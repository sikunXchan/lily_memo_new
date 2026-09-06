import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Server-side dictionary + translation lookup for the News tab's tap-a-word
// feature. The browser only ever talks to our own origin (no CORS, and the
// unofficial translation endpoint below doesn't reliably send CORS headers
// to arbitrary origins anyway) — same reasoning as /api/pdf-proxy.
const DICTIONARY_TIMEOUT_MS = 9000;

interface FetchOutcome {
  ok: boolean;
  status: number | null;
  text?: string;
  error?: string;
}

async function timedFetch(url: string, ms: number): Promise<FetchOutcome> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ms);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const text = await response.text().catch(() => '');
    return { ok: response.ok, status: response.status, text };
  } catch (e) {
    return { ok: false, status: null, error: String(e) };
  } finally {
    clearTimeout(timeoutId);
  }
}

function safeParse(text: string | undefined): unknown {
  try { return JSON.parse(text || 'null'); } catch { return null; }
}

interface DictEntry {
  word?: string;
  phonetic?: string;
  phonetics?: { text?: string }[];
  meanings?: { partOfSpeech?: string; definitions?: { definition?: string; example?: string }[] }[];
}

export async function GET(req: NextRequest) {
  const word = (req.nextUrl.searchParams.get('word') || '').trim().toLowerCase();

  if (!word || !/^[a-z0-9-]+$/.test(word)) {
    return NextResponse.json({ found: false, error: 'invalid word' }, { status: 400 });
  }

  try {
    const [dictOutcome, transOutcome] = await Promise.all([
      timedFetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`, DICTIONARY_TIMEOUT_MS),
      timedFetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(word)}&langpair=en|ja`, DICTIONARY_TIMEOUT_MS),
    ]);

    let dictItem: DictEntry | null = null;
    if (dictOutcome.ok) {
      const data = safeParse(dictOutcome.text);
      dictItem = Array.isArray(data) && data.length > 0 ? (data[0] as DictEntry) : null;
    }

    let jaMeaning = '';
    if (transOutcome.ok) {
      const data = safeParse(transOutcome.text) as { responseData?: { translatedText?: string } } | null;
      // MyMemory sometimes wraps parts of the translation in word-alignment
      // markup like <g id="1">...</g> — strip that down to plain text.
      const raw = (data?.responseData?.translatedText || '').replace(/<\/?g[^>]*>/gi, '');
      const translated = raw.trim();
      // MyMemory echoes the source text back (or an error string) when it
      // has no real translation instead of failing the request outright.
      if (
        translated &&
        translated.toLowerCase() !== word.toLowerCase() &&
        !/invalid|no translation|could not|mymemory warning/i.test(translated)
      ) {
        jaMeaning = translated;
      }
    }

    const phonetic = dictItem?.phonetic || dictItem?.phonetics?.find(p => p.text)?.text || '';
    const firstMeaning = dictItem?.meanings?.[0];
    const partOfSpeech = firstMeaning?.partOfSpeech || 'word';
    const enDef = firstMeaning?.definitions?.[0]?.definition || '';
    const example = firstMeaning?.definitions?.[0]?.example || '';

    if (!jaMeaning && enDef) {
      jaMeaning = `[英英] ${enDef}`;
    }

    if (!jaMeaning) {
      return NextResponse.json({ found: false });
    }

    return NextResponse.json(
      {
        found: true,
        word: dictItem?.word || word,
        phonetic,
        partOfSpeech,
        meaning: jaMeaning,
        techContext: `一般・技術英単語: "${word}"。音声アイコンで発音を確認できます。`,
        example: example || `技術文書やニュースでの一般的な用例: "${word}"`,
      },
      { headers: { 'Cache-Control': 's-maxage=86400, stale-while-revalidate' } },
    );
  } catch (e) {
    return NextResponse.json({ found: false, error: 'timeout', message: String(e) }, { status: 504 });
  }
}
