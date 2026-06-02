'use client';

import { useState, useCallback } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ArrowLeft, Plus, Search, ChevronRight, Folder, FileText,
} from 'lucide-react';
import { db, newSyncId } from '@/lib/db';
import type { Folder as FolderType, Note } from '@/lib/db';

const FALLBACK_COLORS = ['#ffb6c1', '#93c5fd', '#86efac', '#fde68a', '#c4b5fd'];

function folderColor(f: FolderType, idx: number): string {
  if (f.color?.startsWith('--')) return `var(${f.color}, ${FALLBACK_COLORS[idx % FALLBACK_COLORS.length]})`;
  return f.color || FALLBACK_COLORS[idx % FALLBACK_COLORS.length];
}

interface MemoTreeScreenProps {
  onSelectNote: (id: number) => void;
  onGoBack: () => void;
  onOpenSearch: () => void;
}

export default function MemoTreeScreen({ onSelectNote, onGoBack, onOpenSearch }: MemoTreeScreenProps) {
  const [expandedFolders, setExpandedFolders] = useState<Record<number, boolean>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);

  const folders = useLiveQuery<FolderType[]>(() => db.folders.filter(f => !f.deletedAt).toArray()) ?? [];
  const notes = useLiveQuery<Note[]>(() => {
    const base = db.notes.filter(n => !n.deletedAt);
    if (!searchQuery) return base.sortBy('updatedAt').then(l => l.reverse());
    const q = searchQuery.toLowerCase();
    return base.filter(n => n.title.toLowerCase().includes(q) || (n.content ?? '').toLowerCase().includes(q))
      .sortBy('updatedAt').then(l => l.reverse());
  }, [searchQuery]) ?? [];

  const createNote = useCallback(async (folderId?: number) => {
    const t = Date.now();
    const id = await db.notes.add({
      syncId: newSyncId(), title: '無題のメモ', content: '',
      folderId, type: 'text', createdAt: t, updatedAt: t,
    });
    onSelectNote(id as number);
  }, [onSelectNote]);

  const toggleFolder = (id: number) =>
    setExpandedFolders(p => ({ ...p, [id]: !p[id] }));

  const looseNotes = searchQuery
    ? notes
    : notes.filter(n => !n.folderId);

  return (
    <div className="mt-root">
      {/* Header */}
      <div className="mt-header">
        <button className="mt-back" onClick={onGoBack}>
          <ArrowLeft size={18} />
        </button>
        {showSearch ? (
          <input
            className="mt-search-input"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="メモを検索..."
            autoFocus
            onBlur={() => { if (!searchQuery) setShowSearch(false); }}
          />
        ) : (
          <span className="mt-title">メモ</span>
        )}
        <div className="mt-actions">
          <button className="mt-icon-btn" onClick={() => { setShowSearch(v => !v); if (showSearch) setSearchQuery(''); }}>
            <Search size={18} />
          </button>
          <button className="mt-icon-btn mt-add-btn" onClick={() => void createNote()}>
            <Plus size={18} />
          </button>
        </div>
      </div>

      {/* Tree */}
      <div className="mt-scroll">
        {!searchQuery && folders.map((f, idx) => {
          const folderNotes = notes.filter(n => n.folderId === f.id);
          const expanded = !!expandedFolders[f.id!];
          return (
            <div key={f.id} className="mt-folder-group">
              <button className="mt-folder-row" onClick={() => toggleFolder(f.id!)}>
                <ChevronRight size={15} color="#c7b8be" className={`mt-chev ${expanded ? 'open' : ''}`} />
                <span className="mt-fdot" style={{ background: folderColor(f, idx) }} />
                <span className="mt-fname">{f.name}</span>
                <span className="mt-fcount">{folderNotes.length}</span>
              </button>
              {expanded && (
                <div className="mt-folder-notes">
                  {folderNotes.map(n => (
                    <button key={n.id} className="mt-note-row" onClick={() => onSelectNote(n.id!)}>
                      <FileText size={14} color="#cab9bf" />
                      <span className="mt-note-title">{n.title || '無題のメモ'}</span>
                    </button>
                  ))}
                  <button className="mt-note-row mt-add-note" onClick={() => void createNote(f.id)}>
                    <Plus size={14} color="#ff8da1" />
                    <span>メモを追加</span>
                  </button>
                </div>
              )}
            </div>
          );
        })}

        {looseNotes.length > 0 && !searchQuery && (
          <div className="mt-section-label">フォルダなし</div>
        )}
        {looseNotes.map(n => (
          <button key={n.id} className="mt-loose-row" onClick={() => onSelectNote(n.id!)}>
            <FileText size={15} color="#cab9bf" />
            <span className="mt-note-title">{n.title || '無題のメモ'}</span>
          </button>
        ))}

        {searchQuery && notes.length === 0 && (
          <div className="mt-empty">「{searchQuery}」は見つかりません</div>
        )}
        {!searchQuery && folders.length === 0 && looseNotes.length === 0 && (
          <div className="mt-empty">
            <p>メモはまだありません</p>
            <button className="mt-create-first" onClick={() => void createNote()}>
              <Plus size={16} /> 最初のメモを作る
            </button>
          </div>
        )}
      </div>

      <style jsx>{`
        .mt-root {
          flex: 1;
          display: flex;
          flex-direction: column;
          background: linear-gradient(180deg, #fff6f8 0%, #fdeef4 60%, #eef4fd 100%);
          overflow: hidden;
        }
        .mt-header {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 12px 16px;
          border-bottom: 1px solid #ffe6ec;
          background: rgba(255,255,255,.85);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          flex-shrink: 0;
        }
        .mt-back {
          width: 34px; height: 34px;
          border-radius: 50%;
          border: 1px solid #ffe0e8;
          background: rgba(255,255,255,.8);
          display: flex; align-items: center; justify-content: center;
          cursor: pointer; color: #ff8da1; flex-shrink: 0;
        }
        .mt-title {
          font-family: 'Outfit', sans-serif;
          font-size: 20px;
          font-weight: 800;
          background: linear-gradient(120deg, #ff8da1, #93c5fd);
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
          flex: 1;
        }
        .mt-search-input {
          flex: 1;
          background: rgba(255,240,245,.9);
          border: 1.5px solid #ffe0e8;
          border-radius: 20px;
          padding: 7px 14px;
          font-size: .88rem;
          color: #4a4045;
          outline: none;
          font-family: inherit;
        }
        .mt-search-input:focus { border-color: #ff8da1; }
        .mt-actions { display: flex; gap: 6px; flex-shrink: 0; }
        .mt-icon-btn {
          width: 34px; height: 34px;
          border-radius: 50%;
          border: 1px solid #ffe0e8;
          background: rgba(255,255,255,.8);
          display: flex; align-items: center; justify-content: center;
          cursor: pointer; color: #c7b8be;
        }
        .mt-add-btn { color: #ff8da1; border-color: #ffb6c1; background: rgba(255,240,245,.9); }

        .mt-scroll {
          flex: 1;
          overflow-y: auto;
          padding: 12px 14px;
          -webkit-overflow-scrolling: touch;
        }
        .mt-folder-group { margin-bottom: 4px; }
        .mt-folder-row {
          display: flex; align-items: center; gap: 8px;
          width: 100%; padding: 10px 8px;
          background: none; border: none; cursor: pointer;
          border-radius: 12px; text-align: left;
        }
        .mt-folder-row:active { background: rgba(255,182,193,.12); }
        .mt-chev { transition: transform .15s; flex-shrink: 0; }
        .mt-chev.open { transform: rotate(90deg); }
        .mt-fdot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
        .mt-fname {
          flex: 1; font-size: .9rem; font-weight: 700; color: #4a4045;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .mt-fcount {
          font-size: .72rem; font-weight: 700; color: #c7b3bb;
          background: #fff0f4; padding: 2px 8px; border-radius: 99px;
        }
        .mt-folder-notes {
          margin-left: 20px;
          border-left: 2px solid #ffe6ec;
          padding-left: 10px;
          margin-bottom: 6px;
        }
        .mt-note-row {
          display: flex; align-items: center; gap: 8px;
          width: 100%; padding: 8px 6px;
          background: none; border: none; cursor: pointer;
          border-radius: 10px; text-align: left;
          font-family: inherit;
        }
        .mt-note-row:active { background: rgba(255,182,193,.12); }
        .mt-note-title {
          font-size: .85rem; color: #6b5a61;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
          flex: 1;
        }
        .mt-add-note .mt-note-title, .mt-add-note span {
          color: #ff8da1; font-size: .82rem; font-weight: 600;
        }
        .mt-section-label {
          font-size: .7rem; font-weight: 700; color: #c7b8be;
          letter-spacing: .1em; text-transform: uppercase;
          padding: 10px 8px 4px;
        }
        .mt-loose-row {
          display: flex; align-items: center; gap: 10px;
          width: 100%; padding: 10px 8px;
          background: none; border: none; cursor: pointer;
          border-radius: 12px; text-align: left;
          font-family: inherit;
        }
        .mt-loose-row:active { background: rgba(255,182,193,.12); }
        .mt-empty {
          display: flex; flex-direction: column; align-items: center; gap: 14px;
          padding: 40px 0; color: #c7b8be; font-size: .88rem; text-align: center;
        }
        .mt-create-first {
          display: flex; align-items: center; gap: 6px;
          background: linear-gradient(135deg, #ffb6c1, #ff8da1);
          color: #fff; border: none; border-radius: 20px;
          padding: 10px 20px; font-size: .88rem; font-weight: 700;
          cursor: pointer; font-family: inherit;
        }
      `}</style>
    </div>
  );
}
