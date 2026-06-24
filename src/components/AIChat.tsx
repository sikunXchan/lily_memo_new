'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Sparkles, Send, ChevronDown, ChevronUp, RotateCcw,
  Paperclip, X, Search,
  FileDown, Wand2, Download, Pencil, ArrowLeft,
  Save, History, Trash2, Mic, Phone, Wrench, MoreVertical, PencilLine,
  NotebookText, Check,
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
  getLastUsage,
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
import { getEffectiveApiKey, getAppLang, getUserName } from '@/lib/appLang';
import { canAfford, deductPoints, getRemainingPoints, getPlan, PT, PLAN_DAILY_POINTS, PLAN_LABEL } from '@/lib/points';
import { useT, translate } from '@/lib/i18n';
import { TONES, SLASH_COMMANDS } from '@/lib/toolboxData';
import { useEnabledTones } from '@/lib/toolbox';
import { ensureSkillsSeeded, skillPromptAddon, type Skill } from '@/lib/skills';
import { useShortcuts } from '@/lib/shortcuts';
import ToolboxModal from '@/components/ToolboxModal';

const LectureRecorder = dynamic(() => import('@/components/LectureRecorder'), { ssr: false });
const VoiceChat = dynamic(() => import('@/components/VoiceChat'), { ssr: false });

ChartJS.register(
  CategoryScale, LinearScale, BarElement, PointElement, LineElement,
  ArcElement, Title, Tooltip, Legend, Filler
);

initMermaid();

const MAX_FILE_BYTES = 12 * 1024 * 1024; // 12MB per file
const MAX_FILES = 5;
// Cap how many notes can be sent as context. "All notes" mode is disabled
// entirely because re-sending every note each turn balloons input token cost.
const MAX_CONTEXT_NOTES = 5;
const ACCEPTED_FILE_TYPES = 'image/png,image/jpeg,image/webp,image/heic,image/heif,application/pdf,text/plain,text/markdown,.md,.txt';

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
  qaChecked?: Record<string, number[]>; // block.id → checked indices
  usage?: { prompt: number; cached: number; output: number; thoughts: number; total: number }; // temp token diagnostic
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
  initialContext?: string;
  onContextConsumed?: () => void;
}

function escHtmlAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function detectMermaidLabel(code: string): string {
  if (/sequenceDiagram/i.test(code)) return translate('シーケンス図');
  if (/classDiagram/i.test(code)) return translate('クラス図');
  if (/gantt/i.test(code)) return translate('ガントチャート');
  if (/pie/i.test(code)) return translate('円グラフ(Mermaid)');
  if (/erDiagram/i.test(code)) return translate('ER図');
  if (/^\s*mindmap/im.test(code)) return translate('マインドマップ');
  if (/graph|flowchart/i.test(code)) return translate('フローチャート');
  return translate('Mermaid図');
}

function detectChartLabel(code: string): string {
  try {
    const p = JSON.parse(code);
    const m: Record<string, string> = { bar: '棒グラフ', line: '折れ線グラフ', pie: '円グラフ', scatter: '散布図' };
    return translate(m[p.type as string] ?? 'グラフ');
  } catch { return translate('グラフ'); }
}

// Requests where correctness/completeness matter more than speed — problem &
// quiz generation, grading, summarizing, translating, proofreading, explaining.
// For these we automatically engage extended thinking + a low temperature so
// the model doesn't rush and drop answers, regardless of the thinking toggle.
const ACCURACY_RE = /問題|もんだい|クイズ|テスト|試験|演習|過去問|穴埋め|空欄|単語(カード|帳)|フラッシュ|暗記|一問一答|○×|まるばつ|正誤|並べ替え|並べかえ|選択問題|多肢選択|[0-9０-９]\s*択|採点|添削|校正|要約|翻訳|和訳|英訳|解説|説明して|証明|計算|解いて|解答|グラフ|図解|図にして|図示|可視化|ベクトル|関数|方程式|微分|積分|フローチャート/;

function isAccuracyTask(text: string): boolean {
  return ACCURACY_RE.test(text || '');
}

function pointCostForMode(isUltra: boolean, isThinking: boolean, isEconomy: boolean, isAutoLite = false): number {
  if (isUltra) return PT.ultra;
  if (isThinking) return PT.thinking;
  if (isEconomy || isAutoLite) return PT.lite;
  return PT.flash;
}

const QUOTES_JA: { text: string; author: string }[] = [
  { text: '天才とは、1%のひらめきと99%の努力だ。', author: 'トーマス・エジソン' },
  { text: '千里の道も一歩から。', author: '老子' },
  { text: '成功の秘訣は、始めることだ。', author: 'マーク・トウェイン' },
  { text: '困難の中に機会がある。', author: 'アルバート・アインシュタイン' },
  { text: '明日死ぬと思って生きなさい。永遠に生きると思って学びなさい。', author: 'マハトマ・ガンジー' },
  { text: '教育は、世界を変えるために使える最も強力な武器だ。', author: 'ネルソン・マンデラ' },
  { text: '学ぶことをやめたとき、人は老いる。', author: 'ヘンリー・フォード' },
  { text: '今日できることを明日に延ばすな。', author: 'ベンジャミン・フランクリン' },
  { text: '成功とは、失敗から失敗へ、熱意を失わずに進むことだ。', author: 'ウィンストン・チャーチル' },
  { text: 'どれだけ遅くとも、止まらない限り問題はない。', author: '孔子' },
  { text: '夢を見ることができれば、それは実現できる。', author: 'ウォルト・ディズニー' },
  { text: '偉大であるためには、まず始めなければならない。', author: 'ジグ・ジグラー' },
  { text: '努力する人は希望を語り、怠ける人は不満を語る。', author: '井上靖' },
  { text: '他人が諦めるところから、本当の努力が始まる。', author: '大谷翔平' },
  { text: '不可能とは、小さな人間の言葉だ。', author: 'ムハマド・アリ' },
  { text: '失敗は成功のもと。', author: 'ことわざ' },
  { text: '一つのドアが閉まれば、別のドアが開く。', author: 'アレクサンダー・グラハム・ベル' },
  { text: '人生でもっとも大切なことは、才能を生かすことではなく、才能を与えられるほど努力することだ。', author: 'ソフィア・ローレン' },
  { text: '自分自身を信じなさい。あなたの力は、あなたが思っているよりずっと大きい。', author: 'テオドール・ルーズベルト' },
  { text: '昨日の自分より成長していれば、それで十分だ。', author: '武者小路実篤' },
  { text: '私は失敗したことがない。ただ、1万通りのうまくいかない方法を見つけただけだ。', author: 'トーマス・エジソン' },
  { text: '生きるとは呼吸することではない。行動することだ。', author: 'ジャン＝ジャック・ルソー' },
  { text: '為せば成る、為さねば成らぬ何事も。', author: '上杉鷹山' },
  { text: '七転び八起き。', author: 'ことわざ' },
  { text: '好きこそものの上手なれ。', author: 'ことわざ' },
  { text: '人間の真価は、その人が死んだとき、何を残したかではなく、何を生きたかにある。', author: 'アインシュタイン' },
  { text: 'やってみせ、言って聞かせて、させてみせ、ほめてやらねば人は動かじ。', author: '山本五十六' },
  { text: '継続は力なり。', author: 'ことわざ' },
  { text: '今日という日は、残りの人生の最初の日である。', author: 'チャールズ・ディードリッヒ' },
  { text: '知識への投資は、常に最高の利息を生む。', author: 'ベンジャミン・フランクリン' },
  { text: '小さいことを積み重ねるのが、とんでもないところへ行くただ一つの道。', author: 'イチロー' },
  { text: '人生において重要なのは、生きることそのものではなく、よく生きることだ。', author: 'ソクラテス' },
  { text: '最大の栄光は、決して転ばないことではなく、転ぶたびに起き上がることにある。', author: 'ネルソン・マンデラ' },
  { text: '想像力は知識より重要だ。', author: 'アルベルト・アインシュタイン' },
  { text: 'チャンスは、苦境の最中に見出される。', author: 'アルベルト・アインシュタイン' },
  { text: 'すべての偉業は、不可能だと言われることから始まった。', author: 'ルイ・パスツール' },
  { text: '時は金なり。', author: 'ベンジャミン・フランクリン' },
  { text: '行動なき夢は、ただの白昼夢に過ぎない。', author: '日本のことわざ' },
  { text: '辛抱する木に金がなる。', author: 'ことわざ' },
  { text: '初心忘るべからず。', author: '世阿弥' },
];

const QUOTES_EN: { text: string; author: string }[] = [
  { text: 'Genius is one percent inspiration and ninety-nine percent perspiration.', author: 'Thomas Edison' },
  { text: 'A journey of a thousand miles begins with a single step.', author: 'Lao Tzu' },
  { text: 'The secret of getting ahead is getting started.', author: 'Mark Twain' },
  { text: 'In the middle of every difficulty lies opportunity.', author: 'Albert Einstein' },
  { text: 'Live as if you were to die tomorrow. Learn as if you were to live forever.', author: 'Mahatma Gandhi' },
  { text: 'Education is the most powerful weapon you can use to change the world.', author: 'Nelson Mandela' },
  { text: 'Anyone who stops learning is old, whether at twenty or eighty.', author: 'Henry Ford' },
  { text: "Don't put off until tomorrow what you can do today.", author: 'Benjamin Franklin' },
  { text: 'Success is not final, failure is not fatal — it is the courage to continue that counts.', author: 'Winston Churchill' },
  { text: 'It does not matter how slowly you go as long as you do not stop.', author: 'Confucius' },
  { text: 'All our dreams can come true, if we have the courage to pursue them.', author: 'Walt Disney' },
  { text: "You don't have to be great to start, but you have to start to be great.", author: 'Zig Ziglar' },
  { text: 'The only way to do great work is to love what you do.', author: 'Steve Jobs' },
  { text: 'The harder you work for something, the greater you will feel when you achieve it.', author: 'Anonymous' },
  { text: 'Impossible is a word found only in the dictionary of fools.', author: 'Muhammad Ali' },
  { text: 'Failure is the mother of success.', author: 'Proverb' },
  { text: 'When one door closes, another opens.', author: 'Alexander Graham Bell' },
  { text: 'Believe in yourself and all that you are. Know that there is something inside you that is greater than any obstacle.', author: 'Christian D. Larson' },
  { text: 'Do what you can, with what you have, where you are.', author: 'Theodore Roosevelt' },
  { text: 'You are never too old to set another goal or to dream a new dream.', author: 'C.S. Lewis' },
  { text: "I have not failed. I've just found 10,000 ways that won't work.", author: 'Thomas Edison' },
  { text: 'The future belongs to those who believe in the beauty of their dreams.', author: 'Eleanor Roosevelt' },
  { text: 'Whether you think you can or you think you can\'t, you\'re right.', author: 'Henry Ford' },
  { text: 'The expert in anything was once a beginner.', author: 'Helen Hayes' },
  { text: 'Learning never exhausts the mind.', author: 'Leonardo da Vinci' },
  { text: 'The beautiful thing about learning is that no one can take it away from you.', author: 'B.B. King' },
  { text: 'Strive for progress, not perfection.', author: 'Anonymous' },
  { text: 'Continuous effort is the key to unlocking our potential.', author: 'Winston Churchill' },
  { text: 'Today is the first day of the rest of your life.', author: 'Charles Dederich' },
  { text: 'An investment in knowledge pays the best interest.', author: 'Benjamin Franklin' },
  { text: 'Push yourself, because no one else is going to do it for you.', author: 'Anonymous' },
  { text: 'Great things never come from comfort zones.', author: 'Anonymous' },
  { text: 'Imagination is more important than knowledge.', author: 'Albert Einstein' },
  { text: 'The greatest glory in living lies not in never falling, but in rising every time we fall.', author: 'Nelson Mandela' },
  { text: 'Quality is not an act, it is a habit.', author: 'Aristotle' },
  { text: 'The roots of education are bitter, but the fruit is sweet.', author: 'Aristotle' },
  { text: 'Start where you are. Use what you have. Do what you can.', author: 'Arthur Ashe' },
  { text: 'The only limit to our realization of tomorrow is our doubts of today.', author: 'Franklin D. Roosevelt' },
  { text: 'Knowing is not enough; we must apply. Willing is not enough; we must do.', author: 'Bruce Lee' },
];

function getDailyQuote(lang: string): { text: string; author: string } {
  const quotes = lang === 'en' ? QUOTES_EN : QUOTES_JA;
  const dayIndex = Math.floor(Date.now() / 86400000);
  return quotes[dayIndex % quotes.length];
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
  qa: '一問一答',
  fill: '穴埋め問題',
  order: '並べ替え問題',
  choice: '選択問題',
  truefalse: '○×問題',
  flash: '単語カード',
};

// Maps slash command id → QAKind + human-readable format name for the directive.
const FORMAT_CMD: Record<string, { kind: string; label: string }> = {
  qa:     { kind: 'qa',        label: '一問一答（Q&A）' },
  fill:   { kind: 'fill',      label: '穴埋め問題' },
  choice: { kind: 'choice',    label: '選択問題（4択）' },
  tf:     { kind: 'truefalse', label: '○×問題' },
  flash:  { kind: 'flash',     label: '単語カード' },
  order:  { kind: 'order',     label: '並べ替え問題' },
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
      // Only keep the previous pair if it actually got an answer — otherwise a
      // question the model left unanswered would render as a blank-answer card.
      if (cur && cur.q && cur.a) pairs.push(cur);
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
      blocks.push({ id, type: 'geometry', rawCode: jsonStr.trim(), previewLabel: translate('数学・幾何の図') });
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
      const label = translate('{n}問の{kind}', { n: pairs.length, kind: translate(QA_KIND_LABEL[parseQAKind(trimmed)]) });
      blocks.push({ id, type: 'qa', rawCode: trimmed, previewLabel: label });
      return blockMarker(id);
    }
    if (type === 'geometry') {
      try { parseGeometry(trimmed); } catch { return '\n[図の生成に失敗しちゃった]\n'; }
      blocks.push({ id, type: 'geometry', rawCode: trimmed, previewLabel: translate('数学・幾何の図') });
      return blockMarker(id);
    }
    if (type === 'memo_create' && allowMemoBlocks) {
      const firstLine = trimmed.split('\n')[0] || '';
      const titleMatch = firstLine.match(/^@@memo_create\s*:\s*(.+)/);
      const memoTitle = titleMatch?.[1]?.trim() || '新しいメモ';
      const content = trimmed.split('\n').slice(1).join('\n').trim();
      blocks.push({ id, type: 'memo_create', rawCode: content, previewLabel: translate('メモ作成: {title}', { title: memoTitle }), memoTitle });
      return blockMarker(id);
    }
    if (type === 'memo_overwrite' && allowMemoBlocks) {
      const firstLine = trimmed.split('\n')[0] || '';
      const idMatch = firstLine.match(/^@@memo_overwrite\s*:\s*(\d+)/);
      const memoId = idMatch ? Number(idMatch[1]) : undefined;
      const content = trimmed.split('\n').slice(1).join('\n').trim();
      blocks.push({ id, type: 'memo_overwrite', rawCode: content, previewLabel: translate('メモ上書き: ID {id}', { id: memoId ?? '?' }), memoId });
      return blockMarker(id);
    }
    if (type === 'folder_create') {
      const lines = trimmed.split('\n');
      const nameMatch = lines[0]?.match(/^@@folder_create\s*:\s*(.+)/);
      const colorMatch = lines.find((l: string) => l.startsWith('@@color:'))?.match(/^@@color:\s*(.+)/);
      const folderName = nameMatch?.[1]?.trim() || '新しいフォルダ';
      const folderColor = colorMatch?.[1]?.trim();
      blocks.push({ id, type: 'folder_create', rawCode: trimmed, previewLabel: translate('フォルダ作成: 📁 {name}', { name: folderName }), folderName, folderColor });
      return blockMarker(id);
    }
    if (type === 'note_move') {
      const lines = trimmed.split('\n');
      const idMatch = lines[0]?.match(/^@@note_move\s*:\s*(\d+)/);
      const folderMatch = lines.find((l: string) => l.startsWith('@@to_folder:'))?.match(/^@@to_folder:\s*(.+)/);
      const memoId = idMatch ? Number(idMatch[1]) : undefined;
      const targetFolderName = folderMatch?.[1]?.trim() || '未分類';
      blocks.push({ id, type: 'note_move', rawCode: trimmed, previewLabel: translate('移動: ID {id} → 📁 {name}', { id: memoId ?? '?', name: targetFolderName }), memoId, targetFolderName });
      return blockMarker(id);
    }
    if (type === 'table') {
      blocks.push({ id, type: 'table', rawCode: trimmed, previewLabel: translate('表') });
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

function nameAddon(): string {
  const name = getUserName();
  if (!name) return '';
  return `\n\nユーザーの名前は「${name}」です。自然なタイミングで名前で呼びかけてください。`;
}

function buildSystemPrompt(contextNotes: Note[], activeSkill?: Skill | null): string {
  const skillAddon = (activeSkill ? skillPromptAddon(activeSkill) : '') + nameAddon();
  if (contextNotes.length === 0) return LILY_CHAT_SYSTEM_PROMPT + skillAddon;
  // Adaptive per-note cap: when the user is focused on just a few notes, send
  // (almost) the whole thing so Lily doesn't miss content that's actually
  // written in the memo. Only clamp hard when many notes are in scope (e.g.
  // "all notes" mode) to keep the request bounded.
  const perNoteCap = contextNotes.length <= 3 ? 16000
    : contextNotes.length <= 10 ? 6000
    : 3000;
  const context = contextNotes
    .map(n => {
      const full = noteHtmlToText(n.content || '');
      const body = full.length > perNoteCap
        ? `${full.slice(0, perNoteCap)}\n…(以下 ${full.length - perNoteCap} 文字省略)`
        : full;
      return `## ${n.title || '無題'} (ID:${n.id})\n${body}`;
    })
    .join('\n\n---\n\n');
  return `${LILY_CHAT_SYSTEM_PROMPT}${skillAddon}\n\n【参照中のメモ (${contextNotes.length}件)】\n${context}`;
}

/* ───────────── Block previews ───────────── */

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

async function tryRenderMermaid(source: string): Promise<string> {
  const id = `lily-mmd-${Math.random().toString(36).slice(2, 9)}`;
  const { svg } = await mermaid.render(id, source);
  return svg;
}

function MermaidPreview({ code, baseName }: { code: string; baseName: string }) {
  const t = useT();
  const [svg, setSvg] = useState('');
  const [err, setErr] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // With suppressErrorRendering:true in mermaid config, render() throws
      // immediately on bad syntax (no error-SVG injected into document.body).
      // We try: original → sanitized mindmap → recovered syntax → give up.
      const candidates = [
        sanitizeMindmap(code),           // mindmap normalisation (no-op for others)
        recoverMermaid(sanitizeMindmap(code)), // flowchart/sequence recovery
      ];
      // Deduplicate so we don't run identical sources twice.
      const seen = new Set<string>();
      for (const src of candidates) {
        if (seen.has(src)) continue;
        seen.add(src);
        try {
          const out = await tryRenderMermaid(src);
          if (!cancelled && out) { setSvg(out); setErr(false); return; }
        } catch { /* try next candidate */ }
      }
      if (!cancelled) setErr(true);
    })();
    return () => { cancelled = true; };
  }, [code]);
  if (err) return (
    <div className="prev-err">
      {t('Mermaid 構文エラー💦')}<br />
      <span style={{ fontSize: '0.75rem', opacity: 0.7 }}>{t('メモに追加すると編集画面から修正できるよ')}</span>
    </div>
  );
  return (
    <div>
      <div className="mmd-prev" dangerouslySetInnerHTML={{ __html: svg }} />
      <ImageSaveBar>
        <button onClick={() => downloadSvgAsPng(svg, `${baseName}.png`)} disabled={!svg}>
          <Download size={13} /> {t('PNG保存')}
        </button>
        <button onClick={() => downloadSvg(svg, `${baseName}.svg`)} disabled={!svg}>
          <Download size={13} /> {t('SVG保存')}
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
  const t = useT();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chartRef = useRef<any>(null);
  const cfg = useMemo(() => {
    try { return JSON.parse(code); } catch { return null; }
  }, [code]);
  if (!cfg || !cfg.data || !Array.isArray(cfg.data.datasets)) {
    return <div className="prev-err">{t('グラフのプレビューを表示できなかったよ💦')}</div>;
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
          <Download size={13} /> {t('PNG画像で保存')}
        </button>
      </ImageSaveBar>
    </div>
  );
}

function GeometryPreview({ code, baseName }: { code: string; baseName: string }) {
  const t = useT();
  const svg = useMemo(() => {
    try { return renderGeometrySvg(parseGeometry(code)); } catch { return ''; }
  }, [code]);
  if (!svg) return <div className="prev-err">{t('図のプレビューを表示できなかったよ💦')}</div>;
  return (
    <div>
      <div className="geo-prev" dangerouslySetInnerHTML={{ __html: svg }} />
      <ImageSaveBar>
        <button onClick={() => downloadSvgAsPng(svg, `${baseName}.png`)}>
          <Download size={13} /> {t('PNG保存')}
        </button>
        <button onClick={() => downloadSvg(svg, `${baseName}.svg`)}>
          <Download size={13} /> {t('SVG保存')}
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
  const t = useT();
  const snippet = block.rawCode.slice(0, 400);
  return (
    <div className="file-prev">
      <pre className="file-snippet">{snippet}{block.rawCode.length > 400 ? '\n…' : ''}</pre>
      <ImageSaveBar>
        <button onClick={() => downloadTextFile(block.rawCode, block.fileName || 'lily-file.txt')}>
          <FileDown size={13} /> {t('{name} をダウンロード', { name: block.fileName ?? '' })}
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

function QAPreview({ code, initialChecked, onCheckChange }: {
  code: string;
  initialChecked?: number[];
  onCheckChange?: (indices: number[]) => void;
}) {
  const t = useT();
  const pairs = useMemo(() => parseQAPairs(code), [code]);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [checked, setChecked] = useState<Set<number>>(
    () => new Set(initialChecked ?? []),
  );
  const toggle = (i: number) => setChecked(s => {
    const n = new Set(s);
    n.has(i) ? n.delete(i) : n.add(i);
    onCheckChange?.([...n]);
    return n;
  });
  const allDone = checked.size === pairs.length && pairs.length > 0;
  return (
    <div className="qa-prev">
      <div className={`qa-prev-progress${allDone ? ' all-done' : ''}`}>
        {t('{done}/{total} 完了', { done: checked.size, total: pairs.length })}
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
            <button className="qa-show" onClick={() => setOpen(s => new Set(s).add(i))}>{t('答えを見る')}</button>
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
  const t = useT();
  const [status, setStatus] = useState<'idle' | 'loading' | 'done'>('idle');
  const existingNote = block.memoId != null ? allNotes.find(n => n.id === block.memoId) : undefined;
  const confirmMsg = block.type === 'memo_create'
    ? t('「{title}」という新しいメモを作っていい？', { title: block.memoTitle || t('新しいメモ') })
    : t('「{title}」を書き換えていい？', { title: existingNote?.title || t('メモ ID:{id}', { id: String(block.memoId) }) });

  const handleOk = async () => {
    setStatus('loading');
    try {
      if (block.type === 'memo_create') {
        const id = await createNoteWithBlock(block, block.memoTitle || t('新しいメモ'));
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
          <button className="memo-btn cancel" onClick={onClose} disabled={status === 'loading'}>{t('キャンセル')}</button>
          <button className="memo-btn ok" onClick={handleOk} disabled={status !== 'idle'}>
            {status === 'loading' ? t('保存中...') : status === 'done' ? t('✓ 完了') : t('OK')}
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
  const t = useT();
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
      {status === 'loading' ? t('ZIPを作成中...') : t('{n}ファイルをまとめてZIPダウンロード', { n: blocks.length })}
      <style jsx>{`
        .zip-download-btn { display: flex; align-items: center; gap: 8px; width: 100%; padding: 10px 16px; background: linear-gradient(135deg, color-mix(in srgb, var(--primary) 15%, transparent), color-mix(in srgb, var(--primary) 8%, transparent)); border: 1.5px dashed var(--primary); border-radius: 10px; color: var(--primary); font-size: 0.85rem; font-weight: 700; cursor: pointer; transition: all 0.15s; margin-top: 4px; }
        .zip-download-btn:hover:not(:disabled) { background: var(--primary); color: white; }
        .zip-download-btn:disabled { opacity: 0.6; cursor: default; }
      `}</style>
    </button>
  );
}

function FolderActionCard({ block, allNotes }: { block: InsertableBlock; allNotes: Note[] }) {
  const t = useT();
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const allFolders = useLiveQuery(() => db.folders.filter(f => !f.deletedAt).toArray(), []);

  const noteTitle = block.memoId != null
    ? (allNotes.find(n => n.id === block.memoId)?.title || `ID:${block.memoId}`)
    : t('不明');

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
    ? t('フォルダ「{name}」を作成', { name: String(block.folderName) })
    : t('「{title}」→ 📁 {folder}', { title: noteTitle, folder: String(block.targetFolderName) });
  const btnLabel = block.type === 'folder_create' ? t('フォルダを作成する') : t('メモを移動する');

  return (
    <div className="folder-action-card">
      <div className="folder-action-label">{icon} {label}</div>
      <button
        className={`folder-action-btn ${status}`}
        onClick={handleExecute}
        disabled={status !== 'idle'}
      >
        {status === 'loading' ? t('実行中...') : status === 'done' ? t('✓ 完了') : status === 'error' ? t('✕ 失敗') : btnLabel}
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
  qaInitialChecked,
  onQaCheckChange,
}: {
  block: InsertableBlock;
  allNotes: Note[];
  defaultNoteId?: number;
  onNoteCreated?: (id: number) => void;
  qaInitialChecked?: number[];
  onQaCheckChange?: (indices: number[]) => void;
}) {
  const t = useT();
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
      setErrorMsg(e instanceof Error ? e.message : t('挿入に失敗しちゃった'));
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
        {block.type === 'qa' && <QAPreview code={block.rawCode} initialChecked={qaInitialChecked} onCheckChange={onQaCheckChange} />}
        {block.type === 'geometry' && <GeometryPreview code={block.rawCode} baseName={baseName} />}
        {block.type === 'file' && <FilePreview block={block} />}
        {block.type === 'table' && (
          <div className="table-preview" dangerouslySetInnerHTML={{ __html: markdownTableToHtml(block.rawCode) }} />
        )}
        {(block.type === 'memo_create' || block.type === 'memo_overwrite') && (
          <pre className="memo-block-preview">{block.rawCode.slice(0, 200)}{block.rawCode.length > 200 ? '\n…' : ''}</pre>
        )}
      </div>

      {(block.type === 'memo_create' || block.type === 'memo_overwrite') ? (
        <>
          <button className="memo-confirm-btn" onClick={() => setShowMemoModal(true)}>
            {block.type === 'memo_create' ? t('✏️ このメモを作成する') : t('📝 上書きを確認する')}
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
            <option value={NEW_NOTE}>{t('✏️ 新規メモを作成')}</option>
            {allNotes.map(n => (
              <option key={n.id} value={String(n.id)}>{n.title || t('無題のメモ')}</option>
            ))}
          </select>
          <button
            className={`insert-btn ${status}`}
            onClick={handleInsert}
            disabled={status === 'loading' || status === 'success'}
          >
            {status === 'loading' ? t('...追加中') : status === 'success' ? t('✓ 追加完了！') : status === 'error' ? t('✕ 失敗') : t('メモに追加')}
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
        .table-preview { overflow-x: auto; margin-bottom: 8px; border-radius: 8px; }
        .table-preview :global(table) { border-collapse: collapse; width: 100%; font-size: 0.78rem; }
        .table-preview :global(th), .table-preview :global(td) { border: 1px solid var(--border); padding: 5px 10px; text-align: left; }
        .table-preview :global(th) { background: color-mix(in srgb, var(--primary) 12%, transparent); font-weight: 700; }
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
  const t = useT();
  const [freeText, setFreeText] = useState('');

  const handleOption = (opt: string) => {
    if (disabled) return;
    onAnswer(opt);
  };

  const handleFreeSubmit = () => {
    const val = freeText.trim();
    if (!val || disabled) return;
    onAnswer(val);
    setFreeText('');
  };

  return (
    <div className="clarify-overlay" onClick={onDismiss}>
      <div className="clarify-sheet" onClick={e => e.stopPropagation()}>
        <div className="clarify-header">
          <div className="clarify-q-wrap">
            {progress.total > 1 && (
              <span className="clarify-progress">{t('質問 {current} / {total}', { current: progress.current, total: progress.total })}</span>
            )}
            <span className="clarify-question">{question.question}</span>
          </div>
          <button className="clarify-close" onClick={onDismiss} title={t('閉じる')}>
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
            placeholder={t('回答を入力...')}
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
  const t = useT();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  return (
    <>
      <button className={`copy-btn${light ? ' copy-btn-light' : ''}`} onClick={copy} title={t('コピー')}>
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
  message, allNotes, selectedNoteId, model, onNoteCreated, onRegenerate, onQaCheck,
}: {
  message: ChatMessage;
  allNotes: Note[];
  selectedNoteId?: number;
  model?: 'lily';
  onNoteCreated?: (id: number) => void;
  onRegenerate?: () => void;
  onQaCheck?: (blockId: string, indices: number[]) => void;
}) {
  const t = useT();
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
      flashCopied(codeBtn, t('✓ コピー済み'), t('⎘ コピー'));
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
        qaInitialChecked={message.qaChecked?.[block.id]}
        onQaCheckChange={onQaCheck ? (indices) => onQaCheck(block.id, indices) : undefined}
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
          <div className="ask-asked-hint">{t('❓ {n}件の質問をしたよ', { n: message.questions.length })}</div>
        )}
        {message.thinking && (
          <div className="thinking-toggle-wrap">
            <button
              className="thinking-toggle-btn"
              onClick={() => setThinkingOpen(o => !o)}
            >
              {t('🧠 思考の過程')} {thinkingOpen ? '▲' : '▼'}
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
            <button className="msg-regen-btn" onClick={onRegenerate} title={t('再生成')}>
              <RotateCcw size={13} />
              <span>{t('再生成')}</span>
            </button>
          )}
        </div>
        {message.usage && (
          <div className="msg-usage" style={{ fontSize: '0.68rem', color: message.usage.cached > 0 ? '#1a7a4d' : 'var(--fg-muted,#999)', marginTop: '4px', opacity: 0.85 }}>
            入力{message.usage.prompt.toLocaleString()}（うちキャッシュ{message.usage.cached.toLocaleString()}）/ 出力{message.usage.output.toLocaleString()}
            {message.usage.thoughts > 0 ? `（思考${message.usage.thoughts.toLocaleString()}）` : ''} = 計{message.usage.total.toLocaleString()}tok
          </div>
        )}
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
  const [redSheet, setRedSheet] = useState<Record<number, boolean>>({});
  return (
    <div className="user-bubble-row">
      <CopyButton text={message.text} light />
      <div className="user-bubble">
        {atts.length > 0 && (
          <div className="att-preview">
            {atts.map((att, i) =>
              att.isImage ? (
                <div key={i} className="att-img-wrap">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`data:${att.mimeType};base64,${att.data}`} alt={att.name} className="att-img" />
                  {redSheet[i] && <div className="red-sheet-overlay" />}
                  <button
                    className={`red-sheet-btn${redSheet[i] ? ' active' : ''}`}
                    onClick={() => setRedSheet(p => ({ ...p, [i]: !p[i] }))}
                    title={redSheet[i] ? 'シートを外す' : '赤シートをかける'}
                  >🔴</button>
                </div>
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
        .att-img-wrap { position: relative; display: inline-block; }
        .att-img { max-width: 140px; max-height: 140px; border-radius: 10px; display: block; }
        .red-sheet-overlay { position: absolute; inset: 0; border-radius: 10px; background: rgba(190,0,30,0.72); pointer-events: none; animation: rsIn 0.18s ease; }
        @keyframes rsIn { from { opacity: 0; } to { opacity: 1; } }
        .red-sheet-btn { position: absolute; bottom: 4px; right: 4px; width: 24px; height: 24px; border-radius: 50%; border: none; background: rgba(0,0,0,0.55); font-size: 12px; line-height: 1; cursor: pointer; display: flex; align-items: center; justify-content: center; opacity: 0.7; transition: opacity 0.15s, transform 0.15s; z-index: 2; }
        .att-img-wrap:hover .red-sheet-btn { opacity: 1; }
        .red-sheet-btn.active { opacity: 1; transform: scale(1.1); }
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
  const t = useT();
  const chats = useLiveQuery(() => db.savedChats.orderBy('createdAt').reverse().filter(c => !c.deletedAt).toArray(), []);
  return (
    <div className="history-overlay" onClick={onClose}>
      <div className="history-modal" onClick={e => e.stopPropagation()}>
        <div className="history-head">
          <span className="history-head-title"><History size={16} /> {t('保存した会話')}</span>
          <button className="history-close" onClick={onClose} title={t('閉じる')}><X size={18} /></button>
        </div>
        <div className="history-list">
          {(!chats || chats.length === 0) && (
            <div className="history-empty">{t('保存した会話はまだないよ。')}<br />{t('会話上部の保存ボタン（💾）で残せるよ。')}</div>
          )}
          {chats?.map(c => (
            <div key={c.id} className="history-item">
              <button className="history-item-main" onClick={() => onLoad(c)}>
                <span className="history-badge lily">Lily</span>
                <span className="history-texts">
                  <span className="history-title">{c.title}</span>
                  <span className="history-meta">
                    {new Date(c.createdAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}・{t('{n}件', { n: c.count })}
                  </span>
                </span>
              </button>
              <button className="history-del" onClick={() => { if (c.id != null) deleteSavedChat(c.id); }} title={t('削除')}>
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


export default function AIChat({ onOpenSettings, onSwitchTab, onNoteCreated, initialContext, onContextConsumed }: AIChatProps) {
  const t = useT();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [lilyAllNotes, setLilyAllNotes] = useState(false);
  const [lilyNoteIds, setLilyNoteIds] = useState<number[]>([]);
  const [lilyThinking, setLilyThinking] = useState(false);
  const [lilyUltraThinking, setLilyUltraThinking] = useState(false);
  const [showContextPanel, setShowContextPanel] = useState(false);
  const [contextSearch, setContextSearch] = useState('');
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
  const [economy, setEconomy] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [savedToast, setSavedToast] = useState(false);
  const [showLectureRecorder, setShowLectureRecorder] = useState(false);
  const [showVoiceChat, setShowVoiceChat] = useState(false);
  const [showToolbox, setShowToolbox] = useState(false);
  const [showHeaderMenu, setShowHeaderMenu] = useState(false);
  const [activeSkillId, setActiveSkillId] = useState<number | null>(null);
  // Practice context passed from PracticeScreen via page.tsx
  const [practiceCtxUI, setPracticeCtxUI] = useState<string | null>(null);
  const practiceCtxRef = useRef<string | null>(null);
  const enabledTones = useEnabledTones();
  const shortcuts = useShortcuts();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const allNotes = useLiveQuery(
    () => db.notes.filter(n => !n.deletedAt && n.type !== 'handwriting').toArray(),
    []
  );
  const chatFolders = useLiveQuery(
    () => db.folders.filter(f => !f.deletedAt).toArray(),
    []
  ) ?? [];
  useEffect(() => { ensureSkillsSeeded(); }, []);

  // Consume practice context passed from PracticeScreen (on mount only)
  useEffect(() => {
    if (initialContext) {
      practiceCtxRef.current = initialContext;
      setPracticeCtxUI(initialContext);
      onContextConsumed?.();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const skills = useLiveQuery(() => db.skills.orderBy('createdAt').toArray(), []) ?? [];
  const activeSkill = skills.find(s => s.id === activeSkillId) ?? null;
  useEffect(() => {
    const refreshKey = () => setApiKey(getEffectiveApiKey());
    refreshKey();
    setEconomy(localStorage.getItem('lily_economy_mode') === '1');
    window.addEventListener('lily-lang-changed', refreshKey);
    return () => window.removeEventListener('lily-lang-changed', refreshKey);
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
      text: textContent || t('授業まとめを作成しました！'),
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

  // Slash-command suggestions: shown while the user is typing "/" + a prefix.
  const slashSuggestions = useMemo(() => {
    if (!input.startsWith('/') || input.includes(' ')) return [];
    const q = input.slice(1).toLowerCase();
    return SLASH_COMMANDS.filter(s => s.id.startsWith(q));
  }, [input]);

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
    if (totalPages === 0) throw new Error('The document has no pages.');
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
      setFileError(t('ファイルは合計{max}個までだよ', { max: MAX_FILES }));
      return;
    }
    if (files.length > room) {
      setFileError(t('ファイルは合計{max}個までだよ（先頭{room}件だけ追加するね）', { max: MAX_FILES, room }));
    }

    files.slice(0, room).forEach(file => {
      if (file.size > MAX_FILE_BYTES) {
        setFileError(t('「{name}」が大きすぎるよ（1ファイル12MBまで）', { name: file.name }));
        return;
      }
      const reader = new FileReader();
      reader.onload = async () => {
        const result = reader.result as string;
        const base64 = result.split(',')[1] ?? '';
        const id = crypto.randomUUID();
        const isPdf = file.type === 'application/pdf';
        const isMdOrTxt = !isPdf && !file.type.startsWith('image/') &&
          (file.name.endsWith('.md') || file.name.endsWith('.txt') ||
           file.type === 'text/markdown' || file.type === 'text/x-markdown');
        // Large images (>2 MB) use File API; PDFs use pdf.js text extraction.
        const useLargeImageUpload = !isPdf && file.size > 2 * 1024 * 1024;
        const meta: AttachmentMeta = {
          id,
          name: file.name,
          mimeType: isMdOrTxt ? 'text/plain' : (file.type || 'application/octet-stream'),
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
            setFileError(t('「{name}」のPDF読み込みに失敗したよ: {err}', { name: file.name, err: err instanceof Error ? err.message : 'unknown error' }));
          }
        } else if (useLargeImageUpload && apiKey) {
          try {
            const fileUri = await uploadToFileApi(base64, file.type, file.name, apiKey);
            setAttachments(prev =>
              prev.map(a => a.id === id ? { ...a, fileUri, uploading: false } : a)
            );
          } catch (err) {
            setAttachments(prev => prev.filter(a => a.id !== id));
            setFileError(t('「{name}」のアップロードに失敗したよ: {err}', { name: file.name, err: err instanceof Error ? err.message : 'unknown error' }));
          }
        }
      };
      reader.onerror = () => setFileError(t('「{name}」の読み込みに失敗したよ', { name: file.name }));
      reader.readAsDataURL(file);
    });
  };

  const removeAttachment = (idx: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== idx));
  };

  // /compact: ask Lily to summarize the conversation so far, then replace the
  // visible history with that summary (keeps long study sessions cheap and
  // easy to scroll back through).
  const compactHistory = useCallback(async () => {
    if (messages.length === 0 || isLoading || !apiKey) return;
    setIsLoading(true);
    try {
      const transcript = messages.map(m => `${m.role === 'user' ? 'User' : 'Lily'}: ${m.text}`).join('\n');
      const summary = await callGeminiChat(
        [{
          role: 'user',
          text: `以下の会話を、後で読み返しても流れがわかるように要約して。論点・結論・まだ解決していない疑問を中心に、簡潔な日本語の箇条書きでまとめて。前置きや感想は書かず、要約だけを出力して：\n\n${transcript}`,
        }],
        'あなたは会話ログの要約者です。指示された通りに要約だけを出力してください。',
        apiKey,
        { models: ['gemini-3.1-flash-lite'] },
      );
      setMessages([{
        id: crypto.randomUUID(),
        role: 'lily',
        text: `📦 ${t('ここまでの会話を要約して圧縮したよ')}\n\n${summary}`,
        timestamp: Date.now(),
      }]);
    } catch (e) {
      setMessages(prev => [...prev, {
        id: crypto.randomUUID(),
        role: 'lily',
        text: `${t('ごめんね、要約に失敗しちゃった 🐶')}\n${e instanceof Error ? e.message : t('不明なエラー')}`,
        timestamp: Date.now(),
      }]);
    } finally {
      setIsLoading(false);
    }
  }, [messages, isLoading, apiKey, t]);

  const sendMessage = useCallback(async (text?: string, opts?: { forceSearch?: boolean; fixedCost?: number }) => {
    const rawText = (text ?? input).trim();
    const sentAtts = attachments;

    // Slash commands (typed in English by design): they trigger an action
    // rather than being sent as a message. Anything that isn't a known command
    // falls through and is sent to Lily as plain text.
    if (!text && rawText.startsWith('/') && sentAtts.length === 0) {
      const spaceIdx = rawText.indexOf(' ');
      const cmdWord = (spaceIdx === -1 ? rawText.slice(1) : rawText.slice(1, spaceIdx)).toLowerCase();
      const arg = spaceIdx === -1 ? '' : rawText.slice(spaceIdx + 1).trim();
      const sc = SLASH_COMMANDS.find(s => s.id === cmdWord);
      if (sc) {
        setInput('');
        if (textareaRef.current) textareaRef.current.style.height = 'auto';
        if (sc.id === 'clear') { setMessages([]); return; }
        if (sc.id === 'compact') { await compactHistory(); return; }
        if (sc.id === 'search') {
          await sendMessage(arg || t('わからないことを正確に調べて教えて'), { forceSearch: true });
          return;
        }
        if (sc.id === 'quiz') {
          await sendMessage(arg ? t('{topic}について、練習問題(QA)を作成して。', { topic: arg }) : t('ここまでの会話の内容から、練習問題(QA)を作成して。'), { fixedCost: PT.exercise });
          return;
        }
        if (sc.id === 'hard') {
          await sendMessage(arg
            ? t('{topic}について、受験生でも解けないような超難問・鬼問題を作成して。一切の手加減なし。複数の知識を組み合わせる高度な思考を要する問題にして。', { topic: arg })
            : t('ここまでの会話の内容から、受験生でも解けないような超難問・鬼問題を作成して。一切の手加減なし。'), { fixedCost: PT.hardProblem });
          return;
        }
        if (sc.id === 'review') {
          await sendMessage(arg
            ? t('{topic}についての私の理解を批判的にチェックして、誤りや理解が浅い点があれば遠慮なく指摘して。', { topic: arg })
            : t('これまでの会話に対する私の理解を批判的にチェックして、誤りや理解が浅い点があれば遠慮なく指摘して。'));
          return;
        }
        const fk = FORMAT_CMD[sc.id];
        if (fk) {
          const base = arg || '選択中のメモ・ここまでの会話の内容から問題を作成して';
          await sendMessage(`${base}\n\n【出力形式指定】必ず${fk.label}形式で出力し、\`\`\`qa ブロックの1行目に @@kind:${fk.kind} を付けてください。`, { fixedCost: PT.exercise });
          return;
        }
      }
    }

    const ctxPrefix = practiceCtxRef.current; // captured before async work
    const userText = rawText;
    if ((!userText && sentAtts.length === 0) || isLoading || !apiKey) return;

    const hasNewFiles = sentAtts.length > 0;
    const accuracy0 = isAccuracyTask(rawText);
    const autoLite = !lilyThinking && !lilyUltraThinking && !economy && !accuracy0 && !hasNewFiles && !opts?.fixedCost;
    const msgCost = opts?.fixedCost ?? pointCostForMode(lilyUltraThinking && !economy, (lilyThinking || accuracy0) && !economy, economy, autoLite);
    if (!canAfford(msgCost)) {
      setMessages(prev => [...prev, {
        id: crypto.randomUUID(),
        role: 'lily',
        text: `ポイントが足りません（残り${getRemainingPoints()}pt・必要${msgCost}pt）。明日リセットされます。`,
        timestamp: Date.now(),
      }]);
      return;
    }

    setInput('');
    setAttachments([]);
    setFileError('');
    if (ctxPrefix) { practiceCtxRef.current = null; setPracticeCtxUI(null); }
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
      const systemPrompt = buildSystemPrompt(contextNotes, activeSkill);

      const allMsgs = [...messages, userMsg];
      // Keep a generous window of recent turns. gemini-2.5-flash has a very
      // large context window, so the previous hard cap of 10 messages was the
      // main reason Lily "forgot" things the user had written earlier in the
      // same conversation. Walk backwards accumulating text until a character
      // budget, capped by message count, so long chats stay coherent without
      // sending an unbounded request.
      const HISTORY_MSG_CAP = 40;
      const HISTORY_CHAR_BUDGET = 24000;
      const picked: ChatMessage[] = [];
      let charCount = 0;
      for (let i = allMsgs.length - 1; i >= 0 && picked.length < HISTORY_MSG_CAP; i--) {
        const m = allMsgs[i];
        picked.push(m);
        charCount += m.text.length;
        if (charCount > HISTORY_CHAR_BUDGET) break;
      }
      picked.reverse();
      const recentMsgs = picked;

      const modeDirective = TONES.find(mo => mo.id === activeMode)?.directive;
      const lastIdx = recentMsgs.length - 1;
      const history: ChatTurn[] = recentMsgs.map((m, idx) => {
        let msgText = m.text;
        if (idx === lastIdx && m.role === 'user') {
          // Prepend practice context (invisible to user, seen by Gemini)
          if (ctxPrefix) msgText = `[演習コンテキスト]\n${ctxPrefix}\n\n---\n\n${msgText}`;
          if (modeDirective) msgText = `${msgText}\n\n（${modeDirective}）`;
        }
        const turn: ChatTurn = {
          role: m.role === 'user' ? 'user' : 'model',
          text: msgText,
        };
        // Re-attach files for EVERY user message in the window that has them.
        // Each request is stateless — the model only sees attachments present
        // in this request, so dropping older ones made Lily unable to "see"
        // files the user had shown earlier. File API uploads are referenced
        // cheaply by URI; only inline images/PDF renders carry real weight.
        if (m.role === 'user' && m.attachments && m.attachments.length > 0) {
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

      // Files from messages outside the history window are normally dropped.
      // Re-attaching every old file each turn balloons input token cost, so we
      // only do it when the request actually needs the source material —
      // problem/quiz generation, explanation, grading etc. (i.e. NOT a casual
      // simple question, which is the auto-lite path). Re-sending PDF page
      // images is expensive, so casual chat skips them entirely.
      if (!autoLite) {
        const recentMsgSet = new Set(recentMsgs.map(m => m.id));
        const olderFiles: ChatAttachment[] = allMsgs
          .filter(m => !recentMsgSet.has(m.id) && m.role === 'user' && m.attachments?.length)
          .flatMap(m => m.attachments!.map<ChatAttachment>(a => ({
            mimeType: a.mimeType,
            data: a.fileUri || a.extractedText || a.pdfPageImages ? '' : a.data,
            fileUri: a.fileUri,
            extractedText: a.extractedText,
            pdfPageImages: a.pdfPageImages,
            pdfTotalPages: a.pdfTotalPages,
          })));
        if (olderFiles.length > 0) {
          history.unshift(
            { role: 'model', text: '承知しました。以前のファイルも確認しました。' },
            { role: 'user', text: '以前の会話で共有したファイルです。引き続き参照してください。', attachments: olderFiles },
          );
        }
      }

      // Problem/quiz generation, grading, summarizing etc. auto-engage thinking
      // + a low temperature so the model doesn't rush and drop answers.
      const accuracy = isAccuracyTask(userMsg.text);
      let aiText: string;
      deductPoints(msgCost);
      if (lilyUltraThinking && !economy) {
        setSikunLiveThinking('');
        let thinkingAccum = '';
        setSikunProgress(t('⚡ Ultra思考中... 深く考えています'));
        aiText = await streamSikunlilyChat(
          history,
          systemPrompt,
          apiKey,
          16384,
          {
            onThinkingDelta: (delta) => {
              thinkingAccum += delta;
              setSikunLiveThinking(thinkingAccum);
            },
            onResponseDelta: () => {
              setSikunProgress(t('✍️ 回答を生成中...'));
            },
          },
          ['gemini-3.1-pro-preview', 'gemini-3.5-flash', 'gemini-2.5-flash'],
          webSearch || opts?.forceSearch,
          65536,
          0.6,
        );
        setSikunProgress('');
        setSikunLiveThinking('');
        pendingThinkingRef.current = thinkingAccum;
      } else if ((lilyThinking || accuracy) && !economy) {
        setSikunLiveThinking('');
        let thinkingAccum = '';
        setSikunProgress(accuracy && !lilyThinking ? t('🧠 じっくり考えてるよ…') : t('🧠 思考中...'));
        aiText = await streamSikunlilyChat(
          history,
          systemPrompt,
          apiKey,
          lilyThinking ? 8192 : 4096,
          {
            onThinkingDelta: (delta) => {
              thinkingAccum += delta;
              setSikunLiveThinking(thinkingAccum);
            },
            onResponseDelta: () => {
              setSikunProgress(t('✍️ 回答を生成中...'));
            },
          },
          ['gemini-3.5-flash', 'gemini-2.5-flash'],
          webSearch || opts?.forceSearch,
          65536,
          accuracy ? 0.35 : 0.6,
        );
        setSikunProgress('');
        setSikunLiveThinking('');
        pendingThinkingRef.current = thinkingAccum;
      } else {
        const useLite = economy || autoLite;
        aiText = await callGeminiChat(history, systemPrompt, apiKey, {
          webSearch: webSearch || opts?.forceSearch,
          models: useLite
            ? ['gemini-3.1-flash-lite', 'gemini-2.5-flash-lite']
            : ['gemini-3.5-flash', 'gemini-2.5-flash'],
          maxOutputTokens: useLite ? 8192 : undefined,
          temperature: accuracy ? 0.35 : undefined,
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
            ? `${questions.map(q => q.question).join('\n')}\n\n${t('下のフォームから回答してください')}`
            : '...'
        ),
        timestamp: Date.now(),
        extractedBlocks: blocks.length > 0 ? blocks : undefined,
        questions: questions.length > 0 ? questions : undefined,
        thinking: capturedThinking || undefined,
        usage: getLastUsage() ?? undefined,
      }]);
    } catch (e) {
      setSikunProgress('');
      setSikunLiveThinking('');
      pendingThinkingRef.current = '';
      setMessages(prev => [...prev, {
        id: crypto.randomUUID(),
        role: 'lily',
        text: `${t('エラーが発生しました')}\n${e instanceof Error ? e.message : t('不明なエラー')}`,
        timestamp: Date.now(),
      }]);
    } finally {
      setIsLoading(false);
    }
  }, [input, attachments, isLoading, apiKey, messages, lilyAllNotes, lilyNoteIds, lilyThinking, lilyUltraThinking, allNotes, webSearch, activeMode, economy, activeSkill, compactHistory, t]);

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

    const lastUserText = [...history].reverse().find(h => h.role === 'user')?.text ?? '';
    const regenHasFiles = recentMsgs.some(m => m.role === 'user' && m.attachments?.length);
    const regenAutoLite = !lilyThinking && !lilyUltraThinking && !economy && !isAccuracyTask(lastUserText) && !regenHasFiles;
    const regenCost = pointCostForMode(lilyUltraThinking && !economy, (lilyThinking || isAccuracyTask(lastUserText)) && !economy, economy, regenAutoLite);
    if (!canAfford(regenCost)) {
      setMessages(prev => [...prev, {
        id: crypto.randomUUID(),
        role: 'lily',
        text: `ポイントが足りません（残り${getRemainingPoints()}pt・必要${regenCost}pt）。明日リセットされます。`,
        timestamp: Date.now(),
      }]);
      return;
    }

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

      const accuracy = isAccuracyTask(lastUserText);
      let aiText: string;
      deductPoints(regenCost);
      if (lilyUltraThinking && !economy) {
        const systemPrompt = buildSystemPrompt(contextNotes, activeSkill);
        setSikunLiveThinking('');
        let thinkingAccum = '';
        setSikunProgress(t('⚡ Ultra思考中... 深く考えています'));
        aiText = await streamSikunlilyChat(
          history,
          systemPrompt,
          apiKey,
          16384,
          {
            onThinkingDelta: (delta) => {
              thinkingAccum += delta;
              setSikunLiveThinking(thinkingAccum);
            },
            onResponseDelta: () => {
              setSikunProgress(t('✍️ 回答を生成中...'));
            },
          },
          ['gemini-3.1-pro-preview', 'gemini-3.5-flash', 'gemini-2.5-flash'],
          webSearch,
          65536,
          0.6,
        );
        setSikunProgress('');
        setSikunLiveThinking('');
        pendingThinkingRef.current = thinkingAccum;
      } else if ((lilyThinking || accuracy) && !economy) {
        const systemPrompt = buildSystemPrompt(contextNotes, activeSkill);
        setSikunLiveThinking('');
        let thinkingAccum = '';
        setSikunProgress(accuracy && !lilyThinking ? t('🧠 じっくり考えてるよ…') : t('🧠 思考中...'));
        aiText = await streamSikunlilyChat(
          history,
          systemPrompt,
          apiKey,
          lilyThinking ? 8192 : 4096,
          {
            onThinkingDelta: (delta) => {
              thinkingAccum += delta;
              setSikunLiveThinking(thinkingAccum);
            },
            onResponseDelta: () => {
              setSikunProgress(t('✍️ 回答を生成中...'));
            },
          },
          ['gemini-3.5-flash', 'gemini-2.5-flash'],
          webSearch,
          65536,
          accuracy ? 0.35 : 0.6,
        );
        setSikunProgress('');
        setSikunLiveThinking('');
        pendingThinkingRef.current = thinkingAccum;
      } else {
        const systemPrompt = buildSystemPrompt(contextNotes, activeSkill);
        const regenUseLite = economy || regenAutoLite;
        aiText = await callGeminiChat(history, systemPrompt, apiKey, {
          webSearch,
          models: regenUseLite
            ? ['gemini-3.1-flash-lite', 'gemini-2.5-flash-lite']
            : ['gemini-3.5-flash', 'gemini-2.5-flash'],
          maxOutputTokens: regenUseLite ? 8192 : undefined,
          temperature: accuracy ? 0.35 : undefined,
        });
      }

      const { textContent, blocks, questions } = parseAIResponse(aiText, true);
      const capturedThinking = pendingThinkingRef.current;
      pendingThinkingRef.current = '';
      setMessages(prev => [...prev, {
        id: crypto.randomUUID(),
        role: 'lily',
        text: textContent || (questions.length > 0 ? `${questions.map(q => q.question).join('\n')}\n\n${t('下のフォームから回答してください')}` : '...'),
        timestamp: Date.now(),
        extractedBlocks: blocks.length > 0 ? blocks : undefined,
        questions: questions.length > 0 ? questions : undefined,
        thinking: capturedThinking || undefined,
        usage: getLastUsage() ?? undefined,
      }]);
    } catch (e) {
      setSikunProgress('');
      setSikunLiveThinking('');
      pendingThinkingRef.current = '';
      setMessages(prev => [...prev, {
        id: crypto.randomUUID(),
        role: 'lily',
        text: `${t('エラーが発生しました')}\n${e instanceof Error ? e.message : t('不明なエラー')}`,
        timestamp: Date.now(),
      }]);
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, messages, allNotes, lilyAllNotes, lilyNoteIds, lilyThinking, lilyUltraThinking, activeMode, economy, apiKey, webSearch, activeSkill]);

  const lilyDefaultNoteId = lilyNoteIds[0];

  if (!apiKey) {
    return (
      <div className="ai-chat-container">
        <div className="setup-screen">
          <div className="setup-lily-wrap">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/lily-character.png" alt="Lily" className="setup-lily" />
          </div>
          <h2 className="setup-title">{t('やあ！Lily だよ 🐶')}</h2>
          <p className="setup-desc">
            {t('Gemini API キーを設定すると、メモの分析・図やグラフの作成・問題作りをお手伝いできるよ！')}
          </p>
          <button className="setup-btn" onClick={onOpenSettings}>
            <Sparkles size={18} />
            {t('設定してみる')}
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
          <button className="chat-back-btn" onClick={() => onSwitchTab('memos')} title={t('メモに戻る')}>
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
            <div className="header-sub">{t('AIアシスタント ✨')}</div>
          </div>
        </div>
        <div className="header-right">
          <button className="context-toggle" onClick={() => setShowContextPanel(p => !p)} title={t('メモを選択')}>
            <span className={`context-chip${lilyAllNotes || lilyNoteIds.length > 0 ? ' selected' : ''}`}>
              {lilyAllNotes ? t('📚 全メモ参照中') : lilyNoteIds.length > 0 ? t('📄 {n}件選択中', { n: lilyNoteIds.length }) : t('メモを選ぶ')}
              {showContextPanel ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </span>
          </button>
          <div className="header-menu-wrap">
            <button className={`clear-btn${webSearch || lilyThinking || lilyUltraThinking || economy ? ' has-active' : ''}`} onClick={() => setShowHeaderMenu(v => !v)} title={t('メニュー')}>
              <MoreVertical size={17} />
            </button>
            {showHeaderMenu && typeof document !== 'undefined' && createPortal(
              <>
                <div className="header-menu-backdrop" onClick={() => setShowHeaderMenu(false)} />
                <div className="header-menu">
                  <div className="header-menu-section">{t('応答モード')}</div>
                  <button className={`header-menu-item toggle${webSearch ? ' on' : ''}`} onClick={() => setWebSearch(p => !p)}>
                    <Search size={15} /><span className="hmi-label">{t('ネット検索')}</span><span className="hmi-state">{webSearch ? 'ON' : 'OFF'}</span>
                  </button>
                  <button className={`header-menu-item toggle${lilyThinking ? ' on' : ''}`} onClick={() => setLilyThinking(p => !p)} disabled={economy || lilyUltraThinking}>
                    <span className="hmi-emoji">🧠</span><span className="hmi-label">{t('思考モード')}</span><span className="hmi-state">{lilyThinking ? 'ON' : 'OFF'}</span>
                  </button>
                  <button
                    className={`header-menu-item toggle${lilyUltraThinking ? ' on ultra' : ''}`}
                    onClick={() => setLilyUltraThinking(p => !p)}
                    disabled={economy || lilyThinking}
                  >
                    <span className="hmi-emoji">⚡</span><span className="hmi-label">{t('Ultra思考モード')}</span><span className="hmi-state">{lilyUltraThinking ? 'ON' : 'OFF'}</span>
                  </button>
                  <button className={`header-menu-item toggle${economy ? ' on' : ''}`} onClick={toggleEconomy} disabled={lilyThinking || lilyUltraThinking}>
                    <span className="hmi-emoji">🪶</span><span className="hmi-label">{t('軽量モード')}</span><span className="hmi-state">{economy ? 'ON' : 'OFF'}</span>
                  </button>
                  <div className="header-menu-divider" />
                  {messages.length > 0 && (
                    <button className="header-menu-item" onClick={() => { handleSaveChat(); setShowHeaderMenu(false); }}>
                      <Save size={15} />{t('この会話を保存')}
                    </button>
                  )}
                  <button className="header-menu-item" onClick={() => { setShowHistory(true); setShowHeaderMenu(false); }}>
                    <History size={15} />{t('保存した会話')}
                  </button>
                  {messages.length > 0 && (
                    <button className="header-menu-item" onClick={() => { setMessages([]); setShowHeaderMenu(false); }}>
                      <RotateCcw size={15} />{t('会話をリセット')}
                    </button>
                  )}
                </div>
              </>,
              document.body,
            )}
          </div>
        </div>
      </div>
      {showToolbox && <ToolboxModal onClose={() => setShowToolbox(false)} />}
      {showHistory && <ChatHistoryModal onClose={() => setShowHistory(false)} onLoad={handleLoadChat} />}
      {savedToast && <div className="chat-saved-toast">{t('会話を保存しました ✓')}</div>}
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
                : (allNotes ?? []).filter(n => lilyNoteIds.includes(n.id!)),
              activeSkill,
            ) + (activeMode ? `\n\n（${TONES.find(m => m.id === activeMode)?.directive ?? ''}）` : '')
          }
          modeLabel={TONES.find(m => m.id === activeMode)?.label}
          onClose={() => setShowVoiceChat(false)}
        />
      )}

      {showContextPanel && typeof document !== 'undefined' && createPortal(
        <div className="ctx-backdrop" onClick={() => setShowContextPanel(false)}>
          <div className="ctx-modal" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="ctx-head">
              <NotebookText size={16} className="ctx-head-ic" />
              <span>{t('参照するメモを選ぶ')}</span>
              <button className="ctx-close" onClick={() => setShowContextPanel(false)}><X size={16} /></button>
            </div>

            {/* Quick options */}
            <div className="ctx-quick">
              <button
                className={`ctx-quick-btn${lilyNoteIds.length === 0 ? ' on' : ''}`}
                onClick={() => { setLilyAllNotes(false); setLilyNoteIds([]); }}
              >
                {t('なし')}
              </button>
              <span className="ctx-quick-hint">{t('最大{n}件まで選択できます', { n: MAX_CONTEXT_NOTES })}</span>
            </div>

            {/* Search */}
            <div className="ctx-search">
              <Search size={14} />
              <input
                value={contextSearch}
                onChange={e => setContextSearch(e.target.value)}
                placeholder={t('メモを検索…')}
              />
              {contextSearch && <button onClick={() => setContextSearch('')}><X size={12} /></button>}
            </div>

            {/* Note list */}
            <div className="ctx-list">
              {(allNotes ?? [])
                .filter(n => !contextSearch || `${n.title} ${chatFolders.find(f => f.id === n.folderId)?.name ?? ''}`.toLowerCase().includes(contextSearch.toLowerCase()))
                .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
                .map(n => {
                  const sel = lilyNoteIds.includes(n.id!);
                  const fname = chatFolders.find(f => f.id === n.folderId)?.name;
                  return (
                    <button
                      key={n.id}
                      className={`ctx-item${sel ? ' on' : ''}`}
                      onClick={() => {
                        setLilyAllNotes(false);
                        setLilyNoteIds(prev => {
                          if (prev.includes(n.id!)) return prev.filter(id => id !== n.id);
                          if (prev.length >= MAX_CONTEXT_NOTES) return prev; // cap reached
                          return [...prev, n.id!];
                        });
                      }}
                    >
                      <span className="ctx-check">{sel && <Check size={11} />}</span>
                      <span className="ctx-item-info">
                        <span className="ctx-item-title">{n.title || t('無題のメモ')}</span>
                        {fname && <span className="ctx-item-folder">{fname}</span>}
                      </span>
                    </button>
                  );
                })}
            </div>

            {/* Footer */}
            <div className="ctx-foot">
              <span className="ctx-foot-count">
                {lilyAllNotes
                  ? t('📚 全メモ参照中')
                  : lilyNoteIds.length > 0
                    ? t('{n}件 選択中', { n: lilyNoteIds.length })
                    : t('参照なし')}
              </span>
              <button className="ctx-done" onClick={() => setShowContextPanel(false)}>{t('決定')}</button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      <div className="messages-list">
        {messages.length === 0 && (
          <div className="welcome-lily-wrap">
            <div className="welcome-lily-stage">
              <span className="welcome-halo" />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/9D507C9A-09F0-4B05-9F41-612FBD120675.png" alt="Lily" className="welcome-lily" />
            </div>
            {(() => {
              const wPlan = getPlan();
              const wDaily = PLAN_DAILY_POINTS[wPlan];
              const wRemaining = getRemainingPoints();
              const wPct = Math.max(0, Math.min(100, (wRemaining / wDaily) * 100));
              const R = 36;
              const circ = 2 * Math.PI * R;
              const dash = circ * (wPct / 100);
              const color = wPct > 50 ? 'var(--primary,#f06292)' : wPct > 20 ? '#f59e0b' : '#ef4444';
              return (
                <div className="pt-gauge-wrap">
                  <svg className="pt-gauge-svg" viewBox="0 0 88 88" width="88" height="88">
                    <circle cx="44" cy="44" r={R} fill="none" stroke="var(--border,#eee)" strokeWidth="7" />
                    <circle
                      cx="44" cy="44" r={R} fill="none"
                      stroke={color} strokeWidth="7"
                      strokeLinecap="round"
                      strokeDasharray={`${dash} ${circ}`}
                      transform="rotate(-90 44 44)"
                      style={{ transition: 'stroke-dasharray 0.6s ease, stroke 0.4s ease' }}
                    />
                  </svg>
                  <div className="pt-gauge-inner">
                    <span className="pt-gauge-num">{wRemaining >= 1000 ? `${(wRemaining/1000).toFixed(1)}k` : wRemaining}</span>
                    <span className="pt-gauge-label">pt</span>
                  </div>
                  <div className="pt-gauge-plan">{PLAN_LABEL[wPlan]}</div>
                </div>
              );
            })()}
            {(() => {
              const q = getDailyQuote(getAppLang());
              return (
                <div className="welcome-quote">
                  <span className="welcome-quote-mark">"</span>
                  <span className="welcome-quote-label">{t('今日の一言')}</span>
                  <p className="welcome-quote-text">{q.text}</p>
                  <p className="welcome-quote-author">— {q.author}</p>
                </div>
              );
            })()}
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
              onQaCheck={(blockId, indices) =>
                setMessages(prev => prev.map(m =>
                  m.id === msg.id
                    ? { ...m, qaChecked: { ...m.qaChecked, [blockId]: indices } }
                    : m
                ))
              }
            />
          );
        })}
        {isLoading && (
          <>
            <TypingIndicator />
            <BoxingOverlay />
            {sikunProgress && <div className={`siku-progress${lilyUltraThinking ? ' ultra' : lilyThinking ? ' thinking' : ''}`}>{sikunProgress}</div>}
            {sikunLiveThinking && (
              <div className={`siku-thinking-live${lilyUltraThinking ? ' ultra' : ''}`}>
                <div className="siku-thinking-live-header">
                  <span className="siku-thinking-pulse" />
                  {lilyUltraThinking ? t('⚡ Ultra思考ログ') : t('思考ログ（リアルタイム）')}
                </div>
                <div className="siku-thinking-live-body">{sikunLiveThinking}</div>
              </div>
            )}
          </>
        )}
        <div ref={messagesEndRef} />
      </div>


      {/* Skills: tapping toggles the skill on; while on, Lily's whole behaviour
          changes (system prompt + reference materials). */}
      <div className="quick-actions mode-row">
        <button className="qa-toolbox-btn" onClick={() => setShowToolbox(true)} title={t('ツールボックスを開く（スキル・トーン・ショートカットを作成/編集できるよ）')}>
          <Wrench size={12} />
          <span>{t('ツール')}</span>
        </button>
        <span className="qa-label">{t('スキル')}</span>
        {skills.map(sk => (
          <button
            key={sk.id}
            className={`quick-chip skill-chip${activeSkillId === sk.id ? ' on' : ''}`}
            onClick={() => setActiveSkillId(p => (p === sk.id ? null : sk.id!))}
            title={sk.instructions.slice(0, 80)}
          >
            {sk.emoji} {sk.name}{sk.references.length > 0 ? ' 📎' : ''}{activeSkillId === sk.id ? ' ✓' : ''}
          </button>
        ))}
      </div>

      {enabledTones.length > 0 && (
        <div className="quick-actions mode-row skill-row">
          <span className="qa-label">{t('トーン')}</span>
          {TONES.filter(mo => enabledTones.includes(mo.id)).map(mo => (
            <button
              key={mo.id}
              className={`quick-chip mode-chip${activeMode === mo.id ? ' on' : ''}`}
              onClick={() => setActiveMode(p => (p === mo.id ? null : mo.id))}
              title={t('タップでON。次に送るメッセージからこのトーンで答えてくれるよ')}
            >
              {t(mo.label)}{activeMode === mo.id ? ' ✓' : ''}
            </button>
          ))}
        </div>
      )}

      {/* Notebook bar: NotebookLM-style generation actions when notes are selected */}
      {(lilyAllNotes || lilyNoteIds.length > 0) && (
        <div className="quick-actions nb-bar">
          <span className="nb-bar-label">📓</span>
          {([
            { id: 'summary',  label: '要点まとめ', prompt: '選択したメモの内容を、見出しと箇条書きを使って要点でまとめてください。' },
            { id: 'qa',       label: 'Q&A問題',   prompt: '選択したメモから一問一答（Q&A）の練習問題を作成してください。重要な概念・用語・事実をカバーすること。' },
            { id: 'timeline', label: '年表',       prompt: '選択したメモに出てくる出来事・トピックを時系列に並べた年表を作成してください。' },
            { id: 'keywords', label: 'キーワード', prompt: '選択したメモに出てくる重要なキーワード・用語を全て抽出し、それぞれの意味・重要性を簡潔に説明してください。' },
            { id: 'briefing', label: 'ブリーフィング', prompt: '選択したメモをもとに、第三者に内容を伝えるためのブリーフィングドキュメントを作成してください。背景・要点・重要事項を含めてください。' },
          ] as const).map(a => (
            <button key={a.id} className="nb-btn" onClick={() => { void sendMessage(a.prompt); }} disabled={isLoading}>
              {a.label}
            </button>
          ))}
        </div>
      )}

      {/* Shortcuts: one-tap canned prompts (user-editable). Hidden in EN mode or when none added. */}
      {getAppLang() !== 'en' && shortcuts.length > 0 && (
        <div className="quick-actions">
          <Wand2 size={14} className="qa-wand" />
          {shortcuts.map(sc => (
            <button key={sc.id} className="quick-chip" onClick={() => fillInput(sc.prompt)} disabled={isLoading}>
              {sc.label}
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
              <span className="att-chip-name">{att.uploading ? t('{name} (アップロード中...)', { name: att.name }) : att.name}</span>
              <button className="att-remove" onClick={() => removeAttachment(i)} title={t('削除')}><X size={14} /></button>
            </div>
          ))}
          {fileError && <span className="att-error">{fileError}</span>}
        </div>
      )}

      {slashSuggestions.length > 0 && (
        <div className="slash-suggestions">
          {slashSuggestions.map(s => (
            <button
              key={s.id}
              className="slash-suggestion"
              onClick={() => fillInput(`${s.cmd} `)}
            >
              <span className="slash-cmd">{s.cmd}</span>
              <span className="slash-desc">{t(s.description)}</span>
            </button>
          ))}
        </div>
      )}

      {practiceCtxUI && (
        <div className="practice-ctx-bar">
          <PencilLine size={12} />
          <span>{getAppLang() === 'en' ? 'Practice context attached — type your question' : '演習コンテキスト添付済み — 質問を入力してね'}</span>
          <button onClick={() => { practiceCtxRef.current = null; setPracticeCtxUI(null); }} title="削除">
            <X size={12} />
          </button>
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
          title={t('ファイルを添付（複数可）')}
        >
          <Paperclip size={20} />
        </button>
        <button
          className="attach-btn lecture-btn"
          onClick={() => setShowLectureRecorder(true)}
          disabled={isLoading}
          title={t('授業リアルタイム要約 — 音声を文字起こし→Geminiでまとめ')}
        >
          <Mic size={20} />
        </button>
        <button
          className="attach-btn voice-chat-btn"
          onClick={() => setShowVoiceChat(true)}
          disabled={isLoading}
          title={t('音声対話 — Lily と声で会話する')}
        >
          <Phone size={20} />
        </button>
        <textarea
          ref={textareaRef}
          className="chat-input"
          placeholder={t('Lily に話しかける...（Enter で改行 / 送信はボタン）')}
          value={input}
          onChange={e => { setInput(e.target.value); autoResizeTextarea(); }}
          rows={1}
          disabled={isLoading}
        />
        <button
          className="send-btn"
          onClick={() => sendMessage()}
          disabled={(!input.trim() && attachments.length === 0) || isLoading || attachments.some(a => a.uploading)}
          title={t('送信 (Enter)')}
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
        .siku-progress.ultra { color: transparent; background: linear-gradient(90deg, #f59e0b, #ec4899, #8b5cf6, #f59e0b); background-size: 200% auto; background-clip: text; -webkit-background-clip: text; animation: ultra-progress-shine 2s linear infinite; font-weight: 700; font-style: normal; }
        @keyframes ultra-progress-shine { 0% { background-position: 0% center; } 100% { background-position: 200% center; } }
        .siku-progress.thinking { color: transparent; background: linear-gradient(90deg, #6366f1, #a855f7, #06b6d4, #6366f1); background-size: 200% auto; background-clip: text; -webkit-background-clip: text; animation: thinking-progress-shine 2.5s linear infinite; font-weight: 600; font-style: normal; }
        @keyframes thinking-progress-shine { 0% { background-position: 0% center; } 100% { background-position: 200% center; } }
        .header-menu-item.toggle.on.ultra { background: linear-gradient(120deg, rgba(245,158,11,0.15), rgba(139,92,246,0.15)); border-color: #f59e0b; color: #f59e0b; }
        .chat-saved-toast { position: fixed; left: 50%; bottom: 120px; transform: translateX(-50%); z-index: 6000; background: var(--foreground); color: var(--background); font-size: 0.84rem; font-weight: 700; padding: 10px 18px; border-radius: 999px; box-shadow: 0 4px 16px rgba(0,0,0,0.25); animation: toastIn 0.2s ease; pointer-events: none; }
        @keyframes toastIn { from { opacity: 0; transform: translateX(-50%) translateY(8px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } }
        .siku-thinking-live {
          margin: 4px 0 4px 52px;
          border: 1.5px solid #334155; border-radius: 10px;
          background: #0f172a; overflow: hidden;
          position: relative;
          box-shadow: 0 0 0 0 rgba(99,102,241,0);
          animation: thinkGlow 2.4s ease-in-out infinite;
        }
        @keyframes thinkGlow {
          0%,100% { box-shadow: 0 0 8px 0 rgba(99,102,241,0.18), inset 0 0 20px rgba(99,102,241,0.04); border-color: #334155; }
          50% { box-shadow: 0 0 18px 2px rgba(99,102,241,0.38), inset 0 0 28px rgba(99,102,241,0.10); border-color: #6366f1; }
        }
        .siku-thinking-live.ultra {
          animation: ultraGlow 1.6s ease-in-out infinite;
          border-color: #f59e0b;
        }
        @keyframes ultraGlow {
          0% { box-shadow: 0 0 12px 2px rgba(245,158,11,0.35), inset 0 0 24px rgba(245,158,11,0.08); border-color: #f59e0b; }
          25% { box-shadow: 0 0 20px 4px rgba(236,72,153,0.45), inset 0 0 32px rgba(236,72,153,0.12); border-color: #ec4899; }
          50% { box-shadow: 0 0 24px 5px rgba(139,92,246,0.50), inset 0 0 36px rgba(139,92,246,0.14); border-color: #8b5cf6; }
          75% { box-shadow: 0 0 20px 4px rgba(236,72,153,0.45), inset 0 0 32px rgba(236,72,153,0.12); border-color: #ec4899; }
          100% { box-shadow: 0 0 12px 2px rgba(245,158,11,0.35), inset 0 0 24px rgba(245,158,11,0.08); border-color: #f59e0b; }
        }
        .siku-thinking-live-header {
          display: flex; align-items: center; gap: 7px;
          padding: 6px 12px; font-size: 0.72rem; font-weight: 600;
          color: #64748b; border-bottom: 1px solid #1e293b;
        }
        .siku-thinking-live.ultra .siku-thinking-live-header {
          color: transparent;
          background: linear-gradient(90deg, #f59e0b, #ec4899, #8b5cf6, #f59e0b);
          background-size: 200% auto;
          background-clip: text; -webkit-background-clip: text;
          animation: ultraTextShine 2s linear infinite;
        }
        @keyframes ultraTextShine { 0% { background-position: 0% center; } 100% { background-position: 200% center; } }
        .siku-thinking-pulse {
          width: 7px; height: 7px; border-radius: 50%; background: #6366f1;
          animation: thinkPulse 1.2s ease-in-out infinite;
          flex-shrink: 0; flex-shrink: 0;
        }
        .siku-thinking-live.ultra .siku-thinking-pulse {
          background: linear-gradient(135deg, #f59e0b, #ec4899);
          animation: ultraPulse 0.8s ease-in-out infinite;
          box-shadow: 0 0 6px 2px rgba(245,158,11,0.6);
        }
        @keyframes thinkPulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.35;transform:scale(0.7)} }
        @keyframes ultraPulse { 0%,100%{opacity:1;transform:scale(1.1);box-shadow:0 0 8px 3px rgba(245,158,11,0.7)} 50%{opacity:0.6;transform:scale(0.85);box-shadow:0 0 4px 1px rgba(139,92,246,0.5)} }
        .siku-thinking-live-body {
          padding: 8px 12px; max-height: 180px; overflow-y: auto;
          font-size: 0.7rem; line-height: 1.55; color: #64748b;
          font-family: 'Fira Code','Consolas',monospace;
          white-space: pre-wrap; word-break: break-word;
        }
        .context-toggle { background: transparent; border: none; cursor: pointer; padding: 2px; }
        .context-chip { display: inline-flex; align-items: center; gap: 4px; background: var(--accent); border: 1px solid var(--border); border-radius: 20px; padding: 4px 10px; font-size: 0.78rem; color: var(--fg-muted); white-space: nowrap; max-width: 150px; overflow: hidden; text-overflow: ellipsis; cursor: pointer; }
        .context-chip.selected { color: var(--primary); border-color: var(--primary); }
        .clear-btn { background: transparent; border: 1px solid var(--border); border-radius: 8px; padding: 5px 7px; cursor: pointer; color: var(--fg-muted); display: flex; align-items: center; position: relative; }
        .clear-btn.has-active::after { content: ''; position: absolute; top: 2px; right: 2px; width: 7px; height: 7px; border-radius: 50%; background: var(--primary); border: 1.5px solid var(--background); }
        .header-menu-wrap { position: relative; flex-shrink: 0; }
        .header-menu-backdrop { position: fixed; inset: 0; z-index: 40; }
        .header-menu { position: fixed; top: 52px; right: 10px; z-index: 9997; background: var(--background); border: 1px solid var(--border); border-radius: 12px; box-shadow: 0 8px 28px rgba(0,0,0,0.16); padding: 6px; min-width: 220px; display: flex; flex-direction: column; gap: 2px; }
        .header-menu-section { font-size: 0.68rem; font-weight: 700; color: var(--fg-muted); text-transform: uppercase; letter-spacing: 0.04em; padding: 6px 12px 2px; }
        .header-menu-divider { height: 1px; background: var(--border); margin: 5px 4px; }
        .header-menu-item { display: flex; align-items: center; gap: 10px; background: none; border: none; border-radius: 8px; padding: 9px 12px; font-size: 0.84rem; color: var(--foreground); cursor: pointer; text-align: left; white-space: nowrap; }
        .header-menu-item:hover { background: var(--accent); color: var(--primary); }
        .header-menu-item.toggle .hmi-label { flex: 1; }
        .header-menu-item.toggle .hmi-emoji { font-size: 14px; width: 15px; text-align: center; }
        .header-menu-item.toggle .hmi-state { font-size: 0.7rem; font-weight: 800; color: var(--fg-muted); }
        .header-menu-item.toggle.on { color: var(--primary); }
        .header-menu-item.toggle.on .hmi-state { color: var(--primary); }
        .header-menu-item.toggle:disabled { opacity: 0.4; cursor: default; }
        .header-menu-item.toggle:disabled:hover { background: none; color: var(--foreground); }
        /* Note context picker modal */
        .ctx-backdrop { position: fixed; inset: 0; z-index: 10010; background: rgba(0,0,0,.45); backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; padding: 20px; animation: ctx-fade .18s ease; }
        @keyframes ctx-fade { from { opacity: 0; } to { opacity: 1; } }
        .ctx-modal { width: 100%; max-width: 420px; max-height: min(76vh, 580px); display: flex; flex-direction: column; background: var(--background); border: 1px solid var(--border); border-radius: 18px; overflow: hidden; box-shadow: 0 20px 60px rgba(0,0,0,.28); }
        .ctx-head { display: flex; align-items: center; gap: 8px; padding: 14px 16px; font-size: .9rem; font-weight: 800; border-bottom: 1px solid var(--border); }
        .ctx-head-ic { color: var(--primary); }
        .ctx-close { margin-left: auto; display: flex; align-items: center; border: none; background: none; color: var(--fg-muted); cursor: pointer; padding: 2px; border-radius: 8px; }
        .ctx-close:hover { color: var(--foreground); background: var(--border); }
        .ctx-quick { display: flex; gap: 8px; padding: 10px 14px 6px; align-items: center; }
        .ctx-quick-hint { font-size: .72rem; color: var(--fg-muted); opacity: .8; }
        .ctx-quick-btn { padding: 7px 12px; border: 1.5px solid var(--border); border-radius: 10px; font-size: .8rem; font-weight: 700; background: none; color: var(--fg-muted); cursor: pointer; transition: all .14s; }
        .ctx-quick-btn.on { background: var(--primary); color: #fff; border-color: var(--primary); }
        .ctx-search { display: flex; align-items: center; gap: 8px; margin: 4px 14px 8px; padding: 7px 12px; background: color-mix(in srgb, var(--fg-muted) 8%, var(--background)); border: 1px solid var(--border); border-radius: 10px; color: var(--fg-muted); }
        .ctx-search input { flex: 1; border: none; background: none; outline: none; font-size: .84rem; color: var(--foreground); font-family: inherit; }
        .ctx-search button { display: flex; align-items: center; border: none; background: none; cursor: pointer; color: var(--fg-muted); padding: 0; }
        .ctx-list { flex: 1; overflow-y: auto; padding: 4px 10px; display: flex; flex-direction: column; gap: 2px; }
        .ctx-item { display: flex; align-items: center; gap: 10px; width: 100%; text-align: left; padding: 8px 10px; border: none; background: none; border-radius: 10px; cursor: pointer; transition: background .12s; }
        .ctx-item:hover:not(.dim) { background: color-mix(in srgb, var(--primary) 8%, transparent); }
        .ctx-item.on { background: color-mix(in srgb, var(--primary) 12%, transparent); }
        .ctx-item.dim { opacity: .4; cursor: default; }
        .ctx-check { flex-shrink: 0; width: 20px; height: 20px; border-radius: 6px; border: 1.5px solid var(--border); display: flex; align-items: center; justify-content: center; color: #fff; }
        .ctx-item.on .ctx-check { background: var(--primary); border-color: var(--primary); }
        .ctx-item-info { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
        .ctx-item-title { font-size: .84rem; font-weight: 600; color: var(--foreground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .ctx-item-folder { font-size: .68rem; color: var(--fg-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .ctx-foot { display: flex; align-items: center; gap: 10px; padding: 11px 16px; border-top: 1px solid var(--border); }
        .ctx-foot-count { font-size: .78rem; font-weight: 700; color: var(--fg-muted); }
        .ctx-done { margin-left: auto; padding: 7px 20px; border: none; border-radius: 10px; background: var(--primary); color: #fff; font-size: .84rem; font-weight: 700; cursor: pointer; }
        .ctx-done:hover { filter: brightness(1.1); }
        .messages-list { flex: 1; overflow-y: auto; padding: 16px 14px; display: flex; flex-direction: column; gap: 14px; padding-bottom: 20px; }
        .welcome-lily-wrap { display: flex; flex-direction: column; align-items: center; padding: 32px 0 10px; gap: 20px; animation: welcome-in 0.6s cubic-bezier(0.22, 1, 0.36, 1); }
        @keyframes welcome-in { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
        .pt-gauge-wrap { position: relative; display: flex; flex-direction: column; align-items: center; gap: 4px; }
        .pt-gauge-svg { display: block; filter: drop-shadow(0 2px 8px color-mix(in srgb, var(--primary) 30%, transparent)); }
        .pt-gauge-inner { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -52%); display: flex; flex-direction: column; align-items: center; line-height: 1; }
        .pt-gauge-num { font-size: 1.15rem; font-weight: 800; color: var(--text,#333); }
        .pt-gauge-label { font-size: 0.6rem; font-weight: 700; color: var(--text-muted,#888); letter-spacing: 0.05em; }
        .pt-gauge-plan { font-size: 0.65rem; font-weight: 700; color: var(--primary); letter-spacing: 0.1em; text-transform: uppercase; opacity: 0.85; }
        .welcome-lily-stage { position: relative; display: flex; justify-content: center; align-items: center; }
        .welcome-halo {
          position: absolute; width: 180px; height: 180px; border-radius: 50%;
          background: radial-gradient(circle, color-mix(in srgb, var(--primary) 38%, transparent) 0%, transparent 68%);
          filter: blur(14px); animation: halo-pulse 4s ease-in-out infinite;
        }
        @keyframes halo-pulse { 0%, 100% { transform: scale(1); opacity: 0.75; } 50% { transform: scale(1.15); opacity: 1; } }
        .welcome-lily { position: relative; width: 142px; height: auto; object-fit: contain; animation: float 3.4s ease-in-out infinite; filter: drop-shadow(0 8px 18px rgba(0,0,0,0.18)); }
        @keyframes float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }
        .welcome-quote {
          position: relative; max-width: 320px; margin: 0 14px; padding: 22px 22px 18px;
          text-align: center; border-radius: 20px;
          background: color-mix(in srgb, var(--card, var(--background)) 82%, transparent);
          border: 1px solid color-mix(in srgb, var(--primary) 22%, var(--border));
          box-shadow: 0 10px 30px -12px color-mix(in srgb, var(--primary) 40%, transparent), inset 0 1px 0 rgba(255,255,255,0.06);
          backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); overflow: hidden;
        }
        .welcome-quote::before {
          content: ''; position: absolute; inset: 0; pointer-events: none;
          background: linear-gradient(135deg, color-mix(in srgb, var(--primary) 10%, transparent) 0%, transparent 55%);
        }
        .welcome-quote-mark {
          position: absolute; top: -6px; left: 14px; font-size: 4rem; line-height: 1;
          font-family: Georgia, 'Times New Roman', serif;
          color: color-mix(in srgb, var(--primary) 28%, transparent); user-select: none; pointer-events: none;
        }
        .welcome-quote-label {
          position: relative; display: inline-block; margin-bottom: 10px;
          font-size: 0.64rem; font-weight: 800; letter-spacing: 0.14em; text-transform: uppercase;
          color: var(--primary); opacity: 0.85;
        }
        .welcome-quote-text { position: relative; font-size: 0.92rem; line-height: 1.7; color: var(--fg); font-weight: 600; margin: 0 0 10px; }
        .welcome-quote-author { position: relative; font-size: 0.76rem; color: var(--fg-muted); font-weight: 600; margin: 0; }
        .suggestions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; max-width: 400px; }
        .suggestion-chip { background: color-mix(in srgb, var(--primary) 12%, transparent); border: 1px solid color-mix(in srgb, var(--primary) 30%, transparent); color: var(--primary); border-radius: 20px; padding: 6px 14px; font-size: 0.82rem; font-weight: 600; cursor: pointer; transition: all 0.15s; }
        .suggestion-chip:hover { background: var(--primary); color: white; }
        .quick-actions { display: flex; align-items: center; gap: 6px; padding: 8px 14px; border-top: 1px solid var(--border); background: var(--accent); overflow-x: auto; overflow-y: hidden; -webkit-overflow-scrolling: touch; scrollbar-width: none; flex-shrink: 0; }
        .quick-actions::-webkit-scrollbar { display: none; }
        .quick-actions :global(.qa-wand) { color: var(--primary); flex-shrink: 0; }
        .quick-chip { flex-shrink: 0; background: var(--background); border: 1px solid var(--border); border-radius: 16px; padding: 5px 12px; font-size: 0.76rem; font-weight: 600; color: var(--foreground); cursor: pointer; white-space: nowrap; transition: all 0.15s; }
        .quick-chip:hover:not(:disabled) { border-color: var(--primary); color: var(--primary); }
        .quick-chip:disabled { opacity: 0.5; cursor: default; }
        .mode-row { border-top: none; padding-bottom: 0; }
        .skill-row { padding-top: 0; }
        .qa-label { flex-shrink: 0; font-size: 0.7rem; font-weight: 700; color: var(--fg-muted); }
        .mode-chip.on { background: var(--primary); color: #fff; border-color: var(--primary); }
        .skill-chip { border-color: color-mix(in srgb, var(--primary) 40%, var(--border)); }
        .skill-chip.on { background: var(--primary); color: #fff; border-color: var(--primary); }
        .qa-toolbox-btn { flex-shrink: 0; display: flex; align-items: center; gap: 4px; background: var(--background); border: 1px solid var(--primary); border-radius: 16px; padding: 5px 10px; font-size: 0.72rem; font-weight: 700; color: var(--primary); cursor: pointer; white-space: nowrap; }
        .qa-toolbox-btn:hover { background: var(--primary); color: #fff; }
        .nb-bar { border-top: 1.5px solid color-mix(in srgb, var(--primary) 25%, var(--border)); background: color-mix(in srgb, var(--primary) 5%, var(--accent)); }
        .nb-bar-label { flex-shrink: 0; font-size: 0.75rem; font-weight: 700; color: var(--fg-muted); }
        .nb-btn { flex-shrink: 0; background: var(--background); border: 1px solid color-mix(in srgb, var(--primary) 35%, var(--border)); border-radius: 16px; padding: 5px 11px; font-size: 0.73rem; font-weight: 600; color: var(--primary); cursor: pointer; white-space: nowrap; transition: all 0.15s; }
        .nb-btn:hover:not(:disabled) { background: var(--primary); color: #fff; border-color: var(--primary); }
        .nb-btn:disabled { opacity: 0.4; cursor: default; }
        .slash-suggestions { display: flex; flex-direction: column; gap: 2px; padding: 6px 14px; border-top: 1px solid var(--border); background: var(--accent); flex-shrink: 0; max-height: 160px; overflow-y: auto; }
        .slash-suggestion { display: flex; align-items: baseline; gap: 8px; background: var(--background); border: 1px solid var(--border); border-radius: 8px; padding: 6px 10px; font-size: 0.78rem; cursor: pointer; text-align: left; color: var(--foreground); transition: border-color 0.15s; }
        .slash-suggestion:hover { border-color: var(--primary); }
        .slash-cmd { font-family: monospace; font-weight: 700; color: var(--primary); flex-shrink: 0; }
        .slash-desc { opacity: 0.65; font-size: 0.72rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
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
        .practice-ctx-bar { display: flex; align-items: center; gap: 8px; padding: 7px 14px; border-top: 1px solid color-mix(in srgb, #8b5cf6 30%, var(--border)); background: color-mix(in srgb, #8b5cf6 8%, var(--background)); flex-shrink: 0; font-size: 0.76rem; font-weight: 700; color: #8b5cf6; }
        .practice-ctx-bar span { flex: 1; }
        .practice-ctx-bar button { display: flex; align-items: center; justify-content: center; width: 20px; height: 20px; border-radius: 50%; border: none; background: color-mix(in srgb, #8b5cf6 20%, transparent); color: #8b5cf6; cursor: pointer; flex-shrink: 0; }
        .att-bar { display: flex; align-items: center; gap: 10px; padding: 8px 14px; border-top: 1px solid var(--border); background: var(--accent); flex-shrink: 0; overflow-x: auto; }
        .att-chip { display: inline-flex; align-items: center; gap: 8px; background: var(--background); border: 1px solid var(--border); border-radius: 10px; padding: 5px 8px 5px 10px; flex-shrink: 0; }
        .att-chip-thumb { width: 32px; height: 32px; object-fit: cover; border-radius: 6px; }
        .att-chip-icon { font-size: 1rem; }
        .att-chip-name { font-size: 0.78rem; color: var(--foreground); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 120px; }
        .att-remove { background: transparent; border: none; cursor: pointer; color: var(--fg-muted); display: flex; align-items: center; padding: 2px; }
        .att-error { font-size: 0.78rem; color: #cc0000; flex-shrink: 0; }
        @media (max-width: 1023px) {
          .messages-list { padding-bottom: 16px; }
        }
      `}</style>
    </div>
  );
}
