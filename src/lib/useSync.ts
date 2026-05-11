'use client';

import { useSession } from 'next-auth/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { collectLocalData, mergeServerIntoLocal } from './syncHelpers';
import type { SyncPayload } from './syncHelpers';

export interface SyncState {
  isSyncing: boolean;
  lastSyncAt: number | null;
  error: string | null;
}

function getLastSyncKey(userId: string) {
  return `lily_lastSync_${userId}`;
}

export function useSync() {
  const { data: session, status } = useSession();
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const syncingRef = useRef(false);

  const sync = useCallback(async (full = false) => {
    if (!session?.user?.id || syncingRef.current) return;
    syncingRef.current = true;
    setIsSyncing(true);
    setError(null);

    try {
      const userId = session.user.id;
      const lastSyncKey = getLastSyncKey(userId);
      const lastSync = full ? 0 : parseInt(localStorage.getItem(lastSyncKey) ?? '0');

      // Collect local changes since last sync
      const { notes, folders } = await collectLocalData(lastSync || undefined);

      // Push to server + get server response
      const res = await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes, folders, since: lastSync }),
      });

      if (!res.ok) throw new Error(`Sync failed: ${res.status}`);

      const serverPayload: SyncPayload & { syncedAt: number } = await res.json();

      // Merge server data into local IndexedDB
      await mergeServerIntoLocal(serverPayload);

      const now = serverPayload.syncedAt ?? Date.now();
      localStorage.setItem(lastSyncKey, String(now));
      setLastSyncAt(now);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sync error');
    } finally {
      syncingRef.current = false;
      setIsSyncing(false);
    }
  }, [session]);

  // Sync on login
  useEffect(() => {
    if (status === 'authenticated' && session?.user?.id) {
      const userId = session.user.id;
      const lastSyncKey = getLastSyncKey(userId);
      const lastSync = localStorage.getItem(lastSyncKey);
      // Full sync if never synced before
      sync(!lastSync);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, session?.user?.id]);

  // Sync on visibility change (app comes to foreground)
  useEffect(() => {
    const handleVisible = () => {
      if (document.visibilityState === 'visible' && session?.user?.id) {
        sync();
      }
    };
    document.addEventListener('visibilitychange', handleVisible);
    return () => document.removeEventListener('visibilitychange', handleVisible);
  }, [session, sync]);

  return { isSyncing, lastSyncAt, error, sync };
}
