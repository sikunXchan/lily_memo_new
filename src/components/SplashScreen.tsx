'use client';

import { useEffect, useMemo, useState } from 'react';

// One of nine seasonal LILY MEMO scenes, picked at random each launch.
const SCENES = [
  '/splash-01.png', '/splash-02.png', '/splash-03.png',
  '/splash-04.png', '/splash-05.png', '/splash-06.png',
  '/splash-07.png', '/splash-08.png', '/splash-09.png',
];

const FADE_MS = 500;
const SESSION_KEY = 'lily-splash-shown';
const PALETTE = ['#ff8ec7', '#ffd66e', '#8ee6c6', '#c79bff', '#8ec9ff', '#fff7b0'];

type Particle = { tx: number; ty: number; color: string; size: number };
type Burst = { x: number; y: number; delay: number; particles: Particle[] };
type Star = { x: number; y: number; size: number; delay: number; dur: number; color: string };

function buildBursts(): Burst[] {
  const bursts: Burst[] = [];
  for (let b = 0; b < 6; b++) {
    const count = 12 + Math.floor(Math.random() * 4);
    const radius = 70 + Math.random() * 70;
    const hue = PALETTE[b % PALETTE.length];
    const particles: Particle[] = [];
    for (let i = 0; i < count; i++) {
      const ang = (Math.PI * 2 * i) / count + Math.random() * 0.2;
      const r = radius * (0.7 + Math.random() * 0.5);
      particles.push({
        tx: Math.cos(ang) * r,
        ty: Math.sin(ang) * r,
        color: Math.random() < 0.3 ? '#ffffff' : hue,
        size: 5 + Math.random() * 5,
      });
    }
    bursts.push({
      x: 12 + Math.random() * 76,
      y: 12 + Math.random() * 70,
      delay: Math.random() * 2.2,
      particles,
    });
  }
  return bursts;
}

function buildStars(): Star[] {
  return Array.from({ length: 28 }, () => ({
    x: Math.random() * 100,
    y: Math.random() * 100,
    size: 3 + Math.random() * 6,
    delay: Math.random() * 3,
    dur: 1.6 + Math.random() * 2,
    color: PALETTE[Math.floor(Math.random() * PALETTE.length)],
  }));
}

export default function SplashScreen() {
  const [scene, setScene] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const bursts = useMemo(() => buildBursts(), []);
  const stars = useMemo(() => buildStars(), []);

  useEffect(() => {
    if (sessionStorage.getItem(SESSION_KEY)) return; // once per launch
    sessionStorage.setItem(SESSION_KEY, '1');
    setScene(SCENES[Math.floor(Math.random() * SCENES.length)]);
  }, []);

  const dismiss = () => {
    if (closing) return;
    setClosing(true);
    window.setTimeout(() => setScene(null), FADE_MS);
  };

  if (!scene) return null;

  return (
    <div className={`splash ${closing ? 'closing' : ''}`} onClick={dismiss} role="button" aria-label="はじめる">
      {/* twinkling background stars */}
      <div className="layer">
        {stars.map((s, i) => (
          <span
            key={`s${i}`}
            className="star"
            style={{
              left: `${s.x}%`, top: `${s.y}%`,
              width: s.size, height: s.size,
              background: s.color, color: s.color,
              animationDelay: `${s.delay}s`, animationDuration: `${s.dur}s`,
            }}
          />
        ))}
      </div>

      {/* glowing scene */}
      <div className="scene-wrap">
        <span className="glow" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={scene} alt="" className="splash-img" />
        <span className="shimmer" />
      </div>

      {/* firework bursts */}
      <div className="layer">
        {bursts.map((b, bi) => (
          <span key={`b${bi}`} className="burst" style={{ left: `${b.x}%`, top: `${b.y}%` }}>
            {b.particles.map((p, pi) => (
              <span
                key={pi}
                className="spark"
                style={{
                  width: p.size, height: p.size, background: p.color,
                  boxShadow: `0 0 8px ${p.color}`,
                  // @ts-expect-error custom props
                  '--tx': `${p.tx}px`, '--ty': `${p.ty}px`,
                  animationDelay: `${b.delay}s`,
                }}
              />
            ))}
          </span>
        ))}
      </div>

      <div className="tap-hint">タップしてはじめる ✨</div>

      <style jsx>{`
        .splash {
          position: fixed; inset: 0; z-index: 99999; overflow: hidden;
          display: flex; align-items: center; justify-content: center;
          background:
            radial-gradient(120% 90% at 50% 40%, color-mix(in srgb, var(--primary) 14%, transparent), transparent 70%),
            var(--background, #fff);
          animation: splashIn 0.4s ease both;
          transition: opacity ${FADE_MS}ms ease;
          cursor: pointer;
        }
        .splash.closing { opacity: 0; pointer-events: none; }
        .layer { position: absolute; inset: 0; pointer-events: none; }

        .scene-wrap {
          position: relative;
          display: flex; align-items: center; justify-content: center;
          animation: pop 0.9s cubic-bezier(0.18, 1.3, 0.4, 1) both, float 4s ease-in-out 0.9s infinite;
        }
        .splash-img {
          position: relative; z-index: 1;
          max-width: min(86vw, 520px); max-height: 74vh;
          width: auto; height: auto; object-fit: contain;
          border-radius: 18px;
          filter: drop-shadow(0 14px 36px rgba(0,0,0,0.28));
        }
        .glow {
          position: absolute; inset: -8%; z-index: 0; border-radius: 50%;
          background: radial-gradient(circle, color-mix(in srgb, var(--primary) 55%, #fff) 0%, transparent 62%);
          filter: blur(26px); opacity: 0.85;
          animation: pulse 2.6s ease-in-out infinite;
        }
        .shimmer {
          position: absolute; inset: 0; z-index: 2; border-radius: 18px; overflow: hidden;
          background: linear-gradient(115deg, transparent 35%, rgba(255,255,255,0.65) 50%, transparent 65%);
          background-size: 280% 100%;
          mix-blend-mode: screen;
          animation: sweep 2.8s ease-in-out 0.6s infinite;
        }

        .star {
          position: absolute; border-radius: 50%;
          box-shadow: 0 0 8px currentColor, 0 0 14px currentColor;
          animation: twinkle ease-in-out infinite alternate;
        }

        .burst { position: absolute; width: 0; height: 0; }
        .spark {
          position: absolute; left: 0; top: 0; border-radius: 50%;
          opacity: 0;
          animation: explode 1.5s ease-out infinite;
        }

        .tap-hint {
          position: absolute; bottom: max(7vh, 28px); left: 0; right: 0;
          text-align: center; font-weight: 800; font-size: 1rem;
          color: var(--foreground); letter-spacing: 0.03em;
          text-shadow: 0 1px 8px color-mix(in srgb, var(--primary) 50%, transparent);
          animation: hintPulse 1.5s ease-in-out infinite;
          pointer-events: none;
        }

        @keyframes splashIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes pop { 0% { transform: scale(0.6); opacity: 0; } 60% { opacity: 1; } 100% { transform: scale(1); } }
        @keyframes float { 0%,100% { translate: 0 0; } 50% { translate: 0 -10px; } }
        @keyframes pulse { 0%,100% { transform: scale(1); opacity: 0.7; } 50% { transform: scale(1.08); opacity: 1; } }
        @keyframes sweep { 0% { background-position: 160% 0; } 55%,100% { background-position: -160% 0; } }
        @keyframes twinkle { from { opacity: 0.15; transform: scale(0.7); } to { opacity: 1; transform: scale(1.15); } }
        @keyframes explode {
          0% { transform: translate(0,0) scale(0.3); opacity: 0; }
          12% { opacity: 1; }
          70% { opacity: 1; }
          100% { transform: translate(var(--tx), var(--ty)) scale(1); opacity: 0; }
        }
        @keyframes hintPulse { 0%,100% { opacity: 0.55; transform: translateY(0); } 50% { opacity: 1; transform: translateY(-3px); } }

        @media (prefers-reduced-motion: reduce) {
          .scene-wrap, .glow, .shimmer, .star, .spark, .tap-hint { animation: none; }
          .spark { display: none; }
        }
      `}</style>
    </div>
  );
}
