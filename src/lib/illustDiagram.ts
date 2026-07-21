// 図解（イラスト図解）の仕様 → SVG レンダラ。
//
// geometry.ts と同じ思想で、AI が出した JSON 仕様（ノード＝素材アイコン、
// エッジ＝ラベル付き矢印、ゾーン＝範囲の囲み）を純粋関数で 1 枚の SVG に描く。
// アイコンの実体は illustAssets.ts が持ち、ここは配置・接続・ラベルを担当する。

import { illustGlyph } from './illustAssets';

export interface DiagramNode {
  id: string;
  icon: string;         // 素材キー（illustAssets の key）
  label?: string;       // アイコン下の主ラベル
  sublabel?: string;    // 補助ラベル（小さめ・薄め）
  x: number;            // 0..100（キャンバス横方向の中心位置）
  y: number;            // 0..100（縦方向の中心位置）
  color?: string;       // 'blue' 等の名前 or #hex。省略時は自動割り当て
}

export interface DiagramEdge {
  from: string;         // ノード id
  to: string;           // ノード id
  label?: string;
  color?: string;
  dashed?: boolean;
  dir?: 'to' | 'both' | 'none';  // 矢印の向き（既定 'to'）
  curve?: number;       // -1..1 の弓なり量（既定 0＝直線）
}

export interface DiagramZone {
  label?: string;
  x: number; y: number; w: number; h: number; // 0..100 座標（左上 + 幅高さ）
  color?: string;
}

export interface DiagramNote {
  x: number; y: number; text: string; color?: string;
}

export interface IllustDiagramSpec {
  title?: string;
  width?: number;
  height?: number;
  nodes: DiagramNode[];
  edges?: DiagramEdge[];
  zones?: DiagramZone[];
  notes?: DiagramNote[];
}

/* ---------- palette ---------- */
const PALETTE = ['#6366f1', '#ec4899', '#0ea5e9', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#14b8a6'];
const NAMED: Record<string, string> = {
  purple: '#8b5cf6', violet: '#8b5cf6', indigo: '#6366f1', blue: '#0ea5e9', sky: '#0ea5e9',
  pink: '#ec4899', rose: '#f43f5e', red: '#ef4444', orange: '#f59e0b', amber: '#f59e0b',
  yellow: '#eab308', green: '#10b981', emerald: '#10b981', teal: '#14b8a6', cyan: '#06b6d4',
  gray: '#64748b', grey: '#64748b', slate: '#64748b', black: '#334155',
};
function resolveColor(c: string | undefined, fallback: string): string {
  if (!c) return fallback;
  if (/^#[0-9a-fA-F]{3,8}$/.test(c)) return c;
  return NAMED[c.toLowerCase()] ?? fallback;
}

/* ---------- geometry constants ---------- */
const BADGE = 78;              // ノードの丸角バッジの一辺
const RB = BADGE * 0.5 + 5;    // 接続線を止めるノード境界の半径（円近似）
const ICON_PAD = 11;           // バッジ内のアイコン余白

/* ---------- text helpers ---------- */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
// おおよその表示幅（全角=1, 半角=0.56 で近似）。
function textWidth(s: string, fs: number): number {
  let w = 0;
  for (const ch of s) w += /[\x20-\x7e]/.test(ch) ? 0.56 : 1;
  return w * fs;
}
// 主ラベルを最大 2 行に折り返す（全角換算で maxUnits/行）。
// 英単語（連続 ASCII）は途中で割らないよう「原子」単位で折り返す。
function wrapLabel(s: string, maxUnits: number): string[] {
  const uw = (a: string) => { let u = 0; for (const c of a) u += /[\x20-\x7e]/.test(c) ? 0.56 : 1; return u; };
  // CJK 等は 1 文字ずつ、連続 ASCII は 1 語としてまとめる。
  const atoms: string[] = [];
  let i = 0;
  while (i < s.length) {
    if (/[\x20-\x7e]/.test(s[i]!)) {
      let w = '';
      while (i < s.length && /[\x20-\x7e]/.test(s[i]!)) { w += s[i]; i++; }
      atoms.push(w);
    } else { atoms.push(s[i]!); i++; }
  }
  const lines: string[] = [];
  let cur = '', curW = 0, truncated = false;
  for (const a of atoms) {
    const w = uw(a);
    if (curW + w > maxUnits && cur) {
      if (lines.length >= 1) { truncated = true; break; } // 既に2行目 → 打ち切り
      lines.push(cur); cur = ''; curW = 0;
    }
    cur += a; curW += w;
  }
  if (cur) lines.push(cur);
  if (truncated && lines.length >= 1) lines[lines.length - 1] += '…';
  return lines;
}

/* ---------- node badge ---------- */
function renderNode(n: DiagramNode, cx: number, cy: number, color: string): string {
  const half = BADGE / 2;
  const x = cx - half, y = cy - half;
  const scale = (BADGE - ICON_PAD * 2) / 64;
  const glyph = illustGlyph(n.icon, color);
  const parts: string[] = [];
  // バッジ背景
  parts.push(
    `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${BADGE}" height="${BADGE}" rx="18" ` +
    `fill="${color}" fill-opacity="0.09" stroke="${color}" stroke-opacity="0.35" stroke-width="1.5"/>`
  );
  // アイコン（64→scale）
  parts.push(
    `<g transform="translate(${(x + ICON_PAD).toFixed(1)},${(y + ICON_PAD).toFixed(1)}) scale(${scale.toFixed(3)})">${glyph}</g>`
  );
  // 主ラベル（バッジ下）
  if (n.label) {
    const fs = 14;
    const lines = wrapLabel(n.label, 8);
    let ly = cy + half + 17;
    for (const ln of lines) {
      parts.push(
        `<text x="${cx.toFixed(1)}" y="${ly.toFixed(1)}" font-size="${fs}" font-weight="700" ` +
        `fill="#1e293b" text-anchor="middle">${esc(ln)}</text>`
      );
      ly += fs + 2;
    }
    if (n.sublabel) {
      parts.push(
        `<text x="${cx.toFixed(1)}" y="${ly.toFixed(1)}" font-size="11.5" ` +
        `fill="#64748b" text-anchor="middle">${esc(n.sublabel)}</text>`
      );
    }
  }
  return parts.join('');
}

/* ---------- edge ---------- */
function renderEdge(
  a: { x: number; y: number }, b: { x: number; y: number }, e: DiagramEdge, color: string,
  curveOverride: number,
): string {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const sx = a.x + ux * RB, sy = a.y + uy * RB;
  const ex = b.x - ux * RB, ey = b.y - uy * RB;
  const dir = e.dir ?? 'to';
  const parts: string[] = [];

  // 経路（弓なり対応）。curve!=0 のとき中点を法線方向にずらした二次ベジェ。
  const bow = Math.max(-1, Math.min(1, curveOverride));
  let midX = (sx + ex) / 2, midY = (sy + ey) / 2;
  let path: string;
  if (bow !== 0) {
    const nx = -uy, ny = ux;
    const off = bow * Math.min(120, len * 0.4);
    const qx = midX + nx * off, qy = midY + ny * off;
    path = `M${sx.toFixed(1)} ${sy.toFixed(1)} Q${qx.toFixed(1)} ${qy.toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}`;
    // ラベルは制御点寄りの曲線上に置く
    midX = 0.25 * sx + 0.5 * qx + 0.25 * ex;
    midY = 0.25 * sy + 0.5 * qy + 0.25 * ey;
  } else {
    path = `M${sx.toFixed(1)} ${sy.toFixed(1)} L${ex.toFixed(1)} ${ey.toFixed(1)}`;
  }
  const dash = e.dashed ? ` stroke-dasharray="6 5"` : '';
  parts.push(`<path d="${path}" fill="none" stroke="${color}" stroke-width="2.4" stroke-linecap="round"${dash}/>`);

  // 矢印ヘッド（角度は端点付近の接線方向で近似）
  const head = (tipX: number, tipY: number, dirX: number, dirY: number) => {
    const l = Math.hypot(dirX, dirY) || 1;
    const hx = dirX / l, hy = dirY / l;
    const px = -hy, py = hx;
    const size = 8.5, wid = 4.8;
    const bx = tipX - hx * size, by = tipY - hy * size;
    const p1 = `${(bx + px * wid).toFixed(1)},${(by + py * wid).toFixed(1)}`;
    const p2 = `${(bx - px * wid).toFixed(1)},${(by - py * wid).toFixed(1)}`;
    return `<polygon points="${tipX.toFixed(1)},${tipY.toFixed(1)} ${p1} ${p2}" fill="${color}"/>`;
  };
  if (dir === 'to' || dir === 'both') parts.push(head(ex, ey, ux, uy));
  if (dir === 'both') parts.push(head(sx, sy, -ux, -uy));

  // ラベル（白い角丸背景で可読性を確保）
  if (e.label) {
    const fs = 12.5;
    const w = textWidth(e.label, fs) + 12;
    const h = fs + 8;
    parts.push(
      `<rect x="${(midX - w / 2).toFixed(1)}" y="${(midY - h / 2).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" ` +
      `rx="6" fill="#ffffff" stroke="${color}" stroke-opacity="0.35" stroke-width="1"/>`
    );
    parts.push(
      `<text x="${midX.toFixed(1)}" y="${(midY + fs * 0.35).toFixed(1)}" font-size="${fs}" font-weight="600" ` +
      `fill="${color}" text-anchor="middle">${esc(e.label)}</text>`
    );
  }
  return parts.join('');
}

/* ---------- zone ---------- */
function renderZone(z: DiagramZone, W: number, H: number, padL: number, padR: number, padT: number, padB: number, color: string): string {
  const x = padL + (z.x / 100) * (W - padL - padR);
  const y = padT + (z.y / 100) * (H - padT - padB);
  const w = (z.w / 100) * (W - padL - padR);
  const h = (z.h / 100) * (H - padT - padB);
  const parts: string[] = [];
  parts.push(
    `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="14" ` +
    `fill="${color}" fill-opacity="0.05" stroke="${color}" stroke-opacity="0.5" stroke-width="1.6" stroke-dasharray="7 5"/>`
  );
  if (z.label) {
    parts.push(
      `<text x="${(x + 12).toFixed(1)}" y="${(y + 19).toFixed(1)}" font-size="12.5" font-weight="700" ` +
      `fill="${color}">${esc(z.label)}</text>`
    );
  }
  return parts.join('');
}

/* ---------- main ---------- */
export function renderIllustDiagramSvg(spec: IllustDiagramSpec): string {
  const nodes = Array.isArray(spec.nodes) ? spec.nodes : [];
  const edges = Array.isArray(spec.edges) ? spec.edges : [];
  const zones = Array.isArray(spec.zones) ? spec.zones : [];
  const notes = Array.isArray(spec.notes) ? spec.notes : [];

  const hasTitle = !!(spec.title && spec.title.trim());
  const W = Math.max(360, Math.min(1400, spec.width ?? 780));
  const H = Math.max(280, Math.min(1200, spec.height ?? 480));

  const padL = BADGE * 0.5 + 34;
  const padR = BADGE * 0.5 + 34;
  const padT = (hasTitle ? 50 : 26) + BADGE * 0.5;
  const padB = BADGE * 0.5 + 46;

  const center = (n: DiagramNode) => ({
    x: padL + (Math.max(0, Math.min(100, n.x)) / 100) * (W - padL - padR),
    y: padT + (Math.max(0, Math.min(100, n.y)) / 100) * (H - padT - padB),
  });

  const colorOf = (c: string | undefined, i: number) => resolveColor(c, PALETTE[i % PALETTE.length]!);
  const centers = new Map<string, { x: number; y: number }>();
  nodes.forEach(n => centers.set(n.id, center(n)));
  // ノード id -> 色（エッジ色のフォールバックに使う）
  const nodeColor = new Map<string, string>();
  nodes.forEach((n, i) => nodeColor.set(n.id, colorOf(n.color, i)));

  const layers: string[] = [];

  // 1) ゾーン（最背面）
  zones.forEach((z, i) => layers.push(renderZone(z, W, H, padL, padR, padT, padB, colorOf(z.color, i + 2))));

  // 2) エッジ。同じ2ノード間に複数の矢印がある場合（例: TCP 3ウェイハンドシェイク）は
  // ラベルが重ならないよう、curve 未指定なら自動で弓なりを振り分ける。
  const pairKey = (e: DiagramEdge) => (e.from < e.to ? `${e.from} ${e.to}` : `${e.to} ${e.from}`);
  const groups = new Map<string, number[]>();
  edges.forEach((e, i) => {
    const k = pairKey(e);
    const arr = groups.get(k) ?? [];
    arr.push(i);
    groups.set(k, arr);
  });
  edges.forEach((e, i) => {
    const a = centers.get(e.from), b = centers.get(e.to);
    if (!a || !b) return;
    const col = resolveColor(e.color, nodeColor.get(e.from) ?? '#64748b');
    let curve = e.curve ?? 0;
    const grp = groups.get(pairKey(e))!;
    if (grp.length > 1 && grp.every(j => !edges[j]!.curve)) {
      // 全て curve 未指定のときだけ自動振り分け。画面上で一貫した側に膨らむよう、
      // ペアの正準向き（id 昇順）に対する各辺の向きで符号を合わせる。
      const pos = grp.indexOf(i);
      const step = Math.min(0.55, 0.9 / (grp.length - 1));
      const base = (pos - (grp.length - 1) / 2) * step;
      const idA = e.from < e.to ? e.from : e.to;
      curve = base * (e.from === idA ? 1 : -1);
    }
    layers.push(renderEdge(a, b, e, col, curve));
  });

  // 3) ノート（自由テキスト）— 他の要素の上でも読めるよう白い角丸背景を敷く。
  notes.forEach(nt => {
    const x = padL + (Math.max(0, Math.min(100, nt.x)) / 100) * (W - padL - padR);
    const y = padT + (Math.max(0, Math.min(100, nt.y)) / 100) * (H - padT - padB);
    const col = resolveColor(nt.color, '#475569');
    const fs = 12.5;
    const w = textWidth(nt.text, fs) + 14;
    const h = fs + 9;
    layers.push(
      `<rect x="${(x - w / 2).toFixed(1)}" y="${(y - h / 2).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" ` +
      `rx="7" fill="#ffffff" fill-opacity="0.92" stroke="${col}" stroke-opacity="0.2" stroke-width="1"/>`
    );
    layers.push(
      `<text x="${x.toFixed(1)}" y="${(y + fs * 0.35).toFixed(1)}" font-size="${fs}" fill="${col}" text-anchor="middle">${esc(nt.text)}</text>`
    );
  });

  // 4) ノード（最前面）
  nodes.forEach((n, i) => {
    const p = centers.get(n.id)!;
    layers.push(renderNode(n, p.x, p.y, colorOf(n.color, i)));
  });

  const titleSvg = hasTitle
    ? `<text x="${(W / 2).toFixed(1)}" y="30" font-size="17" font-weight="800" fill="#0f172a" text-anchor="middle">${esc(spec.title!.trim())}</text>`
    : '';

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" ` +
    `font-family="system-ui,-apple-system,'Segoe UI',sans-serif" overflow="visible">` +
    `<rect width="${W}" height="${H}" rx="16" fill="#ffffff"/>` +
    `${titleSvg}${layers.join('')}</svg>`
  );
}

/* ---------- parse ---------- */
// フェンス（```diagram / ~~~diagram / ```json）が付いていても剥がして JSON.parse。
export function parseIllustDiagram(code: string): IllustDiagramSpec {
  let text = (code || '').trim();
  const fence = text.match(/^(?:`{3,}|~{3,})\s*[a-zA-Z]*\s*\n([\s\S]*?)\n(?:`{3,}|~{3,})\s*$/);
  if (fence) text = fence[1]!.trim();
  // フェンスなしでも先頭/末尾のバッククォートを念のため除去
  text = text.replace(/^(?:`{3,}|~{3,})[a-zA-Z]*\s*/, '').replace(/(?:`{3,}|~{3,})\s*$/, '').trim();
  // { で始まらない場合は最初の { から最後の } を抜き出す
  if (!text.startsWith('{')) {
    const s = text.indexOf('{'), e = text.lastIndexOf('}');
    if (s >= 0 && e > s) text = text.slice(s, e + 1);
  }
  const raw = JSON.parse(text) as Partial<IllustDiagramSpec>;
  if (!raw || !Array.isArray(raw.nodes) || raw.nodes.length === 0) {
    throw new Error('図解データにノードがありません');
  }
  return {
    title: typeof raw.title === 'string' ? raw.title : undefined,
    width: typeof raw.width === 'number' ? raw.width : undefined,
    height: typeof raw.height === 'number' ? raw.height : undefined,
    nodes: raw.nodes.map((n, i) => ({
      id: String(n.id ?? `n${i}`),
      icon: String(n.icon ?? 'gear'),
      label: n.label != null ? String(n.label) : undefined,
      sublabel: n.sublabel != null ? String(n.sublabel) : undefined,
      x: Number(n.x ?? 50),
      y: Number(n.y ?? 50),
      color: n.color != null ? String(n.color) : undefined,
    })),
    edges: Array.isArray(raw.edges) ? raw.edges.map(e => ({
      from: String(e.from ?? ''),
      to: String(e.to ?? ''),
      label: e.label != null ? String(e.label) : undefined,
      color: e.color != null ? String(e.color) : undefined,
      dashed: !!e.dashed,
      dir: e.dir === 'both' || e.dir === 'none' ? e.dir : 'to',
      curve: typeof e.curve === 'number' ? e.curve : 0,
    })) : [],
    zones: Array.isArray(raw.zones) ? raw.zones.map(z => ({
      label: z.label != null ? String(z.label) : undefined,
      x: Number(z.x ?? 0), y: Number(z.y ?? 0),
      w: Number(z.w ?? 30), h: Number(z.h ?? 30),
      color: z.color != null ? String(z.color) : undefined,
    })) : [],
    notes: Array.isArray(raw.notes) ? raw.notes.map(nt => ({
      x: Number(nt.x ?? 50), y: Number(nt.y ?? 50),
      text: String(nt.text ?? ''),
      color: nt.color != null ? String(nt.color) : undefined,
    })) : [],
  };
}
