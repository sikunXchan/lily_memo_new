// Study level system. The level is derived purely from cumulative study time,
// so it stays in sync across devices for free (it's a function of the sessions
// already being synced). Quadratic formula — each level costs a bit more than
// the previous — but tuned so the early game is fast and the climb steepens
// dramatically once effects start. No upper cap; Tier 15 (rainbow) is eternal.
//
//   hoursToReach(level) = COEF * (level - 1)^2

// Tuned so Tier 9 (first effect) ≈ 300h and Tier 15 (max) ≈ 2500h.
const COEF = 0.03;

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
// tierForLevel returns the first match. Tiers 1–8 cluster in the first ~300h
// (accessible warm-up); from Tier 9 the required hours roughly double each
// tier, making the top genuinely hard.
//   t1 Lv1(0h)    t2 Lv21(12h)   t3 Lv38(41h)   t4 Lv51(75h)   t5 Lv63(115h)
//   t6 Lv74(160h) t7 Lv86(217h)  t8 Lv95(265h)
//   t9 Lv101(300h)  t10 Lv124(454h)  t11 Lv148(648h)  t12 Lv184(1005h)
//   t13 Lv217(1400h) t14 Lv253(1905h) t15 Lv290(2506h≈2500h)
export const LEVEL_TIERS: LevelTier[] = [
  { minLevel: 290, emoji: '🌈', icon: '/level/tier15.png', color: '#e879f9', fx: 'rainbow' },
  { minLevel: 253, emoji: '😇', icon: '/level/tier14.png', color: '#a5b4fc', fx: 'radiant2' },
  { minLevel: 217, emoji: '🪽', icon: '/level/tier13.png', color: '#c7d2fe', fx: 'radiant' },
  { minLevel: 184, emoji: '👑', icon: '/level/tier12.png', color: '#10b981', fx: 'aura2' },
  { minLevel: 148, emoji: '💚', icon: '/level/tier11.png', color: '#34d399', fx: 'aura' },
  { minLevel: 124, emoji: '💠', icon: '/level/tier10.png', color: '#38bdf8', fx: 'glow2' },
  { minLevel: 101, emoji: '💎', icon: '/level/tier9.png',  color: '#67e8f9', fx: 'glow' },
  { minLevel: 95,  emoji: '🥇', icon: '/level/tier8.png',  color: '#ffc107', fx: 'none' },
  { minLevel: 86,  emoji: '🥇', icon: '/level/tier7.png',  color: '#f4b400', fx: 'none' },
  { minLevel: 74,  emoji: '🥇', icon: '/level/tier6.png',  color: '#f59e0b', fx: 'none' },
  { minLevel: 63,  emoji: '🥈', icon: '/level/tier5.png',  color: '#cbd2dc', fx: 'none' },
  { minLevel: 51,  emoji: '🥈', icon: '/level/tier4.png',  color: '#b6bcc6', fx: 'none' },
  { minLevel: 38,  emoji: '🥈', icon: '/level/tier3.png',  color: '#9ca3af', fx: 'none' },
  { minLevel: 21,  emoji: '🥉', icon: '/level/tier2.png',  color: '#d8884a', fx: 'none' },
  { minLevel: 1,   emoji: '🥉', icon: '/level/tier1.png',  color: '#cd7f32', fx: 'none' },
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
