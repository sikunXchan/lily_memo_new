'use client';

import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import {
  Book, FileText, Sparkles, GraduationCap, Settings,
  Plus, ListTodo, Camera, X, PencilLine, Pen, NotebookPen,
} from 'lucide-react';
import { db, newSyncId } from '@/lib/db';
import type { Todo, AlbumPhoto } from '@/lib/db';
import { useTheme } from './ThemeContext';
import { useT } from '@/lib/i18n';
import { getAppLang } from '@/lib/appLang';

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const SPLASH_IMAGES = Array.from({ length: 9 }, (_, i) => `/splash-0${i + 1}.png`);

type TimeOfDay = 'dawn' | 'day' | 'dusk' | 'night';

function getTimeOfDay(h: number): TimeOfDay {
  if (h >= 5  && h < 7)  return 'dawn';
  if (h >= 7  && h < 17) return 'day';
  if (h >= 17 && h < 20) return 'dusk';
  return 'night';
}

const SKY: Record<TimeOfDay, string> = {
  dawn:  'linear-gradient(180deg, #f97316 0%, #fb923c 22%, #fde68a 55%, #e0f2fe 100%)',
  day:   'linear-gradient(180deg, #0ea5e9 0%, #38bdf8 45%, #bae6fd 100%)',
  dusk:  'linear-gradient(180deg, #1e0a3c 0%, #7c3aed 28%, #db2777 58%, #f97316 82%, #fde68a 100%)',
  night: 'linear-gradient(180deg, #020617 0%, #0f172a 55%, #1e1b4b 100%)',
};

// Deterministic stars (golden-angle distribution)
const STARS = Array.from({ length: 55 }, (_, i) => ({
  cx: +((i * 137.508) % 100).toFixed(2),
  cy: +((i * 89.3)   % 65).toFixed(2),
  r:  i % 5 === 0 ? 1.9 : i % 3 === 0 ? 1.2 : 0.7,
  delay: +((i * 0.23) % 2.8).toFixed(2),
}));


interface BubbleItem {
  key: string; label: string; tint: string; size: number;
  pos: React.CSSProperties; floatDelay: number;
  windAnim: number; windDur: number; isNew?: boolean;
}

const BUBBLES: BubbleItem[] = [
  { key: 'memos',    label: 'メモ',      tint: '#ffb6c1', size: 124, pos: { left: '4%',   top: 0   }, floatDelay: 0,   windAnim: 0, windDur: 6.2 },
  { key: 'ai',       label: 'AI',        tint: '#c7d2fe', size: 102, pos: { right: '2%',  top: 14  }, floatDelay: 1.1, windAnim: 1, windDur: 5.8 },
  { key: 'study',    label: '学習',      tint: '#86efac', size: 94,  pos: { left: '24%',  top: 112 }, floatDelay: 0.6, windAnim: 0, windDur: 6.5 },
  { key: 'practice', label: '演習',      tint: '#e9d5ff', size: 98,  pos: { right: '5%',  top: 150 }, floatDelay: 1.5, windAnim: 2, windDur: 6.3, isNew: true },
  { key: 'pdf',      label: 'PDF',       tint: '#c4b5fd', size: 80,  pos: { left: '2%',   top: 228 }, floatDelay: 1.6, windAnim: 1, windDur: 5.5 },
  { key: 'diary',    label: '日記',       tint: '#fde68a', size: 66,  pos: { left: '44%',  top: 232 }, floatDelay: 1.3, windAnim: 1, windDur: 6.1 },
  { key: 'todo',     label: 'ToDo',      tint: '#bbf7d0', size: 72,  pos: { right: '16%', top: 298 }, floatDelay: 0.9, windAnim: 2, windDur: 6.4 },
  { key: 'new',      label: '新規',      tint: '#fecdd3', size: 62,  pos: { left: '10%',  top: 350 }, floatDelay: 1.8, windAnim: 1, windDur: 5.9, isNew: true },
  { key: 'settings', label: '設定',      tint: '#e2e8f0', size: 66,  pos: { right: '6%',  top: 350 }, floatDelay: 0.3, windAnim: 0, windDur: 7.2 },
  { key: 'sketch',   label: '落書き',    tint: '#fef3c7', size: 70,  pos: { left: '44%',  top: 420 }, floatDelay: 1.0, windAnim: 1, windDur: 6.0 },
];

function BubbleIcon({ navKey, size }: { navKey: string; size: number }) {
  const s = Math.round(size * 0.3);
  const p = { size: s, color: '#fff', strokeWidth: 2.1 };
  switch (navKey) {
    case 'memos':    return <Book {...p} />;
    case 'ai':       return <Sparkles {...p} />;
    case 'study':    return <GraduationCap {...p} />;
    case 'practice': return <PencilLine {...p} />;
    case 'diary':    return <NotebookPen {...p} />;
    case 'pdf':      return <FileText {...p} />;
    case 'todo':     return <ListTodo {...p} />;
    case 'settings': return <Settings {...p} />;
    case 'sketch':   return <Pen {...p} />;
    case 'new':      return <Plus size={Math.round(size * 0.34)} color="#ff8da1" strokeWidth={2.6} />;
    default:         return null;
  }
}

interface BubbleHomeProps {
  onSelectNote: (id: number) => void;
  onNavigate: (tab: string) => void;
}

export default function BubbleHome({ onSelectNote, onNavigate }: BubbleHomeProps) {
  const { cycleTheme, nextThemeName } = useTheme();
  const t = useT();

  const pinnedTodos = useLiveQuery<Todo[]>(() =>
    db.todos.filter(t => t.pinned && !t.done).toArray()
  ) ?? [];

  const albumPhotos = useLiveQuery<AlbumPhoto[]>(() =>
    db.albumPhotos.orderBy('createdAt').toArray()
  ) ?? [];

  const [albumUrls, setAlbumUrls] = useState<string[]>([]);
  const [deleteOverlayId, setDeleteOverlayId] = useState<number | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const urls = albumPhotos.map(p => URL.createObjectURL(p.blob));
    setAlbumUrls(urls);
    return () => {
      urls.forEach(u => URL.revokeObjectURL(u));
    };
  }, [albumPhotos]);

  const handleAddPhotos = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    for (const file of files) {
      const buf = await file.arrayBuffer();
      await db.albumPhotos.add({
        blob: new Blob([buf], { type: file.type }),
        mimeType: file.type,
        createdAt: Date.now(),
      });
    }
    // Reset input so same file can be re-selected
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleLongPressStart = (id: number) => {
    longPressTimer.current = setTimeout(() => {
      setDeleteOverlayId(id);
    }, 600);
  };

  const handleLongPressEnd = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const handlePhotoTap = (id: number) => {
    if (deleteOverlayId === id) {
      setDeleteOverlayId(null);
    }
  };

  const handleDeletePhoto = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    await db.albumPhotos.delete(id);
    setDeleteOverlayId(null);
  };

  const now     = new Date();
  const tod     = getTimeOfDay(now.getHours());
  const isLight = tod === 'day' || tod === 'dawn';
  const isNight = tod === 'night';
  const labelColor = isLight ? '#3a2d32' : 'rgba(255,255,255,.9)';
  const dateColor  = isLight ? '#c79aa8' : 'rgba(255,255,255,.55)';
  const dateLabel  = getAppLang() === 'en'
    ? `${WEEKDAYS[now.getDay()]} · ${MONTHS_EN[now.getMonth()]} ${now.getDate()}`
    : `${WEEKDAYS[now.getDay()]} · ${now.getMonth() + 1}月${now.getDate()}日`;

  const createNote = async () => {
    const ts = Date.now();
    const id = await db.notes.add({
      syncId: newSyncId(), title: t('無題のメモ'), content: '',
      folderId: undefined, type: 'text', createdAt: ts, updatedAt: ts,
    });
    onSelectNote(id as number);
  };

  const handleBubbleTap = (key: string) => {
    if (key === 'new') { void createNote(); return; }
    onNavigate(key);
  };

  return (
    <div className="bh-root" style={{ background: SKY[tod] }}>

      {/* Stars */}
      {isNight && (
        <svg className="bh-stars" viewBox="0 0 100 65" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
          {STARS.map((s, i) => (
            <circle key={i} cx={s.cx} cy={s.cy} r={s.r} fill="white"
              style={{ animationDelay: `${s.delay}s` }} className="bh-star" />
          ))}
        </svg>
      )}

      {/* Clouds */}
      {isLight && (
        <div className="bh-clouds" aria-hidden="true">
          <div className="bh-cloud bh-cloud-1" />
          <div className="bh-cloud bh-cloud-2" />
          <div className="bh-cloud bh-cloud-3" />
        </div>
      )}

      {/* Header */}
      <div className="bh-header">
        <div>
          <div className="bh-date" style={{ color: dateColor }}>{dateLabel}</div>
          <div className="bh-title">Lily Memo</div>
        </div>
        <button className="bh-theme-btn" onClick={cycleTheme}
          title={t('テーマ切替（次: {name}）', { name: nextThemeName })}
          style={{
            background: isLight ? 'rgba(255,255,255,.75)' : 'rgba(255,255,255,.1)',
            borderColor: isLight ? '#ffe0e8' : 'rgba(255,255,255,.2)',
          }}>
          <Sparkles size={14} color={isLight ? '#ff8da1' : '#e2e8f0'} />
        </button>
      </div>

      {/* Pinned ToDo ticker */}
      {pinnedTodos.length > 0 && (
        <div className="bh-ticker" aria-live="polite">
          <span className="bh-ticker-badge">📌 ToDo</span>
          <div className="bh-ticker-track-wrap">
            <div className="bh-ticker-track">
              {[...pinnedTodos, ...pinnedTodos].map((t, i) => (
                <span key={i} className="bh-ticker-item">● {t.text}</span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Bubble cluster */}
      <div className="bh-cluster">
        {(getAppLang() === 'en' ? BUBBLES.filter(b => b.key !== 'diary') : BUBBLES).map(b => (
          <div key={b.key} style={{ ...b.pos, position: 'absolute' }}>
            <button
              className="bh-bubble"
              style={{
                width: b.size,
                '--tint': b.tint,
                animationName: `bh-wind-${b.windAnim}`,
                animationDuration: `${b.windDur}s`,
                animationDelay: `${b.floatDelay}s`,
              } as React.CSSProperties}
              onClick={() => handleBubbleTap(b.key)}
            >
              <span className="bh-skin" style={{ '--tint': b.tint } as React.CSSProperties}>
                <BubbleIcon navKey={b.key} size={b.size} />
                <span className="bh-spec" />
                <span className="bh-rim" />
              </span>
              <span className="bh-label" style={{ color: b.isNew ? '#ff8da1' : labelColor }}>
                {t(b.label)}
              </span>
            </button>
          </div>
        ))}

      </div>

      {/* Album strip */}
      <div className="bh-album" aria-hidden={albumPhotos.length === 0 ? 'true' : undefined}>
        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: 'none' }}
          onChange={handleAddPhotos}
        />
        {/* Camera add button */}
        <button
          className="bh-album-add-btn"
          aria-label={t('写真を追加')}
          onClick={() => fileInputRef.current?.click()}
        >
          <Camera size={16} color="rgba(255,255,255,0.9)" />
        </button>
        <div className="bh-album-track">
          {albumPhotos.length > 0
            ? [...albumUrls, ...albumUrls].map((src, i) => {
                const photo = albumPhotos[i % albumPhotos.length];
                const photoId = photo?.id ?? i;
                return (
                  <button
                    key={i}
                    className="bh-album-btn"
                    onTouchStart={() => handleLongPressStart(photoId)}
                    onTouchEnd={handleLongPressEnd}
                    onTouchCancel={handleLongPressEnd}
                    onMouseDown={() => handleLongPressStart(photoId)}
                    onMouseUp={handleLongPressEnd}
                    onMouseLeave={handleLongPressEnd}
                    onClick={() => handlePhotoTap(photoId)}
                    aria-label={t('写真')}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img className="bh-album-img" src={src} alt="" draggable={false} />
                    {deleteOverlayId === photoId && (
                      <span
                        className="bh-album-del"
                        role="button"
                        aria-label={t('削除')}
                        onClick={(e) => void handleDeletePhoto(photoId, e)}
                      >
                        <X size={12} color="#fff" strokeWidth={3} />
                      </span>
                    )}
                  </button>
                );
              })
            : [...SPLASH_IMAGES, ...SPLASH_IMAGES].map((src, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={i} className="bh-album-img" src={src} alt="" draggable={false} />
              ))
          }
        </div>
      </div>

      <style jsx>{`
        .bh-root {
          flex: 1; display: flex; flex-direction: column;
          overflow: hidden; position: relative;
          padding: 0 14px;
          padding-bottom: env(safe-area-inset-bottom);
        }

        /* ── Stars ── */
        .bh-stars {
          position: absolute; inset: 0; width: 100%; height: 100%;
          pointer-events: none; z-index: 0;
        }
        .bh-star {
          animation: bh-twinkle 3s ease-in-out infinite;
          opacity: .15;
        }
        @keyframes bh-twinkle {
          0%, 100% { opacity: .12; }
          50%       { opacity: .95; }
        }

        /* ── Clouds ── */
        .bh-clouds {
          position: absolute; inset: 0; overflow: hidden;
          pointer-events: none; z-index: 0;
        }
        .bh-cloud {
          position: absolute;
          background: rgba(255,255,255,.7);
          border-radius: 50px;
        }
        .bh-cloud::before, .bh-cloud::after {
          content: ''; position: absolute;
          background: inherit; border-radius: 50%;
        }
        .bh-cloud-1 {
          width: 100px; height: 30px; top: 14%;
          animation: bh-drift 55s linear infinite;
        }
        .bh-cloud-1::before { width: 50px; height: 44px; top: -22px; left: 12px; }
        .bh-cloud-1::after  { width: 38px; height: 32px; top: -14px; right: 12px; }
        .bh-cloud-2 {
          width: 76px; height: 24px; top: 28%;
          animation: bh-drift 75s linear infinite; animation-delay: -22s;
        }
        .bh-cloud-2::before { width: 40px; height: 34px; top: -18px; left: 8px; }
        .bh-cloud-2::after  { width: 30px; height: 26px; top: -12px; right: 8px; }
        .bh-cloud-3 {
          width: 60px; height: 18px; top: 20%;
          animation: bh-drift 90s linear infinite; animation-delay: -40s;
        }
        .bh-cloud-3::before { width: 30px; height: 26px; top: -14px; left: 6px; }
        .bh-cloud-3::after  { width: 24px; height: 20px; top: -8px; right: 6px; }
        @keyframes bh-drift {
          from { transform: translateX(-180px); }
          to   { transform: translateX(calc(100vw + 180px)); }
        }

        /* ── Header ── */
        .bh-header {
          flex-shrink: 0; display: flex; align-items: flex-start;
          justify-content: space-between; padding: 10px 4px 6px;
          position: relative; z-index: 2;
        }
        .bh-date {
          font-family: 'Outfit', sans-serif; font-size: 10px; font-weight: 700;
          letter-spacing: .22em; transition: color .6s;
        }
        .bh-title {
          font-family: 'Outfit', sans-serif; font-size: 25px; font-weight: 800;
          letter-spacing: -.02em; margin-top: 2px;
          background: linear-gradient(120deg, #ff8da1, #93c5fd);
          -webkit-background-clip: text; background-clip: text; color: transparent;
        }
        .bh-theme-btn {
          width: 32px; height: 32px; border-radius: 99px; border: 1px solid;
          display: flex; align-items: center; justify-content: center;
          cursor: pointer; flex-shrink: 0; margin-top: 14px;
          box-shadow: 0 2px 10px rgba(0,0,0,.15);
          transition: background .3s, border-color .3s;
        }

        /* ── Cluster ── */
        .bh-cluster {
          position: relative; flex: 1; min-height: 0;
          margin: 2px 0;
        }

        /* ── Bubbles ── */
        .bh-bubble {
          display: flex; flex-direction: column; align-items: center; gap: 6px;
          background: none; border: none; padding: 0; cursor: pointer;
          animation-timing-function: ease-in-out;
          animation-iteration-count: infinite;
          will-change: transform;
        }
        .bh-bubble:active { transform: scale(.92) !important; }
        @keyframes bh-wind-0 {
          0%   { transform: translate(0,0); }
          20%  { transform: translate(5px,-7px); }
          45%  { transform: translate(-3px,-11px); }
          65%  { transform: translate(6px,-8px); }
          85%  { transform: translate(2px,-4px); }
          100% { transform: translate(0,0); }
        }
        @keyframes bh-wind-1 {
          0%   { transform: translate(0,0); }
          25%  { transform: translate(-6px,-9px); }
          50%  { transform: translate(4px,-13px); }
          75%  { transform: translate(-4px,-6px); }
          100% { transform: translate(0,0); }
        }
        @keyframes bh-wind-2 {
          0%   { transform: translate(0,0); }
          30%  { transform: translate(7px,-10px); }
          55%  { transform: translate(-5px,-7px); }
          70%  { transform: translate(4px,-12px); }
          100% { transform: translate(0,0); }
        }
        .bh-skin {
          position: relative; width: 100%; aspect-ratio: 1; border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          background:
            radial-gradient(circle at 32% 26%, rgba(255,255,255,.95), rgba(255,255,255,.32) 22%, transparent 42%),
            radial-gradient(circle at 70% 74%,
              color-mix(in srgb, var(--tint) 70%, #fff),
              color-mix(in srgb, var(--tint) 35%, transparent) 70%);
          box-shadow:
            0 12px 32px color-mix(in srgb, var(--tint) 55%, transparent),
            inset 0 0 18px rgba(255,255,255,.55),
            inset -6px -8px 16px color-mix(in srgb, var(--tint) 40%, transparent);
          border: 1.5px solid rgba(255,255,255,.65);
        }
        .bh-spec {
          position: absolute; top: 11%; left: 16%; width: 30%; height: 22%;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(255,255,255,.95), transparent 70%);
          z-index: 2; pointer-events: none;
        }
        .bh-rim {
          position: absolute; inset: 0; border-radius: 50%; pointer-events: none;
          mix-blend-mode: screen;
          background: conic-gradient(from 200deg,
            rgba(255,170,210,0), rgba(160,210,255,.5),
            rgba(190,255,210,.4), rgba(255,225,150,.45), rgba(255,170,210,0));
          -webkit-mask: radial-gradient(circle, transparent 62%, #000 70%, #000 88%, transparent 95%);
          mask: radial-gradient(circle, transparent 62%, #000 70%, #000 88%, transparent 95%);
        }
        .bh-label {
          font-size: 11.5px; font-weight: 700; letter-spacing: .02em;
          white-space: nowrap; transition: color .4s;
          text-shadow: 0 1px 5px rgba(0,0,0,.25);
        }

        /* ── Pinned ToDo ticker ── */
        .bh-ticker {
          flex-shrink: 0;
          display: flex; align-items: center;
          height: 34px; overflow: hidden;
          background: rgba(0,0,0,.52);
          backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
          border-top: 1px solid rgba(255,255,255,.12);
          border-bottom: 1px solid rgba(255,255,255,.12);
          margin: 0 -14px;
          position: relative; z-index: 3;
        }
        .bh-ticker-badge {
          flex-shrink: 0;
          font-size: 0.64rem; font-weight: 800;
          color: #fbbf24; letter-spacing: .05em;
          padding: 0 10px; white-space: nowrap;
          border-right: 1px solid rgba(255,255,255,.15);
          height: 100%; display: flex; align-items: center;
          gap: 4px;
        }
        .bh-ticker-track-wrap {
          flex: 1; overflow: hidden; height: 100%;
        }
        .bh-ticker-track {
          display: flex; align-items: center; gap: 40px;
          height: 100%; width: max-content;
          animation: bh-ticker-scroll 18s linear infinite;
        }
        .bh-ticker-item {
          font-size: 0.75rem; font-weight: 600;
          color: rgba(255,255,255,.9); white-space: nowrap;
        }
        @keyframes bh-ticker-scroll {
          from { transform: translateX(0); }
          to   { transform: translateX(-50%); }
        }

        /* ── Album strip ── */
        .bh-album {
          flex-shrink: 0;
          height: 114px;
          overflow: hidden;
          margin: 0 -14px;
          margin-top: auto;  /* pin to the bottom so bubbles get the space above */
          position: relative; z-index: 2;
        }
        .bh-album-track {
          display: flex; align-items: center; gap: 10px;
          padding: 8px 14px;
          width: max-content; height: 100%;
          animation: bh-marquee 32s linear infinite;
        }
        .bh-album-img {
          width: 74px; height: 98px;
          object-fit: cover;
          border-radius: 16px;
          flex-shrink: 0;
          border: 1.5px solid rgba(255,255,255,.28);
          box-shadow: 0 4px 14px rgba(0,0,0,.22);
        }
        @keyframes bh-marquee {
          from { transform: translateX(0); }
          to   { transform: translateX(-50%); }
        }
        .bh-album-btn {
          position: relative; flex-shrink: 0;
          background: none; border: none; padding: 0; cursor: pointer;
        }
        .bh-album-del {
          position: absolute; top: 4px; right: 4px;
          width: 20px; height: 20px; border-radius: 50%;
          background: rgba(220, 38, 38, 0.9);
          display: flex; align-items: center; justify-content: center;
          cursor: pointer; z-index: 10;
          box-shadow: 0 2px 6px rgba(0,0,0,.35);
        }
        .bh-album-add-btn {
          position: absolute; top: 6px; right: 6px; z-index: 10;
          width: 30px; height: 30px; border-radius: 50%;
          background: rgba(0,0,0,.42);
          backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
          border: 1px solid rgba(255,255,255,.3);
          display: flex; align-items: center; justify-content: center;
          cursor: pointer;
          box-shadow: 0 2px 8px rgba(0,0,0,.3);
        }
      `}</style>
    </div>
  );
}
