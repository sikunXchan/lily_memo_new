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
}

const POS_KEY = 'lily_instance_sikun_pos';
const ICON_SIZE = 64;
const LONG_PRESS_MS = 450;
const TAP_MAX_MS = 300;
const TAP_MAX_MOVE = 6;
const BUBBLE_W = 260;

const INSTANCE_SIKUN_SYSTEM = `あなたは「Instance Sikun」、画面上に常駐するフローティング・キャラクター。
sikunlilyの軽量版で、ユーザーが作業中にちらっと質問する用途専用だ。

# 役割
- 短い質問への即答（1〜3文）
- アクティブメモの内容に対する簡単な質問への回答
- 直接的な事実回答や言い換え、簡単な要約のみ

# 絶対にやらないこと
- mermaid 図、QA ブロック、グラフ、スライド、図形などの構造化出力は一切作らない
- \`\`\`ask\`\`\` で聞き返さない（聞き返さずベストエフォートで答える）
- コードフェンス、Markdown見出し、箇条書きを使わない（プレーンテキスト3文以内が基本）
- 長文の解説や論文調の回答はしない
- 「次のアクション」「次のステップ」みたいなメタ説明をしない

# 複雑な依頼が来たら
「それは AI タブの sikunlily 本体に頼んでくれ」とひと言だけ返せ。
（例: 「マインドマップ作って」「クイズ作って」「グラフ書いて」「Deep Research して」など）

# 口調
sikunlily と同じ柴犬の武士口調（「〜だ」「〜ぞ」）。短く、キレよく。`;

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

export default function InstanceSikun({ activeNoteId }: InstanceSikunProps) {
  const [pos, setPos] = useState<Pos>(() => {
    const saved = loadPos();
    if (saved) return saved;
    if (typeof window === 'undefined') return { x: 16, y: 80 };
    return { x: window.innerWidth - ICON_SIZE - 12, y: 90 };
  });
  const [dragging, setDragging] = useState(false);
  // 'closed' = just icon. 'input' = inline input bar near icon. Bubble shows
  // automatically while a reply is loading or when user re-taps after a reply.
  const [mode, setMode] = useState<'closed' | 'input'>('closed');
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [lastReply, setLastReply] = useState<string>('');
  const [bubbleVisible, setBubbleVisible] = useState(false);
  const [history, setHistory] = useState<SikunMessage[]>([]);

  // Pre-fetch active note via live query so the context is ready
  // instantly when the user sends — no per-message DB round trip.
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

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    pointerStart.current = { x: e.clientX, y: e.clientY, ox: pos.x, oy: pos.y, ts: Date.now() };
    moved.current = false;
    if (longPressTimer.current) window.clearTimeout(longPressTimer.current);
    longPressTimer.current = window.setTimeout(() => setDragging(true), LONG_PRESS_MS);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointerStart.current) return;
    const dx = e.clientX - pointerStart.current.x;
    const dy = e.clientY - pointerStart.current.y;
    if (Math.abs(dx) > TAP_MAX_MOVE || Math.abs(dy) > TAP_MAX_MOVE) moved.current = true;
    if (dragging) {
      setPos(clampPos({ x: pointerStart.current.ox + dx, y: pointerStart.current.oy + dy }));
    }
  };

  const onPointerUp = () => {
    if (longPressTimer.current) { window.clearTimeout(longPressTimer.current); longPressTimer.current = null; }
    const start = pointerStart.current;
    pointerStart.current = null;
    if (!start) return;
    const elapsed = Date.now() - start.ts;
    if (dragging) { setDragging(false); persistPos(pos); return; }
    if (elapsed <= TAP_MAX_MS && !moved.current) {
      // Tap behavior:
      // - If there's a reply hidden, show it
      // - Otherwise toggle the inline input
      if (lastReply && !bubbleVisible && mode === 'closed') {
        setBubbleVisible(true);
      } else if (mode === 'closed') {
        setMode('input');
        setBubbleVisible(false);
      } else {
        setMode('closed');
      }
    }
  };

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || loading) return;
    const apiKey = localStorage.getItem('lily_gemini_api_key') || '';
    if (!apiKey) {
      setLastReply('設定で Gemini API キーを保存してくれ');
      setBubbleVisible(true);
      setMode('closed');
      return;
    }
    setInput('');
    setLoading(true);
    setBubbleVisible(true);
    setLastReply('考え中...');

    const userMsg: SikunMessage = { id: `u${Date.now()}`, role: 'user', text, ts: Date.now() };
    const nextHistory = [...history, userMsg];
    setHistory(nextHistory);

    // Use the already-fetched activeNote (no per-message DB round trip).
    let noteContext = '';
    if (activeNote) {
      const plain = (activeNote.content || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      noteContext = `\n\n# 現在ユーザーが開いているメモ\nタイトル: ${activeNote.title || '無題'}\n抜粋(先頭500文字): ${plain.slice(0, 500)}`;
    }

    try {
      const reply = await streamSikunlilyChat(
        toChatTurns(nextHistory),
        INSTANCE_SIKUN_SYSTEM + noteContext,
        apiKey,
        0, // no extended thinking — keep it snappy
      );
      // Strip any code fences / ask blocks the model might emit despite the
      // system prompt — Instance Sikun must always come through as plain text.
      const replyClean = reply
        .replace(/```[\s\S]*?```/g, '')
        .replace(/^#+\s*/gm, '')
        .trim() || '...';
      setLastReply(replyClean);
      const sikunMsg: SikunMessage = { id: `s${Date.now()}`, role: 'sikun', text: replyClean, ts: Date.now() };
      const finalHistory = [...nextHistory, sikunMsg];
      setHistory(finalHistory);
      saveSikunHistory(finalHistory);
      setMode('closed');
    } catch (err) {
      setLastReply(`エラー: ${err instanceof Error ? err.message : '失敗'}`);
    } finally {
      setLoading(false);
    }
  };

  // Place the bubble / input on whichever side has more room.
  const winW = typeof window !== 'undefined' ? window.innerWidth : 800;
  const bubbleOnLeft = pos.x + ICON_SIZE / 2 > winW / 2;
  const bubbleStyle: React.CSSProperties = bubbleOnLeft
    ? { right: winW - pos.x + 8, top: pos.y }
    : { left: pos.x + ICON_SIZE + 8, top: pos.y };

  const inputStyle: React.CSSProperties = bubbleOnLeft
    ? { right: winW - pos.x + 8, top: pos.y + ICON_SIZE + 6 }
    : { left: pos.x + ICON_SIZE + 8, top: pos.y + ICON_SIZE + 6 };

  return (
    <>
      <div
        className={`sikun-icon ${dragging ? 'dragging' : ''} ${loading ? 'thinking' : ''}`}
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
        title="タップで話しかける / 長押しで移動"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/sikun-character.png" alt="sikun" draggable={false} />
      </div>

      {bubbleVisible && lastReply && (
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
            placeholder="sikunに話す..."
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void sendMessage();
              }
              if (e.key === 'Escape') setMode('closed');
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
        .sikun-icon.thinking {
          animation: sikun-bob 0.8s ease-in-out infinite;
        }
        @keyframes sikun-bob {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-3px); }
        }
        .sikun-icon img {
          width: 100%;
          height: 100%;
          object-fit: contain;
          pointer-events: none;
          user-select: none;
          -webkit-user-drag: none;
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
