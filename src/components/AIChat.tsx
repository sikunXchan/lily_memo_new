'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Sparkles, Send, ChevronDown, ChevronUp, RotateCcw, Book, Brush,
  FileText, Settings as SettingsIcon, Paperclip, X, Search,
  FileDown, Wand2, Download, Pencil, HelpCircle,
} from 'lucide-react';
import {
  Bar, Line, Pie, Scatter,
} from 'react-chartjs-2';
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, PointElement,
  LineElement, ArcElement, Title, Tooltip, Legend, Filler,
} from 'chart.js';
import mermaid from 'mermaid';
import 'katex/dist/katex.min.css';
import { db, newSyncId } from '@/lib/db';
import type { Note, Folder } from '@/lib/db';
import {
  callGeminiChat, callDeepResearch, uploadToFileApi,
  streamSikunlilyChat, SIKU_THINKING_BUDGETS,
  LILY_CHAT_SYSTEM_PROMPT, SIKUNLILY_CHAT_SYSTEM_PROMPT,
  runMultiAgentPipeline,
} from '@/lib/gemini';
import type { ChatTurn, ChatAttachment } from '@/lib/gemini';
import { noteHtmlToText } from '@/lib/noteText';
import { parseSlides, exportSlidesToPptx } from '@/lib/slides';
import { parseGeometry, renderGeometrySvg } from '@/lib/geometry';
import { renderRich } from '@/lib/richText';
import { sanitizeMindmap } from '@/lib/mermaidSanitize';
import {
  downloadTextFile, downloadSvg, downloadSvgAsPng, downloadCanvasAsPng,
} from '@/lib/fileGen';

ChartJS.register(
  CategoryScale, LinearScale, BarElement, PointElement, LineElement,
  ArcElement, Title, Tooltip, Legend, Filler
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
mermaid.initialize({ startOnLoad: false, theme: 'neutral', securityLevel: 'loose', suppressErrors: true } as any);

const MAX_FILE_BYTES = 12 * 1024 * 1024; // 12MB per file
const MAX_FILES = 5;
const ACCEPTED_FILE_TYPES = 'image/png,image/jpeg,image/webp,image/heic,image/heif,application/pdf,text/plain';

interface AttachmentMeta {
  id: string;
  name: string;
  mimeType: string;
  data: string; // base64
  isImage: boolean;
  fileUri?: string;           // set after File API upload (large images)
  extractedText?: string;     // legacy text extraction fallback
  pdfPageImages?: Array<{ data: string }>; // JPEG renders of PDF pages
  pdfTotalPages?: number;     // total pages (may exceed pdfPageImages.length)
  uploading?: boolean;        // true while async processing is in progress
}

interface ChatMessage {
  id: string;
  role: 'user' | 'lily';
  text: string;
  timestamp: number;
  extractedBlocks?: InsertableBlock[];
  questions?: ClarifyQuestion[];
  attachments?: AttachmentMeta[];
  thinking?: string; // sikunlily extended thinking log
}

interface InsertableBlock {
  id: string;
  type: 'mermaid' | 'chart' | 'qa' | 'slides' | 'file' | 'geometry' | 'memo_create' | 'memo_overwrite' | 'folder_create' | 'note_move';
  rawCode: string;
  previewLabel: string;
  fileName?: string;
  memoTitle?: string;
  memoId?: number;
  folderName?: string;
  folderColor?: string;
  targetFolderName?: string;
}

interface ClarifyQuestion {
  id: string;
  question: string;
  options: string[];
}

interface AIChatProps {
  onOpenSettings: () => void;
  onSwitchTab?: (tab: 'memos' | 'sketch' | 'pdf' | 'settings') => void;
  onNoteCreated?: (noteId: number) => void;
}

function escHtmlAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function detectMermaidLabel(code: string): string {
  if (/sequenceDiagram/i.test(code)) return 'シーケンス図';
  if (/classDiagram/i.test(code)) return 'クラス図';
  if (/gantt/i.test(code)) return 'ガントチャート';
  if (/pie/i.test(code)) return '円グラフ(Mermaid)';
  if (/erDiagram/i.test(code)) return 'ER図';
  if (/^\s*mindmap/im.test(code)) return 'マインドマップ';
  if (/graph|flowchart/i.test(code)) return 'フローチャート';
  return 'Mermaid図';
}

function detectChartLabel(code: string): string {
  try {
    const p = JSON.parse(code);
    const m: Record<string, string> = { bar: '棒グラフ', line: '折れ線グラフ', pie: '円グラフ', scatter: '散布図' };
    return m[p.type as string] ?? 'グラフ';
  } catch { return 'グラフ'; }
}

type QAKind = 'qa' | 'fill' | 'order' | 'choice' | 'truefalse' | 'flash';

function parseQAKind(code: string): QAKind {
  const m = code.match(/^\s*@@kind\s*:\s*(\w+)/im);
  const v = m?.[1]?.toLowerCase();
  const head = code.split('\n')[0] || '';
  if (v === 'fill' || /穴埋め|fill[-_ ]?in/i.test(head)) return 'fill';
  if (v === 'order' || /並べ替え|並べかえ|reorder|sort/i.test(head)) return 'order';
  if (v === 'choice' || /多肢選択|選択問題|四択|4択|3択|multiple[-_ ]?choice/i.test(head)) return 'choice';
  if (v === 'truefalse' || v === 'tf' || /○×|まるばつ|正誤|true[-_ ]?false/i.test(head)) return 'truefalse';
  if (v === 'flash' || v === 'flashcard' || /単語カード|暗記カード|フラッシュ|flash[-_ ]?card/i.test(head)) return 'flash';
  return 'qa';
}

const QA_KIND_LABEL: Record<QAKind, string> = {
  qa: 'Q&A',
  fill: '穴埋め問題',
  order: '並べ替え問題',
  choice: '選択問題',
  truefalse: '○×問題',
  flash: '単語カード',
};

interface QAPairParsed { q: string; a: string; opts?: string[] }

function parseQAPairs(code: string): QAPairParsed[] {
  const lines = code.split('\n').map(l => l.trim())
    .filter(l => l && !/^@@\w+\s*:/.test(l));
  const pairs: QAPairParsed[] = [];
  let cur: QAPairParsed | null = null;
  for (const line of lines) {
    const qm = line.match(/^[Qq]\s*\d*\s*[:.：]\s*(.*)/);
    const am = line.match(/^[Aa]\s*\d*\s*[:.：]\s*(.*)/);
    const om = line.match(/^(?:[-*・>‣–—]|[0-9０-９]+[.)）]|[A-Da-dア-エ①-④][.)）])\s+(.*)/);
    if (qm) {
      if (cur && cur.a !== undefined && cur.q) pairs.push(cur);
      cur = { q: qm[1].trim(), a: '' };
    } else if (am && cur) {
      cur.a = am[1].trim();
      pairs.push(cur);
      cur = null;
    } else if (om && cur && !cur.a) {
      (cur.opts ||= []).push(om[1].trim());
    } else if (cur && !cur.a && cur.opts === undefined && line) {
      // continuation of a multi-line question
      cur.q += ' ' + line;
    }
  }
  if (cur && cur.q && cur.a) pairs.push(cur);
  return pairs.filter(p => p.q);
}

// Strip markdown emphasis and internal directives so a question never
// shows raw `**bold**` / `@@kind:` / fences to the user.
function cleanAsk(s: string): string {
  return s
    .replace(/[（(]\s*@@[^）)]*[）)]/g, '')
    .replace(/@@\w+\s*:\s*[^\s、,）)]*/g, '')
    .replace(/`+/g, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/[*_]/g, '')
    .replace(/^\s*[-・>‣–—]\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseAIResponse(text: string, allowMemoBlocks = true): {
  textContent: string;
  blocks: InsertableBlock[];
  questions: ClarifyQuestion[];
} {
  const blocks: InsertableBlock[] = [];
  const questions: ClarifyQuestion[] = [];

  // Clarifying-question blocks first.
  const ASK_RE = /```ask\s*([\s\S]*?)```/g;
  const afterAsk = text.replace(ASK_RE, (_full, inner: string) => {
    const lines = inner.split('\n').map((l: string) => l.trim()).filter(Boolean);
    let question = '';
    const options: string[] = [];
    for (const line of lines) {
      const qm = line.match(/^(?:Q|質問)\s*[:：]\s*(.*)/i);
      const om = line.match(/^[-*・]\s+(.*)/);
      if (qm) question = qm[1].trim();
      else if (om) options.push(om[1].trim());
      else if (!question) question = line;
    }
    question = cleanAsk(question);
    const cleanOpts = options.map(cleanAsk).filter(Boolean);
    if (question) questions.push({ id: crypto.randomUUID(), question, options: cleanOpts });
    return '';
  });

  // Generic downloadable file blocks (filename on the first line).
  const FILE_RE = /```file\s*\n@@filename:\s*([^\n]+)\n([\s\S]*?)```/g;
  const work = afterAsk.replace(FILE_RE, (_full, name: string, content: string) => {
    const fileName = name.trim();
    blocks.push({
      id: crypto.randomUUID(),
      type: 'file',
      rawCode: content.replace(/\n$/, ''),
      previewLabel: fileName,
      fileName,
    });
    return `\n✨ [ファイル「${fileName}」を作ったよ]\n`;
  });

  // Fallback: catch geometry JSON that Gemini accidentally put in ```json fences or bare
  const JSON_FENCE_RE = /```(?:json)?\s*\n(\{[\s\S]*?"elements"\s*:[\s\S]*?\})\s*\n```/g;
  const work2 = work.replace(JSON_FENCE_RE, (_full, jsonStr: string) => {
    try {
      parseGeometry(jsonStr.trim());
      const id = crypto.randomUUID();
      blocks.push({ id, type: 'geometry', rawCode: jsonStr.trim(), previewLabel: '数学・幾何の図' });
      return `\n✨ [数学の図を描いたよ]\n`;
    } catch {
      return _full; // not a geometry block, leave it
    }
  });

  const FENCE_RE = /```(mermaid|chart|qa|slides|geometry|memo_create|memo_overwrite|folder_create|note_move)([\s\S]*?)```/g;
  const textContent = work2.replace(FENCE_RE, (_full, type, code) => {
    const trimmed = code.trim();
    const id = crypto.randomUUID();
    if (type === 'mermaid') {
      blocks.push({ id, type: 'mermaid', rawCode: trimmed, previewLabel: detectMermaidLabel(trimmed) });
      return `\n✨ [${detectMermaidLabel(trimmed)}を作ったよ]\n`;
    }
    if (type === 'chart') {
      try { JSON.parse(trimmed); } catch { return '\n[グラフの生成に失敗しちゃった]\n'; }
      blocks.push({ id, type: 'chart', rawCode: trimmed, previewLabel: detectChartLabel(trimmed) });
      return `\n✨ [${detectChartLabel(trimmed)}を作ったよ]\n`;
    }
    if (type === 'qa') {
      const pairs = parseQAPairs(trimmed);
      if (pairs.length === 0) return '\n[Q&Aの解析に失敗しちゃった]\n';
      const label = `${pairs.length}問の${QA_KIND_LABEL[parseQAKind(trimmed)]}`;
      blocks.push({ id, type: 'qa', rawCode: trimmed, previewLabel: label });
      return `\n✨ [${label}を作ったよ]\n`;
    }
    if (type === 'slides') {
      const deck = parseSlides(trimmed);
      const label = `${deck.slides.length}枚のスライド`;
      blocks.push({ id, type: 'slides', rawCode: trimmed, previewLabel: label });
      return `\n✨ [${label}を作ったよ]\n`;
    }
    if (type === 'geometry') {
      try { parseGeometry(trimmed); } catch { return '\n[図の生成に失敗しちゃった]\n'; }
      blocks.push({ id, type: 'geometry', rawCode: trimmed, previewLabel: '数学・幾何の図' });
      return `\n✨ [数学の図を描いたよ]\n`;
    }
    if (type === 'memo_create' && allowMemoBlocks) {
      const firstLine = trimmed.split('\n')[0] || '';
      const titleMatch = firstLine.match(/^@@memo_create\s*:\s*(.+)/);
      const memoTitle = titleMatch?.[1]?.trim() || '新しいメモ';
      const content = trimmed.split('\n').slice(1).join('\n').trim();
      blocks.push({ id, type: 'memo_create', rawCode: content, previewLabel: `メモ作成: ${memoTitle}`, memoTitle });
      return `\n✨ [「${memoTitle}」というメモを作る準備ができたよ]\n`;
    }
    if (type === 'memo_overwrite' && allowMemoBlocks) {
      const firstLine = trimmed.split('\n')[0] || '';
      const idMatch = firstLine.match(/^@@memo_overwrite\s*:\s*(\d+)/);
      const memoId = idMatch ? Number(idMatch[1]) : undefined;
      const content = trimmed.split('\n').slice(1).join('\n').trim();
      blocks.push({ id, type: 'memo_overwrite', rawCode: content, previewLabel: `メモ上書き: ID ${memoId ?? '不明'}`, memoId });
      return `\n✨ [メモを書き換える準備ができたよ]\n`;
    }
    if (type === 'folder_create') {
      const lines = trimmed.split('\n');
      const nameMatch = lines[0]?.match(/^@@folder_create\s*:\s*(.+)/);
      const colorMatch = lines.find((l: string) => l.startsWith('@@color:'))?.match(/^@@color:\s*(.+)/);
      const folderName = nameMatch?.[1]?.trim() || '新しいフォルダ';
      const folderColor = colorMatch?.[1]?.trim();
      blocks.push({ id, type: 'folder_create', rawCode: trimmed, previewLabel: `フォルダ作成: 📁 ${folderName}`, folderName, folderColor });
      return `\n📁 [「${folderName}」フォルダを作る準備ができたよ]\n`;
    }
    if (type === 'note_move') {
      const lines = trimmed.split('\n');
      const idMatch = lines[0]?.match(/^@@note_move\s*:\s*(\d+)/);
      const folderMatch = lines.find((l: string) => l.startsWith('@@to_folder:'))?.match(/^@@to_folder:\s*(.+)/);
      const memoId = idMatch ? Number(idMatch[1]) : undefined;
      const targetFolderName = folderMatch?.[1]?.trim() || '未分類';
      blocks.push({ id, type: 'note_move', rawCode: trimmed, previewLabel: `移動: ID ${memoId ?? '?'} → 📁 ${targetFolderName}`, memoId, targetFolderName });
      return `\n📁 [メモを「${targetFolderName}」に移動する準備ができたよ]\n`;
    }
    return '';
  }).trim();

  // Fallback: if Lily ignores the `ask` block rule and asks in plain prose,
  // surface it as a clarify form. Very conservative — false positives
  // (turning a real answer into a form) are worse than missing a form.
  // Only trigger when the ENTIRE reply is a short, standalone question.
  if (questions.length === 0 && blocks.length === 0) {
    const t = textContent.trim();
    // Strip trailing emoji/punctuation to test what the reply really ends on.
    const tail = t.replace(/[\s。.!！~〜♪\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]+$/u, '');
    const endsOnQuestion = /[?？]$/.test(tail);
    // Sign-off phrases mean this is a completed task, not a real question.
    const signOff = /(声をかけて|気軽に|いつでも|聞いてね|参考に|役に立て|できたよ|完成|してみた|まとめた|作ってみた|書いてみた|訳してみた|翻訳してみた|楽しんで|またね|どうぞ)/.test(t);
    // A genuine standalone question is short, ends on ？, and has no
    // substantive answer content (no bullets, no numbered lists, no colons
    // introducing sections — those are all signs of a real answer).
    const hasAnswerContent = /^[-*・]\s|\n[-*・]\s|^\d+[.)]\s|\n\d+[.)]\s|：\s*\n|:\s*\n/.test(t);
    if (
      t.length > 0 &&
      t.length <= 120 &&
      endsOnQuestion &&
      !signOff &&
      !hasAnswerContent
    ) {
      // Try to extract parenthetical options like (A／B／C)
      const paren = t.match(/[（(]([^（）()]*(?:[、,／/]|または|or)[^（）()]*)[）)]/);
      let options: string[] = [];
      if (paren) {
        options = paren[1]
          .split(/[、,／/]|または|\bor\b/)
          .map(s => cleanAsk(s))
          .filter(s => s.length > 0 && s.length <= 24);
        if (options.length < 2) options = [];
      }
      questions.push({ id: crypto.randomUUID(), question: cleanAsk(t), options });
    }
  }

  // Never let internal directives leak into the visible chat bubble.
  const cleanText = textContent
    .replace(/[（(]\s*@@[^）)]*[）)]/g, '')
    .replace(/@@\w+\s*:\s*[^\s、,）)]*/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .trim();

  return { textContent: cleanText, blocks, questions };
}

const CHART_PALETTE = [
  'rgba(255,99,132,0.75)', 'rgba(54,162,235,0.75)', 'rgba(255,206,86,0.75)',
  'rgba(75,192,192,0.75)', 'rgba(153,102,255,0.75)', 'rgba(255,159,64,0.75)',
  'rgba(231,76,60,0.75)', 'rgba(46,204,113,0.75)', 'rgba(52,152,219,0.75)',
];
const CHART_PALETTE_BORDER = CHART_PALETTE.map(c => c.replace('0.75', '1'));

function autoColorChart(parsed: Record<string, unknown>): Record<string, unknown> {
  const data = parsed.data as { datasets?: Array<Record<string, unknown>> } | undefined;
  if (!Array.isArray(data?.datasets)) return parsed;
  const datasets = data!.datasets!.map((ds, i) => {
    if (ds.backgroundColor) return ds;
    const isPie = parsed.type === 'pie' || parsed.type === 'doughnut';
    return {
      ...ds,
      backgroundColor: isPie ? CHART_PALETTE : CHART_PALETTE[i % CHART_PALETTE.length],
      borderColor: isPie ? CHART_PALETTE_BORDER : CHART_PALETTE_BORDER[i % CHART_PALETTE_BORDER.length],
    };
  });
  return { ...parsed, data: { ...data, datasets } };
}

function blockToHtml(block: InsertableBlock): string {
  if (block.type === 'mermaid') {
    return `<div content="${escHtmlAttr(block.rawCode)}" width="100%" data-type="mermaid"></div>`;
  }
  if (block.type === 'chart') {
    const parsed = autoColorChart(JSON.parse(block.rawCode));
    const codeStr = `return ${JSON.stringify(parsed)};`;
    return `<div code="${escHtmlAttr(codeStr)}" type="${escHtmlAttr((parsed.type as string) || 'bar')}" width="100%" data-type="chart"></div>`;
  }
  if (block.type === 'qa') {
    const pairs = parseQAPairs(block.rawCode);
    if (pairs.length === 0) throw new Error('Q&Aの解析に失敗しました');
    return `<div data-pairs="${escHtmlAttr(JSON.stringify(pairs))}" data-kind="${parseQAKind(block.rawCode)}" data-type="qa"></div>`;
  }
  if (block.type === 'geometry') {
    return `<div data-type="geometry" data-code="${escHtmlAttr(block.rawCode)}" data-width="100%"></div>`;
  }
  if (block.type === 'file') {
    return `<pre><code>${escHtmlAttr(block.rawCode)}</code></pre>`;
  }
  if (block.type === 'memo_create') {
    return `<p>${block.rawCode.split('\n').map(escHtmlAttr).join('</p><p>')}</p>`;
  }
  if (block.type === 'slides') {
    const deck = parseSlides(block.rawCode);
    return deck.slides
      .map(s => {
        const lines: string[] = [];
        if (s.subtitle) lines.push(s.subtitle);
        if (s.lead) lines.push(s.lead);
        if (s.quote) lines.push(`"${s.quote}"${s.by ? ` — ${s.by}` : ''}`);
        const bullets = [
          ...(s.items ?? []),
          ...(s.left?.items ?? []),
          ...(s.right?.items ?? []),
          ...(s.cols?.flatMap(c => c.items) ?? []),
          ...(s.kpis?.map(k => `${k.value} — ${k.label}${k.detail ? ` (${k.detail})` : ''}`) ?? []),
          ...(s.steps?.map(st => `${st.heading}${st.detail ? `: ${st.detail}` : ''}`) ?? []),
        ];
        const h = s.heading ? `<h2>${escHtmlAttr(s.heading)}</h2>` : '';
        const body = lines.map(p => `<p>${escHtmlAttr(p)}</p>`).join('');
        const ul = bullets.length
          ? `<ul>${bullets.map(b => `<li>${escHtmlAttr(b)}</li>`).join('')}</ul>`
          : '';
        return h + body + ul;
      })
      .join('');
  }
  return '';
}

async function insertBlockIntoNote(block: InsertableBlock, noteId: number): Promise<void> {
  const note = await db.notes.get(noteId);
  if (!note) throw new Error('メモが見つかりません');
  const appendHtml = blockToHtml(block);
  if (!appendHtml) return;
  await db.notes.update(noteId, {
    content: (note.content || '') + appendHtml,
    updatedAt: Date.now(),
  });
}

async function createNoteWithBlock(block: InsertableBlock, title: string): Promise<number> {
  const t = Date.now();
  const id = await db.notes.add({
    syncId: newSyncId(),
    title: title || 'Lily が作ったメモ',
    content: blockToHtml(block),
    type: 'text',
    createdAt: t,
    updatedAt: t,
  });
  return id as number;
}

function buildSystemPrompt(contextNotes: Note[]): string {
  if (contextNotes.length === 0) return LILY_CHAT_SYSTEM_PROMPT;
  const context = contextNotes
    .map(n => `## ${n.title || '無題'} (ID:${n.id})\n${noteHtmlToText(n.content || '').slice(0, 4000)}`)
    .join('\n\n---\n\n');
  return `${LILY_CHAT_SYSTEM_PROMPT}\n\n【参照中のメモ (${contextNotes.length}件)】\n${context}`;
}

const SIKU_MODE_PROMPTS: Record<string, string> = {
  code: `
【現在のモード: コード構築】
複数ファイルにまたがる大規模プロジェクト全体を設計・実装することに全力を注げ。
非機能要件（性能・セキュリティ・保守性・スケーラビリティ）を複合的に考慮し、アーキテクチャ全体を最適化せよ。
コードブロック形式で各ファイルを明示し、ディレクトリ構成も提示すること。`,
  organize: `
【現在のモード: メモ整理】
提供されたメモ群を横断的に分析し、フォルダ構造の整理を行う。
分析内容:
1. メモ間の関連性・重複・矛盾を検出して報告する
2. 最適なフォルダ構造を提案する（フォルダ名・どのメモをどこに入れるか）
3. 孤立したメモや未整理コンテンツを指摘する

【フォルダ整理の実行方法 - 必ず守ること】
- 「フォルダ分けして」「整理して」「実行して」等と言われたら、必ず folder_create / note_move ブロックを出力すること
- 「AIにはUIを操作できない」は誤りだ。このアプリは folder_create / note_move ブロックで実際にフォルダ作成・メモ移動が実行される
- memo_create / memo_overwrite ブロックは使わない（メモの内容を書き換えるものではなくフォルダ構造を整理するモードだ）
- ユーザーが承認したら即座にブロックを出力する。「できない」と言わない`,
  analysis: `
【現在のモード: データ解析】
PDF・画像・音声・動画・手書きメモ・Webページなど、あらゆる形式の非構造化データから関連する情報・概念・感情・意図を抽出し、統合的に分析せよ。
単なるキーワード抽出に留まらず、文脈全体を理解し、意味のある洞察を導き出すこと。
膨大なデータの中から人間には発見しにくい複雑な相関関係・隠れたパターン・異常な振る舞いを検知し、過去データに基づく将来予測とシミュレーション結果も提示すること。`,
  research: `
【現在のモード: 調査・検証】
複数の情報源から得られたデータについて、信頼性・鮮度を評価し相互の整合性を確認せよ。
矛盾する情報が存在する場合はその原因を特定し、より信頼性の高い情報を優先して提示すること。
貴殿から与えられた目標に対し、必要な情報収集・計画立案・複数ツールの連携を自律的に行い、進捗と結果を報告せよ。
市場調査や競合分析など抽象的な指示も具体的なステップに分解して実行すること。`,
  arch: `
【現在のモード: アーキテクチャ設計】
要件定義・設計書・課題から最適なシステム構成を自動的に提案・設計する技術コンサルタントとして振る舞え。

1. **アーキテクチャ提案**: スケーラビリティ・耐障害性・セキュリティ・保守性を考慮した構成を提案し、必ず Mermaid 図（graph TD / sequenceDiagram / classDiagram 等）で視覚化する
2. **テストケース自動生成**: 要件定義・設計書・既存コードから網羅性の高いテストケース（単体・結合・E2E）を生成し、カバレッジの抜け漏れを指摘する
3. **技術選定の比較**: 複数の解決策・ライブラリ・アーキテクチャパターンをメリット/デメリット・導入コスト・将来性で比較し、推奨案を論理的に提示する
4. **潜在的問題の特定**: 設計の弱点・スケールボトルネック・セキュリティリスクを事前に洗い出して改善提案を出す

必ずMermaid図を出力して視覚的に示すこと。テキストだけで終わらせない。`,
  study: `
【現在のモード: 学習支援】
学習・教育を全力でサポートする。以下の機能を状況に応じて使い分けよ。

1. **テキスト理解 & Q&A 自動生成**: メモや添付テキストを読み込み、試験対策に役立つ Q&A を自動生成する。形式は内容に応じて qa / fill / truefalse / order / flash から最適なものを選ぶ
2. **概念間の関連性可視化**: 「この分野の全体像を見せて」「概念マップを作って」と言われたら、Mermaid mindmap でキーワード間の関係を整理して提示する
3. **レポート・小論文添削**: 論理構成の明確さ・根拠の提示方法・表現の適切さをフィードバックする。「何が弱い部分か」を具体的に指摘し改善案を出す
4. **外国語支援**: 翻訳・文法解説・英作文/和文の添削。なぜその表現が適切か/不適切かを具体的に説明する
5. **学習パス提案**: 「この単元が苦手」「どこから勉強すべきか」と言われたら、理解度に合わせた次の学習ステップを提案する

Q&A を生成する時は必ず qa ブロックで出力してメモに挿入できる形にする。マインドマップは必ず Mermaid mindmap を使う。`,
};

function buildSikunSystemPrompt(contextNotes: Note[], allFolders?: Folder[], mode?: string): string {
  const base = SIKUNLILY_CHAT_SYSTEM_PROMPT;
  const modePrompt = mode ? (SIKU_MODE_PROMPTS[mode] ?? '') : '';
  let extra = '';
  if (allFolders && allFolders.length > 0) {
    const list = allFolders.map(f => `- 「${f.name}」(フォルダID:${f.id})`).join('\n');
    extra += `\n\n【既存のフォルダ (${allFolders.length}件)】\n${list}`;
  }
  if (contextNotes.length > 0) {
    const notesCtx = contextNotes
      .map(n => {
        const folder = allFolders?.find(f => f.id === n.folderId);
        const loc = folder ? ` [フォルダ:${folder.name}]` : ' [未分類]';
        return `## ${n.title || '無題'} (ID:${n.id})${loc}\n${noteHtmlToText(n.content || '').slice(0, 4000)}`;
      })
      .join('\n\n---\n\n');
    extra += `\n\n【参照中のメモ (${contextNotes.length}件)】\n${notesCtx}`;
  }
  return `${base}${modePrompt}${extra}`;
}

/* ───────────── Block previews ───────────── */

/* ─────────────── Help Modal ─────────────── */

const LILY_FEATURES = [
  { icon: '📝', title: 'メモ分析・要約', desc: '選択中のメモを読んで要点まとめ・アドバイス' },
  { icon: '🗺️', title: 'マインドマップ', desc: 'アイデア出し・ブレスト → Mermaid mindmap で可視化' },
  { icon: '📊', title: 'グラフ作成', desc: 'データを棒・折れ線・円グラフなどに可視化 (Chart.js)' },
  { icon: '🔷', title: 'Mermaid 図', desc: 'フロー・シーケンス・クラス図・ER図・ガントチャート' },
  { icon: '📐', title: '数学・幾何の図', desc: '座標平面に点・ベクトル・円・関数グラフを描画' },
  { icon: '❓', title: 'Q&A・問題作成', desc: '一問一答・穴埋め・4択・○×・単語カードなど6形式' },
  { icon: '📄', title: 'PDF・画像解析', desc: 'ファイルを添付して内容分析・要約・図表化' },
  { icon: '💻', title: 'コードスニペット', desc: 'Python/JS/HTMLなどのコード生成・解説' },
  { icon: '✉️', title: 'メール文面作成', desc: 'メモを元に報告メール・議事録メールの下書き' },
  { icon: '✍️', title: 'トーン調整', desc: '文章をフォーマル/カジュアル/丁寧に書き換え' },
  { icon: '📰', title: 'ブログ案', desc: 'メモからブログタイトル案・構成案を提案' },
  { icon: '💾', title: 'メモ書き込み', desc: '「メモに書いて」で新規作成・選択中メモを上書き保存' },
];

const SIKU_FEATURES = [
  { icon: '📚', title: '全メモ横断分析', desc: '複数メモ・全メモを一括で参照・分析・整理提案' },
  { icon: '🔍', title: '調査・検証', desc: '事実確認・情報源の信頼性評価・矛盾の検出・訂正' },
  { icon: '⚙️', title: '大規模コード構築', desc: '複数ファイルにまたがるプロジェクト全体を設計・実装' },
  { icon: '📈', title: 'データ解析', desc: '非構造化データの統合解析・パターン認識・将来予測' },
  { icon: '🗂️', title: 'メモ整理', desc: 'メモ間の関連性・重複・矛盾を検出してリンク提案' },
  { icon: '🌐', title: 'Deep Research', desc: '数分かけてウェブ全体を深くリサーチしてレポート作成' },
  { icon: '📄', title: 'PDF・画像解析', desc: 'ファイルを添付して内容分析・検証・要約' },
  { icon: '💾', title: 'メモ書き込み', desc: '「メモに書いて」「整理してメモにして」で保存・上書き' },
  { icon: '🌍', title: '翻訳・要約', desc: '多言語翻訳、長文の要約、文章の変換' },
];

const LILY_PROMPTS = [
  'このメモの要点を3つにまとめて',
  '「スマートホーム」についてマインドマップを作って',
  '先週の売上データをグラフにして\n月曜:120 火曜:95 水曜:140 木曜:110 金曜:160',
  'このメモからテスト問題を4択で5問作って',
  '次の文章をフォーマルに書き換えて',
  'このメモを元に上司への報告メールを作って',
  '二次方程式 x²+3x+2=0 を図を使って解説して',
  'フローチャート: ユーザー登録フローを図にして',
];

const SIKU_PROMPTS = [
  '全メモを読んで重複している内容をまとめて',
  '「地球温暖化は人間活動が原因だ」この主張の根拠と反論を検証して',
  'React + TypeScript で TODO アプリを作って。CRUD 全部実装して',
  'このメモ群の中で矛盾している記述はある？',
  '全メモを分析してフォルダ分類案を提案して',
  'このメモの内容を整理してメモに書いて',
];

const TIPS = [
  { title: 'メモを選んでから話しかける', desc: '右上の「メモを選ぶ」でメモを選択してから質問すると、AI がメモの内容を読んで回答できます。' },
  { title: 'ファイルを添付する', desc: '📎ボタンで PDF・画像を添付できます。「これを要約して」「この画像について説明して」と送信するだけ。' },
  { title: 'Lily はメモを直接書き込める', desc: '「このメモを書き換えて」「要約してメモに保存して」と頼むと、編集候補を提案してくれます。確認後に保存されます。' },
  { title: 'sikunlily は厳しく検証する', desc: '内容の間違いや矛盾があると遠慮なく指摘します。「この情報は正しい？」「根拠は？」という使い方に最適です。' },
  { title: 'ネット検索を ON にする', desc: '「ネット検索 ON」にすると最新情報も調べて答えます。時事ニュース・最新技術の調査に有効。' },
  { title: 'sikunlily の Deep Research', desc: '「Deep Research ON」にすると数分かけてウェブ全体をリサーチし、詳細なレポートを作成します。' },
];

function HelpModal({ onClose, initialTab }: { onClose: () => void; initialTab: 'lily' | 'sikunlily' | 'tips' }) {
  const [tab, setTab] = useState<'lily' | 'sikunlily' | 'tips'>(initialTab);
  return (
    <div className="help-overlay" onClick={onClose}>
      <div className="help-modal" onClick={e => e.stopPropagation()}>
        <div className="help-header">
          <span className="help-title">使い方ガイド</span>
          <button className="help-close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="help-tabs">
          {(['lily', 'sikunlily', 'tips'] as const).map(t => (
            <button key={t} className={`help-tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
              {t === 'lily' ? '🌸 Lily' : t === 'sikunlily' ? '⚔️ sikunlily' : '💡 使い方'}
            </button>
          ))}
        </div>
        <div className="help-body">
          {tab === 'lily' && (
            <>
              <p className="help-lead">Lily はノート作成・学習・創作をサポートする優しいAIアシスタントです。</p>
              <div className="help-grid">
                {LILY_FEATURES.map(f => (
                  <div key={f.title} className="help-card">
                    <span className="help-card-icon">{f.icon}</span>
                    <div><strong>{f.title}</strong><div className="help-card-desc">{f.desc}</div></div>
                  </div>
                ))}
              </div>
              <p className="help-section-title">プロンプト例</p>
              <div className="help-prompts">
                {LILY_PROMPTS.map(p => <div key={p} className="help-prompt">{p}</div>)}
              </div>
            </>
          )}
          {tab === 'sikunlily' && (
            <>
              <p className="help-lead">sikunlily は正確性・批判的思考を重視する開発者向けAIです。間違いは遠慮なく指摘します。</p>
              <div className="help-grid">
                {SIKU_FEATURES.map(f => (
                  <div key={f.title} className="help-card">
                    <span className="help-card-icon">{f.icon}</span>
                    <div><strong>{f.title}</strong><div className="help-card-desc">{f.desc}</div></div>
                  </div>
                ))}
              </div>
              <p className="help-section-title">プロンプト例</p>
              <div className="help-prompts">
                {SIKU_PROMPTS.map(p => <div key={p} className="help-prompt">{p}</div>)}
              </div>
            </>
          )}
          {tab === 'tips' && (
            <div className="help-tips">
              {TIPS.map(t => (
                <div key={t.title} className="help-tip">
                  <strong className="help-tip-title">{t.title}</strong>
                  <p className="help-tip-desc">{t.desc}</p>
                </div>
              ))}
            </div>
          )}
        </div>
        <style jsx>{`
          .help-overlay { position:fixed; inset:0; background:rgba(0,0,0,0.45); z-index:9999; display:flex; align-items:center; justify-content:center; padding:16px; }
          .help-modal { background:var(--background); border-radius:16px; width:100%; max-width:520px; max-height:82vh; display:flex; flex-direction:column; overflow:hidden; box-shadow:0 8px 32px rgba(0,0,0,0.18); }
          .help-header { display:flex; align-items:center; justify-content:space-between; padding:16px 18px 0; }
          .help-title { font-size:1.05rem; font-weight:700; color:var(--primary); }
          .help-close { background:none; border:none; cursor:pointer; color:var(--foreground); opacity:0.6; padding:4px; display:flex; }
          .help-close:hover { opacity:1; }
          .help-tabs { display:flex; gap:6px; padding:12px 18px 0; }
          .help-tab { background:none; border:1.5px solid var(--border); border-radius:20px; padding:5px 14px; font-size:0.82rem; cursor:pointer; color:var(--foreground); opacity:0.65; transition:all 0.15s; }
          .help-tab:hover { opacity:1; }
          .help-tab.active { background:var(--primary); color:#fff; border-color:var(--primary); opacity:1; }
          .help-body { overflow-y:auto; padding:14px 18px 20px; flex:1; }
          .help-lead { font-size:0.85rem; color:var(--foreground); opacity:0.7; margin:0 0 12px; line-height:1.5; }
          .help-grid { display:flex; flex-direction:column; gap:8px; }
          .help-card { display:flex; align-items:flex-start; gap:10px; padding:9px 12px; background:var(--accent); border:1px solid var(--border); border-radius:10px; }
          .help-card-icon { font-size:1.2rem; flex-shrink:0; margin-top:1px; }
          .help-card strong { font-size:0.88rem; color:var(--foreground); }
          .help-card-desc { font-size:0.79rem; color:var(--foreground); opacity:0.65; margin-top:1px; }
          .help-section-title { font-size:0.85rem; font-weight:700; color:var(--primary); margin:16px 0 8px; }
          .help-prompts { display:flex; flex-direction:column; gap:6px; }
          .help-prompt { background:var(--accent); border:1px solid var(--border); border-radius:8px; padding:8px 12px; font-size:0.82rem; color:var(--foreground); white-space:pre-wrap; }
          .help-tips { display:flex; flex-direction:column; gap:12px; }
          .help-tip { padding:12px 14px; background:var(--accent); border:1px solid var(--border); border-radius:10px; }
          .help-tip-title { font-size:0.88rem; color:var(--foreground); display:block; margin-bottom:4px; font-weight:600; }
          .help-tip-desc { font-size:0.81rem; color:var(--foreground); opacity:0.7; margin:0; line-height:1.5; }
        `}</style>
      </div>
    </div>
  );
}

function ImageSaveBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="img-save-bar">
      {children}
      <style jsx>{`
        .img-save-bar { display: flex; gap: 6px; margin-top: 8px; }
        .img-save-bar :global(button) {
          display: flex; align-items: center; gap: 4px;
          background: var(--accent); border: 1px solid var(--border);
          color: var(--foreground); border-radius: 8px;
          padding: 5px 10px; font-size: 0.74rem; font-weight: 600; cursor: pointer;
        }
        .img-save-bar :global(button:hover) { border-color: var(--primary); color: var(--primary); }
      `}</style>
    </div>
  );
}

function MermaidPreview({ code, baseName }: { code: string; baseName: string }) {
  const [svg, setSvg] = useState('');
  const [err, setErr] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const sanitized = sanitizeMindmap(code);
      try {
        // Pre-validate to prevent Mermaid v11 from injecting a bomb SVG on error.
        const ok = await (mermaid as unknown as { parse(t: string, o: object): Promise<boolean> })
          .parse(sanitized, { suppressErrors: true });
        if (!ok) { if (!cancelled) setErr(true); return; }
        const id = `lily-mmd-${Math.random().toString(36).slice(2, 9)}`;
        const { svg: out } = await mermaid.render(id, sanitized);
        if (!cancelled) { setSvg(out); setErr(false); }
      } catch {
        if (!cancelled) setErr(true);
      }
    })();
    return () => { cancelled = true; };
  }, [code]);
  if (err) return (
    <div className="prev-err">
      Mermaid 構文エラー💦<br />
      <span style={{ fontSize: '0.75rem', opacity: 0.7 }}>メモに追加すると編集画面から修正できるよ</span>
    </div>
  );
  return (
    <div>
      <div className="mmd-prev" dangerouslySetInnerHTML={{ __html: svg }} />
      <ImageSaveBar>
        <button onClick={() => downloadSvgAsPng(svg, `${baseName}.png`)} disabled={!svg}>
          <Download size={13} /> PNG保存
        </button>
        <button onClick={() => downloadSvg(svg, `${baseName}.svg`)} disabled={!svg}>
          <Download size={13} /> SVG保存
        </button>
      </ImageSaveBar>
      <style jsx>{`
        .mmd-prev { background: #fff; border-radius: 8px; padding: 12px; overflow: auto; }
        .mmd-prev :global(svg) { max-width: 100%; height: auto; }
      `}</style>
    </div>
  );
}

function ChartPreview({ code, baseName }: { code: string; baseName: string }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chartRef = useRef<any>(null);
  const cfg = useMemo(() => {
    try { return JSON.parse(code); } catch { return null; }
  }, [code]);
  if (!cfg || !cfg.data || !Array.isArray(cfg.data.datasets)) {
    return <div className="prev-err">グラフのプレビューを表示できなかったよ💦</div>;
  }
  const props = {
    ref: chartRef,
    data: cfg.data,
    options: { ...(cfg.options || {}), responsive: true, maintainAspectRatio: false },
  };
  const type = cfg.type || 'bar';
  const savePng = () => {
    const canvas: HTMLCanvasElement | undefined = chartRef.current?.canvas;
    if (canvas) downloadCanvasAsPng(canvas, `${baseName}.png`);
  };
  return (
    <div>
      <div style={{ height: 220, background: '#fff', borderRadius: 8, padding: 10 }}>
        {type === 'line' ? <Line {...props} /> :
         type === 'pie' ? <Pie {...props} /> :
         type === 'scatter' ? <Scatter {...props} /> :
         <Bar {...props} />}
      </div>
      <ImageSaveBar>
        <button onClick={savePng}>
          <Download size={13} /> PNG画像で保存
        </button>
      </ImageSaveBar>
    </div>
  );
}

function GeometryPreview({ code, baseName }: { code: string; baseName: string }) {
  const svg = useMemo(() => {
    try { return renderGeometrySvg(parseGeometry(code)); } catch { return ''; }
  }, [code]);
  if (!svg) return <div className="prev-err">図のプレビューを表示できなかったよ💦</div>;
  return (
    <div>
      <div className="geo-prev" dangerouslySetInnerHTML={{ __html: svg }} />
      <ImageSaveBar>
        <button onClick={() => downloadSvgAsPng(svg, `${baseName}.png`)}>
          <Download size={13} /> PNG保存
        </button>
        <button onClick={() => downloadSvg(svg, `${baseName}.svg`)}>
          <Download size={13} /> SVG保存
        </button>
      </ImageSaveBar>
      <style jsx>{`
        .geo-prev { background: #fff; border-radius: 8px; padding: 8px; overflow: auto; text-align: center; }
        .geo-prev :global(svg) { max-width: 100%; height: auto; }
      `}</style>
    </div>
  );
}

function FilePreview({ block }: { block: InsertableBlock }) {
  const snippet = block.rawCode.slice(0, 400);
  return (
    <div className="file-prev">
      <pre className="file-snippet">{snippet}{block.rawCode.length > 400 ? '\n…' : ''}</pre>
      <ImageSaveBar>
        <button onClick={() => downloadTextFile(block.rawCode, block.fileName || 'lily-file.txt')}>
          <FileDown size={13} /> {block.fileName} をダウンロード
        </button>
      </ImageSaveBar>
      <style jsx>{`
        .file-snippet {
          font-family: 'Fira Code', 'Consolas', monospace;
          font-size: 0.72rem; color: var(--fg-muted);
          background: var(--accent); border-radius: 8px;
          padding: 10px; margin: 0; white-space: pre-wrap;
          word-break: break-word; max-height: 160px; overflow: auto; line-height: 1.5;
        }
      `}</style>
    </div>
  );
}

function QAPreview({ code }: { code: string }) {
  const pairs = useMemo(() => parseQAPairs(code), [code]);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const toggle = (i: number) => setChecked(s => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; });
  const allDone = checked.size === pairs.length && pairs.length > 0;
  return (
    <div className="qa-prev">
      <div className={`qa-prev-progress${allDone ? ' all-done' : ''}`}>
        {checked.size}/{pairs.length} 完了
      </div>
      {pairs.map((p, i) => (
        <div key={i} className={`qa-item${checked.has(i) ? ' checked' : ''}`}>
          <div className="qa-item-row">
            <input type="checkbox" className="qa-prev-cb" checked={checked.has(i)} onChange={() => toggle(i)} />
            <div className="qa-q">Q{i + 1}. {p.q}</div>
          </div>
          {open.has(i) ? (
            <div className="qa-a">A. {p.a}</div>
          ) : (
            <button className="qa-show" onClick={() => setOpen(s => new Set(s).add(i))}>答えを見る</button>
          )}
        </div>
      ))}
      <style jsx>{`
        .qa-prev { display:flex; flex-direction:column; gap:8px; }
        .qa-prev-progress { font-size:0.75rem; font-weight:700; color:var(--primary); background:color-mix(in srgb,var(--primary) 12%,transparent); border-radius:99px; padding:2px 10px; align-self:flex-start; margin-bottom:2px; }
        .qa-prev-progress.all-done { background:#e8f7ee; color:#1a7a4d; }
        .qa-item { background:var(--background); border:1px solid var(--border); border-radius:8px; padding:8px 10px; transition:opacity 0.2s; }
        .qa-item.checked { opacity:0.45; }
        .qa-item.checked .qa-q { text-decoration:line-through; }
        .qa-item-row { display:flex; align-items:flex-start; gap:8px; }
        .qa-prev-cb { margin-top:2px; width:16px; height:16px; flex-shrink:0; accent-color:var(--primary); cursor:pointer; }
        .qa-q { font-weight:700; font-size:0.82rem; color:var(--foreground); flex:1; }
        .qa-a { margin-top:6px; font-size:0.82rem; color:var(--primary); white-space:pre-wrap; padding-left:24px; }
        .qa-show { margin-top:6px; margin-left:24px; background:transparent; border:1px dashed var(--border); border-radius:6px; padding:3px 10px; font-size:0.74rem; color:var(--fg-muted); cursor:pointer; }
      `}</style>
    </div>
  );
}

function SlidesPreview({ code }: { code: string }) {
  const deck = useMemo(() => parseSlides(code), [code]);
  return (
    <div className="sl-prev">
      {deck.slides.map((s, i) => (
        <div key={i} className="sl-item">
          <span className="sl-no">{i === 0 ? '表紙' : i}</span>
          <span className="sl-title">{s.heading || s.quote || s.subtitle || `(${s.type})`}</span>
        </div>
      ))}
      <style jsx>{`
        .sl-prev { display:flex; flex-direction:column; gap:6px; }
        .sl-item { display:flex; align-items:center; gap:8px; background:var(--background); border:1px solid var(--border); border-radius:8px; padding:6px 10px; }
        .sl-no { flex-shrink:0; min-width:34px; text-align:center; font-size:0.7rem; font-weight:700; color:white; background:var(--primary); border-radius:10px; padding:2px 6px; }
        .sl-title { font-size:0.82rem; color:var(--foreground); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      `}</style>
    </div>
  );
}

function MemoPermissionModal({
  block,
  allNotes,
  onClose,
  onNoteCreated,
}: {
  block: InsertableBlock;
  allNotes: Note[];
  onClose: () => void;
  onNoteCreated?: (id: number) => void;
}) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'done'>('idle');
  const existingNote = block.memoId != null ? allNotes.find(n => n.id === block.memoId) : undefined;
  const confirmMsg = block.type === 'memo_create'
    ? `「${block.memoTitle || '新しいメモ'}」という新しいメモを作っていい？`
    : `「${existingNote?.title || `メモ ID:${block.memoId}`}」を書き換えていい？`;

  const handleOk = async () => {
    setStatus('loading');
    try {
      if (block.type === 'memo_create') {
        const id = await createNoteWithBlock(block, block.memoTitle || '新しいメモ');
        onNoteCreated?.(id as number);
      } else if (block.type === 'memo_overwrite' && block.memoId != null) {
        const html = `<p>${block.rawCode.split('\n').map(escHtmlAttr).join('</p><p>')}</p>`;
        await db.notes.update(block.memoId, { content: html, updatedAt: Date.now() });
      }
      setStatus('done');
      setTimeout(onClose, 600);
    } catch {
      setStatus('idle');
    }
  };

  return (
    <div className="memo-modal-overlay" onClick={onClose}>
      <div className="memo-modal" onClick={e => e.stopPropagation()}>
        <p className="memo-modal-q">{confirmMsg}</p>
        <div className="memo-modal-actions">
          <button className="memo-btn cancel" onClick={onClose} disabled={status === 'loading'}>キャンセル</button>
          <button className="memo-btn ok" onClick={handleOk} disabled={status !== 'idle'}>
            {status === 'loading' ? '保存中...' : status === 'done' ? '✓ 完了' : 'OK'}
          </button>
        </div>
      </div>
      <style jsx>{`
        .memo-modal-overlay { position: fixed; inset: 0; z-index: 300; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; padding: 16px; }
        .memo-modal { background: var(--background); border-radius: 16px; padding: 24px 20px; max-width: 340px; width: 100%; box-shadow: 0 8px 40px rgba(0,0,0,0.2); }
        .memo-modal-q { font-size: 1rem; font-weight: 700; color: var(--foreground); margin: 0 0 20px; line-height: 1.5; }
        .memo-modal-actions { display: flex; gap: 10px; justify-content: flex-end; }
        .memo-btn { border: none; border-radius: 10px; padding: 9px 20px; font-size: 0.9rem; font-weight: 700; cursor: pointer; }
        .memo-btn.cancel { background: var(--accent); color: var(--fg-muted); }
        .memo-btn.ok { background: var(--primary); color: white; }
        .memo-btn:disabled { opacity: 0.6; cursor: default; }
      `}</style>
    </div>
  );
}

function ZipDownloadButton({ blocks }: { blocks: InsertableBlock[] }) {
  const [status, setStatus] = useState<'idle' | 'loading'>('idle');
  const handleZip = async () => {
    if (status === 'loading') return;
    setStatus('loading');
    try {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      for (const b of blocks) {
        if (b.fileName && b.rawCode != null) {
          zip.file(b.fileName, b.rawCode);
        }
      }
      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'project.zip';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('ZIP error', e);
    } finally {
      setStatus('idle');
    }
  };
  return (
    <button className="zip-download-btn" onClick={handleZip} disabled={status === 'loading'}>
      <span>📦</span>
      {status === 'loading' ? 'ZIPを作成中...' : `${blocks.length}ファイルをまとめてZIPダウンロード`}
      <style jsx>{`
        .zip-download-btn { display: flex; align-items: center; gap: 8px; width: 100%; padding: 10px 16px; background: linear-gradient(135deg, color-mix(in srgb, var(--primary) 15%, transparent), color-mix(in srgb, var(--primary) 8%, transparent)); border: 1.5px dashed var(--primary); border-radius: 10px; color: var(--primary); font-size: 0.85rem; font-weight: 700; cursor: pointer; transition: all 0.15s; margin-top: 4px; }
        .zip-download-btn:hover:not(:disabled) { background: var(--primary); color: white; }
        .zip-download-btn:disabled { opacity: 0.6; cursor: default; }
      `}</style>
    </button>
  );
}

function FolderActionCard({ block, allNotes }: { block: InsertableBlock; allNotes: Note[] }) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const allFolders = useLiveQuery(() => db.folders.filter(f => !f.deletedAt).toArray(), []);

  const noteTitle = block.memoId != null
    ? (allNotes.find(n => n.id === block.memoId)?.title || `ID:${block.memoId}`)
    : '不明';

  const handleExecute = async () => {
    if (status !== 'idle') return;
    setStatus('loading');
    try {
      if (block.type === 'folder_create') {
        const existing = allFolders?.find(f => f.name === block.folderName);
        if (!existing) {
          await db.folders.add({
            syncId: newSyncId(),
            name: block.folderName!,
            color: block.folderColor || '--folder-pink',
            createdAt: Date.now(),
            updatedAt: Date.now(),
          });
        }
        setStatus('done');
      } else if (block.type === 'note_move' && block.memoId != null) {
        let folder = allFolders?.find(f => f.name === block.targetFolderName);
        if (!folder) {
          const newId = await db.folders.add({
            syncId: newSyncId(),
            name: block.targetFolderName!,
            color: '--folder-pink',
            createdAt: Date.now(),
            updatedAt: Date.now(),
          });
          folder = { id: newId as number, name: block.targetFolderName!, syncId: '', createdAt: 0, updatedAt: 0 };
        }
        await db.notes.update(block.memoId, { folderId: folder.id, updatedAt: Date.now() });
        setStatus('done');
      }
    } catch {
      setStatus('error');
    }
  };

  const icon = block.type === 'folder_create' ? '📁' : '📄';
  const label = block.type === 'folder_create'
    ? `フォルダ「${block.folderName}」を作成`
    : `「${noteTitle}」→ 📁 ${block.targetFolderName}`;
  const btnLabel = block.type === 'folder_create' ? 'フォルダを作成する' : 'メモを移動する';

  return (
    <div className="folder-action-card">
      <div className="folder-action-label">{icon} {label}</div>
      <button
        className={`folder-action-btn ${status}`}
        onClick={handleExecute}
        disabled={status !== 'idle'}
      >
        {status === 'loading' ? '実行中...' : status === 'done' ? '✓ 完了' : status === 'error' ? '✕ 失敗' : btnLabel}
      </button>
      <style jsx>{`
        .folder-action-card { background: var(--background); border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px; margin-top: 8px; display: flex; align-items: center; gap: 10px; }
        .folder-action-label { flex: 1; font-size: 0.83rem; color: var(--foreground); font-weight: 600; word-break: break-word; }
        .folder-action-btn { flex-shrink: 0; background: var(--primary); color: white; border: none; border-radius: 8px; padding: 6px 14px; font-size: 0.8rem; font-weight: 700; cursor: pointer; white-space: nowrap; transition: all 0.2s; }
        .folder-action-btn.done { background: #22863a; }
        .folder-action-btn.error { background: #cc0000; }
        .folder-action-btn:disabled { opacity: 0.6; cursor: default; }
      `}</style>
    </div>
  );
}

function InsertableBlockCard({
  block,
  allNotes,
  defaultNoteId,
  isPremium,
  onNoteCreated,
}: {
  block: InsertableBlock;
  allNotes: Note[];
  defaultNoteId?: number;
  isPremium?: boolean;
  onNoteCreated?: (id: number) => void;
}) {
  const NEW_NOTE = '__new__';
  const [target, setTarget] = useState<string>(
    defaultNoteId != null ? String(defaultNoteId) : (allNotes[0]?.id != null ? String(allNotes[0].id) : NEW_NOTE)
  );
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [pdfStatus, setPdfStatus] = useState<'idle' | 'loading'>('idle');
  const [showMemoModal, setShowMemoModal] = useState(false);

  const baseName = `lily-${block.type}-${block.id.slice(0, 6)}`;
  const typeEmoji = block.type === 'mermaid' ? '🌊'
    : block.type === 'chart' ? '📊'
    : block.type === 'slides' ? '🖼️'
    : block.type === 'geometry' ? '📐'
    : block.type === 'file' ? '📄'
    : block.type === 'memo_create' ? '✏️'
    : block.type === 'memo_overwrite' ? '📝' : '📚';

  const handleInsert = async () => {
    if (status === 'loading') return;
    setStatus('loading');
    setErrorMsg('');
    try {
      if (target === NEW_NOTE) {
        await createNoteWithBlock(block, `Lily: ${block.previewLabel}`);
      } else {
        await insertBlockIntoNote(block, Number(target));
      }
      setStatus('success');
      setTimeout(() => setStatus('idle'), 2500);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : '挿入に失敗しちゃった');
      setStatus('error');
      setTimeout(() => setStatus('idle'), 3000);
    }
  };

  const handlePptx = async () => {
    if (pdfStatus === 'loading') return;
    setPdfStatus('loading');
    try {
      const deck = parseSlides(block.rawCode);
      await exportSlidesToPptx(deck, isPremium ? 'premium' : 'standard');
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'PowerPointの作成に失敗しちゃった');
    } finally {
      setPdfStatus('idle');
    }
  };

  return (
    <div className="insertable-block">
      <div className="block-header">
        <span className="block-type-badge">{typeEmoji} {block.previewLabel}</span>
      </div>

      <div className="block-visual">
        {block.type === 'mermaid' && <MermaidPreview code={block.rawCode} baseName={baseName} />}
        {block.type === 'chart' && <ChartPreview code={block.rawCode} baseName={baseName} />}
        {block.type === 'qa' && <QAPreview code={block.rawCode} />}
        {block.type === 'slides' && <SlidesPreview code={block.rawCode} />}
        {block.type === 'geometry' && <GeometryPreview code={block.rawCode} baseName={baseName} />}
        {block.type === 'file' && <FilePreview block={block} />}
        {(block.type === 'memo_create' || block.type === 'memo_overwrite') && (
          <pre className="memo-block-preview">{block.rawCode.slice(0, 200)}{block.rawCode.length > 200 ? '\n…' : ''}</pre>
        )}
      </div>

      {block.type === 'slides' && (
        <button className="pdf-btn" onClick={handlePptx} disabled={pdfStatus === 'loading'}>
          <FileDown size={14} />
          {pdfStatus === 'loading' ? 'PowerPoint作成中...' : 'PowerPoint(.pptx)で保存'}
        </button>
      )}

      {(block.type === 'memo_create' || block.type === 'memo_overwrite') ? (
        <>
          <button className="memo-confirm-btn" onClick={() => setShowMemoModal(true)}>
            {block.type === 'memo_create' ? '✏️ このメモを作成する' : '📝 上書きを確認する'}
          </button>
          {showMemoModal && (
            <MemoPermissionModal
              block={block}
              allNotes={allNotes}
              onClose={() => setShowMemoModal(false)}
              onNoteCreated={onNoteCreated}
            />
          )}
        </>
      ) : (
        <>
        <div className="block-insert-row">
          <select className="note-select" value={target} onChange={e => setTarget(e.target.value)}>
            <option value={NEW_NOTE}>✏️ 新規メモを作成</option>
            {allNotes.map(n => (
              <option key={n.id} value={String(n.id)}>{n.title || '無題のメモ'}</option>
            ))}
          </select>
          <button
            className={`insert-btn ${status}`}
            onClick={handleInsert}
            disabled={status === 'loading' || status === 'success'}
          >
            {status === 'loading' ? '...追加中' : status === 'success' ? '✓ 追加完了！' : status === 'error' ? '✕ 失敗' : 'メモに追加'}
          </button>
        </div>
        {errorMsg && <p className="block-error">{errorMsg}</p>}
        </>
      )}

      <style jsx>{`
        .insertable-block { background: var(--background); border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px; margin-top: 8px; }
        .block-header { margin-bottom: 8px; }
        .block-type-badge { background: color-mix(in srgb, var(--primary) 15%, transparent); color: var(--primary); border-radius: 20px; padding: 3px 10px; font-size: 0.78rem; font-weight: 700; }
        .block-visual { margin-bottom: 10px; }
        .block-visual :global(.prev-err) { font-size: 0.78rem; color: var(--fg-muted); background: var(--accent); border-radius: 8px; padding: 12px; text-align: center; }
        .pdf-btn { display:flex; align-items:center; justify-content:center; gap:6px; width:100%; background:var(--primary); color:white; border:none; border-radius:8px; padding:8px; font-size:0.82rem; font-weight:700; cursor:pointer; margin-bottom:8px; }
        .pdf-btn:disabled { opacity:0.6; cursor:default; }
        .memo-block-preview { font-size: 0.75rem; color: var(--fg-muted); background: var(--accent); border-radius: 8px; padding: 10px; margin: 0 0 8px; white-space: pre-wrap; word-break: break-word; max-height: 120px; overflow: auto; }
        .memo-confirm-btn { display: flex; align-items: center; justify-content: center; width: 100%; background: var(--primary); color: white; border: none; border-radius: 8px; padding: 9px; font-size: 0.84rem; font-weight: 700; cursor: pointer; margin-top: 4px; }
        .block-insert-row { display: flex; gap: 8px; align-items: center; }
        .note-select { flex: 1; min-width: 0; background: var(--accent); border: 1px solid var(--border); border-radius: 8px; padding: 5px 8px; font-size: 0.8rem; color: var(--foreground); outline: none; }
        .insert-btn { flex-shrink: 0; background: var(--primary); color: white; border: none; border-radius: 8px; padding: 6px 14px; font-size: 0.8rem; font-weight: 700; cursor: pointer; transition: all 0.2s; white-space: nowrap; }
        .insert-btn.success { background: #22863a; }
        .insert-btn.error { background: #cc0000; }
        .insert-btn:disabled { opacity: 0.6; cursor: default; }
        .block-error { font-size: 0.75rem; color: #cc0000; margin-top: 4px; }
      `}</style>
    </div>
  );
}

function ClarifyBottomSheet({
  question,
  progress,
  onAnswer,
  onDismiss,
  disabled,
}: {
  question: ClarifyQuestion;
  progress: { current: number; total: number };
  onAnswer: (text: string) => void;
  onDismiss: () => void;
  disabled: boolean;
}) {
  const [freeText, setFreeText] = useState('');

  const handleOption = (opt: string) => {
    if (disabled) return;
    onAnswer(opt);
  };

  const handleFreeSubmit = () => {
    const t = freeText.trim();
    if (!t || disabled) return;
    onAnswer(t);
    setFreeText('');
  };

  return (
    <div className="clarify-overlay" onClick={onDismiss}>
      <div className="clarify-sheet" onClick={e => e.stopPropagation()}>
        <div className="clarify-header">
          <div className="clarify-q-wrap">
            {progress.total > 1 && (
              <span className="clarify-progress">質問 {progress.current} / {progress.total}</span>
            )}
            <span className="clarify-question">{question.question}</span>
          </div>
          <button className="clarify-close" onClick={onDismiss} title="閉じる">
            <X size={16} />
          </button>
        </div>
        {question.options.length > 0 && (
          <div className="clarify-options">
            {question.options.map((opt, i) => (
              <button
                key={i}
                className="clarify-opt-row"
                onClick={() => handleOption(opt)}
                disabled={disabled}
              >
                <span className="clarify-opt-num">{i + 1}</span>
                <span className="clarify-opt-label">{opt}</span>
              </button>
            ))}
          </div>
        )}
        <div className="clarify-footer">
          <Pencil size={15} className="clarify-pencil" />
          <input
            className="clarify-input"
            placeholder="回答を入力..."
            value={freeText}
            onChange={e => setFreeText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleFreeSubmit(); }}
            disabled={disabled}
          />
          {freeText.trim() && (
            <button className="clarify-send" onClick={handleFreeSubmit} disabled={disabled}>
              <Send size={15} />
            </button>
          )}
        </div>
      </div>
      <style jsx>{`
        .clarify-overlay {
          position: fixed; inset: 0; z-index: 200;
          background: rgba(0,0,0,0.45);
          display: flex; align-items: flex-end;
          animation: clarify-fade 0.18s ease;
        }
        @keyframes clarify-fade { from { opacity: 0; } to { opacity: 1; } }
        .clarify-sheet {
          width: 100%; max-width: 640px; margin: 0 auto;
          background: var(--background);
          border-radius: 20px 20px 0 0;
          box-shadow: 0 -6px 40px rgba(0,0,0,0.18);
          animation: clarify-up 0.22s cubic-bezier(0.32,0.72,0,1);
          overflow: hidden;
          padding-bottom: env(safe-area-inset-bottom);
        }
        @keyframes clarify-up { from { transform: translateY(100%); } to { transform: translateY(0); } }
        .clarify-header {
          display: flex; align-items: flex-start; justify-content: space-between;
          gap: 12px; padding: 18px 16px 14px;
          border-bottom: 1px solid var(--border);
        }
        .clarify-q-wrap {
          flex: 1; display: flex; flex-direction: column; gap: 5px;
        }
        .clarify-progress {
          font-size: 0.72rem; font-weight: 700; color: var(--primary);
          letter-spacing: 0.4px;
        }
        .clarify-question {
          font-size: 0.95rem; font-weight: 700;
          color: var(--foreground); line-height: 1.45;
        }
        .clarify-close {
          flex-shrink: 0; background: var(--accent); border: none; border-radius: 50%;
          width: 28px; height: 28px; display: flex; align-items: center; justify-content: center;
          cursor: pointer; color: var(--fg-muted); transition: background 0.15s;
        }
        .clarify-close:hover { background: var(--border); }
        .clarify-options { display: flex; flex-direction: column; max-height: 55vh; overflow-y: auto; }
        .clarify-opt-row {
          display: flex; align-items: center; gap: 14px;
          padding: 14px 16px; background: transparent; border: none;
          border-bottom: 1px solid var(--border); cursor: pointer;
          text-align: left; transition: background 0.1s; width: 100%;
        }
        .clarify-opt-row:last-child { border-bottom: none; }
        .clarify-opt-row:hover:not(:disabled) { background: var(--accent); }
        .clarify-opt-row:disabled { cursor: default; opacity: 0.5; }
        .clarify-opt-num {
          flex-shrink: 0; width: 28px; height: 28px;
          background: color-mix(in srgb, var(--primary) 12%, transparent);
          color: var(--primary); border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          font-size: 0.8rem; font-weight: 700;
        }
        .clarify-opt-label { font-size: 0.9rem; color: var(--foreground); line-height: 1.4; }
        .clarify-footer {
          display: flex; align-items: center; gap: 10px;
          padding: 12px 16px;
          border-top: 1px solid var(--border);
          background: var(--accent);
        }
        .clarify-footer :global(.clarify-pencil) { color: var(--fg-muted); flex-shrink: 0; }
        .clarify-input {
          flex: 1; background: transparent; border: none; outline: none;
          font-size: 0.9rem; color: var(--foreground); font-family: inherit;
        }
        .clarify-input::placeholder { color: var(--fg-muted); }
        .clarify-send {
          flex-shrink: 0; background: var(--primary); color: white; border: none;
          border-radius: 8px; padding: 6px 8px; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
        }
        .clarify-send:disabled { opacity: 0.5; cursor: default; }
      `}</style>
    </div>
  );
}

function CopyButton({ text, light }: { text: string; light?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  return (
    <>
      <button className={`copy-btn${light ? ' copy-btn-light' : ''}`} onClick={copy} title="コピー">
        {copied ? '✓' : '⎘'}
      </button>
      <style jsx>{`
        .copy-btn { opacity: 0.75; transition: opacity 0.15s, background 0.15s, color 0.15s; background: var(--background); border: 1px solid var(--primary); border-radius: 6px; padding: 3px 8px; font-size: 0.78rem; cursor: pointer; color: var(--primary); flex-shrink: 0; box-shadow: 0 1px 3px rgba(0,0,0,0.12); }
        .copy-btn-light { background: #fff; border-color: #fff; color: var(--primary); }
        .copy-btn:hover { opacity: 1 !important; background: var(--primary); color: #fff; }
        .copy-btn-light:hover { background: #fff; color: var(--primary); }
      `}</style>
    </>
  );
}

function LilyBubble({
  message, allNotes, selectedNoteId, model, onNoteCreated,
}: {
  message: ChatMessage;
  allNotes: Note[];
  selectedNoteId?: number;
  model?: 'lily' | 'sikunlily';
  onNoteCreated?: (id: number) => void;
}) {
  const avatarSrc = model === 'sikunlily' ? '/sikunlily-character.png' : '/lily-character.png';
  const avatarAlt = model === 'sikunlily' ? 'sikunlily' : 'Lily';
  const [thinkingOpen, setThinkingOpen] = useState(false);
  return (
    <div className="lily-bubble-row">
      <div className="lily-avatar">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={avatarSrc} alt={avatarAlt} className="avatar-img" />
      </div>
      <div className="lily-bubble-wrap">
        <div className="lily-bubble-header">
          <div
            className="lily-bubble rt-body"
            dangerouslySetInnerHTML={{ __html: renderRich(message.text) }}
          />
          <CopyButton text={message.text} />
        </div>
        {message.questions && message.questions.length > 0 && (
          <div className="ask-asked-hint">❓ {message.questions.length}件の質問をしたよ</div>
        )}
        {message.thinking && (
          <div className="thinking-toggle-wrap">
            <button
              className="thinking-toggle-btn"
              onClick={() => setThinkingOpen(o => !o)}
            >
              🧠 思考の過程 {thinkingOpen ? '▲' : '▼'}
            </button>
            {thinkingOpen && (
              <div className="thinking-content">{message.thinking}</div>
            )}
          </div>
        )}
        {message.extractedBlocks && message.extractedBlocks.length > 0 && (
          <div className="block-list">
            {message.extractedBlocks.map(block =>
              block.type === 'folder_create' || block.type === 'note_move' ? (
                <FolderActionCard key={block.id} block={block} allNotes={allNotes} />
              ) : (
                <InsertableBlockCard
                  key={block.id}
                  block={block}
                  allNotes={allNotes}
                  defaultNoteId={selectedNoteId}
                  isPremium={model === 'sikunlily'}
                  onNoteCreated={onNoteCreated}
                />
              )
            )}
            {message.extractedBlocks.filter(b => b.type === 'file').length >= 2 && (
              <ZipDownloadButton blocks={message.extractedBlocks.filter(b => b.type === 'file')} />
            )}
          </div>
        )}
      </div>
      <style jsx>{`
        .lily-bubble-row { display: flex; align-items: flex-start; gap: 10px; align-self: flex-start; max-width: 85%; }
        .lily-avatar { flex-shrink: 0; width: 36px; height: 36px; border-radius: 50%; overflow: hidden; background: var(--accent); border: 2px solid var(--border); }
        .avatar-img { width: 100%; height: 100%; object-fit: cover; object-position: top center; }
        .lily-bubble-wrap { flex: 1; min-width: 0; }
        .lily-bubble-header { display: flex; align-items: flex-start; gap: 6px; }
        .lily-bubble-header:hover :global(.copy-btn) { opacity: 1; }
        .lily-bubble { flex: 1; min-width: 0; background: var(--accent); border: 1px solid var(--border); border-radius: 4px 16px 16px 16px; padding: 10px 14px; font-size: 0.9rem; line-height: 1.65; color: var(--foreground); word-break: break-word; }
        .rt-body :global(p) { margin: 0 0 0.6em; }
        .rt-body :global(p:last-child) { margin-bottom: 0; }
        .rt-body :global(h1) { font-size: 1.15rem; font-weight: 800; margin: 0.9em 0 0.35em; color: var(--primary); border-bottom: 2px solid var(--primary); padding-bottom: 2px; }
        .rt-body :global(h2) { font-size: 1.05rem; font-weight: 700; margin: 0.75em 0 0.3em; color: var(--primary); }
        .rt-body :global(h3) { font-size: 0.95rem; font-weight: 700; margin: 0.6em 0 0.25em; color: var(--primary); opacity: 0.85; }
        .rt-body :global(ul) { margin: 0.35em 0; padding-left: 0; list-style: none; }
        .rt-body :global(ul li) { margin: 0.25em 0; padding-left: 1.3em; position: relative; }
        .rt-body :global(ul li::before) { content: "•"; position: absolute; left: 0.3em; color: var(--primary); font-weight: 700; }
        .rt-body :global(ol) { margin: 0.35em 0; padding-left: 1.5em; }
        .rt-body :global(ol li) { margin: 0.25em 0; }
        .rt-body :global(li) { line-height: 1.6; }
        .rt-body :global(strong) { font-weight: 800; color: var(--foreground); }
        .rt-body :global(em) { font-style: italic; opacity: 0.9; }
        .rt-body :global(a) { color: var(--primary); text-decoration: underline; text-underline-offset: 2px; }
        .rt-body :global(blockquote) { border-left: 3px solid var(--primary); margin: 0.6em 0; padding: 0.3em 0.8em; background: rgba(var(--primary-rgb, 236,72,153),0.06); border-radius: 0 6px 6px 0; color: var(--foreground); opacity: 0.9; font-style: italic; }
        .rt-body :global(hr) { border: none; border-top: 1px solid var(--border); margin: 0.8em 0; }
        .rt-body :global(table) { border-collapse: collapse; margin: 0.6em 0; font-size: 0.85rem; width: 100%; }
        .rt-body :global(thead tr) { background: var(--primary); color: white; }
        .rt-body :global(th) { border: 1px solid var(--primary); padding: 5px 10px; font-weight: 700; text-align: left; }
        .rt-body :global(td) { border: 1px solid var(--border); padding: 4px 10px; }
        .rt-body :global(tbody tr:nth-child(even)) { background: rgba(0,0,0,0.03); }
        .rt-body :global(.rt-code) { background: rgba(0,0,0,0.07); border: 1px solid var(--border); border-radius: 4px; padding: 1px 6px; font-size: 0.83em; font-family: 'Fira Code','Consolas',monospace; color: var(--primary); }
        .rt-body :global(.rt-pre) { background: #1a1a2e; border: none; border-radius: 10px; padding: 12px 14px; overflow-x: auto; margin: 0.6em 0; }
        .rt-body :global(.rt-pre code) { font-size: 0.8rem; font-family: 'Fira Code','Consolas',monospace; white-space: pre; color: #e2e8f0; }
        .rt-body :global(.katex) { font-size: 1.05em; }
        .rt-body :global(.katex-display) { margin: 0.6em 0; overflow-x: auto; overflow-y: hidden; background: rgba(var(--primary-rgb,236,72,153),0.04); border-radius: 6px; padding: 6px 10px; }
        .block-list { margin-top: 4px; }
        .ask-asked-hint { margin-top: 6px; font-size: 0.78rem; color: var(--fg-muted); display: flex; align-items: center; gap: 4px; }
        .thinking-toggle-wrap { margin-top: 6px; }
        .thinking-toggle-btn {
          display: flex; align-items: center; gap: 5px;
          padding: 4px 10px; border-radius: 8px; font-size: 0.75rem; font-weight: 600;
          background: transparent; color: #888; border: 1px solid var(--border);
          cursor: pointer; transition: background 0.15s, color 0.15s;
        }
        .thinking-toggle-btn:hover { background: var(--accent); color: var(--foreground); }
        .thinking-content {
          margin-top: 6px; padding: 10px 12px;
          background: #0f172a; color: #94a3b8;
          border-radius: 8px; font-size: 0.72rem; line-height: 1.6;
          max-height: 260px; overflow-y: auto;
          font-family: 'Fira Code','Consolas',monospace;
          white-space: pre-wrap; word-break: break-word;
        }
      `}</style>
    </div>
  );
}

function UserBubble({ message }: { message: ChatMessage }) {
  const atts = message.attachments ?? [];
  return (
    <div className="user-bubble-row">
      <CopyButton text={message.text} light />
      <div className="user-bubble">
        {atts.length > 0 && (
          <div className="att-preview">
            {atts.map((att, i) =>
              att.isImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={i} src={`data:${att.mimeType};base64,${att.data}`} alt={att.name} className="att-img" />
              ) : (
                <span key={i} className="att-file">📎 {att.name}</span>
              )
            )}
          </div>
        )}
        {message.text.split('\n').map((line, i, arr) => (
          <span key={i}>{line}{i < arr.length - 1 && <br />}</span>
        ))}
      </div>
      <style jsx>{`
        .user-bubble-row { display: flex; justify-content: flex-end; align-items: flex-start; gap: 6px; align-self: flex-end; max-width: 80%; }
        .user-bubble-row:hover :global(.copy-btn) { opacity: 1; }
        .user-bubble { background: var(--primary); color: white; border-radius: 16px 4px 16px 16px; padding: 10px 14px; font-size: 0.9rem; line-height: 1.65; word-break: break-word; }
        .att-preview { margin-bottom: 6px; display: flex; flex-wrap: wrap; gap: 6px; }
        .att-img { max-width: 140px; max-height: 140px; border-radius: 10px; display: block; }
        .att-file { display: inline-block; background: rgba(255,255,255,0.25); border-radius: 8px; padding: 4px 10px; font-size: 0.82rem; }
      `}</style>
    </div>
  );
}

function TypingIndicator({ model }: { model?: 'lily' | 'sikunlily' }) {
  const avatarSrc = model === 'sikunlily' ? '/sikunlily-character.png' : '/lily-character.png';
  const avatarAlt = model === 'sikunlily' ? 'sikunlily' : 'Lily';
  return (
    <div className="typing-row">
      <div className="typing-avatar">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={avatarSrc} alt={avatarAlt} className="avatar-img" />
      </div>
      <div className="typing-bubble">
        <span className="dot" /><span className="dot" /><span className="dot" />
      </div>
      <style jsx>{`
        .typing-row { display: flex; align-items: flex-start; gap: 10px; align-self: flex-start; }
        .typing-avatar { flex-shrink: 0; width: 36px; height: 36px; border-radius: 50%; overflow: hidden; background: var(--accent); border: 2px solid var(--border); }
        .avatar-img { width: 100%; height: 100%; object-fit: cover; object-position: top center; }
        .typing-bubble { background: var(--accent); border: 1px solid var(--border); border-radius: 4px 16px 16px 16px; padding: 12px 16px; display: flex; gap: 5px; align-items: center; }
        .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--primary); animation: bounce 1.2s infinite ease-in-out; }
        .dot:nth-child(2) { animation-delay: 0.2s; }
        .dot:nth-child(3) { animation-delay: 0.4s; }
        @keyframes bounce { 0%, 80%, 100% { transform: translateY(0); opacity: 0.4; } 40% { transform: translateY(-6px); opacity: 1; } }
      `}</style>
    </div>
  );
}

// Examples written so first-time / non-technical users instantly see
// the breadth of what Lily can do.
const SUGGESTIONS = [
  '今日の予定を整理して',
  'このメモをわかりやすく要約して',
  '丁寧なメールの文面を作って',
  '英語に翻訳して',
  '暗記用の問題を作って',
  '会議の議事録をまとめて',
  '旅行の持ち物リストを作って',
  '考えを図（マインドマップ）にして',
  'この数式をグラフで解説して',
];

const SIKUNLILY_SUGGESTIONS = [
  '複数ファイルのコードプロジェクトを作って',
  'このドキュメントを分析してまとめて',
  'このデータのパターンと異常を検出して',
  '情報源を比較して信頼性を評価して',
];

// Tone/style modes: tapping toggles the mode ON; while ON, every message
// you send is answered in that style (until you tap it off).
const MODES: { id: string; label: string; directive: string }[] = [
  { id: 'formal', label: '🎚️ フォーマル', directive: 'フォーマルで丁寧なトーンで答えて。' },
  { id: 'casual', label: '😊 カジュアル', directive: '親しみやすいカジュアルなトーンで答えて。' },
  { id: 'concise', label: '⚡ 簡潔に', directive: '要点だけを簡潔に短く答えて。' },
  { id: 'detailed', label: '📚 くわしく', directive: '背景や具体例も交えて、くわしく丁寧に説明して。' },
  { id: 'easy', label: '🍼 やさしく', directive: '専門用語を避けて、初心者にもわかるやさしい言葉で説明して。' },
];

// One-tap actions: sending a prompt immediately.
const QUICK_ACTIONS: { label: string; prompt: string }[] = [
  { label: '📧 メール文面', prompt: 'このメモの内容を元に、そのまま送れる丁寧なメールの下書きを作って。件名も付けてね。' },
  { label: '📝 ブログ案', prompt: 'このメモを元に、ブログ記事のタイトル案を3つと、それぞれの構成案を提案して。' },
  { label: '🔎 詳しく調べて', prompt: 'このメモに出てくる専門用語や関連トピックを、ネットの情報も使ってもう少し詳しく補足して。' },
];

export default function AIChat({ onOpenSettings, onSwitchTab, onNoteCreated }: AIChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [selectedNoteId, setSelectedNoteId] = useState<number | undefined>();
  const [showContextPanel, setShowContextPanel] = useState(false);
  const [apiKey, setApiKey] = useState<string>('');
  const [attachments, setAttachments] = useState<AttachmentMeta[]>([]);
  const [fileError, setFileError] = useState('');
  const [webSearch, setWebSearch] = useState(false);
  const [activeMode, setActiveMode] = useState<string | null>(null);
  const [questionQueue, setQuestionQueue] = useState<ClarifyQuestion[]>([]);
  const [collectedAnswers, setCollectedAnswers] = useState<{ q: string; a: string }[]>([]);
  const [activeModel, setActiveModel] = useState<'lily' | 'sikunlily'>('lily');
  const [sikunProgress, setSikunProgress] = useState<string>('');
  const [sikunLiveThinking, setSikunLiveThinking] = useState<string>('');
  const [expandedThinking, setExpandedThinking] = useState<Set<string>>(new Set());
  const pendingThinkingRef = useRef<string>('');
  const [sikunNoteIds, setSikunNoteIds] = useState<number[]>([]);
  const [sikunAllNotes, setSikunAllNotes] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [helpInitialTab, setHelpInitialTab] = useState<'lily' | 'sikunlily' | 'tips'>('lily');
  const [deepResearch, setDeepResearch] = useState(false);
  const [multiAgent, setMultiAgent] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const allNotes = useLiveQuery(
    () => db.notes.filter(n => !n.deletedAt && n.type !== 'handwriting').toArray(),
    []
  );
  const allFolders = useLiveQuery(
    () => db.folders.filter(f => !f.deletedAt).toArray(),
    []
  );

  useEffect(() => {
    setApiKey(localStorage.getItem('lily_gemini_api_key') || '');
  }, []);

  useEffect(() => {
    const last = messages[messages.length - 1];
    if (last?.role === 'lily' && last.questions && last.questions.length > 0) {
      setQuestionQueue(last.questions);
      setCollectedAnswers([]);
    }
  }, [messages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const autoResizeTextarea = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
  };

  const renderPdfAsImages = async (
    base64Data: string,
  ): Promise<{ images: Array<{ data: string }>; totalPages: number }> => {
    const pdfjs = await import('pdfjs-dist');
    pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
    const binaryStr = atob(base64Data);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
    const doc = await pdfjs.getDocument({ data: bytes }).promise;
    const totalPages = doc.numPages;
    const MAX_PAGES = 20;
    const images: Array<{ data: string }> = [];
    for (let p = 1; p <= Math.min(totalPages, MAX_PAGES); p++) {
      const page = await doc.getPage(p);
      const viewport = page.getViewport({ scale: 1.5 });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d')!;
      await page.render({ canvasContext: ctx, viewport }).promise;
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      images.push({ data: dataUrl.split(',')[1] });
    }
    return { images, totalPages };
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length === 0) return;
    setFileError('');

    const room = MAX_FILES - attachments.length;
    if (room <= 0) {
      setFileError(`ファイルは合計${MAX_FILES}個までだよ`);
      return;
    }
    if (files.length > room) {
      setFileError(`ファイルは合計${MAX_FILES}個までだよ（先頭${room}件だけ追加するね）`);
    }

    files.slice(0, room).forEach(file => {
      if (file.size > MAX_FILE_BYTES) {
        setFileError(`「${file.name}」が大きすぎるよ（1ファイル12MBまで）`);
        return;
      }
      const reader = new FileReader();
      reader.onload = async () => {
        const result = reader.result as string;
        const base64 = result.split(',')[1] ?? '';
        const id = crypto.randomUUID();
        const isPdf = file.type === 'application/pdf';
        // Large images (>2 MB) use File API; PDFs use pdf.js text extraction.
        const useLargeImageUpload = !isPdf && file.size > 2 * 1024 * 1024;
        const meta: AttachmentMeta = {
          id,
          name: file.name,
          mimeType: file.type || 'application/octet-stream',
          data: base64,
          isImage: file.type.startsWith('image/'),
          uploading: isPdf || (useLargeImageUpload && !!apiKey),
        };
        setAttachments(prev => prev.length >= MAX_FILES ? prev : [...prev, meta]);
        if (isPdf) {
          try {
            const { images: pdfPageImages, totalPages: pdfTotalPages } = await renderPdfAsImages(base64);
            setAttachments(prev =>
              prev.map(a => a.id === id ? { ...a, pdfPageImages, pdfTotalPages, uploading: false } : a)
            );
          } catch (err) {
            setAttachments(prev => prev.filter(a => a.id !== id));
            setFileError(`「${file.name}」のPDF読み込みに失敗したよ: ${err instanceof Error ? err.message : 'unknown error'}`);
          }
        } else if (useLargeImageUpload && apiKey) {
          try {
            const fileUri = await uploadToFileApi(base64, file.type, file.name, apiKey);
            setAttachments(prev =>
              prev.map(a => a.id === id ? { ...a, fileUri, uploading: false } : a)
            );
          } catch (err) {
            setAttachments(prev => prev.filter(a => a.id !== id));
            setFileError(`「${file.name}」のアップロードに失敗したよ: ${err instanceof Error ? err.message : 'unknown error'}`);
          }
        }
      };
      reader.onerror = () => setFileError(`「${file.name}」の読み込みに失敗したよ`);
      reader.readAsDataURL(file);
    });
  };

  const removeAttachment = (idx: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== idx));
  };

  const sendMessage = useCallback(async (text?: string) => {
    const userText = (text ?? input).trim();
    const sentAtts = attachments;
    if ((!userText && sentAtts.length === 0) || isLoading || !apiKey) return;

    setInput('');
    setAttachments([]);
    setFileError('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    setIsLoading(true);

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      text: userText || (sentAtts.length > 0 ? `(${sentAtts.length}件のファイルを送信)` : ''),
      timestamp: Date.now(),
      attachments: sentAtts.length > 0 ? sentAtts : undefined,
    };
    setMessages(prev => [...prev, userMsg]);

    try {
      const contextNotes: Note[] = [];
      if (activeModel === 'sikunlily') {
        if (sikunAllNotes) {
          contextNotes.push(...(allNotes ?? []));
        } else {
          for (const id of sikunNoteIds) {
            const n = await db.notes.get(id);
            if (n) contextNotes.push(n);
          }
        }
      } else if (selectedNoteId) {
        const n = await db.notes.get(selectedNoteId);
        if (n) contextNotes.push(n);
      }
      const systemPrompt = buildSystemPrompt(contextNotes);

      const allMsgs = [...messages, userMsg];
      // Keep last 10 messages to limit token usage per request.
      const recentMsgs = allMsgs.slice(-10);
      // Only include attachments on the last user message — older attachments
      // have already been processed by the model, so re-sending their base64
      // data on every turn wastes significant quota.
      const lastUserIdx = recentMsgs.reduce(
        (acc, m, idx) => (m.role === 'user' && m.attachments?.length ? idx : acc),
        -1
      );
      const modeDirective = MODES.find(mo => mo.id === activeMode)?.directive;
      const lastIdx = recentMsgs.length - 1;
      const history: ChatTurn[] = recentMsgs.map((m, idx) => {
        const turn: ChatTurn = {
          role: m.role === 'user' ? 'user' : 'model',
          text:
            idx === lastIdx && m.role === 'user' && modeDirective
              ? `${m.text}\n\n（${modeDirective}）`
              : m.text,
        };
        if (idx === lastUserIdx && m.attachments && m.attachments.length > 0) {
          turn.attachments = m.attachments.map<ChatAttachment>(a => ({
            mimeType: a.mimeType,
            data: a.fileUri || a.extractedText || a.pdfPageImages ? '' : a.data,
            fileUri: a.fileUri,
            extractedText: a.extractedText,
            pdfPageImages: a.pdfPageImages,
            pdfTotalPages: a.pdfTotalPages,
          }));
        }
        return turn;
      });

      let aiText: string;
      if (deepResearch) {
        aiText = await callDeepResearch(
          history[history.length - 1]?.text ?? input,
          apiKey,
          (msg) => setSikunProgress(msg),
        );
        setSikunProgress('');
      } else if (activeModel === 'sikunlily') {
        const folders = allFolders ?? [];
        const sikunSystemPrompt = buildSikunSystemPrompt(contextNotes, folders, activeMode ?? undefined);
        setSikunLiveThinking('');
        let thinkingAccum = '';

        if (multiAgent) {
          // ── マルチエージェントパイプライン ──
          aiText = await runMultiAgentPipeline(
            history[history.length - 1]?.text ?? input,
            sikunSystemPrompt,
            apiKey,
            {
              onProgress: (msg) => setSikunProgress(msg ?? ''),
              onThinkingDelta: (delta) => {
                thinkingAccum += delta;
                setSikunLiveThinking(thinkingAccum);
              },
              onResponseDelta: () => {
                setSikunProgress('✍️ 回答を生成中...');
              },
            },
          );
        } else {
          // ── 通常の sikunlily ──
          const budget = activeMode
            ? (SIKU_THINKING_BUDGETS[activeMode] ?? 8192)
            : 8192;
          const modeLabels: Record<string, string> = {
            code: 'コードを設計中',
            arch: 'アーキテクチャを設計中',
            analysis: 'データを解析中',
            research: '調査・検証中',
            study: '学習支援中',
            organize: 'メモを分析中',
          };
          setSikunProgress(budget !== 0 ? '🧠 深く思考中...' : (modeLabels[activeMode ?? ''] ?? '考え中') + '...');
          aiText = await streamSikunlilyChat(
            history,
            sikunSystemPrompt,
            apiKey,
            budget,
            {
              onThinkingDelta: (delta) => {
                thinkingAccum += delta;
                setSikunLiveThinking(thinkingAccum);
                if (budget !== 0) setSikunProgress('🧠 思考中...');
              },
              onResponseDelta: () => {
                setSikunProgress('✍️ 回答を生成中...');
              },
            },
            ['gemini-2.5-flash', 'gemini-2.5-flash-lite'],
          );
        }
        setSikunProgress('');
        setSikunLiveThinking('');
        pendingThinkingRef.current = thinkingAccum;
      } else {
        aiText = await callGeminiChat(history, systemPrompt, apiKey, { webSearch });
      }
      const { textContent, blocks, questions } = parseAIResponse(aiText, true);
      const capturedThinking = pendingThinkingRef.current;
      pendingThinkingRef.current = '';

      setMessages(prev => [...prev, {
        id: crypto.randomUUID(),
        role: 'lily',
        text: textContent || (
          questions.length > 0
            ? `${questions.map(q => q.question).join('\n')}\n\n下のフォームから教えてね！🐶`
            : '...'
        ),
        timestamp: Date.now(),
        extractedBlocks: blocks.length > 0 ? blocks : undefined,
        questions: questions.length > 0 ? questions : undefined,
        thinking: capturedThinking || undefined,
      }]);
    } catch (e) {
      setSikunProgress('');
      setSikunLiveThinking('');
      pendingThinkingRef.current = '';
      setMessages(prev => [...prev, {
        id: crypto.randomUUID(),
        role: 'lily',
        text: `ごめんね、エラーが起きちゃった 🐶\n${e instanceof Error ? e.message : '不明なエラー'}`,
        timestamp: Date.now(),
      }]);
    } finally {
      setIsLoading(false);
    }
  }, [input, attachments, isLoading, apiKey, messages, selectedNoteId, webSearch, activeMode, activeModel, deepResearch, multiAgent]);

  const selectedNote = allNotes?.find(n => n.id === selectedNoteId);

  if (!apiKey) {
    return (
      <div className="ai-chat-container">
        <div className="setup-screen">
          <div className="setup-lily-wrap">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/lily-character.png" alt="Lily" className="setup-lily" />
          </div>
          <h2 className="setup-title">やあ！Lily だよ 🐶</h2>
          <p className="setup-desc">
            Gemini API キーを設定すると、メモの分析・図やスライドの作成・問題作りをお手伝いできるよ！
          </p>
          <button className="setup-btn" onClick={onOpenSettings}>
            <Sparkles size={18} />
            設定してみる
          </button>
        </div>
        <style jsx>{`
          .ai-chat-container { display: flex; flex-direction: column; height: 100%; background: var(--background); overflow: hidden; }
          .setup-screen { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 40px 24px; gap: 16px; text-align: center; }
          .setup-lily-wrap { width: 160px; height: 160px; animation: float 3s ease-in-out infinite; }
          .setup-lily { width: 100%; height: 100%; object-fit: contain; }
          @keyframes float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }
          .setup-title { font-size: 1.4rem; color: var(--primary); font-weight: 800; margin: 0; }
          .setup-desc { font-size: 0.9rem; color: var(--fg-muted); line-height: 1.6; max-width: 320px; margin: 0; }
          .setup-btn { display: flex; align-items: center; gap: 8px; background: var(--primary); color: white; border: none; border-radius: 12px; padding: 12px 24px; font-size: 1rem; font-weight: 700; cursor: pointer; margin-top: 8px; }
        `}</style>
      </div>
    );
  }

  return (
    <div className="ai-chat-container">
      <div className="chat-header">
        <div className="header-left">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={activeModel === 'sikunlily' ? '/sikunlily-character.png' : '/lily-character.png'}
            alt={activeModel === 'sikunlily' ? 'sikunlily' : 'Lily'}
            className="header-avatar"
          />
          <div>
            <div className="header-title">{activeModel === 'sikunlily' ? 'sikunlily' : 'Lily'}</div>
            <div className="header-sub">{activeModel === 'sikunlily' ? '開発者用AIアシスタント 🛠️' : 'AIアシスタント ✨'}</div>
          </div>
        </div>
        <div className="header-right">
          <button
            className={`model-toggle ${activeModel === 'sikunlily' ? 'siku' : 'lily'}`}
            onClick={() => {
              setActiveModel(p => p === 'lily' ? 'sikunlily' : 'lily');
              setMessages([]);
              setQuestionQueue([]);
              setCollectedAnswers([]);
            }}
            title="AIキャラクターを切り替える"
          >
            <span className="model-toggle-dot" />
            {activeModel === 'lily' ? 'Lily' : 'sikunlily'}
          </button>
          <button
            className={`web-toggle ${webSearch ? 'on' : ''}`}
            onClick={() => setWebSearch(p => !p)}
            title="ネット検索をON/OFF。ONにすると最新情報も調べて答えるよ"
          >
            <Search size={13} />
            <span className="web-label">ネット検索</span>
            <span className="web-state">{webSearch ? 'ON' : 'OFF'}</span>
          </button>
          {activeModel === 'sikunlily' && (
            <button
              className={`web-toggle deep-research-toggle ${deepResearch ? 'on' : ''}`}
              onClick={() => setDeepResearch(p => !p)}
              title="Deep Research Pro Preview: 数分かけて深くリサーチしてレポートを作成するよ"
            >
              <Sparkles size={13} />
              <span className="web-label">Deep Research</span>
              <span className="web-state">{deepResearch ? 'ON' : 'OFF'}</span>
            </button>
          )}
          {activeModel === 'sikunlily' && (
            <button
              className={`web-toggle multi-agent-toggle ${multiAgent ? 'on' : ''}`}
              onClick={() => setMultiAgent(p => !p)}
              title="マルチエージェント: 計画→実行→統合の3エージェントが協調して複雑タスクを処理する"
            >
              <span style={{ fontSize: '11px' }}>🤖</span>
              <span className="web-label">Multi-Agent</span>
              <span className="web-state">{multiAgent ? 'ON' : 'OFF'}</span>
            </button>
          )}
          <button className="context-toggle" onClick={() => setShowContextPanel(p => !p)} title="メモを選択">
            {activeModel === 'sikunlily' ? (
              <span className={`context-chip${sikunAllNotes || sikunNoteIds.length > 0 ? ' selected' : ''}`}>
                {sikunAllNotes ? '📚 全メモ参照中' : sikunNoteIds.length > 0 ? `📄 ${sikunNoteIds.length}件選択中` : 'メモを選ぶ'}
                {showContextPanel ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              </span>
            ) : selectedNote ? (
              <span className="context-chip selected">
                📄 {selectedNote.title || '無題'}
                {showContextPanel ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              </span>
            ) : (
              <span className="context-chip">
                メモを選ぶ
                {showContextPanel ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              </span>
            )}
          </button>
          {messages.length > 0 && (
            <button className="clear-btn" onClick={() => setMessages([])} title="会話をリセット">
              <RotateCcw size={15} />
            </button>
          )}
          <button
            className="help-btn"
            onClick={() => { setHelpInitialTab(activeModel === 'sikunlily' ? 'sikunlily' : 'lily'); setShowHelp(true); }}
            title="使い方ガイド"
          >
            <HelpCircle size={16} />
          </button>
        </div>
      </div>
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} initialTab={helpInitialTab} />}

      {showContextPanel && activeModel === 'sikunlily' && (
        <div className="context-panel">
          <button
            className={`note-chip${sikunAllNotes ? ' active' : ''}`}
            onClick={() => { setSikunAllNotes(true); setSikunNoteIds([]); setShowContextPanel(false); }}
          >
            📚 全メモを参照
          </button>
          <button
            className={`note-chip${!sikunAllNotes && sikunNoteIds.length === 0 ? ' active' : ''}`}
            onClick={() => { setSikunAllNotes(false); setSikunNoteIds([]); setShowContextPanel(false); }}
          >
            なし
          </button>
          {allNotes?.map(n => (
            <button
              key={n.id}
              className={`note-chip${sikunNoteIds.includes(n.id!) ? ' active' : ''}`}
              onClick={() => {
                setSikunAllNotes(false);
                setSikunNoteIds(prev =>
                  prev.includes(n.id!) ? prev.filter(id => id !== n.id) : [...prev, n.id!]
                );
              }}
            >
              {sikunNoteIds.includes(n.id!) ? '✓ ' : ''}{n.title || '無題のメモ'}
            </button>
          ))}
        </div>
      )}
      {showContextPanel && activeModel === 'lily' && (
        <div className="context-panel">
          <button
            className={`note-chip ${!selectedNoteId ? 'active' : ''}`}
            onClick={() => { setSelectedNoteId(undefined); setShowContextPanel(false); }}
          >
            なし
          </button>
          {allNotes?.map(n => (
            <button
              key={n.id}
              className={`note-chip ${selectedNoteId === n.id ? 'active' : ''}`}
              onClick={() => { setSelectedNoteId(n.id); setShowContextPanel(false); }}
            >
              {n.title || '無題のメモ'}
            </button>
          ))}
        </div>
      )}

      <div className="messages-list">
        {messages.length === 0 && (
          <div className="welcome-screen">
            <div className="welcome-lily-wrap">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={activeModel === 'sikunlily' ? '/sikunlily-character.png' : '/lily-character.png'}
                alt={activeModel === 'sikunlily' ? 'sikunlily' : 'Lily'}
                className="welcome-lily"
              />
            </div>
            {activeModel === 'sikunlily' ? (
              <>
                <p className="welcome-text">sikunlily だ ⚔️🐕<br />lilyのペット「sikun」と「lily」が合わさった柴犬の武士だ。<br />コード構築・データ解析・調査検証・メモ整理が得意だ。</p>
                <div className="suggestions">
                  {SIKUNLILY_SUGGESTIONS.map(s => (
                    <button key={s} className="suggestion-chip siku" onClick={() => sendMessage(s)}>{s}</button>
                  ))}
                </div>
              </>
            ) : (
              <>
                <p className="welcome-text">こんにちは、Lily だよ！🐶<br />メモの要約・翻訳・メール作成・問題づくり・図やグラフ・スライドまで、文章でお願いするだけ。<br />まずは下の例をタップしてみてね👇</p>
                <div className="suggestions">
                  {SUGGESTIONS.map(s => (
                    <button key={s} className="suggestion-chip" onClick={() => sendMessage(s)}>{s}</button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
        {messages.map(msg =>
          msg.role === 'user' ? (
            <UserBubble key={msg.id} message={msg} />
          ) : (
            <LilyBubble
              key={msg.id}
              message={msg}
              allNotes={allNotes ?? []}
              selectedNoteId={selectedNoteId}
              model={activeModel}
              onNoteCreated={onNoteCreated}
            />
          )
        )}
        {isLoading && (
          <>
            <TypingIndicator model={activeModel} />
            {sikunProgress && <div className="siku-progress">{sikunProgress}</div>}
            {sikunLiveThinking && (
              <div className="siku-thinking-live">
                <div className="siku-thinking-live-header">
                  <span className="siku-thinking-pulse" />
                  思考ログ（リアルタイム）
                </div>
                <div className="siku-thinking-live-body">{sikunLiveThinking}</div>
              </div>
            )}
          </>
        )}
        <div ref={messagesEndRef} />
      </div>

      {onSwitchTab && (
        <nav className="ai-bottom-nav">
          <button className="ai-nav-item" onClick={() => onSwitchTab('memos')}><Book size={22} /><span>メモ</span></button>
          <button className="ai-nav-item" onClick={() => onSwitchTab('sketch')}><Brush size={22} /><span>落書き</span></button>
          <button className="ai-nav-item" onClick={() => onSwitchTab('pdf')}><FileText size={22} /><span>PDF</span></button>
          <button className="ai-nav-item active"><Sparkles size={22} /><span>AI</span></button>
          <button className="ai-nav-item" onClick={() => { onSwitchTab('settings'); onOpenSettings(); }}><SettingsIcon size={22} /><span>設定</span></button>
        </nav>
      )}

      {activeModel === 'sikunlily' ? (
        /* sikunlily: 専門モードトグル */
        <div className="quick-actions mode-row">
          <span className="qa-label">モード</span>
          <button
            className={`quick-chip mode-chip siku-mode${activeMode === 'code' ? ' on' : ''}`}
            onClick={() => setActiveMode(p => (p === 'code' ? null : 'code'))}
            title="大規模コード構築モード: gemini-2.5-proで複数ファイルを跨ぐプロジェクトを生成"
          >
            ⚙️ コード構築{activeMode === 'code' ? ' ✓' : ''}
          </button>
          <button
            className={`quick-chip mode-chip siku-mode${activeMode === 'organize' ? ' on' : ''}`}
            onClick={() => setActiveMode(p => (p === 'organize' ? null : 'organize'))}
            title="メモ整理モード: メモ間の関連性分析・リンク提案・フォルダ整理提案"
          >
            🗂️ メモ整理{activeMode === 'organize' ? ' ✓' : ''}
          </button>
          <button
            className={`quick-chip mode-chip siku-mode${activeMode === 'analysis' ? ' on' : ''}`}
            onClick={() => setActiveMode(p => (p === 'analysis' ? null : 'analysis'))}
            title="データ解析モード: 非構造化データの統合解析・パターン認識・将来予測"
          >
            📊 データ解析{activeMode === 'analysis' ? ' ✓' : ''}
          </button>
          <button
            className={`quick-chip mode-chip siku-mode${activeMode === 'research' ? ' on' : ''}`}
            onClick={() => setActiveMode(p => (p === 'research' ? null : 'research'))}
            title="調査・検証モード: 情報源の信頼性評価・矛盾検出・自律的な課題解決"
          >
            🔬 調査・検証{activeMode === 'research' ? ' ✓' : ''}
          </button>
          <button
            className={`quick-chip mode-chip siku-mode${activeMode === 'arch' ? ' on' : ''}`}
            onClick={() => setActiveMode(p => (p === 'arch' ? null : 'arch'))}
            title="アーキテクチャ設計モード: 要件からシステム構成図を自動生成・テストケース生成・技術選定比較"
          >
            🏗️ アーキテクチャ{activeMode === 'arch' ? ' ✓' : ''}
          </button>
          <button
            className={`quick-chip mode-chip siku-mode${activeMode === 'study' ? ' on' : ''}`}
            onClick={() => setActiveMode(p => (p === 'study' ? null : 'study'))}
            title="学習支援モード: Q&A自動生成・概念マップ・レポート添削・外国語支援・学習パス提案"
          >
            📖 学習支援{activeMode === 'study' ? ' ✓' : ''}
          </button>
        </div>
      ) : (
        /* Lily: トーンモード */
        <div className="quick-actions mode-row">
          <span className="qa-label">トーン</span>
          {MODES.map(mo => (
            <button
              key={mo.id}
              className={`quick-chip mode-chip${activeMode === mo.id ? ' on' : ''}`}
              onClick={() => setActiveMode(p => (p === mo.id ? null : mo.id))}
              title="タップでON。次に送るメッセージからこのトーンで答えてくれるよ"
            >
              {mo.label}{activeMode === mo.id ? ' ✓' : ''}
            </button>
          ))}
        </div>
      )}

      {/* Quick actions (Lily only) */}
      {activeModel === 'lily' && (
        <div className="quick-actions">
          <Wand2 size={14} className="qa-wand" />
          {QUICK_ACTIONS.map(a => (
            <button key={a.label} className="quick-chip" onClick={() => sendMessage(a.prompt)} disabled={isLoading}>
              {a.label}
            </button>
          ))}
        </div>
      )}

      {(attachments.length > 0 || fileError) && (
        <div className="att-bar">
          {attachments.map((att, i) => (
            <div key={att.id ?? i} className={`att-chip${att.uploading ? ' att-chip--uploading' : ''}`}>
              {att.uploading ? (
                <span className="att-chip-icon">⏳</span>
              ) : att.isImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`data:${att.mimeType};base64,${att.data}`} alt={att.name} className="att-chip-thumb" />
              ) : (
                <span className="att-chip-icon">📎</span>
              )}
              <span className="att-chip-name">{att.uploading ? `${att.name} (アップロード中...)` : att.name}</span>
              <button className="att-remove" onClick={() => removeAttachment(i)} title="削除"><X size={14} /></button>
            </div>
          ))}
          {fileError && <span className="att-error">{fileError}</span>}
        </div>
      )}

      <div className="input-area">
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_FILE_TYPES}
          multiple
          hidden
          onChange={handleFileSelect}
        />
        <button
          className="attach-btn"
          onClick={() => fileInputRef.current?.click()}
          disabled={isLoading || attachments.length >= MAX_FILES}
          title="ファイルを添付（複数可）"
        >
          <Paperclip size={20} />
        </button>
        <textarea
          ref={textareaRef}
          className="chat-input"
          placeholder={activeModel === 'sikunlily' ? 'sikunlily に話しかける...（Enter で改行 / 送信はボタン）' : 'Lily に話しかける...（Enter で改行 / 送信はボタン）'}
          value={input}
          onChange={e => { setInput(e.target.value); autoResizeTextarea(); }}
          rows={1}
          disabled={isLoading}
        />
        <button
          className="send-btn"
          onClick={() => sendMessage()}
          disabled={(!input.trim() && attachments.length === 0) || isLoading || attachments.some(a => a.uploading)}
          title="送信 (Enter)"
        >
          <Send size={20} />
        </button>
      </div>

      {questionQueue.length > 0 && (
        <ClarifyBottomSheet
          key={questionQueue[0].id}
          question={questionQueue[0]}
          progress={{
            current: collectedAnswers.length + 1,
            total: collectedAnswers.length + questionQueue.length,
          }}
          onAnswer={(t) => {
            const current = questionQueue[0];
            const answers = [...collectedAnswers, { q: current.question, a: t }];
            const remaining = questionQueue.slice(1);
            if (remaining.length > 0) {
              setCollectedAnswers(answers);
              setQuestionQueue(remaining);
            } else {
              setQuestionQueue([]);
              setCollectedAnswers([]);
              const combined =
                answers.length === 1
                  ? answers[0].a
                  : answers.map(p => `・${p.q}\n→ ${p.a}`).join('\n');
              sendMessage(combined);
            }
          }}
          onDismiss={() => { setQuestionQueue([]); setCollectedAnswers([]); }}
          disabled={isLoading}
        />
      )}

      <style jsx>{`
        .ai-chat-container { display: flex; flex-direction: column; height: 100%; background: var(--background); overflow: hidden; position: relative; }
        .chat-header { display: flex; align-items: center; padding: 10px 14px; border-bottom: 1px solid var(--border); background: var(--glass-tint, rgba(255,255,255,0.9)); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); flex-shrink: 0; gap: 8px; overflow: hidden; }
        .header-left { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
        .header-avatar { width: 38px; height: 38px; border-radius: 50%; object-fit: cover; object-position: top center; border: 2px solid var(--border); background: var(--accent); }
        .header-title { font-size: 0.95rem; font-weight: 800; color: var(--primary); }
        .header-sub { font-size: 0.7rem; color: var(--fg-muted); }
        .header-right { display: flex; align-items: center; gap: 6px; flex: 1; min-width: 0; overflow-x: auto; -webkit-overflow-scrolling: touch; scrollbar-width: none; padding-bottom: 2px; }
        .header-right::-webkit-scrollbar { display: none; }
        .model-toggle { display: flex; align-items: center; gap: 5px; background: var(--accent); border: 1px solid var(--border); border-radius: 16px; padding: 5px 10px; cursor: pointer; font-size: 0.74rem; font-weight: 700; white-space: nowrap; transition: all 0.2s; }
        .model-toggle.siku { color: #8B4513; border-color: #8B4513; background: color-mix(in srgb, #8B4513 12%, transparent); }
        .model-toggle.lily { color: var(--primary); border-color: var(--primary); background: color-mix(in srgb, var(--primary) 12%, transparent); }
        .model-toggle-dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; flex-shrink: 0; }
        .web-toggle { display: flex; align-items: center; gap: 5px; background: var(--accent); border: 1px solid var(--border); border-radius: 16px; padding: 5px 10px; cursor: pointer; color: var(--fg-muted); font-size: 0.74rem; font-weight: 600; white-space: nowrap; }
        .web-toggle.on { color: var(--primary); border-color: var(--primary); background: color-mix(in srgb, var(--primary) 12%, transparent); }
        .web-toggle:disabled { opacity: 0.4; cursor: not-allowed; }
        .web-state { background: var(--border); color: var(--foreground); border-radius: 8px; padding: 1px 6px; font-size: 0.66rem; font-weight: 800; }
        .web-toggle.on .web-state { background: var(--primary); color: white; }
        @media (max-width: 380px) { .web-toggle .web-label { display: none; } }
        .siku-progress { font-size: 0.78rem; color: var(--fg-muted); padding-left: 52px; margin-top: -8px; font-style: italic; }
        .siku-thinking-live {
          margin: 4px 0 4px 52px;
          border: 1px solid #334155; border-radius: 10px;
          background: #0f172a; overflow: hidden;
        }
        .siku-thinking-live-header {
          display: flex; align-items: center; gap: 7px;
          padding: 6px 12px; font-size: 0.72rem; font-weight: 600;
          color: #64748b; border-bottom: 1px solid #1e293b;
        }
        .siku-thinking-pulse {
          width: 7px; height: 7px; border-radius: 50%; background: #3b82f6;
          animation: thinkPulse 1.2s ease-in-out infinite;
          flex-shrink: 0;
        }
        @keyframes thinkPulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.35;transform:scale(0.7)} }
        .siku-thinking-live-body {
          padding: 8px 12px; max-height: 180px; overflow-y: auto;
          font-size: 0.7rem; line-height: 1.55; color: #64748b;
          font-family: 'Fira Code','Consolas',monospace;
          white-space: pre-wrap; word-break: break-word;
        }
        .context-toggle { background: transparent; border: none; cursor: pointer; padding: 2px; }
        .context-chip { display: inline-flex; align-items: center; gap: 4px; background: var(--accent); border: 1px solid var(--border); border-radius: 20px; padding: 4px 10px; font-size: 0.78rem; color: var(--fg-muted); white-space: nowrap; max-width: 150px; overflow: hidden; text-overflow: ellipsis; cursor: pointer; }
        .context-chip.selected { color: var(--primary); border-color: var(--primary); }
        .clear-btn { background: transparent; border: 1px solid var(--border); border-radius: 8px; padding: 5px 7px; cursor: pointer; color: var(--fg-muted); display: flex; align-items: center; }
        .context-panel { display: flex; gap: 8px; padding: 8px 14px; border-bottom: 1px solid var(--border); background: var(--accent); overflow-x: auto; flex-shrink: 0; }
        .note-chip { flex-shrink: 0; background: var(--background); border: 1px solid var(--border); border-radius: 16px; padding: 5px 12px; font-size: 0.78rem; color: var(--fg-muted); cursor: pointer; white-space: nowrap; transition: all 0.15s; }
        .note-chip.active { background: var(--primary); color: white; border-color: var(--primary); }
        .messages-list { flex: 1; overflow-y: auto; padding: 16px 14px; display: flex; flex-direction: column; gap: 14px; padding-bottom: 20px; }
        .welcome-screen { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 20px 0; text-align: center; }
        .welcome-lily-wrap { width: 160px; height: 200px; animation: float 3s ease-in-out infinite; display: flex; align-items: center; justify-content: center; }
        .welcome-lily { max-width: 100%; max-height: 100%; width: auto; height: auto; object-fit: contain; image-rendering: -webkit-optimize-contrast; display: block; }
        @keyframes float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }
        .welcome-text { font-size: 0.9rem; color: var(--fg-muted); line-height: 1.6; margin: 0; }
        .suggestions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; max-width: 400px; }
        .suggestion-chip { background: color-mix(in srgb, var(--primary) 12%, transparent); border: 1px solid color-mix(in srgb, var(--primary) 30%, transparent); color: var(--primary); border-radius: 20px; padding: 6px 14px; font-size: 0.82rem; font-weight: 600; cursor: pointer; transition: all 0.15s; }
        .suggestion-chip:hover { background: var(--primary); color: white; }
        .quick-actions { display: flex; align-items: center; gap: 6px; padding: 8px 14px; border-top: 1px solid var(--border); background: var(--accent); overflow-x: auto; flex-shrink: 0; }
        .quick-actions :global(.qa-wand) { color: var(--primary); flex-shrink: 0; }
        .quick-chip { flex-shrink: 0; background: var(--background); border: 1px solid var(--border); border-radius: 16px; padding: 5px 12px; font-size: 0.76rem; font-weight: 600; color: var(--foreground); cursor: pointer; white-space: nowrap; transition: all 0.15s; }
        .quick-chip:hover:not(:disabled) { border-color: var(--primary); color: var(--primary); }
        .quick-chip:disabled { opacity: 0.5; cursor: default; }
        .mode-row { border-top: none; padding-bottom: 0; }
        .qa-label { flex-shrink: 0; font-size: 0.7rem; font-weight: 700; color: var(--fg-muted); }
        .mode-chip.on { background: var(--primary); color: #fff; border-color: var(--primary); }
        .input-area { display: flex; align-items: flex-end; gap: 8px; padding: 10px 14px; padding-bottom: calc(10px + env(safe-area-inset-bottom)); border-top: 1px solid var(--border); background: var(--glass-tint, rgba(255,255,255,0.9)); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); flex-shrink: 0; }
        .chat-input { flex: 1; min-height: 38px; max-height: 120px; background: var(--accent); border: 1px solid var(--border); border-radius: 12px; padding: 9px 12px; font-size: 0.9rem; color: var(--foreground); outline: none; resize: none; line-height: 1.5; font-family: inherit; overflow-y: auto; }
        .chat-input:focus { border-color: var(--primary); }
        .attach-btn { flex-shrink: 0; width: 40px; height: 40px; background: var(--accent); color: var(--fg-muted); border: 1px solid var(--border); border-radius: 12px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.15s; }
        .attach-btn:hover:not(:disabled) { color: var(--primary); border-color: var(--primary); }
        .attach-btn:disabled { opacity: 0.4; cursor: default; }
        .send-btn { flex-shrink: 0; width: 40px; height: 40px; background: var(--primary); color: white; border: none; border-radius: 12px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: opacity 0.15s; }
        .send-btn:disabled { opacity: 0.4; cursor: default; }
        .web-toggle.multi-agent-toggle { background: var(--accent); }
        .web-toggle.multi-agent-toggle.on { background: color-mix(in srgb, #7c3aed 15%, transparent); border-color: #7c3aed; color: #7c3aed; }
        .web-toggle.multi-agent-toggle.on .web-state { color: #7c3aed; }
        .att-bar { display: flex; align-items: center; gap: 10px; padding: 8px 14px; border-top: 1px solid var(--border); background: var(--accent); flex-shrink: 0; overflow-x: auto; }
        .att-chip { display: inline-flex; align-items: center; gap: 8px; background: var(--background); border: 1px solid var(--border); border-radius: 10px; padding: 5px 8px 5px 10px; flex-shrink: 0; }
        .att-chip-thumb { width: 32px; height: 32px; object-fit: cover; border-radius: 6px; }
        .att-chip-icon { font-size: 1rem; }
        .att-chip-name { font-size: 0.78rem; color: var(--foreground); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 120px; }
        .att-remove { background: transparent; border: none; cursor: pointer; color: var(--fg-muted); display: flex; align-items: center; padding: 2px; }
        .att-error { font-size: 0.78rem; color: #cc0000; flex-shrink: 0; }
        .ai-bottom-nav { display: none; flex-shrink: 0; }
        @media (max-width: 1023px) {
          .ai-bottom-nav { display: flex; height: calc(56px + env(safe-area-inset-bottom)); background: var(--glass-tint, rgba(255,255,255,0.9)); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); border-top: 1px solid var(--border); padding-bottom: env(safe-area-inset-bottom); order: 99; }
          .ai-nav-item { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; background: transparent; color: var(--fg-muted); transition: color 0.15s; }
          .ai-nav-item.active { color: var(--primary); }
          .ai-nav-item span { font-size: 0.65rem; font-weight: 600; }
          .messages-list { padding-bottom: 16px; }
        }
      `}</style>
    </div>
  );
}
