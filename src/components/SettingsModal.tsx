'use client';

import { Download, Upload } from 'lucide-react';
import { useState, useEffect } from 'react';
import { db } from '@/lib/db';

interface SettingsModalProps {
  onClose: () => void;
}

export default function SettingsModal({ onClose }: SettingsModalProps) {
  const [isPersisted, setIsPersisted] = useState(false);

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
        const text = event.target?.result;
        if (typeof text !== 'string') throw new Error('Failed to read file content');
        const data = JSON.parse(text);
        if (!confirm('現在のデータを上書きしてバックアップを復元しますか？')) return;
        await db.transaction('rw', db.folders, db.notes, async () => {
          await db.folders.clear();
          await db.notes.clear();
          if (data.folders?.length) await db.folders.bulkPut(data.folders);
          if (data.notes?.length) await db.notes.bulkPut(data.notes);
        });
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
