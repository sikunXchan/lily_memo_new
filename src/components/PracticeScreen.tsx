'use client';

import { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { createPortal } from 'react-dom';
import { Bar, Line, Pie, Scatter } from 'react-chartjs-2';
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, PointElement,
  LineElement, ArcElement, Title, Tooltip, Legend, Filler,
} from 'chart.js';
import {
  ArrowLeft, Sparkles, Wand2, ImagePlus, FileText, X, Play, Trash2,
  Check, ChevronRight, RotateCcw, Trophy, Loader2, PencilLine,
  Settings2, MessageCircle, ChevronDown, ChevronUp, Search, NotebookText,
  Clock, GraduationCap,
} from 'lucide-react';
import 'katex/dist/katex.min.css';
import { db } from '@/lib/db';
import type { ProblemSet, PracticeQuestion, Note, Folder } from '@/lib/db';
import {
  generateProblemSet, saveProblemSet, deleteProblemSet, recordAttempt,
} from '@/lib/practice';
import type { ChatAttachment, ChatTurn } from '@/lib/gemini';
import { callGeminiChat } from '@/lib/gemini';
import { getEffectiveApiKey, getUserName } from '@/lib/appLang';
import { renderRich } from '@/lib/richText';
import { noteHtmlToText } from '@/lib/noteText';
import { getAppLang } from '@/lib/appLang';

ChartJS.register(
  CategoryScale, LinearScale, BarElement, PointElement, LineElement,
  ArcElement, Title, Tooltip, Legend, Filler,
);

// ── Helpers ────────────────────────────────────────────────────────────────────
const TYPE_BADGE: Record<string, { ja: string; en: string; emoji: string }> = {
  mcq:     { ja: '選択',   en: 'Choice',  emoji: '🔘' },
  written: { ja: '記述',   en: 'Written', emoji: '✍️' },
  fill:    { ja: '穴埋め', en: 'Fill-in', emoji: '⬜' },
  tf:      { ja: '○×',    en: 'T/F',     emoji: '⭕' },
};

function typeLabel(type: string): string {
  const b = TYPE_BADGE[type];
  if (!b) return '';
  return getAppLang() === 'en' ? b.en : b.ja;
}

const norm = (s: string) =>
  s.replace(/\s+/g, '').replace(/[、。．,，.・]/g, '').toLowerCase();

function utf8ToBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}

function fileToAttachment(file: File): Promise<ChatAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1] ?? '';
      resolve({ mimeType: file.type, data: base64 });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ── Rich text ──────────────────────────────────────────────────────────────────
function Rich({ src, className }: { src: string; className?: string }) {
  const html = useMemo(() => renderRich(src), [src]);
  return <div className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}

// ── Chart helpers ─────────────────────────────────────────────────────────────

// Strip LaTeX delimiters and commands from a string so Chart.js can display it.
function stripLatexForChart(s: string): string {
  if (/^#[0-9a-f]/i.test(s) || /^rgba?\(/.test(s) || /^https?:/.test(s)) return s;
  const processInner = (inner: string) =>
    inner
      .replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, '($1)/($2)')
      .replace(/\\sqrt\{([^}]*)\}/g, '√$1')
      .replace(/\\[a-zA-Z]+\*?\{([^}]*)\}/g, '$1')
      .replace(/\\[a-zA-Z]+/g, '')
      .replace(/\^2(?![0-9])/g, '²')
      .replace(/\^3(?![0-9])/g, '³')
      .replace(/\^\{([^}]*)\}/g, '^$1')
      .replace(/[{}]/g, '')
      .trim();
  return s
    .replace(/\$\$([\s\S]*?)\$\$/g, (_m, inner: string) => processInner(inner))
    .replace(/\$((?:[^$\\]|\\.)*?)\$/g, (_m, inner: string) => processInner(inner))
    .replace(/\s+/g, ' ')
    .trim();
}

function processChartStrings(val: unknown): unknown {
  if (typeof val === 'string') return stripLatexForChart(val);
  if (Array.isArray(val)) return val.map(processChartStrings);
  if (val && typeof val === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      result[k] = processChartStrings(v);
    }
    return result;
  }
  return val;
}

// Prepare a raw AI chart config for rendering: strip LaTeX from text fields and
// apply exam-style defaults (grid lines, no fill under lines, no animation).
function prepareChartConfig(cfg: Record<string, unknown>): Record<string, unknown> {
  const clean = processChartStrings(cfg) as Record<string, unknown>;
  const type = (clean.type as string) || 'bar';

  // Exam-style line charts: no fill, subtle smoothing
  if (type === 'line') {
    const d = clean.data as Record<string, unknown> | undefined;
    if (d && Array.isArray(d.datasets)) {
      d.datasets = (d.datasets as Record<string, unknown>[]).map(ds => ({
        ...ds,
        fill: false,
        tension: ds.tension !== undefined ? ds.tension : 0.2,
        borderWidth: ds.borderWidth !== undefined ? ds.borderWidth : 2,
      }));
    }
  }

  const existingOpts = ((clean.options as Record<string, unknown>) ?? {});
  const existingScales = ((existingOpts.scales as Record<string, unknown>) ?? {});

  clean.options = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    ...existingOpts,
    ...(type !== 'pie' ? {
      scales: {
        x: {
          grid: { display: true, color: 'rgba(0,0,0,0.1)' },
          ticks: { color: '#444' },
          ...((existingScales.x as Record<string, unknown>) ?? {}),
        },
        y: {
          grid: { display: true, color: 'rgba(0,0,0,0.1)' },
          ticks: { color: '#444' },
          ...((existingScales.y as Record<string, unknown>) ?? {}),
        },
      },
    } : {}),
  };

  return clean;
}

// ── Chart renderer (parses AI's Chart.js JSON config) ────────────────────────────
function QuestionChart({ config }: { config: string }) {
  const parsed = useMemo(() => {
    try {
      const c = JSON.parse(config);
      if (c && c.data) return prepareChartConfig(c);
    } catch { /* ignore */ }
    return null;
  }, [config]);
  if (!parsed) return null;
  const type = (parsed.type as string) || 'bar';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = parsed.data as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const options = parsed.options as any;
  return (
    <div className="pq-chart">
      {type === 'line'    && <Line data={data} options={options} />}
      {type === 'pie'     && <Pie data={data} options={options} />}
      {type === 'scatter' && <Scatter data={data} options={options} />}
      {(type === 'bar' || !['line', 'pie', 'scatter'].includes(type)) && <Bar data={data} options={options} />}
      <style jsx>{`
        .pq-chart { height: 240px; background: #fff; border-radius: 12px; padding: 12px; margin: 12px 0; border: 1px solid var(--border); }
      `}</style>
    </div>
  );
}

interface PracticeScreenProps {
  onGoBack: () => void;
  onOpenAI?: (context: string) => void;
}

// ── Context builders for Lily AI hand-off ──────────────────────────────────
function buildQuestionContext(
  set: ProblemSet, q: PracticeQuestion, idx: number, total: number,
  textAns: string, selected: number | null, isCorrect: boolean | undefined,
): string {
  const en = getAppLang() === 'en';
  const lines: string[] = [
    en ? `[Practice context] ${set.title}` : `[演習コンテキスト] ${set.title}`,
    en ? `Question ${idx + 1} / ${total} (${typeLabel(q.type)})` : `問題 ${idx + 1} / ${total}（${typeLabel(q.type)}）`,
  ];
  if (q.passage) { lines.push(''); lines.push(en ? 'Reading passage:' : '本文:', q.passage); }
  lines.push(''); lines.push(en ? 'Question:' : '問題文:', q.prompt);
  const ans = q.answer ?? (q.choices && q.correct !== undefined ? q.choices[q.correct] : '');
  if (ans) lines.push(en ? `Model answer: ${ans}` : `模範解答: ${ans}`);
  if (q.explanation) lines.push(en ? `Explanation: ${q.explanation}` : `解説: ${q.explanation}`);
  const userAns = q.type === 'mcq' && selected !== null && q.choices ? q.choices[selected] : textAns;
  if (userAns) lines.push(en ? `Your answer: ${userAns}` : `あなたの回答: ${userAns}`);
  if (isCorrect !== undefined) lines.push(en ? (isCorrect ? 'Result: Correct' : 'Result: Incorrect') : (isCorrect ? '結果: 正解' : '結果: 不正解'));
  return lines.join('\n');
}

function buildResultContext(
  set: ProblemSet, queue: PracticeQuestion[],
  results: Record<string, boolean>, correct: number, total: number,
): string {
  const en = getAppLang() === 'en';
  const pct = total > 0 ? Math.round((correct / total) * 100) : 0;
  const lines: string[] = [
    en ? `[Practice results] ${set.title}` : `[演習結果] ${set.title}`,
  ];
  if (set.subject) lines.push(en ? `Subject: ${set.subject}` : `科目: ${set.subject}`);
  lines.push(en ? `Score: ${correct} / ${total} (${pct}%)` : `スコア: ${correct} / ${total}（${pct}%）`);
  const wrong = queue.filter(q => results[q.id] === false);
  if (wrong.length > 0) {
    lines.push(''); lines.push(en ? '--- Incorrect questions ---' : '--- 間違えた問題 ---');
    for (const q of wrong) {
      lines.push(''); lines.push(q.prompt);
      const ans = q.answer ?? (q.choices && q.correct !== undefined ? q.choices[q.correct] : '');
      if (ans) lines.push(en ? `Answer: ${ans}` : `正解: ${ans}`);
      if (q.explanation) lines.push(en ? `Why: ${q.explanation}` : `解説: ${q.explanation}`);
    }
  }
  return lines.join('\n');
}

type View = 'list' | 'solve' | 'result';
type ScreenMode = 'practice' | 'lesson';

function buildLessonSystemPrompt(topic: string, en: boolean): string {
  const topicLine = topic
    ? (en ? `\nMain topic: ${topic}` : `\nメインのトピック：${topic}`)
    : '';
  const name = getUserName();
  const nameLine = name
    ? (en
        ? `\nYour student's name is ${name} — address them by name naturally.`
        : `\n生徒の名前は「${name}」です。自然に名前で呼びかけてください。`)
    : '';
  if (en) {
    return `You are "Lily", an excellent and warm 1-on-1 private tutor. You teach the student through an interactive back-and-forth conversation — NOT by dumping the whole lesson at once.

How to run the lesson (strict):
- Teach only ONE small chunk (one concept / one step) per message. Keep each message short and digestible.
- Use concrete examples and analogies. Be encouraging and friendly; a few emojis are fine.
- At the end of each message, ask one short comprehension question, then say: "Ask me anything if something's unclear — otherwise tap Next ▶ to continue."
- If the student asks a question, answer it kindly and thoroughly, then guide them back to the lesson.
- When the student says "next", teach the next chunk that follows on from the previous one.
- When you have covered everything, write "## Summary" with the key points as bullets and tell them the lesson is complete.
- If materials are attached, base the lesson on their content.${nameLine}${topicLine}`;
  }
  return `あなたは優秀で温かいマンツーマンの家庭教師「Lily」です。生徒と対話のキャッチボールをしながら授業を進めます。一度に全部を教えるのではなく、会話形式で少しずつ教えてください。

進め方（厳守）：
- 1回の発言では「1つの小さなまとまり（1つの概念／1ステップ）」だけを教える。1回の発言は短く、消化しやすい量にする。
- 具体例や比喩を使う。難しい用語には（ふりがな）を付ける。親しみやすく励ましながら。絵文字も少し使ってOK。
- 発言の最後に、理解度を確認する短い問いかけを1つ入れる。そして「分からないところがあれば何でも聞いてね。大丈夫なら『次へ ▶』を押してね」と伝えて終える。
- 生徒が質問したら、その質問に丁寧に答えてから、授業に戻す。
- 生徒が「次へ」と言ったら、前回の続きの次のまとまりを教える。
- すべての内容を教え終えたら、「## まとめ」で要点を箇条書きにして、授業の終わりを伝える。
- 資料が添付されている場合は、その内容に沿って授業を組み立てる。${nameLine}${topicLine}`;
}

export default function PracticeScreen({ onGoBack, onOpenAI }: PracticeScreenProps) {
  const en = getAppLang() === 'en';

  const sets = useLiveQuery<ProblemSet[]>(
    () => db.problemSets.orderBy('createdAt').reverse().filter(s => !s.deletedAt).toArray(), []
  ) ?? [];

  // Existing in-app notes, usable as source material for problem generation.
  // Handwriting notes are excluded — their content is stroke JSON, not text.
  const allNotes = useLiveQuery<Note[]>(
    () => db.notes.filter(n => !n.deletedAt && n.type !== 'handwriting').toArray(), []
  ) ?? [];
  const allFolders = useLiveQuery<Folder[]>(
    () => db.folders.filter(f => !f.deletedAt).toArray(), []
  ) ?? [];

  const [view, setView] = useState<View>('list');
  const [screenMode, setScreenMode] = useState<ScreenMode>('practice');

  // ── Lesson state (conversational 1-on-1) ──
  const [lessonTopic, setLessonTopic] = useState('');
  const [lessonStarted, setLessonStarted] = useState(false);
  const [lessonTurns, setLessonTurns] = useState<ChatTurn[]>([]); // full API history; [0] is hidden kickoff
  const [lessonInput, setLessonInput] = useState('');
  const [lessonLoading, setLessonLoading] = useState(false);
  const [lessonError, setLessonError] = useState('');
  const lessonSysRef = useRef('');
  const lessonEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    lessonEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lessonTurns, lessonLoading]);

  // Send the current history to Lily and append her reply.
  async function runLessonTurn(history: ChatTurn[]) {
    const apiKey = getEffectiveApiKey();
    if (!apiKey) { setLessonError(en ? 'Set your API key in Settings.' : 'APIキーを設定してください。'); return; }
    setLessonLoading(true);
    setLessonError('');
    try {
      const reply = await callGeminiChat(history, lessonSysRef.current, apiKey, {
        temperature: 0.7,
        maxOutputTokens: 8192,
      });
      setLessonTurns([...history, { role: 'model', text: reply.trim() }]);
    } catch {
      setLessonError(en ? 'Something went wrong. Tap retry.' : 'うまくいかなかった…もう一度試してね。');
    } finally {
      setLessonLoading(false);
    }
  }

  async function startLesson() {
    const topic = lessonTopic.trim();
    const hasAtts = genImages.length > 0 || genMdFiles.length > 0 || genNotes.length > 0;
    if (!topic && !hasAtts) return;
    if (lessonLoading) return;
    const apiKey = getEffectiveApiKey();
    if (!apiKey) { setLessonError(en ? 'Set your API key in Settings.' : 'APIキーを設定してください。'); return; }

    // Gather attachments once for the kickoff turn.
    const mdAtts: ChatAttachment[] = genMdFiles.map(f => ({
      mimeType: 'text/plain', data: utf8ToBase64(f.content),
    }));
    const noteRows = genNotes.length > 0 ? await db.notes.bulkGet(genNotes.map(n => n.id)) : [];
    const noteAtts: ChatAttachment[] = noteRows
      .filter((n): n is Note => !!n)
      .map(n => {
        const body = noteHtmlToText(n.content || '');
        const header = en ? `# Note: ${n.title || 'Untitled'}` : `# メモ: ${n.title || '無題'}`;
        return { mimeType: 'text/plain', data: utf8ToBase64(`${header}\n\n${body}`) };
      });
    const attachments = [...mdAtts, ...noteAtts, ...genImages.map(g => g.att)];

    lessonSysRef.current = buildLessonSystemPrompt(topic, en);
    const kickoff: ChatTurn = {
      role: 'user',
      text: en
        ? 'Please start the lesson from the very first chunk. Teach me step by step.'
        : '最初のまとまりから授業を始めてね。少しずつ教えて。',
      attachments: attachments.length > 0 ? attachments : undefined,
    };
    setLessonStarted(true);
    setLessonTurns([kickoff]);
    await runLessonTurn([kickoff]);
  }

  async function sendLessonMessage(text: string) {
    const msg = text.trim();
    if (!msg || lessonLoading) return;
    setLessonInput('');
    const next: ChatTurn[] = [...lessonTurns, { role: 'user', text: msg }];
    setLessonTurns(next);
    await runLessonTurn(next);
  }

  function exitLesson() {
    setLessonStarted(false);
    setLessonTurns([]);
    setLessonInput('');
    setLessonError('');
  }

  // ── Generation state ──
  const [genInput, setGenInput] = useState('');
  const [genImages, setGenImages] = useState<{ att: ChatAttachment; url: string }[]>([]);
  const [genMdFiles, setGenMdFiles] = useState<{ name: string; content: string }[]>([]);
  const [genNotes, setGenNotes] = useState<{ id: number; title: string }[]>([]);
  const [showNotePicker, setShowNotePicker] = useState(false);
  const [notePickerSearch, setNotePickerSearch] = useState('');
  const [genLoading, setGenLoading] = useState(false);
  const [genError, setGenError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const mdRef = useRef<HTMLInputElement>(null);

  // ── Generation settings ──
  const [showGenOpts, setShowGenOpts] = useState(false);
  const [genTypes, setGenTypes] = useState<Set<string>>(new Set(['mcq', 'written', 'fill', 'tf']));
  const [genCount, setGenCount] = useState<number | 'auto'>('auto');
  const [genDiff, setGenDiff] = useState<'easy' | 'medium' | 'hard' | 'oni'>('medium');
  const [genDaimon, setGenDaimon] = useState(false);
  const [genExam, setGenExam] = useState(false);
  const [genExamMin, setGenExamMin] = useState(30);

  // ── Library management (search / subject filter) ──
  const [search, setSearch] = useState('');

  const filteredSets = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sets;
    return sets.filter(s => `${s.title} ${s.subject ?? ''}`.toLowerCase().includes(q));
  }, [sets, search]);

  // ── Solving state ──
  const [activeSet, setActiveSet] = useState<ProblemSet | null>(null);
  const [queue, setQueue] = useState<PracticeQuestion[]>([]);
  const [index, setIndex] = useState(0);
  // qid -> { correct: boolean }
  const [results, setResults] = useState<Record<string, boolean>>({});
  // current question working state
  const [selected, setSelected] = useState<number | null>(null);
  const [textAns, setTextAns] = useState('');
  const [revealed, setRevealed] = useState(false);
  // Exam countdown — null when not a timed exam attempt.
  const [remainingSec, setRemainingSec] = useState<number | null>(null);

  const SUGGESTIONS = en
    ? ['5 multiple-choice questions on photosynthesis', 'A short English reading passage with 3 questions', 'Quiz me on WWII causes']
    : ['光合成の選択問題を5問', '英語長文を1つ作って3問', '二次関数の記述問題を3問', '世界史の一問一答を10問'];

  // ── Generation ──
  const buildGeneratePrompt = useCallback((): string => {
    const base = genInput.trim();
    const settings: string[] = [];
    if (genTypes.size < 4) {
      const labels = [...genTypes].map(t => TYPE_BADGE[t]?.[en ? 'en' : 'ja']).filter(Boolean).join(en ? ' / ' : '・');
      settings.push(en ? `Question types: ${labels} only` : `問題形式: ${labels}のみ`);
    }
    if (genCount !== 'auto') settings.push(en ? `${genCount} questions` : `${genCount}問`);
    if (genDiff !== 'medium') {
      const lbl = en
        ? { easy: 'easy', medium: 'medium', hard: 'hard', oni: 'brutal (鬼)' }[genDiff]
        : { easy: '易しめ', medium: '普通', hard: '難しめ', oni: '鬼' }[genDiff];
      settings.push(en ? `Difficulty: ${lbl}` : `難易度: ${lbl}`);
    }
    if (genDaimon) settings.push(en
      ? 'Compound question format — use a shared passage/source and create multiple sub-questions from it'
      : '大問形式 — 共通の本文・資料（passage）を設定し、そこから複数の設問を作成する');
    if (genExam) settings.push(en
      ? `Exam format — build a real ${genExamMin}-minute mock exam: compound structure, points on every question summing to 100, broad coverage`
      : `模試形式 — 本番の試験のように、制限時間${genExamMin}分相当の分量で作る。大問構成・全問に配点（合計100点）・分野を満遍なくカバー`);
    if (settings.length === 0) return base;
    const tag = en ? '[Settings]' : '[設定]';
    return base ? `${base}\n\n${tag} ${settings.join(en ? ', ' : '、')}` : `${tag} ${settings.join(en ? ', ' : '、')}`;
  }, [genInput, genTypes, genCount, genDiff, genDaimon, genExam, genExamMin, en]);

  const pickImages = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    const added: { att: ChatAttachment; url: string }[] = [];
    for (const f of files.slice(0, 4)) {
      if (!f.type.startsWith('image/')) continue;
      added.push({ att: await fileToAttachment(f), url: URL.createObjectURL(f) });
    }
    setGenImages(prev => [...prev, ...added].slice(0, 4));
    if (fileRef.current) fileRef.current.value = '';
  };

  const removeImage = (i: number) => {
    setGenImages(prev => {
      URL.revokeObjectURL(prev[i]?.url);
      return prev.filter((_, j) => j !== i);
    });
  };

  const pickMdFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    for (const f of files.slice(0, 3)) {
      const content = await f.text();
      setGenMdFiles(prev => [...prev, { name: f.name, content }].slice(0, 3));
    }
    if (mdRef.current) mdRef.current.value = '';
  };
  const removeMdFile = (i: number) => setGenMdFiles(prev => prev.filter((_, j) => j !== i));

  // ── In-app note picker ──
  const folderName = useCallback((id?: number): string => {
    if (id == null) return '';
    return allFolders.find(f => f.id === id)?.name ?? '';
  }, [allFolders]);

  const toggleNote = (n: Note) => {
    if (n.id == null) return;
    const id = n.id;
    setGenNotes(prev => prev.some(x => x.id === id)
      ? prev.filter(x => x.id !== id)
      : [...prev, { id, title: n.title || (en ? 'Untitled' : '無題') }]);
  };
  const removeNote = (id: number) => setGenNotes(prev => prev.filter(x => x.id !== id));

  const pickerNotes = useMemo(() => {
    const q = notePickerSearch.trim().toLowerCase();
    return allNotes
      .filter(n => !q || `${n.title} ${folderName(n.folderId)}`.toLowerCase().includes(q))
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  }, [allNotes, notePickerSearch, folderName]);

  const handleGenerate = async () => {
    if (genLoading) return;
    if (!genInput.trim() && genImages.length === 0 && genMdFiles.length === 0 && genNotes.length === 0) return;
    setGenLoading(true);
    setGenError('');
    try {
      const mdAtts: ChatAttachment[] = genMdFiles.map(f => ({
        mimeType: 'text/plain',
        data: utf8ToBase64(f.content),
      }));
      // Pull the latest content of each selected note and feed it as plain text.
      const noteRows = genNotes.length > 0 ? await db.notes.bulkGet(genNotes.map(n => n.id)) : [];
      const noteAtts: ChatAttachment[] = noteRows
        .filter((n): n is Note => !!n)
        .map(n => {
          const body = noteHtmlToText(n.content || '');
          const header = en ? `# Note: ${n.title || 'Untitled'}` : `# メモ: ${n.title || '無題'}`;
          return { mimeType: 'text/plain', data: utf8ToBase64(`${header}\n\n${body}`) };
        });
      const result = await generateProblemSet(
        buildGeneratePrompt(),
        [...mdAtts, ...noteAtts, ...genImages.map(g => g.att)],
      );
      const id = await saveProblemSet(result, {
        examMode: genExam,
        timeLimitSec: genExam ? genExamMin * 60 : undefined,
      });
      // Clean up the generation form
      genImages.forEach(g => URL.revokeObjectURL(g.url));
      setGenImages([]);
      setGenMdFiles([]);
      setGenNotes([]);
      setGenInput('');
      // Jump straight into solving the freshly-made set
      const fresh = await db.problemSets.get(id);
      if (fresh) startSolving(fresh);
    } catch (err) {
      setGenError(err instanceof Error ? err.message : String(err));
    } finally {
      setGenLoading(false);
    }
  };

  // ── Solving ──
  const startSolving = useCallback((set: ProblemSet, only?: PracticeQuestion[]) => {
    setActiveSet(set);
    setQueue(only ?? set.questions);
    setIndex(0);
    setResults({});
    setSelected(null);
    setTextAns('');
    setRevealed(false);
    // Run the countdown only for a full timed-exam attempt (not a wrong-only review).
    const timed = !only && !!set.examMode && !!set.timeLimitSec;
    setRemainingSec(timed ? set.timeLimitSec! : null);
    setView('solve');
  }, []);

  const current = queue[index];

  const gradeCurrent = useCallback((): boolean => {
    if (!current) return false;
    if (current.type === 'mcq' || current.type === 'tf') {
      return selected === current.correct;
    }
    return false; // fill & written → self-graded
  }, [current, selected]);

  const reveal = () => {
    if (!current) return;
    // mcq and tf are auto-graded; fill and written use self-grading
    if (current.type === 'mcq' || current.type === 'tf') {
      setResults(r => ({ ...r, [current.id]: gradeCurrent() }));
    }
    setRevealed(true);
  };

  const selfGrade = (ok: boolean) => {
    if (!current) return;
    setResults(r => ({ ...r, [current.id]: ok }));
  };

  const finishAttempt = useCallback(async () => {
    const correct = Object.values(results).filter(Boolean).length;
    if (activeSet?.id) await recordAttempt(activeSet.id, correct);
    setRemainingSec(null);
    setView('result');
  }, [results, activeSet]);

  const next = async () => {
    if (index + 1 < queue.length) {
      setIndex(i => i + 1);
      setSelected(null);
      setTextAns('');
      setRevealed(false);
    } else {
      await finishAttempt();
    }
  };

  // Exam countdown: tick once a second while solving a timed set.
  const timerOn = view === 'solve' && remainingSec != null;
  useEffect(() => {
    if (!timerOn) return;
    const id = setInterval(() => {
      setRemainingSec(s => (s == null ? s : Math.max(0, s - 1)));
    }, 1000);
    return () => clearInterval(id);
  }, [timerOn]);

  // Auto-submit the moment the clock hits zero.
  useEffect(() => {
    if (view === 'solve' && remainingSec === 0) void finishAttempt();
  }, [remainingSec, view, finishAttempt]);

  const correctCount = Object.values(results).filter(Boolean).length;
  const total = queue.length;
  const wrongQuestions = queue.filter(q => results[q.id] === false);
  // Exam scoring (points) — falls back to correct-count when no points present.
  const totalPoints = queue.reduce((s, q) => s + (q.points ?? 0), 0);
  const earnedPoints = queue.reduce((s, q) => s + (results[q.id] ? (q.points ?? 0) : 0), 0);
  const isExam = !!activeSet?.examMode && totalPoints > 0;

  // ── Delete ──
  const handleDelete = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(en ? 'Delete this problem set?' : 'この問題セットを削除する？')) return;
    await deleteProblemSet(id);
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // RESULT VIEW
  // ═══════════════════════════════════════════════════════════════════════════
  if (view === 'result' && activeSet) {
    const pct = isExam
      ? Math.round((earnedPoints / totalPoints) * 100)
      : total > 0 ? Math.round((correctCount / total) * 100) : 0;
    const msg = pct >= 90 ? (en ? 'Perfect! 🎉' : '完璧だね！🎉')
      : pct >= 70 ? (en ? 'Great work! ✨' : 'よくできました！✨')
      : pct >= 40 ? (en ? 'Keep going! 💪' : 'その調子！💪')
      : (en ? "Let's review together 🌱" : '一緒に復習しよう🌱');
    const ring = 2 * Math.PI * 52;
    return (
      <div className="ps-root">
        <div className="ps-result">
          <div className="psr-ring-wrap">
            <svg viewBox="0 0 120 120" className="psr-ring">
              <circle cx="60" cy="60" r="52" className="psr-ring-bg" />
              <circle cx="60" cy="60" r="52" className="psr-ring-fg"
                strokeDasharray={ring}
                strokeDashoffset={ring - (ring * pct) / 100}
              />
            </svg>
            <div className="psr-ring-center">
              <span className="psr-pct">{pct}<small>%</small></span>
              <span className="psr-frac">
                {isExam ? (en ? `${earnedPoints}/${totalPoints} pts` : `${earnedPoints}/${totalPoints}点`) : `${correctCount}/${total}`}
              </span>
            </div>
          </div>
          <p className="psr-msg">{msg}</p>
          <p className="psr-sub">{isExam && <GraduationCap size={13} className="psr-exam-ic" />}{activeSet.title}</p>

          {/* Per-question review */}
          <div className="psr-review">
            {queue.map((q, i) => (
              <div key={q.id} className={`psr-rev-row ${results[q.id] ? 'ok' : 'ng'}`}>
                <span className="psr-rev-num">{i + 1}</span>
                <span className="psr-rev-badge">{TYPE_BADGE[q.type]?.emoji} {typeLabel(q.type)}</span>
                <span className="psr-rev-icon">{results[q.id] ? <Check size={16} /> : <X size={16} />}</span>
              </div>
            ))}
          </div>

          <div className="psr-actions">
            {wrongQuestions.length > 0 && (
              <button className="psr-btn primary" onClick={() => startSolving(activeSet, wrongQuestions)}>
                <RotateCcw size={16} /> {en ? `Review ${wrongQuestions.length} wrong` : `間違えた${wrongQuestions.length}問を復習`}
              </button>
            )}
            {onOpenAI && (
              <button className="psr-btn lily" onClick={() => {
                const ctx = buildResultContext(activeSet, queue, results, correctCount, total);
                onOpenAI(ctx);
              }}>
                <MessageCircle size={16} /> {en ? 'Discuss with Lily' : 'Lilyに相談する'}
              </button>
            )}
            <button className="psr-btn" onClick={() => startSolving(activeSet)}>
              <Play size={16} /> {en ? 'Retry all' : 'もう一度全部'}
            </button>
            <button className="psr-btn ghost" onClick={() => { setView('list'); setActiveSet(null); }}>
              {en ? 'Back to list' : '一覧に戻る'}
            </button>
          </div>
        </div>
        <PracticeStyles />
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SOLVE VIEW (full-screen, portal)
  // ═══════════════════════════════════════════════════════════════════════════
  if (view === 'solve' && current) {
    const isCorrect = results[current.id];
    const canReveal = current.type === 'written'
      ? true
      : current.type === 'fill'
        ? textAns.trim() !== ''
        : selected !== null;

    const overlay = (
      <div className="ps-solve">
        {/* Top bar */}
        <div className="psv-top">
          <button className="psv-close" onClick={() => { setView('list'); setActiveSet(null); }}>
            <X size={20} />
          </button>
          <div className="psv-progress-track">
            <div className="psv-progress-fill" style={{ width: `${((index) / total) * 100}%` }} />
          </div>
          {remainingSec != null && (
            <span className={`psv-timer ${remainingSec <= 60 ? 'low' : ''}`}>
              <Clock size={13} />
              {Math.floor(remainingSec / 60)}:{String(remainingSec % 60).padStart(2, '0')}
            </span>
          )}
          <span className="psv-count">{index + 1}<small>/{total}</small></span>
        </div>

        {/* Scrollable question body */}
        <div className="psv-body">
          <div className="psv-card" key={current.id}>
            <div className="psv-type">{TYPE_BADGE[current.type]?.emoji} {typeLabel(current.type)}</div>

            {current.passage && (
              <div className="psv-passage">
                <Rich src={current.passage} className="rich" />
              </div>
            )}

            {current.chart && <QuestionChart config={current.chart} />}

            <Rich src={current.prompt} className="rich psv-prompt" />

            {/* ── Answer area ── */}
            {current.type === 'mcq' && current.choices && (
              <div className="psv-choices">
                {current.choices.map((c, i) => {
                  const state = !revealed
                    ? (selected === i ? 'sel' : '')
                    : i === current.correct ? 'correct'
                      : selected === i ? 'wrong' : '';
                  return (
                    <button
                      key={i}
                      className={`psv-choice ${state}`}
                      disabled={revealed}
                      onClick={() => setSelected(i)}
                    >
                      <span className="psv-choice-mark">{String.fromCharCode(65 + i)}</span>
                      <Rich src={c} className="rich psv-choice-text" />
                      {revealed && i === current.correct && <Check size={18} className="psv-choice-ic" />}
                      {revealed && selected === i && i !== current.correct && <X size={18} className="psv-choice-ic" />}
                    </button>
                  );
                })}
              </div>
            )}

            {current.type === 'tf' && (
              <div className="psv-tf">
                {[0, 1].map(v => {
                  const state = !revealed
                    ? (selected === v ? 'sel' : '')
                    : v === current.correct ? 'correct'
                      : selected === v ? 'wrong' : '';
                  return (
                    <button key={v} className={`psv-tf-btn ${state}`} disabled={revealed} onClick={() => setSelected(v)}>
                      {v === 0 ? '⭕' : '❌'}
                      <span>{v === 0 ? (en ? 'True' : '正しい') : (en ? 'False' : '誤り')}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {current.type === 'fill' && (
              <input
                className={`psv-input ${revealed ? (isCorrect ? 'ok' : 'ng') : ''}`}
                value={textAns}
                onChange={e => setTextAns(e.target.value)}
                placeholder={en ? 'Your answer…' : '答えを入力…'}
                disabled={revealed}
                onKeyDown={e => { if (e.key === 'Enter' && canReveal && !revealed) reveal(); }}
              />
            )}

            {current.type === 'written' && (
              <textarea
                className="psv-textarea"
                value={textAns}
                onChange={e => setTextAns(e.target.value)}
                placeholder={en ? 'Write your answer…' : '答えを書いてみよう…'}
                disabled={revealed}
                rows={4}
              />
            )}

            {/* ── Reveal area ── */}
            {revealed && (
              <div className="psv-reveal">
                {/* mcq/tf: auto verdict. fill/written: self-grade only */}
                {(current.type === 'mcq' || current.type === 'tf') && (
                  <div className={`psv-verdict ${isCorrect ? 'ok' : 'ng'}`}>
                    {isCorrect ? <><Check size={18} /> {en ? 'Correct!' : '正解！'}</> : <><X size={18} /> {en ? 'Incorrect' : '不正解'}</>}
                  </div>
                )}
                {(current.type === 'fill' || current.type === 'written') && current.answer && (
                  <div className="psv-answer">
                    <span className="psv-answer-label">{en ? 'Model answer' : '模範解答'}</span>
                    <Rich src={current.answer} className="rich" />
                  </div>
                )}
                {current.explanation && (
                  <div className="psv-explain">
                    <span className="psv-explain-label">💡 {en ? 'Explanation' : '解説'}</span>
                    <Rich src={current.explanation} className="rich" />
                  </div>
                )}
                {(current.type === 'written' || current.type === 'fill') && (
                  <div className="psv-selfgrade">
                    <span className="psv-sg-q">{en ? 'Self-grade:' : '自己採点：'}</span>
                    <button className={`psv-sg-btn ok ${isCorrect === true ? 'on' : ''}`} onClick={() => selfGrade(true)}>
                      <Check size={15} /> {en ? 'Got it' : 'できた'}
                    </button>
                    <button className={`psv-sg-btn ng ${isCorrect === false ? 'on' : ''}`} onClick={() => selfGrade(false)}>
                      <X size={15} /> {en ? 'Missed' : 'できなかった'}
                    </button>
                  </div>
                )}
                {onOpenAI && (
                  <button className="psv-lily-btn" onClick={() => {
                    const ctx = buildQuestionContext(activeSet!, current, index, total, textAns, selected, results[current.id]);
                    onOpenAI(ctx);
                  }}>
                    <MessageCircle size={14} /> {en ? 'Ask Lily for more' : 'Lilyに詳しく聞く'}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Bottom action */}
        <div className="psv-bottom">
          {!revealed ? (
            <button className="psv-action" disabled={!canReveal} onClick={reveal}>
              {en ? 'Check answer' : '答えを確認'}
            </button>
          ) : (
            <button
              className="psv-action next"
              disabled={current.type === 'written' && isCorrect === undefined}
              onClick={() => void next()}
            >
              {index + 1 < total ? <>{en ? 'Next' : '次へ'} <ChevronRight size={18} /></> : <>{en ? 'See results' : '結果を見る'} <Trophy size={18} /></>}
            </button>
          )}
        </div>

        <PracticeStyles />
      </div>
    );
    return typeof document !== 'undefined' ? createPortal(overlay, document.body) : overlay;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LIST VIEW
  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <div className="ps-root">
      {/* Header */}
      <div className="ps-header">
        <button className="ps-back" onClick={onGoBack}><ArrowLeft size={18} /></button>
        <PencilLine size={16} className="ps-head-ic" />
        <span className="ps-title">{en ? 'Practice' : '演習'}</span>
      </div>

      <div className="ps-body">
        {/* ── Mode toggle ── */}
        <div className="ps-mode-toggle">
          <button
            className={`ps-mode-btn${screenMode === 'practice' ? ' on' : ''}`}
            onClick={() => setScreenMode('practice')}
          >
            <PencilLine size={13} />
            {en ? 'Practice' : '演習'}
          </button>
          <button
            className={`ps-mode-btn${screenMode === 'lesson' ? ' on' : ''}`}
            onClick={() => setScreenMode('lesson')}
          >
            <GraduationCap size={13} />
            {en ? 'Lesson' : '授業'}
          </button>
        </div>

        {/* ── Lesson: setup view ── */}
        {screenMode === 'lesson' && !lessonStarted && (
          <div className="ps-lesson">
            <div className="ps-lesson-desc">
              {en
                ? 'Type a topic or attach materials — Lily becomes your private 1-on-1 tutor and teaches you step by step. Ask her anything during the lesson.'
                : 'トピックを入力するか資料を添付すると、Lilyがマンツーマンの先生になって一歩ずつ教えてくれるよ。途中でいつでも質問できるよ。'}
            </div>

            {/* Hidden file inputs for the lesson setup */}
            <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={pickImages} />
            <input ref={mdRef} type="file" accept=".md,.txt,text/plain,text/markdown" multiple hidden onChange={e => void pickMdFiles(e)} />

            {/* Attached materials preview */}
            {(genMdFiles.length > 0 || genNotes.length > 0 || genImages.length > 0) && (
              <div className="ps-gen-mds">
                {genMdFiles.map((f, i) => (
                  <div key={i} className="ps-gen-md-chip">
                    <FileText size={12} /><span>{f.name}</span>
                    <button onClick={() => removeMdFile(i)}><X size={11} /></button>
                  </div>
                ))}
                {genNotes.map(n => (
                  <div key={n.id} className="ps-gen-md-chip note">
                    <NotebookText size={12} /><span>{n.title}</span>
                    <button onClick={() => removeNote(n.id)}><X size={11} /></button>
                  </div>
                ))}
                {genImages.map((g, i) => (
                  <div key={i} className="ps-gen-img" style={{ width: 48, height: 48 }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={g.url} alt="" />
                    <button onClick={() => removeImage(i)}><X size={12} /></button>
                  </div>
                ))}
              </div>
            )}

            <input
              className="ps-lesson-input"
              value={lessonTopic}
              onChange={e => setLessonTopic(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void startLesson(); }}
              placeholder={en ? 'Topic (or leave blank to use materials)' : 'トピック（資料だけでもOK）'}
              disabled={lessonLoading}
            />

            <div className="ps-lesson-setup-row">
              <button className="ps-lesson-att" title={en ? 'Attach image' : '画像を添付'} onClick={() => fileRef.current?.click()} disabled={lessonLoading}>
                <ImagePlus size={16} />
              </button>
              <button className="ps-lesson-att" title={en ? 'Attach file' : 'ファイルを添付'} onClick={() => mdRef.current?.click()} disabled={lessonLoading}>
                <FileText size={16} />
              </button>
              <button className={`ps-lesson-att${genNotes.length > 0 ? ' on' : ''}`} title={en ? 'Pick notes' : 'メモを選ぶ'} onClick={() => setShowNotePicker(true)} disabled={lessonLoading}>
                <NotebookText size={16} />
              </button>
              <button
                className="ps-lesson-btn"
                onClick={() => void startLesson()}
                disabled={(!lessonTopic.trim() && genImages.length === 0 && genMdFiles.length === 0 && genNotes.length === 0) || lessonLoading}
              >
                {lessonLoading ? <Loader2 size={15} className="ps-spin" /> : <GraduationCap size={15} />}
                {en ? 'Start lesson' : '授業を始める'}
              </button>
            </div>
            {lessonError && <p className="ps-lesson-err">{lessonError}</p>}
          </div>
        )}

        {/* ── Lesson: conversation view ── */}
        {screenMode === 'lesson' && lessonStarted && (
          <div className="ps-class">
            <div className="ps-class-head">
              <div className="ps-class-head-l">
                <GraduationCap size={15} className="ps-class-head-ic" />
                <span>{lessonTopic.trim() || (en ? 'Lesson with Lily' : 'Lilyの授業')}</span>
              </div>
              <button className="ps-class-exit" onClick={exitLesson}>{en ? 'End' : '終了'}</button>
            </div>

            <div className="ps-class-msgs">
              {lessonTurns.slice(1).map((turn, i) => (
                turn.role === 'model' ? (
                  <div key={i} className="ps-class-row lily">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/lilygirls.PNG" alt="Lily" className="ps-class-ava" />
                    <div
                      className="ps-class-bubble lily rich"
                      dangerouslySetInnerHTML={{ __html: renderRich(turn.text) }}
                    />
                  </div>
                ) : (
                  <div key={i} className="ps-class-row me">
                    <div className="ps-class-bubble me">{turn.text}</div>
                  </div>
                )
              ))}
              {lessonLoading && (
                <div className="ps-class-row lily">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/lilygirls.PNG" alt="Lily" className="ps-class-ava" />
                  <div className="ps-class-bubble lily ps-class-typing">
                    <span /><span /><span />
                  </div>
                </div>
              )}
              {lessonError && (
                <div className="ps-class-err-row">
                  <span>{lessonError}</span>
                  <button onClick={() => void runLessonTurn(lessonTurns)}>{en ? 'Retry' : '再試行'}</button>
                </div>
              )}
              <div ref={lessonEndRef} />
            </div>

            <div className="ps-class-bar">
              <button
                className="ps-class-next"
                onClick={() => void sendLessonMessage(en ? 'Next, please continue.' : '次へ進んで。続きを教えて。')}
                disabled={lessonLoading}
              >
                {en ? 'Next ▶' : '次へ ▶'}
              </button>
              <input
                className="ps-class-input"
                value={lessonInput}
                onChange={e => setLessonInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') void sendLessonMessage(lessonInput); }}
                placeholder={en ? 'Ask the teacher…' : '先生に質問する…'}
                disabled={lessonLoading}
              />
              <button
                className="ps-class-send"
                onClick={() => void sendLessonMessage(lessonInput)}
                disabled={lessonLoading || !lessonInput.trim()}
              >
                <ChevronRight size={18} />
              </button>
            </div>
          </div>
        )}

        {/* ── Generation panel (practice mode only) ── */}
        {screenMode === 'practice' && <div className="ps-gen">
          <div className="ps-gen-head">
            <Sparkles size={15} className="ps-gen-spark" />
            <span>{en ? 'Make a problem set with Lily' : 'Lilyに問題を作ってもらう'}</span>
          </div>

          {genMdFiles.length > 0 && (
            <div className="ps-gen-mds">
              {genMdFiles.map((f, i) => (
                <div key={i} className="ps-gen-md-chip">
                  <FileText size={12} />
                  <span>{f.name}</span>
                  <button onClick={() => removeMdFile(i)}><X size={11} /></button>
                </div>
              ))}
            </div>
          )}

          {genNotes.length > 0 && (
            <div className="ps-gen-mds">
              {genNotes.map(n => (
                <div key={n.id} className="ps-gen-md-chip note">
                  <NotebookText size={12} />
                  <span>{n.title}</span>
                  <button onClick={() => removeNote(n.id)}><X size={11} /></button>
                </div>
              ))}
            </div>
          )}

          {genImages.length > 0 && (
            <div className="ps-gen-imgs">
              {genImages.map((g, i) => (
                <div key={i} className="ps-gen-img">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={g.url} alt="" />
                  <button onClick={() => removeImage(i)}><X size={12} /></button>
                </div>
              ))}
            </div>
          )}

          <textarea
            className="ps-gen-input"
            value={genInput}
            onChange={e => setGenInput(e.target.value)}
            placeholder={en
              ? 'e.g. "5 multiple-choice questions on the water cycle", or attach a textbook photo'
              : '例：「光合成の選択問題を5問」や教科書の写真を添付'}
            rows={3}
            disabled={genLoading}
          />

          <div className="ps-gen-suggest">
            {SUGGESTIONS.map((s, i) => (
              <button key={i} className="ps-sg-chip" disabled={genLoading} onClick={() => setGenInput(s)}>{s}</button>
            ))}
          </div>

          {/* ── Detailed settings ── */}
          <button className="ps-gen-opts-toggle" onClick={() => setShowGenOpts(v => !v)} disabled={genLoading}>
            <Settings2 size={13} /> {en ? 'Options' : '詳細設定'}
            {showGenOpts ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>

          {showGenOpts && (
            <div className="ps-gen-opts">
              {/* Question types */}
              <div className="ps-go-row">
                <span className="ps-go-label">{en ? 'Types' : '形式'}</span>
                <div className="ps-go-chips">
                  {(['mcq', 'fill', 'written', 'tf'] as const).map(t => (
                    <button key={t} className={`ps-go-chip ${genTypes.has(t) ? 'on' : ''}`} onClick={() => {
                      setGenTypes(prev => {
                        const next = new Set(prev);
                        if (next.has(t)) { if (next.size > 1) next.delete(t); }
                        else next.add(t);
                        return next;
                      });
                    }}>
                      {TYPE_BADGE[t]?.emoji} {TYPE_BADGE[t]?.[en ? 'en' : 'ja']}
                    </button>
                  ))}
                </div>
              </div>
              {/* Question count */}
              <div className="ps-go-row">
                <span className="ps-go-label">{en ? 'Count' : '問題数'}</span>
                <button
                  className={`ps-go-chip ${genCount === 'auto' ? 'on' : ''}`}
                  onClick={() => setGenCount('auto')}
                >
                  {en ? 'auto' : 'おまかせ'}
                </button>
                <input
                  type="number"
                  className={`ps-go-count-input${genCount !== 'auto' ? ' active' : ''}`}
                  min={1}
                  max={50}
                  value={genCount === 'auto' ? '' : String(genCount)}
                  placeholder={en ? 'N' : '問数'}
                  onChange={e => {
                    const v = parseInt(e.target.value, 10);
                    if (!isNaN(v) && v >= 1 && v <= 50) setGenCount(v);
                    else if (e.target.value === '') setGenCount('auto');
                  }}
                  onFocus={() => { if (genCount === 'auto') setGenCount(5); }}
                />
              </div>
              {/* Difficulty */}
              <div className="ps-go-row">
                <span className="ps-go-label">{en ? 'Level' : '難易度'}</span>
                <div className="ps-go-chips">
                  {(['easy', 'medium', 'hard', 'oni'] as const).map(d => (
                    <button key={d} className={`ps-go-chip ${d === 'oni' ? 'oni' : ''} ${genDiff === d ? 'on' : ''}`} onClick={() => setGenDiff(d)}>
                      {en
                        ? { easy: 'easy', medium: 'medium', hard: 'hard', oni: '👹 brutal' }[d]
                        : { easy: '易', medium: '普通', hard: '難', oni: '👹 鬼' }[d]}
                    </button>
                  ))}
                </div>
              </div>
              {/* 大問 format */}
              <div className="ps-go-row">
                <span className="ps-go-label">{en ? 'Format' : '形式'}</span>
                <button className={`ps-go-chip ${genDaimon ? 'on' : ''}`} onClick={() => setGenDaimon(v => !v)}>
                  📄 {en ? 'Compound (大問)' : '大問形式'}
                </button>
                <button className={`ps-go-chip exam ${genExam ? 'on' : ''}`} onClick={() => setGenExam(v => !v)}>
                  🎓 {en ? 'Mock exam' : '模試'}
                </button>
              </div>
              {/* Exam time limit (only when mock-exam is on) */}
              {genExam && (
                <div className="ps-go-row">
                  <span className="ps-go-label">{en ? 'Time' : '制限時間'}</span>
                  <div className="ps-go-chips">
                    {[15, 30, 50, 60, 90].map(m => (
                      <button key={m} className={`ps-go-chip ${genExamMin === m ? 'on' : ''}`} onClick={() => setGenExamMin(m)}>
                        {m}{en ? 'min' : '分'}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {genError && <p className="ps-gen-err">{genError}</p>}

          <div className="ps-gen-actions">
            <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={pickImages} />
            <input ref={mdRef} type="file" accept=".md,.txt,text/plain,text/markdown" multiple hidden onChange={e => void pickMdFiles(e)} />
            <button className="ps-gen-attach" onClick={() => fileRef.current?.click()} disabled={genLoading} title={en ? 'Attach image' : '画像を添付'}>
              <ImagePlus size={16} />
            </button>
            <button className="ps-gen-attach" onClick={() => mdRef.current?.click()} disabled={genLoading} title={en ? 'Attach text/markdown' : 'テキスト・mdを添付'}>
              <FileText size={16} />
            </button>
            <button
              className={`ps-gen-attach ${genNotes.length > 0 ? 'on' : ''}`}
              onClick={() => { setNotePickerSearch(''); setShowNotePicker(true); }}
              disabled={genLoading}
              title={en ? 'Use a note from the app' : 'アプリのメモから選ぶ'}
            >
              <NotebookText size={16} />
            </button>
            <button
              className="ps-gen-btn"
              onClick={() => void handleGenerate()}
              disabled={genLoading || (!genInput.trim() && genImages.length === 0 && genMdFiles.length === 0 && genNotes.length === 0)}
            >
              {genLoading
                ? <><Loader2 size={16} className="ps-spin" /> {en ? 'Creating…' : '作成中…'}</>
                : <><Wand2 size={16} /> {en ? 'Generate' : '作成する'}</>}
            </button>
          </div>
        </div>}

        {/* ── In-app note picker (shared between modes) ── */}
        {showNotePicker && typeof document !== 'undefined' && createPortal(
          <div className="ps-notepick-back" onClick={() => setShowNotePicker(false)}>
            <div className="ps-notepick" onClick={e => e.stopPropagation()}>
              <div className="ps-notepick-head">
                <NotebookText size={16} />
                <span>{en ? 'Pick notes' : 'メモを選ぶ'}</span>
                <button className="ps-notepick-close" onClick={() => setShowNotePicker(false)}><X size={16} /></button>
              </div>
              <div className="ps-notepick-search">
                <Search size={14} />
                <input
                  value={notePickerSearch}
                  onChange={e => setNotePickerSearch(e.target.value)}
                  placeholder={en ? 'Search notes…' : 'メモを検索…'}
                />
              </div>
              <div className="ps-notepick-list">
                {pickerNotes.length === 0 ? (
                  <p className="ps-notepick-empty">{en ? 'No notes found.' : 'メモが見つからないよ'}</p>
                ) : pickerNotes.map(n => {
                  const sel = genNotes.some(x => x.id === n.id);
                  const fname = folderName(n.folderId);
                  return (
                    <button key={n.id} className={`ps-notepick-item ${sel ? 'on' : ''}`} onClick={() => toggleNote(n)}>
                      <span className="ps-notepick-check">{sel && <Check size={13} />}</span>
                      <span className="ps-notepick-info">
                        <span className="ps-notepick-title">{n.title || (en ? 'Untitled' : '無題')}</span>
                        {fname && <span className="ps-notepick-folder">{fname}</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="ps-notepick-foot">
                <span className="ps-notepick-count">
                  {genNotes.length > 0
                    ? (en ? `${genNotes.length} selected` : `${genNotes.length}件 選択中`)
                    : (en ? 'Tap to select' : 'タップで選択')}
                </span>
                <button className="ps-notepick-done" onClick={() => setShowNotePicker(false)}>
                  {en ? 'Done' : '決定'}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}

        {/* ── Saved sets (practice only) ── */}
        {screenMode === 'practice' && <div className="ps-list">
          <div className="ps-list-head">
            <p className="ps-list-title">{en ? 'Your problem sets' : '作った問題セット'}</p>
            {sets.length > 0 && <span className="ps-list-count">{sets.length}</span>}
          </div>

          {sets.length === 0 ? (
            <div className="ps-empty">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/9D507C9A-09F0-4B05-9F41-612FBD120675.png" alt="Lily" className="ps-empty-img" />
              <p>{en ? 'No sets yet.' : 'まだ問題セットがないよ'}</p>
              <p className="ps-empty-sub">{en ? 'Ask Lily above to make one!' : '上のフォームから作ってみてね！'}</p>
            </div>
          ) : (
            <>
              {/* Search + subject filter — appears once the library grows */}
              {sets.length > 4 && (
                <div className="ps-filter">
                  <div className="ps-search">
                    <Search size={15} className="ps-search-ic" />
                    <input
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                      placeholder={en ? 'Search title / subject…' : 'タイトル・科目で検索…'}
                    />
                    {search && <button className="ps-search-clear" onClick={() => setSearch('')}><X size={14} /></button>}
                  </div>
                </div>
              )}

              {filteredSets.length === 0 ? (
                <p className="ps-noresult">{en ? 'No matching sets.' : '一致する問題セットがないよ'}</p>
              ) : (
                filteredSets.map(set => (
                  <button key={set.id} className="ps-card" onClick={() => startSolving(set)}>
                    <div className="ps-card-main">
                      <div className="ps-card-top">
                        {set.examMode && (
                          <span className="ps-card-exam">
                            <GraduationCap size={11} /> {en ? 'Exam' : '模試'}
                            {set.timeLimitSec ? ` ${Math.round(set.timeLimitSec / 60)}${en ? 'min' : '分'}` : ''}
                          </span>
                        )}
                        {set.subject && <span className="ps-card-subject">{set.subject}</span>}
                        <span className="ps-card-count">{set.count}{en ? ' Q' : '問'}</span>
                      </div>
                      <span className="ps-card-name">{set.title}</span>
                      {(set.attempts ?? 0) > 0 && (
                        <span className="ps-card-best">
                          <Trophy size={11} /> {en ? 'Best' : '最高'} {set.bestScore ?? 0}/{set.count}
                          <span className="ps-card-attempts">・{en ? `${set.attempts}× ` : `${set.attempts}回`}</span>
                        </span>
                      )}
                    </div>
                    <div className="ps-card-side">
                      <span className="ps-card-play"><Play size={16} fill="currentColor" /></span>
                      <span className="ps-card-del" onClick={(e) => void handleDelete(set.id!, e)}><Trash2 size={14} /></span>
                    </div>
                  </button>
                ))
              )}
            </>
          )}
        </div>}
      </div>

      {/* Full-screen overlay during generation — blocks all other taps */}
      {genLoading && typeof document !== 'undefined' && createPortal(
        <div className="ps-genload">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/9D507C9A-09F0-4B05-9F41-612FBD120675.png" alt="Lily" className="ps-genload-img" />
          <div className="ps-genload-spinner"><Loader2 size={26} className="ps-spin" /></div>
          <p className="ps-genload-title">{en ? 'Lily is creating your problems…' : 'Lilyが問題を作ってるよ…'}</p>
          <p className="ps-genload-sub">{en ? 'This can take a little while' : '少し時間がかかることがあるよ'}</p>
          <PracticeStyles />
        </div>,
        document.body
      )}

      <PracticeStyles />
    </div>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────
// All practice styles live in one global block. Class names are uniquely
// prefixed (ps-/psv-/psr-/pq-/rich) so global scope is safe and lets the same
// rules apply across the list, full-screen solve (portaled) and result views.
function PracticeStyles() {
  return (
    <style jsx global>{`
  .rich { font-size: 0.9rem; line-height: 1.7; color: var(--foreground); word-break: break-word; }
  .rich p { margin: 0 0 8px; }
  .rich p:last-child { margin-bottom: 0; }
  .rich h2 { font-size: 1.02rem; font-weight: 800; margin: 4px 0 8px; color: #8b5cf6; }
  .rich h3 { font-size: 0.94rem; font-weight: 700; margin: 8px 0 6px; }
  .rich h2:first-child, .rich h3:first-child { margin-top: 0; }
  .rich blockquote { margin: 8px 0; padding: 8px 12px; border-left: 3px solid #ec4899; background: color-mix(in srgb, #ec4899 8%, transparent); border-radius: 6px; }
  .rich blockquote p { margin: 0; }
  .rich ul, .rich ol { padding-left: 20px; margin: 6px 0; }
  .rich strong { font-weight: 700; }
  .rich code.rt-code { background: rgba(0,0,0,.06); padding: 1px 5px; border-radius: 4px; font-size: 0.85em; }
  .rich img { max-width: 100%; border-radius: 8px; }
  .rich .katex { font-size: 1.05em; }
  .rich table { border-collapse: collapse; width: 100%; margin: 10px 0; font-size: 0.85em; }
  .rich th, .rich td { border: 1px solid var(--border); padding: 7px 10px; text-align: left; }
  .rich th { background: var(--accent); font-weight: 700; }
  .rich tr:nth-child(even) td { background: color-mix(in srgb, var(--accent) 60%, transparent); }

  .ps-root { flex: 1; display: flex; flex-direction: column; background: var(--background); overflow: hidden; }
  .ps-header { display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-bottom: 1px solid var(--border); background: var(--background); flex-shrink: 0; }
  .ps-back { width: 34px; height: 34px; border-radius: 50%; border: 1px solid var(--border); background: var(--accent); display: flex; align-items: center; justify-content: center; cursor: pointer; color: var(--primary); flex-shrink: 0; }
  .ps-head-ic { color: #8b5cf6; }
  .ps-title { font-size: 18px; font-weight: 800; background: linear-gradient(120deg, #8b5cf6, #ec4899); -webkit-background-clip: text; background-clip: text; color: transparent; }
  .ps-body { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 18px; -webkit-overflow-scrolling: touch; }

  /* Generation panel */
  .ps-gen { background: linear-gradient(135deg, color-mix(in srgb, #8b5cf6 10%, var(--background)), color-mix(in srgb, #ec4899 7%, var(--background))); border: 1.5px solid color-mix(in srgb, #8b5cf6 25%, transparent); border-radius: 18px; padding: 14px; display: flex; flex-direction: column; gap: 10px; }
  .ps-gen-head { display: flex; align-items: center; gap: 7px; font-size: 0.86rem; font-weight: 800; color: var(--foreground); }
  .ps-gen-spark { color: #8b5cf6; }
  .ps-gen-mds { display: flex; gap: 6px; flex-wrap: wrap; }
  .ps-gen-md-chip { display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px 4px 8px; border-radius: 99px; background: color-mix(in srgb, #8b5cf6 14%, var(--background)); border: 1px solid color-mix(in srgb, #8b5cf6 30%, transparent); font-size: .72rem; font-weight: 700; color: #8b5cf6; max-width: 200px; }
  .ps-gen-md-chip span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ps-gen-md-chip button { display: flex; align-items: center; justify-content: center; border: none; background: none; cursor: pointer; padding: 0; color: #8b5cf6; opacity: .7; flex-shrink: 0; }
  .ps-gen-imgs { display: flex; gap: 8px; flex-wrap: wrap; }
  .ps-gen-img { position: relative; width: 60px; height: 60px; border-radius: 10px; overflow: hidden; border: 1px solid var(--border); }
  .ps-gen-img img { width: 100%; height: 100%; object-fit: cover; }
  .ps-gen-img button { position: absolute; top: 2px; right: 2px; width: 18px; height: 18px; border-radius: 50%; background: rgba(0,0,0,.6); border: none; color: #fff; display: flex; align-items: center; justify-content: center; cursor: pointer; }
  .ps-gen-input { width: 100%; background: var(--background); border: 1px solid var(--border); border-radius: 12px; padding: 10px 12px; font-size: 0.88rem; color: var(--foreground); outline: none; font-family: inherit; resize: none; line-height: 1.5; }
  .ps-gen-input:focus { border-color: #8b5cf6; }
  .ps-gen-suggest { display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; padding-bottom: 2px; }
  .ps-gen-suggest::-webkit-scrollbar { display: none; }
  .ps-sg-chip { flex-shrink: 0; background: var(--background); border: 1px solid color-mix(in srgb, #8b5cf6 30%, var(--border)); color: #8b5cf6; border-radius: 16px; padding: 5px 12px; font-size: 0.74rem; font-weight: 600; cursor: pointer; white-space: nowrap; transition: all .15s; }
  .ps-sg-chip:hover:not(:disabled) { background: color-mix(in srgb, #8b5cf6 12%, transparent); }
  .ps-gen-err { font-size: 0.78rem; color: #ef4444; margin: 0; font-weight: 600; }
  .ps-gen-opts-toggle { align-self: flex-start; display: inline-flex; align-items: center; gap: 5px; background: transparent; border: 1px solid var(--border); color: var(--fg-muted); border-radius: 99px; padding: 4px 12px; font-size: 0.74rem; font-weight: 700; cursor: pointer; transition: all .15s; }
  .ps-gen-opts-toggle:hover { color: #8b5cf6; border-color: #8b5cf6; }
  .ps-gen-opts { display: flex; flex-direction: column; gap: 10px; padding: 10px; background: var(--background); border: 1px solid var(--border); border-radius: 12px; }
  .ps-go-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .ps-go-label { font-size: 0.7rem; font-weight: 700; color: var(--fg-muted); width: 44px; flex-shrink: 0; }
  .ps-go-chips { display: flex; gap: 6px; flex-wrap: wrap; }
  .ps-go-chip { background: var(--background); border: 1.5px solid var(--border); color: var(--fg-muted); border-radius: 99px; padding: 4px 12px; font-size: 0.74rem; font-weight: 600; cursor: pointer; transition: all .15s; }
  .ps-go-chip.on { background: color-mix(in srgb, #8b5cf6 15%, transparent); border-color: #8b5cf6; color: #8b5cf6; }
  .ps-go-chip.oni { color: #dc2626; border-color: color-mix(in srgb, #dc2626 35%, var(--border)); font-weight: 800; }
  .ps-go-chip.oni.on { background: linear-gradient(120deg, #dc2626, #b91c1c); border-color: #dc2626; color: #fff; box-shadow: 0 2px 10px rgba(220,38,38,.35); }
  .ps-go-chip.exam.on { background: linear-gradient(120deg, #0ea5e9, #6366f1); border-color: #0ea5e9; color: #fff; box-shadow: 0 2px 10px rgba(14,165,233,.35); }
  .ps-go-count-input { width: 58px; padding: 4px 8px; border: 1.5px solid var(--border); border-radius: 99px; background: var(--background); font-size: 0.74rem; font-weight: 600; color: var(--fg-muted); text-align: center; outline: none; font-family: inherit; -moz-appearance: textfield; }
  .ps-go-count-input::-webkit-outer-spin-button, .ps-go-count-input::-webkit-inner-spin-button { -webkit-appearance: none; }
  .ps-go-count-input.active { border-color: #8b5cf6; color: #8b5cf6; background: color-mix(in srgb, #8b5cf6 12%, var(--background)); }
  .ps-go-count-input:focus { border-color: #8b5cf6; }
  .ps-gen-actions { display: flex; gap: 8px; align-items: center; }
  .ps-gen-attach { width: 42px; height: 42px; border-radius: 12px; border: 1px solid var(--border); background: var(--background); color: var(--fg-muted); display: flex; align-items: center; justify-content: center; cursor: pointer; flex-shrink: 0; }
  .ps-gen-attach:hover { color: #8b5cf6; border-color: #8b5cf6; }
  .ps-gen-btn { flex: 1; height: 42px; border-radius: 12px; border: none; background: linear-gradient(120deg, #8b5cf6, #ec4899); color: #fff; font-size: 0.9rem; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; transition: all .15s; }
  .ps-gen-btn:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 6px 18px rgba(139,92,246,.35); }
  .ps-gen-btn:disabled { opacity: .5; cursor: default; }
  .ps-gen-attach.on { color: #0ea5e9; border-color: #0ea5e9; background: color-mix(in srgb, #0ea5e9 12%, var(--background)); }
  .ps-spin { animation: ps-spin 1s linear infinite; }
  @keyframes ps-spin { to { transform: rotate(360deg); } }

  /* Note source chip (distinct sky hue from the purple md/file chips) */
  .ps-gen-md-chip.note { background: color-mix(in srgb, #0ea5e9 14%, var(--background)); border-color: color-mix(in srgb, #0ea5e9 30%, transparent); color: #0ea5e9; }
  .ps-gen-md-chip.note button { color: #0ea5e9; }

  /* In-app note picker modal */
  .ps-notepick-back { position: fixed; inset: 0; z-index: 10005; background: rgba(0,0,0,.45); backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; padding: 20px; animation: psgl-fade .18s ease; }
  .ps-notepick { width: 100%; max-width: 440px; max-height: min(78vh, 620px); display: flex; flex-direction: column; background: var(--background); border: 1px solid var(--border); border-radius: 18px; overflow: hidden; box-shadow: 0 20px 60px rgba(0,0,0,.3); }
  .ps-notepick-head { display: flex; align-items: center; gap: 8px; padding: 14px 16px; font-size: .92rem; font-weight: 800; color: var(--foreground); border-bottom: 1px solid var(--border); }
  .ps-notepick-head svg { color: #0ea5e9; }
  .ps-notepick-close { margin-left: auto; display: flex; align-items: center; justify-content: center; border: none; background: none; color: var(--fg-muted); cursor: pointer; padding: 2px; border-radius: 8px; }
  .ps-notepick-close:hover { color: var(--foreground); background: var(--border); }
  .ps-notepick-search { display: flex; align-items: center; gap: 8px; margin: 12px 16px 8px; padding: 8px 12px; background: color-mix(in srgb, var(--fg-muted) 8%, var(--background)); border: 1px solid var(--border); border-radius: 12px; color: var(--fg-muted); }
  .ps-notepick-search input { flex: 1; border: none; background: none; outline: none; font-size: .86rem; color: var(--foreground); font-family: inherit; }
  .ps-notepick-list { flex: 1; overflow-y: auto; padding: 4px 10px; display: flex; flex-direction: column; gap: 2px; }
  .ps-notepick-empty { text-align: center; color: var(--fg-muted); font-size: .82rem; padding: 28px 0; margin: 0; }
  .ps-notepick-item { display: flex; align-items: center; gap: 10px; width: 100%; text-align: left; padding: 9px 10px; border: none; background: none; border-radius: 10px; cursor: pointer; transition: background .12s; }
  .ps-notepick-item:hover { background: color-mix(in srgb, #0ea5e9 8%, transparent); }
  .ps-notepick-item.on { background: color-mix(in srgb, #0ea5e9 12%, transparent); }
  .ps-notepick-check { flex-shrink: 0; width: 20px; height: 20px; border-radius: 6px; border: 1.5px solid var(--border); display: flex; align-items: center; justify-content: center; color: #fff; }
  .ps-notepick-item.on .ps-notepick-check { background: #0ea5e9; border-color: #0ea5e9; }
  .ps-notepick-info { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
  .ps-notepick-title { font-size: .86rem; font-weight: 600; color: var(--foreground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ps-notepick-folder { font-size: .7rem; color: var(--fg-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ps-notepick-foot { display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-top: 1px solid var(--border); }
  .ps-notepick-count { font-size: .78rem; font-weight: 700; color: var(--fg-muted); }
  .ps-notepick-done { margin-left: auto; padding: 8px 20px; border: none; border-radius: 10px; background: #0ea5e9; color: #fff; font-size: .84rem; font-weight: 700; cursor: pointer; }
  .ps-notepick-done:hover { background: #0284c7; }

  /* Generation loading overlay (portaled, covers everything incl. home bubble) */
  .ps-genload { position: fixed; inset: 0; z-index: 10001; background: color-mix(in srgb, var(--background) 88%, transparent); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; padding: 24px; animation: psgl-fade .25s ease; }
  @keyframes psgl-fade { from { opacity: 0; } to { opacity: 1; } }
  .ps-genload-img { width: 110px; height: auto; animation: ps-float 3s ease-in-out infinite; filter: drop-shadow(0 8px 24px rgba(139,92,246,.35)); }
  .ps-genload-spinner { color: #8b5cf6; margin-top: 8px; }
  .ps-genload-title { font-size: 1.02rem; font-weight: 800; margin: 6px 0 0; background: linear-gradient(120deg, #8b5cf6, #ec4899); -webkit-background-clip: text; background-clip: text; color: transparent; }
  .ps-genload-sub { font-size: 0.8rem; color: var(--fg-muted); margin: 0; }

  /* List */
  .ps-list { display: flex; flex-direction: column; gap: 10px; }
  .ps-list-head { display: flex; align-items: center; gap: 8px; }
  .ps-list-title { font-size: 0.78rem; font-weight: 700; color: var(--fg-muted); margin: 0; }
  .ps-list-count { font-size: 0.66rem; font-weight: 800; color: #8b5cf6; background: color-mix(in srgb, #8b5cf6 14%, transparent); padding: 1px 8px; border-radius: 99px; }
  .ps-filter { display: flex; flex-direction: column; gap: 8px; }
  .ps-search { position: relative; display: flex; align-items: center; }
  .ps-search-ic { position: absolute; left: 11px; color: var(--fg-muted); pointer-events: none; }
  .ps-search input { width: 100%; background: var(--background); border: 1px solid var(--border); border-radius: 12px; padding: 9px 32px 9px 34px; font-size: 0.85rem; color: var(--foreground); outline: none; font-family: inherit; }
  .ps-search input:focus { border-color: #8b5cf6; }
  .ps-search-clear { position: absolute; right: 8px; width: 22px; height: 22px; border-radius: 50%; border: none; background: var(--accent); color: var(--fg-muted); display: flex; align-items: center; justify-content: center; cursor: pointer; }
  .ps-noresult { font-size: 0.82rem; color: var(--fg-muted); text-align: center; padding: 20px 0; margin: 0; }
  .ps-empty { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 30px 0; text-align: center; color: var(--fg-muted); }
  .ps-empty-img { width: 96px; height: auto; opacity: .9; animation: ps-float 3s ease-in-out infinite; }
  @keyframes ps-float { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
  .ps-empty-sub { font-size: 0.78rem; }
  .ps-card { display: flex; align-items: stretch; gap: 12px; text-align: left; background: var(--accent); border: 1.5px solid var(--border); border-radius: 16px; padding: 14px; cursor: pointer; transition: all .15s; font-family: inherit; }
  .ps-card:hover { transform: translateY(-2px); box-shadow: 0 6px 18px rgba(0,0,0,.1); border-color: color-mix(in srgb, #8b5cf6 40%, var(--border)); }
  .ps-card-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 5px; }
  .ps-card-top { display: flex; align-items: center; gap: 8px; }
  .ps-card-subject { font-size: 0.66rem; font-weight: 700; color: #8b5cf6; background: color-mix(in srgb, #8b5cf6 14%, transparent); padding: 2px 8px; border-radius: 99px; }
  .ps-card-count { font-size: 0.66rem; font-weight: 700; color: var(--fg-muted); }
  .ps-card-exam { display: inline-flex; align-items: center; gap: 3px; font-size: 0.66rem; font-weight: 800; color: #0ea5e9; background: color-mix(in srgb, #0ea5e9 15%, transparent); padding: 2px 8px; border-radius: 99px; }
  .ps-card-name { font-size: 0.96rem; font-weight: 700; color: var(--foreground); line-height: 1.3; }
  .ps-card-best { display: inline-flex; align-items: center; gap: 4px; font-size: 0.7rem; font-weight: 600; color: #f59e0b; }
  .ps-card-attempts { color: var(--fg-muted); }
  .ps-card-side { display: flex; flex-direction: column; align-items: center; justify-content: space-between; gap: 8px; flex-shrink: 0; }
  .ps-card-play { width: 38px; height: 38px; border-radius: 50%; background: linear-gradient(120deg, #8b5cf6, #ec4899); color: #fff; display: flex; align-items: center; justify-content: center; }
  .ps-card-del { width: 28px; height: 26px; border-radius: 8px; display: flex; align-items: center; justify-content: center; color: var(--fg-muted); }
  .ps-card-del:hover { color: #ef4444; background: color-mix(in srgb, #ef4444 12%, transparent); }

  .ps-solve { position: fixed; inset: 0; z-index: 10000; background: var(--background); display: flex; flex-direction: column; }
  .psv-top { display: flex; align-items: center; gap: 12px; padding: 12px 16px; padding-top: calc(12px + env(safe-area-inset-top)); flex-shrink: 0; }
  .psv-close { width: 34px; height: 34px; border-radius: 50%; border: none; background: var(--accent); color: var(--fg-muted); display: flex; align-items: center; justify-content: center; cursor: pointer; flex-shrink: 0; }
  .psv-progress-track { flex: 1; height: 8px; background: var(--accent); border-radius: 99px; overflow: hidden; }
  .psv-progress-fill { height: 100%; border-radius: 99px; background: linear-gradient(90deg, #8b5cf6, #ec4899); transition: width .4s ease; }
  .psv-count { font-size: 0.85rem; font-weight: 800; color: var(--foreground); flex-shrink: 0; font-variant-numeric: tabular-nums; }
  .psv-count small { color: var(--fg-muted); font-weight: 600; }
  .psv-timer { display: inline-flex; align-items: center; gap: 4px; flex-shrink: 0; padding: 4px 10px; border-radius: 99px; font-size: 0.82rem; font-weight: 800; font-variant-numeric: tabular-nums; color: #0ea5e9; background: color-mix(in srgb, #0ea5e9 14%, transparent); }
  .psv-timer.low { color: #ef4444; background: color-mix(in srgb, #ef4444 14%, transparent); animation: psv-timer-pulse 1s ease-in-out infinite; }
  @keyframes psv-timer-pulse { 0%,100% { opacity: 1; } 50% { opacity: .5; } }

  .psv-body { flex: 1; overflow-y: auto; padding: 4px 16px 20px; -webkit-overflow-scrolling: touch; }
  .psv-card { max-width: 680px; margin: 0 auto; animation: psv-in .3s cubic-bezier(.2,.8,.3,1); }
  @keyframes psv-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
  .psv-type { display: inline-block; font-size: 0.7rem; font-weight: 700; color: #8b5cf6; background: color-mix(in srgb, #8b5cf6 12%, transparent); padding: 3px 10px; border-radius: 99px; margin-bottom: 12px; }
  .psv-passage { background: var(--accent); border: 1px solid var(--border); border-left: 3px solid #8b5cf6; border-radius: 10px; padding: 12px 14px; margin-bottom: 14px; max-height: 320px; overflow-y: auto; }
  .psv-prompt { font-size: 1.02rem !important; font-weight: 600; margin-bottom: 18px; }

  .psv-choices { display: flex; flex-direction: column; gap: 10px; }
  .psv-choice { display: flex; align-items: center; gap: 12px; text-align: left; background: var(--accent); border: 2px solid var(--border); border-radius: 14px; padding: 13px 14px; cursor: pointer; transition: all .15s; font-family: inherit; }
  .psv-choice:hover:not(:disabled) { border-color: color-mix(in srgb, #8b5cf6 50%, var(--border)); }
  .psv-choice.sel { border-color: #8b5cf6; background: color-mix(in srgb, #8b5cf6 10%, var(--background)); }
  .psv-choice.correct { border-color: #10b981; background: color-mix(in srgb, #10b981 12%, var(--background)); }
  .psv-choice.wrong { border-color: #ef4444; background: color-mix(in srgb, #ef4444 10%, var(--background)); }
  .psv-choice:disabled { cursor: default; }
  .psv-choice-mark { width: 28px; height: 28px; flex-shrink: 0; border-radius: 50%; background: var(--background); border: 1px solid var(--border); display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 0.82rem; color: var(--fg-muted); }
  .psv-choice.sel .psv-choice-mark { background: #8b5cf6; color: #fff; border-color: #8b5cf6; }
  .psv-choice.correct .psv-choice-mark { background: #10b981; color: #fff; border-color: #10b981; }
  .psv-choice.wrong .psv-choice-mark { background: #ef4444; color: #fff; border-color: #ef4444; }
  .psv-choice-text { flex: 1; }
  .psv-choice-ic { flex-shrink: 0; }
  .psv-choice.correct .psv-choice-ic { color: #10b981; }
  .psv-choice.wrong .psv-choice-ic { color: #ef4444; }

  .psv-tf { display: flex; gap: 12px; }
  .psv-tf-btn { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 22px 12px; border-radius: 16px; border: 2px solid var(--border); background: var(--accent); cursor: pointer; font-size: 1.8rem; transition: all .15s; }
  .psv-tf-btn span { font-size: 0.82rem; font-weight: 700; color: var(--foreground); }
  .psv-tf-btn.sel { border-color: #8b5cf6; background: color-mix(in srgb, #8b5cf6 10%, var(--background)); }
  .psv-tf-btn.correct { border-color: #10b981; background: color-mix(in srgb, #10b981 12%, var(--background)); }
  .psv-tf-btn.wrong { border-color: #ef4444; background: color-mix(in srgb, #ef4444 10%, var(--background)); }
  .psv-tf-btn:disabled { cursor: default; }

  .psv-input { width: 100%; background: var(--accent); border: 2px solid var(--border); border-radius: 12px; padding: 13px 14px; font-size: 1rem; color: var(--foreground); outline: none; font-family: inherit; }
  .psv-input:focus { border-color: #8b5cf6; }
  .psv-input.ok { border-color: #10b981; }
  .psv-input.ng { border-color: #ef4444; }
  .psv-textarea { width: 100%; background: var(--accent); border: 2px solid var(--border); border-radius: 12px; padding: 13px 14px; font-size: 0.95rem; color: var(--foreground); outline: none; font-family: inherit; resize: vertical; line-height: 1.6; }
  .psv-textarea:focus { border-color: #8b5cf6; }

  .psv-reveal { margin-top: 18px; display: flex; flex-direction: column; gap: 12px; animation: psv-in .3s ease; }
  .psv-verdict { display: inline-flex; align-items: center; gap: 6px; align-self: flex-start; font-size: 0.9rem; font-weight: 800; padding: 6px 14px; border-radius: 99px; }
  .psv-verdict.ok { color: #10b981; background: color-mix(in srgb, #10b981 14%, transparent); }
  .psv-verdict.ng { color: #ef4444; background: color-mix(in srgb, #ef4444 12%, transparent); }
  .psv-answer { background: color-mix(in srgb, #10b981 8%, var(--background)); border: 1px solid color-mix(in srgb, #10b981 30%, transparent); border-radius: 12px; padding: 12px 14px; }
  .psv-answer-label { display: block; font-size: 0.72rem; font-weight: 800; color: #10b981; margin-bottom: 6px; }
  .psv-explain { background: var(--accent); border: 1px solid var(--border); border-radius: 12px; padding: 12px 14px; }
  .psv-explain-label { display: block; font-size: 0.72rem; font-weight: 800; color: #f59e0b; margin-bottom: 6px; }
  .psv-selfgrade { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .psv-sg-q { font-size: 0.82rem; font-weight: 700; color: var(--fg-muted); }
  .psv-sg-btn { display: inline-flex; align-items: center; gap: 5px; padding: 8px 16px; border-radius: 99px; border: 2px solid var(--border); background: var(--background); font-size: 0.82rem; font-weight: 700; cursor: pointer; transition: all .15s; }
  .psv-sg-btn.ok { color: #10b981; }
  .psv-sg-btn.ok.on { background: #10b981; color: #fff; border-color: #10b981; }
  .psv-sg-btn.ng { color: #ef4444; }
  .psv-sg-btn.ng.on { background: #ef4444; color: #fff; border-color: #ef4444; }
  .psv-lily-btn { align-self: flex-start; display: inline-flex; align-items: center; gap: 6px; padding: 8px 16px; border-radius: 99px; border: 1.5px solid color-mix(in srgb, #8b5cf6 40%, var(--border)); background: color-mix(in srgb, #8b5cf6 8%, var(--background)); color: #8b5cf6; font-size: 0.8rem; font-weight: 700; cursor: pointer; transition: all .15s; }
  .psv-lily-btn:hover { background: color-mix(in srgb, #8b5cf6 16%, var(--background)); }

  .psv-bottom { flex-shrink: 0; padding: 12px 16px; padding-bottom: calc(12px + env(safe-area-inset-bottom)); border-top: 1px solid var(--border); background: var(--background); }
  .psv-action { width: 100%; max-width: 680px; margin: 0 auto; height: 52px; display: flex; align-items: center; justify-content: center; gap: 8px; border-radius: 14px; border: none; background: var(--foreground); color: var(--background); font-size: 1rem; font-weight: 800; cursor: pointer; transition: all .15s; }
  .psv-action.next { background: linear-gradient(120deg, #8b5cf6, #ec4899); color: #fff; }
  .psv-action:disabled { opacity: .35; cursor: default; }

  .ps-result { flex: 1; overflow-y: auto; display: flex; flex-direction: column; align-items: center; padding: 32px 20px calc(32px + env(safe-area-inset-bottom)); -webkit-overflow-scrolling: touch; }
  .psr-ring-wrap { position: relative; width: 160px; height: 160px; margin-bottom: 8px; animation: psr-pop .5s cubic-bezier(.2,1.4,.4,1); }
  @keyframes psr-pop { from { transform: scale(.6); opacity: 0; } to { transform: scale(1); opacity: 1; } }
  .psr-ring { width: 160px; height: 160px; transform: rotate(-90deg); }
  .psr-ring-bg { fill: none; stroke: var(--accent); stroke-width: 10; }
  .psr-ring-fg { fill: none; stroke: url(#psr-grad); stroke-width: 10; stroke-linecap: round; transition: stroke-dashoffset 1s cubic-bezier(.3,1,.4,1); stroke: #8b5cf6; }
  .psr-ring-center { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; }
  .psr-pct { font-size: 2.6rem; font-weight: 900; color: var(--foreground); line-height: 1; }
  .psr-pct small { font-size: 1.1rem; color: var(--fg-muted); }
  .psr-frac { font-size: 0.86rem; font-weight: 700; color: var(--fg-muted); margin-top: 2px; }
  .psr-msg { font-size: 1.3rem; font-weight: 800; margin: 8px 0 2px; background: linear-gradient(120deg, #8b5cf6, #ec4899); -webkit-background-clip: text; background-clip: text; color: transparent; }
  .psr-sub { font-size: 0.84rem; color: var(--fg-muted); margin: 0 0 20px; text-align: center; }
  .psr-exam-ic { color: #0ea5e9; vertical-align: -2px; margin-right: 4px; }
  .psr-review { width: 100%; max-width: 460px; display: flex; flex-direction: column; gap: 6px; margin-bottom: 24px; }
  .psr-rev-row { display: flex; align-items: center; gap: 10px; padding: 9px 12px; border-radius: 10px; background: var(--accent); border: 1px solid var(--border); border-left: 3px solid var(--border); }
  .psr-rev-row.ok { border-left-color: #10b981; }
  .psr-rev-row.ng { border-left-color: #ef4444; }
  .psr-rev-num { width: 22px; height: 22px; border-radius: 50%; background: var(--background); display: flex; align-items: center; justify-content: center; font-size: 0.75rem; font-weight: 800; color: var(--fg-muted); flex-shrink: 0; }
  .psr-rev-badge { flex: 1; font-size: 0.78rem; font-weight: 600; color: var(--foreground); }
  .psr-rev-icon { flex-shrink: 0; }
  .psr-rev-row.ok .psr-rev-icon { color: #10b981; }
  .psr-rev-row.ng .psr-rev-icon { color: #ef4444; }
  .psr-actions { width: 100%; max-width: 460px; display: flex; flex-direction: column; gap: 10px; }
  .psr-btn { width: 100%; height: 48px; display: flex; align-items: center; justify-content: center; gap: 8px; border-radius: 14px; border: 1.5px solid var(--border); background: var(--accent); color: var(--foreground); font-size: 0.92rem; font-weight: 700; cursor: pointer; transition: all .15s; }
  .psr-btn:hover { transform: translateY(-1px); }
  .psr-btn.primary { background: linear-gradient(120deg, #8b5cf6, #ec4899); color: #fff; border: none; }
  .psr-btn.lily { background: color-mix(in srgb, #8b5cf6 12%, var(--accent)); color: #8b5cf6; border-color: color-mix(in srgb, #8b5cf6 35%, var(--border)); }
  .psr-btn.ghost { background: transparent; color: var(--fg-muted); border: none; }
  /* ── Mode toggle ── */
  .ps-mode-toggle { display: flex; gap: 4px; padding: 10px 14px 0; }
  .ps-mode-btn { flex: 1; display: flex; align-items: center; justify-content: center; gap: 5px; height: 36px; border-radius: 10px; border: 1.5px solid var(--border); background: var(--accent); color: var(--fg-muted); font-size: 0.82rem; font-weight: 700; cursor: pointer; transition: all .15s; }
  .ps-mode-btn.on { background: linear-gradient(120deg, #8b5cf6, #ec4899); color: #fff; border-color: transparent; }
  /* ── Lesson: setup ── */
  .ps-lesson { padding: 14px; display: flex; flex-direction: column; gap: 12px; }
  .ps-lesson-desc { font-size: 0.8rem; color: var(--fg-muted); line-height: 1.6; }
  .ps-lesson-input { width: 100%; height: 44px; background: var(--accent); border: 1.5px solid var(--border); border-radius: 12px; padding: 0 12px; font-size: 0.9rem; color: var(--foreground); outline: none; box-sizing: border-box; }
  .ps-lesson-input:focus { border-color: var(--primary); }
  .ps-lesson-setup-row { display: flex; gap: 8px; align-items: center; }
  .ps-lesson-att { width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; background: var(--accent); border: 1.5px solid var(--border); border-radius: 12px; color: var(--fg-muted); cursor: pointer; flex-shrink: 0; transition: color .15s, border-color .15s; }
  .ps-lesson-att:hover:not(:disabled) { color: var(--primary); border-color: var(--primary); }
  .ps-lesson-att.on { color: #8b5cf6; border-color: #8b5cf6; }
  .ps-lesson-att:disabled { opacity: 0.4; cursor: default; }
  .ps-lesson-btn { flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px; height: 44px; padding: 0 14px; background: linear-gradient(120deg, #8b5cf6, #ec4899); color: #fff; border: none; border-radius: 12px; font-size: 0.86rem; font-weight: 700; cursor: pointer; white-space: nowrap; }
  .ps-lesson-btn:disabled { opacity: 0.5; cursor: default; }
  .ps-lesson-err { font-size: 0.8rem; color: #ef4444; margin: 0; }
  /* ── Lesson: 1-on-1 conversation ── */
  .ps-class { flex: 1; min-height: 0; display: flex; flex-direction: column; margin: 0 -16px -16px; }
  .ps-class-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 14px; border-bottom: 1px solid var(--border); background: var(--accent); flex-shrink: 0; }
  .ps-class-head-l { display: flex; align-items: center; gap: 6px; font-size: 0.86rem; font-weight: 700; color: var(--foreground); min-width: 0; }
  .ps-class-head-l span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ps-class-head-ic { color: #8b5cf6; flex-shrink: 0; }
  .ps-class-exit { flex-shrink: 0; background: transparent; border: 1px solid var(--border); border-radius: 8px; padding: 4px 12px; font-size: 0.76rem; font-weight: 700; color: var(--fg-muted); cursor: pointer; }
  .ps-class-msgs { flex: 1; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch; padding: 14px; display: flex; flex-direction: column; gap: 12px; }
  .ps-class-row { display: flex; gap: 8px; max-width: 100%; }
  .ps-class-row.lily { align-items: flex-start; }
  .ps-class-row.me { justify-content: flex-end; }
  .ps-class-ava { width: 32px; height: 32px; border-radius: 50%; object-fit: cover; flex-shrink: 0; border: 1.5px solid color-mix(in srgb, #8b5cf6 30%, var(--border)); }
  .ps-class-bubble { border-radius: 14px; padding: 11px 13px; font-size: 0.88rem; line-height: 1.65; word-break: break-word; max-width: 80%; }
  .ps-class-bubble.lily { background: var(--accent); border: 1px solid var(--border); border-top-left-radius: 4px; color: var(--foreground); }
  .ps-class-bubble.me { background: linear-gradient(120deg, #8b5cf6, #ec4899); color: #fff; border-top-right-radius: 4px; white-space: pre-wrap; }
  .ps-class-typing { display: flex; gap: 4px; align-items: center; }
  .ps-class-typing span { width: 7px; height: 7px; border-radius: 50%; background: var(--fg-muted); opacity: 0.5; animation: ps-typing 1s infinite; }
  .ps-class-typing span:nth-child(2) { animation-delay: 0.2s; }
  .ps-class-typing span:nth-child(3) { animation-delay: 0.4s; }
  @keyframes ps-typing { 0%, 60%, 100% { transform: translateY(0); opacity: 0.4; } 30% { transform: translateY(-4px); opacity: 1; } }
  .ps-class-err-row { display: flex; align-items: center; gap: 10px; justify-content: center; font-size: 0.8rem; color: #ef4444; }
  .ps-class-err-row button { background: transparent; border: 1px solid #ef4444; border-radius: 8px; padding: 3px 10px; color: #ef4444; font-weight: 700; cursor: pointer; }
  .ps-class-bar { display: flex; align-items: center; gap: 8px; padding: 10px 12px; padding-bottom: calc(10px + env(safe-area-inset-bottom)); border-top: 1px solid var(--border); background: var(--background); flex-shrink: 0; }
  .ps-class-next { flex-shrink: 0; height: 40px; padding: 0 13px; background: color-mix(in srgb, #8b5cf6 14%, var(--accent)); color: #8b5cf6; border: 1.5px solid color-mix(in srgb, #8b5cf6 35%, var(--border)); border-radius: 12px; font-size: 0.83rem; font-weight: 800; cursor: pointer; white-space: nowrap; }
  .ps-class-next:disabled { opacity: 0.45; cursor: default; }
  .ps-class-input { flex: 1; min-width: 0; height: 40px; background: var(--accent); border: 1.5px solid var(--border); border-radius: 12px; padding: 0 12px; font-size: 0.88rem; color: var(--foreground); outline: none; }
  .ps-class-input:focus { border-color: var(--primary); }
  .ps-class-send { flex-shrink: 0; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; background: linear-gradient(120deg, #8b5cf6, #ec4899); color: #fff; border: none; border-radius: 12px; cursor: pointer; }
  .ps-class-send:disabled { opacity: 0.4; cursor: default; }
    `}</style>
  );
}
