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

function paragraph(text: string, opts: { size: number; bold?: boolean; bullet?: boolean; align?: string }): string {
  const pPr = `<a:pPr${opts.align ? ` algn="${opts.align}"` : ''}>${
    opts.bullet ? '<a:buChar char="•"/>' : '<a:buNone/>'
  }</a:pPr>`;
  const rPr = `<a:rPr lang="ja-JP" sz="${opts.size}"${opts.bold ? ' b="1"' : ''} dirty="0"/>`;
  return `<a:p>${pPr}<a:r>${rPr}<a:t>${xmlEsc(text)}</a:t></a:r></a:p>`;
}

function slideXml(slide: Slide, isTitle: boolean): string {
  const titleSize = isTitle ? 4400 : 3200;
  const titleBox = isTitle
    ? { x: 1524000, y: 2400000, cx: 9144000, cy: 2058000 }
    : { x: 838200, y: 457200, cx: 10515600, cy: 1143000 };

  const titleSp = `
  <p:sp>
    <p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
    <p:spPr><a:xfrm><a:off x="${titleBox.x}" y="${titleBox.y}"/><a:ext cx="${titleBox.cx}" cy="${titleBox.cy}"/></a:xfrm></p:spPr>
    <p:txBody><a:bodyPr anchor="ctr"/><a:lstStyle/>${paragraph(slide.title, {
      size: titleSize, bold: true, align: isTitle ? 'ctr' : 'l',
    })}</p:txBody>
  </p:sp>`;

  const bodyParas = [
    ...slide.bullets.map(b => paragraph(b, { size: 2000, bullet: true })),
    ...slide.body.map(p => paragraph(p, { size: 1800 })),
  ].join('');

  const bodySp = isTitle || (!slide.bullets.length && !slide.body.length)
    ? ''
    : `
  <p:sp>
    <p:nvSpPr><p:cNvPr id="3" name="Body"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>
    <p:spPr><a:xfrm><a:off x="838200" y="1828800"/><a:ext cx="10515600" cy="4525963"/></a:xfrm></p:spPr>
    <p:txBody><a:bodyPr/><a:lstStyle/>${bodyParas}</p:txBody>
  </p:sp>`;

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="${A_NS}" xmlns:r="${R_NS}" xmlns:p="${P_NS}">
<p:cSld><p:spTree>
<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
${titleSp}${bodySp}
</p:spTree></p:cSld><p:clrMapOvr><a:overrideClrMapping bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/></p:clrMapOvr>
</p:sld>`;
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
<a:majorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>
<a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont>
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

  deck.slides.forEach((slide, i) => {
    add(`ppt/slides/slide${i + 1}.xml`, slideXml(slide, i === 0 && slide.bullets.length === 0));
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
