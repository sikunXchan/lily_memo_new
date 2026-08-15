'use client';

import { useState } from 'react';
import { X, Lock, Check } from 'lucide-react';
import type { LevelTier } from '@/lib/level';
import { tierName } from '@/lib/level';
import {
  STUDY_THEMES, getStudyThemeId, saveStudyThemeId, isThemeUnlocked, unlockLabel,
} from '@/lib/studyThemes';
import { useT } from '@/lib/i18n';

// 学習タブの見た目テーマを選ぶシート。未解禁のテーマも「どの段位で開くか」
// 付きで並べて見せる — 次に何が手に入るか分かるほうが上げる気になるので、
// 隠さずに鍵付きで出しておく。
interface Props {
  tier: LevelTier;
  onClose: () => void;
}

export default function StudyThemeModal({ tier, onClose }: Props) {
  const t = useT();
  const [selected, setSelected] = useState(getStudyThemeId);

  const pick = (id: string) => {
    setSelected(id);
    saveStudyThemeId(id);
  };

  return (
    <div className="tm-overlay" onClick={onClose}>
      <div className="tm-card" onClick={e => e.stopPropagation()}>
        <div className="tm-header">
          <span className="tm-title">🎨 {t('学習テーマ')}</span>
          <button className="tm-close" onClick={onClose}><X size={20} /></button>
        </div>

        <p className="tm-lead">
          {t('色は自分で選べて、派手さは今の段位（{tier}）で決まるよ。', { tier: tierName(tier, t) })}
        </p>

        <div className="tm-list">
          {STUDY_THEMES.map(th => {
            const open = isThemeUnlocked(th, tier);
            const on = selected === th.id;
            return (
              <button
                key={th.id}
                className={`tm-item${on ? ' on' : ''}${open ? '' : ' locked'}`}
                onClick={() => open && pick(th.id)}
                disabled={!open}
                style={th.color ? { ['--sw' as string]: th.color, ['--sw2' as string]: th.edge } : undefined}
              >
                <span className={`tm-swatch${th.rainbow ? ' rainbow' : ''}${th.color ? '' : ' tier'}`}>{th.emoji}</span>
                <span className="tm-body">
                  <span className="tm-name">{t(th.name)}</span>
                  <span className="tm-sub">
                    {open
                      ? (th.color ? t('解禁済み') : t('今の段位の色をそのまま使う'))
                      : t('{tier} で解禁', { tier: unlockLabel(th, t) })}
                  </span>
                </span>
                {open
                  ? (on ? <Check size={17} className="tm-mark" /> : null)
                  : <Lock size={15} className="tm-lock" />}
              </button>
            );
          })}
        </div>

        <div className="tm-footer">
          <button className="tm-done" onClick={onClose}>{t('閉じる')}</button>
        </div>
      </div>

      <style jsx>{`
        .tm-overlay {
          position: fixed; inset: 0; z-index: 6700;
          background: rgba(0,0,0,0.55); backdrop-filter: blur(8px);
          display: flex; align-items: center; justify-content: center; padding: 18px;
        }
        .tm-card {
          background: var(--background); border: 1px solid var(--border);
          border-radius: 22px; width: 100%; max-width: 380px; max-height: 86vh;
          display: flex; flex-direction: column; overflow: hidden;
          box-shadow: 0 20px 60px rgba(0,0,0,0.4);
        }
        .tm-header { display: flex; align-items: center; justify-content: space-between; padding: 15px 16px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
        .tm-title { font-weight: 900; font-size: 0.98rem; color: var(--foreground); }
        .tm-close { width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; border-radius: 8px; color: var(--fg-muted); cursor: pointer; }
        .tm-close:hover { background: var(--accent); }
        /* 画面右上には常駐 sikun ボタン（z-index 10001）が居座るので、その帯に
           大事な文字を送り込まないよう右側を空けておく。 */
        .tm-lead { margin: 0; padding: 12px 58px 4px 16px; font-size: 0.76rem; line-height: 1.6; color: var(--fg-muted); }
        .tm-list { flex: 1; overflow-y: auto; padding: 8px 12px 12px; display: flex; flex-direction: column; gap: 7px; }
        .tm-item {
          display: flex; align-items: center; gap: 11px; width: 100%; text-align: left; font-family: inherit;
          padding: 9px 11px; border-radius: 15px; border: 1.5px solid var(--border);
          background: var(--accent); color: var(--foreground); cursor: pointer; transition: border-color .12s, transform .12s;
        }
        .tm-item:hover:not(.locked) { transform: translateY(-1px); border-color: var(--sw, var(--primary)); }
        .tm-item.on { border-color: var(--sw, var(--primary)); box-shadow: 0 0 14px -4px var(--sw, var(--primary)); }
        .tm-item.locked { opacity: 0.5; cursor: not-allowed; }
        .tm-swatch {
          width: 40px; height: 40px; flex-shrink: 0; border-radius: 13px;
          display: flex; align-items: center; justify-content: center; font-size: 1.05rem;
          background: linear-gradient(140deg, var(--sw), var(--sw2));
          box-shadow: inset 0 0 12px rgba(255,255,255,0.35);
        }
        /* 段位カラーは固定色を持たないので、虹より控えめなグレーの見本にする */
        .tm-swatch.tier { background: linear-gradient(140deg, #cbd5e1, #94a3b8); }
        .tm-swatch.rainbow { background: conic-gradient(#ff5e5e, #ffd24d, #5eff8b, #5ec8ff, #b15eff, #ff5ec8, #ff5e5e); }
        .tm-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
        .tm-name { font-size: 0.88rem; font-weight: 900; }
        .tm-sub { font-size: 0.68rem; font-weight: 700; color: var(--fg-muted); }
        .tm-mark { color: var(--sw, var(--primary)); flex-shrink: 0; }
        .tm-lock { color: var(--fg-muted); flex-shrink: 0; }
        .tm-footer { padding: 0 16px 16px; flex-shrink: 0; }
        .tm-done { width: 100%; background: var(--primary); color: #fff; border: none; border-radius: 14px; padding: 13px; font-size: 0.95rem; font-weight: 800; cursor: pointer; font-family: inherit; }
        .tm-done:hover { opacity: 0.88; }
        @media (prefers-reduced-motion: reduce) {
          .tm-item { transition: none; }
        }
      `}</style>
    </div>
  );
}
