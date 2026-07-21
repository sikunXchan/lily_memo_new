// 図解（イラスト図解）で使う「素材」= アイコン集。
//
// 外部フリー素材サイト（silhouette-illust / kotonohaworks 等）は bot ブロックで
// 取得できず、再配布のライセンス条件や PNG のスタイル不一致・オフライン PWA での
// 信頼性の問題もあるため、アプリ内に自前の一貫したインライン SVG アイコン集を持つ。
// AI は素材キー（'server' / 'pc' / 'user' …）で必要な素材を選び、illustDiagram.ts
// のレンダラがこのアイコンをノードとして配置して図解を組み立てる。
//
// 各アイコンは 0..64 のキャンバスに、渡された色 `c` の単色ライン画として描く
// （塗りは fill-opacity で軽く乗せる程度）。レンダラ側がノードの丸角バッジ背景と
// ラベルを描くので、アイコン自体はグリフ（線画）だけを返す。

export interface IllustAsset {
  key: string;
  label: string;   // 日本語ラベル（AI に渡す素材カタログ用）
  en: string;      // English label
  keywords: string; // AI が概念から素材を選ぶときのヒント
  draw: (c: string) => string; // 0..64 キャンバス上のグリフ SVG
}

// 共通の線スタイル。round キャップ/ジョインで柔らかい印象に統一。
const S = (c: string) =>
  `fill="none" stroke="${c}" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"`;
const FILL = (c: string) => `fill="${c}" fill-opacity="0.16"`;
const DOT = (c: string) => `fill="${c}"`;

// key -> asset。追加はここに 1 エントリ書くだけ。
export const ILLUST_ASSETS: Record<string, IllustAsset> = {
  server: {
    key: 'server', label: 'サーバー', en: 'Server',
    keywords: 'server host backend web api バックエンド ホスト',
    draw: c => `
      <rect x="16" y="13" width="32" height="15" rx="3" ${FILL(c)}/>
      <rect x="16" y="13" width="32" height="15" rx="3" ${S(c)}/>
      <rect x="16" y="34" width="32" height="15" rx="3" ${FILL(c)}/>
      <rect x="16" y="34" width="32" height="15" rx="3" ${S(c)}/>
      <circle cx="23" cy="20.5" r="2.1" ${DOT(c)}/>
      <line x1="30" y1="20.5" x2="42" y2="20.5" ${S(c)}/>
      <circle cx="23" cy="41.5" r="2.1" ${DOT(c)}/>
      <line x1="30" y1="41.5" x2="42" y2="41.5" ${S(c)}/>`,
  },
  database: {
    key: 'database', label: 'データベース', en: 'Database',
    keywords: 'database db store data 記憶 保存 DB データ',
    draw: c => `
      <path d="M16 18 V46 A16 6 0 0 0 48 46 V18" ${FILL(c)}/>
      <ellipse cx="32" cy="18" rx="16" ry="6" ${FILL(c)}/>
      <ellipse cx="32" cy="18" rx="16" ry="6" ${S(c)}/>
      <path d="M16 18 V46 A16 6 0 0 0 48 46 V18" ${S(c)}/>
      <path d="M16 32 A16 6 0 0 0 48 32" ${S(c)}/>`,
  },
  pc: {
    key: 'pc', label: 'パソコン（デスクトップ）', en: 'Desktop PC',
    keywords: 'pc desktop monitor computer 画面 端末 コンピュータ モニタ',
    draw: c => `
      <rect x="12" y="13" width="40" height="28" rx="3" ${FILL(c)}/>
      <rect x="12" y="13" width="40" height="28" rx="3" ${S(c)}/>
      <path d="M32 41 V50" ${S(c)}/>
      <path d="M23 51 H41" ${S(c)}/>`,
  },
  laptop: {
    key: 'laptop', label: 'ノートパソコン', en: 'Laptop',
    keywords: 'laptop notebook client 端末 クライアント ノートPC',
    draw: c => `
      <rect x="17" y="15" width="30" height="20" rx="2.5" ${FILL(c)}/>
      <rect x="17" y="15" width="30" height="20" rx="2.5" ${S(c)}/>
      <path d="M11 44 H53 L49 39 H15 Z" ${FILL(c)}/>
      <path d="M11 44 H53 L49 39 H15 Z" ${S(c)}/>`,
  },
  smartphone: {
    key: 'smartphone', label: 'スマートフォン', en: 'Smartphone',
    keywords: 'smartphone phone mobile スマホ 携帯 モバイル',
    draw: c => `
      <rect x="22" y="11" width="20" height="42" rx="4.5" ${FILL(c)}/>
      <rect x="22" y="11" width="20" height="42" rx="4.5" ${S(c)}/>
      <line x1="29" y1="48" x2="35" y2="48" ${S(c)}/>`,
  },
  browser: {
    key: 'browser', label: 'ブラウザ / Webページ', en: 'Browser',
    keywords: 'browser web page url site サイト ウェブ ページ',
    draw: c => `
      <rect x="12" y="14" width="40" height="32" rx="4" ${FILL(c)}/>
      <rect x="12" y="14" width="40" height="32" rx="4" ${S(c)}/>
      <line x1="12" y1="24" x2="52" y2="24" ${S(c)}/>
      <circle cx="18" cy="19" r="1.6" ${DOT(c)}/>
      <circle cx="24" cy="19" r="1.6" ${DOT(c)}/>
      <circle cx="30" cy="19" r="1.6" ${DOT(c)}/>`,
  },
  user: {
    key: 'user', label: 'ユーザー / 利用者', en: 'User',
    keywords: 'user person people client victim 人 利用者 被害者 ユーザ',
    draw: c => `
      <circle cx="32" cy="22" r="9" ${FILL(c)}/>
      <circle cx="32" cy="22" r="9" ${S(c)}/>
      <path d="M17 49 a15 15 0 0 1 30 0" ${FILL(c)}/>
      <path d="M17 49 a15 15 0 0 1 30 0" ${S(c)}/>`,
  },
  attacker: {
    key: 'attacker', label: '攻撃者 / 不正利用者', en: 'Attacker',
    keywords: 'attacker hacker malicious adversary 攻撃者 悪意 なりすまし 犯人',
    draw: c => `
      <circle cx="32" cy="22" r="9" ${FILL(c)}/>
      <circle cx="32" cy="22" r="9" ${S(c)}/>
      <path d="M17 49 a15 15 0 0 1 30 0" ${FILL(c)}/>
      <path d="M17 49 a15 15 0 0 1 30 0" ${S(c)}/>
      <rect x="23" y="19" width="18" height="5.4" rx="2.4" ${DOT(c)}/>`,
  },
  cloud: {
    key: 'cloud', label: 'クラウド', en: 'Cloud',
    keywords: 'cloud internet saas service クラウド インターネット',
    draw: c => `
      <path d="M43 45 H21 A10 10 0 0 1 19.6 25.2 A13 13 0 0 1 44.4 22.4 A9 9 0 0 1 43 45 Z" ${FILL(c)}/>
      <path d="M43 45 H21 A10 10 0 0 1 19.6 25.2 A13 13 0 0 1 44.4 22.4 A9 9 0 0 1 43 45 Z" ${S(c)}/>`,
  },
  globe: {
    key: 'globe', label: 'インターネット / 世界', en: 'Internet',
    keywords: 'internet global network world web インターネット 世界 網',
    draw: c => `
      <circle cx="32" cy="32" r="18" ${FILL(c)}/>
      <circle cx="32" cy="32" r="18" ${S(c)}/>
      <ellipse cx="32" cy="32" rx="8" ry="18" ${S(c)}/>
      <line x1="14" y1="32" x2="50" y2="32" ${S(c)}/>
      <path d="M18.5 22 H45.5 M18.5 42 H45.5" ${S(c)}/>`,
  },
  router: {
    key: 'router', label: 'ルーター / 通信機器', en: 'Router',
    keywords: 'router gateway network wifi access-point ルーター 通信 回線 中継',
    draw: c => `
      <rect x="14" y="33" width="36" height="15" rx="3" ${FILL(c)}/>
      <rect x="14" y="33" width="36" height="15" rx="3" ${S(c)}/>
      <circle cx="22" cy="40.5" r="2" ${DOT(c)}/>
      <line x1="24" y1="33" x2="20" y2="18" ${S(c)}/>
      <line x1="40" y1="33" x2="44" y2="18" ${S(c)}/>`,
  },
  firewall: {
    key: 'firewall', label: 'ファイアウォール', en: 'Firewall',
    keywords: 'firewall wall protection block 防火 壁 遮断 防御',
    draw: c => `
      <rect x="14" y="22" width="36" height="26" rx="2.5" ${FILL(c)}/>
      <rect x="14" y="22" width="36" height="26" rx="2.5" ${S(c)}/>
      <line x1="14" y1="30.5" x2="50" y2="30.5" ${S(c)}/>
      <line x1="14" y1="39.5" x2="50" y2="39.5" ${S(c)}/>
      <line x1="26" y1="22" x2="26" y2="30.5" ${S(c)}/>
      <line x1="38" y1="22" x2="38" y2="30.5" ${S(c)}/>
      <line x1="20" y1="30.5" x2="20" y2="39.5" ${S(c)}/>
      <line x1="32" y1="30.5" x2="32" y2="39.5" ${S(c)}/>
      <line x1="44" y1="30.5" x2="44" y2="39.5" ${S(c)}/>
      <line x1="26" y1="39.5" x2="26" y2="48" ${S(c)}/>
      <line x1="38" y1="39.5" x2="38" y2="48" ${S(c)}/>`,
  },
  lock: {
    key: 'lock', label: '鍵（ロック）', en: 'Lock',
    keywords: 'lock secure encrypted private 施錠 暗号 保護 セキュア',
    draw: c => `
      <rect x="18" y="30" width="28" height="21" rx="3.5" ${FILL(c)}/>
      <rect x="18" y="30" width="28" height="21" rx="3.5" ${S(c)}/>
      <path d="M24 30 V24 a8 8 0 0 1 16 0 V30" ${S(c)}/>
      <circle cx="32" cy="39" r="2.6" ${DOT(c)}/>
      <line x1="32" y1="41" x2="32" y2="45.5" ${S(c)}/>`,
  },
  unlock: {
    key: 'unlock', label: '解錠 / 突破された鍵', en: 'Unlocked',
    keywords: 'unlock breached open compromised 解錠 突破 漏洩 開錠',
    draw: c => `
      <rect x="18" y="30" width="28" height="21" rx="3.5" ${FILL(c)}/>
      <rect x="18" y="30" width="28" height="21" rx="3.5" ${S(c)}/>
      <path d="M24 30 V24 a8 8 0 0 1 16 0" ${S(c)}/>
      <circle cx="32" cy="39" r="2.6" ${DOT(c)}/>
      <line x1="32" y1="41" x2="32" y2="45.5" ${S(c)}/>`,
  },
  key: {
    key: 'key', label: '鍵（キー）', en: 'Key',
    keywords: 'key token credential password 鍵 認証 パスワード 資格情報',
    draw: c => `
      <circle cx="24" cy="26" r="8.5" ${FILL(c)}/>
      <circle cx="24" cy="26" r="8.5" ${S(c)}/>
      <path d="M30 32 L47 49" ${S(c)}/>
      <path d="M42 48 L46 44" ${S(c)}/>
      <path d="M38 44 L41 41" ${S(c)}/>`,
  },
  shield: {
    key: 'shield', label: '盾（防御）', en: 'Shield',
    keywords: 'shield security defense protect guard 盾 防御 セキュリティ 安全',
    draw: c => `
      <path d="M32 12 L48 18 V32 C48 42 40 49.5 32 52 C24 49.5 16 42 16 32 V18 Z" ${FILL(c)}/>
      <path d="M32 12 L48 18 V32 C48 42 40 49.5 32 52 C24 49.5 16 42 16 32 V18 Z" ${S(c)}/>
      <path d="M25 32 l5 5 l9 -11" ${S(c)}/>`,
  },
  cookie: {
    key: 'cookie', label: 'クッキー / セッション', en: 'Cookie',
    keywords: 'cookie session token state クッキー セッション 状態',
    draw: c => `
      <circle cx="32" cy="32" r="18" ${FILL(c)}/>
      <circle cx="32" cy="32" r="18" ${S(c)}/>
      <circle cx="26" cy="27" r="2.1" ${DOT(c)}/>
      <circle cx="38" cy="26" r="1.7" ${DOT(c)}/>
      <circle cx="40" cy="37" r="2.1" ${DOT(c)}/>
      <circle cx="28" cy="39" r="1.7" ${DOT(c)}/>
      <circle cx="33" cy="33" r="1.7" ${DOT(c)}/>`,
  },
  email: {
    key: 'email', label: 'メール', en: 'Email',
    keywords: 'email mail message envelope メール 手紙 通知 送信',
    draw: c => `
      <rect x="12" y="18" width="40" height="28" rx="3" ${FILL(c)}/>
      <rect x="12" y="18" width="40" height="28" rx="3" ${S(c)}/>
      <path d="M13 21 L32 36 L51 21" ${S(c)}/>`,
  },
  document: {
    key: 'document', label: '書類 / ファイル', en: 'Document',
    keywords: 'document file page report data 書類 ファイル 資料 文書',
    draw: c => `
      <path d="M20 12 H36 L46 22 V52 H20 Z" ${FILL(c)}/>
      <path d="M20 12 H36 L46 22 V52 H20 Z" ${S(c)}/>
      <path d="M36 12 V22 H46" ${S(c)}/>
      <line x1="26" y1="32" x2="40" y2="32" ${S(c)}/>
      <line x1="26" y1="39" x2="40" y2="39" ${S(c)}/>
      <line x1="26" y1="46" x2="34" y2="46" ${S(c)}/>`,
  },
  token: {
    key: 'token', label: 'トークン / タグ', en: 'Token',
    keywords: 'token ticket tag label jwt トークン タグ 引換 認可',
    draw: c => `
      <path d="M34 14 H50 V30 L30 50 L14 34 Z" ${FILL(c)}/>
      <path d="M34 14 H50 V30 L30 50 L14 34 Z" ${S(c)}/>
      <circle cx="42" cy="22" r="2.8" ${DOT(c)}/>`,
  },
  warning: {
    key: 'warning', label: '警告 / 危険', en: 'Warning',
    keywords: 'warning danger alert risk 警告 危険 注意 リスク',
    draw: c => `
      <path d="M32 13 L52 48 H12 Z" ${FILL(c)}/>
      <path d="M32 13 L52 48 H12 Z" ${S(c)}/>
      <line x1="32" y1="28" x2="32" y2="38" ${S(c)}/>
      <circle cx="32" cy="43" r="2.1" ${DOT(c)}/>`,
  },
  check: {
    key: 'check', label: 'OK / 正常', en: 'OK',
    keywords: 'ok check success valid safe 正常 成功 承認 OK',
    draw: c => `
      <circle cx="32" cy="32" r="18" ${FILL(c)}/>
      <circle cx="32" cy="32" r="18" ${S(c)}/>
      <path d="M23 33 l6 6 l12 -14" ${S(c)}/>`,
  },
  cross: {
    key: 'cross', label: '拒否 / 遮断', en: 'Blocked',
    keywords: 'block deny reject fail invalid 拒否 遮断 失敗 不正',
    draw: c => `
      <circle cx="32" cy="32" r="18" ${FILL(c)}/>
      <circle cx="32" cy="32" r="18" ${S(c)}/>
      <path d="M25 25 L39 39 M39 25 L25 39" ${S(c)}/>`,
  },
  gear: {
    key: 'gear', label: '処理 / 設定', en: 'Process',
    keywords: 'gear process settings config system 処理 設定 仕組み 歯車',
    draw: c => `
      <circle cx="32" cy="32" r="7.5" ${FILL(c)}/>
      <circle cx="32" cy="32" r="7.5" ${S(c)}/>
      <g ${S(c)}>
        <line x1="32" y1="12" x2="32" y2="18"/>
        <line x1="32" y1="46" x2="32" y2="52"/>
        <line x1="12" y1="32" x2="18" y2="32"/>
        <line x1="46" y1="32" x2="52" y2="32"/>
        <line x1="18" y1="18" x2="22" y2="22"/>
        <line x1="42" y1="42" x2="46" y2="46"/>
        <line x1="46" y1="18" x2="42" y2="22"/>
        <line x1="22" y1="42" x2="18" y2="46"/>
      </g>`,
  },
  chip: {
    key: 'chip', label: 'CPU / チップ', en: 'Chip',
    keywords: 'cpu chip processor hardware CPU 処理装置 半導体 回路',
    draw: c => `
      <rect x="20" y="20" width="24" height="24" rx="3" ${FILL(c)}/>
      <rect x="20" y="20" width="24" height="24" rx="3" ${S(c)}/>
      <rect x="27" y="27" width="10" height="10" rx="1.5" ${S(c)}/>
      <g ${S(c)}>
        <line x1="26" y1="20" x2="26" y2="14"/><line x1="32" y1="20" x2="32" y2="14"/><line x1="38" y1="20" x2="38" y2="14"/>
        <line x1="26" y1="44" x2="26" y2="50"/><line x1="32" y1="44" x2="32" y2="50"/><line x1="38" y1="44" x2="38" y2="50"/>
        <line x1="20" y1="26" x2="14" y2="26"/><line x1="20" y1="32" x2="14" y2="32"/><line x1="20" y1="38" x2="14" y2="38"/>
        <line x1="44" y1="26" x2="50" y2="26"/><line x1="44" y1="32" x2="50" y2="32"/><line x1="44" y1="38" x2="50" y2="38"/>
      </g>`,
  },
  link: {
    key: 'link', label: 'リンク / URL', en: 'Link',
    keywords: 'link url hyperlink chain リンク URL 誘導 参照',
    draw: c => `
      <path d="M27 37 L20 44 a7.5 7.5 0 0 1 -10.6 -10.6 L16 27" ${S(c)}/>
      <path d="M37 27 L44 20 a7.5 7.5 0 0 1 10.6 10.6 L48 37" ${S(c)}/>
      <line x1="26" y1="38" x2="38" y2="26" ${S(c)}/>`,
  },
  bug: {
    key: 'bug', label: 'バグ / マルウェア', en: 'Bug',
    keywords: 'bug malware virus vulnerability exploit バグ ウイルス 脆弱性 不具合',
    draw: c => `
      <ellipse cx="32" cy="35" rx="10" ry="12" ${FILL(c)}/>
      <ellipse cx="32" cy="35" rx="10" ry="12" ${S(c)}/>
      <circle cx="32" cy="20" r="5" ${S(c)}/>
      <line x1="22" y1="35" x2="42" y2="35" ${S(c)}/>
      <g ${S(c)}>
        <line x1="28" y1="16" x2="25" y2="12"/><line x1="36" y1="16" x2="39" y2="12"/>
        <line x1="22" y1="30" x2="15" y2="27"/><line x1="22" y1="38" x2="15" y2="38"/><line x1="23" y1="45" x2="17" y2="49"/>
        <line x1="42" y1="30" x2="49" y2="27"/><line x1="42" y1="38" x2="49" y2="38"/><line x1="41" y1="45" x2="47" y2="49"/>
      </g>`,
  },
  wifi: {
    key: 'wifi', label: '無線 / 電波', en: 'Wireless',
    keywords: 'wifi signal wireless radio 無線 電波 通信 信号',
    draw: c => `
      <path d="M14 28 a26 26 0 0 1 36 0" ${S(c)}/>
      <path d="M21 35 a16 16 0 0 1 22 0" ${S(c)}/>
      <path d="M27 42 a7 7 0 0 1 10 0" ${S(c)}/>
      <circle cx="32" cy="48" r="2.4" ${DOT(c)}/>`,
  },
  search: {
    key: 'search', label: '検索 / スキャン', en: 'Scan',
    keywords: 'search scan inspect probe detect 検索 走査 探索 監視',
    draw: c => `
      <circle cx="28" cy="28" r="12" ${FILL(c)}/>
      <circle cx="28" cy="28" r="12" ${S(c)}/>
      <line x1="37" y1="37" x2="50" y2="50" ${S(c)}/>`,
  },
  clock: {
    key: 'clock', label: '時間 / タイミング', en: 'Time',
    keywords: 'time clock timing delay schedule 時間 タイミング 遅延 時刻',
    draw: c => `
      <circle cx="32" cy="32" r="18" ${FILL(c)}/>
      <circle cx="32" cy="32" r="18" ${S(c)}/>
      <path d="M32 22 V32 L40 37" ${S(c)}/>`,
  },
  folder: {
    key: 'folder', label: 'フォルダ / 保管', en: 'Folder',
    keywords: 'folder directory storage archive フォルダ 保管 格納 ディレクトリ',
    draw: c => `
      <path d="M14 22 H27 L31 27 H50 V46 H14 Z" ${FILL(c)}/>
      <path d="M14 22 H27 L31 27 H50 V46 H14 Z" ${S(c)}/>`,
  },
  api: {
    key: 'api', label: 'API / プログラム', en: 'API',
    keywords: 'api code program endpoint interface API コード プログラム 連携',
    draw: c => `
      <rect x="12" y="16" width="40" height="32" rx="4" ${FILL(c)}/>
      <rect x="12" y="16" width="40" height="32" rx="4" ${S(c)}/>
      <path d="M26 26 L20 32 L26 38" ${S(c)}/>
      <path d="M38 26 L44 32 L38 38" ${S(c)}/>`,
  },
};

// AI に渡す素材カタログ（key: 日本語ラベル）。プロンプトに埋め込んで、AI が
// 内容のかたちに合う素材を選べるようにする。
export const ILLUST_MATERIAL_CATALOG: { key: string; label: string; keywords: string }[] =
  Object.values(ILLUST_ASSETS).map(a => ({ key: a.key, label: a.label, keywords: a.keywords }));

// 有効な素材キーの集合（AI が存在しないキーを出したときのフォールバック判定用）。
export const ILLUST_ASSET_KEYS = new Set(Object.keys(ILLUST_ASSETS));

// key -> グリフ SVG。未知キーは汎用ノード（丸 + ？）を返すので図解は壊れない。
export function illustGlyph(key: string, color: string): string {
  const asset = ILLUST_ASSETS[key];
  if (asset) return asset.draw(color);
  return `
    <circle cx="32" cy="32" r="16" ${FILL(color)}/>
    <circle cx="32" cy="32" r="16" ${S(color)}/>
    <path d="M27 27 a5 5 0 1 1 6.5 6 c -1.5 1 -1.5 2 -1.5 3.5" ${S(color)}/>
    <circle cx="32" cy="43" r="1.8" ${DOT(color)}/>`;
}
