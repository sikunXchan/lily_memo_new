'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Play, Square, Plus, Trash2, BarChart2, Timer, ArrowLeft,
  Book, FileText, Brush, Sparkles, Settings as SettingsIcon, GraduationCap,
  Flame, X, ChevronLeft, ChevronRight, Zap, Pencil, Check,
} from 'lucide-react';
import { db, newSyncId, softDeleteSession, softDeleteCategory } from '@/lib/db';
import type { StudyCategory, StudySession } from '@/lib/db';
import StudyGreeting from './StudyGreeting';
import TrophyRoom from './TrophyRoom';
import StudyProfileModal from './StudyProfileModal';
import { getLevelInfo, fmtHoursShort } from '@/lib/level';
import LevelIcon from './LevelIcon';

// ── Constants ─────────────────────────────────────────────────────────────────
const LS_KEY_START     = 'study_timer_start';
const LS_KEY_RUNNING   = 'study_timer_running';
const LS_KEY_CAT       = 'study_selected_category_id';
const LS_KEY_CAT_NAME  = 'study_cat_name';
const LS_KEY_CAT_COLOR = 'study_cat_color';

const PRESET_COLORS = [
  '#6366f1', '#10b981', '#f59e0b', '#ef4444',
  '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16',
  '#f97316', '#64748b',
];

// ── Utilities ─────────────────────────────────────────────────────────────────
function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function dateStrFor(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function fmtClock(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

function fmtDur(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0) return `${h}時間${m > 0 ? m + '分' : ''}`;
  if (m > 0) return `${m}分`;
  return secs > 0 ? `${secs}秒` : '0分';
}

function fmtDateTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

function pastDays(n: number, offset: number = 0): string[] {
  const today = new Date(todayStr() + 'T00:00:00');
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - (n - 1 - i) - (offset * n));
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  });
}

function shortLabel(ds: string): string {
  const d = new Date(ds + 'T00:00:00');
  return `${d.getMonth()+1}/${d.getDate()}`;
}

// ── Stats bucket helpers ───────────────────────────────────────────────────────
type BucketSeg = { name: string; color: string; secs: number };
type Bucket    = { label: string; current: boolean; segs: BucketSeg[]; total: number; start: string; end: string };

function toYMD(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function segsFrom(list: StudySession[]): BucketSeg[] {
  const map = new Map<string, BucketSeg>();
  for (const s of list) {
    const key = s.categoryId != null ? `c${s.categoryId}` : 'none';
    const prev = map.get(key);
    if (prev) prev.secs += s.duration;
    else map.set(key, { name: s.categoryName ?? 'なし', color: s.categoryColor ?? '#94a3b8', secs: s.duration });
  }
  return [...map.values()].sort((a, b) => b.secs - a.secs);
}

function makeDayBuckets(sessions: StudySession[], offset: number): Bucket[] {
  const base = new Date(todayStr() + 'T00:00:00');
  const td = todayStr();
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(base);
    d.setDate(d.getDate() - (6 - i) - offset * 7);
    const start = toYMD(d);
    const segs = segsFrom(sessions.filter(s => s.date === start));
    return { label: `${d.getMonth()+1}/${d.getDate()}`, current: start === td, segs, total: segs.reduce((a, s) => a + s.secs, 0), start, end: start };
  });
}

function makeWeekBuckets(sessions: StudySession[], offset: number): Bucket[] {
  const base = new Date(todayStr() + 'T00:00:00');
  const td = todayStr();
  return Array.from({ length: 4 }, (_, i) => {
    const endD = new Date(base);
    endD.setDate(endD.getDate() - (3 - i) * 7 - offset * 28);
    const startD = new Date(endD);
    startD.setDate(startD.getDate() - 6);
    const start = toYMD(startD); const end = toYMD(endD);
    const segs = segsFrom(sessions.filter(s => s.date >= start && s.date <= end));
    return { label: `${startD.getMonth()+1}/${startD.getDate()}〜`, current: td >= start && td <= end, segs, total: segs.reduce((a, s) => a + s.secs, 0), start, end };
  });
}

function makeMonthBuckets(sessions: StudySession[], offset: number): Bucket[] {
  const base = new Date(todayStr() + 'T00:00:00');
  const tdYM = `${base.getFullYear()}-${String(base.getMonth()+1).padStart(2,'0')}`;
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(base.getFullYear(), base.getMonth() - (11 - i) - offset * 12, 1);
    const y = d.getFullYear(); const m = d.getMonth() + 1;
    const start = `${y}-${String(m).padStart(2,'0')}-01`;
    const lastDay = new Date(y, m, 0).getDate();
    const end = `${y}-${String(m).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`;
    const segs = segsFrom(sessions.filter(s => s.date >= start && s.date <= end));
    const bYM = `${y}-${String(m).padStart(2,'0')}`;
    return { label: `${m}月`, current: tdYM === bYM, segs, total: segs.reduce((a, s) => a + s.secs, 0), start, end };
  });
}

function calcStreak(dates: Set<string>): number {
  const today = new Date(todayStr() + 'T00:00:00');
  let streak = 0;
  for (let i = 0; i < 366; i++) {
    const d = new Date(today); d.setDate(d.getDate() - i);
    const ds = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    if (dates.has(ds)) {
      streak++;
    } else if (i === 0) {
      continue;
    } else {
      break;
    }
  }
  return streak;
}

// ── Props ─────────────────────────────────────────────────────────────────────
export interface StudyTrackerProps {
  onSwitchTab?: (tab: string) => void;
  onOpenSettings: () => void;
  onOpenFocus?: () => void;
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function StudyTracker({ onSwitchTab, onOpenSettings, onOpenFocus }: StudyTrackerProps) {
  const [view, setView] = useState<'timer' | 'stats' | 'total'>('timer');
  const [period, setPeriod]   = useState<'7d' | '30d' | '1y'>('7d');
  const [offset, setOffset]   = useState(0);
  const [selectedBucket, setSelectedBucket] = useState<number | null>(null);

  // Trophy room + profile modal
  const [showTrophy, setShowTrophy] = useState(false);
  const [showProfile, setShowProfile] = useState(false);

  // Timer
  const [isRunning, setIsRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const startTsRef = useRef<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Category
  const [selectedCatId, setSelectedCatId] = useState<number | null>(null);
  const [showAddCat, setShowAddCat] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newCatColor, setNewCatColor] = useState(PRESET_COLORS[0]);
  const [editCats, setEditCats] = useState(false);

  // Recent sessions editing & swipe-to-delete
  const [editingSessionId, setEditingSessionId] = useState<number | null>(null);
  const [editingStart, setEditingStart] = useState('');
  const [editingEnd, setEditingEnd] = useState('');
  const [editingCatId, setEditingCatId] = useState<number | null>(null);
  const [swipedId, setSwipedId] = useState<number | null>(null);
  const touchStartX = useRef(0);

  // DB
  const categories = useLiveQuery(() => db.studyCategories.orderBy('createdAt').filter(c => !c.deletedAt).toArray(), []) ?? [];
  const sessions = useLiveQuery(() => db.studySessions.orderBy('startTime').filter(s => !s.deletedAt).toArray(), []) ?? [];

  // Restore timer + category on mount
  useEffect(() => {
    const catStr = localStorage.getItem(LS_KEY_CAT);
    if (catStr !== null) setSelectedCatId(catStr === 'null' ? null : parseInt(catStr, 10) || null);

    const running = localStorage.getItem(LS_KEY_RUNNING) === 'true';
    const startStr = localStorage.getItem(LS_KEY_START);
    if (running && startStr) {
      const ts = parseInt(startStr, 10);
      startTsRef.current = ts;
      setIsRunning(true);
      setElapsed(Math.floor((Date.now() - ts) / 1000));
      intervalRef.current = setInterval(() => {
        if (startTsRef.current) setElapsed(Math.floor((Date.now() - startTsRef.current) / 1000));
      }, 1000);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // iOS background re-sync
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && startTsRef.current) {
        setElapsed(Math.floor((Date.now() - startTsRef.current) / 1000));
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  const startTimer = useCallback(() => {
    const now = Date.now();
    startTsRef.current = now;
    localStorage.setItem(LS_KEY_START, String(now));
    localStorage.setItem(LS_KEY_RUNNING, 'true');
    setIsRunning(true);
    setElapsed(0);
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => {
      if (startTsRef.current) setElapsed(Math.floor((Date.now() - startTsRef.current) / 1000));
    }, 1000);
  }, []);

  const stopTimer = useCallback(async () => {
    if (!startTsRef.current) return;
    const endTime = Date.now();
    const duration = Math.floor((endTime - startTsRef.current) / 1000);
    const startTime = startTsRef.current;
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    localStorage.removeItem(LS_KEY_START);
    localStorage.removeItem(LS_KEY_RUNNING);
    startTsRef.current = null;
    setIsRunning(false);
    setElapsed(0);
    if (duration >= 10) {
      const cat = categories.find(c => c.id === selectedCatId) ?? null;
      await db.studySessions.add({
        date: dateStrFor(startTime),
        startTime,
        endTime,
        duration,
        categoryId: selectedCatId,
        categoryName: cat?.name ?? null,
        categoryColor: cat?.color ?? null,
        source: 'stopwatch',
        syncId: newSyncId(),
        updatedAt: Date.now(),
      });
    }
  }, [categories, selectedCatId]);

  const selectCat = useCallback((id: number | null) => {
    if (isRunning) return;
    const cat = id !== null ? categories.find(c => c.id === id) : null;
    setSelectedCatId(id);
    localStorage.setItem(LS_KEY_CAT, id === null ? 'null' : String(id));
    localStorage.setItem(LS_KEY_CAT_NAME, cat?.name ?? '');
    localStorage.setItem(LS_KEY_CAT_COLOR, cat?.color ?? '');
  }, [isRunning, categories]);

  const addCat = useCallback(async () => {
    const name = newCatName.trim();
    if (!name) return;
    const id = await db.studyCategories.add({ name, color: newCatColor, createdAt: Date.now(), syncId: newSyncId(), updatedAt: Date.now() });
    setSelectedCatId(id as number);
    localStorage.setItem(LS_KEY_CAT, String(id));
    localStorage.setItem(LS_KEY_CAT_NAME, name);
    localStorage.setItem(LS_KEY_CAT_COLOR, newCatColor);
    setNewCatName('');
    setNewCatColor(PRESET_COLORS[Math.floor(Math.random() * PRESET_COLORS.length)]);
    setShowAddCat(false);
  }, [newCatName, newCatColor]);

  const deleteCat = useCallback(async (id: number) => {
    await softDeleteCategory(id);
    if (selectedCatId === id) selectCat(null);
  }, [selectedCatId, selectCat]);

  const startEditSession = (s: StudySession) => {
    setSwipedId(null);
    setEditingSessionId(s.id!);
    setEditingCatId(s.categoryId ?? null);
    const toHHMM = (ts: number) => {
      const d = new Date(ts);
      return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    };
    setEditingStart(toHHMM(s.startTime));
    setEditingEnd(toHHMM(s.endTime));
  };

  const saveEditSession = useCallback(async (id: number, date: string) => {
    const startMs = new Date(`${date}T${editingStart}:00`).getTime();
    const endMs = new Date(`${date}T${editingEnd}:00`).getTime();
    if (!isNaN(startMs) && !isNaN(endMs) && endMs > startMs) {
      const cat = editingCatId !== null ? categories.find(c => c.id === editingCatId) ?? null : null;
      await db.studySessions.update(id, {
        startTime: startMs,
        endTime: endMs,
        duration: Math.round((endMs - startMs) / 1000),
        categoryId: editingCatId,
        categoryName: cat?.name ?? null,
        categoryColor: cat?.color ?? null,
        updatedAt: Date.now(),
      });
    }
    setEditingSessionId(null);
    setEditingStart('');
    setEditingEnd('');
    setEditingCatId(null);
  }, [editingStart, editingEnd, editingCatId, categories]);

  const deleteSession = useCallback(async (id: number) => {
    await softDeleteSession(id);
    setSwipedId(null);
  }, []);

  // ── Stats ──────────────────────────────────────────────────────────────────
  const today = todayStr();
  const todayTotal = sessions.filter(s => s.date === today).reduce((sum, s) => sum + s.duration, 0);
  const sessionDates = new Set<string>(sessions.map(s => s.date as string));
  const streak = calcStreak(sessionDates);
  const selectedCat = categories.find(c => c.id === selectedCatId) ?? null;
  const recentSessions = [...sessions].reverse().slice(0, 10);

  const buckets =
    period === '7d'  ? makeDayBuckets(sessions, offset) :
    period === '30d' ? makeWeekBuckets(sessions, offset) :
                       makeMonthBuckets(sessions, offset);
  const maxBucket = Math.max(...buckets.map(b => b.total), 60);
  const firstDate = buckets.length > 0 ? buckets[0].start : today;
  const lastDate  = buckets.length > 0 ? buckets[buckets.length - 1].end : today;
  const periodSessions = sessions.filter(s => s.date >= firstDate && s.date <= lastDate);
  const periodTotal    = periodSessions.reduce((sum, s) => sum + s.duration, 0);
  const catMap = new Map<string, { name: string; color: string; secs: number }>();
  for (const s of periodSessions) {
    const key = s.categoryId !== null ? `c${s.categoryId}` : 'none';
    const prev = catMap.get(key);
    catMap.set(key, { name: s.categoryName ?? 'カテゴリなし', color: s.categoryColor ?? '#94a3b8', secs: (prev?.secs ?? 0) + s.duration });
  }
  const catTotals = [...catMap.values()].sort((a, b) => b.secs - a.secs);

  // ── All-time totals (合計タブ & 初期画面) ──────────────────────────────────
  const grandTotal = sessions.reduce((sum, s) => sum + s.duration, 0);
  const allCatMap = new Map<string, { name: string; color: string; secs: number }>();
  for (const s of sessions) {
    const key = s.categoryId !== null ? `c${s.categoryId}` : 'none';
    const prev = allCatMap.get(key);
    allCatMap.set(key, { name: s.categoryName ?? 'カテゴリなし', color: s.categoryColor ?? '#94a3b8', secs: (prev?.secs ?? 0) + s.duration });
  }
  const allCatTotals = [...allCatMap.values()].sort((a, b) => b.secs - a.secs);
  const totalDays = sessionDates.size;
  const levelInfo = getLevelInfo(grandTotal);

  const periodLabel = offset === 0
    ? (period === '7d' ? '直近7日間' : period === '30d' ? '直近4週間' : '直近1年間')
    : `${buckets[0]?.label ?? ''} 〜 ${buckets[buckets.length-1]?.label ?? ''}`;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="st-container">
      {/* Header */}
      <div className="st-header">
        {onSwitchTab && (
          <button className="st-back" onClick={() => onSwitchTab('memos')} title="メモに戻る">
            <ArrowLeft size={18} />
          </button>
        )}
        <span className="st-title">📚 学習トラッカー</span>
        <div className="st-tabs">
          <button className={`st-tab ${view === 'timer' ? 'active' : ''}`} onClick={() => setView('timer')}>
            <Timer size={13} /> タイマー
          </button>
          <button className={`st-tab ${view === 'stats' ? 'active' : ''}`} onClick={() => setView('stats')}>
            <BarChart2 size={13} /> 記録
          </button>
          <button className={`st-tab ${view === 'total' ? 'active' : ''}`} onClick={() => setView('total')}>
            <GraduationCap size={13} /> 合計
          </button>
        </div>
      </div>

      {/* ── Timer view ── */}
      {view === 'timer' && (
        <div className="st-scroll">
          {/* Greeting + progress + trophy room entrance */}
          <StudyGreeting
            onOpenTrophy={() => setShowTrophy(true)}
            onEditProfile={() => setShowProfile(true)}
          />

          {/* Prominent level banner */}
          <button className="lv-hero" onClick={() => setView('total')} style={{ borderColor: levelInfo.tier.color + '55' }}>
            <div className="lv-hero-icon" style={{ background: levelInfo.tier.color + '22', borderColor: levelInfo.tier.color + '66' }}>
              <LevelIcon tier={levelInfo.tier} size={56} />
            </div>
            <div className="lv-hero-body">
              <div className="lv-hero-top">
                <span className="lv-hero-num" style={{ color: levelInfo.tier.color }}>Lv {levelInfo.level}</span>
                <span className="lv-hero-next">次まで {fmtHoursShort(levelInfo.remainingHours)}</span>
              </div>
              <div className="lv-hero-bar"><div className="lv-hero-fill" style={{ width: `${levelInfo.pct}%`, background: levelInfo.tier.color }} /></div>
            </div>
          </button>

          {/* Category selector */}
          <div className="cat-section">
            <div className="cat-row">
              <button
                className={`cat-chip ${selectedCatId === null ? 'selected' : ''}`}
                style={selectedCatId === null ? { borderColor: '#6366f1', background: 'rgba(99,102,241,0.12)' } : {}}
                onClick={() => selectCat(null)}
                disabled={isRunning}
              >
                <span className="cat-dot" style={{ background: '#94a3b8' }} />
                なし
              </button>
              {categories.map(cat => (
                <div key={cat.id} className="cat-chip-wrap">
                  <button
                    className={`cat-chip ${selectedCatId === cat.id ? 'selected' : ''}`}
                    style={selectedCatId === cat.id ? { borderColor: cat.color, background: cat.color + '22' } : {}}
                    onClick={() => selectCat(cat.id!)}
                    disabled={isRunning}
                  >
                    <span className="cat-dot" style={{ background: cat.color }} />
                    {cat.name}
                  </button>
                  {editCats && (
                    <button className="cat-del-btn" onClick={() => void deleteCat(cat.id!)}>
                      <X size={10} />
                    </button>
                  )}
                </div>
              ))}
              <button className="cat-chip cat-action-chip" onClick={() => { setShowAddCat(v => !v); setEditCats(false); }} disabled={isRunning}>
                <Plus size={13} />
              </button>
              {categories.length > 0 && (
                <button className={`cat-chip cat-action-chip ${editCats ? 'editing' : ''}`} onClick={() => { setEditCats(v => !v); setShowAddCat(false); }} disabled={isRunning}>
                  <Trash2 size={12} />
                </button>
              )}
            </div>

            {showAddCat && (
              <div className="add-cat-form">
                <input
                  className="cat-name-input"
                  value={newCatName}
                  onChange={e => setNewCatName(e.target.value)}
                  placeholder="教科名 (例: 数学)"
                  maxLength={20}
                  onKeyDown={e => { if (e.key === 'Enter') void addCat(); }}
                  autoFocus
                />
                <div className="color-row">
                  {PRESET_COLORS.map(c => (
                    <button
                      key={c}
                      className={`color-swatch ${newCatColor === c ? 'selected' : ''}`}
                      style={{ background: c }}
                      onClick={() => setNewCatColor(c)}
                    />
                  ))}
                </div>
                <button className="cat-save-btn" onClick={() => void addCat()} disabled={!newCatName.trim()}>
                  追加
                </button>
              </div>
            )}
          </div>

          {/* Timer display */}
          <div className={`timer-card ${isRunning ? 'running' : ''}`}>
            {selectedCat && (
              <div className="timer-cat-label">
                <span className="timer-cat-dot" style={{ background: selectedCat.color }} />
                {selectedCat.name}
              </div>
            )}
            <div className="timer-display">{fmtClock(elapsed)}</div>
            <button
              className={`timer-btn ${isRunning ? 'stop' : 'start'}`}
              onClick={isRunning ? () => void stopTimer() : startTimer}
            >
              {isRunning ? <><Square size={16} fill="currentColor" /> 停止して保存</> : <><Play size={16} fill="currentColor" /> スタート</>}
            </button>
          </div>

          {/* Today + all-time total */}
          <div className="total-row">
            <div className="today-card">
              <span className="today-label">今日の学習</span>
              <span className="today-total">{fmtDur(todayTotal + (isRunning ? elapsed : 0))}</span>
            </div>
            <button className="today-card today-card-btn" onClick={() => setView('total')}>
              <span className="today-label">合計学習時間</span>
              <span className="today-total">{fmtDur(grandTotal + (isRunning ? elapsed : 0))}</span>
            </button>
          </div>

          {/* Recent sessions */}
          {recentSessions.length > 0 && (
            <div className="recent-section">
              <p className="recent-title">直近の記録（左スワイプで削除）</p>
              {recentSessions.map(s => (
                <div key={s.id} className="recent-row-wrap">
                  <div
                    className={`recent-row-inner ${swipedId === s.id ? 'swiped' : ''} ${editingSessionId === s.id ? 'editing' : ''}`}
                    onTouchStart={e => { if (editingSessionId === s.id) return; touchStartX.current = e.touches[0].clientX; }}
                    onTouchEnd={e => {
                      if (editingSessionId === s.id) return;
                      const dx = touchStartX.current - e.changedTouches[0].clientX;
                      if (dx > 50) { setSwipedId(s.id!); setEditingSessionId(null); }
                      else if (dx < -20) setSwipedId(null);
                    }}
                    onClick={() => { if (swipedId === s.id) setSwipedId(null); }}
                  >
                    <div className="recent-row-top">
                      <span className="recent-dot" style={{ background: s.categoryColor ?? '#94a3b8' }} />
                      <div className="recent-info">
                        <span className="recent-cat">{s.categoryName ?? 'なし'}</span>
                        <span className="recent-time">{fmtDateTime(s.startTime)}</span>
                      </div>
                    </div>
                    {editingSessionId === s.id ? (
                      <div className="recent-edit-area" onClick={e => e.stopPropagation()}>
                        <div className="recent-edit-row">
                          <input
                            type="time"
                            className="recent-edit-time"
                            value={editingStart}
                            onChange={e => setEditingStart(e.target.value)}
                          />
                          <span className="recent-edit-sep">〜</span>
                          <input
                            type="time"
                            className="recent-edit-time"
                            value={editingEnd}
                            onChange={e => setEditingEnd(e.target.value)}
                          />
                          <button className="recent-confirm-btn" onClick={() => void saveEditSession(s.id!, s.date)}>
                            <Check size={12} />
                          </button>
                        </div>
                        <div className="recent-cat-edit-row">
                          <button
                            className={`rce-chip ${editingCatId === null ? 'rce-chip-active' : ''}`}
                            onClick={() => setEditingCatId(null)}
                          >なし</button>
                          {categories.map(c => (
                            <button
                              key={c.id}
                              className={`rce-chip ${editingCatId === c.id ? 'rce-chip-active' : ''}`}
                              style={editingCatId === c.id ? { borderColor: c.color, color: c.color } : {}}
                              onClick={() => setEditingCatId(c.id!)}
                            >
                              <span className="rce-dot" style={{ background: c.color }} />
                              {c.name}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="recent-dur-wrap">
                        <button
                          className="recent-dur-btn"
                          onClick={e => { e.stopPropagation(); if (swipedId !== s.id) startEditSession(s); }}
                          title="開始・終了時刻・カテゴリを修正"
                        >
                          {fmtDur(s.duration)}
                          <Pencil size={10} className="recent-edit-icon" />
                        </button>
                      </div>
                    )}
                  </div>
                  <button className="recent-swipe-del" onClick={() => void deleteSession(s.id!)}>
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Stats view ── */}
      {view === 'stats' && (
        <div className="st-scroll">
          <div className="period-row">
            <button className={`period-btn ${period === '7d'  ? 'active' : ''}`} onClick={() => { setPeriod('7d');  setOffset(0); setSelectedBucket(null); }}>7日間</button>
            <button className={`period-btn ${period === '30d' ? 'active' : ''}`} onClick={() => { setPeriod('30d'); setOffset(0); setSelectedBucket(null); }}>30日間</button>
            <button className={`period-btn ${period === '1y'  ? 'active' : ''}`} onClick={() => { setPeriod('1y');  setOffset(0); setSelectedBucket(null); }}>1年間</button>
            <div className="period-nav">
              <button className="period-nav-btn" onClick={() => { setOffset(o => o + 1); setSelectedBucket(null); }} title="前の期間">
                <ChevronLeft size={16} />
              </button>
              <span className="period-nav-label">{periodLabel}</span>
              <button className="period-nav-btn" onClick={() => { setOffset(o => Math.max(0, o - 1)); setSelectedBucket(null); }} disabled={offset === 0} title="次の期間">
                <ChevronRight size={16} />
              </button>
            </div>
          </div>

          <div className="summary-row">
            <div className="summary-card">
              <Flame size={18} style={{ color: '#f97316' }} />
              <span className="summary-val">{streak}</span>
              <span className="summary-lbl">連続日数</span>
            </div>
            <div className="summary-card">
              <span className="summary-val">{fmtDur(periodTotal)}</span>
              <span className="summary-lbl">{periodLabel}合計</span>
            </div>
          </div>

          {sessions.length > 0 ? (
            <>
              <div className="chart-card">
                <p className="chart-title">
                  {period === '7d' ? '日別' : period === '30d' ? '週別' : '月別'}学習時間
                </p>
                <div className="bar-chart">
                  {buckets.map((b, i) => (
                    <div key={i} className="bar-col" onClick={() => setSelectedBucket(selectedBucket === i ? null : i)}>
                      <div className="bar-wrap">
                        <div
                          className={`bar-stack${b.current ? ' cur' : ''}${selectedBucket === i ? ' sel' : ''}`}
                          style={{ height: `${b.total > 0 ? Math.max(Math.round((b.total / maxBucket) * 100), 4) : 0}%` }}
                        >
                          {b.segs.length > 0
                            ? b.segs.map((seg, j) => (
                                <div key={j} className="bar-seg" style={{ flex: seg.secs, background: seg.color }} />
                              ))
                            : null
                          }
                        </div>
                      </div>
                      <span className={`bar-label${selectedBucket === i ? ' sel' : ''}`}>{b.label}</span>
                    </div>
                  ))}
                </div>
                {selectedBucket !== null && (() => {
                  const b = buckets[selectedBucket];
                  return (
                    <div className="bar-detail">
                      <span className="bar-detail-label">{b.label}</span>
                      <span className="bar-detail-total">{b.total > 0 ? fmtDur(b.total) : '記録なし'}</span>
                      {b.segs.length > 0 && (
                        <div className="bar-detail-segs">
                          {b.segs.map((seg, j) => (
                            <div key={j} className="bar-detail-seg">
                              <span className="bar-detail-dot" style={{ background: seg.color }} />
                              <span className="bar-detail-name">{seg.name}</span>
                              <span className="bar-detail-time">{fmtDur(seg.secs)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>

              {catTotals.length > 0 && (
                <div className="cat-breakdown">
                  <p className="breakdown-title">カテゴリ別</p>
                  {catTotals.map((c, i) => (
                    <div key={i} className="breakdown-row">
                      <div className="breakdown-head">
                        <span className="breakdown-dot" style={{ background: c.color }} />
                        <span className="breakdown-name">{c.name}</span>
                        <span className="breakdown-time">{fmtDur(c.secs)}</span>
                      </div>
                      <div className="breakdown-bar-bg">
                        <div
                          className="breakdown-bar-fill"
                          style={{ width: `${periodTotal > 0 ? Math.round((c.secs / periodTotal) * 100) : 0}%`, background: c.color }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="no-sessions">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/allstar.PNG" alt="" className="no-sessions-img" />
              <p>まだ学習記録がないよ！</p>
              <p className="no-sessions-sub">タイマータブで記録してみてね 📚</p>
            </div>
          )}
        </div>
      )}

      {/* ── Total view ── */}
      {view === 'total' && (
        <div className="st-scroll">
          {/* Level card */}
          <div className="lv-card" style={{ borderColor: levelInfo.tier.color + '66' }}>
            <div className="lv-card-icon" style={{ background: levelInfo.tier.color + '1f', borderColor: levelInfo.tier.color + '66' }}>
              <LevelIcon tier={levelInfo.tier} size={72} />
            </div>
            <div className="lv-card-body">
              <span className="lv-num" style={{ color: levelInfo.tier.color }}>Lv {levelInfo.level}</span>
              <div className="lv-bar"><div className="lv-fill" style={{ width: `${levelInfo.pct}%`, background: levelInfo.tier.color }} /></div>
              <span className="lv-next">次のレベルまであと {fmtHoursShort(levelInfo.remainingHours)}</span>
            </div>
          </div>

          <div className="grand-card">
            <span className="grand-label">合計学習時間</span>
            <span className="grand-total">{fmtDur(grandTotal)}</span>
            <span className="grand-sub">{totalDays}日間 ・ {sessions.length}セッション</span>
          </div>

          {allCatTotals.length > 0 ? (
            <div className="cat-breakdown">
              <p className="breakdown-title">カテゴリ別 合計</p>
              {allCatTotals.map((c, i) => (
                <div key={i} className="breakdown-row">
                  <div className="breakdown-head">
                    <span className="breakdown-dot" style={{ background: c.color }} />
                    <span className="breakdown-name">{c.name}</span>
                    <span className="breakdown-time">{fmtDur(c.secs)}</span>
                  </div>
                  <div className="breakdown-bar-bg">
                    <div
                      className="breakdown-bar-fill"
                      style={{ width: `${grandTotal > 0 ? Math.round((c.secs / grandTotal) * 100) : 0}%`, background: c.color }}
                    />
                  </div>
                  <span className="breakdown-pct">{grandTotal > 0 ? Math.round((c.secs / grandTotal) * 100) : 0}%</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="no-sessions">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/allstar.PNG" alt="" className="no-sessions-img" />
              <p>まだ学習記録がないよ！</p>
              <p className="no-sessions-sub">タイマータブで記録してみてね 📚</p>
            </div>
          )}
        </div>
      )}

      {/* Bottom nav — desktop only, hidden on mobile (BackBubble handles mobile nav) */}
      {onSwitchTab && (
        <nav className="st-bottom-nav">
          <button className="snav-item" onClick={() => onSwitchTab('memos')}><Book size={22}/><span>メモ</span></button>
          <button className="snav-item" onClick={() => onSwitchTab('sketch')}><Brush size={22}/><span>落書き</span></button>
          <button className="snav-item" onClick={() => onSwitchTab('pdf')}><FileText size={22}/><span>PDF</span></button>
          <button className="snav-item" onClick={() => onSwitchTab('ai')}><Sparkles size={22}/><span>AI</span></button>
          <button className="snav-item active"><GraduationCap size={22}/><span>学習</span></button>
          {onOpenFocus && (
            <button className="snav-item snav-focus" onClick={onOpenFocus}><Zap size={22}/><span>集中</span></button>
          )}
          <button className="snav-item" onClick={() => { onSwitchTab('settings'); onOpenSettings(); }}><SettingsIcon size={22}/><span>設定</span></button>
        </nav>
      )}

      {showTrophy && <TrophyRoom onClose={() => setShowTrophy(false)} />}
      {showProfile && <StudyProfileModal onClose={() => setShowProfile(false)} />}

      <style jsx>{`
        .st-container { display:flex; flex-direction:column; height:100%; background:var(--background); overflow:hidden; }
        .st-header { display:flex; align-items:center; gap:8px; padding:10px 14px; border-bottom:1px solid var(--border); background:var(--glass-tint,rgba(255,255,255,0.9)); backdrop-filter:blur(20px); -webkit-backdrop-filter:blur(20px); flex-shrink:0; }
        .st-back { width:34px; height:34px; display:flex; align-items:center; justify-content:center; border-radius:10px; background:var(--accent); border:1px solid var(--border); color:var(--foreground); cursor:pointer; flex-shrink:0; }
        .st-back:hover { opacity:.75; }
        .st-title { font-size:.9rem; font-weight:800; color:var(--foreground); flex:1; }
        .st-tabs { display:flex; gap:4px; }
        .st-tab { display:flex; align-items:center; gap:4px; background:var(--accent); border:1px solid var(--border); border-radius:16px; padding:5px 11px; font-size:.75rem; font-weight:600; color:var(--fg-muted); cursor:pointer; white-space:nowrap; transition:all .15s; }
        .st-tab.active { background:var(--primary); color:#fff; border-color:var(--primary); }

        .st-scroll { flex:1; overflow-y:auto; padding:14px; display:flex; flex-direction:column; gap:12px; }

        /* ── Category ── */
        .cat-section { display:flex; flex-direction:column; gap:8px; }
        .cat-row { display:flex; gap:7px; flex-wrap:wrap; align-items:center; }
        .cat-chip-wrap { position:relative; display:inline-flex; }
        .cat-chip { display:flex; align-items:center; gap:5px; padding:6px 12px; border-radius:20px; font-size:.78rem; font-weight:600; color:var(--foreground); background:var(--accent); border:1.5px solid var(--border); cursor:pointer; transition:all .15s; white-space:nowrap; }
        .cat-chip:hover:not(:disabled) { opacity:.8; }
        .cat-chip:disabled { opacity:.5; cursor:default; }
        .cat-chip.selected { font-weight:700; }
        .cat-dot { width:8px; height:8px; border-radius:50%; flex-shrink:0; }
        .cat-action-chip { color:var(--fg-muted); padding:6px 10px; }
        .cat-action-chip.editing { background:color-mix(in srgb,#ef4444 15%,var(--accent)); border-color:#ef4444; color:#ef4444; }
        .cat-del-btn { position:absolute; top:-5px; right:-5px; width:16px; height:16px; border-radius:50%; background:#ef4444; color:#fff; border:none; cursor:pointer; display:flex; align-items:center; justify-content:center; }

        .add-cat-form { background:var(--accent); border:1px solid var(--border); border-radius:14px; padding:12px; display:flex; flex-direction:column; gap:10px; }
        .cat-name-input { width:100%; background:var(--background); border:1px solid var(--border); border-radius:8px; padding:8px 10px; font-size:.85rem; color:var(--foreground); outline:none; font-family:inherit; }
        .cat-name-input:focus { border-color:var(--primary); }
        .color-row { display:flex; gap:7px; flex-wrap:wrap; }
        .color-swatch { width:24px; height:24px; border-radius:50%; border:2px solid transparent; cursor:pointer; transition:all .15s; }
        .color-swatch.selected { border-color:#fff; box-shadow:0 0 0 2px var(--primary); transform:scale(1.2); }
        .cat-save-btn { background:var(--primary); color:#fff; border:none; border-radius:8px; padding:8px 16px; font-size:.82rem; font-weight:700; cursor:pointer; align-self:flex-end; }
        .cat-save-btn:disabled { opacity:.4; cursor:default; }

        /* ── Timer ── */
        .timer-card { background:var(--accent); border:1.5px solid var(--border); border-radius:20px; padding:28px 20px; display:flex; flex-direction:column; align-items:center; gap:14px; transition:border-color .3s, background .3s; }
        .timer-card.running { border-color:var(--primary); background:color-mix(in srgb,var(--primary) 6%,var(--background)); }
        .timer-cat-label { display:flex; align-items:center; gap:6px; font-size:.78rem; font-weight:600; color:var(--fg-muted); }
        .timer-cat-dot { width:8px; height:8px; border-radius:50%; }
        .timer-display { font-size:clamp(2.8rem,10vw,4.5rem); font-weight:800; font-variant-numeric:tabular-nums; letter-spacing:.02em; color:var(--foreground); line-height:1; }
        .timer-btn { display:flex; align-items:center; gap:8px; padding:12px 32px; border-radius:50px; font-size:.95rem; font-weight:700; cursor:pointer; border:none; transition:all .15s; }
        .timer-btn.start { background:var(--primary); color:#fff; }
        .timer-btn.stop { background:#ef4444; color:#fff; }
        .timer-btn:hover { opacity:.88; transform:scale(1.02); }

        .today-card { background:color-mix(in srgb,var(--primary) 10%,transparent); border:1px solid color-mix(in srgb,var(--primary) 25%,transparent); border-radius:14px; padding:14px 18px; display:flex; align-items:center; justify-content:space-between; }
        .today-label { font-size:.8rem; font-weight:600; color:var(--fg-muted); }
        .today-total { font-size:1.6rem; font-weight:800; color:var(--primary); }
        .total-row { display:flex; gap:10px; }
        .total-row .today-card { flex:1; flex-direction:column; align-items:flex-start; gap:4px; padding:12px 14px; min-width:0; }
        .total-row .today-total { font-size:1.25rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:100%; }
        .total-row .today-label { font-size:.72rem; }
        .today-card-btn { cursor:pointer; text-align:left; font-family:inherit; transition:transform .12s, box-shadow .12s; }
        .today-card-btn:hover { transform:translateY(-2px); box-shadow:0 4px 14px rgba(99,102,241,.18); }

        /* ── Level hero (home/timer view) ── */
        .lv-hero { display:flex; align-items:center; gap:13px; width:100%; text-align:left; cursor:pointer; font-family:inherit;
          background:var(--accent); border:1.5px solid var(--border); border-radius:18px; padding:13px 15px; transition:transform .12s, box-shadow .12s; }
        .lv-hero:hover { transform:translateY(-2px); box-shadow:0 6px 18px rgba(0,0,0,.12); }
        .lv-hero-icon { width:62px; height:62px; flex-shrink:0; border-radius:16px; border:1.5px solid; display:flex; align-items:center; justify-content:center; }
        .lv-hero-body { flex:1; min-width:0; display:flex; flex-direction:column; gap:7px; }
        .lv-hero-top { display:flex; align-items:baseline; justify-content:space-between; gap:8px; }
        .lv-hero-num { font-size:1.7rem; font-weight:900; line-height:1; }
        .lv-hero-next { font-size:.72rem; font-weight:700; color:var(--fg-muted); white-space:nowrap; }
        .lv-hero-bar { height:9px; background:rgba(0,0,0,0.12); border-radius:99px; overflow:hidden; }
        .lv-hero-fill { height:100%; border-radius:99px; transition:width .6s ease; }

        /* ── Total view ── */
        .lv-card { background:var(--accent); border:1.5px solid var(--border); border-radius:18px; padding:16px 18px; display:flex; align-items:center; gap:15px; }
        .lv-card-icon { width:80px; height:80px; flex-shrink:0; border-radius:18px; border:1.5px solid; display:flex; align-items:center; justify-content:center; }
        .lv-card-body { flex:1; min-width:0; display:flex; flex-direction:column; gap:8px; }
        .lv-num { font-size:1.7rem; font-weight:900; line-height:1; }
        .lv-bar { height:10px; background:rgba(0,0,0,0.12); border-radius:99px; overflow:hidden; }
        .lv-fill { height:100%; border-radius:99px; transition:width .6s ease; }
        .lv-next { font-size:.76rem; font-weight:700; color:var(--fg-muted); }
        .grand-card { background:linear-gradient(135deg,color-mix(in srgb,var(--primary) 18%,var(--background)),var(--background)); border:1px solid color-mix(in srgb,var(--primary) 30%,transparent); border-radius:18px; padding:22px 18px; display:flex; flex-direction:column; align-items:center; gap:6px; }
        .grand-label { font-size:.82rem; font-weight:700; color:var(--fg-muted); }
        .grand-total { font-size:2.4rem; font-weight:900; color:var(--primary); line-height:1.1; text-align:center; }
        .grand-sub { font-size:.74rem; font-weight:600; color:var(--fg-muted); }
        .breakdown-pct { font-size:.68rem; font-weight:700; color:var(--fg-muted); text-align:right; }

        /* ── Recent sessions ── */
        .recent-section { display:flex; flex-direction:column; gap:6px; }
        .recent-title { font-size:.75rem; font-weight:700; color:var(--fg-muted); margin-bottom:2px; }
        .recent-row-wrap { position:relative; border-radius:12px; overflow:hidden; }
        .recent-row-inner { display:flex; align-items:center; gap:8px; background:var(--accent); border:1px solid var(--border); border-radius:12px; padding:8px 10px; transform:translateX(0); transition:transform .22s ease; position:relative; z-index:1; user-select:none; }
        .recent-row-inner.swiped { transform:translateX(-64px); border-radius:12px 0 0 12px; }
        .recent-row-inner.editing { flex-direction:column; align-items:stretch; gap:6px; }
        .recent-row-top { display:flex; align-items:center; gap:8px; flex:1; min-width:0; }
        .recent-swipe-del { position:absolute; right:0; top:0; bottom:0; width:64px; background:#ef4444; color:#fff; border:none; cursor:pointer; display:flex; align-items:center; justify-content:center; border-radius:0 12px 12px 0; }
        .recent-swipe-del:active { background:#dc2626; }
        .recent-dot { width:8px; height:8px; border-radius:50%; flex-shrink:0; }
        .recent-info { flex:1; display:flex; flex-direction:column; gap:1px; min-width:0; }
        .recent-cat { font-size:.78rem; font-weight:600; color:var(--foreground); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .recent-time { font-size:.65rem; color:var(--fg-muted); }
        .recent-dur-wrap { flex-shrink:0; }
        .recent-dur-btn { display:flex; align-items:center; gap:4px; font-size:.8rem; font-weight:700; color:var(--primary); background:transparent; border:none; cursor:pointer; padding:3px 6px; border-radius:6px; }
        .recent-dur-btn:hover { background:color-mix(in srgb,var(--primary) 10%,transparent); }
        .recent-edit-icon { opacity:.5; }
        .recent-edit-area { display:flex; flex-direction:column; gap:5px; }
        .recent-edit-row { display:flex; align-items:center; gap:3px; }
        .recent-edit-time { width:76px; background:var(--background); border:1.5px solid var(--primary); border-radius:6px; padding:3px 5px; font-size:.78rem; font-weight:600; color:var(--foreground); outline:none; font-family:inherit; }
        .recent-edit-sep { font-size:.72rem; color:var(--fg-muted); font-weight:600; }
        .recent-confirm-btn { width:22px; height:22px; border-radius:6px; background:var(--primary); border:none; color:#fff; cursor:pointer; display:flex; align-items:center; justify-content:center; flex-shrink:0; }
        .recent-cat-edit-row { display:flex; gap:5px; flex-wrap:wrap; align-items:center; padding:2px 0; }
        .rce-chip { display:flex; align-items:center; gap:4px; padding:3px 9px; border-radius:99px; font-size:.7rem; font-weight:600; background:var(--background); border:1.5px solid var(--border); color:var(--fg-muted); cursor:pointer; white-space:nowrap; transition:all .12s; }
        .rce-chip.rce-chip-active { border-color:var(--primary); color:var(--primary); background:color-mix(in srgb,var(--primary) 10%,var(--background)); }
        .rce-dot { width:7px; height:7px; border-radius:50%; flex-shrink:0; }

        /* ── Stats ── */
        .period-row { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
        .period-btn { padding:7px 20px; border-radius:20px; font-size:.8rem; font-weight:700; cursor:pointer; background:var(--accent); border:1.5px solid var(--border); color:var(--fg-muted); transition:all .15s; }
        .period-btn.active { background:var(--primary); color:#fff; border-color:var(--primary); }
        .period-nav { display:flex; align-items:center; gap:4px; margin-left:auto; }
        .period-nav-btn { width:28px; height:28px; display:flex; align-items:center; justify-content:center; border-radius:8px; background:var(--accent); border:1px solid var(--border); color:var(--fg-muted); cursor:pointer; transition:all .15s; }
        .period-nav-btn:hover:not(:disabled) { color:var(--primary); border-color:var(--primary); }
        .period-nav-btn:disabled { opacity:.3; cursor:default; }
        .period-nav-label { font-size:.72rem; font-weight:600; color:var(--fg-muted); white-space:nowrap; padding:0 4px; min-width:80px; text-align:center; }
        .summary-row { display:flex; gap:10px; }
        .summary-card { flex:1; background:var(--accent); border:1px solid var(--border); border-radius:14px; padding:14px; display:flex; flex-direction:column; align-items:center; gap:4px; }
        .summary-val { font-size:1.5rem; font-weight:800; color:var(--foreground); }
        .summary-lbl { font-size:.68rem; font-weight:600; color:var(--fg-muted); text-align:center; }

        .chart-card { background:var(--accent); border:1px solid var(--border); border-radius:14px; padding:14px; }
        .chart-title { font-size:.75rem; font-weight:700; color:var(--fg-muted); margin-bottom:10px; }
        .bar-chart { display:flex; gap:3px; align-items:flex-end; height:130px; }
        .bar-col { flex:1; display:flex; flex-direction:column; align-items:center; gap:3px; height:100%; min-width:0; cursor:pointer; }
        .bar-wrap { flex:1; width:100%; display:flex; align-items:flex-end; }
        .bar-stack { width:100%; display:flex; flex-direction:column-reverse; border-radius:4px 4px 0 0; overflow:hidden; transition:height .4s ease; }
        .bar-stack.cur { outline:2px solid var(--primary); outline-offset:-1px; }
        .bar-stack.sel { outline:2px solid var(--primary); outline-offset:-1px; opacity:1; filter:brightness(1.15); }
        .bar-seg { width:100%; min-height:1px; }
        .bar-label { font-size:0.58rem; color:var(--fg-muted); text-align:center; white-space:nowrap; overflow:hidden; width:100%; text-overflow:ellipsis; }
        .bar-label.sel { color:var(--primary); font-weight:800; }
        .bar-detail { margin-top:12px; background:var(--background); border:1px solid var(--border); border-radius:12px; padding:11px 14px; display:flex; flex-direction:column; gap:6px; animation:fadeUp .18s ease; }
        @keyframes fadeUp { from { opacity:0; transform:translateY(4px); } to { opacity:1; transform:translateY(0); } }
        .bar-detail-label { font-size:.7rem; font-weight:700; color:var(--fg-muted); }
        .bar-detail-total { font-size:1.1rem; font-weight:800; color:var(--foreground); }
        .bar-detail-segs { display:flex; flex-direction:column; gap:4px; margin-top:2px; }
        .bar-detail-seg { display:flex; align-items:center; gap:7px; }
        .bar-detail-dot { width:8px; height:8px; border-radius:50%; flex-shrink:0; }
        .bar-detail-name { flex:1; font-size:.8rem; color:var(--foreground); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .bar-detail-time { font-size:.78rem; font-weight:700; color:var(--fg-muted); font-variant-numeric:tabular-nums; flex-shrink:0; }

        .cat-breakdown { background:var(--accent); border:1px solid var(--border); border-radius:14px; padding:14px; display:flex; flex-direction:column; gap:10px; }
        .breakdown-title { font-size:.75rem; font-weight:700; color:var(--fg-muted); }
        .breakdown-row { display:flex; flex-direction:column; gap:4px; }
        .breakdown-head { display:flex; align-items:center; gap:7px; }
        .breakdown-dot { width:8px; height:8px; border-radius:50%; flex-shrink:0; }
        .breakdown-name { flex:1; font-size:.82rem; color:var(--foreground); font-weight:500; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .breakdown-time { font-size:.78rem; color:var(--fg-muted); font-weight:600; font-variant-numeric:tabular-nums; flex-shrink:0; }
        .breakdown-bar-bg { height:5px; background:rgba(0,0,0,0.1); border-radius:99px; overflow:hidden; }
        .breakdown-bar-fill { height:100%; border-radius:99px; transition:width .5s ease; }

        .no-sessions { display:flex; flex-direction:column; align-items:center; gap:10px; padding:30px 0; text-align:center; color:var(--fg-muted); font-size:.88rem; }
        .no-sessions-img { width:100px; height:100px; object-fit:contain; opacity:.7; animation:float 3s ease-in-out infinite; }
        .no-sessions-sub { font-size:.78rem; }
        @keyframes float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-6px)} }

        /* ── Bottom nav — hidden everywhere (mobile uses BackBubble) ── */
        .st-bottom-nav { display:none; }
      `}</style>
    </div>
  );
}
