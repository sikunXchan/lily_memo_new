'use client';

import { useState } from 'react';
import Sidebar from '@/components/Sidebar';
import NoteEditor from '@/components/NoteEditor';

export default function Home() {
  const [activeNoteId, setActiveNoteId] = useState<number | undefined>();

  return (
    <div className="app-container">
      <Sidebar 
        activeNoteId={activeNoteId} 
        onSelectNote={setActiveNoteId} 
      />
      
      <main className="main-view">
        {activeNoteId ? (
          <NoteEditor noteId={activeNoteId} />
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

      <style jsx>{`
        .app-container {
          display: flex;
          height: 100vh;
          background: var(--background);
          overflow: hidden;
        }

        .main-view {
          flex: 1;
          display: flex;
          align-items: stretch;
          justify-content: stretch;
          position: relative;
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
        }

        p {
          color: #999;
        }
      `}</style>
    </div>
  );
}
