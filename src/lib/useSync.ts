'use client';

import { useCallback, useRef, useState } from 'react';
import { db } from './db';

const SYNC_CODE_KEY = 'lily_sync_code';
const LAST_SYNC_KEY = 'lily_last_sync';

export function getSyncCode(): string | null {
  try { return localStorage.getItem(SYNC_CODE_KEY); } catch { return null; }
}

export function saveSyncCode(code: string) {
  try { localStorage.setItem(SYNC_CODE_KEY, code); } catch { /* noop */ }
}

export function clearSyncCode() {
  try { localStorage.removeItem(SYNC_CODE_KEY); } catch { /* noop */ }
}

export interface SyncState {
  isSyncing: boolean;
  lastSyncAt: number | null;
  error: string | null;
}

export function useSync() {
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(() => {
    try { const v = localStorage.getItem(LAST_SYNC_KEY); return v ? parseInt(v) : null; } catch { return null; }
  });
  const [error, setError] = useState<string | null>(null);
  const syncingRef = useRef(false);

  const push = useCallback(async (code: string) => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    setIsSyncing(true);
    setError(null);
    try {
      const [notes, folders] = await Promise.all([
        db.notes.toArray(),
        db.folders.toArray(),
      ]);

      const res = await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, notes, folders }),
      });
      if (!res.ok) throw new Error(`Push failed: ${res.status}`);
      const { updatedAt } = await res.json();
      const ts = updatedAt ?? Date.now();
      localStorage.setItem(LAST_SYNC_KEY, String(ts));
      setLastSyncAt(ts);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'エラーが発生しました');
    } finally {
      syncingRef.current = false;
      setIsSyncing(false);
    }
  }, []);

  const pull = useCallback(async (code: string) => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    setIsSyncing(true);
    setError(null);
    try {
      const res = await fetch(`/api/sync?code=${encodeURIComponent(code)}`);
      if (res.status === 404) throw new Error('このコードのデータが見つかりません');
      if (!res.ok) throw new Error(`Pull failed: ${res.status}`);
      const { notes = [], folders = [], updatedAt } = await res.json();

      type RawNote = { id?: number; syncId?: string; title: string; content: string; folderId?: number; color?: string; createdAt: number; updatedAt: number; syncCode?: string; serverId?: string; syncedAt?: number };
      type RawFolder = { id?: number; name: string; parentId?: number; color?: string; createdAt: number; serverId?: string; syncedAt?: number };

      // Merge server notes into local (syncId で照合 → id collisions を回避)
      for (const raw of notes as RawNote[]) {
        const { id: _serverId, ...fields } = raw;

        // syncId があればそれで検索、なければ id フォールバック（旧形式との互換）
        let existing = raw.syncId
          ? await db.notes.where('syncId').equals(raw.syncId).first().catch(() => undefined)
          : undefined;
        if (!existing && raw.id && !raw.syncId) {
          existing = await db.notes.get(raw.id).catch(() => undefined);
        }

        if (!existing) {
          await db.notes.add(fields);
        } else if (raw.updatedAt > existing.updatedAt) {
          await db.notes.update(existing.id!, fields);
        }
      }

      // Merge folders
      for (const raw of folders as RawFolder[]) {
        if (!raw.id) continue;
        const existing = await db.folders.get(raw.id).catch(() => undefined);
        if (!existing) {
          const { id: _id, ...rest } = raw;
          await db.folders.add(rest);
        }
      }

      const ts = updatedAt ?? Date.now();
      localStorage.setItem(LAST_SYNC_KEY, String(ts));
      setLastSyncAt(ts);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'エラーが発生しました');
    } finally {
      syncingRef.current = false;
      setIsSyncing(false);
    }
  }, []);

  return { isSyncing, lastSyncAt, error, push, pull };
}
