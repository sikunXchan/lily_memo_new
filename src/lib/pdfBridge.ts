// Lightweight bridge so the floating sikun can read the PDF page the user
// is currently looking at. PDFViewer registers a getter while a PDF is open;
// sikun reads it on demand (when sending a message or running a radial action).

export interface PdfSnapshot {
  imageBase64: string; // JPEG base64 (no data: prefix)
  page: number;
  total: number;
}

type Provider = () => PdfSnapshot | null;

let provider: Provider | null = null;

export function registerPdfProvider(p: Provider | null): void {
  provider = p;
}

export function getPdfSnapshot(): PdfSnapshot | null {
  try {
    return provider ? provider() : null;
  } catch {
    return null;
  }
}
