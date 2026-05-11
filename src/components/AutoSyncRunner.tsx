'use client';

import { useState, useEffect, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { useSync, getSyncCode } from '@/lib/useSync';

// SyncStatus からの設定変更を通知するイベント名
export const SYNC_SETTINGS_EVENT = 'lily_sync_settings_changed';

export default function AutoSyncRunner() {
  const { push, pull } = useSync();
  const [enabled, setEnabled] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const prevTrigger = useRef<string | null>(null);

  const readSettings = () => {
    try { setEnabled(localStorage.getItem('lily_auto_sync') === 'true'); } catch {}
    setCode(getSyncCode());
  };

  useEffect(() => {
    readSettings();
    window.addEventListener(SYNC_SETTINGS_EVENT, readSettings);
    return () => window.removeEventListener(SYNC_SETTINGS_EVENT, readSettings);
  }, []);

  // ノート・フォルダの変更を監視
  const syncTrigger = useLiveQuery(async () => {
    const noteCount = await db.notes.count();
    const lastNote = await db.notes.orderBy('updatedAt').last();
    const folderCount = await db.folders.count();
    return `${noteCount}-${lastNote?.updatedAt ?? 0}-${folderCount}`;
  }, []);

  // 自動プッシュ: データ変更から 3 秒後
  useEffect(() => {
    if (syncTrigger === undefined) return;
    const prev = prevTrigger.current;
    prevTrigger.current = syncTrigger;
    if (!enabled || !code) return;
    if (prev === null || prev === syncTrigger) return;
    const timer = setTimeout(() => push(code), 3000);
    return () => clearTimeout(timer);
  }, [syncTrigger, enabled, code, push]);

  // 自動プル: 有効化直後に即時実行、以降 60 秒間隔
  useEffect(() => {
    if (!enabled || !code) return;
    pull(code);
    const interval = setInterval(() => pull(code), 60_000);
    return () => clearInterval(interval);
  }, [enabled, code, pull]);

  return null;
}
