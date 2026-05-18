// Turns Lily's ```slides``` block into a downloadable PDF slide deck.
// Uses html2pdf.js (already a project dependency) so no extra packages.

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
      slides.push({ title: title || deckTitle, bullets: [], body: body.length && body[0] !== title ? body : [] });
      return;
    }
    slides.push({ title: title || `スライド ${idx + 1}`, bullets, body });
  });

  if (slides.length === 0) {
    slides.push({ title: deckTitle, bullets: [], body: [] });
  }
  return { title: deckTitle, slides };
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export async function exportSlidesToPdf(deck: SlideDeck): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const html2pdf = ((await import('html2pdf.js')) as any).default;

  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.left = '-10000px';
  container.style.top = '0';

  const slidesHtml = deck.slides
    .map((s, i) => {
      const isTitle = i === 0 && s.bullets.length === 0;
      const bullets = s.bullets.length
        ? `<ul style="margin:0;padding-left:34px;font-size:30px;line-height:1.7;color:#2b2b3a;">${s.bullets
            .map(b => `<li style="margin-bottom:14px;">${esc(b)}</li>`)
            .join('')}</ul>`
        : '';
      const body = s.body.length
        ? `<div style="font-size:26px;line-height:1.7;color:#444;margin-top:18px;">${s.body
            .map(p => `<p style="margin:0 0 12px;">${esc(p)}</p>`)
            .join('')}</div>`
        : '';
      return `
      <div style="width:1280px;height:720px;box-sizing:border-box;padding:${
        isTitle ? '0' : '70px 80px'
      };display:flex;flex-direction:column;${
        isTitle ? 'align-items:center;justify-content:center;text-align:center;' : ''
      }background:linear-gradient(135deg,#fff 0%,#fdf2f6 100%);font-family:'Helvetica Neue',Arial,'Hiragino Sans','Yu Gothic',sans-serif;">
        <h1 style="font-size:${
          isTitle ? '60px' : '44px'
        };color:#e26a8d;margin:0 0 ${isTitle ? '0' : '34px'};font-weight:800;">${esc(s.title)}</h1>
        ${bullets}${body}
        ${
          isTitle
            ? ''
            : `<div style="margin-top:auto;font-size:18px;color:#c98aa3;text-align:right;">Lily ✨ ${i} / ${
                deck.slides.length - 1
              }</div>`
        }
      </div>`;
    })
    .join('');

  container.innerHTML = slidesHtml;
  document.body.appendChild(container);

  try {
    await html2pdf()
      .set({
        margin: 0,
        filename: `${deck.title || 'lily-slides'}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
        jsPDF: { unit: 'px', format: [1280, 720], orientation: 'landscape' },
        pagebreak: { mode: ['css', 'legacy'] },
      })
      .from(container)
      .save();
  } finally {
    document.body.removeChild(container);
  }
}
