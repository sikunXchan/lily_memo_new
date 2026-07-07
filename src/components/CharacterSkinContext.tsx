'use client';

import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { useTheme } from './ThemeContext';
import { CHARACTER_SKINS, CHARACTER_SKIN_STORAGE_KEY, SKIN_BASE_PATH, AVATAR_FRAME_SCALE } from '@/lib/characterSkins';

interface CharacterSkinContextValue {
  skinId: string; // '' = default (unmodified mascot)
  setSkinId: (id: string) => void;
  // Returns the active skin's image path, or `fallback` when no skin is set.
  // Only Lily's avatar/costume changes per skin — the chat/diary bubbles keep
  // their default look (bubble decoration was reverted; it read as "weird").
  avatarSrc: (fallback: string) => string;
  // Resolved chat-screen background image path for the active skin, or
  // undefined when the skin has no background art yet.
  backgroundSrc?: string;
  // Resolved decorative avatar-frame-ring image path for the active skin, or
  // undefined when the skin has no frame art yet.
  avatarFrameSrc?: string;
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

  const backgroundSrc = useMemo(
    () => activeSkin?.background ? `${SKIN_BASE_PATH}${activeSkin.background}` : undefined,
    [activeSkin],
  );
  const avatarFrameSrc = useMemo(
    () => activeSkin?.avatarFrame ? `${SKIN_BASE_PATH}${activeSkin.avatarFrame}` : undefined,
    [activeSkin],
  );

  return (
    <CharacterSkinContext.Provider value={{ skinId, setSkinId, avatarSrc, backgroundSrc, avatarFrameSrc }}>
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
