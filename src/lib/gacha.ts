// Daily skin gacha — replaces the old single code-unlock for premium
// character skins. Each plan gets a number of pulls per day; a pull is
// mostly a miss (see HIT_RATE), and on a hit grants one skin the user
// doesn't already own, weighted by rarity. Once every skin is owned the
// gacha is blocked entirely — there's nothing left to give.
import { getPlan, todayStr, type Plan } from './points';
import { CHARACTER_SKINS, type SkinRarity } from './characterSkins';
import { SKINS_STORAGE_KEY as LEGACY_UNLOCK_KEY } from './themes';

export const PLAN_GACHA_PULLS: Record<Plan, number> = {
  free: 1,
  plus: 2,
  pro: 3,
  max: 5,
  ultimate: 8,
  developer: Number.MAX_SAFE_INTEGER,
};

// Most pulls come up empty — a skin is only awarded this often.
const HIT_RATE = 0.3;

// Which unowned skin a hit grants, weighted by rarity (rarer = less common).
const RARITY_WEIGHT: Record<SkinRarity, number> = { N: 60, R: 30, UR: 10 };

const KEY_OWNED = 'lily-skins-owned';
const KEY_GACHA_DATE = 'lily-gacha-date';
const KEY_GACHA_USED = 'lily-gacha-used';

function resetGachaIfNewDay(): void {
  const t = todayStr();
  if (localStorage.getItem(KEY_GACHA_DATE) !== t) {
    localStorage.setItem(KEY_GACHA_DATE, t);
    localStorage.setItem(KEY_GACHA_USED, '0');
  }
}

export function getOwnedSkinIds(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    // Anyone who unlocked everything with the old code keeps full access.
    if (localStorage.getItem(LEGACY_UNLOCK_KEY) === '1') {
      return CHARACTER_SKINS.map(s => s.id);
    }
    const raw = localStorage.getItem(KEY_OWNED);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export function isSkinOwned(id: string): boolean {
  return getOwnedSkinIds().includes(id);
}

export function isAllSkinsOwned(): boolean {
  const owned = new Set(getOwnedSkinIds());
  return CHARACTER_SKINS.every(s => owned.has(s.id));
}

function ownSkin(id: string): void {
  const owned = new Set(getOwnedSkinIds());
  owned.add(id);
  localStorage.setItem(KEY_OWNED, JSON.stringify([...owned]));
}

export function getGachaPullLimit(): number {
  return PLAN_GACHA_PULLS[getPlan()];
}

export function getGachaPullsUsedToday(): number {
  if (typeof window === 'undefined') return 0;
  resetGachaIfNewDay();
  return parseInt(localStorage.getItem(KEY_GACHA_USED) ?? '0', 10);
}

export function getGachaPullsLeft(): number {
  return Math.max(0, getGachaPullLimit() - getGachaPullsUsedToday());
}

export function canPullGacha(): boolean {
  return !isAllSkinsOwned() && getGachaPullsLeft() > 0;
}

function pickWeightedUnownedSkin(): string | null {
  const owned = new Set(getOwnedSkinIds());
  const pool = CHARACTER_SKINS.filter(s => !owned.has(s.id));
  if (pool.length === 0) return null;
  const total = pool.reduce((sum, s) => sum + RARITY_WEIGHT[s.rarity], 0);
  let roll = Math.random() * total;
  for (const s of pool) {
    roll -= RARITY_WEIGHT[s.rarity];
    if (roll <= 0) return s.id;
  }
  return pool[pool.length - 1].id;
}

export type GachaResult =
  | { kind: 'miss' }
  | { kind: 'hit'; skinId: string }
  | { kind: 'blocked' }; // no pulls left today, or every skin already owned

export function pullGacha(): GachaResult {
  if (typeof window === 'undefined' || !canPullGacha()) return { kind: 'blocked' };

  resetGachaIfNewDay();
  localStorage.setItem(KEY_GACHA_USED, String(getGachaPullsUsedToday() + 1));

  if (Math.random() >= HIT_RATE) return { kind: 'miss' };

  const skinId = pickWeightedUnownedSkin();
  if (!skinId) return { kind: 'miss' };
  ownSkin(skinId);
  return { kind: 'hit', skinId };
}
