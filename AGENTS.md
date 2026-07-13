<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# データ保存について

メモ・フォルダ・学習記録などは、基本的にブラウザのローカル IndexedDB（Dexie、DB名 `LilyDatabase`、`src/lib/db.ts`）に保存される。サーバー側の恒久ストレージは持たない。

端末間で内容を移す方法は2つ:
- **手動バックアップ**: 設定画面の「バックアップをダウンロード」で JSON を書き出し、もう一方の端末で「復元ファイルをアップロード」して取り込む。
- **ライブ同期**: コードを使った端末間同期（`src/lib/liveSync.ts`、`/api/sync/live`・`/api/sync/[code]`）。中継はするがサーバーにデータを溜め込むクラウド保存ではない。受信側のデータは送信側で上書きされる。

# このリポジトリで作業するエージェントへ

Lily Memo は、メモ・AIアシスタント「Lily」・学習記録・演習/授業・PDFビューアを1つにまとめた学習アプリ（PWA、日本語がソース言語）。以下は実際のコードで確認済みの要点。

## 開発・検証

- **dev サーバーは必ず `npx next dev --webpack`**。`next dev` だけだと Turbopack になり、このプロジェクトの webpack 設定と競合して警告が出る（`package.json` の `build` も `next build --webpack`）。
- 変更の検証は tsc(`npx tsc --noEmit`) → lint(`npm run lint`) → build(`npm run build`) の順。lint はリポジトリ全体で既存の警告が多数あるので、**自分の変更で新規のエラー/警告が増えていないか**を見る。
- UI 機能は実ブラウザで動作確認する。Playwright の Chromium は `/opt/pw-browsers/chromium` にプリインストール済み（`playwright-core` を作業用ディレクトリに入れて `chromium.launch({ executablePath, args:['--no-sandbox'] })`）。初回起動のスプラッシュは `sessionStorage['lily-splash-shown']='1'` で、ようこそモーダルは `button.am-close` で閉じる。モバイル幅(≤1024)はバブルホーム、デスクトップ幅は HomeHero にルーティングされる。

## AI（Lily）のプロンプト構成 — `src/lib/gemini.ts`

- 基本のシステムプロンプトは `LILY_CHAT_SYSTEM_PROMPT`。**常時送る内容は最小限**にし、そのターンで必要な能力の詳細ルールだけを動的に足す「プロンプトアドオン」方式を採る。
- `classifyPromptAddons(userMessage, apiKey)` が軽量モデルで1回だけ分類し、`ADDON_MENU` から該当キー（各図解タイプ＋ `memo_edit`）を選ぶ。`buildPromptAddons(keys)` が対応する `ADDON_DETAIL` だけを末尾に連結する。新しい能力を足す時はこの仕組みに載せ、基本プロンプトを膨らませない。
- 図解は「内容のかたち→最適な種類」で選ばせる（何でもフローチャートにしない）。

## メモのリッチ表現 — `src/lib/markdownToTiptap.ts`

Lily がメモに書ける Markdown を TipTap 用 HTML に変換する。数式($…$/$$…$$)、文字色 `{red:…}`、マーカー `==…==` / `=={green}…==`、図の埋め込み `~~~mermaid` / `~~~chart` / `~~~geometry`（メモブロックの ``` と衝突するのでチルダフェンス）に対応。色は `src/lib/memoColors.ts` の共有パレットを使い、エディタのツールバー（NoteEditor のバブルメニュー/色シート）と完全に一致させる。

## プラン・利用制限 — `src/lib/points.ts`

日次のトークン予算（`PLAN_DAILY_TOKENS`）と、回数制のチケット（`PLAN_*_TICKETS`：thinking/ultra/stable/exercise/lesson/search）で制御。`developer` プランは実質無制限。UI表示は `isTicketUnlimited()` で「無制限」に切り替える。

## UI 文言の国際化 — `src/lib/i18n.ts`

日本語がキー、英語が値。新しい表示文字列は日本語のまま書き、英語訳を `EN` に追加する。キー重複は不可。
