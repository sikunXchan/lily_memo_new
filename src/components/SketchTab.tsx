'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Pencil, Eraser, Undo2, Redo2, Trash2, ZoomIn, ZoomOut, Maximize,
  SplitSquareHorizontal, X, FileText, BookOpen, ArrowLeft,
} from 'lucide-react';
import { db } from '@/lib/db';

const NoteEditor = dynamic(() => import('./NoteEditor'), { ssr: false });
const PDFViewer = dynamic(() => import('./PDFViewer'), { ssr: false });

interface SketchTabProps {
  isMobile: boolean;
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
const ERASER_RADIUS = 12; // CSS px radius for hit detection on stroke points

type SidePanelMode = 'memo-list' | 'memo-open' | 'pdf';

export default function SketchTab({ isMobile }: SketchTabProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const [tool, setTool] = useState<'pen' | 'eraser'>('pen');
  const [color, setColor] = useState(PEN_COLORS[0]);
  const [width, setWidth] = useState(PEN_WIDTHS[1]);
  const [view, setView] = useState<View>({ scale: 1, tx: 0, ty: 0 });

  const strokesRef = useRef<Stroke[]>([]);
  const redoRef = useRef<Stroke[]>([]);
  const currentRef = useRef<Stroke | null>(null);

  // Pointer state
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const drawingRef = useRef<{ pointerId: number; moved: boolean } | null>(null);
  const panRef = useRef<{ initial: View; startX: number; startY: number } | null>(null);
  const pinchRef = useRef<{ initial: View; dist: number; center: { x: number; y: number } } | null>(null);

  // Split screen
  const [splitOpen, setSplitOpen] = useState(false);
  const [splitRatio, setSplitRatio] = useState(0.55); // left (canvas) fraction
  const [sidePanel, setSidePanel] = useState<SidePanelMode>('memo-list');
  const [openNoteId, setOpenNoteId] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const notesList = useLiveQuery(() =>
    db.notes.filter(n => !n.deletedAt && n.type !== 'handwriting').toArray()
  );

  // --- Resizing canvas with container ---
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
  }, [splitOpen, splitRatio]);

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

    // Apply view transform
    ctx.translate(view.tx, view.ty);
    ctx.scale(view.scale, view.scale);

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

  // --- Coordinate helpers ---
  const toWorld = (px: number, py: number) => ({
    x: (px - view.tx) / view.scale,
    y: (py - view.ty) / view.scale,
  });

  const clampScale = (s: number) => Math.max(MIN_SCALE, Math.min(MAX_SCALE, s));

  // --- Wheel zoom ---
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

  // --- Pointer handlers ---
  const localPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const cnv = e.currentTarget;
    cnv.setPointerCapture(e.pointerId);
    const p = localPoint(e);
    pointersRef.current.set(e.pointerId, p);

    // Two-finger → pinch (cancel any in-progress draw)
    if (pointersRef.current.size === 2) {
      if (drawingRef.current) {
        currentRef.current = null;
        drawingRef.current = null;
      }
      const pts = Array.from(pointersRef.current.values());
      const dx = pts[0].x - pts[1].x;
      const dy = pts[0].y - pts[1].y;
      pinchRef.current = {
        initial: view,
        dist: Math.hypot(dx, dy),
        center: { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 },
      };
      panRef.current = null;
      return;
    }

    // Single finger / mouse:
    // - Mouse middle button or shift held → pan.
    // - Touch / pen / left mouse button → draw.
    const isPanGesture = e.button === 1 || e.shiftKey;
    if (isPanGesture) {
      panRef.current = { initial: view, startX: p.x, startY: p.y };
      return;
    }

    // Begin draw
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
    pointersRef.current.set(e.pointerId, p);

    // Pinch
    if (pinchRef.current && pointersRef.current.size === 2) {
      const pts = Array.from(pointersRef.current.values());
      const dx = pts[0].x - pts[1].x;
      const dy = pts[0].y - pts[1].y;
      const dist = Math.hypot(dx, dy);
      const center = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      const { initial } = pinchRef.current;
      const ratio = dist / pinchRef.current.dist;
      const nextScale = clampScale(initial.scale * ratio);
      // Anchor at the pinch midpoint, but also let the midpoint drift to translate.
      const wx = (pinchRef.current.center.x - initial.tx) / initial.scale;
      const wy = (pinchRef.current.center.y - initial.ty) / initial.scale;
      const tx = center.x - wx * nextScale;
      const ty = center.y - wy * nextScale;
      setView({ scale: nextScale, tx, ty });
      return;
    }

    // Pan
    if (panRef.current) {
      const { initial, startX, startY } = panRef.current;
      setView({ scale: initial.scale, tx: initial.tx + (p.x - startX), ty: initial.ty + (p.y - startY) });
      return;
    }

    // Drawing
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

    if (pointersRef.current.size < 2) {
      pinchRef.current = null;
    }

    if (panRef.current && pointersRef.current.size === 0) {
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
    if (!confirm('落書きをすべて消去しますか？')) return;
    strokesRef.current = [];
    redoRef.current = [];
    redraw();
  };

  const zoomIn = () => {
    setView(v => {
      const ns = clampScale(v.scale * 1.4);
      const ax = size.w / 2;
      const ay = size.h / 2;
      const wx = (ax - v.tx) / v.scale;
      const wy = (ay - v.ty) / v.scale;
      return { scale: ns, tx: ax - wx * ns, ty: ay - wy * ns };
    });
  };
  const zoomOut = () => {
    setView(v => {
      const ns = clampScale(v.scale / 1.4);
      const ax = size.w / 2;
      const ay = size.h / 2;
      const wx = (ax - v.tx) / v.scale;
      const wy = (ay - v.ty) / v.scale;
      return { scale: ns, tx: ax - wx * ns, ty: ay - wy * ns };
    });
  };
  const resetView = () => setView({ scale: 1, tx: 0, ty: 0 });

  // --- Split screen divider drag ---
  const dividerDragRef = useRef<{ startX: number; startRatio: number } | null>(null);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const root = rootRef.current;
      if (!dividerDragRef.current || !root) return;
      const rect = root.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const ratio = Math.max(0.2, Math.min(0.8, x / rect.width));
      setSplitRatio(ratio);
    };
    const onUp = () => { dividerDragRef.current = null; };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, []);

  const onDividerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    dividerDragRef.current = { startX: e.clientX, startRatio: splitRatio };
  };

  const toggleSplit = () => {
    setSplitOpen(v => !v);
    setSidePanel('memo-list');
    setOpenNoteId(null);
  };

  return (
    <div className="sketch-root" ref={rootRef}>
      <div
        className="sketch-pane"
        style={splitOpen && !isMobile ? { width: `${splitRatio * 100}%` } : undefined}
      >
        <div className="sketch-toolbar">
          <button
            className={`sk-btn ${tool === 'pen' ? 'active' : ''}`}
            onClick={() => setTool('pen')}
            title="ペン"
          >
            <Pencil size={16} />
          </button>
          <button
            className={`sk-btn ${tool === 'eraser' ? 'active' : ''}`}
            onClick={() => setTool('eraser')}
            title="消しゴム"
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
                aria-label={`色 ${c}`}
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
                aria-label={`太さ ${w}`}
              >
                <span style={{ width: w * 2.2, height: w * 2.2, background: color }} />
              </button>
            ))}
          </div>
          <div className="sk-divider" />
          <button className="sk-btn" onClick={undo} title="一手戻す">
            <Undo2 size={16} />
          </button>
          <button className="sk-btn" onClick={redo} title="やり直し">
            <Redo2 size={16} />
          </button>
          <button className="sk-btn sk-danger" onClick={clearAll} title="全消去">
            <Trash2 size={16} />
          </button>
          <div className="sk-divider" />
          <button className="sk-btn" onClick={zoomOut} title="縮小">
            <ZoomOut size={16} />
          </button>
          <button className="sk-btn sk-label" onClick={resetView} title="表示倍率をリセット">
            {Math.round(view.scale * 100)}%
          </button>
          <button className="sk-btn" onClick={zoomIn} title="拡大">
            <ZoomIn size={16} />
          </button>
          <button className="sk-btn" onClick={resetView} title="全体表示">
            <Maximize size={16} />
          </button>
          {!isMobile && (
            <>
              <div className="sk-divider" />
              <button
                className={`sk-btn ${splitOpen ? 'active' : ''}`}
                onClick={toggleSplit}
                title={splitOpen ? '画面分割を閉じる' : 'メモやPDFを横に開く'}
              >
                <SplitSquareHorizontal size={16} />
              </button>
            </>
          )}
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
            {tool === 'pen' ? '指やペンで自由に描けます' : 'タップでストロークを消去'}
            <span className="sketch-hint-sub">・ 二本指でピンチズーム / Shift+ドラッグで移動</span>
          </div>
        </div>
      </div>

      {splitOpen && !isMobile && (
        <>
          <div
            className="sketch-divider"
            onPointerDown={onDividerDown}
            role="separator"
            aria-orientation="vertical"
            aria-label="パネルの幅を調整"
          />
          <div className="sketch-side" style={{ width: `${(1 - splitRatio) * 100}%` }}>
            <div className="side-tabs">
              <button
                className={`side-tab ${sidePanel !== 'pdf' ? 'active' : ''}`}
                onClick={() => { setSidePanel('memo-list'); setOpenNoteId(null); }}
              >
                <BookOpen size={14} />
                <span>メモ</span>
              </button>
              <button
                className={`side-tab ${sidePanel === 'pdf' ? 'active' : ''}`}
                onClick={() => { setSidePanel('pdf'); setOpenNoteId(null); }}
              >
                <FileText size={14} />
                <span>PDF</span>
              </button>
              <button className="side-close" onClick={() => setSplitOpen(false)} title="閉じる">
                <X size={16} />
              </button>
            </div>
            <div className="side-body">
              {sidePanel === 'pdf' ? (
                <PDFViewer />
              ) : openNoteId ? (
                <div className="side-note-host">
                  <button className="side-back" onClick={() => setOpenNoteId(null)}>
                    <ArrowLeft size={14} />
                    <span>一覧に戻る</span>
                  </button>
                  <div className="side-note-body">
                    <NoteEditor noteId={openNoteId} onClose={() => setOpenNoteId(null)} />
                  </div>
                </div>
              ) : (
                <div className="side-note-list">
                  {(notesList ?? []).length === 0 && (
                    <div className="side-empty">メモがありません</div>
                  )}
                  {(notesList ?? []).map(n => (
                    <button
                      key={n.id}
                      className="side-note-item"
                      onClick={() => { setSidePanel('memo-open'); setOpenNoteId(n.id!); }}
                    >
                      <BookOpen size={14} />
                      <span>{n.title || '無題のメモ'}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      <style jsx>{`
        .sketch-root {
          flex: 1;
          display: flex;
          flex-direction: row;
          height: 100%;
          min-height: 0;
          background: var(--background);
          overflow: hidden;
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
        }
        .sk-btn.active {
          border-color: var(--primary);
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
        .sketch-hint-sub {
          margin-left: 6px;
          opacity: 0.7;
        }
        :global([data-theme='dark']) .sketch-hint {
          background: rgba(0,0,0,0.55);
          color: #ddd;
        }

        .sketch-divider {
          width: 6px;
          cursor: col-resize;
          background: var(--border);
          flex-shrink: 0;
          touch-action: none;
        }
        .sketch-divider:hover {
          background: var(--primary);
          opacity: 0.6;
        }

        .sketch-side {
          display: flex;
          flex-direction: column;
          min-width: 0;
          min-height: 0;
          background: var(--background);
          border-left: 1px solid var(--border);
        }
        .side-tabs {
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 6px 8px;
          border-bottom: 1px solid var(--border);
          background: var(--accent);
          flex-shrink: 0;
        }
        .side-tab {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 6px 10px;
          background: transparent;
          color: var(--foreground);
          border-radius: 8px;
          font-size: 0.8rem;
          font-weight: 600;
          opacity: 0.65;
        }
        .side-tab.active {
          background: var(--background);
          color: var(--primary);
          opacity: 1;
        }
        .side-close {
          margin-left: auto;
          background: transparent;
          color: var(--foreground);
          padding: 4px;
          border-radius: 6px;
        }
        .side-body {
          flex: 1;
          min-height: 0;
          display: flex;
          flex-direction: column;
          position: relative;
          overflow: hidden;
        }
        .side-note-list {
          flex: 1;
          overflow-y: auto;
          padding: 8px;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .side-note-item {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 10px;
          border-radius: 8px;
          background: transparent;
          color: var(--foreground);
          font-size: 0.85rem;
          text-align: left;
        }
        .side-note-item:hover {
          background: var(--accent);
        }
        .side-empty {
          padding: 16px;
          font-size: 0.8rem;
          color: #888;
          text-align: center;
        }
        .side-note-host {
          flex: 1;
          display: flex;
          flex-direction: column;
          min-height: 0;
          position: relative;
        }
        .side-back {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 6px 10px;
          font-size: 0.75rem;
          font-weight: 600;
          background: var(--accent);
          color: var(--primary);
          border-radius: 8px;
          margin: 8px;
          align-self: flex-start;
        }
        .side-note-body {
          flex: 1;
          min-height: 0;
          position: relative;
          overflow: hidden;
        }
        /* NoteEditor uses position:fixed in its mobile/header CSS; constrain
           it to this panel by overriding to absolute within the body. */
        .side-note-body :global(.editor-container) {
          position: absolute !important;
          inset: 0;
          width: 100% !important;
          height: 100% !important;
          z-index: auto !important;
        }
        .side-note-body :global(.editor-header) {
          position: absolute !important;
          left: 0 !important;
          right: 0 !important;
        }
      `}</style>
    </div>
  );
}
