'use client';

import {
  Book, Brush, FileText, Sparkles, GraduationCap, Settings,
  Crosshair, Plus,
} from 'lucide-react';
import { db, newSyncId } from '@/lib/db';
import { useTheme } from './ThemeContext';

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

interface BubbleItem {
  key: string;
  label: string;
  tint: string;
  size: number;
  pos: React.CSSProperties;
  floatDelay: number;
  isNew?: boolean;
}

const BUBBLES: BubbleItem[] = [
  { key: 'memos',    label: 'メモ',   tint: '#ffb6c1', size: 124, pos: { left: '4%',   top: 0   }, floatDelay: 0   },
  { key: 'ai',       label: 'AI',     tint: '#ffb6c1', size: 102, pos: { right: '2%',  top: 14  }, floatDelay: 1.1 },
  { key: 'sketch',   label: '落書き', tint: '#93c5fd', size: 90,  pos: { left: '26%',  top: 108 }, floatDelay: 2.0 },
  { key: 'study',    label: '学習',   tint: '#86efac', size: 92,  pos: { right: '1%',  top: 148 }, floatDelay: 0.6 },
  { key: 'pdf',      label: 'PDF',    tint: '#c4b5fd', size: 82,  pos: { left: '1%',   top: 224 }, floatDelay: 1.6 },
  { key: 'focus',    label: '集中',   tint: '#a5b4fc', size: 74,  pos: { left: '34%',  top: 268 }, floatDelay: 2.4 },
  { key: 'settings', label: '設定',   tint: '#e7e1e4', size: 66,  pos: { right: '14%', top: 312 }, floatDelay: 0.3 },
  { key: 'new',      label: '新規',   tint: '#fff0f5', size: 62,  pos: { left: '8%',   top: 352 }, floatDelay: 1.8, isNew: true },
];

function BubbleIcon({ navKey, size }: { navKey: string; size: number }) {
  const iconSize = Math.round(size * 0.3);
  const props = { size: iconSize, color: '#fff', strokeWidth: 2.1 };
  switch (navKey) {
    case 'memos':    return <Book {...props} />;
    case 'ai':       return <Sparkles {...props} />;
    case 'sketch':   return <Brush {...props} />;
    case 'study':    return <GraduationCap {...props} />;
    case 'pdf':      return <FileText {...props} />;
    case 'focus':    return <Crosshair {...props} />;
    case 'settings': return <Settings {...props} />;
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

  const now = new Date();
  const dateLabel = `${WEEKDAYS[now.getDay()]} · ${now.getMonth() + 1}月${now.getDate()}日`;

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
    <div className="bh-root">
      <div className="bh-aura" />

      {/* Header */}
      <div className="bh-header">
        <div>
          <div className="bh-date">{dateLabel}</div>
          <div className="bh-title">Lily Memo</div>
        </div>
        <button className="bh-theme-btn" onClick={cycleTheme} title={`テーマ切替（次: ${nextThemeName}）`}>
          <Sparkles size={14} color="#ff8da1" />
        </button>
      </div>

      {/* Bubble cluster */}
      <div className="bh-cluster">
        {BUBBLES.map(b => (
          <div key={b.key} className="bh-bubble-wrap" style={{ ...b.pos, position: 'absolute' }}>
            <button
              className={`bh-bubble ${b.isNew ? 'bh-bubble-new' : ''}`}
              style={{
                width: b.size,
                '--tint': b.tint,
                animationDelay: `${b.floatDelay}s`,
              } as React.CSSProperties}
              onClick={() => handleBubbleTap(b.key)}
            >
              <span className="bh-skin" style={{ '--tint': b.tint } as React.CSSProperties}>
                <BubbleIcon navKey={b.key} size={b.size} />
                <span className="bh-spec" />
                <span className="bh-rim" />
              </span>
              <span className="bh-label">{b.label}</span>
            </button>
          </div>
        ))}

        {/* Tide waves */}
        <div className="bh-waves" aria-hidden="true">
          <div className="bh-wave bh-wave-l1">
            <svg viewBox="0 0 800 120" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M0,95 C100,68 300,115 400,95 C500,68 700,115 800,95 L800,120 L0,120 Z" fill="rgba(165,243,252,.52)"/>
            </svg>
          </div>
          <div className="bh-wave bh-wave-l2">
            <svg viewBox="0 0 800 120" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M0,82 C100,50 300,108 400,82 C500,50 700,108 800,82 L800,120 L0,120 Z" fill="rgba(147,197,253,.56)"/>
            </svg>
          </div>
          <div className="bh-wave bh-wave-l3">
            <svg viewBox="0 0 800 120" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M0,70 C100,38 300,96 400,70 C500,38 700,96 800,70 L800,120 L0,120 Z" fill="rgba(196,181,253,.60)"/>
            </svg>
          </div>
          <div className="bh-wave bh-wave-l4">
            <svg viewBox="0 0 800 120" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M0,56 C100,22 300,82 400,56 C500,22 700,82 800,56 L800,120 L0,120 Z" fill="rgba(255,182,193,.65)"/>
            </svg>
          </div>
        </div>
      </div>

      <style jsx>{`
        .bh-root {
          flex: 1;
          display: flex;
          flex-direction: column;
          background: linear-gradient(180deg, #fff6f8 0%, #fdeef4 40%, #eef4fd 100%);
          overflow: hidden;
          position: relative;
          padding: 0 14px;
          padding-bottom: env(safe-area-inset-bottom);
        }
        .bh-aura {
          position: absolute;
          inset: 0;
          pointer-events: none;
          background:
            radial-gradient(40% 22% at 80% 6%, rgba(147,197,253,.28), transparent 70%),
            radial-gradient(38% 20% at 12% 14%, rgba(255,182,193,.32), transparent 70%);
        }
        .bh-header {
          flex-shrink: 0;
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          padding: 10px 4px 6px;
          position: relative;
          z-index: 2;
        }
        .bh-date {
          font-family: 'Outfit', sans-serif;
          font-size: 10px;
          font-weight: 700;
          letter-spacing: .22em;
          color: #c79aa8;
        }
        .bh-title {
          font-family: 'Outfit', sans-serif;
          font-size: 25px;
          font-weight: 800;
          letter-spacing: -.02em;
          margin-top: 2px;
          background: linear-gradient(120deg, #ff8da1, #93c5fd);
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
        }
        .bh-theme-btn {
          width: 32px; height: 32px;
          border-radius: 99px;
          border: 1px solid #ffe0e8;
          background: rgba(255,255,255,.75);
          display: flex; align-items: center; justify-content: center;
          cursor: pointer;
          box-shadow: 0 2px 8px rgba(255,182,193,.25);
          flex-shrink: 0;
          margin-top: 14px;
        }

        /* ── Bubble cluster ── */
        .bh-cluster {
          position: relative;
          flex: 1;
          min-height: 0;
          margin: 2px 0;
          overflow: hidden;
        }
        .bh-bubble {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 6px;
          background: none;
          border: none;
          padding: 0;
          cursor: pointer;
          animation: bh-floaty 5.5s ease-in-out infinite;
        }
        .bh-bubble:active { transform: scale(.93); }
        @keyframes bh-floaty {
          0%, 100% { transform: translateY(0); }
          50%       { transform: translateY(-7px); }
        }
        .bh-skin {
          position: relative;
          width: 100%;
          aspect-ratio: 1;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          background:
            radial-gradient(circle at 32% 26%, rgba(255,255,255,.95), rgba(255,255,255,.32) 22%, transparent 42%),
            radial-gradient(circle at 70% 74%,
              color-mix(in srgb, var(--tint) 70%, #fff),
              color-mix(in srgb, var(--tint) 35%, transparent) 70%);
          box-shadow:
            0 10px 26px color-mix(in srgb, var(--tint) 45%, transparent),
            inset 0 0 18px rgba(255,255,255,.55),
            inset -6px -8px 16px color-mix(in srgb, var(--tint) 40%, transparent);
          border: 1.5px solid rgba(255,255,255,.6);
        }
        .bh-spec {
          position: absolute;
          top: 11%; left: 16%;
          width: 30%; height: 22%;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(255,255,255,.95), transparent 70%);
          z-index: 2;
          pointer-events: none;
        }
        .bh-rim {
          position: absolute;
          inset: 0;
          border-radius: 50%;
          pointer-events: none;
          mix-blend-mode: screen;
          background: conic-gradient(from 200deg,
            rgba(255,170,210,0),
            rgba(160,210,255,.5),
            rgba(190,255,210,.4),
            rgba(255,225,150,.45),
            rgba(255,170,210,0));
          -webkit-mask: radial-gradient(circle, transparent 62%, #000 70%, #000 88%, transparent 95%);
          mask: radial-gradient(circle, transparent 62%, #000 70%, #000 88%, transparent 95%);
        }
        .bh-label {
          font-size: 11.5px;
          font-weight: 700;
          color: #6b5a61;
          letter-spacing: .02em;
          white-space: nowrap;
        }
        .bh-bubble-new .bh-label { color: #e07090; }

        /* ── Tide waves ── */
        .bh-waves {
          position: absolute;
          bottom: 0; left: -14px; right: -14px;
          height: 120px;
          pointer-events: none;
          z-index: 0;
          overflow: hidden;
        }
        .bh-wave {
          position: absolute;
          bottom: 0;
          width: 200%;
          height: 100%;
          will-change: transform;
        }
        .bh-wave svg { display: block; width: 100%; height: 100%; }
        .bh-wave-l1 { animation: bh-tide    15s ease-in-out infinite; }
        .bh-wave-l2 { animation: bh-tide-r  11s ease-in-out infinite; }
        .bh-wave-l3 { animation: bh-tide     8s ease-in-out infinite; }
        .bh-wave-l4 { animation: bh-tide-r   6s ease-in-out infinite; }
        @keyframes bh-tide {
          0%, 100% { transform: translateX(0); }
          50%       { transform: translateX(-50%); }
        }
        @keyframes bh-tide-r {
          0%, 100% { transform: translateX(-50%); }
          50%       { transform: translateX(0); }
        }
      `}</style>
    </div>
  );
}
