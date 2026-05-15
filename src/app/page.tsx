'use client';

import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import Sidebar from '@/components/Sidebar';
import { Book, Settings as SettingsIcon, FileText, Brush } from 'lucide-react';

// Heavy components are loaded only when their tab is opened so the
// initial bundle stays small enough for mobile Safari to parse without
// running out of memory ("This page couldn't load").
const NoteEditor = dynamic(() => import('@/components/NoteEditor'), { ssr: false });
const SettingsModal = dynamic(() => import('@/components/SettingsModal'), { ssr: false });
const PDFViewer = dynamic(() => import('@/components/PDFViewer'), { ssr: false });
const SketchTab = dynamic(() => import('@/components/SketchTab'), { ssr: false });

type TabType = 'memos' | 'pdf' | 'sketch' | 'settings';

export default function Home() {
  const [activeNoteId, setActiveNoteId] = useState<number | undefined>();
  const [activeTab, setActiveTab] = useState<TabType>('memos');
  const [isMobile, setIsMobile] = useState(false);
  const [isLandscape, setIsLandscape] = useState(false);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const checkLayout = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const landscape = w > h;
      // Portrait: treat up to 1023px as mobile (covers iPad Air/Pro portrait)
      // Landscape: use min-dimension (height) to distinguish phones from tablets/desktops
      setIsMobile(landscape ? Math.min(w, h) <= 768 : w < 1024);
      setIsLandscape(landscape);
    };
    const initialize = () => { checkLayout(); setMounted(true); };
    initialize();
    window.addEventListener('resize', checkLayout);

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

    // Register the offline service worker. Memos/folders/handwriting
    // already live in IndexedDB; the SW just caches the HTML/JS/CSS
    // shell so cold loads work without a network connection.
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }

    return () => {
      window.removeEventListener('resize', checkLayout);
      window.removeEventListener('focusin', handleFocus);
      window.removeEventListener('focusout', handleBlur);
    }
  }, []);

  if (!mounted) return null;

  const isDesktopLayout = !isMobile || (isLandscape && !activeNoteId);

  const openSettings = () => {
    setActiveTab('settings');
    setActiveNoteId(undefined);
  };

  const openPDF = () => {
    setActiveTab('pdf');
    setActiveNoteId(undefined);
  };

  const openSketch = () => {
    setActiveTab('sketch');
    setActiveNoteId(undefined);
  };

  return (
    <div className={`app-container ${isMobile && !isLandscape ? 'mobile-mode' : ''} ${isLandscape && isDesktopLayout ? 'landscape-mode' : ''} ${isDesktopLayout ? 'desktop-sidebar' : ''} ${isMobile && isLandscape && !!activeNoteId ? 'mobile-landscape-note' : ''} ${activeTab === 'sketch' ? 'sketch-mode' : ''}`}>
      {isDesktopLayout && activeTab !== 'sketch' && (
        <Sidebar
          activeNoteId={activeNoteId}
          onSelectNote={(id) => { setActiveNoteId(id); setActiveTab('memos'); }}
          onOpenSettings={openSettings}
          onOpenPDF={openPDF}
          onOpenSketch={openSketch}
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
          <>
            {activeTab === 'settings' && (
              <div className={isDesktopLayout ? 'settings-panel' : 'settings-overlay'}>
                <SettingsModal onClose={() => setActiveTab('memos')} />
              </div>
            )}
            {activeTab !== 'settings' && (
              <div className="tab-content">
                {isMobile && !isLandscape && activeTab === 'memos' && (
                  <Sidebar
                    activeNoteId={activeNoteId}
                    onSelectNote={setActiveNoteId}
                    onOpenSettings={openSettings}
                    onOpenPDF={openPDF}
                    onOpenSketch={openSketch}
                    isMobileOpen={true}
                    onToggleMobile={() => {}}
                  />
                )}
                {activeTab === 'pdf' && (
                  <PDFViewer />
                )}
                {activeTab === 'sketch' && (
                  <SketchTab onClose={() => setActiveTab('memos')} />
                )}
                {isDesktopLayout && activeTab === 'memos' && (
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
          </>
        )}
      </main>

      {isMobile && !isLandscape && !isInputFocused && !activeNoteId && (
        <nav className="bottom-nav">
          <button className={`nav-item ${activeTab === 'memos' ? 'active' : ''}`} onClick={() => { setActiveTab('memos'); setActiveNoteId(undefined); }}>
            <Book size={24} />
            <span>メモ</span>
          </button>
          <button className={`nav-item ${activeTab === 'sketch' ? 'active' : ''}`} onClick={() => { setActiveTab('sketch'); setActiveNoteId(undefined); }}>
            <Brush size={24} />
            <span>落書き</span>
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
          bottom: calc(60px + env(safe-area-inset-bottom));
          z-index: 2000;
          background: var(--background);
          display: flex;
          flex-direction: column;
        }

        .settings-panel {
          flex: 1;
          display: flex;
          flex-direction: column;
          overflow: hidden;
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
        /* Sketch tab is a full-screen overlay — hide bottom nav so the
           sketch toolbar isn't covered. */
        .app-container.sketch-mode .bottom-nav {
          display: none;
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

        @media (max-width: 1023px) and (orientation: portrait) {
          .empty-state {
            display: none;
          }
        }
      `}</style>
    </div>
  );
}
