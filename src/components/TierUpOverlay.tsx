'use client';

import { useEffect } from 'react';
import type { LevelTier } from '@/lib/level';
import { hoursForTier, LEVEL_TIERS_ASC } from '@/lib/level';
import LevelIcon from './LevelIcon';
import { useT } from '@/lib/i18n';

// トロフィーの「段位（ティア）」が上がったときの演出。レベルアップの小さな
// ポップアップとは別扱いで、15段しかないティア昇格だけに使う特別な画面。
// 300時間（Tier 9 = はじめてエフェクトが付くティア）はその代表格。
//
// preview=true で「レベル図鑑」からいつでも同じ演出を再生できる（実際に到達
// していなくても、どんな演出がもらえるのか見て目標にできる）。

// Deterministic particle spread (golden angle) — no Math.random in render.
const PARTICLES = Array.from({ length: 30 }, (_, i) => ({
  left: +((i * 137.508) % 100).toFixed(2),
  delay: +(((i * 17.3) % 10) / 8).toFixed(2),
  dur: +(2.2 + ((i * 23) % 16) / 10).toFixed(2),
  size: 4 + ((i * 5) % 6),
  drift: ((i % 5) - 2) * 14,
}));

interface Props {
  tier: LevelTier;
  level: number;
  onClose: () => void;
  preview?: boolean;
}

export default function TierUpOverlay({ tier, level, onClose, preview }: Props) {
  const t = useT();
  const tierNo = LEVEL_TIERS_ASC.findIndex(x => x.minLevel === tier.minLevel) + 1;
  const hours = Math.round(hoursForTier(tier));

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [onClose]);

  return (
    <div className="tu-overlay" onClick={onClose}>
      {/* 背景の光 */}
      <div className="tu-rays" style={{ background: `conic-gradient(from 0deg, transparent 0deg, ${tier.color}66 6deg, transparent 12deg, transparent 30deg, ${tier.color}55 36deg, transparent 42deg, transparent 60deg, ${tier.color}66 66deg, transparent 72deg)` }} />
      <div className="tu-glow" style={{ background: `radial-gradient(circle, ${tier.color}88, transparent 62%)` }} />
      <div className="tu-ring" style={{ borderColor: tier.color }} />
      <div className="tu-ring tu-ring2" style={{ borderColor: tier.color }} />

      {/* 舞い上がる粒子 */}
      <div className="tu-particles">
        {PARTICLES.map((p, i) => (
          <span
            key={i}
            style={{
              left: `${p.left}%`,
              width: `${p.size}px`,
              height: `${p.size}px`,
              background: tier.color,
              animationDelay: `${p.delay}s`,
              animationDuration: `${p.dur}s`,
              ['--drift' as string]: `${p.drift}px`,
            }}
          />
        ))}
      </div>

      <div className="tu-card" onClick={e => e.stopPropagation()}>
        <p className="tu-kicker" style={{ color: tier.color }}>
          {preview ? t('演出プレビュー') : t('トロフィー進化！')}
        </p>
        <div className="tu-icon"><LevelIcon tier={tier} size={150} /></div>
        <p className="tu-tier" style={{ color: tier.color }}>TIER {tierNo}</p>
        <p className="tu-hours">{t('累計 {h} 時間 到達', { h: hours })}</p>
        <p className="tu-level">Lv {level}</p>
        <p className="tu-msg">
          {preview
            ? t('ここまで積み上げると、トロフィーがこの姿になるよ')
            : t('トロフィーが新しい姿になったよ！')}
        </p>
        <button className="tu-ok" style={{ background: tier.color }} onClick={onClose}>
          {preview ? t('閉じる') : t('やったー！')}
        </button>
      </div>

      <style jsx>{`
        .tu-overlay {
          position: fixed; inset: 0; z-index: 7200;
          background: radial-gradient(circle at 50% 42%, rgba(15,12,30,0.86), rgba(0,0,0,0.94));
          backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
          display: flex; align-items: center; justify-content: center; padding: 20px;
          overflow: hidden; animation: tuFade 0.35s ease both;
        }
        @keyframes tuFade { from { opacity: 0; } to { opacity: 1; } }

        .tu-rays {
          position: absolute; top: 50%; left: 50%; width: 180vmax; height: 180vmax;
          transform: translate(-50%, -50%); opacity: 0.5; pointer-events: none;
          animation: tuSpin 24s linear infinite;
        }
        .tu-glow {
          position: absolute; top: 42%; left: 50%; width: 90vmin; height: 90vmin;
          transform: translate(-50%, -50%); pointer-events: none; opacity: 0.55;
          animation: tuBreathe 3s ease-in-out infinite;
        }
        .tu-ring {
          position: absolute; top: 42%; left: 50%; width: 200px; height: 200px;
          margin: -100px 0 0 -100px; border-radius: 50%; border: 2px solid;
          opacity: 0; pointer-events: none;
          animation: tuBurst 2.4s cubic-bezier(.2,.7,.3,1) infinite;
        }
        .tu-ring2 { animation-delay: 1.2s; }

        .tu-particles { position: absolute; inset: 0; overflow: hidden; pointer-events: none; }
        .tu-particles span {
          position: absolute; bottom: -12px; border-radius: 50%; opacity: 0;
          animation-name: tuRise; animation-timing-function: ease-out; animation-iteration-count: infinite;
        }

        .tu-card {
          position: relative; z-index: 2; text-align: center; max-width: 340px; width: 100%;
          padding: 26px 22px;
          background: rgba(12,10,22,0.72); border: 1px solid rgba(255,255,255,0.14);
          border-radius: 26px; box-shadow: 0 24px 70px rgba(0,0,0,0.6);
          animation: tuPop 0.5s cubic-bezier(.2,1.5,.4,1) both;
        }
        .tu-kicker { font-size: 0.84rem; font-weight: 900; letter-spacing: 0.16em; margin: 0 0 10px; }
        .tu-icon { display: flex; justify-content: center; animation: tuFloat 3s ease-in-out infinite; }
        .tu-tier { font-size: 2.1rem; font-weight: 900; margin: 10px 0 2px; letter-spacing: 0.06em; line-height: 1; }
        .tu-hours { font-size: 1rem; font-weight: 900; color: #fff; margin: 0 0 2px; }
        .tu-level { font-size: 0.84rem; font-weight: 800; color: rgba(255,255,255,0.62); margin: 0 0 10px; }
        .tu-msg { font-size: 0.84rem; color: rgba(255,255,255,0.8); margin: 0 0 16px; line-height: 1.55; }
        .tu-ok {
          border: none; border-radius: 14px; padding: 12px 30px; color: #10121c;
          font-size: 0.94rem; font-weight: 900; cursor: pointer; font-family: inherit;
        }
        .tu-ok:hover { opacity: 0.88; }

        @keyframes tuSpin    { to { transform: translate(-50%, -50%) rotate(360deg); } }
        @keyframes tuBreathe { 0%,100% { opacity: 0.4; transform: translate(-50%,-50%) scale(0.9); } 50% { opacity: 0.7; transform: translate(-50%,-50%) scale(1.06); } }
        @keyframes tuBurst   { 0% { opacity: 0.9; transform: scale(0.3); } 70% { opacity: 0.12; } 100% { opacity: 0; transform: scale(2.6); } }
        @keyframes tuRise    { 0% { opacity: 0; transform: translate(0, 0) scale(0.6); } 15% { opacity: 0.95; } 100% { opacity: 0; transform: translate(var(--drift), -78vh) scale(1.1); } }
        @keyframes tuPop     { from { opacity: 0; transform: scale(0.72) translateY(18px); } to { opacity: 1; transform: scale(1) translateY(0); } }
        @keyframes tuFloat   { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }

        @media (prefers-reduced-motion: reduce) {
          .tu-rays, .tu-glow, .tu-ring, .tu-particles span, .tu-icon, .tu-card { animation: none !important; }
          .tu-ring { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}
