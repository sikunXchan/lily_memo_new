// Mermaid mindmap sanitizer.
//
// The free-form mindmap text produced by an LLM often trips Mermaid v11's
// parser: full-width parens in labels, tab indentation, blank lines between
// branches, stray IDs around shapes, etc. To get a reliable render we
// rewrite every non-root node into the `id["..."]` shape with a quoted
// label, and normalise whitespace. The shape is lost but the structure
// (which is what mindmap is about) is preserved.

// Characters that break Mermaid mindmap parsing when present in unquoted
// label text — full-width parens included since LLM Japanese often uses
// them.
export const MERMAID_PROBLEM = /[()（）\[\]{}【】「」〔〕『』#&<>"]/;

// Strip a leading id + shape wrapper around content. Returns the inner
// label and the original id (if any). Examples:
//   root((Central))     -> id="root",  label="Central"
//   node1["A (b)"]      -> id="node1", label="A (b)"
//   "just text"         -> id="",      label="just text"
//   plain               -> id="",      label="plain"
function unwrapNode(content: string): { id: string; label: string } {
  const trimmed = content.trim();
  // Already quoted bare label: "text"
  const quoted = trimmed.match(/^"([^"]*)"$/);
  if (quoted) return { id: '', label: quoted[1] };
  // Strip optional leading id.
  const idMatch = trimmed.match(/^([A-Za-z_][\w-]*)(.*)$/);
  const id = idMatch && /^[(\[{>)]/.test(idMatch[2].trim()) ? idMatch[1] : '';
  const rest = (id ? trimmed.slice(id.length) : trimmed).trim();
  // Try each shape wrapper. Greedy capture inside so labels with the
  // closing char don't get cut short.
  const shapes: [RegExp, number][] = [
    [/^\(\((.*)\)\)$/, 1],   // ((x))
    [/^\{\{(.*)\}\}$/, 1],   // {{x}}
    [/^\[(.*)\]$/, 1],       // [x]
    [/^\((.*)\)$/, 1],       // (x)
    [/^\{(.*)\}$/, 1],       // {x}
    [/^>(.*)\]$/, 1],        // >x]
    [/^\)(.*)\($/, 1],       // )x(
  ];
  for (const [re, g] of shapes) {
    const m = rest.match(re);
    if (m) {
      // Inner may itself be a quoted string — unwrap once.
      let inner = m[g];
      const q = inner.match(/^"([^"]*)"$/);
      if (q) inner = q[1];
      return { id, label: inner };
    }
  }
  return { id, label: rest };
}

export function sanitizeMindmap(src: string): string {
  if (!/^\s*mindmap\b/.test(src)) return src;

  // 1. Normalise whitespace.
  const normalized = src
    .replace(/^﻿/, '')      // BOM
    .replace(/\r\n?/g, '\n')      // CRLF
    .replace(/\t/g, '  ')         // tabs → 2 spaces
    .replace(/[ \t]+$/gm, '');    // trailing spaces

  const rawLines = normalized.split('\n');

  // 2. Find indent of first non-empty content line (after `mindmap`).
  let baseIndent = -1;
  for (let i = 1; i < rawLines.length; i++) {
    const l = rawLines[i];
    if (!l.trim()) continue;
    baseIndent = (l.match(/^(\s*)/)?.[1] ?? '').length;
    break;
  }
  if (baseIndent < 0) return 'mindmap\n  root';

  // 3. Emit.
  const out: string[] = ['mindmap'];
  let nodeCounter = 0;
  let rootEmitted = false;

  for (let i = 1; i < rawLines.length; i++) {
    const line = rawLines[i];
    if (!line.trim()) continue;
    const indentLen = (line.match(/^(\s*)/)?.[1] ?? '').length;
    // Re-anchor indent so root starts at 2 spaces, children at 4, etc.
    const depth = Math.max(0, indentLen - baseIndent);
    const newIndent = '  '.repeat(1 + Math.floor(depth / 2));
    const content = line.slice(indentLen);

    const { id, label } = unwrapNode(content);
    const cleanLabel = label.replace(/"/g, "'").replace(/\s+/g, ' ').trim();
    if (!cleanLabel) continue;

    if (!rootEmitted) {
      const rootId = id || 'root';
      // Always quoted square shape — works in v11 regardless of label chars.
      out.push(`${newIndent}${rootId}["${cleanLabel}"]`);
      rootEmitted = true;
    } else {
      const nodeId = id || `n${++nodeCounter}`;
      out.push(`${newIndent}${nodeId}["${cleanLabel}"]`);
    }
  }

  if (!rootEmitted) out.push('  root');
  return out.join('\n');
}

// ── Flowchart / graph recovery ─────────────────────────────────────────────
// LLMs frequently produce labels that the Mermaid v11 parser rejects:
// unquoted full-width parens, ":", "?", "&", etc. inside [], (), {} shapes.
// Running this always would risk false positives, so we only invoke it as a
// fallback *after* the natural code fails to parse. It walks each line and
// rewrites unquoted labels containing problematic chars into quoted form,
// escaping inner `"` as `#quot;`.

const PROBLEM_CHARS = /[()（）[\]{}<>"'#&:：;,、!?！？|\\/]/;

function maybeQuote(label: string): string {
  const t = label.trim();
  if (!t) return label;
  // Already quoted? leave it.
  if (/^".*"$/.test(t) && !t.slice(1, -1).includes('"')) return label;
  if (!PROBLEM_CHARS.test(t)) return label;
  return `"${t.replace(/"/g, '#quot;')}"`;
}

// Lines that introduce blocks / styling — never rewrite, the shapes here
// mean something different (e.g. classDef has no node labels).
const STRUCTURAL = /^\s*(graph|flowchart|subgraph|end|classDef|class\b|style\b|click\b|linkStyle\b|direction\b|%%)/;

function quoteOneLine(line: string): string {
  if (STRUCTURAL.test(line)) return line;

  let out = line;

  // Process double-bracket shapes first so the single-bracket pass below
  // doesn't reach inside them. Each pattern: opener, label (no shape chars),
  // closer.
  // [[label]] — subroutine
  out = out.replace(/(\[\[)([^[\]]+?)(\]\])/g, (_m, a, l, b) => `${a}${maybeQuote(l)}${b}`);
  // ((label)) — circle
  out = out.replace(/(\(\()([^()]+?)(\)\))/g, (_m, a, l, b) => `${a}${maybeQuote(l)}${b}`);
  // {{label}} — hexagon
  out = out.replace(/(\{\{)([^{}]+?)(\}\})/g, (_m, a, l, b) => `${a}${maybeQuote(l)}${b}`);
  // [(label)] — cylinder
  out = out.replace(/(\[\()([^[\]()]+?)(\)\])/g, (_m, a, l, b) => `${a}${maybeQuote(l)}${b}`);

  // Single-bracket shapes. The "label" capture rejects bracket chars so we
  // don't munge nested shapes we already handled.
  // [label]
  out = out.replace(/(\[)([^[\]]+?)(\])/g, (_m, a, l, b) => `${a}${maybeQuote(l)}${b}`);
  // {label} — only when preceded by an identifier (skip stray braces).
  out = out.replace(/(\b[A-Za-z_]\w*\s*)(\{)([^{}]+?)(\})/g, (_m, id, a, l, b) => `${id}${a}${maybeQuote(l)}${b}`);
  // (label) — only when preceded by an identifier (avoid "graph TD" etc.).
  out = out.replace(/(\b[A-Za-z_]\w*\s*)(\()([^()]+?)(\))/g, (_m, id, a, l, b) => `${id}${a}${maybeQuote(l)}${b}`);

  // |edge label|
  out = out.replace(/(\|)([^|\n]+)(\|)/g, (_m, a, l, b) => `${a}${maybeQuote(l)}${b}`);

  return out;
}

export function autoQuoteFlowchart(src: string): string {
  if (!/^\s*(graph|flowchart)\b/i.test(src.trimStart())) return src;
  return src.split('\n').map(quoteOneLine).join('\n');
}
