'use client';

import { useState } from 'react';
import Sidebar from '@/components/Sidebar';
import NoteEditor from '@/components/NoteEditor';
import SettingsModal from '@/components/SettingsModal';

export default function Home() {
  const [activeNoteId, setActiveNoteId] = useState<number | undefined>();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  return (
    <div className="app-container">
      <Sidebar 
        activeNoteId={activeNoteId} 
        onSelectNote={setActiveNoteId} 
        onOpenSettings={() => setIsSettingsOpen(true)}
        isMobileOpen={isMobileSidebarOpen}
        onToggleMobile={() => setIsMobileSidebarOpen(!isMobileSidebarOpen)}
      />
      
      <main className="main-view">
        {activeNoteId ? (
          <NoteEditor 
            noteId={activeNoteId} 
            onClose={() => setActiveNoteId(undefined)}
          />
        ) : (
          <div className="empty-state">
            <div className="empty-content">
              <img src="/logo.png" alt="Lily Memo Logo" className="empty-logo" />
              <h2>メモを選択するか、新しく作成してください</h2>
              <p>左のサイドバーから整理を始めましょう ✨</p>
            </div>
          </div>
        )}
      </main>

      {isSettingsOpen && (
        <SettingsModal onClose={() => setIsSettingsOpen(false)} />
      )}

      <style jsx>{`
        .app-container {
          display: flex;
          height: 100vh;
          background: var(--background);
          overflow: hidden;
          position: relative;
        }

        .main-view {
          flex: 1;
          display: flex;
          align-items: stretch;
          justify-content: stretch;
          position: relative;
          transition: margin-left 0.3s;
        }

        .empty-state {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          text-align: center;
          background: var(--accent);
          border-radius: var(--radius) 0 0 var(--radius);
          box-shadow: inset 0 0 40px rgba(0,0,0,0.02);
        }

        @media (max-width: 768px) {
          .empty-state {
            border-radius: 0;
            padding: 20px;
          }
        }

        .empty-content {
          max-width: 400px;
        }

        .empty-logo {
          width: 120px;
          height: 120px;
          margin-bottom: 24px;
          opacity: 0.6;
          filter: grayscale(0.2);
        }

        h2 {
          color: var(--primary);
          margin-bottom: 12px;
          font-size: 1.4rem;
        }

        p {
          color: #999;
          font-size: 0.9rem;
        }
      `}</style>
    </div>
  );
}
