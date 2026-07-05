// Character skins — full costume re-skins of the Lily mascot (distinct from
// the color THEMES in themes.ts). All premium, unlocked with the same
// SKIN_UNLOCK_CODE used for premium themes (one purchase covers both).
export interface CharacterSkin {
  id: string;
  name: string;
  file: string; // filename under SKIN_BASE_PATH
  seasonal?: string; // 期間限定 badge label, if any
}

export const SKIN_BASE_PATH = '/skins/lily/';

export const CHARACTER_SKINS: CharacterSkin[] = [
  { id: 'christmas', name: 'クリスマス', file: 'christmas.png', seasonal: '冬 限定' },
  { id: 'birthday', name: 'ハッピーバースデイ', file: 'birthday.png' },
  { id: 'hero', name: 'ヒーロー', file: 'hero.png' },
  { id: 'princess', name: 'プリンセス', file: 'princess.png' },
  { id: 'ninja', name: '忍者', file: 'ninja.png' },
  { id: 'pirate', name: '海賊', file: 'pirate.png' },
  { id: 'police', name: '警察', file: 'police.png' },
];

export const CHARACTER_SKIN_STORAGE_KEY = 'lily-character-skin'; // '' = default look
