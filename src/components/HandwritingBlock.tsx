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
  const scale = w / (doc.width || 1280);

  // Paper background
  ctx.fillStyle = '#fdf9f0';
  ctx.fillRect(0, 0, w, PREVIEW_H);

  // Ruled lines (scaled to preview)
  ctx.save();
  ctx.strokeStyle = 'rgba(150, 190, 255, 0.55)';
  ctx.lineWidth = 1;
  for (let y = 36 * scale; y < PREVIEW_H; y += 36 * scale) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(255, 130, 130, 0.45)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(72 * scale, 0);
  ctx.lineTo(72 * scale, PREVIEW_H);
  ctx.stroke();
  ctx.restore();

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const stroke of doc.strokes) {
    if (!stroke.points.length) continue;
    ctx.beginPath();
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = Math.max(stroke.width * scale, 0.5);
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
          <div className="hw-empty">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#b0a890" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
            <span>タップして手書き</span>
          </div>
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
          border: 1.5px solid #d6c9a8;
          border-radius: 12px;
          cursor: pointer;
          margin: 6px 0;
          overflow: hidden;
          transition: border-color 0.15s, box-shadow 0.15s;
          min-height: 80px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #fdf9f0;
          user-select: none;
          box-shadow: 0 2px 8px rgba(0,0,0,0.07);
        }
        .hw-block:hover { border-color: var(--primary); box-shadow: 0 3px 12px rgba(0,0,0,0.11); }
        .hw-selected { border: 2px solid var(--primary); }
        .hw-empty {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 6px;
          color: #b0a890;
          font-size: 0.85rem;
          padding: 24px;
        }
        .hw-fullscreen {
          position: fixed;
          inset: 0;
          z-index: 10000;
          background: #f0ebe0;
          display: flex;
          flex-direction: column;
        }
        .hw-topbar {
          display: flex;
          align-items: center;
          padding: 10px 16px;
          padding-top: calc(10px + env(safe-area-inset-top));
          border-bottom: 1px solid #d6c9a8;
          background: #fdf9f0;
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
