'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import {
  X, Upload, FileText, Link as LinkIcon, ExternalLink,
  ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Clock,
  Play, Pause, RotateCcw, RotateCw, Highlighter, Pencil, Trash2,
  Image as ImageIcon, Plus, Maximize2, Minimize2,
  Minus, MessageSquare, ChevronDown, ChevronUp,
} from 'lucide-react';
import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { registerPdfProvider, registerPdfAnnotator, type SikunAnnotation } from '@/lib/pdfBridge';

if (typeof window !== 'undefined') {
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
}

const ZOOM_LEVELS = [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0, 2.5];
const DEFAULT_ZOOM_INDEX = 4;
const HL_COLORS = ['#ffeb3b80', '#86efac80', '#fda4af80', '#93c5fd80'];
const PEN_COLORS = ['#ef4444', '#1d4ed8', '#16a34a', '#f97316', '#7c3aed', '#000000'];
const PEN_WIDTHS = [1.5, 3, 6]; // PDF units
const MAX_IMG_DIM = 2048;

type HighlightAnn = {
  id: string; type: 'highlight';
  x: number; y: number; w: number; h: number; color: string;
};
type PenAnn = {
  id: string; type: 'pen';
  points: Array<{ x: number; y: number }>; color: string; lineWidth: number;
};
type LineAnn = {
  id: string; type: 'line';
  x1: number; y1: number; x2: number; y2: number;
  color: string; lineWidth: number;
};
// TextAnn coordinates are stored in "logical CSS px at scale=1.0"
type TextAnn = {
  id: string; type: 'text';
  x: number; y: number; text: string; color: string;
};
type AnnotationItem = HighlightAnn | PenAnn | LineAnn | TextAnn;
type AnnMode = 'none' | 'highlight' | 'pen' | 'line' | 'text';

// ---- PDF builder from JPEG images ----
function buildPDFBlob(pages: Array<{ jpegBytes: Uint8Array; w: number; h: number }>): Blob {
  const n = pages.length;
  const enc = new TextEncoder();
  const segs: Uint8Array[] = [];
  const offs: Record<number, number> = {};
  let pos = 0;

  const wr = (s: string) => { const b = enc.encode(s); segs.push(b); pos += b.length; };
  const wb = (b: Uint8Array) => { segs.push(b); pos += b.length; };

  const imgO = (i: number) => 3 + i * 3;
  const cntO = (i: number) => 4 + i * 3;
  const pgO  = (i: number) => 5 + i * 3;
  const total = 2 + n * 3;

  wr('%PDF-1.4\n');
  offs[1] = pos; wr(`1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`);
  offs[2] = pos;
  wr(`2 0 obj\n<< /Type /Pages /Kids [${Array.from({length:n},(_,i)=>`${pgO(i)} 0 R`).join(' ')}] /Count ${n} >>\nendobj\n`);

  for (let i = 0; i < n; i++) {
    const { jpegBytes, w, h } = pages[i];
    offs[imgO(i)] = pos;
    wr(`${imgO(i)} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`);
    wb(jpegBytes);
    wr(`\nendstream\nendobj\n`);
    const cnt = `q ${w} 0 0 ${h} 0 0 cm /Im${i} Do Q`;
    offs[cntO(i)] = pos;
    wr(`${cntO(i)} 0 obj\n<< /Length ${enc.encode(cnt).length} >>\nstream\n${cnt}\nendstream\nendobj\n`);
    offs[pgO(i)] = pos;
    wr(`${pgO(i)} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Contents ${cntO(i)} 0 R /Resources << /XObject << /Im${i} ${imgO(i)} 0 R >> >> >>\nendobj\n`);
  }

  const xpos = pos;
  wr(`xref\n0 ${total+1}\n0000000000 65535 f \n`);
  for (let j = 1; j <= total; j++) wr(`${String(offs[j]).padStart(10,'0')} 00000 n \n`);
  wr(`trailer\n<< /Size ${total+1} /Root 1 0 R >>\nstartxref\n${xpos}\n%%EOF`);

  const sz = segs.reduce((s,b)=>s+b.length,0);
  const out = new Uint8Array(sz); let off = 0;
  for (const seg of segs) { out.set(seg,off); off+=seg.length; }
  return new Blob([out], { type: 'application/pdf' });
}

async function imagesToPDFUrl(files: File[], rotations: number[] = []): Promise<string> {
  const pages: Array<{ jpegBytes: Uint8Array; w: number; h: number }> = [];
  for (let idx = 0; idx < files.length; idx++) {
    const file = files[idx];
    const dataUrl = await new Promise<string>((res, rej) => {
      const r = new FileReader();
      r.onload = e => res(e.target!.result as string);
      r.onerror = rej;
      r.readAsDataURL(file);
    });
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const el = new Image();
      el.onload = () => res(el);
      el.onerror = rej;
      el.src = dataUrl;
    });
    let w = img.naturalWidth, h = img.naturalHeight;
    if (w > MAX_IMG_DIM || h > MAX_IMG_DIM) {
      const r = Math.min(MAX_IMG_DIM / w, MAX_IMG_DIM / h);
      w = Math.round(w * r); h = Math.round(h * r);
    }
    // Apply the user's chosen rotation (0/90/180/270). For 90/270 the page
    // dimensions are swapped so the rotated image fits exactly.
    const rot = (((rotations[idx] ?? 0) % 360) + 360) % 360;
    const swap = rot === 90 || rot === 270;
    const cw = swap ? h : w;
    const ch = swap ? w : h;
    const cv = document.createElement('canvas');
    cv.width = cw; cv.height = ch;
    const c = cv.getContext('2d')!;
    c.fillStyle = '#fff'; c.fillRect(0, 0, cw, ch);
    c.save();
    c.translate(cw / 2, ch / 2);
    c.rotate((rot * Math.PI) / 180);
    c.drawImage(img, -w / 2, -h / 2, w, h);
    c.restore();
    const b64 = cv.toDataURL('image/jpeg', 0.92).split(',')[1];
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
    pages.push({ jpegBytes: bytes, w: cw, h: ch });
  }
  return URL.createObjectURL(buildPDFBlob(pages));
}

// ---- Smooth curve drawing helper ----
function drawSmoothPath(ctx: CanvasRenderingContext2D, pts: Array<{x:number;y:number}>, sc: number) {
  if (pts.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(pts[0].x * sc, pts[0].y * sc);
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = ((pts[i].x + pts[i+1].x) / 2) * sc;
    const my = ((pts[i].y + pts[i+1].y) / 2) * sc;
    ctx.quadraticCurveTo(pts[i].x * sc, pts[i].y * sc, mx, my);
  }
  ctx.lineTo(pts[pts.length-1].x * sc, pts[pts.length-1].y * sc);
}

// ---- Timer beep ----
function playBeep() {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = 'sine'; osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.8);
  } catch { /* ignore */ }
}

// ========== Component ==========

interface PDFViewerProps {
  // When true, the viewer fills its parent (position:absolute) instead of
  // taking over the whole viewport (position:fixed). Used inside the
  // sketch tab's split panel so PDFs don't escape the panel.
  embedded?: boolean;
}

export default function PDFViewer({ embedded = false }: PDFViewerProps) {
  const [inputUrl, setInputUrl] = useState('');
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [zoomIndex, setZoomIndex] = useState(DEFAULT_ZOOM_INDEX);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [openUrl, setOpenUrl] = useState('');

  // Timer
  const [showTimer, setShowTimer] = useState(false);
  const [timerCollapsed, setTimerCollapsed] = useState(false);
  const [timerMode, setTimerMode] = useState<'stopwatch' | 'countdown'>('stopwatch');
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [timerRunning, setTimerRunning] = useState(false);
  const [timerInput, setTimerInput] = useState(25);
  const [timerAlert, setTimerAlert] = useState(false);

  // Annotations
  const [annotationMode, setAnnotationMode] = useState<AnnMode>('none');
  const [hlColorIdx, setHlColorIdx] = useState(0);
  const [penColorIdx, setPenColorIdx] = useState(5); // black
  const [penWidthIdx, setPenWidthIdx] = useState(1); // medium
  const [annotations, setAnnotations] = useState<Record<number, AnnotationItem[]>>({});
  const [overlayVersion, setOverlayVersion] = useState(0);
  // Text annotation input
  const [textInputPos, setTextInputPos] = useState<{ x: number; y: number; screenX: number; screenY: number } | null>(null);
  const [textInputValue, setTextInputValue] = useState('');
  const [showComments, setShowComments] = useState(false);

  // Sikun AI annotations (keyed by page, separate from user annotations)
  const [sikunAnnotations, setSikunAnnotations] = useState<Record<number, SikunAnnotation[]>>({});
  const sikunAnnotationsRef = useRef<Record<number, SikunAnnotation[]>>({});
  sikunAnnotationsRef.current = sikunAnnotations;

  // App-level fullscreen (hides the top bar to maximize canvas area)
  const [isAppFullscreen, setIsAppFullscreen] = useState(false);

  // Photo-to-PDF
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [photoThumbs, setPhotoThumbs] = useState<string[]>([]);
  const [photoRotations, setPhotoRotations] = useState<number[]>([]);
  const [isConvertingPDF, setIsConvertingPDF] = useState(false);

  // Canvas & DOM refs
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null);
  const pdfDocRef = useRef<PDFDocumentProxy | null>(null);
  pdfDocRef.current = pdfDoc;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const blobUrlRef = useRef('');
  const drawingRef = useRef<{ x: number; y: number } | null>(null);
  const currentPenPathRef = useRef<Array<{ x: number; y: number }>>([]);
  const photoThumbsRef = useRef<string[]>([]);
  photoThumbsRef.current = photoThumbs;

  // Stable refs for overlay drawing callbacks
  const annotationsRef = useRef(annotations);
  const scaleRef = useRef(ZOOM_LEVELS[DEFAULT_ZOOM_INDEX]);
  const currentPageRef = useRef(1);
  const annotationModeRef = useRef<AnnMode>('none');
  const hlColorRef = useRef(HL_COLORS[0]);
  const penColorRef = useRef(PEN_COLORS[5]);
  const penWidthRef = useRef(PEN_WIDTHS[1]);

  annotationsRef.current = annotations;
  scaleRef.current = ZOOM_LEVELS[zoomIndex];
  currentPageRef.current = currentPage;
  annotationModeRef.current = annotationMode;
  hlColorRef.current = HL_COLORS[hlColorIdx];
  penColorRef.current = PEN_COLORS[penColorIdx];
  penWidthRef.current = PEN_WIDTHS[penWidthIdx];

  const scale = ZOOM_LEVELS[zoomIndex];
  const hasPDF = pdfDoc !== null;

  // ---- PDF loading ----
  const loadPDF = useCallback(async (url: string, originalUrl: string) => {
    setIsLoading(true);
    setError('');
    setPdfDoc(null);
    setCurrentPage(1);
    setTotalPages(0);
    setOpenUrl(originalUrl);
    setAnnotations({});
    if (renderTaskRef.current) { renderTaskRef.current.cancel(); renderTaskRef.current = null; }
    try {
      const doc = await pdfjs.getDocument(url).promise;
      setPdfDoc(doc);
      setTotalPages(doc.numPages);
    } catch (e) {
      if ((e as Error)?.name !== 'RenderingCancelledException')
        setError('PDFを読み込めませんでした。URLを確認するか、ファイルを直接アップロードしてください。');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = inputUrl.trim();
    if (!trimmed) return;
    loadPDF(`/api/pdf-proxy?url=${encodeURIComponent(trimmed)}`, trimmed);
    setInputUrl('');
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    const url = URL.createObjectURL(file);
    blobUrlRef.current = url;
    loadPDF(url, url);
    e.target.value = '';
  };

  const closePDF = () => {
    renderTaskRef.current?.cancel();
    renderTaskRef.current = null;
    setPdfDoc(null); setCurrentPage(1); setTotalPages(0);
    setError(''); setIsLoading(false); setTimerRunning(false);
    setOpenUrl(''); setAnnotations({}); setAnnotationMode('none');
    setTextInputPos(null); setShowComments(false); setSikunAnnotations({});
  };

  // ---- Overlay drawing ----
  const drawOverlay = useCallback(() => {
    const overlay = overlayCanvasRef.current;
    const canvas = canvasRef.current;
    if (!overlay || !canvas || canvas.width === 0) return;

    overlay.width = canvas.width;
    overlay.height = canvas.height;
    const ctx = overlay.getContext('2d')!;
    ctx.clearRect(0, 0, overlay.width, overlay.height);

    const sc = scaleRef.current;
    const page = currentPageRef.current;
    const anns = annotationsRef.current[page] || [];

    for (const ann of anns) {
      if (ann.type === 'highlight') {
        ctx.fillStyle = ann.color;
        ctx.fillRect(ann.x * sc, ann.y * sc, ann.w * sc, ann.h * sc);
      } else if (ann.type === 'pen') {
        if (ann.points.length < 2) continue;
        drawSmoothPath(ctx, ann.points, sc);
        ctx.strokeStyle = ann.color;
        ctx.lineWidth = ann.lineWidth * sc;
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.stroke();
      } else if (ann.type === 'line') {
        ctx.beginPath();
        ctx.moveTo(ann.x1 * sc, ann.y1 * sc);
        ctx.lineTo(ann.x2 * sc, ann.y2 * sc);
        ctx.strokeStyle = ann.color;
        ctx.lineWidth = ann.lineWidth * sc;
        ctx.lineCap = 'round';
        ctx.stroke();
      }
      // 'text' type is rendered as HTML overlay, not on canvas
    }

    // ── Sikun AI annotations ──────────────────────────────────────────────────
    const sikunAnns = sikunAnnotationsRef.current[currentPageRef.current] || [];
    const W = overlay.width;
    const H = overlay.height;
    const INDIGO = '#6366f1';
    const INDIGO_HL = 'rgba(99,102,241,0.28)';

    for (const ann of sikunAnns) {
      const color = ann.color || INDIGO;
      const x0 = ann.x0 * W;
      const y0 = ann.y0 * H;
      const x1 = (ann.x1 ?? ann.x0) * W;
      const y1 = (ann.y1 ?? ann.y0) * H;

      if (ann.type === 'highlight') {
        ctx.fillStyle = ann.color ? ann.color + '55' : INDIGO_HL;
        ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
        // thin border so the box is visible
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
      } else if (ann.type === 'underline') {
        ctx.beginPath();
        ctx.moveTo(x0, y1);
        ctx.lineTo(x1, y1);
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.5;
        ctx.lineCap = 'round';
        ctx.stroke();
      } else if (ann.type === 'arrow') {
        const dx = x1 - x0; const dy = y1 - y0;
        const angle = Math.atan2(dy, dx);
        const headLen = 14;
        ctx.beginPath();
        ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
        ctx.moveTo(x1, y1);
        ctx.lineTo(x1 - headLen * Math.cos(angle - 0.42), y1 - headLen * Math.sin(angle - 0.42));
        ctx.moveTo(x1, y1);
        ctx.lineTo(x1 - headLen * Math.cos(angle + 0.42), y1 - headLen * Math.sin(angle + 0.42));
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.5;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();
      } else if (ann.type === 'text') {
        // Draw a label bubble at (x0, y0)
        const label = ann.text || '';
        const fontSize = Math.max(12, Math.round(H * 0.022));
        ctx.font = `700 ${fontSize}px -apple-system, sans-serif`;
        const tw = ctx.measureText(label).width;
        const padX = 8; const padY = 5;
        const bw = tw + padX * 2; const bh = fontSize + padY * 2;
        // position bubble so it doesn't fall off edges
        const bx = Math.min(x0, W - bw - 4);
        const by = Math.max(4, y0 - bh - 6);
        // background
        ctx.fillStyle = INDIGO;
        ctx.beginPath();
        ctx.roundRect?.(bx, by, bw, bh, 6);
        ctx.fill();
        // text
        ctx.fillStyle = '#fff';
        ctx.fillText(label, bx + padX, by + padY + fontSize * 0.82);
        // tail triangle
        ctx.beginPath();
        ctx.moveTo(Math.min(x0 + 4, W - 4), by + bh);
        ctx.lineTo(Math.min(x0 + 14, W - 4), by + bh);
        ctx.lineTo(Math.min(x0 + 4, W - 4), by + bh + 8);
        ctx.closePath();
        ctx.fillStyle = INDIGO;
        ctx.fill();
      }
    }
  }, []);

  // ---- Page rendering ----
  useEffect(() => {
    if (!pdfDoc || !canvasRef.current) return;
    let cancelled = false;
    const render = async () => {
      renderTaskRef.current?.cancel();
      renderTaskRef.current = null;
      try {
        const page = await pdfDoc.getPage(currentPage);
        if (cancelled) return;
        const dpr = window.devicePixelRatio || 1;
        const logicalViewport = page.getViewport({ scale });
        const physicalViewport = page.getViewport({ scale: scale * dpr });
        const canvas = canvasRef.current!;
        const ctx = canvas.getContext('2d')!;
        canvas.width = physicalViewport.width;
        canvas.height = physicalViewport.height;
        canvas.style.width = `${logicalViewport.width}px`;
        const task = page.render({ canvasContext: ctx, viewport: physicalViewport });
        renderTaskRef.current = task;
        await task.promise;
        renderTaskRef.current = null;
        if (!cancelled) setOverlayVersion(v => v + 1);
      } catch (e) {
        if ((e as Error)?.name !== 'RenderingCancelledException') console.error('render error:', e);
      }
    };
    render();
    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
      renderTaskRef.current = null;
    };
  }, [pdfDoc, currentPage, scale]);

  // Expose the current page (and a full-document renderer) to the floating
  // sikun while a PDF is open. Both run on demand — sikun only calls them
  // when an action explicitly needs the image(s), never on every message.
  useEffect(() => {
    if (!hasPDF) { registerPdfProvider(null); return; }

    const getCurrentPage = () => {
      const canvas = canvasRef.current;
      if (!canvas || canvas.width === 0) return null;
      try {
        const maxEdge = 1600;
        const longEdge = Math.max(canvas.width, canvas.height);
        let src: HTMLCanvasElement = canvas;
        if (longEdge > maxEdge) {
          const r = maxEdge / longEdge;
          const tmp = document.createElement('canvas');
          tmp.width = Math.round(canvas.width * r);
          tmp.height = Math.round(canvas.height * r);
          tmp.getContext('2d')!.drawImage(canvas, 0, 0, tmp.width, tmp.height);
          src = tmp;
        }
        return {
          imageBase64: src.toDataURL('image/jpeg', 0.85).split(',')[1],
          page: currentPageRef.current,
          total: totalPages,
        };
      } catch {
        return null;
      }
    };

    const getAllPages = async (maxPages: number) => {
      const doc = pdfDocRef.current;
      if (!doc) return null;
      const total = doc.numPages;
      const n = Math.min(total, maxPages);
      const images: string[] = [];
      for (let i = 1; i <= n; i++) {
        try {
          const page = await doc.getPage(i);
          const vp = page.getViewport({ scale: 1.3 });
          const cv = document.createElement('canvas');
          cv.width = vp.width; cv.height = vp.height;
          await page.render({ canvasContext: cv.getContext('2d')!, viewport: vp }).promise;
          images.push(cv.toDataURL('image/jpeg', 0.78).split(',')[1]);
        } catch { /* skip a failed page */ }
      }
      return { images, total, truncated: n < total };
    };

    const annotator = (anns: SikunAnnotation[], page: number) => {
      setSikunAnnotations(prev => ({
        ...prev,
        [page]: [...(prev[page] || []), ...anns],
      }));
      setOverlayVersion(v => v + 1);
    };

    registerPdfProvider(getCurrentPage, getAllPages);
    registerPdfAnnotator(annotator);
    return () => { registerPdfProvider(null); registerPdfAnnotator(null); };
  }, [hasPDF, totalPages]);

  // Overlay redraw when annotations or page version changes
  useEffect(() => { drawOverlay(); }, [overlayVersion, annotations, sikunAnnotations, drawOverlay]);

  // Keyboard navigation
  useEffect(() => {
    if (!hasPDF) return;
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown')
        setCurrentPage(p => Math.min(totalPages, p + 1));
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp')
        setCurrentPage(p => Math.max(1, p - 1));
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [hasPDF, totalPages]);

  // Cleanup blob URLs
  useEffect(() => () => {
    if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    photoThumbsRef.current.forEach(t => URL.revokeObjectURL(t));
  }, []);

  // Timer
  useEffect(() => {
    if (!timerRunning) return;
    const id = setInterval(() => {
      setTimerSeconds(prev => {
        if (timerMode === 'countdown') {
          if (prev <= 1) {
            setTimerRunning(false); setTimerAlert(true); playBeep();
            setTimeout(() => setTimerAlert(false), 3000);
            return 0;
          }
          return prev - 1;
        }
        return prev + 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [timerRunning, timerMode]);

  const formatTime = (s: number) => {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return h > 0
      ? `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`
      : `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  };
  const switchTimerMode = (mode: 'stopwatch' | 'countdown') => {
    setTimerMode(mode); setTimerSeconds(0); setTimerRunning(false); setTimerAlert(false);
  };
  const startCountdown = () => {
    setTimerSeconds(timerInput * 60); setTimerRunning(true);
    setTimerAlert(false); setTimerCollapsed(true);
  };
  const resetTimer = () => { setTimerSeconds(0); setTimerRunning(false); setTimerAlert(false); };

  // ---- Annotation pointer events ----
  // Returns canvas physical pixel coords (for canvas drawing ops)
  const getOverlayPos = (clientX: number, clientY: number) => {
    const o = overlayCanvasRef.current!;
    const r = o.getBoundingClientRect();
    return {
      x: (clientX - r.left) * (o.width / r.width),
      y: (clientY - r.top)  * (o.height / r.height),
    };
  };
  // Returns CSS pixel coords relative to canvas top-left (for HTML annotations)
  const getOverlayCssPos = (clientX: number, clientY: number) => {
    const o = overlayCanvasRef.current!;
    const r = o.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const mode = annotationModeRef.current;
    if (mode === 'none') return;

    if (mode === 'text') {
      const css = getOverlayCssPos(e.clientX, e.clientY);
      const sc = scaleRef.current;
      setTextInputPos({ x: css.x / sc, y: css.y / sc, screenX: css.x, screenY: css.y });
      setTextInputValue('');
      return;
    }

    (e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId);
    const pos = getOverlayPos(e.clientX, e.clientY);
    drawingRef.current = pos;
    if (mode === 'pen') {
      const sc = scaleRef.current;
      currentPenPathRef.current = [{ x: pos.x / sc, y: pos.y / sc }];
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const mode = annotationModeRef.current;
    if (!drawingRef.current || (mode !== 'highlight' && mode !== 'pen' && mode !== 'line')) return;
    const pos = getOverlayPos(e.clientX, e.clientY);
    const overlay = overlayCanvasRef.current!;
    const ctx = overlay.getContext('2d')!;
    const sc = scaleRef.current;

    if (mode === 'highlight') {
      drawOverlay();
      ctx.fillStyle = hlColorRef.current;
      const { x: sx, y: sy } = drawingRef.current;
      ctx.fillRect(sx, sy, pos.x - sx, pos.y - sy);
    } else if (mode === 'pen') {
      currentPenPathRef.current.push({ x: pos.x / sc, y: pos.y / sc });
      drawOverlay();
      const pts = currentPenPathRef.current;
      if (pts.length >= 2) {
        drawSmoothPath(ctx, pts, sc);
        ctx.strokeStyle = penColorRef.current;
        ctx.lineWidth = penWidthRef.current * sc;
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.stroke();
      }
    } else if (mode === 'line') {
      drawOverlay();
      const { x: sx, y: sy } = drawingRef.current;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(pos.x, pos.y);
      ctx.strokeStyle = penColorRef.current;
      ctx.lineWidth = penWidthRef.current * sc;
      ctx.lineCap = 'round';
      ctx.stroke();
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const mode = annotationModeRef.current;
    if (!drawingRef.current || (mode !== 'highlight' && mode !== 'pen' && mode !== 'line')) return;
    const pos = getOverlayPos(e.clientX, e.clientY);
    const sc = scaleRef.current;
    const pg = currentPageRef.current;

    if (mode === 'highlight') {
      const { x: sx, y: sy } = drawingRef.current;
      drawingRef.current = null;
      const x = Math.min(sx, pos.x), y = Math.min(sy, pos.y);
      const w = Math.abs(pos.x - sx), h = Math.abs(pos.y - sy);
      if (w >= 5 && h >= 5) {
        const ann: AnnotationItem = { id: Date.now().toString(), type: 'highlight',
          x: x/sc, y: y/sc, w: w/sc, h: h/sc, color: hlColorRef.current };
        setAnnotations(prev => ({ ...prev, [pg]: [...(prev[pg]||[]), ann] }));
      } else { drawOverlay(); }
    } else if (mode === 'pen') {
      drawingRef.current = null;
      const pts = currentPenPathRef.current;
      currentPenPathRef.current = [];
      if (pts.length >= 2) {
        const ann: AnnotationItem = { id: Date.now().toString(), type: 'pen',
          points: pts, color: penColorRef.current, lineWidth: penWidthRef.current };
        setAnnotations(prev => ({ ...prev, [pg]: [...(prev[pg]||[]), ann] }));
      } else { drawOverlay(); }
    } else if (mode === 'line') {
      const { x: sx, y: sy } = drawingRef.current;
      drawingRef.current = null;
      const dx = pos.x - sx, dy = pos.y - sy;
      if (Math.sqrt(dx*dx + dy*dy) >= 8) {
        const ann: AnnotationItem = { id: Date.now().toString(), type: 'line',
          x1: sx/sc, y1: sy/sc, x2: pos.x/sc, y2: pos.y/sc,
          color: penColorRef.current, lineWidth: penWidthRef.current };
        setAnnotations(prev => ({ ...prev, [pg]: [...(prev[pg]||[]), ann] }));
      } else { drawOverlay(); }
    }
  };

  const handlePointerCancel = () => {
    drawingRef.current = null;
    currentPenPathRef.current = [];
    drawOverlay();
  };

  // ---- Text annotation helpers ----
  const confirmTextAnnotation = () => {
    if (!textInputPos || !textInputValue.trim()) { setTextInputPos(null); return; }
    const pg = currentPageRef.current;
    const ann: AnnotationItem = {
      id: Date.now().toString(), type: 'text',
      x: textInputPos.x, y: textInputPos.y,
      text: textInputValue.trim(),
      color: penColorRef.current,
    };
    setAnnotations(prev => ({ ...prev, [pg]: [...(prev[pg]||[]), ann] }));
    setTextInputPos(null);
    setTextInputValue('');
  };
  const cancelTextAnnotation = () => { setTextInputPos(null); setTextInputValue(''); };
  const deleteAnnotation = (id: string) => {
    const pg = currentPageRef.current;
    setAnnotations(prev => ({ ...prev, [pg]: (prev[pg]||[]).filter(a => a.id !== id) }));
  };

  const clearPageAnnotations = () => {
    setAnnotations(prev => { const n = {...prev}; delete n[currentPage]; return n; });
  };

  const undoLastAnnotation = () => {
    setAnnotations(prev => {
      const pg = currentPageRef.current;
      const list = prev[pg] || [];
      if (list.length === 0) return prev;
      return { ...prev, [pg]: list.slice(0, -1) };
    });
  };

  // ---- Photo-to-PDF ----
  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const thumbs = files.map(f => URL.createObjectURL(f));
    setPhotoFiles(prev => [...prev, ...files]);
    setPhotoThumbs(prev => [...prev, ...thumbs]);
    setPhotoRotations(prev => [...prev, ...files.map(() => 0)]);
    e.target.value = '';
  };

  const removePhoto = (idx: number) => {
    URL.revokeObjectURL(photoThumbs[idx]);
    setPhotoFiles(prev => prev.filter((_, i) => i !== idx));
    setPhotoThumbs(prev => prev.filter((_, i) => i !== idx));
    setPhotoRotations(prev => prev.filter((_, i) => i !== idx));
  };

  const rotatePhoto = (idx: number) => {
    setPhotoRotations(prev => prev.map((r, i) => (i === idx ? (r + 90) % 360 : r)));
  };

  const handleCreatePDF = async () => {
    if (!photoFiles.length) return;
    setIsConvertingPDF(true);
    try {
      const pdfUrl = await imagesToPDFUrl(photoFiles, photoRotations);
      photoThumbs.forEach(t => URL.revokeObjectURL(t));
      setPhotoFiles([]); setPhotoThumbs([]); setPhotoRotations([]);
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = pdfUrl;
      await loadPDF(pdfUrl, pdfUrl);
    } catch (err) {
      console.error('PDF creation failed:', err);
    } finally {
      setIsConvertingPDF(false);
    }
  };

  // ========== VIEWER ==========
  if (isLoading || hasPDF || error) {
    return (
      <div className={`pdf-fullscreen${embedded ? ' embedded' : ''}${timerAlert ? ' timer-alert' : ''}${isAppFullscreen ? ' app-fullscreen' : ''}`}>
        {/* Top bar */}
        {!isAppFullscreen && <div className="pdf-top-bar">
          <button className="pdf-text-btn" onClick={closePDF}>
            <X size={16} /><span>閉じる</span>
          </button>
          <div className="pdf-nav-group">
            <button className="pdf-icon-btn" onClick={() => setCurrentPage(p => Math.max(1, p-1))} disabled={currentPage <= 1 || !hasPDF} title="前のページ (←)">
              <ChevronLeft size={20} />
            </button>
            <span className="pdf-page-label">{hasPDF ? `${currentPage} / ${totalPages}` : '–'}</span>
            <button className="pdf-icon-btn" onClick={() => setCurrentPage(p => Math.min(totalPages, p+1))} disabled={currentPage >= totalPages || !hasPDF} title="次のページ (→)">
              <ChevronRight size={20} />
            </button>
          </div>
          <div className="pdf-zoom-group">
            <button className="pdf-icon-btn" onClick={() => setZoomIndex(i => Math.max(0, i-1))} disabled={zoomIndex === 0} title="縮小">
              <ZoomOut size={18} />
            </button>
            <span className="pdf-zoom-label">{Math.round(scale * 100)}%</span>
            <button className="pdf-icon-btn" onClick={() => setZoomIndex(i => Math.min(ZOOM_LEVELS.length-1, i+1))} disabled={zoomIndex === ZOOM_LEVELS.length-1} title="拡大">
              <ZoomIn size={18} />
            </button>
          </div>
          <div className="pdf-bar-right">
            <button className={`pdf-icon-btn${annotationMode === 'highlight' ? ' active' : ''}`} onClick={() => setAnnotationMode(m => m === 'highlight' ? 'none' : 'highlight')} title="ハイライト">
              <Highlighter size={18} />
            </button>
            <button className={`pdf-icon-btn${annotationMode === 'pen' ? ' active' : ''}`} onClick={() => setAnnotationMode(m => m === 'pen' ? 'none' : 'pen')} title="ペン手書き">
              <Pencil size={18} />
            </button>
            <button className={`pdf-icon-btn${showTimer ? ' active' : ''}`} onClick={() => { setShowTimer(v => !v); setTimerCollapsed(false); }} title="タイマー">
              <Clock size={18} />
            </button>
            {openUrl && (
              <a href={openUrl} target="_blank" rel="noopener noreferrer" className="pdf-icon-btn" title="新しいタブで開く">
                <ExternalLink size={18} />
              </a>
            )}
            <button className="pdf-icon-btn" onClick={() => setIsAppFullscreen(true)} title="全画面表示">
              <Maximize2 size={18} />
            </button>
          </div>
        </div>}

        {/* Fullscreen exit button + floating nav */}
        {isAppFullscreen && (
          <>
            <button className="pdf-fullscreen-exit" onClick={() => setIsAppFullscreen(false)} title="全画面を終了">
              <Minimize2 size={20} />
            </button>
            {hasPDF && (
              <div className="pdf-fs-nav">
                <button className="pdf-fs-nav-btn" onClick={() => setCurrentPage(p => Math.max(1, p-1))} disabled={currentPage <= 1}>
                  <ChevronLeft size={18} />
                </button>
                <span className="pdf-fs-nav-label">{currentPage} / {totalPages}</span>
                <button className="pdf-fs-nav-btn" onClick={() => setCurrentPage(p => Math.min(totalPages, p+1))} disabled={currentPage >= totalPages}>
                  <ChevronRight size={18} />
                </button>
                <button className="pdf-fs-nav-btn" onClick={() => setZoomIndex(i => Math.max(0, i-1))} disabled={zoomIndex === 0} title="縮小">
                  <ZoomOut size={16} />
                </button>
                <span className="pdf-fs-nav-label">{Math.round(scale * 100)}%</span>
                <button className="pdf-fs-nav-btn" onClick={() => setZoomIndex(i => Math.min(ZOOM_LEVELS.length-1, i+1))} disabled={zoomIndex === ZOOM_LEVELS.length-1} title="拡大">
                  <ZoomIn size={16} />
                </button>
              </div>
            )}
          </>
        )}

        {/* Annotation toolbar */}
        {annotationMode !== 'none' && (
          <div className="annotation-bar">
            {/* Tool selector */}
            <div className="ann-tool-group">
              <button className={`ann-tool-btn${annotationMode === 'highlight' ? ' active hl' : ''}`}
                onClick={() => setAnnotationMode('highlight')} title="ハイライト">
                <Highlighter size={14} />
                <span>HL</span>
              </button>
              <button className={`ann-tool-btn${annotationMode === 'pen' ? ' active pen' : ''}`}
                onClick={() => setAnnotationMode('pen')} title="ペン">
                <Pencil size={14} />
                <span>ペン</span>
              </button>
              <button className={`ann-tool-btn${annotationMode === 'line' ? ' active pen' : ''}`}
                onClick={() => setAnnotationMode('line')} title="直線">
                <Minus size={14} />
                <span>直線</span>
              </button>
              <button className={`ann-tool-btn${annotationMode === 'text' ? ' active text' : ''}`}
                onClick={() => setAnnotationMode('text')} title="テキストコメント">
                <MessageSquare size={14} />
                <span>メモ</span>
              </button>
            </div>

            {/* Color swatches (HL mode) */}
            {annotationMode === 'highlight' && (
              <div className="color-swatches">
                {HL_COLORS.map((c, i) => (
                  <button key={c} className={`color-swatch${hlColorIdx === i ? ' active' : ''}`}
                    style={{ background: c.replace('80','dd') }} onClick={() => setHlColorIdx(i)} />
                ))}
              </div>
            )}

            {/* Color + width (pen / line / text modes) */}
            {(annotationMode === 'pen' || annotationMode === 'line' || annotationMode === 'text') && (
              <>
                <div className="color-swatches">
                  {PEN_COLORS.map((c, i) => (
                    <button key={c} className={`color-swatch${penColorIdx === i ? ' active' : ''}`}
                      style={{ background: c }} onClick={() => setPenColorIdx(i)} />
                  ))}
                </div>
                {annotationMode !== 'text' && (
                  <div className="pen-widths">
                    {PEN_WIDTHS.map((w, i) => (
                      <button key={w} className={`pen-width-btn${penWidthIdx === i ? ' active' : ''}`}
                        onClick={() => setPenWidthIdx(i)} title={['細','中','太'][i]}>
                        <span className="pen-dot" style={{ width: 4+i*4, height: 4+i*4, background: PEN_COLORS[penColorIdx] }} />
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}

            {/* Text mode hint */}
            {annotationMode === 'text' && (
              <span className="ann-hint">📍 PDFをタップしてメモを追加</span>
            )}

            {/* Comments toggle */}
            {(annotations[currentPage]||[]).some(a => a.type === 'text') && (
              <button className="ann-comments-toggle" onClick={() => setShowComments(v => !v)}>
                <MessageSquare size={13} />
                {(annotations[currentPage]||[]).filter(a => a.type === 'text').length}件
                {showComments ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              </button>
            )}

            <div className="ann-actions">
              <button className="ann-action-btn undo-btn" onClick={undoLastAnnotation} title="元に戻す">↩</button>
              <button className="ann-action-btn clear-btn" onClick={clearPageAnnotations} title="このページを消去">
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        )}

        {/* Comments list panel */}
        {showComments && annotationMode !== 'none' && (
          <div className="comments-panel">
            {(annotations[currentPage]||[]).filter((a): a is TextAnn => a.type === 'text').map(ann => (
              <div key={ann.id} className="comment-item">
                <span className="comment-dot" style={{ background: ann.color }} />
                <span className="comment-text">{ann.text}</span>
                <button className="comment-del" onClick={() => deleteAnnotation(ann.id)} title="削除">
                  <X size={11} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Timer */}
        {showTimer && (
          timerCollapsed ? (
            <button className={`timer-panel timer-panel-collapsed${timerAlert ? ' alert' : ''}`}
              onClick={() => setTimerCollapsed(false)} title="タイマーを展開">
              <span className="timer-display-mini">{formatTime(timerSeconds)}</span>
              {timerRunning && <span className="timer-running-dot" />}
            </button>
          ) : (
            <div className="timer-panel">
              <div className="timer-panel-header">
                <div className="timer-mode-tabs">
                  <button className={`timer-tab${timerMode === 'stopwatch' ? ' active' : ''}`} onClick={() => switchTimerMode('stopwatch')}>ストップウォッチ</button>
                  <button className={`timer-tab${timerMode === 'countdown' ? ' active' : ''}`} onClick={() => switchTimerMode('countdown')}>カウントダウン</button>
                </div>
                <button className="timer-collapse-btn" onClick={() => setTimerCollapsed(true)}><ChevronLeft size={16} />しまう</button>
              </div>
              <div className="timer-display">{formatTime(timerSeconds)}</div>
              {timerMode === 'countdown' && !timerRunning && timerSeconds === 0 && (
                <div className="timer-input-row">
                  <input type="number" className="timer-input" value={timerInput} min={1} max={180}
                    onChange={e => setTimerInput(Math.max(1, parseInt(e.target.value)||1))} />
                  <span className="timer-unit">分</span>
                </div>
              )}
              <div className="timer-controls">
                {timerMode === 'countdown' && !timerRunning && timerSeconds === 0 ? (
                  <button className="timer-btn start" onClick={startCountdown}><Play size={14} /> 開始</button>
                ) : (
                  <>
                    <button className={`timer-btn${timerRunning ? ' pause' : ' start'}`}
                      onClick={() => { setTimerRunning(v => !v); if (!timerRunning) setTimerCollapsed(true); }}>
                      {timerRunning ? <Pause size={14} /> : <Play size={14} />}
                      {timerRunning ? '一時停止' : '再開'}
                    </button>
                    <button className="timer-btn reset" onClick={resetTimer}><RotateCcw size={14} /> リセット</button>
                  </>
                )}
              </div>
            </div>
          )
        )}

        {/* Canvas area — stable centering */}
        <div className="pdf-canvas-area">
          {isLoading && (
            <div className="pdf-status">
              <div className="pdf-spinner" /><span>読み込み中...</span>
            </div>
          )}
          {error && (
            <div className="pdf-status pdf-error">
              <FileText size={40} opacity={0.4} />
              <p>{error}</p>
              <button className="pdf-text-btn" onClick={closePDF}>戻る</button>
            </div>
          )}
          {!isLoading && !error && (
            <div className="pdf-canvas-wrapper">
              <canvas ref={canvasRef} className="pdf-canvas" />
              <canvas
                ref={overlayCanvasRef}
                className={`pdf-overlay${annotationMode !== 'none' ? ' drawing' : ''}${annotationMode === 'text' ? ' text-mode' : ''}`}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerCancel}
              />

              {/* HTML overlay: text annotation bubbles */}
              <div className="text-ann-layer">
                {(annotations[currentPage]||[]).filter((a): a is TextAnn => a.type === 'text').map(ann => (
                  <div
                    key={ann.id}
                    className="text-ann-bubble"
                    style={{ left: ann.x * scale, top: ann.y * scale }}
                  >
                    <div className="text-ann-inner" style={{ borderColor: ann.color, color: '#5c3d11' }}>
                      {ann.text}
                      <button className="text-ann-del" onClick={() => deleteAnnotation(ann.id)} title="削除">
                        <X size={10} />
                      </button>
                    </div>
                    <div className="text-ann-tail" style={{ borderTopColor: ann.color }} />
                  </div>
                ))}
              </div>

              {/* Text annotation input popup */}
              {textInputPos && (
                <div
                  className="text-ann-input-popup"
                  style={{
                    left: Math.min(textInputPos.screenX, Math.max(0, (overlayCanvasRef.current?.getBoundingClientRect().width ?? 300) - 220)),
                    top: Math.max(0, textInputPos.screenY - 120),
                  }}
                  onClick={e => e.stopPropagation()}
                >
                  <div className="text-ann-popup-header">
                    <MessageSquare size={13} />
                    <span>コメントを追加</span>
                  </div>
                  <textarea
                    className="text-ann-textarea"
                    value={textInputValue}
                    onChange={e => setTextInputValue(e.target.value)}
                    placeholder="コメントを入力..."
                    rows={3}
                    autoFocus
                    onKeyDown={e => {
                      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); confirmTextAnnotation(); }
                      if (e.key === 'Escape') cancelTextAnnotation();
                    }}
                  />
                  <div className="text-ann-popup-actions">
                    <button className="text-ann-cancel" onClick={cancelTextAnnotation}>キャンセル</button>
                    <button
                      className="text-ann-ok"
                      onClick={confirmTextAnnotation}
                      disabled={!textInputValue.trim()}
                      style={{ background: penColorRef.current }}
                    >
                      追加
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <style jsx>{`
          .pdf-fullscreen {
            position: fixed; top:0; left:0; right:0; bottom:0;
            height: 100dvh; z-index: 3001;
            display: flex; flex-direction: column;
            background: #525659;
          }
          .pdf-fullscreen.embedded {
            position: absolute; inset: 0;
            height: 100%; z-index: auto;
          }
          /* App fullscreen lifts above the bottom nav (3000) so the PDF
             fills the screen, but stays below the floating sikun (9999)
             so sikun remains visible and usable in fullscreen. */
          .pdf-fullscreen.app-fullscreen { z-index: 5000; }
          .pdf-fullscreen.timer-alert { animation: alertFlash 0.5s ease 3; }
          @keyframes alertFlash {
            0%,100% { box-shadow:none; }
            50% { box-shadow: inset 0 0 0 6px rgba(239,68,68,0.7); }
          }
          .pdf-top-bar {
            height: 52px; background: var(--background);
            border-bottom: 1px solid var(--border);
            display: flex; align-items: center; gap: 4px;
            padding: 0 8px; flex-shrink: 0;
            overflow-x: auto; scrollbar-width: none;
          }
          .pdf-top-bar::-webkit-scrollbar { display:none; }
          .pdf-text-btn {
            display:flex; align-items:center; gap:5px; padding:6px 10px;
            background:transparent; color:var(--foreground);
            font-size:0.85rem; font-weight:600; border-radius:8px;
            white-space:nowrap; cursor:pointer; transition:background 0.15s;
          }
          .pdf-text-btn:hover { background:var(--accent); }
          .pdf-icon-btn {
            width:36px; height:36px; display:flex; align-items:center;
            justify-content:center; background:transparent; color:var(--foreground);
            border-radius:8px; text-decoration:none; flex-shrink:0;
            cursor:pointer; transition:background 0.15s;
          }
          .pdf-icon-btn:hover { background:var(--accent); }
          .pdf-icon-btn:disabled { opacity:0.3; cursor:default; }
          .pdf-icon-btn.active { background:var(--primary); color:white; }
          .pdf-nav-group, .pdf-zoom-group { display:flex; align-items:center; gap:2px; }
          .pdf-page-label, .pdf-zoom-label {
            font-size:0.8rem; font-weight:600; color:var(--foreground);
            min-width:52px; text-align:center; white-space:nowrap;
          }
          .pdf-bar-right {
            margin-left:auto; display:flex; align-items:center; gap:2px; flex-shrink:0;
          }
          /* App-level fullscreen exit button */
          .pdf-fullscreen-exit {
            position:absolute; top:12px; right:12px; z-index:10;
            width:40px; height:40px; border-radius:50%;
            background:rgba(0,0,0,0.5); color:#fff;
            display:flex; align-items:center; justify-content:center;
            cursor:pointer; backdrop-filter:blur(4px);
            transition:background 0.15s;
          }
          .pdf-fullscreen-exit:hover { background:rgba(0,0,0,0.75); }
          /* Floating nav bar in app fullscreen */
          .pdf-fs-nav {
            position:absolute; bottom:20px; left:50%; transform:translateX(-50%);
            z-index:10; display:flex; align-items:center; gap:4px;
            background:rgba(0,0,0,0.55); color:#fff; border-radius:999px;
            padding:6px 14px; backdrop-filter:blur(8px);
          }
          .pdf-fs-nav-btn {
            width:32px; height:32px; display:flex; align-items:center; justify-content:center;
            background:transparent; color:#fff; border-radius:8px; cursor:pointer;
            transition:background 0.15s;
          }
          .pdf-fs-nav-btn:hover { background:rgba(255,255,255,0.15); }
          .pdf-fs-nav-btn:disabled { opacity:0.3; cursor:default; }
          .pdf-fs-nav-label { font-size:0.82rem; font-weight:600; min-width:36px; text-align:center; color:#fff; }
          /* Annotation bar */
          .annotation-bar {
            background:var(--background); border-bottom:1px solid var(--border);
            padding:6px 10px; display:flex; align-items:center;
            gap:8px; flex-shrink:0; flex-wrap:wrap;
          }
          .ann-tool-group { display:flex; gap:3px; background:var(--accent); border-radius:10px; padding:3px; }
          .ann-tool-btn {
            display:flex; align-items:center; gap:3px;
            padding:4px 9px; border-radius:7px;
            font-size:0.72rem; font-weight:700;
            background:transparent; color:#888; cursor:pointer; transition:all 0.15s;
          }
          .ann-tool-btn:hover { background:var(--background); color:var(--foreground); }
          .ann-tool-btn.active.hl { background:#fef9c3; color:#854d0e; box-shadow:0 1px 4px rgba(0,0,0,.1); }
          .ann-tool-btn.active.pen { background:var(--background); color:var(--primary); box-shadow:0 1px 4px rgba(0,0,0,.1); }
          .ann-tool-btn.active.text { background:#eff6ff; color:#1d4ed8; box-shadow:0 1px 4px rgba(0,0,0,.1); }
          .color-swatches { display:flex; gap:5px; }
          .color-swatch {
            width:20px; height:20px; border-radius:50%;
            border:2px solid transparent; cursor:pointer;
            transition:transform 0.1s, border-color 0.1s;
          }
          .color-swatch:hover { transform:scale(1.15); }
          .color-swatch.active { border-color:var(--foreground); transform:scale(1.1); }
          .pen-widths { display:flex; gap:5px; align-items:center; }
          .pen-width-btn {
            width:28px; height:28px; display:flex; align-items:center;
            justify-content:center; background:transparent;
            border-radius:6px; cursor:pointer; transition:background 0.15s;
          }
          .pen-width-btn:hover { background:var(--accent); }
          .pen-width-btn.active { background:var(--accent); box-shadow:0 0 0 2px var(--primary); }
          .pen-dot { border-radius:50%; display:block; }
          .ann-hint { font-size:0.73rem; color:var(--primary); font-weight:600; opacity:0.8; }
          .ann-comments-toggle {
            display:flex; align-items:center; gap:4px;
            padding:4px 10px; border-radius:20px; font-size:0.74rem; font-weight:700;
            background:rgba(59,130,246,.1); color:#1d4ed8; border:1px solid rgba(59,130,246,.25);
            cursor:pointer; transition:all 0.15s;
          }
          .ann-comments-toggle:hover { background:rgba(59,130,246,.18); }
          .ann-actions { margin-left:auto; display:flex; gap:4px; }
          .ann-action-btn {
            display:flex; align-items:center; justify-content:center;
            padding:5px 8px; border-radius:7px; font-size:0.85rem;
            font-weight:700; cursor:pointer; transition:background 0.15s;
          }
          .undo-btn { background:transparent; color:var(--foreground); border:1px solid var(--border); }
          .undo-btn:hover { background:var(--accent); }
          .clear-btn { background:transparent; color:#f87171; border:1px solid var(--border); }
          .clear-btn:hover { background:rgba(248,113,113,0.1); }
          /* Comments list panel */
          .comments-panel {
            background:var(--background); border-bottom:1px solid var(--border);
            padding:6px 12px; display:flex; flex-direction:column; gap:5px;
            max-height:140px; overflow-y:auto; flex-shrink:0;
          }
          .comment-item {
            display:flex; align-items:flex-start; gap:7px;
            padding:5px 8px; background:var(--accent); border-radius:8px;
            border:1px solid var(--border);
          }
          .comment-dot { width:8px; height:8px; border-radius:50%; flex-shrink:0; margin-top:4px; }
          .comment-text { flex:1; font-size:0.78rem; color:var(--foreground); line-height:1.4; word-break:break-word; }
          .comment-del {
            flex-shrink:0; display:flex; align-items:center; justify-content:center;
            width:18px; height:18px; border-radius:50%;
            background:transparent; color:var(--fg-muted); cursor:pointer;
            transition:background 0.1s, color 0.1s;
          }
          .comment-del:hover { background:#fecaca; color:#ef4444; }
          /* Text annotation HTML layer */
          .text-ann-layer {
            position:absolute; top:0; left:0; width:100%; height:100%;
            pointer-events:none; overflow:visible;
          }
          .text-ann-bubble {
            position:absolute; pointer-events:auto; z-index:10;
            transform:translate(4px, -100%);
            filter:drop-shadow(0 2px 6px rgba(0,0,0,.2));
          }
          .text-ann-inner {
            position:relative;
            background:#fffde7;
            border:2px solid;
            border-radius:8px 8px 8px 2px;
            padding:5px 24px 5px 8px;
            font-size:0.75rem; line-height:1.45; font-weight:600;
            max-width:180px; word-break:break-word;
            box-shadow:2px 3px 0 rgba(0,0,0,.08);
          }
          .text-ann-del {
            position:absolute; top:-7px; right:-7px;
            width:17px; height:17px; border-radius:50%;
            background:#ef4444; color:#fff;
            display:flex; align-items:center; justify-content:center;
            cursor:pointer; opacity:0; transition:opacity 0.15s;
          }
          .text-ann-bubble:hover .text-ann-del { opacity:1; }
          .text-ann-tail {
            width:0; height:0;
            border-left:6px solid transparent;
            border-right:6px solid transparent;
            border-top:7px solid;
            margin-left:8px;
          }
          /* Text annotation input popup */
          .text-ann-input-popup {
            position:absolute; z-index:20;
            width:220px;
            background:var(--background); border:1px solid var(--border);
            border-radius:12px; padding:12px;
            box-shadow:0 8px 24px rgba(0,0,0,.18);
          }
          .text-ann-popup-header {
            display:flex; align-items:center; gap:6px;
            font-size:0.78rem; font-weight:700; color:var(--primary);
            margin-bottom:8px;
          }
          .text-ann-textarea {
            width:100%; background:var(--accent); border:1px solid var(--border);
            border-radius:8px; padding:7px 8px; font-size:0.82rem;
            color:var(--foreground); outline:none; resize:none; line-height:1.45;
            transition:border-color 0.15s;
          }
          .text-ann-textarea:focus { border-color:var(--primary); }
          .text-ann-popup-actions { display:flex; gap:6px; margin-top:8px; justify-content:flex-end; }
          .text-ann-cancel {
            padding:5px 12px; border-radius:7px; font-size:0.78rem; font-weight:700;
            background:var(--accent); color:var(--fg-muted); cursor:pointer; border:none;
            transition:background 0.15s;
          }
          .text-ann-cancel:hover { background:var(--border); }
          .text-ann-ok {
            padding:5px 14px; border-radius:7px; font-size:0.78rem; font-weight:700;
            color:#fff; cursor:pointer; border:none; transition:opacity 0.15s;
          }
          .text-ann-ok:disabled { opacity:0.45; cursor:default; }
          /* Cursor for text mode */
          .pdf-overlay.text-mode { cursor:text; }
          /* Timer */
          .timer-panel {
            background:var(--background); border-bottom:1px solid var(--border);
            padding:12px 16px; display:flex; flex-direction:column;
            align-items:center; gap:10px; flex-shrink:0;
          }
          .timer-panel-collapsed {
            background:var(--background); border-bottom:1px solid var(--border);
            padding:6px 16px; display:flex; align-items:center; gap:8px;
            flex-shrink:0; cursor:pointer; width:100%; text-align:left; transition:background 0.15s;
          }
          .timer-panel-collapsed:hover { background:var(--accent); }
          .timer-panel-collapsed.alert { animation:alertFlash 0.5s ease 3; }
          .timer-display-mini {
            font-size:1.3rem; font-weight:700; font-variant-numeric:tabular-nums;
            color:var(--foreground); letter-spacing:0.05em;
          }
          .timer-running-dot {
            width:7px; height:7px; border-radius:50%; background:#22c55e;
            animation:timerPulse 1s ease-in-out infinite;
          }
          @keyframes timerPulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
          .timer-panel-header {
            display:flex; align-items:center; gap:8px; width:100%; justify-content:space-between;
          }
          .timer-collapse-btn {
            display:flex; align-items:center; gap:3px; padding:4px 10px;
            border-radius:6px; font-size:0.78rem; font-weight:600; color:#888;
            background:transparent; cursor:pointer; transition:background 0.15s, color 0.15s; flex-shrink:0;
          }
          .timer-collapse-btn:hover { background:var(--accent); color:var(--foreground); }
          .timer-mode-tabs { display:flex; background:var(--accent); border-radius:8px; padding:3px; }
          .timer-tab {
            padding:5px 14px; border-radius:6px; font-size:0.8rem; font-weight:600;
            background:transparent; color:#888; cursor:pointer; transition:all 0.15s;
          }
          .timer-tab.active { background:var(--background); color:var(--primary); box-shadow:0 1px 4px rgba(0,0,0,0.1); }
          .timer-display {
            font-size:2.4rem; font-weight:700; font-variant-numeric:tabular-nums;
            color:var(--foreground); letter-spacing:0.05em;
          }
          .timer-input-row { display:flex; align-items:center; gap:6px; }
          .timer-input {
            width:64px; padding:6px 8px; background:var(--accent);
            border:1px solid var(--border); border-radius:8px;
            font-size:1rem; font-weight:700; text-align:center; color:var(--foreground); outline:none;
          }
          .timer-unit { font-size:0.9rem; color:#888; }
          .timer-controls { display:flex; gap:8px; }
          .timer-btn {
            display:flex; align-items:center; gap:5px; padding:7px 16px;
            border-radius:8px; font-size:0.85rem; font-weight:700;
            cursor:pointer; transition:opacity 0.15s;
          }
          .timer-btn.start { background:var(--primary); color:white; }
          .timer-btn.pause { background:#f59e0b; color:white; }
          .timer-btn.reset { background:var(--accent); color:var(--foreground); border:1px solid var(--border); }
          .timer-btn:hover { opacity:0.85; }
          /* Canvas — stable centering via scrollbar-gutter + text-align */
          .pdf-canvas-area {
            flex:1; overflow-y:auto; overflow-x:hidden; min-height:0;
            -webkit-overflow-scrolling:touch;
            touch-action: pan-y;
            overscroll-behavior-x: none;
            padding:16px;
            display:flex; justify-content:center; align-items:flex-start;
          }
          .pdf-canvas-wrapper {
            position:relative; max-width:100%; flex-shrink:0;
          }
          .pdf-canvas {
            display:block;
            max-width:100%; height:auto;
            box-shadow:0 4px 20px rgba(0,0,0,0.4);
          }
          .pdf-overlay {
            position:absolute; top:0; left:0;
            width:100%; height:100%;
            pointer-events:none; touch-action:none;
          }
          .pdf-overlay.drawing { pointer-events:auto; cursor:crosshair; }
          .pdf-status {
            display:flex; flex-direction:column; align-items:center;
            justify-content:center; gap:16px; color:#ccc;
            font-size:0.9rem; min-height:200px;
          }
          .pdf-error { color:#fca5a5; }
          .pdf-spinner {
            width:40px; height:40px;
            border:3px solid rgba(255,255,255,0.2);
            border-top-color:var(--primary);
            border-radius:50%; animation:spin 0.8s linear infinite;
          }
          @keyframes spin { to { transform:rotate(360deg); } }
        `}</style>
      </div>
    );
  }

  // ========== HOME SCREEN ==========
  return (
    <div className={`pdf-home${embedded ? ' embedded' : ''}`}>
      <div className="pdf-home-inner">
        <div className="pdf-header">
          <FileText size={32} className="pdf-header-icon" />
          <h2>PDF ビューア</h2>
          <p className="pdf-desc">試験問題などのPDFをページナビ・ズーム・タイマー付きで快適に閲覧できます</p>
        </div>

        <form onSubmit={handleUrlSubmit} className="url-form">
          <div className="url-input-row">
            <LinkIcon size={16} className="url-icon" />
            <input type="url" value={inputUrl} onChange={e => setInputUrl(e.target.value)}
              placeholder="PDFのURLを入力..." className="url-input" />
          </div>
          <button type="submit" className="btn-open" disabled={!inputUrl.trim()}>開く</button>
        </form>

        <div className="upload-section">
          <button className="btn-upload" onClick={() => fileInputRef.current?.click()}>
            <Upload size={18} />ファイルを選択して開く
          </button>
          <input ref={fileInputRef} type="file" accept="application/pdf" hidden onChange={handleFileUpload} />
        </div>

        {/* Photo-to-PDF section */}
        <div className="photo-section">
          <div className="photo-section-header">
            <ImageIcon size={18} className="photo-icon" />
            <span>写真から1枚のPDFにする</span>
          </div>

          <button className="btn-add-photos" onClick={() => photoInputRef.current?.click()}>
            <Plus size={16} />写真を追加
          </button>
          <input ref={photoInputRef} type="file" accept="image/*" multiple hidden onChange={handlePhotoSelect} />

          {photoThumbs.length > 0 && (
            <>
              <div className="photo-thumbs">
                {photoThumbs.map((src, i) => (
                  <div key={i} className="photo-thumb-wrap">
                    <img
                      src={src}
                      alt={`photo ${i+1}`}
                      className="photo-thumb"
                      style={{ transform: `rotate(${photoRotations[i] ?? 0}deg)` }}
                    />
                    <span className="photo-num">{i+1}</span>
                    <button className="photo-rotate" onClick={() => rotatePhoto(i)} title="90°回転"><RotateCw size={12} /></button>
                    <button className="photo-remove" onClick={() => removePhoto(i)}><X size={12} /></button>
                  </div>
                ))}
              </div>
              <button
                className="btn-create-pdf"
                onClick={handleCreatePDF}
                disabled={isConvertingPDF}
              >
                {isConvertingPDF ? '変換中...' : `PDFを作成 (${photoThumbs.length}枚)`}
              </button>
            </>
          )}
        </div>
      </div>

      <style jsx>{`
        .pdf-home {
          flex:1; min-height:0;
          overflow-y:auto; overflow-x:hidden;
          -webkit-overflow-scrolling:touch;
          background:var(--background);
          padding:40px 16px calc(60px + env(safe-area-inset-bottom) + 16px);
        }
        /* When embedded inside the sketch side panel, the parent flex
           chain is unreliable (esp. on mobile Safari) and scroll silently
           dies. Pin to the parent box explicitly so overflow always
           scrolls vertically — horizontal stays locked. */
        .pdf-home.embedded {
          position: absolute; inset: 0;
          flex: none; min-height: 0;
          padding: 24px 16px 32px;
          overflow-y: auto; overflow-x: hidden;
          -webkit-overflow-scrolling: touch;
          touch-action: pan-y;
          overscroll-behavior: contain;
        }
        .pdf-home-inner {
          width:100%; max-width:520px;
          margin:0 auto;
          display:flex; flex-direction:column; gap:24px;
        }
        .pdf-header { text-align:center; padding:24px 0 8px; }
        .pdf-header-icon { color:var(--primary); margin-bottom:12px; }
        .pdf-header h2 { font-size:1.6rem; color:var(--primary); margin-bottom:8px; }
        .pdf-desc { font-size:0.85rem; color:#888; }
        .url-form {
          display:flex; flex-direction:column; gap:10px;
          background:var(--accent); border:1px solid var(--border);
          border-radius:16px; padding:20px;
        }
        .url-input-row {
          display:flex; align-items:center; gap:8px;
          background:var(--background); border:1px solid var(--border);
          border-radius:10px; padding:10px 12px;
        }
        .url-icon { color:#999; flex-shrink:0; }
        .url-input {
          flex:1; border:none; background:transparent;
          font-size:0.95rem; color:var(--foreground); outline:none; min-width:0;
        }
        .btn-open {
          padding:12px; background:var(--primary); color:white;
          font-weight:700; border-radius:10px; border:none; cursor:pointer;
          font-size:0.95rem; transition:opacity 0.2s;
        }
        .btn-open:disabled { opacity:0.5; cursor:default; }
        .upload-section { display:flex; justify-content:center; }
        .btn-upload {
          display:flex; align-items:center; gap:8px; padding:12px 24px;
          background:transparent; border:2px solid var(--primary);
          color:var(--primary); font-weight:600; border-radius:12px;
          cursor:pointer; font-size:0.9rem; transition:background 0.2s;
        }
        .btn-upload:hover { background:var(--accent); }
        /* Photo section */
        .photo-section {
          background:var(--accent); border:1px solid var(--border);
          border-radius:16px; padding:20px; display:flex;
          flex-direction:column; gap:14px;
        }
        .photo-section-header {
          display:flex; align-items:center; gap:8px;
          font-size:0.95rem; font-weight:700; color:var(--foreground);
        }
        .photo-icon { color:var(--primary); }
        .btn-add-photos {
          display:flex; align-items:center; gap:6px;
          padding:10px 16px; background:var(--background);
          border:1px solid var(--border); color:var(--foreground);
          font-size:0.88rem; font-weight:600; border-radius:10px;
          cursor:pointer; transition:background 0.15s; width:fit-content;
        }
        .btn-add-photos:hover { background:var(--border); }
        .photo-thumbs {
          display:flex; gap:10px; flex-wrap:wrap;
        }
        .photo-thumb-wrap {
          position:relative; width:72px; height:72px; flex-shrink:0;
        }
        .photo-thumb {
          width:72px; height:72px; object-fit:cover;
          border-radius:8px; border:1px solid var(--border);
          display:block; transition:transform 0.2s ease;
        }
        .photo-num {
          position:absolute; bottom:3px; left:3px;
          background:rgba(0,0,0,0.6); color:white;
          font-size:0.65rem; font-weight:700;
          padding:1px 5px; border-radius:4px;
          pointer-events:none;
        }
        .photo-remove {
          position:absolute; top:-6px; right:-6px;
          width:20px; height:20px;
          background:#ef4444; color:white; border-radius:50%;
          display:flex; align-items:center; justify-content:center;
          cursor:pointer; transition:opacity 0.15s;
        }
        .photo-remove:hover { opacity:0.8; }
        .photo-rotate {
          position:absolute; bottom:3px; right:3px;
          width:22px; height:22px;
          background:rgba(0,0,0,0.6); color:white; border:none; border-radius:6px;
          display:flex; align-items:center; justify-content:center;
          cursor:pointer; transition:opacity 0.15s;
        }
        .photo-rotate:hover { opacity:0.8; }
        .btn-create-pdf {
          padding:12px; background:var(--primary); color:white;
          font-weight:700; border-radius:10px; border:none;
          cursor:pointer; font-size:0.95rem; transition:opacity 0.2s;
        }
        .btn-create-pdf:disabled { opacity:0.6; cursor:default; }
      `}</style>
    </div>
  );
}
