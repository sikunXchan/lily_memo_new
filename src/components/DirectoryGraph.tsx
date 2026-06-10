'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { translate } from '@/lib/i18n';
import { ZoomIn, ZoomOut, Maximize } from 'lucide-react';
import type { Folder, Note } from '@/lib/db';

interface DirectoryGraphProps {
  folders: Folder[];
  notes: Note[];
  activeNoteId?: number;
  onSelectNote: (id: number) => void;
}

type LaidOutNode = {
  kind: 'folder' | 'note';
  refId: number;
  x: number;
  y: number;
  r: number;
  color: string;
  label: string;
};

type Link = { ax: number; ay: number; bx: number; by: number };
type View = { scale: number; tx: number; ty: number };

const MIN_SCALE = 0.4;
const MAX_SCALE = 6;
const TAP_MOVE_THRESHOLD = 6; // px in screen space — distinguishes tap from drag

const COLOR_MAP: Record<string, string> = {
  '--folder-pink': '#ffb6c1',
  '--folder-blue': '#a0c4ff',
  '--folder-green': '#a8e6a3',
  '--folder-yellow': '#ffd97d',
  '--folder-purple': '#c8a2c8',
};

function resolveColor(token?: string): string {
  if (!token) return '#ffd6a8';
  if (token.startsWith('--')) return COLOR_MAP[token] ?? '#ffd6a8';
  return token;
}

function paintStarfield(cnv: HTMLCanvasElement, w: number, h: number, dpr: number) {
  cnv.width = Math.max(1, Math.ceil(w * dpr));
  cnv.height = Math.max(1, Math.ceil(h * dpr));
  cnv.style.width = w + 'px';
  cnv.style.height = h + 'px';
  const ctx = cnv.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);
  ctx.fillStyle = '#070716';
  ctx.fillRect(0, 0, w, h);
  const g1 = ctx.createRadialGradient(w * 0.2, h * 0.3, 0, w * 0.2, h * 0.3, w * 0.6);
  g1.addColorStop(0, 'rgba(110, 70, 160, 0.22)');
  g1.addColorStop(1, 'rgba(110, 70, 160, 0)');
  ctx.fillStyle = g1;
  ctx.fillRect(0, 0, w, h);
  const g2 = ctx.createRadialGradient(w * 0.8, h * 0.75, 0, w * 0.8, h * 0.75, w * 0.6);
  g2.addColorStop(0, 'rgba(60, 100, 200, 0.18)');
  g2.addColorStop(1, 'rgba(60, 100, 200, 0)');
  ctx.fillStyle = g2;
  ctx.fillRect(0, 0, w, h);
  const area = w * h;
  const count = Math.min(220, Math.max(60, Math.floor(area / 4500)));
  for (let i = 0; i < count; i++) {
    const r = Math.random() < 0.85 ? Math.random() * 0.7 + 0.2 : Math.random() * 1.3 + 0.7;
    const a = Math.random() * 0.6 + 0.25;
    ctx.globalAlpha = a;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(Math.random() * w, Math.random() * h, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// Deterministic radial layout. Folders sit on a ring; each folder's
// notes orbit it; unfiled notes orbit the periphery. No simulation,
// no animation, no continuous redraw — mobile-Safari safe.
function layoutNodes(
  folders: Folder[],
  notes: Note[],
  w: number,
  h: number,
): { nodes: LaidOutNode[]; links: Link[] } {
  const cx = w / 2;
  const cy = h / 2;
  const minDim = Math.min(w, h);
  const folderRingR = minDim * 0.27;
  const orphanRingR = minDim * 0.46;
  const orbitR = Math.max(28, minDim * 0.11);

  const nodes: LaidOutNode[] = [];
  const links: Link[] = [];

  const validFolders = folders.filter(f => f.id != null);
  const folderPos = new Map<number, { x: number; y: number; color: string }>();

  if (validFolders.length === 0) {
    // No folders — lay every note on a single ring around the center.
    const validNotes = notes.filter(n => n.id != null);
    validNotes.forEach((n, i) => {
      const t = (i / Math.max(1, validNotes.length)) * Math.PI * 2;
      const x = cx + Math.cos(t) * folderRingR;
      const y = cy + Math.sin(t) * folderRingR;
      nodes.push({
        kind: 'note',
        refId: n.id!,
        x, y, r: 4,
        color: resolveColor(n.color),
        label: n.title || translate('無題のメモ'),
      });
    });
    return { nodes, links };
  }

  validFolders.forEach((f, i) => {
    const t = (i / validFolders.length) * Math.PI * 2 - Math.PI / 2;
    const x = cx + Math.cos(t) * folderRingR;
    const y = cy + Math.sin(t) * folderRingR;
    const color = resolveColor(f.color);
    folderPos.set(f.id!, { x, y, color });
    nodes.push({
      kind: 'folder',
      refId: f.id!,
      x, y, r: 5,
      color,
      label: f.name,
    });
  });

  // Folder→folder parent links.
  for (const f of validFolders) {
    if (f.parentId == null) continue;
    const child = folderPos.get(f.id!);
    const parent = folderPos.get(f.parentId);
    if (child && parent) {
      links.push({ ax: parent.x, ay: parent.y, bx: child.x, by: child.y });
    }
  }

  // Group notes by folder.
  const byFolder = new Map<number | null, Note[]>();
  for (const n of notes) {
    if (n.id == null) continue;
    const key = n.folderId != null && folderPos.has(n.folderId) ? n.folderId : null;
    if (!byFolder.has(key)) byFolder.set(key, []);
    byFolder.get(key)!.push(n);
  }

  // Notes orbiting their parent folder.
  for (const [folderId, group] of byFolder) {
    if (folderId == null) continue;
    const fp = folderPos.get(folderId)!;
    group.forEach((n, i) => {
      const t = (i / Math.max(1, group.length)) * Math.PI * 2;
      const x = fp.x + Math.cos(t) * orbitR;
      const y = fp.y + Math.sin(t) * orbitR;
      nodes.push({
        kind: 'note',
        refId: n.id!,
        x, y, r: 3.2,
        color: resolveColor(n.color ?? undefined) || fp.color,
        label: n.title || translate('無題のメモ'),
      });
      links.push({ ax: fp.x, ay: fp.y, bx: x, by: y });
    });
  }

  // Orphan notes on the outer ring.
  const orphans = byFolder.get(null) ?? [];
  orphans.forEach((n, i) => {
    const t = (i / Math.max(1, orphans.length)) * Math.PI * 2 + Math.PI / 4;
    const x = cx + Math.cos(t) * orphanRingR;
    const y = cy + Math.sin(t) * orphanRingR;
    nodes.push({
      kind: 'note',
      refId: n.id!,
      x, y, r: 3.2,
      color: resolveColor(n.color),
      label: n.title || translate('無題のメモ'),
    });
  });

  return { nodes, links };
}

function paintGraph(
  cnv: HTMLCanvasElement,
  w: number,
  h: number,
  dpr: number,
  data: { nodes: LaidOutNode[]; links: Link[] },
  activeId: { kind: 'note'; refId: number } | null,
  view: View,
) {
  cnv.width = Math.max(1, Math.ceil(w * dpr));
  cnv.height = Math.max(1, Math.ceil(h * dpr));
  cnv.style.width = w + 'px';
  cnv.style.height = h + 'px';
  const ctx = cnv.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);

  // Apply user view transform after DPR scale.
  ctx.translate(view.tx, view.ty);
  ctx.scale(view.scale, view.scale);

  // Links first (under nodes).
  ctx.lineWidth = 0.6 / view.scale;
  ctx.strokeStyle = 'rgba(180, 200, 255, 0.22)';
  ctx.beginPath();
  for (const l of data.links) {
    ctx.moveTo(l.ax, l.ay);
    ctx.lineTo(l.bx, l.by);
  }
  ctx.stroke();

  // Each node: soft halo + core + colored ring + white pinprick.
  for (const n of data.nodes) {
    const haloR = n.r * 5.5;
    const halo = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, haloR);
    halo.addColorStop(0, n.color + 'cc');
    halo.addColorStop(0.4, n.color + '55');
    halo.addColorStop(1, n.color + '00');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(n.x, n.y, haloR, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(n.x, n.y, n.r * 0.55, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = n.color;
    ctx.beginPath();
    ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(n.x, n.y, n.r * 0.4, 0, Math.PI * 2);
    ctx.fill();

    if (activeId && n.kind === 'note' && n.refId === activeId.refId) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.4 / view.scale;
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r + 2.5 / view.scale, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // Labels last so they sit on top. Counter-scale so font remains readable.
  ctx.fillStyle = '#dfe6ff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const n of data.nodes) {
    const baseSize = n.kind === 'folder' ? 10 : 9;
    // Keep labels roughly the same screen size by dividing by view.scale,
    // but clamp so they don't explode when zoomed out.
    const fontSize = Math.max(7, Math.min(16, baseSize / view.scale));
    ctx.font = `${fontSize}px sans-serif`;
    ctx.fillText(n.label.slice(0, 14), n.x, n.y + n.r + 3 / view.scale);
  }
}

export default function DirectoryGraph({ folders, notes, activeNoteId, onSelectNote }: DirectoryGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bgCanvasRef = useRef<HTMLCanvasElement>(null);
  const fgCanvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 280, height: 400 });
  const [view, setView] = useState<View>({ scale: 1, tx: 0, ty: 0 });

  const data = useMemo(
    () => layoutNodes(folders, notes, size.width, size.height),
    [folders, notes, size.width, size.height],
  );

  useEffect(() => {
    const el = containerRef.current;
    const bg = bgCanvasRef.current;
    if (!el || !bg) return;
    const apply = () => {
      const rect = el.getBoundingClientRect();
      const w = Math.max(120, Math.floor(rect.width));
      const h = Math.max(200, Math.floor(rect.height));
      setSize({ width: w, height: h });
      const dpr = window.devicePixelRatio || 1;
      paintStarfield(bg, w, h, dpr);
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const fg = fgCanvasRef.current;
    if (!fg) return;
    const dpr = window.devicePixelRatio || 1;
    const active = activeNoteId != null ? { kind: 'note' as const, refId: activeNoteId } : null;
    paintGraph(fg, size.width, size.height, dpr, data, active, view);
  }, [data, size.width, size.height, activeNoteId, view]);

  const clampScale = (s: number) => Math.max(MIN_SCALE, Math.min(MAX_SCALE, s));

  // Zoom toward an anchor point given in canvas-local (CSS) pixels.
  const zoomAt = useCallback((nextScaleRaw: number, ax: number, ay: number) => {
    setView(v => {
      const nextScale = clampScale(nextScaleRaw);
      if (nextScale === v.scale) return v;
      // World point under the anchor before zooming: (ax - tx) / scale.
      // We want the same world point under the anchor after zooming, so:
      const wx = (ax - v.tx) / v.scale;
      const wy = (ay - v.ty) / v.scale;
      return {
        scale: nextScale,
        tx: ax - wx * nextScale,
        ty: ay - wy * nextScale,
      };
    });
  }, []);

  // --- Wheel zoom (desktop) ---
  useEffect(() => {
    const fg = fgCanvasRef.current;
    if (!fg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = fg.getBoundingClientRect();
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
    fg.addEventListener('wheel', onWheel, { passive: false });
    return () => fg.removeEventListener('wheel', onWheel);
  }, []);

  // --- Pointer drag / pinch ---
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const dragStateRef = useRef<{
    moved: boolean;
    startX: number;
    startY: number;
    initial: View | null;
    pinchDist: number | null;
    pinchCenter: { x: number; y: number } | null;
  }>({ moved: false, startX: 0, startY: 0, initial: null, pinchDist: null, pinchCenter: null });

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const fg = e.currentTarget;
    fg.setPointerCapture(e.pointerId);
    const rect = fg.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    pointersRef.current.set(e.pointerId, { x: px, y: py });

    if (pointersRef.current.size === 1) {
      dragStateRef.current = {
        moved: false,
        startX: px,
        startY: py,
        initial: view,
        pinchDist: null,
        pinchCenter: null,
      };
    } else if (pointersRef.current.size === 2) {
      const pts = Array.from(pointersRef.current.values());
      const dx = pts[0].x - pts[1].x;
      const dy = pts[0].y - pts[1].y;
      dragStateRef.current.pinchDist = Math.hypot(dx, dy);
      dragStateRef.current.pinchCenter = {
        x: (pts[0].x + pts[1].x) / 2,
        y: (pts[0].y + pts[1].y) / 2,
      };
      dragStateRef.current.initial = view;
      dragStateRef.current.moved = true;
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!pointersRef.current.has(e.pointerId)) return;
    const fg = e.currentTarget;
    const rect = fg.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    pointersRef.current.set(e.pointerId, { x: px, y: py });

    if (pointersRef.current.size === 2) {
      // Pinch zoom.
      const pts = Array.from(pointersRef.current.values());
      const dx = pts[0].x - pts[1].x;
      const dy = pts[0].y - pts[1].y;
      const dist = Math.hypot(dx, dy);
      const center = {
        x: (pts[0].x + pts[1].x) / 2,
        y: (pts[0].y + pts[1].y) / 2,
      };
      const ds = dragStateRef.current;
      if (ds.pinchDist && ds.initial) {
        const ratio = dist / ds.pinchDist;
        const nextScale = clampScale(ds.initial.scale * ratio);
        const wx = (center.x - ds.initial.tx) / ds.initial.scale;
        const wy = (center.y - ds.initial.ty) / ds.initial.scale;
        setView({
          scale: nextScale,
          tx: center.x - wx * nextScale,
          ty: center.y - wy * nextScale,
        });
      }
      return;
    }

    if (pointersRef.current.size === 1) {
      const ds = dragStateRef.current;
      if (!ds.initial) return;
      const dxRaw = px - ds.startX;
      const dyRaw = py - ds.startY;
      if (!ds.moved && Math.hypot(dxRaw, dyRaw) > TAP_MOVE_THRESHOLD) {
        ds.moved = true;
      }
      if (ds.moved) {
        setView({ scale: ds.initial.scale, tx: ds.initial.tx + dxRaw, ty: ds.initial.ty + dyRaw });
      }
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const fg = e.currentTarget;
    const rect = fg.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const wasPinch = pointersRef.current.size >= 2;
    pointersRef.current.delete(e.pointerId);
    if (fg.hasPointerCapture(e.pointerId)) fg.releasePointerCapture(e.pointerId);

    if (pointersRef.current.size === 0) {
      const ds = dragStateRef.current;
      if (!ds.moved && !wasPinch) {
        // Treat as tap → select.
        const tapR = 14 / view.scale;
        // Convert tap point to world coords.
        const wx = (px - view.tx) / view.scale;
        const wy = (py - view.ty) / view.scale;
        let best: LaidOutNode | null = null;
        let bestDist = tapR * tapR;
        for (const n of data.nodes) {
          if (n.kind !== 'note') continue;
          const dx = n.x - wx;
          const dy = n.y - wy;
          const d = dx * dx + dy * dy;
          if (d < bestDist) {
            bestDist = d;
            best = n;
          }
        }
        if (best) onSelectNote(best.refId);
      }
      dragStateRef.current.initial = null;
      dragStateRef.current.pinchDist = null;
    } else if (pointersRef.current.size === 1) {
      // Switching back to single-pointer drag — re-anchor.
      const remaining = Array.from(pointersRef.current.entries())[0];
      dragStateRef.current = {
        moved: true,
        startX: remaining[1].x,
        startY: remaining[1].y,
        initial: view,
        pinchDist: null,
        pinchCenter: null,
      };
    }
  };

  const zoomInBtn = () => {
    zoomAt(view.scale * 1.4, size.width / 2, size.height / 2);
  };
  const zoomOutBtn = () => {
    zoomAt(view.scale / 1.4, size.width / 2, size.height / 2);
  };
  const resetView = () => {
    setView({ scale: 1, tx: 0, ty: 0 });
  };

  return (
    <div ref={containerRef} className="directory-graph">
      <canvas ref={bgCanvasRef} className="layer bg" aria-hidden="true" />
      <canvas
        ref={fgCanvasRef}
        className="layer fg"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
      <div className="graph-controls" aria-label={translate('ズーム操作')}>
        <button className="gc-btn" onClick={zoomInBtn} title={translate('拡大')} aria-label={translate('拡大')}>
          <ZoomIn size={14} />
        </button>
        <button className="gc-btn gc-label" onClick={resetView} title={translate('リセット')}>
          {Math.round(view.scale * 100)}%
        </button>
        <button className="gc-btn" onClick={zoomOutBtn} title={translate('縮小')} aria-label={translate('縮小')}>
          <ZoomOut size={14} />
        </button>
        <button className="gc-btn" onClick={resetView} title={translate('全体表示')} aria-label={translate('全体表示')}>
          <Maximize size={14} />
        </button>
      </div>
      <style jsx>{`
        .directory-graph {
          width: 100%;
          height: 100%;
          min-height: 280px;
          position: relative;
          background: #070716;
          border-radius: 12px;
          overflow: hidden;
        }
        .layer {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
        }
        .bg {
          pointer-events: none;
          z-index: 0;
        }
        .fg {
          z-index: 1;
          cursor: grab;
          touch-action: none;
        }
        .fg:active {
          cursor: grabbing;
        }
        .graph-controls {
          position: absolute;
          bottom: 8px;
          right: 8px;
          z-index: 2;
          display: flex;
          flex-direction: column;
          gap: 4px;
          background: rgba(20, 22, 40, 0.7);
          backdrop-filter: blur(6px);
          -webkit-backdrop-filter: blur(6px);
          padding: 4px;
          border-radius: 10px;
          border: 1px solid rgba(255,255,255,0.08);
        }
        .gc-btn {
          width: 30px;
          height: 28px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: transparent;
          color: #cfd6ff;
          border-radius: 6px;
          padding: 0;
          font-size: 0.65rem;
          font-weight: 600;
        }
        .gc-btn:hover {
          background: rgba(255,255,255,0.08);
        }
        .gc-btn.gc-label {
          min-width: 36px;
          padding: 0 4px;
        }
      `}</style>
    </div>
  );
}
