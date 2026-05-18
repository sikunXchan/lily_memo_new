// Parses Lily's ```slides``` block and exports it as a real .pptx
// (Office Open XML) file. PPTX is just a ZIP of XML parts, so we build
// the ZIP ourselves (STORE / no compression) — no extra dependencies,
// and unlike html-to-canvas PDF it never renders blank.

import { triggerDownload } from './fileGen';

export interface Slide {
  title: string;
  bullets: string[];
  body: string[];
}

export interface SlideDeck {
  title: string;
  slides: Slide[];
}

export function parseSlides(raw: string): SlideDeck {
  const sections = raw
    .split(/^\s*---\s*$/m)
    .map(s => s.trim())
    .filter(Boolean);

  let deckTitle = 'スライド';
  const slides: Slide[] = [];

  sections.forEach((section, idx) => {
    const lines = section.split('\n').map(l => l.trim()).filter(Boolean);
    let title = '';
    const bullets: string[] = [];
    const body: string[] = [];

    for (const line of lines) {
      const h = line.match(/^#{1,6}\s+(.*)/);
      const b = line.match(/^[-*・]\s+(.*)/);
      if (h && !title) {
        title = h[1].trim();
      } else if (b) {
        bullets.push(b[1].trim());
      } else {
        body.push(line.replace(/^#{1,6}\s+/, '').trim());
      }
    }

    if (idx === 0 && bullets.length === 0 && body.length <= 1) {
      deckTitle = title || body[0] || deckTitle;
      slides.push({ title: title || deckTitle, bullets: [], body: [] });
      return;
    }
    slides.push({ title: title || `スライド ${idx + 1}`, bullets, body });
  });

  if (slides.length === 0) slides.push({ title: deckTitle, bullets: [], body: [] });
  return { title: deckTitle, slides };
}

/* ───────────── minimal ZIP (STORE) writer ───────────── */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

interface ZipEntry { name: string; data: Uint8Array; }

function zipStore(entries: ZipEntry[]): Blob {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const enc = new TextEncoder();

  const u16 = (n: number) => new Uint8Array([n & 0xff, (n >>> 8) & 0xff]);
  const u32 = (n: number) =>
    new Uint8Array([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]);
  const push = (arr: Uint8Array[], parts: Uint8Array[]) => {
    for (const p of parts) arr.push(p);
  };

  for (const e of entries) {
    const nameBytes = enc.encode(e.name);
    const crc = crc32(e.data);
    const size = e.data.length;

    const local: Uint8Array[] = [];
    push(local, [
      u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(0),
      u32(crc), u32(size), u32(size), u16(nameBytes.length), u16(0),
      nameBytes, e.data,
    ]);
    const localSize = local.reduce((s, p) => s + p.length, 0);
    for (const p of local) chunks.push(p);

    push(central, [
      u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0),
      u32(crc), u32(size), u32(size), u16(nameBytes.length),
      u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), nameBytes,
    ]);
    offset += localSize;
  }

  const cdStart = offset;
  let cdSize = 0;
  for (const p of central) { chunks.push(p); cdSize += p.length; }

  chunks.push(
    u32(0x06054b50), u16(0), u16(0),
    u16(entries.length), u16(entries.length),
    u32(cdSize), u32(cdStart), u16(0)
  );

  return new Blob(chunks as BlobPart[], {
    type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  });
}

/* ───────────── PPTX XML parts ───────────── */

function xmlEsc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const A_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const P_NS = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

const SLIDE_W = 12192000;
const SLIDE_H = 6858000;

/* ── modern design system ── */

const INK = '241F33';        // near-black text
const MUTED = '8A8499';      // muted captions / footer
const PAPER = 'FFFFFF';      // content background
const DARK1 = '1E1B2E';      // title bg gradient start
const DARK2 = '4A3A5C';      // title bg gradient end
// accent rotation gives each content slide its own rhythm
const ACCENTS = ['E26A8D', '8AB6D6', '9AD0C2', 'F6C28B', 'B79CE0'];

function clr(hex: string, alpha?: number): string {
  return alpha == null
    ? `<a:srgbClr val="${hex}"/>`
    : `<a:srgbClr val="${hex}"><a:alpha val="${alpha}"/></a:srgbClr>`;
}
const solid = (hex: string, alpha?: number) => `<a:solidFill>${clr(hex, alpha)}</a:solidFill>`;
function grad(c1: string, c2: string, ang = 2700000): string {
  return `<a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0">${clr(c1)}</a:gs><a:gs pos="100000">${clr(c2)}</a:gs></a:gsLst><a:lin ang="${ang}" scaled="0"/></a:gradFill>`;
}
const NO_LN = '<a:ln><a:noFill/></a:ln>';
const EMPTY_TX = '<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="ja-JP"/></a:p></p:txBody>';

function shape(
  id: number, name: string, geom: string,
  x: number, y: number, cx: number, cy: number,
  fill: string, txBody = EMPTY_TX, line = NO_LN
): string {
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="${geom}"><a:avLst/></a:prstGeom>${fill}${line}</p:spPr>${txBody}</p:sp>`;
}

function run(text: string, size: number, color: string, bold = false): string {
  return `<a:r><a:rPr lang="ja-JP" altLang="en-US" sz="${size}"${bold ? ' b="1"' : ''} dirty="0">${solid(color)}</a:rPr><a:t>${xmlEsc(text)}</a:t></a:r>`;
}

function para(
  text: string, size: number, color: string,
  opts: { bold?: boolean; align?: string; bulletColor?: string } = {}
): string {
  const bul = opts.bulletColor
    ? `<a:buClr>${clr(opts.bulletColor)}</a:buClr><a:buSzPct val="80000"/><a:buFont typeface="Arial"/><a:buChar char="▸"/>`
    : '<a:buNone/>';
  const marL = opts.bulletColor ? ' marL="285750" indent="-285750"' : '';
  const pPr = `<a:pPr${marL}${opts.align ? ` algn="${opts.align}"` : ''}><a:spcBef><a:spcPts val="700"/></a:spcBef><a:spcAft><a:spcPts val="300"/></a:spcAft>${bul}</a:pPr>`;
  return `<a:p>${pPr}${run(text, size, color, opts.bold)}</a:p>`;
}

function txBox(
  id: number, name: string,
  x: number, y: number, cx: number, cy: number,
  paras: string, anchor = 't'
): string {
  const tx = `<p:txBody><a:bodyPr wrap="square" anchor="${anchor}"><a:normAutofit/></a:bodyPr><a:lstStyle/>${paras}</p:txBody>`;
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>${tx}</p:sp>`;
}

function wrap(shapes: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="${A_NS}" xmlns:r="${R_NS}" xmlns:p="${P_NS}">
<p:cSld><p:spTree>
<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
${shapes}
</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>`;
}

function titleSlideXml(slide: Slide, deckTitle: string): string {
  const subtitle = slide.body[0] || slide.bullets[0] || '';
  const s: string[] = [];
  // gradient backdrop + soft geometric accents
  s.push(shape(2, 'bg', 'rect', 0, 0, SLIDE_W, SLIDE_H, grad(DARK1, DARK2, 2700000)));
  s.push(shape(3, 'glow1', 'ellipse', 8200000, -1700000, 6200000, 6200000, solid(ACCENTS[0], 16000)));
  s.push(shape(4, 'glow2', 'ellipse', -1500000, 4200000, 4400000, 4400000, solid(ACCENTS[1], 13000)));
  s.push(shape(5, 'ring', 'ellipse', 9700000, 4600000, 1900000, 1900000, '<a:noFill/>',
    EMPTY_TX, `<a:ln w="19050">${solid(ACCENTS[0], 40000)}</a:ln>`));
  // accent bar above the title
  s.push(shape(6, 'bar', 'roundRect', 1219200, 2360000, 760000, 84000, solid(ACCENTS[0])));
  // title + subtitle + tag
  s.push(txBox(7, 'title', 1219200, 2520000, 9750000, 2050000,
    para(slide.title || deckTitle, 5400, PAPER, { bold: true }), 't'));
  if (subtitle) {
    s.push(txBox(8, 'subtitle', 1219200, 4560000, 9750000, 760000,
      para(subtitle, 2000, 'D9CFE6'), 't'));
  }
  s.push(txBox(9, 'tag', 1219200, 6020000, 6000000, 500000,
    para('🐶  Presented with Lily', 1200, MUTED), 't'));
  return wrap(s.join(''));
}

function contentSlideXml(slide: Slide, index: number, total: number, deckTitle: string): string {
  const accent = ACCENTS[(index - 1) % ACCENTS.length];
  const num = String(index).padStart(2, '0');
  const s: string[] = [];

  s.push(shape(2, 'bg', 'rect', 0, 0, SLIDE_W, SLIDE_H, solid(PAPER)));
  // decorative corner circles (subtle, behind content)
  s.push(shape(3, 'deco1', 'ellipse', 10700000, 5250000, 2200000, 2200000, solid(accent, 10000)));
  s.push(shape(4, 'deco2', 'ellipse', 11500000, 5950000, 1300000, 1300000, solid(accent, 14000)));
  // number badge
  s.push(shape(5, 'badge', 'roundRect', 838200, 560000, 760000, 760000, solid(accent),
    `<p:txBody><a:bodyPr anchor="ctr"/><a:lstStyle/>${para(num, 2400, PAPER, { bold: true, align: 'ctr' })}</p:txBody>`));
  // title + divider
  s.push(txBox(6, 'title', 1740000, 560000, 9600000, 800000,
    para(slide.title, 3000, INK, { bold: true }), 'ctr'));
  s.push(shape(7, 'divider', 'roundRect', 845000, 1500000, 2300000, 50000, solid(accent)));
  s.push(shape(8, 'divider2', 'rect', 3145000, 1512000, 8200000, 26000, solid('ECE8F0')));

  // body
  const paras = [
    ...slide.bullets.map(b => para(b, 2000, INK, { bulletColor: accent })),
    ...slide.body.map(p => para(p, 1800, '5A5468')),
  ].join('') || para(' ', 1800, INK);
  s.push(txBox(9, 'body', 845000, 1820000, 10500000, 4150000, paras, 't'));

  // footer
  s.push(shape(10, 'footdot', 'ellipse', 845000, 6420000, 90000, 90000, solid(accent)));
  s.push(txBox(11, 'footL', 1000000, 6330000, 7000000, 360000,
    para(deckTitle, 1000, MUTED), 't'));
  s.push(txBox(12, 'footR', 9500000, 6330000, 1850000, 360000,
    para(`${index} / ${total}`, 1000, MUTED, { align: 'r' }), 't'));
  return wrap(s.join(''));
}

function slideXml(
  slide: Slide,
  o: { isTitle: boolean; number: number; total: number; deckTitle: string }
): string {
  return o.isTitle
    ? titleSlideXml(slide, o.deckTitle)
    : contentSlideXml(slide, o.number, o.total, o.deckTitle);
}

const THEME_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="${A_NS}" name="Lily">
<a:themeElements>
<a:clrScheme name="Lily">
<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>
<a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
<a:dk2><a:srgbClr val="2B2B3A"/></a:dk2>
<a:lt2><a:srgbClr val="FDF2F6"/></a:lt2>
<a:accent1><a:srgbClr val="E26A8D"/></a:accent1>
<a:accent2><a:srgbClr val="F2A6C2"/></a:accent2>
<a:accent3><a:srgbClr val="C98AA3"/></a:accent3>
<a:accent4><a:srgbClr val="8AB6D6"/></a:accent4>
<a:accent5><a:srgbClr val="9AD0C2"/></a:accent5>
<a:accent6><a:srgbClr val="F6C28B"/></a:accent6>
<a:hlink><a:srgbClr val="0563C1"/></a:hlink>
<a:folHlink><a:srgbClr val="954F72"/></a:folHlink>
</a:clrScheme>
<a:fontScheme name="Lily">
<a:majorFont><a:latin typeface="Segoe UI Semibold"/><a:ea typeface="Yu Gothic UI"/><a:cs typeface=""/></a:majorFont>
<a:minorFont><a:latin typeface="Segoe UI"/><a:ea typeface="Yu Gothic UI"/><a:cs typeface=""/></a:minorFont>
</a:fontScheme>
<a:fmtScheme name="Lily">
<a:fillStyleLst>
<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
</a:fillStyleLst>
<a:lnStyleLst>
<a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>
<a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>
<a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>
</a:lnStyleLst>
<a:effectStyleLst>
<a:effectStyle><a:effectLst/></a:effectStyle>
<a:effectStyle><a:effectLst/></a:effectStyle>
<a:effectStyle><a:effectLst/></a:effectStyle>
</a:effectStyleLst>
<a:bgFillStyleLst>
<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
</a:bgFillStyleLst>
</a:fmtScheme>
</a:themeElements>
</a:theme>`;

const SLIDE_LAYOUT_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="${A_NS}" xmlns:r="${R_NS}" xmlns:p="${P_NS}" type="blank" preserve="1">
<p:cSld name="Blank"><p:spTree>
<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sldLayout>`;

const SLIDE_MASTER_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="${A_NS}" xmlns:r="${R_NS}" xmlns:p="${P_NS}">
<p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>
<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
</p:spTree></p:cSld>
<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>
<p:txStyles>
<p:titleStyle><a:lvl1pPr><a:defRPr sz="4400"/></a:lvl1pPr></p:titleStyle>
<p:bodyStyle><a:lvl1pPr><a:defRPr sz="2000"/></a:lvl1pPr></p:bodyStyle>
<p:otherStyle/>
</p:txStyles>
</p:sldMaster>`;

export async function exportSlidesToPptx(deck: SlideDeck): Promise<void> {
  const enc = new TextEncoder();
  const files: ZipEntry[] = [];
  const add = (name: string, content: string) =>
    files.push({ name, data: enc.encode(content) });

  const n = deck.slides.length;
  const slideOverrides = deck.slides
    .map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`)
    .join('');

  add('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
${slideOverrides}
</Types>`);

  add('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${REL_NS}">
<Relationship Id="rId1" Type="${R_NS}/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`);

  const sldIds = deck.slides
    .map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`)
    .join('');
  add('ppt/presentation.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="${A_NS}" xmlns:r="${R_NS}" xmlns:p="${P_NS}">
<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
<p:sldIdLst>${sldIds}</p:sldIdLst>
<p:sldSz cx="${SLIDE_W}" cy="${SLIDE_H}"/>
<p:notesSz cx="6858000" cy="9144000"/>
</p:presentation>`);

  const presRels = [
    `<Relationship Id="rId1" Type="${R_NS}/slideMaster" Target="slideMasters/slideMaster1.xml"/>`,
    ...deck.slides.map((_, i) =>
      `<Relationship Id="rId${i + 2}" Type="${R_NS}/slide" Target="slides/slide${i + 1}.xml"/>`),
    `<Relationship Id="rId${n + 2}" Type="${R_NS}/theme" Target="theme/theme1.xml"/>`,
  ].join('');
  add('ppt/_rels/presentation.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${REL_NS}">${presRels}</Relationships>`);

  add('ppt/theme/theme1.xml', THEME_XML);

  add('ppt/slideMasters/slideMaster1.xml', SLIDE_MASTER_XML);
  add('ppt/slideMasters/_rels/slideMaster1.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${REL_NS}">
<Relationship Id="rId1" Type="${R_NS}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
<Relationship Id="rId2" Type="${R_NS}/theme" Target="../theme/theme1.xml"/>
</Relationships>`);

  add('ppt/slideLayouts/slideLayout1.xml', SLIDE_LAYOUT_XML);
  add('ppt/slideLayouts/_rels/slideLayout1.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${REL_NS}">
<Relationship Id="rId1" Type="${R_NS}/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>`);

  const titleCount = deck.slides[0] &&
    deck.slides[0].bullets.length === 0 && deck.slides[0].body.length <= 1 ? 1 : 0;
  const contentTotal = deck.slides.length - titleCount;
  deck.slides.forEach((slide, i) => {
    const isTitle = i === 0 && titleCount === 1;
    add(`ppt/slides/slide${i + 1}.xml`, slideXml(slide, {
      isTitle,
      number: i + 1 - titleCount,
      total: contentTotal,
      deckTitle: deck.title,
    }));
    add(`ppt/slides/_rels/slide${i + 1}.xml.rels`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${REL_NS}">
<Relationship Id="rId1" Type="${R_NS}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
</Relationships>`);
  });

  const blob = zipStore(files);
  const safe = (deck.title || 'lily-slides').replace(/[\\/:*?"<>|]+/g, '_');
  triggerDownload(blob, `${safe}.pptx`);
}
