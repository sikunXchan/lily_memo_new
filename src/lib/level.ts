// Study level system. The level is derived purely from cumulative study time,
// so it stays in sync across devices for free (it's a function of the sessions
// already being synced). RPG-style fast start: ~Lv10 at 2h, ~Lv100 at 200h,
// Lv500 at ~5000h.
//
//   hoursToReach(level) = COEF * (level - 1)^2

export const MAX_LEVEL = 500;
const COEF = 0.0201; // tuned so Lv500 ≈ 5000h

export interface Rank {
  minLevel: number;
  name: string;
  emoji: string;
  color: string;
}

// Highest threshold first so rankForLevel can return the first match.
export const RANKS: Rank[] = [
  { minLevel: 500, name: 'LEGEND',   emoji: '🏆', color: '#fcd34d' },
  { minLevel: 350, name: '達人',     emoji: '👑', color: '#fbbf24' },
  { minLevel: 200, name: '賢者',     emoji: '🔮', color: '#f472b6' },
  { minLevel: 100, name: '秀才',     emoji: '🎓', color: '#a78bfa' },
  { minLevel: 25,  name: '勉強家',   emoji: '📗', color: '#38bdf8' },
  { minLevel: 1,   name: 'みならい', emoji: '🌱', color: '#84cc16' },
];

/** Cumulative hours required to reach a given level. */
export function hoursForLevel(level: number): number {
  if (level <= 1) return 0;
  return COEF * (level - 1) * (level - 1);
}

/** Level for a given amount of cumulative hours. */
export function levelFromHours(hours: number): number {
  if (hours <= 0) return 1;
  const lv = 1 + Math.floor(Math.sqrt(hours / COEF));
  return Math.max(1, Math.min(MAX_LEVEL, lv));
}

export function rankForLevel(level: number): Rank {
  for (const r of RANKS) if (level >= r.minLevel) return r;
  return RANKS[RANKS.length - 1];
}

export interface LevelInfo {
  level: number;
  rank: Rank;
  hours: number;          // total cumulative hours
  pct: number;            // progress within the current level (0..100)
  remainingHours: number; // hours left until the next level
  isMax: boolean;
}

export function getLevelInfo(totalSeconds: number): LevelInfo {
  const hours = totalSeconds / 3600;
  const level = levelFromHours(hours);
  const rank = rankForLevel(level);
  const isMax = level >= MAX_LEVEL;
  const base = hoursForLevel(level);
  const next = hoursForLevel(level + 1);
  const span = Math.max(1e-6, next - base);
  const pct = isMax ? 100 : Math.min(100, Math.max(0, ((hours - base) / span) * 100));
  const remainingHours = isMax ? 0 : Math.max(0, next - hours);
  return { level, rank, hours, pct, remainingHours, isMax };
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
