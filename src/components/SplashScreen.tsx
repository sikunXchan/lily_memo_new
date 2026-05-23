'use client';
import { useEffect, useMemo, useRef, useState } from 'react';

const SCENES = [
  '/splash-01.png', '/splash-02.png', '/splash-03.png',
  '/splash-04.png', '/splash-05.png', '/splash-06.png',
  '/splash-07.png', '/splash-08.png', '/splash-09.png',
];
const FADE_MS = 1200;
const SESSION_KEY = 'lily-splash-shown';
const PAL = ['#ff8ec7', '#ffd66e', '#8ee6c6', '#c79bff', '#8ec9ff', '#fff7b0', '#ffb0cc', '#b0f4e6'];

type Particle = { tx: number; ty: number; color: string; size: number };
type Burst   = { x: number; y: number; delay: number; dur: number; particles: Particle[] };
type Star    = { x: number; y: number; size: number; delay: number; dur: number; color: string };
type Orb     = { angle: number; size: number; color: string };
type Comet   = { x: number; y: number; delay: number; dur: number; len: number };

function buildBursts(): Burst[] {
  return Array.from({ length: 10 }, (_, b) => {
    const count = 14 + Math.floor(Math.random() * 6);
    const radius = 80 + Math.random() * 90;
    const color = PAL[b % PAL.length];
    return {
      x: 8 + Math.random() * 84,
      y: 8 + Math.random() * 78,
      delay: Math.random() * 2.8,
      dur: 1.2 + Math.random() * 0.6,
      particles: Array.from({ length: count }, (__, i) => {
        const ang = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.3;
        const r = radius * (0.6 + Math.random() * 0.6);
        return { tx: Math.cos(ang) * r, ty: Math.sin(ang) * r, color: Math.random() < 0.2 ? '#fff' : color, size: 5 + Math.random() * 6 };
      }),
    };
  });
}

function buildStars(): Star[] {
  return Array.from({ length: 40 }, () => ({
    x: Math.random() * 100, y: Math.random() * 100,
    size: 3 + Math.random() * 7,
    delay: Math.random() * 4, dur: 1.2 + Math.random() * 2.5,
    color: PAL[Math.floor(Math.random() * PAL.length)],
  }));
}

function buildOrbs(): Orb[] {
  return Array.from({ length: 10 }, (_, i) => ({
    angle: (360 / 10) * i,
    size: 14 + Math.floor(Math.random() * 10),
    color: PAL[i % PAL.length],
  }));
}

function buildComets(): Comet[] {
  return Array.from({ length: 5 }, (_, i) => ({
    x: 5 + Math.random() * 40,
    y: 4 + i * 12,
    delay: i * 1.4 + Math.random() * 0.6,
    dur: 1.6 + Math.random() * 1.4,
    len: 80 + Math.floor(Math.random() * 90),
  }));
}

export default function SplashScreen() {
  const [scene, setScene] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const bursts = useMemo(() => buildBursts(), []);
  const stars  = useMemo(() => buildStars(),  []);
  const orbs   = useMemo(() => buildOrbs(),   []);
  const comets = useMemo(() => buildComets(), []);

  useEffect(() => {
    if (sessionStorage.getItem(SESSION_KEY)) return;
    sessionStorage.setItem(SESSION_KEY, '1');
    setScene(SCENES[Math.floor(Math.random() * SCENES.length)]);
  }, []);

  // Canvas confetti / glitter
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !scene) return;
    const ctx = canvas.getContext('2d')!;

    const resize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
    resize();
    window.addEventListener('resize', resize);

    const pieces = Array.from({ length: 72 }, () => ({
      x: Math.random() * window.innerWidth,
      y: -50 - Math.random() * 300,
      vx: (Math.random() - 0.5) * 1.4,
      vy: 0.7 + Math.random() * 1.8,
      rot: Math.random() * Math.PI * 2,
      vrot: (Math.random() - 0.5) * 0.08,
      w: 5 + Math.random() * 10,
      h: 3 + Math.random() * 5,
      color: PAL[Math.floor(Math.random() * PAL.length)],
      alpha: 0.55 + Math.random() * 0.45,
      circle: Math.random() < 0.35,
    }));

    let animId = 0;
    let alive = true;

    const tick = () => {
      if (!alive) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const p of pieces) {
        p.x += p.vx; p.y += p.vy; p.rot += p.vrot;
        if (p.y > canvas.height + 40) { p.y = -40; p.x = Math.random() * canvas.width; }
        ctx.save();
        ctx.globalAlpha = p.alpha;
        ctx.fillStyle = p.color;
        ctx.shadowBlur = 10; ctx.shadowColor = p.color;
        ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        if (p.circle) { ctx.beginPath(); ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2); ctx.fill(); }
        else { ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); }
        ctx.restore();
      }
      animId = requestAnimationFrame(tick);
    };
    tick();

    return () => { alive = false; cancelAnimationFrame(animId); window.removeEventListener('resize', resize); };
  }, [scene]);

  const dismiss = () => {
    if (closing) return;
    setClosing(true);
    window.setTimeout(() => setScene(null), FADE_MS);
  };

  if (!scene) return null;

  return (
    <div className={`splash ${closing ? 'closing' : ''}`} onClick={dismiss} role="button" aria-label="はじめる">

      {/* Aurora gradient background */}
      <div className="aurora" />

      {/* Rotating sunrays */}
      <div className="sunrays" />

      {/* Falling confetti (canvas) */}
      <canvas ref={canvasRef} className="confetti-canvas" />

      {/* Expanding ripple rings */}
      <div className="rings-layer">
        {[0, 0.85, 1.7, 2.55].map((d, i) => (
          <div key={i} className="ring" style={{ animationDelay: `${d}s` }} />
        ))}
      </div>

      {/* Twinkling stars */}
      <div className="layer">
        {stars.map((s, i) => (
          <span key={`s${i}`} className="star" style={{
            left: `${s.x}%`, top: `${s.y}%`, width: s.size, height: s.size,
            background: s.color, boxShadow: `0 0 ${s.size * 2}px ${s.color}`,
            animationDelay: `${s.delay}s`, animationDuration: `${s.dur}s`,
          }} />
        ))}
      </div>

      {/* Shooting comets */}
      <div className="layer">
        {comets.map((c, i) => (
          <span key={`c${i}`} className="comet" style={{
            left: `${c.x}%`, top: `${c.y}%`, width: c.len,
            animationDelay: `${c.delay}s`, animationDuration: `${c.dur}s`,
          }} />
        ))}
      </div>

      {/* Main scene */}
      <div className="scene-wrap">
        {/* Orbiting sparkles */}
        <div className="orbit-ring">
          {orbs.map((o, i) => (
            <span key={`o${i}`} className="orb" style={{
              fontSize: o.size, color: o.color,
              textShadow: `0 0 12px ${o.color}, 0 0 28px ${o.color}`,
              transform: `rotate(${o.angle}deg) translateX(260px) rotate(-${o.angle}deg)`,
            }}>✦</span>
          ))}
        </div>

        <span className="glow" />
        <span className="glow-ring" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={scene} alt="" className="splash-img" />
        <span className="shimmer" />
        <span className="shimmer shimmer2" />
      </div>

      {/* Firework bursts (CSS) */}
      <div className="layer">
        {bursts.map((b, bi) => (
          <span key={`b${bi}`} className="burst" style={{ left: `${b.x}%`, top: `${b.y}%` }}>
            {b.particles.map((p, pi) => (
              <span key={pi} className="spark" style={{
                width: p.size, height: p.size, background: p.color,
                boxShadow: `0 0 8px ${p.color}, 0 0 18px ${p.color}`,
                // @ts-expect-error CSS custom properties
                '--tx': `${p.tx}px`, '--ty': `${p.ty}px`,
                animationDelay: `${b.delay}s`, animationDuration: `${b.dur}s`,
              }} />
            ))}
          </span>
        ))}
      </div>

      {/* Tap hint */}
      <div className="tap-hint">✨ タップしてはじめる ✨</div>

      <style jsx>{`
        .splash {
          position: fixed; inset: 0; z-index: 99999; overflow: hidden;
          display: flex; align-items: center; justify-content: center;
          cursor: pointer;
          animation: fadeIn 0.45s ease both;
        }
        .splash.closing { animation: fadeOut ${FADE_MS}ms ease-in forwards; pointer-events: none; }
        .layer { position: absolute; inset: 0; pointer-events: none; }

        /* ── Aurora ── */
        .aurora {
          position: absolute; inset: 0; pointer-events: none;
          background:
            radial-gradient(ellipse 70% 60% at 18% 28%, rgba(255,182,240,0.6) 0%, transparent 58%),
            radial-gradient(ellipse 60% 70% at 82% 72%, rgba(180,220,255,0.55) 0%, transparent 58%),
            radial-gradient(ellipse 80% 80% at 50% 50%, rgba(255,240,200,0.45) 0%, transparent 65%),
            linear-gradient(160deg, #fff5fb 0%, #f0f5ff 55%, #fff8f0 100%);
          animation: auroraDrift 7s ease-in-out infinite alternate;
        }
        @keyframes auroraDrift {
          0%   { filter: hue-rotate(0deg)   brightness(1);    }
          50%  { filter: hue-rotate(18deg)  brightness(1.07); }
          100% { filter: hue-rotate(-18deg) brightness(0.95); }
        }

        /* ── Sunrays ── */
        .sunrays {
          position: absolute; width: 720px; height: 720px;
          left: 50%; top: 50%; border-radius: 50%; pointer-events: none;
          background: repeating-conic-gradient(rgba(255,215,240,0.13) 0deg 7deg, transparent 7deg 30deg);
          animation: spinRays 20s linear infinite;
        }
        @keyframes spinRays {
          from { transform: translate(-50%,-50%) rotate(0deg); }
          to   { transform: translate(-50%,-50%) rotate(360deg); }
        }

        /* ── Canvas ── */
        .confetti-canvas {
          position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none;
        }

        /* ── Rings ── */
        .rings-layer { position: absolute; inset: 0; pointer-events: none; }
        .ring {
          position: absolute; width: 380px; height: 380px; border-radius: 50%;
          left: 50%; top: 50%;
          border: 2px solid rgba(255,155,210,0.65);
          animation: ringExpand 3.2s ease-out infinite;
        }
        @keyframes ringExpand {
          0%   { transform: translate(-50%,-50%) scale(0.12); opacity: 1; }
          100% { transform: translate(-50%,-50%) scale(3.4);  opacity: 0; }
        }

        /* ── Stars ── */
        .star { position: absolute; border-radius: 50%; animation: twinkle ease-in-out infinite alternate; }
        @keyframes twinkle { from { opacity: 0.1; transform: scale(0.6); } to { opacity: 1; transform: scale(1.25); } }

        /* ── Comets ── */
        .comet {
          position: absolute; height: 2px; border-radius: 1px; pointer-events: none;
          background: linear-gradient(to right, transparent, rgba(255,255,255,0.95), rgba(255,220,255,0.5), transparent);
          box-shadow: 0 0 8px rgba(255,255,255,0.8);
          animation: shoot ease-out infinite;
        }
        @keyframes shoot {
          0%   { transform: translate(0,0) rotate(-28deg); opacity: 0; }
          5%   { opacity: 1; }
          55%  { opacity: 0.9; }
          100% { transform: translate(110vw, 65vh) rotate(-28deg); opacity: 0; }
        }

        /* ── Scene ── */
        .scene-wrap {
          position: relative; z-index: 2;
          display: flex; align-items: center; justify-content: center;
          animation: pop 1s cubic-bezier(0.16,1.4,0.35,1) both, floatY 4.5s ease-in-out 1s infinite;
        }
        @keyframes pop    { 0% { transform: scale(0.45); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }
        @keyframes floatY { 0%,100% { translate: 0 0px; } 50% { translate: 0 -13px; } }

        .splash-img {
          position: relative; z-index: 2;
          max-width: min(84vw, 510px); max-height: 72vh;
          object-fit: contain; border-radius: 20px;
          filter: drop-shadow(0 18px 44px rgba(0,0,0,0.3));
        }

        .glow {
          position: absolute; inset: -14%; z-index: 0; border-radius: 50%;
          background: radial-gradient(circle, rgba(255,155,220,0.9) 0%, rgba(200,165,255,0.55) 40%, transparent 68%);
          filter: blur(32px);
          animation: glowPulse 3s ease-in-out infinite, glowHue 5s linear infinite;
        }
        @keyframes glowPulse { 0%,100% { opacity: 0.65; transform: scale(1); }  50% { opacity: 1; transform: scale(1.12); } }
        @keyframes glowHue   { to { filter: blur(32px) hue-rotate(360deg); } }

        .glow-ring {
          position: absolute; inset: -6px; z-index: 1; border-radius: 25px; pointer-events: none;
          border: 3px solid rgba(255,150,200,0.85);
          background: transparent;
          animation: rainbowBorder 4s linear infinite;
        }
        @keyframes rainbowBorder { to { filter: hue-rotate(360deg); } }

        .shimmer {
          position: absolute; inset: 0; z-index: 3; border-radius: 20px;
          background: linear-gradient(115deg, transparent 28%, rgba(255,255,255,0.72) 46%, rgba(255,235,255,0.45) 54%, transparent 72%);
          background-size: 300% 100%;
          mix-blend-mode: screen;
          animation: sweep 3.2s ease-in-out 0.7s infinite;
        }
        .shimmer2 {
          background: linear-gradient(245deg, transparent 28%, rgba(200,255,255,0.4) 46%, rgba(255,255,200,0.3) 54%, transparent 72%);
          background-size: 300% 100%;
          animation: sweep 3.2s ease-in-out 2.2s infinite;
          mix-blend-mode: overlay;
        }
        @keyframes sweep {
          0%      { background-position: 210% 0; }
          65%,100% { background-position: -210% 0; }
        }

        /* ── Orbit ── */
        .orbit-ring {
          position: absolute; width: 560px; height: 560px;
          left: 50%; top: 50%; pointer-events: none; z-index: 0;
          animation: spinOrbit 12s linear infinite;
        }
        @keyframes spinOrbit {
          from { transform: translate(-50%,-50%) rotate(0deg); }
          to   { transform: translate(-50%,-50%) rotate(360deg); }
        }
        .orb {
          position: absolute; left: 50%; top: 50%; line-height: 1;
          animation: orbPulse 2s ease-in-out infinite alternate;
        }
        @keyframes orbPulse { from { opacity: 0.55; } to { opacity: 1; filter: brightness(1.5); } }

        /* ── Fireworks ── */
        .burst { position: absolute; width: 0; height: 0; pointer-events: none; }
        .spark {
          position: absolute; left: 0; top: 0; border-radius: 50%; opacity: 0;
          animation: explode ease-out infinite;
        }
        @keyframes explode {
          0%   { transform: translate(0,0) scale(0.2); opacity: 0; }
          10%  { opacity: 1; }
          65%  { opacity: 1; }
          100% { transform: translate(var(--tx), var(--ty)) scale(1.2); opacity: 0; }
        }

        /* ── Tap hint ── */
        .tap-hint {
          position: absolute; bottom: max(6vh, 24px); left: 0; right: 0;
          text-align: center; font-weight: 900; font-size: 1.05rem;
          letter-spacing: 0.05em; pointer-events: none;
          animation: hintFloat 1.7s ease-in-out infinite, hintColor 3s linear infinite;
        }
        @keyframes hintFloat { 0%,100% { transform: translateY(0); opacity: 0.6; } 50% { transform: translateY(-6px); opacity: 1; } }
        @keyframes hintColor {
          0%   { color: #ff8ec7; text-shadow: 0 0 18px #ff8ec7; }
          25%  { color: #ffd66e; text-shadow: 0 0 18px #ffd66e; }
          50%  { color: #8ee6c6; text-shadow: 0 0 18px #8ee6c6; }
          75%  { color: #c79bff; text-shadow: 0 0 18px #c79bff; }
          100% { color: #ff8ec7; text-shadow: 0 0 18px #ff8ec7; }
        }

        @keyframes fadeIn  { from { opacity: 0; } to { opacity: 1; } }
        @keyframes fadeOut { from { opacity: 1; } to { opacity: 0; } }

        @media (prefers-reduced-motion: reduce) {
          .aurora, .sunrays, .star, .spark, .comet, .glow, .glow-ring,
          .shimmer, .shimmer2, .orbit-ring, .ring, .orb, .tap-hint, .scene-wrap { animation: none !important; }
          .spark, .comet { display: none; }
        }
      `}</style>
    </div>
  );
}
