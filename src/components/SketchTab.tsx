'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Pencil, Eraser, Undo2, Redo2, Trash2, ZoomIn, ZoomOut, Maximize,
  ArrowLeft, Hand, Fingerprint,
} from 'lucide-react';
import { useT } from '@/lib/i18n';

interface SketchTabProps {
  onClose?: () => void;
}

type Stroke = {
  points: { x: number; y: number }[];
  color: string;
  width: number;
};

type View = { scale: number; tx: number; ty: number };

const PEN_COLORS = ['#1a1a1a', '#e94e77', '#3273dc', '#23a55a', '#f5a623', '#9b59b6'];
const PEN_WIDTHS = [1.5, 3, 6, 10];
const MIN_SCALE = 0.25;
const MAX_SCALE = 8;
const ERASER_RADIUS = 12;
// Notebook-style grid (graph-paper look). Drawn in world space so it
// pans/zooms with the strokes, like an infinite sheet of grid paper.
const GRID = 40;
const GRID_MAJOR_EVERY = 5;

export default function SketchTab({ onClose }: SketchTabProps) {
  const t = useT();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const [tool, setTool] = useState<'pen' | 'eraser'>('pen');
  const [color, setColor] = useState(PEN_COLORS[0]);
  const [width, setWidth] = useState(PEN_WIDTHS[1]);
  const [view, setView] = useState<View>({ scale: 1, tx: 0, ty: 0 });
  // Pen-only: touch input pans/zooms only, pen input draws.
  // Persisted so the preference survives navigation.
  const [penOnly, setPenOnly] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('sketchPenOnly') === '1';
  });
  useEffect(() => {
    try { localStorage.setItem('sketchPenOnly', penOnly ? '1' : '0'); } catch {}
  }, [penOnly]);

  const strokesRef = useRef<Stroke[]>([]);
  const redoRef = useRef<Stroke[]>([]);
  const currentRef = useRef<Stroke | null>(null);

  // Pointer state
  const pointersRef = useRef<Map<number, { x: number; y: number; type: string }>>(new Map());
  const drawingRef = useRef<{ pointerId: number; moved: boolean } | null>(null);
  const panRef = useRef<{ initial: View; startX: number; startY: number; pointerId: number } | null>(null);
  const pinchRef = useRef<{ initial: View; dist: number; center: { x: number; y: number } } | null>(null);

  // --- Canvas size tracking ---
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const apply = () => {
      const r = el.getBoundingClientRect();
      setSize({ w: Math.floor(r.width), h: Math.floor(r.height) });
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const redraw = useCallback(() => {
    const cnv = canvasRef.current;
    if (!cnv || size.w === 0 || size.h === 0) return;
    const ctx = cnv.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    if (cnv.width !== Math.ceil(size.w * dpr) || cnv.height !== Math.ceil(size.h * dpr)) {
      cnv.width = Math.ceil(size.w * dpr);
      cnv.height = Math.ceil(size.h * dpr);
      cnv.style.width = size.w + 'px';
      cnv.style.height = size.h + 'px';
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size.w, size.h);

    ctx.translate(view.tx, view.ty);
    ctx.scale(view.scale, view.scale);

    // --- Notebook grid background ---
    {
      const left = -view.tx / view.scale;
      const top = -view.ty / view.scale;
      const right = (size.w - view.tx) / view.scale;
      const bottom = (size.h - view.ty) / view.scale;
      const startX = Math.floor(left / GRID) * GRID;
      const startY = Math.floor(top / GRID) * GRID;
      // Keep lines ~1px regardless of zoom.
      const minor = 0.6 / view.scale;
      const major = 1 / view.scale;
      for (let x = startX; x <= right; x += GRID) {
        const isMajor = Math.round(x / GRID) % GRID_MAJOR_EVERY === 0;
        ctx.strokeStyle = isMajor ? '#cfd8e3' : '#e5ebf2';
        ctx.lineWidth = isMajor ? major : minor;
        ctx.beginPath();
        ctx.moveTo(x, top);
        ctx.lineTo(x, bottom);
        ctx.stroke();
      }
      for (let y = startY; y <= bottom; y += GRID) {
        const isMajor = Math.round(y / GRID) % GRID_MAJOR_EVERY === 0;
        ctx.strokeStyle = isMajor ? '#cfd8e3' : '#e5ebf2';
        ctx.lineWidth = isMajor ? major : minor;
        ctx.beginPath();
        ctx.moveTo(left, y);
        ctx.lineTo(right, y);
        ctx.stroke();
      }
    }

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const drawStroke = (s: Stroke) => {
      if (s.points.length === 0) return;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.width;
      ctx.beginPath();
      ctx.moveTo(s.points[0].x, s.points[0].y);
      if (s.points.length === 1) {
        ctx.lineTo(s.points[0].x + 0.01, s.points[0].y + 0.01);
      } else {
        for (let i = 1; i < s.points.length; i++) {
          ctx.lineTo(s.points[i].x, s.points[i].y);
        }
      }
      ctx.stroke();
    };

    for (const s of strokesRef.current) drawStroke(s);
    if (currentRef.current) drawStroke(currentRef.current);
  }, [size.w, size.h, view.scale, view.tx, view.ty]);

  useEffect(() => {
    redraw();
  }, [redraw]);

  const toWorld = (px: number, py: number) => ({
    x: (px - view.tx) / view.scale,
    y: (py - view.ty) / view.scale,
  });
  const clampScale = (s: number) => Math.max(MIN_SCALE, Math.min(MAX_SCALE, s));

  // --- Wheel zoom (for trackpad pinch / mouse wheel — harmless on iPad) ---
  useEffect(() => {
    const cnv = canvasRef.current;
    if (!cnv) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = cnv.getBoundingClientRect();
      const ax = e.clientX - rect.left;
      const ay = e.clientY - rect.top;
      const factor = Math.exp(-e.deltaY * 0.0015);
      setView(v => {
        const nextScale = clampScale(v.scale * factor);
        if (nextScale === v.scale) return v;
        const wx = (ax - v.tx) / v.scale;
        const wy = (ay - v.ty) / v.scale;
        return { scale: nextScale, tx: ax - wx * nextScale, ty: ay - wy * nextScale };
      });
    };
    cnv.addEventListener('wheel', onWheel, { passive: false });
    return () => cnv.removeEventListener('wheel', onWheel);
  }, []);

  const localPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  // Touch input behaves as a pan/scroll gesture when:
  //   - penOnly mode is on, OR
  //   - there are 2+ touches (pinch always wins)
  const shouldPanForTouch = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType !== 'touch') return false;
    if (penOnly) return true;
    return false;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const cnv = e.currentTarget;
    cnv.setPointerCapture(e.pointerId);
    const p = localPoint(e);
    pointersRef.current.set(e.pointerId, { x: p.x, y: p.y, type: e.pointerType });

    // Two pointers → pinch zoom (cancel any in-progress draw).
    if (pointersRef.current.size === 2) {
      if (drawingRef.current) {
        currentRef.current = null;
        drawingRef.current = null;
      }
      panRef.current = null;
      const pts = Array.from(pointersRef.current.values());
      const dx = pts[0].x - pts[1].x;
      const dy = pts[0].y - pts[1].y;
      pinchRef.current = {
        initial: view,
        dist: Math.hypot(dx, dy),
        center: { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 },
      };
      redraw();
      return;
    }

    // Mouse middle button / shift → pan (kept for completeness — user said no PC).
    const explicitPan = e.button === 1 || e.shiftKey;

    if (explicitPan || shouldPanForTouch(e)) {
      panRef.current = { initial: view, startX: p.x, startY: p.y, pointerId: e.pointerId };
      return;
    }

    // Begin draw (pen or non-penOnly touch or mouse).
    const wp = toWorld(p.x, p.y);
    if (tool === 'eraser') {
      eraseAt(wp.x, wp.y);
      drawingRef.current = { pointerId: e.pointerId, moved: true };
      return;
    }
    currentRef.current = { points: [wp], color, width };
    drawingRef.current = { pointerId: e.pointerId, moved: false };
    redraw();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!pointersRef.current.has(e.pointerId)) return;
    const p = localPoint(e);
    const existing = pointersRef.current.get(e.pointerId)!;
    pointersRef.current.set(e.pointerId, { x: p.x, y: p.y, type: existing.type });

    if (pinchRef.current && pointersRef.current.size === 2) {
      const pts = Array.from(pointersRef.current.values());
      const dx = pts[0].x - pts[1].x;
      const dy = pts[0].y - pts[1].y;
      const dist = Math.hypot(dx, dy);
      const center = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      const { initial } = pinchRef.current;
      const ratio = dist / pinchRef.current.dist;
      const nextScale = clampScale(initial.scale * ratio);
      const wx = (pinchRef.current.center.x - initial.tx) / initial.scale;
      const wy = (pinchRef.current.center.y - initial.ty) / initial.scale;
      const tx = center.x - wx * nextScale;
      const ty = center.y - wy * nextScale;
      setView({ scale: nextScale, tx, ty });
      return;
    }

    if (panRef.current && panRef.current.pointerId === e.pointerId) {
      const { initial, startX, startY } = panRef.current;
      setView({ scale: initial.scale, tx: initial.tx + (p.x - startX), ty: initial.ty + (p.y - startY) });
      return;
    }

    if (drawingRef.current && drawingRef.current.pointerId === e.pointerId) {
      const wp = toWorld(p.x, p.y);
      if (tool === 'eraser') {
        eraseAt(wp.x, wp.y);
        return;
      }
      const cs = currentRef.current;
      if (!cs) return;
      const last = cs.points[cs.points.length - 1];
      if (last && Math.hypot(last.x - wp.x, last.y - wp.y) < 0.8 / view.scale) return;
      cs.points.push(wp);
      drawingRef.current.moved = true;
      redraw();
    }
  };

  const finishPointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const cnv = e.currentTarget;
    if (cnv.hasPointerCapture(e.pointerId)) cnv.releasePointerCapture(e.pointerId);
    pointersRef.current.delete(e.pointerId);

    if (pointersRef.current.size < 2) pinchRef.current = null;

    if (panRef.current && panRef.current.pointerId === e.pointerId) {
      panRef.current = null;
    }

    if (drawingRef.current && drawingRef.current.pointerId === e.pointerId) {
      const cs = currentRef.current;
      if (cs && tool !== 'eraser' && cs.points.length > 0) {
        strokesRef.current = [...strokesRef.current, cs];
        redoRef.current = [];
      }
      currentRef.current = null;
      drawingRef.current = null;
      redraw();
    }
  };

  const eraseAt = (x: number, y: number) => {
    const r = ERASER_RADIUS / view.scale;
    const before = strokesRef.current.length;
    const next = strokesRef.current.filter(s => !strokeNear(s, x, y, r));
    if (next.length !== before) {
      strokesRef.current = next;
      redoRef.current = [];
      redraw();
    }
  };

  const strokeNear = (s: Stroke, x: number, y: number, r: number) => {
    const rr = r + s.width / 2;
    for (const p of s.points) {
      if (Math.hypot(p.x - x, p.y - y) <= rr) return true;
    }
    return false;
  };

  const undo = () => {
    const list = strokesRef.current;
    if (list.length === 0) return;
    const last = list[list.length - 1];
    strokesRef.current = list.slice(0, -1);
    redoRef.current = [...redoRef.current, last];
    redraw();
  };

  const redo = () => {
    const list = redoRef.current;
    if (list.length === 0) return;
    const last = list[list.length - 1];
    redoRef.current = list.slice(0, -1);
    strokesRef.current = [...strokesRef.current, last];
    redraw();
  };

  const clearAll = () => {
    if (strokesRef.current.length === 0) return;
    if (!confirm(t('落書きをすべて消去しますか？'))) return;
    strokesRef.current = [];
    redoRef.current = [];
    redraw();
  };

  const zoomAt = (factor: number) => {
    setView(v => {
      const ns = clampScale(v.scale * factor);
      const ax = size.w / 2;
      const ay = size.h / 2;
      const wx = (ax - v.tx) / v.scale;
      const wy = (ay - v.ty) / v.scale;
      return { scale: ns, tx: ax - wx * ns, ty: ay - wy * ns };
    });
  };
  const zoomIn = () => zoomAt(1.4);
  const zoomOut = () => zoomAt(1 / 1.4);
  const resetView = () => setView({ scale: 1, tx: 0, ty: 0 });

  return (
    <div className="sketch-root">
      <div className="sketch-pane">
        <div className="sketch-toolbar">
          {onClose && (
            <>
              <button className="sk-btn sk-back" onClick={onClose} title={t('戻る')}>
                <ArrowLeft size={16} />
              </button>
              <div className="sk-divider" />
            </>
          )}
          <button
            className={`sk-btn ${tool === 'pen' ? 'active' : ''}`}
            onClick={() => setTool('pen')}
            title={t('ペン')}
          >
            <Pencil size={16} />
          </button>
          <button
            className={`sk-btn ${tool === 'eraser' ? 'active' : ''}`}
            onClick={() => setTool('eraser')}
            title={t('消しゴム')}
          >
            <Eraser size={16} />
          </button>
          <div className="sk-divider" />
          <div className="sk-colors">
            {PEN_COLORS.map(c => (
              <button
                key={c}
                className={`sk-color ${color === c ? 'active' : ''}`}
                style={{ background: c }}
                onClick={() => { setColor(c); setTool('pen'); }}
                aria-label={t('色 {c}', { c })}
              />
            ))}
          </div>
          <div className="sk-divider" />
          <div className="sk-widths">
            {PEN_WIDTHS.map(w => (
              <button
                key={w}
                className={`sk-width ${width === w ? 'active' : ''}`}
                onClick={() => { setWidth(w); setTool('pen'); }}
                aria-label={t('太さ {w}', { w })}
              >
                <span style={{ width: w * 2.2, height: w * 2.2, background: color }} />
              </button>
            ))}
          </div>
          <div className="sk-divider" />
          <button className="sk-btn" onClick={undo} title={t('一手戻す')}>
            <Undo2 size={16} />
          </button>
          <button className="sk-btn" onClick={redo} title={t('やり直し')}>
            <Redo2 size={16} />
          </button>
          <button className="sk-btn sk-danger" onClick={clearAll} title={t('全消去')}>
            <Trash2 size={16} />
          </button>
          <div className="sk-divider" />
          <button className="sk-btn" onClick={zoomOut} title={t('縮小')}>
            <ZoomOut size={16} />
          </button>
          <button className="sk-btn sk-label" onClick={resetView} title={t('表示倍率をリセット')}>
            {Math.round(view.scale * 100)}%
          </button>
          <button className="sk-btn" onClick={zoomIn} title={t('拡大')}>
            <ZoomIn size={16} />
          </button>
          <button className="sk-btn" onClick={resetView} title={t('全体表示')}>
            <Maximize size={16} />
          </button>
          <div className="sk-divider" />
          <button
            className={`sk-btn ${penOnly ? 'active' : ''}`}
            onClick={() => setPenOnly(v => !v)}
            title={penOnly ? t('ペン専用モード ON（指でスクロール）') : t('ペン専用モード OFF（指でも描画）')}
          >
            {penOnly ? <Hand size={16} /> : <Fingerprint size={16} />}
          </button>
        </div>
        <div className="sketch-canvas-wrap" ref={wrapRef}>
          <canvas
            ref={canvasRef}
            className="sketch-canvas"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={finishPointer}
            onPointerCancel={finishPointer}
            onPointerLeave={finishPointer}
          />
          <div className="sketch-hint">
            {penOnly
              ? t('ペンで描画 / 指でスクロール・ピンチズーム')
              : (tool === 'pen' ? t('指やペンで自由に描けます') : t('タップでストロークを消去'))}
          </div>
        </div>
      </div>

      <style jsx>{`
        .sketch-root {
          position: fixed;
          inset: 0;
          z-index: 1500;
          display: flex;
          flex-direction: column;
          background: var(--background);
          overflow: hidden;
          padding-top: env(safe-area-inset-top);
          padding-bottom: env(safe-area-inset-bottom);
          padding-left: env(safe-area-inset-left);
          padding-right: env(safe-area-inset-right);
        }
        .sketch-pane {
          flex: 1;
          display: flex;
          flex-direction: column;
          min-width: 0;
          min-height: 0;
        }
        .sketch-toolbar {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 8px 10px;
          background: var(--accent);
          border-bottom: 1px solid var(--border);
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
          scrollbar-width: none;
          flex-shrink: 0;
        }
        .sketch-toolbar::-webkit-scrollbar { display: none; }
        .sk-btn {
          background: var(--background);
          color: var(--foreground);
          padding: 6px 8px;
          border-radius: 8px;
          border: 1px solid transparent;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          font-size: 0.75rem;
          font-weight: 600;
          min-height: 32px;
        }
        .sk-btn.active {
          border-color: var(--primary);
          color: var(--primary);
        }
        .sk-btn.sk-back {
          color: var(--primary);
        }
        .sk-btn.sk-label {
          min-width: 50px;
        }
        .sk-btn.sk-danger {
          color: #ef4444;
        }
        .sk-divider {
          width: 1px;
          align-self: stretch;
          background: var(--border);
          flex-shrink: 0;
        }
        .sk-colors, .sk-widths {
          display: flex;
          gap: 6px;
          align-items: center;
          flex-shrink: 0;
        }
        .sk-color {
          width: 22px;
          height: 22px;
          border-radius: 50%;
          border: 2px solid transparent;
          padding: 0;
          flex-shrink: 0;
        }
        .sk-color.active {
          border-color: var(--foreground);
        }
        .sk-width {
          width: 30px;
          height: 30px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--background);
          border-radius: 8px;
          border: 1px solid transparent;
          flex-shrink: 0;
        }
        .sk-width.active {
          border-color: var(--primary);
        }
        .sk-width > span {
          display: block;
          border-radius: 50%;
        }
        .sketch-canvas-wrap {
          position: relative;
          flex: 1;
          min-height: 0;
          background: #fff;
          overflow: hidden;
        }
        .sketch-canvas {
          display: block;
          touch-action: none;
          width: 100%;
          height: 100%;
        }
        .sketch-hint {
          position: absolute;
          left: 12px;
          bottom: 8px;
          font-size: 0.7rem;
          color: #888;
          pointer-events: none;
          background: rgba(255,255,255,0.65);
          padding: 4px 8px;
          border-radius: 6px;
        }
        :global([data-theme='dark']) .sketch-hint {
          background: rgba(0,0,0,0.55);
          color: #ddd;
        }
      `}</style>
    </div>
  );
}
