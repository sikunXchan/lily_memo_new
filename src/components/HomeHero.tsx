'use client';

import { useLiveQuery } from 'dexie-react-hooks';
import { db, newSyncId, softDeleteNotes, softDeleteFolder } from '@/lib/db';
import { useTheme } from './ThemeContext';
import { useState } from 'react';
import dynamic from 'next/dynamic';
import {
  Plus, Search, Palette, Sun, Moon, ChevronRight, FolderPlus,
  Sparkles, FileText, Pencil, Trash2, List, Maximize2, X,
} from 'lucide-react';
import type { Note, Folder } from '@/lib/db';
import { useT } from '@/lib/i18n';

const DirectoryGraph = dynamic(() => import('./DirectoryGraph'), { ssr: false });

interface HomeHeroProps {
  onSelectNote: (id: number) => void;
  onOpenConnection?: () => void;
  onSelectFolder?: (id: number) => void;
  isDesktop?: boolean;
}

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const FALLBACK_VARS = ['--folder-pink', '--folder-blue', '--folder-green', '--folder-yellow', '--folder-purple'];

const COLORS = [
  { name: 'Pink', value: '--folder-pink' },
  { name: 'Blue', value: '--folder-blue' },
  { name: 'Green', value: '--folder-green' },
  { name: 'Yellow', value: '--folder-yellow' },
  { name: 'Purple', value: '--folder-purple' },
];

function folderColorVar(f: Folder, idx: number) {
  return `var(${f.color || FALLBACK_VARS[idx % FALLBACK_VARS.length]})`;
}

interface DeletingFolderState { id: number; name: string; noteCount: number; }

export default function HomeHero({
  onSelectNote, onOpenConnection, onSelectFolder, isDesktop,
}: HomeHeroProps) {
  const { theme, cycleTheme, nextThemeName } = useTheme();
  const t = useT();

  const [searchQuery, setSearchQuery] = useState('');
  const [expandedFolders, setExpandedFolders] = useState<Record<number, boolean>>({});
  const [editingFolderColor, setEditingFolderColor] = useState<number | null>(null);
  const [deletingFolder, setDeletingFolder] = useState<DeletingFolderState | null>(null);
  const [viewMode, setViewMode] = useState<'tree' | 'graph'>('tree');
  const [graphFullscreen, setGraphFullscreen] = useState(false);

  const folders = useLiveQuery<Folder[]>(() => db.folders.filter(f => !f.deletedAt).toArray());
  const notes = useLiveQuery<Note[]>(() => {
    const base = db.notes.filter(n => !n.deletedAt);
    if (!searchQuery) return base.sortBy('updatedAt').then(l => l.reverse());
    const q = searchQuery.toLowerCase();
    return base.filter(n => n.title.toLowerCase().includes(q)).sortBy('updatedAt').then(l => l.reverse());
  }, [searchQuery]);

  const now = new Date();
  const dateLabel = `${WEEKDAYS[now.getDay()]} · ${t('{m}月{d}日', { m: now.getMonth() + 1, d: now.getDate() })}`;
  const recent = (notes ?? []).slice(0, 5);
  const looseNotes = notes?.filter(n => !n.folderId || (searchQuery && n.folderId)) ?? [];

  const createNote = async (folderId?: number) => {
    const t = Date.now();
    const id = await db.notes.add({
      syncId: newSyncId(), title: '無題のメモ', content: '',
      folderId, type: 'text', createdAt: t, updatedAt: t,
    });
    if (folderId) setExpandedFolders(p => ({ ...p, [folderId]: true }));
    onSelectNote(id as number);
  };

  const addFolder = async () => {
    const name = prompt(t('フォルダ名を入力してください'));
    if (name) {
      const t = Date.now();
      await db.folders.add({ syncId: newSyncId(), name, createdAt: t, updatedAt: t, color: '--folder-pink' });
    }
  };

  const updateFolderColor = async (id: number, color: string) => {
    await db.folders.update(id, { color, updatedAt: Date.now() });
    setEditingFolderColor(null);
  };

  const handleDeleteFolder = (e: React.MouseEvent, folder: { id: number; name: string }) => {
    e.stopPropagation();
    const noteCount = notes?.filter(n => n.folderId === folder.id).length ?? 0;
    setDeletingFolder({ id: folder.id, name: folder.name, noteCount });
    setEditingFolderColor(null);
  };

  const confirmDeleteFolder = async (deleteNotes: boolean) => {
    if (!deletingFolder) return;
    const { id } = deletingFolder;
    const folderNoteIds = notes?.filter(n => n.folderId === id).map(n => n.id!) ?? [];
    if (deleteNotes && folderNoteIds.length > 0) {
      await softDeleteNotes(folderNoteIds);
    } else if (!deleteNotes && folderNoteIds.length > 0) {
      for (const nId of folderNoteIds) {
        await db.notes.update(nId, { folderId: undefined, updatedAt: Date.now() });
      }
    }
    await softDeleteFolder(id);
    setDeletingFolder(null);
  };

  const toggleFolder = (id: number) => setExpandedFolders(p => ({ ...p, [id]: !p[id] }));

  return (
    <div className={`home-hero ${isDesktop ? 'desktop' : 'mobile'}`}>
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
            <button className="hero-theme-btn" onClick={cycleTheme}
              title={t('テーマ切替（次: {name}）', { name: nextThemeName })} aria-label={t('テーマを切り替える')}>
              <Palette size={14} color="#fff" />
              {theme.dark ? <Moon size={12} color="#fff" /> : <Sun size={12} color="#fff" />}
            </button>
          </div>
          <button className="hero-action" onClick={() => createNote()}>
            <Plus size={16} strokeWidth={2.4} style={{ color: 'var(--primary)', flexShrink: 0 }} />
            <span className="hero-action-label">{t('今日のメモを書く...')}</span>
          </button>
        </div>
      </div>

      {isDesktop ? (
        /* ── Desktop dashboard (Sidebar handles management) ── */
        <div className="hero-tiles">
          <div className="tile">
            <div className="tile-header"><span className="tile-label">RECENT</span></div>
            {recent.length === 0
              ? <p className="tile-empty">{t('まだメモがありません')}</p>
              : <ul className="note-list">{recent.map(n => (
                  <li key={n.id} className="note-row" onClick={() => onSelectNote(n.id!)}
                    role="button" tabIndex={0} onKeyDown={e => e.key === 'Enter' && onSelectNote(n.id!)}>
                    {n.type === 'handwriting' ? <Pencil size={13} className="note-icon" /> : <FileText size={13} className="note-icon" />}
                    <span className="note-title">{n.title}</span>
                    <ChevronRight size={11} className="note-chevron" />
                  </li>))}</ul>}
          </div>
          <div className="tile">
            <div className="tile-header">
              <span className="tile-label">FOLDERS · {folders?.length ?? 0}</span>
              <FolderPlus size={13} className="tile-icon-muted" />
            </div>
            {(folders ?? []).length === 0
              ? <p className="tile-empty">{t('フォルダなし')}</p>
              : <ul className="folder-chip-list">{(folders ?? []).map((f, i) => (
                  <li key={f.id}>
                    <button className="folder-chip" onClick={() => onSelectFolder?.(f.id!)}>
                      <span className="folder-dot" style={{ background: folderColorVar(f, i) }} />
                      <span className="folder-chip-name">{f.name}</span>
                    </button>
                  </li>))}</ul>}
          </div>
          <div className="tile tile-action" onClick={() => onOpenConnection?.()}
            role="button" tabIndex={0} onKeyDown={e => e.key === 'Enter' && onOpenConnection?.()}>
            <div className="tile-header"><span className="tile-label">CONNECTION</span><ChevronRight size={13} className="tile-icon-faint" /></div>
            <div className="tile-cta"><Sparkles size={22} className="tile-cta-icon" /><span>{t('つながりを見る')}</span></div>
          </div>
        </div>
      ) : (
        /* ── Mobile: self-contained home with folder management ── */
        <>
          <div className="search-container">
            <Search size={15} className="search-icon" />
            <input type="text" placeholder={t('メモを検索...')} value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)} className="search-input" />
          </div>

          <div className="actions-row">
            <button className="btn-new-folder" onClick={addFolder}>
              <FolderPlus size={15} /><span>{t('新しいフォルダ')}</span>
            </button>
            <div className="view-toggle" role="tablist">
              <button role="tab" aria-selected={viewMode === 'tree'}
                className={`vt-btn ${viewMode === 'tree' ? 'active' : ''}`} onClick={() => setViewMode('tree')}>
                <List size={13} /><span>{t('ツリー')}</span>
              </button>
              <button role="tab" aria-selected={viewMode === 'graph'}
                className={`vt-btn ${viewMode === 'graph' ? 'active' : ''}`} onClick={() => setViewMode('graph')}>
                <Sparkles size={13} /><span>{t('つながり')}</span>
              </button>
            </div>
          </div>

          <div className="content-area">
            {viewMode === 'graph' ? (
              <div className="graph-wrap">
                <button
                  className="graph-fullscreen-btn"
                  onClick={() => setGraphFullscreen(true)}
                  title={t('全画面表示')}
                >
                  <Maximize2 size={14} />
                </button>
                <DirectoryGraph folders={folders ?? []} notes={notes ?? []}
                  onSelectNote={(id) => onSelectNote(id)} />
              </div>
            ) : (
              <div className="folder-list">
                {folders?.map((folder, i) => (
                  <div key={folder.id} className="folder-item-wrapper">
                    <div className="folder-item" onClick={() => folder.id && toggleFolder(folder.id)}>
                      <span className={`chevron ${expandedFolders[folder.id!] ? 'expanded' : ''}`}>
                        <ChevronRight size={14} />
                      </span>
                      <span className="folder-dot lg" style={{ background: folderColorVar(folder, i) }} />
                      <span className="folder-name">{folder.name}</span>
                      <div className="folder-actions">
                        <button className="btn-inline" title={t('色を変更')}
                          onClick={(e) => { e.stopPropagation(); setEditingFolderColor(editingFolderColor === folder.id ? null : folder.id!); }}>
                          <Palette size={13} />
                        </button>
                        <button className="btn-inline" title={t('メモを追加')}
                          onClick={(e) => { e.stopPropagation(); createNote(folder.id); }}>
                          <Plus size={13} />
                        </button>
                        <button className="btn-inline btn-del" title={t('フォルダを削除')}
                          onClick={(e) => handleDeleteFolder(e, { id: folder.id!, name: folder.name })}>
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                    {editingFolderColor === folder.id && (
                      <div className="color-picker" onClick={e => e.stopPropagation()}>
                        {COLORS.map(c => (
                          <button key={c.value} className="color-dot" style={{ background: `var(${c.value})` }}
                            onClick={() => updateFolderColor(folder.id!, c.value)} title={c.name} />
                        ))}
                      </div>
                    )}
                    {expandedFolders[folder.id!] && (
                      <div className="nested-notes">
                        {notes?.filter(n => n.folderId === folder.id).map(note => (
                          <div key={note.id} className="note-item" onClick={() => onSelectNote(note.id!)}>
                            {note.type === 'handwriting' ? <Pencil size={14} /> : <FileText size={14} />}
                            <span>{note.title}</span>
                          </div>
                        ))}
                        {notes?.filter(n => n.folderId === folder.id).length === 0 && (
                          <div className="empty-hint">{t('メモはありません')}</div>
                        )}
                      </div>
                    )}
                  </div>
                ))}

                <div className="loose-notes">
                  <div className="section-label">{searchQuery ? t('検索結果') : t('すべてのメモ')}</div>
                  {looseNotes.map(note => (
                    <div key={note.id} className="note-item" onClick={() => onSelectNote(note.id!)}>
                      {note.type === 'handwriting' ? <Pencil size={14} /> : <FileText size={14} />}
                      <span>{note.title}</span>
                    </div>
                  ))}
                  {looseNotes.length === 0 && (
                    <div className="empty-hint">{searchQuery ? t('見つかりませんでした') : t('メモはありません')}</div>
                  )}
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {graphFullscreen && (
        <div className="graph-fs-overlay">
          <button className="graph-fs-close" onClick={() => setGraphFullscreen(false)} title={t('閉じる')}>
            <X size={20} />
          </button>
          <DirectoryGraph
            folders={folders ?? []} notes={notes ?? []}
            onSelectNote={(id) => { onSelectNote(id); setGraphFullscreen(false); }}
          />
        </div>
      )}

      {!isDesktop && deletingFolder && (
        <div className="delete-overlay" onClick={() => setDeletingFolder(null)}>
          <div className="delete-dialog" onClick={e => e.stopPropagation()}>
            <div className="delete-dialog-icon"><Trash2 size={22} /></div>
            <h3 className="ddt">{t('フォルダを削除')}</h3>
            <p className="ddf">「{deletingFolder.name}」</p>
            {deletingFolder.noteCount > 0
              ? <p className="ddd">{t('{n}件のメモが含まれています。', { n: deletingFolder.noteCount })}<br />{t('メモはどうしますか？')}</p>
              : <p className="ddd">{t('このフォルダを削除します。')}</p>}
            <div className="dda">
              <button className="dda-cancel" onClick={() => setDeletingFolder(null)}>{t('キャンセル')}</button>
              {deletingFolder.noteCount > 0 && (
                <button className="dda-keep" onClick={() => confirmDeleteFolder(false)}>{t('メモを残す')}</button>
              )}
              <button className="dda-delete" onClick={() => confirmDeleteFolder(deletingFolder.noteCount > 0)}>
                {deletingFolder.noteCount > 0 ? t('すべて削除') : t('削除する')}
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        .home-hero {
          width: 100%;
          flex: 1;
          min-height: 0;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          background: transparent;
          font-family: var(--app-font, var(--font-body));
          color: var(--foreground);
          position: relative;
          z-index: 1;
        }
        .home-hero.desktop { overflow-y: auto; padding-bottom: 20px; }

        .hero-banner {
          position: relative;
          margin: 12px;
          border-radius: var(--radius);
          overflow: hidden;
          height: 200px;
          flex-shrink: 0;
          box-shadow: var(--shadow);
        }
        .home-hero.desktop .hero-banner { height: 160px; }
        .hero-img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: center 35%; }
        .hero-grad { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(0,0,0,0) 30%, rgba(0,0,0,0.55) 100%); }
        .hero-inner { position: absolute; inset: 0; padding: 18px; display: flex; flex-direction: column; justify-content: space-between; color: #fff; }
        .hero-top { display: flex; justify-content: space-between; align-items: flex-start; }
        .hero-date { font-family: var(--font-latin); font-size: 10px; font-weight: 700; letter-spacing: 0.22em; opacity: 0.85; }
        .hero-title { font-family: var(--font-display); font-size: 24px; font-weight: 700; letter-spacing: -0.02em; margin-top: 4px; }
        .hero-theme-btn { height: 32px; padding: 0 10px; border-radius: 999px; background: rgba(255,255,255,0.18); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); display: flex; align-items: center; gap: 5px; flex-shrink: 0; }
        .hero-action { display: flex; align-items: center; gap: 10px; padding: 11px 16px; background: rgba(255,255,255,0.92); border-radius: 999px; width: 100%; text-align: left; }
        .hero-action-label { flex: 1; font-weight: 700; font-size: 13px; color: #2c2620; }

        .hero-tiles { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; padding: 0 12px; align-content: start; }
        @media (min-width: 600px) { .hero-tiles { grid-template-columns: repeat(4, 1fr); } }
        .tile { background: var(--card-bg, var(--surface)); border: 1px solid var(--border); border-radius: var(--radius); padding: 14px; box-shadow: var(--shadow-sm); display: flex; flex-direction: column; min-height: 96px; overflow: hidden; }
        .tile-action { cursor: pointer; transition: background 0.18s; }
        .tile-action:hover { background: var(--surface-deep, var(--muted)); }
        .tile-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
        .tile-label { font-family: var(--font-latin); font-size: 10px; font-weight: 700; letter-spacing: 0.14em; color: var(--fg-faint); text-transform: uppercase; }
        .tile-icon-muted { color: var(--fg-muted); }
        .tile-icon-faint { color: var(--fg-faint); }
        .tile-empty { font-size: 12px; color: var(--fg-muted); flex: 1; display: flex; align-items: center; }
        .note-list { list-style: none; display: flex; flex-direction: column; gap: 4px; flex: 1; }
        .note-row { display: flex; align-items: center; gap: 7px; padding: 6px 8px; border-radius: var(--radius-sm, 8px); cursor: pointer; transition: background 0.15s; }
        .note-row:hover { background: var(--surface-alt, var(--accent)); }
        .note-icon { color: var(--fg-muted); flex-shrink: 0; }
        .note-title { flex: 1; font-size: 12.5px; font-weight: 600; color: var(--foreground); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .note-chevron { color: var(--fg-faint); flex-shrink: 0; }
        .folder-chip-list { list-style: none; display: flex; flex-wrap: wrap; gap: 6px; align-content: flex-start; flex: 1; }
        .folder-chip { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 600; color: var(--foreground); background: var(--surface-alt, var(--accent)); padding: 4px 9px; border-radius: 999px; max-width: 100%; cursor: pointer; border: none; font-family: inherit; }
        .folder-chip:hover { background: var(--surface-deep, var(--muted)); }
        .folder-chip-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 90px; }
        .tile-cta { display: flex; align-items: center; gap: 10px; flex: 1; }
        .tile-cta-icon { color: var(--primary); flex-shrink: 0; }
        .tile-cta span { font-size: 12.5px; font-weight: 600; color: var(--foreground); }

        .folder-dot { width: 8px; height: 8px; border-radius: 999px; flex-shrink: 0; }
        .folder-dot.lg { width: 12px; height: 12px; }

        .home-hero.mobile { display: block; overflow-y: auto; -webkit-overflow-scrolling: touch; overscroll-behavior: contain; padding-bottom: calc(60px + env(safe-area-inset-bottom) + 16px); }
        .search-container { position: relative; margin: 0 12px 12px; flex-shrink: 0; }
        .search-icon { position: absolute; left: 13px; top: 50%; transform: translateY(-50%); color: var(--fg-faint); pointer-events: none; }
        .search-input { width: 100%; padding: 10px 14px 10px 36px; background: var(--surface-alt, var(--accent)); border: 1.5px solid transparent; font-size: 0.875rem; border-radius: 50px; color: var(--foreground); }
        .search-input:focus { border-color: var(--primary); }

        .actions-row { display: flex; gap: 8px; margin: 0 12px 12px; flex-shrink: 0; }
        .btn-new-folder { display: flex; align-items: center; gap: 6px; padding: 8px 14px; background: linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%); color: var(--primary-foreground, #fff); font-weight: 700; font-size: 0.8rem; border-radius: 10px; flex-shrink: 0; }
        .view-toggle { display: flex; flex: 1; background: var(--surface-alt, var(--accent)); border-radius: 10px; padding: 3px; gap: 2px; }
        .vt-btn { flex: 1; display: flex; align-items: center; justify-content: center; gap: 5px; padding: 7px 8px; background: transparent; color: var(--foreground); font-size: 0.78rem; font-weight: 600; border-radius: 8px; opacity: 0.55; }
        .vt-btn.active { background: var(--card-bg, var(--background)); color: var(--primary); opacity: 1; box-shadow: var(--shadow-sm); }

        .content-area { padding: 0 12px; }
        @media (max-height: 500px) { .hero-banner { height: 110px; } }
        .graph-wrap { position: relative; width: 100%; height: 100%; min-height: 320px; display: flex; }
        .graph-fullscreen-btn { position: absolute; top: 8px; right: 8px; z-index: 10; width: 30px; height: 30px; border-radius: 8px; background: rgba(0,0,0,0.18); color: #fff; display: flex; align-items: center; justify-content: center; cursor: pointer; border: none; transition: background 0.15s; backdrop-filter: blur(4px); }
        .graph-fullscreen-btn:hover { background: rgba(0,0,0,0.4); }

        .folder-item-wrapper { margin-bottom: 2px; }
        .folder-item { display: flex; align-items: center; gap: 8px; padding: 10px 8px; border-radius: 10px; cursor: pointer; transition: background 0.18s; }
        .folder-item:hover { background: var(--surface-alt, var(--accent)); }
        .chevron { display: flex; color: var(--fg-faint); transition: transform 0.2s; flex-shrink: 0; }
        .chevron.expanded { transform: rotate(90deg); }
        .folder-name { flex: 1; font-size: 0.9rem; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--foreground); }
        .folder-actions { display: flex; gap: 2px; flex-shrink: 0; }
        .btn-inline { background: transparent; color: var(--fg-faint); padding: 6px; border-radius: 6px; }
        .btn-inline:hover { background: var(--surface-alt, var(--accent)); color: var(--primary); }
        .btn-del:hover { background: rgba(239,68,68,0.12); color: #ef4444; }
        .color-picker { display: flex; gap: 8px; padding: 10px 12px; background: var(--card-bg, var(--background)); border: 1px solid var(--border); border-radius: 12px; box-shadow: var(--shadow); margin: 4px 0 10px 30px; }
        .color-dot { width: 24px; height: 24px; border-radius: 50%; box-shadow: 0 1px 4px rgba(0,0,0,0.2); }
        .color-dot:hover { transform: scale(1.15); }
        .nested-notes { margin-left: 24px; border-left: 2px solid var(--border); padding-left: 8px; margin-top: 2px; margin-bottom: 4px; }
        .note-item { display: flex; align-items: center; gap: 8px; padding: 9px 10px; border-radius: 8px; cursor: pointer; margin: 2px 0; font-size: 0.875rem; color: var(--foreground); transition: background 0.15s; }
        .note-item:hover { background: var(--surface-alt, var(--accent)); }
        .empty-hint { font-size: 0.75rem; color: var(--fg-faint); padding: 6px 10px; }
        .section-label { font-size: 0.7rem; color: var(--fg-faint); font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; margin: 18px 0 6px 4px; }
        .loose-notes { margin-top: 4px; }

        .delete-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.45); backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); z-index: 9999; display: flex; align-items: center; justify-content: center; padding: 24px; }
        .delete-dialog { background: var(--surface, var(--background)); border-radius: 20px; padding: 28px 24px 24px; width: 100%; max-width: 320px; box-shadow: 0 20px 60px rgba(0,0,0,0.3); display: flex; flex-direction: column; align-items: center; text-align: center; }
        .delete-dialog-icon { width: 52px; height: 52px; background: rgba(239,68,68,0.12); border-radius: 50%; display: flex; align-items: center; justify-content: center; color: #ef4444; margin-bottom: 14px; }
        .ddt { font-size: 1.05rem; font-weight: 800; color: var(--foreground); margin-bottom: 6px; }
        .ddf { font-size: 0.95rem; font-weight: 700; color: var(--primary); margin-bottom: 10px; }
        .ddd { font-size: 0.85rem; color: var(--fg-muted); line-height: 1.6; margin-bottom: 22px; }
        .dda { display: flex; flex-direction: column; gap: 8px; width: 100%; }
        .dda-cancel { padding: 11px; background: var(--surface-alt, var(--accent)); color: var(--foreground); border-radius: 12px; font-weight: 600; font-size: 0.9rem; }
        .dda-keep { padding: 11px; background: var(--surface-alt, var(--accent)); color: var(--primary); border-radius: 12px; font-weight: 600; font-size: 0.9rem; border: 1.5px solid var(--border); }
        .dda-delete { padding: 11px; background: #ef4444; color: #fff; border-radius: 12px; font-weight: 700; font-size: 0.9rem; box-shadow: 0 4px 12px rgba(239,68,68,0.3); }
        .dda-delete:hover { background: #dc2626; }
        .graph-fs-overlay { position: fixed; inset: 0; z-index: 9998; background: var(--background); display: flex; flex-direction: column; }
        .graph-fs-close { position: absolute; top: 14px; right: 14px; z-index: 9999; width: 40px; height: 40px; border-radius: 50%; background: var(--accent); color: var(--foreground); display: flex; align-items: center; justify-content: center; box-shadow: var(--shadow); cursor: pointer; border: none; transition: background 0.15s; }
        .graph-fs-close:hover { background: var(--border); }
      `}</style>
    </div>
  );
}
