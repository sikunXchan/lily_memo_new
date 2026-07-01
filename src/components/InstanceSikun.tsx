'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { X, Send } from 'lucide-react';
import { db } from '@/lib/db';
import { noteHtmlToText } from '@/lib/noteText';
import { streamSikunlilyChat, type ChatTurn } from '@/lib/gemini';
import { getPdfSnapshot, getPdfAllPages, addPdfAnnotation, type SikunAnnotation } from '@/lib/pdfBridge';
import {
  loadSikunHistory, saveSikunHistory, toChatTurns,
  type SikunMessage,
} from '@/lib/sikunHistory';
import { getEffectiveApiKey, getAppLang } from '@/lib/appLang';
import { canAfford, deductPoints, getRemainingPoints, PT, ptToTokens, formatTokens } from '@/lib/points';
import { buildAppKnowledgeText } from '@/lib/appKnowledge';
import { renderRich } from '@/lib/richText';
import 'katex/dist/katex.min.css';

interface InstanceSikunProps {
  activeNoteId?: number;
  prevNoteId?: number;
  onOpenNote?: (id: number) => void;
  isPdfTab?: boolean;
}

interface DoSendOpts {
  fullNote?: boolean;    // include the whole memo body, not just an excerpt
  attachPdf?: boolean;   // attach the current PDF page image
  attachPdfAll?: boolean; // attach every PDF page image (capped)
  heavy?: boolean;       // allow long, detailed output
  annotatePdf?: boolean; // ask Sikun to write annotations onto the PDF
}

const POS_KEY = 'lily_instance_sikun_pos';
const TONE_KEY = 'lily_sikun_tone';
const ICON_SIZE = 88;
const LONG_PRESS_MS = 420;
const TAP_MAX_MS = 300;
const TAP_MAX_MOVE = 8;
const BUBBLE_W = 260;
const DOUBLE_TAP_MS = 320;
const EDGE_SNAP_PX = 18;

const TYPING_FRAMES = [
  '/sikun-type-both.png',
  '/sikun-type-right.png',
  '/sikun-type-left.png',
];
const TYPING_FRAME_MS = 170;
const IDLE_ICON = '/sikun-character.png';

// 9-frame book animation played once when user opens a memo.
const BOOK_FRAMES = [
  '/sikun-book-open.png',
  '/sikun-book-read.png',
  '/sikun-book-hand.png',
  '/sikun-book-read.png',
  '/sikun-book-hand.png',
  '/sikun-book-read.png',
  '/sikun-book-hand.png',
  '/sikun-book-read.png',
  '/sikun-book-close.png',
];
// How long each frame stays before the next. First (open) and last (close)
// linger; the middle page-flips are quick.
const BOOK_FRAME_DELAYS = [600, 200, 200, 200, 200, 200, 200, 200, 600];

const TONE_PROMPTS: Record<string, string> = {
  keigo: '丁寧な敬語（「〜です」「〜ます」「〜でしょう」）。礼儀正しく、簡潔に。',
  tame: 'フランクなタメ口（「〜だよ」「〜じゃん」「〜してみて」）。友達みたいに気さくに。',
  casual: 'カジュアルでフレンドリー、絵文字も少しだけ使う（「〜だね！」「〜かも🐶」）。明るく簡潔に。',
};

function currentTonePrompt(): string {
  if (typeof window === 'undefined') return TONE_PROMPTS.tame;
  return TONE_PROMPTS[localStorage.getItem(TONE_KEY) || 'tame'] || TONE_PROMPTS.tame;
}

function timeOfDayPlaceholder(): string {
  const h = new Date().getHours();
  if (getAppLang() === 'en') {
    if (h >= 5 && h < 11) return 'Morning. What do you want to know?';
    if (h >= 11 && h < 17) return 'Ask sikun...';
    if (h >= 17 && h < 22) return 'Long day? Need a hand?';
    return 'Up late? I\'ll keep it short';
  }
  if (h >= 5 && h < 11) return 'おはよう、何か聞きたいか？';
  if (h >= 11 && h < 17) return 'sikunに話す...';
  if (h >= 17 && h < 22) return 'お疲れさま。何か手伝おうか？';
  return '夜更かし？短めに答えるよ';
}

function formatMs(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const INSTANCE_SIKUN_SYSTEM = `あなたは「sikun」、画面上に常駐するフローティング・キャラクター。
sikunlilyの軽量版で、ユーザーが作業中にちらっと質問する用途専用だ。

# 役割
- 短い質問への即答（1〜3文）
- アクティブメモの内容に対する質問への回答・要約・ToDo（やること）抽出
- 画像で渡されたPDFページの内容を読み取って、説明・要約・翻訳する
- 選択された文章の解説
- 直接的な事実回答や言い換え

# 検索について（重要・コスト節約）
- 基本は自分の知識だけで答える。検索は有料なので安易に使わない。
- ただし「自分が知らない固有名詞・専門用語」や「最新情報（時事・価格・リリース等）が必須の質問」で、知識だけでは正確に答えられないと判断したときは、本文を一切書かず、次の一行だけを出力せよ:
  [SEARCH: 調べたいキーワード]
- 知っている内容なら絶対に [SEARCH] を使わず普通に答える。

# テキスト整形のルール
- **重要な用語・キーワード**は **太字** にする
- 複数の項目や手順は「・」「-」の箇条書きにする
- コードスニペットがある場合は \`\`\`コード\`\`\` フェンスを使ってよい（本文の補足として短くね）
- 長い説明は h2/h3 見出し（##/###）で区切ってよい
- mermaid 図、QA ブロック、グラフ、スライド、図形などの構造化ブロック出力は一切作らない
- \`\`\`ask\`\`\` で聞き返さない（聞き返さずベストエフォートで答える）
- 論文調の回答はしない
- 「次のアクション」「次のステップ」みたいなメタ説明をしない

# 複雑な依頼が来たら
「それは AI タブの sikunlily 本体に頼んでくれ」とひと言だけ返せ。
（例: 「マインドマップ作って」「クイズ作って」「グラフ書いて」「Deep Research して」など）

# 口調
__TONE__`;

const INSTANCE_SIKUN_SYSTEM_EN = `You are "sikun", a floating character that lives on the screen.
You're the lightweight version of sikunlily, made for quick questions while the user is working.

# Role
- Instant answers to short questions (1-3 sentences)
- Answering, summarizing, and pulling to-dos from the active note
- Reading PDF page images passed to you and explaining / summarizing / translating them
- Explaining a selected sentence
- Direct factual answers and rephrasing

# About search (important — save cost)
- Answer from your own knowledge by default. Search costs money, so don't reach for it lightly.
- But when a question hinges on a proper noun / technical term you don't know, or needs up-to-date info (news, prices, releases) you can't answer accurately from memory, output nothing but this single line:
  [SEARCH: keywords to look up]
- If you know the answer, never use [SEARCH] — just answer normally.

# Text formatting rules
- **Bold** important terms and keywords
- Use bullet lists ("・" or "-") for multiple items or steps
- Short code snippets may use \`\`\`code\`\`\` fences as a supplement
- Long explanations may use h2/h3 headings (##/###) to break them up
- Never produce structured block output like mermaid diagrams, QA blocks, charts, slides, or shapes
- Don't ask back with \`\`\`ask\`\`\` (answer best-effort without asking back)
- No academic-paper tone
- No meta commentary like "next action" or "next step"

# When a complex request comes in
Reply with one line only: "Ask the full sikunlily in the AI tab for that."
(e.g. "make a mind map", "make a quiz", "draw a graph", "do Deep Research")

# Always reply in English.

# Tone
Friendly, warm, and concise — like a helpful study buddy. A light emoji now and then is fine.`;

function sikunBaseSystem(en: boolean): string {
  const base = en ? INSTANCE_SIKUN_SYSTEM_EN : INSTANCE_SIKUN_SYSTEM.replace('__TONE__', currentTonePrompt());
  return `${base}\n\n${buildAppKnowledgeText()}`;
}

// Appended to system prompt when Sikun is asked to annotate a PDF page.
const PDF_ANNOTATE_ADDON = `

# PDFへの書き込み指示（重要）
ユーザーがPDFへの書き込み・注釈を依頼している。
以下の手順で回答せよ:
1. まず通常の解説テキストを日本語で書く（短くてよい。要点と注釈の意図を説明する）。
2. 解説の後に、次の形式で注釈ブロックを出力する（必須）:

[PDF_WRITE]
[{"type":"highlight","x0":0.05,"y0":0.12,"x1":0.95,"y1":0.18},{"type":"text","x0":0.05,"y0":0.20,"text":"ここが重要！"},{"type":"underline","x0":0.10,"y0":0.35,"x1":0.65,"y1":0.40},{"type":"arrow","x0":0.30,"y0":0.50,"x1":0.55,"y1":0.45}]
[/PDF_WRITE]

## 座標の仕様
- すべての座標は 0.0〜1.0 の正規化座標（0=左端・上端、1=右端・下端）。
- ページ画像を目で読み取って、実際の内容の位置に合わせて座標を指定すること。
- x0,y0 が左上、x1,y1 が右下（arrowの場合は始点・終点）。

## 注釈タイプ
- highlight: 矩形ハイライト（x0,y0,x1,y1 必須）
- underline: 下線（x0,y0=行の左端, x1,y1=行の右端）
- text: ラベル吹き出し（x0,y0=吹き出し位置, text=ラベル文字列）
- arrow: 矢印（x0,y0=始点, x1,y1=終点）

## 注意
- JSONの配列はそのまま出力（コードフェンス不要）。
- 1ページにつき注釈は最大8個まで。
- highlight は太い帯にならないよう y1-y0 は 0.04〜0.10 程度に。
- text のラベルは10文字以内の簡潔な日本語で。`;

interface Pos { x: number; y: number }

function loadPos(): Pos | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(POS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function clampPos(p: Pos): Pos {
  if (typeof window === 'undefined') return p;
  const maxX = window.innerWidth - ICON_SIZE - 4;
  const maxY = window.innerHeight - ICON_SIZE - 4;
  return {
    x: Math.max(4, Math.min(p.x, maxX)),
    y: Math.max(4, Math.min(p.y, maxY)),
  };
}

export default function InstanceSikun({ activeNoteId, prevNoteId, onOpenNote, isPdfTab }: InstanceSikunProps) {
  const en = getAppLang() === 'en';
  const [pos, setPos] = useState<Pos>(() => {
    const saved = loadPos();
    if (saved) return saved;
    if (typeof window === 'undefined') return { x: 16, y: 80 };
    return { x: window.innerWidth - ICON_SIZE - 12, y: 90 };
  });
  const [dragging, setDragging] = useState(false);
  const [mode, setMode] = useState<'closed' | 'input'>('closed');
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [lastReply, setLastReply] = useState<string>('');
  const [bubbleVisible, setBubbleVisible] = useState(false);
  const [history, setHistory] = useState<SikunMessage[]>([]);
  const [tapStreak, setTapStreak] = useState(0);
  const [typingFrame, setTypingFrame] = useState(0);
  const [bookFrame, setBookFrame] = useState<number | null>(null);
  const [selectionBadge, setSelectionBadge] = useState(false);
  const [selectedText, setSelectedText] = useState('');
  const [pomodoroMs, setPomodoroMs] = useState<number | null>(null);
  const [pausedMs, setPausedMs] = useState<number | null>(null);
  const [pendingAnswer, setPendingAnswer] = useState<string>('');
  const [quizMode, setQuizMode] = useState(false);
  const [radialOpen, setRadialOpen] = useState(false);

  const lastTapAt = useRef<number>(0);
  // Track the last noteId we showed the book animation for
  const seenNoteIdRef = useRef<number | undefined>(undefined);
  const selectionBadgeTimer = useRef<number | null>(null);
  const selectionDebounce = useRef<number | null>(null);
  const pomodoroRef = useRef<number | null>(null);
  const pomodoroEndRef = useRef<number>(0);
  const pomodoroMinRef = useRef<number>(30);
  const pointerStart = useRef<{ x: number; y: number; ox: number; oy: number; ts: number } | null>(null);
  const moved = useRef(false);
  const longPressTimer = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setHistory(loadSikunHistory()); }, []);

  useEffect(() => {
    if (mode === 'input') setTimeout(() => inputRef.current?.focus(), 30);
  }, [mode]);

  useEffect(() => {
    const handleResize = () => setPos(p => clampPos(p));
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const persistPos = useCallback((p: Pos) => {
    try { localStorage.setItem(POS_KEY, JSON.stringify(p)); } catch {}
  }, []);

  const closeInput = useCallback(() => {
    inputRef.current?.blur();
    setMode('closed');
  }, []);

  // Typing frame cycle
  useEffect(() => {
    if (!loading) { setTypingFrame(0); return; }
    const id = window.setInterval(() => setTypingFrame(f => (f + 1) % TYPING_FRAMES.length), TYPING_FRAME_MS);
    return () => window.clearInterval(id);
  }, [loading]);

  // Book animation when activeNoteId changes
  useEffect(() => {
    if (activeNoteId === seenNoteIdRef.current) return;
    seenNoteIdRef.current = activeNoteId;
    if (activeNoteId === undefined) { setBookFrame(null); return; }
    let f = 0;
    setBookFrame(0);
    let timer: number;
    const advance = () => {
      timer = window.setTimeout(() => {
        f++;
        if (f < BOOK_FRAMES.length) {
          setBookFrame(f);
          advance();
        } else {
          setBookFrame(null);
        }
      }, BOOK_FRAME_DELAYS[f] ?? 200);
    };
    advance();
    return () => window.clearTimeout(timer);
  }, [activeNoteId]);

  // Selection badge (memo only) — debounced so rapid selectionchange bursts
  // don't flicker. PDF text selection is intentionally excluded because PDF
  // OCR/text extraction is unreliable; users type the word into chat instead.
  useEffect(() => {
    const capture = () => {
      if (isPdfTab) return;
      if (selectionDebounce.current) window.clearTimeout(selectionDebounce.current);
      selectionDebounce.current = window.setTimeout(() => {
        const sel = window.getSelection();
        const text = sel?.toString().trim() || '';
        if (text.length >= 2) {
          setSelectedText(text);
          setSelectionBadge(true);
          if (selectionBadgeTimer.current) window.clearTimeout(selectionBadgeTimer.current);
          selectionBadgeTimer.current = window.setTimeout(() => {
            setSelectionBadge(false);
            setSelectedText('');
          }, 10000);
        }
        // don't clear badge on empty — user may be tapping sikun while text is still selected
      }, 200);
    };
    // selectionchange fires on text selection; pointerup catches mobile long-press selection
    document.addEventListener('selectionchange', capture);
    document.addEventListener('pointerup', capture);
    return () => {
      document.removeEventListener('selectionchange', capture);
      document.removeEventListener('pointerup', capture);
      if (selectionDebounce.current) window.clearTimeout(selectionDebounce.current);
      if (selectionBadgeTimer.current) window.clearTimeout(selectionBadgeTimer.current);
    };
  }, [isPdfTab]);

  useEffect(() => {
    return () => {
      if (pomodoroRef.current) window.clearInterval(pomodoroRef.current);
    };
  }, []);

  // Run the countdown for a given remaining time. Used by both start & resume.
  const runTimer = useCallback((remainingMs: number) => {
    if (pomodoroRef.current) window.clearInterval(pomodoroRef.current);
    pomodoroEndRef.current = Date.now() + remainingMs;
    setPausedMs(null);
    setPomodoroMs(remainingMs);
    pomodoroRef.current = window.setInterval(() => {
      const remaining = pomodoroEndRef.current - Date.now();
      if (remaining <= 0) {
        if (pomodoroRef.current) { window.clearInterval(pomodoroRef.current); pomodoroRef.current = null; }
        setPomodoroMs(0);
        setLastReply(en
          ? `${pomodoroMinRef.current} minutes are up! Nice work — take a short break.`
          : `${pomodoroMinRef.current}分経ったよ！お疲れさま、少し休もう。`);
        setBubbleVisible(true);
        if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
        window.setTimeout(() => setPomodoroMs(null), 4000);
      } else {
        setPomodoroMs(remaining);
      }
    }, 1000);
  }, [en]);

  const startPomodoro = useCallback((minutes: number) => {
    pomodoroMinRef.current = minutes;
    runTimer(minutes * 60 * 1000);
  }, [runTimer]);

  // Pause keeps the remaining time so it can be resumed later.
  const pausePomodoro = useCallback(() => {
    if (pomodoroRef.current) { window.clearInterval(pomodoroRef.current); pomodoroRef.current = null; }
    const remaining = pomodoroEndRef.current - Date.now();
    setPomodoroMs(null);
    setPausedMs(remaining > 0 ? remaining : null);
  }, []);

  const resumePomodoro = useCallback(() => {
    if (pausedMs !== null && pausedMs > 0) runTimer(pausedMs);
  }, [pausedMs, runTimer]);

  // Cancel clears everything (no resume).
  const cancelPomodoro = useCallback(() => {
    if (pomodoroRef.current) { window.clearInterval(pomodoroRef.current); pomodoroRef.current = null; }
    setPomodoroMs(null);
    setPausedMs(null);
  }, []);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    pointerStart.current = { x: e.clientX, y: e.clientY, ox: pos.x, oy: pos.y, ts: Date.now() };
    moved.current = false;
    if (longPressTimer.current) window.clearTimeout(longPressTimer.current);
    longPressTimer.current = window.setTimeout(() => {
      if (!moved.current) {
        setRadialOpen(true);
        setMode('closed');
        setBubbleVisible(false);
        setQuizMode(false);
        setPendingAnswer('');
        if (navigator.vibrate) navigator.vibrate(10);
      }
    }, LONG_PRESS_MS);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointerStart.current) return;
    const dx = e.clientX - pointerStart.current.x;
    const dy = e.clientY - pointerStart.current.y;
    if (Math.abs(dx) > TAP_MAX_MOVE || Math.abs(dy) > TAP_MAX_MOVE) {
      if (!moved.current) {
        moved.current = true;
        if (!radialOpen) {
          if (longPressTimer.current) { window.clearTimeout(longPressTimer.current); longPressTimer.current = null; }
          setDragging(true);
        }
      }
    }
    if (dragging) {
      setPos(clampPos({ x: pointerStart.current.ox + dx, y: pointerStart.current.oy + dy }));
    }
  };

  const snapToEdgeIfClose = (p: Pos): Pos => {
    if (typeof window === 'undefined') return p;
    const W = window.innerWidth;
    const next = { ...p };
    if (next.x < EDGE_SNAP_PX) next.x = 6;
    else if (next.x + ICON_SIZE > W - EDGE_SNAP_PX) next.x = W - ICON_SIZE - 6;
    return next;
  };

  const onPointerUp = () => {
    if (longPressTimer.current) { window.clearTimeout(longPressTimer.current); longPressTimer.current = null; }
    const start = pointerStart.current;
    pointerStart.current = null;
    if (!start) return;
    const elapsed = Date.now() - start.ts;
    if (dragging) {
      setDragging(false);
      const snapped = snapToEdgeIfClose(pos);
      if (snapped.x !== pos.x) setPos(snapped);
      persistPos(snapped);
      return;
    }
    if (radialOpen) return;
    if (elapsed <= TAP_MAX_MS && !moved.current) {

      // Tapping while selection badge is active → explain selected text (memo)
      if (selectionBadge && selectedText) {
        if (selectionBadgeTimer.current) window.clearTimeout(selectionBadgeTimer.current);
        setSelectionBadge(false);
        setSelectedText('');
        void sendQuickAction(`次の文を短く解説してくれ:\n${selectedText.slice(0, 500)}`);
        return;
      }

      const now = Date.now();
      const since = now - lastTapAt.current;
      lastTapAt.current = now;

      // 5-tap easter egg
      const nextStreak = since < 500 ? tapStreak + 1 : 1;
      setTapStreak(nextStreak);
      if (nextStreak >= 5) {
        setTapStreak(0);
        setLastReply('くすぐったいよ！そんなに連打しないで〜🐶');
        setBubbleVisible(true);
        return;
      }

      // Regular tap
      if (lastReply && !bubbleVisible && mode === 'closed') {
        setBubbleVisible(true);
      } else if (mode === 'closed') {
        setMode('input');
        setBubbleVisible(false);
      } else {
        closeInput();
      }
    }
  };

  const sendQuickAction = (presetText: string, opts?: DoSendOpts) => {
    setInput('');
    return doSend(presetText, opts);
  };

  const jumpToPrevNote = useCallback(() => {
    setRadialOpen(false);
    setQuizMode(false);
    setPendingAnswer('');
    if (prevNoteId !== undefined && onOpenNote) {
      onOpenNote(prevNoteId);
      setLastReply(en ? 'Opened your last note.' : 'さっきのメモを開いたよ。');
      setBubbleVisible(true);
    } else {
      setLastReply(en ? 'No note to go back to yet.' : '戻れるメモがまだ無いよ。');
      setBubbleVisible(true);
    }
  }, [prevNoteId, onOpenNote, en]);

  // Random Q&A from the currently open memo (reads its full content)
  const randomQA = useCallback(async () => {
    setRadialOpen(false);
    if (activeNoteId === undefined) {
      setLastReply(en ? 'Open a note first.' : 'メモを開いてからにしてね。');
      setBubbleVisible(true);
      return;
    }
    try {
      const note = await db.notes.get(activeNoteId);
      const pairs: { q: string; a: string }[] = [];
      if (note?.content) {
        const matches = [...note.content.matchAll(/data-pairs="([^"]*)"/g)];
        for (const m of matches) {
          try {
            const decoded = m[1].replace(/&quot;/g, '"').replace(/&#34;/g, '"').replace(/&amp;/g, '&');
            const arr = JSON.parse(decoded);
            if (Array.isArray(arr)) {
              pairs.push(...arr.map((p: { q: string; a: string }) => ({ q: p.q, a: p.a })));
            }
          } catch { /* skip malformed */ }
        }
      }
      if (pairs.length === 0) {
        setLastReply(en ? 'No Q&A found in this note.' : 'このメモにQ&Aが見つからないよ。');
        setBubbleVisible(true);
        return;
      }
      const item = pairs[Math.floor(Math.random() * pairs.length)];
      setLastReply(`Q: ${item.q}`);
      setPendingAnswer(item.a);
      setQuizMode(true);
      setBubbleVisible(true);
    } catch {
      setLastReply(en ? 'Failed to load the Q&A.' : 'Q&Aの取得に失敗しちゃった。');
      setBubbleVisible(true);
    }
  }, [activeNoteId, en]);

  // Generate a study question from the full note content using AI
  const doFullTextQuiz = useCallback(async () => {
    setRadialOpen(false);
    if (activeNoteId === undefined) {
      setLastReply(en ? 'Open a note first.' : 'メモを開いてからにしてね。');
      setBubbleVisible(true);
      return;
    }
    const apiKey = getEffectiveApiKey();
    if (!apiKey) {
      setLastReply(en ? 'Save your Gemini API key in Settings.' : '設定で Gemini API キーを保存してくれ');
      setBubbleVisible(true);
      return;
    }
    if (!canAfford(PT.lite)) {
      setLastReply(en ? `Not enough tokens (${formatTokens(ptToTokens(getRemainingPoints()))} remaining).` : `トークンが足りません（残り${formatTokens(ptToTokens(getRemainingPoints()))}）。明日リセットされます。`);
      setBubbleVisible(true);
      return;
    }
    setLoading(true);
    setBubbleVisible(false);
    setLastReply('');
    setQuizMode(false);
    setPendingAnswer('');
    try {
      const note = await db.notes.get(activeNoteId);
      if (!note) throw new Error(en ? 'note not found' : 'メモが見つからない');
      const plain = noteHtmlToText(note.content || '');
      const noteCtx = en
        ? `\n\n# The note the user currently has open\nTitle: ${note.title || 'Untitled'}\nFull text: ${plain}`
        : `\n\n# 現在ユーザーが開いているメモ\nタイトル: ${note.title || '無題'}\n本文全文: ${plain}`;
      const systemPrompt = sikunBaseSystem(en) + noteCtx;
      const turns: ChatTurn[] = [{
        role: 'user',
        text: en
          ? 'Create exactly one question from this whole note. Output in the format "Q: question\nA: answer", in English.'
          : 'このメモ全体の内容から1問だけ出して。「Q: 問題\nA: 答え」の形式で出力してね。',
      }];
      deductPoints(PT.lite);
      const reply = await streamSikunlilyChat(
        turns, systemPrompt, apiKey, 0, {},
        ['gemini-3.1-flash-lite'],
        false,
      );
      const qm = reply.match(/Q[：:]\s*(.+)/);
      const am = reply.match(/A[：:]\s*(.+)/);
      if (qm && am) {
        setLastReply(`Q: ${qm[1].trim()}`);
        setPendingAnswer(am[1].trim());
        setQuizMode(true);
      } else {
        setLastReply(reply.trim() || (en ? "Couldn't make a question." : '問題を作れなかったよ。'));
      }
      setBubbleVisible(true);
      setMode('closed');
    } catch (err) {
      setLastReply(`${en ? 'Error' : 'エラー'}: ${err instanceof Error ? err.message : (en ? 'failed' : '失敗')}`);
      setBubbleVisible(true);
    } finally {
      setLoading(false);
    }
  }, [activeNoteId, en]);

  // Show last 5 memo titles
  const showRecentMemos = useCallback(async () => {
    setRadialOpen(false);
    setQuizMode(false);
    setPendingAnswer('');
    try {
      const notes = await db.notes.orderBy('updatedAt').reverse().limit(5).toArray();
      if (notes.length === 0) {
        setLastReply(en ? 'No notes yet.' : 'まだメモが無いよ。');
      } else {
        setLastReply((en ? 'Recent notes:\n' : '最近のメモ:\n') + notes.map((n, i) => `${i + 1}. ${n.title || (en ? 'Untitled' : '無題')}`).join('\n'));
      }
      setBubbleVisible(true);
    } catch {
      setLastReply(en ? 'Failed to load.' : '取得に失敗しちゃった。');
      setBubbleVisible(true);
    }
  }, [en]);

  const sendMessage = () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');

    if (/(前|さっき|戻)(の)?メモ|メモ.*(戻|に戻)/.test(text) || /^(戻る|戻って)$/.test(text)) {
      closeInput();
      jumpToPrevNote();
      return;
    }

    // Resume a paused timer
    if (pausedMs !== null && /(再開|続き|続け|resume)/i.test(text)) {
      closeInput();
      resumePomodoro();
      setLastReply(en ? 'Timer resumed!' : 'タイマーを再開したよ！');
      setBubbleVisible(true);
      return;
    }
    // Fully cancel
    if ((pomodoroMs !== null || pausedMs !== null) && /(終了|キャンセル|cancel|やめ)/i.test(text)) {
      closeInput();
      cancelPomodoro();
      setLastReply(en ? 'Timer stopped.' : 'タイマーを終了したよ。');
      setBubbleVisible(true);
      return;
    }
    // Pause a running timer
    if (pomodoroMs !== null && /(止め|ストップ|一時停止|stop|pause)/i.test(text)) {
      closeInput();
      pausePomodoro();
      setLastReply(en ? 'Timer paused. Say "resume" to continue.' : 'タイマーを一時停止したよ。「再開」で続けられる。');
      setBubbleVisible(true);
      return;
    }

    const pomMatch = text.match(/(\d+)\s*分.*(タイマー|ポモドーロ)|(タイマー|ポモドーロ).*(\d+)\s*分|^ポモドーロ$/)
      || text.match(/(\d+)\s*min.*(timer|pomodoro)|(timer|pomodoro).*(\d+)\s*min|^pomodoro$/i);
    if (pomMatch) {
      closeInput();
      const mins = parseInt(pomMatch[1] || pomMatch[4] || '30', 10);
      startPomodoro(mins);
      setLastReply(en ? `Started a ${mins}-minute timer! Let's focus.` : `${mins}分のタイマーを開始したよ！集中しよう。`);
      setBubbleVisible(true);
      return;
    }

    const wantsFullNote = activeNoteId !== undefined &&
      /全文|全体|全部|全て|解析|分析/.test(text);
    return doSend(text, wantsFullNote ? { fullNote: true } : undefined);
  };

  const doSend = async (text: string, opts?: DoSendOpts) => {
    if (!text || loading) return;
    const apiKey = getEffectiveApiKey();
    if (!apiKey) {
      setLastReply(en ? 'Save your Gemini API key in Settings.' : '設定で Gemini API キーを保存してくれ');
      setBubbleVisible(true);
      setMode('closed');
      return;
    }
    if (!canAfford(PT.lite)) {
      setLastReply(en ? `Not enough tokens (${formatTokens(ptToTokens(getRemainingPoints()))} remaining).` : `トークンが足りません（残り${formatTokens(ptToTokens(getRemainingPoints()))}）。明日リセットされます。`);
      setBubbleVisible(true);
      return;
    }
    closeInput();
    setLoading(true);
    setBubbleVisible(false);
    setLastReply('');
    setQuizMode(false);
    setPendingAnswer('');

    const userMsg: SikunMessage = { id: `u${Date.now()}`, role: 'user', text, ts: Date.now() };
    const nextHistory = [...history, userMsg];
    setHistory(nextHistory);

    // On-demand note fetch — only when user actually sends a message.
    // 要約/ToDo/解説は全文、通常チャットは先頭800文字。
    let noteContext = '';
    if (activeNoteId !== undefined) {
      try {
        const note = await db.notes.get(activeNoteId);
        if (note) {
          const plain = noteHtmlToText(note.content || '');
          const body = opts?.fullNote ? plain : plain.slice(0, 800);
          const label = opts?.fullNote
            ? (en ? 'Full text' : '本文全文')
            : (en ? 'Excerpt (first 800 chars)' : '抜粋(先頭800文字)');
          noteContext = en
            ? `\n\n# The note the user currently has open\nTitle: ${note.title || 'Untitled'}\n${label}: ${body}`
            : `\n\n# 現在ユーザーが開いているメモ\nタイトル: ${note.title || '無題'}\n${label}: ${body}`;
        }
      } catch { /* ignore */ }
    }

    // Attach PDF on demand only. Free-text on the PDF tab attaches the page
    // just when the message clearly refers to it — never on every message.
    const turns: ChatTurn[] = toChatTurns(nextHistory);
    let pdfNote = '';
    const wantPage = opts?.attachPdf
      || (isPdfTab && /ページ|pdf|この(問題|図|表|文|内容|資料|範囲|箇所)|ここ|画像|written|書いて/i.test(text));
    if (opts?.attachPdfAll) {
      const all = await getPdfAllPages(15);
      if (all && all.images.length > 0 && turns.length > 0) {
        turns[turns.length - 1] = {
          ...turns[turns.length - 1],
          attachments: [{
            mimeType: 'image/jpeg',
            data: '',
            pdfPageImages: all.images.map(d => ({ data: d })),
            pdfTotalPages: all.total,
          }],
        };
        pdfNote = en
          ? `\n\n# Full PDF\nAttached ${all.truncated ? `the first ${all.images.length} of ${all.total} pages` : `all ${all.total} pages`} as images. Read through the whole thing and explain it carefully.`
          : `\n\n# PDF全文\n全${all.total}ページ${all.truncated ? `中の最初の${all.images.length}ページ` : ''}を画像で添付した。全体を通して読み取り、丁寧に解説せよ。`;
      }
    } else if (wantPage) {
      const snap = getPdfSnapshot();
      if (snap && turns.length > 0) {
        turns[turns.length - 1] = {
          ...turns[turns.length - 1],
          attachments: [{
            mimeType: 'image/jpeg',
            data: '',
            pdfPageImages: [{ data: snap.imageBase64 }],
          }],
        };
        pdfNote = en
          ? `\n\n# The PDF the user currently has open\nAttached the image of page ${snap.page}/${snap.total}. Read the content of this image and answer.`
          : `\n\n# 現在ユーザーが開いているPDF\n${snap.page}/${snap.total}ページ目の画像を添付した。この画像の内容を読み取って答えよ。`;
      }
    }

    // Heavy actions (full PDF, full memo) may produce long, structured text.
    const heavyNote = opts?.heavy
      ? (en
          ? '\n\n# This is an important analysis request\nDon\'t worry about output length — go as long and detailed as needed. You may structure with paragraphs and "・" bullets (no special blocks like mermaid/QA).'
          : '\n\n# 今回は重要な解析依頼\n出力の長さ制限は気にせず、必要なだけ詳しく丁寧に長文で回答してよい。段落や「・」の箇条書きで構造化してよい（mermaid/QAブロック等の特殊ブロックは作らない）。')
      : '';

    const annotateNote = opts?.annotatePdf ? PDF_ANNOTATE_ADDON : '';

    try {
      const baseSystem = sikunBaseSystem(en);
      const systemPrompt = baseSystem + noteContext + pdfNote + heavyNote + annotateNote;
      const modelList = ['gemini-3.1-flash-lite'];
      deductPoints(PT.lite);
      // Pass 1: no search (free). sikun answers from its own knowledge, or
      // emits `[SEARCH: query]` when it hits something it doesn't know.
      let reply = await streamSikunlilyChat(
        turns,
        systemPrompt,
        apiKey,
        0,
        {},
        modelList,
        false,
      );
      // Pass 2: only if sikun asked to search → re-run with Google Search on (paid).
      const searchReq = reply.match(/\[SEARCH:\s*([^\]]+)\]/i);
      if (searchReq) {
        const query = searchReq[1].trim();
        const searchTurns: ChatTurn[] = [
          ...turns,
          { role: 'model', text: reply },
          { role: 'user', text: en ? `Search for "${query}" and answer the original question.` : `「${query}」を調べて、最初の質問に答えて。` },
        ];
        reply = await streamSikunlilyChat(
          searchTurns,
          systemPrompt,
          apiKey,
          0,
          {},
          modelList,
          true,
        );
      }
      // Extract and apply PDF annotation blocks before showing reply text
      let replyForDisplay = reply;
      const annMatch = reply.match(/\[PDF_WRITE\]\s*([\s\S]*?)\s*\[\/PDF_WRITE\]/);
      if (annMatch) {
        replyForDisplay = reply.replace(/\[PDF_WRITE\][\s\S]*?\[\/PDF_WRITE\]/g, '').trim();
        try {
          const parsed = JSON.parse(annMatch[1]) as SikunAnnotation[];
          const snap = getPdfSnapshot();
          const page = snap?.page ?? 1;
          addPdfAnnotation(parsed, page);
        } catch { /* ignore malformed JSON */ }
      }

      const replyClean = replyForDisplay.trim() || '...';
      setLastReply(replyClean);
      setBubbleVisible(true);
      const sikunMsg: SikunMessage = { id: `s${Date.now()}`, role: 'sikun', text: replyClean, ts: Date.now() };
      const finalHistory = [...nextHistory, sikunMsg];
      setHistory(finalHistory);
      saveSikunHistory(finalHistory);
      setMode('closed');
    } catch (err) {
      setLastReply(`${en ? 'Error' : 'エラー'}: ${err instanceof Error ? err.message : (en ? 'failed' : '失敗')}`);
      setBubbleVisible(true);
    } finally {
      setLoading(false);
    }
  };

  const winW = typeof window !== 'undefined' ? window.innerWidth : 800;
  const bubbleOnLeft = pos.x + ICON_SIZE / 2 > winW / 2;
  const bubbleStyle: React.CSSProperties = bubbleOnLeft
    ? { right: winW - pos.x + 8, top: pos.y }
    : { left: pos.x + ICON_SIZE + 8, top: pos.y };
  const inputStyle: React.CSSProperties = bubbleOnLeft
    ? { right: winW - pos.x + 8, top: pos.y + ICON_SIZE + 6 }
    : { left: pos.x + ICON_SIZE + 8, top: pos.y + ICON_SIZE + 6 };

  // Radial menu items — context aware
  const radialItems: { key: string; emoji: string; label: string; run: () => void }[] = [];
  if (isPdfTab) {
    // PDF tab → analyze the current page or the whole document
    radialItems.push({ key: 'pdfx', emoji: '📄', label: en ? 'Explain page' : 'ページ解説', run: () => { setRadialOpen(false); void sendQuickAction(en ? 'Explain the content of this PDF page clearly, in a way a beginner can follow.' : 'このPDFページの内容を、初学者にも分かるよう丁寧に解説して。', { attachPdf: true, heavy: true }); } });
    radialItems.push({ key: 'pdfwrite', emoji: '✍️', label: en ? 'AI markup' : 'AI書き込み', run: () => { setRadialOpen(false); void sendQuickAction(en ? 'Mark up the important parts of this PDF page with highlights, arrows and labels, and explain it clearly.' : 'このPDFページの重要箇所にハイライト・矢印・ラベルで書き込みをして、分かりやすく解説して。', { attachPdf: true, annotatePdf: true, heavy: true }); } });
    radialItems.push({ key: 'pdfall', emoji: '📚', label: en ? 'Explain all' : 'PDF全文解説', run: () => { setRadialOpen(false); void sendQuickAction(en ? 'Explain the whole PDF carefully, with section structure and key points.' : 'このPDF全体の内容を、章立て・ポイントを押さえて丁寧に解説して。', { attachPdfAll: true, heavy: true }); } });
    radialItems.push({ key: 'pdft', emoji: '🔤', label: en ? 'Translate' : '翻訳', run: () => { setRadialOpen(false); void sendQuickAction(en ? 'Translate this PDF page into English.' : 'このPDFページを日本語に翻訳して。', { attachPdf: true }); } });
  } else if (activeNoteId !== undefined) {
    // Memo open → memo actions (full content)
    radialItems.push({ key: 'sum', emoji: '📝', label: en ? 'Summary' : '要約', run: () => { setRadialOpen(false); void sendQuickAction(en ? 'Summarize this note clearly without missing the key points.' : 'このメモの内容を、要点を漏らさず分かりやすく要約して。', { fullNote: true, heavy: true }); } });
    radialItems.push({ key: 'todo', emoji: '✅', label: 'ToDo', run: () => { setRadialOpen(false); void sendQuickAction(en ? 'Extract the to-do items from this note as a bullet list. If there are none, say "No to-dos here".' : 'このメモから「やること(ToDo)」を箇条書きで抜き出して。無ければ「ToDoは無さそう」と答えて。', { fullNote: true }); } });
    radialItems.push({ key: 'qa', emoji: '🎲', label: en ? 'Random Q' : 'ランダム問題', run: () => void randomQA() });
    radialItems.push({ key: 'fullq', emoji: '🔍', label: en ? 'Quiz me' : '全文問題', run: () => void doFullTextQuiz() });
  }
  radialItems.push({ key: 'rec',  emoji: '📋', label: en ? 'Recent notes' : '最近のメモ',  run: () => void showRecentMemos() });
  if (pomodoroMs !== null) {
    radialItems.push({ key: 'pause', emoji: '⏸', label: en ? 'Pause' : '一時停止', run: () => { setRadialOpen(false); pausePomodoro(); setLastReply(en ? 'Timer paused. Say "resume" to continue.' : 'タイマーを一時停止したよ。「再開」で続けられる。'); setBubbleVisible(true); } });
    radialItems.push({ key: 'stop', emoji: '⏹', label: en ? 'Stop' : '終了', run: () => { setRadialOpen(false); cancelPomodoro(); setLastReply(en ? 'Timer stopped.' : 'タイマーを終了したよ。'); setBubbleVisible(true); } });
  } else if (pausedMs !== null) {
    radialItems.push({ key: 'resume', emoji: '▶', label: en ? 'Resume' : '再開', run: () => { setRadialOpen(false); resumePomodoro(); setLastReply(en ? 'Timer resumed!' : 'タイマーを再開したよ！'); setBubbleVisible(true); } });
    radialItems.push({ key: 'stop', emoji: '⏹', label: en ? 'Stop' : '終了', run: () => { setRadialOpen(false); cancelPomodoro(); setLastReply(en ? 'Timer stopped.' : 'タイマーを終了したよ。'); setBubbleVisible(true); } });
  } else {
    radialItems.push({ key: 'p30', emoji: '⏱', label: en ? '30 min' : '30分', run: () => { setRadialOpen(false); startPomodoro(30); setLastReply(en ? 'Started a 30-minute timer! Let\'s focus.' : '30分のタイマーを開始したよ！集中しよう。'); setBubbleVisible(true); } });
    radialItems.push({ key: 'p60', emoji: '⏰', label: en ? '60 min' : '60分', run: () => { setRadialOpen(false); startPomodoro(60); setLastReply(en ? 'Started a 60-minute timer! Let\'s focus.' : '60分のタイマーを開始したよ！集中しよう。'); setBubbleVisible(true); } });
  }
  radialItems.push({ key: 'prev', emoji: '⏮', label: en ? 'Prev note' : '前のメモ', run: jumpToPrevNote });

  const iconCx = pos.x + ICON_SIZE / 2;
  const iconCy = pos.y + ICON_SIZE / 2;
  const baseAngle = bubbleOnLeft ? 180 : 0;
  // Widen the arc and push out the radius as the item count grows so the
  // 56px buttons never overlap.
  const span = radialItems.length > 1 ? Math.min(220, radialItems.length * 36) : 0;
  const minRadius = ICON_SIZE / 2 + 54;
  const neededRadius = radialItems.length > 1
    ? (radialItems.length * 60) / (span * Math.PI / 180)
    : minRadius;
  const radius = Math.min(140, Math.max(minRadius, neededRadius));
  const radialPos = (i: number): React.CSSProperties => {
    const n = radialItems.length;
    const deg = baseAngle - span / 2 + (n > 1 ? span * (i / (n - 1)) : 0);
    const rad = (deg * Math.PI) / 180;
    return { left: iconCx + radius * Math.cos(rad) - 28, top: iconCy + radius * Math.sin(rad) - 28 };
  };

  const currentIcon = loading
    ? TYPING_FRAMES[typingFrame]
    : bookFrame !== null
      ? BOOK_FRAMES[bookFrame]
      : IDLE_ICON;

  return (
    <>
      <div
        className={`sikun-icon ${dragging ? 'dragging' : ''} ${loading ? 'typing' : ''} ${bookFrame !== null ? 'book' : ''}`}
        style={{ left: pos.x, top: pos.y }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          if (longPressTimer.current) window.clearTimeout(longPressTimer.current);
          pointerStart.current = null;
          setDragging(false);
        }}
        aria-label="sikun"
        title={en ? 'Tap to chat / Drag to move / Long-press for menu' : 'タップで話す / ドラッグで移動 / 長押しでメニュー'}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={currentIcon} alt="sikun" draggable={false} />

        {/* Selection badge: shows when memo text is selected, tap to explain */}
        {selectionBadge && !loading && (
          <span className="sikun-badge sikun-badge-sel" aria-hidden>?</span>
        )}

        {/* Pomodoro countdown badge (paused shows ⏸ + dimmed) */}
        {(pomodoroMs !== null || pausedMs !== null) && !loading && (
          <span className={`sikun-badge sikun-badge-timer ${pausedMs !== null ? 'paused' : ''}`} aria-hidden>
            {pausedMs !== null ? `⏸${formatMs(pausedMs)}` : formatMs(pomodoroMs!)}
          </span>
        )}
      </div>

      {radialOpen && (
        <>
          <div className="sikun-radial-backdrop" onPointerDown={() => setRadialOpen(false)} />
          {radialItems.map((it, i) => (
            <button key={it.key} className="sikun-radial-item" style={radialPos(i)} onClick={it.run}>
              <span className="sikun-radial-emoji">{it.emoji}</span>
              <span className="sikun-radial-label">{it.label}</span>
            </button>
          ))}
        </>
      )}

      {/* Preload all frames */}
      <div className="sikun-preload" aria-hidden>
        {[...new Set([...TYPING_FRAMES, ...BOOK_FRAMES, IDLE_ICON])].map(src => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={src} src={src} alt="" />
        ))}
      </div>

      {!loading && bubbleVisible && lastReply && (
        <div className="sikun-bubble" style={bubbleStyle} role="status">
          <button className="sikun-bubble-close" onClick={() => { setBubbleVisible(false); setPendingAnswer(''); setQuizMode(false); }} aria-label={en ? 'Close' : '閉じる'}>
            <X size={12} />
          </button>
          <div className="sikun-bubble-text" dangerouslySetInnerHTML={{ __html: renderRich(lastReply) }} />
          {(pendingAnswer || quizMode) && (
            <div className="sikun-quiz-actions">
              {pendingAnswer && (
                <button
                  className="sikun-answer-btn"
                  onClick={() => { setLastReply(`A: ${pendingAnswer}`); setPendingAnswer(''); }}
                >
                  {en ? 'Show answer' : '答えを見る'}
                </button>
              )}
              {quizMode && (
                <button
                  className="sikun-answer-btn outline"
                  onClick={() => void randomQA()}
                >
                  {en ? 'Next question →' : '次の問題 →'}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {mode === 'input' && (
        <div className="sikun-input-row" style={inputStyle}>
          <input
            ref={inputRef}
            className="sikun-input"
            placeholder={timeOfDayPlaceholder()}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); void sendMessage(); }
              if (e.key === 'Escape') closeInput();
            }}
            disabled={loading}
          />
          <button className="sikun-send" onClick={() => void sendMessage()} disabled={!input.trim() || loading} aria-label={en ? 'Send' : '送信'}>
            <Send size={14} />
          </button>
        </div>
      )}

      <style jsx>{`
        .sikun-icon {
          position: fixed;
          width: ${ICON_SIZE}px;
          height: ${ICON_SIZE}px;
          z-index: 10001;
          cursor: pointer;
          touch-action: none;
          user-select: none;
          opacity: 0.92;
          transition: opacity 0.15s, transform 0.15s, filter 0.15s;
          filter: drop-shadow(0 2px 4px rgba(0,0,0,0.18));
        }
        .sikun-icon:hover { opacity: 1; }
        .sikun-icon.dragging {
          opacity: 1;
          transform: scale(1.1);
          filter: drop-shadow(0 4px 10px rgba(0,0,0,0.3));
        }
        .sikun-icon.typing { opacity: 1; }
        .sikun-icon.book img {
          transform: scale(1.35);
          transform-origin: bottom center;
        }
        .sikun-icon img {
          width: 100%;
          height: 100%;
          object-fit: contain;
          pointer-events: none;
          user-select: none;
          -webkit-user-drag: none;
        }
        .sikun-badge {
          position: absolute;
          pointer-events: none;
          font-weight: 800;
          line-height: 1;
          border-radius: 999px;
          white-space: nowrap;
          box-shadow: 0 2px 6px rgba(0,0,0,0.25);
        }
        .sikun-badge-sel {
          top: -10px;
          left: 50%;
          transform: translateX(-50%);
          font-size: 14px;
          background: var(--primary, #6b46c1);
          color: #fff;
          width: 22px;
          height: 22px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 50%;
          animation: sikun-pop 0.25s ease-out both;
        }
        .sikun-badge-timer {
          bottom: -12px;
          left: 50%;
          transform: translateX(-50%);
          font-size: 10px;
          background: #e53e3e;
          color: #fff;
          padding: 2px 6px;
        }
        .sikun-badge-timer.paused {
          background: #718096;
        }
        @keyframes sikun-pop {
          from { opacity: 0; transform: translateX(-50%) scale(0.5); }
          to   { opacity: 1; transform: translateX(-50%) scale(1); }
        }
        .sikun-preload {
          position: fixed; width: 0; height: 0; overflow: hidden; opacity: 0; pointer-events: none;
        }
        .sikun-radial-backdrop {
          position: fixed; inset: 0; z-index: 10001;
        }
        .sikun-radial-item {
          position: fixed;
          width: 56px; height: 56px;
          border-radius: 50%;
          border: 1px solid var(--border, rgba(0,0,0,0.1));
          background: var(--background, #fff);
          box-shadow: 0 4px 14px rgba(0,0,0,0.2);
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          gap: 1px; cursor: pointer; z-index: 10002;
          animation: sikun-radial-pop 0.18s ease-out both;
        }
        @keyframes sikun-radial-pop {
          from { opacity: 0; transform: scale(0.4); }
          to   { opacity: 1; transform: scale(1); }
        }
        .sikun-radial-emoji { font-size: 19px; line-height: 1; }
        .sikun-radial-label { font-size: 0.58rem; font-weight: 700; color: var(--fg-muted, #555); line-height: 1; }
        .sikun-bubble {
          position: fixed;
          width: ${BUBBLE_W}px; max-width: calc(100vw - 24px); max-height: min(60vh, 420px); overflow-y: auto;
          background: var(--background, #fff); color: var(--foreground, #222);
          border: 1px solid var(--border, rgba(0,0,0,0.12)); border-radius: 14px;
          padding: 10px 26px 10px 12px; box-shadow: 0 6px 20px rgba(0,0,0,0.18);
          font-size: 0.86rem; line-height: 1.55; z-index: 10002;
          word-wrap: break-word; overflow-wrap: break-word;
        }
        .sikun-bubble-text { display: block; }
        .sikun-bubble-text :global(p) { margin: 0 0 6px; }
        .sikun-bubble-text :global(p:last-child) { margin-bottom: 0; }
        .sikun-bubble-text :global(strong) { font-weight: 700; color: var(--primary, #f06292); }
        .sikun-bubble-text :global(em) { font-style: italic; }
        .sikun-bubble-text :global(code) { background: var(--accent,#f5f5f5); border-radius: 4px; padding: 1px 4px; font-size: 0.82em; font-family: monospace; }
        .sikun-bubble-text :global(ul), .sikun-bubble-text :global(ol) { padding-left: 18px; margin: 4px 0; }
        .sikun-bubble-text :global(li) { margin-bottom: 2px; }
        .sikun-bubble-text :global(h1), .sikun-bubble-text :global(h2), .sikun-bubble-text :global(h3) { font-weight: 700; margin: 6px 0 4px; font-size: 0.95em; }
        .sikun-bubble-close {
          position: absolute; top: 4px; right: 4px;
          width: 20px; height: 20px; border-radius: 50%; border: none;
          background: var(--accent, #eee); color: var(--fg-muted, #666);
          display: flex; align-items: center; justify-content: center; cursor: pointer; padding: 0;
        }
        .sikun-quiz-actions {
          display: flex;
          gap: 6px;
          margin-top: 8px;
        }
        .sikun-answer-btn {
          flex: 1;
          padding: 6px 0;
          background: var(--primary, #6b46c1);
          color: #fff;
          border: none;
          border-radius: 8px;
          font-size: 0.8rem;
          font-weight: 700;
          cursor: pointer;
        }
        .sikun-answer-btn.outline {
          background: transparent;
          color: var(--primary, #6b46c1);
          border: 1.5px solid var(--primary, #6b46c1);
        }
        .sikun-input-row {
          position: fixed; display: flex; gap: 4px;
          width: ${BUBBLE_W}px; max-width: calc(100vw - 24px); z-index: 10002;
        }
        .sikun-input {
          flex: 1; padding: 8px 10px; border-radius: 18px;
          border: 1px solid var(--border, rgba(0,0,0,0.18));
          background: var(--background, #fff); color: var(--foreground, #222);
          font-family: inherit; font-size: 0.86rem; outline: none;
          box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }
        .sikun-input:focus { border-color: var(--primary, #6b46c1); }
        .sikun-send {
          width: 32px; height: 32px; border-radius: 50%;
          background: var(--primary, #6b46c1); color: white; border: none;
          display: flex; align-items: center; justify-content: center;
          cursor: pointer; box-shadow: 0 2px 6px rgba(0,0,0,0.15);
        }
        .sikun-send:disabled { opacity: 0.4; cursor: default; }
      `}</style>
    </>
  );
}
