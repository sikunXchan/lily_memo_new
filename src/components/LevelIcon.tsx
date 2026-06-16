'use client';

import { useState, useEffect } from 'react';
import type { LevelTier } from '@/lib/level';

// Shows the tier's icon image (falling back to its emoji until the PNG loads),
// wrapped with a tier-specific visual effect. Effects start at Tier 9 and get
// progressively flashier, climaxing in the all-out rainbow of Tier 15:
//   glow (T9) → glow2 (T10) → aura (T11) → aura2 (T12) → radiant (T13)
//   → radiant2 (T14) → rainbow (T15)
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

        /* ── T9 — soft ice/crystal glow ───────────────────────────── */
        .lvi-fx-glow .lvi-img, .lvi-fx-glow .lvi-emoji {
          animation: lviGlowC 2.8s ease-in-out infinite;
        }
        @keyframes lviGlowC {
          0%,100% { filter: drop-shadow(0 0 3px rgba(103,232,249,0.55)); }
          50%     { filter: drop-shadow(0 0 9px rgba(103,232,249,0.95)); }
        }

        /* ── T10 — stronger ice glow + float ──────────────────────── */
        .lvi-fx-glow2 .lvi-img, .lvi-fx-glow2 .lvi-emoji {
          animation: lviGlowC2 2.4s ease-in-out infinite, lviFloat 3.4s ease-in-out infinite;
        }
        @keyframes lviGlowC2 {
          0%,100% { filter: drop-shadow(0 0 4px rgba(56,189,248,0.7))  drop-shadow(0 0 9px rgba(186,230,253,0.4)); }
          50%     { filter: drop-shadow(0 0 11px rgba(56,189,248,1))   drop-shadow(0 0 16px rgba(186,230,253,0.7)); }
        }

        /* ── T11 — emerald aura + float ───────────────────────────── */
        .lvi-fx-aura::before {
          content: ''; position: absolute; inset: -15%; border-radius: 50%; z-index: 0;
          background: radial-gradient(circle, rgba(52,211,153,0.5), rgba(52,211,153,0) 66%);
          animation: lviAura 2.8s ease-in-out infinite;
        }
        .lvi-fx-aura .lvi-img, .lvi-fx-aura .lvi-emoji {
          animation: lviFloat 3.4s ease-in-out infinite;
          filter: drop-shadow(0 0 6px rgba(16,185,129,0.55));
        }

        /* ── T12 — emerald radiant aura + sparkle + float ─────────── */
        .lvi-fx-aura2::before {
          content: ''; position: absolute; inset: -20%; border-radius: 50%; z-index: 0;
          background: radial-gradient(circle, rgba(16,185,129,0.6), rgba(52,211,153,0) 68%);
          animation: lviAura 2.6s ease-in-out infinite;
        }
        .lvi-fx-aura2::after { content: ''; position: absolute; inset: -8%; z-index: 2;
          background:
            radial-gradient(circle 2px at 22% 30%, #d1fae5 60%, transparent 62%),
            radial-gradient(circle 2px at 80% 24%, #eafff0 60%, transparent 62%),
            radial-gradient(circle 1.5px at 70% 78%, #d1fae5 60%, transparent 62%);
          animation: lviSparkle 2.2s ease-in-out infinite;
        }
        .lvi-fx-aura2 .lvi-img, .lvi-fx-aura2 .lvi-emoji {
          animation: lviFloat 3.2s ease-in-out infinite;
          filter: drop-shadow(0 0 8px rgba(16,185,129,0.7));
        }

        /* ── T13 — holy white radiant ring + float ────────────────── */
        .lvi-fx-radiant::before {
          content: ''; position: absolute; inset: -18%; border-radius: 50%; z-index: 0;
          background: radial-gradient(circle, rgba(199,210,254,0.65), rgba(199,210,254,0) 66%);
          animation: lviAura 3s ease-in-out infinite;
        }
        .lvi-fx-radiant .lvi-img, .lvi-fx-radiant .lvi-emoji {
          animation: lviFloat 3.2s ease-in-out infinite;
          filter: drop-shadow(0 0 8px rgba(199,210,254,0.85));
        }

        /* ── T14 — holy aura + rotating halo + sparkle + float ────── */
        .lvi-fx-radiant2::before {
          content: ''; position: absolute; inset: -22%; border-radius: 50%; z-index: 0;
          background: conic-gradient(from 0deg, rgba(224,231,255,0), rgba(165,180,252,0.9), rgba(224,231,255,0), rgba(199,210,254,0.9), rgba(224,231,255,0));
          filter: blur(8px); opacity: 0.8;
          animation: lviSpin 7s linear infinite;
        }
        .lvi-fx-radiant2::after { content: ''; position: absolute; inset: -10%; z-index: 2;
          background:
            radial-gradient(circle 2.5px at 20% 28%, #fff 60%, transparent 62%),
            radial-gradient(circle 2px at 82% 32%, #e0e7ff 60%, transparent 62%),
            radial-gradient(circle 2px at 50% 86%, #fff 60%, transparent 62%),
            radial-gradient(circle 1.5px at 72% 70%, #c7d2fe 60%, transparent 62%);
          animation: lviSparkle 1.9s ease-in-out infinite;
        }
        .lvi-fx-radiant2 .lvi-img, .lvi-fx-radiant2 .lvi-emoji {
          animation: lviFloat 3s ease-in-out infinite;
          filter: drop-shadow(0 0 10px rgba(199,210,254,0.95));
        }

        /* ── T15 — RAINBOW MAX: spinning halo + pulse + sparkles + float ── */
        .lvi-fx-rainbow::before {
          content: ''; position: absolute; inset: -26%; border-radius: 50%; z-index: 0;
          background: conic-gradient(from 0deg, #ff5e5e, #ffd24d, #5eff8b, #5ec8ff, #b15eff, #ff5ec8, #ff5e5e);
          filter: blur(14px); opacity: 0.7;
          animation: lviSpin 5s linear infinite, lviPulse 2.2s ease-in-out infinite;
        }
        .lvi-fx-rainbow::after { content: ''; position: absolute; inset: -12%; z-index: 2;
          background:
            radial-gradient(circle 3px at 18% 26%, #fff 60%, transparent 62%),
            radial-gradient(circle 2.5px at 84% 30%, #ffe9a8 60%, transparent 62%),
            radial-gradient(circle 2.5px at 30% 80%, #a8f0ff 60%, transparent 62%),
            radial-gradient(circle 2px at 76% 74%, #ffc4f0 60%, transparent 62%),
            radial-gradient(circle 2px at 52% 12%, #fff 60%, transparent 62%);
          animation: lviSparkle 1.6s ease-in-out infinite;
        }
        .lvi-fx-rainbow .lvi-img, .lvi-fx-rainbow .lvi-emoji {
          animation: lviFloat 2.8s ease-in-out infinite, lviHue 4s linear infinite;
        }

        /* ── shared keyframes ─────────────────────────────────────── */
        @keyframes lviAura    { 0%,100% { opacity: 0.45; transform: scale(0.94); } 50% { opacity: 0.9; transform: scale(1.07); } }
        @keyframes lviSpin    { to { transform: rotate(360deg); } }
        @keyframes lviPulse   { 0%,100% { opacity: 0.55; } 50% { opacity: 0.95; } }
        @keyframes lviFloat   { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-6%); } }
        @keyframes lviSparkle { 0%,100% { opacity: 0.25; transform: scale(0.9) rotate(0deg); } 50% { opacity: 1; transform: scale(1.1) rotate(8deg); } }
        @keyframes lviHue     {
          0%,100% { filter: drop-shadow(0 0 8px rgba(255,94,200,0.9)); }
          33%     { filter: drop-shadow(0 0 10px rgba(94,200,255,0.9)); }
          66%     { filter: drop-shadow(0 0 10px rgba(94,255,139,0.9)); }
        }

        @media (prefers-reduced-motion: reduce) {
          .lvi-img, .lvi-emoji,
          .lvi-fx-aura::before, .lvi-fx-aura2::before, .lvi-fx-aura2::after,
          .lvi-fx-radiant::before, .lvi-fx-radiant2::before, .lvi-fx-radiant2::after,
          .lvi-fx-rainbow::before, .lvi-fx-rainbow::after {
            animation: none !important;
          }
        }
      `}</style>
    </span>
  );
}
