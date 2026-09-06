'use client';

import { useEffect, useState } from 'react';
import { Volume2, Bookmark, BookmarkCheck, X, Loader2 } from 'lucide-react';
import { lookupDictionary, fetchOnlineDefinition, type DictionaryEntry } from '@/lib/newsDictionary';
import { useT } from '@/lib/i18n';

interface NewsDictionaryPopoverProps {
  word: string;
  onClose: () => void;
  isSaved: boolean;
  onToggleSave: (entry: DictionaryEntry) => void;
}

// Bottom sheet (not positioned near the tapped word) — matches the app's
// existing insert/color sheets and sidesteps viewport-overflow edge cases a
// word near the screen edge would otherwise create.
export default function NewsDictionaryPopover({ word, onClose, isSaved, onToggleSave }: NewsDictionaryPopoverProps) {
  const t = useT();
  const [data, setData] = useState<DictionaryEntry | null>(() => lookupDictionary(word));
  const [loading, setLoading] = useState(!lookupDictionary(word));
  const [notFound, setNotFound] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    const localHit = lookupDictionary(word);
    if (localHit) {
      setData(localHit);
      setNotFound(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    setNotFound(false);
    let cancelled = false;
    fetchOnlineDefinition(word).then(online => {
      if (cancelled) return;
      if (online) {
        setData(online);
        setNotFound(false);
      } else {
        setData(null);
        setNotFound(true);
      }
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [word]);

  const handleSpeak = () => {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(data?.word || word);
    utterance.lang = 'en-US';
    utterance.rate = 0.9;
    setIsPlaying(true);
    utterance.onend = () => setIsPlaying(false);
    utterance.onerror = () => setIsPlaying(false);
    window.speechSynthesis.speak(utterance);
  };

  return (
    <div className="news-pop-backdrop" onClick={onClose}>
      <div className="news-pop-sheet" onClick={e => e.stopPropagation()}>
        <div className="news-pop-handle" />
        <div className="news-pop-header">
          <div className="news-pop-word-group">
            <h3 className="news-pop-word">{data?.word || word}</h3>
            {data?.phonetic && <span className="news-pop-phonetic">{data.phonetic}</span>}
            {data?.partOfSpeech && <span className="news-pop-pos">{data.partOfSpeech}</span>}
          </div>
          <div className="news-pop-actions">
            <button className={`news-pop-btn${isPlaying ? ' active' : ''}`} onClick={handleSpeak} title={t('発音')}>
              <Volume2 size={16} />
            </button>
            <button
              className={`news-pop-btn${isSaved ? ' saved' : ''}`}
              onClick={() => data && onToggleSave(data)}
              disabled={!data}
              title={isSaved ? t('単語帳から削除') : t('単語帳に保存')}
            >
              {isSaved ? <BookmarkCheck size={16} /> : <Bookmark size={16} />}
            </button>
            <button className="news-pop-btn" onClick={onClose} title={t('閉じる')}>
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="news-pop-body">
          {loading ? (
            <div className="news-pop-loading"><Loader2 size={16} className="animate-spin" /><span>{t('意味を調べています...')}</span></div>
          ) : notFound ? (
            <div className="news-pop-notfound">{t('この単語の意味を見つけられませんでした。')}</div>
          ) : (
            <>
              {data?.meaning && <p className="news-pop-meaning">{data.meaning}</p>}
              {data?.example && <p className="news-pop-example">&ldquo;{data.example}&rdquo;</p>}
            </>
          )}
        </div>
      </div>

      <style jsx>{`
        .news-pop-backdrop {
          position: fixed; inset: 0; z-index: 9200;
          background: rgba(0,0,0,0.4);
          display: flex; align-items: flex-end;
        }
        .news-pop-sheet {
          width: 100%; background: var(--background);
          border-radius: 20px 20px 0 0;
          padding: 12px 20px calc(24px + env(safe-area-inset-bottom));
          animation: newsSheetUp 0.2s ease;
        }
        @keyframes newsSheetUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
        .news-pop-handle { width: 36px; height: 4px; background: var(--border); border-radius: 2px; margin: 0 auto 14px; }
        .news-pop-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
        .news-pop-word-group { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
        .news-pop-word { font-size: 1.15rem; font-weight: 800; color: var(--foreground); margin: 0; }
        .news-pop-phonetic { font-size: 0.8rem; color: #888; }
        .news-pop-pos { font-size: 0.7rem; color: var(--primary); background: color-mix(in srgb, var(--primary) 12%, transparent); padding: 2px 7px; border-radius: 999px; }
        .news-pop-actions { display: flex; gap: 6px; flex-shrink: 0; }
        .news-pop-btn {
          width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;
          background: var(--accent); border: 1px solid var(--border); border-radius: 8px;
          color: var(--foreground); cursor: pointer;
        }
        .news-pop-btn:disabled { opacity: 0.5; cursor: default; }
        .news-pop-btn.active, .news-pop-btn.saved { background: var(--primary); color: #fff; border-color: var(--primary); }
        .news-pop-body { display: flex; flex-direction: column; gap: 10px; min-height: 60px; }
        .news-pop-loading { display: flex; align-items: center; gap: 8px; color: #888; font-size: 0.85rem; padding: 12px 0; }
        .news-pop-notfound { color: #888; font-size: 0.85rem; padding: 12px 0; }
        .news-pop-meaning { font-size: 1rem; font-weight: 700; color: var(--foreground); margin: 0; }
        .news-pop-example { font-size: 0.82rem; color: #888; font-style: italic; margin: 0; }
      `}</style>
    </div>
  );
}
