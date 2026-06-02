'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Play, Square, Plus, Trash2, BarChart2, Timer, ArrowLeft,
  Book, FileText, Brush, Sparkles, Settings as SettingsIcon, GraduationCap,
  Flame, Share2, X, Copy, Check,
} from 'lucide-react';
import { db } from '@/lib/db';
import type { StudyCategory } from '@/lib/db';
import { buildSyncJson, restoreSyncFromJson } from '@/lib/backup';

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
  if (h > 0) return `${h}h${m > 0 ? m + 'm' : ''}`;
  if (m > 0) return `${m}m`;
  return secs > 0 ? `${secs}s` : '0m';
}

function pastDays(n: number): string[] {
  const today = new Date(todayStr() + 'T00:00:00');
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - (n - 1 - i));
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  });
}

function shortLabel(ds: string): string {
  const d = new Date(ds + 'T00:00:00');
  return `${d.getMonth()+1}/${d.getDate()}`;
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
      continue; // today might not have study yet
    } else {
      break;
    }
  }
  return streak;
}

function randCode(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

// ── Props ─────────────────────────────────────────────────────────────────────
export interface StudyTrackerProps {
  onSwitchTab?: (tab: string) => void;
  onOpenSettings: () => void;
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function StudyTracker({ onSwitchTab, onOpenSettings }: StudyTrackerProps) {
  const [view, setView] = useState<'timer' | 'stats'>('timer');
  const [statsDays, setStatsDays] = useState<7 | 30>(7);

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

  // Sync modal
  const [showSync, setShowSync] = useState(false);
  const [syncMode, setSyncMode] = useState<'export' | 'import'>('export');
  const [syncCode, setSyncCode] = useState('');
  const [syncInput, setSyncInput] = useState('');
  const [syncStatus, setSyncStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');
  const [syncMsg, setSyncMsg] = useState('');
  const [copied, setCopied] = useState(false);

  // DB
  const categories = useLiveQuery(() => db.studyCategories.orderBy('createdAt').toArray(), []) ?? [];
  const sessions = useLiveQuery(() => db.studySessions.orderBy('startTime').toArray(), []) ?? [];

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
    const id = await db.studyCategories.add({ name, color: newCatColor, createdAt: Date.now() });
    setSelectedCatId(id as number);
    localStorage.setItem(LS_KEY_CAT, String(id));
    localStorage.setItem(LS_KEY_CAT_NAME, name);
    localStorage.setItem(LS_KEY_CAT_COLOR, newCatColor);
    setNewCatName('');
    setNewCatColor(PRESET_COLORS[Math.floor(Math.random() * PRESET_COLORS.length)]);
    setShowAddCat(false);
  }, [newCatName, newCatColor]);

  const deleteCat = useCallback(async (id: number) => {
    await db.studyCategories.delete(id);
    if (selectedCatId === id) selectCat(null);
  }, [selectedCatId, selectCat]);

  // ── Stats ──────────────────────────────────────────────────────────────────
  const today = todayStr();
  const todayTotal = sessions.filter(s => s.date === today).reduce((sum, s) => sum + s.duration, 0);
  const sessionDates = new Set<string>(sessions.map(s => s.date as string));
  const streak = calcStreak(sessionDates);
  const days = pastDays(statsDays);
  const dayTotals = days.map(d => sessions.filter(s => s.date === d).reduce((sum, s) => sum + s.duration, 0));
  const maxTotal = Math.max(...dayTotals, 60);
  const periodSessions = sessions.filter(s => s.date >= days[0]);
  const periodTotal = periodSessions.reduce((sum, s) => sum + s.duration, 0);
  const catMap = new Map<string, { name: string; color: string; secs: number }>();
  for (const s of periodSessions) {
    const key = s.categoryId !== null ? `c${s.categoryId}` : 'none';
    const prev = catMap.get(key);
    catMap.set(key, { name: s.categoryName ?? 'カテゴリなし', color: s.categoryColor ?? '#94a3b8', secs: (prev?.secs ?? 0) + s.duration });
  }
  const catTotals = [...catMap.values()].sort((a, b) => b.secs - a.secs);
  const selectedCat = categories.find(c => c.id === selectedCatId) ?? null;

  // ── Sync ──────────────────────────────────────────────────────────────────
  const doExport = useCallback(async () => {
    setSyncStatus('loading');
    setSyncMsg('');
    try {
      const code = randCode();
      const payload = await buildSyncJson();
      const res = await fetch(`/api/sync/${code}`, {
        method: 'POST',
        body: payload,
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSyncCode(code);
      setSyncStatus('ok');
      setSyncMsg('コードを相手のデバイスに入力してください。5分間有効です。');
    } catch (e) {
      setSyncStatus('error');
      setSyncMsg(e instanceof Error ? e.message : 'エラーが発生しました');
    }
  }, []);

  const doImport = useCallback(async () => {
    const code = syncInput.trim().toUpperCase();
    if (!code) return;
    setSyncStatus('loading');
    setSyncMsg('');
    try {
      const res = await fetch(`/api/sync/${code}`);
      if (res.status === 404) throw new Error('コードが見つかりません。期限切れか間違いがあります。');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const jsonText = await res.text();
      await restoreSyncFromJson(jsonText);
      setSyncStatus('ok');
      setSyncMsg('同期完了！すべてのデータを取り込みました。');
      setSyncInput('');
    } catch (e) {
      setSyncStatus('error');
      setSyncMsg(e instanceof Error ? e.message : 'エラーが発生しました');
    }
  }, [syncInput]);

  const copyCode = useCallback(() => {
    navigator.clipboard.writeText(syncCode).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [syncCode]);

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
        </div>
        <button className="sync-icon-btn" onClick={() => { setShowSync(true); setSyncStatus('idle'); setSyncMsg(''); setSyncCode(''); setSyncInput(''); }} title="デバイス同期">
          <Share2 size={16} />
        </button>
      </div>

      {/* ── Timer view ── */}
      {view === 'timer' && (
        <div className="st-scroll">
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

          {/* Today total */}
          <div className="today-card">
            <span className="today-label">今日の学習</span>
            <span className="today-total">{fmtDur(todayTotal + (isRunning ? elapsed : 0))}</span>
          </div>
        </div>
      )}

      {/* ── Stats view ── */}
      {view === 'stats' && (
        <div className="st-scroll">
          <div className="period-row">
            <button className={`period-btn ${statsDays === 7 ? 'active' : ''}`} onClick={() => setStatsDays(7)}>7日間</button>
            <button className={`period-btn ${statsDays === 30 ? 'active' : ''}`} onClick={() => setStatsDays(30)}>30日間</button>
          </div>

          <div className="summary-row">
            <div className="summary-card">
              <Flame size={18} style={{ color: '#f97316' }} />
              <span className="summary-val">{streak}</span>
              <span className="summary-lbl">連続日数</span>
            </div>
            <div className="summary-card">
              <span className="summary-val">{fmtDur(periodTotal)}</span>
              <span className="summary-lbl">{statsDays}日間合計</span>
            </div>
          </div>

          {sessions.length > 0 ? (
            <>
              <div className="chart-card">
                <p className="chart-title">日別学習時間</p>
                <div className="bar-chart">
                  {days.map((d, i) => (
                    <div key={d} className="bar-col">
                      <div className="bar-time">{dayTotals[i] > 0 ? fmtDur(dayTotals[i]) : ''}</div>
                      <div className="bar-wrap">
                        <div
                          className={`bar-fill ${d === today ? 'today' : ''}`}
                          style={{ height: `${Math.max(Math.round((dayTotals[i] / maxTotal) * 100), dayTotals[i] > 0 ? 4 : 0)}%` }}
                        />
                      </div>
                      <span className="bar-label">{shortLabel(d)}</span>
                    </div>
                  ))}
                </div>
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

      {/* ── Sync modal ── */}
      {showSync && (
        <div className="sync-overlay" onClick={e => { if (e.target === e.currentTarget) setShowSync(false); }}>
          <div className="sync-modal">
            <div className="sync-modal-head">
              <span className="sync-modal-title">📡 デバイス同期</span>
              <button className="sync-close" onClick={() => setShowSync(false)}><X size={18} /></button>
            </div>
            <p className="sync-desc">メモ・フォルダ・学習記録など、すべてのデータをデバイス間でコピーします。受信側のデータは送信側で上書きされます。</p>
            <div className="sync-mode-row">
              <button className={`sync-mode-btn ${syncMode === 'export' ? 'active' : ''}`} onClick={() => { setSyncMode('export'); setSyncStatus('idle'); setSyncMsg(''); setSyncCode(''); }}>
                このデバイスから送る
              </button>
              <button className={`sync-mode-btn ${syncMode === 'import' ? 'active' : ''}`} onClick={() => { setSyncMode('import'); setSyncStatus('idle'); setSyncMsg(''); }}>
                コードを受け取る
              </button>
            </div>

            {syncMode === 'export' && (
              <div className="sync-body">
                {syncStatus !== 'ok' ? (
                  <button className="sync-action-btn" onClick={() => void doExport()} disabled={syncStatus === 'loading'}>
                    {syncStatus === 'loading' ? '処理中...' : 'コードを生成して送信'}
                  </button>
                ) : (
                  <div className="sync-code-display">
                    <span className="sync-code-label">同期コード</span>
                    <div className="sync-code-row">
                      <span className="sync-code">{syncCode}</span>
                      <button className="sync-copy-btn" onClick={copyCode}>
                        {copied ? <Check size={14} /> : <Copy size={14} />}
                        {copied ? 'コピー済み' : 'コピー'}
                      </button>
                    </div>
                  </div>
                )}
                {syncMsg && <p className={`sync-msg ${syncStatus}`}>{syncMsg}</p>}
              </div>
            )}

            {syncMode === 'import' && (
              <div className="sync-body">
                <p className="sync-warn">⚠️ このデバイスの全データが送信元で上書きされます</p>
                <input
                  className="sync-input"
                  value={syncInput}
                  onChange={e => setSyncInput(e.target.value.toUpperCase())}
                  placeholder="コードを入力 (例: AB12CD)"
                  maxLength={8}
                />
                <button className="sync-action-btn" onClick={() => void doImport()} disabled={syncStatus === 'loading' || !syncInput.trim()}>
                  {syncStatus === 'loading' ? '取得中...' : '全データを同期'}
                </button>
                {syncMsg && <p className={`sync-msg ${syncStatus}`}>{syncMsg}</p>}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Bottom nav */}
      {onSwitchTab && (
        <nav className="st-bottom-nav">
          <button className="snav-item" onClick={() => onSwitchTab('memos')}><Book size={22}/><span>メモ</span></button>
          <button className="snav-item" onClick={() => onSwitchTab('sketch')}><Brush size={22}/><span>落書き</span></button>
          <button className="snav-item" onClick={() => onSwitchTab('pdf')}><FileText size={22}/><span>PDF</span></button>
          <button className="snav-item" onClick={() => onSwitchTab('ai')}><Sparkles size={22}/><span>AI</span></button>
          <button className="snav-item active"><GraduationCap size={22}/><span>学習</span></button>
          <button className="snav-item" onClick={() => { onSwitchTab('settings'); onOpenSettings(); }}><SettingsIcon size={22}/><span>設定</span></button>
        </nav>
      )}

      <style jsx>{`
        .st-container { display:flex; flex-direction:column; height:100%; background:var(--background); overflow:hidden; }
        .st-header { display:flex; align-items:center; gap:8px; padding:10px 14px; border-bottom:1px solid var(--border); background:var(--glass-tint,rgba(255,255,255,0.9)); backdrop-filter:blur(20px); -webkit-backdrop-filter:blur(20px); flex-shrink:0; }
        .st-back { width:34px; height:34px; display:flex; align-items:center; justify-content:center; border-radius:10px; background:var(--accent); border:1px solid var(--border); color:var(--foreground); cursor:pointer; flex-shrink:0; }
        .st-back:hover { opacity:.75; }
        .st-title { font-size:.9rem; font-weight:800; color:var(--foreground); flex:1; }
        .st-tabs { display:flex; gap:4px; }
        .st-tab { display:flex; align-items:center; gap:4px; background:var(--accent); border:1px solid var(--border); border-radius:16px; padding:5px 11px; font-size:.75rem; font-weight:600; color:var(--fg-muted); cursor:pointer; white-space:nowrap; transition:all .15s; }
        .st-tab.active { background:var(--primary); color:#fff; border-color:var(--primary); }
        .sync-icon-btn { width:32px; height:32px; display:flex; align-items:center; justify-content:center; border-radius:8px; background:transparent; border:1px solid var(--border); color:var(--fg-muted); cursor:pointer; flex-shrink:0; }
        .sync-icon-btn:hover { color:var(--primary); border-color:var(--primary); }

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

        /* ── Stats ── */
        .period-row { display:flex; gap:8px; }
        .period-btn { padding:7px 20px; border-radius:20px; font-size:.8rem; font-weight:700; cursor:pointer; background:var(--accent); border:1.5px solid var(--border); color:var(--fg-muted); transition:all .15s; }
        .period-btn.active { background:var(--primary); color:#fff; border-color:var(--primary); }
        .summary-row { display:flex; gap:10px; }
        .summary-card { flex:1; background:var(--accent); border:1px solid var(--border); border-radius:14px; padding:14px; display:flex; flex-direction:column; align-items:center; gap:4px; }
        .summary-val { font-size:1.5rem; font-weight:800; color:var(--foreground); }
        .summary-lbl { font-size:.68rem; font-weight:600; color:var(--fg-muted); }

        .chart-card { background:var(--accent); border:1px solid var(--border); border-radius:14px; padding:14px; }
        .chart-title { font-size:.75rem; font-weight:700; color:var(--fg-muted); margin-bottom:10px; }
        .bar-chart { display:flex; gap:3px; align-items:flex-end; height:130px; }
        .bar-col { flex:1; display:flex; flex-direction:column; align-items:center; gap:3px; height:100%; min-width:0; }
        .bar-time { font-size:0.55rem; color:var(--fg-muted); height:14px; display:flex; align-items:flex-end; white-space:nowrap; }
        .bar-wrap { flex:1; width:100%; display:flex; align-items:flex-end; }
        .bar-fill { width:100%; min-height:0; border-radius:3px 3px 0 0; background:rgba(99,102,241,0.35); transition:height .4s ease; }
        .bar-fill.today { background:var(--primary); }
        .bar-label { font-size:0.58rem; color:var(--fg-muted); text-align:center; white-space:nowrap; overflow:hidden; width:100%; text-overflow:ellipsis; }

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

        /* ── Sync modal ── */
        .sync-overlay { position:fixed; inset:0; z-index:8000; background:rgba(0,0,0,0.5); display:flex; align-items:center; justify-content:center; padding:20px; }
        .sync-modal { background:var(--background); border:1px solid var(--border); border-radius:20px; padding:20px; width:100%; max-width:380px; display:flex; flex-direction:column; gap:14px; }
        .sync-modal-head { display:flex; align-items:center; justify-content:space-between; }
        .sync-modal-title { font-size:1rem; font-weight:800; color:var(--foreground); }
        .sync-close { width:30px; height:30px; display:flex; align-items:center; justify-content:center; border-radius:8px; background:var(--accent); border:1px solid var(--border); color:var(--fg-muted); cursor:pointer; }
        .sync-desc { font-size:.78rem; color:var(--fg-muted); line-height:1.5; }
        .sync-mode-row { display:flex; gap:8px; }
        .sync-mode-btn { flex:1; padding:8px 12px; border-radius:10px; font-size:.78rem; font-weight:600; cursor:pointer; background:var(--accent); border:1.5px solid var(--border); color:var(--fg-muted); transition:all .15s; }
        .sync-mode-btn.active { background:var(--primary); color:#fff; border-color:var(--primary); }
        .sync-body { display:flex; flex-direction:column; gap:10px; }
        .sync-action-btn { background:var(--primary); color:#fff; border:none; border-radius:12px; padding:11px 20px; font-size:.9rem; font-weight:700; cursor:pointer; }
        .sync-action-btn:disabled { opacity:.5; cursor:default; }
        .sync-code-display { display:flex; flex-direction:column; gap:6px; background:var(--accent); border:1px solid var(--border); border-radius:12px; padding:14px; }
        .sync-code-label { font-size:.72rem; font-weight:600; color:var(--fg-muted); }
        .sync-code-row { display:flex; align-items:center; gap:10px; }
        .sync-code { font-size:2rem; font-weight:900; letter-spacing:.15em; color:var(--primary); font-variant-numeric:tabular-nums; flex:1; }
        .sync-copy-btn { display:flex; align-items:center; gap:5px; background:var(--background); border:1px solid var(--border); border-radius:8px; padding:7px 12px; font-size:.75rem; font-weight:600; cursor:pointer; color:var(--fg-muted); }
        .sync-input { width:100%; background:var(--accent); border:1.5px solid var(--border); border-radius:10px; padding:10px 14px; font-size:1.1rem; font-weight:700; letter-spacing:.1em; color:var(--foreground); outline:none; font-family:inherit; text-transform:uppercase; }
        .sync-input:focus { border-color:var(--primary); }
        .sync-msg { font-size:.8rem; font-weight:600; padding:8px 12px; border-radius:8px; }
        .sync-warn { font-size:.75rem; font-weight:600; color:#f59e0b; background:rgba(245,158,11,0.1); border:1px solid rgba(245,158,11,0.3); border-radius:8px; padding:7px 10px; }
        .sync-msg.ok { background:rgba(16,185,129,0.12); color:#10b981; }
        .sync-msg.error { background:rgba(239,68,68,0.12); color:#ef4444; }

        /* ── Bottom nav ── */
        .st-bottom-nav { display:none; flex-shrink:0; }
        @media (max-width:1023px) {
          .st-bottom-nav { display:flex; height:calc(56px + env(safe-area-inset-bottom)); background:var(--glass-tint,rgba(255,255,255,0.9)); backdrop-filter:blur(20px); -webkit-backdrop-filter:blur(20px); border-top:1px solid var(--border); padding-bottom:env(safe-area-inset-bottom); order:99; }
          .snav-item { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:3px; background:transparent; color:var(--fg-muted); transition:color .15s; border:none; cursor:pointer; }
          .snav-item.active { color:var(--primary); }
          .snav-item span { font-size:.65rem; font-weight:600; }
        }
      `}</style>
    </div>
  );
}
