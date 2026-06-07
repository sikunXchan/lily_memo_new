'use client';

import { useState, useEffect } from 'react';
import { ArrowLeft, Sparkles } from 'lucide-react';
import { useT } from '@/lib/i18n';

interface NewsScreenProps {
  onGoBack: () => void;
}

export default function NewsScreen({ onGoBack }: NewsScreenProps) {
  const t = useT();
  const [html, setHtml] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/news.md')
      .then(r => r.text())
      .then(async text => {
        const { marked } = await import('marked');
        const result = await Promise.resolve(marked(text));
        setHtml(result as string);
        localStorage.setItem('lily_news_read_ts', String(Date.now()));
      })
      .catch(() => setHtml(`<p>${t('読み込みに失敗しました。')}</p>`))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="ns-root">
      <div className="ns-header">
        <button className="ns-back" onClick={onGoBack}>
          <ArrowLeft size={18} />
        </button>
        <Sparkles size={16} color="#f59e0b" />
        <span className="ns-title">{t('できること')}</span>
      </div>

      <div className="ns-body">
        {loading ? (
          <p className="ns-loading">{t('読み込み中...')}</p>
        ) : (
          <div className="ns-content" dangerouslySetInnerHTML={{ __html: html }} />
        )}
      </div>

      <style jsx>{`
        .ns-root {
          flex: 1; display: flex; flex-direction: column;
          background: var(--background); overflow: hidden;
        }
        .ns-header {
          display: flex; align-items: center; gap: 10px;
          padding: 12px 16px;
          border-bottom: 1px solid var(--border);
          background: var(--background);
          flex-shrink: 0;
        }
        .ns-back {
          width: 34px; height: 34px; border-radius: 50%;
          border: 1px solid var(--border); background: var(--accent);
          display: flex; align-items: center; justify-content: center;
          cursor: pointer; color: var(--primary); flex-shrink: 0;
        }
        .ns-title {
          font-size: 18px; font-weight: 800;
          background: linear-gradient(120deg, #f59e0b, #ff8da1);
          -webkit-background-clip: text; background-clip: text; color: transparent;
        }
        .ns-body {
          flex: 1; overflow-y: auto; padding: 20px 20px 40px;
          -webkit-overflow-scrolling: touch;
        }
        .ns-loading { color: var(--fg-muted); text-align: center; padding: 40px 0; }
        .ns-content :global(h1) {
          font-size: 1.4rem; font-weight: 800; color: var(--primary);
          margin: 0 0 24px; padding-bottom: 10px;
          border-bottom: 2px solid var(--border);
        }
        .ns-content :global(h2) {
          font-size: 1rem; font-weight: 800; color: var(--foreground);
          margin: 28px 0 14px; padding: 6px 12px;
          background: color-mix(in srgb, var(--primary) 8%, transparent);
          border-left: 3px solid var(--primary);
          border-radius: 0 8px 8px 0;
        }
        .ns-content :global(h3) {
          font-size: 0.95rem; font-weight: 700; color: var(--foreground);
          margin: 18px 0 8px;
        }
        .ns-content :global(p) {
          font-size: 0.88rem; line-height: 1.75; color: var(--fg-muted);
          margin: 0 0 12px;
        }
        .ns-content :global(ul), .ns-content :global(ol) {
          padding-left: 20px; margin: 0 0 12px;
        }
        .ns-content :global(li) {
          font-size: 0.88rem; line-height: 1.75; color: var(--fg-muted);
          margin-bottom: 4px;
        }
        .ns-content :global(strong) { color: var(--foreground); font-weight: 700; }
        .ns-content :global(hr) { border: none; border-top: 1px solid var(--border); margin: 20px 0; }
      `}</style>
    </div>
  );
}
