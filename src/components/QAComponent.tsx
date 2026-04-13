'use client';

import { NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react';
import { useState } from 'react';

interface QAPair {
  q: string;
  a: string;
  checked?: boolean;
}

function parseNumberedText(text: string): string[] {
  const trimmed = text.trim();
  const lines = trimmed.split('\n');

  // Count lines that start with a numbered item (e.g. "1." or "１．")
  const numberedLineCount = lines.filter(l => /^\s*\d+[.．]/.test(l)).length;

  if (numberedLineCount > 1) {
    // Multiline format: each item begins on its own line.
    // Numbers that appear mid-line (e.g. "3.5 liters", "in 2024.") are ignored.
    const items: string[] = [];
    let current: string | null = null;

    for (const line of lines) {
      const match = line.match(/^\s*\d+[.．]\s*(.*)/);
      if (match) {
        if (current !== null) items.push(current.trim());
        current = match[1];
      } else if (current !== null) {
        current += '\n' + line;
      }
    }
    if (current !== null) items.push(current.trim());
    return items.filter(Boolean);
  }

  // Single-line / inline format: items are separated by whitespace.
  // e.g. "1. lowering　2. shorten　3. risk …"
  const matches = Array.from(trimmed.matchAll(/\d+[.．]\s*(.*?)(?=\s*\d+[.．]|$)/g));
  return matches.map(m => m[1].trim()).filter(Boolean);
}

export default function QAComponent({ node: { attrs }, updateAttributes }: ReactNodeViewProps) {
  const pairs: QAPair[] = attrs.pairs || [];
  const [isEditing, setIsEditing] = useState(pairs.length === 0);
  const [qText, setQText] = useState('');
  const [aText, setAText] = useState('');
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const [revealAll, setRevealAll] = useState(false);

  const handleInsert = () => {
    const questions = parseNumberedText(qText);
    const answers = parseNumberedText(aText);
    const newPairs: QAPair[] = questions.map((q, i) => ({
      q,
      a: answers[i] ?? '',
    }));
    if (newPairs.length === 0) return;
    updateAttributes({ pairs: newPairs });
    setIsEditing(false);
    setRevealed(new Set());
    setRevealAll(false);
  };

  const toggleReveal = (i: number) => {
    setRevealed(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const toggleRevealAll = () => {
    if (revealAll) {
      setRevealAll(false);
      setRevealed(new Set());
    } else {
      setRevealAll(true);
    }
  };

  const isRevealed = (i: number) => revealAll || revealed.has(i);

  if (isEditing) {
    return (
      <NodeViewWrapper className="qa-wrapper">
        <div className="qa-editor" contentEditable={false}>
          <div className="qa-editor-header">Q&amp;A 読み込み</div>
          <div className="qa-editor-body">
            <label className="qa-label">問題をペースト</label>
            <textarea
              className="qa-textarea"
              value={qText}
              onChange={e => setQText(e.target.value)}
              onKeyDown={e => e.stopPropagation()}
              onWheel={e => e.stopPropagation()}
              placeholder={'1.LSIとして挙げられるものは？2.次の問題...'}
            />
            <label className="qa-label">答えをペースト</label>
            <textarea
              className="qa-textarea"
              value={aText}
              onChange={e => setAText(e.target.value)}
              onKeyDown={e => e.stopPropagation()}
              onWheel={e => e.stopPropagation()}
              placeholder={'1.(例)プロセッサ2.立ち上げ...'}
            />
          </div>
          <div className="qa-editor-actions">
            {pairs.length > 0 && (
              <button className="qa-btn-cancel" onClick={() => setIsEditing(false)}>
                キャンセル
              </button>
            )}
            <button className="qa-btn-insert" onClick={handleInsert}>
              挿入する
            </button>
          </div>
        </div>

        <style jsx>{`
          .qa-wrapper {
            margin: 1.5rem auto;
          }
          .qa-editor {
            border: 1px solid var(--border);
            border-radius: 12px;
            overflow: hidden;
            background: var(--accent);
          }
          .qa-editor-header {
            padding: 8px 14px;
            background: var(--muted);
            border-bottom: 1px solid var(--border);
            font-size: 0.75rem;
            font-weight: 700;
            color: var(--primary);
            text-transform: uppercase;
            letter-spacing: 0.5px;
          }
          .qa-editor-body {
            padding: 14px;
            display: flex;
            flex-direction: column;
            gap: 8px;
          }
          .qa-label {
            font-size: 0.8rem;
            font-weight: 600;
            color: var(--foreground);
            opacity: 0.7;
          }
          .qa-textarea {
            width: 100%;
            min-height: 100px;
            padding: 10px 12px;
            border: 1px solid var(--border);
            border-radius: 8px;
            background: var(--background);
            color: var(--foreground);
            font-size: 0.875rem;
            font-family: inherit;
            resize: vertical;
            outline: none;
            line-height: 1.6;
          }
          .qa-textarea:focus {
            border-color: var(--primary);
          }
          .qa-editor-actions {
            padding: 10px 14px;
            display: flex;
            justify-content: flex-end;
            gap: 8px;
            border-top: 1px solid var(--border);
          }
          .qa-btn-cancel {
            padding: 6px 16px;
            border-radius: 8px;
            border: 1px solid var(--border);
            background: transparent;
            color: var(--foreground);
            font-size: 0.85rem;
            cursor: pointer;
          }
          .qa-btn-insert {
            padding: 6px 16px;
            border-radius: 8px;
            border: none;
            background: var(--primary);
            color: white;
            font-size: 0.85rem;
            font-weight: 600;
            cursor: pointer;
          }
        `}</style>
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper className="qa-wrapper">
      <div className="qa-block" contentEditable={false}>
        <div className="qa-block-header">
          <span className="qa-block-title">Q&amp;A <span className="qa-count">{pairs.length}問</span></span>
          <div className="qa-block-header-actions">
            <button className="qa-action-btn" onClick={toggleRevealAll}>
              {revealAll ? '全て隠す' : '全て表示'}
            </button>
            <button
              className="qa-action-btn"
              onClick={() => {
                setQText(pairs.map((p, i) => `${i + 1}.${p.q}`).join('\n'));
                setAText(pairs.map((p, i) => `${i + 1}.${p.a}`).join('\n'));
                setIsEditing(true);
              }}
            >
              編集
            </button>
          </div>
        </div>

        <div className="qa-cards">
          {pairs.map((pair, i) => (
            <div key={i} className={`qa-card ${pair.checked ? 'qa-card-checked' : ''}`}>
              <div className="qa-question">
                <input
                  type="checkbox"
                  className="qa-checkbox"
                  checked={!!pair.checked}
                  onChange={() => {
                    const next = pairs.map((p, j) =>
                      j === i ? { ...p, checked: !p.checked } : p
                    );
                    updateAttributes({ pairs: next });
                  }}
                />
                <span className="qa-num">{i + 1}</span>
                <span className="qa-question-text">{pair.q}</span>
              </div>
              <button
                className={`qa-answer-btn ${isRevealed(i) ? 'revealed' : ''}`}
                onClick={() => toggleReveal(i)}
              >
                {isRevealed(i) ? pair.a : '答えを見る ▶'}
              </button>
            </div>
          ))}
        </div>
      </div>

      <style jsx>{`
        .qa-wrapper {
          margin: 1.5rem auto;
        }
        .qa-block {
          border: 1px solid var(--border);
          border-radius: 12px;
          overflow: hidden;
          background: var(--accent);
        }
        .qa-block-header {
          padding: 8px 14px;
          background: var(--muted);
          border-bottom: 1px solid var(--border);
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .qa-block-title {
          font-size: 0.75rem;
          font-weight: 700;
          color: var(--primary);
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .qa-count {
          font-weight: 400;
          opacity: 0.7;
        }
        .qa-block-header-actions {
          display: flex;
          gap: 6px;
        }
        .qa-action-btn {
          padding: 3px 10px;
          border-radius: 6px;
          border: 1px solid var(--border);
          background: var(--background);
          color: var(--foreground);
          font-size: 0.75rem;
          cursor: pointer;
        }
        .qa-cards {
          padding: 10px 14px;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .qa-card {
          border: 1px solid var(--border);
          border-radius: 8px;
          overflow: hidden;
          background: var(--background);
        }
        .qa-card-checked {
          opacity: 0.5;
        }
        .qa-card-checked .qa-question-text {
          text-decoration: line-through;
        }
        .qa-question {
          padding: 10px 12px;
          display: flex;
          gap: 8px;
          align-items: flex-start;
          font-size: 0.9rem;
          line-height: 1.6;
        }
        .qa-checkbox {
          margin-top: 3px;
          width: 16px;
          height: 16px;
          accent-color: var(--primary);
          flex-shrink: 0;
          cursor: pointer;
        }
        .qa-num {
          font-weight: 700;
          color: var(--primary);
          min-width: 1.2em;
          flex-shrink: 0;
        }
        .qa-question-text {
          color: var(--foreground);
        }
        .qa-answer-btn {
          width: 100%;
          padding: 8px 12px;
          border: none;
          border-top: 1px solid var(--border);
          background: var(--muted);
          color: var(--foreground);
          font-size: 0.875rem;
          text-align: left;
          cursor: pointer;
          opacity: 0.6;
          transition: opacity 0.15s;
          font-family: inherit;
          line-height: 1.6;
        }
        .qa-answer-btn.revealed {
          opacity: 1;
          background: var(--accent);
          font-weight: 500;
        }
        .qa-answer-btn:hover {
          opacity: 1;
        }
      `}</style>
    </NodeViewWrapper>
  );
}
