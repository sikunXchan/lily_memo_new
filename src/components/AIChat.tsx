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
import { callGeminiChat, LILY_CHAT_SYSTEM_PROMPT } from '@/lib/gemini';
import type { ChatTurn, ChatAttachment } from '@/lib/gemini';
import { noteHtmlToText } from '@/lib/noteText';
import { parseSlides, exportSlidesToPptx } from '@/lib/slides';
import { parseGeometry, renderGeometrySvg } from '@/lib/geometry';
import { renderRich } from '@/lib/richText';
import {
  downloadTextFile, downloadSvg, downloadSvgAsPng, downloadCanvasAsPng,
} from '@/lib/fileGen';

ChartJS.register(
  CategoryScale, LinearScale, BarElement, PointElement, LineElement,
  ArcElement, Title, Tooltip, Legend, Filler
);

mermaid.initialize({ startOnLoad: false, theme: 'neutral', securityLevel: 'loose' });

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
  type: 'mermaid' | 'chart' | 'qa' | 'slides' | 'file' | 'geometry';
  rawCode: string;
  previewLabel: string;
  fileName?: string;
}

interface ClarifyQuestion {
  id: string;
  question: string;
  options: string[];
}

interface AIChatProps {
  onOpenSettings: () => void;
  onSwitchTab?: (tab: 'memos' | 'sketch' | 'pdf' | 'settings') => void;
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

function parseAIResponse(text: string): {
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

  const FENCE_RE = /```(mermaid|chart|qa|slides|geometry)([\s\S]*?)```/g;
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
    return '';
  }).trim();

  // Fallback: the model sometimes ignores the `ask` block rule and asks
  // in plain prose. If Lily produced no deliverables and the reply is
  // clearly a question, surface it as a clarify form anyway.
  if (questions.length === 0 && blocks.length === 0) {
    const t = textContent.trim();
    // Lily often lists choices as **bold** items (e.g. a format menu).
    const bold = [...t.matchAll(/\*\*\s*(.+?)\s*\*\*/g)]
      .map(m => cleanAsk(m[1]))
      .filter(s => s.length > 0 && s.length <= 30);
    // A genuine clarify is short and *ends* on a question mark. A finished
    // answer that merely contains "どうかな？" mid-text, or signs off with
    // "声をかけてね！", must NOT be turned into a form.
    const tail = t.replace(/[\s。.!！~〜♪☺︎\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]+$/u, '');
    const endsOnQuestion = /[?？]$/.test(tail);
    const signOff = /(声をかけて|気軽に|いつでも|聞いてね|参考に|役に立て|できたよ|完成|してみた|してみたよ|まとめた|まとめてみた|作ってみた|書いてみた|訳してみた|翻訳してみた|以上|楽しんで|またね|どうぞ)/.test(t);
    const isFormatMenu = bold.length >= 2 || /@@\w+\s*:/.test(t);
    const looksLikeQuestion =
      isFormatMenu || (endsOnQuestion && t.length <= 220 && !signOff);
    if (t.length > 0 && t.length <= 1200 && looksLikeQuestion) {
      let options: string[] = [];
      if (bold.length >= 2) {
        options = [...new Set(bold)];
      } else {
        const paren = t.match(/[（(]([^（）()]*(?:[、,／/]|または|or)[^（）()]*)[）)]/);
        if (paren) {
          options = paren[1]
            .split(/[、,／/]|または|\bor\b/)
            .map(s => cleanAsk(s))
            .filter(s => s.length > 0 && s.length <= 24);
        }
      }
      if (options.length < 2) options = [];
      // Question = text before the first bold/option list, cleaned.
      const head = t.split(/\*\*|[（(]\s*@@/)[0];
      const question = cleanAsk(head && head.trim().length >= 4 ? head : t);
      questions.push({ id: crypto.randomUUID(), question, options });
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
  if (err) return <div className="prev-err">図のプレビューを表示できなかったよ💦</div>;
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

function InsertableBlockCard({
  block,
  allNotes,
  defaultNoteId,
}: {
  block: InsertableBlock;
  allNotes: Note[];
  defaultNoteId?: number;
}) {
  const NEW_NOTE = '__new__';
  const [target, setTarget] = useState<string>(
    defaultNoteId != null ? String(defaultNoteId) : (allNotes[0]?.id != null ? String(allNotes[0].id) : NEW_NOTE)
  );
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [pdfStatus, setPdfStatus] = useState<'idle' | 'loading'>('idle');

  const baseName = `lily-${block.type}-${block.id.slice(0, 6)}`;
  const typeEmoji = block.type === 'mermaid' ? '🌊'
    : block.type === 'chart' ? '📊'
    : block.type === 'slides' ? '🖼️'
    : block.type === 'geometry' ? '📐'
    : block.type === 'file' ? '📄' : '📚';

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
      await exportSlidesToPptx(parseSlides(block.rawCode));
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
      </div>

      {block.type === 'slides' && (
        <button className="pdf-btn" onClick={handlePptx} disabled={pdfStatus === 'loading'}>
          <FileDown size={14} />
          {pdfStatus === 'loading' ? 'PowerPoint作成中...' : 'PowerPoint(.pptx)で保存'}
        </button>
      )}

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

      <style jsx>{`
        .insertable-block { background: var(--background); border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px; margin-top: 8px; }
        .block-header { margin-bottom: 8px; }
        .block-type-badge { background: color-mix(in srgb, var(--primary) 15%, transparent); color: var(--primary); border-radius: 20px; padding: 3px 10px; font-size: 0.78rem; font-weight: 700; }
        .block-visual { margin-bottom: 10px; }
        .block-visual :global(.prev-err) { font-size: 0.78rem; color: var(--fg-muted); background: var(--accent); border-radius: 8px; padding: 12px; text-align: center; }
        .pdf-btn { display:flex; align-items:center; justify-content:center; gap:6px; width:100%; background:var(--primary); color:white; border:none; border-radius:8px; padding:8px; font-size:0.82rem; font-weight:700; cursor:pointer; margin-bottom:8px; }
        .pdf-btn:disabled { opacity:0.6; cursor:default; }
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
            autoFocus
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
  message, allNotes, selectedNoteId,
}: {
  message: ChatMessage;
  allNotes: Note[];
  selectedNoteId?: number;
}) {
  return (
    <div className="lily-bubble-row">
      <div className="lily-avatar">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/lily-character.png" alt="Lily" className="avatar-img" />
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
              <InsertableBlockCard key={block.id} block={block} allNotes={allNotes} defaultNoteId={selectedNoteId} />
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
        .rt-body :global(p) { margin: 0 0 0.5em; }
        .rt-body :global(p:last-child) { margin-bottom: 0; }
        .rt-body :global(h1), .rt-body :global(h2), .rt-body :global(h3) { font-size: 1rem; font-weight: 800; margin: 0.6em 0 0.3em; color: var(--primary); }
        .rt-body :global(ul), .rt-body :global(ol) { margin: 0.3em 0; padding-left: 1.3em; }
        .rt-body :global(li) { margin: 0.15em 0; }
        .rt-body :global(strong) { font-weight: 800; }
        .rt-body :global(a) { color: var(--primary); text-decoration: underline; }
        .rt-body :global(table) { border-collapse: collapse; margin: 0.4em 0; font-size: 0.85rem; }
        .rt-body :global(th), .rt-body :global(td) { border: 1px solid var(--border); padding: 4px 8px; }
        .rt-body :global(.rt-code) { background: var(--background); border: 1px solid var(--border); border-radius: 4px; padding: 1px 5px; font-size: 0.84em; font-family: 'Fira Code','Consolas',monospace; }
        .rt-body :global(.rt-pre) { background: var(--background); border: 1px solid var(--border); border-radius: 8px; padding: 10px; overflow-x: auto; margin: 0.5em 0; }
        .rt-body :global(.rt-pre code) { font-size: 0.8rem; font-family: 'Fira Code','Consolas',monospace; white-space: pre; }
        .rt-body :global(.katex) { font-size: 1.05em; }
        .rt-body :global(.katex-display) { margin: 0.5em 0; overflow-x: auto; overflow-y: hidden; }
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

function TypingIndicator() {
  return (
    <div className="typing-row">
      <div className="typing-avatar">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/lily-character.png" alt="Lily" className="avatar-img" />
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
  'プレゼン用のスライドにして',
  'この数式をグラフで解説して',
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

export default function AIChat({ onOpenSettings, onSwitchTab }: AIChatProps) {
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

      const aiText = await callGeminiChat(history, systemPrompt, apiKey, { webSearch });
      const { textContent, blocks, questions } = parseAIResponse(aiText);

      setMessages(prev => [...prev, {
        id: crypto.randomUUID(),
        role: 'lily',
        text: textContent || (questions.length > 0 ? 'いくつか教えてほしいな！🐶' : '...'),
        timestamp: Date.now(),
        extractedBlocks: blocks.length > 0 ? blocks : undefined,
        questions: questions.length > 0 ? questions : undefined,
      }]);
    } catch (e) {
      setMessages(prev => [...prev, {
        id: crypto.randomUUID(),
        role: 'lily',
        text: `ごめんね、エラーが起きちゃった 🐶\n${e instanceof Error ? e.message : '不明なエラー'}`,
        timestamp: Date.now(),
      }]);
    } finally {
      setIsLoading(false);
    }
  }, [input, attachments, isLoading, apiKey, messages, selectedNoteId, webSearch, activeMode]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

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
          <img src="/lily-character.png" alt="Lily" className="header-avatar" />
          <div>
            <div className="header-title">Lily</div>
            <div className="header-sub">AIアシスタント ✨</div>
          </div>
        </div>
        <div className="header-right">
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
              <img src="/lily-character.png" alt="Lily" className="welcome-lily" />
            </div>
            <p className="welcome-text">こんにちは、Lily だよ！🐶<br />メモの要約・翻訳・メール作成・問題づくり・図やグラフ・スライドまで、文章でお願いするだけ。<br />まずは下の例をタップしてみてね👇</p>
            <div className="suggestions">
              {SUGGESTIONS.map(s => (
                <button key={s} className="suggestion-chip" onClick={() => sendMessage(s)}>{s}</button>
              ))}
            </div>
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
            />
          )
        )}
        {isLoading && <TypingIndicator />}
        <div ref={messagesEndRef} />
      </div>

      {onSwitchTab && (
        <nav className="ai-bottom-nav">
          <button className="ai-nav-item" onClick={() => onSwitchTab('memos')}><Book size={22} /><span>メモ</span></button>
          <button className="ai-nav-item" onClick={() => onSwitchTab('sketch')}><Brush size={22} /><span>落書き</span></button>
          <button className="ai-nav-item" onClick={() => onSwitchTab('pdf')}><FileText size={22} /><span>PDF</span></button>
          <button className="ai-nav-item active"><Sparkles size={22} /><span>Lily</span></button>
          <button className="ai-nav-item" onClick={() => { onSwitchTab('settings'); onOpenSettings(); }}><SettingsIcon size={22} /><span>設定</span></button>
        </nav>
      )}

      {/* Tone modes (tap to toggle ON — affects every message you send) */}
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

      {/* Quick actions (Lily's wish-list) */}
      <div className="quick-actions">
        <Wand2 size={14} className="qa-wand" />
        {QUICK_ACTIONS.map(a => (
          <button key={a.label} className="quick-chip" onClick={() => sendMessage(a.prompt)} disabled={isLoading}>
            {a.label}
          </button>
        ))}
      </div>

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
          placeholder="Lily に話しかける..."
          value={input}
          onChange={e => { setInput(e.target.value); autoResizeTextarea(); }}
          onKeyDown={handleKeyDown}
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
        .web-toggle { display: flex; align-items: center; gap: 5px; background: var(--accent); border: 1px solid var(--border); border-radius: 16px; padding: 5px 10px; cursor: pointer; color: var(--fg-muted); font-size: 0.74rem; font-weight: 600; white-space: nowrap; }
        .web-toggle.on { color: var(--primary); border-color: var(--primary); background: color-mix(in srgb, var(--primary) 12%, transparent); }
        .web-state { background: var(--border); color: var(--foreground); border-radius: 8px; padding: 1px 6px; font-size: 0.66rem; font-weight: 800; }
        .web-toggle.on .web-state { background: var(--primary); color: white; }
        @media (max-width: 380px) { .web-toggle .web-label { display: none; } }
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
