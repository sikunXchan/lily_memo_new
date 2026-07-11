'use client';

// First-ever-open modal — shows a one-time "Lily Memoへようこそ" welcome
// screen on the very first app launch. It never appears again afterwards.

import { useEffect, useState } from 'react';

const KEY_FIRST_RUN = 'lily-first-run'; // set on the very first app open

export default function AnnouncementModal() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem(KEY_FIRST_RUN)) {
      try { localStorage.setItem(KEY_FIRST_RUN, '1'); } catch {}
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpen(true);
    }
  }, []);

  if (!open) return null;

  return (
    <div className="am-backdrop" role="dialog" aria-modal="true" aria-label="ようこそ">
      <div className="am-card">
        <span className="am-welcome-emoji">🐶</span>
        <h2 className="am-welcome-title">Lily Memoへようこそ</h2>
        <p className="am-welcome-body">
          メモ・学習記録・AIアシスタントが1つになった勉強アプリです。さっそく使ってみましょう。
        </p>
        <button className="am-close" onClick={() => setOpen(false)}>はじめる</button>
      </div>

      <style jsx>{`
        .am-backdrop {
          position: fixed; inset: 0; z-index: 100000;
          display: flex; align-items: center; justify-content: center;
          padding: 20px;
          background: rgba(0, 0, 0, 0.45);
          backdrop-filter: blur(3px);
          animation: amFade 0.25s ease both;
        }
        .am-card {
          width: 100%; max-width: 380px;
          background: var(--background, #fffafa);
          color: var(--foreground, #3d3d3d);
          border: 1px solid var(--border, #ffe0e8);
          border-radius: 20px;
          padding: 32px 26px 26px;
          text-align: center;
          box-shadow: 0 24px 60px rgba(0, 0, 0, 0.28);
          animation: amPop 0.32s cubic-bezier(0.16, 1.3, 0.4, 1) both;
        }
        .am-welcome-emoji { font-size: 52px; line-height: 1; display: block; margin-bottom: 14px; }
        .am-welcome-title {
          font-size: 22px; font-weight: 900; margin: 0 0 12px;
          color: var(--foreground, #3d3d3d);
        }
        .am-welcome-body {
          font-size: 14px; line-height: 1.7;
          color: color-mix(in srgb, var(--foreground, #3d3d3d) 70%, transparent);
          margin: 0 0 24px;
        }

        .am-close {
          width: 100%; border: none; cursor: pointer;
          background: var(--primary-dark, #ff8da1); color: var(--primary-foreground, #fff);
          font-size: 15px; font-weight: 800; letter-spacing: 0.03em;
          padding: 13px; border-radius: 14px;
          transition: filter 0.15s ease, transform 0.1s ease;
        }
        .am-close:hover { filter: brightness(1.05); }
        .am-close:active { transform: scale(0.98); }

        @keyframes amFade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes amPop {
          from { opacity: 0; transform: translateY(14px) scale(0.96); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        @media (prefers-reduced-motion: reduce) {
          .am-backdrop, .am-card { animation: none; }
        }
      `}</style>
    </div>
  );
}
