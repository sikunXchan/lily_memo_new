'use client';

import { useState, useRef, useCallback } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, Plus, Pin, Check, Trash2, X } from 'lucide-react';
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

  const toggleDone = useCallback(async (t: Todo) => {
    await db.todos.update(t.id!, { done: !t.done });
  }, []);

  const togglePin = useCallback(async (t: Todo) => {
    await db.todos.update(t.id!, { pinned: !t.pinned });
  }, []);

  const deleteTodo = useCallback(async (id: number) => {
    await db.todos.delete(id);
    setSwipedId(null);
  }, []);

  const pending = todos.filter(t => !t.done);
  const done    = todos.filter(t => t.done);

  const renderItem = (t: Todo) => (
    <div key={t.id} className="td-row-wrap">
      <div
        className={`td-row ${swipedId === t.id ? 'swiped' : ''} ${t.done ? 'done' : ''}`}
        onTouchStart={e => { touchStartX.current = e.touches[0].clientX; }}
        onTouchEnd={e => {
          const dx = touchStartX.current - e.changedTouches[0].clientX;
          if (dx > 50) setSwipedId(t.id!);
          else if (dx < -20) setSwipedId(null);
        }}
        onClick={() => { if (swipedId === t.id) setSwipedId(null); }}
      >
        <button className={`td-check ${t.done ? 'checked' : ''}`} onClick={() => void toggleDone(t)}>
          {t.done && <Check size={12} />}
        </button>
        <span className="td-text">{t.text}</span>
        <button
          className={`td-pin ${t.pinned ? 'pinned' : ''}`}
          onClick={e => { e.stopPropagation(); void togglePin(t); }}
          title={t.pinned ? 'ピン解除' : 'ピン留め'}
        >
          <Pin size={13} />
        </button>
      </div>
      <button className="td-del-btn" onClick={() => void deleteTodo(t.id!)}>
        <Trash2 size={15} />
      </button>
    </div>
  );

  return (
    <div className="td-root">
      <div className="td-header">
        <button className="td-back" onClick={onGoBack}>
          <ArrowLeft size={18} />
        </button>
        <span className="td-title">ToDo</span>
        <span className="td-count">{pending.length}</span>
      </div>

      {/* Add form */}
      <div className="td-add-row">
        <input
          ref={inputRef}
          className="td-input"
          placeholder="新しいタスクを追加..."
          value={newText}
          onChange={e => setNewText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') void addTodo(); }}
        />
        <button className="td-add-btn" onClick={() => void addTodo()} disabled={!newText.trim()}>
          <Plus size={16} />
        </button>
      </div>

      <div className="td-scroll">
        {todos.length === 0 && (
          <div className="td-empty">タスクはまだありません</div>
        )}

        {pending.length > 0 && (
          <div className="td-section">
            <div className="td-section-label">未完了 · {pending.length}</div>
            {pending.map(renderItem)}
          </div>
        )}

        {done.length > 0 && (
          <div className="td-section">
            <div className="td-section-label">完了 · {done.length}</div>
            {done.map(renderItem)}
          </div>
        )}
      </div>

      <style jsx>{`
        .td-root {
          flex: 1; display: flex; flex-direction: column;
          background: var(--background); overflow: hidden;
        }
        .td-header {
          display: flex; align-items: center; gap: 10px;
          padding: 12px 16px; border-bottom: 1px solid var(--border);
          background: var(--background); flex-shrink: 0;
        }
        .td-back {
          width: 34px; height: 34px; border-radius: 50%;
          border: 1px solid var(--border); background: var(--accent);
          display: flex; align-items: center; justify-content: center;
          cursor: pointer; color: var(--primary); flex-shrink: 0;
        }
        .td-title {
          font-size: 20px; font-weight: 800; flex: 1;
          background: linear-gradient(120deg, #86efac, #22d3ee);
          -webkit-background-clip: text; background-clip: text; color: transparent;
        }
        .td-count {
          font-size: 0.75rem; font-weight: 800; background: var(--accent);
          border: 1px solid var(--border); border-radius: 99px;
          padding: 2px 9px; color: var(--fg-muted);
        }
        .td-add-row {
          display: flex; gap: 8px; padding: 10px 14px;
          border-bottom: 1px solid var(--border); flex-shrink: 0;
        }
        .td-input {
          flex: 1; background: var(--accent); border: 1.5px solid var(--border);
          border-radius: 20px; padding: 9px 14px; font-size: 0.88rem;
          color: var(--foreground); outline: none; font-family: inherit;
        }
        .td-input:focus { border-color: #86efac; }
        .td-add-btn {
          width: 38px; height: 38px; border-radius: 50%; border: none;
          background: linear-gradient(135deg, #86efac, #22d3ee); color: #fff;
          display: flex; align-items: center; justify-content: center;
          cursor: pointer; flex-shrink: 0; transition: opacity .15s;
        }
        .td-add-btn:disabled { opacity: .35; cursor: default; }
        .td-scroll {
          flex: 1; overflow-y: auto; padding: 10px 12px 32px;
          -webkit-overflow-scrolling: touch;
        }
        .td-empty {
          text-align: center; color: var(--fg-faint);
          font-size: 0.88rem; padding: 40px 0;
        }
        .td-section { margin-bottom: 8px; }
        .td-section-label {
          font-size: 0.68rem; font-weight: 700; letter-spacing: .14em;
          text-transform: uppercase; color: var(--fg-faint);
          padding: 8px 6px 4px;
        }
        .td-row-wrap {
          position: relative; overflow: hidden;
          border-radius: 12px; margin-bottom: 4px;
        }
        .td-row {
          display: flex; align-items: center; gap: 10px;
          padding: 11px 10px; background: var(--accent);
          border: 1px solid var(--border); border-radius: 12px;
          transition: transform .18s;
          cursor: default;
        }
        .td-row.swiped { transform: translateX(-64px); border-radius: 12px 0 0 12px; }
        .td-row.done { opacity: .55; }
        .td-check {
          width: 22px; height: 22px; border-radius: 50%; flex-shrink: 0;
          border: 2px solid var(--border); background: var(--background);
          display: flex; align-items: center; justify-content: center;
          cursor: pointer; transition: all .15s;
        }
        .td-check.checked {
          background: linear-gradient(135deg, #86efac, #22d3ee);
          border-color: transparent;
        }
        .td-check.checked svg { color: #fff; }
        .td-text {
          flex: 1; font-size: 0.88rem; color: var(--foreground);
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .td-row.done .td-text {
          text-decoration: line-through; color: var(--fg-muted);
        }
        .td-pin {
          width: 28px; height: 28px; border-radius: 8px; flex-shrink: 0;
          border: 1px solid var(--border); background: transparent;
          display: flex; align-items: center; justify-content: center;
          cursor: pointer; color: var(--fg-faint); transition: all .15s;
        }
        .td-pin.pinned { color: #f59e0b; border-color: #f59e0b; background: rgba(245,158,11,.1); }
        .td-del-btn {
          position: absolute; right: 0; top: 0; bottom: 0; width: 64px;
          background: #ef4444; color: #fff; border: none; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          border-radius: 0 12px 12px 0;
        }
        .td-del-btn:active { background: #dc2626; }
      `}</style>
    </div>
  );
}
