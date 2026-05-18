'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import {
  THEMES, THEME_LIST, THEME_STORAGE_KEY, DEFAULT_THEME_ID,
  FONT_OPTIONS, FONT_STORAGE_KEY, DEFAULT_FONT_ID,
  themeCssVars, type Theme,
} from '@/lib/themes';

interface ThemeContextValue {
  theme: Theme;
  themeId: string;
  setThemeId: (id: string) => void;
  cycleTheme: () => void;
  nextThemeName: string;
  fontId: string;
  setFontId: (id: string) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: THEMES[DEFAULT_THEME_ID],
  themeId: DEFAULT_THEME_ID,
  setThemeId: () => {},
  cycleTheme: () => {},
  nextThemeName: '',
  fontId: DEFAULT_FONT_ID,
  setFontId: () => {},
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

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  const vars = themeCssVars(theme);
  for (const [k, v] of Object.entries(vars)) {
    root.style.setProperty(k, v);
  }
  // Keep existing [data-theme='dark'] selectors working.
  document.body.setAttribute('data-theme', theme.dark ? 'dark' : 'light');
  document.body.setAttribute('data-theme-id', theme.id);
  if (theme.starfield) {
    document.body.setAttribute('data-starfield', 'true');
  } else {
    document.body.removeAttribute('data-starfield');
  }
  if (theme.fireworks) {
    document.body.setAttribute('data-fireworks', 'true');
  } else {
    document.body.removeAttribute('data-fireworks');
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [themeId, setThemeIdState] = useState<string>(DEFAULT_THEME_ID);
  const [fontId, setFontIdState] = useState<string>(DEFAULT_FONT_ID);

  useEffect(() => {
    let initial = DEFAULT_THEME_ID;
    try {
      const saved = localStorage.getItem(THEME_STORAGE_KEY);
      if (saved && THEMES[saved]) {
        initial = saved;
      } else {
        // Migrate the old binary light/dark preference.
        const legacy = localStorage.getItem('theme');
        if (legacy === 'dark') initial = 'night';
      }
    } catch {
      /* localStorage unavailable */
    }
    let initialFont = DEFAULT_FONT_ID;
    try {
      const savedFont = localStorage.getItem(FONT_STORAGE_KEY);
      if (savedFont && FONT_OPTIONS.some(f => f.id === savedFont)) initialFont = savedFont;
    } catch {
      /* localStorage unavailable */
    }
    // Read persisted prefs only after mount so server and client render
    // the same default (avoids a hydration mismatch).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setThemeIdState(initial);
    setFontIdState(initialFont);
    applyTheme(THEMES[initial]);
    applyFont(initialFont);
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

  const setThemeId = useCallback((id: string) => {
    if (!THEMES[id]) return;
    setThemeIdState(id);
    applyTheme(THEMES[id]);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, id);
    } catch {
      /* localStorage unavailable */
    }
  }, []);

  const cycleTheme = useCallback(() => {
    setThemeIdState((current) => {
      const idx = THEME_LIST.indexOf(current);
      const next = THEME_LIST[(idx + 1) % THEME_LIST.length];
      applyTheme(THEMES[next]);
      try {
        localStorage.setItem(THEME_STORAGE_KEY, next);
      } catch {
        /* localStorage unavailable */
      }
      return next;
    });
  }, []);

  const theme = THEMES[themeId] ?? THEMES[DEFAULT_THEME_ID];
  const nextIdx = (THEME_LIST.indexOf(themeId) + 1) % THEME_LIST.length;
  const nextThemeName = THEMES[THEME_LIST[nextIdx]].name;

  return (
    <ThemeContext.Provider value={{ theme, themeId, setThemeId, cycleTheme, nextThemeName, fontId, setFontId }}>
      {theme.starfield && <div className="starfield-overlay" aria-hidden="true" />}
      {theme.fireworks && (
        <div className="fireworks-overlay" aria-hidden="true">
          <span className="fw fw1" />
          <span className="fw fw2" />
          <span className="fw fw3" />
          <span className="fw fw4" />
          <span className="fw fw5" />
        </div>
      )}
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
