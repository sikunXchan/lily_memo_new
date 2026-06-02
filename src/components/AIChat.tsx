'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Sparkles, Send, ChevronDown, ChevronUp, RotateCcw, Book, Brush,
  FileText, Settings as SettingsIcon, Paperclip, X, Search,
  FileDown, Wand2, Download, Pencil, HelpCircle, ArrowLeft,
  Save, History, Trash2, Mic, GraduationCap, Phone,
} from 'lucide-react';
import {
  Bar, Line, Pie, Scatter,
} from 'react-chartjs-2';
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, PointElement,
  LineElement, ArcElement, Title, Tooltip, Legend, Filler,
} from 'chart.js';
import mermaid from 'mermaid';
import { initMermaid } from '@/lib/mermaidConfig';
import 'katex/dist/katex.min.css';
import { db, newSyncId } from '@/lib/db';
import type { Note, Folder, SavedChat } from '@/lib/db';
import { saveChat, deleteSavedChat, parseSavedMessages } from '@/lib/chatHistory';
import {
  callGeminiChat, uploadToFileApi,
  streamSikunlilyChat,
  LILY_CHAT_SYSTEM_PROMPT,
} from '@/lib/gemini';
import type { ChatTurn, ChatAttachment } from '@/lib/gemini';
import { noteHtmlToText } from '@/lib/noteText';
import { parseGeometry, renderGeometrySvg } from '@/lib/geometry';
import { renderRich } from '@/lib/richText';
import { sanitizeMindmap, recoverMermaid } from '@/lib/mermaidSanitize';
import {
  downloadTextFile, downloadSvg, downloadSvgAsPng, downloadCanvasAsPng,
} from '@/lib/fileGen';
import dynamic from 'next/dynamic';

const LectureRecorder = dynamic(() => import('@/components/LectureRecorder'), { ssr: false });
const VoiceChat = dynamic(() => import('@/components/VoiceChat'), { ssr: false });

ChartJS.register(
  CategoryScale, LinearScale, BarElement, PointElement, LineElement,
  ArcElement, Title, Tooltip, Legend, Filler
);

initMermaid();

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
  thinking?: string;
}

interface InsertableBlock {
  id: string;
  type: 'mermaid' | 'chart' | 'qa' | 'file' | 'geometry' | 'memo_create' | 'memo_overwrite' | 'folder_create' | 'note_move' | 'table';
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
  onSwitchTab?: (tab: 'memos' | 'sketch' | 'pdf' | 'settings' | 'study') => void;
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

  // Block markers use a control char so they survive markdown / cleanup
  // regexes without being touched, and so users can't accidentally type them.
  // LilyBubble splits message.text on these and renders each captured block
  // inline at the exact position where Lily produced it.
  const blockMarker = (id: string) => `\n\nLBLK:${id}\n\n`;

  // Generic downloadable file blocks (filename on the first line).
  const FILE_RE = /```file\s*\n@@filename:\s*([^\n]+)\n([\s\S]*?)```/g;
  const work = afterAsk.replace(FILE_RE, (_full, name: string, content: string) => {
    const fileName = name.trim();
    const id = crypto.randomUUID();
    blocks.push({
      id,
      type: 'file',
      rawCode: content.replace(/\n$/, ''),
      previewLabel: fileName,
      fileName,
    });
    return blockMarker(id);
  });

  // Fallback: catch geometry JSON that Gemini accidentally put in ```json fences or bare
  const JSON_FENCE_RE = /```(?:json)?\s*\n(\{[\s\S]*?"elements"\s*:[\s\S]*?\})\s*\n```/g;
  const work2 = work.replace(JSON_FENCE_RE, (_full, jsonStr: string) => {
    try {
      parseGeometry(jsonStr.trim());
      const id = crypto.randomUUID();
      blocks.push({ id, type: 'geometry', rawCode: jsonStr.trim(), previewLabel: '数学・幾何の図' });
      return blockMarker(id);
    } catch {
      return _full; // not a geometry block, leave it
    }
  });

  const FENCE_RE = /```(mermaid|chart|qa|geometry|memo_create|memo_overwrite|folder_create|note_move|table)([\s\S]*?)```/g;
  const textContent = work2.replace(FENCE_RE, (_full, type, code) => {
    const trimmed = code.trim();
    const id = crypto.randomUUID();
    if (type === 'mermaid') {
      blocks.push({ id, type: 'mermaid', rawCode: trimmed, previewLabel: detectMermaidLabel(trimmed) });
      return blockMarker(id);
    }
    if (type === 'chart') {
      try { JSON.parse(trimmed); } catch { return '\n[グラフの生成に失敗しちゃった]\n'; }
      blocks.push({ id, type: 'chart', rawCode: trimmed, previewLabel: detectChartLabel(trimmed) });
      return blockMarker(id);
    }
    if (type === 'qa') {
      const pairs = parseQAPairs(trimmed);
      if (pairs.length === 0) return '\n[Q&Aの解析に失敗しちゃった]\n';
      const label = `${pairs.length}問の${QA_KIND_LABEL[parseQAKind(trimmed)]}`;
      blocks.push({ id, type: 'qa', rawCode: trimmed, previewLabel: label });
      return blockMarker(id);
    }
    if (type === 'geometry') {
      try { parseGeometry(trimmed); } catch { return '\n[図の生成に失敗しちゃった]\n'; }
      blocks.push({ id, type: 'geometry', rawCode: trimmed, previewLabel: '数学・幾何の図' });
      return blockMarker(id);
    }
    if (type === 'memo_create' && allowMemoBlocks) {
      const firstLine = trimmed.split('\n')[0] || '';
      const titleMatch = firstLine.match(/^@@memo_create\s*:\s*(.+)/);
      const memoTitle = titleMatch?.[1]?.trim() || '新しいメモ';
      const content = trimmed.split('\n').slice(1).join('\n').trim();
      blocks.push({ id, type: 'memo_create', rawCode: content, previewLabel: `メモ作成: ${memoTitle}`, memoTitle });
      return blockMarker(id);
    }
    if (type === 'memo_overwrite' && allowMemoBlocks) {
      const firstLine = trimmed.split('\n')[0] || '';
      const idMatch = firstLine.match(/^@@memo_overwrite\s*:\s*(\d+)/);
      const memoId = idMatch ? Number(idMatch[1]) : undefined;
      const content = trimmed.split('\n').slice(1).join('\n').trim();
      blocks.push({ id, type: 'memo_overwrite', rawCode: content, previewLabel: `メモ上書き: ID ${memoId ?? '不明'}`, memoId });
      return blockMarker(id);
    }
    if (type === 'folder_create') {
      const lines = trimmed.split('\n');
      const nameMatch = lines[0]?.match(/^@@folder_create\s*:\s*(.+)/);
      const colorMatch = lines.find((l: string) => l.startsWith('@@color:'))?.match(/^@@color:\s*(.+)/);
      const folderName = nameMatch?.[1]?.trim() || '新しいフォルダ';
      const folderColor = colorMatch?.[1]?.trim();
      blocks.push({ id, type: 'folder_create', rawCode: trimmed, previewLabel: `フォルダ作成: 📁 ${folderName}`, folderName, folderColor });
      return blockMarker(id);
    }
    if (type === 'note_move') {
      const lines = trimmed.split('\n');
      const idMatch = lines[0]?.match(/^@@note_move\s*:\s*(\d+)/);
      const folderMatch = lines.find((l: string) => l.startsWith('@@to_folder:'))?.match(/^@@to_folder:\s*(.+)/);
      const memoId = idMatch ? Number(idMatch[1]) : undefined;
      const targetFolderName = folderMatch?.[1]?.trim() || '未分類';
      blocks.push({ id, type: 'note_move', rawCode: trimmed, previewLabel: `移動: ID ${memoId ?? '?'} → 📁 ${targetFolderName}`, memoId, targetFolderName });
      return blockMarker(id);
    }
    if (type === 'table') {
      blocks.push({ id, type: 'table', rawCode: trimmed, previewLabel: '表' });
      return blockMarker(id);
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

  // Never let internal directives leak into the visible chat bubble. The
  // whitespace-collapsing below would otherwise wreck indentation inside
  // fenced code snippets (```python ... ```), so stash every fence — closed
  // pairs first, then any trailing unclosed fence from a streaming reply —
  // run the cleanup on prose only, then restore the code verbatim.
  const fences: string[] = [];
  const stashFence = (m: string) => {
    fences.push(m);
    // Sentinel with no space/tab/word chars, so the whitespace and directive
    // cleanups below can't touch it or the code it stands in for.
    return `§§FENCE${fences.length - 1}§§`;
  };
  const cleanText = textContent
    .replace(/```[\s\S]*?```/g, stashFence)
    .replace(/```[\s\S]*$/, stashFence)
    .replace(/[（(]\s*@@[^）)]*[）)]/g, '')
    .replace(/@@\w+\s*:\s*[^\s、,）)]*/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/§§FENCE(\d+)§§/g, (_m, i: string) => fences[Number(i)] ?? '')
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

function markdownTableToHtml(markdown: string): string {
  const lines = markdown.split('\n').map(l => l.trim()).filter(l => l.startsWith('|'));
  if (lines.length < 2) return `<p>${markdown}</p>`;
  const parseRow = (line: string) => line.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
  const headers = parseRow(lines[0]);
  const dataRows = lines.slice(2); // skip separator line
  const headerHtml = headers.map(h => `<th>${h}</th>`).join('');
  const bodyHtml = dataRows.map(row => {
    const cells = parseRow(row);
    return `<tr>${cells.map(c => `<td>${c}</td>`).join('')}</tr>`;
  }).join('');
  return `<table><thead><tr>${headerHtml}</tr></thead><tbody>${bodyHtml}</tbody></table>`;
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
  if (block.type === 'table') {
    return markdownTableToHtml(block.rawCode);
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

const PRICE_ROWS = [
  { label: 'Lily（通常の質問）', cost: '約 ¥0.3〜1' },
  { label: 'Lily＋問題作成', cost: '約 ¥1〜8' },
  { label: 'Lily＋PDF・画像', cost: '約 ¥1〜3' },
  { label: 'Lily（思考モード）', cost: '約 ¥3〜6' },
  { label: 'ネット検索 ON', cost: '＋数円／回' },
  { label: 'Deep Research', cost: '約 ¥20〜100＋' },
  { label: '🌱 節約モード', cost: '約 ¥0.1〜0.5' },
];

function HelpModal({ onClose, initialTab }: { onClose: () => void; initialTab: 'lily' | 'cost' }) {
  const [tab, setTab] = useState<'lily' | 'cost'>(initialTab);
  return (
    <div className="help-overlay" onClick={onClose}>
      <div className="help-modal" onClick={e => e.stopPropagation()}>
        <div className="help-header">
          <span className="help-title">使い方ガイド</span>
          <button className="help-close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="help-tabs">
          {(['lily', 'cost'] as const).map(t => (
            <button key={t} className={`help-tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
              {t === 'lily' ? '🌸 Lily' : '💰 料金'}
            </button>
          ))}
        </div>
        <div className="help-body">
          {tab === 'lily' && (
            <div className="help-grid">
              {LILY_FEATURES.map(f => (
                <div key={f.title} className="help-card">
                  <span className="help-card-icon">{f.icon}</span>
                  <div><strong>{f.title}</strong></div>
                </div>
              ))}
            </div>
          )}
          {tab === 'cost' && (
            <div className="price-table">
              {PRICE_ROWS.map(r => (
                <div key={r.label} className="price-row">
                  <span className="price-label">{r.label}</span>
                  <span className="price-cost">{r.cost}</span>
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
          .help-grid { display:flex; flex-direction:column; gap:8px; }
          .help-card { display:flex; align-items:center; gap:10px; padding:9px 12px; background:var(--accent); border:1px solid var(--border); border-radius:10px; }
          .help-card-icon { font-size:1.2rem; flex-shrink:0; }
          .help-card strong { font-size:0.88rem; color:var(--foreground); }
          .price-table { display:flex; flex-direction:column; gap:6px; }
          .price-row { display:flex; align-items:center; justify-content:space-between; padding:9px 12px; background:var(--accent); border:1px solid var(--border); border-radius:10px; }
          .price-label { font-size:0.85rem; font-weight:700; color:var(--foreground); }
          .price-cost { font-size:0.85rem; font-weight:800; color:#16a34a; white-space:nowrap; }
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
      const parse = (mermaid as unknown as { parse(t: string, o: object): Promise<boolean> }).parse;
      let source = sanitizeMindmap(code);
      try {
        // Pre-validate to prevent Mermaid v11 from injecting a bomb SVG on error.
        let ok = await parse(source, { suppressErrors: true });
        if (!ok) {
          // Recovery: auto-quote flowchart labels / alias sequence participants.
          const recovered = recoverMermaid(source);
          if (recovered !== source) {
            ok = await parse(recovered, { suppressErrors: true });
            if (ok) source = recovered;
          }
        }
        if (!ok) { if (!cancelled) setErr(true); return; }
        const id = `lily-mmd-${Math.random().toString(36).slice(2, 9)}`;
        const { svg: out } = await mermaid.render(id, source);
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

// Block types whose raw content is useful to copy verbatim (diagrams, data,
// problems, tables, files). Action blocks (memo/folder ops) are excluded.
const BLOCK_COPYABLE = new Set<InsertableBlock['type']>([
  'mermaid', 'chart', 'qa', 'geometry', 'table', 'file',
]);

function InsertableBlockCard({
  block,
  allNotes,
  defaultNoteId,
  onNoteCreated,
}: {
  block: InsertableBlock;
  allNotes: Note[];
  defaultNoteId?: number;
  onNoteCreated?: (id: number) => void;
}) {
  const NEW_NOTE = '__new__';
  const [target, setTarget] = useState<string>(
    defaultNoteId != null ? String(defaultNoteId) : (allNotes[0]?.id != null ? String(allNotes[0].id) : NEW_NOTE)
  );
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [showMemoModal, setShowMemoModal] = useState(false);

  const baseName = `lily-${block.type}-${block.id.slice(0, 6)}`;
  const typeEmoji = block.type === 'mermaid' ? '🌊'
    : block.type === 'chart' ? '📊'
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

  return (
    <div className="insertable-block">
      <div className="block-header">
        <span className="block-type-badge">{typeEmoji} {block.previewLabel}</span>
        {BLOCK_COPYABLE.has(block.type) && <CopyButton text={block.rawCode} />}
      </div>

      <div className="block-visual">
        {block.type === 'mermaid' && <MermaidPreview code={block.rawCode} baseName={baseName} />}
        {block.type === 'chart' && <ChartPreview code={block.rawCode} baseName={baseName} />}
        {block.type === 'qa' && <QAPreview code={block.rawCode} />}
        {block.type === 'geometry' && <GeometryPreview code={block.rawCode} baseName={baseName} />}
        {block.type === 'file' && <FilePreview block={block} />}
        {(block.type === 'memo_create' || block.type === 'memo_overwrite') && (
          <pre className="memo-block-preview">{block.rawCode.slice(0, 200)}{block.rawCode.length > 200 ? '\n…' : ''}</pre>
        )}
      </div>

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
        .block-header { margin-bottom: 8px; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
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

// Matches the markers parseAIResponse emits for each extracted block.
// Capturing group is the block id. Surrounding newlines are absorbed so the
// marker doesn't leave blank paragraphs behind when it's split out.
const LBLK_RE = /\n*LBLK:([0-9a-fA-F-]+)\n*/g;

// Strip the LBLK markers from text destined for copy/clipboard so users
// don't paste opaque "LBLK:…" tokens.
function stripBlockMarkers(text: string): string {
  return text.replace(LBLK_RE, '\n\n').replace(/\n{3,}/g, '\n\n').trim();
}

function LilyBubble({
  message, allNotes, selectedNoteId, model, onNoteCreated, onRegenerate,
}: {
  message: ChatMessage;
  allNotes: Note[];
  selectedNoteId?: number;
  model?: 'lily';
  onNoteCreated?: (id: number) => void;
  onRegenerate?: () => void;
}) {
  const avatarSrc = '/9D507C9A-09F0-4B05-9F41-612FBD120675.png';
  const avatarAlt = 'Lily';
  const [thinkingOpen, setThinkingOpen] = useState(false);

  // Interleave text segments and block components in the order Lily produced
  // them. Any block not referenced by a marker (e.g. older saved messages)
  // falls through to the trailing block list so it still renders.
  const allBlocks = message.extractedBlocks ?? [];
  const blockMap = new Map(allBlocks.map(b => [b.id, b]));
  const consumed = new Set<string>();
  const inlineParts: Array<{ kind: 'text'; value: string } | { kind: 'block'; id: string }> = [];
  if (allBlocks.length === 0) {
    inlineParts.push({ kind: 'text', value: stripBlockMarkers(message.text) });
  } else {
    const parts = message.text.split(LBLK_RE);
    parts.forEach((part, i) => {
      if (i % 2 === 0) {
        if (part.trim()) inlineParts.push({ kind: 'text', value: part });
      } else if (blockMap.has(part)) {
        consumed.add(part);
        inlineParts.push({ kind: 'block', id: part });
      }
    });
  }
  const orphanBlocks = allBlocks.filter(b => !consumed.has(b.id));
  const fileBlocks = allBlocks.filter(b => b.type === 'file');
  const copyText = stripBlockMarkers(message.text);

  // Per-code-block and per-section copy. The rich text is injected as raw HTML,
  // so we use event delegation on the bubble. A `.code-copy-btn` copies its
  // block's <code>; a `.section-copy-btn` copies its heading plus the content
  // down to the next same-or-higher heading.
  const flashCopied = (btn: Element, done: string, restore: string) => {
    btn.textContent = done;
    btn.classList.add('copied');
    setTimeout(() => {
      btn.textContent = restore;
      btn.classList.remove('copied');
    }, 1600);
  };
  // Plain text of an element, minus our injected control buttons / code header.
  const cleanText = (el: Element): string => {
    const clone = el.cloneNode(true) as Element;
    clone.querySelectorAll('.section-copy-btn, .code-copy-btn, .rt-pre-head').forEach(n => n.remove());
    return (clone.textContent ?? '').trim();
  };
  const handleBubbleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;

    const codeBtn = target.closest('.code-copy-btn');
    if (codeBtn) {
      const code = codeBtn.closest('.rt-codeblock')?.querySelector('pre code');
      if (!code) return;
      void navigator.clipboard.writeText(code.textContent ?? '');
      flashCopied(codeBtn, '✓ コピー済み', '⎘ コピー');
      return;
    }

    const secBtn = target.closest('.section-copy-btn');
    if (secBtn) {
      const heading = secBtn.closest('h1, h2, h3');
      if (!heading) return;
      const level = Number(heading.tagName[1]);
      const parts = [cleanText(heading)];
      let sib = heading.nextElementSibling;
      while (sib) {
        const tag = sib.tagName.toLowerCase();
        const m = tag.match(/^h([1-6])$/);
        if (m && Number(m[1]) <= level) break;
        const txt = cleanText(sib);
        if (txt) parts.push(txt);
        sib = sib.nextElementSibling;
      }
      void navigator.clipboard.writeText(parts.join('\n\n'));
      flashCopied(secBtn, '✓', '⎘');
      return;
    }
  };

  const renderBlock = (block: InsertableBlock) =>
    block.type === 'folder_create' || block.type === 'note_move' ? (
      <FolderActionCard key={block.id} block={block} allNotes={allNotes} />
    ) : (
      <InsertableBlockCard
        key={block.id}
        block={block}
        allNotes={allNotes}
        defaultNoteId={selectedNoteId}
        onNoteCreated={onNoteCreated}
      />
    );

  return (
    <div className="lily-bubble-row">
      <div className="lily-avatar">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={avatarSrc} alt={avatarAlt} className="avatar-img" />
      </div>
      <div className="lily-bubble-wrap">
        <div className="lily-bubble" onClick={handleBubbleClick}>
          {inlineParts.map((p, i) =>
            p.kind === 'text' ? (
              <div
                key={`t-${i}`}
                className="rt-body"
                dangerouslySetInnerHTML={{ __html: renderRich(p.value) }}
              />
            ) : (
              <div key={p.id} className="inline-block-wrap">
                {renderBlock(blockMap.get(p.id)!)}
              </div>
            )
          )}
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
        {(orphanBlocks.length > 0 || fileBlocks.length >= 2) && (
          <div className="block-list">
            {orphanBlocks.map(renderBlock)}
            {fileBlocks.length >= 2 && (
              <ZipDownloadButton blocks={fileBlocks} />
            )}
          </div>
        )}
        <div className="msg-actions">
          <CopyButton text={copyText} />
          {onRegenerate && (
            <button className="msg-regen-btn" onClick={onRegenerate} title="再生成">
              <RotateCcw size={13} />
              <span>再生成</span>
            </button>
          )}
        </div>
      </div>
      <style jsx>{`
        .lily-bubble-row { display: flex; align-items: flex-start; gap: 10px; align-self: flex-start; max-width: 85%; }
        .lily-avatar { flex-shrink: 0; width: 36px; height: 36px; border-radius: 50%; overflow: hidden; background: var(--accent); border: 2px solid var(--border); }
        .avatar-img { width: 100%; height: 100%; object-fit: cover; object-position: top center; }
        .lily-bubble-wrap { flex: 1; min-width: 0; }
        .lily-bubble { background: var(--accent); border: 1px solid var(--border); border-radius: 4px 16px 16px 16px; padding: 10px 14px; font-size: 0.9rem; line-height: 1.65; color: var(--foreground); word-break: break-word; }
        .inline-block-wrap { margin: 8px 0; }
        .inline-block-wrap:first-child { margin-top: 0; }
        .inline-block-wrap:last-child { margin-bottom: 0; }
        .msg-actions { display: flex; align-items: center; gap: 4px; margin-top: 6px; }
        .msg-regen-btn { display: flex; align-items: center; gap: 4px; padding: 3px 8px; border-radius: 6px; border: 1px solid var(--border); background: var(--background); color: var(--fg-muted, #888); font-size: 0.78rem; cursor: pointer; flex-shrink: 0; box-shadow: 0 1px 3px rgba(0,0,0,0.08); transition: background 0.14s, color 0.14s, border-color 0.14s; }
        .msg-regen-btn:hover { border-color: var(--primary); color: var(--primary); background: var(--accent); }
        .rt-body :global(p) { margin: 0 0 0.75em; }
        .rt-body :global(p:last-child) { margin-bottom: 0; }
        .rt-body :global(h1) { font-size: 1.2rem; font-weight: 800; margin: 1em 0 0.45em; color: var(--primary); border-left: 4px solid var(--primary); background: color-mix(in srgb, var(--primary) 8%, transparent); border-radius: 0 6px 6px 0; padding: 5px 10px 5px 12px; }
        .rt-body :global(h2) { font-size: 1.05rem; font-weight: 700; margin: 0.8em 0 0.32em; color: var(--primary); border-left: 3px solid color-mix(in srgb, var(--primary) 55%, transparent); padding-left: 10px; }
        .rt-body :global(h3) { font-size: 0.95rem; font-weight: 700; margin: 0.65em 0 0.25em; color: var(--primary); opacity: 0.9; }
        .rt-body :global(h3::before) { content: "▸ "; font-size: 0.78em; }
        .rt-body :global(ul) { margin: 0.4em 0; padding-left: 0; list-style: none; }
        .rt-body :global(ul li) { margin: 0.28em 0; padding-left: 1.35em; position: relative; }
        .rt-body :global(ul li::before) { content: ""; position: absolute; left: 0.32em; top: 0.57em; width: 7px; height: 7px; border-radius: 50%; background: var(--primary); opacity: 0.7; }
        .rt-body :global(ul ul) { margin: 0.12em 0; }
        .rt-body :global(ul ul li::before) { width: 5px; height: 5px; background: transparent; border: 1.5px solid color-mix(in srgb, var(--primary) 80%, transparent); top: 0.61em; left: 0.34em; opacity: 1; }
        .rt-body :global(ol) { margin: 0.4em 0; padding-left: 1.5em; }
        .rt-body :global(ol li) { margin: 0.28em 0; }
        .rt-body :global(li) { line-height: 1.7; }
        .rt-body :global(strong) { font-weight: 800; color: color-mix(in srgb, var(--primary) 65%, var(--foreground)); }
        .rt-body :global(em) { font-style: italic; opacity: 0.9; }
        .rt-body :global(del) { text-decoration: line-through; opacity: 0.55; }
        .rt-body :global(a) { color: var(--primary); text-decoration: underline; text-underline-offset: 2px; transition: opacity 0.12s; }
        .rt-body :global(a:hover) { opacity: 0.72; }
        .rt-body :global(blockquote) { border-left: 4px solid var(--primary); margin: 0.75em 0; padding: 0.5em 1em; background: color-mix(in srgb, var(--primary) 7%, var(--background)); border-radius: 0 8px 8px 0; color: var(--foreground); font-style: italic; }
        .rt-body :global(.rt-mark) { background: color-mix(in srgb, var(--primary) 22%, transparent); padding: 0 3px; border-radius: 3px; }
        .rt-body :global(.section-copy-btn) { opacity: 0.4; margin-left: 6px; vertical-align: baseline; background: transparent; border: none; color: var(--primary); cursor: pointer; font-size: 0.78em; padding: 0 3px; line-height: 1; transition: opacity 0.15s, color 0.15s; }
        .rt-body :global(h1:hover .section-copy-btn), .rt-body :global(h2:hover .section-copy-btn), .rt-body :global(h3:hover .section-copy-btn) { opacity: 0.85; }
        .rt-body :global(.section-copy-btn:hover) { opacity: 1; }
        .rt-body :global(.section-copy-btn.copied) { opacity: 1; color: #22863a; }
        .rt-body :global(.rt-callout) { margin: 0.7em 0; border: 1px solid var(--border); border-left-width: 4px; border-radius: 8px; padding: 8px 12px; background: var(--background); }
        .rt-body :global(.rt-callout-head) { font-weight: 800; font-size: 0.82rem; margin-bottom: 4px; display: flex; align-items: center; gap: 5px; }
        .rt-body :global(.rt-callout-body) { font-size: 0.86rem; }
        .rt-body :global(.rt-callout-body > :first-child) { margin-top: 0; }
        .rt-body :global(.rt-callout-body > :last-child) { margin-bottom: 0; }
        .rt-body :global(.rt-callout-note) { border-left-color: #1976d2; background: rgba(25,118,210,0.06); }
        .rt-body :global(.rt-callout-note .rt-callout-head) { color: #1976d2; }
        .rt-body :global(.rt-callout-tip) { border-left-color: #2e7d32; background: rgba(46,125,50,0.06); }
        .rt-body :global(.rt-callout-tip .rt-callout-head) { color: #2e7d32; }
        .rt-body :global(.rt-callout-important) { border-left-color: #7b1fa2; background: rgba(123,31,162,0.06); }
        .rt-body :global(.rt-callout-important .rt-callout-head) { color: #7b1fa2; }
        .rt-body :global(.rt-callout-warning) { border-left-color: #f9a825; background: rgba(249,168,37,0.08); }
        .rt-body :global(.rt-callout-warning .rt-callout-head) { color: #c77800; }
        .rt-body :global(.rt-callout-caution) { border-left-color: #c62828; background: rgba(198,40,40,0.06); }
        .rt-body :global(.rt-callout-caution .rt-callout-head) { color: #c62828; }
        .rt-body :global(hr) { border: none; height: 1px; margin: 0.9em 0; background: linear-gradient(to right, transparent, var(--primary), transparent); opacity: 0.35; }
        .rt-body :global(table) { border-collapse: collapse; margin: 0.65em 0; font-size: 0.85rem; width: 100%; }
        .rt-body :global(thead tr) { background: var(--primary); color: white; }
        .rt-body :global(th) { border: 1px solid var(--primary); padding: 6px 12px; font-weight: 700; text-align: left; }
        .rt-body :global(td) { border: 1px solid var(--border); padding: 5px 12px; }
        .rt-body :global(tbody tr:nth-child(even)) { background: rgba(0,0,0,0.03); }
        .rt-body :global(tbody tr:hover) { background: color-mix(in srgb, var(--primary) 7%, transparent); transition: background 0.12s; }
        .rt-body :global(.rt-code) { background: rgba(0,0,0,0.07); border: 1px solid var(--border); border-radius: 4px; padding: 1px 6px; font-size: 0.83em; font-family: 'Fira Code','Consolas',monospace; color: var(--primary); }
        .rt-body :global(.rt-codeblock) { margin: 0.6em 0; border-radius: 10px; overflow: hidden; background: #1a1a2e; border: 1px solid rgba(255,255,255,0.07); }
        .rt-body :global(.rt-pre-head) { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 5px 8px 5px 14px; background: rgba(255,255,255,0.045); border-bottom: 1px solid rgba(255,255,255,0.07); }
        .rt-body :global(.rt-pre-lang) { font-size: 0.62rem; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; color: #8b95b3; }
        .rt-body :global(.code-copy-btn) { display: inline-flex; align-items: center; gap: 4px; background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.12); color: #c7d0e8; font-size: 0.66rem; font-weight: 700; padding: 3px 9px; border-radius: 6px; cursor: pointer; transition: background 0.15s, color 0.15s, border-color 0.15s; }
        .rt-body :global(.code-copy-btn:hover) { background: var(--primary); color: #fff; border-color: var(--primary); }
        .rt-body :global(.code-copy-btn.copied) { background: #22863a; color: #fff; border-color: #22863a; }
        .rt-body :global(.rt-pre) { position: relative; background: transparent; border: none; border-radius: 0; padding: 12px 16px 14px; overflow: visible; margin: 0; }
        .rt-body :global(.rt-pre code) { display: block; font-size: 0.82rem; font-family: 'Fira Code','Cascadia Code','Consolas',monospace; white-space: pre; color: #e2e8f0; line-height: 1.75; overflow-x: auto; padding-bottom: 2px; }
        .rt-body :global(.hljs-keyword) { color: #c792ea; }
        .rt-body :global(.hljs-string) { color: #c3e88d; }
        .rt-body :global(.hljs-comment) { color: #546e7a; font-style: italic; }
        .rt-body :global(.hljs-number) { color: #f78c6c; }
        .rt-body :global(.hljs-function,.hljs-title.function_) { color: #82aaff; }
        .rt-body :global(.hljs-built_in,.hljs-class,.hljs-title.class_) { color: #ffcb6b; }
        .rt-body :global(.hljs-variable,.hljs-attr) { color: #f07178; }
        .rt-body :global(.hljs-type) { color: #c792ea; }
        .rt-body :global(.hljs-operator,.hljs-punctuation) { color: #89ddff; }
        .rt-body :global(.hljs-literal,.hljs-symbol) { color: #89ddff; }
        .rt-body :global(.hljs-meta) { color: #80cbc4; }
        .rt-body :global(.hljs-tag) { color: #f07178; }
        .rt-body :global(.hljs-name) { color: #82aaff; }
        .rt-body :global(.hljs-property) { color: #80cbc4; }
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

// 18-frame boxing combo looped while Lily is thinking.
const BOXING_FRAMES = [
  '/sikun-box-01.png', '/sikun-box-02.png', '/sikun-box-03.png', '/sikun-box-04.png',
  '/sikun-box-05.png', '/sikun-box-06.png', '/sikun-box-07.png', '/sikun-box-08.png',
  '/sikun-box-09.png', '/sikun-box-10.png', '/sikun-box-11.png', '/sikun-box-12.png',
  '/sikun-box-13.png', '/sikun-box-14.png', '/sikun-box-15.png', '/sikun-box-16.png',
  '/sikun-box-17.png', '/sikun-box-18.png',
];
const BOXING_FRAME_MS = 165;

function TypingIndicator() {
  return (
    <div className="typing-row">
      <div className="typing-bubble">
        <span className="dot" /><span className="dot" /><span className="dot" />
      </div>
      <style jsx>{`
        .typing-row { display: flex; align-items: center; gap: 8px; align-self: flex-start; }
        .typing-bubble { background: var(--accent); border: 1px solid var(--border); border-radius: 4px 16px 16px 16px; padding: 12px 16px; display: flex; gap: 5px; align-items: center; }
        .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--primary); animation: bounce 1.2s infinite ease-in-out; }
        .dot:nth-child(2) { animation-delay: 0.2s; }
        .dot:nth-child(3) { animation-delay: 0.4s; }
        @keyframes bounce { 0%, 80%, 100% { transform: translateY(0); opacity: 0.4; } 40% { transform: translateY(-6px); opacity: 1; } }
      `}</style>
    </div>
  );
}

// Floating thinking animation pinned to the bottom-right of the screen while
// Floating thinking animation while Lily is generating. Layered
// above the chat; pointer-events off so it never blocks taps underneath.
function BoxingOverlay() {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setFrame(f => (f + 1) % BOXING_FRAMES.length), BOXING_FRAME_MS);
    return () => window.clearInterval(id);
  }, []);
  return (
    <div className="boxing-overlay" aria-hidden>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={BOXING_FRAMES[frame]} alt="" className="boxing-img" />
      <div className="boxing-preload">
        {BOXING_FRAMES.map(src => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={src} src={src} alt="" />
        ))}
      </div>
      <style jsx>{`
        .boxing-overlay {
          position: fixed; right: 10px; bottom: 150px;
          width: 104px; height: 104px; z-index: 4000;
          pointer-events: none;
        }
        .boxing-img {
          width: 100%; height: 100%; object-fit: contain;
          filter: drop-shadow(0 3px 8px rgba(0,0,0,0.25));
        }
        .boxing-preload { position: absolute; width: 0; height: 0; overflow: hidden; opacity: 0; }
      `}</style>
    </div>
  );
}

function ChatHistoryModal({ onClose, onLoad }: { onClose: () => void; onLoad: (c: SavedChat) => void }) {
  const chats = useLiveQuery(() => db.savedChats.orderBy('createdAt').reverse().toArray(), []);
  return (
    <div className="history-overlay" onClick={onClose}>
      <div className="history-modal" onClick={e => e.stopPropagation()}>
        <div className="history-head">
          <span className="history-head-title"><History size={16} /> 保存した会話</span>
          <button className="history-close" onClick={onClose} title="閉じる"><X size={18} /></button>
        </div>
        <div className="history-list">
          {(!chats || chats.length === 0) && (
            <div className="history-empty">保存した会話はまだないよ。<br />会話上部の保存ボタン（💾）で残せるよ。</div>
          )}
          {chats?.map(c => (
            <div key={c.id} className="history-item">
              <button className="history-item-main" onClick={() => onLoad(c)}>
                <span className="history-badge lily">Lily</span>
                <span className="history-texts">
                  <span className="history-title">{c.title}</span>
                  <span className="history-meta">
                    {new Date(c.createdAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}・{c.count}件
                  </span>
                </span>
              </button>
              <button className="history-del" onClick={() => { if (c.id != null) deleteSavedChat(c.id); }} title="削除">
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
        <style jsx>{`
          .history-overlay { position: fixed; inset: 0; z-index: 5000; background: rgba(0,0,0,0.45); display: flex; align-items: center; justify-content: center; padding: 16px; }
          .history-modal { background: var(--background); border: 1px solid var(--border); border-radius: 16px; width: 100%; max-width: 460px; max-height: 80vh; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 12px 40px rgba(0,0,0,0.3); }
          .history-head { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px; border-bottom: 1px solid var(--border); }
          .history-head-title { display: flex; align-items: center; gap: 7px; font-weight: 700; font-size: 0.98rem; color: var(--foreground); }
          .history-close { width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; border-radius: 8px; color: var(--fg-muted); cursor: pointer; }
          .history-close:hover { background: var(--accent); }
          .history-list { overflow-y: auto; padding: 8px; display: flex; flex-direction: column; gap: 6px; }
          .history-empty { text-align: center; color: var(--fg-muted); font-size: 0.85rem; line-height: 1.7; padding: 32px 12px; }
          .history-item { display: flex; align-items: stretch; gap: 6px; }
          .history-item-main { flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px; padding: 10px 12px; background: var(--accent); border: 1px solid var(--border); border-radius: 10px; cursor: pointer; text-align: left; transition: background 0.15s; }
          .history-item-main:hover { background: var(--border); }
          .history-badge { flex-shrink: 0; font-size: 0.66rem; font-weight: 800; padding: 3px 7px; border-radius: 6px; }
          .history-badge.lily { color: var(--primary); background: color-mix(in srgb, var(--primary) 14%, transparent); }
          .history-texts { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
          .history-title { font-size: 0.88rem; font-weight: 600; color: var(--foreground); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
          .history-meta { font-size: 0.72rem; color: var(--fg-muted); }
          .history-del { flex-shrink: 0; width: 40px; display: flex; align-items: center; justify-content: center; border: 1px solid var(--border); border-radius: 10px; color: #ef4444; background: transparent; cursor: pointer; transition: background 0.15s; }
          .history-del:hover { background: rgba(239,68,68,0.1); }
        `}</style>
      </div>
    </div>
  );
}

// Tone/style modes: tapping toggles the mode ON; while ON, every message
// you send is answered in that style (until you tap it off).
const MODES: { id: string; label: string; directive: string }[] = [
  { id: 'formal', label: '🎚️ フォーマル', directive: 'フォーマルで丁寧なトーンで答えて。' },
  { id: 'casual', label: '😊 カジュアル', directive: '親しみやすいカジュアルなトーンで答えて。' },
  { id: 'concise', label: '⚡ 簡潔に', directive: '要点だけを簡潔に短く答えて。' },
  { id: 'detailed', label: '📚 くわしく', directive: '背景や具体例も交えて、くわしく丁寧に説明して。' },
  { id: 'easy', label: '🍼 やさしく', directive: '専門用語を避けて、初心者にもわかるやさしい言葉で説明して。' },
  { id: 'socratic', label: '🧠 ソクラテス式', directive: '答えを直接教えず、ヒントや誘導質問でユーザー自身が気づけるよう導いてください（ソクラテス式対話）。間違いがあっても正解を言わず、「なぜそう思う？」「別の見方は？」など考えるきっかけの質問を返してください。' },
  { id: 'interviewer', label: '😈 面接官', directive: 'あなたは意地悪で容赦ない面接官です。ユーザーが説明や回答をするたびに「それって本当に理解してますか？」「もっと具体的に言ってください」「その根拠は？」「曖昧すぎます」など厳しく突っ込んでください。知識の穴や矛盾を積極的に突き、ごまかしや浅い理解は即座に見抜いて指摘してください。褒めるのは本当に正確・深い説明のときだけにして、それ以外は容赦なく圧をかけてください。ただし最終的には学習者のためになることを意識してください。' },
  { id: 'student', label: '🙋 生徒役', directive: 'あなたは何も知らない生徒です。ユーザーが先生役となって説明してくれます。あなたは授業を受ける無知な生徒として振る舞い、「それってどういう意味ですか？」「なんでそうなるんですか？」「もっとわかりやすく教えてください」「〇〇って何ですか？」のように素朴な疑問をどんどん投げかけてください。専門用語が出たら必ず「それ何ですか？」と聞き返してください。ユーザーが説明に詰まったり、説明が曖昧なときは「よくわかりませんでした…」と正直に伝えてください。ユーザーが本当に理解しているかを説明させることで確認するのが目的です。' },
];

// One-tap actions: sending a prompt immediately.
const QUICK_ACTIONS: { label: string; prompt: string }[] = [
  { label: '📚 日これ', prompt: 'これらの資料から問題(qa)を作成して。単語を問う問題形式で全ての単語を網羅してください。また、時系列順に並べてください。\n答えには読み方をふってください。\n\n【絶対厳守】資料に含まれる全ての単語を1つも漏らさず必ず全て問題にすること。「など」「以下省略」「…」で途中で止めることは禁止。最後の単語まで出力すること。' },
  { label: '▶ 続きを書いて', prompt: '問題が途中で止まっています。続きの未出題の単語を全て、同じ形式・同じqaブロック内で続けて出力してください。重複は入れず、まだ出題されていない単語だけを残らず書いてください。' },
  { label: '📧 メール文面', prompt: 'このメモの内容を元に、そのまま送れる丁寧なメールの下書きを作って。件名も付けてね。' },
  { label: '📝 ブログ案', prompt: 'このメモを元に、ブログ記事のタイトル案を3つと、それぞれの構成案を提案して。' },
  { label: '🔎 詳しく調べて', prompt: 'このメモに出てくる専門用語や関連トピックを、ネットの情報も使ってもう少し詳しく補足して。' },
];

// 英単語帳画像から穴埋め例文を作るプロンプト。画像添付が必要なので
// 送信ではなく入力欄に挿入する（ユーザーが画像を添付してから送る）。
const ENGLISH_VOCAB_PROMPT = `この英単語帳の画像を解析して、qaか穴埋めの問題を作成してください。qaか穴埋め問題かはユーザーに必ず質問をすること。
以下のルールを厳守して出力してください。
フォーマット: 問題の出力番号.[英文の例文] [その日本語翻訳文] を1セットとする。また、隠された単語を答えとして1,2,3,のように該当の問題の番号をふる。
穴埋め問題化: 画像内で「赤色」で書かれている英単語は、テストに出る重要部分です。その部分は必ず [____] という空欄に置き換えて出力してください。空欄の先頭に答えの1文字目を事前に記述する。
不要な情報の除外: 単語の番号（1011など）、発音記号、品詞ラベル、見出し語単体などは含めず、純粋に「例文」と「訳」のペアだけを抽出してください。
出力例:
問題
1.Be careful! That glass is close to the [e____] of the table. 気をつけて！グラスがテーブルの端に近いよ。
2. . . . . 続く
答え
1.edge
2. 続く
そして生成した内容を問題セッションを問題に、答えのセッションを答えに挿入し、qaか穴埋め問題のどちらかの問題形式の問題を作成してください。`;

export default function AIChat({ onOpenSettings, onSwitchTab, onNoteCreated }: AIChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [lilyAllNotes, setLilyAllNotes] = useState(false);
  const [lilyNoteIds, setLilyNoteIds] = useState<number[]>([]);
  const [lilyThinking, setLilyThinking] = useState(false);
  const [showContextPanel, setShowContextPanel] = useState(false);
  const [apiKey, setApiKey] = useState<string>('');
  const [attachments, setAttachments] = useState<AttachmentMeta[]>([]);
  const [fileError, setFileError] = useState('');
  const [webSearch, setWebSearch] = useState(false);
  const [activeMode, setActiveMode] = useState<string | null>(null);
  const [questionQueue, setQuestionQueue] = useState<ClarifyQuestion[]>([]);
  const [collectedAnswers, setCollectedAnswers] = useState<{ q: string; a: string }[]>([]);
  const [sikunProgress, setSikunProgress] = useState<string>('');
  const [sikunLiveThinking, setSikunLiveThinking] = useState<string>('');
  const pendingThinkingRef = useRef<string>('');
  const [showHelp, setShowHelp] = useState(false);
  const [helpInitialTab, setHelpInitialTab] = useState<'lily' | 'cost'>('lily');
  const [economy, setEconomy] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [savedToast, setSavedToast] = useState(false);
  const [showLectureRecorder, setShowLectureRecorder] = useState(false);
  const [showVoiceChat, setShowVoiceChat] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const allNotes = useLiveQuery(
    () => db.notes.filter(n => !n.deletedAt && n.type !== 'handwriting').toArray(),
    []
  );
  useEffect(() => {
    setApiKey(localStorage.getItem('lily_gemini_api_key') || '');
    setEconomy(localStorage.getItem('lily_economy_mode') === '1');
  }, []);

  const toggleEconomy = useCallback(() => {
    setEconomy(prev => {
      const next = !prev;
      try { localStorage.setItem('lily_economy_mode', next ? '1' : '0'); } catch {}
      return next;
    });
  }, []);

  useEffect(() => {
    const last = messages[messages.length - 1];
    if (last?.role === 'lily' && last.questions && last.questions.length > 0) {
      setQuestionQueue(last.questions);
      setCollectedAnswers([]);
    }
  }, [messages]);

  const handleSaveChat = useCallback(async () => {
    if (messages.length === 0) return;
    await saveChat('lily', messages);
    setSavedToast(true);
    setTimeout(() => setSavedToast(false), 1800);
  }, [messages]);

  const handleLoadChat = useCallback((chat: SavedChat) => {
    const loaded = parseSavedMessages<ChatMessage>(chat);
    setMessages(loaded);
    setQuestionQueue([]);
    setCollectedAnswers([]);
    setShowHistory(false);
  }, []);

  const handleLectureComplete = useCallback((summary: string) => {
    setShowLectureRecorder(false);
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      text: '📖 授業録音が終わりました。まとめをチャットに表示してください。',
      timestamp: Date.now(),
    };
    const { textContent, blocks, questions } = parseAIResponse(summary, true);
    const lilyMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'lily',
      text: textContent || '授業まとめを作成しました！',
      timestamp: Date.now(),
      extractedBlocks: blocks.length > 0 ? blocks : undefined,
      questions: questions.length > 0 ? questions : undefined,
    };
    setMessages(prev => [...prev, userMsg, lilyMsg]);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const autoResizeTextarea = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
  };

  // Preset shortcuts fill the input (not auto-send) so the user can tweak
  // the prompt or attach an image before sending.
  const fillInput = (text: string) => {
    setInput(text);
    requestAnimationFrame(() => { textareaRef.current?.focus(); autoResizeTextarea(); });
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
      if (lilyAllNotes) {
        contextNotes.push(...(allNotes ?? []));
      } else {
        for (const id of lilyNoteIds) {
          const n = await db.notes.get(id);
          if (n) contextNotes.push(n);
        }
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
      if (lilyThinking && !economy) {
        setSikunLiveThinking('');
        let thinkingAccum = '';
        setSikunProgress('🧠 思考中...');
        aiText = await streamSikunlilyChat(
          history,
          systemPrompt,
          apiKey,
          2048,
          {
            onThinkingDelta: (delta) => {
              thinkingAccum += delta;
              setSikunLiveThinking(thinkingAccum);
            },
            onResponseDelta: () => {
              setSikunProgress('✍️ 回答を生成中...');
            },
          },
          ['gemini-2.5-flash', 'gemini-2.5-flash-lite'],
          webSearch,
          65536,
        );
        setSikunProgress('');
        setSikunLiveThinking('');
        pendingThinkingRef.current = thinkingAccum;
      } else {
        aiText = await callGeminiChat(history, systemPrompt, apiKey, {
          webSearch,
          models: economy ? ['gemini-2.5-flash-lite'] : undefined,
          maxOutputTokens: economy ? 8192 : undefined,
        });
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
  }, [input, attachments, isLoading, apiKey, messages, lilyAllNotes, lilyNoteIds, lilyThinking, allNotes, webSearch, activeMode, economy]);

  const handleRegenerate = useCallback(async () => {
    if (isLoading) return;

    // Find the last lily message
    let lilyIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'lily') { lilyIdx = i; break; }
    }
    if (lilyIdx < 0) return;

    // Capture the history to send (everything before the last lily response)
    const histMsgs = messages.slice(0, lilyIdx);
    const recentMsgs = histMsgs.slice(-10);
    const lastUserIdx = recentMsgs.reduce(
      (acc, m, idx) => (m.role === 'user' && m.attachments?.length ? idx : acc), -1
    );
    const history: ChatTurn[] = recentMsgs.map((m, idx) => {
      const turn: ChatTurn = { role: m.role === 'user' ? 'user' : 'model', text: m.text };
      if (idx === lastUserIdx && m.attachments?.length) {
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

    // Remove the last lily message from display
    setMessages(prev => prev.slice(0, lilyIdx));
    setIsLoading(true);

    try {
      const contextNotes: Note[] = [];
      if (lilyAllNotes) {
        contextNotes.push(...(allNotes ?? []));
      } else {
        for (const id of lilyNoteIds) {
          const n = await db.notes.get(id);
          if (n) contextNotes.push(n);
        }
      }

      let aiText: string;
      if (lilyThinking && !economy) {
        const systemPrompt = buildSystemPrompt(contextNotes);
        setSikunLiveThinking('');
        let thinkingAccum = '';
        setSikunProgress('🧠 思考中...');
        aiText = await streamSikunlilyChat(
          history,
          systemPrompt,
          apiKey,
          2048,
          {
            onThinkingDelta: (delta) => {
              thinkingAccum += delta;
              setSikunLiveThinking(thinkingAccum);
            },
            onResponseDelta: () => {
              setSikunProgress('✍️ 回答を生成中...');
            },
          },
          ['gemini-2.5-flash', 'gemini-2.5-flash-lite'],
          webSearch,
          65536,
        );
        setSikunProgress('');
        setSikunLiveThinking('');
        pendingThinkingRef.current = thinkingAccum;
      } else {
        const systemPrompt = buildSystemPrompt(contextNotes);
        aiText = await callGeminiChat(history, systemPrompt, apiKey, {
          webSearch,
          models: economy ? ['gemini-2.5-flash-lite'] : undefined,
          maxOutputTokens: economy ? 8192 : undefined,
        });
      }

      const { textContent, blocks, questions } = parseAIResponse(aiText, true);
      const capturedThinking = pendingThinkingRef.current;
      pendingThinkingRef.current = '';
      setMessages(prev => [...prev, {
        id: crypto.randomUUID(),
        role: 'lily',
        text: textContent || (questions.length > 0 ? `${questions.map(q => q.question).join('\n')}\n\n下のフォームから教えてね！🐶` : '...'),
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
  }, [isLoading, messages, allNotes, lilyAllNotes, lilyNoteIds, lilyThinking, activeMode, economy, apiKey, webSearch]);

  const lilyDefaultNoteId = lilyNoteIds[0];

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
            Gemini API キーを設定すると、メモの分析・図やグラフの作成・問題作りをお手伝いできるよ！
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
        {onSwitchTab && (
          <button className="chat-back-btn" onClick={() => onSwitchTab('memos')} title="メモに戻る">
            <ArrowLeft size={20} />
          </button>
        )}
        <div className="header-left">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/9D507C9A-09F0-4B05-9F41-612FBD120675.png"
            alt="Lily"
            className="header-avatar"
          />
          <div>
            <div className="header-title">Lily</div>
            <div className="header-sub">AIアシスタント ✨</div>
          </div>
        </div>
        <div className="header-right">
          <button
            className={`web-toggle eco-toggle ${economy ? 'on' : ''}`}
            onClick={toggleEconomy}
            title="節約モード: 思考を抑えて軽量モデル(flash-lite)で答え、APIコストを大幅に削減する"
          >
            <span style={{ fontSize: '11px' }}>🌱</span>
            <span className="web-label">節約モード</span>
            <span className="web-state">{economy ? 'ON' : 'OFF'}</span>
          </button>
          {!economy && (
            <button
              className={`web-toggle thinking-toggle ${lilyThinking ? 'on' : ''}`}
              onClick={() => setLilyThinking(p => !p)}
              title="思考モード: Geminiの拡張思考機能でじっくり考えてから答えるよ（APIコスト増）"
            >
              <span style={{ fontSize: '11px' }}>🧠</span>
              <span className="web-label">思考モード</span>
              <span className="web-state">{lilyThinking ? 'ON' : 'OFF'}</span>
            </button>
          )}
          <button
            className={`web-toggle ${webSearch ? 'on' : ''}`}
            onClick={() => setWebSearch(p => !p)}
            title="ネット検索をON/OFF。ONにすると最新情報も調べて答えるよ"
          >
            <Search size={13} />
            <span className="web-label">ネット検索</span>
            <span className="web-state">{webSearch ? 'ON' : 'OFF'}</span>
          </button>
          <button className="context-toggle" onClick={() => setShowContextPanel(p => !p)} title="メモを選択">
            <span className={`context-chip${lilyAllNotes || lilyNoteIds.length > 0 ? ' selected' : ''}`}>
              {lilyAllNotes ? '📚 全メモ参照中' : lilyNoteIds.length > 0 ? `📄 ${lilyNoteIds.length}件選択中` : 'メモを選ぶ'}
              {showContextPanel ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </span>
          </button>
          {messages.length > 0 && (
            <button className="clear-btn" onClick={handleSaveChat} title="この会話を保存">
              <Save size={15} />
            </button>
          )}
          <button className="clear-btn" onClick={() => setShowHistory(true)} title="保存した会話の履歴">
            <History size={15} />
          </button>
          {messages.length > 0 && (
            <button className="clear-btn" onClick={() => setMessages([])} title="会話をリセット">
              <RotateCcw size={15} />
            </button>
          )}
          <button
            className="help-btn"
            onClick={() => { setHelpInitialTab('lily'); setShowHelp(true); }}
            title="使い方ガイド"
          >
            <HelpCircle size={16} />
          </button>
        </div>
      </div>
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} initialTab={helpInitialTab} />}
      {showHistory && <ChatHistoryModal onClose={() => setShowHistory(false)} onLoad={handleLoadChat} />}
      {savedToast && <div className="chat-saved-toast">会話を保存しました ✓</div>}
      {showLectureRecorder && (
        <LectureRecorder
          apiKey={apiKey}
          onClose={() => setShowLectureRecorder(false)}
          onComplete={handleLectureComplete}
        />
      )}
      {showVoiceChat && (
        <VoiceChat
          apiKey={apiKey}
          systemPrompt={
            buildSystemPrompt(
              lilyAllNotes
                ? (allNotes ?? [])
                : (allNotes ?? []).filter(n => lilyNoteIds.includes(n.id!))
            ) + (activeMode ? `\n\n（${MODES.find(m => m.id === activeMode)?.directive ?? ''}）` : '')
          }
          modeLabel={MODES.find(m => m.id === activeMode)?.label}
          onClose={() => setShowVoiceChat(false)}
        />
      )}

      {showContextPanel && (
        <div className="context-panel">
          <button
            className={`note-chip${lilyAllNotes ? ' active' : ''}`}
            onClick={() => { setLilyAllNotes(true); setLilyNoteIds([]); setShowContextPanel(false); }}
          >
            📚 全メモを参照
          </button>
          <button
            className={`note-chip${!lilyAllNotes && lilyNoteIds.length === 0 ? ' active' : ''}`}
            onClick={() => { setLilyAllNotes(false); setLilyNoteIds([]); setShowContextPanel(false); }}
          >
            なし
          </button>
          {allNotes?.map(n => (
            <button
              key={n.id}
              className={`note-chip${lilyNoteIds.includes(n.id!) ? ' active' : ''}`}
              onClick={() => {
                setLilyAllNotes(false);
                setLilyNoteIds(prev =>
                  prev.includes(n.id!) ? prev.filter(id => id !== n.id) : [...prev, n.id!]
                );
              }}
            >
              {lilyNoteIds.includes(n.id!) ? '✓ ' : ''}{n.title || '無題のメモ'}
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
                src="/9D507C9A-09F0-4B05-9F41-612FBD120675.png"
                alt="Lily"
                className="welcome-lily"
              />
            </div>
            <p className="welcome-text">
              こんにちは、Lily だよ！🐶<br />メモの要約・翻訳・メール作成・問題づくり・図やグラフの作成まで、文章でお願いするだけ。
            </p>

            <button
              className="welcome-guide-btn"
              onClick={() => { setHelpInitialTab('lily'); setShowHelp(true); }}
            >
              <span className="welcome-guide-main"><HelpCircle size={18} /> 使い方ガイドを見る</span>
            </button>
          </div>
        )}
        {messages.map((msg, idx) => {
          const isLastLily = msg.role === 'lily' &&
            !messages.slice(idx + 1).some(m => m.role === 'lily');
          return msg.role === 'user' ? (
            <UserBubble key={msg.id} message={msg} />
          ) : (
            <LilyBubble
              key={msg.id}
              message={msg}
              allNotes={allNotes ?? []}
              selectedNoteId={lilyDefaultNoteId}
              model="lily"
              onNoteCreated={onNoteCreated}
              onRegenerate={isLastLily && !isLoading ? handleRegenerate : undefined}
            />
          );
        })}
        {isLoading && (
          <>
            <TypingIndicator />
            <BoxingOverlay />
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
          <button className="ai-nav-item" onClick={() => onSwitchTab('study')}><GraduationCap size={22} /><span>学習</span></button>
          <button className="ai-nav-item" onClick={() => { onSwitchTab('settings'); onOpenSettings(); }}><SettingsIcon size={22} /><span>設定</span></button>
        </nav>
      )}

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

      {/* Quick actions */}
      <div className="quick-actions">
        <Wand2 size={14} className="qa-wand" />
        {QUICK_ACTIONS.map(a => (
          <button key={a.label} className="quick-chip" onClick={() => fillInput(a.prompt)} disabled={isLoading}>
            {a.label}
          </button>
        ))}
        <button
          className="quick-chip"
          onClick={() => fillInput(ENGLISH_VOCAB_PROMPT)}
          disabled={isLoading}
          title="英単語帳の画像を添付してから送ると、穴埋め例文を作るよ"
        >
          🔤 英単語帳→問題
        </button>
      </div>

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
        <button
          className="attach-btn lecture-btn"
          onClick={() => setShowLectureRecorder(true)}
          disabled={isLoading}
          title="授業リアルタイム要約 — 音声を文字起こし→Geminiでまとめ"
        >
          <Mic size={20} />
        </button>
        <button
          className="attach-btn voice-chat-btn"
          onClick={() => setShowVoiceChat(true)}
          disabled={isLoading}
          title="音声対話 — Lily と声で会話する"
        >
          <Phone size={20} />
        </button>
        <textarea
          ref={textareaRef}
          className="chat-input"
          placeholder="Lily に話しかける...（Enter で改行 / 送信はボタン）"
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
        .chat-back-btn { display: flex; align-items: center; justify-content: center; width: 34px; height: 34px; border-radius: 10px; background: var(--accent); border: 1px solid var(--border); color: var(--foreground); cursor: pointer; flex-shrink: 0; transition: opacity 0.15s; }
        .chat-back-btn:hover { opacity: 0.75; }
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
        .chat-saved-toast { position: fixed; left: 50%; bottom: 120px; transform: translateX(-50%); z-index: 6000; background: var(--foreground); color: var(--background); font-size: 0.84rem; font-weight: 700; padding: 10px 18px; border-radius: 999px; box-shadow: 0 4px 16px rgba(0,0,0,0.25); animation: toastIn 0.2s ease; pointer-events: none; }
        @keyframes toastIn { from { opacity: 0; transform: translateX(-50%) translateY(8px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } }
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
        .welcome-guide-btn { display: flex; flex-direction: column; align-items: center; gap: 3px; margin: 6px 0 2px; padding: 13px 28px; border: none; border-radius: 18px; cursor: pointer; color: #fff; background: linear-gradient(135deg, var(--primary), color-mix(in srgb, var(--primary) 55%, #ff9ec4)); box-shadow: 0 6px 18px color-mix(in srgb, var(--primary) 40%, transparent); transition: transform 0.15s, box-shadow 0.15s; animation: guidePulse 2.4s ease-in-out infinite; }
        .welcome-guide-btn.siku { background: linear-gradient(135deg, #a05a2c, #d29156); box-shadow: 0 6px 18px rgba(139,69,19,0.35); }
        .welcome-guide-btn:hover { transform: translateY(-2px); box-shadow: 0 9px 24px color-mix(in srgb, var(--primary) 50%, transparent); }
        .welcome-guide-main { display: inline-flex; align-items: center; gap: 7px; font-weight: 800; font-size: 0.98rem; }
        @keyframes guidePulse { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
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
        .lecture-btn { color: #6366f1; border-color: rgba(99,102,241,0.35); }
        .lecture-btn:hover:not(:disabled) { color: #6366f1; border-color: #6366f1; background: rgba(99,102,241,0.1); }
        .send-btn { flex-shrink: 0; width: 40px; height: 40px; background: var(--primary); color: white; border: none; border-radius: 12px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: opacity 0.15s; }
        .send-btn:disabled { opacity: 0.4; cursor: default; }
        .web-toggle.eco-toggle.on { background: color-mix(in srgb, #16a34a 15%, transparent); border-color: #16a34a; color: #16a34a; }
        .web-toggle.eco-toggle.on .web-state { background: #16a34a; color: white; }
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
