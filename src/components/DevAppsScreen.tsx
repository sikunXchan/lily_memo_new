'use client';

import { useState, useEffect } from 'react';
import { ArrowLeft, Layers } from 'lucide-react';
import { useT } from '@/lib/i18n';

interface DevAppsScreenProps {
  onGoBack: () => void;
}

export default function DevAppsScreen({ onGoBack }: DevAppsScreenProps) {
  const t = useT();
  const [html, setHtml] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(false);
    fetch('/dev-apps.md', { cache: 'no-store' })
      .then(r => r.text())
      .then(async text => {
        const { marked } = await import('marked');
        setHtml(await Promise.resolve(marked(text)));
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="da-root">
      <div className="da-header">
        <button className="da-back" onClick={onGoBack}>
          <ArrowLeft size={18} />
        </button>
        <Layers size={16} color="#a78bfa" />
        <span className="da-title">{t('開発者のアプリ')}</span>
      </div>

      <div className="da-body">
        {loading && <p className="da-loading">{t('読み込み中...')}</p>}
        {error && <p className="da-error">{t('読み込みに失敗しました。')}</p>}
        {!loading && !error && (
          <div className="da-content" dangerouslySetInnerHTML={{ __html: html }} />
        )}
      </div>

      <style jsx>{`
        .da-root {
          flex: 1; display: flex; flex-direction: column;
          background: var(--background); overflow: hidden;
        }
        .da-header {
          display: flex; align-items: center; gap: 10px;
          padding: 12px 16px;
          border-bottom: 1px solid var(--border);
          background: var(--background);
          flex-shrink: 0;
        }
        .da-back {
          width: 34px; height: 34px; border-radius: 50%;
          border: 1px solid var(--border); background: var(--accent);
          display: flex; align-items: center; justify-content: center;
          cursor: pointer; color: var(--foreground);
        }
        .da-title {
          font-size: 15px; font-weight: 700; color: var(--foreground);
        }
        .da-body {
          flex: 1; overflow-y: auto;
          padding: 20px 18px 40px;
          -webkit-overflow-scrolling: touch;
        }
        .da-loading, .da-error {
          font-size: 14px; color: var(--muted); text-align: center;
          margin-top: 40px;
        }
        .da-error { color: #f87171; }
        .da-content :global(h1) {
          font-size: 22px; font-weight: 800;
          color: var(--foreground);
          margin: 0 0 6px; letter-spacing: -.02em;
        }
        .da-content :global(h2) {
          font-size: 17px; font-weight: 700;
          color: var(--foreground);
          margin: 28px 0 10px;
          padding-bottom: 6px;
          border-bottom: 1px solid var(--border);
        }
        .da-content :global(h3) {
          font-size: 14px; font-weight: 700;
          color: var(--foreground); margin: 18px 0 6px;
        }
        .da-content :global(p) {
          font-size: 14px; line-height: 1.75;
          color: var(--muted-foreground, var(--foreground));
          margin: 0 0 12px;
        }
        .da-content :global(blockquote) {
          border-left: 3px solid #a78bfa;
          margin: 12px 0; padding: 8px 14px;
          background: rgba(167,139,250,.08);
          border-radius: 0 8px 8px 0;
        }
        .da-content :global(blockquote p) {
          margin: 0; color: var(--foreground); font-style: italic;
        }
        .da-content :global(strong) {
          font-weight: 700; color: var(--foreground);
        }
        .da-content :global(ul), .da-content :global(ol) {
          padding-left: 20px; margin: 0 0 12px;
        }
        .da-content :global(li) {
          font-size: 14px; line-height: 1.7;
          color: var(--muted-foreground, var(--foreground));
          margin-bottom: 4px;
        }
        .da-content :global(a) {
          color: #a78bfa; text-decoration: none;
          border-bottom: 1px solid rgba(167,139,250,.35);
        }
        .da-content :global(a:active) { opacity: .7; }
        .da-content :global(hr) {
          border: none; border-top: 1px solid var(--border);
          margin: 24px 0;
        }
        .da-content :global(em) {
          font-size: 12px; color: var(--muted);
        }
        .da-content :global(code) {
          font-size: 12px;
          background: var(--accent);
          border-radius: 4px; padding: 1px 5px;
        }
      `}</style>
    </div>
  );
}
