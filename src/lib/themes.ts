// Lily Memo — theme tokens. 5 brand-aligned themes.
// All honor the Shiba-Inu mascot (warm, cute, cozy) without being saccharine.

export interface ThemeFolders {
  pink: string;
  blue: string;
  green: string;
  yellow: string;
  purple: string;
}

export interface Theme {
  id: string;
  name: string;
  tag: string;

  bg: string;
  surface: string;
  surfaceAlt: string;
  surfaceDeep: string;

  fg: string;
  fgMuted: string;
  fgFaint: string;

  primary: string;
  primaryDeep: string;
  primaryFg: string;

  border: string;
  borderStrong: string;

  folders: ThemeFolders;

  fontDisplay: string;
  fontBody: string;
  fontLatin: string;
  fontMono: string;

  radius: number;
  radiusSm: number;
  radiusXs: number;

  shadow: string;
  shadowSoft: string;

  glassTint: string;

  dark: boolean;
  starfield?: boolean;
  fireworks?: boolean;
}

export const THEMES: Record<string, Theme> = {
  cream: {
    id: 'cream', name: 'Cream', tag: 'WARM · DEFAULT',
    bg: '#faf6ee', surface: '#ffffff', surfaceAlt: '#f3ede0',
    surfaceDeep: '#e8dfcb',
    fg: '#2c2620', fgMuted: '#8a7d6d', fgFaint: '#bfb2a0',
    primary: '#e08394', primaryDeep: '#c25c70', primaryFg: '#ffffff',
    border: '#ece3d2', borderStrong: '#d8cbb3',
    folders: { pink: '#e08394', blue: '#7eaed1', green: '#86b288', yellow: '#dcb15b', purple: '#a892c7' },
    fontDisplay: '"Plus Jakarta Sans","Noto Sans JP",system-ui,sans-serif',
    fontBody: '"Noto Sans JP","Plus Jakarta Sans",system-ui,sans-serif',
    fontLatin: '"Plus Jakarta Sans","Inter",system-ui,sans-serif',
    fontMono: '"JetBrains Mono",ui-monospace,monospace',
    radius: 14, radiusSm: 10, radiusXs: 6,
    shadow: '0 1px 2px rgba(60,40,20,0.04), 0 8px 24px -10px rgba(140,90,50,0.16)',
    shadowSoft: '0 1px 2px rgba(60,40,20,0.03), 0 3px 10px -6px rgba(140,90,50,0.10)',
    glassTint: 'rgba(255,253,247,0.78)',
    dark: false,
  },

  paper: {
    id: 'paper', name: 'Notebook', tag: 'PAPER · INK',
    bg: '#fbf8f1', surface: '#ffffff', surfaceAlt: '#f3eee2',
    surfaceDeep: '#e6dec9',
    fg: '#1f1c17', fgMuted: '#6b6357', fgFaint: '#a89e8f',
    primary: '#c75668', primaryDeep: '#9c3a4c', primaryFg: '#fefdfa',
    border: '#e6dec9', borderStrong: '#cdc1a8',
    folders: { pink: '#c75668', blue: '#5a82a8', green: '#688f5a', yellow: '#b9893a', purple: '#876aa3' },
    fontDisplay: '"Lora","Noto Serif JP",serif',
    fontBody: '"Noto Sans JP","Inter",system-ui,sans-serif',
    fontLatin: '"Lora","Inter",serif',
    fontMono: '"JetBrains Mono",ui-monospace,monospace',
    radius: 8, radiusSm: 5, radiusXs: 3,
    shadow: '0 1px 2px rgba(40,30,20,0.05), 0 10px 24px -10px rgba(40,30,20,0.18)',
    shadowSoft: '0 1px 1px rgba(40,30,20,0.04), 0 3px 8px -4px rgba(40,30,20,0.08)',
    glassTint: 'rgba(255,253,247,0.86)',
    dark: false,
  },

  clean: {
    id: 'clean', name: 'Studio', tag: 'CLEAN · LIGHT',
    bg: '#ffffff', surface: '#ffffff', surfaceAlt: '#f5f3ef',
    surfaceDeep: '#ebe7e0',
    fg: '#161412', fgMuted: '#7a7268', fgFaint: '#b8b0a4',
    primary: '#e74e6a', primaryDeep: '#c33756', primaryFg: '#ffffff',
    border: '#ece8e0', borderStrong: '#d4cec3',
    folders: { pink: '#e74e6a', blue: '#3b82c4', green: '#4ea36a', yellow: '#d4a01e', purple: '#8459b8' },
    fontDisplay: '"Plus Jakarta Sans","Noto Sans JP",system-ui,sans-serif',
    fontBody: '"Plus Jakarta Sans","Noto Sans JP",system-ui,sans-serif',
    fontLatin: '"Plus Jakarta Sans","Inter",system-ui,sans-serif',
    fontMono: '"JetBrains Mono",ui-monospace,monospace',
    radius: 12, radiusSm: 8, radiusXs: 5,
    shadow: '0 1px 2px rgba(0,0,0,0.04), 0 8px 28px -12px rgba(0,0,0,0.12)',
    shadowSoft: '0 1px 2px rgba(0,0,0,0.03), 0 2px 8px -4px rgba(0,0,0,0.06)',
    glassTint: 'rgba(255,255,255,0.86)',
    dark: false,
  },

  night: {
    id: 'night', name: 'Night', tag: 'DARK · COZY',
    bg: '#100d0a', surface: '#1a1614', surfaceAlt: '#251f1b',
    surfaceDeep: '#332b25',
    fg: '#f0ebe2', fgMuted: '#a39888', fgFaint: '#605648',
    primary: '#f4a4b0', primaryDeep: '#e07686', primaryFg: '#1a0f12',
    border: '#2a2420', borderStrong: '#3c332c',
    folders: { pink: '#f4a4b0', blue: '#92c0e0', green: '#a8d4a0', yellow: '#e8c878', purple: '#c0a8e0' },
    fontDisplay: '"Plus Jakarta Sans","Noto Sans JP",system-ui,sans-serif',
    fontBody: '"Noto Sans JP","Plus Jakarta Sans",system-ui,sans-serif',
    fontLatin: '"Plus Jakarta Sans","Inter",system-ui,sans-serif',
    fontMono: '"JetBrains Mono",ui-monospace,monospace',
    radius: 14, radiusSm: 10, radiusXs: 6,
    shadow: '0 1px 2px rgba(0,0,0,0.4), 0 12px 32px -12px rgba(244,164,176,0.18)',
    shadowSoft: '0 1px 2px rgba(0,0,0,0.3), 0 4px 12px -6px rgba(0,0,0,0.4)',
    glassTint: 'rgba(26,22,20,0.78)',
    dark: true,
  },

  starry: {
    id: 'starry', name: '夜空', tag: 'NIGHT SKY · DEEP',
    bg: '#070b17', surface: '#0d1426', surfaceAlt: '#141c35',
    surfaceDeep: '#1b2448',
    fg: '#dde6f8', fgMuted: '#7b8fb8', fgFaint: '#3d4f78',
    primary: '#89abf0', primaryDeep: '#5f82d4', primaryFg: '#050914',
    border: '#18244a', borderStrong: '#243260',
    folders: { pink: '#e87ab8', blue: '#89abf0', green: '#6dcfac', yellow: '#f0d074', purple: '#c09cf4' },
    fontDisplay: '"Plus Jakarta Sans","Noto Sans JP",system-ui,sans-serif',
    fontBody: '"Noto Sans JP","Plus Jakarta Sans",system-ui,sans-serif',
    fontLatin: '"Plus Jakarta Sans","Inter",system-ui,sans-serif',
    fontMono: '"JetBrains Mono",ui-monospace,monospace',
    radius: 14, radiusSm: 10, radiusXs: 6,
    shadow: '0 1px 3px rgba(0,0,0,0.7), 0 12px 32px -12px rgba(137,171,240,0.25)',
    shadowSoft: '0 1px 2px rgba(0,0,0,0.6), 0 4px 14px -6px rgba(0,0,0,0.55)',
    glassTint: 'rgba(7,11,23,0.84)',
    dark: true,
    starfield: true,
  },

  fireworks: {
    id: 'fireworks', name: '花火', tag: 'SUMMER · HANABI',
    bg: '#0a0a1f', surface: '#14132e', surfaceAlt: '#1d1b40',
    surfaceDeep: '#272357',
    fg: '#f0e9ff', fgMuted: '#9b93c8', fgFaint: '#534d80',
    primary: '#ff6f9c', primaryDeep: '#e0457b', primaryFg: '#1a0613',
    border: '#221f4a', borderStrong: '#332e63',
    folders: { pink: '#ff6f9c', blue: '#5fb8ff', green: '#5fe0b0', yellow: '#ffd45f', purple: '#b98cff' },
    fontDisplay: '"Plus Jakarta Sans","Noto Sans JP",system-ui,sans-serif',
    fontBody: '"Noto Sans JP","Plus Jakarta Sans",system-ui,sans-serif',
    fontLatin: '"Plus Jakarta Sans","Inter",system-ui,sans-serif',
    fontMono: '"JetBrains Mono",ui-monospace,monospace',
    radius: 14, radiusSm: 10, radiusXs: 6,
    shadow: '0 1px 3px rgba(0,0,0,0.7), 0 12px 32px -12px rgba(255,111,156,0.30)',
    shadowSoft: '0 1px 2px rgba(0,0,0,0.6), 0 4px 14px -6px rgba(0,0,0,0.55)',
    glassTint: 'rgba(10,10,31,0.84)',
    dark: true,
    fireworks: true,
  },

  flower: {
    id: 'flower', name: '花畑', tag: 'BLOOM · MEADOW',
    bg: '#fdf7f4', surface: '#ffffff', surfaceAlt: '#fbeef0',
    surfaceDeep: '#f3e2dd',
    fg: '#3a322e', fgMuted: '#8a7468', fgFaint: '#c2ab9e',
    primary: '#ec6f9e', primaryDeep: '#cf4d80', primaryFg: '#ffffff',
    border: '#f5e1de', borderStrong: '#e6c8c2',
    folders: { pink: '#ec6f9e', blue: '#74b7d8', green: '#7cbf7a', yellow: '#e6b94f', purple: '#b08cd4' },
    fontDisplay: '"Plus Jakarta Sans","Noto Sans JP",system-ui,sans-serif',
    fontBody: '"Noto Sans JP","Plus Jakarta Sans",system-ui,sans-serif',
    fontLatin: '"Plus Jakarta Sans","Inter",system-ui,sans-serif',
    fontMono: '"JetBrains Mono",ui-monospace,monospace',
    radius: 18, radiusSm: 12, radiusXs: 7,
    shadow: '0 1px 2px rgba(120,60,60,0.05), 0 10px 28px -12px rgba(236,111,158,0.22)',
    shadowSoft: '0 1px 2px rgba(120,60,60,0.04), 0 3px 10px -6px rgba(236,111,158,0.12)',
    glassTint: 'rgba(253,247,244,0.82)',
    dark: false,
  },

  library: {
    id: 'library', name: '図書館', tag: 'COZY · READING',
    bg: '#1c140d', surface: '#282016', surfaceAlt: '#33281c',
    surfaceDeep: '#42341f',
    fg: '#f1e6d2', fgMuted: '#b09a7a', fgFaint: '#6e5c43',
    primary: '#d8a24a', primaryDeep: '#b3812f', primaryFg: '#1c1409',
    border: '#352a1d', borderStrong: '#4a3c28',
    folders: { pink: '#d68a72', blue: '#7fa0a8', green: '#8aa06a', yellow: '#d8a24a', purple: '#a98fb0' },
    fontDisplay: '"Lora","Noto Serif JP",serif',
    fontBody: '"Noto Serif JP","Lora",serif',
    fontLatin: '"Lora","Inter",serif',
    fontMono: '"JetBrains Mono",ui-monospace,monospace',
    radius: 8, radiusSm: 5, radiusXs: 3,
    shadow: '0 1px 3px rgba(0,0,0,0.5), 0 12px 30px -12px rgba(216,162,74,0.16)',
    shadowSoft: '0 1px 2px rgba(0,0,0,0.4), 0 4px 12px -6px rgba(0,0,0,0.4)',
    glassTint: 'rgba(28,20,13,0.84)',
    dark: true,
  },
};

export const THEME_LIST = ['cream', 'paper', 'clean', 'night', 'starry', 'fireworks', 'flower', 'library'];

// ── Skins (解放スキン) ───────────────────────────────────────────────────────
// Plain themes are free; the fancy ones are premium "skins" unlocked with a
// single code (persisted in localStorage — no server needed). Seasonal skins
// additionally carry a 期間限定 badge.
export const PREMIUM_SKINS = new Set<string>(['starry', 'fireworks', 'flower', 'library']);
export const SEASONAL_SKINS: Record<string, string> = { flower: '春 限定', fireworks: '夏 限定' };
// Legacy character-skin unlock flag — pre-gacha, unlocked every skin at once
// via a single code. No longer settable, but still checked (lib/gacha.ts) so
// anyone who already unlocked with it keeps full access.
export const SKINS_STORAGE_KEY = 'lily-skins-unlocked';

export function isPremiumSkin(id: string): boolean {
  return PREMIUM_SKINS.has(id);
}

export const THEME_STORAGE_KEY = 'lily-memo-theme';

export const DEFAULT_THEME_ID = 'cream';

// ── User-selectable font (settings tab) ──────────────────────────
// Uses fonts already loaded (next/font) or system stacks so it works
// offline. `value: ''` means "follow the theme's own fonts".
export const FONT_STORAGE_KEY = 'lily-memo-font';

export interface FontOption {
  id: string;
  name: string;
  value: string;
}

export const FONT_OPTIONS: FontOption[] = [
  { id: 'default', name: 'テーマ標準', value: '' },
  { id: 'rounded', name: '丸ゴシック', value: 'var(--font-m-plus-rounded), "Noto Sans JP", sans-serif' },
  { id: 'gothic', name: 'ゴシック', value: 'system-ui, -apple-system, "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif' },
  { id: 'mincho', name: '明朝', value: '"Hiragino Mincho ProN", "Yu Mincho", "Noto Serif JP", serif' },
  { id: 'outfit', name: 'モダン', value: 'var(--font-outfit), "Noto Sans JP", sans-serif' },
  { id: 'mono', name: '等幅', value: 'ui-monospace, "SF Mono", "JetBrains Mono", monospace' },
];

export const DEFAULT_FONT_ID = 'default';

// Maps theme tokens onto the CSS custom properties the existing UI already
// uses, so every component restyles for all 5 themes without a rewrite.
export function themeCssVars(t: Theme): Record<string, string> {
  return {
    '--background': t.bg,
    '--foreground': t.fg,
    '--primary': t.primary,
    '--primary-dark': t.primaryDeep,
    '--primary-foreground': t.primaryFg,
    '--secondary': t.surface,
    '--accent': t.surfaceAlt,
    '--muted': t.surfaceDeep,
    '--border': t.border,
    '--radius': `${t.radius}px`,
    '--shadow': t.shadow,
    '--shadow-sm': t.shadowSoft,
    '--shadow-lg': t.shadow,

    '--surface': t.surface,
    // Cards are translucent on the starry/fireworks themes so the
    // animated night sky shows through behind them.
    '--card-bg': t.starfield ? 'rgba(13,20,38,0.62)' : t.fireworks ? 'rgba(20,19,46,0.66)' : t.surface,
    '--surface-alt': t.surfaceAlt,
    '--surface-deep': t.surfaceDeep,
    '--fg-muted': t.fgMuted,
    '--fg-faint': t.fgFaint,
    '--primary-deep': t.primaryDeep,
    '--border-strong': t.borderStrong,
    '--glass-tint': t.glassTint,
    '--radius-sm': `${t.radiusSm}px`,
    '--radius-xs': `${t.radiusXs}px`,

    '--folder-pink': t.folders.pink,
    '--folder-blue': t.folders.blue,
    '--folder-green': t.folders.green,
    '--folder-yellow': t.folders.yellow,
    '--folder-purple': t.folders.purple,

    '--font-display': t.fontDisplay,
    '--font-body': t.fontBody,
    '--font-latin': t.fontLatin,
    '--font-mono': t.fontMono,
  };
}
