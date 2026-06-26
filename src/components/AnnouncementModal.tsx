'use client';

// First-open announcement / お知らせ modal.
//
// Shown once per browser session when the app opens. A "今日はもう表示しない"
// checkbox suppresses it for the rest of the day (across sessions).
//
// To publish a NEW announcement:
//   1. Edit NEWS_TITLE / NEWS_ITEMS below.
//   2. Bump NEWS_VERSION — this makes the announcement re-appear even for
//      users who had checked "今日はもう表示しない" for the previous one.
// The 注意（CAUTION）section is fixed policy text and normally stays as-is.

import { useEffect, useState } from 'react';

// Bump when publishing a new announcement (any unique string — a date works).
const NEWS_VERSION = '2026-06-26';

// ── Editable announcement content ──────────────────────────────────────────
const NEWS_TITLE = '新機能のお知らせ';
const NEWS_ITEMS: { emoji: string; title: string; body: string }[] = [
  {
    emoji: '✨',
    title: 'Lilyの解説がさらに分かりやすく',
    body: '途中式や理由を省略せず、頭にイメージが浮かぶように説明するよう改善しました。',
  },
  // 新しいお知らせはここに追加してください
];
// ───────────────────────────────────────────────────────────────────────────

// localStorage: "<version>|<YYYY-MM-DD>" set when "今日はもう表示しない" is checked.
const KEY_HIDE = 'lily-news-hide';
// sessionStorage: marks that we've already shown it once this session.
const SESSION_KEY = 'lily-news-shown';

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function AnnouncementModal() {
  const [open, setOpen] = useState(false);
  const [hideToday, setHideToday] = useState(false);

  useEffect(() => {
    if (sessionStorage.getItem(SESSION_KEY)) return;
    if (localStorage.getItem(KEY_HIDE) === `${NEWS_VERSION}|${todayStr()}`) return;
    setOpen(true);
  }, []);

  const dismiss = () => {
    sessionStorage.setItem(SESSION_KEY, '1');
    if (hideToday) localStorage.setItem(KEY_HIDE, `${NEWS_VERSION}|${todayStr()}`);
    setOpen(false);
  };

  if (!open) return null;

  return (
    <div className="am-backdrop" onClick={dismiss} role="dialog" aria-modal="true" aria-label={NEWS_TITLE}>
      <div className="am-card" onClick={(e) => e.stopPropagation()}>
        <div className="am-header">
          <span className="am-badge">📣 お知らせ</span>
        </div>

        <h2 className="am-title">{NEWS_TITLE}</h2>

        <div className="am-items">
          {NEWS_ITEMS.map((item, i) => (
            <div key={i} className="am-item">
              <span className="am-item-emoji">{item.emoji}</span>
              <div className="am-item-text">
                <div className="am-item-title">{item.title}</div>
                <div className="am-item-body">{item.body}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="am-caution">
          <div className="am-caution-head">⚠️ ご利用にあたっての注意</div>
          <ul className="am-caution-list">
            <li>
              通常のチャットや簡単な質問は、<strong>軽量モード</strong>、または他のAI（Gemini・ChatGPT・Claude）サービスのご利用を推奨します。
            </li>
            <li>
              <strong>Freeプラン以上のご利用は、認められたユーザーのみ</strong>利用可能です。
            </li>
          </ul>
        </div>

        <label className="am-checkbox">
          <input
            type="checkbox"
            checked={hideToday}
            onChange={(e) => setHideToday(e.target.checked)}
          />
          <span>今日はもう表示しない</span>
        </label>

        <button className="am-close" onClick={dismiss}>はじめる</button>
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
          width: 100%; max-width: 420px;
          max-height: 86vh; overflow-y: auto;
          background: var(--background, #fffafa);
          color: var(--foreground, #3d3d3d);
          border: 1px solid var(--border, #ffe0e8);
          border-radius: 20px;
          padding: 22px 22px 20px;
          box-shadow: 0 24px 60px rgba(0, 0, 0, 0.28);
          animation: amPop 0.32s cubic-bezier(0.16, 1.3, 0.4, 1) both;
        }
        .am-header { display: flex; justify-content: center; margin-bottom: 12px; }
        .am-badge {
          font-size: 13px; font-weight: 800; letter-spacing: 0.02em;
          color: var(--primary-dark, #ff8da1);
          background: color-mix(in srgb, var(--primary, #ffb6c1) 22%, transparent);
          padding: 5px 14px; border-radius: 999px;
        }
        .am-title {
          margin: 0 0 16px; text-align: center;
          font-size: 19px; font-weight: 800; line-height: 1.4;
          color: var(--foreground, #3d3d3d);
        }
        .am-items { display: flex; flex-direction: column; gap: 12px; margin-bottom: 18px; }
        .am-item {
          display: flex; gap: 11px; align-items: flex-start;
          background: var(--accent, #fff0f5);
          border: 1px solid var(--border, #ffe0e8);
          border-radius: 14px; padding: 12px 13px;
        }
        .am-item-emoji { font-size: 20px; line-height: 1.3; flex-shrink: 0; }
        .am-item-text { min-width: 0; }
        .am-item-title { font-size: 14px; font-weight: 700; margin-bottom: 3px; color: var(--foreground, #3d3d3d); }
        .am-item-body { font-size: 13px; line-height: 1.6; color: color-mix(in srgb, var(--foreground, #3d3d3d) 65%, transparent); }

        .am-caution {
          border: 1px solid color-mix(in srgb, #e8a200 50%, transparent);
          background: color-mix(in srgb, #ffb300 16%, transparent);
          border-radius: 14px; padding: 12px 14px; margin-bottom: 18px;
        }
        .am-caution-head { font-size: 13px; font-weight: 800; color: #e8a200; margin-bottom: 7px; }
        .am-caution-list { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 6px; }
        .am-caution-list li { font-size: 12.5px; line-height: 1.65; color: var(--foreground, #4a4a4a); }
        .am-caution-list strong { color: #e8a200; font-weight: 800; }

        .am-checkbox {
          display: flex; align-items: center; gap: 8px;
          font-size: 13px; color: color-mix(in srgb, var(--foreground, #3d3d3d) 70%, transparent);
          margin-bottom: 16px; cursor: pointer; user-select: none;
        }
        .am-checkbox input { width: 16px; height: 16px; accent-color: var(--primary-dark, #ff8da1); cursor: pointer; }

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
