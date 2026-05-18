// Converts a note's stored HTML into readable plain text for the AI.
// Unlike a naive tag-strip, this also surfaces the *content* of the
// special atom blocks (Mermaid / Chart / Q&A) which live in element
// attributes — so Lily can actually read diagrams, graphs and quizzes
// that already exist inside a memo.

function fallbackStrip(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function noteHtmlToText(html: string): string {
  if (!html) return '';
  if (typeof window === 'undefined' || typeof DOMParser === 'undefined') {
    return fallbackStrip(html);
  }

  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(html, 'text/html');
  } catch {
    return fallbackStrip(html);
  }

  doc.querySelectorAll('div[data-type="mermaid"]').forEach(el => {
    const code = el.getAttribute('content') || '';
    el.replaceWith(doc.createTextNode(`\n[Mermaid図]\n${code}\n`));
  });

  doc.querySelectorAll('div[data-type="chart"]').forEach(el => {
    const code = el.getAttribute('code') || '';
    const type = el.getAttribute('type') || 'グラフ';
    el.replaceWith(doc.createTextNode(`\n[グラフ (${type})]\n${code}\n`));
  });

  doc.querySelectorAll('div[data-type="qa"]').forEach(el => {
    let pairs: { q: string; a: string }[] = [];
    try {
      pairs = JSON.parse(el.getAttribute('data-pairs') || '[]');
    } catch {
      pairs = [];
    }
    const txt = pairs
      .map((p, i) => `Q${i + 1}: ${p.q}\nA${i + 1}: ${p.a}`)
      .join('\n');
    el.replaceWith(doc.createTextNode(`\n[Q&A 問題集]\n${txt}\n`));
  });

  const text = doc.body.textContent || '';
  return text
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
