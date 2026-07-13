// User-chosen "favorite emblems" to show off on the study tab. Purely a
// display preference (which earned badges to feature, max 5), stored locally.
// Empty by default — someone who picks nothing gets no showcase at all.

const KEY = 'lily_favorite_emblems';
export const MAX_FAVORITE_EMBLEMS = 5;

export function getFavoriteEmblems(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    if (!Array.isArray(raw)) return [];
    return raw.filter((x): x is string => typeof x === 'string').slice(0, MAX_FAVORITE_EMBLEMS);
  } catch {
    return [];
  }
}

export function setFavoriteEmblems(ids: string[]): void {
  if (typeof window === 'undefined') return;
  const trimmed = ids.slice(0, MAX_FAVORITE_EMBLEMS);
  try {
    localStorage.setItem(KEY, JSON.stringify(trimmed));
    // Let same-tab listeners (the study tab) react without a reload.
    window.dispatchEvent(new CustomEvent('lily-favorite-emblems-changed'));
  } catch {}
}
