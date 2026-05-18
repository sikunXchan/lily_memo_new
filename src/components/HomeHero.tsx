'use client';

import { useLiveQuery } from 'dexie-react-hooks';
import { db, newSyncId } from '@/lib/db';
import { useTheme } from './ThemeContext';
import {
  Plus, Search, Sun, Moon, Palette, ChevronRight, FolderPlus,
  Brush, Sparkles, FileText, Pencil,
} from 'lucide-react';

interface HomeHeroProps {
  onSelectNote: (id: number) => void;
  onOpenList: () => void;
  onOpenSketch?: () => void;
}

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

const FOLDER_VARS = ['--folder-pink', '--folder-blue', '--folder-green', '--folder-yellow', '--folder-purple'];

export default function HomeHero({ onSelectNote, onOpenList, onOpenSketch }: HomeHeroProps) {
  const { theme, cycleTheme, nextThemeName } = useTheme();

  const folders = useLiveQuery(() => db.folders.filter(f => !f.deletedAt).toArray());
  const notes = useLiveQuery(() =>
    db.notes.filter(n => !n.deletedAt).sortBy('updatedAt')
      .then(list => list.reverse())
  );

  const now = new Date();
  const dateLabel = `${WEEKDAYS[now.getDay()]} · ${now.getMonth() + 1}月${now.getDate()}日`;

  const recent = (notes ?? []).slice(0, 3);

  const createNote = async () => {
    const t = Date.now();
    const id = await db.notes.add({
      syncId: newSyncId(),
      title: '無題のメモ',
      content: '',
      type: 'text',
      createdAt: t,
      updatedAt: t,
    });
    onSelectNote(id as number);
  };

  const tileStyle: React.CSSProperties = {
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    padding: 14,
    boxShadow: 'var(--shadow-sm)',
    display: 'flex',
    flexDirection: 'column',
    cursor: 'pointer',
    minHeight: 96,
  };

  const labelStyle: React.CSSProperties = {
    fontFamily: 'var(--font-latin)',
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.14em',
    color: 'var(--fg-faint)',
    textTransform: 'uppercase',
  };

  return (
    <div className="home-hero">
      {/* Hero banner */}
      <div className="hero-banner">
        <img src="/logo.png" alt="" className="hero-img" />
        <div className="hero-grad" />
        <div className="hero-inner">
          <div className="hero-top">
            <div>
              <div className="hero-date">{dateLabel}</div>
              <div className="hero-title">Lily Memo</div>
            </div>
            <button
              className="hero-theme-btn"
              onClick={cycleTheme}
              title={`テーマ切替（次: ${nextThemeName}）`}
              aria-label="テーマを切り替える"
            >
              <Palette size={14} color="#fff" />
              {theme.dark ? <Moon size={12} color="#fff" /> : <Sun size={12} color="#fff" />}
            </button>
          </div>
          <button className="hero-action" onClick={createNote}>
            <Plus size={16} strokeWidth={2.4} color={theme.primary} />
            <span>今日のメモを書く...</span>
            <span
              onClick={(e) => { e.stopPropagation(); onOpenList(); }}
              className="hero-search-icon"
              role="button"
              aria-label="メモを検索"
            >
              <Search size={14} color={theme.fgMuted} />
            </span>
          </button>
        </div>
      </div>

      {/* Tiles */}
      <div className="hero-tiles">
        <div style={tileStyle} onClick={onOpenList}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={labelStyle}>RECENT</span>
            <ChevronRight size={13} color={theme.fgFaint} />
          </div>
          {recent.length === 0 ? (
            <div style={{ fontSize: 12, color: theme.fgMuted }}>まだメモがありません</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
              {recent.map((r) => (
                <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                  {r.type === 'handwriting'
                    ? <Pencil size={13} color={theme.fgMuted} style={{ flexShrink: 0 }} />
                    : <FileText size={13} color={theme.fgMuted} style={{ flexShrink: 0 }} />}
                  <span style={{
                    fontSize: 12.5, fontWeight: 600, color: theme.fg,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>{r.title}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={tileStyle} onClick={onOpenList}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
            <span style={labelStyle}>FOLDERS · {folders?.length ?? 0}</span>
            <FolderPlus size={13} color={theme.fgMuted} />
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignContent: 'flex-start', flex: 1 }}>
            {(folders ?? []).slice(0, 6).map((f, i) => (
              <span key={f.id} style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                fontSize: 11, fontWeight: 600, color: theme.fg,
                background: 'var(--surface-alt)', padding: '4px 9px',
                borderRadius: 999, maxWidth: '100%',
              }}>
                <span style={{
                  width: 8, height: 8, borderRadius: 999,
                  background: `var(${f.color || FOLDER_VARS[i % FOLDER_VARS.length]})`,
                  flexShrink: 0,
                }} />
                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {f.name}
                </span>
              </span>
            ))}
            {(folders?.length ?? 0) === 0 && (
              <span style={{ fontSize: 12, color: theme.fgMuted }}>フォルダなし</span>
            )}
          </div>
        </div>

        <div style={tileStyle} onClick={() => onOpenSketch?.()}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={labelStyle}>SKETCH</span>
            <ChevronRight size={13} color={theme.fgFaint} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
            <Brush size={20} color={theme.primary} />
            <span style={{ fontSize: 12.5, fontWeight: 600, color: theme.fg }}>落書きを開く</span>
          </div>
        </div>

        <div style={tileStyle} onClick={onOpenList}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={labelStyle}>CONNECTION</span>
            <ChevronRight size={13} color={theme.fgFaint} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
            <Sparkles size={20} color={theme.primary} />
            <span style={{ fontSize: 12.5, fontWeight: 600, color: theme.fg }}>つながりを見る</span>
          </div>
        </div>
      </div>

      <style jsx>{`
        .home-hero {
          width: 100%;
          height: 100%;
          display: flex;
          flex-direction: column;
          overflow-y: auto;
          background: transparent;
          font-family: var(--font-body);
          color: var(--foreground);
          padding-bottom: calc(60px + env(safe-area-inset-bottom) + 16px);
        }
        .hero-banner {
          position: relative;
          margin: 12px 12px 12px;
          border-radius: var(--radius);
          overflow: hidden;
          height: 220px;
          flex-shrink: 0;
          box-shadow: var(--shadow);
        }
        .hero-img {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          object-fit: cover;
          object-position: center 35%;
        }
        .hero-grad {
          position: absolute;
          inset: 0;
          background: linear-gradient(180deg, rgba(0,0,0,0) 30%, rgba(0,0,0,0.55) 100%);
        }
        .hero-inner {
          position: absolute;
          inset: 0;
          padding: 18px;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          color: #fff;
        }
        .hero-top {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
        }
        .hero-date {
          font-family: var(--font-latin);
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.22em;
          opacity: 0.85;
        }
        .hero-title {
          font-family: var(--font-display);
          font-size: 26px;
          font-weight: 700;
          letter-spacing: -0.02em;
          margin-top: 4px;
        }
        .hero-theme-btn {
          width: auto;
          min-width: 32px;
          height: 32px;
          padding: 0 9px;
          border-radius: 999px;
          background: rgba(255,255,255,0.18);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          display: flex;
          align-items: center;
          gap: 4px;
        }
        .hero-action {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 14px;
          background: rgba(255,255,255,0.92);
          border-radius: 999px;
          color: var(--foreground);
          width: 100%;
        }
        .hero-action span {
          flex: 1;
          text-align: left;
          font-family: var(--font-body);
          font-weight: 700;
          font-size: 13px;
          color: #2c2620;
        }
        .hero-search-icon {
          flex: 0 0 auto;
          display: flex;
          align-items: center;
          padding: 2px;
        }
        .hero-tiles {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
          padding: 0 12px;
          align-content: start;
        }
      `}</style>
    </div>
  );
}
