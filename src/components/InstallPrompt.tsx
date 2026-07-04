'use client';

// PWA インストール導線。
//   - Chrome/Edge/Android: beforeinstallprompt を捕まえて「インストール」ボタンを出す。
//   - iOS Safari: beforeinstallprompt が来ないので「共有 → ホーム画面に追加」を案内。
//   - すでにインストール済み(standalone)なら何も出さない。
// 「あとで」で14日間は非表示（しつこくしない）。

import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const KEY_DISMISS = 'lily-install-dismissed'; // stores an ISO date
const SNOOZE_DAYS = 14;

function isStandalone(): boolean {
  if (typeof window === 'undefined') return true;
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    // iOS Safari
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  const iOS = /iPad|iPhone|iPod/.test(ua);
  // iPadOS 13+ reports as Mac; detect via touch.
  const iPadOS = navigator.platform === 'MacIntel' && (navigator.maxTouchPoints ?? 0) > 1;
  return iOS || iPadOS;
}

function snoozed(): boolean {
  try {
    const raw = localStorage.getItem(KEY_DISMISS);
    if (!raw) return false;
    const then = new Date(raw).getTime();
    return Date.now() - then < SNOOZE_DAYS * 86400000;
  } catch {
    return false;
  }
}

export default function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const [iosHint, setIosHint] = useState(false);

  useEffect(() => {
    if (isStandalone() || snoozed()) return;

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setVisible(true);
    };
    const onInstalled = () => {
      setVisible(false);
      setDeferred(null);
      try { localStorage.setItem(KEY_DISMISS, new Date(Date.now() + 365 * 86400000).toISOString()); } catch {}
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);

    // iOS never fires beforeinstallprompt — show the manual hint instead,
    // after a short delay so it doesn't collide with the first-open news modal.
    let iosTimer: ReturnType<typeof setTimeout> | null = null;
    if (isIOS()) {
      iosTimer = setTimeout(() => { setIosHint(true); setVisible(true); }, 2500);
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
      if (iosTimer) clearTimeout(iosTimer);
    };
  }, []);

  const dismiss = () => {
    setVisible(false);
    try { localStorage.setItem(KEY_DISMISS, new Date().toISOString()); } catch {}
  };

  const install = async () => {
    if (!deferred) return;
    try {
      await deferred.prompt();
      await deferred.userChoice;
    } catch { /* ignore */ }
    setDeferred(null);
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div className="ip-wrap" role="dialog" aria-label="アプリのインストール">
      <div className="ip-card">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="Lily Memo" className="ip-icon" />
        <div className="ip-text">
          <div className="ip-title">アプリとして追加しよう 📲</div>
          {iosHint ? (
            <div className="ip-sub">Safari下の「共有」→「ホーム画面に追加」でアプリのように使えます。</div>
          ) : (
            <div className="ip-sub">ホーム画面から一瞬で起動。オフラインでもメモを開けます。</div>
          )}
        </div>
        {!iosHint && (
          <button className="ip-install" onClick={() => void install()}>インストール</button>
        )}
        <button className="ip-close" onClick={dismiss} aria-label="あとで">✕</button>
      </div>

      <style jsx>{`
        .ip-wrap {
          position: fixed; left: 0; right: 0; bottom: 0; z-index: 99990;
          display: flex; justify-content: center; padding: 12px;
          pointer-events: none;
          animation: ipUp 0.35s cubic-bezier(0.16, 1.2, 0.4, 1) both;
        }
        .ip-card {
          pointer-events: auto;
          display: flex; align-items: center; gap: 12px;
          width: 100%; max-width: 460px;
          padding: 11px 12px 11px 14px;
          background: var(--background, #fffafa);
          border: 1px solid var(--border, #ffe0e8);
          border-radius: 16px;
          box-shadow: 0 12px 34px rgba(0, 0, 0, 0.22);
        }
        .ip-icon { width: 40px; height: 40px; border-radius: 10px; flex-shrink: 0; object-fit: cover; }
        .ip-text { flex: 1; min-width: 0; }
        .ip-title { font-size: 0.9rem; font-weight: 800; color: var(--foreground, #3d3d3d); }
        .ip-sub { font-size: 0.76rem; line-height: 1.5; color: color-mix(in srgb, var(--foreground, #3d3d3d) 62%, transparent); margin-top: 1px; }
        .ip-install {
          flex-shrink: 0; border: none; cursor: pointer;
          background: var(--primary-dark, #ff8da1); color: #fff;
          font-size: 0.82rem; font-weight: 800; padding: 8px 15px; border-radius: 999px;
          transition: filter 0.14s;
        }
        .ip-install:hover { filter: brightness(1.06); }
        .ip-close {
          flex-shrink: 0; border: none; background: transparent; cursor: pointer;
          color: var(--fg-muted, #9aa); font-size: 0.9rem; padding: 4px 6px; border-radius: 8px;
        }
        .ip-close:hover { background: var(--accent, #fff0f5); color: var(--foreground, #555); }
        @keyframes ipUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        @media (prefers-reduced-motion: reduce) { .ip-wrap { animation: none; } }
      `}</style>
    </div>
  );
}
