// Study level system. The level is derived purely from cumulative study time,
// so it stays in sync across devices for free (it's a function of the sessions
// already being synced). RPG-style fast start, but the icon TIERS are spread
// across the whole journey (not bunched at the bottom). No upper cap — the
// level keeps climbing; Tier 9 (rainbow) is the eternal top.
//
//   hoursToReach(level) = COEF * (level - 1)^2

// Constant level-up rate: every level costs the same fixed amount of study
// time. Change this one number to make leveling faster (smaller) or slower
// (larger) across the board.
const HOURS_PER_LEVEL = 2;

// Tier-specific visual effects. 'none' for the early tiers; from Tier 9 up they
// escalate, peaking at the all-out rainbow of Tier 15.
export type LevelFx =
  | 'none'
  | 'glow'      // T9  — soft crystal/ice glow
  | 'glow2'     // T10 — stronger ice glow + float
  | 'aura'      // T11 — emerald aura + float
  | 'aura2'     // T12 — emerald radiant aura + sparkle + float
  | 'radiant'   // T13 — holy white radiant ring + float
  | 'radiant2'  // T14 — holy aura + rotating halo + sparkle + float
  | 'rainbow';  // T15 — full rainbow halo + pulse + sparkles + float (MAX)

export interface LevelTier {
  minLevel: number;
  emoji: string;  // fallback shown until the icon image loads
  icon: string;   // /level/tierN.png
  color: string;  // accent color for the XP bar / level number
  fx: LevelFx;    // tier-specific visual effect (Tier 9+)
}

// 15 visual tiers (no names — just an evolving trophy). Highest first so
// tierForLevel returns the first match. With the constant 2h/level rate the
// tier boundaries are spaced for an even-ish climb in study hours: effects
// begin at Tier 9 (~124h) and the eternal top, Tier 15, lands at ~500h.
//   t1 Lv1(0h)   t2 Lv4(6h)    t3 Lv8(14h)   t4 Lv13(24h)  t5 Lv19(36h)
//   t6 Lv27(52h) t7 Lv37(72h)  t8 Lv49(96h)  t9 Lv63(124h) t10 Lv81(160h)
//   t11 Lv103(204h) t12 Lv130(258h) t13 Lv163(324h) t14 Lv203(404h)
//   t15 Lv251(500h)
export const LEVEL_TIERS: LevelTier[] = [
  { minLevel: 251, emoji: '🌈', icon: '/level/tier15.png', color: '#e879f9', fx: 'rainbow' },
  { minLevel: 203, emoji: '😇', icon: '/level/tier14.png', color: '#a5b4fc', fx: 'radiant2' },
  { minLevel: 163, emoji: '🪽', icon: '/level/tier13.png', color: '#c7d2fe', fx: 'radiant' },
  { minLevel: 130, emoji: '👑', icon: '/level/tier12.png', color: '#10b981', fx: 'aura2' },
  { minLevel: 103, emoji: '💚', icon: '/level/tier11.png', color: '#34d399', fx: 'aura' },
  { minLevel: 81,  emoji: '💠', icon: '/level/tier10.png', color: '#38bdf8', fx: 'glow2' },
  { minLevel: 63,  emoji: '💎', icon: '/level/tier9.png',  color: '#67e8f9', fx: 'glow' },
  { minLevel: 49,  emoji: '🥇', icon: '/level/tier8.png',  color: '#ffc107', fx: 'none' },
  { minLevel: 37,  emoji: '🥇', icon: '/level/tier7.png',  color: '#f4b400', fx: 'none' },
  { minLevel: 27,  emoji: '🥇', icon: '/level/tier6.png',  color: '#f59e0b', fx: 'none' },
  { minLevel: 19,  emoji: '🥈', icon: '/level/tier5.png',  color: '#cbd2dc', fx: 'none' },
  { minLevel: 13,  emoji: '🥈', icon: '/level/tier4.png',  color: '#b6bcc6', fx: 'none' },
  { minLevel: 8,   emoji: '🥈', icon: '/level/tier3.png',  color: '#9ca3af', fx: 'none' },
  { minLevel: 4,   emoji: '🥉', icon: '/level/tier2.png',  color: '#d8884a', fx: 'none' },
  { minLevel: 1,   emoji: '🥉', icon: '/level/tier1.png',  color: '#cd7f32', fx: 'none' },
];

/** Cumulative hours required to reach a given level (constant rate). */
export function hoursForLevel(level: number): number {
  if (level <= 1) return 0;
  return HOURS_PER_LEVEL * (level - 1);
}

/** Level for a given amount of cumulative hours (uncapped, constant rate). */
export function levelFromHours(hours: number): number {
  if (hours <= 0) return 1;
  return 1 + Math.floor(hours / HOURS_PER_LEVEL);
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
