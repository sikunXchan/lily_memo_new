'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import {
  X, Upload, FileText, Link as LinkIcon, ExternalLink,
  ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Clock,
  Play, Pause, RotateCcw, RotateCw,
  Image as ImageIcon, Plus, Maximize2, Minimize2,
  FileDown, Home, ArrowLeft,
} from 'lucide-react';
import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { registerPdfProvider } from '@/lib/pdfBridge';
import { pdfPagesToMarkdown } from '@/lib/pdfToMarkdown';
import { downloadTextFile } from '@/lib/fileGen';
import { db, newSyncId } from '@/lib/db';
import { useT } from '@/lib/i18n';

if (typeof window !== 'undefined') {
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
}

// Zoom range for the ± buttons (0.5x–2.5x).
const MIN_SCALE = 0.5;
const MAX_SCALE = 2.5;
const DEFAULT_SCALE = 1.5;
const ZOOM_BTN_STEP = 1.25; // +/- button multiplier
const MAX_IMG_DIM = 2048;

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
  onSwitchTab?: (tab: string) => void;
}

export default function PDFViewer({ embedded = false, onSwitchTab }: PDFViewerProps) {
  const t = useT();
  const [inputUrl, setInputUrl] = useState('');
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [scale, setScale] = useState(DEFAULT_SCALE);
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

  // App-level fullscreen (hides the top bar to maximize canvas area)
  const [isAppFullscreen, setIsAppFullscreen] = useState(false);

  // Photo-to-PDF
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [photoThumbs, setPhotoThumbs] = useState<string[]>([]);
  const [photoRotations, setPhotoRotations] = useState<number[]>([]);
  const [isConvertingPDF, setIsConvertingPDF] = useState(false);

  // PDF → Markdown conversion
  const [mdState, setMdState] = useState<'idle' | 'working' | 'done' | 'error'>('idle');
  const [mdProgress, setMdProgress] = useState('');
  const [mdResult, setMdResult] = useState('');
  const [mdError, setMdError] = useState('');
  const [mdSaved, setMdSaved] = useState(false);
  // Bumped whenever the open document changes so an in-flight conversion of a
  // closed/replaced PDF can't surface its (now irrelevant) result.
  const mdRunIdRef = useRef(0);


  // Canvas & DOM refs
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null);
  const pdfDocRef = useRef<PDFDocumentProxy | null>(null);
  pdfDocRef.current = pdfDoc;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const blobUrlRef = useRef('');
  const photoThumbsRef = useRef<string[]>([]);
  photoThumbsRef.current = photoThumbs;
  // Zoom is button-only (±). Finger pinch-zoom is intentionally disabled and
  // horizontal panning is locked (touch-action: pan-y on the canvas area), so
  // reading a PDF stays a clean vertical scroll.
  const pdfCanvasAreaRef = useRef<HTMLDivElement>(null);

  const scaleRef = useRef(DEFAULT_SCALE);
  const currentPageRef = useRef(1);

  scaleRef.current = scale;
  currentPageRef.current = currentPage;
  const hasPDF = pdfDoc !== null;

  // Re-encodes the already-rendered on-screen canvas as a downscaled JPEG —
  // cheap, no re-render. Shared by the sikun PDF bridge and the Lily dock.
  const capturePageImage = useCallback((): string | null => {
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
      return src.toDataURL('image/jpeg', 0.85).split(',')[1];
    } catch {
      return null;
    }
  }, []);

  const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
  const zoomByStep = (dir: 1 | -1) =>
    setScale(s => clampScale(dir === 1 ? s * ZOOM_BTN_STEP : s / ZOOM_BTN_STEP));

  // ---- PDF loading ----
  const loadPDF = useCallback(async (url: string, originalUrl: string) => {
    setIsLoading(true);
    setError('');
    setPdfDoc(null);
    setCurrentPage(1);
    setTotalPages(0);
    setOpenUrl(originalUrl);
    if (renderTaskRef.current) { renderTaskRef.current.cancel(); renderTaskRef.current = null; }
    try {
      const doc = await pdfjs.getDocument(url).promise;
      setPdfDoc(doc);
      setTotalPages(doc.numPages);
    } catch (e) {
      if ((e as Error)?.name !== 'RenderingCancelledException')
        setError(t('PDFを読み込めませんでした。URLを確認するか、ファイルを直接アップロードしてください。'));
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
    setOpenUrl('');
    mdRunIdRef.current++;
    setMdState('idle'); setMdProgress(''); setMdResult(''); setMdError(''); setMdSaved(false);
  };

  // ---- PDF → Markdown ----
  const MD_MAX_PAGES = 50;

  // Best-effort document name for the .md file / memo title.
  const pdfBaseName = (): string => {
    try {
      if (openUrl && !openUrl.startsWith('blob:')) {
        const last = decodeURIComponent(new URL(openUrl, window.location.href).pathname.split('/').pop() ?? '');
        const name = last.replace(/\.pdf$/i, '').trim();
        if (name) return name;
      }
    } catch { /* fall through */ }
    const d = new Date();
    return `PDF_${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const handlePdfToMarkdown = async () => {
    const doc = pdfDocRef.current;
    if (!doc || mdState === 'working') return;
    const runId = ++mdRunIdRef.current;
    setMdState('working'); setMdError(''); setMdResult(''); setMdSaved(false);
    try {
      const total = doc.numPages;
      const n = Math.min(total, MD_MAX_PAGES);
      const images: string[] = [];
      for (let i = 1; i <= n; i++) {
        setMdProgress(t('ページを画像化中... ({done}/{total})', { done: i, total: n }));
        const page = await doc.getPage(i);
        const vp = page.getViewport({ scale: 1.5 });
        const cv = document.createElement('canvas');
        cv.width = vp.width; cv.height = vp.height;
        await page.render({ canvasContext: cv.getContext('2d')!, viewport: vp }).promise;
        images.push(cv.toDataURL('image/jpeg', 0.8).split(',')[1]);
        if (runId !== mdRunIdRef.current) return;
      }
      const md = await pdfPagesToMarkdown(images, p =>
        setMdProgress(t('Markdownに変換中... ({done}/{total}ページ)', { done: p.done, total: p.total })));
      if (runId !== mdRunIdRef.current) return;
      const result = total > n
        ? `${md}\n\n---\n\n（${t('元のPDFは全{total}ページですが、最初の{n}ページのみ変換しました。', { total, n })}）`
        : md;
      setMdResult(result);
      setMdState('done');
    } catch (e) {
      if (runId !== mdRunIdRef.current) return;
      setMdError(e instanceof Error ? e.message : 'unknown error');
      setMdState('error');
    }
  };

  const handleMdDownload = () => {
    if (!mdResult) return;
    downloadTextFile(mdResult, `${pdfBaseName()}.md`);
  };

  const handleMdSaveAsMemo = async () => {
    if (!mdResult || mdSaved) return;
    const esc = (s: string) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const now = Date.now();
    await db.notes.add({
      syncId: newSyncId(),
      title: `${pdfBaseName()} (Markdown)`,
      content: `<p>${mdResult.split('\n').map(esc).join('</p><p>')}</p>`,
      type: 'text',
      createdAt: now,
      updatedAt: now,
    });
    setMdSaved(true);
  };

  const closeMdModal = () => {
    mdRunIdRef.current++;
    setMdState('idle'); setMdProgress(''); setMdResult(''); setMdError(''); setMdSaved(false);
  };

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
      const imageBase64 = capturePageImage();
      return imageBase64 ? { imageBase64, page: currentPageRef.current, total: totalPages } : null;
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

    registerPdfProvider(getCurrentPage, getAllPages);
    return () => { registerPdfProvider(null); };
  }, [hasPDF, totalPages, capturePageImage]);


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
          {onSwitchTab && (
            <button className="pdf-text-btn" onClick={() => onSwitchTab('memos')} title={t('ホーム')}>
              <Home size={16} /><span>{t('ホーム')}</span>
            </button>
          )}
          <button className="pdf-text-btn" onClick={closePDF}>
            <X size={16} /><span>{t('閉じる')}</span>
          </button>
          <div className="pdf-nav-group">
            <button className="pdf-icon-btn" onClick={() => setCurrentPage(p => Math.max(1, p-1))} disabled={currentPage <= 1 || !hasPDF} title={t('前のページ (←)')}>
              <ChevronLeft size={20} />
            </button>
            <span className="pdf-page-label">{hasPDF ? `${currentPage} / ${totalPages}` : '–'}</span>
            <button className="pdf-icon-btn" onClick={() => setCurrentPage(p => Math.min(totalPages, p+1))} disabled={currentPage >= totalPages || !hasPDF} title={t('次のページ (→)')}>
              <ChevronRight size={20} />
            </button>
          </div>
          <div className="pdf-zoom-group">
            <button className="pdf-icon-btn" onClick={() => zoomByStep(-1)} disabled={scale <= MIN_SCALE + 1e-6} title={t('縮小')}>
              <ZoomOut size={18} />
            </button>
            <span className="pdf-zoom-label">{Math.round(scale * 100)}%</span>
            <button className="pdf-icon-btn" onClick={() => zoomByStep(1)} disabled={scale >= MAX_SCALE - 1e-6} title={t('拡大')}>
              <ZoomIn size={18} />
            </button>
          </div>
          <div className="pdf-bar-right">
            <button className={`pdf-icon-btn${mdState === 'working' ? ' active' : ''}`} onClick={() => void handlePdfToMarkdown()} disabled={!hasPDF || mdState === 'working'} title={t('PDFをMarkdown化')}>
              <FileDown size={18} />
            </button>
            <button className={`pdf-icon-btn${showTimer ? ' active' : ''}`} onClick={() => { setShowTimer(v => !v); setTimerCollapsed(false); }} title={t('タイマー')}>
              <Clock size={18} />
            </button>
            {openUrl && (
              <a href={openUrl} target="_blank" rel="noopener noreferrer" className="pdf-icon-btn" title={t('新しいタブで開く')}>
                <ExternalLink size={18} />
              </a>
            )}
            <button className="pdf-icon-btn" onClick={() => setIsAppFullscreen(true)} title={t('全画面表示')}>
              <Maximize2 size={18} />
            </button>
          </div>
        </div>}

        {/* Fullscreen exit button + floating nav */}
        {isAppFullscreen && (
          <>
            <button className="pdf-fullscreen-exit" onClick={() => setIsAppFullscreen(false)} title={t('全画面を終了')}>
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
                <button className="pdf-fs-nav-btn" onClick={() => zoomByStep(-1)} disabled={scale <= MIN_SCALE + 1e-6} title={t('縮小')}>
                  <ZoomOut size={16} />
                </button>
                <span className="pdf-fs-nav-label">{Math.round(scale * 100)}%</span>
                <button className="pdf-fs-nav-btn" onClick={() => zoomByStep(1)} disabled={scale >= MAX_SCALE - 1e-6} title={t('拡大')}>
                  <ZoomIn size={16} />
                </button>
              </div>
            )}
          </>
        )}

        {/* Timer */}
        {showTimer && (
          timerCollapsed ? (
            <button className={`timer-panel timer-panel-collapsed${timerAlert ? ' alert' : ''}`}
              onClick={() => setTimerCollapsed(false)} title={t('タイマーを展開')}>
              <span className="timer-display-mini">{formatTime(timerSeconds)}</span>
              {timerRunning && <span className="timer-running-dot" />}
            </button>
          ) : (
            <div className="timer-panel">
              <div className="timer-panel-header">
                <div className="timer-mode-tabs">
                  <button className={`timer-tab${timerMode === 'stopwatch' ? ' active' : ''}`} onClick={() => switchTimerMode('stopwatch')}>{t('ストップウォッチ')}</button>
                  <button className={`timer-tab${timerMode === 'countdown' ? ' active' : ''}`} onClick={() => switchTimerMode('countdown')}>{t('カウントダウン')}</button>
                </div>
                <button className="timer-collapse-btn" onClick={() => setTimerCollapsed(true)}><ChevronLeft size={16} />{t('しまう')}</button>
              </div>
              <div className="timer-display">{formatTime(timerSeconds)}</div>
              {timerMode === 'countdown' && !timerRunning && timerSeconds === 0 && (
                <div className="timer-input-row">
                  <input type="number" className="timer-input" value={timerInput} min={1} max={180}
                    onChange={e => setTimerInput(Math.max(1, parseInt(e.target.value)||1))} />
                  <span className="timer-unit">{t('分')}</span>
                </div>
              )}
              <div className="timer-controls">
                {timerMode === 'countdown' && !timerRunning && timerSeconds === 0 ? (
                  <button className="timer-btn start" onClick={startCountdown}><Play size={14} /> {t('開始')}</button>
                ) : (
                  <>
                    <button className={`timer-btn${timerRunning ? ' pause' : ' start'}`}
                      onClick={() => { setTimerRunning(v => !v); if (!timerRunning) setTimerCollapsed(true); }}>
                      {timerRunning ? <Pause size={14} /> : <Play size={14} />}
                      {timerRunning ? t('一時停止') : t('再開')}
                    </button>
                    <button className="timer-btn reset" onClick={resetTimer}><RotateCcw size={14} /> {t('リセット')}</button>
                  </>
                )}
              </div>
            </div>
          )
        )}

        {/* PDF → Markdown progress / result */}
        {mdState !== 'idle' && (
          <div className="md-modal-overlay" onClick={mdState === 'working' ? undefined : closeMdModal}>
            <div className="md-modal" onClick={e => e.stopPropagation()}>
              {mdState === 'working' && (
                <>
                  <div className="pdf-spinner" />
                  <p className="md-modal-title">{t('PDFをMarkdownに変換中')}</p>
                  <p className="md-modal-sub">{mdProgress}</p>
                </>
              )}
              {mdState === 'error' && (
                <>
                  <p className="md-modal-title">{t('Markdown変換に失敗しました')}</p>
                  <p className="md-modal-sub">{mdError}</p>
                  <div className="md-modal-actions">
                    <button className="md-btn" onClick={closeMdModal}>{t('閉じる')}</button>
                    <button className="md-btn primary" onClick={() => void handlePdfToMarkdown()}>{t('もう一度試す')}</button>
                  </div>
                </>
              )}
              {mdState === 'done' && (
                <>
                  <p className="md-modal-title">{t('Markdown変換が完了しました')}</p>
                  <pre className="md-preview">{mdResult.slice(0, 1200)}{mdResult.length > 1200 ? '\n…' : ''}</pre>
                  <div className="md-modal-actions">
                    <button className="md-btn" onClick={closeMdModal}>{t('閉じる')}</button>
                    <button className="md-btn" onClick={() => void handleMdSaveAsMemo()} disabled={mdSaved}>
                      {mdSaved ? t('✓ メモに保存済み') : t('メモとして保存')}
                    </button>
                    <button className="md-btn primary" onClick={handleMdDownload}>
                      <FileDown size={14} /> {t('.md をダウンロード')}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Canvas area — stable centering */}
        <div className="pdf-canvas-area" ref={pdfCanvasAreaRef}>
          {isLoading && (
            <div className="pdf-status">
              <div className="pdf-spinner" /><span>{t('読み込み中...')}</span>
            </div>
          )}
          {error && (
            <div className="pdf-status pdf-error">
              <FileText size={40} opacity={0.4} />
              <p>{error}</p>
              <button className="pdf-text-btn" onClick={closePDF}>{t('戻る')}</button>
            </div>
          )}
          {!isLoading && !error && (
            <div className="pdf-canvas-wrapper">
              <canvas ref={canvasRef} className="pdf-canvas" />
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
          /* Canvas — vertical scroll only. touch-action: pan-y disables finger
             pinch-zoom and horizontal panning (the page stays left-right fixed);
             zoom is done exclusively with the ± toolbar buttons. */
          .pdf-canvas-area {
            flex:1; overflow-y:auto; overflow-x:hidden; min-height:0;
            -webkit-overflow-scrolling:touch;
            touch-action: pan-y;
            overscroll-behavior: contain;
            padding:16px;
            display:flex; justify-content:center; align-items:flex-start;
          }
          .pdf-canvas-wrapper {
            position:relative; flex-shrink:0; margin:auto;
          }
          .pdf-canvas {
            display:block;
            height:auto;
            box-shadow:0 4px 20px rgba(0,0,0,0.4);
          }
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

          /* ── PDF → Markdown modal ── */
          .md-modal-overlay {
            position:absolute; inset:0; z-index:60;
            background:rgba(0,0,0,0.55);
            display:flex; align-items:center; justify-content:center; padding:16px;
          }
          .md-modal {
            background:var(--background); border-radius:16px;
            padding:22px 18px; max-width:480px; width:100%;
            display:flex; flex-direction:column; align-items:center; gap:10px;
            box-shadow:0 8px 40px rgba(0,0,0,0.35);
            max-height:80%;
          }
          .md-modal-title { font-size:0.98rem; font-weight:700; color:var(--foreground); margin:0; text-align:center; }
          .md-modal-sub { font-size:0.78rem; color:var(--fg-muted); margin:0; text-align:center; word-break:break-all; }
          .md-preview {
            width:100%; flex:1; min-height:0; overflow:auto;
            background:var(--accent); border:1px solid var(--border); border-radius:10px;
            padding:10px 12px; margin:0;
            font-size:0.72rem; line-height:1.5; color:var(--foreground);
            white-space:pre-wrap; word-break:break-word;
            max-height:300px;
          }
          .md-modal-actions { display:flex; gap:8px; flex-wrap:wrap; justify-content:flex-end; width:100%; }
          .md-btn {
            display:flex; align-items:center; gap:5px;
            border:1px solid var(--border); background:var(--accent); color:var(--foreground);
            border-radius:10px; padding:8px 14px; font-size:0.8rem; font-weight:700; cursor:pointer;
          }
          .md-btn.primary { background:var(--primary); border-color:var(--primary); color:#fff; }
          .md-btn:disabled { opacity:0.55; cursor:default; }

        `}</style>
      </div>
    );
  }

  // ========== HOME SCREEN ==========
  return (
    <div className={`pdf-home${embedded ? ' embedded' : ''}`}>
      <div className="pdf-home-inner">
        {onSwitchTab && !embedded && (
          <button className="pdf-home-back" onClick={() => onSwitchTab('memos')}>
            <ArrowLeft size={18} /><span>{t('ホームに戻る')}</span>
          </button>
        )}
        <div className="pdf-header">
          <FileText size={32} className="pdf-header-icon" />
          <h2>{t('PDF ビューア')}</h2>
          <p className="pdf-desc">{t('試験問題などのPDFをページナビ・ズーム・タイマー付きで快適に閲覧できます')}</p>
        </div>

        <form onSubmit={handleUrlSubmit} className="url-form">
          <div className="url-input-row">
            <LinkIcon size={16} className="url-icon" />
            <input type="url" value={inputUrl} onChange={e => setInputUrl(e.target.value)}
              placeholder={t('PDFのURLを入力...')} className="url-input" />
          </div>
          <button type="submit" className="btn-open" disabled={!inputUrl.trim()}>{t('開く')}</button>
        </form>

        <div className="upload-section">
          <button className="btn-upload" onClick={() => fileInputRef.current?.click()}>
            <Upload size={18} />{t('ファイルを選択して開く')}
          </button>
          <input ref={fileInputRef} type="file" accept="application/pdf" hidden onChange={handleFileUpload} />
        </div>

        {/* Photo-to-PDF section */}
        <div className="photo-section">
          <div className="photo-section-header">
            <ImageIcon size={18} className="photo-icon" />
            <span>{t('写真から1枚のPDFにする')}</span>
          </div>

          <button className="btn-add-photos" onClick={() => photoInputRef.current?.click()}>
            <Plus size={16} />{t('写真を追加')}
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
                    <button className="photo-rotate" onClick={() => rotatePhoto(i)} title={t('90°回転')}><RotateCw size={12} /></button>
                    <button className="photo-remove" onClick={() => removePhoto(i)}><X size={12} /></button>
                  </div>
                ))}
              </div>
              <button
                className="btn-create-pdf"
                onClick={handleCreatePDF}
                disabled={isConvertingPDF}
              >
                {isConvertingPDF ? t('変換中...') : t('PDFを作成 ({n}枚)', { n: photoThumbs.length })}
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
        .pdf-home-back {
          display:flex; align-items:center; gap:6px; align-self:flex-start;
          background:var(--accent); border:1px solid var(--border);
          border-radius:99px; padding:8px 16px; margin-top:4px;
          font-size:0.85rem; font-weight:700; color:var(--foreground);
          cursor:pointer; transition:background 0.15s;
        }
        .pdf-home-back:hover, .pdf-home-back:active { background:color-mix(in srgb, var(--primary) 12%, transparent); color:var(--primary); }
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
