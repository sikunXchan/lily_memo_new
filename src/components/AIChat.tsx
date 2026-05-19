'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Sparkles, Send, ChevronDown, ChevronUp, RotateCcw, Book, Brush,
  FileText, Settings as SettingsIcon, Paperclip, X, Search,
  FileDown, Wand2, Download, Pencil,
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
import type { Note } from '@/lib/db';
import {
  callGeminiChat, callSikunLilyChat, callNanobanana, analyzeSlideImages, callDeepResearch,
  LILY_CHAT_SYSTEM_PROMPT, SIKUNLILY_CHAT_SYSTEM_PROMPT,
} from '@/lib/gemini';
import type { ChatTurn, ChatAttachment, SikunLilyProgress, SlideImageRequest } from '@/lib/gemini';
import { noteHtmlToText } from '@/lib/noteText';
import { parseSlides, exportSlidesToPptx } from '@/lib/slides';
import type { GeneratedImages } from '@/lib/slides';
import { removeImageBackground } from '@/lib/bgRemoval';
import { parseGeometry, renderGeometrySvg } from '@/lib/geometry';
import { renderRich } from '@/lib/richText';
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
  name: string;
  mimeType: string;
  data: string; // base64
  isImage: boolean;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'lily';
  text: string;
  timestamp: number;
  extractedBlocks?: InsertableBlock[];
  questions?: ClarifyQuestion[];
  attachments?: AttachmentMeta[];
}

interface InsertableBlock {
  id: string;
  type: 'mermaid' | 'chart' | 'qa' | 'slides' | 'file' | 'geometry' | 'memo_create' | 'memo_overwrite';
  rawCode: string;
  previewLabel: string;
  fileName?: string;
  memoTitle?: string;
  memoId?: number;
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

  const FENCE_RE = /```(mermaid|chart|qa|slides|geometry|memo_create|memo_overwrite)([\s\S]*?)```/g;
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
    .map(n => `## ${n.title || '無題'}\n${noteHtmlToText(n.content || '').slice(0, 4000)}`)
    .join('\n\n---\n\n');
  return `${LILY_CHAT_SYSTEM_PROMPT}\n\n【参照中のメモ (${contextNotes.length}件)】\n${context}`;
}

function buildSikunSystemPrompt(contextNotes: Note[]): string {
  if (contextNotes.length === 0) return SIKUNLILY_CHAT_SYSTEM_PROMPT;
  const context = contextNotes
    .map(n => `## ${n.title || '無題'}\n${noteHtmlToText(n.content || '').slice(0, 4000)}`)
    .join('\n\n---\n\n');
  return `${SIKUNLILY_CHAT_SYSTEM_PROMPT}\n\n【参照中のメモ (${contextNotes.length}件)】\n${context}`;
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

function MermaidPreview({ code, baseName }: { code: string; baseName: string }) {
  const [svg, setSvg] = useState('');
  const [err, setErr] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const id = `lily-mmd-${Math.random().toString(36).slice(2, 9)}`;
        const { svg: out } = await mermaid.render(id, code);
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
  return (
    <div className="qa-prev">
      {pairs.map((p, i) => (
        <div key={i} className="qa-item">
          <div className="qa-q">Q{i + 1}. {p.q}</div>
          {open.has(i) ? (
            <div className="qa-a">A. {p.a}</div>
          ) : (
            <button className="qa-show" onClick={() => setOpen(s => new Set(s).add(i))}>答えを見る</button>
          )}
        </div>
      ))}
      <style jsx>{`
        .qa-prev { display:flex; flex-direction:column; gap:8px; }
        .qa-item { background:var(--background); border:1px solid var(--border); border-radius:8px; padding:8px 10px; }
        .qa-q { font-weight:700; font-size:0.82rem; color:var(--foreground); }
        .qa-a { margin-top:6px; font-size:0.82rem; color:var(--primary); white-space:pre-wrap; }
        .qa-show { margin-top:6px; background:transparent; border:1px dashed var(--border); border-radius:6px; padding:3px 10px; font-size:0.74rem; color:var(--fg-muted); cursor:pointer; }
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
  const [pptxProgress, setPptxProgress] = useState('');
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
      let images: GeneratedImages | undefined;

      if (isPremium) {
        const apiKey = (localStorage.getItem('gemini_api_key') || '').trim();
        if (apiKey) {
          setPptxProgress('スライドを分析中...');
          let requests: SlideImageRequest[] = [];
          try { requests = await analyzeSlideImages(block.rawCode, apiKey); } catch { /* skip on failure */ }

          if (requests.length > 0) {
            images = {};
            for (let i = 0; i < requests.length; i++) {
              const req = requests[i];
              try {
                setPptxProgress(`🎨 画像を生成中... (${i + 1}/${requests.length})`);
                const b64 = await callNanobanana(req.prompt, apiKey, req.quality);
                setPptxProgress(`✂️ 背景を除去中... (${i + 1}/${requests.length})`);
                images[req.slideIndex] = await removeImageBackground(b64);
              } catch (imgErr) {
                console.warn('Nanobanana/BG-removal failed for slide', req.slideIndex, imgErr);
                setPptxProgress(`⚠️ 画像スキップ (${i + 1}/${requests.length}): ${imgErr instanceof Error ? imgErr.message : '不明なエラー'}`);
                await new Promise(r => setTimeout(r, 1200));
              }
            }
          }
        }
      }

      setPptxProgress('PPTXを組み立て中...');
      await exportSlidesToPptx(deck, isPremium ? 'premium' : 'standard', images);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'PowerPointの作成に失敗しちゃった');
    } finally {
      setPdfStatus('idle');
      setPptxProgress('');
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
          {pdfStatus === 'loading' ? (pptxProgress || 'PowerPoint作成中...') : 'PowerPoint(.pptx)で保存'}
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
        {message.extractedBlocks && message.extractedBlocks.length > 0 && (
          <div className="block-list">
            {message.extractedBlocks.map(block => (
              <InsertableBlockCard
                key={block.id}
                block={block}
                allNotes={allNotes}
                defaultNoteId={selectedNoteId}
                isPremium={model === 'sikunlily'}
                onNoteCreated={onNoteCreated}
              />
            ))}
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
  'このメモをプレゼン用スライドにして',
  '複数ファイルのコードプロジェクトを作って',
  'このドキュメントを分析してまとめて',
  'スライドのテーマと構成を提案して',
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
  { label: '🖼️ スライド化', prompt: 'このメモの内容をプレゼン用のスライドにまとめて。' },
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
  const [deepResearch, setDeepResearch] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const allNotes = useLiveQuery(
    () => db.notes.filter(n => !n.deletedAt && n.type !== 'handwriting').toArray(),
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
      reader.onload = () => {
        const result = reader.result as string;
        const base64 = result.split(',')[1] ?? '';
        setAttachments(prev =>
          prev.length >= MAX_FILES
            ? prev
            : [...prev, {
                name: file.name,
                mimeType: file.type || 'application/octet-stream',
                data: base64,
                isImage: file.type.startsWith('image/'),
              }]
        );
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
      if (selectedNoteId) {
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
            mimeType: a.mimeType, data: a.data,
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
        if (activeMode === 'code') {
          setSikunProgress('コードを設計中...');
          aiText = await callGeminiChat(
            history,
            buildSikunSystemPrompt(contextNotes),
            apiKey,
            { models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-1.5-flash'] },
          );
          setSikunProgress('');
        } else {
          setSikunProgress('構成を設計中...');
          aiText = await callSikunLilyChat(
            history,
            buildSikunSystemPrompt(contextNotes),
            apiKey,
            (p: SikunLilyProgress) => setSikunProgress(p.label),
          );
          setSikunProgress('');
        }
      } else {
        aiText = await callGeminiChat(history, systemPrompt, apiKey, { webSearch });
      }
      const { textContent, blocks, questions } = parseAIResponse(aiText, activeModel !== 'sikunlily');

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
      }]);
    } catch (e) {
      setSikunProgress('');
      setMessages(prev => [...prev, {
        id: crypto.randomUUID(),
        role: 'lily',
        text: `ごめんね、エラーが起きちゃった 🐶\n${e instanceof Error ? e.message : '不明なエラー'}`,
        timestamp: Date.now(),
      }]);
    } finally {
      setIsLoading(false);
    }
  }, [input, attachments, isLoading, apiKey, messages, selectedNoteId, webSearch, activeMode, activeModel, deepResearch]);

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
            onClick={() => activeModel !== 'sikunlily' && setWebSearch(p => !p)}
            title={activeModel === 'sikunlily' ? 'sikunlilyはネット検索未対応' : 'ネット検索をON/OFF。ONにすると最新情報も調べて答えるよ'}
            disabled={activeModel === 'sikunlily'}
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
          <button className="context-toggle" onClick={() => setShowContextPanel(p => !p)} title="メモを選択">
            {selectedNote ? (
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
        </div>
      </div>

      {showContextPanel && (
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
                <p className="welcome-text">sikunlily だ ⚔️🐕<br />スライド作成と大規模コード構築が得意だ。<br />スライドはヘッダーのトグルでコード構築に切り替えられる。</p>
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
        /* sikunlily: コード構築モードトグル */
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
            className={`quick-chip mode-chip siku-mode${activeMode === 'slides' ? ' on' : ''}`}
            onClick={() => setActiveMode(p => (p === 'slides' ? null : 'slides'))}
            title="スライド作成モード（デフォルト）"
          >
            🖼️ スライド{activeMode === 'slides' ? ' ✓' : ''}
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
            <div key={i} className="att-chip">
              {att.isImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`data:${att.mimeType};base64,${att.data}`} alt={att.name} className="att-chip-thumb" />
              ) : (
                <span className="att-chip-icon">📎</span>
              )}
              <span className="att-chip-name">{att.name}</span>
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
          disabled={(!input.trim() && attachments.length === 0) || isLoading}
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
        .chat-header { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; border-bottom: 1px solid var(--border); background: var(--glass-tint, rgba(255,255,255,0.9)); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); flex-shrink: 0; gap: 8px; }
        .header-left { display: flex; align-items: center; gap: 10px; }
        .header-avatar { width: 38px; height: 38px; border-radius: 50%; object-fit: cover; object-position: top center; border: 2px solid var(--border); background: var(--accent); }
        .header-title { font-size: 0.95rem; font-weight: 800; color: var(--primary); }
        .header-sub { font-size: 0.7rem; color: var(--fg-muted); }
        .header-right { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
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
        .context-toggle { background: transparent; border: none; cursor: pointer; padding: 2px; }
        .context-chip { display: inline-flex; align-items: center; gap: 4px; background: var(--accent); border: 1px solid var(--border); border-radius: 20px; padding: 4px 10px; font-size: 0.78rem; color: var(--fg-muted); white-space: nowrap; max-width: 150px; overflow: hidden; text-overflow: ellipsis; cursor: pointer; }
        .context-chip.selected { color: var(--primary); border-color: var(--primary); }
        .clear-btn { background: transparent; border: 1px solid var(--border); border-radius: 8px; padding: 5px 7px; cursor: pointer; color: var(--fg-muted); display: flex; align-items: center; }
        .context-panel { display: flex; gap: 8px; padding: 8px 14px; border-bottom: 1px solid var(--border); background: var(--accent); overflow-x: auto; flex-shrink: 0; }
        .note-chip { flex-shrink: 0; background: var(--background); border: 1px solid var(--border); border-radius: 16px; padding: 5px 12px; font-size: 0.78rem; color: var(--fg-muted); cursor: pointer; white-space: nowrap; transition: all 0.15s; }
        .note-chip.active { background: var(--primary); color: white; border-color: var(--primary); }
        .messages-list { flex: 1; overflow-y: auto; padding: 16px 14px; display: flex; flex-direction: column; gap: 14px; padding-bottom: 20px; }
        .welcome-screen { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 20px 0; text-align: center; }
        .welcome-lily-wrap { width: 120px; height: 120px; animation: float 3s ease-in-out infinite; }
        .welcome-lily { width: 100%; height: 100%; object-fit: contain; }
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
