'use client';

import { useState, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import Sidebar from '@/components/Sidebar';
import { initLiveSync, stopLiveSync } from '@/lib/liveSync';
import { applyAppLang } from '@/lib/appLang';

// Heavy components are loaded only when their tab is opened so the
// initial bundle stays small enough for mobile Safari to parse without
// running out of memory ("This page couldn't load").
const NoteEditor = dynamic(() => import('@/components/NoteEditor'), { ssr: false });
const SettingsModal = dynamic(() => import('@/components/SettingsModal'), { ssr: false });
const SearchModal = dynamic(() => import('@/components/SearchModal'), { ssr: false });
const PDFViewer = dynamic(() => import('@/components/PDFViewer'), { ssr: false });
const HomeHero = dynamic(() => import('@/components/HomeHero'), { ssr: false });
const BubbleHome = dynamic(() => import('@/components/BubbleHome'), { ssr: false });
const BackBubble = dynamic(() => import('@/components/BackBubble'), { ssr: false });
const AIChat = dynamic(() => import('@/components/AIChat'), { ssr: false });
const StudyTracker = dynamic(() => import('@/components/StudyTracker'), { ssr: false });
const InstanceSikun = dynamic(() => import('@/components/InstanceSikun'), { ssr: false });
const FocusMode = dynamic(() => import('@/components/FocusMode'), { ssr: false });
const MemoTreeScreen = dynamic(() => import('@/components/MemoTreeScreen'), { ssr: false });
const NewsScreen = dynamic(() => import('@/components/NewsScreen'), { ssr: false });
const TodoScreen = dynamic(() => import('@/components/TodoScreen'), { ssr: false });
const TrophyRoom = dynamic(() => import('@/components/TrophyRoom'), { ssr: false });
const PracticeScreen = dynamic(() => import('@/components/PracticeScreen'), { ssr: false });
type TabType = 'memos' | 'pdf' | 'settings' | 'ai' | 'study' | 'news' | 'todo' | 'practice';

export default function Home() {
  const [activeNoteId, setActiveNoteId] = useState<number | undefined>();
  const [activeTab, setActiveTab] = useState<TabType>('memos');
  const [showSearch, setShowSearch] = useState(false);
  const [sidebarViewMode, setSidebarViewMode] = useState<'tree' | 'graph'>('tree');
  const [highlightFolderReq, setHighlightFolderReq] = useState<{ id: number; seq: number } | null>(null);
  const highlightSeq = useRef(0);
  const [isMobile, setIsMobile] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [sikunEnabled, setSikunEnabled] = useState(false);
  const [recentNotes, setRecentNotes] = useState<number[]>([]);
  const [showFocusMode, setShowFocusMode] = useState(false);
  const [showTrophy, setShowTrophy] = useState(false);
  // 'bubbles' = BubbleHome, 'notes' = old HomeHero note list
  const [mobilePage, setMobilePage] = useState<'bubbles' | 'notes'>('bubbles');

  useEffect(() => {
    const checkLayout = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const landscape = w > h;
      setIsMobile(landscape ? Math.min(w, h) <= 1024 : w < 1024);
    };
    const initialize = () => { checkLayout(); setMounted(true); };
    initialize();
    window.addEventListener('resize', checkLayout);

    // Apply the saved language/AI mode (English → server-proxied key).
    applyAppLang();
    window.addEventListener('lily-lang-changed', () => applyAppLang());

    const savedViewMode = localStorage.getItem('sidebarViewMode');
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (savedViewMode === 'graph' || savedViewMode === 'tree') setSidebarViewMode(savedViewMode);

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSikunEnabled(localStorage.getItem('lily_instance_sikun_enabled') !== '0');
    const onSettingsChange = () => {
      setSikunEnabled(localStorage.getItem('lily_instance_sikun_enabled') !== '0');
    };
    window.addEventListener('lily-settings-changed', onSettingsChange);

    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist();
    }

    // Live sync
    const applyLiveSync = () => {
      const key     = localStorage.getItem('lily_livesync_key') ?? '';
      const enabled = localStorage.getItem('lily_livesync_enabled') === '1';
      if (key && enabled) initLiveSync(key);
      else stopLiveSync();
    };
    applyLiveSync();
    window.addEventListener('lily-settings-changed', applyLiveSync);

    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }

    return () => {
      window.removeEventListener('resize', checkLayout);
      window.removeEventListener('lily-settings-changed', onSettingsChange);
      window.removeEventListener('lily-settings-changed', applyLiveSync);
      stopLiveSync();
    };
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setShowSearch(s => !s);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    if (activeNoteId === undefined) return;
    setRecentNotes(prev => [activeNoteId, ...prev.filter(id => id !== activeNoteId)].slice(0, 10));
  }, [activeNoteId]);

  if (!mounted) return null;

  const isDesktopLayout = !isMobile;

  const openSettings = () => { setActiveTab('settings'); setActiveNoteId(undefined); };
  const openPDF = () => { setActiveTab('pdf'); setActiveNoteId(undefined); };
  const openAI = () => { setActiveTab('ai'); setActiveNoteId(undefined); };
  const goHome = () => {
    setActiveTab('memos');
    setActiveNoteId(undefined);
    setMobilePage('bubbles');
  };

  const changeSidebarViewMode = (mode: 'tree' | 'graph') => {
    setSidebarViewMode(mode);
    localStorage.setItem('sidebarViewMode', mode);
  };

  const openConnection = () => { changeSidebarViewMode('graph'); };

  const selectFolder = (id: number) => {
    highlightSeq.current += 1;
    setHighlightFolderReq({ id, seq: highlightSeq.current });
  };

  const handleSelectNote = (id: number) => {
    setActiveNoteId(id);
    setActiveTab('memos');
  };

  const handleMobileNavigate = (tab: string) => {
    if (tab === 'trophy') { setShowTrophy(true); return; }
    if (tab === 'memos') { setMobilePage('notes'); setActiveTab('memos'); setActiveNoteId(undefined); return; }
    setActiveTab(tab as TabType);
    setActiveNoteId(undefined);
  };

  // BackBubble: shown on mobile when not on bubble home
  const onBubbleHome = isMobile && activeTab === 'memos' && !activeNoteId && mobilePage === 'bubbles';
  const showBackBubble = isMobile && !showFocusMode && activeTab !== 'ai' && !onBubbleHome;

  return (
    <div className={`app-container ${isMobile ? 'mobile-mode' : ''} ${isDesktopLayout ? 'desktop-sidebar' : ''}`}>
      {showSearch && (
        <SearchModal
          isOpen={showSearch}
          onClose={() => setShowSearch(false)}
          onSelectNote={handleSelectNote}
        />
      )}
      {isDesktopLayout && (
        <Sidebar
          activeNoteId={activeNoteId}
          onSelectNote={(id) => { setActiveNoteId(id); setActiveTab('memos'); }}
          onOpenSettings={openSettings}
          onOpenPDF={openPDF}
          onOpenAI={openAI}
          onOpenSearch={() => setShowSearch(true)}
          isMobileOpen={false}
          onToggleMobile={() => {}}
          onActiveNoteDeleted={() => setActiveNoteId(undefined)}
          viewModeProp={sidebarViewMode}
          onViewModeChangeProp={changeSidebarViewMode}
          highlightFolderReq={highlightFolderReq}
        />
      )}

      <main className="main-view">
        {activeNoteId ? (
          <NoteEditor
            noteId={activeNoteId}
            onClose={() => setActiveNoteId(undefined)}
            onSelectNote={handleSelectNote}
          />
        ) : (
          <>
            {activeTab === 'settings' && (
              <div className={isDesktopLayout ? 'settings-panel' : 'settings-overlay'}>
                <SettingsModal onClose={goHome} />
              </div>
            )}
            {activeTab !== 'settings' && (
              <div className="tab-content">
                {/* Mobile home — bubble cluster */}
                {isMobile && activeTab === 'memos' && mobilePage === 'bubbles' && (
                  <BubbleHome
                    onSelectNote={(id) => setActiveNoteId(id)}
                    onNavigate={handleMobileNavigate}
                  />
                )}
                {/* News screen */}
                {isMobile && activeTab === 'news' && (
                  <NewsScreen onGoBack={goHome} />
                )}
                {/* ToDo screen */}
                {isMobile && activeTab === 'todo' && (
                  <TodoScreen onGoBack={goHome} />
                )}
                {/* Practice / 演習 screen */}
                {isMobile && activeTab === 'practice' && (
                  <PracticeScreen onGoBack={goHome} />
                )}
                {/* Mobile memo tree */}
                {isMobile && activeTab === 'memos' && mobilePage === 'notes' && (
                  <MemoTreeScreen
                    onSelectNote={(id) => setActiveNoteId(id)}
                    onGoBack={goHome}
                    onOpenSearch={() => setShowSearch(true)}
                  />
                )}
                {activeTab === 'pdf' && <PDFViewer />}
                {activeTab === 'ai' && (
                  <AIChat
                    onOpenSettings={openSettings}
                    onSwitchTab={(tab) => { setActiveTab(tab as TabType); setActiveNoteId(undefined); }}
                    onNoteCreated={(id) => { setActiveNoteId(id); setActiveTab('memos'); }}
                  />
                )}
                {activeTab === 'study' && (
                  <StudyTracker
                    onOpenSettings={openSettings}
                    onSwitchTab={(tab) => { setActiveTab(tab as TabType); setActiveNoteId(undefined); }}
                    onOpenFocus={() => setShowFocusMode(true)}
                  />
                )}
                {/* Desktop — Hero in main content area */}
                {isDesktopLayout && activeTab === 'memos' && (
                  <HomeHero
                    onSelectNote={(id) => { setActiveNoteId(id); setActiveTab('memos'); }}
                    onOpenConnection={openConnection}
                    onSelectFolder={selectFolder}
                    isDesktop={true}
                  />
                )}
              </div>
            )}
          </>
        )}
      </main>

      {showFocusMode && (
        <FocusMode onClose={() => setShowFocusMode(false)} />
      )}

      {showTrophy && (
        <TrophyRoom onClose={() => setShowTrophy(false)} />
      )}

      {sikunEnabled && !showFocusMode && (
        <InstanceSikun
          activeNoteId={activeNoteId}
          prevNoteId={recentNotes.find(id => id !== activeNoteId)}
          onOpenNote={(id) => { setActiveNoteId(id); setActiveTab('memos'); }}
          isPdfTab={activeTab === 'pdf' && !activeNoteId}
        />
      )}

      {showBackBubble && <BackBubble onGoHome={goHome} />}

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
      `}</style>
    </div>
  );
}
