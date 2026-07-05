'use client';

// Fullscreen viewer for inline SVG figures (flowcharts, geometry). Opened by
// tapping a figure preview; the inline previews are capped at bubble width, so
// this gives a readable, zoomable full-screen view. Independent of any skin —
// it fixes the "figures are tiny" problem for the default look too.

import { useRef, useState, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';
import { useT } from '@/lib/i18n';

const MIN_SCALE = 0.5;
const MAX_SCALE = 6;
const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

type Pt = { x: number; y: number };
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

export function FigureLightbox({ svg, onClose }: { svg: string; onClose: () => void }) {
  const t = useT();
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);

  const scaleRef = useRef(1); scaleRef.current = scale;
  const txRef = useRef(0); txRef.current = tx;
  const tyRef = useRef(0); tyRef.current = ty;

  const pointers = useRef<Map<number, Pt>>(new Map());
  const pinchStart = useRef<{ dist: number; scale: number } | null>(null);
  const panStart = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinchStart.current = { dist: dist(a, b) || 1, scale: scaleRef.current };
      panStart.current = null;
    } else if (pointers.current.size === 1) {
      panStart.current = { x: e.clientX, y: e.clientY, tx: txRef.current, ty: tyRef.current };
    }
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    if (pts.length === 2 && pinchStart.current) {
      const d = dist(pts[0], pts[1]);
      setScale(clampScale(pinchStart.current.scale * (d / pinchStart.current.dist)));
    } else if (pts.length === 1 && panStart.current) {
      setTx(panStart.current.tx + (e.clientX - panStart.current.x));
      setTy(panStart.current.ty + (e.clientY - panStart.current.y));
    }
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchStart.current = null;
    if (pointers.current.size === 0) panStart.current = null;
  }, []);

  const reset = () => { setScale(1); setTx(0); setTy(0); };
  const zoomBy = (f: number) => setScale(s => clampScale(s * f));
  const onDoubleClick = () => { if (scale > 1) reset(); else setScale(2); };

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    // Lock body scroll while open.
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', h); document.body.style.overflow = prev; };
  }, [onClose]);

  return createPortal(
    <div className="fig-lb" role="dialog" aria-modal="true">
      <div className="fig-lb-bar">
        <button onClick={() => zoomBy(1 / 1.3)} aria-label={t('縮小')}><ZoomOut size={18} /></button>
        <button onClick={reset} className="fig-lb-reset"><RotateCcw size={15} /> {t('リセット')}</button>
        <button onClick={() => zoomBy(1.3)} aria-label={t('拡大')}><ZoomIn size={18} /></button>
        <button onClick={onClose} className="fig-lb-close" aria-label={t('閉じる')}><X size={20} /></button>
      </div>
      <div
        className="fig-lb-stage"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
      >
        <div
          className="fig-lb-content"
          style={{ transform: `translate(${tx}px, ${ty}px) scale(${scale})` }}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>
      <div className="fig-lb-hint">{t('ピンチ / ダブルタップで拡大・移動できるよ')}</div>
      <style jsx>{`
        .fig-lb { position: fixed; inset: 0; z-index: 9000; background: rgba(0,0,0,0.85); display: flex; flex-direction: column; }
        .fig-lb-bar { display: flex; align-items: center; gap: 8px; padding: 12px 14px; justify-content: flex-end; padding-top: max(12px, env(safe-area-inset-top)); }
        .fig-lb-bar button { display: inline-flex; align-items: center; gap: 5px; background: rgba(255,255,255,0.15); color: #fff; border: none; border-radius: 10px; padding: 8px 12px; font-size: 0.82rem; cursor: pointer; transition: background 0.14s; }
        .fig-lb-bar button:hover { background: rgba(255,255,255,0.28); }
        .fig-lb-close { margin-left: 6px; background: rgba(255,255,255,0.22) !important; }
        .fig-lb-stage { flex: 1; overflow: hidden; display: flex; align-items: center; justify-content: center; touch-action: none; padding: 8px; }
        .fig-lb-content { transform-origin: center center; will-change: transform; }
        .fig-lb-content :global(svg) { width: 94vw; max-width: 1500px; height: auto; max-height: 82vh; background: #fff; border-radius: 10px; padding: 14px; box-sizing: border-box; display: block; }
        .fig-lb-hint { text-align: center; color: rgba(255,255,255,0.7); font-size: 0.75rem; padding: 8px 12px calc(10px + env(safe-area-inset-bottom)); }
      `}</style>
    </div>,
    document.body,
  );
}
