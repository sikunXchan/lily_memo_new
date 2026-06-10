'use client';

// PDF → Markdown conversion. Page images (JPEG renders from pdf.js) are sent
// to Gemini in chunks with a strict transcription prompt; the chunks are
// joined into one Markdown document. Used by the PDF viewer's「Markdown化」
// button, which then lets the user download the .md or save it as a memo.

import { callGeminiChat } from './gemini';
import type { ChatTurn } from './gemini';
import { getEffectiveApiKey, getAppLang } from './appLang';

// Pages per Gemini request. Small enough to keep each request well under the
// inline-data limit at our render quality, large enough to preserve context
// (headings/tables that continue across pages).
const PAGES_PER_REQUEST = 8;

const SYS_JA = `あなたはPDFをMarkdownに変換する書き起こし専用AIです。渡されたPDFページ画像の内容を、忠実にMarkdownへ変換します。

# 変換ルール（厳守）
- **忠実に書き起こす**: 要約・省略・言い換え・創作は一切しない。本文のテキストをそのまま写す
- 見出しの大きさ・構造を反映して #, ##, ### を使い分ける
- 箇条書き・番号付きリストはMarkdownのリストにする
- 表はMarkdownの表（| 列 | 列 |）にする
- 数式はLaTeXにする（インラインは $...$、独立した式は $$...$$）
- 図・写真・イラストは本文の該当位置に [図: 内容の簡潔な説明] と1行で記す
- ヘッダー/フッターのページ番号や透かしは書き起こさない
- 判読できない箇所は [判読不能] と記す。推測で埋めない
- 出力はMarkdown本文のみ。前置き・後書き・コードフェンス（\`\`\`）で全体を囲むことは禁止`;

const SYS_EN = `You are a transcription-only AI that converts PDF pages to Markdown. Faithfully convert the content of the given PDF page images into Markdown.

# Rules (strict)
- **Transcribe faithfully**: no summarising, omitting, paraphrasing or inventing. Copy the body text as is.
- Use #, ##, ### following the visual heading hierarchy.
- Convert bullet/numbered lists to Markdown lists.
- Convert tables to Markdown tables (| col | col |).
- Write math as LaTeX ($...$ inline, $$...$$ display).
- For figures/photos/illustrations, write a single line [Figure: short description] at their position in the text.
- Skip header/footer page numbers and watermarks.
- Mark unreadable parts as [unreadable]; never guess.
- Output ONLY the Markdown body. No preamble, no closing remarks, never wrap the whole output in code fences.`;

// Strip a model-added outer ```markdown fence, if any slipped through.
function stripOuterFence(s: string): string {
  const m = s.trim().match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n?```$/);
  return m ? m[1].trim() : s.trim();
}

export interface PdfToMarkdownProgress {
  done: number;   // pages converted so far
  total: number;  // total pages being converted
}

/**
 * Convert rendered PDF page images (base64 JPEG, no data: prefix) into one
 * Markdown document. Throws a user-facing Error when no API key is set or
 * every request fails.
 */
export async function pdfPagesToMarkdown(
  pageImages: string[],
  onProgress?: (p: PdfToMarkdownProgress) => void,
): Promise<string> {
  const apiKey = getEffectiveApiKey();
  if (!apiKey) {
    throw new Error(getAppLang() === 'en'
      ? 'Set your Gemini API key in Settings first.'
      : '先に設定でGemini APIキーを入力してください。');
  }
  const sys = getAppLang() === 'en' ? SYS_EN : SYS_JA;
  const total = pageImages.length;
  const parts: string[] = [];

  for (let i = 0; i < total; i += PAGES_PER_REQUEST) {
    const chunk = pageImages.slice(i, i + PAGES_PER_REQUEST);
    const from = i + 1;
    const to = i + chunk.length;
    const text = getAppLang() === 'en'
      ? `These are pages ${from}–${to} of a ${total}-page PDF. Convert them to Markdown following the rules.`
      : `これは全${total}ページのPDFの ${from}〜${to} ページ目です。ルールに従ってMarkdownに変換してください。`;
    const history: ChatTurn[] = [{
      role: 'user',
      text,
      attachments: chunk.map(data => ({ mimeType: 'image/jpeg', data })),
    }];
    const reply = await callGeminiChat(history, sys, apiKey, {
      temperature: 0.2,
      maxOutputTokens: 65536,
    });
    parts.push(stripOuterFence(reply));
    onProgress?.({ done: to, total });
  }

  return parts.join('\n\n');
}
