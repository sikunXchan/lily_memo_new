'use client';

import { useState, useEffect } from 'react';
import Sidebar from '@/components/Sidebar';
import NoteEditor from '@/components/NoteEditor';
import SettingsModal from '@/components/SettingsModal';
import { Book, Search, Sparkles, Settings as SettingsIcon } from 'lucide-react';

type TabType = 'memos' | 'search' | 'ai' | 'settings';

export default function Home() {
  const [activeNoteId, setActiveNoteId] = useState<number | undefined>();
  const [activeTab, setActiveTab] = useState<TabType>('memos');
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    // Check for mobile
    const checkMobile = () => setIsMobile(window.innerWidth <= 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);

    // Request persistent storage (iOS/Safari)
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().then(persistent => {
        if (persistent) console.log('Storage will not be cleared except by explicit user action.');
        else console.log('Storage may be cleared under storage pressure.');
      });
    }

    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  return (
    <div className={`app-container ${isMobile ? 'mobile-mode' : ''}`}>
      {!isMobile && (
        <Sidebar 
          activeNoteId={activeNoteId} 
          onSelectNote={setActiveNoteId} 
          onOpenSettings={() => setActiveTab('settings')}
          isMobileOpen={false}
          onToggleMobile={() => {}}
        />
      )}

      <main className="main-view">
        {activeNoteId ? (
          <NoteEditor 
            noteId={activeNoteId} 
            onClose={() => setActiveNoteId(undefined)}
          />
        ) : (
          <div className="tab-content">
            {activeTab === 'memos' && isMobile && (
                <Sidebar 
                    activeNoteId={activeNoteId} 
                    onSelectNote={setActiveNoteId} 
                    onOpenSettings={() => setActiveTab('settings')}
                    isMobileOpen={true}
                    onToggleMobile={() => {}}
                />
            )}
            {activeTab === 'search' && (
                <div className="view-placeholder">
                   <Search size={48} />
                   <h2>検索機能</h2>
                   <p>サイドバーの検索機能がここに統合されます（開発中）</p>
                </div>
            )}
            {activeTab === 'ai' && (
                <div className="view-placeholder">
                   <Sparkles size={48} />
                   <h2>AI チャット</h2>
                   <p>Geminiとシームレスに対話できるチャット画面（開発中）</p>
                </div>
            )}
            {activeTab === 'settings' && (
                <SettingsModal onClose={() => { if(!isMobile) setActiveTab('memos'); }} />
            )}
            
            {!isMobile && activeTab === 'memos' && (
                <div className="empty-state">
                    <div className="empty-content">
                    <img src="/logo.png" alt="Lily Memo Logo" className="empty-logo" />
                    <h2>メモを開くか、新しく作成してください</h2>
                    <p>左のサイドバーから整理を始めましょう ✨</p>
                    </div>
                </div>
            )}
          </div>
        )}
      </main>

      {isMobile && (
        <nav className="bottom-nav">
          <button className={`nav-item ${activeTab === 'memos' ? 'active' : ''}`} onClick={() => { setActiveTab('memos'); setActiveNoteId(undefined); }}>
            <Book size={24} />
            <span>メモ</span>
          </button>
          <button className={`nav-item ${activeTab === 'search' ? 'active' : ''}`} onClick={() => { setActiveTab('search'); setActiveNoteId(undefined); }}>
            <Search size={24} />
            <span>検索</span>
          </button>
          <button className={`nav-item ${activeTab === 'ai' ? 'active' : ''}`} onClick={() => { setActiveTab('ai'); setActiveNoteId(undefined); }}>
            <Sparkles size={24} />
            <span>AI分析</span>
          </button>
          <button className={`nav-item ${activeTab === 'settings' ? 'active' : ''}`} onClick={() => { setActiveTab('settings'); setActiveNoteId(undefined); }}>
            <SettingsIcon size={24} />
            <span>設定</span>
          </button>
        </nav>
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
          flex-direction: column;
          position: relative;
        }

        .tab-content {
          flex: 1;
          display: flex;
          flex-direction: column;
        }

        .view-placeholder {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 16px;
          color: var(--primary);
        }

        .view-placeholder p {
          color: #999;
        }

        .empty-state {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          text-align: center;
          background: var(--accent);
          border-radius: var(--radius) 0 0 var(--radius);
        }

        .empty-logo {
          width: 100px;
          opacity: 0.5;
          margin-bottom: 20px;
        }

        .bottom-nav {
          position: fixed;
          bottom: 0;
          left: 0;
          right: 0;
          height: 70px;
          background: rgba(255, 255, 255, 0.85);
          backdrop-filter: blur(20px);
          display: flex;
          border-top: 1px solid var(--border);
          padding-bottom: env(safe-area-inset-bottom);
          z-index: 1000;
        }

        .nav-item {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 4px;
          background: transparent;
          color: #999;
          transition: all 0.2s;
        }

        .nav-item.active {
          color: var(--primary);
        }

        .nav-item span {
          font-size: 0.7rem;
          font-weight: 600;
        }

        @media (max-width: 768px) {
          .main-view {
            padding-bottom: 70px;
          }
          .empty-state {
            display: none;
          }
        }
      `}</style>
    </div>
  );
}
