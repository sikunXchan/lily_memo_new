'use client';

import { useLiveQuery } from 'dexie-react-hooks';
import { db, newSyncId } from '@/lib/db';
import { useTheme } from './ThemeContext';
import {
  Plus, Search, Palette, Sun, Moon, ChevronRight, FolderPlus,
  Brush, Sparkles, FileText, Pencil,
} from 'lucide-react';
import type { Note, Folder } from '@/lib/db';

interface HomeHeroProps {
  onSelectNote: (id: number) => void;
  onOpenConnection: () => void;
  onSelectFolder: (id: number) => void;
  onOpenSketch?: () => void;
  onOpenAllNotes?: () => void;  // search/see-all (mobile only, omit on desktop)
  isDesktop?: boolean;
}

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

function folderColorVar(f: Folder, idx: number) {
  const fallbacks = ['--folder-pink', '--folder-blue', '--folder-green', '--folder-yellow', '--folder-purple'];
  return `var(${f.color || fallbacks[idx % fallbacks.length]})`;
}

export default function HomeHero({
  onSelectNote, onOpenConnection, onSelectFolder, onOpenSketch, onOpenAllNotes, isDesktop,
}: HomeHeroProps) {
  const { theme, cycleTheme, nextThemeName } = useTheme();

  const folders = useLiveQuery<Folder[]>(() => db.folders.filter(f => !f.deletedAt).toArray());
  const recentNotes = useLiveQuery<Note[]>(() =>
    db.notes.filter(n => !n.deletedAt).sortBy('updatedAt').then(list => list.reverse().slice(0, 5))
  );

  const now = new Date();
  const dateLabel = `${WEEKDAYS[now.getDay()]} · ${now.getMonth() + 1}月${now.getDate()}日`;

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

  return (
    <div className={`home-hero ${isDesktop ? 'desktop' : 'mobile'}`}>
      {/* ── Hero banner ─────────────────────────── */}
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

          {/* Primary action pill */}
          <div className="hero-action-row">
            <button className="hero-action" onClick={createNote}>
              <Plus size={16} strokeWidth={2.4} style={{ color: 'var(--primary)', flexShrink: 0 }} />
              <span className="hero-action-label">今日のメモを書く...</span>
            </button>
            {onOpenAllNotes && (
              <button className="hero-search-btn" onClick={onOpenAllNotes} aria-label="メモを検索">
                <Search size={16} style={{ color: 'var(--fg-muted)' }} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Tiles ──────────────────────────────── */}
      <div className="hero-tiles">

        {/* Recent */}
        <div className="tile">
          <div className="tile-header">
            <span className="tile-label">RECENT</span>
            {onOpenAllNotes && (
              <button className="tile-see-all" onClick={onOpenAllNotes}>
                <ChevronRight size={13} />
              </button>
            )}
          </div>
          {(recentNotes ?? []).length === 0 ? (
            <p className="tile-empty">まだメモがありません</p>
          ) : (
            <ul className="note-list">
              {(recentNotes ?? []).map((note) => (
                <li
                  key={note.id}
                  className="note-row"
                  onClick={() => onSelectNote(note.id!)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && onSelectNote(note.id!)}
                >
                  {note.type === 'handwriting'
                    ? <Pencil size={13} className="note-icon" />
                    : <FileText size={13} className="note-icon" />}
                  <span className="note-title">{note.title}</span>
                  <ChevronRight size={11} className="note-chevron" />
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Folders */}
        <div className="tile">
          <div className="tile-header">
            <span className="tile-label">FOLDERS · {folders?.length ?? 0}</span>
            <FolderPlus size={13} className="tile-icon-muted" />
          </div>
          {(folders ?? []).length === 0 ? (
            <p className="tile-empty">フォルダなし</p>
          ) : (
            <ul className="folder-chip-list">
              {(folders ?? []).map((f, i) => (
                <li key={f.id}>
                  <button
                    className="folder-chip"
                    onClick={() => onSelectFolder(f.id!)}
                  >
                    <span className="folder-dot" style={{ background: folderColorVar(f, i) }} />
                    <span className="folder-chip-name">{f.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Sketch */}
        <div
          className="tile tile-action"
          onClick={() => onOpenSketch?.()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && onOpenSketch?.()}
        >
          <div className="tile-header">
            <span className="tile-label">SKETCH</span>
            <ChevronRight size={13} className="tile-icon-faint" />
          </div>
          <div className="tile-cta">
            <Brush size={22} className="tile-cta-icon" />
            <span>落書きを開く</span>
          </div>
        </div>

        {/* Connection */}
        <div
          className="tile tile-action"
          onClick={onOpenConnection}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && onOpenConnection()}
        >
          <div className="tile-header">
            <span className="tile-label">CONNECTION</span>
            <ChevronRight size={13} className="tile-icon-faint" />
          </div>
          <div className="tile-cta">
            <Sparkles size={22} className="tile-cta-icon" />
            <span>つながりを見る</span>
          </div>
        </div>

      </div>

      <style jsx>{`
        /* ── Layout ─────────────────────────────── */
        .home-hero {
          width: 100%;
          height: 100%;
          display: flex;
          flex-direction: column;
          overflow-y: auto;
          overflow-x: hidden;
          background: transparent;
          font-family: var(--font-body);
          color: var(--foreground);
          position: relative;
          z-index: 1;
        }
        .home-hero.mobile {
          padding-bottom: calc(60px + env(safe-area-inset-bottom) + 16px);
        }
        .home-hero.desktop {
          padding-bottom: 20px;
        }

        /* ── Hero banner ──────────────────────── */
        .hero-banner {
          position: relative;
          margin: 12px;
          border-radius: var(--radius);
          overflow: hidden;
          height: 220px;
          flex-shrink: 0;
          box-shadow: var(--shadow);
        }
        /* Landscape / desktop: shorter banner */
        .home-hero.desktop .hero-banner,
        @media (orientation: landscape) {
          height: 160px;
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
          height: 32px;
          padding: 0 10px;
          border-radius: 999px;
          background: rgba(255,255,255,0.18);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          display: flex;
          align-items: center;
          gap: 5px;
          flex-shrink: 0;
        }

        /* Hero action row (pill + search) */
        .hero-action-row {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .hero-action {
          flex: 1;
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 14px;
          background: rgba(255,255,255,0.92);
          border-radius: 999px;
          color: var(--foreground);
          text-align: left;
          min-width: 0;
        }
        .hero-action-label {
          flex: 1;
          font-family: var(--font-body);
          font-weight: 700;
          font-size: 13px;
          color: #2c2620;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .hero-search-btn {
          width: 40px;
          height: 40px;
          border-radius: 999px;
          background: rgba(255,255,255,0.92);
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }

        /* ── Tiles grid ───────────────────────── */
        .hero-tiles {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
          padding: 0 12px;
          align-content: start;
          flex: 1;
        }

        /* Each tile */
        .tile {
          background: var(--surface, var(--secondary));
          border: 1px solid var(--border);
          border-radius: var(--radius);
          padding: 14px;
          box-shadow: var(--shadow-sm);
          display: flex;
          flex-direction: column;
          min-height: 96px;
          overflow: hidden;
        }
        .tile-action {
          cursor: pointer;
          transition: background 0.18s;
        }
        .tile-action:hover {
          background: var(--surface-deep, var(--muted));
        }

        .tile-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 10px;
        }
        .tile-label {
          font-family: var(--font-latin);
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.14em;
          color: var(--fg-faint);
          text-transform: uppercase;
        }
        .tile-see-all {
          background: transparent;
          color: var(--fg-faint);
          padding: 2px;
          border-radius: 4px;
          display: flex;
          align-items: center;
        }
        .tile-icon-muted {
          color: var(--fg-muted);
        }
        .tile-icon-faint {
          color: var(--fg-faint);
        }
        .tile-empty {
          font-size: 12px;
          color: var(--fg-muted);
          flex: 1;
          display: flex;
          align-items: center;
        }

        /* Recent note rows */
        .note-list {
          list-style: none;
          display: flex;
          flex-direction: column;
          gap: 4px;
          flex: 1;
        }
        .note-row {
          display: flex;
          align-items: center;
          gap: 7px;
          padding: 6px 8px;
          border-radius: var(--radius-sm, 8px);
          cursor: pointer;
          transition: background 0.15s;
        }
        .note-row:hover {
          background: var(--surface-alt, var(--accent));
        }
        :global(.note-icon) {
          color: var(--fg-muted);
          flex-shrink: 0;
        }
        .note-title {
          flex: 1;
          font-size: 12.5px;
          font-weight: 600;
          color: var(--foreground);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        :global(.note-chevron) {
          color: var(--fg-faint);
          flex-shrink: 0;
        }

        /* Folder chips */
        .folder-chip-list {
          list-style: none;
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          align-content: flex-start;
          flex: 1;
        }
        .folder-chip {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          font-size: 11px;
          font-weight: 600;
          color: var(--foreground);
          background: var(--surface-alt, var(--accent));
          padding: 4px 9px;
          border-radius: 999px;
          max-width: 100%;
          cursor: pointer;
          transition: background 0.15s;
          border: none;
          font-family: inherit;
        }
        .folder-chip:hover {
          background: var(--surface-deep, var(--muted));
        }
        .folder-dot {
          width: 8px;
          height: 8px;
          border-radius: 999px;
          flex-shrink: 0;
        }
        .folder-chip-name {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 90px;
        }

        /* Sketch / Connection action tiles */
        .tile-cta {
          display: flex;
          align-items: center;
          gap: 10px;
          flex: 1;
        }
        :global(.tile-cta-icon) {
          color: var(--primary);
          flex-shrink: 0;
        }
        .tile-cta span {
          font-size: 12.5px;
          font-weight: 600;
          color: var(--foreground);
        }

        /* ── Responsive ───────────────────────── */
        /* Desktop / iPad landscape: shorter banner, more tiles cols */
        .home-hero.desktop .hero-banner {
          height: 160px;
        }
        @media (min-width: 600px) {
          .hero-tiles {
            grid-template-columns: repeat(4, 1fr);
          }
        }
        /* Mobile landscape: compress hero */
        @media (orientation: landscape) and (max-height: 500px) {
          .hero-banner {
            height: 130px;
          }
          .hero-title {
            font-size: 20px;
          }
          .hero-tiles {
            grid-template-columns: repeat(4, 1fr);
          }
        }
      `}</style>
    </div>
  );
}
