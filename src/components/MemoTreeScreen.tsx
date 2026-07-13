'use client';

import { useState, useCallback, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ArrowLeft, Plus, Search, ChevronRight, Folder, FileText, FolderPlus, Check, X, Pencil,
} from 'lucide-react';
import { db, newSyncId } from '@/lib/db';
import type { Folder as FolderType, Note } from '@/lib/db';
import { useT, translate } from '@/lib/i18n';
import { useCharacterSkin, AmbientOverlay } from './CharacterSkinContext';

interface MemoTreeScreenProps {
  onSelectNote: (id: number) => void;
  onGoBack: () => void;
  onOpenSearch: () => void;
}

export default function MemoTreeScreen({ onSelectNote, onGoBack, onOpenSearch }: MemoTreeScreenProps) {
  const t = useT();
  const { homeBackgroundSrc } = useCharacterSkin();
  const [expandedFolders, setExpandedFolders] = useState<Record<number, boolean>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);

  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [renamingFolder, setRenamingFolder] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const nameInputRef = useRef<HTMLInputElement>(null);

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
      syncId: newSyncId(), title: translate('無題のメモ'), content: '',
      folderId, type: 'text', createdAt: t, updatedAt: t,
    });
    onSelectNote(id as number);
  }, [onSelectNote]);

  const createFolder = useCallback(async () => {
    const name = newFolderName.trim();
    if (!name) return;
    const t = Date.now();
    await db.folders.add({ syncId: newSyncId(), name, createdAt: t, updatedAt: t });
    setNewFolderName('');
    setShowNewFolder(false);
  }, [newFolderName]);

  const toggleFolder = (id: number) =>
    setExpandedFolders(p => ({ ...p, [id]: !p[id] }));

  const startRenameFolder = (id: number, current: string) => {
    setRenamingFolder(id);
    setRenameValue(current);
  };

  const commitRenameFolder = useCallback(async () => {
    if (renamingFolder == null) return;
    const name = renameValue.trim();
    if (name) await db.folders.update(renamingFolder, { name, updatedAt: Date.now() });
    setRenamingFolder(null);
    setRenameValue('');
  }, [renamingFolder, renameValue]);

  const openNewFolder = () => {
    setShowNewFolder(true);
    setTimeout(() => nameInputRef.current?.focus(), 50);
  };

  const cancelNewFolder = () => {
    setShowNewFolder(false);
    setNewFolderName('');
  };

  const looseNotes = searchQuery
    ? notes
    : notes.filter(n => !n.folderId);

  return (
    <div
      className={`mt-root${homeBackgroundSrc ? ' has-skin-bg' : ''}`}
      style={homeBackgroundSrc
        ? { backgroundImage: `url(${homeBackgroundSrc})`, backgroundSize: 'cover', backgroundPosition: 'center', position: 'relative' }
        : undefined}
    >
      <AmbientOverlay />
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
            placeholder={t('メモを検索...')}
            autoFocus
            onBlur={() => { if (!searchQuery) setShowSearch(false); }}
          />
        ) : (
          <span className="mt-title">{t('メモ')}</span>
        )}
        <div className="mt-actions">
          <button className="mt-icon-btn" onClick={() => { setShowSearch(v => !v); if (showSearch) setSearchQuery(''); }}>
            <Search size={18} />
          </button>
          <button className="mt-icon-btn" onClick={openNewFolder} title={t('フォルダを追加')}>
            <FolderPlus size={18} />
          </button>
          <button className="mt-icon-btn mt-add-btn" onClick={() => void createNote()}>
            <Plus size={18} />
          </button>
        </div>
      </div>

      {/* New folder form */}
      {showNewFolder && (
        <div className="mt-new-folder-form">
          <input
            ref={nameInputRef}
            className="mt-new-folder-input"
            value={newFolderName}
            onChange={e => setNewFolderName(e.target.value)}
            placeholder={t('フォルダ名...')}
            onKeyDown={e => { if (e.key === 'Enter') void createFolder(); if (e.key === 'Escape') cancelNewFolder(); }}
          />
          <button className="mt-confirm-btn" onClick={() => void createFolder()} disabled={!newFolderName.trim()}>
            <Check size={16} />
          </button>
          <button className="mt-cancel-btn" onClick={cancelNewFolder}>
            <X size={16} />
          </button>
        </div>
      )}

      {/* Tree */}
      <div className="mt-scroll">
        {!searchQuery && folders.map((f) => {
          const folderNotes = notes.filter(n => n.folderId === f.id);
          const expanded = !!expandedFolders[f.id!];
          return (
            <div key={f.id} className="mt-folder-card">
              {renamingFolder === f.id ? (
                <div className="mt-folder-row mt-folder-rename">
                  <Folder size={16} color="#ffb6c1" />
                  <input
                    className="mt-rename-input"
                    value={renameValue}
                    autoFocus
                    onChange={e => setRenameValue(e.target.value)}
                    onBlur={() => void commitRenameFolder()}
                    onKeyDown={e => {
                      if (e.key === 'Enter') { e.preventDefault(); void commitRenameFolder(); }
                      if (e.key === 'Escape') { setRenamingFolder(null); setRenameValue(''); }
                    }}
                  />
                  <button className="mt-rename-ok" onMouseDown={e => e.preventDefault()} onClick={() => void commitRenameFolder()} title={t('保存')}>
                    <Check size={16} />
                  </button>
                </div>
              ) : (
                <button className="mt-folder-row" onClick={() => toggleFolder(f.id!)}>
                  <ChevronRight size={15} color="#c7b8be" className={`mt-chev ${expanded ? 'open' : ''}`} />
                  <Folder size={16} color="#ffb6c1" />
                  <span className="mt-fname">{f.name}</span>
                  <button
                    className="mt-frename-btn"
                    onClick={e => { e.stopPropagation(); startRenameFolder(f.id!, f.name); }}
                    title={t('名前を変更')}
                  >
                    <Pencil size={14} color="#c7b8be" />
                  </button>
                  <span className="mt-fcount">{folderNotes.length}</span>
                </button>
              )}
              {expanded && (
                <div className="mt-folder-notes">
                  {folderNotes.map(n => (
                    <button key={n.id} className="mt-note-row" onClick={() => onSelectNote(n.id!)}>
                      <FileText size={14} color="#cab9bf" />
                      <span className="mt-note-title">{n.title || t('無題のメモ')}</span>
                    </button>
                  ))}
                  <button className="mt-note-row mt-add-note" onClick={() => void createNote(f.id)}>
                    <Plus size={14} color="#ff8da1" />
                    <span>{t('メモを追加')}</span>
                  </button>
                </div>
              )}
            </div>
          );
        })}

        {looseNotes.length > 0 && !searchQuery && (
          <span className="mt-section-label">{t('フォルダなし')}</span>
        )}
        {looseNotes.map(n => (
          <button key={n.id} className="mt-loose-row" onClick={() => onSelectNote(n.id!)}>
            <FileText size={15} color="#cab9bf" />
            <span className="mt-note-title">{n.title || t('無題のメモ')}</span>
          </button>
        ))}

        {searchQuery && notes.length === 0 && (
          <div className="mt-empty">{t('「{q}」は見つかりません', { q: searchQuery })}</div>
        )}
        {!searchQuery && folders.length === 0 && looseNotes.length === 0 && (
          <div className="mt-empty">
            <p>{t('メモはまだありません')}</p>
            <button className="mt-create-first" onClick={() => void createNote()}>
              <Plus size={16} /> {t('最初のメモを作る')}
            </button>
          </div>
        )}
      </div>

      <style jsx>{`
        .mt-root {
          flex: 1; display: flex; flex-direction: column;
          background: linear-gradient(180deg, #fff6f8 0%, #fdeef4 60%, #eef4fd 100%);
          overflow: hidden;
        }
        .mt-header {
          display: flex; align-items: center; gap: 8px;
          padding: 12px 16px;
          background: rgba(255,253,246,.72);
          backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
          flex-shrink: 0;
        }
        .mt-back {
          width: 34px; height: 34px; border-radius: 50%;
          border: 1px solid #ffe0e8; background: rgba(255,255,255,.8);
          display: flex; align-items: center; justify-content: center;
          cursor: pointer; color: #ff8da1; flex-shrink: 0;
        }
        .mt-title {
          font-family: 'Outfit', sans-serif; font-size: 20px; font-weight: 800;
          background: linear-gradient(120deg, #ff8da1, #93c5fd);
          -webkit-background-clip: text; background-clip: text; color: transparent;
          flex: 1;
        }
        .mt-search-input {
          flex: 1; background: rgba(255,240,245,.9); border: 1.5px solid #ffe0e8;
          border-radius: 20px; padding: 7px 14px; font-size: .88rem;
          color: #4a4045; outline: none; font-family: inherit;
        }
        .mt-search-input:focus { border-color: #ff8da1; }
        .mt-actions { display: flex; gap: 5px; flex-shrink: 0; }
        .mt-icon-btn {
          width: 34px; height: 34px; border-radius: 50%;
          border: 1px solid #ffe0e8; background: rgba(255,255,255,.8);
          display: flex; align-items: center; justify-content: center;
          cursor: pointer; color: #c7b8be;
        }
        .mt-add-btn { color: #ff8da1; border-color: #ffb6c1; background: rgba(255,240,245,.9); }

        .mt-new-folder-form {
          display: flex; align-items: center; gap: 8px;
          padding: 10px 14px;
          background: rgba(255,255,255,.9);
          border-bottom: 1px solid #ffe6ec;
          flex-shrink: 0;
        }
        .mt-new-folder-input {
          flex: 1; background: rgba(255,240,245,.9); border: 1.5px solid #ffe0e8;
          border-radius: 20px; padding: 8px 14px; font-size: .9rem;
          color: #4a4045; outline: none; font-family: inherit;
        }
        .mt-new-folder-input:focus { border-color: #ff8da1; }
        .mt-confirm-btn {
          width: 34px; height: 34px; border-radius: 50%; border: none;
          background: linear-gradient(135deg, #ffb6c1, #ff8da1); color: #fff;
          display: flex; align-items: center; justify-content: center;
          cursor: pointer; flex-shrink: 0;
        }
        .mt-confirm-btn:disabled { opacity: .4; cursor: default; }
        .mt-cancel-btn {
          width: 34px; height: 34px; border-radius: 50%;
          border: 1px solid #ffe0e8; background: rgba(255,255,255,.8); color: #c7b8be;
          display: flex; align-items: center; justify-content: center;
          cursor: pointer; flex-shrink: 0;
        }

        .mt-scroll {
          flex: 1; overflow-y: auto; padding: 12px 14px;
          display: flex; flex-direction: column; gap: 10px;
          -webkit-overflow-scrolling: touch;
        }
        .mt-folder-card {
          background: rgba(255,253,246,.86);
          backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
          border-radius: 15px; box-shadow: 0 3px 14px rgba(30,35,25,.1);
          overflow: hidden;
          /* .mt-scroll is a column flex container, so without this a card
             with many notes (its content taller than the scroll viewport)
             gets flex-shrunk to fit instead of the list scrolling — the
             overflow:hidden above then silently clips the bottom rows
             (including "メモを追加") instead of them ever appearing. */
          flex-shrink: 0;
        }
        .mt-folder-row {
          display: flex; align-items: center; gap: 8px;
          width: 100%; padding: 12px 14px;
          background: none; border: none; cursor: pointer;
          text-align: left;
        }
        .mt-folder-row:active { background: rgba(255,182,193,.14); }
        .mt-chev { transition: transform .15s; flex-shrink: 0; }
        .mt-chev.open { transform: rotate(90deg); }
        .mt-fname {
          flex: 1; font-size: .9rem; font-weight: 700; color: #2c2620;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .mt-fcount {
          font-size: .72rem; font-weight: 700; color: #a08a72;
          background: #f1ece1; padding: 2px 8px; border-radius: 99px;
        }
        .mt-frename-btn {
          display: flex; align-items: center; justify-content: center;
          background: none; border: none; cursor: pointer;
          padding: 4px; border-radius: 6px; flex-shrink: 0;
        }
        .mt-frename-btn:active { background: rgba(255,182,193,.2); }
        .mt-folder-rename {
          gap: 8px; padding: 8px 14px;
        }
        .mt-rename-input {
          flex: 1; min-width: 0; font-size: .9rem; font-weight: 700;
          font-family: inherit; color: #2c2620;
          background: #fff; border: 1.5px solid #ff8da1; border-radius: 8px;
          padding: 6px 10px; outline: none;
        }
        .mt-rename-ok {
          display: flex; align-items: center; justify-content: center;
          background: #ff8da1; color: #fff; border: none; cursor: pointer;
          width: 32px; height: 32px; border-radius: 8px; flex-shrink: 0;
        }
        .mt-folder-notes {
          padding: 0 14px 10px 40px;
          display: flex; flex-direction: column; gap: 2px;
        }
        .mt-note-row {
          display: flex; align-items: center; gap: 8px;
          width: 100%; padding: 7px 0;
          background: none; border: none; cursor: pointer;
          text-align: left; font-family: inherit;
        }
        .mt-note-title {
          font-size: .85rem; color: #52483f;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;
        }
        .mt-add-note span { color: #ff8da1; font-size: .82rem; font-weight: 600; }
        .mt-section-label {
          font-size: .68rem; font-weight: 700; color: #fff;
          letter-spacing: .08em; text-transform: uppercase;
          background: rgba(30,30,25,.32);
          backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
          display: inline-block; padding: 5px 11px; border-radius: 999px;
          align-self: flex-start; margin-top: 2px;
          flex-shrink: 0;
        }
        .mt-loose-row {
          display: flex; align-items: center; gap: 10px;
          width: 100%; padding: 10px 13px;
          background: rgba(255,253,246,.86);
          backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
          border: none; cursor: pointer;
          border-radius: 13px; text-align: left; font-family: inherit;
          box-shadow: 0 2px 10px rgba(30,35,25,.08);
          flex-shrink: 0;
        }
        .mt-loose-row:active { background: rgba(255,253,246,.7); }
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
