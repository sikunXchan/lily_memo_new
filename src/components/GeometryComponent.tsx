'use client';

import { NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react';
import { useMemo, useState } from 'react';
import { parseGeometry, renderGeometrySvg } from '@/lib/geometry';
import { downloadSvg, downloadSvgAsPng } from '@/lib/fileGen';
import { useT } from '@/lib/i18n';
import 'katex/dist/katex.min.css';

export default function GeometryComponent({ node: { attrs }, updateAttributes }: ReactNodeViewProps) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [localCode, setLocalCode] = useState('');

  const code = (attrs.code as string) || '';
  const widthNum = attrs.width ? parseInt(attrs.width as string) : 100;
  const scale = widthNum > 100 ? widthNum / 100 : 1;

  const { svg, error } = useMemo(() => {
    if (!code.trim()) return { svg: '', error: '' };
    try {
      return { svg: renderGeometrySvg(parseGeometry(code)), error: '' };
    } catch (e) {
      return { svg: '', error: e instanceof Error ? e.message : t('不明なエラー') };
    }
  }, [code]);

  const startEdit = () => { setLocalCode(code); setEditing(true); };
  const saveEdit = () => { updateAttributes({ code: localCode }); setEditing(false); };
  const baseName = 'lily-geometry';

  return (
    <NodeViewWrapper
      className="geo-wrapper"
      style={{
        width: widthNum <= 100 ? (attrs.width as string) : '100%',
        paddingBottom: scale > 1 && svg ? `${(scale - 1) * 100}%` : undefined,
      }}
    >
      <div className="geo-header" contentEditable={false}>
        <span className="geo-label">📐 {t('幾何の図')}</span>
        <div className="geo-actions">
          <select
            value={(attrs.width as string) || '100%'}
            onChange={(e) => updateAttributes({ width: e.target.value })}
            className="size-select"
            title={t('サイズ')}
          >
            {['25%', '50%', '75%', '100%', '125%', '150%', '200%'].map(v => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
          {!editing && svg && (
            <>
              <button className="btn-save" onClick={() => downloadSvgAsPng(svg, `${baseName}.png`)}>PNG</button>
              <button className="btn-save" onClick={() => downloadSvg(svg, `${baseName}.svg`)}>SVG</button>
            </>
          )}
          <button className="btn-edit" onClick={editing ? saveEdit : startEdit}>
            {editing ? `✓ ${t('保存')}` : t('コードを編集')}
          </button>
        </div>
      </div>

      {editing ? (
        <textarea
          contentEditable={false}
          value={localCode}
          onChange={(e) => setLocalCode(e.target.value)}
          onWheel={(e) => e.stopPropagation()}
          onTouchMove={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          className="geo-editor"
          placeholder={t('{\n  "title": "タイトル",\n  "xRange": [-3, 3],\n  "yRange": [-3, 3],\n  "elements": [\n    {"type":"point","x":1,"y":2,"label":"A"}\n  ]\n}')}
          spellCheck={false}
        />
      ) : (
        <div
          className="geo-render"
          contentEditable={false}
          style={{ transform: scale > 1 ? `scale(${scale})` : 'none', transformOrigin: 'top center' }}
        >
          {svg && <div dangerouslySetInnerHTML={{ __html: svg }} />}
          {error && <div className="geo-error">⚠️ {error}</div>}
          {!svg && !error && <div className="geo-empty">{t('「コードを編集」でJSONを入力してね')}</div>}
        </div>
      )}

      <style jsx>{`
        .geo-wrapper { margin: 1.5rem auto; background: var(--accent); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }
        .geo-header { padding: 8px 12px; background: var(--muted); border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; }
        .geo-label { font-size: 0.75rem; font-weight: 700; color: var(--primary); text-transform: uppercase; letter-spacing: 0.5px; }
        .geo-actions { display: flex; align-items: center; gap: 6px; }
        .size-select { padding: 2px 6px; border-radius: 6px; border: 1px solid var(--border); background: var(--background); color: var(--foreground); font-size: 0.75rem; outline: none; cursor: pointer; }
        .btn-edit { padding: 4px 12px; background: var(--primary); color: white; border-radius: 6px; font-size: 0.8rem; border: none; cursor: pointer; white-space: nowrap; }
        .btn-save { padding: 4px 10px; background: transparent; border: 1px solid var(--border); border-radius: 6px; font-size: 0.75rem; color: var(--fg-muted); cursor: pointer; white-space: nowrap; }
        .btn-save:hover { border-color: var(--primary); color: var(--primary); }
        .geo-editor { width: 100%; min-height: 220px; padding: 16px; font-family: 'Fira Code','Consolas',monospace; font-size: 0.82rem; border: none; outline: none; background: #1e1e1e; color: #d4d4d4; resize: vertical; line-height: 1.5; display: block; }
        .geo-render { padding: 16px; display: flex; justify-content: center; align-items: center; min-height: 80px; background: var(--background); }
        .geo-render :global(svg) { max-width: 100%; height: auto; }
        .geo-error { color: #cc0000; font-size: 0.82rem; padding: 8px; }
        .geo-empty { color: var(--fg-muted); font-size: 0.85rem; }
      `}</style>
    </NodeViewWrapper>
  );
}
