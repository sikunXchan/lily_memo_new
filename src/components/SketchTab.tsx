'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Pencil, Eraser, Undo2, Redo2, Trash2, ZoomIn, ZoomOut, Maximize,
  PanelLeft, PanelTop, X, FileText, BookOpen, ArrowLeft, Hand, Fingerprint,
  FolderIcon, Sparkles,
} from 'lucide-react';
import { db } from '@/lib/db';

const NoteEditor = dynamic(() => import('./NoteEditor'), { ssr: false });
const PDFViewer = dynamic(() => import('./PDFViewer'), { ssr: false });

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
// Allow split UI on phones too. Below SPLIT_LEFT_MIN_WIDTH we only expose
// the top/bottom split (left/right would leave each pane too narrow).
const SPLIT_MIN_WIDTH = 360;
const SPLIT_LEFT_MIN_WIDTH = 700;

type SidePanelMode = 'memo-list' | 'memo-open' | 'pdf';

export default function SketchTab({ onClose }: SketchTabProps) {
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

  // Viewport sizing — used both for canvas size and for whether the split UI is allowed.
  const [viewport, setViewport] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const apply = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    apply();
    window.addEventListener('resize', apply);
    window.addEventListener('orientationchange', apply);
    return () => {
      window.removeEventListener('resize', apply);
      window.removeEventListener('orientationchange', apply);
    };
  }, []);
  const canSplit = viewport.w >= SPLIT_MIN_WIDTH;
  const canSplitLeft = viewport.w >= SPLIT_LEFT_MIN_WIDTH;

  // Split screen — user wants the side panel either on the LEFT or on TOP
  // (right was dropped since the pen-hand rests on the right edge).
  type SplitSide = 'left' | 'top';
  const [splitOpen, setSplitOpen] = useState(false);
  const [splitSide, setSplitSide] = useState<SplitSide>(() => {
    if (typeof window === 'undefined') return 'left';
    const saved = localStorage.getItem('sketchSplitSide');
    return saved === 'top' ? 'top' : 'left';
  });
  useEffect(() => {
    try { localStorage.setItem('sketchSplitSide', splitSide); } catch {}
  }, [splitSide]);
  // splitRatio = sketch-pane fraction of the total (preserves the original
  // "pane is 55%, side is 45%" default). Persisted across sessions so the
  // user's preferred size sticks.
  const [splitRatio, setSplitRatio] = useState<number>(() => {
    if (typeof window === 'undefined') return 0.55;
    const saved = parseFloat(localStorage.getItem('sketchSplitRatio') || '');
    return Number.isFinite(saved) && saved >= 0.2 && saved <= 0.85 ? saved : 0.55;
  });
  useEffect(() => {
    try { localStorage.setItem('sketchSplitRatio', String(splitRatio)); } catch {}
  }, [splitRatio]);
  const [sidePanel, setSidePanel] = useState<SidePanelMode>('memo-list');
  const [openNoteId, setOpenNoteId] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // If the persisted preference is 'left' but the viewport is now too
  // narrow for a side-by-side split, coerce to 'top' at render time.
  // (Derived, not stored — the user's preference is preserved for when
  // they're back on a wider screen.)
  const effectiveSplitSide: SplitSide = splitSide === 'left' && !canSplitLeft ? 'top' : splitSide;

  const notesList = useLiveQuery(() =>
    db.notes.filter(n => !n.deletedAt && n.type !== 'handwriting').toArray()
  );
  const foldersList = useLiveQuery(() =>
    db.folders.filter(f => !f.deletedAt).toArray()
  );

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
    if (!confirm('落書きをすべて消去しますか？')) return;
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

  // --- Split divider drag (use pointer capture on the divider itself
  // so iPad touch events keep firing on it). ---
  const dividerDragRef = useRef<{ pointerId: number } | null>(null);

  const onDividerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    dividerDragRef.current = { pointerId: e.pointerId };
  };

  const onDividerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dividerDragRef.current || dividerDragRef.current.pointerId !== e.pointerId) return;
    const root = rootRef.current;
    if (!root) return;
    const rect = root.getBoundingClientRect();
    // Side panel is the FIRST child (left or top). The divider position from
    // the start of the container equals the side panel's size. splitRatio is
    // the sketch-pane fraction, so it's 1 - sideFraction.
    const sideFrac = effectiveSplitSide === 'top'
      ? (e.clientY - rect.top) / rect.height
      : (e.clientX - rect.left) / rect.width;
    const next = 1 - sideFrac;
    setSplitRatio(Math.max(0.2, Math.min(0.85, next)));
  };

  const onDividerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    if (dividerDragRef.current && dividerDragRef.current.pointerId === e.pointerId) {
      dividerDragRef.current = null;
    }
  };

  const openSplit = (side: SplitSide) => {
    if (splitOpen && splitSide === side) {
      setSplitOpen(false);
      return;
    }
    setSplitSide(side);
    setSplitOpen(true);
    setSidePanel('memo-list');
    setOpenNoteId(null);
  };

  const splitActive = splitOpen && canSplit;

  const openNoteInSide = (id: number) => {
    setSidePanel('memo-open');
    setOpenNoteId(id);
  };

  // Build the memo picker: notes grouped by folder. Modern card-style list
  // — no search, no per-section counts (kept intentionally minimal so the
  // side panel doesn't compete with the sketch canvas for attention).
  const renderNotePicker = () => {
    const allNotes = notesList ?? [];
    const allFolders = foldersList ?? [];

    if (allNotes.length === 0) {
      return (
        <div className="side-empty-wrap">
          <div className="side-empty-icon">
            <Sparkles size={28} />
          </div>
          <div className="side-empty-title">メモがまだありません</div>
          <div className="side-empty-sub">メモタブから作成できます</div>
        </div>
      );
    }

    // Group: folderId -> notes
    const byFolder = new Map<number | 'none', typeof allNotes>();
    for (const n of allNotes) {
      const key: number | 'none' = (n.folderId != null && allFolders.some(f => f.id === n.folderId)) ? n.folderId : 'none';
      const arr = byFolder.get(key) ?? [];
      arr.push(n);
      byFolder.set(key, arr);
    }

    const sections: Array<{ key: string; label: string; color?: string; notes: typeof allNotes }> = [];
    for (const f of allFolders) {
      const ns = byFolder.get(f.id!);
      if (ns && ns.length > 0) {
        sections.push({ key: `f-${f.id}`, label: f.name, color: f.color, notes: ns });
      }
    }
    const orphans = byFolder.get('none');
    if (orphans && orphans.length > 0) {
      sections.push({ key: 'none', label: '未分類', notes: orphans });
    }

    return (
      <div className="side-note-list">
        {sections.map(sec => (
          <div key={sec.key} className="side-section">
            <div className="side-section-header">
              {sec.color ? (
                <span className="side-folder-dot" style={{ background: `var(${sec.color})` }} />
              ) : (
                <FolderIcon size={12} className="side-folder-dim" />
              )}
              <span>{sec.label}</span>
            </div>
            <div className="side-section-items">
              {sec.notes.map(n => (
                <button
                  key={n.id}
                  className="side-note-item"
                  onClick={() => openNoteInSide(n.id!)}
                >
                  <span className="side-note-icon-wrap">
                    <BookOpen size={14} />
                  </span>
                  <span className="side-note-title">{n.title || '無題のメモ'}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  };

  const paneStyle = splitActive
    ? (effectiveSplitSide === 'top'
        ? { height: `${splitRatio * 100}%` }
        : { width: `${splitRatio * 100}%` })
    : undefined;
  const sideStyle = effectiveSplitSide === 'top'
    ? { height: `${(1 - splitRatio) * 100}%` }
    : { width: `${(1 - splitRatio) * 100}%` };

  // Side panel + divider rendered BEFORE the sketch-pane so the side panel
  // sits on the left (in row mode) or on the top (in column mode).
  const splitBlock = splitActive && (
    <>
      <div className="sketch-side" style={sideStyle}>
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
            <PDFViewer embedded />
          ) : openNoteId ? (
            <div className="side-note-host">
              <button className="side-back" onClick={() => setOpenNoteId(null)}>
                <ArrowLeft size={14} />
                <span>一覧に戻る</span>
              </button>
              <div className="side-note-body">
                <NoteEditor noteId={openNoteId} onClose={() => setOpenNoteId(null)} embedded />
              </div>
            </div>
          ) : (
            <div className="side-picker">
              {renderNotePicker()}
            </div>
          )}
        </div>
      </div>
      <div
        className="sketch-divider"
        onPointerDown={onDividerDown}
        onPointerMove={onDividerMove}
        onPointerUp={onDividerUp}
        onPointerCancel={onDividerUp}
        role="separator"
        aria-orientation={effectiveSplitSide === 'top' ? 'horizontal' : 'vertical'}
        aria-label="パネルのサイズを調整"
      />
    </>
  );

  return (
    <div
      className={`sketch-root ${splitActive ? `split-${effectiveSplitSide}` : ''}`}
      ref={rootRef}
    >
      {splitBlock}
      <div
        className="sketch-pane"
        style={paneStyle}
      >
        <div className="sketch-toolbar">
          {onClose && (
            <>
              <button className="sk-btn sk-back" onClick={onClose} title="戻る">
                <ArrowLeft size={16} />
              </button>
              <div className="sk-divider" />
            </>
          )}
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
          <div className="sk-divider" />
          <button
            className={`sk-btn ${penOnly ? 'active' : ''}`}
            onClick={() => setPenOnly(v => !v)}
            title={penOnly ? 'ペン専用モード ON（指でスクロール）' : 'ペン専用モード OFF（指でも描画）'}
          >
            {penOnly ? <Hand size={16} /> : <Fingerprint size={16} />}
          </button>
          {canSplit && (
            <>
              <div className="sk-divider" />
              {canSplitLeft && (
                <button
                  className={`sk-btn ${splitOpen && effectiveSplitSide === 'left' ? 'active' : ''}`}
                  onClick={() => openSplit('left')}
                  title="左にメモ/PDFを開く"
                >
                  <PanelLeft size={16} />
                </button>
              )}
              <button
                className={`sk-btn ${splitOpen && effectiveSplitSide === 'top' ? 'active' : ''}`}
                onClick={() => openSplit('top')}
                title="上にメモ/PDFを開く"
              >
                <PanelTop size={16} />
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
            {penOnly
              ? 'ペンで描画 / 指でスクロール・ピンチズーム'
              : (tool === 'pen' ? '指やペンで自由に描けます' : 'タップでストロークを消去')}
          </div>
        </div>
      </div>

      <style jsx>{`
        .sketch-root {
          position: fixed;
          inset: 0;
          z-index: 1500;
          display: flex;
          flex-direction: row;
          background: var(--background);
          overflow: hidden;
          padding-top: env(safe-area-inset-top);
          padding-bottom: env(safe-area-inset-bottom);
          padding-left: env(safe-area-inset-left);
          padding-right: env(safe-area-inset-right);
        }
        .sketch-root.split-top {
          flex-direction: column;
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

        .sketch-divider {
          background: var(--border);
          flex-shrink: 0;
          touch-action: none;
          position: relative;
        }
        .split-left .sketch-divider {
          width: 10px;
          cursor: col-resize;
        }
        .split-top .sketch-divider {
          height: 10px;
          cursor: row-resize;
        }
        .sketch-divider::after {
          content: '';
          position: absolute;
          left: 50%;
          top: 50%;
          transform: translate(-50%, -50%);
          background: var(--primary);
          border-radius: 2px;
          opacity: 0.45;
        }
        .split-left .sketch-divider::after {
          width: 3px;
          height: 32px;
        }
        .split-top .sketch-divider::after {
          width: 32px;
          height: 3px;
        }
        .sketch-divider:hover::after {
          opacity: 0.9;
        }

        .sketch-side {
          display: flex;
          flex-direction: column;
          min-width: 0;
          min-height: 0;
          background: var(--background);
          /* Forces this element to become the containing block for any
             position:fixed descendants (NoteEditor's editor-container /
             editor-header use position:fixed on mobile). Without this,
             those descendants escape to the viewport and cover the
             whole sketch, breaking the split layout. */
          transform: translateZ(0);
        }
        .split-left .sketch-side {
          border-right: 1px solid var(--border);
        }
        .split-top .sketch-side {
          border-bottom: 1px solid var(--border);
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
        .side-picker {
          flex: 1;
          display: flex;
          flex-direction: column;
          min-height: 0;
        }
        .side-note-list {
          flex: 1;
          overflow-y: auto;
          -webkit-overflow-scrolling: touch;
          padding: 12px 12px 18px;
          display: flex;
          flex-direction: column;
          gap: 18px;
        }
        .side-section {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .side-section-header {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 0 4px;
          font-size: 0.72rem;
          font-weight: 700;
          color: #999;
          letter-spacing: 0.06em;
          text-transform: uppercase;
        }
        .side-folder-dot {
          display: inline-block;
          width: 9px;
          height: 9px;
          border-radius: 50%;
          flex-shrink: 0;
          box-shadow: 0 0 0 2px rgba(255,255,255,0.6);
        }
        :global([data-theme='dark']) .side-folder-dot {
          box-shadow: 0 0 0 2px rgba(0,0,0,0.3);
        }
        .side-folder-dim {
          color: #aaa;
          flex-shrink: 0;
        }
        .side-section-items {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .side-note-item {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 12px;
          border-radius: 12px !important;
          background: var(--accent);
          color: var(--foreground);
          font-size: 0.88rem;
          font-weight: 500;
          text-align: left;
          border: 1px solid transparent;
          transition: background 0.15s, border-color 0.15s, transform 0.1s;
        }
        .side-note-item:hover {
          background: var(--background);
          border-color: var(--border);
        }
        .side-note-item:active {
          transform: scale(0.98);
        }
        .side-note-icon-wrap {
          width: 28px;
          height: 28px;
          border-radius: 8px;
          background: var(--background);
          color: var(--primary);
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .side-note-item:hover .side-note-icon-wrap {
          background: var(--accent);
        }
        .side-note-title {
          flex: 1;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .side-empty-wrap {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 32px 24px;
          text-align: center;
        }
        .side-empty-icon {
          width: 56px;
          height: 56px;
          border-radius: 50%;
          background: var(--accent);
          color: var(--primary);
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 12px;
        }
        .side-empty-title {
          font-size: 0.95rem;
          font-weight: 700;
          color: var(--foreground);
          margin-bottom: 4px;
        }
        .side-empty-sub {
          font-size: 0.75rem;
          color: #888;
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
        /* NoteEditor uses position:fixed for its header (top:0;left:0).
           Constrain it inside our side panel so it doesn't escape and
           cover the sketch toolbar / split tabs. */
        .side-note-body :global(.editor-container) {
          position: absolute !important;
          inset: 0 !important;
          width: 100% !important;
          height: 100% !important;
          z-index: auto !important;
          border-radius: 0 !important;
        }
        .side-note-body :global(.editor-header) {
          position: absolute !important;
          top: 0 !important;
          left: 0 !important;
          right: 0 !important;
          z-index: 1 !important;
        }
      `}</style>
    </div>
  );
}
