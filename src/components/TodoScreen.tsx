'use client';

import { useState, useRef, useCallback } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ArrowLeft, Plus, Pin, Check, Trash2,
  CalendarDays, List as ListIcon, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { db } from '@/lib/db';
import type { Todo } from '@/lib/db';
import { useT } from '@/lib/i18n';

const DEL_W = 80;
const WEEKDAYS_JA = ['日', '月', '火', '水', '木', '金', '土'];

function isoOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function parseIso(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}
function fmtDayLabel(iso: string): string {
  const d = parseIso(iso);
  return `${d.getMonth() + 1}/${d.getDate()} (${WEEKDAYS_JA[d.getDay()]})`;
}
// Sunday that starts the week containing `d`.
function startOfWeek(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - x.getDay());
  return x;
}
function addDaysIso(iso: string, n: number): string {
  const d = parseIso(iso);
  d.setDate(d.getDate() + n);
  return isoOf(d);
}

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

  // ── Calendar (予定表) — week view state ──
  const [view, setView] = useState<'list' | 'calendar'>('list');
  const todayIso = isoOf(new Date());
  const [selDay, setSelDay] = useState<string>(todayIso);
  const [weekStart, setWeekStart] = useState<string>(() => isoOf(startOfWeek(new Date())));
  const [calText, setCalText] = useState('');
  const weekTouchX = useRef(0);

  const addTodoForDay = useCallback(async (text: string, day: string) => {
    const v = text.trim();
    if (!v) return;
    const now = Date.now();
    await db.todos.add({ text: v, done: false, pinned: false, createdAt: now, updatedAt: now, dueDate: day });
    setCalText('');
  }, []);

  const prevWeek = () => setWeekStart(w => addDaysIso(w, -7));
  const nextWeek = () => setWeekStart(w => addDaysIso(w, 7));
  const goThisWeek = () => { setWeekStart(isoOf(startOfWeek(new Date()))); setSelDay(todayIso); };

  // Map dueDate → todos, and the 7 days of the displayed week.
  const dueByDay = new Map<string, Todo[]>();
  for (const td of todos) {
    if (!td.dueDate) continue;
    const arr = dueByDay.get(td.dueDate) ?? [];
    arr.push(td);
    dueByDay.set(td.dueDate, arr);
  }
  const selDayTodos = todos.filter(td => td.dueDate === selDay);
  const weekDays: string[] = [];
  for (let i = 0; i < 7; i++) weekDays.push(addDaysIso(weekStart, i));
  const weekMid = parseIso(addDaysIso(weekStart, 3)); // for the month/year label

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

      {/* Progress bar (list view only) */}
      {view === 'list' && todos.length > 0 && (
        <div className="td-progress-track">
          <div className="td-progress-fill" style={{ width: `${progress}%` }} />
        </div>
      )}

      {/* View toggle: list / calendar */}
      <div className="td-viewtabs">
        <button className={`td-vtab${view === 'list' ? ' on' : ''}`} onClick={() => setView('list')}>
          <ListIcon size={14} strokeWidth={2.4} /> {t('リスト')}
        </button>
        <button className={`td-vtab${view === 'calendar' ? ' on' : ''}`} onClick={() => setView('calendar')}>
          <CalendarDays size={14} strokeWidth={2.4} /> {t('カレンダー')}
        </button>
      </div>

      {/* ── Calendar (予定表) — week view ── */}
      {view === 'calendar' && (
        <div className="td-cal-scroll">
          <div className="td-cal-head">
            <button className="td-cal-nav" onClick={prevWeek} aria-label={t('前の週')}><ChevronLeft size={18} /></button>
            <button className="td-cal-title" onClick={goThisWeek}>
              {weekMid.getFullYear()}{t('年')} {weekMid.getMonth() + 1}{t('月')}
            </button>
            <button className="td-cal-nav" onClick={nextWeek} aria-label={t('次の週')}><ChevronRight size={18} /></button>
          </div>

          {/* 7-day strip (swipe left/right to change week) */}
          <div
            className="td-week"
            onTouchStart={e => { weekTouchX.current = e.touches[0].clientX; }}
            onTouchEnd={e => {
              const dx = weekTouchX.current - e.changedTouches[0].clientX;
              if      (dx > 45)  nextWeek();
              else if (dx < -45) prevWeek();
            }}
          >
            {weekDays.map(iso => {
              const d = parseIso(iso);
              const list = dueByDay.get(iso);
              const undone = list ? list.filter(x => !x.done).length : 0;
              return (
                <button
                  key={iso}
                  className={`td-wday${iso === selDay ? ' sel' : ''}${iso === todayIso ? ' today' : ''}`}
                  onClick={() => setSelDay(iso)}
                >
                  <span className={`td-wday-wd${d.getDay() === 0 ? ' sun' : ''}${d.getDay() === 6 ? ' sat' : ''}`}>
                    {WEEKDAYS_JA[d.getDay()]}
                  </span>
                  <span className="td-wday-num">{d.getDate()}</span>
                  {list?.length ? (
                    <span className={`td-wday-dot${undone === 0 ? ' alldone' : ''}`}>{undone > 0 ? undone : '✓'}</span>
                  ) : <span className="td-wday-dot ph" />}
                </button>
              );
            })}
          </div>

          {/* Selected-day panel */}
          <div className="td-cal-day">
            <div className="td-cal-day-label">{fmtDayLabel(selDay)}{selDay === todayIso ? ` ・${t('今日')}` : ''}</div>
            <div className="td-add-row">
              <input
                className="td-input"
                placeholder={t('この日の予定を追加...')}
                value={calText}
                onChange={e => setCalText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') void addTodoForDay(calText, selDay); }}
              />
              <button
                className="td-add-btn"
                onClick={() => void addTodoForDay(calText, selDay)}
                disabled={!calText.trim()}
                aria-label={t('追加')}
              >
                <Plus size={18} strokeWidth={2.8} />
              </button>
            </div>
            {selDayTodos.length === 0 ? (
              <p className="td-cal-empty">{t('この日の予定はまだないよ')}</p>
            ) : selDayTodos.map(todo => (
              <div key={todo.id} className={`td-card cal${todo.done ? ' done' : ''}`}>
                <button
                  className={`td-check${todo.done ? ' checked' : ''}`}
                  onClick={() => void toggleDone(todo)}
                  aria-label={t(todo.done ? '未完了に戻す' : '完了にする')}
                >
                  {todo.done && <Check size={11} strokeWidth={3.5} />}
                </button>
                <span className="td-text">{todo.text}</span>
                <button className="td-cal-del" onClick={() => void deleteTodo(todo.id!)} aria-label={t('削除')}>
                  <Trash2 size={16} strokeWidth={2} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Add row — kept at top so it never collides with the floating Home bubble */}
      {view === 'list' && (
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
      )}

      {/* List */}
      {view === 'list' && (
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

                      {todo.dueDate && (
                        <span className="td-date-chip"><CalendarDays size={11} strokeWidth={2.4} /> {fmtDayLabel(todo.dueDate)}</span>
                      )}

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
      )}

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

        /* ── View toggle (list / calendar) ── */
        .td-viewtabs {
          display: flex; gap: 6px; padding: 0 14px 12px; flex-shrink: 0;
        }
        .td-vtab {
          flex: 1; display: flex; align-items: center; justify-content: center; gap: 5px;
          padding: 8px 0; border-radius: 12px; cursor: pointer;
          border: 1.5px solid var(--border); background: var(--accent);
          color: var(--fg-muted); font-size: .78rem; font-weight: 700;
          transition: all .15s;
        }
        .td-vtab.on {
          border-color: transparent; color: #fff;
          background: linear-gradient(135deg, #34d399, #22d3ee);
          box-shadow: 0 2px 8px rgba(52,211,153,.32);
        }

        /* ── Date chip on list items ── */
        .td-date-chip {
          display: inline-flex; align-items: center; gap: 3px; flex-shrink: 0;
          font-size: .64rem; font-weight: 700; color: #0891b2;
          background: rgba(34,211,238,.13); border-radius: 99px; padding: 2px 8px;
        }

        /* ── Calendar (予定表) ── */
        .td-cal-scroll {
          flex: 1; overflow-y: auto; padding: 0 14px 96px;
          -webkit-overflow-scrolling: touch;
        }
        .td-cal-head {
          display: flex; align-items: center; justify-content: space-between;
          padding: 2px 4px 12px;
        }
        .td-cal-title {
          font-size: 1rem; font-weight: 800; color: var(--foreground);
          background: none; border: none; cursor: pointer; font-family: inherit;
          padding: 4px 10px; border-radius: 9px;
        }
        .td-cal-title:active { background: var(--accent); }
        .td-cal-nav {
          width: 34px; height: 34px; border-radius: 10px;
          border: 1px solid var(--border); background: var(--accent);
          display: flex; align-items: center; justify-content: center;
          cursor: pointer; color: var(--foreground);
        }
        .td-cal-nav:active { opacity: .55; }

        /* ── Week strip ── */
        .td-week {
          display: grid; grid-template-columns: repeat(7, 1fr); gap: 5px;
          touch-action: pan-y;
        }
        .td-wday {
          position: relative; display: flex; flex-direction: column; align-items: center; gap: 3px;
          padding: 8px 0 7px; border-radius: 13px; cursor: pointer; font-family: inherit;
          border: 1.5px solid transparent; background: var(--accent);
          transition: background .12s, border-color .12s;
        }
        .td-wday.today { background: rgba(52,211,153,.14); }
        .td-wday.sel {
          border-color: #34d399;
          background: linear-gradient(135deg, rgba(52,211,153,.18), rgba(34,211,238,.18));
          box-shadow: 0 0 0 2px rgba(52,211,153,.22);
        }
        .td-wday-wd { font-size: .6rem; font-weight: 700; color: var(--fg-muted); }
        .td-wday-wd.sun { color: #f87171; }
        .td-wday-wd.sat { color: #60a5fa; }
        .td-wday-num { font-size: 1.02rem; font-weight: 800; color: var(--foreground); line-height: 1; }
        .td-wday-dot {
          min-width: 16px; height: 16px; border-radius: 99px; padding: 0 4px;
          background: linear-gradient(135deg, #34d399, #22d3ee); color: #fff;
          font-size: .6rem; font-weight: 800;
          display: flex; align-items: center; justify-content: center;
        }
        .td-wday-dot.alldone { background: var(--fg-faint); }
        .td-wday-dot.ph { background: transparent; } /* keeps row height stable */

        .td-cal-day { margin-top: 20px; }
        .td-cal-day-label {
          font-size: .8rem; font-weight: 800; color: var(--foreground);
          padding: 0 2px 8px;
        }
        .td-cal-empty {
          text-align: center; font-size: .76rem; color: var(--fg-faint);
          padding: 14px 0;
        }
        .td-card.cal {
          border-radius: 12px; margin-bottom: 6px; cursor: default;
          box-shadow: 0 1px 2px rgba(0,0,0,.05);
        }
        .td-cal-del {
          width: 30px; height: 30px; border-radius: 9px; flex-shrink: 0;
          border: none; background: transparent; padding: 0; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          color: var(--fg-faint);
        }
        .td-cal-del:active { color: #ef4444; transform: scale(.82); }

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
