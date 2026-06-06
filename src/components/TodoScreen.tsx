'use client';

import { useState, useRef, useCallback } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, Plus, Pin, Check, Trash2 } from 'lucide-react';
import { db } from '@/lib/db';
import type { Todo } from '@/lib/db';
import { useT } from '@/lib/i18n';

const DEL_W = 80;

interface TodoScreenProps {
  onGoBack: () => void;
}

export default function TodoScreen({ onGoBack }: TodoScreenProps) {
  const t = useT();
  const [newText, setNewText]   = useState('');
  const [swipedId, setSwipedId] = useState<number | null>(null);
  const touchStartX = useRef(0);
  const inputRef    = useRef<HTMLInputElement>(null);

  const todos = useLiveQuery<Todo[]>(() =>
    db.todos.orderBy('createdAt').toArray().then(list =>
      list.filter(t => !t.deletedAt).sort((a, b) => {
        if (a.done   !== b.done)   return a.done   ? 1 : -1;
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return b.createdAt - a.createdAt;
      })
    )
  ) ?? [];

  const addTodo = useCallback(async () => {
    const text = newText.trim();
    if (!text) return;
    const now = Date.now();
    await db.todos.add({ text, done: false, pinned: false, createdAt: now, updatedAt: now });
    setNewText('');
  }, [newText]);

  const toggleDone = useCallback(async (t: Todo) =>
    db.todos.update(t.id!, { done: !t.done, updatedAt: Date.now() }), []);
  const togglePin = useCallback(async (t: Todo) =>
    db.todos.update(t.id!, { pinned: !t.pinned, updatedAt: Date.now() }), []);
  const deleteTodo = useCallback(async (id: number) => {
    const now = Date.now();
    await db.todos.update(id, { deletedAt: now, updatedAt: now });
    setSwipedId(null);
  }, []);

  const pending  = todos.filter(t => !t.done);
  const done     = todos.filter(t => t.done);
  const progress = todos.length > 0 ? Math.round((done.length / todos.length) * 100) : 0;

  // Sections are built as plain data and mapped INLINE in the return below.
  // styled-jsx only injects its scoping className onto JSX written lexically
  // inside the returned JSX tree — JSX returned from a separate helper
  // function does NOT get scoped, which silently breaks every rule here.
  const sections = [
    { key: 'pending', dotClass: 'active-dot', label: 'やること', list: pending },
    { key: 'done',    dotClass: 'done-dot',   label: '完了',     list: done },
  ].filter(s => s.list.length > 0);

  return (
    <div className="td-root">

      {/* Header */}
      <div className="td-header">
        <button className="td-back" onClick={onGoBack} aria-label={t('戻る')}>
          <ArrowLeft size={17} strokeWidth={2.5} />
        </button>
        <div className="td-header-mid">
          <span className="td-title">{t('タスク')}</span>
          {todos.length > 0 && (
            <span className="td-subtitle">{t('{done} / {total} 完了', { done: done.length, total: todos.length })}</span>
          )}
        </div>
        {pending.length > 0 && (
          <div className="td-badge">{pending.length}</div>
        )}
      </div>

      {/* Progress bar */}
      {todos.length > 0 && (
        <div className="td-progress-track">
          <div className="td-progress-fill" style={{ width: `${progress}%` }} />
        </div>
      )}

      {/* Add row — kept at top so it never collides with the floating Home bubble */}
      <div className="td-add-row">
        <input
          ref={inputRef}
          className="td-input"
          placeholder={t('新しいタスクを追加...')}
          value={newText}
          onChange={e => setNewText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') void addTodo(); }}
        />
        <button
          className="td-add-btn"
          onClick={() => void addTodo()}
          disabled={!newText.trim()}
          aria-label={t('追加')}
        >
          <Plus size={18} strokeWidth={2.8} />
        </button>
      </div>

      {/* List */}
      <div className="td-scroll">
        {todos.length === 0 && (
          <div className="td-empty">
            <span className="td-empty-icon">🎯</span>
            <p className="td-empty-title">{t('タスクをゼロに！')}</p>
            <p className="td-empty-sub">{t('上の入力欄から追加してね')}</p>
          </div>
        )}

        {sections.map(section => (
          <section key={section.key} className="td-section">
            <div className="td-section-label">
              <span className={`td-dot ${section.dotClass}`} />
              <span className="td-label-text">{t(section.label)}</span>
              <span className="td-label-cnt">{section.list.length}</span>
            </div>
            {section.list.map(todo => {
              const swiped = swipedId === todo.id;
              return (
                <div key={todo.id} className={`td-item${todo.pinned ? ' pinned-item' : ''}`}>
                  <div className={`td-inner${swiped ? ' slid' : ''}`}>
                    <div
                      className={`td-card${todo.done ? ' done' : ''}${todo.pinned ? ' pinned' : ''}`}
                      onTouchStart={e => { touchStartX.current = e.touches[0].clientX; }}
                      onTouchEnd={e => {
                        const dx = touchStartX.current - e.changedTouches[0].clientX;
                        if      (dx > 40)  setSwipedId(todo.id!);
                        else if (dx < -16) setSwipedId(null);
                      }}
                      onClick={() => { if (swiped) setSwipedId(null); }}
                    >
                      <button
                        className={`td-check${todo.done ? ' checked' : ''}`}
                        onClick={e => { e.stopPropagation(); void toggleDone(todo); }}
                        aria-label={t(todo.done ? '未完了に戻す' : '完了にする')}
                      >
                        {todo.done && <Check size={11} strokeWidth={3.5} />}
                      </button>

                      <span className="td-text">{todo.text}</span>

                      <button
                        className={`td-pin${todo.pinned ? ' on' : ''}`}
                        onClick={e => { e.stopPropagation(); void togglePin(todo); }}
                        aria-label={t(todo.pinned ? 'ピン解除' : 'ピン留め')}
                      >
                        <Pin size={14} strokeWidth={2.4} fill={todo.pinned ? 'currentColor' : 'none'} />
                      </button>
                    </div>

                    <button className="td-del" onClick={() => void deleteTodo(todo.id!)} aria-label={t('削除')}>
                      <Trash2 size={19} strokeWidth={2} />
                    </button>
                  </div>
                </div>
              );
            })}
          </section>
        ))}
      </div>

      <style jsx>{`
        /* ── Root ── */
        .td-root {
          flex: 1; display: flex; flex-direction: column;
          background: var(--background); overflow: hidden;
        }

        /* ── Header ── */
        .td-header {
          display: flex; align-items: center; gap: 10px;
          padding: 12px 14px 10px;
          background: var(--glass-tint, rgba(255,255,255,.88));
          backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
          flex-shrink: 0;
        }
        .td-back {
          width: 34px; height: 34px; border-radius: 10px; flex-shrink: 0;
          border: 1px solid var(--border); background: var(--accent);
          display: flex; align-items: center; justify-content: center;
          cursor: pointer; color: var(--foreground);
        }
        .td-back:active { opacity: .55; }
        .td-header-mid { flex: 1; display: flex; flex-direction: column; gap: 1px; min-width: 0; }
        .td-title {
          font-size: 18px; font-weight: 800; letter-spacing: -.025em; line-height: 1.15;
          background: linear-gradient(120deg, #34d399, #22d3ee);
          -webkit-background-clip: text; background-clip: text; color: transparent;
        }
        .td-subtitle { font-size: .65rem; color: var(--fg-muted); font-weight: 500; }
        .td-badge {
          min-width: 24px; height: 24px; border-radius: 99px; flex-shrink: 0;
          background: linear-gradient(135deg, #34d399, #22d3ee);
          color: #fff; font-size: .7rem; font-weight: 800;
          display: flex; align-items: center; justify-content: center; padding: 0 7px;
        }

        /* ── Progress ── */
        .td-progress-track {
          height: 3px; margin: 0 14px 12px; border-radius: 99px;
          background: var(--border); overflow: hidden; flex-shrink: 0;
        }
        .td-progress-fill {
          height: 100%; border-radius: 99px;
          background: linear-gradient(90deg, #34d399, #22d3ee);
          transition: width .6s cubic-bezier(.34,1.1,.64,1);
        }

        /* ── Add row ── */
        .td-add-row {
          display: flex; align-items: center; gap: 10px;
          padding: 0 14px 12px; flex-shrink: 0;
        }
        .td-input {
          flex: 1; min-width: 0; background: var(--accent);
          border: 1.5px solid var(--border); border-radius: 22px;
          padding: 10px 16px; font-size: .9rem;
          color: var(--foreground); outline: none; font-family: inherit;
          transition: border-color .15s;
        }
        .td-input::placeholder { color: var(--fg-faint); }
        .td-input:focus { border-color: #34d399; }
        .td-add-btn {
          width: 42px; height: 42px; border-radius: 50%; border: none; flex-shrink: 0;
          background: linear-gradient(135deg, #34d399, #22d3ee); color: #fff;
          display: flex; align-items: center; justify-content: center;
          cursor: pointer; box-shadow: 0 3px 10px rgba(52,211,153,.4);
          transition: opacity .15s, transform .12s;
        }
        .td-add-btn:disabled { opacity: .28; cursor: default; box-shadow: none; }
        .td-add-btn:not(:disabled):active { transform: scale(.86); }

        /* ── Scroll ── */
        .td-scroll {
          flex: 1; overflow-y: auto; padding: 2px 14px 96px;
          -webkit-overflow-scrolling: touch;
        }

        /* ── Empty ── */
        .td-empty {
          display: flex; flex-direction: column; align-items: center;
          padding: 52px 0 0; gap: 8px; text-align: center;
        }
        .td-empty-icon { font-size: 2.6rem; }
        .td-empty-title { font-size: .92rem; font-weight: 700; color: var(--foreground); margin: 0; }
        .td-empty-sub { font-size: .73rem; color: var(--fg-faint); margin: 0; }

        /* ── Section ── */
        .td-section { margin-bottom: 20px; }
        .td-section-label {
          display: flex; align-items: center; gap: 6px; padding: 0 2px 8px;
        }
        .td-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
        .active-dot { background: linear-gradient(135deg, #34d399, #22d3ee); }
        .done-dot   { background: var(--fg-faint); }
        .td-label-text {
          font-size: .68rem; font-weight: 700; letter-spacing: .09em;
          text-transform: uppercase; color: var(--fg-muted); flex: 1;
        }
        .td-label-cnt {
          font-size: .63rem; font-weight: 700; color: var(--fg-faint);
          background: var(--accent); border: 1px solid var(--border);
          border-radius: 99px; padding: 1px 7px;
        }

        /* ── Item (flex-sliding swipe-to-delete) ── */
        .td-item {
          border-radius: 14px; overflow: hidden; margin-bottom: 6px;
          box-shadow: 0 1px 2px rgba(0,0,0,.06), 0 3px 10px rgba(0,0,0,.05);
        }
        .td-item.pinned-item {
          box-shadow: 0 0 0 1.5px rgba(251,191,36,.55), 0 4px 16px rgba(251,191,36,.12);
        }
        .td-inner {
          display: flex;
          width: calc(100% + ${DEL_W}px);
          transition: transform .22s cubic-bezier(.25,.46,.45,.94);
        }
        .td-inner.slid { transform: translateX(-${DEL_W}px); }

        /* Card */
        .td-card {
          flex: 1; min-width: 0;
          display: flex; align-items: center; gap: 12px;
          padding: 14px 10px 14px 14px;
          background: var(--accent);
          cursor: default; -webkit-user-select: none; user-select: none;
          transition: opacity .25s;
        }
        .td-card.done   { opacity: .45; }
        .td-card.pinned { box-shadow: inset 3px 0 0 #fbbf24; }

        /* Check */
        .td-check {
          width: 26px; height: 26px; border-radius: 50%; flex-shrink: 0;
          border: 2px solid var(--border); background: var(--background);
          display: flex; align-items: center; justify-content: center;
          cursor: pointer;
          transition:
            background .2s cubic-bezier(.34,1.5,.64,1),
            border-color .2s, box-shadow .2s,
            transform .2s cubic-bezier(.34,1.5,.64,1);
        }
        .td-check:active { transform: scale(.84); }
        .td-check.checked {
          background: linear-gradient(135deg, #34d399, #22d3ee);
          border-color: transparent;
          box-shadow: 0 2px 10px rgba(52,211,153,.5);
        }
        .td-check.checked svg { color: #fff; }

        /* Text */
        .td-text {
          flex: 1; min-width: 0; font-size: .9rem; font-weight: 500;
          color: var(--foreground); line-height: 1.3;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .td-card.done .td-text { text-decoration: line-through; color: var(--fg-muted); }

        /* Pin */
        .td-pin {
          width: 30px; height: 30px; border-radius: 9px; flex-shrink: 0;
          border: none; background: transparent; padding: 0;
          display: flex; align-items: center; justify-content: center;
          cursor: pointer; color: var(--fg-faint);
          transition: color .15s, background .15s, transform .12s;
        }
        .td-pin:active { transform: scale(.78); }
        .td-pin.on { color: #f59e0b; background: rgba(245,158,11,.12); }

        /* Delete panel */
        .td-del {
          width: ${DEL_W}px; flex-shrink: 0;
          background: linear-gradient(160deg, #fb7185, #ef4444);
          border: none; color: #fff; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
        }
        .td-del:active { background: #dc2626; }
      `}</style>
    </div>
  );
}
