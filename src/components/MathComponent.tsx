'use client';

// TipTap NodeView for LaTeX math (inline `$…$` and block `$$…$$`).
// Renders with KaTeX. When the editor is editable, clicking the formula opens a
// small inline editor (textarea + live preview) so the user can fix the LaTeX
// without touching the Markdown source. In read mode it is a static, selectable
// atom. The raw LaTeX lives in the `latex` node attribute.

import { NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react';
import { useEffect, useRef, useState } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { useT } from '@/lib/i18n';

// A few macros KaTeX doesn't define by default but that show up in study notes.
const KATEX_MACROS: Record<string, string> = {
  '\\R': '\\mathbb{R}', '\\N': '\\mathbb{N}', '\\Z': '\\mathbb{Z}',
  '\\Q': '\\mathbb{Q}', '\\C': '\\mathbb{C}',
};

function renderKatex(tex: string, display: boolean): { html: string; error: boolean } {
  try {
    return {
      html: katex.renderToString(tex, {
        displayMode: display,
        throwOnError: false,
        output: 'html',
        strict: false,
        trust: false,
        macros: KATEX_MACROS,
      }),
      error: false,
    };
  } catch {
    return { html: '', error: true };
  }
}

export default function MathComponent({ node, updateAttributes, deleteNode, editor }: ReactNodeViewProps) {
  const t = useT();
  const isBlock = node.type.name === 'mathBlock';
  const latex = (node.attrs.latex as string) || '';
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(latex);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // `draft` is only read while editing, and openEditor() re-seeds it from the
  // latest latex each time, so no separate sync effect is needed.
  useEffect(() => { if (editing) taRef.current?.focus(); }, [editing]);

  const { html, error } = renderKatex(latex || '\\;', isBlock);
  const preview = renderKatex(draft || '\\;', isBlock);

  const openEditor = () => {
    if (!editor?.isEditable) return;
    setDraft(latex);
    setEditing(true);
  };
  const commit = () => {
    const next = draft.trim();
    if (!next) { deleteNode(); return; }
    updateAttributes({ latex: next });
    setEditing(false);
  };

  return (
    <NodeViewWrapper
      as={isBlock ? 'div' : 'span'}
      className={`math-node ${isBlock ? 'math-block' : 'math-inline'}`}
      data-drag-handle={isBlock ? true : undefined}
    >
      {editing ? (
        <span className="math-editor" contentEditable={false}>
          <span className="math-editor-preview">
            {preview.error
              ? <span className="math-err">{t('数式の書き方を確認してね')}</span>
              : <span dangerouslySetInnerHTML={{ __html: preview.html }} />}
          </span>
          <textarea
            ref={taRef}
            className="math-input"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              e.stopPropagation();
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit(); }
              if (e.key === 'Escape') { e.preventDefault(); setEditing(false); }
            }}
            onBlur={commit}
            spellCheck={false}
            rows={isBlock ? 2 : 1}
            placeholder="x^2 + y^2 = r^2"
          />
          <span className="math-editor-hint">{t('Enter で確定 / Esc で取消')}</span>
        </span>
      ) : (
        <span
          className={`math-view ${error ? 'has-err' : ''}`}
          contentEditable={false}
          role={editor?.isEditable ? 'button' : undefined}
          tabIndex={editor?.isEditable ? 0 : undefined}
          title={editor?.isEditable ? t('タップで数式を編集') : undefined}
          onClick={openEditor}
          onKeyDown={e => { if (editor?.isEditable && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openEditor(); } }}
        >
          {error
            ? <span className="math-err">{latex || t('（空の数式）')}</span>
            : <span dangerouslySetInnerHTML={{ __html: html }} />}
        </span>
      )}
      <style jsx>{`
        .math-node.math-inline { display: inline; }
        .math-node.math-block { display: block; margin: 0.9rem 0; text-align: center; }
        .math-view {
          cursor: ${editor?.isEditable ? 'pointer' : 'default'};
          border-radius: 6px;
          transition: background 0.15s;
        }
        .math-node.math-inline .math-view { padding: 0 2px; }
        .math-node.math-block .math-view {
          display: block; padding: 10px 12px; overflow-x: auto; overflow-y: hidden;
          background: color-mix(in srgb, var(--primary) 6%, transparent);
        }
        .math-view:hover { background: color-mix(in srgb, var(--primary) 14%, transparent); }
        .math-view:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
        .math-view.has-err { background: rgba(239,68,68,.1); }
        .math-err { color: #ef4444; font-family: var(--font-mono, monospace); font-size: 0.9em; }
        .math-editor {
          display: ${isBlock ? 'block' : 'inline-flex'};
          ${isBlock ? '' : 'align-items: baseline; gap: 6px;'}
          background: var(--accent);
          border: 1px solid var(--primary);
          border-radius: 10px;
          padding: 8px 10px;
          ${isBlock ? 'margin: 0.5rem 0;' : ''}
        }
        .math-editor-preview {
          display: block; text-align: center; min-height: 1.4em; margin-bottom: 6px;
          ${isBlock ? '' : 'display: none;'}
        }
        .math-input {
          width: ${isBlock ? '100%' : '14ch'};
          min-width: 8ch;
          font-family: var(--font-mono, monospace);
          font-size: 0.9rem;
          border: 1px solid var(--border);
          border-radius: 6px;
          padding: 5px 8px;
          background: var(--background);
          color: var(--foreground);
          outline: none;
          resize: vertical;
          box-sizing: border-box;
        }
        .math-editor-hint {
          display: ${isBlock ? 'block' : 'none'};
          font-size: 0.68rem; color: var(--fg-muted); margin-top: 5px;
        }
      `}</style>
    </NodeViewWrapper>
  );
}
