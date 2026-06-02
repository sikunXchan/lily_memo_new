'use client';

import { useState, useRef, useCallback } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, Plus, Pin, Check, Trash2 } from 'lucide-react';
import { db } from '@/lib/db';
import type { Todo } from '@/lib/db';

interface TodoScreenProps {
  onGoBack: () => void;
}

export default function TodoScreen({ onGoBack }: TodoScreenProps) {
  const [newText, setNewText] = useState('');
  const [swipedId, setSwipedId] = useState<number | null>(null);
  const touchStartX = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const todos = useLiveQuery<Todo[]>(() =>
    db.todos.orderBy('createdAt').toArray().then(list =>
      list.sort((a, b) => {
        if (a.done !== b.done) return a.done ? 1 : -1;
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return b.createdAt - a.createdAt;
      })
    )
  ) ?? [];

  const addTodo = useCallback(async () => {
    const text = newText.trim();
    if (!text) return;
    await db.todos.add({ text, done: false, pinned: false, createdAt: Date.now() });
    setNewText('');
  }, [newText]);

  const toggleDone  = useCallback(async (t: Todo) => { await db.todos.update(t.id!, { done:   !t.done   }); }, []);
  const togglePin   = useCallback(async (t: Todo) => { await db.todos.update(t.id!, { pinned: !t.pinned }); }, []);
  const deleteTodo  = useCallback(async (id: number) => { await db.todos.delete(id); setSwipedId(null); }, []);

  const pending = todos.filter(t => !t.done);
  const done    = todos.filter(t => t.done);

  const renderItem = (t: Todo) => {
    const isSwiped = swipedId === t.id;
    return (
      <div key={t.id} className="td-item">
        {/* ── Delete panel (sits behind the card) ── */}
        <button
          className="td-del"
          onClick={() => void deleteTodo(t.id!)}
          tabIndex={isSwiped ? 0 : -1}
          aria-label="削除"
        >
          <Trash2 size={20} strokeWidth={2} />
          <span>削除</span>
        </button>

        {/* ── Main card ── */}
        <div
          className={`td-card${isSwiped ? ' slid' : ''}${t.done ? ' done' : ''}${t.pinned ? ' pinned-card' : ''}`}
          onTouchStart={e => { touchStartX.current = e.touches[0].clientX; }}
          onTouchEnd={e => {
            const dx = touchStartX.current - e.changedTouches[0].clientX;
            if (dx > 42)  setSwipedId(t.id!);
            else if (dx < -16) setSwipedId(null);
          }}
          onClick={() => { if (isSwiped) setSwipedId(null); }}
        >
          {/* Check */}
          <button
            className={`td-check${t.done ? ' checked' : ''}`}
            onClick={e => { e.stopPropagation(); void toggleDone(t); }}
            aria-label={t.done ? '未完了に戻す' : '完了にする'}
          >
            {t.done && <Check size={13} strokeWidth={3} />}
          </button>

          {/* Text */}
          <span className="td-text">{t.text}</span>

          {/* Pin */}
          <button
            className={`td-pin${t.pinned ? ' on' : ''}`}
            onClick={e => { e.stopPropagation(); void togglePin(t); }}
            aria-label={t.pinned ? 'ピン解除' : 'ピン留め'}
          >
            <Pin size={14} strokeWidth={2.2} />
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="td-root">
      {/* Header */}
      <div className="td-header">
        <button className="td-back" onClick={onGoBack} aria-label="戻る">
          <ArrowLeft size={18} strokeWidth={2.4} />
        </button>
        <span className="td-title">ToDo</span>
        {pending.length > 0 && (
          <span className="td-badge">{pending.length}</span>
        )}
      </div>

      {/* Add row */}
      <div className="td-add-row">
        <input
          ref={inputRef}
          className="td-input"
          placeholder="新しいタスクを追加..."
          value={newText}
          onChange={e => setNewText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') void addTodo(); }}
        />
        <button
          className="td-add-btn"
          onClick={() => void addTodo()}
          disabled={!newText.trim()}
          aria-label="追加"
        >
          <Plus size={18} strokeWidth={2.6} />
        </button>
      </div>

      {/* List */}
      <div className="td-scroll">
        {todos.length === 0 && (
          <div className="td-empty">
            <span className="td-empty-icon">✅</span>
            <p>タスクはまだありません</p>
            <p className="td-empty-sub">上の入力欄から追加してね</p>
          </div>
        )}

        {pending.length > 0 && (
          <section className="td-section">
            <div className="td-section-label">
              <span className="td-section-dot pending" />
              未完了
              <span className="td-section-count">{pending.length}</span>
            </div>
            {pending.map(renderItem)}
          </section>
        )}

        {done.length > 0 && (
          <section className="td-section">
            <div className="td-section-label">
              <span className="td-section-dot done" />
              完了
              <span className="td-section-count">{done.length}</span>
            </div>
            {done.map(renderItem)}
          </section>
        )}
      </div>

      <style jsx>{`
        /* ── Root ── */
        .td-root {
          flex: 1; display: flex; flex-direction: column;
          background: var(--background); overflow: hidden;
        }

        /* ── Header ── */
        .td-header {
          display: flex; align-items: center; gap: 12px;
          padding: 14px 16px 12px;
          border-bottom: 1px solid var(--border);
          background: var(--background); flex-shrink: 0;
        }
        .td-back {
          width: 36px; height: 36px; border-radius: 50%;
          border: 1.5px solid var(--border); background: var(--accent);
          display: flex; align-items: center; justify-content: center;
          cursor: pointer; color: var(--foreground); flex-shrink: 0;
          transition: background .15s;
        }
        .td-back:active { background: var(--border); }
        .td-title {
          font-size: 22px; font-weight: 800; flex: 1; letter-spacing: -.02em;
          background: linear-gradient(120deg, #34d399, #22d3ee);
          -webkit-background-clip: text; background-clip: text; color: transparent;
        }
        .td-badge {
          min-width: 26px; height: 26px; border-radius: 99px;
          background: linear-gradient(135deg, #34d399, #22d3ee);
          color: #fff; font-size: 0.75rem; font-weight: 800;
          display: flex; align-items: center; justify-content: center;
          padding: 0 7px;
        }

        /* ── Add row ── */
        .td-add-row {
          display: flex; align-items: center; gap: 10px;
          padding: 12px 16px;
          border-bottom: 1px solid var(--border); flex-shrink: 0;
        }
        .td-input {
          flex: 1; background: var(--accent);
          border: 1.5px solid var(--border); border-radius: 22px;
          padding: 10px 16px; font-size: 0.9rem;
          color: var(--foreground); outline: none; font-family: inherit;
          transition: border-color .15s;
        }
        .td-input::placeholder { color: var(--fg-faint); }
        .td-input:focus { border-color: #34d399; }
        .td-add-btn {
          width: 42px; height: 42px; border-radius: 50%; border: none; flex-shrink: 0;
          background: linear-gradient(135deg, #34d399, #22d3ee); color: #fff;
          display: flex; align-items: center; justify-content: center;
          cursor: pointer; transition: opacity .15s, transform .12s;
          box-shadow: 0 3px 10px rgba(52,211,153,.4);
        }
        .td-add-btn:disabled { opacity: .3; cursor: default; box-shadow: none; }
        .td-add-btn:not(:disabled):active { transform: scale(.9); }

        /* ── Scroll area ── */
        .td-scroll {
          flex: 1; overflow-y: auto; padding: 12px 14px 40px;
          -webkit-overflow-scrolling: touch;
        }

        /* ── Empty ── */
        .td-empty {
          display: flex; flex-direction: column; align-items: center;
          padding: 56px 0 0; gap: 6px; text-align: center;
        }
        .td-empty-icon { font-size: 2.2rem; }
        .td-empty p { font-size: 0.9rem; color: var(--fg-muted); font-weight: 600; margin: 0; }
        .td-empty-sub { font-size: 0.78rem; color: var(--fg-faint) !important; font-weight: 400 !important; }

        /* ── Section ── */
        .td-section { margin-bottom: 16px; }
        .td-section-label {
          display: flex; align-items: center; gap: 6px;
          font-size: 0.72rem; font-weight: 700; letter-spacing: .1em;
          text-transform: uppercase; color: var(--fg-muted);
          padding: 0 4px 8px;
        }
        .td-section-dot {
          width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0;
        }
        .td-section-dot.pending { background: #34d399; }
        .td-section-dot.done    { background: var(--fg-faint); }
        .td-section-count {
          margin-left: auto;
          background: var(--accent); border: 1px solid var(--border);
          border-radius: 99px; padding: 1px 8px;
          font-size: 0.68rem; color: var(--fg-faint);
        }

        /* ── Swipe item ──
           .td-item: overflow:hidden + border-radius clips both layers.
           .td-del:  absolute, right side, always behind .td-card (z-index).
           .td-card: NO border-radius so its opaque background fully
                     covers .td-del. Only the wrapper clips to rounded corners.
        ── */
        .td-item {
          position: relative;
          overflow: hidden;
          border-radius: 16px;
          margin-bottom: 7px;
          /* Shadow on the wrapper is visible around the card */
          box-shadow: 0 2px 8px rgba(0,0,0,.06);
        }

        /* Delete panel */
        .td-del {
          position: absolute; right: 0; top: 0; bottom: 0; width: 84px;
          background: linear-gradient(135deg, #f87171 0%, #ef4444 100%);
          border: none; color: #fff; cursor: pointer;
          display: flex; flex-direction: column; align-items: center;
          justify-content: center; gap: 4px;
          font-size: 0.65rem; font-weight: 800; letter-spacing: .06em;
          z-index: 0;
        }
        .td-del:active { background: #dc2626; }

        /* Card — NO border-radius so its rect background covers the delete panel */
        .td-card {
          position: relative; z-index: 1;
          display: flex; align-items: center; gap: 12px;
          padding: 13px 12px 13px 14px;
          background: var(--accent);
          border: 1px solid var(--border);
          transition: transform .24s cubic-bezier(.25,.46,.45,.94);
          user-select: none; -webkit-user-select: none;
        }
        .td-card.slid { transform: translateX(-84px); }
        .td-card.done { opacity: .55; }
        .td-card.pinned-card {
          border-color: rgba(251,191,36,.5);
          background: color-mix(in srgb, var(--accent) 94%, #fbbf24 6%);
        }

        /* Check circle */
        .td-check {
          width: 24px; height: 24px; border-radius: 50%; flex-shrink: 0;
          border: 2px solid var(--border); background: var(--background);
          display: flex; align-items: center; justify-content: center;
          cursor: pointer; transition: all .18s;
        }
        .td-check.checked {
          background: linear-gradient(135deg, #34d399, #22d3ee);
          border-color: transparent;
          box-shadow: 0 2px 8px rgba(52,211,153,.45);
        }
        .td-check.checked svg { color: #fff; }

        /* Text */
        .td-text {
          flex: 1; font-size: 0.9rem; font-weight: 500;
          color: var(--foreground); line-height: 1.35;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .td-card.done .td-text {
          text-decoration: line-through; color: var(--fg-muted);
        }

        /* Pin button */
        .td-pin {
          width: 30px; height: 30px; border-radius: 50%; flex-shrink: 0;
          border: none; background: transparent; padding: 0;
          display: flex; align-items: center; justify-content: center;
          cursor: pointer; color: var(--fg-faint);
          transition: color .15s, transform .12s;
        }
        .td-pin:active { transform: scale(.82); }
        .td-pin.on { color: #f59e0b; }
      `}</style>
    </div>
  );
}
