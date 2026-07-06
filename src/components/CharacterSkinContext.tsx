'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useTheme } from './ThemeContext';
import { CHARACTER_SKINS, CHARACTER_SKIN_STORAGE_KEY, SKIN_BASE_PATH } from '@/lib/characterSkins';

interface CharacterSkinContextValue {
  skinId: string; // '' = default (unmodified mascot)
  setSkinId: (id: string) => void;
  // Returns the active skin's image path, or `fallback` when no skin is set.
  // Only Lily's avatar/costume changes per skin — the chat/diary bubbles keep
  // their default look (bubble decoration was reverted; it read as "weird").
  avatarSrc: (fallback: string) => string;
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

  return (
    <CharacterSkinContext.Provider value={{ skinId, setSkinId, avatarSrc }}>
      {children}
    </CharacterSkinContext.Provider>
  );
}

export function useCharacterSkin() {
  return useContext(CharacterSkinContext);
}
