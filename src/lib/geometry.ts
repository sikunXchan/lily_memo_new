// Renders a math/geometry figure (points, vectors, segments, lines,
// circles, polygons, angles and y=f(x) curves) to a standalone SVG string.
// Labels containing $...$ or common LaTeX are rendered via KaTeX foreignObject.

import katex from 'katex';

export interface GeometrySpec {
  title?: string;
  xRange?: [number, number];
  yRange?: [number, number];
  grid?: boolean;
  axes?: boolean;
  width?: number;
  height?: number;
  elements: GeometryElement[];
}

type Pt = [number, number];

export type GeometryElement =
  | { type: 'point'; x: number; y: number; label?: string; color?: string }
  | { type: 'segment'; from: Pt; to: Pt; label?: string; color?: string; dashed?: boolean }
  | { type: 'vector'; from: Pt; to: Pt; label?: string; color?: string }
  | { type: 'line'; from?: Pt; to?: Pt; a?: number; b?: number; c?: number; label?: string; color?: string }
  | { type: 'circle'; center: Pt; r: number; label?: string; color?: string; fill?: string }
  | { type: 'polygon'; points: Pt[]; label?: string; color?: string; fill?: string }
  | { type: 'angle'; at: Pt; from: Pt; to: Pt; label?: string; color?: string }
  | { type: 'function'; expr: string; label?: string; color?: string }
  | { type: 'text'; x: number; y: number; text: string; color?: string };

/* ---------- safe expression evaluator (for y = f(x)) ---------- */

type Tok = { t: 'num' | 'op' | 'lp' | 'rp' | 'id'; v: string };

function tokenize(s: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === ' ') { i++; continue; }
    if (/[0-9.]/.test(c)) {
      let n = '';
      while (i < s.length && /[0-9.]/.test(s[i])) n += s[i++];
      out.push({ t: 'num', v: n });
      continue;
    }
    if (/[a-zA-Z]/.test(c)) {
      // Identifiers start with a letter but may contain digits (log10, log2).
      let id = c; i++;
      while (i < s.length && /[a-zA-Z0-9]/.test(s[i])) id += s[i++];
      out.push({ t: 'id', v: id });
      continue;
    }
    if ('+-*/^'.includes(c)) {
      // Treat `**` as exponentiation (LLMs often write x**2).
      if (c === '*' && s[i + 1] === '*') { out.push({ t: 'op', v: '^' }); i += 2; continue; }
      out.push({ t: 'op', v: c }); i++; continue;
    }
    if (c === '(') { out.push({ t: 'lp', v: c }); i++; continue; }
    if (c === ')') { out.push({ t: 'rp', v: c }); i++; continue; }
    throw new Error(`bad char ${c}`);
  }
  return out;
}

const FUNCS: Record<string, (n: number) => number> = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, sqrt: Math.sqrt, cbrt: Math.cbrt,
  abs: Math.abs, exp: Math.exp, log: Math.log, ln: Math.log,
  log10: Math.log10, log2: Math.log2,
  asin: Math.asin, acos: Math.acos, atan: Math.atan,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
  sign: Math.sign, floor: Math.floor, ceil: Math.ceil, round: Math.round, trunc: Math.trunc,
};

const CONSTS: Record<string, number> = {
  pi: Math.PI, e: Math.E, tau: Math.PI * 2,
};

// Recursive-descent parser → function of x. No eval / Function.
function compile(expr: string): (x: number) => number {
  const toks = tokenize(expr);
  let p = 0;
  const peek = () => toks[p];
  const eat = () => toks[p++];

  function parseExpr(): (x: number) => number {
    let left = parseTerm();
    while (peek() && peek().t === 'op' && (peek().v === '+' || peek().v === '-')) {
      const op = eat().v;
      const right = parseTerm();
      const l = left;
      left = op === '+' ? (x) => l(x) + right(x) : (x) => l(x) - right(x);
    }
    return left;
  }
  function parseTerm(): (x: number) => number {
    let left = parsePow();
    for (;;) {
      const tk = peek();
      if (!tk) break;
      if (tk.t === 'op' && (tk.v === '*' || tk.v === '/')) {
        const op = eat().v;
        const right = parsePow();
        const l = left;
        left = op === '*' ? (x) => l(x) * right(x) : (x) => l(x) / right(x);
      } else if (tk.t === 'num' || tk.t === 'id' || tk.t === 'lp') {
        // Implicit multiplication: 2x, 3(x+1), (x+1)(x-1), 2pi, x sin(x).
        const right = parsePow();
        const l = left;
        left = (x) => l(x) * right(x);
      } else {
        break;
      }
    }
    return left;
  }
  function parsePow(): (x: number) => number {
    const base = parseUnary();
    if (peek() && peek().t === 'op' && peek().v === '^') {
      eat();
      const exp = parsePow();
      return (x) => Math.pow(base(x), exp(x));
    }
    return base;
  }
  function parseUnary(): (x: number) => number {
    if (peek() && peek().t === 'op' && peek().v === '-') {
      eat();
      const u = parseUnary();
      return (x) => -u(x);
    }
    if (peek() && peek().t === 'op' && peek().v === '+') {
      eat();
      return parseUnary();
    }
    return parseAtom();
  }
  function parseAtom(): (x: number) => number {
    const tk = peek();
    if (!tk) throw new Error('unexpected end');
    if (tk.t === 'num') { eat(); const n = parseFloat(tk.v); return () => n; }
    if (tk.t === 'lp') {
      eat();
      const e = parseExpr();
      if (!peek() || peek().t !== 'rp') throw new Error('missing )');
      eat();
      return e;
    }
    if (tk.t === 'id') {
      eat();
      if (tk.v === 'x') return (x) => x;
      if (tk.v in CONSTS) { const c = CONSTS[tk.v]; return () => c; }
      const fn = FUNCS[tk.v];
      if (fn) {
        if (!peek() || peek().t !== 'lp') throw new Error(`( expected after ${tk.v}`);
        eat();
        const arg = parseExpr();
        if (!peek() || peek().t !== 'rp') throw new Error('missing )');
        eat();
        return (x) => fn(arg(x));
      }
      throw new Error(`unknown ${tk.v}`);
    }
    throw new Error('parse error');
  }

  const f = parseExpr();
  if (p !== toks.length) throw new Error('trailing tokens');
  return f;
}

/* ---------- SVG rendering ---------- */

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Returns true when the label contains LaTeX math notation.
function hasMath(text: string): boolean {
  return /\$[^$]+\$|\\\(|\\\[|\\(?:vec|frac|sqrt|hat|bar|dot|tilde|overline|underbrace|overbrace|sum|int|prod|lim|alpha|beta|gamma|delta|theta|lambda|mu|nu|pi|sigma|phi|omega|cdot|times|div|pm|mp|leq|geq|neq|approx|infty|partial|nabla|rightarrow|leftarrow|Rightarrow|Leftrightarrow)[\s{^_\\]/.test(text)
    || /^\$.*\$$/.test(text.trim());
}

// Renders a math label via KaTeX inside a <foreignObject> so it appears in SVG.
// Falls back to a plain <text> element on error.
function mathLabel(
  svgX: number, svgY: number,
  text: string, color: string,
  anchor: 'start' | 'middle' | 'end' = 'start',
  fontSize = 13,
): string {
  // Strip surrounding $ delimiters for KaTeX input.
  const stripped = text.trim().replace(/^\$|\$$/g, '').replace(/^\\\(|\\\)$/g, '');
  try {
    const html = katex.renderToString(stripped, {
      throwOnError: false,
      output: 'html',
      strict: false,
      trust: false,
    });
    const w = 160;
    const h = fontSize + 12;
    const dx = anchor === 'end' ? -w : anchor === 'middle' ? -(w / 2) : 0;
    return (
      `<foreignObject x="${(svgX + dx).toFixed(1)}" y="${(svgY - h + 4).toFixed(1)}" ` +
      `width="${w}" height="${h}" overflow="visible">` +
      `<div xmlns="http://www.w3.org/1999/xhtml" ` +
      `style="font-size:${fontSize - 1}px;color:${color};white-space:nowrap;font-weight:600;line-height:1">` +
      `${html}</div></foreignObject>`
    );
  } catch {
    return plainLabel(svgX, svgY, text, color, anchor, fontSize);
  }
}

function plainLabel(
  svgX: number, svgY: number,
  text: string, color: string,
  anchor: 'start' | 'middle' | 'end' = 'start',
  fontSize = 13,
): string {
  return `<text x="${svgX.toFixed(1)}" y="${svgY.toFixed(1)}" font-size="${fontSize}" font-weight="600" fill="${color}" text-anchor="${anchor}" dominant-baseline="auto">${esc(text)}</text>`;
}

// Unified label renderer: uses KaTeX for math labels, plain SVG text otherwise.
function renderLabel(
  svgX: number, svgY: number,
  text: string, color: string,
  anchor: 'start' | 'middle' | 'end' = 'start',
  fontSize = 13,
): string {
  return hasMath(text)
    ? mathLabel(svgX, svgY, text, color, anchor, fontSize)
    : plainLabel(svgX, svgY, text, color, anchor, fontSize);
}

export function renderGeometrySvg(spec: GeometrySpec): string {
  const W = spec.width ?? 460;
  const H = spec.height ?? 380;
  const pad = 32;
  const [xMin, xMax] = spec.xRange ?? [-5, 5];
  const [yMin, yMax] = spec.yRange ?? [-5, 5];
  const sx = (W - pad * 2) / (xMax - xMin);
  const sy = (H - pad * 2) / (yMax - yMin);
  const X = (x: number) => pad + (x - xMin) * sx;
  const Y = (y: number) => H - pad - (y - yMin) * sy;

  const parts: string[] = [];

  // grid
  if (spec.grid !== false) {
    for (let gx = Math.ceil(xMin); gx <= xMax; gx++) {
      parts.push(`<line x1="${X(gx)}" y1="${Y(yMin)}" x2="${X(gx)}" y2="${Y(yMax)}" stroke="#e8e8ef" stroke-width="1"/>`);
    }
    for (let gy = Math.ceil(yMin); gy <= yMax; gy++) {
      parts.push(`<line x1="${X(xMin)}" y1="${Y(gy)}" x2="${X(xMax)}" y2="${Y(gy)}" stroke="#e8e8ef" stroke-width="1"/>`);
    }
  }
  // axes
  if (spec.axes !== false) {
    parts.push(`<line x1="${X(xMin)}" y1="${Y(0)}" x2="${X(xMax)}" y2="${Y(0)}" stroke="#9aa0b4" stroke-width="1.5"/>`);
    parts.push(`<line x1="${X(0)}" y1="${Y(yMin)}" x2="${X(0)}" y2="${Y(yMax)}" stroke="#9aa0b4" stroke-width="1.5"/>`);
    parts.push(`<text x="${X(xMax) - 4}" y="${Y(0) - 6}" font-size="11" fill="#9aa0b4" text-anchor="end">x</text>`);
    parts.push(`<text x="${X(0) + 8}" y="${Y(yMax) + 12}" font-size="11" fill="#9aa0b4">y</text>`);
  }

  const DEF = '#e84393';
  const dot = (x: number, y: number, color: string) =>
    `<circle cx="${X(x)}" cy="${Y(y)}" r="3.5" fill="${color}"/>`;

  // Direction-aware label: offset CW-perpendicular to the motion direction.
  const smartLbl = (
    svgTipX: number, svgTipY: number,
    svgDx: number, svgDy: number,
    text: string, color: string,
    extraAlong = 10
  ) => {
    const len = Math.sqrt(svgDx * svgDx + svgDy * svgDy) || 1;
    const udx = svgDx / len, udy = svgDy / len;
    const px = udy, py = -udx;
    const lx = svgTipX + udx * extraAlong + px * 14;
    const ly = svgTipY + udy * extraAlong + py * 14;
    const anchor: 'start' | 'middle' | 'end' = px < -0.25 ? 'end' : px > 0.25 ? 'start' : 'middle';
    return renderLabel(lx, ly, text, color, anchor);
  };

  // Simple fixed label for midpoints (segments, circles, etc.)
  const lbl = (svgX: number, svgY: number, text: string, color: string, anchor: 'start' | 'middle' | 'end' = 'start') =>
    renderLabel(svgX + 8, svgY - 8, text, color, anchor);

  for (const el of spec.elements ?? []) {
    const color = ('color' in el && el.color) || DEF;
    if (el.type === 'point') {
      parts.push(dot(el.x, el.y, color));
      if (el.label) {
        const offX = el.x >= 0 ? 8 : -8;
        const offY = el.y >= 0 ? -10 : 12;
        const anchor: 'start' | 'end' = el.x >= 0 ? 'start' : 'end';
        parts.push(renderLabel(X(el.x) + offX, Y(el.y) + offY, el.label, color, anchor));
      }
    } else if (el.type === 'segment') {
      parts.push(`<line x1="${X(el.from[0])}" y1="${Y(el.from[1])}" x2="${X(el.to[0])}" y2="${Y(el.to[1])}" stroke="${color}" stroke-width="2"${el.dashed ? ' stroke-dasharray="5 4"' : ''}/>`);
      if (el.label) {
        const mx = (X(el.from[0]) + X(el.to[0])) / 2;
        const my = (Y(el.from[1]) + Y(el.to[1])) / 2;
        const svgDx = X(el.to[0]) - X(el.from[0]);
        const svgDy = Y(el.to[1]) - Y(el.from[1]);
        parts.push(smartLbl(mx, my, svgDx, svgDy, el.label, color, 0));
      }
    } else if (el.type === 'vector') {
      const id = `arr${Math.random().toString(36).slice(2, 7)}`;
      parts.push(`<defs><marker id="${id}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse" markerUnits="strokeWidth"><path d="M0 1L9 5L0 9z" fill="${color}"/></marker></defs>`);
      parts.push(`<line x1="${X(el.from[0])}" y1="${Y(el.from[1])}" x2="${X(el.to[0])}" y2="${Y(el.to[1])}" stroke="${color}" stroke-width="2" marker-end="url(#${id})"/>`);
      if (el.label) {
        const svgDx = X(el.to[0]) - X(el.from[0]);
        const svgDy = Y(el.to[1]) - Y(el.from[1]);
        parts.push(smartLbl(X(el.to[0]), Y(el.to[1]), svgDx, svgDy, el.label, color, 8));
      }
    } else if (el.type === 'line') {
      let p1: Pt, p2: Pt;
      if (el.from && el.to) {
        const dx = el.to[0] - el.from[0], dy = el.to[1] - el.from[1];
        p1 = [el.from[0] - dx * 100, el.from[1] - dy * 100];
        p2 = [el.to[0] + dx * 100, el.to[1] + dy * 100];
      } else {
        const a = el.a ?? 0, b = el.b ?? 1, c = el.c ?? 0; // ax+by+c=0
        if (b !== 0) { p1 = [xMin, -(a * xMin + c) / b]; p2 = [xMax, -(a * xMax + c) / b]; }
        else { const xv = -c / a; p1 = [xv, yMin]; p2 = [xv, yMax]; }
      }
      parts.push(`<line x1="${X(p1[0])}" y1="${Y(p1[1])}" x2="${X(p2[0])}" y2="${Y(p2[1])}" stroke="${color}" stroke-width="2"/>`);
      if (el.label && el.to) parts.push(lbl(X(el.to[0]), Y(el.to[1]), el.label, color));
    } else if (el.type === 'circle') {
      parts.push(`<ellipse cx="${X(el.center[0])}" cy="${Y(el.center[1])}" rx="${el.r * sx}" ry="${el.r * sy}" stroke="${color}" stroke-width="2" fill="${el.fill || 'none'}"/>`);
      if (el.label) parts.push(lbl(X(el.center[0]), Y(el.center[1] + el.r), el.label, color));
    } else if (el.type === 'polygon') {
      const pts = el.points.map(p => `${X(p[0])},${Y(p[1])}`).join(' ');
      parts.push(`<polygon points="${pts}" stroke="${color}" stroke-width="2" fill="${el.fill || 'rgba(232,67,147,0.12)'}"/>`);
      if (el.label && el.points[0]) parts.push(lbl(X(el.points[0][0]), Y(el.points[0][1]), el.label, color));
    } else if (el.type === 'angle') {
      const r = 0.5;
      const a1 = Math.atan2(el.from[1] - el.at[1], el.from[0] - el.at[0]);
      const a2 = Math.atan2(el.to[1] - el.at[1], el.to[0] - el.at[0]);
      const p1x = el.at[0] + r * Math.cos(a1), p1y = el.at[1] + r * Math.sin(a1);
      const p2x = el.at[0] + r * Math.cos(a2), p2y = el.at[1] + r * Math.sin(a2);
      // Sweep from a1 to a2 going in the positive (counterclockwise in math) direction
      const sweep = ((a2 - a1) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) > Math.PI ? 1 : 0;
      parts.push(`<path d="M ${X(p1x)} ${Y(p1y)} A ${r * sx} ${r * sy} 0 0 ${sweep} ${X(p2x)} ${Y(p2y)}" stroke="${color}" stroke-width="1.5" fill="none"/>`);
      if (el.label) {
        const amid = (a1 + a2) / 2;
        const lx = X(el.at[0] + (r + 0.3) * Math.cos(amid));
        const ly = Y(el.at[1] + (r + 0.3) * Math.sin(amid));
        parts.push(renderLabel(lx, ly, el.label, color, 'middle', 12));
      }
    } else if (el.type === 'function') {
      try {
        const f = compile(el.expr.toLowerCase());
        const segs: string[] = [];
        let started = false;
        const steps = 240;
        for (let i = 0; i <= steps; i++) {
          const xv = xMin + (xMax - xMin) * (i / steps);
          const yv = f(xv);
          if (!isFinite(yv) || yv < yMin - 50 || yv > yMax + 50) { started = false; continue; }
          segs.push(`${started ? 'L' : 'M'} ${X(xv).toFixed(1)} ${Y(yv).toFixed(1)}`);
          started = true;
        }
        parts.push(`<path d="${segs.join(' ')}" stroke="${color}" stroke-width="2" fill="none"/>`);
        if (el.label) parts.push(renderLabel(W - pad, pad, el.label, color, 'end', 12));
      } catch {
        parts.push(`<text x="${W / 2}" y="${H / 2}" font-size="12" fill="#cc0000" text-anchor="middle">式を解釈できなかったよ: ${esc(el.expr)}</text>`);
      }
    } else if (el.type === 'text') {
      parts.push(renderLabel(X(el.x), Y(el.y), el.text, color));
    }
  }

  const titleSvg = spec.title
    ? renderLabel(W / 2, 20, spec.title, '#222', 'middle', 14)
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="system-ui,sans-serif" overflow="visible"><rect width="${W}" height="${H}" fill="#ffffff"/>${titleSvg}${parts.join('')}</svg>`;
}

export function parseGeometry(code: string): GeometrySpec {
  let spec: GeometrySpec;
  try {
    spec = JSON.parse(code) as GeometrySpec;
  } catch {
    // Be tolerant of common LLM JSON quirks: surrounding prose / fences,
    // // line comments, and trailing commas before } or ].
    const start = code.indexOf('{');
    const end = code.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('JSON が見つからないよ');
    const cleaned = code
      .slice(start, end + 1)
      .replace(/\/\/[^\n\r]*/g, '')      // // comments
      .replace(/,(\s*[}\]])/g, '$1');    // trailing commas
    spec = JSON.parse(cleaned) as GeometrySpec;
  }
  if (!Array.isArray(spec.elements)) throw new Error('elements 配列がないよ');
  return spec;
}
