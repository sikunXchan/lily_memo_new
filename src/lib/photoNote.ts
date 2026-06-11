'use client';

// ── 写真から清書メモ (Photo → clean note) ─────────────────────────────────────
// Take a photo of handwritten or printed notes and let Lily transcribe + tidy
// them into a proper, structured memo (HTML). The result is saved as a normal
// text note, so it flows straight into the rest of the app — including the
// practice tab's note picker, where it can become a quiz.

import { db, newSyncId } from './db';
import { callGeminiChat } from './gemini';
import type { ChatTurn, ChatAttachment } from './gemini';
import { getEffectiveApiKey, getAppLang } from './appLang';

const CLEANUP_SYSTEM_PROMPT = `あなたは「Lily」、学習アプリの清書AIです。ユーザーが撮影した手書きノート・板書・プリント・教科書などの画像を読み取り、きれいに整形された「清書メモ」をHTMLで作成します。

# 最重要ルール
- **原文の言語をそのまま保持する。絶対に翻訳しない。** 日本語のノートは日本語のまま、英語のノートは英語のまま清書する。（出力言語の指示があってもこれを優先する）
- 画像に書かれている内容を忠実に書き起こす。勝手に内容を追加・創作しない。
- 走り書き・誤字・崩れた字は、文脈から自然に読める形に整える。明らかな書き間違いは直してよい。
- 読み取れない箇所は <mark>（読み取れず）</mark> と書く。

# 出力フォーマット（厳守）
- 出力は **HTMLのみ**。前置き・説明・コードフェンス（\`\`\`）は一切書かない。
- 1行目は必ず内容を表す短いタイトルを <h1>タイトル</h1> で書く。
- 本文は構造化する: 見出し <h2>/<h3>、箇条書き <ul><li>、番号付き <ol><li>、強調 <strong>、段落 <p>。
- 表が適切なときは <table><thead><tbody> を使う。
- 数式は LaTeX を $...$（インライン）/ $$...$$（ブロック）で書く。
- 図やイラストは文章で「[図: 〜の図]」のように一言で説明する。

# 整形の方針
- ぐちゃぐちゃな箇条書きや矢印メモは、意味のまとまりごとに見出し＋箇条書きへ再構成する。
- 重要語句や定義は <strong> で強調する。
- 内容は変えずに「読みやすさ」だけを上げる。要約はしない（情報を削らない）。`;

// Strip stray code fences the model may add despite instructions.
function stripFences(raw: string): string {
  const s = raw.trim();
  const fence = s.match(/```(?:html)?\s*([\s\S]*?)```/);
  return (fence ? fence[1] : s).trim();
}

// Pull the first <h1> out as the note title and return the remaining body.
// Falls back to the first non-empty text line when no <h1> is present.
function splitTitle(html: string): { title: string; body: string } {
  const m = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (m) {
    const title = m[1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    const body = (html.slice(0, m.index) + html.slice((m.index ?? 0) + m[0].length)).trim();
    return { title, body };
  }
  const firstText = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  const title = firstText.slice(0, 40);
  return { title, body: html };
}

// Transcribe one or more photos into a tidy note and save it.
// Returns the new note's id so the caller can open it. Throws a friendly error.
export async function transcribeImagesToNote(
  images: ChatAttachment[],
  folderId?: number,
): Promise<number> {
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
    ? 'Transcribe and tidy up the notes in these photos into a clean HTML memo.'
    : 'この写真のノートを読み取って、きれいなHTMLの清書メモにして。';
  const history: ChatTurn[] = [{ role: 'user', text: userText, attachments: images }];

  // Low temperature: faithful transcription matters more than variety.
  const reply = await callGeminiChat(history, CLEANUP_SYSTEM_PROMPT, apiKey, {
    temperature: 0.3,
    maxOutputTokens: 65536,
    thinkingBudget: 2048,
  });

  const html = stripFences(reply);
  if (!html) {
    throw new Error(en
      ? "Couldn't read the photo. Try a clearer shot."
      : '写真をうまく読み取れなかった…もう少しはっきり撮ってみてね。');
  }

  const { title, body } = splitTitle(html);
  const now = Date.now();
  const id = await db.notes.add({
    syncId: newSyncId(),
    title: title || (en ? 'Transcribed note' : '清書メモ'),
    content: body || html,
    folderId,
    type: 'text',
    createdAt: now,
    updatedAt: now,
  });
  return id as number;
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
