'use client';

import { NodeViewWrapper, NodeViewContent } from '@tiptap/react';
import React, { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';

mermaid.initialize({
  startOnLoad: false,
  theme: 'neutral',
  securityLevel: 'loose',
});

export default function MermaidComponent({ node: { attrs }, updateAttributes }: any) {
  const [svg, setSvg] = useState('');
  const [editing, setEditing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const renderMermaid = async () => {
    if (!attrs.content) return;
    try {
      const id = `mermaid-${Math.random().toString(36).substr(2, 9)}`;
      const { svg } = await mermaid.render(id, attrs.content);
      setSvg(svg);
    } catch (err) {
      console.error('Mermaid render error:', err);
    }
  };

  useEffect(() => {
    if (!editing) renderMermaid();
  }, [attrs.content, editing]);

  return (
    <NodeViewWrapper 
       className="mermaid-wrapper"
       style={{ width: attrs.width || '100%' }}
    >
      <div className="mermaid-header" contentEditable={false}>
          <span className="mermaid-label">Mermaid 図</span>
          <div className="mermaid-header-actions">
            <select
              value={attrs.width || '100%'}
              onChange={(e) => updateAttributes({ width: e.target.value })}
              className="size-select"
              title="図のサイズを変更"
            >
              <option value="25%">25%</option>
              <option value="50%">50%</option>
              <option value="75%">75%</option>
              <option value="100%">100%</option>
              <option value="125%">125%</option>
              <option value="150%">150%</option>
              <option value="200%">200%</option>
              <option value="300%">300%</option>
            </select>
            <button className="btn-edit" onClick={() => setEditing(!editing)}>
              {editing ? 'プレビュー表示' : 'コードを編集'}
            </button>
          </div>
      </div>

      {editing ? (
        <textarea
            contentEditable={false}
            value={attrs.content || ''}
            onChange={(e) => updateAttributes({ content: e.target.value })}
            onWheel={(e) => e.stopPropagation()}
            onTouchMove={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            className="mermaid-editor"
            placeholder="graph TD..."
        />
      ) : (
        <div 
          className="mermaid-render" 
          dangerouslySetInnerHTML={{ __html: svg }} 
          contentEditable={false}
        />
      )}

      <style jsx>{`
        .mermaid-wrapper {
          margin: 1.5rem auto;
          background: var(--accent);
          border: 1px solid var(--border);
          border-radius: 12px;
          overflow: hidden;
          transition: width 0.3s ease;
        }
        .mermaid-header {
          padding: 8px 12px;
          background: var(--muted);
          border-bottom: 1px solid var(--border);
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .mermaid-label {
          font-size: 0.75rem;
          font-weight: 700;
          color: var(--primary);
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .mermaid-header-actions {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .size-select {
          padding: 2px 6px;
          border-radius: 6px;
          border: 1px solid var(--border);
          background: var(--background);
          color: var(--foreground);
          font-size: 0.75rem;
          outline: none;
          cursor: pointer;
        }
        .btn-edit {
          padding: 4px 12px;
          background: var(--primary);
          color: white;
          border-radius: 6px;
          font-size: 0.8rem;
          border: none;
          cursor: pointer;
        }
        .mermaid-editor {
          width: 100%;
          min-height: 160px;
          padding: 16px;
          font-family: monospace;
          font-size: 0.9rem;
          border: none;
          outline: none;
          background: #1e1e1e;
          color: #d4d4d4;
          resize: vertical;
        }
        .mermaid-render {
          padding: 24px;
          display: flex;
          justify-content: center;
          align-items: center;
          background: var(--background);
        }
        .mermaid-render :global(svg) {
          max-width: 100%;
          height: auto;
        }
      `}</style>
    </NodeViewWrapper>
  );
}
