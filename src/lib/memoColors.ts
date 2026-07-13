// Single source of truth for the memo text/highlight color palette, shared by
// the editor's toolbar swatches (NoteEditor) and the Markdown→TipTap converter
// that renders Lily's color syntax (markdownToTiptap). Each value mixes a
// saturated hue with the theme's foreground (text) or transparent (marker), so
// the same stored value stays readable in both light and dark themes.

export interface MemoColor {
  // Stable ASCII key Lily uses in memo Markdown ({red:…} / =={green}…==).
  key: string;
  // Human-readable name shown in the editor UI (translated via i18n).
  name: string;
  value: string;
}

export const TEXT_COLORS: MemoColor[] = [
  { key: 'red', name: '赤', value: 'color-mix(in srgb, #c62828 75%, var(--foreground) 25%)' },
  { key: 'orange', name: 'オレンジ', value: 'color-mix(in srgb, #c96f00 60%, var(--foreground) 40%)' },
  { key: 'green', name: '緑', value: 'color-mix(in srgb, #2e7d32 75%, var(--foreground) 25%)' },
  { key: 'blue', name: '青', value: 'color-mix(in srgb, #1565c0 75%, var(--foreground) 25%)' },
  { key: 'purple', name: '紫', value: 'color-mix(in srgb, #7b1fa2 60%, var(--foreground) 40%)' },
];

export const HIGHLIGHT_COLORS: MemoColor[] = [
  { key: 'yellow', name: '黄', value: 'color-mix(in srgb, #f5c518 48%, transparent)' },
  { key: 'green', name: '緑', value: 'color-mix(in srgb, #4caf50 40%, transparent)' },
  { key: 'blue', name: '青', value: 'color-mix(in srgb, #42a5f5 40%, transparent)' },
  { key: 'pink', name: 'ピンク', value: 'color-mix(in srgb, #ec407a 35%, transparent)' },
  { key: 'purple', name: '紫', value: 'color-mix(in srgb, #ab47bc 35%, transparent)' },
];

export const TEXT_COLOR_BY_KEY: Record<string, string> =
  Object.fromEntries(TEXT_COLORS.map(c => [c.key, c.value]));

export const HIGHLIGHT_COLOR_BY_KEY: Record<string, string> =
  Object.fromEntries(HIGHLIGHT_COLORS.map(c => [c.key, c.value]));
