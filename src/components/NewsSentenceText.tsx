'use client';

import { useState } from 'react';
import { Languages, Loader2 } from 'lucide-react';
import NewsInteractiveText from './NewsInteractiveText';
import { translateSentence } from '@/lib/newsTranslate';
import { useT } from '@/lib/i18n';

interface NewsSentenceTextProps {
  text: string;
  onWordSelected: (word: string, rect: DOMRect) => void;
  highlightWords?: string[];
}

// Paragraph breaks come in as literal "\n\n" from /api/news-feed's stripHtml.
// Splitting sentences first (before paragraphs) would swallow that spacing
// as part of a sentence's trailing whitespace, so paragraphs are split out
// first and rendered as their own block so the article keeps its structure.
function splitParagraphs(text: string): string[] {
  return text.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
}

// Lightweight sentence splitter — not full NLP (it can mis-split on
// abbreviations like "e.g."), but good enough for a tap-to-translate toggle.
function splitSentences(text: string): string[] {
  const matches = text.match(/[^.!?]+[.!?]+(\s+|$)|[^.!?]+$/g);
  return matches ? matches.map(s => s.trim()).filter(Boolean) : [text];
}

// Sentence-level companion to NewsInteractiveText's word-level tap lookup:
// each sentence gets its own small translate toggle so a learner can check
// a Japanese translation without leaving the English reading flow, one
// sentence at a time.
export default function NewsSentenceText({ text, onWordSelected, highlightWords = [] }: NewsSentenceTextProps) {
  const t = useT();
  const [translations, setTranslations] = useState<Record<string, string | null>>({});
  const [loadingKey, setLoadingKey] = useState<string | null>(null);

  if (!text) return null;

  const handleToggle = async (key: string, sentence: string) => {
    if (key in translations) {
      setTranslations(prev => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      return;
    }
    setLoadingKey(key);
    const result = await translateSentence(sentence);
    setLoadingKey(null);
    setTranslations(prev => ({ ...prev, [key]: result }));
  };

  return (
    <span className="news-sentences">
      {splitParagraphs(text).map((paragraph, pIdx) => (
        <span key={pIdx} className="news-paragraph">
          {splitSentences(paragraph).map((sentence, sIdx) => {
            const key = `${pIdx}-${sIdx}`;
            return (
              <span key={key} className="news-sentence">
                <NewsInteractiveText text={sentence} onWordSelected={onWordSelected} highlightWords={highlightWords} />
                <button
                  type="button"
                  className="news-sentence-translate-btn"
                  onClick={(e) => { e.stopPropagation(); void handleToggle(key, sentence); }}
                  title={t('この文を翻訳')}
                >
                  {loadingKey === key ? <Loader2 size={11} className="animate-spin" /> : <Languages size={11} />}
                </button>
                {' '}
                {key in translations && (
                  <span className="news-sentence-translation">
                    {translations[key] || t('この文の翻訳を取得できませんでした')}
                  </span>
                )}
              </span>
            );
          })}
        </span>
      ))}
      <style jsx>{`
        .news-paragraph { display: block; margin-bottom: 12px; }
        .news-paragraph:last-child { margin-bottom: 0; }
        .news-sentence-translate-btn {
          display: inline-flex; align-items: center; justify-content: center;
          width: 17px; height: 17px; margin-left: 3px; vertical-align: middle;
          background: var(--accent); border: 1px solid var(--border); border-radius: 5px;
          color: var(--primary); cursor: pointer; padding: 0; flex-shrink: 0;
        }
        .news-sentence-translation {
          display: block; margin: 4px 0 10px; padding: 7px 10px;
          background: var(--accent); border-left: 3px solid var(--primary);
          border-radius: 6px; font-size: 0.85rem; line-height: 1.6; color: var(--foreground);
        }
      `}</style>
    </span>
  );
}
