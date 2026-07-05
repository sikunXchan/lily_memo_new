'use client';

import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import type { CSSProperties } from 'react';
import { useTheme } from './ThemeContext';
import { CHARACTER_SKINS, CHARACTER_SKIN_STORAGE_KEY, SKIN_BASE_PATH } from '@/lib/characterSkins';

interface CharacterSkinContextValue {
  skinId: string; // '' = default (unmodified mascot)
  setSkinId: (id: string) => void;
  // Returns the active skin's image path, or `fallback` when no skin is set.
  avatarSrc: (fallback: string) => string;
  // Background/border color tint for Lily's chat bubble, the diary comment
  // card, and the typing indicator; undefined when no skin is set (callers
  // fall back to their default CSS).
  bubbleStyle?: CSSProperties;
  // Same tint (kept as a separate name for callers that only ever want the
  // plain tint, never the corner stickers below).
  tintStyle?: CSSProperties;
  // Resolved corner-sticker image paths for BubbleCornerDecor, if the active
  // skin has illustrated bubble art; undefined otherwise.
  bubbleCorners?: { tl: string; tr: string; bl: string; br: string };
  // "Thinking" dot/accent color tinted for the active skin, or undefined.
  dotColor?: string;
}

const CharacterSkinContext = createContext<CharacterSkinContextValue>({
  skinId: '',
  setSkinId: () => {},
  avatarSrc: (fallback) => fallback,
});

export function CharacterSkinProvider({ children }: { children: React.ReactNode }) {
  const { skinsUnlocked } = useTheme();
  const [skinId, setSkinIdState] = useState('');

  useEffect(() => {
    try {
      const saved = localStorage.getItem(CHARACTER_SKIN_STORAGE_KEY) || '';
      if (saved && CHARACTER_SKINS.some(s => s.id === saved)) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setSkinIdState(saved);
      }
    } catch { /* localStorage unavailable */ }
  }, []);

  // If skins somehow become locked again (shouldn't normally happen since
  // unlocking is permanent), don't leave a broken/inaccessible skin selected.
  useEffect(() => {
    if (skinId && !skinsUnlocked) setSkinIdState('');
  }, [skinId, skinsUnlocked]);

  const setSkinId = useCallback((id: string) => {
    if (id && (!CHARACTER_SKINS.some(s => s.id === id) || !skinsUnlocked)) return;
    setSkinIdState(id);
    try { localStorage.setItem(CHARACTER_SKIN_STORAGE_KEY, id); } catch { /* unavailable */ }
  }, [skinsUnlocked]);

  const avatarSrc = useCallback((fallback: string) => {
    const skin = CHARACTER_SKINS.find(s => s.id === skinId);
    return skin ? `${SKIN_BASE_PATH}${skin.file}` : fallback;
  }, [skinId]);

  const activeSkin = CHARACTER_SKINS.find(s => s.id === skinId);
  const accent = activeSkin?.accent;
  const corners = activeSkin?.bubbleCorners;

  const tintStyle = useMemo<CSSProperties | undefined>(() => accent ? {
    background: `color-mix(in srgb, ${accent} 22%, var(--accent))`,
    borderColor: `color-mix(in srgb, ${accent} 45%, var(--border))`,
  } : undefined, [accent]);

  const bubbleCorners = useMemo(() => corners ? {
    tl: `${SKIN_BASE_PATH}${corners.tl}`,
    tr: `${SKIN_BASE_PATH}${corners.tr}`,
    bl: `${SKIN_BASE_PATH}${corners.bl}`,
    br: `${SKIN_BASE_PATH}${corners.br}`,
  } : undefined, [corners]);

  const dotColor = useMemo(() => accent ? `color-mix(in srgb, ${accent} 45%, var(--primary))` : undefined, [accent]);

  return (
    <CharacterSkinContext.Provider value={{ skinId, setSkinId, avatarSrc, bubbleStyle: tintStyle, tintStyle, bubbleCorners, dotColor }}>
      {children}
    </CharacterSkinContext.Provider>
  );
}

export function useCharacterSkin() {
  return useContext(CharacterSkinContext);
}

// Illustrated corner stickers layered over a bubble that has `position:
// relative`. Purely decorative and non-interactive; renders nothing when the
// active skin has no bubble art yet.
export function BubbleCornerDecor({ corners }: { corners?: { tl: string; tr: string; bl: string; br: string } }) {
  if (!corners) return null;
  return (
    <div className="bcd-wrap" aria-hidden>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={corners.tl} alt="" className="bcd bcd-tl" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={corners.tr} alt="" className="bcd bcd-tr" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={corners.bl} alt="" className="bcd bcd-bl" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={corners.br} alt="" className="bcd bcd-br" />
      <style jsx>{`
        /* Decorations straddle the corners and hang OUTSIDE the bubble edge,
           like ornaments clipped onto the frame — not sitting inside over the
           text. z-index keeps them above the bubble but pointer-events:none so
           taps still reach the content underneath. */
        .bcd-wrap { position: absolute; inset: 0; pointer-events: none; z-index: 2; }
        .bcd { position: absolute; height: 52px; width: auto; filter: drop-shadow(0 1px 3px rgba(0,0,0,0.16)); }
        .bcd-tl { top: -26px; left: -14px; }
        .bcd-tr { top: -26px; right: -14px; }
        .bcd-bl { bottom: -26px; left: -14px; }
        .bcd-br { bottom: -26px; right: -14px; }
      `}</style>
    </div>
  );
}
