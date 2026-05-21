// Lets Lily emit an arbitrary downloadable file (any text-based
// extension) from the conversation context, plus helpers to save
// chart/diagram previews as images.

const EXT_MIME: Record<string, string> = {
  txt: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  json: 'application/json',
  html: 'text/html',
  htm: 'text/html',
  xml: 'application/xml',
  yaml: 'text/yaml',
  yml: 'text/yaml',
  js: 'text/javascript',
  ts: 'text/typescript',
  jsx: 'text/javascript',
  tsx: 'text/typescript',
  py: 'text/x-python',
  java: 'text/x-java',
  c: 'text/x-c',
  cpp: 'text/x-c',
  cs: 'text/x-csharp',
  go: 'text/x-go',
  rb: 'text/x-ruby',
  rs: 'text/x-rust',
  php: 'text/x-php',
  sh: 'text/x-shellscript',
  sql: 'text/x-sql',
  ini: 'text/plain',
  toml: 'text/plain',
  env: 'text/plain',
  svg: 'image/svg+xml',
  vtt: 'text/vtt',
  srt: 'text/plain',
  ics: 'text/calendar',
  tex: 'text/x-tex',
};

export function mimeForFilename(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return EXT_MIME[ext] ?? 'application/octet-stream';
}

export function sanitizeFilename(name: string): string {
  const cleaned = name.trim().replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_');
  return cleaned || 'lily-file.txt';
}

function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua)
    || (navigator.platform === 'MacIntel' && (navigator.maxTouchPoints ?? 0) > 1);
}

// iOS Safari ignores <a download> and opens the blob in a new tab. Use the
// Web Share API to surface the system save sheet on iOS, fall back to the
// anchor trick everywhere else.
export function triggerDownload(blob: Blob, filename: string): void {
  if (isIOS() && typeof navigator !== 'undefined' && 'canShare' in navigator) {
    try {
      const file = new File([blob], filename, { type: blob.type });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const n = navigator as any;
      if (n.canShare?.({ files: [file] })) {
        n.share({ files: [file], title: filename }).catch(() => {});
        return;
      }
    } catch {
      // fall through
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadTextFile(content: string, filename: string): void {
  const safe = sanitizeFilename(filename);
  const blob = new Blob([content], { type: `${mimeForFilename(safe)};charset=utf-8` });
  triggerDownload(blob, safe);
}

export function downloadSvg(svg: string, filename: string): void {
  triggerDownload(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), sanitizeFilename(filename));
}

// Rasterize an SVG string to a PNG and download it.
export function downloadSvgAsPng(svg: string, filename: string, scale = 2): void {
  const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);
  const img = new Image();
  img.onload = () => {
    const w = img.naturalWidth || img.width || 800;
    const h = img.naturalHeight || img.height || 600;
    const canvas = document.createElement('canvas');
    canvas.width = w * scale;
    canvas.height = h * scale;
    const ctx = canvas.getContext('2d');
    if (!ctx) { URL.revokeObjectURL(url); return; }
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    canvas.toBlob(blob => {
      if (blob) {
        triggerDownload(blob, sanitizeFilename(filename));
        return;
      }
      // iOS Safari sometimes returns null from toBlob — fall back to dataURL
      try {
        const dataUrl = canvas.toDataURL('image/png');
        const bin = atob(dataUrl.split(',')[1]);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        triggerDownload(new Blob([bytes], { type: 'image/png' }), sanitizeFilename(filename));
      } catch { /* give up */ }
    }, 'image/png');
  };
  img.onerror = () => URL.revokeObjectURL(url);
  img.src = url;
}

export function downloadCanvasAsPng(canvas: HTMLCanvasElement, filename: string): void {
  canvas.toBlob(blob => {
    if (blob) triggerDownload(blob, sanitizeFilename(filename));
  }, 'image/png');
}
