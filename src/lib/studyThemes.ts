// 学習タブの「見た目テーマ」。段位（Tier）そのものは累計時間で勝手に決まる
// ——つまり選べない——ので、光の色だけは自分で選べるようにしたもの。
//
// 2つの意味でレベルに連動する:
//   1. 解禁 — テーマごとに `minTier` があり、そこへ到達して初めて選べる。
//      レベルが上がるほど選択肢が増える。
//   2. 強さ — 演出の濃さ・速さ・粒の数は今までどおり現在の段位の
//      `LevelFxSpec.power / ambient` が決める。つまり同じテーマでも上の段
//      ほど派手になる。テーマは「色」を、段位は「強さ」を担当する。
//
// トロフィーの絵とその金属光沢だけはテーマの影響を受けない。あれは段位その
// もの（アイデンティティ）で、着せ替えの対象ではないため。
import type { LevelTier } from './level';
import { tierNumber, LEVEL_TIERS_ASC, tierName } from './level';

export interface StudyTheme {
  id: string;
  name: string;    // 日本語のまま = i18n のキー
  emoji: string;
  minTier: number; // 解禁に必要な通し段位（1 = 最初から）
  color: string;   // 主色。Lv の数字・バー・枠・オーラに使う
  edge: string;    // 副色。光沢の縁・外周リング・下側のオーロラ
  metal: string;   // 光沢の芯（いちばん明るいところ）
  rainbow: boolean; // 全虹（色相が巡回する）
}

/** 段位そのままの色を使う既定テーマの id。 */
export const DEFAULT_THEME_ID = 'tier';

export const STUDY_THEMES: StudyTheme[] = [
  { id: 'tier',    name: '段位カラー', emoji: '🏆', minTier: 1,  color: '',        edge: '',        metal: '',        rainbow: false },
  { id: 'aurora',  name: 'オーロラ',   emoji: '🌌', minTier: 1,  color: '#3fbfa8', edge: '#7c6cf5', metal: '#eafff8', rainbow: false },
  { id: 'neon',    name: 'ネオン',     emoji: '🌃', minTier: 9,  color: '#e838c8', edge: '#22d3ee', metal: '#ffffff', rainbow: false },
  { id: 'forest',  name: '森',         emoji: '🌿', minTier: 11, color: '#2f9e5f', edge: '#a3e635', metal: '#f0fff4', rainbow: false },
  { id: 'frost',   name: '氷晶',       emoji: '❄️', minTier: 13, color: '#4aa8d8', edge: '#c7f0ff', metal: '#ffffff', rainbow: false },
  { id: 'thunder', name: '蒼雷',       emoji: '⚡', minTier: 15, color: '#2f6fed', edge: '#ffd24d', metal: '#eaf2ff', rainbow: false },
  { id: 'obsidian',name: '黒曜',       emoji: '🖤', minTier: 17, color: '#6b5fa8', edge: '#c8b6ff', metal: '#f5f3ff', rainbow: false },
  { id: 'crimson', name: '紅蓮',       emoji: '🔥', minTier: 19, color: '#e0402f', edge: '#ffa23a', metal: '#fff3ec', rainbow: false },
  { id: 'starsea', name: '星海',       emoji: '✨', minTier: 21, color: '#7b4fe0', edge: '#ffd24d', metal: '#f8f0ff', rainbow: false },
  { id: 'rainbow', name: '虹',         emoji: '🌈', minTier: 23, color: '#e879f9', edge: '#ffd24d', metal: '#ffffff', rainbow: true },
];

export function themeById(id: string): StudyTheme {
  return STUDY_THEMES.find(x => x.id === id) ?? STUDY_THEMES[0];
}

/** そのテーマを解禁するのに必要な段位（表示用。最初から使えるものは null）。 */
export function unlockTierOf(theme: StudyTheme): LevelTier | null {
  if (theme.minTier <= 1) return null;
  return LEVEL_TIERS_ASC[theme.minTier - 1] ?? null;
}

/** 解禁条件の文言（「エース Ⅰ で解禁」）。translate は i18n の t。 */
export function unlockLabel(theme: StudyTheme, translate?: (s: string) => string): string {
  const tier = unlockTierOf(theme);
  return tier ? tierName(tier, translate) : '';
}

export function isThemeUnlocked(theme: StudyTheme, tier: LevelTier): boolean {
  return tierNumber(tier) >= theme.minTier;
}

/**
 * 実際に描画に使う色。テーマが `tier` のときは段位の色をそのまま返すので、
 * 呼び出し側は分岐せずにこれを使えばいい。
 */
export interface ThemeLook {
  color: string;
  edge: string;
  metal: string;
  rainbow: boolean;
}

export function resolveLook(
  tier: LevelTier,
  themeId: string,
  fallback: { metal: string; edge: string; rainbow: boolean } | null,
): ThemeLook {
  const theme = themeById(themeId);
  if (theme.id === DEFAULT_THEME_ID || !isThemeUnlocked(theme, tier)) {
    return {
      color: tier.color,
      edge: fallback?.edge ?? tier.color,
      metal: fallback?.metal ?? '#ffffff',
      rainbow: fallback?.rainbow ?? false,
    };
  }
  return { color: theme.color, edge: theme.edge, metal: theme.metal, rainbow: theme.rainbow };
}

// ── 保存（端末ローカル。バックアップ/同期の対象ではない見た目設定）──────
const LS_KEY = 'lily_study_theme';
export const STUDY_THEME_EVENT = 'lily-study-theme-changed';

export function getStudyThemeId(): string {
  if (typeof window === 'undefined') return DEFAULT_THEME_ID;
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw && STUDY_THEMES.some(x => x.id === raw) ? raw : DEFAULT_THEME_ID;
  } catch {
    return DEFAULT_THEME_ID;
  }
}

export function saveStudyThemeId(id: string): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(LS_KEY, id);
  } catch {
    /* ストレージが使えなくても表示は続けられるので握りつぶす */
  }
  window.dispatchEvent(new Event(STUDY_THEME_EVENT));
}
