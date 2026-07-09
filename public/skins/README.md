# スキン素材の追加手順

キャラクタースキンは `src/lib/characterSkins.ts` の `CHARACTER_SKINS` 配列に1エントリ足すだけで追加できます。素材は最適化して `public/skins/lily/` に置きます（このフォルダ直下がアプリから参照される場所。`backgrounds/` や `フレーム/` は入稿用の原本置き場で、アプリからは参照しません）。

## レアリティと表示先

| レアリティ | 枠(設定一覧) | アバター着せ替え | チャット背景 | ホーム/メモツリー背景 | アンビエント演出 |
| --- | --- | --- | --- | --- | --- |
| **N**  | なし | ○ | – | – | – |
| **R**  | 金色ピカピカ | ○ | ○ | ○（チャットと同じ画像） | – |
| **UR** | 虹色ピカピカ | ○ | ○ | ○（専用の `homeBackground`） | ○ |

- アンビエント演出（UR）は 学習タブ / todo / 日記 / メモツリー(ファイルツリー) / ホーム に出ます。
- 背景を敷くと文字が同化しやすいので、テキストは不透明チップUIの上に載せて可読性を確保しています（実装済み。新画面に背景を広げるときも同じ方針で）。

## 素材の命名・仕様

`public/skins/lily/` に以下を置きます（`<id>` は `characterSkins.ts` の `id`）。

| 用途 | ファイル名 | 仕様 |
| --- | --- | --- |
| アバター着せ替え | `<id>.png` | 透過PNG。長辺480pxくらいに圧縮。キャラの位置が不揃いでもOK（表示側で `object-position` 調整済み） |
| チャット背景 | `bg-<id>.jpg` | **正方形**。1000×1000のJPEG(quality 82)くらいに圧縮。`background-size: cover` で敷く |
| ホーム等の背景(UR専用) | `home-<id>.jpg` | 正方形。同上。Rは不要（チャット背景を流用） |
| アンビエント粒子(UR) | `ambient-<id>-1.png` … | 透過PNG。1辺96px程度。1スキン5〜10個。ふわっと下から上へ流れる |
| アバターフレーム(任意) | `frame-<id>.png` | 中央が透過のリング。現状ヘッダーでは未使用（サイズ調整待ちで保留中） |

入稿原本（大きいPNG）は `public/skins/backgrounds/` や `public/skins/フレーム/` に置いてもらってOK。こちらで最適化して `lily/` にコピーします。

## `characterSkins.ts` への登録例

```ts
{
  id: 'yukata', name: '浴衣', accent: '#e8590c', rarity: 'UR', seasonal: '夏 限定',
  file: 'yukata.png',            // アバター着せ替え画像（無ければ省略でデフォルトのLily）
  background: 'bg-yukata.jpg',   // R以上で必須
  homeBackground: 'home-yukata.jpg', // UR専用（Rは省略＝backgroundを流用）
  ambient: [                     // UR専用
    'ambient-yukata-1.png', 'ambient-yukata-2.png', 'ambient-yukata-3.png',
    'ambient-yukata-4.png', 'ambient-yukata-5.png', 'ambient-yukata-6.png',
    'ambient-yukata-7.png',
  ],
},
```

- 設定画面のスキン一覧は `CHARACTER_SKINS_BY_RARITY`（UR→R→N順）で自動ソートされます。並び順は気にせず配列に足せばOK。
- 素材が一部だけの状態でも壊れません（未提供のものはフォールバックして何も表示されないだけ）。

## 画像の最適化コマンド（参考）

`sharp`（`node_modules` に同梱済み）で最適化できます。日本語ファイル名はUnicode正規化(NFC/NFD)ズレで `readFileSync` が失敗することがあるので、`fs.readdirSync('.').filter(f => f.normalize('NFC').includes('浴衣'))` のように**正規化して照合**し、`sharp(fs.readFileSync(name))` のように**バッファ経由**で読むと確実です。

```js
const sharp = require('sharp');
// 背景（正方形1000pxのJPEG）
await sharp(buf).resize(1000, 1000).jpeg({ quality: 82 }).toFile('public/skins/lily/bg-<id>.jpg');
// アンビエント粒子（96px透過PNG）
await sharp(spriteBuf).resize(96, 96, { fit: 'inside' }).png({ compressionLevel: 9 }).toFile('public/skins/lily/ambient-<id>-1.png');
```
