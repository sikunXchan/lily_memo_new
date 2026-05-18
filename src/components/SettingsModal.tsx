'use client';

import { Download, Upload, Type, Palette, Sparkles, Eye, EyeOff } from 'lucide-react';
import { useState, useEffect } from 'react';
import { buildBackupJson, restoreBackupFromJson } from '@/lib/backup';
import { useTheme } from './ThemeContext';
import { FONT_OPTIONS, THEME_LIST, THEMES } from '@/lib/themes';

interface SettingsModalProps {
  onClose: () => void;
}

export default function SettingsModal({ onClose: _onClose }: SettingsModalProps) {
  void _onClose;
  const [isPersisted, setIsPersisted] = useState(false);
  const { fontId, setFontId, themeId, setThemeId } = useTheme();
  const [geminiKey, setGeminiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [keySaved, setKeySaved] = useState(false);

  useEffect(() => {
    if (navigator.storage && navigator.storage.persisted) {
      navigator.storage.persisted().then(setIsPersisted);
    }
    setGeminiKey(localStorage.getItem('lily_gemini_api_key') || '');
  }, []);

  const saveGeminiKey = () => {
    localStorage.setItem('lily_gemini_api_key', geminiKey.trim());
    setKeySaved(true);
    setTimeout(() => setKeySaved(false), 2000);
  };

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

  return (
    <div className="settings-view">
      <header className="settings-header">
        <h2>設定</h2>
      </header>

      <div className="settings-sections">
        <section className="settings-section">
          <div className="section-title">
            <Palette size={20} />
            <h3>テーマ</h3>
          </div>
          <div className="section-content">
            <p className="desc">アプリ全体の配色を切り替えます。「夜空」は星空の背景になります。</p>
            <div className="option-grid">
              {THEME_LIST.map(id => {
                const t = THEMES[id];
                return (
                  <button
                    key={id}
                    className={`option-card ${themeId === id ? 'selected' : ''}`}
                    onClick={() => setThemeId(id)}
                  >
                    <span className="swatch" style={{ background: t.bg, borderColor: t.border }}>
                      <span className="swatch-dot" style={{ background: t.primary }} />
                    </span>
                    <span className="option-name">{t.name}</span>
                    <span className="option-tag">{t.tag}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        <section className="settings-section">
          <div className="section-title">
            <Type size={20} />
            <h3>フォント</h3>
          </div>
          <div className="section-content">
            <p className="desc">アプリ全体の文字の書体を選べます。</p>
            <div className="option-grid">
              {FONT_OPTIONS.map(f => (
                <button
                  key={f.id}
                  className={`option-card ${fontId === f.id ? 'selected' : ''}`}
                  onClick={() => setFontId(f.id)}
                >
                  <span
                    className="font-preview"
                    style={{ fontFamily: f.value || 'inherit' }}
                  >
                    あA
                  </span>
                  <span className="option-name">{f.name}</span>
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="settings-section">
          <div className="section-title">
            <Sparkles size={20} />
            <h3>AIアシスタント (Lily)</h3>
          </div>
          <div className="section-content">
            <p className="desc">Gemini APIキーを設定すると、Lilyがメモの分析・図の作成・問題作りをお手伝いします。</p>
            <div className="api-key-wrap">
              <input
                type={showKey ? 'text' : 'password'}
                className="api-key-input"
                placeholder="AIzaSy..."
                value={geminiKey}
                onChange={e => setGeminiKey(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') saveGeminiKey(); }}
              />
              <button className="show-key-btn" onClick={() => setShowKey(p => !p)} title={showKey ? '隠す' : '表示'}>
                {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            <button className={`btn-action ${keySaved ? 'saved' : ''}`} onClick={saveGeminiKey}>
              {keySaved ? '✓ 保存しました' : '保存する'}
            </button>
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
            <p className="desc">手元にローカルコピーを残したい時にどうぞ。別の端末でもこのファイルを取り込めば同じ内容を見られます。</p>
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
          max-width: 600px;
          margin: 0 auto 40px;
        }
        .settings-header h2 {
          font-size: 1.8rem;
          color: var(--primary);
        }
        .settings-sections {
          max-width: 600px;
          margin: 0 auto;
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
        .option-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
          gap: 10px;
        }
        .option-card {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 4px;
          padding: 12px;
          background: var(--surface, var(--background));
          border: 2px solid var(--border);
          border-radius: 12px;
          cursor: pointer;
          transition: border-color 0.15s, transform 0.15s;
          text-align: left;
        }
        .option-card:hover {
          transform: translateY(-1px);
        }
        .option-card.selected {
          border-color: var(--primary);
          box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary) 22%, transparent);
        }
        .swatch {
          width: 100%;
          height: 38px;
          border-radius: 8px;
          border: 1px solid;
          position: relative;
          margin-bottom: 4px;
        }
        .swatch-dot {
          position: absolute;
          right: 6px;
          bottom: 6px;
          width: 14px;
          height: 14px;
          border-radius: 50%;
          box-shadow: 0 1px 4px rgba(0,0,0,0.3);
        }
        .font-preview {
          font-size: 1.5rem;
          font-weight: 700;
          color: var(--foreground);
          margin-bottom: 2px;
        }
        .option-name {
          font-size: 0.85rem;
          font-weight: 700;
          color: var(--foreground);
        }
        .option-tag {
          font-size: 0.65rem;
          font-weight: 600;
          letter-spacing: 0.08em;
          color: var(--fg-faint);
        }
        .status-badge {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 8px;
          font-size: 0.8rem;
          font-weight: 600;
          color: var(--fg-muted);
        }
        .dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--fg-faint);
        }
        .dot.persisted {
          background: #22863a;
          box-shadow: 0 0 8px rgba(34, 134, 58, 0.4);
        }
        .desc {
          font-size: 0.85rem;
          color: var(--fg-muted);
          margin-bottom: 20px;
          line-height: 1.6;
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
        .btn-action.saved {
          background: #22863a;
        }
        .api-key-wrap {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 12px;
        }
        .api-key-input {
          flex: 1;
          background: var(--accent);
          border: 1px solid var(--border);
          border-radius: 10px;
          padding: 10px 12px;
          font-size: 0.9rem;
          color: var(--foreground);
          outline: none;
          font-family: monospace;
        }
        .api-key-input:focus { border-color: var(--primary); }
        .show-key-btn {
          background: var(--accent);
          border: 1px solid var(--border);
          border-radius: 8px;
          padding: 8px 10px;
          cursor: pointer;
          color: var(--fg-muted);
          display: flex;
          align-items: center;
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
