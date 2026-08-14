// Study level system. The level is derived purely from cumulative study time,
// so it stays in sync across devices for free (it's a function of the sessions
// already being synced). Quadratic formula — each level costs a bit more than
// the previous — but tuned so the early game is fast and the climb steepens
// dramatically once effects start. No upper cap; Tier 23 (キング, rainbow) is
// eternal.
//
//   hoursToReach(level) = COEF * (level - 1)^2

// Tuned so Tier 9 (プラチナ Ⅰ — the first tier with an effect) ≈ 300h and
// Tier 23 (キング) ≈ 5200h.
const COEF = 0.03;

// Tier-specific visual effects. 'none' for the early tiers (ブロンズ〜ゴールド);
// from プラチナ (Tier 9 ≈ 300h) up every tier gets its own metal, and the
// effects escalate all the way to the full rainbow of キング (Tier 23).
export type LevelFx =
  | 'none'
  | 'platinum1' | 'platinum2'   // T9,  T10 — プラチナ Ⅰ/Ⅱ
  | 'emerald1'  | 'emerald2'    // T11, T12 — エメラルド Ⅰ/Ⅱ
  | 'diamond1'  | 'diamond2'    // T13, T14 — ダイヤモンド Ⅰ/Ⅱ
  | 'elite1'    | 'elite2'      // T15, T16 — エリート Ⅰ/Ⅱ
  | 'ace1'      | 'ace2'        // T17, T18 — エース Ⅰ/Ⅱ
  | 'champion1' | 'champion2'   // T19, T20 — チャンピオン Ⅰ/Ⅱ
  | 'champion3' | 'champion4'   // T21, T22 — チャンピオン Ⅲ/Ⅳ
  | 'king';                     // T23      — キング（最大演出）

/** Rotating light behind the trophy. Gets grander with the tier. */
export type LevelRing = 'none' | 'halo' | 'orbit' | 'crown';

/**
 * 段位名チップの見た目。
 *   plain — ただの色付きピル（ブロンズ〜プラチナ）
 *   fancy — 金属の縁取り＋光沢が流れる（エメラルド〜ダイヤモンド）
 *   wild  — 縁が回る・脈打つ・光沢が走る（エリート以上）。ここから学習タブ
 *           全体にもオーラが出る（`ambient`）。
 */
export type LevelChipFx = 'plain' | 'fancy' | 'wild';

// Per-tier knobs for the trophy animation (see LevelIcon.tsx). The headline
// effect is a *metal gloss*: a specular band swept across the trophy's own
// silhouette (CSS mask), so higher tiers literally shine like the metal they
// are named after. Everything else — aura, rotating ring, floating motes,
// 3D tilt — layers on top of that and scales with `power`.
export interface LevelFxSpec {
  power: number;      // 0..1 — 全体の強さ（オーラの太さ・脈動の速さ）
  metal: string;      // 光沢バンドの芯の色（金属の種類そのもの）
  metalEdge: string;  // 光沢バンドの縁の色（回り込む反射光）
  sheen: number;      // 光沢の強さ 0..1
  sheenDur: number;   // 光沢が一周する秒数（短いほど忙しい）
  aura: string;       // 背後の発光オーラ
  aura2: string;      // 外周リングの色
  ring: LevelRing;    // 回転リングの種類
  sparks: number;     // 舞う光の粒の数
  tilt: boolean;      // ゆっくり傾いて金属面が光を返す 3D 演出
  rainbow: boolean;   // 最高段：色相が巡回する全虹
  chip: LevelChipFx;  // 段位名チップ（「ゴールド Ⅱ」の札）の派手さ
  ambient: number;    // 学習タブ全体に広がる演出の強さ 0..1（0 = 出さない）
}

export const LEVEL_FX: Record<Exclude<LevelFx, 'none'>, LevelFxSpec> = {
  // ── プラチナ — 白銀の金属光沢がゆっくり流れる（初めてのエフェクト）──
  platinum1: { power: 0.10, metal: '#ffffff', metalEdge: '#bae6fd', sheen: 0.55, sheenDur: 4.6, aura: 'rgba(125,211,252,0.45)', aura2: 'rgba(224,242,254,0.5)', ring: 'none',  sparks: 0,  tilt: false, rainbow: false, chip: 'plain', ambient: 0 },
  platinum2: { power: 0.18, metal: '#ffffff', metalEdge: '#7dd3fc', sheen: 0.65, sheenDur: 4.2, aura: 'rgba(56,189,248,0.55)',  aura2: 'rgba(186,230,253,0.6)', ring: 'none',  sparks: 3,  tilt: false, rainbow: false, chip: 'plain', ambient: 0 },
  // ── エメラルド — 翠の照り返し＋オーラ ──────────────────────────
  emerald1:  { power: 0.26, metal: '#ecfdf5', metalEdge: '#34d399', sheen: 0.7,  sheenDur: 3.9, aura: 'rgba(52,211,153,0.6)',   aura2: 'rgba(16,185,129,0.5)',  ring: 'none',  sparks: 4,  tilt: false, rainbow: false, chip: 'fancy', ambient: 0 },
  emerald2:  { power: 0.34, metal: '#d1fae5', metalEdge: '#10b981', sheen: 0.78, sheenDur: 3.6, aura: 'rgba(16,185,129,0.7)',   aura2: 'rgba(52,211,153,0.6)',  ring: 'halo',  sparks: 5,  tilt: false, rainbow: false, chip: 'fancy', ambient: 0 },
  // ── ダイヤモンド — 白の閃光が走り、光輪が回る ──────────────────
  diamond1:  { power: 0.42, metal: '#ffffff', metalEdge: '#c7d2fe', sheen: 0.85, sheenDur: 3.3, aura: 'rgba(199,210,254,0.7)',  aura2: 'rgba(255,255,255,0.6)', ring: 'halo',  sparks: 6,  tilt: false, rainbow: false, chip: 'fancy', ambient: 0 },
  diamond2:  { power: 0.50, metal: '#ffffff', metalEdge: '#a5b4fc', sheen: 0.9,  sheenDur: 3.0, aura: 'rgba(165,180,252,0.8)',  aura2: 'rgba(224,231,255,0.7)', ring: 'halo',  sparks: 7,  tilt: true,  rainbow: false, chip: 'fancy', ambient: 0 },
  // ── エリート — 蒼氷の金属＋周回する光 ──────────────────────────
  elite1:    { power: 0.58, metal: '#e0f2fe', metalEdge: '#3b82f6', sheen: 0.92, sheenDur: 2.8, aura: 'rgba(96,165,250,0.8)',   aura2: 'rgba(191,219,254,0.7)', ring: 'orbit', sparks: 8,  tilt: true,  rainbow: false, chip: 'wild', ambient: 0.55 },
  elite2:    { power: 0.64, metal: '#e0e7ff', metalEdge: '#6366f1', sheen: 0.94, sheenDur: 2.7, aura: 'rgba(99,102,241,0.85)',  aura2: 'rgba(165,180,252,0.75)', ring: 'orbit', sparks: 9, tilt: true,  rainbow: false, chip: 'wild', ambient: 0.63 },
  // ── エース — 黒曜石にクロームの閃光 ────────────────────────────
  ace1:      { power: 0.70, metal: '#f8fafc', metalEdge: '#7f88b8', sheen: 1.0,  sheenDur: 2.5, aura: 'rgba(127,136,184,0.85)', aura2: 'rgba(226,232,240,0.75)', ring: 'orbit', sparks: 10, tilt: true,  rainbow: false, chip: 'wild', ambient: 0.70 },
  ace2:      { power: 0.76, metal: '#f5f3ff', metalEdge: '#9d8ae0', sheen: 1.0,  sheenDur: 2.4, aura: 'rgba(157,138,224,0.9)',  aura2: 'rgba(221,214,254,0.8)', ring: 'orbit', sparks: 11, tilt: true,  rainbow: false, chip: 'wild', ambient: 0.77 },
  // ── チャンピオン Ⅰ–Ⅳ — 紅蓮から宇宙色へ ───────────────────────
  champion1: { power: 0.82, metal: '#fff1f2', metalEdge: '#ef4444', sheen: 1.0,  sheenDur: 2.3, aura: 'rgba(239,68,68,0.9)',    aura2: 'rgba(254,205,211,0.8)', ring: 'orbit', sparks: 12, tilt: true,  rainbow: false, chip: 'wild', ambient: 0.83 },
  champion2: { power: 0.86, metal: '#fdf2f8', metalEdge: '#ec4899', sheen: 1.0,  sheenDur: 2.2, aura: 'rgba(236,72,153,0.9)',   aura2: 'rgba(251,207,232,0.8)', ring: 'orbit', sparks: 13, tilt: true,  rainbow: false, chip: 'wild', ambient: 0.88 },
  champion3: { power: 0.90, metal: '#f5f3ff', metalEdge: '#7c6cf5', sheen: 1.0,  sheenDur: 2.1, aura: 'rgba(124,108,245,0.95)', aura2: 'rgba(196,181,253,0.85)', ring: 'crown', sparks: 14, tilt: true,  rainbow: false, chip: 'wild', ambient: 0.93 },
  champion4: { power: 0.94, metal: '#faf5ff', metalEdge: '#b06cf7', sheen: 1.0,  sheenDur: 2.0, aura: 'rgba(176,108,247,0.95)', aura2: 'rgba(233,213,255,0.85)', ring: 'crown', sparks: 15, tilt: true,  rainbow: false, chip: 'wild', ambient: 0.97 },
  // ── キング — 全虹（回転する王冠光＋色相巡回、最大演出）─────────
  king:      { power: 1.00, metal: '#ffffff', metalEdge: '#ffd24d', sheen: 1.0,  sheenDur: 1.8, aura: 'rgba(232,121,249,0.95)', aura2: 'rgba(255,210,77,0.9)',  ring: 'crown', sparks: 18, tilt: true,  rainbow: true,  chip: 'wild', ambient: 1.00 },
};

/** 段位の通し番号（1〜4）を Ⅰ〜Ⅳ の表記にする。 */
export const TIER_RANK_LABELS = ['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ'] as const;

export interface LevelTier {
  minLevel: number;
  group: string;  // 段位名（ブロンズ／シルバー／…／キング）— i18n のキーでもある
  rank: number;   // 段位内の序数 1..4（キングは 0 = 序数なし）
  emoji: string;  // fallback shown until the icon image loads
  icon: string;   // /level/tierN.png
  color: string;  // accent color for the XP bar / level number
  fx: LevelFx;    // tier-specific visual effect (Tier 9+)
}

// 23 visual tiers. Highest first so tierForLevel returns the first match.
// Tiers 1–8 (ブロンズ〜ゴールド) cluster in the first ~300h as an accessible
// warm-up with no effects at all; from Tier 9 (プラチナ Ⅰ = 累計300時間) every
// tier carries its own metal gloss. Tier 9 以降は「1段に必要な時間が毎段
// 少しずつ増える」形（+139h → +241h）にしてあり、頂点の キングは累計
// 約3000時間。ずっと加速させると到達不能になるので、伸び幅の増え方は
// 一定に抑えている。
//   t1  Lv1(0h)     t2  Lv21(12h)    t3  Lv38(41h)    t4  Lv51(75h)
//   t5  Lv63(115h)  t6  Lv74(160h)   t7  Lv86(217h)   t8  Lv95(265h)
//   t9  Lv101(300h) t10 Lv122(439h)  t11 Lv141(588h)  t12 Lv159(749h)
//   t13 Lv175(908h) t14 Lv191(1083h) t15 Lv206(1261h) t16 Lv221(1452h)
//   t17 Lv236(1657h) t18 Lv250(1860h) t19 Lv264(2075h) t20 Lv277(2285h)
//   t21 Lv291(2523h) t22 Lv304(2754h) t23 Lv317(2996h ≈ 3000h)
export const LEVEL_TIERS: LevelTier[] = [
  { minLevel: 317, group: 'キング',       rank: 0, emoji: '👑', icon: '/level/tier23.png', color: '#e879f9', fx: 'king' },
  { minLevel: 304, group: 'チャンピオン', rank: 4, emoji: '🌌', icon: '/level/tier22.png', color: '#b06cf7', fx: 'champion4' },
  { minLevel: 291, group: 'チャンピオン', rank: 3, emoji: '🌌', icon: '/level/tier21.png', color: '#7c6cf5', fx: 'champion3' },
  { minLevel: 277, group: 'チャンピオン', rank: 2, emoji: '🔥', icon: '/level/tier20.png', color: '#ec4899', fx: 'champion2' },
  { minLevel: 264, group: 'チャンピオン', rank: 1, emoji: '🔥', icon: '/level/tier19.png', color: '#ef4444', fx: 'champion1' },
  { minLevel: 250, group: 'エース',       rank: 2, emoji: '🖤', icon: '/level/tier18.png', color: '#9d8ae0', fx: 'ace2' },
  { minLevel: 236, group: 'エース',       rank: 1, emoji: '🖤', icon: '/level/tier17.png', color: '#7f88b8', fx: 'ace1' },
  { minLevel: 221, group: 'エリート',     rank: 2, emoji: '🔷', icon: '/level/tier16.png', color: '#5145e5', fx: 'elite2' },
  { minLevel: 206, group: 'エリート',     rank: 1, emoji: '🔹', icon: '/level/tier15.png', color: '#2f6fed', fx: 'elite1' },
  { minLevel: 191, group: 'ダイヤモンド', rank: 2, emoji: '💎', icon: '/level/tier14.png', color: '#818cf8', fx: 'diamond2' },
  { minLevel: 175, group: 'ダイヤモンド', rank: 1, emoji: '💎', icon: '/level/tier13.png', color: '#a5b4fc', fx: 'diamond1' },
  { minLevel: 159, group: 'エメラルド',   rank: 2, emoji: '💚', icon: '/level/tier12.png', color: '#10b981', fx: 'emerald2' },
  { minLevel: 141, group: 'エメラルド',   rank: 1, emoji: '💚', icon: '/level/tier11.png', color: '#34d399', fx: 'emerald1' },
  { minLevel: 122, group: 'プラチナ',     rank: 2, emoji: '💠', icon: '/level/tier10.png', color: '#38bdf8', fx: 'platinum2' },
  { minLevel: 101, group: 'プラチナ',     rank: 1, emoji: '💠', icon: '/level/tier9.png',  color: '#7dd3fc', fx: 'platinum1' },
  { minLevel: 95,  group: 'ゴールド',     rank: 3, emoji: '🥇', icon: '/level/tier8.png',  color: '#ffc107', fx: 'none' },
  { minLevel: 86,  group: 'ゴールド',     rank: 2, emoji: '🥇', icon: '/level/tier7.png',  color: '#f4b400', fx: 'none' },
  { minLevel: 74,  group: 'ゴールド',     rank: 1, emoji: '🥇', icon: '/level/tier6.png',  color: '#f59e0b', fx: 'none' },
  { minLevel: 63,  group: 'シルバー',     rank: 3, emoji: '🥈', icon: '/level/tier5.png',  color: '#cbd2dc', fx: 'none' },
  { minLevel: 51,  group: 'シルバー',     rank: 2, emoji: '🥈', icon: '/level/tier4.png',  color: '#b6bcc6', fx: 'none' },
  { minLevel: 38,  group: 'シルバー',     rank: 1, emoji: '🥈', icon: '/level/tier3.png',  color: '#9ca3af', fx: 'none' },
  { minLevel: 21,  group: 'ブロンズ',     rank: 2, emoji: '🥉', icon: '/level/tier2.png',  color: '#d8884a', fx: 'none' },
  { minLevel: 1,   group: 'ブロンズ',     rank: 1, emoji: '🥉', icon: '/level/tier1.png',  color: '#cd7f32', fx: 'none' },
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

/** その段の効果設定（エフェクトの無い段は null）。 */
export function fxSpecFor(tier: LevelTier): LevelFxSpec | null {
  return tier.fx === 'none' ? null : LEVEL_FX[tier.fx];
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

/** Cumulative hours needed to reach a tier (its first level). */
export function hoursForTier(tier: LevelTier): number {
  return hoursForLevel(tier.minLevel);
}

/** Tiers listed low → high (LEVEL_TIERS is stored highest-first for lookup). */
export const LEVEL_TIERS_ASC: LevelTier[] = [...LEVEL_TIERS].reverse();

/** 通し番号（1〜23）。UI の "TIER 23" 表記や強さの段階計算に使う。 */
export function tierNumber(tier: LevelTier): number {
  return LEVEL_TIERS_ASC.findIndex(x => x.minLevel === tier.minLevel) + 1;
}

/**
 * 段位名。`ブロンズ Ⅰ` のように「区間名＋その中での序数」で表す。
 * 序数を持たないキングだけは区間名そのもの。区間名は i18n のキーなので、
 * 表示側で `t(tier.group)` して英語にできるよう translate を渡せる。
 */
export function tierName(tier: LevelTier, translate?: (s: string) => string): string {
  const group = translate ? translate(tier.group) : tier.group;
  if (tier.rank < 1) return group;
  return `${group} ${TIER_RANK_LABELS[tier.rank - 1] ?? tier.rank}`;
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
