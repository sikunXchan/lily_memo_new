'use client';

import { RefreshCw, CheckCircle, AlertCircle } from 'lucide-react';
import { useSync } from '@/lib/useSync';

export default function SyncStatus() {
  const { isSyncing, lastSyncAt, error, sync } = useSync();

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="sync-status">
      <button
        className={`sync-btn ${isSyncing ? 'syncing' : ''}`}
        onClick={() => sync()}
        disabled={isSyncing}
        title="今すぐ同期"
      >
        <RefreshCw size={14} className={isSyncing ? 'spin' : ''} />
        <span>{isSyncing ? '同期中...' : '同期'}</span>
      </button>

      {error ? (
        <span className="sync-error">
          <AlertCircle size={12} />
          エラー
        </span>
      ) : lastSyncAt ? (
        <span className="sync-ok">
          <CheckCircle size={12} />
          {formatTime(lastSyncAt)}
        </span>
      ) : null}

      <style jsx>{`
        .sync-status { display: flex; align-items: center; gap: 8px; padding: 4px 0; }
        .sync-btn {
          display: flex; align-items: center; gap: 4px;
          padding: 4px 10px; border-radius: 6px; border: 1px solid var(--border);
          background: none; color: var(--text); cursor: pointer; font-size: 0.78rem;
          transition: background 0.15s;
        }
        .sync-btn:hover:not(:disabled) { background: var(--hover); }
        .sync-btn:disabled { opacity: 0.6; cursor: default; }
        .sync-ok { display: flex; align-items: center; gap: 3px; font-size: 0.72rem; color: var(--text-secondary); }
        .sync-error { display: flex; align-items: center; gap: 3px; font-size: 0.72rem; color: #e05; }
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
