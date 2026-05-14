'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
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
        label: n.title || '無題のメモ',
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
        label: n.title || '無題のメモ',
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
      label: n.title || '無題のメモ',
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

  // Links first (under nodes).
  ctx.lineWidth = 0.6;
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
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r + 2.5, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // Labels last so they sit on top.
  ctx.fillStyle = '#dfe6ff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const n of data.nodes) {
    ctx.font = `${n.kind === 'folder' ? 10 : 9}px sans-serif`;
    ctx.fillText(n.label.slice(0, 14), n.x, n.y + n.r + 3);
  }
}

export default function DirectoryGraph({ folders, notes, activeNoteId, onSelectNote }: DirectoryGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bgCanvasRef = useRef<HTMLCanvasElement>(null);
  const fgCanvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 280, height: 400 });

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
    paintGraph(fg, size.width, size.height, dpr, data, active);
  }, [data, size.width, size.height, activeNoteId]);

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    // Hit radius generous enough to be tappable on mobile.
    const tapR = 14;
    let best: LaidOutNode | null = null;
    let bestDist = tapR * tapR;
    for (const n of data.nodes) {
      if (n.kind !== 'note') continue;
      const dx = n.x - x;
      const dy = n.y - y;
      const d = dx * dx + dy * dy;
      if (d < bestDist) {
        bestDist = d;
        best = n;
      }
    }
    if (best) onSelectNote(best.refId);
  };

  return (
    <div ref={containerRef} className="directory-graph">
      <canvas ref={bgCanvasRef} className="layer bg" aria-hidden="true" />
      <canvas ref={fgCanvasRef} className="layer fg" onClick={handleClick} />
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
          cursor: pointer;
        }
      `}</style>
    </div>
  );
}
