import { liveQuery } from 'dexie';
import { db, newSyncId } from './db';
import type { Note, Folder, StudySession, StudyCategory, Exam, ScheduleDay, SavedChat, Todo } from './db';

const PUSH_DEBOUNCE_MS  = 3_000;
const POLL_INTERVAL_MS  = 30_000;
const MERGE_SUPPRESS_MS = 12_000; // suppress push triggers right after a merge

interface LiveSnapshot {
  notes:            Note[];
  folders:          Folder[];
  studySessions:    StudySession[];
  studyCategories:  StudyCategory[];
  exams:            Exam[];
  scheduleDays:     ScheduleDay[];
  savedChats:       SavedChat[];
  todos:            Todo[];
  ts: number;
}

let _key            = '';
let _lastSyncTs     = 0;
let _isMerging      = false;
let _suppressUntil  = 0;
let _pushTimer:   ReturnType<typeof setTimeout>  | null = null;
let _pollTimer:   ReturnType<typeof setInterval> | null = null;
let _dexieSub:    { unsubscribe: () => void }    | null = null;

// ── Build local snapshot ─────────────────────────────────────────
async function buildSnapshot(): Promise<LiveSnapshot> {
  const [notes, folders, studySessions, studyCategories, exams, scheduleDays, savedChats, todos] = await Promise.all([
    db.notes.toArray(),
    db.folders.toArray(),
    db.studySessions.toArray(),
    db.studyCategories.toArray(),
    db.exams.toArray(),
    db.scheduleDays.toArray(),
    db.savedChats.toArray(),
    db.todos.toArray(),
  ]);
  return { notes, folders, studySessions, studyCategories, exams, scheduleDays, savedChats, todos, ts: Date.now() };
}

// ── Push to Redis ────────────────────────────────────────────────
async function push() {
  if (!_key || _isMerging) return;
  try {
    const snapshot = await buildSnapshot();
    const body = JSON.stringify({ key: _key, snapshot });
    if (body.length > 7.5 * 1024 * 1024) return; // safety: skip if too large
    await fetch('/api/sync/live', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
  } catch { /* network error — will retry on next change */ }
}

function schedulePush() {
  if (_isMerging || Date.now() < _suppressUntil) return;
  if (_pushTimer) clearTimeout(_pushTimer);
  _pushTimer = setTimeout(() => void push(), PUSH_DEBOUNCE_MS);
}

// ── Merge remote snapshot into local DB ─────────────────────────
async function mergeSnapshot(remote: LiveSnapshot) {
  _isMerging = true;
  try {
    // Notes: syncId-based, newer updatedAt wins
    for (const r of remote.notes) {
      if (!r.syncId) continue;
      const local = await db.notes.where('syncId').equals(r.syncId).first();
      if (!local) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { id: _id, ...rest } = r;
        await db.notes.add({ ...rest, syncId: r.syncId || newSyncId() });
      } else if ((r.updatedAt ?? 0) > (local.updatedAt ?? 0)) {
        await db.notes.update(local.id!, r);
      }
    }

    // Folders: syncId-based, newer updatedAt wins
    for (const r of remote.folders) {
      if (!r.syncId) continue;
      const local = await db.folders.where('syncId').equals(r.syncId).first();
      if (!local) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { id: _id, ...rest } = r;
        await db.folders.add({ ...rest, syncId: r.syncId || newSyncId() });
      } else if ((r.updatedAt ?? 0) > (local.updatedAt ?? 0)) {
        await db.folders.update(local.id!, r);
      }
    }

    // Study sessions: union by date+startTime (additive — never delete)
    const localSessions = await db.studySessions.toArray();
    const sessionKeys = new Set(localSessions.map(s => `${s.date}|${s.startTime}`));
    for (const r of remote.studySessions) {
      if (!sessionKeys.has(`${r.date}|${r.startTime}`)) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { id: _id, ...rest } = r;
        await db.studySessions.add(rest as StudySession);
      }
    }

    // Study categories: union by name
    const localCats = await db.studyCategories.toArray();
    const catNames = new Set(localCats.map(c => c.name));
    for (const r of remote.studyCategories) {
      if (!catNames.has(r.name)) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { id: _id, ...rest } = r;
        await db.studyCategories.add(rest as StudyCategory);
      }
    }

    // Exams: union by name+examDate
    const localExams = await db.exams.toArray();
    const examKeys = new Set(localExams.map(e => `${e.name}|${e.examDate}`));
    for (const r of remote.exams) {
      if (!examKeys.has(`${r.name}|${r.examDate}`)) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { id: _id, ...rest } = r;
        await db.exams.add(rest as Exam);
      }
    }

    // Schedule days: add missing dates only
    const localDays = await db.scheduleDays.toArray();
    const dayDates = new Set(localDays.map(d => d.date));
    for (const r of remote.scheduleDays) {
      if (!dayDates.has(r.date)) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { id: _id, ...rest } = r;
        await db.scheduleDays.add(rest as ScheduleDay);
      }
    }

    // Saved chats: union by createdAt (each chat is immutable after creation)
    if (remote.savedChats?.length) {
      const localChats = await db.savedChats.toArray();
      const chatKeys = new Set(localChats.map(c => c.createdAt));
      for (const r of remote.savedChats) {
        if (!chatKeys.has(r.createdAt)) {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { id: _id, ...rest } = r;
          await db.savedChats.add(rest as SavedChat);
        }
      }
    }

    // Todos: tombstone-aware — deletedAt propagates across devices
    // Rule: once deleted, stays deleted (deletion always wins)
    if (remote.todos !== undefined) {
      const localTodos = await db.todos.toArray(); // includes soft-deleted
      const todoMap = new Map(localTodos.map(t => [t.createdAt, t]));
      for (const r of remote.todos) {
        const local = todoMap.get(r.createdAt);
        if (!local) {
          if (!r.deletedAt) {
            // New todo from remote, not deleted → add it
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { id: _id, ...rest } = r;
            await db.todos.add(rest as Todo);
          }
          // Remote has deletedAt but we don't have the record → already gone, skip
        } else if (r.deletedAt && !local.deletedAt) {
          // Remote deleted it, we still have it → apply tombstone
          await db.todos.update(local.id!, { deletedAt: r.deletedAt });
        } else if (!r.deletedAt && !local.deletedAt) {
          // Both alive → sync done/pinned state
          if (r.done !== local.done || r.pinned !== local.pinned) {
            await db.todos.update(local.id!, { done: r.done, pinned: r.pinned });
          }
        }
        // local.deletedAt is set (deleted locally) → keep local deletion, never restore
      }
    }
  } finally {
    _isMerging = false;
    _suppressUntil = Date.now() + MERGE_SUPPRESS_MS;
    _lastSyncTs = remote.ts;
    localStorage.setItem('lily_livesync_ts', String(_lastSyncTs));
  }
}

// ── Poll Redis for remote changes ────────────────────────────────
async function poll() {
  if (!_key) return;
  try {
    const res = await fetch(
      `/api/sync/live?key=${encodeURIComponent(_key)}&since=${_lastSyncTs}`,
    );
    if (!res.ok) return;
    const json = await res.json() as { changed: boolean; ts?: number; snapshot?: LiveSnapshot };
    if (!json.changed || !json.snapshot) return;
    await mergeSnapshot(json.snapshot);
  } catch { /* network error */ }
}

// ── Public API ───────────────────────────────────────────────────
export function initLiveSync(key: string) {
  if (_key === key && _pollTimer) return; // already running with same key
  stopLiveSync();

  _key        = key;
  _lastSyncTs = Number(localStorage.getItem('lily_livesync_ts') ?? 0);

  // Watch Dexie for local changes
  const obs = liveQuery(() => Promise.all([
    db.notes.orderBy('updatedAt').last().then(n => n?.updatedAt ?? 0),
    db.studySessions.count(),
    db.studyCategories.count(),
    db.exams.count(),
    db.savedChats.count(),
    db.todos.count(),
  ]));
  _dexieSub = obs.subscribe(() => schedulePush());

  _pollTimer = setInterval(() => void poll(), POLL_INTERVAL_MS);
  void poll(); // pull immediately on init
}

export function stopLiveSync() {
  if (_pushTimer)  { clearTimeout(_pushTimer);   _pushTimer  = null; }
  if (_pollTimer)  { clearInterval(_pollTimer);  _pollTimer  = null; }
  if (_dexieSub)   { _dexieSub.unsubscribe();    _dexieSub   = null; }
  _key = '';
}

export function isLiveSyncActive(): boolean {
  return !!_key;
}
