'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, ChevronLeft, ChevronRight, Check, Clock, ListTodo } from 'lucide-react';
import { db, newSyncId } from '@/lib/db';
import type { Diary } from '@/lib/db';
import { useT } from '@/lib/i18n';
import { getAppLang } from '@/lib/appLang';

const WEEKDAYS_JA = ['日', '月', '火', '水', '木', '金', '土'];
const WEEKDAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const MOODS = ['😄', '🙂', '😐', '😟', '😣'];
// Index 0 = best (bright amber) → index 4 = worst (dark slate). Used as cell tint on calendar.
const MOOD_TINT: string[] = [
  'rgba(251,191,36,.35)',   // 😄 amber
  'rgba(163,230,53,.30)',   // 🙂 lime
  'rgba(148,163,184,.20)',  // 😐 slate
  'rgba(107,114,128,.28)',  // 😟 gray
  'rgba(30,41,59,.38)',     // 😣 dark
];

function weekdayLabels(): string[] {
  return getAppLang() === 'en' ? WEEKDAYS_EN : WEEKDAYS_JA;
}
function isoOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function parseIso(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}
function fmtMonthTitle(d: Date): string {
  return getAppLang() === 'en'
    ? `${MONTHS_EN[d.getMonth()]} ${d.getFullYear()}`
    : `${d.getFullYear()}年 ${d.getMonth() + 1}月`;
}
function fmtDayLabel(iso: string): string {
  const d = parseIso(iso);
  return getAppLang() === 'en'
    ? `${WEEKDAYS_EN[d.getDay()]}, ${MONTHS_EN[d.getMonth()]} ${d.getDate()}`
    : `${d.getMonth() + 1}月${d.getDate()}日 (${WEEKDAYS_JA[d.getDay()]})`;
}
function fmtDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (getAppLang() === 'en') {
    if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
    return `${Math.max(m, 0)}m`;
  }
  if (h > 0) return m > 0 ? `${h}時間${m}分` : `${h}時間`;
  return `${Math.max(m, 0)}分`;
}

function monthCells(viewDate: Date): { iso: string; inMonth: boolean }[] {
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const first = new Date(year, month, 1);
  const start = new Date(first);
  start.setDate(1 - first.getDay());
  const cells: { iso: string; inMonth: boolean }[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    cells.push({ iso: isoOf(d), inMonth: d.getMonth() === month });
  }
  return cells.slice(0, cells[35].inMonth || cells.slice(35).some(c => c.inMonth) ? 42 : 35);
}

interface DiaryScreenProps {
  onGoBack: () => void;
}

export default function DiaryScreen({ onGoBack }: DiaryScreenProps) {
  const t = useT();
  const lang = getAppLang();
  const todayIso = isoOf(new Date());
  const [viewDate, setViewDate] = useState<Date>(() => new Date());
  const [selDay, setSelDay] = useState<string>(todayIso);
  const [draft, setDraft] = useState('');
  const [mood, setMood] = useState<string>('');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const diaries = useLiveQuery<Diary[]>(() =>
    db.diaries.filter(d => !d.deletedAt).toArray()
  );
  const ready = diaries !== undefined;

  const byDate = new Map<string, Diary>();
  for (const d of diaries ?? []) byDate.set(d.date, d);

  const current = byDate.get(selDay);

  // Study sessions for selected day
  const selDayStudy = useLiveQuery(
    () => db.studySessions.filter(s => s.date === selDay && !s.deletedAt).toArray(),
    [selDay],
  );
  const totalStudySec = (selDayStudy ?? []).reduce((sum, s) => sum + (s.duration ?? 0), 0);

  // Completed todos for selected day
  const selDayDoneTodos = useLiveQuery(
    () => db.todos.filter(t => t.dueDate === selDay && t.done && !t.deletedAt).toArray(),
    [selDay],
  );

  const loadedDay = useRef<string | null>(null);
  useEffect(() => {
    if (!ready) return;
    if (loadedDay.current === selDay) return;
    loadedDay.current = selDay;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft(current?.content ?? '');
    setMood(current?.mood ?? '');
  }, [ready, selDay, current]);

  const persist = useCallback(async (day: string, content: string, m: string) => {
    const existing = await db.diaries.where('date').equals(day).first();
    const now = Date.now();
    const empty = !content.trim() && !m;
    if (existing) {
      if (empty) {
        await db.diaries.update(existing.id!, { deletedAt: now, updatedAt: now });
      } else {
        await db.diaries.update(existing.id!, { content, mood: m || undefined, deletedAt: undefined, updatedAt: now });
      }
    } else if (!empty) {
      await db.diaries.add({
        syncId: newSyncId(), date: day, content, mood: m || undefined,
        createdAt: now, updatedAt: now,
      });
    }
  }, []);

  const scheduleSave = useCallback((content: string, m: string) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const day = selDay;
    saveTimer.current = setTimeout(() => { void persist(day, content, m); }, 600);
  }, [selDay, persist]);

  const flushSave = useCallback(() => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
  }, []);
  useEffect(() => () => flushSave(), [flushSave]);

  const selectDay = (iso: string) => {
    if (iso === selDay) return;
    flushSave();
    void persist(selDay, draft, mood);
    setSelDay(iso);
    // If selected month differs from view, navigate there
    const d = parseIso(iso);
    if (d.getMonth() !== viewDate.getMonth() || d.getFullYear() !== viewDate.getFullYear()) {
      setViewDate(new Date(d.getFullYear(), d.getMonth(), 1));
    }
  };

  const prevMonth = () => setViewDate(d => new Date(d.getFullYear(), d.getMonth() - 1, 1));
  const nextMonth = () => setViewDate(d => new Date(d.getFullYear(), d.getMonth() + 1, 1));
  const goToday = () => { setViewDate(new Date()); selectDay(todayIso); };

  const cells = monthCells(viewDate);
  const monthTouchX = useRef(0);

  const moodTint = (m?: string): string | undefined => {
    if (!m) return undefined;
    const idx = MOODS.indexOf(m);
    return idx >= 0 ? MOOD_TINT[idx] : undefined;
  };

  return (
    <div className="dy-root">
      {/* Header */}
      <div className="dy-header">
        <button
          className="dy-back"
          onClick={() => { flushSave(); void persist(selDay, draft, mood); onGoBack(); }}
          aria-label={t('戻る')}
        >
          <ArrowLeft size={17} strokeWidth={2.5} />
        </button>
        <div className="dy-header-mid">
          <span className="dy-title">{t('日記')}</span>
        </div>
      </div>

      <div className="dy-scroll">
        {/* Month nav */}
        <div className="dy-cal-head">
          <button className="dy-cal-nav" onClick={prevMonth} aria-label={t('前の月')}><ChevronLeft size={18} /></button>
          <button className="dy-cal-title" onClick={goToday}>{fmtMonthTitle(viewDate)}</button>
          <button className="dy-cal-nav" onClick={nextMonth} aria-label={t('次の月')}><ChevronRight size={18} /></button>
        </div>

        {/* Weekday header */}
        <div className="dy-wdrow">
          {weekdayLabels().map((w, i) => (
            <span key={w} className={`dy-wd${i === 0 ? ' sun' : ''}${i === 6 ? ' sat' : ''}`}>{w}</span>
          ))}
        </div>

        {/* Month grid */}
        <div
          className="dy-grid"
          onTouchStart={e => { monthTouchX.current = e.touches[0].clientX; }}
          onTouchEnd={e => {
            const dx = monthTouchX.current - e.changedTouches[0].clientX;
            if (dx > 45) nextMonth();
            else if (dx < -45) prevMonth();
          }}
        >
          {cells.map(({ iso, inMonth }) => {
            const entry = byDate.get(iso);
            const d = parseIso(iso);
            const tint = inMonth ? moodTint(entry?.mood) : undefined;
            return (
              <button
                key={iso}
                className={`dy-cell${inMonth ? '' : ' off'}${iso === selDay ? ' sel' : ''}${iso === todayIso ? ' today' : ''}`}
                style={tint ? { background: tint } : undefined}
                onClick={() => selectDay(iso)}
              >
                <span className="dy-cell-num">{d.getDate()}</span>
                {entry
                  ? <span className="dy-cell-mark">{entry.mood || '●'}</span>
                  : <span className="dy-cell-mark ph" />}
              </button>
            );
          })}
        </div>

        {/* Selected-day editor */}
        <div className="dy-editor">
          <div className="dy-day-label">
            {fmtDayLabel(selDay)}{selDay === todayIso ? ` ・${t('今日')}` : ''}
          </div>

          {/* Study time + done todos summary pills */}
          {(totalStudySec > 0 || (selDayDoneTodos?.length ?? 0) > 0) && (
            <div className="dy-stats">
              {totalStudySec > 0 && (
                <div className="dy-stat">
                  <Clock size={12} strokeWidth={2.5} />
                  <span>{lang === 'en' ? 'Study' : '学習'}: {fmtDuration(totalStudySec)}</span>
                </div>
              )}
              {(selDayDoneTodos?.length ?? 0) > 0 && (
                <div className="dy-stat">
                  <ListTodo size={12} strokeWidth={2.5} />
                  <span>
                    {lang === 'en'
                      ? `${selDayDoneTodos!.length} task${selDayDoneTodos!.length > 1 ? 's' : ''} done`
                      : `${selDayDoneTodos!.length}件完了`}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Completed todo list (up to 5) */}
          {(selDayDoneTodos?.length ?? 0) > 0 && (
            <div className="dy-todo-list">
              {selDayDoneTodos!.slice(0, 5).map(td => (
                <div key={td.id} className="dy-todo-item">
                  <Check size={10} strokeWidth={3.5} className="dy-todo-check" />
                  <span className="dy-todo-text">{td.text}</span>
                </div>
              ))}
              {selDayDoneTodos!.length > 5 && (
                <div className="dy-todo-more">
                  {lang === 'en' ? `+${selDayDoneTodos!.length - 5} more` : `他${selDayDoneTodos!.length - 5}件`}
                </div>
              )}
            </div>
          )}

          <div className="dy-moods">
            {MOODS.map(m => (
              <button
                key={m}
                className={`dy-mood${mood === m ? ' on' : ''}`}
                onClick={() => { const next = mood === m ? '' : m; setMood(next); scheduleSave(draft, next); }}
              >
                {m}
              </button>
            ))}
            {current && (
              <span className="dy-saved"><Check size={12} strokeWidth={3} /> {t('保存済み')}</span>
            )}
          </div>
          <textarea
            className="dy-textarea"
            value={draft}
            placeholder={t('今日はどんな一日だった？')}
            onChange={e => { setDraft(e.target.value); scheduleSave(e.target.value, mood); }}
            onBlur={() => { flushSave(); void persist(selDay, draft, mood); }}
          />
        </div>
      </div>

      <style jsx>{`
        .dy-root {
          flex: 1; display: flex; flex-direction: column;
          background: var(--background); overflow: hidden;
        }
        .dy-header {
          display: flex; align-items: center; gap: 10px;
          padding: 12px 14px 10px;
          background: var(--glass-tint, rgba(255,255,255,.88));
          backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
          flex-shrink: 0;
        }
        .dy-back {
          width: 34px; height: 34px; border-radius: 10px; flex-shrink: 0;
          border: 1px solid var(--border); background: var(--accent);
          display: flex; align-items: center; justify-content: center;
          cursor: pointer; color: var(--foreground);
        }
        .dy-back:active { opacity: .55; }
        .dy-header-mid { flex: 1; display: flex; flex-direction: column; gap: 1px; min-width: 0; }
        .dy-title {
          font-size: 18px; font-weight: 800; letter-spacing: -.025em; line-height: 1.15;
          background: linear-gradient(120deg, #f59e0b, #fb7185);
          -webkit-background-clip: text; background-clip: text; color: transparent;
        }

        /* Scrollable body */
        .dy-scroll {
          flex: 1; overflow-y: auto; -webkit-overflow-scrolling: touch;
          display: flex; flex-direction: column;
        }

        /* ── Month calendar ────────────────────────────────────── */
        .dy-cal-head {
          display: flex; align-items: center; justify-content: space-between;
          padding: 10px 14px 6px; flex-shrink: 0;
        }
        .dy-cal-title {
          font-size: 1rem; font-weight: 800; color: var(--foreground);
          background: none; border: none; cursor: pointer; font-family: inherit;
          padding: 4px 10px; border-radius: 9px;
        }
        .dy-cal-title:active { background: var(--accent); }
        .dy-cal-nav {
          width: 34px; height: 34px; border-radius: 10px;
          border: 1px solid var(--border); background: var(--accent);
          display: flex; align-items: center; justify-content: center;
          cursor: pointer; color: var(--foreground);
        }
        .dy-cal-nav:active { opacity: .55; }

        .dy-wdrow {
          display: grid; grid-template-columns: repeat(7, 1fr);
          padding: 0 14px 4px; flex-shrink: 0;
        }
        .dy-wd {
          text-align: center; font-size: .62rem; font-weight: 800;
          color: var(--fg-muted); letter-spacing: .04em;
        }
        .dy-wd.sun { color: #f87171; }
        .dy-wd.sat { color: #60a5fa; }

        .dy-grid {
          display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px;
          padding: 0 14px; flex-shrink: 0; touch-action: pan-y;
        }
        .dy-cell {
          position: relative; aspect-ratio: 1; min-height: 0;
          display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
          border: 1.5px solid transparent; border-radius: 12px;
          background: var(--accent); cursor: pointer; font-family: inherit;
          transition: background .12s, border-color .12s;
        }
        .dy-cell.off { background: transparent; opacity: .32; }
        .dy-cell.today { background: rgba(245,158,11,.14); }
        .dy-cell.sel {
          border-color: #f59e0b;
          background: linear-gradient(135deg, rgba(245,158,11,.18), rgba(251,113,133,.18));
          box-shadow: 0 0 0 2px rgba(245,158,11,.2);
        }
        .dy-cell-num { font-size: .9rem; font-weight: 700; color: var(--foreground); line-height: 1; }
        .dy-cell.off .dy-cell-num { color: var(--fg-faint); }
        .dy-cell-mark {
          font-size: .72rem; line-height: 1; height: .8rem;
          display: flex; align-items: center; justify-content: center;
          color: #f59e0b;
        }
        .dy-cell-mark.ph { color: transparent; }

        /* ── Day editor ─────────────────────────────────────────── */
        .dy-editor {
          flex: 1; display: flex; flex-direction: column;
          padding: 14px 14px 96px;
        }
        .dy-day-label {
          font-size: .82rem; font-weight: 800; color: var(--foreground);
          padding: 0 2px 8px; flex-shrink: 0;
        }

        /* Stats pills */
        .dy-stats {
          display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 8px; flex-shrink: 0;
        }
        .dy-stat {
          display: inline-flex; align-items: center; gap: 5px;
          font-size: .73rem; font-weight: 700; color: var(--fg-muted);
          background: var(--accent); border: 1px solid var(--border);
          border-radius: 20px; padding: 4px 10px;
        }

        /* Done todo list */
        .dy-todo-list {
          background: var(--accent); border: 1px solid var(--border);
          border-radius: 12px; padding: 8px 12px;
          margin-bottom: 10px; flex-shrink: 0;
          display: flex; flex-direction: column; gap: 5px;
        }
        .dy-todo-item { display: flex; align-items: center; gap: 7px; }
        .dy-todo-check { color: #16a34a; flex-shrink: 0; }
        .dy-todo-text {
          font-size: .78rem; color: var(--foreground);
          text-decoration: line-through; opacity: .6;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .dy-todo-more {
          font-size: .7rem; color: var(--fg-muted);
          text-align: right; padding-top: 2px;
        }

        .dy-moods {
          display: flex; align-items: center; gap: 6px; padding: 0 0 10px; flex-shrink: 0;
        }
        .dy-mood {
          width: 38px; height: 38px; border-radius: 11px; font-size: 1.2rem;
          border: 1.5px solid var(--border); background: var(--accent);
          cursor: pointer; display: flex; align-items: center; justify-content: center;
          transition: transform .1s, border-color .12s, background .12s; line-height: 1;
          filter: grayscale(.5); opacity: .7;
        }
        .dy-mood:active { transform: scale(.86); }
        .dy-mood.on {
          border-color: #f59e0b; background: rgba(245,158,11,.14);
          filter: none; opacity: 1;
        }
        .dy-saved {
          margin-left: auto; display: inline-flex; align-items: center; gap: 3px;
          font-size: .68rem; font-weight: 700; color: #16a34a;
        }
        .dy-textarea {
          flex: 1; min-height: 140px; width: 100%; resize: none;
          background: var(--accent); border: 1.5px solid var(--border);
          border-radius: 14px; padding: 14px 16px;
          font-size: .92rem; line-height: 1.7; color: var(--foreground);
          font-family: inherit; outline: none;
          transition: border-color .15s;
        }
        .dy-textarea::placeholder { color: var(--fg-faint); }
        .dy-textarea:focus { border-color: #f59e0b; }
      `}</style>
    </div>
  );
}
