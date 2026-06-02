'use client';

import { useState } from 'react';
import {
  Book, Brush, FileText, Sparkles, GraduationCap, Settings,
  Crosshair, Plus,
} from 'lucide-react';
import { db, newSyncId } from '@/lib/db';
import { useTheme } from './ThemeContext';

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

type TimeOfDay = 'dawn' | 'day' | 'dusk' | 'night';
type Scene = 'city' | 'sea' | 'forest';
const SCENES: Scene[] = ['city', 'sea', 'forest'];

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

const SILHOUETTE: Record<TimeOfDay, string> = {
  dawn: '#180c20', day: '#0f2027', dusk: '#08030f', night: '#020408',
};

// Deterministic stars (golden-angle distribution)
const STARS = Array.from({ length: 55 }, (_, i) => ({
  cx: +((i * 137.508) % 100).toFixed(2),
  cy: +((i * 89.3)   % 65).toFixed(2),
  r:  i % 5 === 0 ? 1.9 : i % 3 === 0 ? 1.2 : 0.7,
  delay: +((i * 0.23) % 2.8).toFixed(2),
}));

// City skyline path (390×100 viewBox)
const CITY_PATH =
  'M0,100 L0,65 L25,65 L25,50 L42,50 L42,38 L55,38 ' +
  'L55,28 L68,28 L68,18 L78,18 L78,12 L90,12 L90,22 ' +
  'L105,22 L105,35 L120,35 L120,55 L132,55 L132,38 L148,38 ' +
  'L148,22 L162,22 L162,8 L175,8 L175,18 L188,18 L188,28 ' +
  'L200,28 L200,42 L215,42 L215,28 L228,28 L228,15 L242,15 ' +
  'L242,22 L255,22 L255,35 L270,35 L270,48 L285,48 L285,32 ' +
  'L300,32 L300,22 L312,22 L312,35 L328,35 L328,52 L342,52 ' +
  'L342,42 L358,42 L358,58 L372,58 L372,68 L390,68 L390,100 Z';

// Night window lights (x, y) — positioned within building silhouettes
const WINDOWS = [
  [70,24],[76,24],[82,24],[88,14],[70,32],[82,32],[88,22],
  [163,12],[169,18],[176,12],[163,24],[176,22],[170,36],
  [229,18],[235,18],[241,18],[229,28],[241,28],[235,36],
  [286,36],[298,26],[303,34],[312,26],[316,34],
];

// Forest hill + trees
const HILL_PATH = 'M0,100 C65,72 130,86 195,76 C260,66 325,80 390,70 L390,100 Z';
const TREES: [number,number,number,number][] = [
  [18,90,32,22],[48,84,38,28],[80,81,30,22],[112,79,36,26],
  [148,81,42,32],[178,82,26,20],[210,76,36,28],[242,74,32,24],
  [272,76,40,30],[302,77,28,22],[334,75,35,26],[366,72,32,24],
];

interface BubbleItem {
  key: string; label: string; tint: string; size: number;
  pos: React.CSSProperties; floatDelay: number;
  windAnim: number; windDur: number; isNew?: boolean;
}

const BUBBLES: BubbleItem[] = [
  { key: 'memos',    label: 'メモ',   tint: '#ffb6c1', size: 124, pos: { left: '4%',   top: 0   }, floatDelay: 0,   windAnim: 0, windDur: 6.2 },
  { key: 'ai',       label: 'AI',     tint: '#c7d2fe', size: 102, pos: { right: '2%',  top: 14  }, floatDelay: 1.1, windAnim: 1, windDur: 5.8 },
  { key: 'sketch',   label: '落書き', tint: '#93c5fd', size: 90,  pos: { left: '26%',  top: 108 }, floatDelay: 2.0, windAnim: 2, windDur: 7.0 },
  { key: 'study',    label: '学習',   tint: '#86efac', size: 92,  pos: { right: '1%',  top: 148 }, floatDelay: 0.6, windAnim: 0, windDur: 6.5 },
  { key: 'pdf',      label: 'PDF',    tint: '#c4b5fd', size: 82,  pos: { left: '1%',   top: 224 }, floatDelay: 1.6, windAnim: 1, windDur: 5.5 },
  { key: 'focus',    label: '集中',   tint: '#a5b4fc', size: 74,  pos: { left: '34%',  top: 268 }, floatDelay: 2.4, windAnim: 2, windDur: 6.8 },
  { key: 'settings', label: '設定',   tint: '#e2e8f0', size: 66,  pos: { right: '14%', top: 312 }, floatDelay: 0.3, windAnim: 0, windDur: 7.2 },
  { key: 'new',      label: '新規',   tint: '#fecdd3', size: 62,  pos: { left: '8%',   top: 352 }, floatDelay: 1.8, windAnim: 1, windDur: 5.9, isNew: true },
];

function BubbleIcon({ navKey, size }: { navKey: string; size: number }) {
  const s = Math.round(size * 0.3);
  const p = { size: s, color: '#fff', strokeWidth: 2.1 };
  switch (navKey) {
    case 'memos':    return <Book {...p} />;
    case 'ai':       return <Sparkles {...p} />;
    case 'sketch':   return <Brush {...p} />;
    case 'study':    return <GraduationCap {...p} />;
    case 'pdf':      return <FileText {...p} />;
    case 'focus':    return <Crosshair {...p} />;
    case 'settings': return <Settings {...p} />;
    case 'new':      return <Plus size={Math.round(size * 0.34)} color="#ff8da1" strokeWidth={2.6} />;
    default:         return null;
  }
}

interface BubbleHomeProps {
  onSelectNote: (id: number) => void;
  onNavigate: (tab: string) => void;
  onOpenFocus: () => void;
}

export default function BubbleHome({ onSelectNote, onNavigate, onOpenFocus }: BubbleHomeProps) {
  const { cycleTheme, nextThemeName } = useTheme();
  const [scene] = useState<Scene>(() => SCENES[Math.floor(Math.random() * SCENES.length)]);

  const now   = new Date();
  const tod   = getTimeOfDay(now.getHours());
  const isLight = tod === 'day' || tod === 'dawn';
  const isNight = tod === 'night';
  const silFill = SILHOUETTE[tod];
  const labelColor = isLight ? '#3a2d32' : 'rgba(255,255,255,.9)';
  const dateColor  = isLight ? '#c79aa8' : 'rgba(255,255,255,.55)';
  const dateLabel  = `${WEEKDAYS[now.getDay()]} · ${now.getMonth() + 1}月${now.getDate()}日`;

  const waterFill: Record<TimeOfDay, string> = {
    day: '#0c5a8a', dawn: '#2a5a9a', dusk: '#3a0c30', night: '#060e22',
  };

  const createNote = async () => {
    const t = Date.now();
    const id = await db.notes.add({
      syncId: newSyncId(), title: '無題のメモ', content: '',
      folderId: undefined, type: 'text', createdAt: t, updatedAt: t,
    });
    onSelectNote(id as number);
  };

  const handleBubbleTap = (key: string) => {
    if (key === 'new') { void createNote(); return; }
    if (key === 'focus') { onOpenFocus(); return; }
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
          title={`テーマ切替（次: ${nextThemeName}）`}
          style={{
            background: isLight ? 'rgba(255,255,255,.75)' : 'rgba(255,255,255,.1)',
            borderColor: isLight ? '#ffe0e8' : 'rgba(255,255,255,.2)',
          }}>
          <Sparkles size={14} color={isLight ? '#ff8da1' : '#e2e8f0'} />
        </button>
      </div>

      {/* Bubble cluster */}
      <div className="bh-cluster">
        {BUBBLES.map(b => (
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
                {b.label}
              </span>
            </button>
          </div>
        ))}

        {/* Ground scenery */}
        <div className="bh-scenery" aria-hidden="true">
          {scene === 'city' && (
            <svg viewBox="0 0 390 100" preserveAspectRatio="none" style={{ width: '100%', height: '100%', display: 'block' }}>
              <path d={CITY_PATH} fill={silFill} />
              {isNight && WINDOWS.map(([x, y], i) => (
                <rect key={i} x={x} y={y} width={3} height={4} fill="#fef3c7" opacity={0.75} />
              ))}
            </svg>
          )}

          {scene === 'forest' && (
            <svg viewBox="0 0 390 100" preserveAspectRatio="none" style={{ width: '100%', height: '100%', display: 'block' }}>
              <path d={HILL_PATH} fill={silFill} />
              {TREES.map(([cx, base, h, w], i) => (
                <g key={i}>
                  <polygon
                    points={`${cx - w * .55},${base} ${cx + w * .55},${base} ${cx},${base - h * .58}`}
                    fill={silFill} />
                  <polygon
                    points={`${cx - w * .38},${base - h * .38} ${cx + w * .38},${base - h * .38} ${cx},${base - h}`}
                    fill={silFill} />
                  <rect x={cx - 2} y={base} width={4} height={6} fill={silFill} />
                </g>
              ))}
            </svg>
          )}

          {scene === 'sea' && (
            <svg viewBox="0 0 390 100" preserveAspectRatio="none" style={{ width: '100%', height: '100%', display: 'block' }}>
              {/* Water body */}
              <path
                d="M0,100 L0,58 C80,50 160,65 195,55 C230,45 310,60 390,50 L390,100 Z"
                fill={waterFill[tod]}
              />
              {/* Water surface highlight */}
              <path
                d="M0,58 C80,50 160,65 195,55 C230,45 310,60 390,50"
                fill="none" stroke="rgba(255,255,255,.22)" strokeWidth="1.5"
              />
              {/* Left cliff */}
              <path d="M0,100 L0,54 C14,44 28,42 40,53 C52,64 56,80 66,100 Z" fill={silFill} />
              {/* Right cliff */}
              <path d="M390,100 L390,47 C376,38 362,42 352,54 C342,66 338,82 324,100 Z" fill={silFill} />
            </svg>
          )}
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
          margin: 2px 0; overflow: hidden; z-index: 1;
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

        /* ── Scenery ── */
        .bh-scenery {
          position: absolute; bottom: 0; left: -14px; right: -14px;
          height: 100px; pointer-events: none; z-index: 0;
        }
      `}</style>
    </div>
  );
}
