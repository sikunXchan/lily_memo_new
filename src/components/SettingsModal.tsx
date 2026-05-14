'use client';

import { Download, Upload, Cloud, CloudOff, LogOut, RefreshCw, Loader2 } from 'lucide-react';
import { useState, useEffect, useCallback } from 'react';
import { buildBackupJson, restoreBackupFromJson } from '@/lib/backup';
import { SUPABASE_CONFIGURED } from '@/lib/supabase';
import {
  subscribeSync,
  signIn,
  signUp,
  signOut,
  syncNow,
  type SyncStatus,
} from '@/lib/sync';

interface SettingsModalProps {
  onClose: () => void;
}

function formatRelative(ts: number): string {
  if (!ts) return '未同期';
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'たった今';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 時間前`;
  return new Date(ts).toLocaleString();
}

export default function SettingsModal({ onClose: _onClose }: SettingsModalProps) {
  void _onClose;
  const [isPersisted, setIsPersisted] = useState(false);
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);

  useEffect(() => {
    if (navigator.storage && navigator.storage.persisted) {
      navigator.storage.persisted().then(setIsPersisted);
    }
  }, []);

  useEffect(() => {
    const unsub = subscribeSync(s => setStatus(s));
    return unsub;
  }, []);

  const downloadBackup = async () => {
    const json = await buildBackupJson();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lily-memo-backup-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const uploadBackup = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const text = event.target?.result;
        if (typeof text !== 'string') throw new Error('Failed to read file content');
        if (!confirm('現在のデータを上書きしてバックアップを復元しますか？')) return;
        await restoreBackupFromJson(text);
        alert('復元が完了しました。ページを再読み込みします。');
        window.location.reload();
      } catch (err) {
        console.error('Backup restore error:', err);
        alert('バックアップファイルの読み込みに失敗しました。');
      }
    };
    reader.onerror = () => alert('ファイルの読み込みに失敗しました。');
    reader.readAsText(file, 'UTF-8');
  };

  const handleAuthSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthBusy(true);
    try {
      if (authMode === 'login') {
        await signIn(email.trim(), password);
      } else {
        await signUp(email.trim(), password);
        setAuthError('登録メールを送信しました。認証後にログインしてください。');
      }
      setPassword('');
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : '認証に失敗しました');
    } finally {
      setAuthBusy(false);
    }
  }, [authMode, email, password]);

  const handleSignOut = async () => {
    if (!confirm('クラウド同期からログアウトしますか？（ローカルのメモは残ります）')) return;
    await signOut();
  };

  const handleSyncNow = async () => {
    await syncNow();
  };

  return (
    <div className="settings-view">
      <header className="settings-header">
        <h2>設定</h2>
      </header>

      <div className="settings-sections">
        <section className="settings-section">
          <div className="section-title">
            <Cloud size={20} />
            <h3>クラウド同期</h3>
          </div>
          <div className="section-content">
            {!SUPABASE_CONFIGURED && (
              <p className="desc">
                同期を有効にするには <code>NEXT_PUBLIC_SUPABASE_URL</code> と <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> を <code>.env.local</code> に設定してください。詳細は <code>AGENTS.md</code>。
              </p>
            )}

            {SUPABASE_CONFIGURED && !status?.signedIn && (
              <>
                <p className="desc">
                  自分のアカウントを作成すると、同じアカウントでログインしたデバイス間でメモが自動同期されます。
                </p>
                <div className="auth-tabs">
                  <button
                    className={`auth-tab ${authMode === 'login' ? 'active' : ''}`}
                    onClick={() => { setAuthMode('login'); setAuthError(null); }}
                    type="button"
                  >ログイン</button>
                  <button
                    className={`auth-tab ${authMode === 'signup' ? 'active' : ''}`}
                    onClick={() => { setAuthMode('signup'); setAuthError(null); }}
                    type="button"
                  >新規登録</button>
                </div>
                <form onSubmit={handleAuthSubmit} className="auth-form">
                  <input
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    placeholder="メールアドレス"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="auth-input"
                    required
                  />
                  <input
                    type="password"
                    autoComplete={authMode === 'login' ? 'current-password' : 'new-password'}
                    placeholder="パスワード"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="auth-input"
                    minLength={6}
                    required
                  />
                  <button type="submit" className="btn-action" disabled={authBusy}>
                    {authBusy ? <Loader2 size={18} className="spin" /> : <Cloud size={18} />}
                    {authMode === 'login' ? 'ログイン' : 'アカウント作成'}
                  </button>
                </form>
                {authError && (
                  <div className="drive-message">
                    <CloudOff size={14} />
                    <span>{authError}</span>
                  </div>
                )}
              </>
            )}

            {SUPABASE_CONFIGURED && status?.signedIn && (
              <>
                <div className="sync-status">
                  <div className="sync-row">
                    <span className="sync-label">アカウント</span>
                    <span className="sync-value">{status.email ?? '(不明)'}</span>
                  </div>
                  <div className="sync-row">
                    <span className="sync-label">最終同期</span>
                    <span className="sync-value">
                      {status.isSyncing ? '同期中…' : formatRelative(status.lastSyncedAt)}
                    </span>
                  </div>
                  <div className="sync-row">
                    <span className="sync-label">未送信</span>
                    <span className="sync-value">{status.pendingCount} 件</span>
                  </div>
                  {status.lastError && (
                    <div className="drive-message">
                      <CloudOff size={14} />
                      <span>{status.lastError}</span>
                    </div>
                  )}
                </div>
                <div className="action-group">
                  <button className="btn-action outline" onClick={handleSyncNow} disabled={status.isSyncing}>
                    {status.isSyncing ? <Loader2 size={18} className="spin" /> : <RefreshCw size={18} />}
                    今すぐ同期
                  </button>
                  <button className="btn-action subtle" onClick={handleSignOut}>
                    <LogOut size={18} />
                    ログアウト
                  </button>
                </div>
              </>
            )}
          </div>
        </section>

        <section className="settings-section">
          <div className="section-title">
            <Download size={20} />
            <h3>バックアップと復元</h3>
          </div>
          <div className="section-content">
            <div className="status-badge">
              <div className={`dot ${isPersisted ? 'persisted' : ''}`} />
              <span>ストレージ永続化: {isPersisted ? '有効（安全）' : '標準'}</span>
            </div>
            <p className="desc">クラウド同期がない場合や、手元にローカルコピーを残したい時にどうぞ。</p>
            <div className="action-group">
              <button className="btn-action" onClick={downloadBackup}>
                <Download size={18} />
                バックアップをダウンロード
              </button>
              <label className="btn-action outline">
                <Upload size={18} />
                復元ファイルをアップロード
                <input type="file" hidden onChange={uploadBackup} accept=".json,application/json" />
              </label>
            </div>
          </div>
        </section>
      </div>

      <style jsx>{`
        .settings-view {
          padding: 32px;
          flex: 1;
          min-height: 0;
          overflow-y: auto;
          background: var(--background);
        }
        .settings-header {
          margin-bottom: 40px;
        }
        .settings-header h2 {
          font-size: 1.8rem;
          color: var(--primary);
        }
        .settings-sections {
          max-width: 600px;
          display: flex;
          flex-direction: column;
          gap: 40px;
        }
        .settings-section {
          background: var(--accent);
          border: 1px solid var(--border);
          padding: 24px;
          border-radius: 16px;
        }
        .section-title {
          display: flex;
          align-items: center;
          gap: 12px;
          color: var(--primary);
          margin-bottom: 20px;
        }
        .section-title h3 {
          margin: 0;
          font-size: 1.1rem;
        }
        .status-badge {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 8px;
          font-size: 0.8rem;
          font-weight: 600;
          color: #666;
        }
        .dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #ccc;
        }
        .dot.persisted {
          background: #22863a;
          box-shadow: 0 0 8px rgba(34, 134, 58, 0.4);
        }
        .desc {
          font-size: 0.85rem;
          color: #888;
          margin-bottom: 20px;
          line-height: 1.6;
        }
        .desc code {
          background: var(--background);
          padding: 1px 6px;
          border-radius: 4px;
          font-size: 0.8rem;
        }
        .action-group {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .btn-action {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          padding: 12px;
          background: var(--primary);
          color: white;
          font-weight: 600;
          border-radius: 12px;
          border: none;
          cursor: pointer;
          font-size: 0.9rem;
        }
        .btn-action.outline {
          background: transparent;
          border: 2px solid var(--primary);
          color: var(--primary);
          cursor: pointer;
        }
        .btn-action.subtle {
          background: transparent;
          color: var(--foreground);
          border: 1px solid var(--border);
          opacity: 0.85;
        }
        .btn-action:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .spin {
          animation: spin 1s linear infinite;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        .drive-message {
          margin-top: 12px;
          padding: 10px 12px;
          background: var(--background);
          border: 1px solid var(--border);
          border-radius: 8px;
          font-size: 0.85rem;
          color: var(--foreground);
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .auth-tabs {
          display: flex;
          gap: 6px;
          background: var(--background);
          padding: 4px;
          border-radius: 10px;
          margin-bottom: 12px;
        }
        .auth-tab {
          flex: 1;
          background: transparent;
          color: var(--foreground);
          padding: 8px 12px;
          font-weight: 600;
          border-radius: 8px;
          font-size: 0.85rem;
          opacity: 0.65;
        }
        .auth-tab.active {
          background: var(--accent);
          color: var(--primary);
          opacity: 1;
        }
        .auth-form {
          display: flex;
          flex-direction: column;
          gap: 10px;
          margin-bottom: 8px;
        }
        .auth-input {
          padding: 11px 12px;
          font-size: 0.95rem;
          border-radius: 10px;
          border: 1px solid var(--border);
          background: var(--background);
          color: var(--foreground);
          width: 100%;
        }
        .sync-status {
          display: flex;
          flex-direction: column;
          gap: 6px;
          padding: 14px;
          background: var(--background);
          border: 1px solid var(--border);
          border-radius: 12px;
          margin-bottom: 16px;
        }
        .sync-row {
          display: flex;
          justify-content: space-between;
          font-size: 0.85rem;
        }
        .sync-label {
          color: #888;
        }
        .sync-value {
          font-weight: 600;
          color: var(--foreground);
        }

        @media (max-width: 768px) {
          .settings-view {
            padding: 24px 16px;
          }
          .settings-header h2 {
            font-size: 1.5rem;
          }
          .settings-section {
            padding: 16px;
          }
        }
      `}</style>
    </div>
  );
}
