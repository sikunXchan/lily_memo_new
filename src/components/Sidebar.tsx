'use client';

import { useLiveQuery } from 'dexie-react-hooks';
import { db, newSyncId, softDeleteNotes, softDeleteFolder } from '@/lib/db';
import { FolderIcon, FileText, Plus, ChevronRight, ChevronDown, FolderPlus, Palette, Search, Settings, List, Sparkles, Pencil, Brush, Trash2, ArrowLeft, X } from 'lucide-react';
import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import Image from 'next/image';
import { useT, translate } from '@/lib/i18n';
import { useCharacterSkin, AmbientOverlay } from './CharacterSkinContext';

// Heavy: pulls in react-force-graph-2d + d3 + canvas-confetti shaders.
// Only needed when the user switches to the graph view.
const DirectoryGraph = dynamic(() => import('./DirectoryGraph'), { ssr: false });

interface SidebarProps {
  activeNoteId?: number;
  onSelectNote: (id: number) => void;
  onOpenSettings: () => void;
  onOpenPDF?: () => void;
  onOpenSketch?: () => void;
  onOpenAI?: () => void;
  onOpenSearch?: () => void;
  isMobileOpen: boolean;
  onToggleMobile: () => void;
  onActiveNoteDeleted?: () => void;
  onBackToHome?: () => void;
  /** Controlled view mode. When provided, Sidebar delegates to parent. */
  viewModeProp?: 'tree' | 'graph';
  onViewModeChangeProp?: (mode: 'tree' | 'graph') => void;
  /** Pass a new object each time to trigger folder expand + scroll. */
  highlightFolderReq?: { id: number; seq: number } | null;
}

const COLORS = [
  { name: 'Pink', value: '--folder-pink' },
  { name: 'Blue', value: '--folder-blue' },
  { name: 'Green', value: '--folder-green' },
  { name: 'Yellow', value: '--folder-yellow' },
  { name: 'Purple', value: '--folder-purple' },
];

interface DeletingFolderState {
  id: number;
  name: string;
  noteCount: number;
}

export default function Sidebar({
  activeNoteId, onSelectNote, onOpenSettings, onOpenPDF, onOpenSketch, onOpenAI, onOpenSearch,
  isMobileOpen, onToggleMobile, onActiveNoteDeleted, onBackToHome,
  viewModeProp, onViewModeChangeProp, highlightFolderReq,
}: SidebarProps) {
  const t = useT();
  const { homeBackgroundSrc } = useCharacterSkin();
  const [searchQuery, setSearchQuery] = useState('');

  const folders = useLiveQuery(() =>
    db.folders.filter(f => !f.deletedAt).toArray()
  );
  const notes = useLiveQuery(() => {
    const base = db.notes.filter(note => !note.deletedAt);
    if (!searchQuery) return base.toArray();
    return base
      .filter(note => note.title.toLowerCase().includes(searchQuery.toLowerCase()))
      .toArray();
  }, [searchQuery]);

  const [expandedFolders, setExpandedFolders] = useState<Record<number, boolean>>({});
  const [editingFolderColor, setEditingFolderColor] = useState<number | null>(null);
  const [internalViewMode, setInternalViewMode] = useState<'tree' | 'graph'>('tree');
  const [deletingFolder, setDeletingFolder] = useState<DeletingFolderState | null>(null);

  // Controlled or uncontrolled view mode.
  const viewMode = viewModeProp ?? internalViewMode;

  useEffect(() => {
    const saved = localStorage.getItem('sidebarViewMode');
    if (saved === 'graph' || saved === 'tree') {
      if (onViewModeChangeProp) onViewModeChangeProp(saved as 'tree' | 'graph');
      else setInternalViewMode(saved as 'tree' | 'graph');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const changeViewMode = (mode: 'tree' | 'graph') => {
    if (onViewModeChangeProp) onViewModeChangeProp(mode);
    else setInternalViewMode(mode);
    localStorage.setItem('sidebarViewMode', mode);
  };

  // Auto-expand a folder when parent requests a highlight.
  useEffect(() => {
    if (highlightFolderReq) {
      setExpandedFolders(prev => ({ ...prev, [highlightFolderReq.id]: true }));
      // Switch to tree view so the folder is visible.
      if (viewMode === 'graph') changeViewMode('tree');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightFolderReq]);

  const toggleFolder = (id: number) => {
    setExpandedFolders(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const addFolder = async () => {
    const name = prompt(t('フォルダ名を入力してください'));
    if (name) {
      const now = Date.now();
      await db.folders.add({
        syncId: newSyncId(),
        name,
        createdAt: now,
        updatedAt: now,
        color: '--folder-pink'
      });
    }
  };

  const updateFolderColor = async (id: number, color: string) => {
    await db.folders.update(id, { color, updatedAt: Date.now() });
    setEditingFolderColor(null);
  };

  const addNote = async (folderId?: number) => {
    const now = Date.now();
    const id = await db.notes.add({
      syncId: newSyncId(),
      title: translate('無題のメモ'),
      content: '',
      folderId,
      type: 'text',
      createdAt: now,
      updatedAt: now
    });
    onSelectNote(id as number);
    if (folderId) {
      setExpandedFolders(prev => ({ ...prev, [folderId]: true }));
    }
    if (window.innerWidth <= 768) onToggleMobile();
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
      if (activeNoteId && folderNoteIds.includes(activeNoteId)) {
        onActiveNoteDeleted?.();
      }
      await softDeleteNotes(folderNoteIds);
    } else if (!deleteNotes && folderNoteIds.length > 0) {
      for (const noteId of folderNoteIds) {
        await db.notes.update(noteId, { folderId: undefined, updatedAt: Date.now() });
      }
    }

    await softDeleteFolder(id);
    setDeletingFolder(null);
  };

  return (
    <>
      <aside
        className={`sidebar glass${homeBackgroundSrc ? ' has-skin-bg' : ''}`}
        style={homeBackgroundSrc
          ? { overflow: 'hidden', backgroundImage: `url(${homeBackgroundSrc})`, backgroundSize: 'cover', backgroundPosition: 'center' }
          : { overflow: 'hidden' }}
      >
        {homeBackgroundSrc && <AmbientOverlay />}
        <div className="sidebar-header">
          <div className="logo-area">
            {onBackToHome && (
              <button className="back-btn" onClick={onBackToHome} title={t('ホームに戻る')} aria-label={t('ホームに戻る')}>
                <ArrowLeft size={18} />
              </button>
            )}
            <Image src="/logo.png" alt="Lily Memo Logo" width={36} height={36} className="logo-img" />
            <h1 className="title">Lily Memo</h1>
          </div>
        </div>

        <div className="search-container">
          <Search size={15} className="search-icon" />
          <input
            type="text"
            placeholder={t('タイトルで絞り込み...')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="search-input"
          />
          {onOpenSearch && (
            <button className="btn-fulltext-search" onClick={onOpenSearch} title={t('全文検索 (⌘K)')}>
              {t('全文')}
            </button>
          )}
        </div>

        <div className="sidebar-actions">
          <button className="btn-add" onClick={() => addNote()}>
            <Plus size={17} />
            <span>{t('新しいメモ')}</span>
          </button>
          <button className="btn-icon" onClick={addFolder} title={t('フォルダ作成')}>
            <FolderPlus size={17} />
          </button>
        </div>

        <div className="sidebar-content" style={{ minHeight: 0, overflowY: 'auto' }}>
          {(
          <div className="folder-list">
            {folders?.map(folder => (
              <div key={folder.id} className="folder-item-wrapper">
                <div className="folder-item" onClick={() => folder.id && toggleFolder(folder.id)}>
                  <span className={`chevron ${expandedFolders[folder.id!] ? 'expanded' : ''}`}>
                    <ChevronRight size={14} />
                  </span>
                  <FolderIcon size={16} style={{ color: `var(${folder.color || '--folder-pink'})`, flexShrink: 0 }} />
                  <span className="folder-name">{folder.name}</span>
                  <div className="folder-item-actions">
                    <button className="btn-inline" title={t('色を変更')} onClick={(e) => { e.stopPropagation(); setEditingFolderColor(editingFolderColor === folder.id ? null : folder.id!); }}>
                      <Palette size={13} />
                    </button>
                    <button className="btn-inline" title={t('メモを追加')} onClick={(e) => { e.stopPropagation(); addNote(folder.id); }}>
                      <Plus size={13} />
                    </button>
                    <button className="btn-inline btn-inline-delete" title={t('フォルダを削除')} onClick={(e) => handleDeleteFolder(e, { id: folder.id!, name: folder.name })}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>

                {editingFolderColor === folder.id && (
                  <div className="color-picker" onClick={e => e.stopPropagation()}>
                    {COLORS.map(c => (
                      <button
                        key={c.value}
                        className="color-dot"
                        style={{ background: `var(${c.value})` }}
                        onClick={() => updateFolderColor(folder.id!, c.value)}
                        title={c.name}
                      />
                    ))}
                  </div>
                )}

                {expandedFolders[folder.id!] && (
                  <div className="nested-notes">
                    {notes?.filter(n => n.folderId === folder.id).map(note => (
                      <div
                        key={note.id}
                        className={`note-item ${activeNoteId === note.id ? 'active' : ''}`}
                        onClick={() => { onSelectNote(note.id!); if (window.innerWidth <= 768) onToggleMobile(); }}
                      >
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

            <div className="unorganized-notes">
              <div className="section-label">{searchQuery ? t('検索結果') : t('すべてのメモ')}</div>
              {notes?.filter(n => !n.folderId || (searchQuery && n.folderId)).map(note => (
                  <div
                    key={note.id}
                    className={`note-item ${activeNoteId === note.id ? 'active' : ''}`}
                    onClick={() => { onSelectNote(note.id!); if (window.innerWidth <= 768) onToggleMobile(); }}
                  >
                    {note.type === 'handwriting' ? <Pencil size={14} /> : <FileText size={14} />}
                    <span>{note.title}</span>
                  </div>
                ))}
            </div>
          </div>
          )}
        </div>

        <div className="sidebar-footer">
          {onOpenAI && (
            <button className="btn-settings btn-ai" onClick={onOpenAI}>
              <Sparkles size={18} />
              <span>Lily</span>
            </button>
          )}
          {onOpenSketch && (
            <button className="btn-settings" onClick={onOpenSketch}>
              <Brush size={18} />
              <span>{t('落書き')}</span>
            </button>
          )}
          {onOpenPDF && (
            <button className="btn-settings" onClick={onOpenPDF}>
              <FileText size={18} />
              <span>PDF</span>
            </button>
          )}
          <button className="btn-settings" onClick={onOpenSettings}>
            <Settings size={18} />
            <span>{t('設定')}</span>
          </button>
        </div>

        {/* フォルダ削除確認モーダル */}
        {deletingFolder && (
          <div className="delete-overlay" onClick={() => setDeletingFolder(null)}>
            <div className="delete-dialog" onClick={e => e.stopPropagation()}>
              <div className="delete-dialog-icon">
                <Trash2 size={22} />
              </div>
              <h3 className="delete-dialog-title">{t('フォルダを削除')}</h3>
              <p className="delete-dialog-folder-name">「{deletingFolder.name}」</p>
              {deletingFolder.noteCount > 0 ? (
                <p className="delete-dialog-desc">
                  {t('{n}件のメモが含まれています。', { n: deletingFolder.noteCount })}<br />{t('メモはどうしますか？')}
                </p>
              ) : (
                <p className="delete-dialog-desc">{t('このフォルダを削除します。')}</p>
              )}
              <div className="delete-dialog-actions">
                <button className="dda-cancel" onClick={() => setDeletingFolder(null)}>{t('キャンセル')}</button>
                {deletingFolder.noteCount > 0 && (
                  <button className="dda-keep" onClick={() => confirmDeleteFolder(false)}>{t('メモを残す')}</button>
                )}
                <button className="dda-delete" onClick={() => confirmDeleteFolder(deletingFolder.noteCount === 0 ? false : true)}>
                  {deletingFolder.noteCount > 0 ? t('すべて削除') : t('削除する')}
                </button>
              </div>
            </div>
          </div>
        )}

        <style jsx>{`
          .sidebar {
            width: 280px;
            height: 100vh;
            display: grid;
            grid-template-rows: auto auto auto auto 1fr auto;
            padding: 18px 16px;
            border-right: 1px solid var(--border);
            flex-shrink: 0;
            z-index: 100;
            transition: all 0.3s;
            background: var(--glass-tint, rgba(255, 255, 255, 0.85));
            backdrop-filter: blur(20px);
            -webkit-backdrop-filter: blur(20px);
          }
          @media (max-width: 1023px) and (orientation: portrait) {
            .sidebar {
              width: 100%;
              height: 100dvh;
              border-right: none;
              padding: 16px;
            }
          }
          /* スキン背景が敷かれているとき: 文字は不透明チップの上に載せて可読性を保つ */
          .sidebar.has-skin-bg { position: relative; }
          .sidebar.has-skin-bg .logo-area {
            background: rgba(255, 252, 246, 0.92);
            border-radius: 12px; padding: 4px 10px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.15);
          }
          .sidebar.has-skin-bg :global(.folder-item),
          .sidebar.has-skin-bg :global(.note-item) {
            background: rgba(255, 252, 246, 0.92);
            box-shadow: 0 1px 5px rgba(0,0,0,0.12);
          }
          .sidebar.has-skin-bg :global(.folder-item) { margin-bottom: 4px; }
          .sidebar.has-skin-bg :global(.note-item.active) {
            background: rgba(255, 240, 245, 0.96);
          }
          .sidebar.has-skin-bg :global(.section-label),
          .sidebar.has-skin-bg :global(.empty-hint) {
            background: rgba(255, 252, 246, 0.88);
            border-radius: 8px; padding: 3px 8px; display: inline-block;
            color: var(--fg-muted);
          }
          .sidebar.has-skin-bg :global(.nested-notes) { border-left-color: rgba(255,252,246,0.8); }
          .sidebar-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 16px;
          }
          .logo-area {
            display: flex;
            align-items: center;
            gap: 10px;
          }
          .back-btn {
            background: var(--accent);
            color: var(--foreground);
            padding: 7px;
            border-radius: 10px;
            display: flex;
            align-items: center;
            justify-content: center;
            opacity: 0.8;
            transition: opacity 0.2s, background 0.2s;
          }
          .back-btn:hover {
            opacity: 1;
            background: var(--border);
          }
          .logo-img {
            border-radius: 10px;
            box-shadow: var(--shadow-sm);
          }
          .title {
            font-size: 1.15rem;
            font-weight: 800;
            color: var(--primary);
            letter-spacing: -0.3px;
          }
          .search-container {
            position: relative;
            margin-bottom: 14px;
          }
          .search-icon {
            position: absolute;
            left: 13px;
            top: 50%;
            transform: translateY(-50%);
            color: var(--fg-faint);
            pointer-events: none;
          }
          .search-input {
            width: 100%;
            padding: 9px 44px 9px 36px;
            background: var(--accent);
            border: 1.5px solid transparent;
            font-size: 0.875rem;
            border-radius: 50px;
            transition: border-color 0.2s, box-shadow 0.2s;
          }
          .search-input:focus {
            border-color: var(--primary);
            box-shadow: 0 0 0 3px rgba(128,128,128,0.15);
          }
          .btn-fulltext-search {
            position: absolute;
            right: 8px;
            top: 50%;
            transform: translateY(-50%);
            background: var(--primary);
            color: #fff;
            border: none;
            border-radius: 20px;
            padding: 2px 8px;
            font-size: 0.7rem;
            font-weight: 700;
            cursor: pointer;
            opacity: 0.85;
            transition: opacity 0.15s;
          }
          .btn-fulltext-search:hover { opacity: 1; }
          .sidebar-actions {
            display: flex;
            gap: 8px;
            margin-bottom: 12px;
          }
          .btn-add {
            flex: 1;
            background: linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%);
            color: var(--primary-foreground, white);
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 7px;
            padding: 10px 14px;
            font-weight: 700;
            font-size: 0.875rem;
            box-shadow: var(--shadow-sm);
            border-radius: 12px;
            transition: transform 0.18s, box-shadow 0.18s;
          }
          .btn-add:hover {
            transform: translateY(-1px);
            box-shadow: var(--shadow);
          }
          .btn-icon {
            width: 40px;
            height: 40px;
            background: var(--accent);
            color: var(--primary);
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 12px;
            transition: background 0.2s;
          }
          .btn-icon:hover {
            background: var(--border);
          }
          .view-toggle {
            display: flex;
            background: var(--accent);
            border-radius: 10px;
            padding: 3px;
            margin-bottom: 14px;
            gap: 2px;
          }
          .view-toggle-btn {
            flex: 1;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 5px;
            padding: 7px 8px;
            background: transparent;
            color: var(--foreground);
            font-size: 0.78rem;
            font-weight: 600;
            border-radius: 8px;
            transition: all 0.18s;
            opacity: 0.55;
          }
          .view-toggle-btn.active {
            background: var(--background);
            color: var(--primary);
            opacity: 1;
            box-shadow: 0 1px 6px rgba(0,0,0,0.1);
          }
          .sidebar-content {
            overflow-y: auto;
            min-height: 0;
          }
          @media (max-width: 1023px) and (orientation: portrait) {
            .sidebar-content {
              padding-bottom: calc(60px + env(safe-area-inset-bottom) + 16px);
            }
          }
          .folder-item-wrapper {
            margin-bottom: 2px;
          }
          .folder-item {
            display: flex;
            align-items: center;
            gap: 7px;
            padding: 8px 8px 8px 6px;
            border-radius: 10px;
            cursor: pointer;
            transition: background 0.18s;
          }
          .folder-item:hover {
            background: var(--surface-alt, var(--accent));
          }
          .chevron {
            display: flex;
            color: var(--fg-faint);
            transition: transform 0.2s;
            flex-shrink: 0;
          }
          .chevron.expanded {
            transform: rotate(90deg);
          }
          .folder-name {
            flex: 1;
            font-size: 0.875rem;
            font-weight: 600;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            color: var(--foreground);
          }
          .folder-item-actions {
            display: flex;
            gap: 2px;
            opacity: 0;
            transition: opacity 0.15s;
            flex-shrink: 0;
          }
          .folder-item:hover .folder-item-actions {
            opacity: 1;
          }
          /* タッチデバイスではホバーが使えないため常時表示 */
          @media (hover: none) {
            .folder-item-actions {
              opacity: 1;
            }
          }
          .btn-inline {
            background: transparent;
            color: var(--fg-faint);
            padding: 4px;
            border-radius: 6px;
            transition: background 0.15s, color 0.15s;
          }
          .btn-inline:hover {
            background: var(--accent);
            color: var(--primary);
          }
          .btn-inline-delete:hover {
            background: rgba(239, 68, 68, 0.1);
            color: #ef4444;
          }
          .color-picker {
            display: flex;
            gap: 8px;
            padding: 10px 12px;
            background: var(--background);
            border: 1px solid var(--border);
            border-radius: 12px;
            box-shadow: 0 4px 16px rgba(0,0,0,0.12);
            margin: 4px 0 10px 28px;
          }
          .color-dot {
            width: 22px;
            height: 22px;
            border-radius: 50%;
            transition: transform 0.15s;
            box-shadow: 0 1px 4px rgba(0,0,0,0.15);
          }
          .color-dot:hover {
            transform: scale(1.2);
          }
          .nested-notes {
            margin-left: 22px;
            border-left: 2px solid var(--border);
            padding-left: 6px;
            margin-top: 2px;
            margin-bottom: 4px;
          }
          .note-item {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 7px 10px 7px 7px;
            border-radius: 8px;
            cursor: pointer;
            margin: 2px 0;
            font-size: 0.85rem;
            transition: background 0.18s, color 0.18s;
            border-left: 2.5px solid transparent;
            color: var(--foreground);
          }
          .note-item:hover {
            background: var(--surface-alt, var(--accent));
          }
          .note-item.active {
            background: var(--surface-deep, var(--muted));
            border-left-color: var(--primary);
            color: var(--primary);
            font-weight: 600;
            padding-left: 4.5px;
          }
          .empty-hint {
            font-size: 0.73rem;
            color: var(--fg-faint);
            padding: 4px 10px;
          }
          .section-label {
            font-size: 0.7rem;
            color: var(--fg-faint);
            font-weight: 700;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            margin: 18px 0 6px 8px;
          }
          .sidebar-footer {
            padding-top: 14px;
            border-top: 1px solid var(--border);
            display: flex;
            flex-direction: column;
            gap: 4px;
          }
          .btn-settings {
            width: 100%;
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 10px 12px;
            background: transparent;
            color: var(--foreground);
            font-size: 0.875rem;
            font-weight: 600;
            border-radius: 10px;
            transition: background 0.18s;
            opacity: 0.75;
          }
          .btn-settings:hover {
            background: var(--accent);
            opacity: 1;
          }
          .btn-ai {
            color: var(--primary);
            opacity: 0.85;
          }
          .btn-ai:hover { opacity: 1; }
          /* 縦画面モバイルではタブナビゲーションがあるため、設定/PDFボタンは非表示 */
          @media (max-width: 1023px) and (orientation: portrait) {
            .sidebar-footer .btn-settings {
              display: none;
            }
            .sidebar-footer {
              padding-bottom: calc(env(safe-area-inset-bottom) + 8px);
            }
          }

          /* ===== フォルダ削除モーダル ===== */
          .delete-overlay {
            position: fixed;
            inset: 0;
            background: rgba(0, 0, 0, 0.45);
            backdrop-filter: blur(4px);
            -webkit-backdrop-filter: blur(4px);
            z-index: 9999;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 24px;
          }
          .delete-dialog {
            background: var(--background);
            border-radius: 20px;
            padding: 28px 24px 24px;
            width: 100%;
            max-width: 320px;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2);
            display: flex;
            flex-direction: column;
            align-items: center;
            text-align: center;
            animation: dialogIn 0.2s ease-out;
          }
          @keyframes dialogIn {
            from { transform: scale(0.92); opacity: 0; }
            to { transform: scale(1); opacity: 1; }
          }
          .delete-dialog-icon {
            width: 52px;
            height: 52px;
            background: rgba(239, 68, 68, 0.1);
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #ef4444;
            margin-bottom: 14px;
          }
          .delete-dialog-title {
            font-size: 1.05rem;
            font-weight: 800;
            color: var(--foreground);
            margin-bottom: 6px;
          }
          .delete-dialog-folder-name {
            font-size: 0.95rem;
            font-weight: 700;
            color: var(--primary);
            margin-bottom: 10px;
          }
          .delete-dialog-desc {
            font-size: 0.85rem;
            color: var(--fg-muted);
            line-height: 1.6;
            margin-bottom: 22px;
          }
          .delete-dialog-actions {
            display: flex;
            flex-direction: column;
            gap: 8px;
            width: 100%;
          }
          .dda-cancel {
            padding: 11px;
            background: var(--accent);
            color: var(--foreground);
            border-radius: 12px;
            font-weight: 600;
            font-size: 0.9rem;
            transition: background 0.15s;
          }
          .dda-cancel:hover {
            background: var(--border);
          }
          .dda-keep {
            padding: 11px;
            background: var(--surface-alt, var(--accent));
            color: var(--primary);
            border-radius: 12px;
            font-weight: 600;
            font-size: 0.9rem;
            border: 1.5px solid var(--border);
            transition: background 0.15s;
          }
          .dda-keep:hover {
            background: var(--surface-deep, var(--muted));
          }
          .dda-delete {
            padding: 11px;
            background: #ef4444;
            color: white;
            border-radius: 12px;
            font-weight: 700;
            font-size: 0.9rem;
            transition: background 0.15s, box-shadow 0.15s;
            box-shadow: 0 4px 12px rgba(239, 68, 68, 0.3);
          }
          .dda-delete:hover {
            background: #dc2626;
            box-shadow: 0 6px 16px rgba(239, 68, 68, 0.4);
          }
        `}</style>
      </aside>

    </>
  );
}
