'use client';

import { X, Download, Upload, Key, Palette, Trash2 } from 'lucide-react';
import { useState, useEffect } from 'react';
import { db } from '@/lib/db';

interface SettingsModalProps {
  onClose: () => void;
}

export default function SettingsModal({ onClose }: SettingsModalProps) {
  const [aiKey, setAiKey] = useState('');
  const [isPersisted, setIsPersisted] = useState(false);

  useEffect(() => {
    const savedKey = localStorage.getItem('gemini_api_key');
    if (savedKey) setAiKey(savedKey);

    if (navigator.storage && navigator.storage.persisted) {
      navigator.storage.persisted().then(setIsPersisted);
    }
  }, []);

  const saveAiKey = (key: string) => {
    setAiKey(key);
    localStorage.setItem('gemini_api_key', key);
  };

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
      } catch (err) {
        alert('バックアップファイルの読み込みに失敗しました。');
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content glass" onClick={e => e.stopPropagation()}>
        <header className="modal-header">
          <h2>設定</h2>
          <button className="btn-close" onClick={onClose}><X size={24} /></button>
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
                  <input type="file" hidden onChange={uploadBackup} accept=".json" />
                </label>
              </div>
            </div>
          </section>

          <section className="settings-section">
            <div className="section-title">
              <Key size={20} />
              <h3>AI 連携設定</h3>
            </div>
            <div className="section-content">
              <p className="desc">Gemini APIキーを入力して、文章の校正や相談機能を利用できます。</p>
              <div className="input-group">
                <input 
                  type="password" 
                  placeholder="API Key を入力" 
                  value={aiKey}
                  onChange={(e) => saveAiKey(e.target.value)}
                  className="settings-input"
                />
              </div>
            </div>
          </section>

          <section className="settings-section">
            <div className="section-title">
              <Palette size={20} />
              <h3>アピアランス</h3>
            </div>
            <div className="section-content">
              <p className="desc">カラーテーマや背景スタイルの設定（開発中）</p>
            </div>
          </section>

          <button className="btn-danger" onClick={() => confirm('すべてのデータを消去しますか？') && db.delete().then(() => window.location.reload())}>
            <Trash2 size={18} />
            データベースを完全にリセット
          </button>
        </div>
      </div>

      <style jsx>{`
        .modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0,0,0,0.4);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
          backdrop-filter: blur(4px);
        }
        .modal-content {
          width: 90%;
          max-width: 500px;
          background: var(--background);
          border-radius: var(--radius);
          padding: 32px;
          max-height: 85vh;
          overflow-y: auto;
        }
        .modal-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 32px;
        }
        .btn-close {
          background: transparent;
          color: var(--foreground);
        }
        .settings-sections {
          display: flex;
          flex-direction: column;
          gap: 40px;
        }
        .section-title {
          display: flex;
          align-items: center;
          gap: 12px;
          color: var(--primary);
          margin-bottom: 16px;
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
          margin-bottom: 16px;
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
        }
        .btn-action.outline {
          background: transparent;
          border: 2px solid var(--primary);
          color: var(--primary);
          cursor: pointer;
        }
        .settings-input {
          width: 100%;
          padding: 12px;
          background: var(--accent);
          border: 1px solid var(--border);
          border-radius: 12px;
        }
        .btn-danger {
          margin-top: 20px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          padding: 12px;
          background: #fff0f0;
          color: #ff4d4d;
          border-radius: 12px;
          font-weight: 600;
        }
      `}</style>
    </div>
  );
}
