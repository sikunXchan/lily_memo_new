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

interface Ctx { p: PInstance; t: Theme; deck: SlideDeck; n: number; total: number }

function heading(s: PSlide, t: Theme, text: string, lead?: string) {
  s.addText(text || '', {
    x: 0.85, y: 0.55, w: 11.6, h: 0.95, fontFace: FONT,
    fontSize: 28, bold: true, color: t.ink, valign: 'top',
  });
  s.addShape('roundRect', {
    x: 0.87, y: 1.52, w: 2.2, h: 0.07, rectRadius: 0.04, fill: FILL(t.accent),
  });
  if (lead) {
    s.addText(lead, {
      x: 0.87, y: 1.72, w: 11.5, h: 0.5, fontFace: FONT,
      fontSize: 14, italic: true, color: t.muted,
    });
  }
}

function footerTitle(s: PSlide, ctx: Ctx) {
  s.addText(ctx.deck.title, {
    x: 0.85, y: H - 0.46, w: 8, h: 0.32, fontFace: FONT,
    fontSize: 9, color: ctx.t.muted,
  });
}

function card(s: PSlide, t: Theme, x: number, y: number, w: number, h: number, fill?: string) {
  s.addShape('roundRect', {
    x, y, w, h, rectRadius: 0.08,
    fill: FILL(fill ?? t.panel),
  });
}

function bulletList(s: PSlide, t: Theme, items: string[], x: number, y: number, w: number, h: number, color?: string, size = 16) {
  if (items.length === 0) return;
  s.addText(
    items.map(it => ({
      text: it,
      options: { bullet: { code: '25AA', indent: 16 }, breakLine: true, paraSpaceAfter: 10 },
    })),
    { x, y, w, h, fontFace: FONT, fontSize: size, color: color ?? t.ink, valign: 'top', lineSpacingMultiple: 1.15 },
  );
}

// ---- per-type renderers ---------------------------------------------

function renderCover(d: DeckSlide, s: PSlide, c: Ctx) {
  const { t, deck } = c;
  s.addShape('roundRect', { x: 1.1, y: 2.35, w: 0.9, h: 0.1, rectRadius: 0.05, fill: FILL(t.accent) });
  s.addText(d.heading || deck.title, {
    x: 1.1, y: 2.6, w: 10.8, h: 2.0, fontFace: FONT,
    fontSize: 44, bold: true, color: t.onDark, valign: 'top',
  });
  if (d.subtitle || deck.subtitle) {
    s.addText(d.subtitle || deck.subtitle || '', {
      x: 1.12, y: 4.7, w: 10.5, h: 0.9, fontFace: FONT, fontSize: 18, color: t.onDarkMuted,
    });
  }
  s.addText('🐶  Presented with Lily', {
    x: 1.12, y: H - 0.85, w: 6, h: 0.4, fontFace: FONT, fontSize: 11, color: t.onDarkMuted,
  });
}

function renderClosing(d: DeckSlide, s: PSlide, c: Ctx) {
  const { t } = c;
  s.addText(d.heading || 'ありがとうございました', {
    x: 1, y: 2.7, w: 11.3, h: 1.6, fontFace: FONT,
    fontSize: 40, bold: true, color: t.onDark, align: 'center',
  });
  if (d.subtitle) {
    s.addText(d.subtitle, {
      x: 1, y: 4.4, w: 11.3, h: 0.8, fontFace: FONT,
      fontSize: 18, color: t.onDarkMuted, align: 'center',
    });
  }
  s.addText('🐶  Made with Lily', {
    x: 0, y: H - 0.8, w: W, h: 0.4, fontFace: FONT,
    fontSize: 11, color: t.onDarkMuted, align: 'center',
  });
}

function renderSection(d: DeckSlide, s: PSlide, c: Ctx) {
  const { t } = c;
  s.addShape('roundRect', { x: 6.07, y: 2.85, w: 1.2, h: 0.1, rectRadius: 0.05, fill: FILL(t.accent) });
  s.addText(d.heading || '', {
    x: 1, y: 3.05, w: 11.3, h: 1.5, fontFace: FONT,
    fontSize: 34, bold: true, color: t.onDark, align: 'center',
  });
  if (d.subtitle) {
    s.addText(d.subtitle, {
      x: 1, y: 4.6, w: 11.3, h: 0.7, fontFace: FONT,
      fontSize: 16, color: t.onDarkMuted, align: 'center',
    });
  }
}

function renderBullets(d: DeckSlide, s: PSlide, c: Ctx) {
  heading(s, c.t, d.heading || '', d.lead);
  bulletList(s, c.t, d.items ?? [], 0.9, d.lead ? 2.35 : 2.05, 11.5, 4.6);
  footerTitle(s, c);
}

function renderAgenda(d: DeckSlide, s: PSlide, c: Ctx) {
  const { t } = c;
  heading(s, t, d.heading || 'アジェンダ');
  const items = d.items ?? [];
  const top = 2.15;
  const rowH = Math.min(0.95, (H - 1.0 - top) / Math.max(items.length, 1));
  items.forEach((it, i) => {
    const y = top + i * rowH;
    s.addShape('ellipse', { x: 0.95, y: y + 0.04, w: 0.5, h: 0.5, fill: FILL(t.accent) });
    s.addText(String(i + 1), {
      x: 0.95, y: y + 0.04, w: 0.5, h: 0.5, fontFace: FONT,
      fontSize: 16, bold: true, color: 'FFFFFF', align: 'center', valign: 'middle',
    });
    s.addText(it, {
      x: 1.7, y, w: 10.6, h: rowH, fontFace: FONT,
      fontSize: 17, color: t.ink, valign: 'middle',
    });
  });
  footerTitle(s, c);
}

function renderTwoCol(d: DeckSlide, s: PSlide, c: Ctx) {
  const { t } = c;
  heading(s, t, d.heading || '');
  const cols: [Col | undefined, string][] = [[d.left, t.accent], [d.right, t.accent2]];
  const y = 2.05, h = 4.6, w = 5.7;
  cols.forEach(([col, ac], i) => {
    const x = 0.85 + i * (w + 0.33);
    card(s, t, x, y, w, h);
    s.addText(col?.heading || '', {
      x: x + 0.35, y: y + 0.3, w: w - 0.7, h: 0.55, fontFace: FONT,
      fontSize: 17, bold: true, color: ac,
    });
    bulletList(s, t, col?.items ?? [], x + 0.35, y + 0.95, w - 0.7, h - 1.25, t.ink, 15);
  });
  footerTitle(s, c);
}

function renderCompare(d: DeckSlide, s: PSlide, c: Ctx) {
  const { t } = c;
  heading(s, t, d.heading || '');
  const cols = d.cols ?? [];
  const n = Math.max(cols.length, 1);
  const gap = 0.3;
  const w = (11.6 - gap * (n - 1)) / n;
  const y = 2.05, h = 4.6;
  cols.forEach((col, i) => {
    const x = 0.87 + i * (w + gap);
    const ac = i === 0 ? t.accent : t.accent2;
    s.addShape('roundRect', { x, y, w, h: 0.7, rectRadius: 0.08, fill: FILL(ac) });
    s.addText(col.heading || '', {
      x, y, w, h: 0.7, fontFace: FONT, fontSize: 16, bold: true,
      color: 'FFFFFF', align: 'center', valign: 'middle',
    });
    card(s, t, x, y + 0.82, w, h - 0.82);
    bulletList(s, t, col.items, x + 0.3, y + 1.12, w - 0.6, h - 1.4, t.ink, 14);
  });
  footerTitle(s, c);
}

function renderStats(d: DeckSlide, s: PSlide, c: Ctx) {
  const { t } = c;
  heading(s, t, d.heading || '');
  const kpis = d.kpis ?? [];
  const n = Math.max(kpis.length, 1);
  const gap = 0.3;
  const w = (11.6 - gap * (n - 1)) / n;
  const y = 2.5, h = 3.0;
  kpis.forEach((k, i) => {
    const x = 0.87 + i * (w + gap);
    card(s, t, x, y, w, h);
    s.addShape('roundRect', { x: x + 0.3, y: y + 0.35, w: 0.7, h: 0.08, rectRadius: 0.04, fill: FILL(t.accent) });
    s.addText(k.value, {
      x, y: y + 0.5, w, h: 1.2, fontFace: FONT,
      fontSize: 40, bold: true, color: t.accent, align: 'center',
    });
    s.addText(k.label, {
      x: x + 0.2, y: y + 1.75, w: w - 0.4, h: 0.5, fontFace: FONT,
      fontSize: 14, bold: true, color: t.ink, align: 'center',
    });
    if (k.detail) {
      s.addText(k.detail, {
        x: x + 0.2, y: y + 2.25, w: w - 0.4, h: 0.55, fontFace: FONT,
        fontSize: 10, color: t.muted, align: 'center',
      });
    }
  });
  footerTitle(s, c);
}

function renderQuote(d: DeckSlide, s: PSlide, c: Ctx) {
  const { t } = c;
  s.addText('“', {
    x: 0.7, y: 0.3, w: 2, h: 1.8, fontFace: 'Georgia',
    fontSize: 120, bold: true, color: t.accent, valign: 'top',
  });
  s.addText(d.quote || d.heading || '', {
    x: 1.6, y: 2.2, w: 10.1, h: 3.0, fontFace: FONT,
    fontSize: 26, color: t.ink, valign: 'top',
  });
  if (d.by) {
    s.addText(`— ${d.by}`, {
      x: 1.62, y: 5.45, w: 10, h: 0.5, fontFace: FONT,
      fontSize: 14, color: t.muted,
    });
  }
  footerTitle(s, c);
}

function renderProcess(d: DeckSlide, s: PSlide, c: Ctx) {
  const { t } = c;
  heading(s, t, d.heading || '');
  const steps = d.steps ?? [];
  const n = Math.max(steps.length, 1);
  const gap = 0.3;
  const w = (11.6 - gap * (n - 1)) / n;
  const cy = 2.65;
  steps.forEach((st, i) => {
    const x = 0.87 + i * (w + gap);
    if (i < steps.length - 1) {
      s.addShape('rect', { x: x + w * 0.5, y: cy + 0.27, w: w + gap, h: 0.05, fill: FILL(t.accent2, 45) });
    }
    s.addShape('ellipse', { x: x + w * 0.5 - 0.32, y: cy, w: 0.64, h: 0.64, fill: FILL(t.accent) });
    s.addText(String(i + 1), {
      x: x + w * 0.5 - 0.32, y: cy, w: 0.64, h: 0.64, fontFace: FONT,
      fontSize: 18, bold: true, color: 'FFFFFF', align: 'center', valign: 'middle',
    });
    s.addText(st.heading, {
      x, y: cy + 0.85, w, h: 0.6, fontFace: FONT,
      fontSize: 15, bold: true, color: t.ink, align: 'center',
    });
    if (st.detail) {
      s.addText(st.detail, {
        x: x + 0.1, y: cy + 1.45, w: w - 0.2, h: 1.4, fontFace: FONT,
        fontSize: 11, color: t.muted, align: 'center',
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

export async function exportSlidesToPptx(deck: SlideDeck): Promise<void> {
  const mod = await import('pptxgenjs');
  const PptxGenJS = (mod.default ?? mod) as unknown as PClass;
  const p = new PptxGenJS();
  const t = THEMES[deck.theme] ?? THEMES.business;

  p.defineLayout({ name: 'LILY', width: W, height: H });
  p.layout = 'LILY';
  buildMasters(p, t);

  const total = deck.slides.length;
  deck.slides.forEach((d, i) => {
    const dark = DARK_TYPES.has(d.type);
    const s = p.addSlide({ masterName: dark ? DARK : BASE });
    const ctx: Ctx = { p, t, deck, n: i + 1, total };
    (RENDER[d.type] ?? renderBullets)(d, s, ctx);
  });

  // Use arraybuffer → manual Blob so we control the MIME type and avoid
  // any environment-specific quirks in pptxgenjs's blob creation path.
  const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  const ab = await p.write({ outputType: 'arraybuffer' }) as unknown as ArrayBuffer;
  const blob = new Blob([ab], { type: PPTX_MIME });
  triggerDownload(blob, sanitizeFilename(`${deck.title || 'slides'}.pptx`));
}
