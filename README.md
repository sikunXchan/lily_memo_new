<div align="center">

<img src="public/logo.png" alt="Lily Memo" width="96" />

# Lily Memo

**An AI study companion that turns your notes, PDFs, and lectures into active learning.**

Notes · AI tutor (Lily) · Practice problem sets · PDF viewer + Markdown conversion · Live lecture summarization · Study tracking & gamification — all in one installable PWA.

</div>

---

## What it does

Lily Memo is a study app for students built around one idea: **the fastest way to learn is to turn passive material into active practice**. The built-in AI assistant, Lily, reads your notes, PDFs, photos, and even live lecture audio, then produces explanations, diagrams, quizzes, and full exam-style problem sets you can solve inside the app.

### Core features

| Area | What you can do |
|---|---|
| 📝 **Notes** | Rich-text editor with code blocks, LaTeX math, tables, hand-drawn sketches, images, note-to-note links (`[[...]]`), and a graph view of how your notes connect |
| 🤖 **Lily (AI tutor)** | Chat about your notes and files. Lily generates Mermaid diagrams, charts, geometry figures, tables, and 6 types of quizzes — inserted directly into your notes. Strict accuracy-first persona: she corrects mistakes instead of just agreeing |
| 🧪 **Practice** | Describe what you want (or attach a textbook photo / PDF) and get a full problem set — multiple choice, written, fill-in, true/false, reading passages, chart questions — solved full-screen with scoring, explanations, and attempt history |
| 📄 **PDF study tools** | Built-in viewer with highlights, pen, timers — plus one-tap **PDF → Markdown** conversion (vision-based transcription, so scanned PDFs work) that saves to a note or `.md` file |
| 🎙️ **Live lecture summary** | Record a lecture; audio is transcribed in near-real-time, cleaned up in chunks, and turned into Cornell-style notes + key terms + 10 practice questions when you hit stop |
| 🗣️ **Voice chat** | Hands-free spoken Q&A with the AI (works inside an installed PWA, where the Web Speech API doesn't) |
| ⏱️ **Study tracking** | Stopwatch/pomodoro sessions by subject, daily/weekly/monthly charts, streaks, levels, and unlockable badges & trophies |
| ✅ **Tasks & calendar** | To-dos with pinning plus a weekly schedule view |
| 🔄 **Live sync** | Optional cross-device sync of everything (notes, problem sets, tasks, study history) via a shared key — conflict-resolved server-side with last-write-wins merging |

Data lives in the browser (IndexedDB) by default; nothing is required to start. English mode works with **zero configuration** — AI calls are routed through a server-side key.

## Tech stack

- **Next.js 16 / React 19 / TypeScript** — single-page PWA (installable, offline-capable shell)
- **Gemini 2.5** (Pro / Flash / Flash-Lite) with model fallback, extended thinking for reasoning-heavy tasks, streaming thought traces, and vision input for PDFs/photos/audio
- **Dexie (IndexedDB)** for local-first storage; **Upstash Redis** for optional live sync with server-side snapshot merging (per-record LWW + compare-and-set)
- **TipTap** rich-text editor with custom nodes (Mermaid, Chart.js, geometry canvas, Q&A cards, handwriting)
- **pdf.js**, **KaTeX**, **Mermaid**, **Chart.js**, Web Audio API

## Getting started

```bash
npm ci
cp env.example .env.local   # add your keys (see below)
npm run dev
```

Open <http://localhost:3000>.

Environment variables (`.env.local`):

| Variable | Purpose |
|---|---|
| `GEMINI_API_KEY` | Server-side key used by the `/api/gemini` proxy (zero-config English mode) |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Optional — enables cross-device live sync |

The app defaults to **English**. 日本語 UI は設定画面からいつでも切り替えできます（日本語モードでは自分の Gemini API キーを使用します）。

## 日本語

Lily Memo は「読むだけの教材を、解ける問題に変える」ことを軸にした学習アプリです。メモ・PDF・写真・授業音声を AI（Lily）が読み取り、解説・図解・クイズ・本格的な問題セットを生成します。データはブラウザの IndexedDB に保存され、設定画面からバックアップの書き出し・復元、および同期キーによる端末間ライブ同期が利用できます。
