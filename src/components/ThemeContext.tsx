'use client';

// Color themes were removed in favor of character-skin backgrounds — the app
// now always uses the "cream" palette. This provider still owns fonts and the
// premium-skin unlock state (shared by the character-skin picker).

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import {
  THEMES, DEFAULT_THEME_ID,
  FONT_OPTIONS, FONT_STORAGE_KEY, DEFAULT_FONT_ID,
  themeCssVars,
  SKIN_UNLOCK_CODE, SKINS_STORAGE_KEY,
} from '@/lib/themes';

interface ThemeContextValue {
  fontId: string;
  setFontId: (id: string) => void;
  skinsUnlocked: boolean;
  unlockSkins: (code: string) => boolean;
}

const ThemeContext = createContext<ThemeContextValue>({
  fontId: DEFAULT_FONT_ID,
  setFontId: () => {},
  skinsUnlocked: false,
  unlockSkins: () => false,
});

function applyFont(fontId: string) {
  const opt = FONT_OPTIONS.find(f => f.id === fontId);
  const root = document.documentElement;
  if (opt && opt.value) {
    root.style.setProperty('--app-font', opt.value);
  } else {
    root.style.removeProperty('--app-font');
  }
}

function applyCreamTheme() {
  const theme = THEMES[DEFAULT_THEME_ID];
  const root = document.documentElement;
  const vars = themeCssVars(theme);
  for (const [k, v] of Object.entries(vars)) {
    root.style.setProperty(k, v);
  }
  document.body.setAttribute('data-theme', 'light');
  document.body.setAttribute('data-theme-id', theme.id);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [fontId, setFontIdState] = useState<string>(DEFAULT_FONT_ID);
  const [skinsUnlocked, setSkinsUnlocked] = useState(false);

  useEffect(() => {
    let initialFont = DEFAULT_FONT_ID;
    try {
      const savedFont = localStorage.getItem(FONT_STORAGE_KEY);
      if (savedFont && FONT_OPTIONS.some(f => f.id === savedFont)) initialFont = savedFont;
    } catch {
      /* localStorage unavailable */
    }
    let unlocked = false;
    try { unlocked = localStorage.getItem(SKINS_STORAGE_KEY) === '1'; } catch { /* unavailable */ }
    // Read persisted prefs only after mount so server and client render
    // the same default (avoids a hydration mismatch).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFontIdState(initialFont);
    setSkinsUnlocked(unlocked);
    applyCreamTheme();
    applyFont(initialFont);
  }, []);

  const unlockSkins = useCallback((code: string): boolean => {
    if (code.trim() !== SKIN_UNLOCK_CODE) return false;
    setSkinsUnlocked(true);
    try { localStorage.setItem(SKINS_STORAGE_KEY, '1'); } catch { /* unavailable */ }
    return true;
  }, []);

  const setFontId = useCallback((id: string) => {
    if (!FONT_OPTIONS.some(f => f.id === id)) return;
    setFontIdState(id);
    applyFont(id);
    try {
      localStorage.setItem(FONT_STORAGE_KEY, id);
    } catch {
      /* localStorage unavailable */
    }
  }, []);

  return (
    <ThemeContext.Provider value={{ fontId, setFontId, skinsUnlocked, unlockSkins }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
