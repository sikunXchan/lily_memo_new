'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import type { Folder, Note } from '@/lib/db';

// CSR only — force-graph touches window on import
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

interface BackgroundStar {
  x: number;
  y: number;
  r: number;
  baseAlpha: number;
  twinkleSpeed: number;
  twinklePhase: number;
}

function makeStars(width: number, height: number): BackgroundStar[] {
  const area = width * height;
  const count = Math.min(280, Math.max(80, Math.floor(area / 3500)));
  const stars: BackgroundStar[] = [];
  for (let i = 0; i < count; i++) {
    stars.push({
      x: Math.random() * width,
      y: Math.random() * height,
      r: Math.random() < 0.85 ? Math.random() * 0.7 + 0.2 : Math.random() * 1.3 + 0.7,
      baseAlpha: Math.random() * 0.6 + 0.25,
      twinkleSpeed: Math.random() * 0.0015 + 0.0005,
      twinklePhase: Math.random() * Math.PI * 2,
    });
  }
  return stars;
}

export default function DirectoryGraph({ folders, notes, activeNoteId, onSelectNote }: DirectoryGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 280, height: 400 });
  const starsRef = useRef<BackgroundStar[]>([]);
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
      starsRef.current = makeStars(w, h);
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Tighten the simulation — bring nodes closer together
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
        cooldownTicks={150}
        nodeRelSize={4}
        linkColor={() => linkColor}
        linkWidth={0.6}
        enableNodeDrag={true}
        onRenderFramePre={(ctx) => {
          // Paint twinkling stars in graph coordinate space (nope — this fires after transforms).
          // We draw in canvas pixel space using identity transform for backdrop.
          ctx.save();
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.fillStyle = '#070716';
          ctx.fillRect(0, 0, size.width, size.height);
          // subtle nebula tint
          const grad1 = ctx.createRadialGradient(size.width * 0.2, size.height * 0.3, 0, size.width * 0.2, size.height * 0.3, size.width * 0.6);
          grad1.addColorStop(0, 'rgba(110, 70, 160, 0.22)');
          grad1.addColorStop(1, 'rgba(110, 70, 160, 0)');
          ctx.fillStyle = grad1;
          ctx.fillRect(0, 0, size.width, size.height);
          const grad2 = ctx.createRadialGradient(size.width * 0.8, size.height * 0.75, 0, size.width * 0.8, size.height * 0.75, size.width * 0.6);
          grad2.addColorStop(0, 'rgba(60, 100, 200, 0.18)');
          grad2.addColorStop(1, 'rgba(60, 100, 200, 0)');
          ctx.fillStyle = grad2;
          ctx.fillRect(0, 0, size.width, size.height);
          // stars
          const t = performance.now();
          for (const s of starsRef.current) {
            const a = s.baseAlpha * (0.6 + 0.4 * Math.sin(t * s.twinkleSpeed + s.twinklePhase));
            ctx.globalAlpha = Math.max(0, Math.min(1, a));
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.globalAlpha = 1;
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
          // outer glow — bigger and softer, like a star
          const glowR = r * 6;
          const glow = ctx.createRadialGradient(x, y, 0, x, y, glowR);
          glow.addColorStop(0, node.color + 'dd');
          glow.addColorStop(0.4, node.color + '55');
          glow.addColorStop(1, node.color + '00');
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(x, y, glowR, 0, Math.PI * 2);
          ctx.fill();
          // bright core (white-hot center)
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
          // label (only when zoomed in enough OR for folders)
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
