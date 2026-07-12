// Converts Markdown (optionally with LaTeX math) into HTML that the TipTap
// note editor can parse into its own schema: headings, bold/italic, lists,
// task lists, tables, blockquotes, code blocks, and math atom nodes
// (mathInline / mathBlock, see lib/extensions.ts).
//
// Used when Lily writes into a memo (create / append / overwrite) so the memo
// shows a rendered document — real headings, real formulas — instead of raw
// `#`, `**`, and `$…$` characters.

import { marked } from 'marked';

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

export function markdownToTiptapHtml(src: string): string {
  if (!src || !src.trim()) return '';

  const store: string[] = [];
  // Alphanumeric sentinel so `marked` can never mangle it or treat it as
  // markdown. Block items get blank lines so they become their own paragraph.
  const stashInline = (html: string) => { store.push(html); return `xrtx${store.length - 1}xtrx`; };
  const stashBlock = (html: string) => { store.push(html); return `\n\nxrtx${store.length - 1}xtrx\n\n`; };

  let s = src;

  // 1. Protect code so `$` inside it is never read as math. Fenced first, then
  //    inline. Stashed as the final HTML TipTap parses.
  s = s.replace(/```(\w*)[^\n]*\n([\s\S]*?)```/g, (_m, lang: string, code: string) => {
    const cls = lang ? ` class="language-${lang.replace(/[^a-zA-Z0-9_-]/g, '')}"` : '';
    return stashBlock(`<pre><code${cls}>${escHtml(code.replace(/\n$/, ''))}</code></pre>`);
  });
  s = s.replace(/`([^`\n]+)`/g, (_m, c: string) => stashInline(`<code>${escHtml(c)}</code>`));

  // 2. Math → math atom nodes. Block ($$…$$, \[…\]) then inline ($…$, \(…\)).
  const mathBlock = (tex: string) => stashBlock(`<div data-type="math-block" data-latex="${escAttr(tex.trim())}"></div>`);
  const mathInline = (tex: string) => stashInline(`<span data-type="math-inline" data-latex="${escAttr(tex.trim())}"></span>`);
  s = s.replace(/\$\$([\s\S]+?)\$\$/g, (_m, t: string) => mathBlock(t));
  s = s.replace(/\\\[([\s\S]+?)\\\]/g, (_m, t: string) => mathBlock(t));
  s = s.replace(/\\\(([\s\S]+?)\\\)/g, (_m, t: string) => mathInline(t));
  s = s.replace(/\$(?!\s)([^\n$]+?)(?<!\s)\$/g, (_m, t: string) => mathInline(t));

  // 3. Markdown → HTML.
  let html = marked.parse(s) as string;

  // 4. Restore stashed HTML. Replace the paragraph-wrapped form first so a block
  //    node never ends up illegally nested inside a <p>.
  for (let pass = 0; pass < 4 && /xrtx\d+xtrx/.test(html); pass++) {
    html = html.replace(/<p>\s*xrtx(\d+)xtrx\s*<\/p>/g, (_m, i: string) => store[Number(i)] ?? '');
    html = html.replace(/xrtx(\d+)xtrx/g, (_m, i: string) => store[Number(i)] ?? '');
  }

  // 5. Task lists.
  html = convertTaskLists(html);

  return html.trim();
}
