'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import {
  THEMES, THEME_LIST, THEME_STORAGE_KEY, DEFAULT_THEME_ID,
  themeCssVars, type Theme,
} from '@/lib/themes';

interface ThemeContextValue {
  theme: Theme;
  themeId: string;
  setThemeId: (id: string) => void;
  cycleTheme: () => void;
  nextThemeName: string;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: THEMES[DEFAULT_THEME_ID],
  themeId: DEFAULT_THEME_ID,
  setThemeId: () => {},
  cycleTheme: () => {},
  nextThemeName: '',
});

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
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [themeId, setThemeIdState] = useState<string>(DEFAULT_THEME_ID);

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
    // Read the persisted theme only after mount so server and client
    // render the same default (avoids a hydration mismatch).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setThemeIdState(initial);
    applyTheme(THEMES[initial]);
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
    <ThemeContext.Provider value={{ theme, themeId, setThemeId, cycleTheme, nextThemeName }}>
      {theme.starfield && <div className="starfield-overlay" aria-hidden="true" />}
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
