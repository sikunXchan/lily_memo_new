'use client';

import { useLiveQuery } from 'dexie-react-hooks';
import { db, newSyncId } from '@/lib/db';
import { FolderIcon, FileText, Plus, ChevronRight, ChevronDown, FolderPlus, Palette, Sun, Moon, Search, Settings, List, Sparkles, Pencil, Brush } from 'lucide-react';
import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import Image from 'next/image';

// Heavy: pulls in react-force-graph-2d + d3 + canvas-confetti shaders.
// Only needed when the user switches to the graph view.
const DirectoryGraph = dynamic(() => import('./DirectoryGraph'), { ssr: false });

interface SidebarProps {
  activeNoteId?: number;
  onSelectNote: (id: number) => void;
  onOpenSettings: () => void;
  onOpenPDF?: () => void;
  onOpenSketch?: () => void;
  isMobileOpen: boolean;
  onToggleMobile: () => void;
}

const COLORS = [
  { name: 'Pink', value: '--folder-pink' },
  { name: 'Blue', value: '--folder-blue' },
  { name: 'Green', value: '--folder-green' },
  { name: 'Yellow', value: '--folder-yellow' },
  { name: 'Purple', value: '--folder-purple' },
];

export default function Sidebar({ activeNoteId, onSelectNote, onOpenSettings, onOpenPDF, onOpenSketch, isMobileOpen, onToggleMobile }: SidebarProps) {
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
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [editingFolderColor, setEditingFolderColor] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<'tree' | 'graph'>('tree');

  useEffect(() => {
    const restoreViewMode = () => {
      const saved = localStorage.getItem('sidebarViewMode');
      if (saved === 'graph' || saved === 'tree') setViewMode(saved);
    };
    restoreViewMode();
  }, []);

  const changeViewMode = (mode: 'tree' | 'graph') => {
    setViewMode(mode);
    localStorage.setItem('sidebarViewMode', mode);
  };

  useEffect(() => {
    const applyStoredTheme = () => {
      const theme = localStorage.getItem('theme');
      if (theme === 'dark') {
        setIsDarkMode(true);
        document.body.setAttribute('data-theme', 'dark');
      }
    };
    applyStoredTheme();
  }, []);

  const toggleTheme = () => {
    const newMode = !isDarkMode;
    setIsDarkMode(newMode);
    document.body.setAttribute('data-theme', newMode ? 'dark' : 'light');
    localStorage.setItem('theme', newMode ? 'dark' : 'light');
  };

  const toggleFolder = (id: number) => {
    setExpandedFolders(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const addFolder = async () => {
    const name = prompt('フォルダ名を入力してください');
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
    const folder = await db.folders.get(id);
    if (!folder) return;
    // eslint-disable-next-line react-hooks/purity
    await db.folders.update(id, { color, updatedAt: Date.now() });
    setEditingFolderColor(null);
  };

  const addNote = async (folderId?: number) => {
    const now = Date.now();
    const id = await db.notes.add({
      syncId: newSyncId(),
      title: '無題のメモ',
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

  return (
    <>
      <aside className="sidebar glass" style={{ overflow: 'hidden' }}>
        <div className="sidebar-header">
          <Image src="/logo.png" alt="Lily Memo Logo" width={40} height={40} className="logo-img" />
          <h1 className="title">Lily Memo</h1>
          <button className="theme-toggle" onClick={toggleTheme}>
            {isDarkMode ? <Sun size={20} /> : <Moon size={20} />}
          </button>
        </div>

        <div className="search-container">
          <Search size={16} className="search-icon" />
          <input 
            type="text" 
            placeholder="メモを検索..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="search-input"
          />
        </div>

        <div className="sidebar-actions">
          <button className="btn-add" onClick={() => addNote()}>
            <Plus size={18} />
            <span>新しいメモ</span>
          </button>
          <button className="btn-icon" onClick={addFolder} title="フォルダ作成">
            <FolderPlus size={18} />
          </button>
        </div>

        <div className="view-toggle" role="tablist" aria-label="表示切替">
          <button
            role="tab"
            aria-selected={viewMode === 'tree'}
            className={`view-toggle-btn ${viewMode === 'tree' ? 'active' : ''}`}
            onClick={() => changeViewMode('tree')}
          >
            <List size={14} />
            <span>ツリー</span>
          </button>
          <button
            role="tab"
            aria-selected={viewMode === 'graph'}
            className={`view-toggle-btn ${viewMode === 'graph' ? 'active' : ''}`}
            onClick={() => changeViewMode('graph')}
          >
            <Sparkles size={14} />
            <span>つながり</span>
          </button>
        </div>

        <div className="sidebar-content" style={{ minHeight: 0, overflowY: 'auto' }}>
          {viewMode === 'graph' ? (
            <div className="graph-wrapper">
              <DirectoryGraph
                folders={folders ?? []}
                notes={notes ?? []}
                activeNoteId={activeNoteId}
                onSelectNote={(id) => { onSelectNote(id); if (window.innerWidth <= 768) onToggleMobile(); }}
              />
            </div>
          ) : (
          <div className="folder-list">
            {folders?.map(folder => (
              <div key={folder.id} className="folder-item-wrapper">
                <div className="folder-item" onClick={() => folder.id && toggleFolder(folder.id)}>
                  {expandedFolders[folder.id!] ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  <FolderIcon size={18} style={{ color: `var(${folder.color || '--folder-pink'})` }} />
                  <span>{folder.name}</span>
                  <div className="folder-item-actions">
                    <button className="btn-inline" onClick={(e) => { e.stopPropagation(); setEditingFolderColor(editingFolderColor === folder.id ? null : folder.id!); }}>
                      <Palette size={14} />
                    </button>
                    <button className="btn-inline" onClick={(e) => { e.stopPropagation(); addNote(folder.id); }}>
                      <Plus size={14} />
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
                        {note.type === 'handwriting' ? <Pencil size={16} /> : <FileText size={16} />}
                        <span>{note.title}</span>
                      </div>
                    ))}
                    {notes?.filter(n => n.folderId === folder.id).length === 0 && (
                      <div className="empty-hint">メモはありません</div>
                    )}
                  </div>
                )}
              </div>
            ))}

            <div className="unorganized-notes">
              <div className="section-label">{searchQuery ? '検索結果' : 'すべてのメモ'}</div>
              {notes?.filter(n => !n.folderId || (searchQuery && n.folderId)).map(note => (
                  <div
                    key={note.id}
                    className={`note-item ${activeNoteId === note.id ? 'active' : ''}`}
                    onClick={() => { onSelectNote(note.id!); if (window.innerWidth <= 768) onToggleMobile(); }}
                  >
                    {note.type === 'handwriting' ? <Pencil size={16} /> : <FileText size={16} />}
                    <span>{note.title}</span>
                  </div>
                ))}
            </div>
          </div>
          )}
        </div>

        <div className="sidebar-footer">
          {onOpenSketch && (
            <button className="btn-settings" onClick={onOpenSketch}>
              <Brush size={20} />
              <span>落書き</span>
            </button>
          )}
          {onOpenPDF && (
            <button className="btn-settings" onClick={onOpenPDF}>
              <FileText size={20} />
              <span>PDF</span>
            </button>
          )}
          <button className="btn-settings" onClick={onOpenSettings}>
            <Settings size={20} />
            <span>設定</span>
          </button>
        </div>

        <style jsx>{`
          .sidebar {
            width: 280px;
            height: 100vh;
            display: grid;
            grid-template-rows: auto auto auto auto 1fr auto;
            padding: 20px;
            border-right: 1px solid var(--border);
            flex-shrink: 0;
            z-index: 100;
            transition: all 0.3s;
          }
          @media (max-width: 1023px) and (orientation: portrait) {
            .sidebar {
              width: 100%;
              height: 100dvh;
              border-right: none;
              padding: 16px;
            }
          }
          .sidebar-header {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-bottom: 20px;
          }
          .logo-img {
            border-radius: 12px;
          }
          .title {
            font-size: 1.2rem;
            font-weight: 700;
            color: var(--primary);
            flex: 1;
          }
          .theme-toggle {
            background: transparent;
            color: var(--foreground);
            padding: 4px;
          }
          .search-container {
            position: relative;
            margin-bottom: 20px;
          }
          .search-icon {
            position: absolute;
            left: 12px;
            top: 50%;
            transform: translateY(-50%);
            color: #999;
          }
          .search-input {
            width: 100%;
            padding: 8px 12px 8px 36px;
            background: var(--accent);
            border: none;
            font-size: 0.9rem;
            border-radius: 8px;
          }
          .sidebar-actions {
            display: flex;
            gap: 8px;
            margin-bottom: 12px;
          }
          .btn-add {
            flex: 1;
            background: var(--primary);
            color: white;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            padding: 10px;
            font-weight: 600;
            box-shadow: var(--shadow);
            border-radius: 8px;
          }
          .btn-icon {
            width: 40px;
            height: 40px;
            background: var(--accent);
            color: var(--primary);
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 8px;
          }
          .view-toggle {
            display: flex;
            background: var(--accent);
            border-radius: 10px;
            padding: 3px;
            margin-bottom: 16px;
            gap: 2px;
          }
          .view-toggle-btn {
            flex: 1;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            padding: 7px 8px;
            background: transparent;
            color: var(--foreground);
            font-size: 0.8rem;
            font-weight: 600;
            border-radius: 8px;
            transition: all 0.18s;
            opacity: 0.65;
          }
          .view-toggle-btn.active {
            background: var(--background);
            color: var(--primary);
            opacity: 1;
            box-shadow: 0 1px 4px rgba(0,0,0,0.08);
          }
          .graph-wrapper {
            width: 100%;
            height: 100%;
            min-height: 280px;
            display: flex;
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
          .folder-item {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px;
            border-radius: 12px;
            cursor: pointer;
            transition: background 0.2s;
          }
          .folder-item:hover {
            background: var(--accent);
          }
          .folder-item-actions {
            margin-left: auto;
            display: flex;
            gap: 4px;
            opacity: 0;
            transition: opacity 0.15s;
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
            color: var(--primary);
            padding: 2px;
          }
          .color-picker {
            display: flex;
            gap: 8px;
            padding: 8px;
            background: var(--background);
            border: 1px solid var(--border);
            border-radius: 12px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            margin: 4px 0 12px 24px;
          }
          .color-dot {
            width: 20px;
            height: 20px;
            border-radius: 50%;
          }
          .nested-notes {
            margin-left: 20px;
            border-left: 2px solid var(--border);
            padding-left: 8px;
          }
          .note-item {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px 12px;
            border-radius: 12px;
            cursor: pointer;
            margin: 4px 0;
            font-size: 0.9rem;
            transition: all 0.2s;
          }
          .note-item:hover {
            background: var(--accent);
          }
          .note-item.active {
            background: var(--primary);
            color: white;
          }
          .empty-hint {
            font-size: 0.75rem;
            color: #ccc;
            padding: 4px 12px;
          }
          .section-label {
            font-size: 0.75rem;
            color: #999;
            margin: 20px 0 8px 8px;
            text-transform: uppercase;
          }
          .sidebar-footer {
            padding-top: 20px;
            border-top: 1px solid var(--border);
            display: flex;
            flex-direction: column;
            gap: 8px;
          }
          .btn-settings {
            width: 100%;
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 12px;
            background: var(--accent);
            color: var(--foreground);
            font-weight: 600;
            border-radius: 8px;
          }
          .btn-settings:hover {
            background: var(--border);
          }
          /* 縦画面モバイルではタブナビゲーションがあるため、設定/PDFボタンは非表示 */
          @media (max-width: 1023px) and (orientation: portrait) {
            .sidebar-footer .btn-settings {
              display: none;
            }
            .sidebar-footer {
              padding-bottom: calc(env(safe-area-inset-bottom) + 8px);
            }
          }
        `}</style>
      </aside>
    </>
  );
}
