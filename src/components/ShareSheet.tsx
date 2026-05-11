'use client';

import { useState } from 'react';
import { Link, Copy, Check, Trash2, X } from 'lucide-react';

interface ShareSheetProps {
  noteServerId: string;
  onClose: () => void;
}

export default function ShareSheet({ noteServerId, onClose }: ShareSheetProps) {
  const [shareCode, setShareCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shareUrl = shareCode
    ? `${typeof window !== 'undefined' ? window.location.origin : ''}/shared/${shareCode}`
    : null;

  const createShare = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ noteId: noteServerId, permission: 'view' }),
      });
      if (!res.ok) throw new Error('共有リンクの作成に失敗しました');
      const data = await res.json();
      setShareCode(data.shareCode);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'エラーが発生しました');
    } finally {
      setLoading(false);
    }
  };

  const copyUrl = async () => {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const revokeShare = async () => {
    if (!shareCode) return;
    setLoading(true);
    try {
      await fetch(`/api/share/${shareCode}`, { method: 'DELETE' });
      setShareCode(null);
    } catch {
      setError('削除に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet" onClick={e => e.stopPropagation()}>
        <div className="sheet-header">
          <h3>メモを共有</h3>
          <button className="sheet-close" onClick={onClose}><X size={18} /></button>
        </div>

        {!shareCode ? (
          <div className="sheet-body">
            <p className="sheet-desc">リンクを知っている人なら誰でも閲覧できます。</p>
            <button className="btn-create" onClick={createShare} disabled={loading}>
              <Link size={16} />
              {loading ? '作成中...' : '共有リンクを作成'}
            </button>
            {error && <p className="sheet-error">{error}</p>}
          </div>
        ) : (
          <div className="sheet-body">
            <div className="url-row">
              <input className="url-input" readOnly value={shareUrl ?? ''} />
              <button className="btn-copy" onClick={copyUrl} title="コピー">
                {copied ? <Check size={16} /> : <Copy size={16} />}
              </button>
            </div>
            <button className="btn-revoke" onClick={revokeShare} disabled={loading}>
              <Trash2 size={14} />
              共有を解除
            </button>
            {error && <p className="sheet-error">{error}</p>}
          </div>
        )}

        <style jsx>{`
          .sheet-overlay {
            position: fixed; inset: 0; background: rgba(0,0,0,0.3);
            display: flex; align-items: flex-end; justify-content: center;
            z-index: 500;
          }
          .sheet {
            background: var(--bg); border-radius: 16px 16px 0 0;
            width: 100%; max-width: 480px; padding: 20px;
            border-top: 1px solid var(--border);
          }
          .sheet-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
          .sheet-header h3 { font-size: 1rem; font-weight: 600; }
          .sheet-close { background: none; border: none; cursor: pointer; color: var(--text-secondary); padding: 4px; }
          .sheet-desc { font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 16px; }
          .btn-create {
            display: flex; align-items: center; gap: 8px;
            width: 100%; padding: 10px 16px; border-radius: 10px;
            background: #ffb6c1; border: none; font-size: 0.9rem; cursor: pointer;
            color: #fff; font-weight: 600; justify-content: center;
          }
          .btn-create:disabled { opacity: 0.6; cursor: default; }
          .url-row { display: flex; gap: 8px; margin-bottom: 12px; }
          .url-input {
            flex: 1; padding: 8px 12px; border-radius: 8px;
            border: 1px solid var(--border); background: var(--bg-secondary, #f5f5f5);
            color: var(--text); font-size: 0.82rem; overflow: hidden; text-overflow: ellipsis;
          }
          .btn-copy {
            padding: 8px 12px; border-radius: 8px; border: 1px solid var(--border);
            background: none; cursor: pointer; color: var(--text);
          }
          .btn-revoke {
            display: flex; align-items: center; gap: 6px;
            padding: 7px 12px; border-radius: 8px; border: 1px solid var(--border);
            background: none; cursor: pointer; color: #e05; font-size: 0.82rem;
          }
          .btn-revoke:disabled { opacity: 0.6; cursor: default; }
          .sheet-error { font-size: 0.8rem; color: #e05; margin-top: 8px; }
        `}</style>
      </div>
    </div>
  );
}
