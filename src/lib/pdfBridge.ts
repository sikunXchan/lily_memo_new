// Lightweight bridge so the floating sikun can read the PDF the user is
// looking at. PDFViewer registers getters while a PDF is open; sikun reads
// them on demand (only when an action explicitly needs the page/document),
// never on every message — to keep token usage down.

export interface PdfSnapshot {
  imageBase64: string; // JPEG base64 (no data: prefix)
  page: number;
  total: number;
}

export interface PdfAllPages {
  images: string[]; // JPEG base64 per page (no data: prefix)
  total: number;
  truncated: boolean;
}

// Annotation written by Sikun AI onto the current PDF page.
// All coordinates are normalized 0..1 (x=right, y=down, origin=top-left).
export interface SikunAnnotation {
  type: 'highlight' | 'underline' | 'text' | 'arrow';
  x0: number; y0: number;   // top-left (highlight/underline: start of region)
  x1?: number; y1?: number; // bottom-right for highlight; endpoint for arrow
  text?: string;             // label text for 'text' type
  color?: string;            // optional override; defaults to indigo
}

type PageProvider = () => PdfSnapshot | null;
type AllProvider = (maxPages: number) => Promise<PdfAllPages | null>;
type AnnotatorFn = (anns: SikunAnnotation[], page: number) => void;

let pageProvider: PageProvider | null = null;
let allProvider: AllProvider | null = null;
let annotatorFn: AnnotatorFn | null = null;

export function registerPdfProvider(page: PageProvider | null, all: AllProvider | null = null): void {
  pageProvider = page;
  allProvider = all;
}

export function registerPdfAnnotator(fn: AnnotatorFn | null): void {
  annotatorFn = fn;
}

export function addPdfAnnotation(anns: SikunAnnotation[], page: number): boolean {
  if (!annotatorFn) return false;
  try { annotatorFn(anns, page); return true; } catch { return false; }
}

export function getPdfSnapshot(): PdfSnapshot | null {
  try {
    return pageProvider ? pageProvider() : null;
  } catch {
    return null;
  }
}

export async function getPdfAllPages(maxPages = 15): Promise<PdfAllPages | null> {
  try {
    return allProvider ? await allProvider(maxPages) : null;
  } catch {
    return null;
  }
}

export function hasPdfOpen(): boolean {
  return pageProvider !== null;
}
