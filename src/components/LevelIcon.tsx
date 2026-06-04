'use client';

import { useState, useEffect } from 'react';
import type { LevelTier } from '@/lib/level';

// Shows the tier's icon image (falling back to its emoji until the PNG loads),
// wrapped with a tier-specific visual effect for Tier 6+ (glow / radiant aura /
// rainbow halo).
export default function LevelIcon({ tier, size }: { tier: LevelTier; size: number }) {
  const [err, setErr] = useState(false);
  useEffect(() => { setErr(false); }, [tier.icon]);

  return (
    <span className={`lvi lvi-fx-${tier.fx}`} style={{ width: size, height: size }}>
      {err ? (
        <span className="lvi-emoji" style={{ fontSize: Math.round(size * 0.82) }}>{tier.emoji}</span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className="lvi-img"
          src={tier.icon}
          alt=""
          width={size}
          height={size}
          draggable={false}
          onError={() => setErr(true)}
        />
      )}

      <style jsx>{`
        .lvi { position: relative; display: inline-flex; align-items: center; justify-content: center; }
        .lvi-img { object-fit: contain; display: block; position: relative; z-index: 1; }
        .lvi-emoji { line-height: 1; display: inline-block; position: relative; z-index: 1; }

        /* Tier 6 — gold glow */
        .lvi-fx-glow .lvi-img, .lvi-fx-glow .lvi-emoji {
          animation: lviGlow 2.6s ease-in-out infinite;
        }
        @keyframes lviGlow {
          0%,100% { filter: drop-shadow(0 0 3px rgba(245,158,11,0.55)); }
          50%     { filter: drop-shadow(0 0 9px rgba(245,158,11,0.95)); }
        }

        /* Tier 7 — stronger gold + crimson glow */
        .lvi-fx-glow2 .lvi-img, .lvi-fx-glow2 .lvi-emoji {
          animation: lviGlow2 2.4s ease-in-out infinite;
        }
        @keyframes lviGlow2 {
          0%,100% { filter: drop-shadow(0 0 4px rgba(251,191,36,0.7)) drop-shadow(0 0 9px rgba(239,68,68,0.35)); }
          50%     { filter: drop-shadow(0 0 11px rgba(253,224,71,1))  drop-shadow(0 0 16px rgba(239,68,68,0.6)); }
        }

        /* Tier 8 — radiant aura + float */
        .lvi-fx-radiant::before {
          content: ''; position: absolute; inset: -16%; border-radius: 50%; z-index: 0;
          background: radial-gradient(circle, rgba(255,213,90,0.55), rgba(255,213,90,0) 66%);
          animation: lviAura 2.8s ease-in-out infinite;
        }
        .lvi-fx-radiant .lvi-img, .lvi-fx-radiant .lvi-emoji { animation: lviFloat 3.2s ease-in-out infinite; }

        /* Tier 9 — rainbow halo + float */
        .lvi-fx-rainbow::before {
          content: ''; position: absolute; inset: -20%; border-radius: 50%; z-index: 0;
          background: conic-gradient(from 0deg, #ff5e5e, #ffd24d, #5eff8b, #5ec8ff, #b15eff, #ff5e5e);
          filter: blur(13px); opacity: 0.55;
          animation: lviSpin 6s linear infinite;
        }
        .lvi-fx-rainbow .lvi-img, .lvi-fx-rainbow .lvi-emoji { animation: lviFloat 3.2s ease-in-out infinite; }

        @keyframes lviAura  { 0%,100% { opacity: 0.45; transform: scale(0.94); } 50% { opacity: 0.85; transform: scale(1.06); } }
        @keyframes lviSpin  { to { transform: rotate(360deg); } }
        @keyframes lviFloat { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-6%); } }

        @media (prefers-reduced-motion: reduce) {
          .lvi-img, .lvi-emoji, .lvi-fx-radiant::before, .lvi-fx-rainbow::before { animation: none !important; }
        }
      `}</style>
    </span>
  );
}
