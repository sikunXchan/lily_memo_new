'use client';

import { useState, useEffect } from 'react';
import Sidebar from '@/components/Sidebar';
import NoteEditor from '@/components/NoteEditor';
import SettingsModal from '@/components/SettingsModal';
import PDFViewer from '@/components/PDFViewer';
import { Book, Settings as SettingsIcon, FileText } from 'lucide-react';

type TabType = 'memos' | 'pdf' | 'settings';

export default function Home() {
  const [activeNoteId, setActiveNoteId] = useState<number | undefined>();
  const [activeTab, setActiveTab] = useState<TabType>('memos');
  const [isMobile, setIsMobile] = useState(false);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth <= 768);
    const initialize = () => { checkMobile(); setMounted(true); };
    initialize();
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
    }
  }, []);

  if (!mounted) return null;

  const openSettings = () => {
    setActiveTab('settings');
    setActiveNoteId(undefined);
  };

  const openPDF = () => {
    setActiveTab('pdf');
    setActiveNoteId(undefined);
  };

  return (
    <div className={`app-container ${isMobile ? 'mobile-mode' : ''}`}>
      {!isMobile && (
        <Sidebar
          activeNoteId={activeNoteId}
          onSelectNote={setActiveNoteId}
          onOpenSettings={openSettings}
          onOpenPDF={openPDF}
          isMobileOpen={false}
          onToggleMobile={() => {}}
        />
      )}

      <main className="main-view">
        {/* Settings renders as a full-screen overlay on all devices */}
        {activeTab === 'settings' && (
          <div className="settings-overlay">
            <SettingsModal onClose={() => setActiveTab('memos')} />
          </div>
        )}

        {activeTab !== 'settings' && (
          activeNoteId ? (
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
                  onOpenSettings={openSettings}
                  onOpenPDF={openPDF}
                  isMobileOpen={true}
                  onToggleMobile={() => {}}
                />
              )}
              {activeTab === 'pdf' && (
                <PDFViewer />
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
          )
        )}
      </main>

      {isMobile && !isInputFocused && !activeNoteId && (
        <nav className="bottom-nav">
          <button className={`nav-item ${activeTab === 'memos' ? 'active' : ''}`} onClick={() => { setActiveTab('memos'); setActiveNoteId(undefined); }}>
            <Book size={24} />
            <span>メモ</span>
          </button>
          <button className={`nav-item ${activeTab === 'pdf' ? 'active' : ''}`} onClick={() => { setActiveTab('pdf'); setActiveNoteId(undefined); }}>
            <FileText size={24} />
            <span>PDF</span>
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
          overflow: hidden;
        }

        .settings-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          z-index: 2000;
          background: var(--background);
          display: flex;
          flex-direction: column;
        }

        @media (max-width: 768px) {
          .settings-overlay {
            bottom: calc(60px + env(safe-area-inset-bottom));
          }
        }

        .tab-content {
          flex: 1;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          min-height: 0;
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
          z-index: 3000;
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
            padding-bottom: 0;
          }
          .empty-state {
            display: none;
          }
        }
      `}</style>
    </div>
  );
}
