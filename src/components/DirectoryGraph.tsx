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
  if (!token) return '#ffb6c1';
  if (token.startsWith('--')) return COLOR_MAP[token] ?? '#ffb6c1';
  return token;
}

export default function DirectoryGraph({ folders, notes, activeNoteId, onSelectNote }: DirectoryGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 280, height: 400 });
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const update = () => setIsDark(document.body.getAttribute('data-theme') === 'dark');
    update();
    const obs = new MutationObserver(update);
    obs.observe(document.body, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const apply = () => {
      const rect = el.getBoundingClientRect();
      setSize({ width: Math.max(120, Math.floor(rect.width)), height: Math.max(200, Math.floor(rect.height)) });
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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
      // edge from parent folder to child folder
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

  const linkColor = isDark ? 'rgba(255,255,255,0.18)' : 'rgba(120,120,160,0.25)';
  const labelColor = isDark ? '#e8e8ef' : '#3a3a4a';
  const activeId = activeNoteId != null ? `n:${activeNoteId}` : null;

  return (
    <div ref={containerRef} className="directory-graph">
      <ForceGraph2D
        width={size.width}
        height={size.height}
        graphData={graphData}
        backgroundColor="rgba(0,0,0,0)"
        cooldownTicks={120}
        nodeRelSize={4}
        linkColor={() => linkColor}
        linkWidth={1}
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
          const r = node.kind === 'folder' ? 5 : 3.5;
          // outer glow
          const glow = ctx.createRadialGradient(x, y, 0, x, y, r * 4);
          glow.addColorStop(0, node.color + 'cc');
          glow.addColorStop(1, node.color + '00');
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(x, y, r * 4, 0, Math.PI * 2);
          ctx.fill();
          // core
          ctx.fillStyle = node.color;
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fill();
          if (isActive) {
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1.5 / globalScale;
            ctx.stroke();
          }
          // label (only when zoomed in enough)
          if (globalScale > 1.2 || node.kind === 'folder') {
            const fontSize = Math.max(3, 10 / globalScale);
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
          background:
            radial-gradient(circle at 20% 30%, rgba(255,182,193,0.08), transparent 60%),
            radial-gradient(circle at 80% 70%, rgba(160,196,255,0.08), transparent 60%);
          border-radius: 12px;
          overflow: hidden;
        }
        :global([data-theme='dark']) .directory-graph {
          background:
            radial-gradient(circle at 20% 30%, rgba(120,80,140,0.18), transparent 60%),
            radial-gradient(circle at 80% 70%, rgba(60,90,160,0.18), transparent 60%),
            #0d0d18;
        }
      `}</style>
    </div>
  );
}
