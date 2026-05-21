'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { X, Send } from 'lucide-react';
import { db } from '@/lib/db';
import { streamSikunlilyChat } from '@/lib/gemini';
import {
  loadSikunHistory, saveSikunHistory, toChatTurns,
  type SikunMessage,
} from '@/lib/sikunHistory';

interface InstanceSikunProps {
  activeNoteId?: number;
  prevNoteId?: number;
  onOpenNote?: (id: number) => void;
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
const IDLE_BLINK_MIN_MS = 22000;
const IDLE_BLINK_MAX_MS = 42000;

// Typing animation frames cycled while a reply is loading.
const TYPING_FRAMES = [
  '/sikun-type-both.png',
  '/sikun-type-right.png',
  '/sikun-type-left.png',
];
const TYPING_FRAME_MS = 170;
const IDLE_ICON = '/sikun-character.png';

// Book animation: plays once when user opens a memo.
// Order: open → read → hand on book → read → close
const BOOK_FRAMES = [
  '/sikun-book-open.png',
  '/sikun-book-read.png',
  '/sikun-book-hand.png',
  '/sikun-book-read.png',
  '/sikun-book-close.png',
];
const BOOK_FRAME_MS = 350;

const TONE_PROMPTS: Record<string, string> = {
  bushi: 'sikunlily と同じ柴犬の武士口調（「〜だ」「〜だぞ」「〜せよ」）。短く、キレよく。',
  keigo: '丁寧な敬語（「〜です」「〜ます」「〜でしょう」）。礼儀正しく、簡潔に。',
  tame: 'フランクなタメ口（「〜だよ」「〜じゃん」「〜してみて」）。友達みたいに気さくに。',
  casual: 'カジュアルでフレンドリー、絵文字も少しだけ使う（「〜だね！」「〜かも🐶」）。明るく簡潔に。',
};

function currentTonePrompt(): string {
  if (typeof window === 'undefined') return TONE_PROMPTS.bushi;
  return TONE_PROMPTS[localStorage.getItem(TONE_KEY) || 'bushi'] || TONE_PROMPTS.bushi;
}

function timeOfDayPlaceholder(): string {
  const h = new Date().getHours();
  if (h >= 5 && h < 11) return 'おはよう、何か聞きたいか？';
  if (h >= 11 && h < 17) return 'sikunに話す...';
  if (h >= 17 && h < 22) return 'お疲れさん。何か手伝うか？';
  return '夜更かしか？短く答えるぞ';
}

function formatMs(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const INSTANCE_SIKUN_SYSTEM = `あなたは「Instance Sikun」、画面上に常駐するフローティング・キャラクター。
sikunlilyの軽量版で、ユーザーが作業中にちらっと質問する用途専用だ。

# 役割
- 短い質問への即答（1〜3文）
- アクティブメモの内容に対する簡単な質問への回答
- 直接的な事実回答や言い換え、簡単な要約のみ

# 絶対にやらないこと
- mermaid 図、QA ブロック、グラフ、スライド、図形などの構造化出力は一切作らない
- \`\`\`ask\`\`\` で聞き返さない（聞き返さずベストエフォートで答える）
- コードフェンス、Markdown見出しは使わない（プレーンテキストが基本）
- 長文の解説や論文調の回答はしない
- 「次のアクション」「次のステップ」みたいなメタ説明をしない

# 複雑な依頼が来たら
「それは AI タブの sikunlily 本体に頼んでくれ」とひと言だけ返せ。
（例: 「マインドマップ作って」「クイズ作って」「グラフ書いて」「Deep Research して」など）

# 口調
__TONE__`;

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

export default function InstanceSikun({ activeNoteId, prevNoteId, onOpenNote }: InstanceSikunProps) {
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
  const [idleBlink, setIdleBlink] = useState(false);
  const [tapStreak, setTapStreak] = useState(0);
  const [typingFrame, setTypingFrame] = useState(0);
  const [bookFrame, setBookFrame] = useState<number | null>(null);
  const [selectionBadge, setSelectionBadge] = useState(false);
  const [selectedText, setSelectedText] = useState('');
  const [pomodoroMs, setPomodoroMs] = useState<number | null>(null);
  const [radialOpen, setRadialOpen] = useState(false);
  const lastTapAt = useRef<number>(0);
  const lastInteractionAt = useRef<number>(Date.now());
  const seenNoteIdRef = useRef<number | undefined>(undefined);
  const selectionBadgeTimer = useRef<number | null>(null);
  const pomodoroRef = useRef<number | null>(null);

  const activeNote = useLiveQuery(
    async () => (activeNoteId !== undefined ? await db.notes.get(activeNoteId) : undefined),
    [activeNoteId],
  );

  const pointerStart = useRef<{ x: number; y: number; ox: number; oy: number; ts: number } | null>(null);
  const moved = useRef(false);
  const longPressTimer = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setHistory(loadSikunHistory()); }, []);

  useEffect(() => {
    if (mode === 'input') {
      setTimeout(() => inputRef.current?.focus(), 30);
    }
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

  // Idle blink
  useEffect(() => {
    let timeoutId: number;
    const scheduleNext = () => {
      const delay = IDLE_BLINK_MIN_MS + Math.random() * (IDLE_BLINK_MAX_MS - IDLE_BLINK_MIN_MS);
      timeoutId = window.setTimeout(() => {
        const sinceInteraction = Date.now() - lastInteractionAt.current;
        if (sinceInteraction > IDLE_BLINK_MIN_MS && !loading && !dragging && mode === 'closed') {
          setIdleBlink(true);
          window.setTimeout(() => setIdleBlink(false), 380);
        }
        scheduleNext();
      }, delay);
    };
    scheduleNext();
    return () => window.clearTimeout(timeoutId);
  }, [loading, dragging, mode]);

  // Typing frame cycle while loading
  useEffect(() => {
    if (!loading) { setTypingFrame(0); return; }
    const id = window.setInterval(() => {
      setTypingFrame(f => (f + 1) % TYPING_FRAMES.length);
    }, TYPING_FRAME_MS);
    return () => window.clearInterval(id);
  }, [loading]);

  // Book animation: play once when user opens a memo
  useEffect(() => {
    if (activeNoteId === seenNoteIdRef.current) return;
    seenNoteIdRef.current = activeNoteId;
    if (activeNoteId === undefined) { setBookFrame(null); return; }
    setBookFrame(0);
    let f = 0;
    const id = window.setInterval(() => {
      f++;
      if (f < BOOK_FRAMES.length) {
        setBookFrame(f);
      } else {
        setBookFrame(null);
        window.clearInterval(id);
      }
    }, BOOK_FRAME_MS);
    return () => window.clearInterval(id);
  }, [activeNoteId]);

  // Listen for text selections to offer quick explanations
  useEffect(() => {
    const onSelection = () => {
      const sel = window.getSelection();
      const text = sel?.toString().trim() || '';
      if (text.length > 5) {
        setSelectedText(text);
        setSelectionBadge(true);
        if (selectionBadgeTimer.current) window.clearTimeout(selectionBadgeTimer.current);
        selectionBadgeTimer.current = window.setTimeout(() => {
          setSelectionBadge(false);
          setSelectedText('');
        }, 8000);
      }
    };
    document.addEventListener('selectionchange', onSelection);
    return () => {
      document.removeEventListener('selectionchange', onSelection);
      if (selectionBadgeTimer.current) window.clearTimeout(selectionBadgeTimer.current);
      if (pomodoroRef.current) window.clearInterval(pomodoroRef.current);
    };
  }, []);

  const startPomodoro = useCallback((minutes: number) => {
    if (pomodoroRef.current) window.clearInterval(pomodoroRef.current);
    const endTs = Date.now() + minutes * 60 * 1000;
    setPomodoroMs(endTs - Date.now());
    pomodoroRef.current = window.setInterval(() => {
      const remaining = endTs - Date.now();
      if (remaining <= 0) {
        if (pomodoroRef.current) { window.clearInterval(pomodoroRef.current); pomodoroRef.current = null; }
        setPomodoroMs(0);
        setLastReply(`${minutes}分経ったぞ！お疲れ、少し休んでよし。⚔️`);
        setBubbleVisible(true);
        if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
        window.setTimeout(() => setPomodoroMs(null), 4000);
      } else {
        setPomodoroMs(remaining);
      }
    }, 1000);
  }, []);

  const stopPomodoro = useCallback(() => {
    if (pomodoroRef.current) { window.clearInterval(pomodoroRef.current); pomodoroRef.current = null; }
    setPomodoroMs(null);
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
      lastInteractionAt.current = Date.now();
      return;
    }
    if (radialOpen) return;
    if (elapsed <= TAP_MAX_MS && !moved.current) {
      lastInteractionAt.current = Date.now();

      // Tapping while a selection badge is active → explain the selected text
      if (selectionBadge && selectedText) {
        setSelectionBadge(false);
        if (selectionBadgeTimer.current) window.clearTimeout(selectionBadgeTimer.current);
        setSelectedText('');
        void sendQuickAction(`次の文を短く解説してくれ:\n${selectedText.slice(0, 500)}`);
        return;
      }

      const now = Date.now();
      const since = now - lastTapAt.current;
      lastTapAt.current = now;

      // Double tap → summarise active memo
      if (since < DOUBLE_TAP_MS && activeNote) {
        setTapStreak(0);
        void sendQuickAction('このメモを3行で要約してくれ。');
        return;
      }

      // 5-tap easter egg
      const nextStreak = since < 500 ? tapStreak + 1 : 1;
      setTapStreak(nextStreak);
      if (nextStreak >= 5) {
        setTapStreak(0);
        setLastReply('くすぐったいぞ⚔️ そんなに連打されるとは思わなんだ。');
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

  const sendQuickAction = (presetText: string) => {
    setInput('');
    return doSend(presetText);
  };

  const jumpToPrevNote = useCallback(() => {
    setRadialOpen(false);
    if (prevNoteId !== undefined && onOpenNote) {
      onOpenNote(prevNoteId);
      setLastReply('さっきのメモを開いたぞ。');
      setBubbleVisible(true);
    } else {
      setLastReply('戻れるメモがまだ無いぞ。');
      setBubbleVisible(true);
    }
  }, [prevNoteId, onOpenNote]);

  const sendMessage = () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');

    // Natural-language: jump to previous memo
    if (/(前|さっき|戻)(の)?メモ|メモ.*(戻|に戻)/.test(text) || /^(戻る|戻って)$/.test(text)) {
      closeInput();
      jumpToPrevNote();
      return;
    }

    // Pomodoro: stop
    if (pomodoroMs !== null && /(止め|ストップ|キャンセル|stop)/i.test(text)) {
      closeInput();
      stopPomodoro();
      setLastReply('タイマーを止めたぞ。');
      setBubbleVisible(true);
      return;
    }

    // Pomodoro: start (e.g. "25分タイマー", "ポモドーロ", "15分ポモドーロ")
    const pomMatch = text.match(/(\d+)\s*分.*(タイマー|ポモドーロ)|(タイマー|ポモドーロ).*(\d+)\s*分|^ポモドーロ$/);
    if (pomMatch) {
      closeInput();
      const mins = parseInt(pomMatch[1] || pomMatch[4] || '25', 10);
      startPomodoro(mins);
      setLastReply(`${mins}分のタイマーを開始したぞ！集中せよ⚔️`);
      setBubbleVisible(true);
      return;
    }

    return doSend(text);
  };

  const doSend = async (text: string) => {
    if (!text || loading) return;
    const apiKey = localStorage.getItem('lily_gemini_api_key') || '';
    if (!apiKey) {
      setLastReply('設定で Gemini API キーを保存してくれ');
      setBubbleVisible(true);
      setMode('closed');
      return;
    }
    closeInput();
    lastInteractionAt.current = Date.now();
    setLoading(true);
    setBubbleVisible(false);
    setLastReply('');

    const userMsg: SikunMessage = { id: `u${Date.now()}`, role: 'user', text, ts: Date.now() };
    const nextHistory = [...history, userMsg];
    setHistory(nextHistory);

    let noteContext = '';
    if (activeNote) {
      const plain = (activeNote.content || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      noteContext = `\n\n# 現在ユーザーが開いているメモ\nタイトル: ${activeNote.title || '無題'}\n抜粋(先頭500文字): ${plain.slice(0, 500)}`;
    }

    try {
      const systemPrompt = INSTANCE_SIKUN_SYSTEM.replace('__TONE__', currentTonePrompt()) + noteContext;
      const reply = await streamSikunlilyChat(
        toChatTurns(nextHistory),
        systemPrompt,
        apiKey,
        0,
      );
      const replyClean = reply
        .replace(/```[\s\S]*?```/g, '')
        .replace(/^#+\s*/gm, '')
        .trim() || '...';
      setLastReply(replyClean);
      setBubbleVisible(true);
      const sikunMsg: SikunMessage = { id: `s${Date.now()}`, role: 'sikun', text: replyClean, ts: Date.now() };
      const finalHistory = [...nextHistory, sikunMsg];
      setHistory(finalHistory);
      saveSikunHistory(finalHistory);
      setMode('closed');
    } catch (err) {
      setLastReply(`エラー: ${err instanceof Error ? err.message : '失敗'}`);
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

  const radialItems: { key: string; emoji: string; label: string; run: () => void }[] = [];
  if (activeNote) {
    radialItems.push({ key: 'sum', emoji: '📝', label: '要約', run: () => { setRadialOpen(false); void sendQuickAction('このメモを3行で要約してくれ。'); } });
    radialItems.push({ key: 'tr', emoji: '🌐', label: '翻訳', run: () => { setRadialOpen(false); void sendQuickAction('このメモを自然な英語に翻訳してくれ。'); } });
    radialItems.push({ key: 'todo', emoji: '✅', label: 'ToDo', run: () => { setRadialOpen(false); void sendQuickAction('このメモからやること（ToDo）を短く抜き出してくれ。'); } });
  }
  radialItems.push({ key: 'pom', emoji: '⏱', label: 'ポモドーロ', run: () => { setRadialOpen(false); startPomodoro(25); setLastReply('25分のタイマーを開始したぞ！集中せよ⚔️'); setBubbleVisible(true); } });
  radialItems.push({ key: 'prev', emoji: '⏮', label: '前のメモ', run: jumpToPrevNote });

  const iconCx = pos.x + ICON_SIZE / 2;
  const iconCy = pos.y + ICON_SIZE / 2;
  const radius = ICON_SIZE / 2 + 52;
  const baseAngle = bubbleOnLeft ? 180 : 0;
  const span = radialItems.length > 1 ? 160 : 0;
  const radialPos = (i: number): React.CSSProperties => {
    const n = radialItems.length;
    const deg = baseAngle - span / 2 + (n > 1 ? span * (i / (n - 1)) : 0);
    const rad = (deg * Math.PI) / 180;
    const cx = iconCx + radius * Math.cos(rad);
    const cy = iconCy + radius * Math.sin(rad);
    return { left: cx - 28, top: cy - 28 };
  };

  const currentIcon = loading
    ? TYPING_FRAMES[typingFrame]
    : bookFrame !== null
      ? BOOK_FRAMES[bookFrame]
      : IDLE_ICON;

  return (
    <>
      <div
        className={`sikun-icon ${dragging ? 'dragging' : ''} ${loading ? 'typing' : ''} ${idleBlink ? 'blink' : ''}`}
        style={{ left: pos.x, top: pos.y }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          if (longPressTimer.current) window.clearTimeout(longPressTimer.current);
          pointerStart.current = null;
          setDragging(false);
        }}
        aria-label="Instance Sikun"
        title="タップで話す / ドラッグで移動 / 長押しでメニュー"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={currentIcon} alt="sikun" draggable={false} />

        {/* Selection badge: tap sikun while text is selected to explain it */}
        {selectionBadge && !loading && (
          <span className="sikun-badge sikun-badge-selection" aria-hidden>?</span>
        )}

        {/* Pomodoro timer badge */}
        {pomodoroMs !== null && !loading && (
          <span className="sikun-badge sikun-badge-timer" aria-hidden>
            {formatMs(pomodoroMs)}
          </span>
        )}
      </div>

      {radialOpen && (
        <>
          <div className="sikun-radial-backdrop" onPointerDown={() => setRadialOpen(false)} />
          {radialItems.map((it, i) => (
            <button
              key={it.key}
              className="sikun-radial-item"
              style={radialPos(i)}
              onClick={it.run}
            >
              <span className="sikun-radial-emoji">{it.emoji}</span>
              <span className="sikun-radial-label">{it.label}</span>
            </button>
          ))}
        </>
      )}

      {/* Preload all animated frames */}
      <div className="sikun-preload" aria-hidden>
        {[...new Set([...TYPING_FRAMES, ...BOOK_FRAMES, IDLE_ICON])].map(src => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={src} src={src} alt="" />
        ))}
      </div>

      {!loading && bubbleVisible && lastReply && (
        <div className="sikun-bubble" style={bubbleStyle} role="status">
          <button className="sikun-bubble-close" onClick={() => setBubbleVisible(false)} aria-label="閉じる">
            <X size={12} />
          </button>
          <div className="sikun-bubble-text">{lastReply}</div>
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
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void sendMessage();
              }
              if (e.key === 'Escape') closeInput();
            }}
            disabled={loading}
          />
          <button
            className="sikun-send"
            onClick={() => void sendMessage()}
            disabled={!input.trim() || loading}
            aria-label="送信"
          >
            <Send size={14} />
          </button>
        </div>
      )}

      <style jsx>{`
        .sikun-icon {
          position: fixed;
          width: ${ICON_SIZE}px;
          height: ${ICON_SIZE}px;
          z-index: 9999;
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
        .sikun-icon.blink {
          animation: sikun-blink 0.38s ease-in-out;
        }
        @keyframes sikun-blink {
          0%, 100% { transform: scaleY(1); }
          50% { transform: scaleY(0.6); }
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
        .sikun-badge-selection {
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
          animation: sikun-ping 0.3s ease-out both;
        }
        .sikun-badge-timer {
          bottom: -12px;
          left: 50%;
          transform: translateX(-50%);
          font-size: 10px;
          background: #e53e3e;
          color: #fff;
          padding: 2px 6px;
          border-radius: 999px;
        }
        @keyframes sikun-ping {
          from { opacity: 0; transform: translateX(-50%) scale(0.5); }
          to   { opacity: 1; transform: translateX(-50%) scale(1); }
        }

        .sikun-preload {
          position: fixed;
          width: 0;
          height: 0;
          overflow: hidden;
          opacity: 0;
          pointer-events: none;
        }

        .sikun-radial-backdrop {
          position: fixed;
          inset: 0;
          z-index: 9997;
        }
        .sikun-radial-item {
          position: fixed;
          width: 56px;
          height: 56px;
          border-radius: 50%;
          border: 1px solid var(--border, rgba(0,0,0,0.1));
          background: var(--background, #fff);
          box-shadow: 0 4px 14px rgba(0,0,0,0.2);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 1px;
          cursor: pointer;
          z-index: 9999;
          animation: sikun-radial-pop 0.18s ease-out both;
        }
        @keyframes sikun-radial-pop {
          from { opacity: 0; transform: scale(0.4); }
          to { opacity: 1; transform: scale(1); }
        }
        .sikun-radial-emoji { font-size: 19px; line-height: 1; }
        .sikun-radial-label {
          font-size: 0.58rem;
          font-weight: 700;
          color: var(--fg-muted, #555);
          line-height: 1;
        }

        .sikun-bubble {
          position: fixed;
          width: ${BUBBLE_W}px;
          max-width: calc(100vw - 24px);
          max-height: 220px;
          overflow-y: auto;
          background: var(--background, #fff);
          color: var(--foreground, #222);
          border: 1px solid var(--border, rgba(0,0,0,0.12));
          border-radius: 14px;
          padding: 10px 26px 10px 12px;
          box-shadow: 0 6px 20px rgba(0,0,0,0.18);
          font-size: 0.86rem;
          line-height: 1.55;
          z-index: 9998;
          white-space: pre-wrap;
          word-wrap: break-word;
        }
        .sikun-bubble-close {
          position: absolute;
          top: 4px;
          right: 4px;
          width: 20px;
          height: 20px;
          border-radius: 50%;
          border: none;
          background: var(--accent, #eee);
          color: var(--fg-muted, #666);
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          padding: 0;
        }
        .sikun-bubble-text { display: block; }

        .sikun-input-row {
          position: fixed;
          display: flex;
          gap: 4px;
          width: ${BUBBLE_W}px;
          max-width: calc(100vw - 24px);
          z-index: 9999;
        }
        .sikun-input {
          flex: 1;
          padding: 8px 10px;
          border-radius: 18px;
          border: 1px solid var(--border, rgba(0,0,0,0.18));
          background: var(--background, #fff);
          color: var(--foreground, #222);
          font-family: inherit;
          font-size: 0.86rem;
          outline: none;
          box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }
        .sikun-input:focus { border-color: var(--primary, #6b46c1); }
        .sikun-send {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          background: var(--primary, #6b46c1);
          color: white;
          border: none;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          box-shadow: 0 2px 6px rgba(0,0,0,0.15);
        }
        .sikun-send:disabled { opacity: 0.4; cursor: default; }
      `}</style>
    </>
  );
}
