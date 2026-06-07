'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Eraser, Pencil, Undo2, Trash2, Hand } from 'lucide-react';
import type { HandwritingDoc, HandwritingStroke } from '@/lib/db';
import { useT } from '@/lib/i18n';

interface HandwritingCanvasProps {
  value: HandwritingDoc;
  onChange: (next: HandwritingDoc) => void;
  readOnly?: boolean;
}

const PEN_COLORS = ['#1a1a1a', '#e94e77', '#3273dc', '#23a55a', '#f5a623', '#9b59b6'];
const PEN_WIDTHS = [1.5, 3, 6];

export default function HandwritingCanvas({ value, onChange, readOnly = false }: HandwritingCanvasProps) {
  const t = useT();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<HandwritingDoc>(value);
  const currentStrokeRef = useRef<HandwritingStroke | null>(null);
  const isDrawingRef = useRef(false);
  const pointerIdRef = useRef<number | null>(null);
  const [tool, setTool] = useState<'pen' | 'eraser'>('pen');
  const [color, setColor] = useState(PEN_COLORS[0]);
  const [width, setWidth] = useState(PEN_WIDTHS[1]);
  const [containerWidth, setContainerWidth] = useState(0);
  const [pencilOnly, setPencilOnly] = useState(false);

  useEffect(() => {
    docRef.current = value;
    redraw();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const apply = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0) setContainerWidth(rect.width);
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const displayScale = containerWidth > 0 ? containerWidth / docRef.current.width : 1;
  const displayWidth = docRef.current.width * displayScale;
  const displayHeight = docRef.current.height * displayScale;

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const doc = docRef.current;

    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== doc.width * dpr || canvas.height !== doc.height * dpr) {
      canvas.width = doc.width * dpr;
      canvas.height = doc.height * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Paper background
    ctx.fillStyle = '#fdf9f0';
    ctx.fillRect(0, 0, doc.width, doc.height);

    // Ruled lines (36px spacing)
    ctx.save();
    ctx.strokeStyle = 'rgba(150, 190, 255, 0.55)';
    ctx.lineWidth = 1;
    for (let y = 36; y < doc.height; y += 36) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(doc.width, y);
      ctx.stroke();
    }
    // Margin line
    ctx.strokeStyle = 'rgba(255, 130, 130, 0.45)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(72, 0);
    ctx.lineTo(72, doc.height);
    ctx.stroke();
    ctx.restore();

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const stroke of doc.strokes) {
      drawStroke(ctx, stroke);
    }
    if (currentStrokeRef.current) {
      drawStroke(ctx, currentStrokeRef.current);
    }
  }, []);

  function drawStroke(ctx: CanvasRenderingContext2D, stroke: HandwritingStroke) {
    const pts = stroke.points;
    if (!pts.length) return;
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.width;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    if (pts.length === 1) {
      ctx.lineTo(pts[0].x + 0.01, pts[0].y + 0.01);
    } else {
      for (let i = 1; i < pts.length - 1; i++) {
        const mx = (pts[i].x + pts[i + 1].x) / 2;
        const my = (pts[i].y + pts[i + 1].y) / 2;
        ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
      }
      ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
    }
    ctx.stroke();
  }

  const toCanvasPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const doc = docRef.current;
    const x = ((e.clientX - rect.left) / rect.width) * doc.width;
    const y = ((e.clientY - rect.top) / rect.height) * doc.height;
    return { x, y };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (readOnly) return;
    if (pencilOnly && e.pointerType !== 'pen') return;
    e.preventDefault();
    canvasRef.current?.setPointerCapture(e.pointerId);
    pointerIdRef.current = e.pointerId;
    isDrawingRef.current = true;
    const p = toCanvasPoint(e);
    if (tool === 'eraser') {
      eraseAt(p.x, p.y);
      return;
    }
    currentStrokeRef.current = { points: [p], color, width };
    redraw();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (readOnly) return;
    if (pencilOnly && e.pointerType !== 'pen') return;
    if (!isDrawingRef.current) return;
    if (pointerIdRef.current !== e.pointerId) return;
    const p = toCanvasPoint(e);
    if (tool === 'eraser') {
      eraseAt(p.x, p.y);
      return;
    }
    const cs = currentStrokeRef.current;
    if (!cs) return;
    const last = cs.points[cs.points.length - 1];
    if (last && Math.hypot(last.x - p.x, last.y - p.y) < 0.8) return;
    cs.points.push(p);
    redraw();
  };

  const onPointerUp = () => {
    if (readOnly) return;
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;
    pointerIdRef.current = null;
    const cs = currentStrokeRef.current;
    if (cs && cs.points.length > 0) {
      const nextDoc: HandwritingDoc = {
        ...docRef.current,
        strokes: [...docRef.current.strokes, cs],
      };
      docRef.current = nextDoc;
      currentStrokeRef.current = null;
      onChange(nextDoc);
      redraw();
    } else {
      currentStrokeRef.current = null;
      redraw();
    }
  };

  const eraseAt = (x: number, y: number) => {
    const doc = docRef.current;
    const before = doc.strokes.length;
    const next = doc.strokes.filter(s => !strokeHitsPoint(s, x, y, 8));
    if (next.length !== before) {
      const nextDoc: HandwritingDoc = { ...doc, strokes: next };
      docRef.current = nextDoc;
      onChange(nextDoc);
      redraw();
    }
  };

  function strokeHitsPoint(stroke: HandwritingStroke, x: number, y: number, threshold: number): boolean {
    const r = threshold + stroke.width / 2;
    for (const p of stroke.points) {
      if (Math.hypot(p.x - x, p.y - y) <= r) return true;
    }
    return false;
  }

  const undo = () => {
    if (readOnly) return;
    const doc = docRef.current;
    if (doc.strokes.length === 0) return;
    const next: HandwritingDoc = { ...doc, strokes: doc.strokes.slice(0, -1) };
    docRef.current = next;
    onChange(next);
    redraw();
  };

  const clearAll = () => {
    if (readOnly) return;
    if (docRef.current.strokes.length === 0) return;
    if (!confirm(t('すべて消去しますか？'))) return;
    const next: HandwritingDoc = { ...docRef.current, strokes: [] };
    docRef.current = next;
    onChange(next);
    redraw();
  };

  return (
    <div className="hw-root">
      {!readOnly && (
        <div className="hw-toolbar">
          <button
            className={`hw-btn ${tool === 'pen' ? 'active' : ''}`}
            onClick={() => setTool('pen')}
            title={t('ペン')}
          >
            <Pencil size={16} />
          </button>
          <button
            className={`hw-btn ${tool === 'eraser' ? 'active' : ''}`}
            onClick={() => setTool('eraser')}
            title={t('消しゴム')}
          >
            <Eraser size={16} />
          </button>
          <div className="hw-divider" />
          <div className="hw-colors">
            {PEN_COLORS.map(c => (
              <button
                key={c}
                className={`hw-color ${color === c ? 'active' : ''}`}
                style={{ background: c }}
                onClick={() => { setColor(c); setTool('pen'); }}
                aria-label={t('色 {c}', { c })}
              />
            ))}
          </div>
          <div className="hw-divider" />
          <div className="hw-widths">
            {PEN_WIDTHS.map(w => (
              <button
                key={w}
                className={`hw-width ${width === w ? 'active' : ''}`}
                onClick={() => { setWidth(w); setTool('pen'); }}
                aria-label={t('太さ {w}', { w })}
              >
                <span style={{ width: w * 2.5, height: w * 2.5, background: color }} />
              </button>
            ))}
          </div>
          <div className="hw-divider" />
          <button className="hw-btn" onClick={undo} title={t('一手戻す')}><Undo2 size={16} /></button>
          <button className="hw-btn" onClick={clearAll} title={t('全消去')}><Trash2 size={16} /></button>
          <div className="hw-divider" />
          <button
            className={`hw-btn ${pencilOnly ? 'active' : ''}`}
            onClick={() => setPencilOnly(p => !p)}
            title={pencilOnly ? t('Apple Pencil専用（指でスクロール）') : t('全タッチモード（指でも描ける）')}
          >
            <Hand size={16} />
          </button>
        </div>
      )}
      <div className="hw-canvas-wrap" ref={wrapRef}>
        {containerWidth > 0 ? (
          <div className="hw-canvas-stage" style={{ width: displayWidth, height: displayHeight }}>
            <canvas
              ref={canvasRef}
              className="hw-canvas"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onPointerLeave={onPointerUp}
              style={{ width: displayWidth, height: displayHeight, touchAction: pencilOnly ? 'pan-x pan-y' : 'none' }}
            />
          </div>
        ) : (
          <div
            className="hw-canvas-stage"
            style={{ width: '100%', aspectRatio: `${docRef.current.width} / ${docRef.current.height}` }}
          >
            <canvas
              ref={canvasRef}
              className="hw-canvas"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onPointerLeave={onPointerUp}
              style={{ width: '100%', height: '100%', touchAction: pencilOnly ? 'pan-x pan-y' : 'none' }}
            />
          </div>
        )}
      </div>
      <style jsx>{`
        .hw-root {
          display: flex;
          flex-direction: column;
          gap: 12px;
          width: 100%;
        }
        .hw-toolbar {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 10px;
          background: var(--accent);
          border: 1px solid var(--border);
          border-radius: 10px;
          flex-wrap: wrap;
        }
        .hw-btn {
          background: var(--background);
          color: var(--foreground);
          padding: 6px;
          border-radius: 8px;
          border: 1px solid transparent;
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .hw-btn.active {
          border-color: var(--primary);
          color: var(--primary);
        }
        .hw-divider {
          width: 1px;
          align-self: stretch;
          background: var(--border);
          flex-shrink: 0;
        }
        .hw-colors, .hw-widths {
          display: flex;
          gap: 6px;
          align-items: center;
          flex-shrink: 0;
        }
        .hw-color {
          width: 20px;
          height: 20px;
          border-radius: 50%;
          border: 2px solid transparent;
          padding: 0;
          flex-shrink: 0;
        }
        .hw-color.active {
          border-color: var(--foreground);
        }
        .hw-width {
          width: 28px;
          height: 28px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--background);
          border-radius: 8px;
          border: 1px solid transparent;
          flex-shrink: 0;
        }
        .hw-width.active {
          border-color: var(--primary);
        }
        .hw-width > span {
          display: block;
          border-radius: 50%;
        }
        .hw-canvas-wrap {
          background: #fdf9f0;
          border: 1px solid #d6c9a8;
          border-radius: 12px;
          overflow: auto;
          -webkit-overflow-scrolling: touch;
          box-shadow: 0 2px 8px rgba(0,0,0,0.08), inset 0 0 0 1px rgba(255,255,255,0.6);
        }
        :global([data-theme='dark']) .hw-canvas-wrap {
          background: #fdf9f0;
          border-color: #d6c9a8;
        }
        .hw-canvas-stage {
          position: relative;
        }
        .hw-canvas {
          display: block;
          touch-action: none;
        }
      `}</style>
    </div>
  );
}
