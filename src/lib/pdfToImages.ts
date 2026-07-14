// Renders a PDF (base64) into per-page JPEG images via pdf.js, so it can be
// attached to a Gemini request as pdfPageImages — the Gemini REST endpoints
// used here have no native "read this PDF" primitive, only text/inline_data
// parts, so pages must travel as images.
export interface PdfImagesResult {
  images: Array<{ data: string }>;
  totalPages: number;
}

export async function renderPdfAsImages(base64Data: string): Promise<PdfImagesResult> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
  const binaryStr = atob(base64Data);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
  const doc = await pdfjs.getDocument({ data: bytes }).promise;
  const totalPages = doc.numPages;
  if (totalPages === 0) throw new Error('The document has no pages.');
  const MAX_PAGES = 20;
  const images: Array<{ data: string }> = [];
  for (let p = 1; p <= Math.min(totalPages, MAX_PAGES); p++) {
    const page = await doc.getPage(p);
    const viewport = page.getViewport({ scale: 1.5 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d')!;
    await page.render({ canvasContext: ctx, viewport }).promise;
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    images.push({ data: dataUrl.split(',')[1] });
  }
  return { images, totalPages };
}
