'use client';

import { Download, Upload, Cloud, CloudOff, CloudDownload, CloudUpload, LogOut } from 'lucide-react';
import { useState, useEffect } from 'react';
import { buildBackupJson, restoreBackupFromJson } from '@/lib/backup';
import {
  driveSignIn,
  driveSignOut,
  driveHasToken,
  driveUploadBackup,
  driveDownloadBackup,
  DRIVE_CLIENT_ID,
} from '@/lib/googleDrive';

interface SettingsModalProps {
  onClose: () => void;
}

export default function SettingsModal({ onClose: _onClose }: SettingsModalProps) {
  void _onClose;
  const [isPersisted, setIsPersisted] = useState(false);
  const [driveSignedIn, setDriveSignedIn] = useState(false);
  const [driveBusy, setDriveBusy] = useState<null | 'signin' | 'upload' | 'download'>(null);
  const [driveMessage, setDriveMessage] = useState<string | null>(null);

  useEffect(() => {
    if (navigator.storage && navigator.storage.persisted) {
      navigator.storage.persisted().then(setIsPersisted);
    }
    setDriveSignedIn(driveHasToken());
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
    reader.onerror = () => {
      alert('ファイルの読み込みに失敗しました。');
    };
    reader.readAsText(file, 'UTF-8');
  };

  const handleDriveSignIn = async () => {
    setDriveMessage(null);
    setDriveBusy('signin');
    try {
      await driveSignIn();
      setDriveSignedIn(true);
    } catch (err) {
      console.error(err);
      setDriveMessage(err instanceof Error ? err.message : 'Google ログインに失敗しました');
    } finally {
      setDriveBusy(null);
    }
  };

  const handleDriveSignOut = () => {
    driveSignOut();
    setDriveSignedIn(false);
    setDriveMessage(null);
  };

  const handleDriveUpload = async () => {
    setDriveMessage(null);
    setDriveBusy('upload');
    try {
      const json = await buildBackupJson();
      await driveUploadBackup(json);
      setDriveMessage('クラウドへ保存しました');
    } catch (err) {
      console.error(err);
      setDriveMessage(err instanceof Error ? err.message : '保存に失敗しました');
    } finally {
      setDriveBusy(null);
    }
  };

  const handleDriveDownload = async () => {
    setDriveMessage(null);
    if (!confirm('クラウドのバックアップで現在のデータを上書きしますか？')) return;
    setDriveBusy('download');
    try {
      const json = await driveDownloadBackup();
      if (!json) {
        setDriveMessage('クラウドにバックアップが見つかりませんでした');
        return;
      }
      await restoreBackupFromJson(json);
      setDriveMessage('クラウドから復元しました。再読み込みします…');
      setTimeout(() => window.location.reload(), 600);
    } catch (err) {
      console.error(err);
      setDriveMessage(err instanceof Error ? err.message : '復元に失敗しました');
    } finally {
      setDriveBusy(null);
    }
  };

  return (
    <div className="settings-view">
      <header className="settings-header">
        <h2>設定</h2>
      </header>

      <div className="settings-sections">
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
            <p className="desc">iOSのSafariでは「共有」ボタンからメモを個別ファイルとして保存することをお勧めします。</p>
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

        <section className="settings-section">
          <div className="section-title">
            <Cloud size={20} />
            <h3>Google Drive と同期</h3>
          </div>
          <div className="section-content">
            <p className="desc">
              {DRIVE_CLIENT_ID
                ? '非公開の appDataFolder にバックアップ JSON を保存します。複数端末で手動で push/pull することで同期します。'
                : '同期を有効にするには NEXT_PUBLIC_GOOGLE_CLIENT_ID を設定してください。'}
            </p>
            {!driveSignedIn ? (
              <button className="btn-action" onClick={handleDriveSignIn} disabled={!DRIVE_CLIENT_ID || driveBusy === 'signin'}>
                <Cloud size={18} />
                {driveBusy === 'signin' ? '接続中…' : 'Google でログイン'}
              </button>
            ) : (
              <div className="action-group">
                <button className="btn-action" onClick={handleDriveUpload} disabled={driveBusy !== null}>
                  <CloudUpload size={18} />
                  {driveBusy === 'upload' ? '保存中…' : 'クラウドへ保存'}
                </button>
                <button className="btn-action outline" onClick={handleDriveDownload} disabled={driveBusy !== null}>
                  <CloudDownload size={18} />
                  {driveBusy === 'download' ? '復元中…' : 'クラウドから復元'}
                </button>
                <button className="btn-action subtle" onClick={handleDriveSignOut} disabled={driveBusy !== null}>
                  <LogOut size={18} />
                  ログアウト
                </button>
              </div>
            )}
            {driveMessage && (
              <div className="drive-message">
                <CloudOff size={14} />
                <span>{driveMessage}</span>
              </div>
            )}
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
