'use client';

// PDF page companion — Lily's bottom dock in the PDF viewer. Summarizes the
// currently-shown page (from its already-rendered canvas, as a JPEG — same
// capture approach as the floating sikun's PDF bridge) on demand, when the
// user taps the dock's summarize button. A single, cheap Gemini vision call;
// no chat history is kept, matching the dock's "just this page" scope.

import { callGeminiChat } from './gemini';
import type { ChatTurn } from './gemini';
import { getEffectiveApiKey } from './appLang';

const SUMMARY_SYS = `あなたはPDF閲覧画面に常駐する学習アシスタントLilyです。渡された1ページの画像を読み、この形式で厳密に出力する（前置き・後書き一切なし）:
要約: <このページの要点を1〜2文で>
用語: <このページに出てくる重要語をカンマ区切りで最大4つ。無ければ空欄でよい>`;

export interface PdfPageSummary {
  summary: string;
  terms: string[];
}

function parseSummary(raw: string): PdfPageSummary {
  const summaryMatch = raw.match(/要約[：:]\s*(.+)/);
  const termsMatch = raw.match(/用語[：:]\s*(.+)/);
  const terms = termsMatch
    ? termsMatch[1].split(/[,、，]/).map(s => s.trim()).filter(Boolean).slice(0, 4)
    : [];
  return {
    summary: (summaryMatch?.[1] ?? raw).trim(),
    terms,
  };
}

export async function summarizePdfPage(imageBase64: string): Promise<PdfPageSummary> {
  const apiKey = getEffectiveApiKey();
  if (!apiKey) throw new Error('先に設定でGemini APIキーを入力してください。');
  const history: ChatTurn[] = [{
    role: 'user',
    text: 'このページを要約して。',
    attachments: [{ mimeType: 'image/jpeg', data: imageBase64 }],
  }];
  const reply = await callGeminiChat(history, SUMMARY_SYS, apiKey, {
    temperature: 0.3,
    maxOutputTokens: 1024,
  });
  return parseSummary(reply);
}
