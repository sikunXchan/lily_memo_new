'use client';

// First-open modal — two modes:
//   • NOTICE set  → important notice (⚠️). Bump NOTICE_VERSION to re-show.
//   • NOTICE null → today's rotating tip (💡). Auto-rotates daily; no bump needed.
//
// "今日はもう表示しない" suppresses for the rest of the day.
// The caution section is fixed policy text and normally stays as-is.

import { useEffect, useState } from 'react';

// ── Important notice ─────────────────────────────────────────────────────────
// Set NOTICE to show a notice; set to null to fall back to daily tips.
// Bump NOTICE_VERSION when publishing a new notice so it re-appears for users
// who had already dismissed the previous one.
const NOTICE_VERSION = '2026-07-10-maintenance';
const NOTICE: { emoji: string; title: string; body: string } | null = {
  emoji: '🚧',
  title: '大型メンテナンスのお知らせ',
  body: '7月10日〜20日の間、大型メンテナンスを実施します。この期間中はサービスが一時停止または不安定になる場合があります。',
};

// ── Daily tips (add / edit freely — rotates automatically each day) ──────────
const TIPS: { emoji: string; title: string; body: string }[] = [
  {
    emoji: '⌨️',
    title: 'キーボードショートカット',
    body: 'Ctrl+K（Mac: ⌘K）でメモを素早く検索できます。',
  },
  {
    emoji: '⚡',
    title: 'ポイントを節約しよう',
    body: '簡単な質問は「軽量」モードを選ぶと消費ポイントを抑えられます。',
  },
  {
    emoji: '📄',
    title: 'PDFにそのまま質問',
    body: 'PDFビューワーでファイルを開いた状態でLilyに質問すると、PDF内容を踏まえて回答します。',
  },
  {
    emoji: '🎯',
    title: 'フォーカスモードで集中',
    body: 'スタディトラッカー内のフォーカスモードを使うと、勉強中の余計な操作を防げます。',
  },
  {
    emoji: '💾',
    title: '端末間でデータを移す',
    body: '設定画面の「バックアップをダウンロード」→ 別端末で「復元ファイルをアップロード」でメモを移行できます。',
  },
  {
    emoji: '🧠',
    title: '演習問題を生成',
    body: 'AIチャットの「演習」モードで、ノートの内容から練習問題を自動生成できます。',
  },
  {
    emoji: '🕸️',
    title: 'メモの繋がりを見る',
    body: 'サイドバー上部のグラフアイコンでメモ同士のリンク関係をグラフ表示できます。',
  },
  {
    emoji: '📝',
    title: '毎日の日記',
    body: '日記タブで毎日の学習・気づきを記録しておくと、振り返りに役立ちます。',
  },
  {
    emoji: '🏆',
    title: 'トロフィーを集めよう',
    body: '学習を続けるとトロフィーが解放されます。モチベーション維持に活用してみてください。',
  },
  {
    emoji: '🔗',
    title: 'メモ間リンク',
    body: 'ノートエディタで [[メモ名]] と書くとメモ同士をリンクできます。グラフ表示でも可視化されます。',
  },
];
// ─────────────────────────────────────────────────────────────────────────────

const KEY_HIDE = 'lily-news-hide';
const SESSION_KEY = 'lily-news-shown';

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getTodaysTip(): { emoji: string; title: string; body: string } {
  const d = new Date();
  const start = new Date(d.getFullYear(), 0, 0);
  const dayOfYear = Math.floor((d.getTime() - start.getTime()) / 86400000);
  return TIPS[dayOfYear % TIPS.length];
}

export default function AnnouncementModal() {
  const [open, setOpen] = useState(false);
  const [hideToday, setHideToday] = useState(false);

  useEffect(() => {
    if (sessionStorage.getItem(SESSION_KEY)) return;
    const version = NOTICE ? NOTICE_VERSION : todayStr();
    if (localStorage.getItem(KEY_HIDE) === `${version}|${todayStr()}`) return;
    setOpen(true);
  }, []);

  const dismiss = () => {
    sessionStorage.setItem(SESSION_KEY, '1');
    const version = NOTICE ? NOTICE_VERSION : todayStr();
    if (hideToday) localStorage.setItem(KEY_HIDE, `${version}|${todayStr()}`);
    setOpen(false);
  };

  if (!open) return null;

  const tip = getTodaysTip();

  return (
    <div className="am-backdrop" onClick={dismiss} role="dialog" aria-modal="true" aria-label="お知らせ">
      <div className="am-card" onClick={(e) => e.stopPropagation()}>
        {NOTICE && (
          <>
            <div className="am-header">
              <span className="am-badge am-badge-notice">⚠️ 重要なお知らせ</span>
            </div>
            <div className="am-items" style={{ marginBottom: 14 }}>
              <div className="am-item am-item-notice">
                <span className="am-item-emoji">{NOTICE.emoji}</span>
                <div className="am-item-text">
                  <div className="am-item-title">{NOTICE.title}</div>
                  <div className="am-item-body">{NOTICE.body}</div>
                </div>
              </div>
            </div>
          </>
        )}

        <div className="am-header">
          <span className="am-badge">💡 今日のヒント</span>
        </div>

        <div className="am-items">
          <div className="am-item">
            <span className="am-item-emoji">{tip.emoji}</span>
            <div className="am-item-text">
              <div className="am-item-title">{tip.title}</div>
              <div className="am-item-body">{tip.body}</div>
            </div>
          </div>
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
        .am-header { display: flex; justify-content: center; margin-bottom: 16px; }
        .am-badge {
          font-size: 13px; font-weight: 800; letter-spacing: 0.02em;
          color: var(--primary-dark, #ff8da1);
          background: color-mix(in srgb, var(--primary, #ffb6c1) 22%, transparent);
          padding: 5px 14px; border-radius: 999px;
        }
        .am-badge-notice {
          color: #e8a200;
          background: color-mix(in srgb, #ffb300 22%, transparent);
        }
        .am-items { display: flex; flex-direction: column; gap: 12px; margin-bottom: 18px; }
        .am-item {
          display: flex; gap: 11px; align-items: flex-start;
          background: var(--accent, #fff0f5);
          border: 1px solid var(--border, #ffe0e8);
          border-radius: 14px; padding: 12px 13px;
        }
        .am-item-notice {
          background: color-mix(in srgb, #ffb300 12%, transparent);
          border-color: color-mix(in srgb, #e8a200 40%, transparent);
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
