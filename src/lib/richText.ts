// Turns Lily's reply into safe HTML: Markdown via `marked` plus
// LaTeX math ($...$, $$...$$, \(...\), \[...\]) via KaTeX.
// Code spans/blocks are protected so `$` inside them isn't treated
// as math, and the final HTML is sanitized (no scripts / on* attrs).

import { marked } from 'marked';
import katex from 'katex';
import { common, createLowlight } from 'lowlight';

marked.setOptions({ breaks: true, gfm: true });

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

  // 3. Block math: $$...$$ and \[...\]
  s = s.replace(/\$\$([\s\S]+?)\$\$/g, (_m, t: string) => stashBlock(renderMath(t.trim(), true)));
  s = s.replace(/\\\[([\s\S]+?)\\\]/g, (_m, t: string) => stashBlock(renderMath(t.trim(), true)));
  // 4. Inline math: \(...\) and $...$
  s = s.replace(/\\\(([\s\S]+?)\\\)/g, (_m, t: string) => stashInline(renderMath(t.trim(), false)));
  s = s.replace(/\$(?!\s)([^\n$]+?)(?<!\s)\$/g, (_m, t: string) => stashInline(renderMath(t.trim(), false)));

  // 5. Graceful trailing open math
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

  let html = marked.parse(s, { async: false }) as string;
  // restore stash placeholders (block-level — no surrounding <p> wrapping issues)
  html = html.replace(/RT(\d+)STASH/g, (_m, i: string) => store[Number(i)] ?? '');
  return sanitize(html);
}
