// Sentence-level translation for the News tab's "文章単位で翻訳" feature —
// a sibling to newsDictionary.ts's per-word lookup, but for a whole tapped
// sentence. Goes through our own /api/news-translate route rather than
// MyMemory directly, for the same CORS/reliability reasons.

const memoryCache = new Map<string, string>();

export async function translateSentence(text: string): Promise<string | null> {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (memoryCache.has(trimmed)) return memoryCache.get(trimmed)!;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(`/api/news-translate?text=${encodeURIComponent(trimmed)}`, {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!res.ok) return null;

    const data = await res.json().catch(() => null) as { translated?: string } | null;
    if (!data?.translated) return null;

    memoryCache.set(trimmed, data.translated);
    return data.translated;
  } catch {
    clearTimeout(timeoutId);
    return null;
  }
}
