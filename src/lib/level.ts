// Study level system. The level is derived purely from cumulative study time,
// so it stays in sync across devices for free (it's a function of the sessions
// already being synced). RPG-style fast start, but the icon TIERS are spread
// across the whole journey (not bunched at the bottom). No upper cap — the
// level keeps climbing; Tier 9 (rainbow) is the eternal top.
//
//   hoursToReach(level) = COEF * (level - 1)^2

const COEF = 0.0201; // tuned so Lv500 ≈ 5000h

export type LevelFx = 'none' | 'glow' | 'glow2' | 'radiant' | 'rainbow';

export interface LevelTier {
  minLevel: number;
  emoji: string;  // fallback shown until the icon image loads
  icon: string;   // /level/tierN.png
  color: string;  // accent color for the XP bar / level number
  fx: LevelFx;    // tier-specific visual effect (Tier 6+)
}

// Visual tiers (no names — just an evolving icon). Highest first so
// tierForLevel returns the first match. Spread out so the lower tiers aren't
// crowded into the first few dozen hours.
//   t1 Lv1(0h) t2 Lv20(~7h) t3 Lv60(~70h) t4 Lv110(~239h) t5 Lv175(~609h)
//   t6 Lv250(~1246h) t7 Lv330(~2175h) t8 Lv420(~3528h) t9 Lv500(~4980h)
export const LEVEL_TIERS: LevelTier[] = [
  { minLevel: 500, emoji: '🌈', icon: '/level/tier9.png', color: '#c084fc', fx: 'rainbow' },
  { minLevel: 420, emoji: '🏆', icon: '/level/tier8.png', color: '#fcd34d', fx: 'radiant' },
  { minLevel: 330, emoji: '👑', icon: '/level/tier7.png', color: '#fbbf24', fx: 'glow2' },
  { minLevel: 250, emoji: '👑', icon: '/level/tier6.png', color: '#f59e0b', fx: 'glow' },
  { minLevel: 175, emoji: '🎖️', icon: '/level/tier5.png', color: '#facc15', fx: 'none' },
  { minLevel: 110, emoji: '🥇', icon: '/level/tier4.png', color: '#eab308', fx: 'none' },
  { minLevel: 60,  emoji: '🥇', icon: '/level/tier3.png', color: '#f59e0b', fx: 'none' },
  { minLevel: 20,  emoji: '🥈', icon: '/level/tier2.png', color: '#94a3b8', fx: 'none' },
  { minLevel: 1,   emoji: '🥉', icon: '/level/tier1.png', color: '#cd7f32', fx: 'none' },
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
