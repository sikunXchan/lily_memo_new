'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import {
  X, Upload, FileText, Link as LinkIcon, ExternalLink,
  ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Clock,
  Play, Pause, RotateCcw, Search, Highlighter, Trash2,
} from 'lucide-react';
import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';

if (typeof window !== 'undefined') {
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
}

const ZOOM_LEVELS = [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0, 2.5];
const DEFAULT_ZOOM_INDEX = 4;
const HIGHLIGHT_COLORS = ['#ffeb3b80', '#86efac80', '#fda4af80', '#93c5fd80'];

type AnnotationItem = {
  id: string;
  x: number; // PDF user-space coords at scale=1
  y: number;
  w: number;
  h: number;
  color: string;
};

type SearchMatch = {
  page: number;
  x: number; // canvas Y-down coords at scale=1
  y: number;
  w: number;
  h: number;
};

function playBeep() {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.8);
  } catch { /* ignore audio errors */ }
}

export default function PDFViewer() {
  const [inputUrl, setInputUrl] = useState('');
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [zoomIndex, setZoomIndex] = useState(DEFAULT_ZOOM_INDEX);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [openUrl, setOpenUrl] = useState('');

  // Timer state
  const [showTimer, setShowTimer] = useState(false);
  const [timerCollapsed, setTimerCollapsed] = useState(false);
  const [timerMode, setTimerMode] = useState<'stopwatch' | 'countdown'>('stopwatch');
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [timerRunning, setTimerRunning] = useState(false);
  const [timerInput, setTimerInput] = useState(25);
  const [timerAlert, setTimerAlert] = useState(false);

  // Search state
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMatches, setSearchMatches] = useState<SearchMatch[]>([]);
  const [matchIndex, setMatchIndex] = useState(0);
  const [isSearching, setIsSearching] = useState(false);

  // Annotation state
  const [annotationMode, setAnnotationMode] = useState<'none' | 'highlight'>('none');
  const [highlightColor, setHighlightColor] = useState(HIGHLIGHT_COLORS[0]);
  const [annotations, setAnnotations] = useState<Record<number, AnnotationItem[]>>({});
  const [overlayVersion, setOverlayVersion] = useState(0);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const blobUrlRef = useRef('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const drawingRef = useRef<{ x: number; y: number } | null>(null);

  // Stable refs to avoid stale closures in drawOverlay
  const annotationsRef = useRef(annotations);
  const searchMatchesRef = useRef(searchMatches);
  const matchIndexRef = useRef(matchIndex);
  const scaleRef = useRef(ZOOM_LEVELS[DEFAULT_ZOOM_INDEX]);
  const currentPageRef = useRef(1);
  const highlightColorRef = useRef(HIGHLIGHT_COLORS[0]);
  const annotationModeRef = useRef<'none' | 'highlight'>('none');

  annotationsRef.current = annotations;
  searchMatchesRef.current = searchMatches;
  matchIndexRef.current = matchIndex;
  scaleRef.current = ZOOM_LEVELS[zoomIndex];
  currentPageRef.current = currentPage;
  highlightColorRef.current = highlightColor;
  annotationModeRef.current = annotationMode;

  const scale = ZOOM_LEVELS[zoomIndex];
  const hasPDF = pdfDoc !== null;

  const loadPDF = useCallback(async (url: string, originalUrl: string) => {
    setIsLoading(true);
    setError('');
    setPdfDoc(null);
    setCurrentPage(1);
    setTotalPages(0);
    setOpenUrl(originalUrl);
    setSearchMatches([]);
    setSearchQuery('');
    setAnnotations({});

    if (renderTaskRef.current) {
      renderTaskRef.current.cancel();
      renderTaskRef.current = null;
    }

    try {
      const doc = await pdfjs.getDocument(url).promise;
      setPdfDoc(doc);
      setTotalPages(doc.numPages);
    } catch (e) {
      const name = (e as Error)?.name;
      if (name !== 'RenderingCancelledException') {
        setError('PDFを読み込めませんでした。URLを確認するか、ファイルを直接アップロードしてください。');
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = inputUrl.trim();
    if (!trimmed) return;
    const proxyUrl = `/api/pdf-proxy?url=${encodeURIComponent(trimmed)}`;
    loadPDF(proxyUrl, trimmed);
    setInputUrl('');
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    const objectUrl = URL.createObjectURL(file);
    blobUrlRef.current = objectUrl;
    loadPDF(objectUrl, objectUrl);
    e.target.value = '';
  };

  const closePDF = () => {
    if (renderTaskRef.current) {
      renderTaskRef.current.cancel();
      renderTaskRef.current = null;
    }
    setPdfDoc(null);
    setCurrentPage(1);
    setTotalPages(0);
    setError('');
    setIsLoading(false);
    setTimerRunning(false);
    setOpenUrl('');
    setSearchMatches([]);
    setSearchQuery('');
    setShowSearch(false);
    setAnnotations({});
    setAnnotationMode('none');
  };

  // Draw annotations and search highlights on the overlay canvas.
  // Reads from refs so it can be a stable callback (no deps).
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

    const pageAnnotations = annotationsRef.current[page] || [];
    for (const ann of pageAnnotations) {
      ctx.fillStyle = ann.color;
      ctx.fillRect(ann.x * sc, ann.y * sc, ann.w * sc, ann.h * sc);
    }

    const matches = searchMatchesRef.current;
    const mi = matchIndexRef.current;
    matches.forEach((match, i) => {
      if (match.page !== page) return;
      ctx.fillStyle = i === mi ? 'rgba(255,165,0,0.55)' : 'rgba(255,220,0,0.35)';
      ctx.fillRect(match.x * sc, match.y * sc, match.w * sc, match.h * sc);
    });
  }, []);

  // Page rendering
  useEffect(() => {
    if (!pdfDoc || !canvasRef.current) return;
    let cancelled = false;

    const render = async () => {
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
        renderTaskRef.current = null;
      }
      try {
        const page = await pdfDoc.getPage(currentPage);
        if (cancelled) return;

        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current!;
        const ctx = canvas.getContext('2d')!;
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        const task = page.render({ canvasContext: ctx, viewport });
        renderTaskRef.current = task;
        await task.promise;
        renderTaskRef.current = null;

        if (!cancelled) setOverlayVersion(v => v + 1);
      } catch (e) {
        if ((e as Error)?.name !== 'RenderingCancelledException') {
          console.error('PDF render error:', e);
        }
      }
    };

    render();
    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
      renderTaskRef.current = null;
    };
  }, [pdfDoc, currentPage, scale]);

  // Redraw overlay when version, annotations, search results or match index change
  useEffect(() => {
    drawOverlay();
  }, [overlayVersion, annotations, searchMatches, matchIndex, drawOverlay]);

  // Keyboard navigation + Ctrl+F to open search
  useEffect(() => {
    if (!hasPDF) return;
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        setCurrentPage(p => Math.min(totalPages, p + 1));
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        setCurrentPage(p => Math.max(1, p - 1));
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        setShowSearch(v => !v);
        setTimeout(() => searchInputRef.current?.focus(), 50);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [hasPDF, totalPages]);

  useEffect(() => () => { if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current); }, []);

  // Timer
  useEffect(() => {
    if (!timerRunning) return;
    const id = setInterval(() => {
      setTimerSeconds(prev => {
        if (timerMode === 'countdown') {
          if (prev <= 1) {
            setTimerRunning(false);
            setTimerAlert(true);
            playBeep();
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
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const mm = String(m).padStart(2, '0');
    const ss = String(sec).padStart(2, '0');
    return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  };

  const switchTimerMode = (mode: 'stopwatch' | 'countdown') => {
    setTimerMode(mode);
    setTimerSeconds(0);
    setTimerRunning(false);
    setTimerAlert(false);
  };

  const startCountdown = () => {
    setTimerSeconds(timerInput * 60);
    setTimerRunning(true);
    setTimerAlert(false);
    setTimerCollapsed(true);
  };

  const resetTimer = () => {
    setTimerSeconds(0);
    setTimerRunning(false);
    setTimerAlert(false);
  };

  // Full-document text search using PDF.js text content API
  const performSearch = useCallback(async (query: string) => {
    if (!pdfDoc || !query.trim()) {
      setSearchMatches([]);
      setMatchIndex(0);
      return;
    }
    setIsSearching(true);
    const matches: SearchMatch[] = [];
    const queryLower = query.toLowerCase();

    try {
      for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
        const page = await pdfDoc.getPage(pageNum);
        const viewport = page.getViewport({ scale: 1 });
        const textContent = await page.getTextContent();

        for (const item of textContent.items) {
          if (!('str' in item)) continue;
          const str = item.str as string;
          if (!str) continue;
          const strLower = str.toLowerCase();
          const tf = item.transform as number[];
          // tf = [a, b, c, d, tx, ty]; font height ≈ |d|, fall back to |a|
          const fontH = Math.abs(tf[3]) || Math.abs(tf[0]) || 12;

          let idx = 0;
          while (true) {
            const pos = strLower.indexOf(queryLower, idx);
            if (pos === -1) break;

            // Convert PDF origin-bottom-left to canvas origin-top-left
            const matchX = tf[4] + (pos / str.length) * item.width;
            const matchY = viewport.height - tf[5] - fontH;

            matches.push({
              page: pageNum,
              x: matchX,
              y: Math.max(0, matchY),
              w: Math.max((query.length / str.length) * item.width, 8),
              h: fontH,
            });
            idx = pos + 1;
          }
        }
      }
    } finally {
      setIsSearching(false);
    }

    setSearchMatches(matches);
    setMatchIndex(0);
    if (matches.length > 0) setCurrentPage(matches[0].page);
  }, [pdfDoc, totalPages]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    performSearch(searchQuery);
  };

  const goToMatch = (newIndex: number) => {
    if (searchMatches.length === 0) return;
    const idx = ((newIndex % searchMatches.length) + searchMatches.length) % searchMatches.length;
    setMatchIndex(idx);
    setCurrentPage(searchMatches[idx].page);
  };

  // Annotation drawing helpers
  const getOverlayPos = (clientX: number, clientY: number) => {
    const overlay = overlayCanvasRef.current!;
    const rect = overlay.getBoundingClientRect();
    return {
      x: (clientX - rect.left) * (overlay.width / rect.width),
      y: (clientY - rect.top) * (overlay.height / rect.height),
    };
  };

  const finishAnnotation = (start: { x: number; y: number }, end: { x: number; y: number }) => {
    drawingRef.current = null;
    const x = Math.min(start.x, end.x);
    const y = Math.min(start.y, end.y);
    const w = Math.abs(end.x - start.x);
    const h = Math.abs(end.y - start.y);

    if (w < 5 || h < 5) { drawOverlay(); return; }

    const sc = scaleRef.current;
    const newAnn: AnnotationItem = {
      id: Date.now().toString(),
      x: x / sc,
      y: y / sc,
      w: w / sc,
      h: h / sc,
      color: highlightColorRef.current,
    };
    setAnnotations(prev => ({
      ...prev,
      [currentPageRef.current]: [...(prev[currentPageRef.current] || []), newAnn],
    }));
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (annotationModeRef.current !== 'highlight') return;
    (e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId);
    drawingRef.current = getOverlayPos(e.clientX, e.clientY);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current || annotationModeRef.current !== 'highlight') return;
    const pos = getOverlayPos(e.clientX, e.clientY);
    drawOverlay();
    const overlay = overlayCanvasRef.current!;
    const ctx = overlay.getContext('2d')!;
    ctx.fillStyle = highlightColorRef.current;
    const { x: sx, y: sy } = drawingRef.current;
    ctx.fillRect(sx, sy, pos.x - sx, pos.y - sy);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current || annotationModeRef.current !== 'highlight') return;
    finishAnnotation(drawingRef.current, getOverlayPos(e.clientX, e.clientY));
  };

  const clearPageAnnotations = () => {
    setAnnotations(prev => {
      const next = { ...prev };
      delete next[currentPage];
      return next;
    });
  };

  // --- Viewer ---
  if (isLoading || hasPDF || error) {
    return (
      <div className={`pdf-fullscreen${timerAlert ? ' timer-alert' : ''}`}>
        <div className="pdf-top-bar">
          <button className="pdf-text-btn" onClick={closePDF}>
            <X size={16} />
            <span>閉じる</span>
          </button>

          <div className="pdf-nav-group">
            <button
              className="pdf-icon-btn"
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage <= 1 || !hasPDF}
              title="前のページ (←)"
            >
              <ChevronLeft size={20} />
            </button>
            <span className="pdf-page-label">
              {hasPDF ? `${currentPage} / ${totalPages}` : '–'}
            </span>
            <button
              className="pdf-icon-btn"
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage >= totalPages || !hasPDF}
              title="次のページ (→)"
            >
              <ChevronRight size={20} />
            </button>
          </div>

          <div className="pdf-zoom-group">
            <button
              className="pdf-icon-btn"
              onClick={() => setZoomIndex(i => Math.max(0, i - 1))}
              disabled={zoomIndex === 0}
              title="縮小"
            >
              <ZoomOut size={18} />
            </button>
            <span className="pdf-zoom-label">{Math.round(scale * 100)}%</span>
            <button
              className="pdf-icon-btn"
              onClick={() => setZoomIndex(i => Math.min(ZOOM_LEVELS.length - 1, i + 1))}
              disabled={zoomIndex === ZOOM_LEVELS.length - 1}
              title="拡大"
            >
              <ZoomIn size={18} />
            </button>
          </div>

          <div className="pdf-bar-right">
            <button
              className={`pdf-icon-btn${showSearch ? ' active' : ''}`}
              onClick={() => {
                setShowSearch(v => !v);
                setTimeout(() => searchInputRef.current?.focus(), 50);
              }}
              title="ページ内検索 (Ctrl+F)"
            >
              <Search size={18} />
            </button>
            <button
              className={`pdf-icon-btn${annotationMode !== 'none' ? ' active' : ''}`}
              onClick={() => setAnnotationMode(m => m === 'none' ? 'highlight' : 'none')}
              title="ハイライト注釈"
            >
              <Highlighter size={18} />
            </button>
            <button
              className={`pdf-icon-btn${showTimer ? ' active' : ''}`}
              onClick={() => { setShowTimer(v => !v); setTimerCollapsed(false); }}
              title="タイマー"
            >
              <Clock size={18} />
            </button>
            {openUrl && (
              <a
                href={openUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="pdf-icon-btn"
                title="新しいタブで開く"
              >
                <ExternalLink size={18} />
              </a>
            )}
          </div>
        </div>

        {/* Search panel */}
        {showSearch && (
          <div className="search-panel">
            <form onSubmit={handleSearchSubmit} className="search-form">
              <Search size={14} className="search-icon-inner" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="キーワードを検索..."
                className="search-input"
              />
              {isSearching && <span className="search-count">検索中…</span>}
              {!isSearching && searchQuery && searchMatches.length > 0 && (
                <span className="search-count">{matchIndex + 1} / {searchMatches.length}</span>
              )}
              {!isSearching && searchQuery && searchMatches.length === 0 && (
                <span className="search-count no-match">見つかりません</span>
              )}
              <button
                type="button"
                className="search-nav-btn"
                onClick={() => goToMatch(matchIndex - 1)}
                disabled={searchMatches.length === 0}
                title="前の一致"
              >
                <ChevronLeft size={16} />
              </button>
              <button
                type="submit"
                className="search-nav-btn"
                title="次の一致 / 検索"
              >
                <ChevronRight size={16} />
              </button>
              {searchQuery && (
                <button
                  type="button"
                  className="search-clear-btn"
                  onClick={() => { setSearchQuery(''); setSearchMatches([]); setMatchIndex(0); }}
                  title="クリア"
                >
                  <X size={14} />
                </button>
              )}
            </form>
          </div>
        )}

        {/* Annotation toolbar */}
        {annotationMode !== 'none' && (
          <div className="annotation-bar">
            <span className="annotation-label">ハイライト</span>
            <div className="color-swatches">
              {HIGHLIGHT_COLORS.map(c => (
                <button
                  key={c}
                  className={`color-swatch${highlightColor === c ? ' active' : ''}`}
                  style={{ background: c.replace('80', 'dd') }}
                  onClick={() => setHighlightColor(c)}
                  title="色を選択"
                />
              ))}
            </div>
            <button className="annotation-clear-btn" onClick={clearPageAnnotations} title="このページのハイライトを削除">
              <Trash2 size={14} />
              <span>消去</span>
            </button>
          </div>
        )}

        {showTimer && (
          timerCollapsed ? (
            <button
              className={`timer-panel timer-panel-collapsed${timerAlert ? ' alert' : ''}`}
              onClick={() => setTimerCollapsed(false)}
              title="タイマーを展開"
            >
              <span className="timer-display-mini">{formatTime(timerSeconds)}</span>
              {timerRunning && <span className="timer-running-dot" />}
            </button>
          ) : (
            <div className="timer-panel">
              <div className="timer-panel-header">
                <div className="timer-mode-tabs">
                  <button
                    className={`timer-tab${timerMode === 'stopwatch' ? ' active' : ''}`}
                    onClick={() => switchTimerMode('stopwatch')}
                  >
                    ストップウォッチ
                  </button>
                  <button
                    className={`timer-tab${timerMode === 'countdown' ? ' active' : ''}`}
                    onClick={() => switchTimerMode('countdown')}
                  >
                    カウントダウン
                  </button>
                </div>
                <button
                  className="timer-collapse-btn"
                  onClick={() => setTimerCollapsed(true)}
                  title="しまう"
                >
                  <ChevronLeft size={16} />
                  しまう
                </button>
              </div>

              <div className="timer-display">{formatTime(timerSeconds)}</div>

              {timerMode === 'countdown' && !timerRunning && timerSeconds === 0 && (
                <div className="timer-input-row">
                  <input
                    type="number"
                    className="timer-input"
                    value={timerInput}
                    min={1}
                    max={180}
                    onChange={e => setTimerInput(Math.max(1, parseInt(e.target.value) || 1))}
                  />
                  <span className="timer-unit">分</span>
                </div>
              )}

              <div className="timer-controls">
                {timerMode === 'countdown' && !timerRunning && timerSeconds === 0 ? (
                  <button className="timer-btn start" onClick={startCountdown}>
                    <Play size={14} /> 開始
                  </button>
                ) : (
                  <>
                    <button
                      className={`timer-btn${timerRunning ? ' pause' : ' start'}`}
                      onClick={() => {
                        setTimerRunning(v => !v);
                        if (!timerRunning) setTimerCollapsed(true);
                      }}
                    >
                      {timerRunning ? <Pause size={14} /> : <Play size={14} />}
                      {timerRunning ? '一時停止' : '再開'}
                    </button>
                    <button className="timer-btn reset" onClick={resetTimer}>
                      <RotateCcw size={14} /> リセット
                    </button>
                  </>
                )}
              </div>
            </div>
          )
        )}

        <div className="pdf-canvas-area">
          {isLoading && (
            <div className="pdf-status">
              <div className="pdf-spinner" />
              <span>読み込み中...</span>
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
                className={`pdf-overlay${annotationMode !== 'none' ? ' drawing' : ''}`}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
              />
            </div>
          )}
        </div>

        <style jsx>{`
          .pdf-fullscreen {
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            height: 100dvh;
            z-index: 3000;
            display: flex;
            flex-direction: column;
            background: #525659;
          }
          .pdf-fullscreen.timer-alert {
            animation: alertFlash 0.5s ease 3;
          }
          @keyframes alertFlash {
            0%, 100% { box-shadow: none; }
            50% { box-shadow: inset 0 0 0 6px rgba(239,68,68,0.7); }
          }
          .pdf-top-bar {
            height: 52px;
            background: var(--background);
            border-bottom: 1px solid var(--border);
            display: flex;
            align-items: center;
            gap: 4px;
            padding: 0 8px;
            flex-shrink: 0;
            overflow-x: auto;
            scrollbar-width: none;
          }
          .pdf-top-bar::-webkit-scrollbar { display: none; }
          .pdf-text-btn {
            display: flex;
            align-items: center;
            gap: 5px;
            padding: 6px 10px;
            background: transparent;
            color: var(--foreground);
            font-size: 0.85rem;
            font-weight: 600;
            border-radius: 8px;
            white-space: nowrap;
            cursor: pointer;
            transition: background 0.15s;
          }
          .pdf-text-btn:hover { background: var(--accent); }
          .pdf-icon-btn {
            width: 36px;
            height: 36px;
            display: flex;
            align-items: center;
            justify-content: center;
            background: transparent;
            color: var(--foreground);
            border-radius: 8px;
            text-decoration: none;
            flex-shrink: 0;
            cursor: pointer;
            transition: background 0.15s;
          }
          .pdf-icon-btn:hover { background: var(--accent); }
          .pdf-icon-btn:disabled { opacity: 0.3; cursor: default; }
          .pdf-icon-btn.active { background: var(--primary); color: white; }
          .pdf-nav-group, .pdf-zoom-group {
            display: flex;
            align-items: center;
            gap: 2px;
          }
          .pdf-page-label, .pdf-zoom-label {
            font-size: 0.8rem;
            font-weight: 600;
            color: var(--foreground);
            min-width: 52px;
            text-align: center;
            white-space: nowrap;
          }
          .pdf-bar-right {
            margin-left: auto;
            display: flex;
            align-items: center;
            gap: 2px;
            flex-shrink: 0;
          }
          /* Search panel */
          .search-panel {
            background: var(--background);
            border-bottom: 1px solid var(--border);
            padding: 8px 12px;
            flex-shrink: 0;
          }
          .search-form {
            display: flex;
            align-items: center;
            gap: 6px;
            background: var(--accent);
            border: 1px solid var(--border);
            border-radius: 10px;
            padding: 6px 10px;
          }
          .search-icon-inner { color: #999; flex-shrink: 0; }
          .search-input {
            flex: 1;
            border: none;
            background: transparent;
            font-size: 0.9rem;
            color: var(--foreground);
            outline: none;
            min-width: 0;
          }
          .search-count {
            font-size: 0.78rem;
            font-weight: 600;
            color: #888;
            white-space: nowrap;
            flex-shrink: 0;
          }
          .search-count.no-match { color: #f87171; }
          .search-nav-btn {
            width: 28px;
            height: 28px;
            display: flex;
            align-items: center;
            justify-content: center;
            background: transparent;
            color: var(--foreground);
            border-radius: 6px;
            flex-shrink: 0;
            cursor: pointer;
            transition: background 0.15s;
          }
          .search-nav-btn:hover { background: var(--border); }
          .search-nav-btn:disabled { opacity: 0.3; cursor: default; }
          .search-clear-btn {
            width: 24px;
            height: 24px;
            display: flex;
            align-items: center;
            justify-content: center;
            background: transparent;
            color: #999;
            border-radius: 4px;
            flex-shrink: 0;
            cursor: pointer;
            transition: color 0.15s;
          }
          .search-clear-btn:hover { color: var(--foreground); }
          /* Annotation bar */
          .annotation-bar {
            background: var(--background);
            border-bottom: 1px solid var(--border);
            padding: 8px 14px;
            display: flex;
            align-items: center;
            gap: 12px;
            flex-shrink: 0;
          }
          .annotation-label {
            font-size: 0.78rem;
            font-weight: 600;
            color: #888;
            white-space: nowrap;
          }
          .color-swatches {
            display: flex;
            gap: 6px;
          }
          .color-swatch {
            width: 22px;
            height: 22px;
            border-radius: 50%;
            border: 2px solid transparent;
            cursor: pointer;
            transition: transform 0.1s, border-color 0.1s;
            flex-shrink: 0;
          }
          .color-swatch:hover { transform: scale(1.15); }
          .color-swatch.active { border-color: var(--foreground); transform: scale(1.1); }
          .annotation-clear-btn {
            display: flex;
            align-items: center;
            gap: 4px;
            padding: 5px 10px;
            background: transparent;
            border: 1px solid var(--border);
            color: #f87171;
            border-radius: 7px;
            font-size: 0.78rem;
            font-weight: 600;
            cursor: pointer;
            margin-left: auto;
            transition: background 0.15s;
          }
          .annotation-clear-btn:hover { background: rgba(248,113,113,0.1); }
          /* Timer panel */
          .timer-panel {
            background: var(--background);
            border-bottom: 1px solid var(--border);
            padding: 12px 16px;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 10px;
            flex-shrink: 0;
          }
          .timer-panel-collapsed {
            background: var(--background);
            border-bottom: 1px solid var(--border);
            padding: 6px 16px;
            display: flex;
            align-items: center;
            gap: 8px;
            flex-shrink: 0;
            cursor: pointer;
            width: 100%;
            text-align: left;
            transition: background 0.15s;
          }
          .timer-panel-collapsed:hover { background: var(--accent); }
          .timer-panel-collapsed.alert { animation: alertFlash 0.5s ease 3; }
          .timer-display-mini {
            font-size: 1.3rem;
            font-weight: 700;
            font-variant-numeric: tabular-nums;
            color: var(--foreground);
            letter-spacing: 0.05em;
          }
          .timer-running-dot {
            width: 7px;
            height: 7px;
            border-radius: 50%;
            background: #22c55e;
            animation: timerPulse 1s ease-in-out infinite;
          }
          @keyframes timerPulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.3; }
          }
          .timer-panel-header {
            display: flex;
            align-items: center;
            gap: 8px;
            width: 100%;
            justify-content: space-between;
          }
          .timer-collapse-btn {
            display: flex;
            align-items: center;
            gap: 3px;
            padding: 4px 10px;
            border-radius: 6px;
            font-size: 0.78rem;
            font-weight: 600;
            color: #888;
            background: transparent;
            cursor: pointer;
            transition: background 0.15s, color 0.15s;
            flex-shrink: 0;
          }
          .timer-collapse-btn:hover { background: var(--accent); color: var(--foreground); }
          .timer-mode-tabs {
            display: flex;
            background: var(--accent);
            border-radius: 8px;
            padding: 3px;
          }
          .timer-tab {
            padding: 5px 14px;
            border-radius: 6px;
            font-size: 0.8rem;
            font-weight: 600;
            background: transparent;
            color: #888;
            cursor: pointer;
            transition: all 0.15s;
          }
          .timer-tab.active {
            background: var(--background);
            color: var(--primary);
            box-shadow: 0 1px 4px rgba(0,0,0,0.1);
          }
          .timer-display {
            font-size: 2.4rem;
            font-weight: 700;
            font-variant-numeric: tabular-nums;
            color: var(--foreground);
            letter-spacing: 0.05em;
          }
          .timer-input-row { display: flex; align-items: center; gap: 6px; }
          .timer-input {
            width: 64px;
            padding: 6px 8px;
            background: var(--accent);
            border: 1px solid var(--border);
            border-radius: 8px;
            font-size: 1rem;
            font-weight: 700;
            text-align: center;
            color: var(--foreground);
            outline: none;
          }
          .timer-unit { font-size: 0.9rem; color: #888; }
          .timer-controls { display: flex; gap: 8px; }
          .timer-btn {
            display: flex;
            align-items: center;
            gap: 5px;
            padding: 7px 16px;
            border-radius: 8px;
            font-size: 0.85rem;
            font-weight: 700;
            cursor: pointer;
            transition: opacity 0.15s;
          }
          .timer-btn.start { background: var(--primary); color: white; }
          .timer-btn.pause { background: #f59e0b; color: white; }
          .timer-btn.reset { background: var(--accent); color: var(--foreground); border: 1px solid var(--border); }
          .timer-btn:hover { opacity: 0.85; }
          /* Canvas area */
          .pdf-canvas-area {
            flex: 1;
            overflow: auto;
            display: flex;
            justify-content: center;
            padding: 16px;
            min-height: 0;
            -webkit-overflow-scrolling: touch;
          }
          .pdf-canvas-wrapper {
            position: relative;
            display: inline-block;
            align-self: flex-start;
          }
          .pdf-canvas {
            display: block;
            box-shadow: 0 4px 20px rgba(0,0,0,0.4);
            max-width: 100%;
            height: auto;
          }
          .pdf-overlay {
            position: absolute;
            top: 0;
            left: 0;
            pointer-events: none;
            touch-action: none;
          }
          .pdf-overlay.drawing {
            pointer-events: auto;
            cursor: crosshair;
          }
          .pdf-status {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 16px;
            color: #ccc;
            font-size: 0.9rem;
            min-height: 200px;
          }
          .pdf-error { color: #fca5a5; }
          .pdf-spinner {
            width: 40px;
            height: 40px;
            border: 3px solid rgba(255,255,255,0.2);
            border-top-color: var(--primary);
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
          }
          @keyframes spin { to { transform: rotate(360deg); } }
        `}</style>
      </div>
    );
  }

  // --- Home screen ---
  return (
    <div className="pdf-home">
      <div className="pdf-home-inner">
        <div className="pdf-header">
          <FileText size={32} className="pdf-header-icon" />
          <h2>PDF ビューア</h2>
          <p className="pdf-desc">試験問題などのPDFをページナビ・ズーム・タイマー付きで快適に閲覧できます</p>
        </div>

        <form onSubmit={handleUrlSubmit} className="url-form">
          <div className="url-input-row">
            <LinkIcon size={16} className="url-icon" />
            <input
              type="url"
              value={inputUrl}
              onChange={e => setInputUrl(e.target.value)}
              placeholder="PDFのURLを入力..."
              className="url-input"
            />
          </div>
          <button type="submit" className="btn-open" disabled={!inputUrl.trim()}>
            開く
          </button>
        </form>

        <div className="upload-section">
          <button className="btn-upload" onClick={() => fileInputRef.current?.click()}>
            <Upload size={18} />
            ファイルを選択して開く
          </button>
          <input ref={fileInputRef} type="file" accept="application/pdf" hidden onChange={handleFileUpload} />
        </div>
      </div>

      <style jsx>{`
        .pdf-home {
          flex: 1;
          overflow-y: auto;
          background: var(--background);
          display: flex;
          justify-content: center;
          padding: 40px 16px calc(60px + env(safe-area-inset-bottom) + 16px);
        }
        .pdf-home-inner {
          width: 100%;
          max-width: 520px;
          display: flex;
          flex-direction: column;
          gap: 24px;
        }
        .pdf-header { text-align: center; padding: 24px 0 8px; }
        .pdf-header-icon { color: var(--primary); margin-bottom: 12px; }
        .pdf-header h2 { font-size: 1.6rem; color: var(--primary); margin-bottom: 8px; }
        .pdf-desc { font-size: 0.85rem; color: #888; }
        .url-form {
          display: flex;
          flex-direction: column;
          gap: 10px;
          background: var(--accent);
          border: 1px solid var(--border);
          border-radius: 16px;
          padding: 20px;
        }
        .url-input-row {
          display: flex;
          align-items: center;
          gap: 8px;
          background: var(--background);
          border: 1px solid var(--border);
          border-radius: 10px;
          padding: 10px 12px;
        }
        .url-icon { color: #999; flex-shrink: 0; }
        .url-input {
          flex: 1;
          border: none;
          background: transparent;
          font-size: 0.95rem;
          color: var(--foreground);
          outline: none;
          min-width: 0;
        }
        .btn-open {
          padding: 12px;
          background: var(--primary);
          color: white;
          font-weight: 700;
          border-radius: 10px;
          border: none;
          cursor: pointer;
          font-size: 0.95rem;
          transition: opacity 0.2s;
        }
        .btn-open:disabled { opacity: 0.5; cursor: default; }
        .upload-section { display: flex; justify-content: center; }
        .btn-upload {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 12px 24px;
          background: transparent;
          border: 2px solid var(--primary);
          color: var(--primary);
          font-weight: 600;
          border-radius: 12px;
          cursor: pointer;
          font-size: 0.9rem;
          transition: background 0.2s;
        }
        .btn-upload:hover { background: var(--accent); }
      `}</style>
    </div>
  );
}
