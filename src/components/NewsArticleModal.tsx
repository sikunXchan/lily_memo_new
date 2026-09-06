'use client';

import { useEffect, useState } from 'react';
import {
  ArrowLeft, Bookmark, ExternalLink, Volume2, Pause, Sparkles,
  Loader2, NotebookPen, Check,
} from 'lucide-react';
import NewsInteractiveText from './NewsInteractiveText';
import NewsSentenceText from './NewsSentenceText';
import { db, newSyncId } from '@/lib/db';
import { markdownToTiptapHtml } from '@/lib/markdownToTiptap';
import { explainNewsArticle, type NewsExplanation } from '@/lib/newsExplain';
import type { NewsArticle } from '@/lib/newsFeeds';
import { useT } from '@/lib/i18n';

interface NewsArticleModalProps {
  article: NewsArticle;
  onClose: () => void;
  onWordSelected: (word: string, rect: DOMRect) => void;
  isSaved: boolean;
  onToggleSave: () => void;
  highlightWords: string[];
}

export default function NewsArticleModal({
  article, onClose, onWordSelected, isSaved, onToggleSave, highlightWords,
}: NewsArticleModalProps) {
  const t = useT();
  const [isPlaying, setIsPlaying] = useState(false);
  const [explanation, setExplanation] = useState<NewsExplanation | null>(null);
  const [explainState, setExplainState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [explainError, setExplainError] = useState('');
  const [memoSaved, setMemoSaved] = useState(false);

  useEffect(() => {
    setIsPlaying(false);
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    return () => { if ('speechSynthesis' in window) window.speechSynthesis.cancel(); };
  }, [article.id]);

  const toggleAudio = () => {
    if (!('speechSynthesis' in window)) return;
    if (isPlaying) {
      window.speechSynthesis.cancel();
      setIsPlaying(false);
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(`${article.title}. ${article.snippet}`);
    utterance.lang = 'en-US';
    utterance.rate = 1.0;
    utterance.onend = () => setIsPlaying(false);
    utterance.onerror = () => setIsPlaying(false);
    window.speechSynthesis.speak(utterance);
    setIsPlaying(true);
  };

  const handleExplain = async () => {
    if (explainState === 'loading') return;
    setExplainState('loading');
    setExplainError('');
    try {
      const result = await explainNewsArticle(article.title, article.snippet);
      setExplanation(result);
      setExplainState('idle');
    } catch (e) {
      setExplainError(e instanceof Error ? e.message : String(e));
      setExplainState('error');
    }
  };

  const handleSaveAsMemo = async () => {
    if (memoSaved) return;
    const now = Date.now();
    const lines = [
      `# ${article.title}`,
      '',
      article.snippet,
      '',
      `[${t('元記事を読む')}](${article.link})`,
    ];
    if (explanation) {
      lines.push('', '## 和訳', explanation.japanese);
      if (explanation.vocabulary.length) {
        lines.push('', '## 単語');
        explanation.vocabulary.forEach(v => lines.push(`- **${v.word}**: ${v.meaning} — ${v.note}`));
      }
      if (explanation.tip) lines.push('', '## 豆知識', explanation.tip);
    }
    await db.notes.add({
      syncId: newSyncId(),
      title: article.title,
      content: markdownToTiptapHtml(lines.join('\n')),
      type: 'text',
      createdAt: now,
      updatedAt: now,
    });
    setMemoSaved(true);
  };

  return (
    <div className="news-reader">
      <div className="news-reader-top">
        <button className="news-reader-icon-btn" onClick={onClose}><ArrowLeft size={22} /></button>
        <div className="news-reader-top-actions">
          <button className={`news-reader-icon-btn${isSaved ? ' active' : ''}`} onClick={onToggleSave} title={t('あとで読む')}>
            <Bookmark size={20} fill={isSaved ? 'currentColor' : 'none'} />
          </button>
          <a className="news-reader-icon-btn" href={article.link} target="_blank" rel="noopener noreferrer" title={t('元記事を読む')}>
            <ExternalLink size={20} />
          </a>
        </div>
      </div>

      <div className="news-reader-scroll">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={article.imageUrl}
          alt=""
          className="news-reader-image"
          onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />

        <div className="news-reader-body">
          <h1 className="news-reader-title">
            <NewsInteractiveText text={article.title} onWordSelected={onWordSelected} highlightWords={highlightWords} />
          </h1>
          <div className="news-reader-meta">
            <span>{article.source}</span>
          </div>

          <p className="news-reader-snippet">
            <NewsSentenceText text={article.snippet} onWordSelected={onWordSelected} highlightWords={highlightWords} />
          </p>

          <div className="news-reader-tools">
            <button className="news-tool-btn" onClick={toggleAudio}>
              {isPlaying ? <Pause size={16} /> : <Volume2 size={16} />}
              <span>{t('音声で聞く')}</span>
            </button>
            <button className="news-tool-btn" onClick={handleExplain} disabled={explainState === 'loading'}>
              {explainState === 'loading' ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
              <span>{t('Lilyに解説してもらう')}</span>
            </button>
            <button className="news-tool-btn" onClick={() => void handleSaveAsMemo()} disabled={memoSaved}>
              {memoSaved ? <Check size={16} /> : <NotebookPen size={16} />}
              <span>{memoSaved ? t('メモに保存済み') : t('メモに保存')}</span>
            </button>
          </div>

          {explainState === 'error' && <p className="news-reader-explain-error">{explainError}</p>}

          {explanation && (
            <div className="news-reader-explanation">
              <div className="news-explain-section">
                <div className="news-explain-label">{t('要約')}</div>
                <ul>{explanation.summary.map((s, i) => <li key={i}>{s}</li>)}</ul>
              </div>
              {explanation.japanese && (
                <div className="news-explain-section">
                  <div className="news-explain-label">{t('和訳')}</div>
                  <p>{explanation.japanese}</p>
                </div>
              )}
              {explanation.vocabulary.length > 0 && (
                <div className="news-explain-section">
                  <div className="news-explain-label">{t('単語')}</div>
                  {explanation.vocabulary.map((v, i) => (
                    <div key={i} className="news-explain-vocab-row">
                      <span className="news-explain-vocab-word">{v.word}</span>
                      <span className="news-explain-vocab-meaning">{v.meaning}</span>
                      <span className="news-explain-vocab-note">{v.note}</span>
                    </div>
                  ))}
                </div>
              )}
              {explanation.tip && (
                <div className="news-explain-section">
                  <div className="news-explain-label">{t('豆知識')}</div>
                  <p>{explanation.tip}</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <style jsx>{`
        .news-reader {
          position: fixed; inset: 0; z-index: 8500;
          background: var(--background);
          display: flex; flex-direction: column;
        }
        .news-reader-top {
          display: flex; align-items: center; justify-content: space-between;
          padding: 10px 12px; padding-top: calc(10px + env(safe-area-inset-top));
          border-bottom: 1px solid var(--border); flex-shrink: 0;
        }
        .news-reader-top-actions { display: flex; gap: 6px; }
        .news-reader-icon-btn {
          width: 38px; height: 38px; display: flex; align-items: center; justify-content: center;
          background: transparent; border-radius: 50%; color: var(--foreground);
          text-decoration: none; cursor: pointer;
        }
        .news-reader-icon-btn:hover { background: var(--accent); }
        .news-reader-icon-btn.active { color: var(--primary); }
        .news-reader-scroll { flex: 1; overflow-y: auto; -webkit-overflow-scrolling: touch; }
        .news-reader-image { width: 100%; height: 220px; object-fit: cover; display: block; }
        .news-reader-body { padding: 20px 20px calc(40px + env(safe-area-inset-bottom)); max-width: 640px; margin: 0 auto; }
        .news-reader-title { font-size: 1.35rem; font-weight: 800; line-height: 1.4; color: var(--foreground); margin: 0 0 8px; }
        .news-reader-meta { font-size: 0.78rem; color: #888; margin-bottom: 16px; }
        .news-reader-snippet { font-size: 1rem; line-height: 1.8; color: var(--foreground); white-space: pre-wrap; }
        .news-reader-tools { display: flex; gap: 8px; flex-wrap: wrap; margin: 20px 0; }
        .news-tool-btn {
          display: flex; align-items: center; gap: 6px; padding: 9px 14px;
          background: var(--accent); border: 1px solid var(--border); border-radius: 10px;
          font-size: 0.82rem; font-weight: 600; color: var(--foreground); cursor: pointer;
        }
        .news-tool-btn:disabled { opacity: 0.6; cursor: default; }
        .news-reader-explain-error { color: #ef4444; font-size: 0.82rem; }
        .news-reader-explanation {
          background: var(--accent); border-radius: 14px; padding: 16px;
          display: flex; flex-direction: column; gap: 14px; margin-top: 8px;
        }
        .news-explain-section ul { margin: 0; padding-left: 18px; }
        .news-explain-section p { margin: 0; }
        .news-explain-label {
          font-size: 0.72rem; font-weight: 800; color: var(--primary);
          text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px;
        }
        .news-explain-section { font-size: 0.88rem; color: var(--foreground); line-height: 1.6; }
        .news-explain-vocab-row {
          display: flex; flex-wrap: wrap; gap: 6px; align-items: baseline;
          padding: 6px 0; border-bottom: 1px dashed var(--border);
        }
        .news-explain-vocab-row:last-child { border-bottom: none; }
        .news-explain-vocab-word { font-weight: 800; }
        .news-explain-vocab-meaning { color: var(--primary); font-weight: 600; }
        .news-explain-vocab-note { color: #888; font-size: 0.8rem; flex-basis: 100%; }
      `}</style>
    </div>
  );
}
