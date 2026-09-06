'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ArrowLeft, RefreshCw, BookOpen, Bookmark, Newspaper,
} from 'lucide-react';
import { db, newSyncId, softDeleteNewsSaved } from '@/lib/db';
import { useT } from '@/lib/i18n';
import { AmbientOverlay, useCharacterSkin } from './CharacterSkinContext';
import NewsInteractiveText from './NewsInteractiveText';
import NewsDictionaryPopover from './NewsDictionaryPopover';
import NewsWordbookModal from './NewsWordbookModal';
import NewsArticleModal from './NewsArticleModal';
import { NEWS_CATEGORIES, type NewsArticle } from '@/lib/newsFeeds';
import { cleanWord, type DictionaryEntry } from '@/lib/newsDictionary';

interface NewsScreenProps {
  onGoBack: () => void;
  onSwitchTab?: (tab: string) => void;
}

const FALLBACK_IMAGE = 'https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&q=80&w=1000';

function timeAgo(pubDate: string, t: (k: string, p?: Record<string, string | number>) => string): string {
  if (!pubDate) return '';
  const ms = Date.now() - Date.parse(pubDate);
  if (Number.isNaN(ms)) return '';
  const hours = Math.floor(ms / 3600000);
  if (hours < 1) return t('たった今');
  if (hours < 24) return t('{n}時間前', { n: hours });
  return t('{n}日前', { n: Math.floor(hours / 24) });
}

export default function NewsScreen({ onGoBack }: NewsScreenProps) {
  const t = useT();
  const { homeBackgroundSrc } = useCharacterSkin();

  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [category, setCategory] = useState('all');
  const [showSavedOnly, setShowSavedOnly] = useState(false);

  const [activeArticle, setActiveArticle] = useState<NewsArticle | null>(null);
  const [popoverWord, setPopoverWord] = useState<string | null>(null);
  const [showWordbook, setShowWordbook] = useState(false);

  const wordbook = useLiveQuery(() => db.newsWordbook.filter(w => !w.deletedAt).toArray(), []) ?? [];
  const savedArticles = useLiveQuery(() => db.newsSaved.filter(s => !s.deletedAt).toArray(), []) ?? [];
  const savedIds = new Set(savedArticles.map(s => s.articleId));

  const load = useCallback(async (cat: string) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/news-feed?category=${encodeURIComponent(cat)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { articles: NewsArticle[] };
      setArticles(data.articles ?? []);
    } catch {
      setError(t('ニュースを取得できませんでした。通信環境をご確認のうえ、もう一度お試しください。'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { void load(category); }, [category, load]);

  const displayedArticles = showSavedOnly
    ? articles.filter(a => savedIds.has(a.id))
    : articles;

  const handleWordSelected = (word: string) => {
    setPopoverWord(word);
  };

  const isWordSaved = (word: string) => wordbook.some(w => cleanWord(w.word) === cleanWord(word));

  const handleToggleWordbook = async (entry: DictionaryEntry) => {
    const existing = wordbook.find(w => cleanWord(w.word) === cleanWord(entry.word));
    if (existing?.id != null) {
      await db.newsWordbook.update(existing.id, { deletedAt: Date.now(), updatedAt: Date.now() });
      return;
    }
    const now = Date.now();
    await db.newsWordbook.add({
      syncId: newSyncId(),
      word: entry.word,
      phonetic: entry.phonetic,
      partOfSpeech: entry.partOfSpeech,
      meaning: entry.meaning,
      techContext: entry.techContext,
      example: entry.example,
      mastered: false,
      createdAt: now,
      updatedAt: now,
    });
  };

  const handleToggleSaveArticle = async (article: NewsArticle) => {
    const existing = savedArticles.find(s => s.articleId === article.id);
    if (existing?.id != null) {
      await softDeleteNewsSaved(existing.id);
      return;
    }
    const now = Date.now();
    await db.newsSaved.add({
      syncId: newSyncId(),
      articleId: article.id,
      title: article.title,
      link: article.link,
      source: article.source,
      category: article.category,
      imageUrl: article.imageUrl,
      snippet: article.snippet,
      pubDate: article.pubDate,
      createdAt: now,
      updatedAt: now,
    });
  };

  return (
    <div
      className={`news-root${homeBackgroundSrc ? ' has-skin-bg' : ''}`}
      style={homeBackgroundSrc
        ? { backgroundImage: `url(${homeBackgroundSrc})`, backgroundSize: 'cover', backgroundPosition: 'center' }
        : undefined}
    >
      <AmbientOverlay />

      <div className="news-header">
        <button className="news-back" onClick={onGoBack} aria-label={t('戻る')}><ArrowLeft size={17} strokeWidth={2.5} /></button>
        <div className="news-header-mid">
          <Newspaper size={16} className="news-header-icon" />
          <span className="news-title">{t('ニュース')}</span>
        </div>
        <button
          className={`news-icon-btn${showSavedOnly ? ' active' : ''}`}
          onClick={() => setShowSavedOnly(v => !v)}
          title={t('あとで読む')}
        ><Bookmark size={16} fill={showSavedOnly ? 'currentColor' : 'none'} /></button>
        <button className="news-icon-btn" onClick={() => setShowWordbook(true)} title={t('単語帳')}>
          <BookOpen size={16} />
          {wordbook.length > 0 && <span className="news-wordbook-badge">{wordbook.length}</span>}
        </button>
        <button className="news-icon-btn" onClick={() => void load(category)} title={t('更新')}>
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="news-category-row">
        {NEWS_CATEGORIES.map(c => (
          <button
            key={c.id}
            className={`news-category-pill${category === c.id ? ' active' : ''}`}
            onClick={() => setCategory(c.id)}
          >
            {c.label}
          </button>
        ))}
      </div>

      <div className="news-scroll">
        {loading && (
          <div className="news-status"><div className="news-spinner" /><span>{t('読み込み中...')}</span></div>
        )}
        {!loading && error && <div className="news-status news-error">{error}</div>}
        {!loading && !error && displayedArticles.length === 0 && (
          <div className="news-status">{showSavedOnly ? t('保存した記事はまだありません') : t('記事がありません')}</div>
        )}
        {!loading && !error && (
          <div className="news-feed">
            {displayedArticles.map((article, idx) => (
              <article
                key={article.id}
                className={`news-card${idx === 0 && !showSavedOnly ? ' hero' : ''}`}
                onClick={() => setActiveArticle(article)}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={article.imageUrl}
                  alt=""
                  className="news-card-image"
                  loading="lazy"
                  onError={e => { (e.target as HTMLImageElement).src = FALLBACK_IMAGE; }}
                />
                <div className="news-card-body">
                  <h3 className="news-card-title">
                    <NewsInteractiveText text={article.title} onWordSelected={handleWordSelected} />
                  </h3>
                  <div className="news-card-meta">
                    <span>{article.source}</span>
                    {timeAgo(article.pubDate, t) && <><span className="news-dot">•</span><span>{timeAgo(article.pubDate, t)}</span></>}
                  </div>
                </div>
                <button
                  className={`news-card-save${savedIds.has(article.id) ? ' active' : ''}`}
                  onClick={(e) => { e.stopPropagation(); void handleToggleSaveArticle(article); }}
                  title={t('あとで読む')}
                >
                  <Bookmark size={16} fill={savedIds.has(article.id) ? 'currentColor' : 'none'} />
                </button>
              </article>
            ))}
          </div>
        )}
      </div>

      {activeArticle && (
        <NewsArticleModal
          article={activeArticle}
          onClose={() => setActiveArticle(null)}
          onWordSelected={handleWordSelected}
          isSaved={savedIds.has(activeArticle.id)}
          onToggleSave={() => void handleToggleSaveArticle(activeArticle)}
          highlightWords={[]}
        />
      )}

      {popoverWord && (
        <NewsDictionaryPopover
          word={popoverWord}
          onClose={() => setPopoverWord(null)}
          isSaved={isWordSaved(popoverWord)}
          onToggleSave={(entry) => void handleToggleWordbook(entry)}
        />
      )}

      {showWordbook && <NewsWordbookModal onClose={() => setShowWordbook(false)} />}

      <style jsx>{`
        .news-root {
          flex: 1; display: flex; flex-direction: column;
          background: var(--background); overflow: hidden; position: relative;
        }
        .news-header {
          display: flex; align-items: center; gap: 8px;
          padding: 12px 14px 10px; flex-shrink: 0;
          background: var(--glass-tint, rgba(255,255,255,.88));
          backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
        }
        .news-back {
          width: 34px; height: 34px; border-radius: 10px; flex-shrink: 0;
          border: 1px solid var(--border); background: var(--accent);
          display: flex; align-items: center; justify-content: center;
          cursor: pointer; color: var(--foreground);
        }
        .news-header-mid { flex: 1; display: flex; align-items: center; gap: 6px; min-width: 0; }
        .news-header-icon { color: var(--primary); flex-shrink: 0; }
        .news-title { font-size: 1rem; font-weight: 800; color: var(--foreground); }
        .news-icon-btn {
          position: relative; width: 34px; height: 34px; border-radius: 10px; flex-shrink: 0;
          border: 1px solid var(--border); background: var(--accent);
          display: flex; align-items: center; justify-content: center;
          cursor: pointer; color: var(--foreground);
        }
        .news-icon-btn.active { background: var(--primary); color: #fff; border-color: var(--primary); }
        .news-wordbook-badge {
          position: absolute; top: -5px; right: -5px;
          background: var(--primary); color: #fff; font-size: 0.6rem; font-weight: 800;
          min-width: 15px; height: 15px; border-radius: 8px; padding: 0 3px;
          display: flex; align-items: center; justify-content: center;
        }
        .news-category-row {
          display: flex; gap: 6px; padding: 10px 14px; overflow-x: auto;
          flex-shrink: 0; scrollbar-width: none;
        }
        .news-category-row::-webkit-scrollbar { display: none; }
        .news-category-pill {
          padding: 6px 14px; border-radius: 999px; white-space: nowrap;
          background: var(--accent); border: 1px solid var(--border);
          font-size: 0.8rem; font-weight: 600; color: var(--foreground); cursor: pointer;
        }
        .news-category-pill.active { background: var(--primary); color: #fff; border-color: var(--primary); }
        .news-scroll { flex: 1; overflow-y: auto; -webkit-overflow-scrolling: touch; padding: 4px 14px calc(20px + env(safe-area-inset-bottom)); }
        .news-status {
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          gap: 10px; color: #888; font-size: 0.85rem; padding: 60px 20px; text-align: center;
        }
        .news-error { color: #ef4444; }
        .news-spinner {
          width: 28px; height: 28px; border: 3px solid var(--border);
          border-top-color: var(--primary); border-radius: 50%; animation: newsSpin 0.8s linear infinite;
        }
        @keyframes newsSpin { to { transform: rotate(360deg); } }
        .news-feed { display: flex; flex-direction: column; gap: 12px; padding-top: 6px; }
        .news-card {
          position: relative; display: flex; gap: 12px; align-items: center;
          background: var(--accent); border: 1px solid var(--border); border-radius: 16px;
          padding: 10px; cursor: pointer; transition: transform 0.1s;
        }
        .news-card:active { transform: scale(0.99); }
        .news-card.hero { flex-direction: column; align-items: stretch; padding: 0; overflow: hidden; }
        .news-card.hero .news-card-image { width: 100%; height: 160px; border-radius: 0; }
        .news-card.hero .news-card-body { padding: 12px 14px 14px; }
        .news-card-image { width: 84px; height: 84px; border-radius: 12px; object-fit: cover; flex-shrink: 0; background: var(--border); }
        .news-card-body { flex: 1; min-width: 0; }
        .news-card-title { font-size: 0.92rem; font-weight: 700; color: var(--foreground); line-height: 1.4; margin: 0 0 4px; }
        .news-card.hero .news-card-title { font-size: 1.1rem; }
        .news-card-meta { display: flex; align-items: center; gap: 6px; font-size: 0.72rem; color: #888; }
        .news-dot { opacity: 0.6; }
        .news-card-save {
          position: absolute; top: 8px; right: 8px;
          width: 30px; height: 30px; border-radius: 50%;
          background: rgba(255,255,255,0.85); border: none;
          display: flex; align-items: center; justify-content: center;
          color: var(--foreground); cursor: pointer;
        }
        .news-card:not(.hero) .news-card-save { position: static; background: none; }
        .news-card-save.active { color: var(--primary); }
      `}</style>
    </div>
  );
}
