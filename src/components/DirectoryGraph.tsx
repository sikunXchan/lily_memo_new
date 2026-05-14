'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import type { Folder, Note } from '@/lib/db';

const ForceGraph2D = dynamic(() => import('react-force-graph-2d'), { ssr: false });

type GraphNode = {
  id: string;
  label: string;
  kind: 'folder' | 'note';
  color: string;
  refId: number;
  val: number;
};

type GraphLink = { source: string; target: string };

interface DirectoryGraphProps {
  folders: Folder[];
  notes: Note[];
  activeNoteId?: number;
  onSelectNote: (id: number) => void;
}

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

const GLOW_SPRITE_PX = 96; // CSS-pixel sprite resolution

// Pre-render the radial glow once per color so the per-frame node draw
// is a cheap bitmap blit instead of recreating a CanvasGradient.
function makeGlowSprite(color: string): HTMLCanvasElement {
  const cnv = document.createElement('canvas');
  cnv.width = GLOW_SPRITE_PX;
  cnv.height = GLOW_SPRITE_PX;
  const ctx = cnv.getContext('2d');
  if (!ctx) return cnv;
  const cx = GLOW_SPRITE_PX / 2;
  const g = ctx.createRadialGradient(cx, cx, 0, cx, cx, cx);
  g.addColorStop(0, color + 'dd');
  g.addColorStop(0.4, color + '55');
  g.addColorStop(1, color + '00');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, GLOW_SPRITE_PX, GLOW_SPRITE_PX);
  return cnv;
}

// Pre-render the entire starry backdrop (base color + 2 nebula gradients
// + static stars) once per size change. Drawing this each frame is just
// a single drawImage — no allocations, mobile Safari friendly.
function makeStarfield(w: number, h: number, dpr: number): HTMLCanvasElement {
  const cnv = document.createElement('canvas');
  cnv.width = Math.max(1, Math.ceil(w * dpr));
  cnv.height = Math.max(1, Math.ceil(h * dpr));
  const ctx = cnv.getContext('2d');
  if (!ctx) return cnv;
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
  const count = Math.min(280, Math.max(80, Math.floor(area / 3500)));
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
  return cnv;
}

export default function DirectoryGraph({ folders, notes, activeNoteId, onSelectNote }: DirectoryGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 280, height: 400 });
  const starfieldRef = useRef<HTMLCanvasElement | null>(null);
  const glowCacheRef = useRef<Map<string, HTMLCanvasElement>>(new Map());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fgRef = useRef<any>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const apply = () => {
      const rect = el.getBoundingClientRect();
      const w = Math.max(120, Math.floor(rect.width));
      const h = Math.max(200, Math.floor(rect.height));
      setSize({ width: w, height: h });
      const dpr = window.devicePixelRatio || 1;
      starfieldRef.current = makeStarfield(w, h, dpr);
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    const linkForce = fg.d3Force('link');
    const chargeForce = fg.d3Force('charge');
    if (linkForce) linkForce.distance(22).strength(0.9);
    if (chargeForce) chargeForce.strength(-35).distanceMax(160);
    fg.d3VelocityDecay(0.45);
    fg.d3ReheatSimulation();
  }, [folders.length, notes.length]);

  const graphData = useMemo(() => {
    const nodes: GraphNode[] = [];
    const links: GraphLink[] = [];

    for (const f of folders) {
      if (f.id == null) continue;
      nodes.push({
        id: `f:${f.id}`,
        label: f.name,
        kind: 'folder',
        color: resolveColor(f.color),
        refId: f.id,
        val: 4,
      });
    }
    for (const n of notes) {
      if (n.id == null) continue;
      const parent = folders.find(f => f.id === n.folderId);
      nodes.push({
        id: `n:${n.id}`,
        label: n.title || '無題のメモ',
        kind: 'note',
        color: resolveColor(n.color ?? parent?.color),
        refId: n.id,
        val: 2,
      });
    }
    for (const f of folders) {
      if (f.id == null || f.parentId == null) continue;
      if (folders.some(p => p.id === f.parentId)) {
        links.push({ source: `f:${f.parentId}`, target: `f:${f.id}` });
      }
    }
    for (const n of notes) {
      if (n.id == null || n.folderId == null) continue;
      if (folders.some(f => f.id === n.folderId)) {
        links.push({ source: `f:${n.folderId}`, target: `n:${n.id}` });
      }
    }

    return { nodes, links };
  }, [folders, notes]);

  const linkColor = 'rgba(180, 200, 255, 0.18)';
  const labelColor = '#dfe6ff';
  const activeId = activeNoteId != null ? `n:${activeNoteId}` : null;

  return (
    <div ref={containerRef} className="directory-graph">
      <ForceGraph2D
        ref={fgRef}
        width={size.width}
        height={size.height}
        graphData={graphData}
        backgroundColor="rgba(0,0,0,0)"
        cooldownTicks={120}
        cooldownTime={4000}
        nodeRelSize={4}
        linkColor={() => linkColor}
        linkWidth={0.6}
        enableNodeDrag={true}
        onRenderFramePre={(ctx) => {
          // Backdrop is painted in canvas-pixel space (identity transform),
          // covering the full pixel buffer regardless of devicePixelRatio.
          // Pre-rendered to an offscreen canvas at the same DPR-scaled
          // resolution, so this is a single 1:1 blit per frame — no
          // gradient allocations, no per-star math.
          ctx.save();
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          const sf = starfieldRef.current;
          if (sf && sf.width > 0 && sf.height > 0) {
            ctx.drawImage(sf, 0, 0);
          } else {
            ctx.fillStyle = '#070716';
            ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
          }
          ctx.restore();
        }}
        onNodeClick={(rawNode) => {
          const node = rawNode as GraphNode;
          if (node.kind === 'note' && typeof node.refId === 'number') {
            onSelectNote(node.refId);
          }
        }}
        nodeCanvasObject={(rawNode, ctx, globalScale) => {
          const node = rawNode as GraphNode & { x?: number; y?: number };
          const x = node.x ?? 0;
          const y = node.y ?? 0;
          const isActive = node.id === activeId;
          const r = node.kind === 'folder' ? 3.2 : 2.2;
          const glowR = r * 6;
          // Glow: pre-rendered per-color sprite, blitted (cheap).
          let sprite = glowCacheRef.current.get(node.color);
          if (!sprite) {
            sprite = makeGlowSprite(node.color);
            glowCacheRef.current.set(node.color, sprite);
          }
          ctx.drawImage(sprite, x - glowR, y - glowR, glowR * 2, glowR * 2);
          // bright core
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(x, y, r * 0.55, 0, Math.PI * 2);
          ctx.fill();
          // colored ring
          ctx.fillStyle = node.color;
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(x, y, r * 0.4, 0, Math.PI * 2);
          ctx.fill();
          if (isActive) {
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1.2 / globalScale;
            ctx.beginPath();
            ctx.arc(x, y, r + 2, 0, Math.PI * 2);
            ctx.stroke();
          }
          if (globalScale > 1.4 || node.kind === 'folder') {
            const fontSize = Math.max(3, 9 / globalScale);
            ctx.font = `${fontSize}px sans-serif`;
            ctx.fillStyle = labelColor;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText(node.label.slice(0, 14), x, y + r + 2);
          }
        }}
        nodePointerAreaPaint={(rawNode, color, ctx) => {
          const node = rawNode as GraphNode & { x?: number; y?: number };
          const x = node.x ?? 0;
          const y = node.y ?? 0;
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(x, y, 8, 0, Math.PI * 2);
          ctx.fill();
        }}
      />
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
      `}</style>
    </div>
  );
}
