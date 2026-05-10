'use client';

import { Download, Upload, CloudUpload, CloudDownload } from 'lucide-react';
import { useState, useEffect } from 'react';
import { db } from '@/lib/db';

interface SettingsModalProps {
  onClose: () => void;
}

export default function SettingsModal({ onClose }: SettingsModalProps) {
  const [isPersisted, setIsPersisted] = useState(false);
  const [syncCode, setSyncCode] = useState('');
  const [pullCode, setPullCode] = useState('');
  const [syncStatus, setSyncStatus] = useState('');

  useEffect(() => {
    if (navigator.storage && navigator.storage.persisted) {
      navigator.storage.persisted().then(setIsPersisted);
    }
  }, []);

  const downloadBackup = async () => {
    const folders = await db.folders.toArray();
    const notes = await db.notes.toArray();
    const data = { folders, notes, timestamp: Date.now() };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
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
        const data = JSON.parse(event.target?.result as string);
        if (confirm('現在のデータを上書きしてバックアップを復元しますか？')) {
          await db.folders.clear();
          await db.notes.clear();
          if (data.folders) await db.folders.bulkAdd(data.folders);
          if (data.notes) await db.notes.bulkAdd(data.notes);
          alert('復元が完了しました。ページを再読み込みします。');
          window.location.reload();
        }
      } catch {
        alert('バックアップファイルの読み込みに失敗しました。');
      }
    };
    reader.readAsText(file);
  };

  const pushToCloud = async () => {
    const folders = await db.folders.toArray();
    const notes = await db.notes.toArray();
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    setSyncStatus('送信中...');
    try {
      const res = await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'push', code, payload: { folders, notes } }),
      });
      const json = await res.json();
      if (json.success) {
        setSyncCode(code);
        setSyncStatus('');
      } else {
        setSyncStatus('送信に失敗しました。');
      }
    } catch {
      setSyncStatus('エラーが発生しました。');
    }
  };

  const pullFromCloud = async () => {
    const code = pullCode.trim().toUpperCase();
    if (!code) return;
    setSyncStatus('取得中...');
    try {
      const res = await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'pull', code }),
      });
      const json = await res.json();
      if (json.success && json.data) {
        if (!confirm('現在のデータを上書きして取得しますか？')) {
          setSyncStatus('');
          return;
        }
        await db.folders.clear();
        await db.notes.clear();
        if (json.data.folders) await db.folders.bulkAdd(json.data.folders);
        if (json.data.notes) await db.notes.bulkAdd(json.data.notes);
        alert('取得完了！ページを再読み込みします。');
        window.location.reload();
      } else {
        setSyncStatus('コードが見つかりません。');
      }
    } catch {
      setSyncStatus('エラーが発生しました。');
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
            <CloudUpload size={20} />
            <h3>クラウド同期</h3>
          </div>
          <div className="section-content">
            <p className="desc">別の端末とすべてのメモを同期できます。</p>

            <div className="sync-block">
              <p className="sync-label">① この端末のデータをクラウドへ送信</p>
              <button className="btn-action" onClick={pushToCloud}>
                <CloudUpload size={18} />
                クラウドへ送信
              </button>
              {syncCode && (
                <div className="code-display">
                  <span className="code-label">同期コード</span>
                  <span className="code-value">{syncCode}</span>
                  <p className="code-hint">別の端末でこのコードを入力して取得してください（24時間有効）</p>
                </div>
              )}
            </div>

            <div className="sync-block">
              <p className="sync-label">② 別の端末から同期コードで取得</p>
              <div className="pull-row">
                <input
                  className="code-input"
                  placeholder="同期コードを入力"
                  value={pullCode}
                  onChange={e => setPullCode(e.target.value)}
                  maxLength={6}
                />
                <button className="btn-action pull-btn" onClick={pullFromCloud}>
                  <CloudDownload size={18} />
                  取得
                </button>
              </div>
            </div>

            {syncStatus && <p className="sync-status">{syncStatus}</p>}
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
            <p className="desc">iOSのSafariでは「共有」ボタンからメモを個別ファイルとして保存することをお勧めします。</p>
            <div className="action-group">
              <button className="btn-action" onClick={downloadBackup}>
                <Download size={18} />
                バックアップをダウンロード
              </button>
              <label className="btn-action outline">
                <Upload size={18} />
                復元ファイルをアップロード
                <input type="file" hidden onChange={uploadBackup} accept=".json" />
              </label>
            </div>
          </div>
        </section>
      </div>

      <style jsx>{`
        .settings-view {
          padding: 32px;
          height: 100%;
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
        .sync-block {
          margin-bottom: 24px;
        }
        .sync-label {
          font-size: 0.85rem;
          font-weight: 600;
          color: var(--foreground);
          margin-bottom: 10px;
        }
        .code-display {
          margin-top: 14px;
          padding: 14px;
          background: var(--background);
          border: 1px solid var(--border);
          border-radius: 10px;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .code-label {
          font-size: 0.75rem;
          color: #888;
        }
        .code-value {
          font-size: 1.8rem;
          font-weight: 700;
          letter-spacing: 0.2em;
          color: var(--primary);
          font-family: monospace;
        }
        .code-hint {
          font-size: 0.75rem;
          color: #888;
          margin-top: 4px;
        }
        .pull-row {
          display: flex;
          gap: 8px;
          align-items: center;
        }
        .code-input {
          flex: 1;
          padding: 10px 14px;
          background: var(--background);
          color: var(--foreground);
          border: 1px solid var(--border);
          border-radius: 10px;
          font-size: 1rem;
          font-family: monospace;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          outline: none;
        }
        .pull-btn {
          flex-shrink: 0;
          padding: 10px 16px !important;
        }
        .sync-status {
          font-size: 0.85rem;
          color: #888;
          margin-top: 8px;
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
