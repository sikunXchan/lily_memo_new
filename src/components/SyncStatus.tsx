'use client';

import { useState, useEffect } from 'react';
import { RefreshCw, Copy, Check, Upload, Download, Key, X } from 'lucide-react';
import { nanoid } from 'nanoid';
import { useSync, getSyncCode, saveSyncCode, clearSyncCode } from '@/lib/useSync';

export default function SyncStatus() {
  const { isSyncing, lastSyncAt, error, push, pull } = useSync();
  const [code, setCode] = useState<string | null>(null);
  const [inputCode, setInputCode] = useState('');
  const [showInput, setShowInput] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setCode(getSyncCode());
  }, []);

  const generateCode = () => {
    const newCode = nanoid(20);
    saveSyncCode(newCode);
    setCode(newCode);
  };

  const forgetCode = () => {
    clearSyncCode();
    setCode(null);
  };

  const copyCode = async () => {
    if (!code) return;
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const loadCode = () => {
    const trimmed = inputCode.trim();
    if (!trimmed) return;
    saveSyncCode(trimmed);
    setCode(trimmed);
    setInputCode('');
    setShowInput(false);
  };

  const formatTime = (ts: number) =>
    new Date(ts).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="sync-wrap">
      <div className="sync-header">
        <Key size={13} />
        <span>同期コード</span>
      </div>

      {code ? (
        <>
          <div className="code-row">
            <span className="code-text">{code}</span>
            <button className="icon-btn" onClick={copyCode} title="コードをコピー">
              {copied ? <Check size={13} /> : <Copy size={13} />}
            </button>
            <button className="icon-btn icon-btn--danger" onClick={forgetCode} title="コードを削除">
              <X size={13} />
            </button>
          </div>

          <div className="sync-actions">
            <button className="sync-btn" onClick={() => push(code)} disabled={isSyncing}>
              <Upload size={13} />
              プッシュ
            </button>
            <button className="sync-btn" onClick={() => pull(code)} disabled={isSyncing}>
              <Download size={13} />
              プル
            </button>
            {isSyncing && <RefreshCw size={13} className="spin" />}
          </div>

          {lastSyncAt && (
            <span className="sync-time">最終同期 {formatTime(lastSyncAt)}</span>
          )}
        </>
      ) : (
        <button className="gen-btn" onClick={generateCode}>
          <Key size={13} />
          コードを生成
        </button>
      )}

      {showInput ? (
        <div className="input-row">
          <input
            className="code-input"
            placeholder="別デバイスのコードを入力"
            value={inputCode}
            onChange={e => setInputCode(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && loadCode()}
            autoFocus
          />
          <button className="icon-btn" onClick={loadCode}>
            <Check size={13} />
          </button>
          <button className="icon-btn" onClick={() => setShowInput(false)}>
            <X size={13} />
          </button>
        </div>
      ) : (
        <button className="link-btn" onClick={() => setShowInput(true)}>
          別のコードを読み込む
        </button>
      )}

      {error && <p className="sync-error">{error}</p>}

      <style jsx>{`
        .sync-wrap { padding: 10px 0; border-top: 1px solid var(--border); }
        .sync-header { display: flex; align-items: center; gap: 5px; font-size: 0.73rem; color: var(--text-secondary); margin-bottom: 6px; }
        .code-row { display: flex; align-items: center; gap: 4px; margin-bottom: 6px; }
        .code-text { font-size: 0.72rem; font-family: monospace; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; background: var(--bg-secondary, #f5f5f5); padding: 3px 6px; border-radius: 5px; color: var(--text); }
        .icon-btn { background: none; border: 1px solid var(--border); border-radius: 5px; padding: 3px 5px; cursor: pointer; color: var(--text-secondary); display: flex; align-items: center; }
        .icon-btn:hover { background: var(--hover); }
        .icon-btn--danger:hover { color: #e05; border-color: #e05; }
        .sync-actions { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
        .sync-btn { display: flex; align-items: center; gap: 4px; padding: 4px 9px; border-radius: 6px; border: 1px solid var(--border); background: none; color: var(--text); font-size: 0.78rem; cursor: pointer; }
        .sync-btn:hover:not(:disabled) { background: var(--hover); }
        .sync-btn:disabled { opacity: 0.5; cursor: default; }
        .sync-time { font-size: 0.7rem; color: var(--text-secondary); }
        .gen-btn { display: flex; align-items: center; gap: 5px; padding: 5px 10px; border-radius: 7px; border: 1px dashed var(--border); background: none; color: var(--text-secondary); font-size: 0.78rem; cursor: pointer; width: 100%; justify-content: center; margin-bottom: 6px; }
        .gen-btn:hover { background: var(--hover); color: var(--text); }
        .input-row { display: flex; gap: 4px; margin-top: 6px; }
        .code-input { flex: 1; padding: 4px 8px; border-radius: 6px; border: 1px solid var(--border); background: var(--bg); color: var(--text); font-size: 0.78rem; }
        .link-btn { background: none; border: none; color: var(--text-secondary); font-size: 0.72rem; cursor: pointer; padding: 2px 0; text-decoration: underline; margin-top: 4px; }
        .link-btn:hover { color: var(--text); }
        .sync-error { font-size: 0.72rem; color: #e05; margin-top: 4px; }
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
