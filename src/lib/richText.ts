// Turns Lily's reply into safe HTML: Markdown via `marked` plus
// LaTeX math ($...$, $$...$$, \(...\), \[...\]) via KaTeX.
// Code spans/blocks are protected so `$` inside them isn't treated
// as math, and the final HTML is sanitized (no scripts / on* attrs).

import { marked } from 'marked';
import katex from 'katex';
import { common, createLowlight } from 'lowlight';

marked.use({ breaks: true, gfm: true });

// ── Lowlight (syntax highlight) ──────────────────────────────────────────────
type HastNode = {
  type: string;
  value?: string;
  tagName?: string;
  properties?: { className?: string[] };
  children?: HastNode[];
};

let _low: ReturnType<typeof createLowlight> | null = null;
function getLow(): ReturnType<typeof createLowlight> | null {
  if (typeof window === 'undefined') return null;
  if (!_low) _low = createLowlight(common);
  return _low;
}

function hastToHtml(n: HastNode): string {
  if (n.type === 'text') {
    return (n.value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  if (n.type === 'element') {
    const cls = (n.properties?.className ?? []).join(' ');
    const attr = cls ? ` class="${cls}"` : '';
    const inner = (n.children ?? []).map(hastToHtml).join('');
    return `<${n.tagName}${attr}>${inner}</${n.tagName}>`;
  }
  return (n.children ?? []).map(hastToHtml).join('');
}

function highlightCode(lang: string, code: string): string {
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const low = getLow();
  if (!low || !lang) return esc(code);
  try {
    const registered = low.listLanguages();
    const normalized = lang.toLowerCase();
    const alias: Record<string, string> = { js: 'javascript', ts: 'typescript', py: 'python', sh: 'bash', yml: 'yaml' };
    const target = alias[normalized] ?? normalized;
    if (registered.includes(target)) {
      return hastToHtml(low.highlight(target, code) as HastNode);
    }
  } catch { /* fall through */ }
  return esc(code);
}

// ── Math renderer ────────────────────────────────────────────────────────────
function renderMath(tex: string, display: boolean): string {
  try {
    return katex.renderToString(tex, {
      displayMode: display,
      throwOnError: false,
      output: 'html',
    });
  } catch {
    return `<code>${tex.replace(/</g, '&lt;')}</code>`;
  }
}

// ── Sanitiser ────────────────────────────────────────────────────────────────
function sanitize(html: string): string {
  if (typeof window === 'undefined' || typeof DOMParser === 'undefined') return html;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,style,iframe,object,embed,form,link,meta').forEach(n => n.remove());
  doc.querySelectorAll('*').forEach(el => {
    [...el.attributes].forEach(attr => {
      const name = attr.name.toLowerCase();
      const val = attr.value.toLowerCase();
      if (name.startsWith('on')) el.removeAttribute(attr.name);
      if ((name === 'href' || name === 'src') && val.trim().startsWith('javascript:')) {
        el.removeAttribute(attr.name);
      }
    });
  });
  return doc.body.innerHTML;
}

// ── GitHub-style callouts ─────────────────────────────────────────────────────
// > [!NOTE] / [!TIP] / [!IMPORTANT] / [!WARNING] / [!CAUTION]
const CALLOUTS: Record<string, { label: string; icon: string; cls: string }> = {
  NOTE:      { label: 'ノート', icon: '📝', cls: 'note' },
  TIP:       { label: 'ヒント', icon: '💡', cls: 'tip' },
  IMPORTANT: { label: '重要',   icon: '❗', cls: 'important' },
  WARNING:   { label: '注意',   icon: '⚠️', cls: 'warning' },
  CAUTION:   { label: '警告',   icon: '🚨', cls: 'caution' },
};

// Collapse consecutive `> ...` blockquote lines that open with a `[!TYPE]`
// marker into a styled callout box. The body is rendered as Markdown so it can
// hold lists, bold, inline code, etc. Stashed as a block so `marked` leaves it
// alone. Runs after code/math have been stashed, so any RT placeholders inside
// the body survive to the (looped) restore pass.
function transformCallouts(src: string, stash: (html: string) => string): string {
  const lines = src.split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; ) {
    const m = lines[i].match(/^\s{0,3}>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(.*)$/i);
    if (!m) { out.push(lines[i]); i++; continue; }
    const meta = CALLOUTS[m[1].toUpperCase()];
    const body: string[] = [];
    if (m[2].trim()) body.push(m[2].trim());
    i++;
    while (i < lines.length && /^\s{0,3}>/.test(lines[i])) {
      body.push(lines[i].replace(/^\s{0,3}>\s?/, ''));
      i++;
    }
    const inner = marked.parse(body.join('\n')) as string;
    out.push(stash(
      `<div class="rt-callout rt-callout-${meta.cls}">` +
      `<div class="rt-callout-head">${meta.icon} ${meta.label}</div>` +
      `<div class="rt-callout-body">${inner}</div>` +
      `</div>`
    ));
  }
  return out.join('\n');
}

// Append a per-section copy button to every h1–h3. The chat bubble's click
// handler walks the heading's siblings to gather the section text.
function addSectionCopyButtons(html: string): string {
  return html.replace(
    /(<h([123])[^>]*>)([\s\S]*?)(<\/h\2>)/g,
    (_m, open: string, _lvl: string, inner: string, close: string) =>
      `${open}${inner}<button type="button" class="section-copy-btn" aria-label="このセクションをコピー">⎘</button>${close}`
  );
}

// ── Main export ──────────────────────────────────────────────────────────────
export function renderRich(src: string): string {
  if (!src) return '';
  const store: string[] = [];
  // Block-level stash: wrap with blank lines so the placeholder becomes its
  // own paragraph (needed for <pre>, display math, etc.).
  const stashBlock = (html: string) => {
    store.push(html);
    return `\n\nRT${store.length - 1}STASH\n\n`;
  };
  // Inline stash: no surrounding newlines, so the placeholder stays inside
  // whatever paragraph / list item / sentence it came from. Critical for
  // inline code and inline math — wrapping with \n\n would split bullets
  // like "* `rst`: 説明" into three separate blocks.
  const stashInline = (html: string) => {
    store.push(html);
    return `RT${store.length - 1}STASH`;
  };

  let s = src;

  // 1. Fenced code blocks — extract language, apply highlight, stash.
  // Wrapped in `.rt-codeblock` with a header bar (language label + per-block
  // copy button) so each snippet can be copied on its own. The copy handler
  // lives in the chat bubble (event delegation), reading the <code> text.
  s = s.replace(/```(\w*)[^\n]*\n([\s\S]*?)```/g, (_, lang: string, code: string) => {
    const raw = code.replace(/\n$/, '');
    const body = highlightCode(lang, raw);
    const escLang = lang ? lang.replace(/[^a-zA-Z0-9_-]/g, '') : '';
    const langAttr = escLang ? ` data-lang="${escLang}"` : '';
    const codeClass = `hljs${escLang ? ` language-${escLang}` : ''}`;
    const head =
      `<div class="rt-pre-head">` +
      `<span class="rt-pre-lang">${escLang || 'code'}</span>` +
      `<button type="button" class="code-copy-btn" aria-label="このコードをコピー">⎘ コピー</button>` +
      `</div>`;
    return stashBlock(
      `<div class="rt-codeblock">${head}<pre class="rt-pre"${langAttr}><code class="${codeClass}">${body}</code></pre></div>`
    );
  });

  // 2. Inline code — stash to protect from math processing.
  s = s.replace(/`([^`\n]+)`/g, (_m, c: string) =>
    stashInline(`<code class="rt-code">${c.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</code>`));

  // 3. Highlight: ==text== → <mark>
  s = s.replace(/==([^=\n]+)==/g, (_m, t: string) =>
    stashInline(`<mark class="rt-mark">${t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</mark>`));

  // 4. Block math: $$...$$ and \[...\]
  s = s.replace(/\$\$([\s\S]+?)\$\$/g, (_m, t: string) => stashBlock(renderMath(t.trim(), true)));
  s = s.replace(/\\\[([\s\S]+?)\\\]/g, (_m, t: string) => stashBlock(renderMath(t.trim(), true)));
  // 5. Inline math: \(...\) and $...$
  s = s.replace(/\\\(([\s\S]+?)\\\)/g, (_m, t: string) => stashInline(renderMath(t.trim(), false)));
  s = s.replace(/\$(?!\s)([^\n$]+?)(?<!\s)\$/g, (_m, t: string) => stashInline(renderMath(t.trim(), false)));

  // 6. Graceful trailing open math
  const openBlock = s.match(/\$\$([\s\S]+)$/);
  if (openBlock && !openBlock[1].includes('$')) {
    s = s.slice(0, openBlock.index) + stashBlock(renderMath(openBlock[1].trim(), true));
  } else {
    const openInline = s.match(/(?:^|[^$])\$(?!\s)([^\n$]+)$/);
    if (openInline && /[\\^_{}]/.test(openInline[1])) {
      const idx = s.lastIndexOf('$');
      s = s.slice(0, idx) + stashInline(renderMath(s.slice(idx + 1).trim(), false));
    }
  }

  // 7. Callouts (after code/math stashing so their bodies are protected).
  s = transformCallouts(s, stashBlock);

  let html = marked.parse(s) as string;
  // Restore stash placeholders. Loop because a stashed callout can itself
  // contain placeholders (inline code etc.) and a single global replace won't
  // re-scan inserted text. Bounded so a stray token can never spin forever.
  for (let pass = 0; pass < 6 && /RT\d+STASH/.test(html); pass++) {
    html = html.replace(/RT(\d+)STASH/g, (_m, i: string) => store[Number(i)] ?? '');
  }
  html = addSectionCopyButtons(html);
  return sanitize(html);
}
