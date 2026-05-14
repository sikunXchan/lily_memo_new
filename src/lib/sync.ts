'use client';

import { db, type Folder, type Note } from './db';
import { getSupabase, SUPABASE_CONFIGURED } from './supabase';

const LS_LAST_SYNC = 'sync:lastSyncedAt';
const LS_PENDING = 'sync:pending';
const LS_LAST_USER_ID = 'sync:lastUserId';
const PUSH_DEBOUNCE_MS = 5000;
const TOMBSTONE_GC_MS = 30 * 24 * 60 * 60 * 1000;
// Tombstones live in cloud just long enough for other devices on the same
// account to pull them. After this window, any device that pulls will
// hard-delete them — keeps the cloud table free of "deleted" leftovers.
const CLOUD_TOMBSTONE_TTL_MS = 10 * 60 * 1000;

type TableName = 'folders' | 'notes';
type Pending = { folders: string[]; notes: string[] };

interface RemoteFolder {
  sync_id: string;
  user_id: string;
  name: string;
  parent_sync_id: string | null;
  color: string | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

interface RemoteNote {
  sync_id: string;
  user_id: string;
  title: string | null;
  content: string | null;
  folder_sync_id: string | null;
  color: string | null;
  type: string | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

export interface SyncStatus {
  configured: boolean;
  /** True once the initial session check has completed (signedIn is meaningful) */
  sessionResolved: boolean;
  signedIn: boolean;
  email?: string;
  lastSyncedAt: number;
  pendingCount: number;
  isSyncing: boolean;
  lastError?: string;
}

const listeners = new Set<(s: SyncStatus) => void>();
let isSyncing = false;
let lastError: string | undefined;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let lastEmittedJSON = '';
// Cached session info, kept in sync via onAuthStateChange so getStatus
// (and pull/push) never have to await a potentially-hanging
// sb.auth.getSession() call.
let sessionSignedIn = false;
let sessionEmail: string | undefined;
let sessionUserId: string | undefined;
let sessionResolved = false;

function readPending(): Pending {
  if (typeof window === 'undefined') return { folders: [], notes: [] };
  try {
    const raw = localStorage.getItem(LS_PENDING);
    if (!raw) return { folders: [], notes: [] };
    const parsed = JSON.parse(raw);
    return {
      folders: Array.isArray(parsed.folders) ? parsed.folders : [],
      notes: Array.isArray(parsed.notes) ? parsed.notes : [],
    };
  } catch {
    return { folders: [], notes: [] };
  }
}

function writePending(p: Pending): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(LS_PENDING, JSON.stringify(p));
}

function readLastSynced(): number {
  if (typeof window === 'undefined') return 0;
  return Number(localStorage.getItem(LS_LAST_SYNC) ?? '0');
}

function writeLastSynced(v: number): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(LS_LAST_SYNC, String(v));
}

function getStatus(): SyncStatus {
  const pending = readPending();
  return {
    configured: SUPABASE_CONFIGURED,
    sessionResolved: sessionResolved || !SUPABASE_CONFIGURED,
    signedIn: sessionSignedIn,
    email: sessionEmail,
    lastSyncedAt: readLastSynced(),
    pendingCount: pending.folders.length + pending.notes.length,
    isSyncing,
    lastError,
  };
}

function emit(): void {
  const s = getStatus();
  const json = JSON.stringify(s);
  if (json === lastEmittedJSON) return;
  lastEmittedJSON = json;
  listeners.forEach(cb => cb(s));
}

export function subscribeSync(cb: (s: SyncStatus) => void): () => void {
  listeners.add(cb);
  // Always deliver an initial status to the new subscriber.
  cb(getStatus());
  return () => { listeners.delete(cb); };
}

export function markDirty(table: TableName, syncId: string): void {
  if (!SUPABASE_CONFIGURED) return;
  const p = readPending();
  if (!p[table].includes(syncId)) {
    p[table].push(syncId);
    writePending(p);
    emit();
  }
  schedulePush();
}

function schedulePush(): void {
  if (typeof window === 'undefined') return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => { void pushPending(); }, PUSH_DEBOUNCE_MS);
}

export async function pushPending(): Promise<void> {
  if (isSyncing) return;
  const sb = getSupabase();
  if (!sb) return;
  const userId = sessionUserId;
  if (!userId) return;
  const pending = readPending();
  if (pending.folders.length === 0 && pending.notes.length === 0) return;

  isSyncing = true;
  try {
    lastError = undefined;
    emit();
    // Folders first (parent before children possible since FK is absent)
    if (pending.folders.length > 0) {
      const localFolders = await db.folders.where('syncId').anyOf(pending.folders).toArray();
      const rows: Omit<RemoteFolder, 'user_id'>[] & { user_id?: string }[] = localFolders.map(f => ({
        sync_id: f.syncId,
        user_id: userId,
        name: f.name,
        parent_sync_id: f.parentId ? null : null, // resolve below
        color: f.color ?? null,
        created_at: f.createdAt,
        updated_at: f.updatedAt,
        deleted_at: f.deletedAt ?? null,
      }));
      // resolve parent_sync_id
      for (let i = 0; i < localFolders.length; i++) {
        const parentLocalId = localFolders[i].parentId;
        if (parentLocalId != null) {
          const p = await db.folders.get(parentLocalId);
          rows[i].parent_sync_id = p?.syncId ?? null;
        }
      }
      const { error } = await sb.from('folders').upsert(rows, { onConflict: 'sync_id' });
      if (error) throw new Error(`folders upsert: ${error.message}`);
      // Clear pushed from pending (only the ones we actually had locally)
      const pushedIds = new Set(localFolders.map(f => f.syncId));
      pending.folders = pending.folders.filter(id => !pushedIds.has(id));
      writePending(pending);
    }
    if (pending.notes.length > 0) {
      const localNotes = await db.notes.where('syncId').anyOf(pending.notes).toArray();
      const rows = await Promise.all(localNotes.map(async n => {
        let folder_sync_id: string | null = null;
        if (n.folderId != null) {
          const f = await db.folders.get(n.folderId);
          folder_sync_id = f?.syncId ?? null;
        }
        return {
          sync_id: n.syncId,
          user_id: userId,
          title: n.title ?? null,
          content: n.content ?? null,
          folder_sync_id,
          color: n.color ?? null,
          type: n.type ?? 'text',
          created_at: n.createdAt,
          updated_at: n.updatedAt,
          deleted_at: n.deletedAt ?? null,
        };
      }));
      const { error } = await sb.from('notes').upsert(rows, { onConflict: 'sync_id' });
      if (error) throw new Error(`notes upsert: ${error.message}`);
      const pushedIds = new Set(localNotes.map(n => n.syncId));
      pending.notes = pending.notes.filter(id => !pushedIds.has(id));
      writePending(pending);
    }
  } catch (e) {
    lastError = e instanceof Error ? e.message : String(e);
    console.error('Sync push error:', e);
  } finally {
    isSyncing = false;
    emit();
  }
}

async function applyRemoteFolders(rows: RemoteFolder[]): Promise<void> {
  for (const row of rows) {
    const existing = await db.folders.where('syncId').equals(row.sync_id).first();
    let parentLocalId: number | undefined;
    if (row.parent_sync_id) {
      const parent = await db.folders.where('syncId').equals(row.parent_sync_id).first();
      parentLocalId = parent?.id;
    }
    const next: Folder = {
      ...(existing ?? {}),
      syncId: row.sync_id,
      name: row.name,
      parentId: parentLocalId,
      color: row.color ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      deletedAt: row.deleted_at ?? undefined,
    };
    if (existing?.id != null) {
      if ((existing.updatedAt ?? 0) >= row.updated_at) continue;
      await db.folders.update(existing.id, next);
    } else {
      await db.folders.add(next);
    }
  }
}

async function applyRemoteNotes(rows: RemoteNote[]): Promise<void> {
  for (const row of rows) {
    const existing = await db.notes.where('syncId').equals(row.sync_id).first();
    let folderLocalId: number | undefined;
    if (row.folder_sync_id) {
      const f = await db.folders.where('syncId').equals(row.folder_sync_id).first();
      folderLocalId = f?.id;
    }
    const next: Note = {
      ...(existing ?? {}),
      syncId: row.sync_id,
      title: row.title ?? '',
      content: row.content ?? '',
      folderId: folderLocalId,
      color: row.color ?? undefined,
      type: (row.type as Note['type']) ?? 'text',
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      deletedAt: row.deleted_at ?? undefined,
    };
    if (existing?.id != null) {
      if ((existing.updatedAt ?? 0) >= row.updated_at) continue;
      await db.notes.update(existing.id, next);
    } else {
      await db.notes.add(next);
    }
  }
}

export async function pull(): Promise<void> {
  if (isSyncing) return;
  const sb = getSupabase();
  if (!sb) return;
  const userId = sessionUserId;
  if (!userId) return;

  isSyncing = true;
  try {
    lastError = undefined;
    emit();
    const since = readLastSynced();
    const PAGE = 500;

    let maxUpdated = since;

    // Folders
    let from = 0;
    while (true) {
      const { data, error } = await sb
        .from('folders')
        .select('*')
        .gt('updated_at', since)
        .order('updated_at', { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`folders pull: ${error.message}`);
      const rows = (data ?? []) as RemoteFolder[];
      if (rows.length === 0) break;
      await applyRemoteFolders(rows);
      maxUpdated = Math.max(maxUpdated, ...rows.map(r => r.updated_at));
      if (rows.length < PAGE) break;
      from += PAGE;
    }

    // Notes
    from = 0;
    while (true) {
      const { data, error } = await sb
        .from('notes')
        .select('*')
        .gt('updated_at', since)
        .order('updated_at', { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`notes pull: ${error.message}`);
      const rows = (data ?? []) as RemoteNote[];
      if (rows.length === 0) break;
      await applyRemoteNotes(rows);
      maxUpdated = Math.max(maxUpdated, ...rows.map(r => r.updated_at));
      if (rows.length < PAGE) break;
      from += PAGE;
    }

    if (maxUpdated > since) writeLastSynced(maxUpdated);

    // Hard-delete tombstones older than the propagation window so the
    // cloud table doesn't accumulate "deleted" rows forever.
    await gcCloudTombstones();
  } catch (e) {
    lastError = e instanceof Error ? e.message : String(e);
    console.error('Sync pull error:', e);
  } finally {
    isSyncing = false;
    emit();
  }
}

async function gcOldTombstones(): Promise<void> {
  const cutoff = Date.now() - TOMBSTONE_GC_MS;
  await db.notes.where('deletedAt').above(0).and(n => (n.deletedAt ?? 0) < cutoff).delete();
  await db.folders.where('deletedAt').above(0).and(f => (f.deletedAt ?? 0) < cutoff).delete();
}

async function gcCloudTombstones(): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const userId = sessionUserId;
  if (!userId) return;
  const cutoff = Date.now() - CLOUD_TOMBSTONE_TTL_MS;
  // Hard-delete cloud rows whose tombstone has aged past the propagation window.
  // RLS limits this to rows owned by the current user.
  await sb.from('notes').delete().not('deleted_at', 'is', null).lt('deleted_at', cutoff);
  await sb.from('folders').delete().not('deleted_at', 'is', null).lt('deleted_at', cutoff);
}

async function wipeLocalData(): Promise<void> {
  await db.transaction('rw', db.folders, db.notes, async () => {
    await db.notes.clear();
    await db.folders.clear();
  });
  writeLastSynced(0);
  writePending({ folders: [], notes: [] });
}

function readLastUserId(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(LS_LAST_USER_ID);
}

function writeLastUserId(uid: string | null): void {
  if (typeof window === 'undefined') return;
  if (uid) localStorage.setItem(LS_LAST_USER_ID, uid);
  else localStorage.removeItem(LS_LAST_USER_ID);
}

let initialized = false;
export async function initSync(): Promise<void> {
  if (initialized) return;
  initialized = true;
  if (!SUPABASE_CONFIGURED) return;

  const sb = getSupabase();
  if (!sb) return;

  // Re-pull on auth state changes. When the active account changes,
  // wipe local data first so each account's notes stay isolated.
  // The INITIAL_SESSION event also fires here, so we use it to populate
  // the cached session state without ever blocking on getSession().
  sb.auth.onAuthStateChange(async (_event, session) => {
    sessionSignedIn = !!session;
    sessionEmail = session?.user.email;
    sessionUserId = session?.user.id;
    sessionResolved = true;
    emit();
    if (session?.user) {
      await ensureAccountIsolation(session.user.id);
      await pull();
      await pushPending();
    }
  });

  // Watchdog: if INITIAL_SESSION never fires (e.g. broken auth), still
  // notify subscribers after 2s so the UI doesn't hang on the loading state.
  setTimeout(() => {
    if (!sessionResolved) {
      sessionResolved = true;
      emit();
    }
  }, 2000);

  // Visibility / pagehide → flush + light pull
  if (typeof window !== 'undefined') {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        void pushPending();
      } else if (document.visibilityState === 'visible') {
        void pull();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', () => { void pushPending(); });
    window.addEventListener('online', () => { void pushPending(); });
  }

  // Local Dexie tombstone GC doesn't depend on auth; safe to run eagerly.
  void gcOldTombstones();
  // No explicit pull/push here — the INITIAL_SESSION event from
  // onAuthStateChange handles the first sync once the session is loaded.
}

/**
 * If the signed-in account differs from the previously remembered one,
 * wipe all local notes/folders before pulling fresh data. This prevents
 * one account's notes from leaking into another account's view.
 *
 * The very first sign-in (no remembered user) does NOT wipe — any
 * pre-account local data is preserved and gets pushed to that account.
 */
async function ensureAccountIsolation(currentUserId: string): Promise<void> {
  const lastUserId = readLastUserId();
  if (lastUserId && lastUserId !== currentUserId) {
    await wipeLocalData();
  }
  writeLastUserId(currentUserId);
}

export async function signUp(email: string, password: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase が未設定です');
  const { error } = await sb.auth.signUp({ email, password });
  if (error) throw new Error(error.message);
}

export async function signIn(email: string, password: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase が未設定です');
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
}

export async function signOut(): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  await sb.auth.signOut();
  // Don't wipe local Dexie data — user might want to keep using offline.
  writeLastSynced(0);
  writePending({ folders: [], notes: [] });
  // Keep the auth listener alive so subsequent sign-in still triggers
  // ensureAccountIsolation/pull/push without needing a page reload.
  emit();
}

export async function syncNow(): Promise<void> {
  await pushPending();
  await pull();
}
