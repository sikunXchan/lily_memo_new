'use client';

import { useState, useEffect } from 'react';
import Sidebar from '@/components/Sidebar';
import NoteEditor from '@/components/NoteEditor';
import SettingsModal from '@/components/SettingsModal';
import { Book, Search, Sparkles, Settings as SettingsIcon } from 'lucide-react';

type TabType = 'memos' | 'ai' | 'settings';

export default function Home() {
  const [activeNoteId, setActiveNoteId] = useState<number | undefined>();
  const [activeTab, setActiveTab] = useState<TabType>('memos');
  const [isMobile, setIsMobile] = useState(false);
  const [isInputFocused, setIsInputFocused] = useState(false);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth <= 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    
    const handleFocus = (e: FocusEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        setIsInputFocused(true);
      }
    };
    const handleBlur = () => setIsInputFocused(false);
    
    window.addEventListener('focusin', handleFocus);
    window.addEventListener('focusout', handleBlur);

    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist();
    }
    return () => {
      window.removeEventListener('resize', checkMobile);
      window.removeEventListener('focusin', handleFocus);
      window.removeEventListener('focusout', handleBlur);
    };
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
            {isMobile && activeTab === 'memos' && (
                <Sidebar
                    activeNoteId={activeNoteId}
                    onSelectNote={setActiveNoteId}
                    onOpenSettings={() => setActiveTab('settings')}
                    isMobileOpen={true}
                    onToggleMobile={() => {}}
                />
            )}
            {activeTab === 'ai' && (
                <div className="view-placeholder">
                   <Sparkles size={48} />
                   <h2>AI 分析・相談</h2>
                   <p>ノートの内容に基づいた高度な分析・図解作成（開発中）</p>
                </div>
            )}
            {activeTab === 'settings' && (
                <SettingsModal onClose={() => setActiveTab('memos')} />
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

      {isMobile && !isInputFocused && (
        <nav className="bottom-nav">
          <button className={`nav-item ${activeTab === 'memos' ? 'active' : ''}`} onClick={() => { setActiveTab('memos'); setActiveNoteId(undefined); }}>
            <Book size={24} />
            <span>メモ</span>
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
          height: 100dvh;
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
          height: calc(60px + env(safe-area-inset-bottom));
          background: rgba(255, 255, 255, 0.9);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          display: flex;
          border-top: 1px solid var(--border);
          padding-bottom: env(safe-area-inset-bottom);
          z-index: 1000;
        }
        :global([data-theme='dark']) .bottom-nav {
          background: rgba(26, 26, 26, 0.92);
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
            padding-bottom: calc(60px + env(safe-area-inset-bottom));
          }
          .empty-state {
            display: none;
          }
        }
      `}</style>
    </div>
  );
}
