'use client';

// ── 写真から清書 (Photo → clean transcription) ────────────────────────────────
// Take a photo of handwritten or printed notes and let Lily transcribe + tidy
// them into clean Markdown, converted to editor-ready HTML. The result is
// inserted into the note the user is currently editing (via the insert sheet).

import { callGeminiChat } from './gemini';
import type { ChatTurn, ChatAttachment } from './gemini';
import { getEffectiveApiKey, getAppLang } from './appLang';
import { marked } from 'marked';

const CLEANUP_SYSTEM_PROMPT = `あなたは「Lily」、学習アプリの清書AIです。ユーザーが撮影した手書きノート・板書・プリント・教科書などの画像を読み取り、**書かれている内容をそのまま忠実に**、きれいなMarkdownの「清書メモ」にします。

# 最重要ルール（内容の忠実性 — 絶対厳守）
- **画像に書かれていることだけを書き起こす。内容を変えない・足さない・削らない・要約しない・言い換えない。** これは「清書（きれいに書き写す）」であって「リライト」ではない。
- 文章・数式・用語・数値・固有名詞は、書かれているとおりに一字一句そのまま写す。勝手に「正しい形」に直さない（書き間違いに見えても、書かれたまま写す）。
- **読み取れない・自信がない箇所は、推測で埋めず必ず <mark>（読み取れず）</mark> と書く。** もっともらしい内容をでっち上げるのは厳禁。
- 画像をよく見て、一文字ずつ慎重に読む。曖昧な字は無理に確定させず <mark>（読み取れず）</mark> にする。
- **原文の言語をそのまま保持する。絶対に翻訳しない。**（出力言語の指示があってもこれを優先する）

# 整形（Markdownで見やすく）
- 元ノートの構造に合わせて、見出し（#, ##, ###）、箇条書き（- ）、番号付き（1. ）、強調（**太字**）を使う。内容の追加や脚色はしない。
- 数式は LaTeX を $...$（インライン）/ $$...$$（ブロック）で書く。

# 図・表は無理に作らない（重要）
- **図・グラフ・ダイアグラム・イラストは、無理に再現しなくてよい。** きれいに表せないものを頑張って文字や記号で描こうとしない。
- 簡単な言葉で説明できる図だけ、一言「（図：◯◯）」と添える程度でよい。テキストで表しづらい図は省略してよい。
- 表も、元ノートにはっきり表として書かれている場合のみ Markdown の表（| 列 | 列 |）で再現してよい。**それ以外で無理に表を作らない。**

# 出力フォーマット（厳守）
- 出力は **Markdown本文のみ**。前置き・説明・コードフェンス（\`\`\`）で全体を囲むことは禁止。
- 1行目は必ず内容を表す短いタイトルを # 見出し で書く（タイトルは内容から付けてよい）。`;

// Strip a stray outer code fence the model may add despite instructions.
function stripFences(raw: string): string {
  const s = raw.trim();
  const fence = s.match(/^```(?:markdown|md|html)?\s*\n([\s\S]*?)\n?```$/);
  return (fence ? fence[1] : s).trim();
}

// Convert the model's Markdown into editor-ready HTML. LaTeX ($...$, $$...$$)
// is left untouched as text so the note keeps rendering it as math.
function mdToHtml(md: string): string {
  return (marked.parse(md, { gfm: true, breaks: true }) as string).trim();
}

// Drop a leading <h1> (the title line) and return the remaining body, so the
// transcription flows into the current note without a giant heading on top.
function stripLeadingTitle(html: string): string {
  return html.replace(/^\s*<h1[^>]*>[\s\S]*?<\/h1>\s*/i, '').trim();
}

// Transcribe photos and return the HTML body — without saving to DB.
// Use this when you want to insert the result into an existing note.
export async function transcribeImagesToHTML(
  images: ChatAttachment[],
): Promise<string> {
  const en = getAppLang() === 'en';
  if (images.length === 0) {
    throw new Error(en ? 'Add at least one photo.' : '写真を1枚以上選んでね。');
  }
  const apiKey = getEffectiveApiKey();
  if (!apiKey) {
    throw new Error(en
      ? 'Set your Gemini API key in Settings first.'
      : '先に設定でGemini APIキーを入力してね。');
  }

  const userText = en
    ? 'Transcribe and tidy up the notes in these photos into a clean Markdown memo.'
    : 'この写真のノートを読み取って、きれいなMarkdownの清書メモにして。';
  const history: ChatTurn[] = [{ role: 'user', text: userText, attachments: images }];

  // Transcription is a vision-heavy, accuracy-critical task: lead with the
  // strong Pro model (falls back to Flash on quota), near-zero temperature so
  // it copies rather than paraphrases, and a real thinking budget so it reads
  // the image carefully instead of guessing.
  const reply = await callGeminiChat(history, CLEANUP_SYSTEM_PROMPT, apiKey, {
    models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'],
    temperature: 0,
    maxOutputTokens: 65536,
    thinkingBudget: 4096,
  });

  const md = stripFences(reply);
  if (!md) {
    throw new Error(en
      ? "Couldn't read the photo. Try a clearer shot."
      : '写真をうまく読み取れなかった…もう少しはっきり撮ってみてね。');
  }

  return stripLeadingTitle(mdToHtml(md));
}

// Read picked image files into Gemini attachments (base64, no data: prefix).
export function imageFileToAttachment(file: File): Promise<ChatAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve({ mimeType: file.type, data: result.split(',')[1] ?? '' });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
