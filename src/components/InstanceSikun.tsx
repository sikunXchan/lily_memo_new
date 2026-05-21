'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { X, Send, Trash2 } from 'lucide-react';
import { db } from '@/lib/db';
import { streamSikunlilyChat, SIKUNLILY_CHAT_SYSTEM_PROMPT } from '@/lib/gemini';
import {
  loadSikunHistory, saveSikunHistory, clearSikunHistory, toChatTurns,
  type SikunMessage,
} from '@/lib/sikunHistory';

interface InstanceSikunProps {
  activeNoteId?: number;
}

const POS_KEY = 'lily_instance_sikun_pos';
const ICON_SIZE = 56;
const LONG_PRESS_MS = 450;
const TAP_MAX_MS = 300;
const TAP_MAX_MOVE = 6;

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
    return { x: window.innerWidth - ICON_SIZE - 16, y: 80 };
  });
  const [dragging, setDragging] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [messages, setMessages] = useState<SikunMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  // pointer drag state held in refs so we don't trigger re-renders on move
  const pointerStart = useRef<{ x: number; y: number; ox: number; oy: number; ts: number } | null>(null);
  const moved = useRef(false);
  const longPressTimer = useRef<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMessages(loadSikunHistory());
  }, []);

  useEffect(() => {
    if (panelOpen) {
      const t = setTimeout(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
      }, 50);
      return () => clearTimeout(t);
    }
  }, [panelOpen, messages]);

  useEffect(() => {
    const handleResize = () => setPos(p => clampPos(p));
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const persistPos = useCallback((p: Pos) => {
    try { localStorage.setItem(POS_KEY, JSON.stringify(p)); } catch {}
  }, []);

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    pointerStart.current = { x: e.clientX, y: e.clientY, ox: pos.x, oy: pos.y, ts: Date.now() };
    moved.current = false;
    if (longPressTimer.current) window.clearTimeout(longPressTimer.current);
    longPressTimer.current = window.setTimeout(() => {
      setDragging(true);
    }, LONG_PRESS_MS);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!pointerStart.current) return;
    const dx = e.clientX - pointerStart.current.x;
    const dy = e.clientY - pointerStart.current.y;
    if (Math.abs(dx) > TAP_MAX_MOVE || Math.abs(dy) > TAP_MAX_MOVE) {
      moved.current = true;
    }
    if (dragging) {
      setPos(clampPos({
        x: pointerStart.current.ox + dx,
        y: pointerStart.current.oy + dy,
      }));
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (longPressTimer.current) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    const start = pointerStart.current;
    pointerStart.current = null;
    if (!start) return;
    const elapsed = Date.now() - start.ts;
    if (dragging) {
      setDragging(false);
      persistPos(pos);
      e.preventDefault();
      return;
    }
    // Tap: short press, no significant movement
    if (elapsed <= TAP_MAX_MS && !moved.current) {
      setPanelOpen(p => !p);
    }
  };

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || loading) return;
    const apiKey = localStorage.getItem('lily_gemini_api_key') || '';
    if (!apiKey) {
      alert('設定で Gemini API キーを保存してね');
      return;
    }
    setInput('');
    const userMsg: SikunMessage = { id: `u${Date.now()}`, role: 'user', text, ts: Date.now() };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setLoading(true);

    // Inject current-note context into the system prompt so "このメモ" works.
    let noteContext = '';
    if (activeNoteId !== undefined) {
      try {
        const note = await db.notes.get(activeNoteId);
        if (note) {
          const plain = (note.content || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          noteContext = `\n\n## 現在ユーザーが開いているメモ\n- タイトル: ${note.title || '無題'}\n- 抜粋(先頭400文字): ${plain.slice(0, 400)}`;
        }
      } catch { /* ignore */ }
    }
    const systemPrompt = `${SIKUNLILY_CHAT_SYSTEM_PROMPT}

あなたは今、画面に常駐するフローティング・アシスタント「Instance Sikun」として動作している。
ユーザーは作業中に短い質問や依頼をしてくる。回答は簡潔（基本3〜6文）に。
コードブロックや図は必要時のみ使用し、長文の解説は避ける。${noteContext}`;

    try {
      const reply = await streamSikunlilyChat(
        toChatTurns(nextMessages),
        systemPrompt,
        apiKey,
        4096,
      );
      const sikunMsg: SikunMessage = {
        id: `s${Date.now()}`,
        role: 'sikun',
        text: reply,
        ts: Date.now(),
      };
      const finalMessages = [...nextMessages, sikunMsg];
      setMessages(finalMessages);
      saveSikunHistory(finalMessages);
    } catch (err) {
      const errorMsg: SikunMessage = {
        id: `e${Date.now()}`,
        role: 'sikun',
        text: `エラー: ${err instanceof Error ? err.message : '失敗'}`,
        ts: Date.now(),
      };
      const finalMessages = [...nextMessages, errorMsg];
      setMessages(finalMessages);
      saveSikunHistory(finalMessages);
    } finally {
      setLoading(false);
    }
  };

  const handleClear = () => {
    if (!confirm('Instance Sikun の会話履歴を全部消すよ？')) return;
    setMessages([]);
    clearSikunHistory();
  };

  return (
    <>
      <button
        className={`sikun-icon ${dragging ? 'dragging' : ''}`}
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
        title="Instance Sikun（長押しで移動 / タップで対話）"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/sikun-character.png" alt="sikun" draggable={false} />
      </button>

      {panelOpen && (
        <div className="sikun-panel" role="dialog" aria-label="Instance Sikun chat">
          <div className="sikun-panel-header">
            <span className="sikun-panel-title">Instance Sikun</span>
            <button className="sikun-icon-btn" onClick={handleClear} title="履歴を消す">
              <Trash2 size={16} />
            </button>
            <button className="sikun-icon-btn" onClick={() => setPanelOpen(false)} title="閉じる">
              <X size={18} />
            </button>
          </div>

          <div className="sikun-messages" ref={scrollRef}>
            {messages.length === 0 && (
              <div className="sikun-empty">
                やあ、Instance Sikun だ⚔️<br />
                作業中でも気軽に話しかけてくれ。<br />
                「このメモ要約して」とかどうだ？
              </div>
            )}
            {messages.map(m => (
              <div key={m.id} className={`sikun-msg ${m.role}`}>
                {m.text}
              </div>
            ))}
            {loading && <div className="sikun-msg sikun loading">考え中...</div>}
          </div>

          <div className="sikun-input-row">
            <textarea
              className="sikun-input"
              placeholder="sikunに話しかける..."
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void sendMessage();
                }
              }}
              rows={1}
              disabled={loading}
            />
            <button
              className="sikun-send"
              onClick={() => void sendMessage()}
              disabled={!input.trim() || loading}
              aria-label="送信"
            >
              <Send size={16} />
            </button>
          </div>
        </div>
      )}

      <style jsx>{`
        .sikun-icon {
          position: fixed;
          width: ${ICON_SIZE}px;
          height: ${ICON_SIZE}px;
          border-radius: 50%;
          border: 2px solid var(--primary, #6b46c1);
          background: var(--background, #fff);
          padding: 0;
          overflow: hidden;
          z-index: 9999;
          opacity: 0.88;
          box-shadow: 0 4px 16px rgba(0,0,0,0.18);
          cursor: pointer;
          touch-action: none;
          transition: opacity 0.15s, transform 0.15s, box-shadow 0.15s;
        }
        .sikun-icon:hover { opacity: 1; }
        .sikun-icon.dragging {
          opacity: 1;
          transform: scale(1.08);
          box-shadow: 0 6px 22px rgba(0,0,0,0.32);
        }
        .sikun-icon img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          pointer-events: none;
          user-select: none;
        }

        .sikun-panel {
          position: fixed;
          right: 12px;
          bottom: 80px;
          width: min(360px, calc(100vw - 24px));
          height: min(520px, calc(100vh - 120px));
          background: var(--background, #fff);
          border: 1px solid var(--border, rgba(0,0,0,0.12));
          border-radius: 16px;
          box-shadow: 0 12px 40px rgba(0,0,0,0.22);
          display: flex;
          flex-direction: column;
          overflow: hidden;
          z-index: 9998;
        }
        .sikun-panel-header {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 12px;
          background: var(--accent, #f4f1ff);
          border-bottom: 1px solid var(--border, rgba(0,0,0,0.08));
        }
        .sikun-panel-title {
          flex: 1;
          font-weight: 700;
          font-size: 0.92rem;
          color: var(--primary, #6b46c1);
        }
        .sikun-icon-btn {
          background: transparent;
          border: none;
          color: var(--fg-muted, #666);
          cursor: pointer;
          padding: 4px;
          display: flex;
          align-items: center;
          border-radius: 6px;
        }
        .sikun-icon-btn:hover { background: var(--border, rgba(0,0,0,0.06)); color: var(--primary, #6b46c1); }

        .sikun-messages {
          flex: 1;
          overflow-y: auto;
          padding: 12px;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .sikun-empty {
          color: var(--fg-muted, #666);
          font-size: 0.85rem;
          line-height: 1.6;
          text-align: center;
          padding: 30px 12px;
        }
        .sikun-msg {
          font-size: 0.88rem;
          line-height: 1.55;
          padding: 8px 12px;
          border-radius: 12px;
          max-width: 92%;
          white-space: pre-wrap;
          word-wrap: break-word;
        }
        .sikun-msg.user {
          align-self: flex-end;
          background: var(--primary, #6b46c1);
          color: white;
        }
        .sikun-msg.sikun {
          align-self: flex-start;
          background: var(--accent, #f4f1ff);
          color: var(--foreground, #222);
        }
        .sikun-msg.loading { opacity: 0.65; font-style: italic; }

        .sikun-input-row {
          display: flex;
          gap: 6px;
          padding: 10px;
          border-top: 1px solid var(--border, rgba(0,0,0,0.08));
          background: var(--background, #fff);
        }
        .sikun-input {
          flex: 1;
          resize: none;
          min-height: 34px;
          max-height: 100px;
          padding: 8px 10px;
          border-radius: 10px;
          border: 1px solid var(--border, rgba(0,0,0,0.12));
          background: var(--accent, #f4f1ff);
          color: var(--foreground, #222);
          font-family: inherit;
          font-size: 0.88rem;
          outline: none;
        }
        .sikun-input:focus { border-color: var(--primary, #6b46c1); }
        .sikun-send {
          width: 36px;
          height: 36px;
          border-radius: 10px;
          background: var(--primary, #6b46c1);
          color: white;
          border: none;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
        }
        .sikun-send:disabled { opacity: 0.4; cursor: default; }
      `}</style>
    </>
  );
}
