import { setGeminiMode } from './gemini';

export type AppLang = 'ja' | 'en';

const LS_KEY = 'lily_app_lang';
// Kept for backward compatibility only — no longer used.
export const PROXY_KEY = '__proxy__';

export function getAppLang(): AppLang {
  return 'ja';
}

export function applyAppLang(_lang: AppLang = 'ja'): void {
  setGeminiMode({ lang: 'ja', proxy: false });
}

export function setAppLang(_lang: AppLang): void {
  if (typeof window !== 'undefined') localStorage.setItem(LS_KEY, 'ja');
  applyAppLang('ja');
}

export function getEffectiveApiKey(): string {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem('lily_gemini_api_key') || '';
}

export const USER_NAME_KEY = 'lily_user_name';
// 名前を最後に変えた時刻。端末間で新しいほうを勝たせるために使う
// （lib/profileSync.ts）。
export const USER_NAME_AT_KEY = 'lily_user_name_at';

export function getUserName(): string {
  if (typeof window === 'undefined') return '';
  return (localStorage.getItem(USER_NAME_KEY) || '').trim();
}

export function setUserName(name: string): void {
  if (typeof window === 'undefined') return;
  const trimmed = name.trim();
  if (trimmed) localStorage.setItem(USER_NAME_KEY, trimmed);
  else localStorage.removeItem(USER_NAME_KEY);
  localStorage.setItem(USER_NAME_AT_KEY, String(Date.now()));
  // このイベントは表示の更新と、同期への push 予約の両方を兼ねる。
  window.dispatchEvent(new Event('lily-username-changed'));
}
