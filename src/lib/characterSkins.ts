// Character skins — full costume re-skins of the Lily mascot (distinct from
// the color THEMES in themes.ts). All premium, unlocked with the same
// SKIN_UNLOCK_CODE used for premium themes (one purchase covers both).
export interface BubbleCorners {
  // Small decorative stickers (filenames under SKIN_BASE_PATH), one per
  // corner. Each is absolutely-positioned over the bubble corner rather than
  // stretched as a CSS border-image, so it never eats into the text width.
  tl: string;
  tr: string;
  bl: string;
  br: string;
}

export interface CharacterSkin {
  id: string;
  name: string;
  file: string; // filename under SKIN_BASE_PATH
  seasonal?: string; // 期間限定 badge label, if any
  accent: string; // costume-matching hex, tinted into chat/diary bubbles while equipped
  bubbleCorners?: BubbleCorners; // illustrated corner stickers for the Lily/diary bubbles, if art exists yet (currently unused — bubble decoration was reverted to default)
  background?: string; // square chat-screen background (filename under SKIN_BASE_PATH), if art exists yet
  avatarFrame?: string; // decorative ring around Lily's avatar with a transparent center (filename under SKIN_BASE_PATH), if art exists yet
}

export const SKIN_BASE_PATH = '/skins/lily/';

// AVATAR_FRAME_SCALE: how much bigger than the avatar an avatarFrame image
// should render, so the frame's transparent center hole lines up with the
// avatar's edge. Derived from the pirate frame (1024px canvas, ~482px hole
// diameter => 1024/482 ≈ 2.12); shared by all frames until one needs its own.
export const AVATAR_FRAME_SCALE = 2.12;

export const CHARACTER_SKINS: CharacterSkin[] = [
  {
    id: 'christmas', name: 'クリスマス', file: 'christmas.png', seasonal: '冬 限定', accent: '#c0392b',
    bubbleCorners: { tl: 'corner-christmas-tl.png', tr: 'corner-christmas-tr.png', bl: 'corner-christmas-bl.png', br: 'corner-christmas-br.png' },
    background: 'bg-christmas.jpg',
  },
  { id: 'birthday', name: 'ハッピーバースデイ', file: 'birthday.png', accent: '#ff4fa3' },
  { id: 'hero', name: 'ヒーロー', file: 'hero.png', accent: '#e63946', background: 'bg-hero.jpg' },
  {
    id: 'princess', name: 'プリンセス', file: 'princess.png', accent: '#d63384',
    bubbleCorners: { tl: 'corner-princess-tl.png', tr: 'corner-princess-tr.png', bl: 'corner-princess-bl.png', br: 'corner-princess-br.png' },
    background: 'bg-princess.jpg',
  },
  { id: 'ninja', name: '忍者', file: 'ninja.png', accent: '#7a1f2b' },
  {
    id: 'pirate', name: '海賊', file: 'pirate.png', accent: '#0e6e7a',
    background: 'bg-pirate.jpg', avatarFrame: 'frame-pirate.png',
  },
  { id: 'police', name: '警察', file: 'police.png', accent: '#1d3f72' },
];

export const CHARACTER_SKIN_STORAGE_KEY = 'lily-character-skin'; // '' = default look
