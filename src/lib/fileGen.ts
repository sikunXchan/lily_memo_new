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

export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
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
      if (blob) triggerDownload(blob, sanitizeFilename(filename));
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
