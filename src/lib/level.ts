// Study level system. The level is derived purely from cumulative study time,
// so it stays in sync across devices for free (it's a function of the sessions
// already being synced). RPG-style fast start: ~Lv10 at 2h, ~Lv100 at 200h,
// ~Lv500 at 5000h — and there is NO upper cap, it keeps climbing.
//
//   hoursToReach(level) = COEF * (level - 1)^2

const COEF = 0.0201; // tuned so Lv500 ≈ 5000h

export interface LevelTier {
  minLevel: number;
  emoji: string;  // fallback shown until the icon image exists
  icon: string;   // /level/tierN.png
  color: string;  // accent color for the XP bar / level number
}

// Visual tiers (no names — just an evolving icon + color). Highest first so
// tierForLevel can return the first match. The top tier covers everything
// past Lv500 since the level itself is uncapped.
export const LEVEL_TIERS: LevelTier[] = [
  { minLevel: 500, emoji: '🏆', icon: '/level/tier8.png', color: '#fcd34d' },
  { minLevel: 350, emoji: '👑', icon: '/level/tier7.png', color: '#fbbf24' },
  { minLevel: 200, emoji: '🔮', icon: '/level/tier6.png', color: '#f472b6' },
  { minLevel: 100, emoji: '🎓', icon: '/level/tier5.png', color: '#a78bfa' },
  { minLevel: 50,  emoji: '📘', icon: '/level/tier4.png', color: '#60a5fa' },
  { minLevel: 25,  emoji: '✏️', icon: '/level/tier3.png', color: '#38bdf8' },
  { minLevel: 10,  emoji: '📗', icon: '/level/tier2.png', color: '#34d399' },
  { minLevel: 1,   emoji: '🌱', icon: '/level/tier1.png', color: '#84cc16' },
];

/** Cumulative hours required to reach a given level. */
export function hoursForLevel(level: number): number {
  if (level <= 1) return 0;
  return COEF * (level - 1) * (level - 1);
}

/** Level for a given amount of cumulative hours (uncapped). */
export function levelFromHours(hours: number): number {
  if (hours <= 0) return 1;
  return 1 + Math.floor(Math.sqrt(hours / COEF));
}

export function tierForLevel(level: number): LevelTier {
  for (const t of LEVEL_TIERS) if (level >= t.minLevel) return t;
  return LEVEL_TIERS[LEVEL_TIERS.length - 1];
}

export interface LevelInfo {
  level: number;
  tier: LevelTier;
  hours: number;          // total cumulative hours
  pct: number;            // progress within the current level (0..100)
  remainingHours: number; // hours left until the next level
}

export function getLevelInfo(totalSeconds: number): LevelInfo {
  const hours = totalSeconds / 3600;
  const level = levelFromHours(hours);
  const tier = tierForLevel(level);
  const base = hoursForLevel(level);
  const next = hoursForLevel(level + 1);
  const span = Math.max(1e-6, next - base);
  const pct = Math.min(100, Math.max(0, ((hours - base) / span) * 100));
  const remainingHours = Math.max(0, next - hours);
  return { level, tier, hours, pct, remainingHours };
}

/** Human-friendly "time to next level" label. */
export function fmtHoursShort(h: number): string {
  if (h >= 1) {
    const hh = Math.floor(h);
    const mm = Math.round((h - hh) * 60);
    return mm > 0 ? `${hh}時間${mm}分` : `${hh}時間`;
  }
  return `${Math.max(1, Math.round(h * 60))}分`;
}
