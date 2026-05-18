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
};

export const THEME_LIST = ['cream', 'paper', 'clean', 'night', 'starry'];

export const THEME_STORAGE_KEY = 'lily-memo-theme';

export const DEFAULT_THEME_ID = 'cream';

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
