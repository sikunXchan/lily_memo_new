'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { Upload, X, Download, Scissors, Grid3x3 } from 'lucide-react';
import { triggerDownload, sanitizeFilename } from '@/lib/fileGen';
import { useT } from '@/lib/i18n';

// One selection box, in fractions (0..1) of the image's natural size — so it
// stays correct regardless of how large the image is displayed on screen.
interface Rect { id: string; x: number; y: number; w: number; h: number; }
interface ExtractedAsset { id: string; url: string; blob: Blob; }

const MIN_RECT = 0.02; // ignore accidental taps smaller than 2% of the image

export default function ImageAssetExtractor() {
  const t = useT();
  const [imgSrc, setImgSrc] = useState('');
  const [fileBaseName, setFileBaseName] = useState('asset');
  const [rects, setRects] = useState<Rect[]>([]);
  const [drawing, setDrawing] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  // Set while an existing rect is being dragged to a new position. offsetX/Y
  // is the pointer's position relative to the rect's own top-left corner at
  // drag start, so the rect doesn't jump to re-center under the pointer.
  const [moving, setMoving] = useState<{ id: string; offsetX: number; offsetY: number } | null>(null);
  // Kept as raw text (not number) so the field can be freely cleared and
  // retyped — clamping this on every keystroke used to snap an emptied
  // field straight back to "1", which then ate the next digit typed
  // (e.g. clearing "2" and typing "6" produced "16" -> clamped to "12").
  const [gridRows, setGridRows] = useState('2');
  const [gridCols, setGridCols] = useState('2');
  const [extracted, setExtracted] = useState<ExtractedAsset[]>([]);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isZipping, setIsZipping] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const imgElRef = useRef<HTMLImageElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const extractedRef = useRef<ExtractedAsset[]>([]);
  extractedRef.current = extracted;

  useEffect(() => () => {
    extractedRef.current.forEach(a => URL.revokeObjectURL(a.url));
  }, []);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    extracted.forEach(a => URL.revokeObjectURL(a.url));
    setExtracted([]);
    setRects([]);
    setFileBaseName(file.name.replace(/\.[^.]+$/, '') || 'asset');
    const reader = new FileReader();
    reader.onload = ev => setImgSrc(ev.target!.result as string);
    reader.readAsDataURL(file);
  };

  const resetImage = () => {
    extracted.forEach(a => URL.revokeObjectURL(a.url));
    setImgSrc(''); setRects([]); setExtracted([]); setDrawing(null);
  };

  const relPos = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    return { x, y };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('.iae-rect-del')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = relPos(e);
    setDrawing({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
  };
  // Pointerdown on an already-drawn rect starts moving it instead of drawing
  // a new one — stopPropagation keeps the overlay's onPointerDown above from
  // also firing and starting a fresh selection underneath it.
  const onRectPointerDown = (e: React.PointerEvent<HTMLDivElement>, r: Rect) => {
    if ((e.target as HTMLElement).closest('.iae-rect-del')) return;
    e.stopPropagation();
    const overlay = overlayRef.current;
    if (!overlay) return;
    overlay.setPointerCapture(e.pointerId);
    const bounds = overlay.getBoundingClientRect();
    const px = (e.clientX - bounds.left) / bounds.width;
    const py = (e.clientY - bounds.top) / bounds.height;
    setMoving({ id: r.id, offsetX: px - r.x, offsetY: py - r.y });
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (moving) {
      const p = relPos(e);
      setRects(prev => prev.map(r => (r.id === moving.id
        ? {
          ...r,
          x: Math.min(Math.max(p.x - moving.offsetX, 0), 1 - r.w),
          y: Math.min(Math.max(p.y - moving.offsetY, 0), 1 - r.h),
        }
        : r)));
      return;
    }
    if (!drawing) return;
    const p = relPos(e);
    setDrawing(d => (d ? { ...d, x1: p.x, y1: p.y } : d));
  };
  const finishDrawing = () => {
    if (moving) { setMoving(null); return; }
    if (!drawing) return;
    const x = Math.min(drawing.x0, drawing.x1);
    const y = Math.min(drawing.y0, drawing.y1);
    const w = Math.abs(drawing.x1 - drawing.x0);
    const h = Math.abs(drawing.y1 - drawing.y0);
    setDrawing(null);
    if (w < MIN_RECT || h < MIN_RECT) return;
    setRects(prev => [...prev, { id: crypto.randomUUID(), x, y, w, h }]);
  };

  const removeRect = (id: string) => setRects(prev => prev.filter(r => r.id !== id));
  const clearRects = () => setRects([]);

  const clampGrid = (v: string) => Math.max(1, Math.min(12, parseInt(v, 10) || 1));

  const applyGrid = () => {
    const rows = clampGrid(gridRows);
    const cols = clampGrid(gridCols);
    setGridRows(String(rows));
    setGridCols(String(cols));
    const next: Rect[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        next.push({ id: crypto.randomUUID(), x: c / cols, y: r / rows, w: 1 / cols, h: 1 / rows });
      }
    }
    setRects(next);
  };

  const extractAll = async () => {
    const img = imgElRef.current;
    if (!img || rects.length === 0 || isExtracting) return;
    setIsExtracting(true);
    try {
      const results: ExtractedAsset[] = [];
      for (const r of rects) {
        const sx = Math.round(r.x * img.naturalWidth);
        const sy = Math.round(r.y * img.naturalHeight);
        const sw = Math.max(1, Math.round(r.w * img.naturalWidth));
        const sh = Math.max(1, Math.round(r.h * img.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = sw; canvas.height = sh;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
        const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/png'));
        if (blob) results.push({ id: crypto.randomUUID(), url: URL.createObjectURL(blob), blob });
      }
      setExtracted(prev => [...prev, ...results]);
    } finally {
      setIsExtracting(false);
    }
  };

  const removeExtracted = (id: string) => setExtracted(prev => {
    const target = prev.find(a => a.id === id);
    if (target) URL.revokeObjectURL(target.url);
    return prev.filter(a => a.id !== id);
  });

  const downloadOne = useCallback((asset: ExtractedAsset, idx: number) => {
    triggerDownload(asset.blob, sanitizeFilename(`${fileBaseName || 'asset'}_${idx + 1}.png`));
  }, [fileBaseName]);

  const downloadAllZip = async () => {
    if (!extracted.length || isZipping) return;
    setIsZipping(true);
    try {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      extracted.forEach((a, i) => {
        zip.file(sanitizeFilename(`${fileBaseName || 'asset'}_${i + 1}.png`), a.blob);
      });
      const blob = await zip.generateAsync({ type: 'blob' });
      triggerDownload(blob, sanitizeFilename(`${fileBaseName || 'asset'}.zip`));
    } catch (e) {
      console.error('ZIP error', e);
    } finally {
      setIsZipping(false);
    }
  };

  const drawingStyle = drawing ? {
    left: `${Math.min(drawing.x0, drawing.x1) * 100}%`,
    top: `${Math.min(drawing.y0, drawing.y1) * 100}%`,
    width: `${Math.abs(drawing.x1 - drawing.x0) * 100}%`,
    height: `${Math.abs(drawing.y1 - drawing.y0) * 100}%`,
  } : null;

  return (
    <div className="iae-section">
      <div className="iae-header">
        <Scissors size={18} className="iae-icon" />
        <span>{t('画像から素材を切り出す')}</span>
      </div>
      <p className="iae-desc">{t('1枚の画像に複数のイラストやアイコンがある場合、範囲を選んで個別の画像として保存できます')}</p>

      {!imgSrc ? (
        <button className="btn-add-photos" onClick={() => fileInputRef.current?.click()}>
          <Upload size={16} />{t('画像を選択')}
        </button>
      ) : (
        <>
          <div className="iae-toolbar">
            <div className="iae-hints">
              <span className="iae-hint">{t('ドラッグして切り出したい範囲を囲んでください')}</span>
              <span className="iae-hint">{t('作成済みの範囲はドラッグで移動できます')}</span>
            </div>
            <button className="iae-icon-btn" onClick={resetImage} title={t('画像を閉じる')}><X size={14} /></button>
          </div>

          <div className="iae-stage">
            <img ref={imgElRef} src={imgSrc} alt="" className="iae-img" draggable={false} />
            <div
              className="iae-overlay"
              ref={overlayRef}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={finishDrawing}
              onPointerCancel={finishDrawing}
            >
              {rects.map((r, i) => (
                <div key={r.id} className={`iae-rect${moving?.id === r.id ? ' moving' : ''}`}
                  style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` }}
                  onPointerDown={e => onRectPointerDown(e, r)}>
                  <span className="iae-rect-num">{i + 1}</span>
                  <button className="iae-rect-del" onPointerDown={e => e.stopPropagation()}
                    onClick={() => removeRect(r.id)}><X size={10} /></button>
                </div>
              ))}
              {drawingStyle && <div className="iae-rect drawing" style={drawingStyle} />}
            </div>
          </div>

          <div className="iae-grid-row">
            <Grid3x3 size={14} className="iae-grid-icon" />
            <input type="number" className="iae-num-input" min={1} max={12} value={gridRows}
              onChange={e => setGridRows(e.target.value)}
              onBlur={() => setGridRows(String(clampGrid(gridRows)))} />
            <span className="iae-grid-label">{t('行')}</span>
            <input type="number" className="iae-num-input" min={1} max={12} value={gridCols}
              onChange={e => setGridCols(e.target.value)}
              onBlur={() => setGridCols(String(clampGrid(gridCols)))} />
            <span className="iae-grid-label">{t('列')}</span>
            <button className="iae-small-btn" onClick={applyGrid}>{t('グリッドで自動分割')}</button>
          </div>

          <div className="iae-status-row">
            <span className="iae-count">{t('{n}個の範囲を選択中', { n: rects.length })}</span>
            {rects.length > 0 && <button className="iae-link-btn" onClick={clearRects}>{t('選択をすべて削除')}</button>}
          </div>

          <div className="iae-name-row">
            <span className="iae-grid-label">{t('保存名')}</span>
            <input type="text" className="iae-name-input" value={fileBaseName}
              onChange={e => setFileBaseName(e.target.value)} />
          </div>

          <button className="btn-create-pdf" onClick={() => void extractAll()} disabled={rects.length === 0 || isExtracting}>
            {isExtracting ? t('切り出し中...') : t('切り出す（{n}個）', { n: rects.length })}
          </button>

          {extracted.length > 0 && (
            <div className="iae-result">
              <div className="iae-result-header">{t('切り出した画像（{n}枚）', { n: extracted.length })}</div>
              <div className="iae-thumbs">
                {extracted.map((a, i) => (
                  <div key={a.id} className="iae-thumb-wrap">
                    <img src={a.url} alt="" className="iae-thumb" />
                    <span className="iae-thumb-num">{i + 1}</span>
                    <button className="iae-thumb-dl" onClick={() => downloadOne(a, i)}
                      title={t('{name} をダウンロード', { name: `${fileBaseName || 'asset'}_${i + 1}.png` })}>
                      <Download size={12} />
                    </button>
                    <button className="iae-thumb-del" onClick={() => removeExtracted(a.id)} title={t('削除')}>
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
              {extracted.length > 1 && (
                <button className="iae-zip-btn" onClick={() => void downloadAllZip()} disabled={isZipping}>
                  <Download size={14} />
                  {isZipping ? t('ZIPを作成中...') : t('{n}ファイルをまとめてZIPダウンロード', { n: extracted.length })}
                </button>
              )}
            </div>
          )}
        </>
      )}

      <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={handleFile} />

      <style jsx>{`
        .iae-section {
          background:var(--accent); border:1px solid var(--border);
          border-radius:16px; padding:20px; display:flex;
          flex-direction:column; gap:14px;
        }
        .iae-header {
          display:flex; align-items:center; gap:8px;
          font-size:0.95rem; font-weight:700; color:var(--foreground);
        }
        .iae-icon { color:var(--primary); }
        .iae-desc { font-size:0.8rem; color:#888; margin:0; }
        .btn-add-photos {
          display:flex; align-items:center; gap:6px;
          padding:10px 16px; background:var(--background);
          border:1px solid var(--border); color:var(--foreground);
          font-size:0.88rem; font-weight:600; border-radius:10px;
          cursor:pointer; transition:background 0.15s; width:fit-content;
        }
        .btn-add-photos:hover { background:var(--border); }
        .iae-toolbar { display:flex; align-items:flex-start; justify-content:space-between; gap:8px; }
        .iae-hints { display:flex; flex-direction:column; gap:2px; }
        .iae-hint { font-size:0.78rem; color:#888; }
        .iae-icon-btn {
          width:28px; height:28px; flex-shrink:0; display:flex; align-items:center; justify-content:center;
          background:var(--background); border:1px solid var(--border); border-radius:8px;
          color:var(--foreground); cursor:pointer;
        }
        .iae-stage {
          position:relative; width:100%; line-height:0;
          border-radius:10px; overflow:hidden; border:1px solid var(--border);
          background:repeating-conic-gradient(#00000010 0% 25%, transparent 0% 50%) 0 0/16px 16px;
        }
        .iae-img { width:100%; height:auto; display:block; user-select:none; }
        .iae-overlay {
          position:absolute; inset:0; touch-action:none; cursor:crosshair;
        }
        .iae-rect {
          position:absolute; border:2px solid var(--primary);
          background:color-mix(in srgb, var(--primary) 18%, transparent);
          box-sizing:border-box; cursor:move; touch-action:none;
        }
        .iae-rect.moving { background:color-mix(in srgb, var(--primary) 30%, transparent); z-index:1; }
        .iae-rect.drawing { border-style:dashed; pointer-events:none; cursor:crosshair; }
        .iae-rect-num {
          position:absolute; top:2px; left:2px;
          background:var(--primary); color:#fff; font-size:0.65rem; font-weight:700;
          padding:1px 5px; border-radius:4px; line-height:1.4;
        }
        .iae-rect-del {
          position:absolute; top:-8px; right:-8px;
          width:18px; height:18px; border-radius:50%;
          background:#ef4444; color:#fff;
          display:flex; align-items:center; justify-content:center; cursor:pointer;
        }
        .iae-grid-row { display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
        .iae-grid-icon { color:#888; flex-shrink:0; }
        .iae-num-input {
          width:44px; padding:6px 4px; text-align:center;
          background:var(--background); border:1px solid var(--border);
          border-radius:8px; color:var(--foreground); font-size:0.85rem; outline:none;
        }
        .iae-grid-label { font-size:0.78rem; color:#888; margin-right:4px; }
        .iae-small-btn {
          padding:6px 12px; background:var(--background); border:1px solid var(--border);
          border-radius:8px; font-size:0.78rem; font-weight:600; color:var(--foreground);
          cursor:pointer; white-space:nowrap;
        }
        .iae-small-btn:hover { background:var(--border); }
        .iae-status-row { display:flex; align-items:center; justify-content:space-between; }
        .iae-count { font-size:0.8rem; color:var(--foreground); font-weight:600; }
        .iae-link-btn {
          background:none; border:none; color:var(--primary);
          font-size:0.78rem; font-weight:600; cursor:pointer; text-decoration:underline;
        }
        .iae-name-row { display:flex; align-items:center; gap:8px; }
        .iae-name-input {
          flex:1; min-width:0; padding:8px 10px;
          background:var(--background); border:1px solid var(--border);
          border-radius:8px; color:var(--foreground); font-size:0.85rem; outline:none;
        }
        .btn-create-pdf {
          padding:12px; background:var(--primary); color:white;
          font-weight:700; border-radius:10px; border:none;
          cursor:pointer; font-size:0.95rem; transition:opacity 0.2s;
        }
        .btn-create-pdf:disabled { opacity:0.6; cursor:default; }
        .iae-result { display:flex; flex-direction:column; gap:10px; }
        .iae-result-header { font-size:0.85rem; font-weight:700; color:var(--foreground); }
        .iae-thumbs { display:flex; gap:10px; flex-wrap:wrap; }
        .iae-thumb-wrap { position:relative; width:72px; height:72px; flex-shrink:0; }
        .iae-thumb {
          width:72px; height:72px; object-fit:contain;
          border-radius:8px; border:1px solid var(--border);
          background:var(--background); display:block;
        }
        .iae-thumb-num {
          position:absolute; bottom:3px; left:3px;
          background:rgba(0,0,0,0.6); color:white;
          font-size:0.65rem; font-weight:700;
          padding:1px 5px; border-radius:4px; pointer-events:none;
        }
        .iae-thumb-del {
          position:absolute; top:-6px; right:-6px;
          width:20px; height:20px;
          background:#ef4444; color:white; border-radius:50%;
          display:flex; align-items:center; justify-content:center; cursor:pointer;
        }
        .iae-thumb-dl {
          position:absolute; bottom:3px; right:3px;
          width:22px; height:22px;
          background:rgba(0,0,0,0.6); color:white; border:none; border-radius:6px;
          display:flex; align-items:center; justify-content:center; cursor:pointer;
        }
        .iae-zip-btn {
          display:flex; align-items:center; justify-content:center; gap:8px;
          padding:10px 16px; background:linear-gradient(135deg, color-mix(in srgb, var(--primary) 15%, transparent), color-mix(in srgb, var(--primary) 8%, transparent));
          border:1.5px dashed var(--primary); border-radius:10px; color:var(--primary);
          font-size:0.85rem; font-weight:700; cursor:pointer; transition:all 0.15s;
        }
        .iae-zip-btn:hover:not(:disabled) { background:var(--primary); color:white; }
        .iae-zip-btn:disabled { opacity:0.6; cursor:default; }
      `}</style>
    </div>
  );
}
