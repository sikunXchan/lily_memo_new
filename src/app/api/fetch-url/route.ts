import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Fetches a URL server-side and returns readable plain text. This works well
// for static / server-rendered pages (most reference sites, exam-explanation
// blogs, wikis). It does NOT execute JavaScript, so single-page apps or pages
// that render their content client-side will come back mostly empty — the
// caller surfaces that and lets the user paste the text instead.

const MAX_BYTES = 4 * 1024 * 1024; // 4 MB of HTML is plenty
const MAX_TEXT = 60000;            // cap returned text

function htmlToText(html: string): { title: string; text: string } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? decodeEntities(titleMatch[1]).trim() : '';

  let body = html;
  // Drop everything that isn't readable content.
  body = body.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  body = body.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  body = body.replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');
  body = body.replace(/<!--[\s\S]*?-->/g, ' ');
  body = body.replace(/<head[\s\S]*?<\/head>/gi, ' ');
  // Turn block boundaries into newlines so the text stays readable.
  body = body.replace(/<\/(p|div|section|article|li|h[1-6]|tr|br)>/gi, '\n');
  body = body.replace(/<br\s*\/?>/gi, '\n');
  // Strip remaining tags.
  body = body.replace(/<[^>]+>/g, ' ');
  body = decodeEntities(body);
  body = body.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return { title, text: body.slice(0, MAX_TEXT) };
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url');
  if (!url) return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 });

  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return NextResponse.json({ error: 'Invalid URL' }, { status: 400 });
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    return NextResponse.json({ error: 'http/https のURLだけ読み込めるよ' }, { status: 400 });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; LilyMemo/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      return NextResponse.json({ error: `ページの取得に失敗したよ (${res.status})` }, { status: res.status });
    }
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('html') && !ct.includes('text')) {
      return NextResponse.json({ error: 'このURLはHTMLページじゃないみたい' }, { status: 415 });
    }
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) {
      return NextResponse.json({ error: 'ページが大きすぎるよ' }, { status: 413 });
    }
    const html = new TextDecoder('utf-8').decode(buf);
    const { title, text } = htmlToText(html);
    if (text.length < 50) {
      return NextResponse.json(
        { error: 'このページは本文を取り出せなかったよ（JavaScriptで描画されるページかも）。テキストを直接貼り付けてね' },
        { status: 422 },
      );
    }
    return NextResponse.json({ title, text });
  } catch (e) {
    const msg = e instanceof Error && e.name === 'AbortError' ? 'タイムアウトしたよ' : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  } finally {
    clearTimeout(timeout);
  }
}
