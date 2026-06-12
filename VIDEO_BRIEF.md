# 動画編集 引き継ぎメモ

このファイルは動画編集作業の引き継ぎ用です。作業完了後は削除してください。

## プロジェクト概要

DSH Hacks V1（AI × STEM Education）ハッカソン向け Lily Memo のデモ動画を編集中。

## 動画構成（合計約3分）

| 時間 | シーン |
|---|---|
| 0:00–0:08 | オープニング（タイトルカード）← Claude が作成 |
| 0:08–0:40 | メモの基本機能（テキスト・チェックボックス・コードブロック・表・画像・検索） |
| 0:40–1:40 | Lily AI（解説・クイズ生成→メモ挿入・図生成・思考モード・履歴） |
| 1:40–2:10 | Sikun（ドラッグ・要約・単語説明・QA出題・タイマー） |
| 2:10–2:25 | Todo & カレンダー |
| 2:25–2:40 | 学習記録（レベル・バッジ・トロフィールーム） |
| 2:40–3:05 | PDF + Sikun解説 + PDF→Markdown変換 |
| 3:05–3:15 | エンドカード ← Claude が作成 |

## 撮影・編集の取り決め

- iPad で録画（英語モード）
- CapCut でクリップを繋いでから送る
- 字幕はこちら（Claude）で英語で追加
- CapCut の自動キャプションはOFF
- 画面下15%に重要UIを置かない（字幕スペース）
- 1080p 以上で書き出し

## Google Drive クリップ

| ファイル名 | Drive ID | 内容 |
|---|---|---|
| hackathon(1).MP4 | 1msjIZmrhEhIk2fA72q4RCN413El6WkJt | AI が図を作ってメモに挿入するシーン |

## ネットワーク設定

Google Drive からクリップを取得するため、egress allowlist に以下を追加済み：
- drive.google.com
- drive.usercontent.google.com
- *.googleusercontent.com

ネットワークポリシー: Trusted（新しいセッションから有効）

## ffmpeg

`ffmpeg -version` で動作確認済み（v6.1.1）。

## 完了済み提出物

- `lily-memo-project-description.pdf` — Devpost「Upload a File」用の1ページ説明PDF
- Devpost「About the project」の英語テキスト（この会話内で生成済み）

## 次のアクション

1. 残りのクリップを撮影して Drive にアップロード
2. Drive ID をここに追記
3. 新セッションで「VIDEO_BRIEF.md を読んで動画編集の続きをやりたい」と伝える
