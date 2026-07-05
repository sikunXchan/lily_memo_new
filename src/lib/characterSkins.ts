// Character skins — full costume re-skins of the Lily mascot (distinct from
// the color THEMES in themes.ts). All premium, unlocked with the same
// SKIN_UNLOCK_CODE used for premium themes (one purchase covers both).
export interface BubbleFrame {
  file: string; // filename under SKIN_BASE_PATH; a 9-slice frame with corner
  // art and a plain stretchable interior/edges (see border-image-slice).
  slice: [number, number, number, number]; // border-image-slice (top right bottom left), in the file's own px
  width: [number, number, number, number]; // on-screen border-image-width (top right bottom left), in CSS px
}

export interface CharacterSkin {
  id: string;
  name: string;
  file: string; // filename under SKIN_BASE_PATH
  seasonal?: string; // 期間限定 badge label, if any
  accent: string; // costume-matching hex, tinted into small fixed-size accents (e.g. the typing indicator)
  bubbleFrame?: BubbleFrame; // full illustrated frame for the Lily/diary bubbles, if art exists yet
}

export const SKIN_BASE_PATH = '/skins/lily/';

export const CHARACTER_SKINS: CharacterSkin[] = [
  {
    id: 'christmas', name: 'クリスマス', file: 'christmas.png', seasonal: '冬 限定', accent: '#c0392b',
    bubbleFrame: { file: 'bubble-christmas.png', slice: [145, 217, 185, 185], width: [42, 62, 54, 54] },
  },
  { id: 'birthday', name: 'ハッピーバースデイ', file: 'birthday.png', accent: '#ff4fa3' },
  { id: 'hero', name: 'ヒーロー', file: 'hero.png', accent: '#e63946' },
  {
    id: 'princess', name: 'プリンセス', file: 'princess.png', accent: '#d63384',
    bubbleFrame: { file: 'bubble-princess.png', slice: [239, 219, 179, 239], width: [58, 54, 44, 58] },
  },
  { id: 'ninja', name: '忍者', file: 'ninja.png', accent: '#7a1f2b' },
  { id: 'pirate', name: '海賊', file: 'pirate.png', accent: '#0e6e7a' },
  { id: 'police', name: '警察', file: 'police.png', accent: '#1d3f72' },
];

export const CHARACTER_SKIN_STORAGE_KEY = 'lily-character-skin'; // '' = default look
