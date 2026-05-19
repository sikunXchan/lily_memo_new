// Parses Lily's ```slides``` block (content-only JSON) and renders a
// polished, "Gamma-level" .pptx via pptxgenjs. Lily only supplies text +
// a slide `type`; all design (theme, layout, typography, accents) is
// controlled here. pptxgenjs is loaded dynamically so it stays out of
// the main bundle.

import { triggerDownload, sanitizeFilename } from './fileGen';

export type ThemeName = 'business' | 'education' | 'creative';
export type SlideType =
  | 'cover' | 'agenda' | 'section' | 'bullets' | 'twoCol'
  | 'stats' | 'quote' | 'compare' | 'process' | 'closing';

export interface Col { heading?: string; items: string[] }
export interface Kpi { value: string; label: string; detail?: string }
export interface Step { heading: string; detail?: string }

export interface DeckSlide {
  type: SlideType;
  heading?: string;
  subtitle?: string;
  lead?: string;
  items?: string[];
  left?: Col;
  right?: Col;
  cols?: Col[];
  kpis?: Kpi[];
  steps?: Step[];
  quote?: string;
  by?: string;
}

export interface SlideDeck {
  title: string;
  subtitle?: string;
  theme: ThemeName;
  slides: DeckSlide[];
}

// ---- Theme palette (hex without '#', pptxgenjs format) ---------------

interface Theme {
  ink: string; muted: string; accent: string; accent2: string;
  panel: string; dark: string; onDark: string; onDarkMuted: string;
}

const THEMES: Record<ThemeName, Theme> = {
  business: {
    ink: '1B2430', muted: '6B7280', accent: '2E5FE8', accent2: '7BA0F4',
    panel: 'F1F4FB', dark: '14213D', onDark: 'FFFFFF', onDarkMuted: 'C6CFE6',
  },
  education: {
    ink: '1F2A24', muted: '6B7B70', accent: '1F9D6B', accent2: 'F2A33C',
    panel: 'EAF6F0', dark: '123A2C', onDark: 'FFFFFF', onDarkMuted: 'C2DBCF',
  },
  creative: {
    ink: '221A2E', muted: '7A6E88', accent: '7C4DFF', accent2: 'FF4D9D',
    panel: 'F4EEFF', dark: '1E1330', onDark: 'FFFFFF', onDarkMuted: 'D8CCEC',
  },
};

function resolveThemeName(val: string): ThemeName {
  const v = (val || '').toLowerCase();
  if (/business|ビジネス|企業|プロフェッショナル|professional|会議/.test(v)) return 'business';
  if (/education|教育|学習|授業|研修|academic/.test(v)) return 'education';
  if (/creative|クリエイティブ|デザイン|colorful|カラフル/.test(v)) return 'creative';
  return v === 'education' || v === 'creative' ? v : 'business';
}

// ---- Parse content JSON ---------------------------------------------

const arr = (v: unknown, max: number): string[] =>
  Array.isArray(v) ? v.map(x => String(x)).filter(Boolean).slice(0, max) : [];

const str = (v: unknown): string | undefined =>
  v == null ? undefined : String(v).trim() || undefined;

function normCol(v: Record<string, unknown> | undefined): Col | undefined {
  if (!v || typeof v !== 'object') return undefined;
  return { heading: str(v.h ?? v.heading), items: arr(v.items, 6) };
}

const TYPES: SlideType[] = [
  'cover', 'agenda', 'section', 'bullets', 'twoCol',
  'stats', 'quote', 'compare', 'process', 'closing',
];

function normSlide(raw: Record<string, unknown>): DeckSlide {
  const ty = String(raw.ty ?? raw.type ?? '').trim() as SlideType;
  const type: SlideType = TYPES.includes(ty) ? ty : 'bullets';
  const s: DeckSlide = {
    type,
    heading: str(raw.h ?? raw.heading),
    subtitle: str(raw.sub ?? raw.subtitle),
    lead: str(raw.lead),
  };
  if (type === 'bullets' || type === 'agenda') s.items = arr(raw.items, 6);
  if (type === 'twoCol') {
    s.left = normCol(raw.l as Record<string, unknown>) ?? { items: [] };
    s.right = normCol(raw.r as Record<string, unknown>) ?? { items: [] };
  }
  if (type === 'compare' && Array.isArray(raw.cols)) {
    s.cols = (raw.cols as Record<string, unknown>[])
      .map(normCol).filter((c): c is Col => !!c).slice(0, 3);
  }
  if (type === 'stats' && Array.isArray(raw.kpis)) {
    s.kpis = (raw.kpis as Record<string, unknown>[]).slice(0, 4).map(k => ({
      value: String(k.v ?? k.value ?? ''),
      label: String(k.l ?? k.label ?? ''),
      detail: str(k.d ?? k.detail),
    }));
  }
  if (type === 'process' && Array.isArray(raw.steps)) {
    s.steps = (raw.steps as Record<string, unknown>[]).slice(0, 5).map(st => ({
      heading: String(st.h ?? st.heading ?? ''),
      detail: str(st.d ?? st.detail),
    }));
  }
  if (type === 'quote') {
    s.quote = str(raw.q ?? raw.quote);
    s.by = str(raw.by);
  }
  return s;
}

const ERROR_DECK: SlideDeck = {
  title: '再生成が必要です',
  theme: 'business',
  slides: [{
    type: 'section',
    heading: 'このスライドは旧形式だよ',
    subtitle: 'お手数だけど、もう一度「スライドにして」とお願いしてね 🐶',
  }],
};

export function parseSlides(raw: string): SlideDeck {
  try {
    const first = raw.indexOf('{');
    const last = raw.lastIndexOf('}');
    if (first < 0 || last <= first) return ERROR_DECK;
    const obj = JSON.parse(raw.slice(first, last + 1)) as Record<string, unknown>;
    const slidesRaw = (obj.s ?? obj.slides) as Record<string, unknown>[] | undefined;
    if (!Array.isArray(slidesRaw) || slidesRaw.length === 0) return ERROR_DECK;
    const slides = slidesRaw.map(normSlide);
    return {
      title: str(obj.t ?? obj.title) || 'プレゼンテーション',
      subtitle: str(obj.sub ?? obj.subtitle),
      theme: resolveThemeName(String(obj.th ?? obj.theme ?? '')),
      slides,
    };
  } catch {
    return ERROR_DECK;
  }
}

// ---- pptxgenjs rendering --------------------------------------------

// Minimal structural types so we don't depend on the lib's d.ts shape
// and don't pull it into the type graph at module load.
interface PSlide {
  background: { color: string };
  addText: (t: unknown, o: Record<string, unknown>) => void;
  addShape: (s: string, o: Record<string, unknown>) => void;
}
interface PInstance {
  defineLayout: (o: { name: string; width: number; height: number }) => void;
  layout: string;
  defineSlideMaster: (o: Record<string, unknown>) => void;
  addSlide: (o?: { masterName?: string }) => PSlide;
  write: (o: { outputType: string }) => Promise<unknown>;
}
interface PClass {
  new (): PInstance;
}

const W = 13.333;
const H = 7.5;
const FONT = 'Yu Gothic UI';

const BASE = 'LILY_BASE';
const DARK = 'LILY_DARK';

const FILL = (color: string, transparency?: number) =>
  transparency == null ? { color } : { color, transparency };

function buildMasters(p: PInstance, t: Theme) {
  p.defineSlideMaster({
    title: BASE,
    background: { color: 'FFFFFF' },
    objects: [
      // soft corner glow (two faint accent ellipses, bottom-right)
      { rect: { x: W - 3.4, y: H - 2.7, w: 3.4, h: 2.7, fill: FILL(t.accent, 94) } },
      { rect: { x: 0, y: H - 0.06, w: W, h: 0.06, fill: FILL(t.accent) } },
    ],
    slideNumber: { x: W - 1.0, y: H - 0.46, w: 0.7, h: 0.32, color: t.muted, fontSize: 9, align: 'right', fontFace: FONT },
  });
  p.defineSlideMaster({
    title: DARK,
    background: { color: t.dark },
    objects: [
      { ellipse: { x: W - 5.0, y: -2.6, w: 7.4, h: 7.4, fill: FILL(t.accent, 86) } },
      { ellipse: { x: -2.4, y: H - 3.4, w: 5.6, h: 5.6, fill: FILL(t.accent2, 90) } },
    ],
  });
}

function buildPremiumMasters(p: PInstance, t: Theme) {
  p.defineSlideMaster({
    title: BASE,
    background: { color: 'FFFFFF' },
    objects: [
      { rect: { x: W - 3.4, y: H - 2.7, w: 3.4, h: 2.7, fill: FILL(t.accent, 94) } },
      { rect: { x: W - 2.0, y: H - 1.8, w: 2.0, h: 1.8, fill: FILL(t.accent2, 92) } },
      { rect: { x: 0, y: 0, w: 0.08, h: H, fill: FILL(t.accent, 85) } },
      { rect: { x: 0, y: H - 0.09, w: W, h: 0.09, fill: FILL(t.accent) } },
    ],
    slideNumber: { x: W - 1.0, y: H - 0.52, w: 0.7, h: 0.32, color: t.muted, fontSize: 9, align: 'right', fontFace: FONT },
  });
  p.defineSlideMaster({
    title: DARK,
    background: { color: t.dark },
    objects: [
      { ellipse: { x: W - 5.5, y: -3.0, w: 8.5, h: 8.5, fill: FILL(t.accent, 82) } },
      { ellipse: { x: -3.0, y: H - 4.0, w: 6.5, h: 6.5, fill: FILL(t.accent2, 86) } },
      { ellipse: { x: W - 2.5, y: H - 2.5, w: 3.0, h: 3.0, fill: FILL(t.accent, 78) } },
    ],
  });
}

interface Ctx { p: PInstance; t: Theme; deck: SlideDeck; n: number; total: number; quality?: 'standard' | 'premium' }

const SHADOW = { type: 'outer', color: '7A7A7A', blur: 8, offset: 3, angle: 90, opacity: 0.16 };
const NO_FILL = { type: 'none' };

// Faint geometric depth shapes — added first so content sits on top.
function decor(s: PSlide, t: Theme) {
  s.addShape('ellipse', { x: W - 2.5, y: -1.5, w: 3.6, h: 3.6, fill: FILL(t.accent, 93) });
  s.addShape('ellipse', { x: W - 1.7, y: -0.8, w: 2.0, h: 2.0, fill: NO_FILL, line: { color: t.accent, width: 1, transparency: 80 } });
  s.addShape('roundRect', { x: -0.7, y: H - 1.2, w: 2.4, h: 2.4, rectRadius: 0.25, fill: FILL(t.accent2, 95) });
}

function heading(s: PSlide, t: Theme, text: string, lead?: string) {
  s.addShape('roundRect', { x: 0.85, y: 0.6, w: 0.14, h: 0.74, rectRadius: 0.07, fill: FILL(t.accent) });
  s.addText(text || '', {
    x: 1.14, y: 0.5, w: 11.3, h: 0.95, fontFace: FONT,
    fontSize: 30, bold: true, color: t.ink, valign: 'middle',
  });
  const dividerY = lead ? 2.05 : 1.6;
  if (lead) {
    s.addText(lead, {
      x: 1.16, y: 1.5, w: 11.3, h: 0.5, fontFace: FONT,
      fontSize: 14, color: t.muted,
    });
  }
  s.addShape('rect', { x: 1.16, y: dividerY, w: 11.32, h: 0.018, fill: FILL(t.muted, 72) });
}

function footerTitle(s: PSlide, ctx: Ctx) {
  s.addShape('ellipse', { x: 0.85, y: H - 0.4, w: 0.12, h: 0.12, fill: FILL(ctx.t.accent) });
  s.addText(ctx.deck.title, {
    x: 1.05, y: H - 0.46, w: 8, h: 0.32, fontFace: FONT,
    fontSize: 9, color: ctx.t.muted,
  });
}

function card(s: PSlide, t: Theme, x: number, y: number, w: number, h: number, fill?: string) {
  s.addShape('roundRect', {
    x, y, w, h, rectRadius: 0.09, fill: FILL(fill ?? 'FFFFFF'),
    line: { color: t.muted, width: 0.5, transparency: 82 }, shadow: SHADOW,
  });
}

function numChip(s: PSlide, x: number, y: number, d: number, n: number | string, color: string) {
  s.addShape('roundRect', { x, y, w: d, h: d, rectRadius: 0.16, fill: FILL(color) });
  s.addText(String(n), {
    x, y, w: d, h: d, fontFace: FONT,
    fontSize: 17, bold: true, color: 'FFFFFF', align: 'center', valign: 'middle',
  });
}

// Bullet items rendered as Gamma-style stacked cards with number chips.
function itemCards(s: PSlide, t: Theme, items: string[], top: number, accent: string) {
  if (items.length === 0) return;
  const bottom = H - 0.65;
  const gap = 0.16;
  const n = items.length;
  const rowH = Math.min(1.1, (bottom - top - gap * (n - 1)) / n);
  items.forEach((it, i) => {
    const y = top + i * (rowH + gap);
    card(s, t, 0.85, y, 11.63, rowH, t.panel);
    const cd = Math.min(0.5, rowH - 0.18);
    numChip(s, 1.05, y + (rowH - cd) / 2, cd, i + 1, accent);
    s.addText(it, {
      x: 1.05 + cd + 0.25, y, w: 11.63 - (cd + 0.55) - 0.3, h: rowH,
      fontFace: FONT, fontSize: 15, color: t.ink, valign: 'middle',
    });
  });
}

// ---- per-type renderers ---------------------------------------------

function renderCover(d: DeckSlide, s: PSlide, c: Ctx) {
  const { t, deck } = c;
  const premium = c.quality === 'premium';
  s.addShape('ellipse', { x: 9.0, y: 3.6, w: 5.2, h: 5.2, fill: NO_FILL, line: { color: t.onDark, width: 1, transparency: 86 } });
  s.addShape('roundRect', { x: 1.12, y: 2.05, w: 1.5, h: 0.12, rectRadius: 0.06, fill: FILL(t.accent2) });
  s.addText(d.heading || deck.title, {
    x: 1.1, y: 2.4, w: 10.8, h: 2.4, fontFace: FONT,
    fontSize: premium ? 48 : 46, bold: true, color: t.onDark, valign: 'top',
  });
  if (d.subtitle || deck.subtitle) {
    s.addText(d.subtitle || deck.subtitle || '', {
      x: 1.14, y: 4.85, w: 10.5, h: 0.9, fontFace: FONT, fontSize: 18, color: t.onDarkMuted,
    });
  }
  s.addShape('ellipse', { x: 1.14, y: H - 0.84, w: 0.16, h: 0.16, fill: FILL(t.accent2) });
  s.addText('Presented with Lily', {
    x: 1.4, y: H - 0.9, w: 6, h: 0.4, fontFace: FONT, fontSize: 11, color: t.onDarkMuted,
  });
}

function renderClosing(d: DeckSlide, s: PSlide, c: Ctx) {
  const { t } = c;
  s.addShape('ellipse', { x: W / 2 - 2.6, y: 1.4, w: 5.2, h: 5.2, fill: NO_FILL, line: { color: t.onDark, width: 1, transparency: 88 } });
  s.addShape('roundRect', { x: W / 2 - 0.7, y: 2.45, w: 1.4, h: 0.12, rectRadius: 0.06, fill: FILL(t.accent2) });
  s.addText(d.heading || 'ありがとうございました', {
    x: 1, y: 2.85, w: 11.3, h: 1.5, fontFace: FONT,
    fontSize: 40, bold: true, color: t.onDark, align: 'center',
  });
  if (d.subtitle) {
    s.addText(d.subtitle, {
      x: 1, y: 4.45, w: 11.3, h: 0.8, fontFace: FONT,
      fontSize: 18, color: t.onDarkMuted, align: 'center',
    });
  }
  s.addText('Made with Lily 🐶', {
    x: 0, y: H - 0.8, w: W, h: 0.4, fontFace: FONT,
    fontSize: 11, color: t.onDarkMuted, align: 'center',
  });
}

function renderSection(d: DeckSlide, s: PSlide, c: Ctx) {
  const { t } = c;
  s.addText(String(c.n).padStart(2, '0'), {
    x: 1, y: 1.7, w: 4, h: 1.3, fontFace: FONT,
    fontSize: 56, bold: true, color: t.accent2, valign: 'top',
  });
  s.addShape('roundRect', { x: 1.04, y: 3.05, w: 1.2, h: 0.12, rectRadius: 0.06, fill: FILL(t.accent2) });
  s.addText(d.heading || '', {
    x: 1, y: 3.3, w: 11.3, h: 1.6, fontFace: FONT,
    fontSize: 36, bold: true, color: t.onDark, valign: 'top',
  });
  if (d.subtitle) {
    s.addText(d.subtitle, {
      x: 1.02, y: 5.0, w: 11.3, h: 0.8, fontFace: FONT,
      fontSize: 16, color: t.onDarkMuted, valign: 'top',
    });
  }
}

function renderBullets(d: DeckSlide, s: PSlide, c: Ctx) {
  decor(s, c.t);
  heading(s, c.t, d.heading || '', d.lead);
  itemCards(s, c.t, d.items ?? [], d.lead ? 2.3 : 1.85, c.t.accent);
  footerTitle(s, c);
}

function renderAgenda(d: DeckSlide, s: PSlide, c: Ctx) {
  decor(s, c.t);
  heading(s, c.t, d.heading || 'アジェンダ');
  itemCards(s, c.t, d.items ?? [], 1.95, c.t.accent2);
  footerTitle(s, c);
}

function colCard(s: PSlide, t: Theme, col: Col | undefined, x: number, y: number, w: number, h: number, ac: string) {
  card(s, t, x, y, w, h);
  s.addShape('roundRect', { x, y, w, h: 0.78, rectRadius: 0.09, fill: FILL(ac) });
  s.addShape('rect', { x, y: y + 0.6, w, h: 0.18, fill: FILL(ac) });
  s.addText(col?.heading || '', {
    x: x + 0.3, y, w: w - 0.6, h: 0.78, fontFace: FONT,
    fontSize: 16, bold: true, color: 'FFFFFF', valign: 'middle',
  });
  const items = col?.items ?? [];
  s.addText(
    items.map(it => ({
      text: it,
      options: { bullet: { code: '25CF', indent: 14 }, breakLine: true, paraSpaceAfter: 9 },
    })),
    { x: x + 0.35, y: y + 1.0, w: w - 0.7, h: h - 1.2, fontFace: FONT, fontSize: 14, color: t.ink, valign: 'top', lineSpacingMultiple: 1.12 },
  );
}

function renderTwoCol(d: DeckSlide, s: PSlide, c: Ctx) {
  const { t } = c;
  decor(s, t);
  heading(s, t, d.heading || '');
  const y = 2.05, h = 4.55, w = 5.68;
  colCard(s, t, d.left, 0.85, y, w, h, t.accent);
  colCard(s, t, d.right, 0.85 + w + 0.35, y, w, h, t.accent2);
  footerTitle(s, c);
}

function renderCompare(d: DeckSlide, s: PSlide, c: Ctx) {
  const { t } = c;
  decor(s, t);
  heading(s, t, d.heading || '');
  const cols = d.cols ?? [];
  const n = Math.max(cols.length, 1);
  const gap = 0.32;
  const w = (11.63 - gap * (n - 1)) / n;
  const y = 2.05, h = 4.55;
  cols.forEach((col, i) => {
    colCard(s, t, col, 0.85 + i * (w + gap), y, w, h, i === 0 ? t.accent : t.accent2);
  });
  footerTitle(s, c);
}

function renderStats(d: DeckSlide, s: PSlide, c: Ctx) {
  const { t } = c;
  const premium = c.quality === 'premium';
  decor(s, t);
  heading(s, t, d.heading || '');
  const kpis = d.kpis ?? [];
  const n = Math.max(kpis.length, 1);
  const gap = 0.32;
  const w = (11.63 - gap * (n - 1)) / n;
  const y = 2.45, h = 3.4;
  kpis.forEach((k, i) => {
    const x = 0.85 + i * (w + gap);
    const ac = i % 2 === 0 ? t.accent : t.accent2;
    card(s, t, x, y, w, h);
    s.addShape('rect', { x, y, w, h: 0.14, fill: FILL(ac) });
    s.addShape('ellipse', { x: x + w / 2 - 0.7, y: y + 0.42, w: 1.4, h: 1.4, fill: FILL(ac, 88) });
    s.addText(k.value, {
      x, y: y + 0.6, w, h: 1.05, fontFace: FONT,
      fontSize: premium ? 40 : 38, bold: true, color: ac, align: 'center', valign: 'middle',
    });
    s.addText(k.label, {
      x: x + 0.2, y: y + 1.95, w: w - 0.4, h: 0.55, fontFace: FONT,
      fontSize: 14, bold: true, color: t.ink, align: 'center',
    });
    if (k.detail) {
      s.addText(k.detail, {
        x: x + 0.2, y: y + 2.5, w: w - 0.4, h: 0.75, fontFace: FONT,
        fontSize: 10, color: t.muted, align: 'center',
      });
    }
  });
  footerTitle(s, c);
}

function renderQuote(d: DeckSlide, s: PSlide, c: Ctx) {
  const { t } = c;
  decor(s, t);
  s.addShape('roundRect', { x: 0.85, y: 1.4, w: 11.63, h: 4.7, rectRadius: 0.1, fill: FILL(t.panel), shadow: SHADOW });
  s.addShape('roundRect', { x: 0.85, y: 1.4, w: 0.16, h: 4.7, rectRadius: 0.04, fill: FILL(t.accent) });
  s.addText('“', {
    x: 1.25, y: 1.35, w: 2, h: 1.6, fontFace: 'Georgia',
    fontSize: 110, bold: true, color: t.accent, valign: 'top',
  });
  s.addText(d.quote || d.heading || '', {
    x: 1.7, y: 2.65, w: 9.9, h: 2.3, fontFace: FONT,
    fontSize: 25, bold: true, color: t.ink, valign: 'top',
  });
  if (d.by) {
    s.addText(`—  ${d.by}`, {
      x: 1.72, y: 5.2, w: 10, h: 0.5, fontFace: FONT,
      fontSize: 14, color: t.muted,
    });
  }
  footerTitle(s, c);
}

function renderProcess(d: DeckSlide, s: PSlide, c: Ctx) {
  const { t } = c;
  decor(s, t);
  heading(s, t, d.heading || '');
  const steps = d.steps ?? [];
  const n = Math.max(steps.length, 1);
  const gap = 0.32;
  const w = (11.63 - gap * (n - 1)) / n;
  const top = 2.3, h = 4.0;
  const cd = 0.74;
  steps.forEach((st, i) => {
    const x = 0.85 + i * (w + gap);
    if (i < steps.length - 1) {
      s.addShape('rect', { x: x + w - gap * 0.1, y: top + cd / 2 - 0.025, w: gap + 0.2, h: 0.05, fill: FILL(t.accent2, 35) });
    }
    card(s, t, x, top, w, h, t.panel);
    numChip(s, x + w / 2 - cd / 2, top + 0.32, cd, i + 1, i % 2 === 0 ? t.accent : t.accent2);
    s.addText(st.heading, {
      x: x + 0.15, y: top + cd + 0.45, w: w - 0.3, h: 0.7, fontFace: FONT,
      fontSize: 15, bold: true, color: t.ink, align: 'center',
    });
    if (st.detail) {
      s.addText(st.detail, {
        x: x + 0.2, y: top + cd + 1.15, w: w - 0.4, h: h - cd - 1.3, fontFace: FONT,
        fontSize: 11, color: t.muted, align: 'center', valign: 'top',
      });
    }
  });
  footerTitle(s, c);
}

type Renderer = (d: DeckSlide, s: PSlide, c: Ctx) => void;

const RENDER: Record<SlideType, Renderer> = {
  cover: renderCover,
  closing: renderClosing,
  section: renderSection,
  bullets: renderBullets,
  agenda: renderAgenda,
  twoCol: renderTwoCol,
  compare: renderCompare,
  stats: renderStats,
  quote: renderQuote,
  process: renderProcess,
};

const DARK_TYPES = new Set<SlideType>(['cover', 'section', 'closing']);

export async function exportSlidesToPptx(deck: SlideDeck, quality: 'standard' | 'premium' = 'standard'): Promise<void> {
  const mod = await import('pptxgenjs');
  const PptxGenJS = (mod.default ?? mod) as unknown as PClass;
  const p = new PptxGenJS();
  const t = THEMES[deck.theme] ?? THEMES.business;

  p.defineLayout({ name: 'LILY', width: W, height: H });
  p.layout = 'LILY';
  if (quality === 'premium') {
    buildPremiumMasters(p, t);
  } else {
    buildMasters(p, t);
  }

  const total = deck.slides.length;
  deck.slides.forEach((d, i) => {
    const dark = DARK_TYPES.has(d.type);
    const s = p.addSlide({ masterName: dark ? DARK : BASE });
    const ctx: Ctx = { p, t, deck, n: i + 1, total, quality };
    (RENDER[d.type] ?? renderBullets)(d, s, ctx);
  });

  // Use arraybuffer → manual Blob so we control the MIME type and avoid
  // any environment-specific quirks in pptxgenjs's blob creation path.
  const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  const ab = await p.write({ outputType: 'arraybuffer' }) as unknown as ArrayBuffer;
  const blob = new Blob([ab], { type: PPTX_MIME });
  triggerDownload(blob, sanitizeFilename(`${deck.title || 'slides'}.pptx`));
}
