// Badge system — definitions + the engine that decides which badges are earned.
//
// Adding a new badge later = add ONE entry to the BADGES array below (image,
// title, room, condition). The engine and trophy room pick it up automatically.
// Add a new condition shape by extending BadgeCondition + the isEarned() switch.

import { db } from './db';
import type { StudySession, EarnedBadge } from './db';
import { getStudyProfile } from './studyProfile';

export type BadgeCategory = 'total' | 'streak' | 'daily' | 'fun' | 'special';
export type RoomId = 'kids' | 'hall' | 'glory' | 'lily';

export type BadgeCondition =
  | { kind: 'totalHours';      hours: number }     // cumulative study hours
  | { kind: 'streak';          days: number }      // longest consecutive-day streak
  | { kind: 'dailyHours';      hours: number }     // best single-day total
  | { kind: 'sessionMinutes';  minutes: number }   // longest single session
  | { kind: 'pomodoroCount';   count: number }     // total pomodoro sessions
  | { kind: 'totalDays';       days: number }      // distinct days studied
  | { kind: 'categoriesInDay'; count: number }     // subjects in a single day
  | { kind: 'categoriesTotal'; count: number }     // distinct subjects ever
  | { kind: 'morning' }                            // studied 5:00–8:00
  | { kind: 'nightCount';      count: number }     // days with a 0:00–5:00 session
  | { kind: 'weekend' }                            // studied on a Sat/Sun
  | { kind: 'comeback';        gapDays: number }   // resumed after a gap
  | { kind: 'goalMet' }                            // hit the daily goal once
  | { kind: 'daysSinceFirst';  days: number }      // veteran (calendar age)
  | { kind: 'badgePercent';    percent: number };  // meta: % of all badges earned

export interface BadgeDef {
  id: string;
  image: string;
  title: string;
  desc: string;            // human-readable unlock condition
  category: BadgeCategory;
  room: RoomId;
  sort: number;            // ordering within a room/category
  cond: BadgeCondition;
}

const IMG = (n: string) => `/trophy/badges/${n}.png`;

// ─────────────────────────────────────────────────────────────────────────────
// Badge definitions (57). Grouped by sheet/theme for readability.
// ─────────────────────────────────────────────────────────────────────────────
export const BADGES: BadgeDef[] = [
  // 🐻 累計勉強時間 — Sheet1 (こども部屋)
  { id: 'total_1h',    image: IMG('sheet1_01'), title: 'はじめの一歩',   desc: '累計1時間 勉強した',    category: 'total', room: 'kids', sort: 1,  cond: { kind: 'totalHours', hours: 1 } },
  { id: 'total_3h',    image: IMG('sheet1_02'), title: '勉強の芽',       desc: '累計3時間 勉強した',    category: 'total', room: 'kids', sort: 2,  cond: { kind: 'totalHours', hours: 3 } },
  { id: 'total_5h',    image: IMG('sheet1_03'), title: 'コツコツ屋さん', desc: '累計5時間 勉強した',    category: 'total', room: 'kids', sort: 3,  cond: { kind: 'totalHours', hours: 5 } },
  { id: 'total_10h',   image: IMG('sheet1_04'), title: '勉強家見習い',   desc: '累計10時間 勉強した',   category: 'total', room: 'kids', sort: 4,  cond: { kind: 'totalHours', hours: 10 } },
  { id: 'total_20h',   image: IMG('sheet1_05'), title: '勉強家',         desc: '累計20時間 勉強した',   category: 'total', room: 'kids', sort: 5,  cond: { kind: 'totalHours', hours: 20 } },
  { id: 'total_30h',   image: IMG('sheet1_06'), title: '努力の人',       desc: '累計30時間 勉強した',   category: 'total', room: 'kids', sort: 6,  cond: { kind: 'totalHours', hours: 30 } },
  { id: 'total_50h',   image: IMG('sheet1_07'), title: '本物の努力',     desc: '累計50時間 勉強した',   category: 'total', room: 'kids', sort: 7,  cond: { kind: 'totalHours', hours: 50 } },
  { id: 'total_75h',   image: IMG('sheet1_08'), title: 'がんばり屋',     desc: '累計75時間 勉強した',   category: 'total', room: 'kids', sort: 8,  cond: { kind: 'totalHours', hours: 75 } },
  { id: 'total_100h',  image: IMG('sheet1_09'), title: '100時間の壁',    desc: '累計100時間 勉強した',  category: 'total', room: 'kids', sort: 9,  cond: { kind: 'totalHours', hours: 100 } },
  { id: 'total_150h',  image: IMG('sheet1_10'), title: '勉強マスター',   desc: '累計150時間 勉強した',  category: 'total', room: 'kids', sort: 10, cond: { kind: 'totalHours', hours: 150 } },
  { id: 'total_200h',  image: IMG('sheet1_11'), title: '秀才',           desc: '累計200時間 勉強した',  category: 'total', room: 'kids', sort: 11, cond: { kind: 'totalHours', hours: 200 } },
  { id: 'total_300h',  image: IMG('sheet1_12'), title: '天才の片鱗',     desc: '累計300時間 勉強した',  category: 'total', room: 'kids', sort: 12, cond: { kind: 'totalHours', hours: 300 } },

  // 🐻 累計勉強時間（上級）— Sheet3 (大広間)
  { id: 'total_400h',  image: IMG('sheet3_01'), title: '学問の探究者',   desc: '累計400時間 勉強した',  category: 'total', room: 'hall', sort: 1,  cond: { kind: 'totalHours', hours: 400 } },
  { id: 'total_500h',  image: IMG('sheet3_02'), title: '賢者',           desc: '累計500時間 勉強した',  category: 'total', room: 'hall', sort: 2,  cond: { kind: 'totalHours', hours: 500 } },
  { id: 'total_650h',  image: IMG('sheet3_03'), title: '大賢者',         desc: '累計650時間 勉強した',  category: 'total', room: 'hall', sort: 3,  cond: { kind: 'totalHours', hours: 650 } },
  { id: 'total_800h',  image: IMG('sheet3_04'), title: '学びの達人',     desc: '累計800時間 勉強した',  category: 'total', room: 'hall', sort: 4,  cond: { kind: 'totalHours', hours: 800 } },
  { id: 'total_1000h', image: IMG('sheet3_05'), title: '千時間の覇者',   desc: '累計1000時間 勉強した', category: 'total', room: 'hall', sort: 5,  cond: { kind: 'totalHours', hours: 1000 } },
  { id: 'total_1500h', image: IMG('sheet3_06'), title: '伝説の学徒',     desc: '累計1500時間 勉強した', category: 'total', room: 'hall', sort: 6,  cond: { kind: 'totalHours', hours: 1500 } },

  // 🎓 1日の集中量 — Sheet4 (大広間)
  { id: 'daily_2h',    image: IMG('sheet4_01'), title: '集中の芽生え',   desc: '1日に合計2時間 勉強した',  category: 'daily', room: 'hall', sort: 10, cond: { kind: 'dailyHours', hours: 2 } },
  { id: 'daily_4h',    image: IMG('sheet4_02'), title: 'ゾーンの入口',   desc: '1日に合計4時間 勉強した',  category: 'daily', room: 'hall', sort: 11, cond: { kind: 'dailyHours', hours: 4 } },
  { id: 'daily_6h',    image: IMG('sheet4_03'), title: 'ゾーンに入った', desc: '1日に合計6時間 勉強した',  category: 'daily', room: 'hall', sort: 12, cond: { kind: 'dailyHours', hours: 6 } },
  { id: 'daily_8h',    image: IMG('sheet4_04'), title: '没頭',           desc: '1日に合計8時間 勉強した',  category: 'daily', room: 'hall', sort: 13, cond: { kind: 'dailyHours', hours: 8 } },
  { id: 'daily_10h',   image: IMG('sheet4_05'), title: '限界突破',       desc: '1日に合計10時間 勉強した', category: 'daily', room: 'hall', sort: 14, cond: { kind: 'dailyHours', hours: 10 } },
  { id: 'daily_12h',   image: IMG('sheet4_06'), title: '鬼の集中',       desc: '1日に合計12時間 勉強した', category: 'daily', room: 'hall', sort: 15, cond: { kind: 'dailyHours', hours: 12 } },

  // 🔥 連続日数 Streak — Sheet5 (栄光の間)
  { id: 'streak_2',    image: IMG('sheet5_01'), title: '2日連続',        desc: '2日連続で勉強した',     category: 'streak', room: 'glory', sort: 1,  cond: { kind: 'streak', days: 2 } },
  { id: 'streak_3',    image: IMG('sheet5_02'), title: '3日坊主卒業',    desc: '3日連続で勉強した',     category: 'streak', room: 'glory', sort: 2,  cond: { kind: 'streak', days: 3 } },
  { id: 'streak_5',    image: IMG('sheet5_03'), title: '5日連続',        desc: '5日連続で勉強した',     category: 'streak', room: 'glory', sort: 3,  cond: { kind: 'streak', days: 5 } },
  { id: 'streak_7',    image: IMG('sheet5_04'), title: '1週間の戦士',    desc: '7日連続で勉強した',     category: 'streak', room: 'glory', sort: 4,  cond: { kind: 'streak', days: 7 } },
  { id: 'streak_10',   image: IMG('sheet5_05'), title: '10日連続',       desc: '10日連続で勉強した',    category: 'streak', room: 'glory', sort: 5,  cond: { kind: 'streak', days: 10 } },
  { id: 'streak_14',   image: IMG('sheet5_06'), title: '2週間の意志',    desc: '14日連続で勉強した',    category: 'streak', room: 'glory', sort: 6,  cond: { kind: 'streak', days: 14 } },
  { id: 'streak_21',   image: IMG('sheet5_07'), title: '3週間の習慣',    desc: '21日連続で勉強した',    category: 'streak', room: 'glory', sort: 7,  cond: { kind: 'streak', days: 21 } },
  { id: 'streak_30',   image: IMG('sheet5_08'), title: '継続は力なり',   desc: '30日連続で勉強した',    category: 'streak', room: 'glory', sort: 8,  cond: { kind: 'streak', days: 30 } },
  { id: 'streak_50',   image: IMG('sheet5_09'), title: '50日連続',       desc: '50日連続で勉強した',    category: 'streak', room: 'glory', sort: 9,  cond: { kind: 'streak', days: 50 } },
  { id: 'streak_100',  image: IMG('sheet5_10'), title: '鉄の意志',       desc: '100日連続で勉強した',   category: 'streak', room: 'glory', sort: 10, cond: { kind: 'streak', days: 100 } },
  { id: 'streak_365',  image: IMG('sheet5_11'), title: '不屈の一年',     desc: '365日連続で勉強した',   category: 'streak', room: 'glory', sort: 11, cond: { kind: 'streak', days: 365 } },

  // 🌸 デイリー＆おもしろ実績 — Sheet2 (こども部屋)
  { id: 'fun_first',    image: IMG('sheet2_01'), title: 'はじめまして',     desc: 'はじめて勉強を記録した',        category: 'fun', room: 'kids', sort: 20, cond: { kind: 'totalDays', days: 1 } },
  { id: 'fun_morning',  image: IMG('sheet2_02'), title: '朝活さん',         desc: '朝5〜8時に勉強した',            category: 'fun', room: 'kids', sort: 21, cond: { kind: 'morning' } },
  { id: 'fun_night',    image: IMG('sheet2_03'), title: '夜ふかし勉強',     desc: '深夜0〜5時に勉強した',          category: 'fun', room: 'kids', sort: 22, cond: { kind: 'nightCount', count: 1 } },
  { id: 'fun_weekend',  image: IMG('sheet2_04'), title: '週末も勉強',       desc: '土日に勉強した',                category: 'fun', room: 'kids', sort: 23, cond: { kind: 'weekend' } },
  { id: 'fun_multi',    image: IMG('sheet2_05'), title: '三刀流',           desc: '1日に3科目以上 勉強した',       category: 'fun', room: 'kids', sort: 24, cond: { kind: 'categoriesInDay', count: 3 } },
  { id: 'fun_7days',    image: IMG('sheet2_06'), title: '通算7日',          desc: '通算7日 勉強した',              category: 'fun', room: 'kids', sort: 25, cond: { kind: 'totalDays', days: 7 } },
  { id: 'fun_comeback', image: IMG('sheet2_07'), title: 'おかえり',         desc: '3日以上あけて勉強を再開した',   category: 'fun', room: 'kids', sort: 26, cond: { kind: 'comeback', gapDays: 3 } },
  { id: 'fun_30days',   image: IMG('sheet2_08'), title: '通算30日',         desc: '通算30日 勉強した',             category: 'fun', room: 'kids', sort: 27, cond: { kind: 'totalDays', days: 30 } },
  { id: 'fun_session2', image: IMG('sheet2_09'), title: 'ノンストップ2時間', desc: '1回で2時間ぶっ通し勉強した',    category: 'fun', room: 'kids', sort: 28, cond: { kind: 'sessionMinutes', minutes: 120 } },
  { id: 'fun_pomo10',   image: IMG('sheet2_10'), title: 'ポモドーロ名人',   desc: 'ポモドーロを通算10回やった',    category: 'fun', room: 'kids', sort: 29, cond: { kind: 'pomodoroCount', count: 10 } },
  { id: 'fun_goal',     image: IMG('sheet2_11'), title: '目標達成',         desc: '1日の目標時間を達成した',       category: 'fun', room: 'kids', sort: 30, cond: { kind: 'goalMet' } },

  // 🐕 Lily特別バッジ — Sheet6 + Sheet7 (Lilyの特別室)
  { id: 'sp_total250',  image: IMG('sheet6_01'), title: 'Lilyと250時間',   desc: '累計250時間 勉強した',          category: 'special', room: 'lily', sort: 1,  cond: { kind: 'totalHours', hours: 250 } },
  { id: 'sp_days100',   image: IMG('sheet6_02'), title: '百日の絆',         desc: '通算100日 勉強した',            category: 'special', room: 'lily', sort: 2,  cond: { kind: 'totalDays', days: 100 } },
  { id: 'sp_streak60',  image: IMG('sheet6_03'), title: 'Lily流・継続の魂', desc: '60日連続で勉強した',            category: 'special', room: 'lily', sort: 3,  cond: { kind: 'streak', days: 60 } },
  { id: 'sp_multi5',    image: IMG('sheet6_04'), title: '多才な学び',       desc: '5科目以上を記録した',           category: 'special', room: 'lily', sort: 4,  cond: { kind: 'categoriesTotal', count: 5 } },
  { id: 'sp_night3',    image: IMG('sheet6_05'), title: '真夜中の番人',     desc: '深夜勉強を3日 達成した',        category: 'special', room: 'lily', sort: 5,  cond: { kind: 'nightCount', count: 3 } },
  { id: 'sp_total700',  image: IMG('sheet7_01'), title: 'Lilyと700時間',   desc: '累計700時間 勉強した',          category: 'special', room: 'lily', sort: 6,  cond: { kind: 'totalHours', hours: 700 } },
  { id: 'sp_total2000', image: IMG('sheet7_02'), title: 'Lilyの伝説',       desc: '累計2000時間 勉強した',         category: 'special', room: 'lily', sort: 7,  cond: { kind: 'totalHours', hours: 2000 } },
  { id: 'sp_streak200', image: IMG('sheet7_03'), title: 'Lily流・不屈',     desc: '200日連続で勉強した',           category: 'special', room: 'lily', sort: 8,  cond: { kind: 'streak', days: 200 } },
  { id: 'sp_days200',   image: IMG('sheet7_04'), title: '二百日の絆',       desc: '通算200日 勉強した',            category: 'special', room: 'lily', sort: 9,  cond: { kind: 'totalDays', days: 200 } },
  { id: 'sp_year',      image: IMG('sheet7_05'), title: '一年の旅路',       desc: 'はじめてから1年が経った',       category: 'special', room: 'lily', sort: 10, cond: { kind: 'daysSinceFirst', days: 365 } },
  { id: 'sp_collector', image: IMG('sheet7_06'), title: 'バッジコレクター', desc: '全バッジの50%を集めた',         category: 'special', room: 'lily', sort: 11, cond: { kind: 'badgePercent', percent: 50 } },
];

export const ROOMS: { id: RoomId; name: string; emoji: string }[] = [
  { id: 'kids',  name: 'こども部屋',     emoji: '🧸' },
  { id: 'hall',  name: '大広間',         emoji: '🏛️' },
  { id: 'glory', name: '栄光の間',       emoji: '🔥' },
  { id: 'lily',  name: 'Lilyの特別室',   emoji: '🐕' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Stats computed from all study sessions (+ profile for the goal badge).
// ─────────────────────────────────────────────────────────────────────────────
export interface StudyStats {
  totalSeconds: number;
  longestStreak: number;
  currentStreak: number;
  maxDailySeconds: number;
  maxSessionSeconds: number;
  pomodoroCount: number;
  distinctDays: number;
  maxCategoriesInDay: number;
  distinctCategories: number;
  hasMorning: boolean;
  hasWeekend: boolean;
  nightDays: number;        // distinct days with a 0:00–5:00 session
  maxGapDays: number;       // longest gap (days) between two studied days
  daysSinceFirst: number;
  goalMet: boolean;
}

function dateToDayNum(date: string): number {
  // 'YYYY-MM-DD' -> integer day index (UTC, avoids DST drift)
  const [y, m, d] = date.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

function todayDayNum(): number {
  const n = new Date();
  return Math.floor(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()) / 86400000);
}

export function computeStudyStats(
  sessions: StudySession[],
  dailyGoalHours: number,
): StudyStats {
  const dayTotals = new Map<number, number>();        // dayNum -> seconds
  const dayCats = new Map<number, Set<number>>();     // dayNum -> categoryIds
  const allCats = new Set<number>();
  const nightDaySet = new Set<number>();
  let totalSeconds = 0;
  let maxSessionSeconds = 0;
  let pomodoroCount = 0;
  let hasMorning = false;
  let hasWeekend = false;

  for (const s of sessions) {
    if (!s.date) continue;
    const day = dateToDayNum(s.date);
    totalSeconds += s.duration;
    dayTotals.set(day, (dayTotals.get(day) ?? 0) + s.duration);
    if (s.duration > maxSessionSeconds) maxSessionSeconds = s.duration;
    if (s.source === 'pomodoro') pomodoroCount++;
    if (s.categoryId != null) {
      allCats.add(s.categoryId);
      if (!dayCats.has(day)) dayCats.set(day, new Set());
      dayCats.get(day)!.add(s.categoryId);
    }
    const start = new Date(s.startTime);
    const hour = start.getHours();
    if (hour >= 5 && hour < 8) hasMorning = true;
    if (hour < 5) nightDaySet.add(day);
    const wd = start.getDay();
    if (wd === 0 || wd === 6) hasWeekend = true;
  }

  const days = [...dayTotals.keys()].sort((a, b) => a - b);
  const daySet = new Set(days);

  // streaks + gaps
  let longestStreak = 0;
  let maxGapDays = 0;
  if (days.length > 0) {
    let run = 1;
    longestStreak = 1;
    for (let i = 1; i < days.length; i++) {
      const gap = days[i] - days[i - 1];
      if (gap === 1) {
        run++;
        if (run > longestStreak) longestStreak = run;
      } else {
        if (gap - 1 > maxGapDays) maxGapDays = gap - 1;
        run = 1;
      }
    }
  }

  // current streak: counting back from today (1-day grace if not yet studied today)
  let currentStreak = 0;
  if (days.length > 0) {
    const today = todayDayNum();
    let cursor = daySet.has(today) ? today : daySet.has(today - 1) ? today - 1 : null;
    while (cursor != null && daySet.has(cursor)) {
      currentStreak++;
      cursor--;
    }
  }

  let maxDailySeconds = 0;
  let maxCategoriesInDay = 0;
  for (const sec of dayTotals.values()) if (sec > maxDailySeconds) maxDailySeconds = sec;
  for (const set of dayCats.values()) if (set.size > maxCategoriesInDay) maxCategoriesInDay = set.size;

  const daysSinceFirst = days.length > 0 ? todayDayNum() - days[0] : 0;
  const goalMet = dailyGoalHours > 0 && maxDailySeconds >= dailyGoalHours * 3600;

  return {
    totalSeconds,
    longestStreak,
    currentStreak,
    maxDailySeconds,
    maxSessionSeconds,
    pomodoroCount,
    distinctDays: days.length,
    maxCategoriesInDay,
    distinctCategories: allCats.size,
    hasMorning,
    hasWeekend,
    nightDays: nightDaySet.size,
    maxGapDays,
    daysSinceFirst,
    goalMet,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Condition evaluation
// ─────────────────────────────────────────────────────────────────────────────

/** Numeric progress toward a condition: [current, target]. Boolean conditions
 *  report [0|1, 1]. badgePercent is handled by the caller. */
export function condProgress(cond: BadgeCondition, stats: StudyStats): [number, number] {
  switch (cond.kind) {
    case 'totalHours':      return [stats.totalSeconds / 3600, cond.hours];
    case 'streak':          return [stats.longestStreak, cond.days];
    case 'dailyHours':      return [stats.maxDailySeconds / 3600, cond.hours];
    case 'sessionMinutes':  return [stats.maxSessionSeconds / 60, cond.minutes];
    case 'pomodoroCount':   return [stats.pomodoroCount, cond.count];
    case 'totalDays':       return [stats.distinctDays, cond.days];
    case 'categoriesInDay': return [stats.maxCategoriesInDay, cond.count];
    case 'categoriesTotal': return [stats.distinctCategories, cond.count];
    case 'nightCount':      return [stats.nightDays, cond.count];
    case 'comeback':        return [stats.maxGapDays, cond.gapDays];
    case 'daysSinceFirst':  return [stats.daysSinceFirst, cond.days];
    case 'morning':         return [stats.hasMorning ? 1 : 0, 1];
    case 'weekend':         return [stats.hasWeekend ? 1 : 0, 1];
    case 'goalMet':         return [stats.goalMet ? 1 : 0, 1];
    case 'badgePercent':    return [0, 1]; // resolved by evaluateBadges
  }
}

function isEarnedNonMeta(cond: BadgeCondition, stats: StudyStats): boolean {
  if (cond.kind === 'badgePercent') return false;
  const [cur, target] = condProgress(cond, stats);
  return cur >= target;
}

/** Returns the set of earned badge IDs. badgePercent badges are resolved last. */
export function evaluateBadges(stats: StudyStats): Set<string> {
  const earned = new Set<string>();
  const meta: BadgeDef[] = [];
  let nonMetaTotal = 0;

  for (const b of BADGES) {
    if (b.cond.kind === 'badgePercent') { meta.push(b); continue; }
    nonMetaTotal++;
    if (isEarnedNonMeta(b.cond, stats)) earned.add(b.id);
  }

  for (const b of meta) {
    if (b.cond.kind !== 'badgePercent') continue;
    const pct = nonMetaTotal > 0 ? (earned.size / nonMetaTotal) * 100 : 0;
    if (pct >= b.cond.percent) earned.add(b.id);
  }
  return earned;
}

// ─────────────────────────────────────────────────────────────────────────────
// Persistence: reconcile earned badges into the DB, return newly-earned defs.
// ─────────────────────────────────────────────────────────────────────────────
export async function syncEarnedBadges(): Promise<BadgeDef[]> {
  const [sessions, already] = await Promise.all([
    db.studySessions.filter(s => !s.deletedAt).toArray(),
    db.earnedBadges.toArray(),
  ]);
  const profile = getStudyProfile();
  const stats = computeStudyStats(sessions, profile.dailyGoalHours);
  const earned = evaluateBadges(stats);

  const alreadyIds = new Set(already.map(e => e.badgeId));
  const now = Date.now();
  const toAdd: EarnedBadge[] = [];
  for (const id of earned) {
    if (!alreadyIds.has(id)) toAdd.push({ badgeId: id, earnedAt: now });
  }
  if (toAdd.length > 0) await db.earnedBadges.bulkPut(toAdd);

  const newIds = new Set(toAdd.map(e => e.badgeId));
  return BADGES.filter(b => newIds.has(b.id));
}

export function badgeById(id: string): BadgeDef | undefined {
  return BADGES.find(b => b.id === id);
}
