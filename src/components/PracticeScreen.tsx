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
  ArrowLeft, Sparkles, Wand2, Paperclip, X, Play, Trash2,
  Check, ChevronRight, ChevronLeft, FileText, RotateCcw, Trophy, Loader2, PencilLine,
  Settings2, MessageCircle, ChevronDown, ChevronUp, Search, NotebookText,
  Clock, GraduationCap, BookOpen, Pencil, Network, Download,
} from 'lucide-react';
import 'katex/dist/katex.min.css';
import { db, softDeleteDiagramSet } from '@/lib/db';
import type { ProblemSet, PracticeQuestion, Note, Folder, LessonSession, DiagramSet } from '@/lib/db';
import { newSyncId } from '@/lib/db';
import { parseIllustDiagram, renderIllustDiagramSvg, type IllustDiagramSpec } from '@/lib/illustDiagram';
import { ILLUST_MATERIAL_CATALOG } from '@/lib/illustAssets';
import { downloadSvg, downloadSvgAsPng } from '@/lib/fileGen';
import {
  generateProblemSet, saveProblemSet, deleteProblemSet, recordAttempt,
} from '@/lib/practice';
import type { ChatAttachment, ChatTurn } from '@/lib/gemini';
import { callGeminiChat, classifyPromptAddons, buildPromptAddons, MERMAID_ADDON_KEYS } from '@/lib/gemini';
import { getEffectiveApiKey, getUserName } from '@/lib/appLang';
import { getTicketsLeft, consumeTicket, isTicketUnlimited } from '@/lib/points';
import { renderRich } from '@/lib/richText';
import { noteHtmlToText } from '@/lib/noteText';
import { getAppLang } from '@/lib/appLang';
import { renderPdfAsImages } from '@/lib/pdfToImages';
import { useCharacterSkin } from '@/components/CharacterSkinContext';
import mermaid from 'mermaid';
import { initMermaid } from '@/lib/mermaidConfig';

initMermaid();

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

// ── Inline Mermaid renderer for lesson slide cards ────────────────────────────
function LessonMermaid({ code }: { code: string }) {
  const [svg, setSvg] = useState('');
  const [err, setErr] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const id = `lm-${Math.random().toString(36).slice(2, 9)}`;
      try {
        const { svg: rendered } = await mermaid.render(id, code.trim());
        if (!cancelled) { setSvg(rendered); setErr(false); }
      } catch {
        if (!cancelled) setErr(true);
      } finally {
        // Remove any temp/error node mermaid may leave in <body> on failure
        // (mindmaps can dump a "Syntax error" bomb at the page bottom).
        document.getElementById('d' + id)?.remove();
        document.getElementById(id)?.remove();
      }
    };
    void run();
    return () => { cancelled = true; };
  }, [code]);
  if (err) return <pre className="ps-mermaid-err"><code>{code}</code></pre>;
  if (!svg) return <div className="ps-mermaid-loading" />;
  return <div className="ps-mermaid-render" dangerouslySetInnerHTML={{ __html: svg }} />;
}

// Splits card text into alternating text/mermaid segments.
function LessonCardBody({ text, className }: { text: string; className?: string }) {
  const segments = useMemo(() => {
    const parts: { type: 'text' | 'mermaid'; content: string }[] = [];
    const fence = /^```mermaid\r?\n([\s\S]*?)^```/gm;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = fence.exec(text)) !== null) {
      if (m.index > last) parts.push({ type: 'text', content: text.slice(last, m.index) });
      parts.push({ type: 'mermaid', content: m[1]! });
      last = m.index + m[0].length;
    }
    if (last < text.length) parts.push({ type: 'text', content: text.slice(last) });
    return parts;
  }, [text]);
  return (
    <div className={className}>
      {segments.map((seg, i) =>
        seg.type === 'mermaid'
          ? <LessonMermaid key={i} code={seg.content} />
          : <div key={i} className="rich" dangerouslySetInnerHTML={{ __html: renderRich(seg.content) }} />
      )}
    </div>
  );
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
type ScreenMode = 'practice' | 'lesson' | 'diagram';
type LessonStyle = 'overview' | 'standard' | 'detailed';

// ── 図解（イラスト図解）のプロンプト ─────────────────────────────────────────
// 概念（例: クロスサイトリクエストフォージェリ）を渡すと、Lily が素材アイコンを
// 選んで配置し、仕組みが一目で分かる1枚の図を JSON 仕様で返す。散文は返さない。
// 座標系・素材カタログ・スキーマを明示して、余計な基本プロンプトは足さない。
function buildDiagramSystemPrompt(en: boolean): string {
  const materials = ILLUST_MATERIAL_CATALOG
    .map(m => `  - ${m.key}: ${m.label}`)
    .join('\n');
  if (en) {
    return `You are "Lily", building a single illustrated diagram (図解) that explains the given concept at a glance. You reply with ONE JSON object and nothing else — no prose, no markdown, no code fence.

Pick material icons whose SHAPE fits the concept (don't force everything into one kind), place them, and connect them with labeled arrows so the mechanism reads clearly.

Available material icons (use the key on the left as "icon"):
${materials}

JSON schema:
{
  "title": "short heading",
  "width": 880, "height": 540,            // optional; default 880x540. Enlarge for many nodes.
  "nodes": [
    { "id": "u", "icon": "user", "label": "Victim", "sublabel": "logged in", "x": 12, "y": 28, "color": "blue" }
  ],
  "edges": [
    { "from": "u", "to": "s", "label": "request + cookie", "dashed": false, "dir": "to", "curve": 0 }
  ],
  "zones": [ { "label": "Trust boundary", "x": 4, "y": 10, "w": 50, "h": 80, "color": "gray" } ],
  "notes": [ { "x": 50, "y": 95, "text": "caption" } ]
}

Rules:
- x and y are 0..100 (percent of the canvas; x=left→right, y=top→bottom). SPREAD NODES OUT — each node is a card with a text label underneath, so keep centers at least 24 apart horizontally AND vertically; never stack two nodes at a similar x with little vertical gap. Keep x within 8..92 and y within 10..88.
- Prefer a clear left→right or top→bottom flow. 3–6 nodes is ideal; never exceed 8. Fewer, well-spaced nodes read far better than a crowded canvas.
- Edge "label" is the action or data that flows (keep it short). Use "dashed": true for a malicious/forged/optional path, "dir": "both" for a two-way exchange, "curve" (-1..1) to bow parallel arrows apart.
- Use "zones" for trust boundaries / networks / a site's inside. Use "notes" for a one-line caption.
- color can be a name (blue, green, red, purple, orange, teal, pink, gray) or #hex. Give the attacker/danger a red-ish color.
- Output ONLY the JSON object.`;
  }
  return `あなたは「Lily」。与えられた概念を「一目で仕組みが分かる1枚のイラスト図解」にする役です。返答は JSON オブジェクト1つだけ。散文・マークダウン・コードフェンスは一切書かない。

内容のかたちに合う素材アイコンを選び（何でも同じ素材にしない）、配置して、ラベル付きの矢印でつないで仕組みが伝わるようにする。

使える素材アイコン（左の key を "icon" に指定）:
${materials}

JSON スキーマ:
{
  "title": "短い見出し",
  "width": 880, "height": 540,            // 省略可。既定 880x540。ノードが多いときは大きく。
  "nodes": [
    { "id": "u", "icon": "user", "label": "利用者", "sublabel": "ログイン中", "x": 12, "y": 28, "color": "blue" }
  ],
  "edges": [
    { "from": "u", "to": "s", "label": "リクエスト＋Cookie", "dashed": false, "dir": "to", "curve": 0 }
  ],
  "zones": [ { "label": "信頼境界", "x": 4, "y": 10, "w": 50, "h": 80, "color": "gray" } ],
  "notes": [ { "x": 50, "y": 95, "text": "補足" } ]
}

ルール:
- x・y は 0〜100（キャンバスに対する％。x は左→右、y は上→下）。各ノードは「カード＋その下のラベル」なので、必ず十分に離す：中心間は横も縦も 24 以上あけ、同じような x に縦の余白が狭いまま2つ置かない。x は 8〜92、y は 10〜88 の範囲に収める。
- 左→右 または 上→下 の流れを基本に。ノードは 3〜6 個が理想、8 個を超えない。詰め込むより、少なく広く配置する方が断然読みやすい。
- edge の "label" は「流れる動作・データ」を短く。不正・偽装・任意の経路は "dashed": true、双方向のやり取りは "dir": "both"、並行する矢印は "curve"（-1〜1）で弓なりに離す。
- 信頼境界・ネットワーク・サイトの内側などは "zones" で囲む。一言の補足は "notes"。
- color は名前（blue, green, red, purple, orange, teal, pink, gray）か #hex。攻撃者・危険には赤系を使う。
- 出力は JSON オブジェクトだけ。`;
}

// Preset turns that advance the lesson rather than ask a question. Cards built
// from these are shown without a "your question" chip.
const LESSON_KICKOFF = {
  en: 'Please start the lesson from the very first chunk. Teach me step by step.',
  ja: '最初のまとまりから授業を始めてね。少しずつ教えて。',
};
const LESSON_NEXT = {
  en: 'Next, please continue.',
  ja: '次へ進んで。続きを教えて。',
};

function buildLessonSystemPrompt(topic: string, en: boolean, style: LessonStyle = 'standard'): string {
  const topicLine = topic
    ? (en ? `\nMain topic: ${topic}` : `\nメインのトピック：${topic}`)
    : '';
  const name = getUserName();
  const nameLine = name
    ? (en
        ? `\nYour student's name is ${name} — address them by name naturally.`
        : `\n生徒の名前は「${name}」です。自然に名前で呼びかけてください。`)
    : '';

  const styleLineEn =
    style === 'overview'
      ? '\nLesson style: OVERVIEW — Cover the whole topic in 4–6 cards total. Group related items (e.g. Q&A pairs, vocabulary, steps) together into one card rather than one per item. Prioritise breadth over depth; give a bird\'s-eye view.'
      : style === 'detailed'
      ? '\nLesson style: DETAILED — One small concept per card. Go deep; explain the "why", give multiple examples, and do not skip nuances.'
      : '\nLesson style: STANDARD — Aim for 7–10 cards total. Balance breadth and depth; group closely related items but break up long sections.';

  const styleLineJa =
    style === 'overview'
      ? '\n授業スタイル：概要モード — 全体を4〜6枚のカードに収める。Q&A・単語・手順など関連する項目はまとめて1枚のカードにする（1項目＝1カードにしない）。深さより広さを優先し、全体像を俯瞰させる。'
      : style === 'detailed'
      ? '\n授業スタイル：詳細モード — 1カードに1つの小概念のみ。「なぜそうなるか」まで掘り下げ、具体例を複数挙げ、細部も丁寧に説明する。'
      : '\n授業スタイル：標準モード — 全体を7〜10枚程度に収める。関連する項目はまとめるが、長い内容は適切に分割してバランスよく教える。';

  if (en) {
    return `You are "Lily", an excellent and warm 1-on-1 private tutor. You teach the student through an interactive back-and-forth conversation — NOT by dumping the whole lesson at once.

How to run the lesson (strict):
- No preamble, ever. Open the very first card with actual content — never with "Today we'll learn about…", "Let's get started", or any throat-clearing sentence. The first sentence must already be teaching something.
- Follow the lesson style instruction below exactly.
- Use concrete examples and analogies. Be encouraging and friendly; a few emojis are fine.
- Use rich Markdown formatting: **bold** key terms, bullet/numbered lists, Markdown tables (| col | col |), and LaTeX math ($formula$, $$block$$). Lean heavily on visual layouts — when in doubt, add a table or list.
- Draw Mermaid diagrams (\`\`\`mermaid … \`\`\`) when a picture beats prose — they render natively. Pick the diagram TYPE that fits the content; do NOT turn everything into a \`graph\` flowchart. Use flowcharts only for real branching/decisions; use \`timeline\` for chronology, \`sequenceDiagram\` for interactions between actors, \`stateDiagram-v2\` for state changes, \`mindmap\` for hierarchies/overviews, and Markdown tables for comparisons.
- You may emphasise text with color and size: {red:text} colors text (keys: red/orange/green/blue/purple), {big:text}/{huge:text}/{small:text} changes its size, and ==text== highlights it (=={green}text== for a different tint; keys: yellow/green/blue/pink/purple). Use sparingly, only for genuinely key terms/warnings — not on every line.
- At the end of each message, ask one short comprehension question to check understanding.
- If the student asks a question, answer it kindly and thoroughly, then guide them back to the lesson.
- When the student says "next", teach the next chunk that follows on from the previous one.
- When you have covered everything, finish with a heading "## Summary" listing the key points as bullets and clearly tell them the lesson is complete. If the student still says "next" afterward, continue naturally — offer a related deeper point or a quick comprehension question rather than repeating the summary.
- If materials are attached, base the lesson on their content.${styleLineEn}${nameLine}${topicLine}`;
  }
  return `あなたは優秀で温かいマンツーマンの家庭教師「Lily」です。生徒と対話のキャッチボールをしながら授業を進めます。

進め方（厳守）：
- 前置き厳禁。「今日は〜について学びましょう」「それでは始めます」のような導入文で最初のカードを始めない。1文目からもう本題（実際の内容）を教える。
- 以下の授業スタイル指示に必ず従う。
- 具体例や比喩を使う。難しい用語には（ふりがな）を付ける。親しみやすく励ましながら。絵文字も少し使ってOK。
- Markdownを積極活用する。**太字**でキーワード強調、箇条書き・番号リスト、Markdownの表（| 列 | 列 |）、数式（$数式$・$$ブロック$$）を使う。迷ったら表やリストで整理する。
- 図が文章より伝わる場面ではMermaid（\`\`\`mermaid … \`\`\`）で描く（授業画面でそのまま描画される）。ただし内容の"かたち"に合った種類を選び、**何でも \`graph\` フローチャートにしない**。フローチャートは分岐・条件のある手順だけ。時系列は \`timeline\`、複数主体のやり取りは \`sequenceDiagram\`、状態変化は \`stateDiagram-v2\`、階層・全体像は \`mindmap\`、比較はMarkdownの表を使う。
- 文字の色・大きさで強調できる: {red:文字}で色付け（使える色: red/orange/green/blue/purple）、{big:文字}/{huge:文字}/{small:文字}で大きさ変更、==文字==でマーカー（=={green}文字==で色変更、使える色: yellow/green/blue/pink/purple）。本当に大事な用語・注意点だけに絞り、多用しない。
- 発言の最後に、理解度を確認する短い問いかけを1つ入れる。
- 生徒が質問したら、その質問に丁寧に答えてから、授業に戻す。
- 生徒が「次へ」と言ったら、前回の続きの次のまとまりを教える。
- すべての内容を教え終えたら、最後に見出し「## まとめ」を付けて要点を箇条書きにし、授業の終わりをはっきり伝える。まとめの後も生徒が「次へ」と言ったら、まとめを繰り返さず、関連する発展的な話や理解度チェックの問いかけを続ける。
- 資料が添付されている場合は、その内容に沿って授業を組み立てる。${styleLineJa}${nameLine}${topicLine}`;
}

export default function PracticeScreen({ onGoBack, onOpenAI }: PracticeScreenProps) {
  const { avatarSrc: lilyAvatarSrc } = useCharacterSkin();
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

  // ── Saved lesson sessions (for history / resume) ──
  const pastLessons = useLiveQuery<LessonSession[]>(
    () => db.lessonSessions.orderBy('updatedAt').reverse().filter(s => !s.deletedAt).limit(20).toArray(), []
  ) ?? [];

  // ── Lesson state (conversational 1-on-1) ──
  const [lessonTopic, setLessonTopic] = useState('');
  const [lessonStyle, setLessonStyle] = useState<LessonStyle>('standard');
  const [lessonStarted, setLessonStarted] = useState(false);
  const [lessonSessionId, setLessonSessionId] = useState<number | null>(null);
  const [lessonTurns, setLessonTurns] = useState<ChatTurn[]>([]); // full API history; [0] is hidden kickoff
  const [lessonInput, setLessonInput] = useState('');
  const [lessonLoading, setLessonLoading] = useState(false);
  const [lessonError, setLessonError] = useState('');
  const [lessonSaved, setLessonSaved] = useState(false);
  const lessonSysRef = useRef('');

  // ── 図解 (illustrated diagram) state ──
  const pastDiagrams = useLiveQuery<DiagramSet[]>(
    () => db.diagramSets.orderBy('updatedAt').reverse().filter(d => !d.deletedAt).limit(30).toArray(), []
  ) ?? [];
  const [diagramInput, setDiagramInput] = useState('');
  const [diagramLoading, setDiagramLoading] = useState(false);
  const [diagramError, setDiagramError] = useState('');
  const [currentDiagram, setCurrentDiagram] = useState<{ id?: number; topic: string; title?: string; spec: IllustDiagramSpec } | null>(null);

  // Re-render the current spec to SVG (pure, cached). Empty on error.
  const diagramSvg = useMemo(() => {
    if (!currentDiagram) return '';
    try { return renderIllustDiagramSvg(currentDiagram.spec); }
    catch { return ''; }
  }, [currentDiagram]);

  const DIAGRAM_SUGGESTIONS = en
    ? ['Cross-Site Request Forgery', 'SQL injection', 'Public-key cryptography', 'TCP 3-way handshake', 'DNS resolution', 'Zero Trust']
    : ['クロスサイトリクエストフォージェリ', 'SQLインジェクション', '公開鍵暗号', 'TCP 3ウェイハンドシェイク', 'DNSの名前解決', 'ゼロトラスト'];

  async function generateDiagram(topicArg?: string) {
    const topic = (topicArg ?? diagramInput).trim();
    if (!topic || diagramLoading) return;
    const apiKey = getEffectiveApiKey();
    if (!apiKey) { setDiagramError(en ? 'Set your API key in Settings.' : 'APIキーを設定してください。'); return; }
    if (getTicketsLeft('diagram') <= 0) {
      setDiagramError(en ? "Today's diagram limit has been reached. Try again tomorrow." : '本日の図解の作成回数の上限に達したよ。明日また試してね。');
      return;
    }
    consumeTicket('diagram');
    setDiagramLoading(true);
    setDiagramError('');
    try {
      const sys = buildDiagramSystemPrompt(en);
      const userTurn: ChatTurn = { role: 'user', text: en ? `Concept to illustrate: ${topic}` : `図解にする概念: ${topic}` };
      const reply = await callGeminiChat([userTurn], sys, apiKey, {
        temperature: 0.5,
        maxOutputTokens: 4096,
        models: ['gemini-3.5-flash', 'gemini-3.1-flash-lite'],
      });
      const spec = parseIllustDiagram(reply);
      // Fail early (before saving) if the spec can't be rendered.
      renderIllustDiagramSvg(spec);
      const now = Date.now();
      const title = (spec.title && spec.title.trim()) || topic;
      const id = await db.diagramSets.add({ topic, title, spec, createdAt: now, updatedAt: now }) as number;
      setCurrentDiagram({ id, topic, title, spec });
      setDiagramInput('');
    } catch {
      setDiagramError(en ? 'Could not build the diagram. Try rephrasing the concept.' : 'うまく図解できなかった…言い方を変えてもう一度試してね。');
    } finally {
      setDiagramLoading(false);
    }
  }

  async function deleteDiagram(id: number, e: React.MouseEvent) {
    e.stopPropagation();
    if (currentDiagram?.id === id) setCurrentDiagram(null);
    await softDeleteDiagramSet(id);
  }

  // Inline the sprite-sheet images (referenced by URL for on-screen display) as
  // data URIs so the exported PNG/SVG is fully self-contained (each sheet is
  // fetched once — icons crop from it — so the export stays small).
  async function inlineDiagramSheets(svg: string): Promise<string> {
    const urls = Array.from(new Set(svg.match(/\/zukai\/s\d+\.webp/g) ?? []));
    let out = svg;
    for (const url of urls) {
      try {
        const blob = await (await fetch(url)).blob();
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(r.result as string);
          r.onerror = reject;
          r.readAsDataURL(blob);
        });
        out = out.split(url).join(dataUrl);
      } catch { /* leave the URL as-is if it can't be fetched */ }
    }
    return out;
  }

  async function downloadDiagram(kind: 'png' | 'svg') {
    if (!diagramSvg) return;
    const base = `lily-diagram-${(currentDiagram?.title || 'figure').replace(/[^\w぀-ヿ一-鿿]+/g, '_').slice(0, 40) || 'figure'}`;
    const svg = await inlineDiagramSheets(diagramSvg);
    if (kind === 'png') downloadSvgAsPng(svg, `${base}.png`);
    else downloadSvg(svg, `${base}.svg`);
  }

  // The lesson is presented as a deck of "slides": one card per Lily message.
  // A card that answers a real question carries that question; cards produced by
  // the kickoff / "next" presets are plain lesson parts.
  const lessonCards = useMemo(() => {
    const out: { text: string; userQ?: string }[] = [];
    for (let i = 0; i < lessonTurns.length; i++) {
      const t = lessonTurns[i];
      if (t.role !== 'model') continue;
      const prev = lessonTurns[i - 1];
      const q = prev && prev.role === 'user' ? prev.text : '';
      const isProgress = q === LESSON_KICKOFF.en || q === LESSON_KICKOFF.ja
        || q === LESSON_NEXT.en || q === LESSON_NEXT.ja;
      out.push({ text: t.text, userQ: isProgress ? undefined : q });
    }
    return out;
  }, [lessonTurns]);

  const [cardIdx, setCardIdx] = useState(0);
  // Whenever a new card arrives, slide to it.
  useEffect(() => {
    if (lessonCards.length > 0) setCardIdx(lessonCards.length - 1);
  }, [lessonCards.length]);

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
        models: ['gemini-3.5-flash', 'gemini-3.1-flash-lite'],
      });
      const next: ChatTurn[] = [...history, { role: 'model', text: reply.trim() }];
      setLessonTurns(next);
      // Auto-save: strip attachment blobs (can be MBs) before persisting.
      const stripped = next.map(t => ({ role: t.role, text: t.text }));
      const cardCount = stripped.filter(t => t.role === 'model').length;
      const now = Date.now();
      setLessonSessionId(prev => {
        if (prev == null) {
          void db.lessonSessions.add({
            topic: lessonTopic.trim() || (en ? 'Lesson' : 'Lilyの授業'),
            style: lessonSysRef.current.includes('OVERVIEW') || lessonSysRef.current.includes('概要モード') ? 'overview'
              : lessonSysRef.current.includes('DETAILED') || lessonSysRef.current.includes('詳細モード') ? 'detailed'
              : 'standard',
            sysPrompt: lessonSysRef.current,
            turns: stripped,
            cardCount,
            createdAt: now,
            updatedAt: now,
          }).then(id => setLessonSessionId(id as number));
          return prev;
        }
        void db.lessonSessions.update(prev, { turns: stripped, cardCount, updatedAt: now });
        return prev;
      });
    } catch {
      setLessonError(en ? 'Something went wrong. Tap retry.' : 'うまくいかなかった…もう一度試してね。');
    } finally {
      setLessonLoading(false);
    }
  }

  async function startLesson() {
    const topic = lessonTopic.trim();
    const hasAtts = genImages.length > 0 || genMdFiles.length > 0 || genPdfs.length > 0 || genNotes.length > 0;
    if (!topic && !hasAtts) return;
    if (lessonLoading) return;
    const apiKey = getEffectiveApiKey();
    if (!apiKey) { setLessonError(en ? 'Set your API key in Settings.' : 'APIキーを設定してください。'); return; }
    if (getTicketsLeft('lesson') <= 0) {
      setLessonError(en ? 'Today\'s lesson limit has been reached (1/day for every plan). Try again tomorrow.' : '本日の授業の利用回数の上限（全プラン1日1回）に達しました。明日また試してね。');
      return;
    }
    consumeTicket('lesson');

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
    const attachments = [...mdAtts, ...noteAtts, ...genPdfs.map(p => p.att), ...genImages.map(g => g.att)];

    // Same lazy addon scheme the chat uses: classify which diagram types this
    // lesson would benefit from, and append only those syntax rules. Restricted
    // to Mermaid-family types (the lesson card view can only render mermaid, not
    // chart/geometry). A classification failure just yields no addon — the base
    // lesson prompt already covers diagram variety in prose.
    let lessonAddon = '';
    try {
      const keys = (await classifyPromptAddons(topic || (en ? 'lesson' : '授業'), apiKey))
        .filter(k => MERMAID_ADDON_KEYS.includes(k));
      lessonAddon = buildPromptAddons(keys);
    } catch { /* base prompt is enough */ }
    lessonSysRef.current = buildLessonSystemPrompt(topic, en, lessonStyle) + lessonAddon;
    const kickoff: ChatTurn = {
      role: 'user',
      text: en ? LESSON_KICKOFF.en : LESSON_KICKOFF.ja,
      attachments: attachments.length > 0 ? attachments : undefined,
    };
    setLessonSessionId(null);
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
    setLessonSaved(false);
    setLessonSessionId(null);
    setCardIdx(0);
  }

  function resumeLesson(session: LessonSession) {
    setLessonTopic(session.topic);
    setLessonStyle(session.style);
    lessonSysRef.current = session.sysPrompt;
    // Restore turns (text only — attachments were stripped on save).
    const turns: ChatTurn[] = session.turns.map(t => ({ role: t.role as 'user' | 'model', text: t.text }));
    setLessonTurns(turns);
    setLessonSessionId(session.id ?? null);
    setLessonStarted(true);
    setCardIdx(Math.max(0, session.cardCount - 1));
  }

  async function deleteLesson(id: number, e: React.MouseEvent) {
    e.stopPropagation();
    // Soft-delete (tombstone + bumped clock) so the deletion propagates via
    // live-sync instead of the lesson resurrecting from another device.
    await db.lessonSessions.update(id, { deletedAt: Date.now(), updatedAt: Date.now() });
  }

  async function renameLesson(id: number, current: string, e: React.MouseEvent) {
    e.stopPropagation();
    const next = window.prompt(en ? 'Rename lesson' : '授業のタイトルを変更', current);
    if (next == null) return;
    const title = next.trim();
    if (!title || title === current) return;
    await db.lessonSessions.update(id, { topic: title, updatedAt: Date.now() });
  }

  async function saveLesson() {
    if (lessonCards.length === 0) return;
    const title = lessonTopic.trim()
      || (en ? `Lesson — ${new Date().toLocaleDateString()}` : `Lilyの授業 — ${new Date().toLocaleDateString('ja-JP')}`);
    const parts = lessonCards.map((card, i) => {
      const heading = card.userQ
        ? `<h3>${en ? 'Q: ' : '質問：'}${card.userQ}</h3>`
        : `<h3>${en ? `Part ${i + 1}` : `その${i + 1}`}</h3>`;
      return `${heading}${renderRich(card.text)}`;
    });
    const content = parts.join('<hr>');
    const now = Date.now();
    await db.notes.add({ syncId: newSyncId(), title, content, createdAt: now, updatedAt: now });
    setLessonSaved(true);
    setTimeout(() => setLessonSaved(false), 2500);
  }

  // ── Generation state ──
  const [genInput, setGenInput] = useState('');
  const [genImages, setGenImages] = useState<{ att: ChatAttachment; url: string }[]>([]);
  const [genMdFiles, setGenMdFiles] = useState<{ name: string; content: string }[]>([]);
  const [genPdfs, setGenPdfs] = useState<{ name: string; att: ChatAttachment }[]>([]);
  const [genNotes, setGenNotes] = useState<{ id: number; title: string }[]>([]);
  const [showNotePicker, setShowNotePicker] = useState(false);
  const [notePickerSearch, setNotePickerSearch] = useState('');
  const [genLoading, setGenLoading] = useState(false);
  const [genError, setGenError] = useState('');
  const attachRef = useRef<HTMLInputElement>(null);

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
  const [textAnsArray, setTextAnsArray] = useState<string[]>([]);
  const [revealed, setRevealed] = useState(false);
  // 記述採点AI — Lily grades the user's written/fill answer against the model answer.
  const [aiGrading, setAiGrading] = useState(false);
  const [aiGradeResult, setAiGradeResult] = useState<string | null>(null);
  const [aiGradeError, setAiGradeError] = useState('');
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

  const pickFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    for (const f of files) {
      if (f.type.startsWith('image/')) {
        const att = await fileToAttachment(f);
        const url = URL.createObjectURL(f);
        setGenImages(prev => prev.length >= 4 ? prev : [...prev, { att, url }]);
      } else if (f.type === 'application/pdf' || f.name.endsWith('.pdf')) {
        const att = await fileToAttachment(f);
        att.mimeType = 'application/pdf';
        try {
          const { images, totalPages } = await renderPdfAsImages(att.data);
          att.pdfPageImages = images;
          att.pdfTotalPages = totalPages;
          att.data = '';
        } catch (err) {
          setGenError(en
            ? `Failed to read PDF "${f.name}": ${err instanceof Error ? err.message : 'unknown error'}`
            : `「${f.name}」のPDF読み込みに失敗したよ: ${err instanceof Error ? err.message : 'unknown error'}`);
          continue;
        }
        setGenPdfs(prev => prev.length >= 3 ? prev : [...prev, { name: f.name, att }]);
      } else {
        const content = await f.text();
        setGenMdFiles(prev => prev.length >= 3 ? prev : [...prev, { name: f.name, content }]);
      }
    }
    if (attachRef.current) attachRef.current.value = '';
  };

  const removeImage = (i: number) => {
    setGenImages(prev => {
      URL.revokeObjectURL(prev[i]?.url);
      return prev.filter((_, j) => j !== i);
    });
  };
  const removeMdFile = (i: number) => setGenMdFiles(prev => prev.filter((_, j) => j !== i));
  const removePdf = (i: number) => setGenPdfs(prev => prev.filter((_, j) => j !== i));

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
    if (!genInput.trim() && genImages.length === 0 && genMdFiles.length === 0 && genPdfs.length === 0 && genNotes.length === 0) return;
    if (getTicketsLeft('exercise') <= 0) {
      setGenError(en ? 'Today\'s problem-set creation limit has been reached. Try again tomorrow.' : '本日の問題作成の利用回数の上限に達しました。明日また試してね。');
      return;
    }
    setGenLoading(true);
    setGenError('');
    try {
      consumeTicket('exercise');
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
        [...mdAtts, ...noteAtts, ...genPdfs.map(p => p.att), ...genImages.map(g => g.att)],
        genDiff === 'oni' ? ['gemini-3.1-pro-preview', 'gemini-3.5-flash'] : ['gemini-3.5-flash'],
      );
      const id = await saveProblemSet(result, {
        examMode: genExam,
        timeLimitSec: genExam ? genExamMin * 60 : undefined,
      });
      // Clean up the generation form
      genImages.forEach(g => URL.revokeObjectURL(g.url));
      setGenImages([]);
      setGenMdFiles([]);
      setGenPdfs([]);
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
    setTextAnsArray([]);
    setRevealed(false);
    setAiGradeResult(null);
    setAiGradeError('');
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

  // Lily grades the user's written/fill answer against the model answer.
  const gradeWithLily = async () => {
    if (!current || aiGrading) return;
    const ans = textAns.trim();
    if (!ans) return;
    const apiKey = getEffectiveApiKey();
    if (!apiKey) { setAiGradeError(en ? 'Register a Gemini API key in Settings first.' : '設定画面で Gemini API キーを登録してね'); return; }
    setAiGrading(true); setAiGradeError(''); setAiGradeResult(null);
    try {
      const prompt =
        `あなたは学習者の記述解答を採点する優しく厳格な採点者です。以下を読み、${en ? '英語' : '日本語'}で簡潔に採点してください。\n` +
        `【問題】\n${current.prompt}\n\n【模範解答】\n${current.answer ?? ''}\n\n【学習者の解答】\n${ans}\n\n` +
        `次の形式で出力（前置き・余計な文章は不要）:\n` +
        `点数: ○/100\n` +
        `講評: 良い点と不足・誤りを2〜3文で。模範解答と照らして具体的に。甘い評価はせず、合っていれば正しく評価する。`;
      const history: ChatTurn[] = [{ role: 'user', text: prompt }];
      const reply = (await callGeminiChat(history, '', apiKey)).trim();
      setAiGradeResult(reply);
    } catch (e) {
      setAiGradeError(e instanceof Error ? e.message : (en ? 'AI grading failed' : 'AI 採点に失敗したよ'));
    } finally {
      setAiGrading(false);
    }
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
      setTextAnsArray([]);
      setRevealed(false);
      setAiGradeResult(null);
      setAiGradeError('');
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

  const handleRenameSet = async (id: number, current: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const next = window.prompt(en ? 'Rename problem set' : '問題セットのタイトルを変更', current);
    if (next == null) return;
    const title = next.trim();
    if (!title || title === current) return;
    await db.problemSets.update(id, { title, updatedAt: Date.now() });
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
    // Count blanks: ［　］ (JA) or [ ___ ] (EN)
    const blankCount = current.type === 'fill'
      ? (current.prompt.match(/\[　\]|［　］|\[ ___ \]|\[_+\]/g) ?? []).length || 1
      : 1;
    // Ensure textAnsArray is long enough (don't mutate during render; handled via key reset)
    const safeArray = Array.from({ length: blankCount }, (_, i) => textAnsArray[i] ?? '');
    const canReveal = current.type === 'written'
      ? true
      : current.type === 'fill'
        ? (blankCount > 1 ? safeArray.every(a => a.trim() !== '') : textAns.trim() !== '')
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

            {current.type === 'fill' && blankCount <= 1 && (
              <input
                className={`psv-input ${revealed ? (isCorrect ? 'ok' : 'ng') : ''}`}
                value={textAns}
                onChange={e => setTextAns(e.target.value)}
                placeholder={en ? 'Your answer…' : '答えを入力…'}
                disabled={revealed}
                onKeyDown={e => { if (e.key === 'Enter' && canReveal && !revealed) reveal(); }}
              />
            )}
            {current.type === 'fill' && blankCount > 1 && (
              <div className="psv-multi-fill">
                {safeArray.map((val, i) => (
                  <div key={i} className="psv-multi-fill-row">
                    <span className="psv-fill-label">空欄{en ? ` ${i + 1}` : `${['①','②','③','④','⑤'][i] ?? i + 1}`}</span>
                    <input
                      className={`psv-input ${revealed ? (isCorrect ? 'ok' : 'ng') : ''}`}
                      value={val}
                      onChange={e => {
                        const next = [...safeArray];
                        next[i] = e.target.value;
                        setTextAnsArray(next);
                        setTextAns(next.join('、'));
                      }}
                      placeholder={en ? `Blank ${i + 1}…` : `${['①','②','③','④','⑤'][i] ?? i + 1}を入力…`}
                      disabled={revealed}
                      onKeyDown={e => { if (e.key === 'Enter' && canReveal && !revealed) reveal(); }}
                    />
                  </div>
                ))}
              </div>
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
                    {blankCount > 1
                      ? (() => {
                          const parts = (current.answer ?? '').split(/[、,，]\s*/);
                          return (
                            <div className="psv-answer-parts">
                              {Array.from({ length: blankCount }, (_, i) => (
                                <div key={i} className="psv-answer-part">
                                  <span className="psv-fill-label">{en ? `Blank ${i + 1}` : ['①','②','③','④','⑤'][i] ?? `${i + 1}`}</span>
                                  <Rich src={parts[i] ?? ''} className="rich" />
                                </div>
                              ))}
                            </div>
                          );
                        })()
                      : <Rich src={current.answer} className="rich" />
                    }
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
                {(current.type === 'written' || current.type === 'fill') && (
                  <div className="psv-aigrade">
                    <button
                      className="psv-aigrade-btn"
                      onClick={() => void gradeWithLily()}
                      disabled={aiGrading || !textAns.trim()}
                    >
                      <Sparkles size={14} />
                      {aiGrading ? (en ? 'Grading…' : '採点中…') : (en ? 'Grade with Lily' : 'Lilyに採点してもらう')}
                    </button>
                    {aiGradeError && <div className="psv-aigrade-error">{aiGradeError}</div>}
                    {aiGradeResult && (
                      <div className="psv-aigrade-result"><Rich src={aiGradeResult} className="rich" /></div>
                    )}
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
          <button
            className={`ps-mode-btn${screenMode === 'diagram' ? ' on' : ''}`}
            onClick={() => setScreenMode('diagram')}
          >
            <Network size={13} />
            {en ? 'Diagram' : '図解'}
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

            {/* Hidden file input for the lesson setup */}
            <input ref={attachRef} type="file" accept="image/*,.md,.txt,.pdf,application/pdf,text/plain,text/markdown" multiple hidden onChange={e => void pickFiles(e)} />

            {/* Attached materials preview */}
            {(genMdFiles.length > 0 || genPdfs.length > 0 || genNotes.length > 0 || genImages.length > 0) && (
              <div className="ps-gen-mds">
                {genMdFiles.map((f, i) => (
                  <div key={i} className="ps-gen-md-chip">
                    <FileText size={12} /><span>{f.name}</span>
                    <button onClick={() => removeMdFile(i)}><X size={11} /></button>
                  </div>
                ))}
                {genPdfs.map((p, i) => (
                  <div key={i} className="ps-gen-md-chip pdf">
                    <BookOpen size={12} /><span>{p.name}</span>
                    <button onClick={() => removePdf(i)}><X size={11} /></button>
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

            <div className="ps-lesson-style-row">
              {(['overview', 'standard', 'detailed'] as LessonStyle[]).map(s => (
                <button
                  key={s}
                  className={`ps-lesson-style-btn${lessonStyle === s ? ' on' : ''}`}
                  onClick={() => setLessonStyle(s)}
                  disabled={lessonLoading}
                >
                  {s === 'overview'  && (en ? '🗺 Overview'  : '🗺 概要')}
                  {s === 'standard'  && (en ? '📖 Standard'  : '📖 標準')}
                  {s === 'detailed'  && (en ? '🔬 Detailed'  : '🔬 詳細')}
                </button>
              ))}
            </div>

            <input
              className="ps-lesson-input"
              value={lessonTopic}
              onChange={e => setLessonTopic(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void startLesson(); }}
              placeholder={en ? 'Topic (or leave blank to use materials)' : 'トピック（資料だけでもOK）'}
              disabled={lessonLoading}
            />

            <div className="ps-lesson-setup-row">
              <button className="ps-lesson-att" title={en ? 'Attach files' : 'ファイルを添付'} onClick={() => attachRef.current?.click()} disabled={lessonLoading}>
                <Paperclip size={16} />
              </button>
              <button className={`ps-lesson-att${genNotes.length > 0 ? ' on' : ''}`} title={en ? 'Pick notes' : 'メモを選ぶ'} onClick={() => setShowNotePicker(true)} disabled={lessonLoading}>
                <NotebookText size={16} />
              </button>
              <button
                className="ps-lesson-btn"
                onClick={() => void startLesson()}
                disabled={(!lessonTopic.trim() && genImages.length === 0 && genMdFiles.length === 0 && genPdfs.length === 0 && genNotes.length === 0) || lessonLoading || getTicketsLeft('lesson') <= 0}
              >
                {lessonLoading ? <Loader2 size={15} className="ps-spin" /> : <GraduationCap size={15} />}
                {en ? 'Start lesson' : '授業を始める'}
              </button>
            </div>
            <p className="ps-lesson-ticket-hint">
              {isTicketUnlimited('lesson')
                ? (en ? 'Lessons: unlimited (Developer)' : '本日の授業の残り回数: 無制限（Developer）')
                : en
                  ? `Today's remaining lessons: ${getTicketsLeft('lesson')} (1/day for every plan)`
                  : `本日の授業の残り回数: ${getTicketsLeft('lesson')}回（全プラン1日1回）`}
            </p>
            {lessonError && <p className="ps-lesson-err">{lessonError}</p>}

            {/* ── Past lessons ── */}
            {pastLessons.length > 0 && (
              <div className="ps-past-lessons">
                <p className="ps-past-label">{en ? 'Continue a lesson' : '続きから再開'}</p>
                {pastLessons.map(s => (
                  <button key={s.id} className="ps-past-row" onClick={() => resumeLesson(s)}>
                    <div className="ps-past-info">
                      <span className="ps-past-topic">{s.topic}</span>
                      <span className="ps-past-meta">
                        {en
                          ? `${s.cardCount} parts · ${new Date(s.updatedAt).toLocaleDateString()}`
                          : `${s.cardCount}枚 · ${new Date(s.updatedAt).toLocaleDateString('ja-JP')}`}
                      </span>
                    </div>
                    <button
                      className="ps-past-edit"
                      onClick={(e) => void renameLesson(s.id!, s.topic, e)}
                      title={en ? 'Rename' : '名前を変更'}
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      className="ps-past-del"
                      onClick={(e) => void deleteLesson(s.id!, e)}
                      title={en ? 'Delete' : '削除'}
                    >
                      <Trash2 size={13} />
                    </button>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Lesson: slide-deck view ── */}
        {screenMode === 'lesson' && lessonStarted && (
          <div className="ps-class">
            <div className="ps-class-head">
              <div className="ps-class-head-l">
                <GraduationCap size={15} className="ps-class-head-ic" />
                <span>{lessonTopic.trim() || (en ? 'Lesson with Lily' : 'Lilyの授業')}</span>
              </div>
              <div className="ps-class-head-r">
                {lessonCards.length > 0 && (
                  <button
                    className={`ps-class-save${lessonSaved ? ' saved' : ''}`}
                    onClick={() => void saveLesson()}
                    disabled={lessonSaved}
                  >
                    {lessonSaved ? (en ? '✓ Saved' : '✓ 保存済み') : (en ? 'Save' : '保存')}
                  </button>
                )}
                <button className="ps-class-exit" onClick={exitLesson}>{en ? 'End' : '終了'}</button>
              </div>
            </div>

            {/* Slide progress */}
            <div className="ps-slide-progress">
              {lessonCards.map((_, i) => (
                <button
                  key={i}
                  className={`ps-slide-dot${i === cardIdx ? ' on' : ''}${i < cardIdx ? ' done' : ''}`}
                  onClick={() => setCardIdx(i)}
                  disabled={lessonLoading}
                  aria-label={`Part ${i + 1}`}
                />
              ))}
              {lessonLoading && <span className="ps-slide-dot loading" />}
            </div>

            {/* The current slide */}
            <div className="ps-slide-stage">
              {lessonLoading ? (
                <div className="ps-slide-card thinking">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={lilyAvatarSrc('/lilygirls.PNG')} alt="Lily" className="ps-slide-ava" />
                  <div className="ps-class-typing"><span /><span /><span /></div>
                  <p className="ps-slide-thinking-txt">
                    {en ? 'Lily is preparing the next part…' : 'Lilyが次の内容を準備中…'}
                  </p>
                </div>
              ) : lessonError ? (
                <div className="ps-slide-card">
                  <p className="ps-class-err-txt">{lessonError}</p>
                  <button className="ps-slide-retry" onClick={() => void runLessonTurn(lessonTurns)}>
                    {en ? 'Retry' : '再試行'}
                  </button>
                </div>
              ) : lessonCards[cardIdx] ? (
                <div className="ps-slide-card" key={cardIdx}>
                  <div className="ps-slide-card-head">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={lilyAvatarSrc('/lilygirls.PNG')} alt="Lily" className="ps-slide-ava" />
                    <span className="ps-slide-num">
                      {lessonCards[cardIdx]!.userQ
                        ? (en ? 'Answer' : '回答')
                        : (en ? `Part ${cardIdx + 1}` : `その${cardIdx + 1}`)}
                    </span>
                  </div>
                  {lessonCards[cardIdx]!.userQ && (
                    <div className="ps-slide-qchip">
                      {(en ? 'Q: ' : '質問：') + lessonCards[cardIdx]!.userQ}
                    </div>
                  )}
                  <LessonCardBody
                    text={lessonCards[cardIdx]!.text}
                    className="ps-slide-body"
                  />
                </div>
              ) : null}
            </div>

            {/* Slide navigation */}
            <div className="ps-slide-nav">
              <button
                className="ps-slide-prev"
                onClick={() => setCardIdx(i => Math.max(0, i - 1))}
                disabled={cardIdx === 0 || lessonLoading}
              >
                <ChevronLeft size={17} /> {en ? 'Back' : '前へ'}
              </button>
              {cardIdx < lessonCards.length - 1 ? (
                <button
                  className="ps-slide-next"
                  onClick={() => setCardIdx(i => i + 1)}
                  disabled={lessonLoading}
                >
                  {en ? 'Forward' : '進む'} <ChevronRight size={17} />
                </button>
              ) : (
                <button
                  className="ps-slide-next"
                  onClick={() => void sendLessonMessage(en ? LESSON_NEXT.en : LESSON_NEXT.ja)}
                  disabled={lessonLoading}
                >
                  {en ? 'Next part' : '次へ'} <ChevronRight size={17} />
                </button>
              )}
            </div>

            {/* Ask the teacher */}
            <div className="ps-class-bar">
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

          {(genMdFiles.length > 0 || genPdfs.length > 0) && (
            <div className="ps-gen-mds">
              {genMdFiles.map((f, i) => (
                <div key={i} className="ps-gen-md-chip">
                  <FileText size={12} />
                  <span>{f.name}</span>
                  <button onClick={() => removeMdFile(i)}><X size={11} /></button>
                </div>
              ))}
              {genPdfs.map((p, i) => (
                <div key={i} className="ps-gen-md-chip pdf">
                  <BookOpen size={12} />
                  <span>{p.name}</span>
                  <button onClick={() => removePdf(i)}><X size={11} /></button>
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
            <input ref={attachRef} type="file" accept="image/*,.md,.txt,.pdf,application/pdf,text/plain,text/markdown" multiple hidden onChange={e => void pickFiles(e)} />
            <button className="ps-gen-attach" onClick={() => attachRef.current?.click()} disabled={genLoading} title={en ? 'Attach files' : 'ファイルを添付'}>
              <Paperclip size={16} />
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
              disabled={genLoading || getTicketsLeft('exercise') <= 0 || (!genInput.trim() && genImages.length === 0 && genMdFiles.length === 0 && genPdfs.length === 0 && genNotes.length === 0)}
            >
              {genLoading
                ? <><Loader2 size={16} className="ps-spin" /> {en ? 'Creating…' : '作成中…'}</>
                : <><Wand2 size={16} /> {en ? 'Generate' : '作成する'}</>}
            </button>
          </div>
          <p className="ps-gen-ticket-hint">
            {isTicketUnlimited('exercise')
              ? (en ? 'Problem sets: unlimited (Developer)' : '本日の問題作成の残り回数: 無制限（Developer）')
              : en
                ? `Today's remaining problem sets: ${getTicketsLeft('exercise')}`
                : `本日の問題作成の残り回数: ${getTicketsLeft('exercise')}回`}
          </p>
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
              <img src={lilyAvatarSrc('/9D507C9A-09F0-4B05-9F41-612FBD120675.png')} alt="Lily" className="ps-empty-img" />
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
                      <span className="ps-card-edit" onClick={(e) => void handleRenameSet(set.id!, set.title, e)} title={en ? 'Rename' : '名前を変更'}><Pencil size={14} /></span>
                      <span className="ps-card-del" onClick={(e) => void handleDelete(set.id!, e)}><Trash2 size={14} /></span>
                    </div>
                  </button>
                ))
              )}
            </>
          )}
        </div>}

        {/* ── Diagram (図解): illustrated diagram generator ── */}
        {screenMode === 'diagram' && (
          <div className="ps-dg">
            <div className="ps-dg-gen">
              <div className="ps-dg-genhead">
                <Sparkles size={16} />
                <span>{en ? 'Ask Lily for a diagram' : 'Lilyに図解を作ってもらう'}</span>
              </div>
              <p className="ps-dg-desc">
                {en
                  ? 'Type a concept (e.g. "Cross-Site Request Forgery") and Lily picks the right material icons — servers, PCs, users… — and lays out a diagram that explains it at a glance.'
                  : '概念を入力すると（例：「クロスサイトリクエストフォージェリ」）、Lilyがサーバーやパソコンなどの素材を選んで、仕組みが一目で分かる図解を組み立てるよ。'}
              </p>
              <input
                className="ps-dg-input"
                value={diagramInput}
                onChange={e => setDiagramInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') void generateDiagram(); }}
                placeholder={en ? 'A concept to illustrate…' : '図解にしたい概念を入力…'}
                disabled={diagramLoading}
              />
              <div className="ps-dg-chips">
                {DIAGRAM_SUGGESTIONS.map(s => (
                  <button key={s} className="ps-dg-chip" onClick={() => { setDiagramInput(s); void generateDiagram(s); }} disabled={diagramLoading}>
                    {s}
                  </button>
                ))}
              </div>
              <button
                className="ps-dg-btn"
                onClick={() => void generateDiagram()}
                disabled={!diagramInput.trim() || diagramLoading || getTicketsLeft('diagram') <= 0}
              >
                {diagramLoading ? <Loader2 size={15} className="ps-spin" /> : <Wand2 size={15} />}
                {en ? 'Create diagram' : '図解を作る'}
              </button>
              <p className="ps-dg-ticket">
                {isTicketUnlimited('diagram')
                  ? (en ? 'Diagrams: unlimited (Developer)' : '本日の図解の残り回数: 無制限（Developer）')
                  : en
                    ? `Today's remaining diagrams: ${getTicketsLeft('diagram')}`
                    : `本日の図解の残り回数: ${getTicketsLeft('diagram')}回`}
              </p>
              {diagramError && <p className="ps-dg-err">{diagramError}</p>}
            </div>

            {/* Current diagram viewer */}
            {currentDiagram && (
              <div className="ps-dg-view">
                <div className="ps-dg-viewhead">
                  <span className="ps-dg-viewtitle">{currentDiagram.title || currentDiagram.topic}</span>
                  <div className="ps-dg-viewacts">
                    <button className="ps-dg-dl" onClick={() => void downloadDiagram('png')} title="PNG"><Download size={13} /> PNG</button>
                    <button className="ps-dg-dl" onClick={() => void downloadDiagram('svg')} title="SVG"><Download size={13} /> SVG</button>
                    <button className="ps-dg-close" onClick={() => setCurrentDiagram(null)} title={en ? 'Close' : '閉じる'}><X size={15} /></button>
                  </div>
                </div>
                {diagramSvg
                  ? <div className="ps-dg-canvas" dangerouslySetInnerHTML={{ __html: diagramSvg }} />
                  : <div className="ps-dg-broken">{en ? 'This diagram could not be rendered.' : 'この図解は表示できませんでした。'}</div>}
              </div>
            )}

            {/* Past diagrams */}
            <div className="ps-dg-list">
              <div className="ps-list-head">
                <p className="ps-list-title">{en ? 'Your diagrams' : '作った図解'}</p>
                {pastDiagrams.length > 0 && <span className="ps-list-count">{pastDiagrams.length}</span>}
              </div>
              {pastDiagrams.length === 0 ? (
                <div className="ps-empty">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={lilyAvatarSrc('/9D507C9A-09F0-4B05-9F41-612FBD120675.png')} alt="Lily" className="ps-empty-img" />
                  <p>{en ? 'No diagrams yet.' : 'まだ図解がないよ'}</p>
                  <p className="ps-empty-sub">{en ? 'Type a concept above!' : '上の欄に概念を入力してみてね！'}</p>
                </div>
              ) : (
                pastDiagrams.map(d => (
                  <button key={d.id} className="ps-dg-card" onClick={() => setCurrentDiagram({ id: d.id, topic: d.topic, title: d.title, spec: d.spec })}>
                    <span className="ps-dg-cardic"><Network size={16} /></span>
                    <div className="ps-dg-cardmain">
                      <span className="ps-dg-cardname">{d.title || d.topic}</span>
                      <span className="ps-dg-cardmeta">{new Date(d.updatedAt).toLocaleDateString(en ? undefined : 'ja-JP')}</span>
                    </div>
                    <span className="ps-dg-carddel" onClick={(e) => void deleteDiagram(d.id!, e)} title={en ? 'Delete' : '削除'}><Trash2 size={14} /></span>
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* Full-screen overlay during generation — blocks all other taps */}
      {genLoading && typeof document !== 'undefined' && createPortal(
        <div className="ps-genload">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lilyAvatarSrc('/9D507C9A-09F0-4B05-9F41-612FBD120675.png')} alt="Lily" className="ps-genload-img" />
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
  .rich .rt-mark { color: var(--foreground); padding: 0 4px; border-radius: 3px; }
  .rich .rt-term { font-weight: 800; color: var(--foreground); }
  .rich .rt-gloss { color: var(--fg-muted); font-weight: 500; }
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
  .ps-gen-ticket-hint { font-size: 0.72rem; color: var(--fg-muted); margin: 0; }
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
  .ps-gen-md-chip.pdf { background: color-mix(in srgb, #f97316 14%, var(--background)); border-color: color-mix(in srgb, #f97316 30%, transparent); color: #f97316; }
  .ps-gen-md-chip.pdf button { color: #f97316; }

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
  .ps-card-edit { width: 28px; height: 26px; border-radius: 8px; display: flex; align-items: center; justify-content: center; color: var(--fg-muted); }
  .ps-card-edit:hover { color: #8b5cf6; background: color-mix(in srgb, #8b5cf6 12%, transparent); }
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
  .psv-multi-fill { display: flex; flex-direction: column; gap: 10px; }
  .psv-multi-fill-row { display: flex; align-items: center; gap: 10px; }
  .psv-fill-label { flex-shrink: 0; font-size: 0.82rem; font-weight: 800; color: #8b5cf6; min-width: 28px; }
  .psv-answer-parts { display: flex; flex-direction: column; gap: 6px; }
  .psv-answer-part { display: flex; align-items: baseline; gap: 8px; }
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
  .psv-aigrade { display: flex; flex-direction: column; gap: 9px; }
  .psv-aigrade-btn { align-self: flex-start; display: inline-flex; align-items: center; gap: 6px; padding: 8px 16px; border-radius: 99px; border: none; background: var(--primary); color: #fff; font-size: 0.82rem; font-weight: 800; cursor: pointer; font-family: inherit; transition: filter .14s, opacity .14s; }
  .psv-aigrade-btn:hover:not(:disabled) { filter: brightness(1.06); }
  .psv-aigrade-btn:disabled { opacity: 0.5; cursor: default; }
  .psv-aigrade-error { font-size: 0.8rem; color: #dc2626; font-weight: 600; }
  .psv-aigrade-result { background: color-mix(in srgb, var(--primary) 9%, transparent); border: 1px solid color-mix(in srgb, var(--primary) 26%, transparent); border-radius: 12px; padding: 11px 13px; font-size: 0.88rem; line-height: 1.7; color: var(--foreground); white-space: pre-wrap; }

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
  .ps-lesson-style-row { display: flex; gap: 6px; }
  .ps-lesson-style-btn { flex: 1; height: 38px; background: var(--accent); border: 1.5px solid var(--border); border-radius: 10px; font-size: 0.8rem; font-weight: 600; color: var(--fg-muted); cursor: pointer; transition: color .15s, border-color .15s, background .15s; white-space: nowrap; }
  .ps-lesson-style-btn.on { background: color-mix(in srgb, #8b5cf6 12%, var(--accent)); border-color: #8b5cf6; color: #8b5cf6; font-weight: 800; }
  .ps-lesson-style-btn:disabled { opacity: 0.4; cursor: default; }
  .ps-lesson-btn { flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px; height: 44px; padding: 0 14px; background: linear-gradient(120deg, #8b5cf6, #ec4899); color: #fff; border: none; border-radius: 12px; font-size: 0.86rem; font-weight: 700; cursor: pointer; white-space: nowrap; }
  .ps-lesson-btn:disabled { opacity: 0.5; cursor: default; }
  .ps-lesson-err { font-size: 0.8rem; color: #ef4444; margin: 0; }
  .ps-lesson-ticket-hint { font-size: 0.72rem; color: var(--fg-muted); margin: 0; }
  /* Past lesson history */
  .ps-past-lessons { display: flex; flex-direction: column; gap: 6px; border-top: 1px solid var(--border); padding-top: 12px; }
  .ps-past-label { font-size: 0.72rem; font-weight: 800; letter-spacing: .05em; color: var(--fg-muted); margin: 0 0 4px; text-transform: uppercase; }
  .ps-past-row { display: flex; align-items: center; gap: 8px; width: 100%; background: var(--accent); border: 1px solid var(--border); border-radius: 12px; padding: 10px 12px; cursor: pointer; text-align: left; transition: border-color .15s; }
  .ps-past-row:hover { border-color: #8b5cf6; }
  .ps-past-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .ps-past-topic { font-size: 0.88rem; font-weight: 700; color: var(--foreground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ps-past-meta { font-size: 0.72rem; color: var(--fg-muted); }
  .ps-past-edit { flex-shrink: 0; display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; background: transparent; border: none; color: var(--fg-muted); cursor: pointer; border-radius: 6px; }
  .ps-past-edit:hover { color: #8b5cf6; background: color-mix(in srgb, #8b5cf6 12%, transparent); }
  .ps-past-del { flex-shrink: 0; display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; background: transparent; border: none; color: var(--fg-muted); cursor: pointer; border-radius: 6px; }
  .ps-past-del:hover { color: #ef4444; background: color-mix(in srgb, #ef4444 12%, transparent); }
  /* ── Diagram (図解) ── */
  .ps-dg { padding: 14px; display: flex; flex-direction: column; gap: 16px; }
  .ps-dg-gen { display: flex; flex-direction: column; gap: 10px; background: color-mix(in srgb, #8b5cf6 6%, var(--accent)); border: 1.5px solid color-mix(in srgb, #8b5cf6 22%, var(--border)); border-radius: 16px; padding: 14px; }
  .ps-dg-genhead { display: flex; align-items: center; gap: 8px; font-size: 0.95rem; font-weight: 800; color: var(--foreground); }
  .ps-dg-genhead :global(svg) { color: #8b5cf6; }
  .ps-dg-desc { font-size: 0.78rem; color: var(--fg-muted); line-height: 1.6; margin: 0; }
  .ps-dg-input { width: 100%; height: 44px; background: var(--background); border: 1.5px solid var(--border); border-radius: 12px; padding: 0 12px; font-size: 0.9rem; color: var(--foreground); outline: none; box-sizing: border-box; }
  .ps-dg-input:focus { border-color: #8b5cf6; }
  .ps-dg-chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .ps-dg-chip { background: var(--background); border: 1.5px solid var(--border); border-radius: 999px; padding: 5px 12px; font-size: 0.76rem; font-weight: 600; color: var(--fg-muted); cursor: pointer; transition: color .15s, border-color .15s; }
  .ps-dg-chip:hover:not(:disabled) { color: #8b5cf6; border-color: #8b5cf6; }
  .ps-dg-chip:disabled { opacity: 0.4; cursor: default; }
  .ps-dg-btn { display: flex; align-items: center; justify-content: center; gap: 6px; width: 100%; height: 46px; border: none; border-radius: 12px; background: linear-gradient(120deg, #8b5cf6, #ec4899); color: #fff; font-size: 0.9rem; font-weight: 800; cursor: pointer; transition: opacity .15s; }
  .ps-dg-btn:disabled { opacity: 0.45; cursor: default; }
  .ps-dg-ticket { font-size: 0.72rem; color: var(--fg-muted); margin: 0; }
  .ps-dg-err { font-size: 0.8rem; color: #ef4444; margin: 0; }
  .ps-dg-view { display: flex; flex-direction: column; background: var(--accent); border: 1px solid var(--border); border-radius: 14px; overflow: hidden; }
  .ps-dg-viewhead { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 9px 12px; background: var(--muted); border-bottom: 1px solid var(--border); }
  .ps-dg-viewtitle { font-size: 0.86rem; font-weight: 800; color: var(--foreground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ps-dg-viewacts { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
  .ps-dg-dl { display: inline-flex; align-items: center; gap: 4px; padding: 4px 9px; background: transparent; border: 1px solid var(--border); border-radius: 7px; font-size: 0.72rem; font-weight: 700; color: var(--fg-muted); cursor: pointer; }
  .ps-dg-dl:hover { border-color: #8b5cf6; color: #8b5cf6; }
  .ps-dg-close { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; background: transparent; border: none; color: var(--fg-muted); cursor: pointer; border-radius: 7px; }
  .ps-dg-close:hover { color: #ef4444; background: color-mix(in srgb, #ef4444 12%, transparent); }
  .ps-dg-canvas { padding: 14px; overflow-x: auto; display: flex; justify-content: center; background: #ffffff; }
  /* Only the outer diagram SVG should scale — NOT the nested icon <svg>s that
     crop cells from the sprite sheet (they must keep their fixed width/height). */
  .ps-dg-canvas > :global(svg) { max-width: 100%; height: auto; }
  .ps-dg-broken { padding: 20px; text-align: center; font-size: 0.82rem; color: var(--fg-muted); }
  .ps-dg-list { display: flex; flex-direction: column; gap: 8px; }
  .ps-dg-card { display: flex; align-items: center; gap: 10px; width: 100%; background: var(--accent); border: 1px solid var(--border); border-radius: 12px; padding: 10px 12px; cursor: pointer; text-align: left; transition: border-color .15s; }
  .ps-dg-card:hover { border-color: #8b5cf6; }
  .ps-dg-cardic { display: flex; align-items: center; justify-content: center; width: 34px; height: 34px; flex-shrink: 0; border-radius: 9px; background: color-mix(in srgb, #8b5cf6 12%, transparent); color: #8b5cf6; }
  .ps-dg-cardmain { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .ps-dg-cardname { font-size: 0.88rem; font-weight: 700; color: var(--foreground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ps-dg-cardmeta { font-size: 0.72rem; color: var(--fg-muted); }
  .ps-dg-carddel { flex-shrink: 0; display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; background: transparent; border: none; color: var(--fg-muted); cursor: pointer; border-radius: 6px; }
  .ps-dg-carddel:hover { color: #ef4444; background: color-mix(in srgb, #ef4444 12%, transparent); }
  /* ── Lesson: slide deck ── */
  .ps-class { flex: 1; min-height: 0; display: flex; flex-direction: column; margin: 0 -16px -16px; }
  .ps-class-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 14px; border-bottom: 1px solid var(--border); background: var(--accent); flex-shrink: 0; }
  .ps-class-head-l { display: flex; align-items: center; gap: 6px; font-size: 0.86rem; font-weight: 700; color: var(--foreground); min-width: 0; }
  .ps-class-head-l span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ps-class-head-ic { color: #8b5cf6; flex-shrink: 0; }
  .ps-class-head-r { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
  .ps-class-save { background: color-mix(in srgb, #8b5cf6 12%, var(--accent)); border: 1.5px solid color-mix(in srgb, #8b5cf6 35%, var(--border)); border-radius: 8px; padding: 4px 12px; font-size: 0.76rem; font-weight: 700; color: #8b5cf6; cursor: pointer; transition: background .15s; }
  .ps-class-save.saved { background: color-mix(in srgb, #22c55e 15%, var(--accent)); border-color: #22c55e; color: #22c55e; cursor: default; }
  .ps-class-exit { flex-shrink: 0; background: transparent; border: 1px solid var(--border); border-radius: 8px; padding: 4px 12px; font-size: 0.76rem; font-weight: 700; color: var(--fg-muted); cursor: pointer; }

  /* Progress dots */
  .ps-slide-progress { display: flex; gap: 6px; align-items: center; justify-content: center; flex-wrap: wrap; padding: 11px 14px 5px; flex-shrink: 0; }
  .ps-slide-dot { width: 8px; height: 8px; padding: 0; border: none; border-radius: 50%; background: var(--border); cursor: pointer; transition: width .2s, background .2s; }
  .ps-slide-dot:disabled { cursor: default; }
  .ps-slide-dot.done { background: color-mix(in srgb, #8b5cf6 45%, var(--border)); }
  .ps-slide-dot.on { width: 22px; border-radius: 5px; background: linear-gradient(120deg, #8b5cf6, #ec4899); }
  .ps-slide-dot.loading { background: #ec4899; animation: ps-pulse .9s infinite; cursor: default; }
  @keyframes ps-pulse { 0%, 100% { opacity: .3; } 50% { opacity: 1; } }

  /* Slide stage + card */
  .ps-slide-stage { flex: 1; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch; padding: 10px 14px; display: flex; }
  .ps-slide-card { width: 100%; align-self: flex-start; background: var(--background); border: 1.5px solid var(--border); border-radius: 18px; padding: 18px 16px; box-shadow: 0 6px 22px rgba(139, 92, 246, 0.09); animation: ps-slide-in .28s ease; }
  @keyframes ps-slide-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
  .ps-slide-card.thinking { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 36px 16px; }
  .ps-slide-card-head { display: flex; align-items: center; gap: 9px; margin-bottom: 13px; }
  .ps-slide-ava { width: 34px; height: 34px; border-radius: 50%; object-fit: cover; object-position: top center; flex-shrink: 0; border: 1.5px solid color-mix(in srgb, #8b5cf6 30%, var(--border)); }
  .ps-slide-num { font-size: 0.72rem; font-weight: 800; letter-spacing: .04em; color: #8b5cf6; background: color-mix(in srgb, #8b5cf6 12%, var(--accent)); padding: 3px 11px; border-radius: 999px; }
  .ps-slide-qchip { font-size: 0.78rem; color: var(--fg-muted); background: var(--accent); border-left: 3px solid #ec4899; border-radius: 6px; padding: 7px 10px; margin-bottom: 13px; line-height: 1.55; word-break: break-word; }
  .ps-slide-body { font-size: 0.92rem; line-height: 1.75; color: var(--foreground); word-break: break-word; }
  .ps-slide-body .section-copy-btn, .ps-slide-body .code-copy-btn { display: none; }
  .ps-slide-body table { width: 100%; border-collapse: collapse; margin: 10px 0; font-size: 0.87rem; }
  .ps-slide-body th, .ps-slide-body td { border: 1px solid var(--border); padding: 7px 10px; text-align: left; }
  .ps-slide-body th { background: color-mix(in srgb, #8b5cf6 10%, var(--accent)); font-weight: 700; color: var(--foreground); }
  .ps-slide-body tr:nth-child(even) td { background: var(--accent); }
  .ps-slide-body h2, .ps-slide-body h3 { margin: 14px 0 6px; font-size: 1rem; font-weight: 800; color: #8b5cf6; }
  .ps-slide-body h2 { font-size: 1.05rem; }
  .ps-slide-body ul, .ps-slide-body ol { padding-left: 1.4em; margin: 6px 0; }
  .ps-slide-body li { margin: 3px 0; }
  .ps-slide-body code { background: var(--accent); border: 1px solid var(--border); border-radius: 5px; padding: 1px 6px; font-size: 0.82em; }
  .ps-slide-body pre { background: var(--accent); border: 1px solid var(--border); border-radius: 10px; padding: 12px; overflow-x: auto; margin: 10px 0; }
  .ps-slide-body pre code { background: none; border: none; padding: 0; font-size: 0.85rem; }
  .ps-mermaid-render { display: flex; justify-content: center; padding: 16px 0; overflow-x: auto; }
  .ps-mermaid-render :global(svg) { max-width: 100%; height: auto; }
  .ps-mermaid-loading { height: 80px; }
  .ps-mermaid-err { background: var(--accent); border: 1px solid var(--border); border-radius: 10px; padding: 12px; overflow-x: auto; margin: 10px 0; font-size: 0.82rem; }
  .ps-slide-thinking-txt { font-size: 0.82rem; color: var(--fg-muted); margin: 0; }
  .ps-class-err-txt { font-size: 0.85rem; color: #ef4444; text-align: center; margin: 0 0 10px; }
  .ps-slide-retry { display: block; margin: 0 auto; background: transparent; border: 1px solid #ef4444; border-radius: 8px; padding: 5px 14px; color: #ef4444; font-weight: 700; cursor: pointer; }

  .ps-class-typing { display: flex; gap: 4px; align-items: center; }
  .ps-class-typing span { width: 8px; height: 8px; border-radius: 50%; background: #8b5cf6; opacity: 0.5; animation: ps-typing 1s infinite; }
  .ps-class-typing span:nth-child(2) { animation-delay: 0.2s; }
  .ps-class-typing span:nth-child(3) { animation-delay: 0.4s; }
  @keyframes ps-typing { 0%, 60%, 100% { transform: translateY(0); opacity: 0.4; } 30% { transform: translateY(-4px); opacity: 1; } }

  /* Slide navigation */
  .ps-slide-nav { display: flex; gap: 8px; padding: 6px 14px 4px; flex-shrink: 0; }
  .ps-slide-prev, .ps-slide-next { display: flex; align-items: center; justify-content: center; gap: 4px; height: 42px; border-radius: 12px; font-size: 0.86rem; font-weight: 800; cursor: pointer; }
  .ps-slide-prev { flex: 0 0 auto; padding: 0 16px; background: var(--accent); border: 1.5px solid var(--border); color: var(--fg-muted); }
  .ps-slide-next { flex: 1; padding: 0 16px; background: linear-gradient(120deg, #8b5cf6, #ec4899); border: none; color: #fff; }
  .ps-slide-prev:disabled, .ps-slide-next:disabled { opacity: 0.45; cursor: default; }

  /* Ask the teacher */
  .ps-class-bar { display: flex; align-items: center; gap: 8px; padding: 8px 12px; padding-bottom: calc(10px + env(safe-area-inset-bottom)); background: var(--background); flex-shrink: 0; }
  .ps-class-input { flex: 1; min-width: 0; height: 40px; background: var(--accent); border: 1.5px solid var(--border); border-radius: 12px; padding: 0 12px; font-size: 0.88rem; color: var(--foreground); outline: none; }
  .ps-class-input:focus { border-color: var(--primary); }
  .ps-class-send { flex-shrink: 0; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; background: linear-gradient(120deg, #8b5cf6, #ec4899); color: #fff; border: none; border-radius: 12px; cursor: pointer; }
  .ps-class-send:disabled { opacity: 0.4; cursor: default; }
    `}</style>
  );
}
