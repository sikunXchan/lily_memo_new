'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Eraser, Pencil, Undo2, Trash2 } from 'lucide-react';
import type { HandwritingDoc, HandwritingStroke } from '@/lib/db';

interface HandwritingCanvasProps {
  value: HandwritingDoc;
  onChange: (next: HandwritingDoc) => void;
  readOnly?: boolean;
}

const PEN_COLORS = ['#1a1a1a', '#e94e77', '#3273dc', '#23a55a', '#f5a623', '#9b59b6'];
const PEN_WIDTHS = [1.5, 3, 6];

export default function HandwritingCanvas({ value, onChange, readOnly = false }: HandwritingCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<HandwritingDoc>(value);
  const currentStrokeRef = useRef<HandwritingStroke | null>(null);
  const isDrawingRef = useRef(false);
  const pointerIdRef = useRef<number | null>(null);
  const [tool, setTool] = useState<'pen' | 'eraser'>('pen');
  const [color, setColor] = useState(PEN_COLORS[0]);
  const [width, setWidth] = useState(PEN_WIDTHS[1]);

  // Keep doc ref in sync with prop changes (e.g. note switch)
  useEffect(() => {
    docRef.current = value;
    redraw();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const doc = docRef.current;

    // Logical size = doc.width/height; physical = scaled by devicePixelRatio
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== doc.width * dpr || canvas.height !== doc.height * dpr) {
      canvas.width = doc.width * dpr;
      canvas.height = doc.height * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, doc.width, doc.height);
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
    if (stroke.points.length === 0) return;
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.width;
    ctx.beginPath();
    ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
    if (stroke.points.length === 1) {
      // dot
      ctx.lineTo(stroke.points[0].x + 0.01, stroke.points[0].y + 0.01);
    } else {
      for (let i = 1; i < stroke.points.length; i++) {
        ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
      }
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
    if (!confirm('すべて消去しますか？')) return;
    const next: HandwritingDoc = { ...docRef.current, strokes: [] };
    docRef.current = next;
    onChange(next);
    redraw();
  };

  return (
    <div ref={containerRef} className="hw-root">
      {!readOnly && (
        <div className="hw-toolbar">
          <button
            className={`hw-btn ${tool === 'pen' ? 'active' : ''}`}
            onClick={() => setTool('pen')}
            title="ペン"
          >
            <Pencil size={16} />
          </button>
          <button
            className={`hw-btn ${tool === 'eraser' ? 'active' : ''}`}
            onClick={() => setTool('eraser')}
            title="消しゴム"
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
                aria-label={`色 ${c}`}
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
                aria-label={`太さ ${w}`}
              >
                <span style={{ width: w * 2.5, height: w * 2.5, background: color }} />
              </button>
            ))}
          </div>
          <div className="hw-divider" />
          <button className="hw-btn" onClick={undo} title="一手戻す"><Undo2 size={16} /></button>
          <button className="hw-btn" onClick={clearAll} title="全消去"><Trash2 size={16} /></button>
        </div>
      )}
      <div className="hw-canvas-wrap">
        <canvas
          ref={canvasRef}
          className="hw-canvas"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={onPointerUp}
          style={{ touchAction: 'none' }}
        />
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
        }
        .hw-btn.active {
          border-color: var(--primary);
          color: var(--primary);
        }
        .hw-divider {
          width: 1px;
          align-self: stretch;
          background: var(--border);
        }
        .hw-colors, .hw-widths {
          display: flex;
          gap: 6px;
          align-items: center;
        }
        .hw-color {
          width: 20px;
          height: 20px;
          border-radius: 50%;
          border: 2px solid transparent;
          padding: 0;
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
        }
        .hw-width.active {
          border-color: var(--primary);
        }
        .hw-width > span {
          display: block;
          border-radius: 50%;
        }
        .hw-canvas-wrap {
          background: #fff;
          border: 1px solid var(--border);
          border-radius: 12px;
          overflow: hidden;
          box-shadow: 0 1px 4px rgba(0,0,0,0.06);
        }
        :global([data-theme='dark']) .hw-canvas-wrap {
          background: #f5f5f5;
        }
        .hw-canvas {
          display: block;
          width: 100%;
          height: auto;
          aspect-ratio: 4 / 3;
          touch-action: none;
        }
      `}</style>
    </div>
  );
}
