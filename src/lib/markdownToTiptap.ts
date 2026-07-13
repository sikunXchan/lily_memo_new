// Converts Markdown (optionally with LaTeX math) into HTML that the TipTap
// note editor can parse into its own schema: headings, bold/italic, lists,
// task lists, tables, blockquotes, code blocks, math atom nodes (mathInline /
// mathBlock), text colors / highlight markers, and embedded diagram nodes
// (mermaid / chart / geometry — see lib/extensions.ts).
//
// Used when Lily writes into a memo (create / append / overwrite) so the memo
// shows a rendered document — real headings, real formulas, real diagrams —
// instead of raw `#`, `**`, and `$…$` characters.

import { marked } from 'marked';
import { TEXT_COLOR_BY_KEY, HIGHLIGHT_COLOR_BY_KEY } from './memoColors';
import { autoColorChart } from './chartColors';

marked.use({ breaks: true, gfm: true });

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// TipTap task-list shape. marked emits `<li><input type="checkbox">text</li>`;
// convert those <ul>/<li> into the taskList/taskItem markup TipTap expects so
// the checkboxes stay interactive in the memo.
function convertTaskLists(html: string): string {
  return html.replace(/<ul>([\s\S]*?)<\/ul>/g, (whole, inner: string) => {
    if (!/<li[^>]*>\s*<input[^>]*type="checkbox"/i.test(inner)) return whole;
    const items = inner.replace(
      /<li[^>]*>\s*<input([^>]*)>\s*([\s\S]*?)<\/li>/gi,
      (_m, attrs: string, body: string) => {
        const checked = /checked/i.test(attrs);
        const text = body.trim();
        return `<li data-type="taskItem" data-checked="${checked}"><p>${text || ''}</p></li>`;
      },
    );
    return `<ul data-type="taskList">${items}</ul>`;
  });
}

// A fenced block inside a memo body becomes either an embedded interactive
// node (mermaid / chart / geometry — same markup the chat insert-buttons
// write, so lib/extensions.ts picks them up) or a plain code block.
function fenceToHtml(lang: string, code: string): string {
  const body = code.replace(/\n$/, '');
  if (lang === 'mermaid') {
    return `<div content="${escAttr(body)}" width="100%" data-type="mermaid"></div>`;
  }
  if (lang === 'chart') {
    try {
      const parsed = autoColorChart(JSON.parse(body));
      const codeStr = `return ${JSON.stringify(parsed)};`;
      return `<div code="${escAttr(codeStr)}" type="${escAttr((parsed.type as string) || 'bar')}" width="100%" data-type="chart"></div>`;
    } catch {
      // Invalid JSON — fall through to a plain code block so nothing is lost.
    }
  }
  if (lang === 'geometry') {
    return `<div data-type="geometry" data-code="${escAttr(body)}" data-width="100%"></div>`;
  }
  const cls = lang ? ` class="language-${lang.replace(/[^a-zA-Z0-9_-]/g, '')}"` : '';
  return `<pre><code${cls}>${escHtml(body)}</code></pre>`;
}

export function markdownToTiptapHtml(src: string): string {
  if (!src || !src.trim()) return '';

  const store: string[] = [];
  // Alphanumeric sentinel so `marked` can never mangle it or treat it as
  // markdown. Block items get blank lines so they become their own paragraph.
  const stashInline = (html: string) => { store.push(html); return `xrtx${store.length - 1}xtrx`; };
  const stashBlock = (html: string) => { store.push(html); return `\n\nxrtx${store.length - 1}xtrx\n\n`; };

  let s = src;

  // 1. Protect fenced blocks so `$`/`==` inside them are never read as math or
  //    markers. Both ``` and ~~~ fences are accepted — Lily uses ~~~ inside
  //    memo bodies because a nested ``` would terminate the outer memo block.
  const fenceRe = /(```|~~~)(\w*)[^\n]*\n([\s\S]*?)\1/g;
  s = s.replace(fenceRe, (_m, _f: string, lang: string, code: string) => stashBlock(fenceToHtml(lang, code)));
  s = s.replace(/`([^`\n]+)`/g, (_m, c: string) => stashInline(`<code>${escHtml(c)}</code>`));

  // 2. Math → math atom nodes. Block ($$…$$, \[…\]) then inline ($…$, \(…\)).
  const mathBlock = (tex: string) => stashBlock(`<div data-type="math-block" data-latex="${escAttr(tex.trim())}"></div>`);
  const mathInline = (tex: string) => stashInline(`<span data-type="math-inline" data-latex="${escAttr(tex.trim())}"></span>`);
  s = s.replace(/\$\$([\s\S]+?)\$\$/g, (_m, t: string) => mathBlock(t));
  s = s.replace(/\\\[([\s\S]+?)\\\]/g, (_m, t: string) => mathBlock(t));
  s = s.replace(/\\\(([\s\S]+?)\\\)/g, (_m, t: string) => mathInline(t));
  s = s.replace(/\$(?!\s)([^\n$]+?)(?<!\s)\$/g, (_m, t: string) => mathInline(t));

  // 3. Color syntax → inline HTML. marked passes the tags through untouched
  //    and still renders any markdown inside them, so `=={green}**大事**==`
  //    keeps its bold. Values come from the shared editor palette, so text
  //    colored by Lily and text colored via the toolbar are identical marks.
  //    - marker:     ==テキスト== (yellow) / =={green}テキスト==
  //    - text color: {red:テキスト}
  s = s.replace(/==(?:\{([a-z]+)\})?([^=\n]+?)==/g, (m, key: string | undefined, text: string) => {
    const color = HIGHLIGHT_COLOR_BY_KEY[key || 'yellow'];
    return color ? `<mark data-color="${escAttr(color)}">${text}</mark>` : m;
  });
  s = s.replace(/\{([a-z]+):([^{}\n]+)\}/g, (m, key: string, text: string) => {
    const color = TEXT_COLOR_BY_KEY[key];
    return color ? `<span style="color: ${escAttr(color)}">${text}</span>` : m;
  });

  // 4. Markdown → HTML.
  let html = marked.parse(s) as string;

  // 5. Restore stashed HTML. Replace the paragraph-wrapped form first so a block
  //    node never ends up illegally nested inside a <p>.
  for (let pass = 0; pass < 4 && /xrtx\d+xtrx/.test(html); pass++) {
    html = html.replace(/<p>\s*xrtx(\d+)xtrx\s*<\/p>/g, (_m, i: string) => store[Number(i)] ?? '');
    html = html.replace(/xrtx(\d+)xtrx/g, (_m, i: string) => store[Number(i)] ?? '');
  }

  // 6. Task lists.
  html = convertTaskLists(html);

  return html.trim();
}
