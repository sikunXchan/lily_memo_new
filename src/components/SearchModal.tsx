'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import type { Note } from '@/lib/db';
import { noteHtmlToText } from '@/lib/noteText';
import { useT } from '@/lib/i18n';

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectNote: (id: number) => void;
}

function getSnippet(text: string, query: string, maxLen = 100): string {
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text.slice(0, maxLen).trimEnd() + (text.length > maxLen ? '…' : '');
  const start = Math.max(0, idx - 30);
  const end = Math.min(text.length, idx + query.length + 70);
  return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
}

function highlightText(text: string, query: string): React.ReactNode {
  if (!query) return text;
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const idx = lowerText.indexOf(lowerQuery);
  if (idx === -1) return text;

  const parts: React.ReactNode[] = [];
  let lastIdx = 0;
  let searchIdx = idx;

  while (searchIdx !== -1) {
    if (searchIdx > lastIdx) {
      parts.push(text.slice(lastIdx, searchIdx));
    }
    parts.push(
      <mark key={searchIdx}>{text.slice(searchIdx, searchIdx + query.length)}</mark>
    );
    lastIdx = searchIdx + query.length;
    searchIdx = lowerText.indexOf(lowerQuery, lastIdx);
  }

  if (lastIdx < text.length) {
    parts.push(text.slice(lastIdx));
  }

  return <>{parts}</>;
}

export default function SearchModal({ isOpen, onClose, onSelectNote }: SearchModalProps) {
  const t = useT();
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const allNotes = useLiveQuery(
    () => db.notes
      .filter(n => !n.deletedAt && n.type !== 'handwriting')
      .toArray(),
    []
  );

  const results = useCallback((): (Note & { id: number; plainText: string })[] => {
    if (!query.trim() || !allNotes) return [];
    const q = query.trim().toLowerCase();

    const matched = allNotes
      .filter(n => n.id !== undefined)
      .map(n => ({
        ...n,
        id: n.id as number,
        plainText: noteHtmlToText(n.content),
      }))
      .filter(n => {
        const titleMatch = n.title.toLowerCase().includes(q);
        const contentMatch = n.plainText.toLowerCase().includes(q);
        return titleMatch || contentMatch;
      });

    matched.sort((a, b) => {
      const aTitleMatch = a.title.toLowerCase().includes(q) ? 1 : 0;
      const bTitleMatch = b.title.toLowerCase().includes(q) ? 1 : 0;
      if (bTitleMatch !== aTitleMatch) return bTitleMatch - aTitleMatch;
      return b.updatedAt - a.updatedAt;
    });

    return matched.slice(0, 20);
  }, [query, allNotes]);

  const searchResults = results();

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setQuery('');
    }
  }, [isOpen]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const trimmedQuery = query.trim();

  return (
    <div className="search-overlay" onClick={onClose}>
      <div className="search-modal" onClick={e => e.stopPropagation()}>
        <div className="search-input-wrap">
          <svg className="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={inputRef}
            className="search-input"
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={t('検索...')}
            autoComplete="off"
            spellCheck={false}
          />
          {query && (
            <button className="clear-btn" onClick={() => { setQuery(''); inputRef.current?.focus(); }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>

        <div className="results-area">
          {!trimmedQuery && (
            <div className="hint">{t('キーワードを入力してメモを検索 / Escで閉じる')}</div>
          )}

          {trimmedQuery && searchResults.length === 0 && (
            <div className="no-results">{t('「{q}」は見つからなかった', { q: trimmedQuery })}</div>
          )}

          {trimmedQuery && searchResults.length > 0 && (
            <ul className="result-list">
              {searchResults.map(note => {
                const snippet = getSnippet(note.plainText, trimmedQuery);
                return (
                  <li key={note.id}>
                    <button
                      className="result-item"
                      onClick={() => {
                        onSelectNote(note.id);
                        onClose();
                      }}
                    >
                      <span className="result-title">
                        {highlightText(note.title || t('無題'), trimmedQuery)}
                      </span>
                      {snippet && (
                        <span className="result-snippet">
                          {highlightText(snippet, trimmedQuery)}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      <style jsx>{`
        .search-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.55);
          z-index: 1000;
          display: flex;
          align-items: flex-start;
          justify-content: center;
          padding-top: 12vh;
          backdrop-filter: blur(2px);
        }
        .search-modal {
          background: var(--background);
          border: 1px solid var(--border);
          border-radius: 16px;
          width: 100%;
          max-width: 560px;
          box-shadow: 0 24px 64px rgba(0, 0, 0, 0.35);
          overflow: hidden;
          display: flex;
          flex-direction: column;
          max-height: 70vh;
        }
        .search-input-wrap {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 14px 16px;
          border-bottom: 1px solid var(--border);
        }
        .search-icon {
          width: 20px;
          height: 20px;
          color: var(--fg-muted);
          flex-shrink: 0;
        }
        .search-input {
          flex: 1;
          background: transparent;
          border: none;
          outline: none;
          font-size: 1rem;
          color: var(--foreground);
          caret-color: var(--primary);
        }
        .search-input::placeholder {
          color: var(--fg-muted);
        }
        .clear-btn {
          background: none;
          border: none;
          cursor: pointer;
          padding: 4px;
          border-radius: 6px;
          color: var(--fg-muted);
          display: flex;
          align-items: center;
          flex-shrink: 0;
        }
        .clear-btn svg {
          width: 16px;
          height: 16px;
        }
        .clear-btn:hover {
          background: var(--accent);
          color: var(--foreground);
        }
        .results-area {
          overflow-y: auto;
          min-height: 80px;
        }
        .hint,
        .no-results {
          padding: 24px 20px;
          font-size: 0.9rem;
          color: var(--fg-muted);
          text-align: center;
        }
        .result-list {
          list-style: none;
          margin: 0;
          padding: 6px;
        }
        .result-item {
          width: 100%;
          background: none;
          border: none;
          border-radius: 10px;
          padding: 10px 14px;
          cursor: pointer;
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 3px;
          text-align: left;
          transition: background 0.1s;
        }
        .result-item:hover {
          background: var(--accent);
        }
        .result-title {
          font-size: 0.95rem;
          font-weight: 600;
          color: var(--foreground);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 100%;
        }
        .result-snippet {
          font-size: 0.8rem;
          color: var(--fg-muted);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 100%;
          line-height: 1.5;
        }

        @media (max-width: 600px) {
          .search-overlay {
            padding-top: 0;
            align-items: flex-start;
          }
          .search-modal {
            border-radius: 0 0 16px 16px;
            max-height: 80vh;
          }
        }
      `}</style>

      <style jsx global>{`
        .result-title mark,
        .result-snippet mark {
          background: color-mix(in srgb, var(--primary) 25%, transparent);
          color: inherit;
          border-radius: 2px;
          padding: 0 1px;
        }
      `}</style>
    </div>
  );
}
