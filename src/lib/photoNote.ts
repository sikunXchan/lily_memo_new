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

const CLEANUP_SYSTEM_PROMPT = `あなたは「Lily」、学習アプリの清書AIです。ユーザーが撮影した手書きノート・板書・プリント・教科書などの画像を読み取り、**書かれている内容をそのまま忠実に**、見やすく整形したHTMLの「清書メモ」を作成します。

# 最重要ルール（内容の忠実性 — 絶対厳守）
- **画像に書かれていることだけを書き起こす。内容を変えない・足さない・削らない・要約しない・言い換えない。** これは「清書（きれいに書き写す）」であって「リライト」ではない。
- 文章・数式・用語・数値・固有名詞は、書かれているとおりに一字一句そのまま写す。勝手に「正しい形」に直さない（書き間違いに見えても、書かれたまま写す）。
- **読み取れない・自信がない箇所は、推測で埋めず必ず <mark>（読み取れず）</mark> と書く。** もっともらしい内容をでっち上げるのは厳禁。
- 画像をよく見て、一文字ずつ慎重に読む。曖昧な字は無理に確定させず <mark>（読み取れず）</mark> にする。
- **原文の言語をそのまま保持する。絶対に翻訳しない。**（出力言語の指示があってもこれを優先する）

# やってよいこと（見た目だけの整形）
- レイアウトの構造化のみOK: 見出し <h2>/<h3>、箇条書き <ul><li>、番号付き <ol><li>、段落 <p>、表 <table><thead><tbody>、強調 <strong>。
- これらは「元のノートにある構造（箇条書き・見出し・表など）を、そのままHTMLの形にする」だけに使う。内容の追加や脚色はしない。
- 数式は LaTeX を $...$（インライン）/ $$...$$（ブロック）で書く。
- 図やイラストは描き起こせないので「[図: （見たままの簡単な説明）]」と一言だけ書く。

# 出力フォーマット（厳守）
- 出力は **HTMLのみ**。前置き・説明・コードフェンス（\`\`\`）は一切書かない。
- 1行目は必ず内容を表す短いタイトルを <h1>タイトル</h1> で書く（タイトルは内容から付けてよい）。`;

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
