'use client';

import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Folder, type Note } from '@/lib/db';
import { FolderIcon, FileText, Plus, ChevronRight, ChevronDown, FolderPlus, Palette, Sun, Moon } from 'lucide-react';
import { useState, useEffect } from 'react';
import Image from 'next/image';

interface SidebarProps {
  activeNoteId?: number;
  onSelectNote: (id: number) => void;
}

const COLORS = [
  { name: 'Pink', value: '--folder-pink' },
  { name: 'Blue', value: '--folder-blue' },
  { name: 'Green', value: '--folder-green' },
  { name: 'Yellow', value: '--folder-yellow' },
  { name: 'Purple', value: '--folder-purple' },
];

export default function Sidebar({ activeNoteId, onSelectNote }: SidebarProps) {
  const folders = useLiveQuery(() => db.folders.toArray());
  const notes = useLiveQuery(() => db.notes.toArray());
  const [expandedFolders, setExpandedFolders] = useState<Record<number, boolean>>({});
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [editingFolderColor, setEditingFolderColor] = useState<number | null>(null);

  useEffect(() => {
    // Only run on client
    const theme = localStorage.getItem('theme');
    if (theme === 'dark') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsDarkMode(true);
      document.body.setAttribute('data-theme', 'dark');
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
      await db.folders.add({
        name,
        createdAt: Date.now(),
        color: '--folder-pink'
      });
    }
  };

  const updateFolderColor = async (id: number, color: string) => {
    await db.folders.update(id, { color });
    setEditingFolderColor(null);
  };

  const addNote = async (folderId?: number) => {
    const id = await db.notes.add({
      title: '無題のメモ',
      content: '',
      folderId,
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
    onSelectNote(id as number);
    if (folderId) {
      setExpandedFolders(prev => ({ ...prev, [folderId]: true }));
    }
  };

  return (
    <aside className="sidebar glass">
      <div className="sidebar-header">
        <Image src="/logo.png" alt="Lily Memo Logo" width={40} height={40} className="logo-img" />
        <h1 className="title">Lily Memo</h1>
        <button className="theme-toggle" onClick={toggleTheme}>
          {isDarkMode ? <Sun size={20} /> : <Moon size={20} />}
        </button>
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

      <div className="sidebar-content">
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
                      onClick={() => onSelectNote(note.id!)}
                    >
                      <FileText size={16} />
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
             <div className="section-label">すべてのメモ</div>
             {notes?.filter(n => !n.folderId).map(note => (
                <div 
                  key={note.id} 
                  className={`note-item ${activeNoteId === note.id ? 'active' : ''}`}
                  onClick={() => onSelectNote(note.id!)}
                >
                  <FileText size={16} />
                  <span>{note.title}</span>
                </div>
              ))}
          </div>
        </div>
      </div>

      <style jsx>{`
        .sidebar {
          width: 280px;
          height: 100vh;
          display: flex;
          flex-direction: column;
          padding: 20px;
          border-right: 1px solid var(--border);
          flex-shrink: 0;
          z-index: 10;
        }
        @media (max-width: 768px) {
          .sidebar {
            width: 80px;
            padding: 10px;
          }
          .title, .btn-add span, .folder-item span, .note-item span, .section-label, .sidebar-header .theme-toggle {
            display: none;
          }
           .sidebar-header {
            justify-content: center;
          }
        }
        .sidebar-header {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 24px;
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
        .sidebar-actions {
          display: flex;
          gap: 8px;
          margin-bottom: 24px;
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
        }
        .btn-icon {
          width: 40px;
          height: 40px;
          background: var(--accent);
          color: var(--primary);
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .sidebar-content {
          flex: 1;
          overflow-y: auto;
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
        }
        .folder-item:hover .folder-item-actions {
          opacity: 1;
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
          background: white;
          border-radius: 12px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.1);
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
      `}</style>
    </aside>
  );
}
