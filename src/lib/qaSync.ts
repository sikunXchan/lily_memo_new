// Per-question sync for the ✓ boxes of Q&A blocks inside memos.
//
// Notes sync as whole records (newest updatedAt wins), so ticking Q1 on the
// phone and Q2 on the PC used to lose one of the two ticks, and a note left
// open in an editor wrote its stale ticks back over the synced ones. Each pair
// now carries `checkedAt` (set whenever its box is toggled); whenever two
// versions of a note meet — server merge, device merge, open editor — the
// state with the newer `checkedAt` wins per question, independently of which
// version of the note won overall.
//
// Pure string/JSON code (no DOM), so it runs in the API route too. Pairs are
// matched by question text (+ occurrence number for repeated questions), so it
// survives blocks being moved or other text being edited.

export interface QaCheck { checked: boolean; checkedAt: number }

interface PairLike { q?: unknown; checked?: unknown; checkedAt?: unknown; [k: string]: unknown }

const ATTR_RE = /data-pairs="([^"]*)"/g;

function decodeAttr(s: string): string {
  return s
    .replace(/&quot;/g, '"').replace(/&#34;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function encodeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function parsePairs(attr: string): PairLike[] | null {
  try {
    const v = JSON.parse(decodeAttr(attr));
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/** Stable key for a question: its text plus how many times that text appeared before. */
export function makeQaKeyer(): (q: unknown) => string {
  const seen = new Map<string, number>();
  return (q: unknown) => {
    const text = typeof q === 'string' ? q.trim() : '';
    const n = seen.get(text) ?? 0;
    seen.set(text, n + 1);
    return `${text}\u0000${n}`;
  };
}

/** The ✓ state of every Q&A question in a note's HTML. */
export function collectQaChecks(html: string | undefined | null): Map<string, QaCheck> {
  const out = new Map<string, QaCheck>();
  if (!html || !html.includes('data-pairs')) return out;
  const key = makeQaKeyer();
  for (const m of html.matchAll(ATTR_RE)) {
    for (const p of parsePairs(m[1]) ?? []) {
      if (!p || typeof p !== 'object') continue;
      out.set(key(p.q), { checked: !!p.checked, checkedAt: Number(p.checkedAt) || 0 });
    }
  }
  return out;
}

/** True if `other` should override `mine` for one question. */
export function isNewerCheck(other: QaCheck | undefined, mine: { checked?: unknown; checkedAt?: unknown }): other is QaCheck {
  return !!other && other.checkedAt > (Number(mine.checkedAt) || 0) && other.checked !== !!mine.checked;
}

/**
 * `winnerHtml` with each question's ✓ replaced by the one from `otherHtml`
 * wherever that one was toggled more recently. Returns `winnerHtml` itself
 * (same string) when nothing changes.
 */
export function overlayQaChecks(winnerHtml: string, otherHtml: string | undefined | null): string {
  if (!winnerHtml || !otherHtml || !winnerHtml.includes('data-pairs') || !otherHtml.includes('data-pairs')) return winnerHtml;
  const other = collectQaChecks(otherHtml);
  if (other.size === 0) return winnerHtml;
  const key = makeQaKeyer();
  let changed = false;
  const result = winnerHtml.replace(ATTR_RE, (whole, attr: string) => {
    const pairs = parsePairs(attr);
    if (!pairs) return whole;
    let blockChanged = false;
    const next = pairs.map(p => {
      if (!p || typeof p !== 'object') return p;
      const o = other.get(key(p.q));
      if (!isNewerCheck(o, p)) return p;
      blockChanged = true;
      return { ...p, checked: o.checked, checkedAt: o.checkedAt };
    });
    if (!blockChanged) return whole;
    changed = true;
    return `data-pairs="${encodeAttr(JSON.stringify(next))}"`;
  });
  return changed ? result : winnerHtml;
}
