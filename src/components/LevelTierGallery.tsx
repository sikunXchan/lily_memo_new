'use client';

import { useState } from 'react';
import { X, Lock, Sparkles } from 'lucide-react';
import {
  LEVEL_TIERS_ASC, hoursForTier, getLevelInfo, titleForHours, fmtHoursShort,
} from '@/lib/level';
import type { LevelTier } from '@/lib/level';
import LevelIcon from './LevelIcon';
import TierUpOverlay from './TierUpOverlay';
import { useT } from '@/lib/i18n';

// レベル図鑑：15段のトロフィーが「何時間で」「どんな姿・エフェクトになるか」を
// 一覧で見られる画面。未到達の段もエフェクト付きで表示して、300時間で光り出す
// といった先の目標が見えるようにしている（タップすると昇格演出を再生できる）。

interface Props {
  totalSeconds: number;
  onClose: () => void;
}

export default function LevelTierGallery({ totalSeconds, onClose }: Props) {
  const t = useT();
  const [preview, setPreview] = useState<LevelTier | null>(null);
  const lvl = getLevelInfo(totalSeconds);
  const ti = titleForHours(lvl.hours);

  return (
    <div className="lg-overlay">
      <div className="lg-header">
        <span className="lg-title">🏆 {t('レベル図鑑')}</span>
        <button className="lg-close" onClick={onClose} aria-label={t('閉じる')}><X size={20} /></button>
      </div>

      <div className="lg-scroll">
        {/* 今の状態 */}
        <div className="lg-now" style={{ borderColor: lvl.tier.color + '66' }}>
          <div className="lg-now-icon"><LevelIcon tier={lvl.tier} size={62} /></div>
          <div className="lg-now-body">
            <span className="lg-now-lv" style={{ color: lvl.tier.color }}>Lv {lvl.level}</span>
            <span className="lg-now-title">{ti.title.emoji} {t(ti.title.name)}</span>
            <span className="lg-now-hours">{t('累計 {h} 時間', { h: lvl.hours.toFixed(1) })}</span>
          </div>
        </div>

        {/* 称号の進み具合 */}
        <div className="lg-titlebar">
          <div className="lg-titlebar-top">
            <span className="lg-titlebar-label">{t('次の称号')}</span>
            <span className="lg-titlebar-next">
              {ti.next
                ? `${ti.next.emoji} ${t(ti.next.name)}（${t('あと {h}', { h: fmtHoursShort(ti.remainingHours) })}）`
                : t('すべての称号を獲得！')}
            </span>
          </div>
          <div className="lg-titlebar-bar"><div className="lg-titlebar-fill" style={{ width: `${ti.pct}%` }} /></div>
        </div>

        <p className="lg-hint">{t('タップすると、その段の演出を見られるよ')}</p>

        {/* 15段一覧 */}
        <div className="lg-list">
          {LEVEL_TIERS_ASC.map((tier, i) => {
            const need = hoursForTier(tier);
            const unlocked = lvl.level >= tier.minLevel;
            const isCurrent = lvl.tier.minLevel === tier.minLevel;
            return (
              <button
                key={tier.minLevel}
                className={`lg-row${unlocked ? ' unlocked' : ''}${isCurrent ? ' current' : ''}`}
                style={{ borderColor: unlocked ? tier.color + '66' : undefined }}
                onClick={() => setPreview(tier)}
              >
                <div className="lg-row-icon" style={{ background: tier.color + '18', borderColor: tier.color + '55' }}>
                  <LevelIcon tier={tier} size={46} />
                  {!unlocked && <span className="lg-lock"><Lock size={13} /></span>}
                </div>
                <div className="lg-row-body">
                  <span className="lg-row-tier" style={{ color: tier.color }}>
                    TIER {i + 1}
                    {isCurrent && <em className="lg-badge-now">{t('いま')}</em>}
                  </span>
                  <span className="lg-row-need">
                    {t('{h} 時間 / Lv {lv}', { h: Math.round(need), lv: tier.minLevel })}
                  </span>
                  <span className="lg-row-fx">
                    {tier.fx === 'none'
                      ? t('エフェクトなし')
                      : <><Sparkles size={11} /> {t(FX_LABEL[tier.fx])}</>}
                  </span>
                </div>
                {!unlocked && (
                  <span className="lg-row-remain">
                    {t('あと {h}', { h: fmtHoursShort(Math.max(0, need - lvl.hours)) })}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {preview && (
        <TierUpOverlay
          tier={preview}
          level={preview.minLevel}
          preview
          onClose={() => setPreview(null)}
        />
      )}

      <style jsx>{`
        .lg-overlay { position: fixed; inset: 0; z-index: 6800; background: var(--background); display: flex; flex-direction: column; }
        .lg-header { display: flex; align-items: center; gap: 12px; padding: 14px 16px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
        .lg-title { font-weight: 900; font-size: 1rem; color: var(--foreground); flex: 1; }
        .lg-close { width: 34px; height: 34px; display: flex; align-items: center; justify-content: center; border-radius: 9px; color: var(--fg-muted); cursor: pointer; background: none; border: none; }
        .lg-close:hover { background: var(--accent); }

        .lg-scroll { flex: 1; overflow-y: auto; padding: 14px; padding-bottom: 40px; display: flex; flex-direction: column; gap: 12px; }

        .lg-now { display: flex; align-items: center; gap: 14px; padding: 14px; border: 1.5px solid var(--border); border-radius: 18px; background: var(--accent); }
        .lg-now-icon { flex-shrink: 0; }
        .lg-now-body { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
        .lg-now-lv { font-size: 1.5rem; font-weight: 900; line-height: 1.1; }
        .lg-now-title { font-size: 0.9rem; font-weight: 800; color: var(--foreground); }
        .lg-now-hours { font-size: 0.76rem; font-weight: 700; color: var(--fg-muted); }

        .lg-titlebar { background: var(--accent); border: 1px solid var(--border); border-radius: 14px; padding: 11px 13px; }
        .lg-titlebar-top { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: 7px; }
        .lg-titlebar-label { font-size: 0.72rem; font-weight: 800; color: var(--fg-muted); flex-shrink: 0; }
        .lg-titlebar-next { font-size: 0.78rem; font-weight: 800; color: var(--primary); text-align: right; }
        .lg-titlebar-bar { height: 8px; background: var(--background); border-radius: 99px; overflow: hidden; }
        .lg-titlebar-fill { height: 100%; background: linear-gradient(90deg, var(--primary), color-mix(in srgb, var(--primary) 45%, #fff)); border-radius: 99px; transition: width 0.5s; }

        .lg-hint { font-size: 0.74rem; color: var(--fg-muted); text-align: center; margin: 0; }

        .lg-list { display: flex; flex-direction: column; gap: 9px; }
        .lg-row {
          display: flex; align-items: center; gap: 12px; width: 100%; text-align: left;
          background: var(--accent); border: 1.5px solid var(--border); border-radius: 16px;
          padding: 10px 12px; cursor: pointer; font-family: inherit; transition: transform 0.12s, opacity 0.15s;
        }
        .lg-row:hover { transform: translateY(-2px); }
        .lg-row:not(.unlocked) { opacity: 0.72; }
        .lg-row.current { box-shadow: 0 0 0 2px var(--primary) inset; }
        .lg-row-icon { position: relative; width: 58px; height: 58px; border-radius: 14px; border: 1px solid var(--border); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .lg-lock { position: absolute; right: -3px; bottom: -3px; width: 21px; height: 21px; border-radius: 50%; background: var(--background); border: 1px solid var(--border); color: var(--fg-muted); display: flex; align-items: center; justify-content: center; }
        .lg-row-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
        .lg-row-tier { font-size: 0.88rem; font-weight: 900; letter-spacing: 0.04em; display: flex; align-items: center; gap: 7px; }
        .lg-badge-now { font-style: normal; font-size: 0.62rem; font-weight: 900; color: #fff; background: var(--primary); border-radius: 99px; padding: 2px 7px; }
        .lg-row-need { font-size: 0.76rem; font-weight: 700; color: var(--foreground); }
        .lg-row-fx { font-size: 0.7rem; font-weight: 700; color: var(--fg-muted); display: inline-flex; align-items: center; gap: 4px; }
        .lg-row-remain { font-size: 0.72rem; font-weight: 800; color: var(--fg-muted); flex-shrink: 0; white-space: nowrap; }
      `}</style>
    </div>
  );
}

// 各エフェクトの短い説明（日本語がキー、英訳は lib/i18n.ts）
const FX_LABEL: Record<LevelTier['fx'], string> = {
  none:     'エフェクトなし',
  glow:     'クリスタルの輝き',
  glow2:    '氷の輝き＋浮遊',
  aura:     'エメラルドのオーラ',
  aura2:    '輝くオーラ＋きらめき',
  radiant:  '聖なる光',
  radiant2: '聖光＋回転する光輪',
  rainbow:  'レインボー（最高段）',
};
