'use client';

// News tab companion — Lily explains the currently-open article on demand:
// English key points, a Japanese gist, a few tech vocabulary picks, and one
// background note. A single, cheap Gemini text call; no chat history kept,
// same "just this thing" scope as lib/pdfPageSummary.ts's page summary.

import { callGeminiChat } from './gemini';
import type { ChatTurn } from './gemini';
import { getEffectiveApiKey } from './appLang';

const EXPLAIN_SYS = `あなたはLily Memoのニュースタブに常駐する学習アシスタントLilyです。渡された英語の技術ニュース記事を読み、日本語話者のエンジニア学習者向けに、この形式で厳密に出力する（前置き・後書き一切なし、見出しの文字列は変えない）:
要約:
- <英語の要点1（簡潔な一文）>
- <要点2>
- <要点3>
和訳: <記事全体の趣旨を2〜3文の日本語で>
単語1: <english word> | <日本語訳> | <技術的な使われ方や文脈の一言解説（日本語）>
単語2: <english word> | <日本語訳> | <一言解説>
単語3: <english word> | <日本語訳> | <一言解説>
豆知識: <関連する技術背景・文法・表現の豆知識を日本語で1〜2文>`;

export interface NewsExplanation {
  summary: string[];
  japanese: string;
  vocabulary: { word: string; meaning: string; note: string }[];
  tip: string;
}

function parseExplanation(raw: string): NewsExplanation {
  const summary = [...raw.matchAll(/^[-・]\s*(.+)$/gm)].map(m => m[1].trim()).slice(0, 3);
  const japaneseMatch = raw.match(/和訳[：:]\s*(.+)/);
  const tipMatch = raw.match(/豆知識[：:]\s*(.+)/);
  const vocabulary = [...raw.matchAll(/^単語\d+[：:]\s*(.+)$/gm)]
    .map(m => {
      const parts = m[1].split('|').map(s => s.trim());
      return { word: parts[0] || '', meaning: parts[1] || '', note: parts[2] || '' };
    })
    .filter(v => v.word);
  return {
    summary,
    japanese: (japaneseMatch?.[1] ?? '').trim(),
    vocabulary,
    tip: (tipMatch?.[1] ?? '').trim(),
  };
}

export async function explainNewsArticle(title: string, snippet: string): Promise<NewsExplanation> {
  const apiKey = getEffectiveApiKey();
  if (!apiKey) throw new Error('先に設定でGemini APIキーを登録してね');
  const history: ChatTurn[] = [{
    role: 'user',
    text: `タイトル: ${title}\n本文: ${snippet}`,
  }];
  const reply = await callGeminiChat(history, EXPLAIN_SYS, apiKey, {
    temperature: 0.4,
    maxOutputTokens: 1536,
  });
  return parseExplanation(reply);
}
