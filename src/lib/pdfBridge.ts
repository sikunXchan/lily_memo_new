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

type PageProvider = () => PdfSnapshot | null;
type AllProvider = (maxPages: number) => Promise<PdfAllPages | null>;

let pageProvider: PageProvider | null = null;
let allProvider: AllProvider | null = null;

export function registerPdfProvider(page: PageProvider | null, all: AllProvider | null = null): void {
  pageProvider = page;
  allProvider = all;
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
