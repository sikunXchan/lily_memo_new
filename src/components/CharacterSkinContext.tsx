'use client';

import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { CHARACTER_SKINS, CHARACTER_SKIN_STORAGE_KEY, SKIN_BASE_PATH, AVATAR_FRAME_SCALE } from '@/lib/characterSkins';
import { getOwnedSkinIds } from '@/lib/gacha';

interface CharacterSkinContextValue {
  skinId: string; // '' = default (unmodified mascot)
  setSkinId: (id: string) => void;
  // Skins currently owned (won from the gacha, or granted by the old
  // all-at-once unlock code). Selecting an unowned skin is a no-op.
  ownedSkinIds: string[];
  // Re-reads owned skins from storage — call after a gacha pull grants one.
  refreshOwnedSkins: () => void;
  // Returns the active skin's costume image path, or `fallback` when no skin
  // is set (or the skin has no costume art yet).
  avatarSrc: (fallback: string) => string;
  // Resolved chat-screen background image path (R以上), or undefined.
  backgroundSrc?: string;
  // Resolved background for home / memo tree / other screens (R以上).
  // UR skins use their dedicated homeBackground; R skins reuse the chat one.
  homeBackgroundSrc?: string;
  // Resolved floating-particle image paths for the UR ambient effect.
  ambientSrcs?: string[];
  // Resolved decorative avatar-frame-ring image path, or undefined.
  avatarFrameSrc?: string;
}

const CharacterSkinContext = createContext<CharacterSkinContextValue>({
  skinId: '',
  setSkinId: () => {},
  ownedSkinIds: [],
  refreshOwnedSkins: () => {},
  avatarSrc: (fallback) => fallback,
});

export function CharacterSkinProvider({ children }: { children: React.ReactNode }) {
  const [skinId, setSkinIdState] = useState('');
  const [ownedSkinIds, setOwnedSkinIds] = useState<string[]>([]);

  const refreshOwnedSkins = useCallback(() => {
    setOwnedSkinIds(getOwnedSkinIds());
  }, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(CHARACTER_SKIN_STORAGE_KEY) || '';
      if (saved && CHARACTER_SKINS.some(s => s.id === saved)) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setSkinIdState(saved);
      }
    } catch { /* localStorage unavailable */ }
    refreshOwnedSkins();
  }, [refreshOwnedSkins]);

  // If a skin somehow becomes unowned (shouldn't normally happen since
  // gacha wins are permanent), don't leave a broken/inaccessible skin selected.
  useEffect(() => {
    if (skinId && !ownedSkinIds.includes(skinId)) setSkinIdState('');
  }, [skinId, ownedSkinIds]);

  const setSkinId = useCallback((id: string) => {
    if (id && (!CHARACTER_SKINS.some(s => s.id === id) || !ownedSkinIds.includes(id))) return;
    setSkinIdState(id);
    try { localStorage.setItem(CHARACTER_SKIN_STORAGE_KEY, id); } catch { /* unavailable */ }
  }, [ownedSkinIds]);

  const avatarSrc = useCallback((fallback: string) => {
    const skin = CHARACTER_SKINS.find(s => s.id === skinId);
    return skin?.file ? `${SKIN_BASE_PATH}${skin.file}` : fallback;
  }, [skinId]);

  const activeSkin = CHARACTER_SKINS.find(s => s.id === skinId);

  const backgroundSrc = useMemo(
    () => activeSkin?.background ? `${SKIN_BASE_PATH}${activeSkin.background}` : undefined,
    [activeSkin],
  );
  // UR = dedicated home art; R = same image as the chat background.
  const homeBackgroundSrc = useMemo(() => {
    if (!activeSkin) return undefined;
    const file = activeSkin.homeBackground ?? activeSkin.background;
    return file ? `${SKIN_BASE_PATH}${file}` : undefined;
  }, [activeSkin]);
  const ambientSrcs = useMemo(
    () => activeSkin?.ambient?.length ? activeSkin.ambient.map(f => `${SKIN_BASE_PATH}${f}`) : undefined,
    [activeSkin],
  );
  const avatarFrameSrc = useMemo(
    () => activeSkin?.avatarFrame ? `${SKIN_BASE_PATH}${activeSkin.avatarFrame}` : undefined,
    [activeSkin],
  );

  // Expose the active skin's accent as a CSS var on <body> so any component's
  // styled-jsx can reskin off it (e.g. the Lily name-dot in chat) without
  // prop-drilling — mirrors ThemeContext's data-theme-id pattern.
  useEffect(() => {
    const body = document.body;
    if (activeSkin?.accent) body.style.setProperty('--skin-accent', activeSkin.accent);
    else body.style.removeProperty('--skin-accent');
  }, [activeSkin]);

  return (
    <CharacterSkinContext.Provider
      value={{ skinId, setSkinId, ownedSkinIds, refreshOwnedSkins, avatarSrc, backgroundSrc, homeBackgroundSrc, ambientSrcs, avatarFrameSrc }}
    >
      {children}
    </CharacterSkinContext.Provider>
  );
}

export function useCharacterSkin() {
  return useContext(CharacterSkinContext);
}

// Wraps an avatar <img> with its skin's decorative frame ring, if any. The
// ring is sized/centered so its transparent center hole lines up with the
// avatar underneath; purely decorative (pointer-events: none).
export function AvatarFrame({ size, frameSrc, children }: { size: number; frameSrc?: string; children: React.ReactNode }) {
  if (!frameSrc) return <>{children}</>;
  const ringSize = Math.round(size * AVATAR_FRAME_SCALE);
  return (
    <div className="avatar-frame-wrap" style={{ width: size, height: size }}>
      {children}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={frameSrc}
        alt=""
        aria-hidden
        className="avatar-frame-ring"
        style={{ width: ringSize, height: ringSize, top: -(ringSize - size) / 2, left: -(ringSize - size) / 2 }}
      />
      <style jsx>{`
        .avatar-frame-wrap { position: relative; flex-shrink: 0; }
        .avatar-frame-ring { position: absolute; pointer-events: none; }
      `}</style>
    </div>
  );
}

// UR ambient effect — a handful of festival trinkets drifting slowly up the
// screen. Mount inside any `position: relative`/fixed-size screen container;
// renders nothing unless the active skin has ambient art. pointer-events:none
// so it never blocks taps.
export function AmbientOverlay() {
  const { ambientSrcs } = useCharacterSkin();
  // Deterministic pseudo-random layout so SSR/CSR match and re-renders don't shuffle.
  const items = useMemo(() => {
    if (!ambientSrcs?.length) return [];
    const out: Array<{ src: string; left: number; size: number; delay: number; dur: number; sway: number }> = [];
    const N = 10;
    for (let i = 0; i < N; i++) {
      const src = ambientSrcs[i % ambientSrcs.length];
      // golden-ratio low-discrepancy sequence for even horizontal spread
      const left = ((i * 0.618033988749895) % 1) * 92 + 2;
      out.push({
        src,
        left,
        size: 26 + ((i * 7) % 22),
        delay: -(i * 3.1) % 24,
        dur: 20 + ((i * 5) % 12),
        sway: (i % 2 === 0 ? 1 : -1) * (8 + (i % 3) * 5),
      });
    }
    return out;
  }, [ambientSrcs]);
  if (items.length === 0) return null;
  return (
    <div className="amb-wrap" aria-hidden>
      {items.map((p, i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={i}
          src={p.src}
          alt=""
          className="amb-item"
          style={{
            left: `${p.left}%`,
            width: p.size,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.dur}s`,
            ['--sway' as string]: `${p.sway}px`,
          }}
        />
      ))}
      <style jsx>{`
        .amb-wrap { position: absolute; inset: 0; overflow: hidden; pointer-events: none; z-index: 3; }
        .amb-item {
          position: absolute; bottom: -60px; height: auto; opacity: 0;
          filter: drop-shadow(0 1px 3px rgba(0,0,0,0.18));
          animation-name: amb-float; animation-timing-function: linear; animation-iteration-count: infinite;
        }
        @keyframes amb-float {
          0% { transform: translateY(0) translateX(0) rotate(-4deg); opacity: 0; }
          8% { opacity: 0.85; }
          50% { transform: translateY(-55vh) translateX(var(--sway)) rotate(5deg); opacity: 0.85; }
          92% { opacity: 0.6; }
          100% { transform: translateY(-108vh) translateX(calc(var(--sway) * -0.6)) rotate(-3deg); opacity: 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          .amb-item { display: none; }
        }
      `}</style>
    </div>
  );
}
