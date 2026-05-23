'use client';

import { useEffect, useState } from 'react';

// One of nine seasonal LILY MEMO scenes, picked at random each launch.
const SCENES = [
  '/splash-01.png', '/splash-02.png', '/splash-03.png',
  '/splash-04.png', '/splash-05.png', '/splash-06.png',
  '/splash-07.png', '/splash-08.png', '/splash-09.png',
];

const VISIBLE_MS = 1900;   // hold before fading out
const FADE_MS = 500;       // fade-out duration
const SESSION_KEY = 'lily-splash-shown';

export default function SplashScreen() {
  const [scene, setScene] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (sessionStorage.getItem(SESSION_KEY)) return; // once per launch
    sessionStorage.setItem(SESSION_KEY, '1');
    setScene(SCENES[Math.floor(Math.random() * SCENES.length)]);
    const hold = window.setTimeout(() => setClosing(true), VISIBLE_MS);
    const done = window.setTimeout(() => setScene(null), VISIBLE_MS + FADE_MS);
    return () => { window.clearTimeout(hold); window.clearTimeout(done); };
  }, []);

  if (!scene) return null;

  return (
    <div
      className={`splash ${closing ? 'closing' : ''}`}
      onClick={() => setClosing(true)}
      aria-hidden
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={scene} alt="" className="splash-img" />
      <style jsx>{`
        .splash {
          position: fixed; inset: 0; z-index: 99999;
          display: flex; align-items: center; justify-content: center;
          background: var(--background, #fff);
          animation: splashIn 0.35s ease both;
          transition: opacity ${FADE_MS}ms ease;
        }
        .splash.closing { opacity: 0; pointer-events: none; }
        .splash-img {
          max-width: 100%; max-height: 100%;
          width: auto; height: auto; object-fit: contain;
          animation: splashZoom 2.4s ease-out both;
        }
        @keyframes splashIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes splashZoom { from { transform: scale(1.04); } to { transform: scale(1); } }
      `}</style>
    </div>
  );
}
