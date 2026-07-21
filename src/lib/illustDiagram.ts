// 図解（イラスト図解）の仕様 → SVG レンダラ。
//
// geometry.ts と同じ思想で、AI が出した JSON 仕様（ノード＝素材アイコン、
// エッジ＝ラベル付き矢印、ゾーン＝範囲の囲み）を純粋関数で 1 枚の SVG に描く。
// アイコンの実体は illustAssets.ts が持ち、ここは配置・接続・ラベルを担当する。

import { illustGlyph, iconCell } from './illustAssets';

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
const CARD = 84;               // ノードの白カードの一辺
const ISZ = 62;                // カード内に描くアイコンの一辺
const RB = CARD * 0.5 + 6;     // 接続線を止めるノード境界の半径（円近似）

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
// 主ラベルを最大 maxLines 行に折り返す（全角換算で maxUnits/行）。
// 英単語（連続 ASCII）は途中で割らないよう「原子」単位で折り返す。
function wrapLabel(s: string, maxUnits: number, maxLines = 2): string[] {
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
      if (lines.length >= maxLines - 1) { truncated = true; break; } // 最終行 → 打ち切り
      lines.push(cur); cur = ''; curW = 0;
    }
    cur += a; curW += w;
  }
  if (cur) lines.push(cur);
  if (truncated && lines.length >= 1) lines[lines.length - 1] += '…';
  return lines;
}

/* ---------- label metrics (shared by node render & collision pass) ---------- */
function labelMetrics(n: DiagramNode): { lines: string[]; fs: number; sfs: number; maxW: number; blockH: number } {
  const fs = 14, sfs = 11.5;
  const lines = n.label ? wrapLabel(n.label, 8) : [];
  const widths = [
    ...lines.map(l => textWidth(l, fs)),
    ...(n.sublabel ? [textWidth(n.sublabel, sfs)] : []),
  ];
  const maxW = Math.max(0, ...widths);
  const blockH = lines.length * (fs + 3) + (n.sublabel ? sfs + 4 : 0) + (lines.length || n.sublabel ? 6 : 0);
  return { lines, fs, sfs, maxW, blockH };
}

/* ---------- node card + icon ---------- */
function renderNode(n: DiagramNode, cx: number, cy: number, color: string, uid: string): string {
  const half = CARD / 2;
  const x = cx - half, y = cy - half;
  const parts: string[] = [];
  // やわらかい影 → 白カード（アイコンのラスターは白背景なのでカードに馴染む）
  parts.push(
    `<rect x="${x.toFixed(1)}" y="${(y + 3).toFixed(1)}" width="${CARD}" height="${CARD}" rx="18" fill="#0f172a" fill-opacity="0.07"/>`
  );
  parts.push(
    `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${CARD}" height="${CARD}" rx="18" ` +
    `fill="#ffffff" stroke="${color}" stroke-opacity="0.5" stroke-width="1.6"/>`
  );
  // アイコン: ラスター素材はセルを少し内側にした窓を contain でカードに収める。
  // clipPath + 一様スケール画像で切り出すので、横長アイコンも切れず中央に載る
  // （ネスト svg + viewBox は Safari/WebKit で位置がずれるため使わない）。
  const cell = iconCell(n.icon);
  if (cell) {
    const insetX = cell.cellW * 0.06, insetY = cell.cellH * 0.06;
    const wx = cell.cellX + insetX, wy = cell.cellY + insetY;
    const ww = cell.cellW - 2 * insetX, wh = cell.cellH - 2 * insetY;
    const scale = ISZ / Math.max(ww, wh);
    const clipW = ww * scale, clipH = wh * scale;
    const clipX = cx - clipW / 2, clipY = cy - clipH / 2;
    const imgW = cell.sheet.w * scale, imgH = cell.sheet.h * scale;
    const imgX = cx - (wx + ww / 2) * scale, imgY = cy - (wy + wh / 2) * scale;
    const cid = `ic${uid}`;
    parts.push(
      `<clipPath id="${cid}"><rect x="${clipX.toFixed(1)}" y="${clipY.toFixed(1)}" width="${clipW.toFixed(1)}" height="${clipH.toFixed(1)}" rx="3"/></clipPath>` +
      `<image href="${cell.sheet.file}" x="${imgX.toFixed(1)}" y="${imgY.toFixed(1)}" width="${imgW.toFixed(1)}" height="${imgH.toFixed(1)}" clip-path="url(#${cid})" preserveAspectRatio="none"/>`
    );
  } else {
    const gsz = ISZ * 0.92;
    const sc = gsz / 64;
    parts.push(
      `<g transform="translate(${(cx - gsz / 2).toFixed(1)},${(cy - gsz / 2).toFixed(1)}) scale(${sc.toFixed(3)})">${illustGlyph(n.icon, color)}</g>`
    );
  }
  // ラベル（カード下）。エッジやゾーンに重なっても読めるよう、白い下地を敷く。
  const m = labelMetrics(n);
  if (m.lines.length || n.sublabel) {
    const top = cy + half + 5;
    if (m.maxW > 0) {
      parts.push(
        `<rect x="${(cx - m.maxW / 2 - 6).toFixed(1)}" y="${top.toFixed(1)}" width="${(m.maxW + 12).toFixed(1)}" height="${m.blockH.toFixed(1)}" ` +
        `rx="7" fill="#ffffff" fill-opacity="0.9"/>`
      );
    }
    let ly = top + m.fs + 3;
    for (const ln of m.lines) {
      parts.push(
        `<text x="${cx.toFixed(1)}" y="${ly.toFixed(1)}" font-size="${m.fs}" font-weight="700" ` +
        `fill="#1e293b" text-anchor="middle">${esc(ln)}</text>`
      );
      ly += m.fs + 3;
    }
    if (n.sublabel) {
      parts.push(
        `<text x="${cx.toFixed(1)}" y="${(ly + 1).toFixed(1)}" font-size="${m.sfs}" ` +
        `fill="#64748b" text-anchor="middle">${esc(n.sublabel)}</text>`
      );
    }
  }
  return parts.join('');
}

/* ---------- edge ---------- */
// body（線＋矢印）は最背面近く、label（白下地付き）はノードより前面に描くため分けて返す。
function renderEdge(
  a: { x: number; y: number }, b: { x: number; y: number }, e: DiagramEdge, color: string,
  curveOverride: number,
): { body: string; label: string } {
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

  // ラベル（白い角丸背景で可読性を確保）。ノードカードに隠れないよう別レイヤーで返す。
  let label = '';
  if (e.label) {
    const fs = 12.5;
    const w = textWidth(e.label, fs) + 12;
    const h = fs + 8;
    label =
      `<rect x="${(midX - w / 2).toFixed(1)}" y="${(midY - h / 2).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" ` +
      `rx="6" fill="#ffffff" stroke="${color}" stroke-opacity="0.35" stroke-width="1"/>` +
      `<text x="${midX.toFixed(1)}" y="${(midY + fs * 0.35).toFixed(1)}" font-size="${fs}" font-weight="600" ` +
      `fill="${color}" text-anchor="middle">${esc(e.label)}</text>`;
  }
  return { body: parts.join(''), label };
}

/* ---------- zone ---------- */
// box は最背面、label は上の境界線上に「凡例」風の白下地付きで最前面に描く。
function renderZone(z: DiagramZone, W: number, H: number, padL: number, padR: number, padT: number, padB: number, color: string): { box: string; label: string } {
  const x = padL + (z.x / 100) * (W - padL - padR);
  const y = padT + (z.y / 100) * (H - padT - padB);
  const w = (z.w / 100) * (W - padL - padR);
  const box =
    `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${((z.h / 100) * (H - padT - padB)).toFixed(1)}" rx="14" ` +
    `fill="${color}" fill-opacity="0.05" stroke="${color}" stroke-opacity="0.5" stroke-width="1.6" stroke-dasharray="7 5"/>`;
  let label = '';
  if (z.label) {
    const fs = 12.5;
    const tw = textWidth(z.label, fs);
    const lx = x + 16;
    // ラベルは枠の上辺に載せ、白下地で下の線・アイコンと重ならないようにする。
    label =
      `<rect x="${(lx - 6).toFixed(1)}" y="${(y - fs / 2 - 3).toFixed(1)}" width="${(tw + 12).toFixed(1)}" height="${(fs + 6).toFixed(1)}" rx="5" fill="#ffffff"/>` +
      `<text x="${lx.toFixed(1)}" y="${(y + fs * 0.35).toFixed(1)}" font-size="${fs}" font-weight="700" fill="${color}">${esc(z.label)}</text>`;
  }
  return { box, label };
}

/* ---------- main ---------- */
export function renderIllustDiagramSvg(spec: IllustDiagramSpec): string {
  const nodes = Array.isArray(spec.nodes) ? spec.nodes : [];
  const edges = Array.isArray(spec.edges) ? spec.edges : [];
  const zones = Array.isArray(spec.zones) ? spec.zones : [];
  const notes = Array.isArray(spec.notes) ? spec.notes : [];

  const hasTitle = !!(spec.title && spec.title.trim());
  const W = Math.max(360, Math.min(1600, spec.width ?? 880));
  const H = Math.max(280, Math.min(1200, spec.height ?? 540));

  const padL = CARD * 0.5 + 40;
  const padR = CARD * 0.5 + 40;
  const padT = (hasTitle ? 54 : 28) + CARD * 0.5;
  const padB = CARD * 0.5 + 52;

  const center = (n: DiagramNode) => ({
    x: padL + (Math.max(0, Math.min(100, n.x)) / 100) * (W - padL - padR),
    y: padT + (Math.max(0, Math.min(100, n.y)) / 100) * (H - padT - padB),
  });

  const colorOf = (c: string | undefined, i: number) => resolveColor(c, PALETTE[i % PALETTE.length]!);
  const centers = new Map<string, { x: number; y: number }>();
  nodes.forEach(n => centers.set(n.id, center(n)));

  // ── ノードの重なり緩和 ──
  // カード＋下のラベルの矩形が重なるノードを、少しずつ押し離す（重なった時だけ動く
  // ので、余裕のある配置はそのまま）。キャンバス内に収める。
  {
    const ext = nodes.map(n => {
      const m = labelMetrics(n);
      return { halfW: Math.max(CARD, m.maxW) / 2 + 7, up: CARD / 2 + 6, down: CARD / 2 + m.blockH + 6 };
    });
    const P = nodes.map(n => ({ ...centers.get(n.id)! }));
    const minX = padL, maxX = W - padR, minY = padT, maxY = H - padB;
    for (let it = 0; it < 90; it++) {
      let moved = false;
      for (let i = 0; i < P.length; i++) {
        for (let j = i + 1; j < P.length; j++) {
          const a = P[i]!, b = P[j]!, ea = ext[i]!, eb = ext[j]!;
          const ox = Math.min(a.x + ea.halfW, b.x + eb.halfW) - Math.max(a.x - ea.halfW, b.x - eb.halfW);
          const oy = Math.min(a.y + ea.down, b.y + eb.down) - Math.max(a.y - ea.up, b.y - eb.up);
          if (ox > 0 && oy > 0) {
            moved = true;
            if (ox <= oy) {
              const push = ox / 2 + 0.5, dir = a.x < b.x ? -1 : 1;
              a.x += dir * push; b.x -= dir * push;
            } else {
              const push = oy / 2 + 0.5, dir = a.y < b.y ? -1 : 1;
              a.y += dir * push; b.y -= dir * push;
            }
          }
        }
      }
      for (const p of P) { p.x = Math.max(minX, Math.min(maxX, p.x)); p.y = Math.max(minY, Math.min(maxY, p.y)); }
      if (!moved) break;
    }
    nodes.forEach((n, i) => centers.set(n.id, P[i]!));
  }

  // ノード id -> 色（エッジ色のフォールバックに使う）
  const nodeColor = new Map<string, string>();
  nodes.forEach((n, i) => nodeColor.set(n.id, colorOf(n.color, i)));

  const rid = Math.random().toString(36).slice(2, 8);
  const layers: string[] = [];
  const topLayers: string[] = []; // ノードより前面（ゾーンラベル・ノート・エッジラベル）

  // 1) ゾーンの枠（最背面）。ラベルは最前面へ。
  zones.forEach((z, i) => {
    const { box, label } = renderZone(z, W, H, padL, padR, padT, padB, colorOf(z.color, i + 2));
    layers.push(box);
    if (label) topLayers.push(label);
  });

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
    const { body, label } = renderEdge(a, b, e, col, curve);
    layers.push(body);
    if (label) topLayers.push(label); // ラベルは最前面へ
  });

  // 3) ノード
  nodes.forEach((n, i) => {
    const p = centers.get(n.id)!;
    layers.push(renderNode(n, p.x, p.y, colorOf(n.color, i), `${rid}-${i}`));
  });

  // 4) ノート（自由テキスト）— 折り返し＋白下地でノードより前面に描く。
  notes.forEach(nt => {
    const cxp = padL + (Math.max(0, Math.min(100, nt.x)) / 100) * (W - padL - padR);
    const cyp = padT + (Math.max(0, Math.min(100, nt.y)) / 100) * (H - padT - padB);
    const col = resolveColor(nt.color, '#475569');
    const fs = 12.5;
    const lines = wrapLabel(nt.text, 30, 4);
    const maxW = Math.max(0, ...lines.map(l => textWidth(l, fs)));
    const boxW = maxW + 16, boxH = lines.length * (fs + 4) + 8;
    topLayers.push(
      `<rect x="${(cxp - boxW / 2).toFixed(1)}" y="${(cyp - boxH / 2).toFixed(1)}" width="${boxW.toFixed(1)}" height="${boxH.toFixed(1)}" ` +
      `rx="7" fill="#ffffff" fill-opacity="0.94" stroke="${col}" stroke-opacity="0.2" stroke-width="1"/>`
    );
    let ny = cyp - boxH / 2 + fs + 4;
    for (const ln of lines) {
      topLayers.push(
        `<text x="${cxp.toFixed(1)}" y="${ny.toFixed(1)}" font-size="${fs}" fill="${col}" text-anchor="middle">${esc(ln)}</text>`
      );
      ny += fs + 4;
    }
  });

  // 5) 最前面レイヤー（ゾーンラベル → エッジラベル → ノート）をまとめて重ねる。
  topLayers.forEach(l => layers.push(l));

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
