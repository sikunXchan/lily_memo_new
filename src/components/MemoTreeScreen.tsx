'use client';

import { useState, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ArrowLeft, Plus, Search, ChevronRight, Folder, FileText, FolderPlus, Check, X,
  ScanLine, Loader2,
} from 'lucide-react';
import { db, newSyncId } from '@/lib/db';
import type { Folder as FolderType, Note } from '@/lib/db';
import { transcribeImagesToNote, imageFileToAttachment } from '@/lib/photoNote';
import { useT, translate } from '@/lib/i18n';

interface MemoTreeScreenProps {
  onSelectNote: (id: number) => void;
  onGoBack: () => void;
  onOpenSearch: () => void;
}

export default function MemoTreeScreen({ onSelectNote, onGoBack, onOpenSearch }: MemoTreeScreenProps) {
  const t = useT();
  const [expandedFolders, setExpandedFolders] = useState<Record<number, boolean>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);

  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
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

  // ── 写真から清書 (Photo → clean note) ──
  const scanRef = useRef<HTMLInputElement>(null);
  const [scanning, setScanning] = useState(false);

  const handleScan = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
      .filter(f => f.type.startsWith('image/'))
      .slice(0, 6);
    if (scanRef.current) scanRef.current.value = '';
    if (files.length === 0) return;
    setScanning(true);
    try {
      const atts = await Promise.all(files.map(imageFileToAttachment));
      const id = await transcribeImagesToNote(atts);
      onSelectNote(id);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setScanning(false);
    }
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
          <button className="mt-icon-btn" onClick={() => scanRef.current?.click()} title={t('写真から清書')}>
            <ScanLine size={18} />
          </button>
          <button className="mt-icon-btn mt-add-btn" onClick={() => void createNote()}>
            <Plus size={18} />
          </button>
          <input
            ref={scanRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={e => void handleScan(e)}
          />
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
            <div key={f.id} className="mt-folder-group">
              <button className="mt-folder-row" onClick={() => toggleFolder(f.id!)}>
                <ChevronRight size={15} color="#c7b8be" className={`mt-chev ${expanded ? 'open' : ''}`} />
                <Folder size={16} color="#ffb6c1" />
                <span className="mt-fname">{f.name}</span>
                <span className="mt-fcount">{folderNotes.length}</span>
              </button>
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
          <div className="mt-section-label">{t('フォルダなし')}</div>
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

      {scanning && typeof document !== 'undefined' && createPortal(
        <div className="mt-scan-overlay">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/9D507C9A-09F0-4B05-9F41-612FBD120675.png" alt="Lily" className="mt-scan-img" />
          <Loader2 size={26} className="mt-scan-spin" />
          <p className="mt-scan-title">{t('清書中…')}</p>
          <p className="mt-scan-sub">{t('写真を読み取っているよ')}</p>
        </div>,
        document.body,
      )}

      <style jsx>{`
        .mt-root {
          flex: 1; display: flex; flex-direction: column;
          background: linear-gradient(180deg, #fff6f8 0%, #fdeef4 60%, #eef4fd 100%);
          overflow: hidden;
        }
        .mt-header {
          display: flex; align-items: center; gap: 8px;
          padding: 12px 16px;
          border-bottom: 1px solid #ffe6ec;
          background: rgba(255,255,255,.85);
          backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
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
          -webkit-overflow-scrolling: touch;
        }
        .mt-folder-group { margin-bottom: 2px; }
        .mt-folder-row {
          display: flex; align-items: center; gap: 8px;
          width: 100%; padding: 9px 8px;
          background: none; border: none; cursor: pointer;
          border-radius: 12px; text-align: left;
        }
        .mt-folder-row:active { background: rgba(255,182,193,.12); }
        .mt-chev { transition: transform .15s; flex-shrink: 0; }
        .mt-chev.open { transform: rotate(90deg); }
        .mt-fname {
          flex: 1; font-size: .9rem; font-weight: 700; color: #4a4045;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .mt-fcount {
          font-size: .72rem; font-weight: 700; color: #c7b3bb;
          background: #fff0f4; padding: 2px 8px; border-radius: 99px;
        }
        .mt-folder-notes {
          margin-left: 24px; border-left: 2px solid #ffe6ec;
          padding-left: 10px; margin-bottom: 6px;
        }
        .mt-note-row {
          display: flex; align-items: center; gap: 8px;
          width: 100%; padding: 8px 6px;
          background: none; border: none; cursor: pointer;
          border-radius: 10px; text-align: left; font-family: inherit;
        }
        .mt-note-row:active { background: rgba(255,182,193,.12); }
        .mt-note-title {
          font-size: .85rem; color: #6b5a61;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;
        }
        .mt-add-note span { color: #ff8da1; font-size: .82rem; font-weight: 600; }
        .mt-section-label {
          font-size: .7rem; font-weight: 700; color: #c7b8be;
          letter-spacing: .1em; text-transform: uppercase; padding: 10px 8px 4px;
        }
        .mt-loose-row {
          display: flex; align-items: center; gap: 10px;
          width: 100%; padding: 10px 8px;
          background: none; border: none; cursor: pointer;
          border-radius: 12px; text-align: left; font-family: inherit;
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
        .mt-scan-overlay {
          position: fixed; inset: 0; z-index: 10001;
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          gap: 6px; padding: 24px;
          background: color-mix(in srgb, #fdeef4 90%, transparent);
          backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
          animation: mt-scan-fade .25s ease;
        }
        @keyframes mt-scan-fade { from { opacity: 0; } to { opacity: 1; } }
        .mt-scan-img {
          width: 104px; height: auto;
          animation: mt-scan-float 3s ease-in-out infinite;
          filter: drop-shadow(0 8px 24px rgba(255,141,161,.4));
        }
        @keyframes mt-scan-float { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }
        .mt-scan-spin { color: #ff8da1; margin-top: 8px; animation: mt-scan-rot 1s linear infinite; }
        @keyframes mt-scan-rot { to { transform: rotate(360deg); } }
        .mt-scan-title { font-size: 1.02rem; font-weight: 800; margin: 6px 0 0; color: #ff5c7a; }
        .mt-scan-sub { font-size: .8rem; color: #b08a96; margin: 0; }
      `}</style>
    </div>
  );
}
