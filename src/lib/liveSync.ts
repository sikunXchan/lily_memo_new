import { liveQuery, type Table } from 'dexie';
import { db, newSyncId } from './db';
import type { Note, Folder, StudySession, StudyCategory, Exam, ScheduleDay, SavedChat, Todo, EarnedBadge, ProblemSet, Diary, LessonSession } from './db';

const PUSH_DEBOUNCE_MS  = 3_000;
const POLL_INTERVAL_MS  = 30_000;
const MERGE_SUPPRESS_MS = 5_000;  // suppress push triggers right after a merge
const MAX_PUSH_BYTES    = 7.5 * 1024 * 1024;

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
  diaries:          Diary[];
  lessonSessions:   LessonSession[];
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

// ── Strip image attachment data from a savedChat for sync ────────
// Local DB keeps full base64 image data; the sync snapshot strips it so
// image-heavy conversations don't hit the 1.5 MB per-record filter and
// disappear from sync silently. Text content (the valuable part) always syncs.
type MsgLike = { attachments?: Array<Record<string, unknown>>; [k: string]: unknown };
function stripSavedChatForSync(chat: SavedChat): SavedChat {
  try {
    const msgs = JSON.parse(chat.messages) as MsgLike[];
    const stripped = msgs.map(m => {
      if (!m.attachments?.length) return m;
      return { ...m, attachments: m.attachments.map(a => ({ ...a, data: '', pdfPageImages: undefined })) };
    });
    return { ...chat, messages: JSON.stringify(stripped) };
  } catch {
    return chat;
  }
}

// ── Build local snapshot ─────────────────────────────────────────
async function buildSnapshot(): Promise<LiveSnapshot> {
  const [notes, folders, studySessions, studyCategories, exams, scheduleDays, savedChats, todos, earnedBadges, problemSets, diaries, lessonSessions] = await Promise.all([
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
    db.diaries.toArray(),
    db.lessonSessions.toArray(),
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
    studyCategories, exams, scheduleDays,
    savedChats: savedChats.map(stripSavedChatForSync),
    todos, earnedBadges, problemSets, diaries, lessonSessions,
    ts: Date.now(),
  };
}

// Shrink an oversized snapshot until its serialized push body fits under
// MAX_PUSH_BYTES, by dropping the largest note `content` / chat `messages`
// records first (base64-image notes are the usual culprit). The lightweight
// tables (todos, folders, diaries, study sessions/categories, problem-set
// metadata, lesson sessions…) are never touched, so they always sync even when
// a handful of notes are too image-heavy to upload. Dropping a record just
// omits it from THIS push — the server keeps its existing copy, so nothing is
// deleted; that note simply syncs later once it fits (or via manual backup).
function trimSnapshotToFit(snapshot: LiveSnapshot): string {
  let body = JSON.stringify({ key: _key, snapshot });
  if (body.length <= MAX_PUSH_BYTES) return body;

  const noteSize = (n: SyncNote)  => n.content?.length  ?? 0;
  const chatSize = (c: SavedChat) => c.messages?.length ?? 0;

  // Rank heavy records largest-first (by reference, so we can drop them without
  // index bookkeeping). Content is base64/ASCII so char length is a good
  // byte-size proxy; the margin below covers JSON escaping/overhead.
  type Heavy =
    | { rec: SyncNote;  size: number; isNote: true }
    | { rec: SavedChat; size: number; isNote: false };
  const heavy: Heavy[] = [
    ...snapshot.notes.map((n): Heavy      => ({ rec: n, size: noteSize(n), isNote: true  })),
    ...snapshot.savedChats.map((c): Heavy => ({ rec: c, size: chatSize(c), isNote: false })),
  ].sort((a, b) => b.size - a.size);

  let need = body.length - MAX_PUSH_BYTES + 4096; // chars to shed + margin
  const dropNotes = new Set<SyncNote>();
  const dropChats = new Set<SavedChat>();
  for (const h of heavy) {
    if (need <= 0 || h.size === 0) break;
    if (h.isNote) dropNotes.add(h.rec); else dropChats.add(h.rec);
    need -= h.size;
  }
  if (dropNotes.size) snapshot.notes      = snapshot.notes.filter(n => !dropNotes.has(n));
  if (dropChats.size) snapshot.savedChats = snapshot.savedChats.filter(c => !dropChats.has(c));

  body = JSON.stringify({ key: _key, snapshot });
  // Safety net: if the estimate undershot, keep dropping the single largest
  // remaining note (then chat) until we're under the cap (bounded, rarely runs).
  let guard = 0;
  while (body.length > MAX_PUSH_BYTES && guard++ < 5000) {
    const topNote = snapshot.notes.reduce<SyncNote | null>((m, n) => (!m || noteSize(n) > noteSize(m) ? n : m), null);
    const topChat = snapshot.savedChats.reduce<SavedChat | null>((m, c) => (!m || chatSize(c) > chatSize(m) ? c : m), null);
    const nSize = topNote ? noteSize(topNote) : 0;
    const cSize = topChat ? chatSize(topChat) : 0;
    if (nSize === 0 && cSize === 0) break; // nothing heavy left to drop
    if (nSize >= cSize && topNote) snapshot.notes      = snapshot.notes.filter(n => n !== topNote);
    else if (topChat)              snapshot.savedChats = snapshot.savedChats.filter(c => c !== topChat);
    body = JSON.stringify({ key: _key, snapshot });
  }
  return body;
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
      // Shrink it to fit by dropping the heaviest note/chat records, but NEVER
      // abort the whole push: a wholesale abort stranded every OTHER table
      // (todos, folders, study history, diaries…) on this device, so nothing —
      // not even a one-line todo — ever synced out while one big note existed.
      body = trimSnapshotToFit(snapshot);
      console.warn('liveSync: snapshot exceeded the push size limit; the largest image-heavy notes were left out of this sync (every other record still synced)');
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
  if (!_key) return; // inert when sync is disabled — write hooks call this freely
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

    // ── Diaries: per-record last-write-wins keyed by `date` (one entry per day,
    // stable across devices). updatedAt is the version clock incl. soft-delete.
    if (remote.diaries !== undefined) {
      const localDiaries = await db.diaries.toArray(); // includes tombstones
      const diaryMap = new Map(localDiaries.map(d => [d.date, d]));
      for (const r of remote.diaries) {
        const rUpdated = r.updatedAt ?? r.createdAt;
        const local = diaryMap.get(r.date);
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { id: _id, ...rest } = r;
        if (!local) {
          if (!r.deletedAt) {
            await db.diaries.add({ ...rest, updatedAt: rUpdated } as Diary);
          }
        } else if (rUpdated > (local.updatedAt ?? local.createdAt)) {
          await db.diaries.update(local.id!, { ...rest, updatedAt: rUpdated });
        }
      }
    }

    // ── Lesson sessions: per-record last-write-wins keyed by `createdAt`
    // (stable across devices). updatedAt is the version clock incl. soft-delete,
    // so a continued lesson propagates and a deletion wins over an older copy —
    // this is what lets you resume a lesson started on another device.
    if (remote.lessonSessions !== undefined) {
      const localLessons = await db.lessonSessions.toArray(); // includes tombstones
      const lessonMap = new Map(localLessons.map(l => [l.createdAt, l]));
      for (const r of remote.lessonSessions) {
        const rUpdated = r.updatedAt ?? r.createdAt;
        const local = lessonMap.get(r.createdAt);
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { id: _id, ...rest } = r;
        if (!local) {
          if (!r.deletedAt) {
            await db.lessonSessions.add({ ...rest, updatedAt: rUpdated } as LessonSession);
          }
        } else if (rUpdated > (local.updatedAt ?? local.createdAt)) {
          await db.lessonSessions.update(local.id!, { ...rest, updatedAt: rUpdated });
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

// ── Reliable change detection via Dexie write hooks ──────────────
// The liveQuery watcher in initLiveSync infers "something changed" from
// max(updatedAt)/count(), which can MISS a mutation — e.g. a soft-delete, or an
// add/edit whose updatedAt isn't the table's new maximum (records synced from a
// device with a faster clock leave "future" timestamps behind). A missed change
// leaves the device able to PULL but never PUSH, so its own edits never reach
// other devices. These hooks fire on EVERY local create/update/delete
// regardless of values, guaranteeing a push is scheduled. Installed once;
// schedulePush() is a no-op while sync is disabled.
let _hooksInstalled = false;
function installWriteHooks() {
  if (_hooksInstalled) return;
  _hooksInstalled = true;
  // Must return undefined: a non-undefined return from a 'creating'/'updating'
  // hook is treated by Dexie as a primary-key / modifications override.
  const onWrite = () => { schedulePush(); };
  const tables = [
    db.notes, db.folders, db.studySessions, db.studyCategories, db.exams,
    db.scheduleDays, db.savedChats, db.todos, db.earnedBadges, db.problemSets,
    db.diaries, db.lessonSessions,
  ] as unknown as Table[];
  for (const table of tables) {
    table.hook('creating', onWrite);
    table.hook('updating', onWrite);
    table.hook('deleting', onWrite);
  }
}

// ── Public API ───────────────────────────────────────────────────
export function initLiveSync(key: string) {
  if (_key === key && _pollTimer) return; // already running with same key
  stopLiveSync();

  _key        = key;
  _lastSyncTs = Number(localStorage.getItem('lily_livesync_ts') ?? 0);

  installWriteHooks(); // reliable per-write push trigger (idempotent)

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
    db.diaries.orderBy('updatedAt').last().then(d => d?.updatedAt ?? 0),
    db.lessonSessions.orderBy('updatedAt').last().then(l => l?.updatedAt ?? 0),
    db.lessonSessions.count(),
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
