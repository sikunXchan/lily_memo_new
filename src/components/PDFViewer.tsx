'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import {
  X, Upload, FileText, Link as LinkIcon, ExternalLink,
  ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Clock,
  Play, Pause, RotateCcw,
} from 'lucide-react';
import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';

if (typeof window !== 'undefined') {
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
}

const ZOOM_LEVELS = [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0, 2.5];
const DEFAULT_ZOOM_INDEX = 4; // 1.5x

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
  const [timerMode, setTimerMode] = useState<'stopwatch' | 'countdown'>('stopwatch');
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [timerRunning, setTimerRunning] = useState(false);
  const [timerInput, setTimerInput] = useState(25);
  const [timerAlert, setTimerAlert] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const blobUrlRef = useRef('');

  const scale = ZOOM_LEVELS[zoomIndex];
  const hasPDF = pdfDoc !== null;

  const loadPDF = useCallback(async (url: string, originalUrl: string) => {
    setIsLoading(true);
    setError('');
    setPdfDoc(null);
    setCurrentPage(1);
    setTotalPages(0);
    setOpenUrl(originalUrl);

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
  };

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

  // Keyboard navigation
  useEffect(() => {
    if (!hasPDF) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        setCurrentPage(p => Math.min(totalPages, p + 1));
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        setCurrentPage(p => Math.max(1, p - 1));
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
  };

  const resetTimer = () => {
    setTimerSeconds(0);
    setTimerRunning(false);
    setTimerAlert(false);
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
              className={`pdf-icon-btn${showTimer ? ' active' : ''}`}
              onClick={() => setShowTimer(v => !v)}
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

        {showTimer && (
          <div className="timer-panel">
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
                    onClick={() => setTimerRunning(v => !v)}
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
            <canvas ref={canvasRef} className="pdf-canvas" />
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
          .timer-input-row {
            display: flex;
            align-items: center;
            gap: 6px;
          }
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
          .pdf-canvas-area {
            flex: 1;
            overflow: auto;
            display: flex;
            justify-content: center;
            padding: 16px;
            min-height: 0;
            -webkit-overflow-scrolling: touch;
          }
          .pdf-canvas {
            display: block;
            box-shadow: 0 4px 20px rgba(0,0,0,0.4);
            max-width: 100%;
            height: auto;
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
