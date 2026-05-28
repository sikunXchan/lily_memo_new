'use client';

import { NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react';
import { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';
import { sanitizeMindmap, recoverMermaid } from '@/lib/mermaidSanitize';

mermaid.initialize({
  startOnLoad: false,
  theme: 'base',
  themeVariables: {
    primaryColor: '#fce4ec',
    primaryTextColor: '#1a1a1a',
    primaryBorderColor: '#e84393',
    lineColor: '#e84393',
    secondaryColor: '#fff3e0',
    secondaryBorderColor: '#fb8c00',
    secondaryTextColor: '#1a1a1a',
    tertiaryColor: '#e3f2fd',
    tertiaryBorderColor: '#1976d2',
    tertiaryTextColor: '#1a1a1a',
    fontFamily: 'inherit',
  },
  securityLevel: 'loose',
  suppressErrors: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any);

export default function MermaidComponent({ node: { attrs }, updateAttributes }: ReactNodeViewProps) {
  const [svg, setSvg] = useState('');
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const renderRef = useRef<HTMLDivElement>(null);
  const [extraSpace, setExtraSpace] = useState(0);
  const widthNum = attrs.width ? parseInt(attrs.width as string) : 100;
  const scale = widthNum > 100 ? widthNum / 100 : 1;

  useEffect(() => {
    if (editing) return;
    let cancelled = false;
    const doRender = async () => {
      if (!attrs.content) return;
      const parse = (mermaid as unknown as { parse(t: string, o: object): Promise<boolean> }).parse;
      let source = sanitizeMindmap(attrs.content as string);
      try {
        // First attempt: as-is. If it fails parsing, retry with autoquote.
        let ok = await parse(source, { suppressErrors: true });
        if (!ok) {
          const recovered = recoverMermaid(source);
          if (recovered !== source) {
            ok = await parse(recovered, { suppressErrors: true });
            if (ok) source = recovered;
          }
        }
        if (!ok) {
          if (!cancelled) { setError('構文エラー'); setEditing(true); }
          return;
        }
        const id = `mermaid-${Math.random().toString(36).slice(2, 9)}`;
        const { svg: renderedSvg } = await mermaid.render(id, source);
        if (!cancelled) { setSvg(renderedSvg); setError(''); }
      } catch (err) {
        console.error('Mermaid render error:', err);
        if (!cancelled) { setError('構文エラー'); setEditing(true); }
      }
    };
    void doRender();
    return () => { cancelled = true; };
  }, [attrs.content, editing]);

  useEffect(() => {
    const el = renderRef.current;
    const measure = () => {
      if (!el || scale <= 1) {
        setExtraSpace(0);
        return;
      }
      setExtraSpace(el.offsetHeight * (scale - 1));
    };
    measure();
    if (!el || scale <= 1) return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [scale, svg]);

  return (
    <NodeViewWrapper
       className="mermaid-wrapper"
       style={{
         width: widthNum <= 100 ? attrs.width : '100%',
         paddingBottom: extraSpace > 0 ? `${extraSpace}px` : undefined,
       }}
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
            <button className="btn-edit" onClick={() => { setError(''); setEditing(!editing); }}>
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
      ) : error ? (
        <div className="mermaid-error" contentEditable={false}>
          <span className="mermaid-error-msg">Mermaid 構文エラー — コードを確認してね</span>
          <button className="btn-edit" onClick={() => { setError(''); setEditing(true); }}>編集</button>
        </div>
      ) : (
        <div
          ref={renderRef}
          className="mermaid-render"
          dangerouslySetInnerHTML={{ __html: svg }}
          contentEditable={false}
          style={{
            transformOrigin: 'top center',
            transform: scale > 1 ? `scale(${scale})` : 'none',
          }}
        />
      )}

      <style jsx>{`
        .mermaid-wrapper {
          margin: 1.5rem auto;
          background: var(--accent);
          border: 1px solid var(--border);
          border-radius: 12px;
          overflow: visible;
          max-width: 100%;
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
        .mermaid-error {
          padding: 16px 24px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: color-mix(in srgb, #cc0000 8%, var(--background));
          border-top: 1px solid color-mix(in srgb, #cc0000 20%, transparent);
        }
        .mermaid-error-msg {
          font-size: 0.82rem;
          color: #cc0000;
          font-weight: 600;
        }
      `}</style>
    </NodeViewWrapper>
  );
}
