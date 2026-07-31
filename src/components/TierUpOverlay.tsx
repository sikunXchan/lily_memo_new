'use client';

import { useEffect } from 'react';
import type { LevelTier } from '@/lib/level';
import { hoursForTier, LEVEL_TIERS_ASC } from '@/lib/level';
import LevelIcon from './LevelIcon';
import { useT } from '@/lib/i18n';

// トロフィーの「段位（ティア）」が上がったときの演出。15段しかないティア昇格
// だけに使う特別な全画面演出で、ただのレベルアップのポップアップとは別物。
// 累計300時間 = Tier 9 は「はじめてトロフィーにエフェクトが付く段」なので、
// ここが最初の大きな山場になる。
//
// 構成（時系列）:
//   0.00s 画面全体の白フラッシュ + 画面シェイク
//   0.15s 光の柱と放射光が回りはじめる
//   0.25s 衝撃波リングが3連で広がる
//   0.35s トロフィーがオーバーシュートしながら降臨（回転しつつ拡大）
//   0.60s テキストが下から突き上がり、金の光沢が流れる
//   常時   紙吹雪 + 舞い上がる粒子 + 十字フレア

// Deterministic spreads (golden angle) — no Math.random in render.
const SPARKS = Array.from({ length: 56 }, (_, i) => ({
  left: +((i * 137.508) % 100).toFixed(2),
  delay: +(((i * 17.3) % 20) / 10).toFixed(2),
  dur: +(1.8 + ((i * 23) % 18) / 10).toFixed(2),
  size: 3 + ((i * 5) % 7),
  drift: ((i % 7) - 3) * 22,
}));

const CONFETTI_COLORS = ['#fff3a8', '#ffffff', '#ffd24d', '#a8f0ff', '#ffc4f0'];
const CONFETTI = Array.from({ length: 40 }, (_, i) => ({
  left: +((i * 97.508) % 100).toFixed(2),
  delay: +(((i * 11.7) % 16) / 10).toFixed(2),
  dur: +(2.2 + ((i * 31) % 16) / 10).toFixed(2),
  w: 5 + ((i * 3) % 6),
  h: 9 + ((i * 7) % 9),
  color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
  spin: ((i % 2) ? 1 : -1) * (540 + (i % 4) * 180),
}));

interface Props {
  tier: LevelTier;
  level: number;
  onClose: () => void;
}

export default function TierUpOverlay({ tier, level, onClose }: Props) {
  const t = useT();
  const tierNo = LEVEL_TIERS_ASC.findIndex(x => x.minLevel === tier.minLevel) + 1;
  const hours = Math.round(hoursForTier(tier));
  const isMax = tier.fx === 'rainbow';

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [onClose]);

  // 最高段だけは虹、それ以外はそのティアの色で染める。
  const rays = isMax
    ? 'conic-gradient(from 0deg, transparent 0deg, #ff5e5e 5deg, transparent 10deg, transparent 25deg, #ffd24d 30deg, transparent 35deg, transparent 50deg, #5eff8b 55deg, transparent 60deg, transparent 75deg, #5ec8ff 80deg, transparent 85deg, transparent 100deg, #b15eff 105deg, transparent 110deg)'
    : `conic-gradient(from 0deg, transparent 0deg, ${tier.color} 5deg, transparent 11deg, transparent 28deg, ${tier.color}cc 33deg, transparent 39deg, transparent 56deg, ${tier.color} 61deg, transparent 67deg)`;

  return (
    <div className="tu-overlay" onClick={onClose}>
      {/* 開幕の白フラッシュ */}
      <div className="tu-flash" />

      <div className="tu-shake">
        {/* 光の柱 */}
        <div className="tu-pillar" style={{ background: `linear-gradient(to bottom, transparent, ${tier.color}, transparent)` }} />
        {/* 放射光（逆回転の2枚重ね） */}
        <div className="tu-rays" style={{ background: rays }} />
        <div className="tu-rays tu-rays-b" style={{ background: rays }} />
        {/* 中央の発光 */}
        <div className="tu-glow" style={{ background: `radial-gradient(circle, ${tier.color}, ${tier.color}55 34%, transparent 68%)` }} />
        {/* 十字フレア */}
        <div className="tu-flare" style={{ background: `linear-gradient(to right, transparent, ${tier.color}, transparent)` }} />
        <div className="tu-flare tu-flare-v" style={{ background: `linear-gradient(to bottom, transparent, ${tier.color}, transparent)` }} />
        {/* 衝撃波リング3連 */}
        <div className="tu-ring" style={{ borderColor: tier.color }} />
        <div className="tu-ring tu-ring2" style={{ borderColor: tier.color }} />
        <div className="tu-ring tu-ring3" style={{ borderColor: '#fff' }} />

        {/* 舞い上がる粒子 */}
        <div className="tu-layer">
          {SPARKS.map((p, i) => (
            <span
              key={i}
              className="tu-spark"
              style={{
                left: `${p.left}%`,
                width: `${p.size}px`,
                height: `${p.size}px`,
                background: i % 4 === 0 ? '#fff' : tier.color,
                boxShadow: `0 0 ${p.size * 2}px ${i % 4 === 0 ? '#fff' : tier.color}`,
                animationDelay: `${p.delay}s`,
                animationDuration: `${p.dur}s`,
                ['--drift' as string]: `${p.drift}px`,
              }}
            />
          ))}
        </div>

        {/* 紙吹雪 */}
        <div className="tu-layer">
          {CONFETTI.map((c, i) => (
            <i
              key={i}
              className="tu-conf"
              style={{
                left: `${c.left}%`,
                width: `${c.w}px`,
                height: `${c.h}px`,
                background: c.color,
                animationDelay: `${c.delay}s`,
                animationDuration: `${c.dur}s`,
                ['--spin' as string]: `${c.spin}deg`,
              }}
            />
          ))}
        </div>

        {/* 本体 */}
        <div className="tu-card" onClick={e => e.stopPropagation()}>
          <p className="tu-kicker">{t('トロフィー進化！')}</p>
          <div className="tu-icon-wrap">
            <span className="tu-icon-halo" style={{ background: `radial-gradient(circle, ${tier.color}, transparent 66%)` }} />
            <span className="tu-icon"><LevelIcon tier={tier} size={190} /></span>
          </div>
          <p className="tu-tier" style={{ color: tier.color, textShadow: `0 0 24px ${tier.color}, 0 0 60px ${tier.color}` }}>
            TIER {tierNo}
          </p>
          <p className="tu-hours">{t('累計 {h} 時間 到達', { h: hours })}</p>
          <p className="tu-level">Lv {level}</p>
          <p className="tu-msg">
            {isMax ? t('ついに最高段。ここまで積み上げたのは本当にすごい！') : t('トロフィーが新しい姿になったよ！')}
          </p>
          <button className="tu-ok" style={{ background: tier.color }} onClick={onClose}>{t('やったー！')}</button>
        </div>
      </div>

      <style jsx>{`
        .tu-overlay {
          position: fixed; inset: 0; z-index: 7200;
          background: radial-gradient(circle at 50% 44%, rgba(20,14,42,0.9), rgba(0,0,0,0.97));
          backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
          display: flex; align-items: center; justify-content: center;
          overflow: hidden;
        }
        .tu-shake {
          position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
          padding: 20px; animation: tuShake 0.62s cubic-bezier(.36,.07,.19,.97) both;
        }

        /* 開幕フラッシュ */
        .tu-flash {
          position: absolute; inset: 0; background: #fff; z-index: 9; pointer-events: none;
          animation: tuFlash 0.55s ease-out both;
        }

        /* 光の柱 */
        .tu-pillar {
          position: absolute; top: 0; bottom: 0; left: 50%; width: 46vmin; margin-left: -23vmin;
          filter: blur(28px); opacity: 0; pointer-events: none;
          animation: tuPillar 2.6s ease-out 0.15s infinite;
        }
        /* 放射光 */
        .tu-rays {
          position: absolute; top: 46%; left: 50%; width: 210vmax; height: 210vmax;
          transform: translate(-50%, -50%); opacity: 0; pointer-events: none;
          animation: tuRaysIn 0.8s ease-out 0.15s forwards, tuSpin 14s linear 0.15s infinite;
        }
        .tu-rays-b { animation: tuRaysIn 0.8s ease-out 0.25s forwards, tuSpinR 22s linear 0.25s infinite; opacity: 0; }
        .tu-glow {
          position: absolute; top: 46%; left: 50%; width: 96vmin; height: 96vmin;
          transform: translate(-50%, -50%); pointer-events: none; opacity: 0.62;
          animation: tuBreathe 2.4s ease-in-out infinite;
        }
        /* 十字フレア */
        .tu-flare {
          position: absolute; top: 46%; left: 50%; width: 150vmin; height: 5px;
          margin: -2.5px 0 0 -75vmin; filter: blur(3px); pointer-events: none;
          animation: tuFlare 2.6s ease-in-out infinite;
        }
        .tu-flare-v { width: 5px; height: 130vmin; margin: -65vmin 0 0 -2.5px; animation-delay: 0.3s; }

        /* 衝撃波 */
        .tu-ring {
          position: absolute; top: 46%; left: 50%; width: 240px; height: 240px;
          margin: -120px 0 0 -120px; border-radius: 50%; border: 3px solid;
          opacity: 0; pointer-events: none;
          animation: tuBurst 2.2s cubic-bezier(.1,.7,.3,1) 0.25s infinite;
        }
        .tu-ring2 { animation-delay: 0.95s; }
        .tu-ring3 { animation-delay: 1.6s; border-width: 2px; }

        .tu-layer { position: absolute; inset: 0; overflow: hidden; pointer-events: none; }
        .tu-spark {
          position: absolute; bottom: -14px; border-radius: 50%; opacity: 0;
          animation-name: tuRise; animation-timing-function: ease-out; animation-iteration-count: infinite;
        }
        .tu-conf {
          position: absolute; top: -24px; border-radius: 2px; opacity: 0;
          animation-name: tuFall; animation-timing-function: linear; animation-iteration-count: infinite;
        }

        /* 本体カード */
        .tu-card {
          position: relative; z-index: 10; text-align: center; max-width: 350px; width: 100%;
          padding: 26px 22px;
          background: rgba(10,8,20,0.66); border: 1px solid rgba(255,255,255,0.16);
          border-radius: 28px; box-shadow: 0 26px 90px rgba(0,0,0,0.7);
          animation: tuCardIn 0.6s cubic-bezier(.2,1.6,.35,1) 0.3s both;
        }
        .tu-kicker {
          font-size: 1.05rem; font-weight: 900; letter-spacing: 0.2em; margin: 0 0 6px;
          background: linear-gradient(100deg, #fff 20%, #ffe071 38%, #fff 52%, #ffe071 66%, #fff 84%);
          background-size: 300% 100%;
          -webkit-background-clip: text; background-clip: text; color: transparent;
          animation: tuShine 2.4s linear infinite;
        }
        .tu-icon-wrap { position: relative; display: flex; align-items: center; justify-content: center; height: 200px; }
        .tu-icon-halo {
          position: absolute; width: 250px; height: 250px; border-radius: 50%;
          filter: blur(16px); opacity: 0.7; animation: tuHalo 2.2s ease-in-out infinite;
        }
        .tu-icon {
          position: relative; display: inline-flex;
          animation: tuDrop 0.85s cubic-bezier(.16,1.5,.4,1) 0.35s both, tuFloat 3s ease-in-out 1.2s infinite;
        }
        .tu-tier {
          font-size: 2.6rem; font-weight: 900; margin: 6px 0 4px; letter-spacing: 0.08em; line-height: 1;
          animation: tuPunch 0.5s cubic-bezier(.2,1.8,.35,1) 0.62s both;
        }
        .tu-hours { font-size: 1.08rem; font-weight: 900; color: #fff; margin: 0 0 2px; animation: tuUp 0.45s ease-out 0.75s both; }
        .tu-level { font-size: 0.84rem; font-weight: 800; color: rgba(255,255,255,0.6); margin: 0 0 10px; animation: tuUp 0.45s ease-out 0.82s both; }
        .tu-msg { font-size: 0.86rem; color: rgba(255,255,255,0.84); margin: 0 0 16px; line-height: 1.55; animation: tuUp 0.45s ease-out 0.9s both; }
        .tu-ok {
          border: none; border-radius: 14px; padding: 13px 32px; color: #10121c;
          font-size: 0.96rem; font-weight: 900; cursor: pointer; font-family: inherit;
          animation: tuUp 0.45s ease-out 1s both;
        }
        .tu-ok:hover { opacity: 0.88; }

        @keyframes tuFlash   { 0% { opacity: 0.95; } 60% { opacity: 0.35; } 100% { opacity: 0; } }
        @keyframes tuShake {
          0%,100% { transform: translate(0,0); }
          10% { transform: translate(-9px, 5px); }
          22% { transform: translate(8px, -6px); }
          36% { transform: translate(-7px, -4px); }
          50% { transform: translate(6px, 5px); }
          66% { transform: translate(-4px, 2px); }
          82% { transform: translate(3px, -2px); }
        }
        @keyframes tuPillar  { 0% { opacity: 0; transform: scaleX(0.4); } 40% { opacity: 0.55; transform: scaleX(1.05); } 100% { opacity: 0; transform: scaleX(0.7); } }
        @keyframes tuRaysIn  { from { opacity: 0; } to { opacity: 0.42; } }
        @keyframes tuSpin    { to { transform: translate(-50%, -50%) rotate(360deg); } }
        @keyframes tuSpinR   { to { transform: translate(-50%, -50%) rotate(-360deg); } }
        @keyframes tuBreathe { 0%,100% { opacity: 0.42; transform: translate(-50%,-50%) scale(0.86); } 50% { opacity: 0.78; transform: translate(-50%,-50%) scale(1.1); } }
        @keyframes tuFlare   { 0%,100% { opacity: 0.15; transform: scaleX(0.7); } 50% { opacity: 0.7; transform: scaleX(1); } }
        @keyframes tuBurst   { 0% { opacity: 1; transform: scale(0.18); } 65% { opacity: 0.22; } 100% { opacity: 0; transform: scale(3.2); } }
        @keyframes tuRise    { 0% { opacity: 0; transform: translate(0,0) scale(0.5); } 12% { opacity: 1; } 100% { opacity: 0; transform: translate(var(--drift), -92vh) scale(1.25); } }
        @keyframes tuFall    { 0% { opacity: 0; transform: translateY(0) rotate(0deg); } 8% { opacity: 1; } 100% { opacity: 0.9; transform: translateY(108vh) rotate(var(--spin)); } }
        @keyframes tuCardIn  { from { opacity: 0; transform: scale(0.6) translateY(28px); } to { opacity: 1; transform: scale(1) translateY(0); } }
        @keyframes tuDrop    { 0% { opacity: 0; transform: scale(2.4) rotate(-26deg); } 60% { opacity: 1; } 100% { opacity: 1; transform: scale(1) rotate(0deg); } }
        @keyframes tuFloat   { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }
        @keyframes tuHalo    { 0%,100% { opacity: 0.45; transform: scale(0.85); } 50% { opacity: 0.85; transform: scale(1.08); } }
        @keyframes tuShine   { to { background-position: -300% 0; } }
        @keyframes tuPunch   { 0% { opacity: 0; transform: scale(2.2); filter: blur(6px); } 100% { opacity: 1; transform: scale(1); filter: blur(0); } }
        @keyframes tuUp      { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }

        @media (prefers-reduced-motion: reduce) {
          .tu-flash, .tu-shake, .tu-pillar, .tu-rays, .tu-glow, .tu-flare, .tu-ring,
          .tu-spark, .tu-conf, .tu-card, .tu-kicker, .tu-icon, .tu-icon-halo,
          .tu-tier, .tu-hours, .tu-level, .tu-msg, .tu-ok {
            animation: none !important;
          }
          .tu-flash { display: none; }
          .tu-rays, .tu-ring { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}
