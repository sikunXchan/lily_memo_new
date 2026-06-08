import { liveQuery } from 'dexie';
import { db, newSyncId } from './db';
import type { Note, Folder, StudySession, StudyCategory, Exam, ScheduleDay, SavedChat, Todo, EarnedBadge, ProblemSet } from './db';

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
  earnedBadges:     EarnedBadge[];
  problemSets:      ProblemSet[];
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
  const [notes, folders, studySessions, studyCategories, exams, scheduleDays, savedChats, todos, earnedBadges, problemSets] = await Promise.all([
    db.notes.toArray(),
    db.folders.toArray(),
    db.studySessions.toArray(),
    db.studyCategories.toArray(),
    db.exams.toArray(),
    db.scheduleDays.toArray(),
    db.savedChats.toArray(),
    db.todos.toArray(),
    db.earnedBadges.toArray(),
    db.problemSets.toArray(),
  ]);
  return { notes, folders, studySessions, studyCategories, exams, scheduleDays, savedChats, todos, earnedBadges, problemSets, ts: Date.now() };
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
    // Notes: syncId-based, newer updatedAt wins. Tombstones (deletedAt) carry a
    // bumped updatedAt, so a remote deletion overwrites an older live local copy.
    for (const r of remote.notes) {
      if (!r.syncId) continue;
      const local = await db.notes.where('syncId').equals(r.syncId).first();
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { id: _id, ...rest } = r; // never carry the remote device's auto-id
      if (!local) {
        await db.notes.add({ ...rest, syncId: r.syncId || newSyncId() });
      } else if ((r.updatedAt ?? 0) > (local.updatedAt ?? 0)) {
        await db.notes.update(local.id!, rest);
      }
    }

    // Folders: syncId-based, newer updatedAt wins (same tombstone rules).
    for (const r of remote.folders) {
      if (!r.syncId) continue;
      const local = await db.folders.where('syncId').equals(r.syncId).first();
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { id: _id, ...rest } = r; // never carry the remote device's auto-id
      if (!local) {
        await db.folders.add({ ...rest, syncId: r.syncId || newSyncId() });
      } else if ((r.updatedAt ?? 0) > (local.updatedAt ?? 0)) {
        await db.folders.update(local.id!, rest);
      }
    }

    // Study sessions: per-record last-write-wins keyed by syncId. updatedAt is
    // the version clock (bumped on edit AND on soft-delete), so a deletion wins
    // over an older live copy — no more resurrection of deleted history.
    {
      const localSessions = await db.studySessions.toArray();
      const map = new Map(localSessions.filter(s => s.syncId).map(s => [s.syncId!, s]));
      for (const r of remote.studySessions) {
        if (!r.syncId) continue;
        const local = map.get(r.syncId);
        const rUpdated = r.updatedAt ?? r.startTime;
        if (!local) {
          if (!r.deletedAt) {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { id: _id, ...rest } = r;
            await db.studySessions.add(rest as StudySession);
          }
        } else if (rUpdated > (local.updatedAt ?? local.startTime)) {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { id: _id, ...rest } = r;
          await db.studySessions.update(local.id!, rest);
        }
      }
    }

    // Study categories: per-record last-write-wins keyed by syncId.
    {
      const localCats = await db.studyCategories.toArray();
      const map = new Map(localCats.filter(c => c.syncId).map(c => [c.syncId!, c]));
      for (const r of remote.studyCategories) {
        if (!r.syncId) continue;
        const local = map.get(r.syncId);
        const rUpdated = r.updatedAt ?? r.createdAt;
        if (!local) {
          if (!r.deletedAt) {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { id: _id, ...rest } = r;
            await db.studyCategories.add(rest as StudyCategory);
          }
        } else if (rUpdated > (local.updatedAt ?? local.createdAt)) {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { id: _id, ...rest } = r;
          await db.studyCategories.update(local.id!, rest);
        }
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

    // Earned badges: additive union by badgeId. Badges are never revoked, so
    // we only add missing ones; if both sides have it, keep the earliest date.
    if (remote.earnedBadges?.length) {
      const localBadges = await db.earnedBadges.toArray();
      const badgeMap = new Map(localBadges.map(b => [b.badgeId, b]));
      for (const r of remote.earnedBadges) {
        const local = badgeMap.get(r.badgeId);
        if (!local) {
          await db.earnedBadges.put({ badgeId: r.badgeId, earnedAt: r.earnedAt });
        } else if (r.earnedAt < local.earnedAt) {
          await db.earnedBadges.put({ badgeId: r.badgeId, earnedAt: r.earnedAt });
        }
      }
    }

    // Problem sets: union by createdAt (immutable after creation).
    if (remote.problemSets?.length) {
      const localSets = await db.problemSets.toArray();
      const setKeys = new Set(localSets.map(p => p.createdAt));
      for (const r of remote.problemSets) {
        if (!setKeys.has(r.createdAt)) {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { id: _id, ...rest } = r;
          await db.problemSets.add(rest as ProblemSet);
        }
      }
    }

    // Todos: per-record last-write-wins keyed by createdAt (stable across
    // devices). updatedAt is the version clock — it is bumped on every
    // mutation INCLUDING soft-delete, so a deletion always carries a fresh
    // timestamp and wins over an older "alive" copy on the other device.
    // This prevents the "deleted-but-it-came-back" resurrection bug.
    if (remote.todos !== undefined) {
      const localTodos = await db.todos.toArray(); // includes soft-deleted tombstones
      const todoMap = new Map(localTodos.map(t => [t.createdAt, t]));
      for (const r of remote.todos) {
        const rUpdated = r.updatedAt ?? r.createdAt;
        const local = todoMap.get(r.createdAt);
        if (!local) {
          // We don't have this record. Only add if it isn't a tombstone —
          // a record we never saw that's already deleted can stay gone.
          if (!r.deletedAt) {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { id: _id, ...rest } = r;
            await db.todos.add({ ...rest, updatedAt: rUpdated } as Todo);
          }
        } else {
          const lUpdated = local.updatedAt ?? local.createdAt;
          // Newest write wins. (deletion is just a state with a timestamp)
          if (rUpdated > lUpdated) {
            await db.todos.update(local.id!, {
              text: r.text, done: r.done, pinned: r.pinned,
              updatedAt: rUpdated, deletedAt: r.deletedAt,
            });
          }
        }
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

  // Watch Dexie for local changes.
  // For todos we watch max(updatedAt) instead of count() — soft-deletes and
  // done/pin toggles are UPDATEs that don't change the row count, so count()
  // would miss them and the deleting device would never push its tombstone.
  const obs = liveQuery(() => Promise.all([
    db.notes.orderBy('updatedAt').last().then(n => n?.updatedAt ?? 0),
    db.studySessions.orderBy('updatedAt').last().then(s => s?.updatedAt ?? 0),
    db.studyCategories.orderBy('updatedAt').last().then(c => c?.updatedAt ?? 0),
    db.exams.count(),
    db.savedChats.count(),
    db.earnedBadges.count(),
    db.todos.orderBy('updatedAt').last().then(t => t?.updatedAt ?? 0),
    db.problemSets.count(),
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
