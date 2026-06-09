import { liveQuery } from 'dexie';
import { db, newSyncId } from './db';
import type { Note, Folder, StudySession, StudyCategory, Exam, ScheduleDay, SavedChat, Todo, EarnedBadge, ProblemSet } from './db';

const PUSH_DEBOUNCE_MS  = 3_000;
const POLL_INTERVAL_MS  = 30_000;
const MERGE_SUPPRESS_MS = 5_000;  // suppress push triggers right after a merge
const MAX_PUSH_BYTES    = 7.5 * 1024 * 1024;
// Records bigger than this (notes with embedded base64 images, huge chats) are
// excluded from an oversized push instead of killing sync for EVERYTHING.
const OVERSIZE_RECORD_BYTES = 1_500_000;

// Snapshot records carry the *sync ids* of their relations, because numeric
// auto-increment ids (folderId, parentId, categoryId) are device-local and
// mean something different on every device. The receiving side resolves them
// back to its own numeric ids; the helper fields are never written to Dexie.
type SyncNote    = Note         & { folderSyncId?: string };
type SyncFolder  = Folder       & { parentSyncId?: string };
type SyncSession = StudySession & { categorySyncId?: string };

interface LiveSnapshot {
  notes:            SyncNote[];
  folders:          SyncFolder[];
  studySessions:    SyncSession[];
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
let _isPolling      = false;
let _suppressUntil  = 0;
let _pushFailures   = 0;
let _pushTimer:   ReturnType<typeof setTimeout>  | null = null;
let _pollTimer:   ReturnType<typeof setInterval> | null = null;
let _dexieSub:    { unsubscribe: () => void }    | null = null;
let _listenersOn  = false;

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
  // Enrich cross-table references with stable syncIds (see SyncNote above).
  const folderSyncById = new Map(folders.filter(f => f.id != null && f.syncId).map(f => [f.id!, f.syncId]));
  const catSyncById    = new Map(studyCategories.filter(c => c.id != null && c.syncId).map(c => [c.id!, c.syncId!]));
  const outNotes: SyncNote[] = notes.map(n => ({
    ...n,
    folderSyncId: n.folderId != null ? folderSyncById.get(n.folderId) : undefined,
  }));
  const outFolders: SyncFolder[] = folders.map(f => ({
    ...f,
    parentSyncId: f.parentId != null ? folderSyncById.get(f.parentId) : undefined,
  }));
  const outSessions: SyncSession[] = studySessions.map(s => ({
    ...s,
    categorySyncId: s.categoryId != null ? catSyncById.get(s.categoryId) : undefined,
  }));
  return {
    notes: outNotes, folders: outFolders, studySessions: outSessions,
    studyCategories, exams, scheduleDays, savedChats, todos, earnedBadges, problemSets,
    ts: Date.now(),
  };
}

// ── Push to Redis ────────────────────────────────────────────────
async function push() {
  if (!_key) return;
  // If we're mid-merge or still inside the post-merge suppress window, don't
  // drop this push — defer it until the window closes. Otherwise a local change
  // made right after a remote merge (e.g. an AI-created note added within the
  // suppress window after the initial poll) would never get pushed.
  if (_isMerging || Date.now() < _suppressUntil) {
    schedulePush();
    return;
  }
  try {
    const snapshot = await buildSnapshot();
    let body = JSON.stringify({ key: _key, snapshot });
    if (body.length > MAX_PUSH_BYTES) {
      // Snapshot too large — almost always notes with embedded base64 images.
      // Previously this silently aborted, which permanently killed sync for
      // ALL data. Instead, exclude only the oversized records and push the rest.
      snapshot.notes      = snapshot.notes.filter(n => (n.content?.length ?? 0) <= OVERSIZE_RECORD_BYTES);
      snapshot.savedChats = snapshot.savedChats.filter(c => (c.messages?.length ?? 0) <= OVERSIZE_RECORD_BYTES);
      body = JSON.stringify({ key: _key, snapshot });
      if (body.length > MAX_PUSH_BYTES) {
        console.warn('liveSync: snapshot too large to push even after excluding oversized records');
        return;
      }
      console.warn('liveSync: some oversized records (likely notes with large embedded images) were excluded from sync');
    }
    const res = await fetch('/api/sync/live', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    if (!res.ok) throw new Error(`push failed: ${res.status}`);
    _pushFailures = 0;
    // The server MERGES our push into the stored snapshot, so it may now hold
    // records from another device that we don't have yet. Pull them promptly
    // instead of waiting for the next 30s poll tick.
    setTimeout(() => void poll(), 1_500);
  } catch {
    // Network/server error — retry with exponential backoff so changes made
    // while offline aren't lost (capped so we don't hammer a dead network).
    _pushFailures = Math.min(_pushFailures + 1, 5);
    if (_pushTimer) clearTimeout(_pushTimer);
    _pushTimer = setTimeout(() => void push(), PUSH_DEBOUNCE_MS * 2 ** _pushFailures);
  }
}

function schedulePush() {
  if (_pushTimer) clearTimeout(_pushTimer);
  const now = Date.now();
  // When inside the suppress window (or mid-merge) wait until just after it
  // closes instead of using the normal debounce — and never drop the push.
  const delay = (_isMerging || now < _suppressUntil)
    ? Math.max(PUSH_DEBOUNCE_MS, _suppressUntil - now + 250)
    : PUSH_DEBOUNCE_MS;
  _pushTimer = setTimeout(() => void push(), delay);
}

// Fire a pending debounced push immediately (page being hidden/closed).
function flushPendingPush() {
  if (!_pushTimer) return;
  clearTimeout(_pushTimer);
  _pushTimer = null;
  void push();
}

// ── Merge remote snapshot into local DB ─────────────────────────
async function mergeSnapshot(remote: LiveSnapshot) {
  _isMerging = true;
  try {
    // ── Folders: syncId-based, newer updatedAt wins (tombstones carry a bumped
    // updatedAt so deletions propagate). parentId is resolved in a second pass
    // because the parent may itself arrive later in the same snapshot.
    const folderWinners: Array<{ syncId: string; parentSyncId?: string; remoteParentId?: number }> = [];
    for (const r of remote.folders ?? []) {
      if (!r.syncId) continue;
      const local = await db.folders.where('syncId').equals(r.syncId).first();
      // Never carry the remote device's auto-id or its local parent id.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { id: _id, parentId: _pid, parentSyncId, ...rest } = r;
      if (!local) {
        await db.folders.add({ ...rest, syncId: r.syncId || newSyncId() });
        folderWinners.push({ syncId: r.syncId, parentSyncId, remoteParentId: r.parentId });
      } else if ((r.updatedAt ?? 0) > (local.updatedAt ?? 0)) {
        await db.folders.update(local.id!, rest);
        folderWinners.push({ syncId: r.syncId, parentSyncId, remoteParentId: r.parentId });
      }
    }

    // Translation maps: remote numeric ids → syncIds → OUR numeric ids.
    const localFolders = await db.folders.toArray();
    const folderIdBySyncId   = new Map(localFolders.filter(f => f.syncId).map(f => [f.syncId, f.id!]));
    const folderSyncByRemote = new Map((remote.folders ?? []).filter(f => f.id != null && f.syncId).map(f => [f.id!, f.syncId]));
    const resolveFolderId = (folderSyncId?: string, remoteFolderId?: number): number | undefined => {
      const sid = folderSyncId ?? (remoteFolderId != null ? folderSyncByRemote.get(remoteFolderId) : undefined);
      return sid != null ? folderIdBySyncId.get(sid) : undefined;
    };

    // Pass 2: set parentId on the folders the remote side won.
    for (const w of folderWinners) {
      const selfId = folderIdBySyncId.get(w.syncId);
      if (selfId == null) continue;
      await db.folders.update(selfId, { parentId: resolveFolderId(w.parentSyncId, w.remoteParentId) });
    }

    // ── Notes: syncId-based, newer updatedAt wins. folderId is translated via
    // the folder's syncId — the raw number is another device's auto-id.
    for (const r of remote.notes ?? []) {
      if (!r.syncId) continue;
      const local = await db.notes.where('syncId').equals(r.syncId).first();
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { id: _id, folderSyncId, folderId: _fid, ...rest } = r;
      const folderId = resolveFolderId(folderSyncId, r.folderId);
      if (!local) {
        await db.notes.add({ ...rest, folderId, syncId: r.syncId || newSyncId() });
      } else if ((r.updatedAt ?? 0) > (local.updatedAt ?? 0)) {
        await db.notes.update(local.id!, { ...rest, folderId });
      }
    }

    // ── Study categories: per-record last-write-wins keyed by syncId.
    {
      const localCats = await db.studyCategories.toArray();
      const map = new Map(localCats.filter(c => c.syncId).map(c => [c.syncId!, c]));
      for (const r of remote.studyCategories ?? []) {
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

    // Category id translation for sessions (categories merged above).
    const localCats = await db.studyCategories.toArray();
    const catIdBySyncId   = new Map(localCats.filter(c => c.syncId).map(c => [c.syncId!, c.id!]));
    const catSyncByRemote = new Map((remote.studyCategories ?? []).filter(c => c.id != null && c.syncId).map(c => [c.id!, c.syncId!]));
    const resolveCategoryId = (categorySyncId?: string, remoteCatId?: number | null): number | null => {
      const sid = categorySyncId ?? (remoteCatId != null ? catSyncByRemote.get(remoteCatId) : undefined);
      return sid != null ? (catIdBySyncId.get(sid) ?? null) : null;
    };

    // ── Study sessions: per-record last-write-wins keyed by syncId. updatedAt
    // is the version clock (bumped on edit AND soft-delete), so a deletion wins
    // over an older live copy — no resurrection of deleted history.
    {
      const localSessions = await db.studySessions.toArray();
      const map = new Map(localSessions.filter(s => s.syncId).map(s => [s.syncId!, s]));
      for (const r of remote.studySessions ?? []) {
        if (!r.syncId) continue;
        const local = map.get(r.syncId);
        const rUpdated = r.updatedAt ?? r.startTime;
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { id: _id, categorySyncId, categoryId: _cid, ...rest } = r;
        const categoryId = resolveCategoryId(categorySyncId, r.categoryId);
        if (!local) {
          if (!r.deletedAt) {
            await db.studySessions.add({ ...rest, categoryId } as StudySession);
          }
        } else if (rUpdated > (local.updatedAt ?? local.startTime)) {
          await db.studySessions.update(local.id!, { ...rest, categoryId });
        }
      }
    }

    // ── Exams: union by name+examDate
    const localExams = await db.exams.toArray();
    const examKeys = new Set(localExams.map(e => `${e.name}|${e.examDate}`));
    for (const r of remote.exams ?? []) {
      if (!examKeys.has(`${r.name}|${r.examDate}`)) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { id: _id, ...rest } = r;
        await db.exams.add(rest as Exam);
      }
    }

    // ── Schedule days: add missing dates only
    const localDays = await db.scheduleDays.toArray();
    const dayDates = new Set(localDays.map(d => d.date));
    for (const r of remote.scheduleDays ?? []) {
      if (!dayDates.has(r.date)) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { id: _id, ...rest } = r;
        await db.scheduleDays.add(rest as ScheduleDay);
      }
    }

    // ── Saved chats: per-record last-write-wins keyed by createdAt, with
    // tombstone support so deletions propagate (updatedAt is the version clock).
    if (remote.savedChats?.length) {
      const localChats = await db.savedChats.toArray();
      const map = new Map(localChats.map(c => [c.createdAt, c]));
      for (const r of remote.savedChats) {
        const local = map.get(r.createdAt);
        const rUpdated = r.updatedAt ?? r.createdAt;
        if (!local) {
          if (!r.deletedAt) {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { id: _id, ...rest } = r;
            await db.savedChats.add(rest as SavedChat);
          }
        } else if (rUpdated > (local.updatedAt ?? local.createdAt)) {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { id: _id, ...rest } = r;
          await db.savedChats.update(local.id!, rest);
        }
      }
    }

    // ── Earned badges: additive union by badgeId. Badges are never revoked, so
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

    // ── Problem sets: per-record last-write-wins keyed by createdAt, with
    // tombstone support so deletions (and attempt/score updates) propagate.
    if (remote.problemSets?.length) {
      const localSets = await db.problemSets.toArray();
      const map = new Map(localSets.map(p => [p.createdAt, p]));
      for (const r of remote.problemSets) {
        const local = map.get(r.createdAt);
        const rUpdated = r.updatedAt ?? r.createdAt;
        if (!local) {
          if (!r.deletedAt) {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { id: _id, ...rest } = r;
            await db.problemSets.add(rest as ProblemSet);
          }
        } else if (rUpdated > (local.updatedAt ?? local.createdAt)) {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { id: _id, ...rest } = r;
          await db.problemSets.update(local.id!, rest);
        }
      }
    }

    // ── Todos: per-record last-write-wins keyed by createdAt (stable across
    // devices). updatedAt is the version clock — it is bumped on every
    // mutation INCLUDING soft-delete, so a deletion always carries a fresh
    // timestamp and wins over an older "alive" copy on the other device.
    // The update path copies the WHOLE record (sans id) so calendar fields
    // (dueDate / startTime) — and anything added later — survive a merge.
    if (remote.todos !== undefined) {
      const localTodos = await db.todos.toArray(); // includes soft-deleted tombstones
      const todoMap = new Map(localTodos.map(t => [t.createdAt, t]));
      for (const r of remote.todos) {
        const rUpdated = r.updatedAt ?? r.createdAt;
        const local = todoMap.get(r.createdAt);
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { id: _id, ...rest } = r;
        if (!local) {
          // We don't have this record. Only add if it isn't a tombstone —
          // a record we never saw that's already deleted can stay gone.
          if (!r.deletedAt) {
            await db.todos.add({ ...rest, updatedAt: rUpdated } as Todo);
          }
        } else {
          const lUpdated = local.updatedAt ?? local.createdAt;
          // Newest write wins. (deletion is just a state with a timestamp)
          if (rUpdated > lUpdated) {
            await db.todos.update(local.id!, { ...rest, updatedAt: rUpdated });
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
  if (!_key || _isPolling) return;
  _isPolling = true;
  try {
    const res = await fetch(
      `/api/sync/live?key=${encodeURIComponent(_key)}&since=${_lastSyncTs}`,
    );
    if (!res.ok) return;
    const json = await res.json() as { changed: boolean; ts?: number; snapshot?: LiveSnapshot };
    if (!json.changed || !json.snapshot) return;
    await mergeSnapshot(json.snapshot);
  } catch { /* network error */ }
  finally { _isPolling = false; }
}

// ── Lifecycle listeners ──────────────────────────────────────────
// Mobile browsers throttle timers aggressively and kill pages without warning:
// a change made within the 3s debounce before the app is backgrounded would
// simply never push. Flush on hide, and re-poll the moment we come back.
function onVisibilityChange() {
  if (document.visibilityState === 'hidden') flushPendingPush();
  else { void poll(); }
}
function onOnline() {
  void poll();
  schedulePush(); // local changes made while offline still need to go up
}
function onPageHide() {
  flushPendingPush();
}

// ── Public API ───────────────────────────────────────────────────
export function initLiveSync(key: string) {
  if (_key === key && _pollTimer) return; // already running with same key
  stopLiveSync();

  _key        = key;
  _lastSyncTs = Number(localStorage.getItem('lily_livesync_ts') ?? 0);

  // Watch Dexie for local changes.
  // Tables whose mutations are UPDATEs (soft-deletes, done/pin toggles) are
  // watched via max(updatedAt) — count() misses them and the mutating device
  // would never push its change.
  const obs = liveQuery(() => Promise.all([
    db.notes.orderBy('updatedAt').last().then(n => n?.updatedAt ?? 0),
    db.folders.orderBy('updatedAt').last().then(f => f?.updatedAt ?? 0),
    db.studySessions.orderBy('updatedAt').last().then(s => s?.updatedAt ?? 0),
    db.studyCategories.orderBy('updatedAt').last().then(c => c?.updatedAt ?? 0),
    db.exams.count(),
    db.savedChats.orderBy('updatedAt').last().then(c => c?.updatedAt ?? 0),
    db.savedChats.count(),
    db.earnedBadges.count(),
    db.todos.orderBy('updatedAt').last().then(t => t?.updatedAt ?? 0),
    db.problemSets.orderBy('updatedAt').last().then(p => p?.updatedAt ?? 0),
    db.problemSets.count(),
  ]));
  _dexieSub = obs.subscribe(() => schedulePush());

  _pollTimer = setInterval(() => void poll(), POLL_INTERVAL_MS);
  if (!_listenersOn && typeof window !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('online', onOnline);
    window.addEventListener('pagehide', onPageHide);
    _listenersOn = true;
  }
  void poll(); // pull immediately on init
}

export function stopLiveSync() {
  if (_pushTimer)  { clearTimeout(_pushTimer);   _pushTimer  = null; }
  if (_pollTimer)  { clearInterval(_pollTimer);  _pollTimer  = null; }
  if (_dexieSub)   { _dexieSub.unsubscribe();    _dexieSub   = null; }
  if (_listenersOn && typeof window !== 'undefined') {
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('online', onOnline);
    window.removeEventListener('pagehide', onPageHide);
    _listenersOn = false;
  }
  _key = '';
  _pushFailures = 0;
}

export function isLiveSyncActive(): boolean {
  return !!_key;
}
