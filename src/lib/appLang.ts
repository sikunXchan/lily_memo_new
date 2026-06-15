import { setGeminiMode } from './gemini';

// App language / AI mode.
//   'en' → English UI + English AI, routed through the server proxy so it works
//          with zero configuration. DEFAULT (hackathon submission).
//   'ja' → Japanese UI, the user supplies their own Gemini key (BYO, offline).
export type AppLang = 'ja' | 'en';

const LS_KEY = 'lily_app_lang';
// Sentinel passed to the Gemini helpers in English mode: it just needs to be
// non-empty so "has key?" gates pass — the server proxy ignores it and injects
// the real key.
export const PROXY_KEY = '__proxy__';

export function getAppLang(): AppLang {
  if (typeof window === 'undefined') return 'en';
  // English is the default; Japanese only when explicitly chosen in settings.
  return localStorage.getItem(LS_KEY) === 'ja' ? 'ja' : 'en';
}

// Push the current language into the Gemini layer (proxy on for English).
export function applyAppLang(lang: AppLang = getAppLang()): void {
  setGeminiMode({ lang, proxy: lang === 'en' });
}

export function setAppLang(lang: AppLang): void {
  if (typeof window !== 'undefined') localStorage.setItem(LS_KEY, lang);
  applyAppLang(lang);
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('lily-lang-changed'));
}

// The key to hand the Gemini helpers. English mode never needs a real key
// (the proxy holds it); Japanese mode uses the user's stored key.
export function getEffectiveApiKey(): string {
  if (typeof window === 'undefined') return '';
  if (getAppLang() === 'en') return PROXY_KEY;
  return localStorage.getItem('lily_gemini_api_key') || '';
}

// The user's display name, used to personalise Lily across chat, diary and
// lessons. Empty string when unset — callers fall back to a neutral label.
const USER_NAME_KEY = 'lily_user_name';

export function getUserName(): string {
  if (typeof window === 'undefined') return '';
  return (localStorage.getItem(USER_NAME_KEY) || '').trim();
}

export function setUserName(name: string): void {
  if (typeof window === 'undefined') return;
  const trimmed = name.trim();
  if (trimmed) localStorage.setItem(USER_NAME_KEY, trimmed);
  else localStorage.removeItem(USER_NAME_KEY);
  window.dispatchEvent(new Event('lily-username-changed'));
}
