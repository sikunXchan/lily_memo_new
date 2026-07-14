// Character skins — full costume re-skins of the Lily mascot (distinct from
// the old color THEMES, now removed). All premium, unlocked with the same
// SKIN_UNLOCK_CODE. スキンの追加手順は public/skins/README.md を参照。
export interface BubbleCorners {
  // Small decorative stickers (filenames under SKIN_BASE_PATH), one per
  // corner. Each is absolutely-positioned over the bubble corner rather than
  // stretched as a CSS border-image, so it never eats into the text width.
  tl: string;
  tr: string;
  bl: string;
  br: string;
}

// レアリティ:
//   N  … 通常。着せ替えアバターのみ。
//   R  … 金枠。チャット背景 + ホーム/メモツリーにも同じ背景が出る。
//   UR … 虹枠。R の内容 + 専用ホーム背景(homeBackground) + アンビエント演出。
export type SkinRarity = 'N' | 'R' | 'UR';

export const RARITY_ORDER: Record<SkinRarity, number> = { UR: 0, R: 1, N: 2 };

export interface CharacterSkin {
  id: string;
  name: string;
  file?: string; // costume art filename under SKIN_BASE_PATH; omit to keep the default Lily look
  seasonal?: string; // 期間限定 badge label, if any
  accent: string; // costume-matching hex (used for small accents)
  rarity: SkinRarity;
  bubbleCorners?: BubbleCorners; // (currently unused — bubble decoration was reverted to default)
  background?: string; // square chat-screen background (filename under SKIN_BASE_PATH). R以上で必須
  homeBackground?: string; // square background for home/memo-tree etc. UR専用(RはbackgroundをそのままR共用)
  ambient?: string[]; // floating particle images for the UR ambient effect (filenames under SKIN_BASE_PATH)
  avatarFrame?: string; // decorative ring around Lily's avatar with a transparent center
}

export const SKIN_BASE_PATH = '/skins/lily/';

// AVATAR_FRAME_SCALE: how much bigger than the avatar an avatarFrame image
// should render, so the frame's transparent center hole lines up with the
// avatar's edge. Derived from the pirate frame (1024px canvas, ~482px hole
// diameter => 1024/482 ≈ 2.12); shared by all frames until one needs its own.
export const AVATAR_FRAME_SCALE = 2.12;

export const CHARACTER_SKINS: CharacterSkin[] = [
  {
    id: 'yukata', name: '浴衣', file: 'yukata.png', accent: '#e8590c', rarity: 'UR', seasonal: '夏 限定',
    background: 'bg-yukata.jpg',
    homeBackground: 'home-yukata.jpg',
    ambient: [
      'ambient-yukata-1.png', 'ambient-yukata-2.png', 'ambient-yukata-3.png',
      'ambient-yukata-4.png', 'ambient-yukata-5.png', 'ambient-yukata-6.png',
      'ambient-yukata-7.png',
    ],
  },
  {
    id: 'christmas', name: 'クリスマス', file: 'christmas.png', seasonal: '冬 限定', accent: '#c0392b', rarity: 'R',
    bubbleCorners: { tl: 'corner-christmas-tl.png', tr: 'corner-christmas-tr.png', bl: 'corner-christmas-bl.png', br: 'corner-christmas-br.png' },
    background: 'bg-christmas.jpg',
  },
  { id: 'hero', name: 'ヒーロー', file: 'hero.png', accent: '#e63946', rarity: 'R', background: 'bg-hero.jpg' },
  {
    id: 'princess', name: 'プリンセス', file: 'princess.png', accent: '#d63384', rarity: 'R',
    bubbleCorners: { tl: 'corner-princess-tl.png', tr: 'corner-princess-tr.png', bl: 'corner-princess-bl.png', br: 'corner-princess-br.png' },
    background: 'bg-princess.jpg',
  },
  {
    // avatarFrame: 'frame-pirate.png' exists but overflowed the header bar
    // and looked broken there — removed for now, pending a better spot/size.
    id: 'pirate', name: '海賊', file: 'pirate.png', accent: '#0e6e7a', rarity: 'R',
    background: 'bg-pirate.jpg',
  },
  { id: 'birthday', name: 'ハッピーバースデイ', file: 'birthday.png', accent: '#ff4fa3', rarity: 'N' },
  { id: 'ninja', name: '忍者', file: 'ninja.png', accent: '#7a1f2b', rarity: 'N' },
  { id: 'police', name: '警察', file: 'police.png', accent: '#1d3f72', rarity: 'N' },
  {
    id: 'boxer', name: 'プロボクサー', file: 'boxer.png', accent: '#d4a017', rarity: 'UR',
    background: 'bg-boxer.jpg',
    homeBackground: 'home-boxer.jpg',
    ambient: [
      'ambient-boxer-1.png', 'ambient-boxer-2.png', 'ambient-boxer-3.png', 'ambient-boxer-4.png',
      'ambient-boxer-5.png', 'ambient-boxer-6.png', 'ambient-boxer-7.png', 'ambient-boxer-8.png',
    ],
  },
  { id: 'hacker', name: 'ハッカー', file: 'hacker.png', accent: '#00e676', rarity: 'N' },
  { id: 'doctor', name: '医者', file: 'doctor.png', accent: '#1976d2', rarity: 'N' },
  // 背景素材が未提供のため background は省略（R本来の仕様ではチャット背景必須だが、
  // 素材が届き次第 bg-detective.jpg を追加すれば自動で反映される）。
  { id: 'detective', name: '探偵', file: 'detective.png', accent: '#8b5e34', rarity: 'R' },
  {
    id: 'astronaut', name: '宇宙飛行士', file: 'astronaut.png', accent: '#17a2b8', rarity: 'UR',
    background: 'bg-astronaut.jpg',
    homeBackground: 'home-astronaut.jpg',
    ambient: [
      'ambient-astronaut-1.png', 'ambient-astronaut-2.png', 'ambient-astronaut-3.png', 'ambient-astronaut-4.png',
      'ambient-astronaut-5.png', 'ambient-astronaut-6.png', 'ambient-astronaut-7.png', 'ambient-astronaut-8.png',
    ],
  },
];

// Settings picker shows skins rarest-first.
export const CHARACTER_SKINS_BY_RARITY: CharacterSkin[] =
  [...CHARACTER_SKINS].sort((a, b) => RARITY_ORDER[a.rarity] - RARITY_ORDER[b.rarity]);

export const CHARACTER_SKIN_STORAGE_KEY = 'lily-character-skin'; // '' = default look
