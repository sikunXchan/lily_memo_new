import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Server-side sentence/phrase translation for the News tab's "文章単位で
// 翻訳" feature. Same reasoning as /api/dictionary: the browser only talks
// to our own origin, and MyMemory doesn't reliably send CORS headers.
const TRANSLATE_TIMEOUT_MS = 9000;
// MyMemory's free tier rejects long queries outright, so a sentence gets
// clipped before being sent rather than failing the whole request.
const MAX_TEXT_LENGTH = 480;

export async function GET(req: NextRequest) {
  const text = (req.nextUrl.searchParams.get('text') || '').trim();
  if (!text) {
    return NextResponse.json({ translated: '' }, { status: 400 });
  }
  const clipped = text.slice(0, MAX_TEXT_LENGTH);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TRANSLATE_TIMEOUT_MS);
  try {
    const res = await fetch(
      `https://api.mymemory.translated.net/get?q=${encodeURIComponent(clipped)}&langpair=en|ja`,
      { signal: controller.signal },
    );
    clearTimeout(timeoutId);
    if (!res.ok) return NextResponse.json({ translated: '' }, { status: 502 });

    const data = await res.json().catch(() => null) as { responseData?: { translatedText?: string } } | null;
    // MyMemory sometimes wraps parts of the translation in word-alignment
    // markup like <g id="1">...</g> — strip that down to plain text.
    const raw = (data?.responseData?.translatedText || '').replace(/<\/?g[^>]*>/gi, '').trim();
    // MyMemory echoes the source text back (or an error string) instead of
    // failing outright when it has no real translation.
    if (
      !raw ||
      raw.toLowerCase() === clipped.toLowerCase() ||
      /invalid|no translation|could not|mymemory warning/i.test(raw)
    ) {
      return NextResponse.json({ translated: '' });
    }

    return NextResponse.json(
      { translated: raw },
      { headers: { 'Cache-Control': 's-maxage=86400, stale-while-revalidate' } },
    );
  } catch (e) {
    clearTimeout(timeoutId);
    return NextResponse.json({ translated: '', error: String(e) }, { status: 504 });
  }
}
