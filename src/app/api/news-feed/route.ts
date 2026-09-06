import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import Parser from 'rss-parser';
import { NEWS_FEEDS, type NewsArticle } from '@/lib/newsFeeds';

// Server-side RSS aggregation for the News tab. Fetching the feeds from the
// browser would run into CORS (dev.to and the BBC don't send permissive
// headers), so — same reasoning as /api/pdf-proxy and /api/define — the
// browser only ever talks to our own origin and the outbound requests run
// from Vercel's network instead of an arbitrary mobile connection.

type RssItem = {
  title?: string;
  link?: string;
  contentSnippet?: string;
  content?: string;
  'content:encoded'?: string;
  isoDate?: string;
  pubDate?: string;
  enclosure?: { url?: string };
  mediaThumbnail?: { $?: { url?: string }; url?: string };
  mediaContent?: Array<{ $?: { url?: string } }> | { $?: { url?: string } };
};

const parser: Parser<unknown, RssItem> = new Parser({
  customFields: {
    item: [
      ['media:content', 'mediaContent', { keepArray: true }],
      ['media:thumbnail', 'mediaThumbnail'],
    ],
  },
});

const CATEGORY_FALLBACK_IMAGES: Record<string, string> = {
  ai: 'https://images.unsplash.com/photo-1550751827-4bd374c3f58b?auto=format&fit=crop&q=80&w=1000',
  web: 'https://images.unsplash.com/photo-1512054502232-10a0a035d672?auto=format&fit=crop&q=80&w=1000',
  cloud: 'https://images.unsplash.com/photo-1526304640581-d334cdbbf45e?auto=format&fit=crop&q=80&w=1000',
  devops: 'https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&q=80&w=1000',
  security: 'https://images.unsplash.com/photo-1563986768609-322da13575f3?auto=format&fit=crop&q=80&w=1000',
  career: 'https://images.unsplash.com/photo-1532996122724-e3c354a0b15b?auto=format&fit=crop&q=80&w=1000',
};
// Every fallback photo above is already served in production, so reusing
// them as one shared pool (instead of adding unverified new stock-photo
// URLs this sandboxed environment has no way to fetch and confirm) is the
// safe way to add variety: articles that lack their own image spread across
// all 6 photos instead of a whole category always showing the same one.
const FALLBACK_IMAGE_POOL = Object.values(CATEGORY_FALLBACK_IMAGES);

function pickFallbackImage(category: string, seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return FALLBACK_IMAGE_POOL[Math.abs(hash) % FALLBACK_IMAGE_POOL.length]
    || CATEGORY_FALLBACK_IMAGES[category]
    || FALLBACK_IMAGE_POOL[0];
}

// Author avatars, badges, and tracking pixels embedded in the article body
// are technically "the first <img>" but aren't the article's photo — skip
// them and keep looking so real content images actually get used.
const DECORATIVE_IMAGE_PATTERN = /avatar|gravatar|badge|pixel|1x1|icon-|favicon/i;

function extractImageUrl(item: RssItem, category: string, seed: string): string {
  if (item.enclosure?.url) return item.enclosure.url;

  const mediaThumbUrl = item.mediaThumbnail?.$?.url || item.mediaThumbnail?.url;
  if (mediaThumbUrl) return mediaThumbUrl;

  const mediaContentUrl = Array.isArray(item.mediaContent)
    ? item.mediaContent.find(m => m?.$?.url)?.$?.url
    : item.mediaContent?.$?.url;
  if (mediaContentUrl) return mediaContentUrl;

  const html = item['content:encoded'] || item.content || '';
  for (const m of html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)) {
    if (!DECORATIVE_IMAGE_PATTERN.test(m[1])) return m[1];
  }

  return pickFallbackImage(category, seed);
}

// A short, deterministic id from the article link so the same story gets the
// same id across requests (needed to match it back up with a saved/bookmarked
// snapshot in IndexedDB).
function idFromLink(link: string): string {
  let hash = 0;
  for (let i = 0; i < link.length; i++) {
    hash = (hash * 31 + link.charCodeAt(i)) | 0;
  }
  return `n${(hash >>> 0).toString(36)}`;
}

// Named entities dev.to/BBC's RSS commonly uses outside the handful that
// `&#NNN;`/`&#xHH;` numeric escapes already cover.
const HTML_NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“',
  hellip: '…', mdash: '—', ndash: '–',
};

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (m, name: string) => HTML_NAMED_ENTITIES[name.toLowerCase()] ?? m);
}

// Turning tags into a single space (the old behavior) squashes a whole
// article body — headings, list items, code blocks, every paragraph — into
// one run-on wall of text with stray "&#39;"-style entities left in it. That
// reads as jumbled/garbled once it's long enough to matter, so block-level
// boundaries become paragraph breaks and entities get decoded before the
// tags are dropped.
function stripHtml(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<\/(p|div|li|h[1-6]|blockquote|pre)>/gi, '\n\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ~3.5x the old 400-char cap — enough extra English to actually be worth
// reading, without turning the reader into a full mirror of the source site.
const SNIPPET_MAX_LENGTH = 1400;

// A hard character-count cutoff (the old behavior sliced at exactly 400
// chars) stops mid-word or mid-sentence, which reads as text getting cut off
// mid-thought. Prefer ending on a sentence boundary; fall back to a word
// boundary with an ellipsis only when no sentence end is found.
function truncateAtBoundary(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  const slice = text.slice(0, maxLength);
  const lastSentenceEnd = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('! '), slice.lastIndexOf('? '), slice.lastIndexOf('.\n'));
  if (lastSentenceEnd > maxLength * 0.4) return slice.slice(0, lastSentenceEnd + 1).trim();
  const lastSpace = slice.lastIndexOf(' ');
  return `${(lastSpace > 0 ? slice.slice(0, lastSpace) : slice).trim()}…`;
}

// dev.to's topic-tag feeds (ai / react / cloud / devops / career) are a
// global platform, not an English-only one — the "ai" tag in particular
// regularly pulls in posts written in Chinese, Korean, or Japanese. Since
// this tab exists for English tech-reading practice, skip any title that's
// mostly non-Latin script rather than presenting it as English content.
// CJK Unified Ideographs (+ Ext-A, Compat) covers Chinese hanzi and Japanese
// kanji; Hangul Syllables covers Korean; Hiragana/Katakana covers the rest
// of Japanese.
const NON_LATIN_SCRIPT = /[\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF\uAC00-\uD7A3\u3040-\u30FF]/g;
function isMostlyNonLatinScript(title: string): boolean {
  const matches = title.match(NON_LATIN_SCRIPT);
  if (!matches) return false;
  return matches.length / title.length > 0.15;
}

async function fetchFeed(feed: typeof NEWS_FEEDS[number]): Promise<NewsArticle[]> {
  try {
    const res = await fetch(feed.url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LilyMemo/1.0)' },
      // Feeds refresh every so often at most — a 30 minute edge cache keeps
      // repeat visits fast without serving day-old news forever.
      next: { revalidate: 1800 },
    });
    if (!res.ok) return [];
    const xml = await res.text();
    const parsed = await parser.parseString(xml);
    // Pull more than the final cap since some items get filtered out below,
    // so a feed with a few non-English posts doesn't come up short.
    return (parsed.items ?? []).slice(0, 16).map((item): NewsArticle | null => {
      if (!item.title || !item.link) return null;
      if (isMostlyNonLatinScript(item.title)) return null;
      // content:encoded/content is the full article body when the feed
      // provides one (dev.to does); contentSnippet is only RSS's own short
      // auto-teaser. Prefer the full body first so there's actually more
      // English to read — the old code had this backwards.
      const bodyHtml = item['content:encoded'] || item.content || '';
      const snippetSource = bodyHtml ? stripHtml(bodyHtml) : (item.contentSnippet || '');
      return {
        id: idFromLink(item.link),
        category: feed.category,
        title: item.title,
        link: item.link,
        source: feed.source,
        imageUrl: extractImageUrl(item, feed.category, item.link),
        snippet: truncateAtBoundary(snippetSource, SNIPPET_MAX_LENGTH),
        pubDate: item.isoDate || item.pubDate || '',
      };
    }).filter((a): a is NewsArticle => a !== null).slice(0, 8);
  } catch {
    return [];
  }
}

export async function GET(req: NextRequest) {
  const categoryFilter = req.nextUrl.searchParams.get('category');
  const feeds = categoryFilter && categoryFilter !== 'all'
    ? NEWS_FEEDS.filter(f => f.category === categoryFilter)
    : NEWS_FEEDS;

  const results = await Promise.all(feeds.map(fetchFeed));
  const articles = results.flat().sort((a, b) => {
    const ta = a.pubDate ? Date.parse(a.pubDate) : 0;
    const tb = b.pubDate ? Date.parse(b.pubDate) : 0;
    return tb - ta;
  });

  return NextResponse.json(
    { articles },
    { headers: { 'Cache-Control': 'public, s-maxage=1800, stale-while-revalidate=3600' } },
  );
}
