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
    <NodeViewWrapper className="mermaid-wrapper">
      <div className="mermaid-header" contentEditable={false}>
          <button className="btn-edit" onClick={() => setEditing(!editing)}>
            {editing ? 'プレビュー表示' : 'コードを編集'}
          </button>
      </div>

      {editing ? (
        <textarea
            contentEditable={false}
            value={attrs.content || ''}
            onChange={(e) => updateAttributes({ content: e.target.value })}
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
          margin: 2rem 0;
          background: #fdfdfd;
          border: 1px solid #eee;
          border-radius: 12px;
          overflow: hidden;
        }
        .mermaid-header {
          padding: 8px;
          background: #f8f8f8;
          border-bottom: 1px solid #eee;
          text-align: right;
        }
        .btn-edit {
          padding: 4px 12px;
          background: var(--primary);
          color: white;
          border-radius: 6px;
        }
        .mermaid-editor {
          width: 100%;
          min-height: 200px;
          padding: 16px;
          font-family: inherit;
          border: none;
          outline: none;
          background: #2d2d2d;
          color: #eee;
        }
        .mermaid-render {
          padding: 32px;
          display: flex;
          justify-content: center;
          align-items: center;
        }
        .mermaid-render :global(svg) {
          max-width: 100%;
          height: auto;
        }
      `}</style>
    </NodeViewWrapper>
  );
}
