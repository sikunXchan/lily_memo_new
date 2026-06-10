'use client';

import { NodeViewWrapper } from '@tiptap/react';
import { translate } from '@/lib/i18n';
import type { ReactNodeViewProps } from '@tiptap/react';
import { useState, useEffect, useRef, useCallback, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { Eraser, Pencil, Undo2, Trash2, Hand, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import type { HandwritingStroke } from '@/lib/db';

const PAGE_W = 1280;
const PAGE_H = 900;
const PEN_COLORS = ['#1a1a1a', '#e94e77', '#3273dc', '#23a55a', '#f5a623', '#9b59b6'];
const PEN_WIDTHS = [1.5, 3, 6];

interface PageData { strokes: HandwritingStroke[]; }
interface BlockData { pages: PageData[]; width: number; height: number; }

function parseBlockData(raw: string): BlockData {
  try {
    const p = JSON.parse(raw || '{}');
    if (Array.isArray(p.pages)) return p as BlockData;
    if (Array.isArray(p.strokes)) {
      return { pages: [{ strokes: p.strokes }], width: PAGE_W, height: PAGE_H };
    }
  } catch {}
  return { pages: [{ strokes: [] }], width: PAGE_W, height: PAGE_H };
}

function drawPageBackground(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = '#fdf9f0';
  ctx.fillRect(0, 0, w, h);
  ctx.save();
  ctx.strokeStyle = 'rgba(150, 190, 255, 0.55)';
  ctx.lineWidth = 1;
  for (let y = 36; y < h; y += 36) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(255, 130, 130, 0.45)';
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(72, 0); ctx.lineTo(72, h); ctx.stroke();
  ctx.restore();
}

function drawStrokeBezier(ctx: CanvasRenderingContext2D, stroke: HandwritingStroke) {
  const pts = stroke.points;
  if (!pts.length) return;
  ctx.strokeStyle = stroke.color;
  ctx.lineWidth = stroke.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
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

// ---- NotebookEditor: pure canvas drawing surface ----
interface NotebookEditorProps {
  pages: PageData[];
  currentPage: number;
  tool: 'pen' | 'eraser';
  color: string;
  penWidth: number;
  pencilOnly: boolean;
  onStrokeEnd: (strokes: HandwritingStroke[]) => void;
}

function NotebookEditor({ pages, currentPage, tool, color, penWidth, pencilOnly, onStrokeEnd }: NotebookEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const pageRef = useRef<PageData>(pages[currentPage]);
  const currentStrokeRef = useRef<HandwritingStroke | null>(null);
  const isDrawingRef = useRef(false);
  const pointerIdRef = useRef<number | null>(null);
  // Keep latest props in refs to avoid stale closures in pointer handlers
  const toolRef = useRef(tool);
  const colorRef = useRef(color);
  const penWidthRef = useRef(penWidth);
  const pencilOnlyRef = useRef(pencilOnly);
  const onStrokeEndRef = useRef(onStrokeEnd);
  useEffect(() => { toolRef.current = tool; }, [tool]);
  useEffect(() => { colorRef.current = color; }, [color]);
  useEffect(() => { penWidthRef.current = penWidth; }, [penWidth]);
  useEffect(() => { pencilOnlyRef.current = pencilOnly; }, [pencilOnly]);
  useEffect(() => { onStrokeEndRef.current = onStrokeEnd; }, [onStrokeEnd]);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const apply = () => {
      const { width } = el.getBoundingClientRect();
      if (width > 0) setContainerWidth(width);
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const displayH = containerWidth > 0 ? Math.round(PAGE_H * containerWidth / PAGE_W) : 0;

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = PAGE_W * dpr;
    canvas.height = PAGE_H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawPageBackground(ctx, PAGE_W, PAGE_H);
    for (const stroke of pageRef.current.strokes) drawStrokeBezier(ctx, stroke);
    if (currentStrokeRef.current) drawStrokeBezier(ctx, currentStrokeRef.current);
  }, []);

  useEffect(() => {
    pageRef.current = pages[currentPage];
    currentStrokeRef.current = null;
    isDrawingRef.current = false;
    pointerIdRef.current = null;
    redraw();
  }, [pages, currentPage, redraw]);

  useEffect(() => {
    if (containerWidth > 0) redraw();
  }, [containerWidth, redraw]);

  const toPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * PAGE_W,
      y: ((e.clientY - rect.top) / rect.height) * PAGE_H,
    };
  };

  const eraseAt = (x: number, y: number) => {
    const page = pageRef.current;
    const next = page.strokes.filter(s =>
      !s.points.some(p => Math.hypot(p.x - x, p.y - y) <= 8 + s.width / 2)
    );
    if (next.length !== page.strokes.length) {
      pageRef.current = { strokes: next };
      onStrokeEndRef.current(next);
      redraw();
    }
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (pencilOnlyRef.current && e.pointerType !== 'pen') return;
    e.preventDefault();
    canvasRef.current?.setPointerCapture(e.pointerId);
    pointerIdRef.current = e.pointerId;
    isDrawingRef.current = true;
    const p = toPoint(e);
    if (toolRef.current === 'eraser') { eraseAt(p.x, p.y); return; }
    currentStrokeRef.current = { points: [p], color: colorRef.current, width: penWidthRef.current };
    redraw();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (pencilOnlyRef.current && e.pointerType !== 'pen') return;
    if (!isDrawingRef.current || pointerIdRef.current !== e.pointerId) return;
    const p = toPoint(e);
    if (toolRef.current === 'eraser') { eraseAt(p.x, p.y); return; }
    const cs = currentStrokeRef.current;
    if (!cs) return;
    const last = cs.points[cs.points.length - 1];
    if (last && Math.hypot(last.x - p.x, last.y - p.y) < 0.8) return;
    cs.points.push(p);
    redraw();
  };

  const onPointerUp = () => {
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;
    pointerIdRef.current = null;
    const cs = currentStrokeRef.current;
    currentStrokeRef.current = null;
    if (cs && cs.points.length > 0) {
      const nextStrokes = [...pageRef.current.strokes, cs];
      pageRef.current = { strokes: nextStrokes };
      onStrokeEndRef.current(nextStrokes);
      redraw();
    }
  };

  return (
    <div
      ref={containerRef}
      style={{ flex: 1, display: 'flex', alignItems: 'flex-start', background: '#e8e0d0', overflow: 'hidden' }}
    >
      {containerWidth > 0 && (
        <canvas
          ref={canvasRef}
          style={{
            display: 'block',
            width: containerWidth,
            height: displayH,
            touchAction: pencilOnly ? 'pan-y' : 'none',
            boxShadow: '0 4px 28px rgba(0,0,0,0.14), 0 0 0 1px rgba(0,0,0,0.06)',
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={onPointerUp}
        />
      )}
    </div>
  );
}

// ---- Preview ----
function drawPreview(canvas: HTMLCanvasElement, pages: PageData[]) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 300;
  const h = canvas.clientHeight || Math.round(w * PAGE_H / PAGE_W);
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.scale(dpr, dpr);
  const scale = w / PAGE_W;

  ctx.fillStyle = '#fdf9f0';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(150, 190, 255, 0.55)';
  ctx.lineWidth = 1;
  for (let y = 36 * scale; y < h; y += 36 * scale) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(255, 130, 130, 0.45)';
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(72 * scale, 0); ctx.lineTo(72 * scale, h); ctx.stroke();

  const n = pages.length;
  ctx.fillStyle = '#c4b898';
  ctx.font = `${Math.max(9, 13 * scale)}px sans-serif`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillText(`1 / ${n}`, w - 6, h - 4);

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const stroke of (pages[0]?.strokes ?? [])) {
    const pts = stroke.points;
    if (!pts.length) continue;
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = Math.max(stroke.width * scale, 0.5);
    ctx.beginPath();
    ctx.moveTo(pts[0].x * scale, pts[0].y * scale);
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i].x + pts[i + 1].x) / 2 * scale;
      const my = (pts[i].y + pts[i + 1].y) / 2 * scale;
      ctx.quadraticCurveTo(pts[i].x * scale, pts[i].y * scale, mx, my);
    }
    if (pts.length > 1) ctx.lineTo(pts[pts.length - 1].x * scale, pts[pts.length - 1].y * scale);
    ctx.stroke();
  }
}

// ---- HandwritingBlock (main) ----
export default function HandwritingBlock({ node, updateAttributes, selected }: ReactNodeViewProps) {
  const [data, setData] = useState<BlockData>(() => parseBlockData(node.attrs.data || '{}'));
  const [editing, setEditing] = useState(false);
  const [currentPage, setCurrentPage] = useState(0);
  const [tool, setTool] = useState<'pen' | 'eraser'>('pen');
  const [color, setColor] = useState(PEN_COLORS[0]);
  const [penWidth, setPenWidth] = useState(PEN_WIDTHS[1]);
  const [pencilOnly, setPencilOnly] = useState(false);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const currentPageRef = useRef(currentPage);
  useEffect(() => { currentPageRef.current = currentPage; }, [currentPage]);

  const totalPages = data.pages.length;
  const isEmpty = data.pages.every(p => p.strokes.length === 0);

  useEffect(() => {
    if (!previewRef.current || isEmpty) return;
    const id = requestAnimationFrame(() => {
      if (previewRef.current) drawPreview(previewRef.current, data.pages);
    });
    return () => cancelAnimationFrame(id);
  }, [data, isEmpty]);

  const handleStrokeEnd = useCallback((strokes: HandwritingStroke[]) => {
    const cp = currentPageRef.current;
    setData(prev => {
      const newPages = prev.pages.map((p, i) => i === cp ? { strokes } : p);
      const next = { ...prev, pages: newPages };
      updateAttributes({ data: JSON.stringify(next) });
      return next;
    });
  }, [updateAttributes]);

  const undo = useCallback(() => {
    const cp = currentPageRef.current;
    setData(prev => {
      const page = prev.pages[cp];
      if (!page?.strokes.length) return prev;
      const newPages = prev.pages.map((p, i) =>
        i === cp ? { strokes: p.strokes.slice(0, -1) } : p
      );
      const next = { ...prev, pages: newPages };
      updateAttributes({ data: JSON.stringify(next) });
      return next;
    });
  }, [updateAttributes]);

  const clearPage = () => {
    const cp = currentPageRef.current;
    if (!data.pages[cp]?.strokes.length) return;
    if (!confirm(translate('このページを全消去しますか？'))) return;
    setData(prev => {
      const newPages = prev.pages.map((p, i) =>
        i === cp ? { strokes: [] as HandwritingStroke[] } : p
      );
      const next = { ...prev, pages: newPages };
      updateAttributes({ data: JSON.stringify(next) });
      return next;
    });
  };

  const addPage = () => {
    const newIdx = data.pages.length;
    setData(prev => {
      const next = { ...prev, pages: [...prev.pages, { strokes: [] as HandwritingStroke[] }] };
      updateAttributes({ data: JSON.stringify(next) });
      return next;
    });
    setCurrentPage(newIdx);
  };

  return (
    <NodeViewWrapper contentEditable={false}>
      <div
        className={`hw-block${selected ? ' hw-selected' : ''}`}
        onClick={() => setEditing(true)}
      >
        {isEmpty ? (
          <div className="hw-empty-wrap">
            <div className="hw-empty">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#b0a890" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
              </svg>
              <span>{translate('タップして手書き')}</span>
            </div>
          </div>
        ) : (
          <canvas
            ref={previewRef}
            style={{ width: '100%', aspectRatio: `${PAGE_W} / ${PAGE_H}`, display: 'block' }}
          />
        )}
      </div>

      {editing && typeof document !== 'undefined' && createPortal(
        <div className="nb-fullscreen">
          <div className="nb-topbar">
            <button className="nb-done-btn" onClick={() => setEditing(false)}>✓ {translate('完了')}</button>
            <div className="nb-sep" />
            {/* Drawing tools */}
            <button className={`nb-btn ${tool === 'pen' ? 'active' : ''}`} onClick={() => setTool('pen')}>
              <Pencil size={16} />
            </button>
            <button className={`nb-btn ${tool === 'eraser' ? 'active' : ''}`} onClick={() => setTool('eraser')}>
              <Eraser size={16} />
            </button>
            <div className="nb-sep" />
            <div className="nb-colors">
              {PEN_COLORS.map(c => (
                <button
                  key={c}
                  className={`nb-color-btn ${color === c ? 'active' : ''}`}
                  style={{ background: c }}
                  onClick={() => { setColor(c); setTool('pen'); }}
                />
              ))}
            </div>
            <div className="nb-sep" />
            <div className="nb-widths">
              {PEN_WIDTHS.map(w => (
                <button
                  key={w}
                  className={`nb-width-btn ${penWidth === w ? 'active' : ''}`}
                  onClick={() => { setPenWidth(w); setTool('pen'); }}
                >
                  <span style={{ width: w * 2.5, height: w * 2.5, borderRadius: '50%', background: color, display: 'block' }} />
                </button>
              ))}
            </div>
            <div className="nb-sep" />
            <button className="nb-btn" onClick={undo}><Undo2 size={16} /></button>
            <button className="nb-btn" onClick={clearPage}><Trash2 size={16} /></button>
            <div className="nb-sep" />
            <button
              className={`nb-btn ${pencilOnly ? 'active' : ''}`}
              onClick={() => setPencilOnly(p => !p)}
              title={pencilOnly ? translate('Apple Pencil専用（指でスクロール）') : translate('全タッチ（指でも描ける）')}
            >
              <Hand size={16} />
            </button>
            {/* Page nav - pushed to right */}
            <div className="nb-spacer" />
            <div className="nb-pager">
              <button
                className="nb-page-btn"
                onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
                disabled={currentPage === 0}
              >
                <ChevronLeft size={18} />
              </button>
              <span className="nb-page-label">{currentPage + 1} / {totalPages}</span>
              <button
                className="nb-page-btn"
                onClick={() => setCurrentPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={currentPage === totalPages - 1}
              >
                <ChevronRight size={18} />
              </button>
              <div className="nb-sep" />
              <button className="nb-page-btn" onClick={addPage} title={translate('ページを追加')}>
                <Plus size={16} />
              </button>
            </div>
          </div>

          {/* Canvas area */}
          <div className="nb-canvas-area">
            <NotebookEditor
              pages={data.pages}
              currentPage={currentPage}
              tool={tool}
              color={color}
              penWidth={penWidth}
              pencilOnly={pencilOnly}
              onStrokeEnd={handleStrokeEnd}
            />
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
          background: #fdf9f0;
          user-select: none;
          box-shadow: 0 2px 8px rgba(0,0,0,0.07);
        }
        .hw-block:hover { border-color: var(--primary); box-shadow: 0 3px 12px rgba(0,0,0,0.11); }
        .hw-selected { border: 2px solid var(--primary); }
        .hw-empty-wrap {
          display: flex; align-items: center; justify-content: center;
          min-height: 80px; width: 100%;
        }
        .hw-empty {
          display: flex; flex-direction: column; align-items: center;
          gap: 6px; color: #b0a890; font-size: 0.85rem; padding: 24px;
        }
        /* Fullscreen notebook */
        .nb-fullscreen {
          position: fixed; inset: 0; z-index: 10000;
          background: #e8e0d0; display: flex; flex-direction: column;
        }
        .nb-topbar {
          display: flex; align-items: center; gap: 6px;
          padding: 8px 14px;
          padding-top: calc(8px + env(safe-area-inset-top));
          background: #fdf9f0; border-bottom: 1px solid #d6c9a8;
          flex-shrink: 0; overflow-x: auto;
          -webkit-overflow-scrolling: touch; scrollbar-width: none;
        }
        .nb-topbar::-webkit-scrollbar { display: none; }
        .nb-done-btn {
          background: var(--primary); color: #fff; border: none;
          border-radius: 10px; padding: 7px 18px;
          font-weight: 700; font-size: 0.88rem; cursor: pointer; flex-shrink: 0;
        }
        .nb-btn {
          display: flex; align-items: center; justify-content: center;
          width: 32px; height: 32px; border-radius: 8px;
          border: 1.5px solid transparent; background: transparent;
          cursor: pointer; flex-shrink: 0; color: #3a3a3a;
        }
        .nb-btn.active {
          border-color: var(--primary); color: var(--primary);
          background: rgba(120, 100, 200, 0.08);
        }
        .nb-sep { width: 1px; height: 22px; background: #d6c9a8; flex-shrink: 0; }
        .nb-spacer { flex: 1; min-width: 8px; }
        .nb-colors { display: flex; gap: 5px; flex-shrink: 0; }
        .nb-color-btn {
          width: 22px; height: 22px; border-radius: 50%;
          border: 2.5px solid transparent; padding: 0; cursor: pointer; flex-shrink: 0;
        }
        .nb-color-btn.active { border-color: #3a3a3a; transform: scale(1.15); }
        .nb-widths { display: flex; gap: 4px; flex-shrink: 0; }
        .nb-width-btn {
          width: 30px; height: 30px; border-radius: 8px;
          border: 1.5px solid transparent; background: transparent;
          display: flex; align-items: center; justify-content: center;
          cursor: pointer; flex-shrink: 0;
        }
        .nb-width-btn.active { border-color: var(--primary); }
        .nb-pager { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
        .nb-page-btn {
          display: flex; align-items: center; justify-content: center;
          width: 30px; height: 30px; border-radius: 8px;
          border: 1px solid #d6c9a8; background: #fff;
          cursor: pointer; color: #3a3a3a; flex-shrink: 0;
        }
        .nb-page-btn:disabled { opacity: 0.3; cursor: default; }
        .nb-page-label {
          font-size: 0.85rem; font-weight: 600; color: #5a5040;
          min-width: 46px; text-align: center; flex-shrink: 0;
        }
        .nb-canvas-area {
          flex: 1; min-height: 0; display: flex;
        }
      `}</style>
    </NodeViewWrapper>
  );
}
