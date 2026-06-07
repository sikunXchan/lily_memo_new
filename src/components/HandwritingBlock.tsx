'use client';

import { NodeViewWrapper } from '@tiptap/react';
import type { ReactNodeViewProps } from '@tiptap/react';
import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import HandwritingCanvas from './HandwritingCanvas';
import type { HandwritingDoc } from '@/lib/db';

const BLOCK_DEFAULT: HandwritingDoc = { strokes: [], width: 1280, height: 900 };
const PREVIEW_H = 180;

function drawPreview(canvas: HTMLCanvasElement, doc: HandwritingDoc) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 300;
  canvas.width = w * dpr;
  canvas.height = PREVIEW_H * dpr;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, PREVIEW_H);
  const scale = w / (doc.width || 1280);
  for (const stroke of doc.strokes) {
    if (!stroke.points.length) continue;
    ctx.beginPath();
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = Math.max(stroke.width * scale, 0.5);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.moveTo(stroke.points[0].x * scale, stroke.points[0].y * scale);
    for (const pt of stroke.points.slice(1)) ctx.lineTo(pt.x * scale, pt.y * scale);
    ctx.stroke();
  }
}

export default function HandwritingBlock({ node, updateAttributes, selected }: ReactNodeViewProps) {
  const [doc, setDoc] = useState<HandwritingDoc>(() => {
    try {
      const parsed = JSON.parse(node.attrs.data || '{}') as HandwritingDoc;
      return parsed.strokes ? parsed : { ...BLOCK_DEFAULT };
    } catch {
      return { ...BLOCK_DEFAULT };
    }
  });
  const [editing, setEditing] = useState(false);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const isEmpty = doc.strokes.length === 0;

  useEffect(() => {
    if (!previewRef.current || isEmpty) return;
    const id = requestAnimationFrame(() => {
      if (previewRef.current) drawPreview(previewRef.current, doc);
    });
    return () => cancelAnimationFrame(id);
  }, [doc, isEmpty]);

  const close = () => {
    setEditing(false);
    updateAttributes({ data: JSON.stringify(doc) });
  };

  return (
    <NodeViewWrapper contentEditable={false}>
      <div
        className={`hw-block${selected ? ' hw-selected' : ''}`}
        onClick={() => setEditing(true)}
      >
        {isEmpty ? (
          <div className="hw-empty">✏️ タップして手書き</div>
        ) : (
          <canvas
            ref={previewRef}
            className="hw-preview"
            style={{ width: '100%', height: PREVIEW_H, display: 'block' }}
          />
        )}
      </div>

      {editing && typeof document !== 'undefined' && createPortal(
        <div className="hw-fullscreen">
          <div className="hw-topbar">
            <button className="hw-done-btn" onClick={close}>✓ 完了</button>
          </div>
          <div className="hw-canvas-wrap">
            <HandwritingCanvas value={doc} onChange={setDoc} />
          </div>
        </div>,
        document.body
      )}

      <style jsx>{`
        .hw-block {
          border: 2px dashed var(--border);
          border-radius: 12px;
          cursor: pointer;
          margin: 6px 0;
          overflow: hidden;
          transition: border-color 0.15s;
          min-height: 60px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--accent);
          user-select: none;
        }
        .hw-block:hover { border-color: var(--primary); }
        .hw-selected { border: 2px solid var(--primary); }
        .hw-empty { color: var(--fg-muted, #999); font-size: 0.9rem; padding: 20px; }
        .hw-fullscreen {
          position: fixed;
          inset: 0;
          z-index: 10000;
          background: var(--background);
          display: flex;
          flex-direction: column;
        }
        .hw-topbar {
          display: flex;
          align-items: center;
          padding: 10px 16px;
          padding-top: calc(10px + env(safe-area-inset-top));
          border-bottom: 1px solid var(--border);
          flex-shrink: 0;
        }
        .hw-done-btn {
          background: var(--primary);
          color: #fff;
          border: none;
          border-radius: 10px;
          padding: 8px 22px;
          font-weight: 700;
          font-size: 0.9rem;
          cursor: pointer;
        }
        .hw-canvas-wrap {
          flex: 1;
          overflow: hidden;
          position: relative;
        }
      `}</style>
    </NodeViewWrapper>
  );
}
