'use client';

import { cleanWord } from '@/lib/newsDictionary';

interface NewsInteractiveTextProps {
  text: string;
  onWordSelected: (word: string, rect: DOMRect) => void;
  highlightWords?: string[];
}

// Wraps each word of `text` in its own tappable span so the News tab's
// tap-a-word dictionary lookup works inside article titles and body text.
// stopPropagation on both click and the containing card's onClick keeps a
// word tap from also opening/closing whatever the text sits inside.
export default function NewsInteractiveText({ text, onWordSelected, highlightWords = [] }: NewsInteractiveTextProps) {
  if (!text) return null;
  const tokens = text.split(/(\s+|[.,!?;:()"'`[\]{}]+)/);

  return (
    <span className="news-interactive-text">
      {tokens.map((token, idx) => {
        const clean = cleanWord(token);
        const isWord = clean.length > 0 && /^[a-zA-Z0-9_-]+$/.test(clean);
        if (!isWord) return <span key={idx}>{token}</span>;

        const isHighlighted = highlightWords.some(hw => cleanWord(hw) === clean);
        return (
          <span
            key={idx}
            className={`news-word${isHighlighted ? ' news-word-highlight' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
              onWordSelected(clean, rect);
            }}
          >
            {token}
          </span>
        );
      })}
      <style jsx>{`
        .news-word { cursor: pointer; border-radius: 3px; transition: background 0.1s; }
        .news-word:hover, .news-word:active { background: color-mix(in srgb, var(--primary) 18%, transparent); }
        .news-word-highlight { text-decoration: underline dotted color-mix(in srgb, var(--primary) 60%, transparent); text-underline-offset: 2px; }
      `}</style>
    </span>
  );
}
