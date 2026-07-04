'use client';

// 新規ユーザー向けチュートリアル。お知らせ（AnnouncementModal）の「チュートリアル
// をはじめる」ボタンから起動する、スライド形式の使い方ガイド。
// 完了・スキップすると lily-tutorial-done を立てるが、お知らせからはいつでも再度
// 開始できる。

import { useState } from 'react';

const KEY_DONE = 'lily-tutorial-done';

export function tutorialDone(): boolean {
  if (typeof window === 'undefined') return true;
  return localStorage.getItem(KEY_DONE) === '1';
}

interface Step {
  emoji: string;
  title: string;
  body: string;
  highlight?: string; // 強調したい一言（無制限などの訴求）
}

const STEPS: Step[] = [
  {
    emoji: '🐶',
    title: 'Lily Memo へようこそ！',
    body: 'メモ・学習記録・AIアシスタントが1つになった勉強アプリです。まずは主な使い方をLilyといっしょに1分でチェックしましょう。',
  },
  {
    emoji: '📝',
    title: 'メモを書く・整理する',
    body: 'アイデアや授業ノートを自由に書けます。フォルダで整理でき、本文に [[メモ名]] と書くとメモ同士をリンク。サイドバー上部のグラフ表示で繋がりを可視化できます。',
  },
  {
    emoji: '✨',
    title: 'AIアシスタント「Lily」',
    body: '「AI」タブでLilyに文章でお願いするだけ。要約・翻訳・問題作成・図やグラフ・幾何の図・メール下書きまで作れます。PDFや画像を添付して質問することもできます。',
  },
  {
    emoji: '🎁',
    title: '応答モードを使い分けよう',
    body: 'チャット右上の ⋮ から応答モードを切り替えられます。「軽量モード」と「古いモード」はどのプランでも無制限に使えます（古いモードは品質が lily-memo-2.0 version 相当のかわりにトークン消費0.1倍）。じっくり答えてほしいときは思考モードもどうぞ。',
    highlight: '軽量モード・古いモードは無制限！',
  },
  {
    emoji: '📚',
    title: '学習トラッカー & 演習',
    body: 'ポモドーロタイマーで集中時間を記録し、続けるとトロフィーやレベルが解放されます。「演習」ではノートの内容から練習問題を自動生成。フォーカスモードで余計な操作も防げます。',
  },
  {
    emoji: '💾',
    title: 'データの保存とバックアップ',
    body: 'メモはこの端末のブラウザ内に保存されます。別の端末に移すときは、設定画面の「バックアップをダウンロード」→ もう一方で「復元ファイルをアップロード」。共有キーを設定すれば自動同期もできます。',
  },
  {
    emoji: '🚀',
    title: '準備完了！',
    body: 'これで基本はバッチリです。分からないことがあれば、いつでもLilyに聞いてくださいね。それでは、良い学習を！',
  },
];

export default function TutorialModal({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0);
  const isLast = step === STEPS.length - 1;
  const cur = STEPS[step];

  const finish = () => {
    try { localStorage.setItem(KEY_DONE, '1'); } catch {}
    onClose();
  };

  return (
    <div className="tut-backdrop" role="dialog" aria-modal="true" aria-label="チュートリアル">
      <div className="tut-card" onClick={(e) => e.stopPropagation()}>
        <button className="tut-skip" onClick={finish} aria-label="スキップ">スキップ ✕</button>

        <div className="tut-stage">
          <span className="tut-halo" />
          <span className="tut-emoji">{cur.emoji}</span>
        </div>

        <div className="tut-step-badge">STEP {step + 1} / {STEPS.length}</div>
        <h2 className="tut-title">{cur.title}</h2>
        {cur.highlight && <div className="tut-highlight">🎉 {cur.highlight}</div>}
        <p className="tut-body">{cur.body}</p>

        <div className="tut-dots">
          {STEPS.map((_, i) => (
            <button
              key={i}
              className={`tut-dot${i === step ? ' on' : ''}`}
              onClick={() => setStep(i)}
              aria-label={`ステップ ${i + 1}`}
            />
          ))}
        </div>

        <div className="tut-actions">
          {step > 0 ? (
            <button className="tut-btn ghost" onClick={() => setStep((s) => s - 1)}>戻る</button>
          ) : (
            <span />
          )}
          {isLast ? (
            <button className="tut-btn primary" onClick={finish}>はじめる 🚀</button>
          ) : (
            <button className="tut-btn primary" onClick={() => setStep((s) => s + 1)}>次へ →</button>
          )}
        </div>
      </div>

      <style jsx>{`
        .tut-backdrop {
          position: fixed; inset: 0; z-index: 100010;
          display: flex; align-items: center; justify-content: center; padding: 20px;
          background: rgba(0, 0, 0, 0.5); backdrop-filter: blur(4px);
          animation: tutFade 0.25s ease both;
        }
        .tut-card {
          position: relative; width: 100%; max-width: 440px;
          max-height: 90vh; overflow-y: auto;
          background: var(--background, #fffafa); color: var(--foreground, #3d3d3d);
          border: 1px solid var(--border, #ffe0e8); border-radius: 24px;
          padding: 26px 24px 22px; text-align: center;
          box-shadow: 0 24px 64px rgba(0, 0, 0, 0.3);
          animation: tutPop 0.34s cubic-bezier(0.16, 1.3, 0.4, 1) both;
        }
        .tut-skip {
          position: absolute; top: 14px; right: 14px;
          background: none; border: none; cursor: pointer;
          font-size: 12px; font-weight: 700; color: var(--fg-muted, #9aa);
          padding: 4px 8px; border-radius: 8px;
        }
        .tut-skip:hover { background: var(--accent, #fff0f5); color: var(--foreground, #555); }
        .tut-stage { position: relative; display: flex; align-items: center; justify-content: center; height: 96px; margin-top: 4px; }
        .tut-halo {
          position: absolute; width: 96px; height: 96px; border-radius: 50%;
          background: radial-gradient(circle, color-mix(in srgb, var(--primary, #ffb6c1) 45%, transparent) 0%, transparent 70%);
          filter: blur(10px); animation: tutHalo 3.4s ease-in-out infinite;
        }
        .tut-emoji { position: relative; font-size: 58px; line-height: 1; animation: tutFloat 3.4s ease-in-out infinite; }
        .tut-step-badge {
          display: inline-block; margin: 8px 0 6px;
          font-size: 11px; font-weight: 800; letter-spacing: 0.08em;
          color: var(--primary-dark, #ff8da1);
          background: color-mix(in srgb, var(--primary, #ffb6c1) 20%, transparent);
          padding: 3px 12px; border-radius: 999px;
        }
        .tut-title { font-size: 1.28rem; font-weight: 800; margin: 4px 0 8px; color: var(--foreground, #3d3d3d); }
        .tut-highlight {
          display: inline-block; margin-bottom: 10px; font-size: 0.8rem; font-weight: 800;
          color: #15803d; background: color-mix(in srgb, #22c55e 18%, transparent);
          border: 1px solid color-mix(in srgb, #22c55e 40%, transparent);
          padding: 5px 12px; border-radius: 999px;
        }
        .tut-body {
          font-size: 0.9rem; line-height: 1.75; font-weight: 500;
          color: color-mix(in srgb, var(--foreground, #3d3d3d) 78%, transparent);
          margin: 0 auto 18px; max-width: 360px; text-align: left;
        }
        .tut-dots { display: flex; justify-content: center; gap: 7px; margin-bottom: 18px; }
        .tut-dot {
          width: 8px; height: 8px; border-radius: 50%; border: none; cursor: pointer; padding: 0;
          background: var(--border, #ffd6e0); transition: all 0.2s ease;
        }
        .tut-dot.on { background: var(--primary-dark, #ff8da1); width: 22px; border-radius: 999px; }
        .tut-actions { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
        .tut-btn {
          border: none; cursor: pointer; font-size: 0.92rem; font-weight: 800;
          padding: 12px 20px; border-radius: 13px; transition: filter 0.15s ease, transform 0.1s ease;
        }
        .tut-btn.primary { flex: 1; background: var(--primary-dark, #ff8da1); color: var(--primary-foreground, #fff); }
        .tut-btn.primary:hover { filter: brightness(1.05); }
        .tut-btn.primary:active { transform: scale(0.98); }
        .tut-btn.ghost { background: var(--accent, #fff0f5); color: var(--foreground, #666); }
        .tut-btn.ghost:hover { filter: brightness(0.97); }

        @keyframes tutFade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes tutPop { from { opacity: 0; transform: translateY(16px) scale(0.95); } to { opacity: 1; transform: translateY(0) scale(1); } }
        @keyframes tutFloat { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }
        @keyframes tutHalo { 0%, 100% { transform: scale(1); opacity: 0.7; } 50% { transform: scale(1.18); opacity: 1; } }
        @media (prefers-reduced-motion: reduce) {
          .tut-backdrop, .tut-card, .tut-emoji, .tut-halo { animation: none; }
        }
      `}</style>
    </div>
  );
}
