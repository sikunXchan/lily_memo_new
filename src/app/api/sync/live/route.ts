import { Redis } from '@upstash/redis';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { mergeSnapshots, snapshotsEqual, type SyncSnapshot } from '@/lib/syncMerge';
import { packForStore, unpackFromStore } from '@/lib/syncStore';

let _redis: Redis | null = null;
function getRedis(): Redis {
  if (!_redis) {
    // Read + trim() the env vars instead of Redis.fromEnv(): a trailing newline
    // or stray whitespace pasted into the dashboard makes fromEnv() reject the
    // URL ("invalid URL ... Received: https://...\n") at construction time and
    // silently kills ALL sync. trim() makes the client resilient to that.
    // enableAutoPipelining: false — Upstash restricts the EVAL command on most
    // plans; the default auto-pipeline mode batches commands via EVAL internally,
    // which triggers NOPERM errors even when the token itself is read/write.
    _redis = new Redis({
      url: (process.env.UPSTASH_REDIS_REST_URL ?? '').trim(),
      token: (process.env.UPSTASH_REDIS_REST_TOKEN ?? '').trim(),
      enableAutoPipelining: false,
    });
  }
  return _redis;
}
const TTL_S    = 30 * 24 * 3600; // 30 days
const MAX_SIZE = 8 * 1024 * 1024; // 8 MB

function sanitizeKey(k: string): string {
  return (k ?? '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32).toLowerCase();
}

// POST /api/sync/live — push snapshot from a device.
// The incoming snapshot is MERGED into the stored one (per-record
// last-write-wins) rather than overwriting it, so concurrent creations and
// deletions from another device are never lost.
//
// Note: we use a simple read-merge-write instead of a Lua CAS script because
// Upstash restricts EVAL on many plans. Data safety comes from the per-record
// LWW merge (largest updatedAt wins), not from atomic CAS. In the rare case
// of a true concurrent push the next poll/push cycle reconciles any gap.
export async function POST(req: NextRequest) {
  const body = await req.text();
  if (body.length > MAX_SIZE) {
    return NextResponse.json({ error: 'payload too large' }, { status: 413 });
  }

  let parsed: { key: string; snapshot: unknown };
  try { parsed = JSON.parse(body); } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const key = sanitizeKey(parsed.key ?? '');
  if (!key) return NextResponse.json({ error: 'invalid key' }, { status: 400 });

  const incoming = (parsed.snapshot ?? {}) as SyncSnapshot;
  const dataKey = `lily:live:${key}:data`;
  const tsKey   = `lily:live:${key}:ts`;

  // Read stored snapshot and merge.
  let base: SyncSnapshot = {};
  let baseTs = 0;
  try {
    const stored = unpackFromStore<SyncSnapshot & { ts?: number }>(await getRedis().get(dataKey));
    if (stored) {
      baseTs = Number(stored.ts) || 0;
      const { ts: _drop, ...rest } = stored; // eslint-disable-line @typescript-eslint/no-unused-vars
      base = rest as SyncSnapshot;
    }
  } catch { /* corrupt or missing — start from incoming only */ }

  const merged = mergeSnapshots(base, incoming);
  // Did the stored copy hold anything this device doesn't have? If not, the
  // device needn't download the snapshot it just pushed (that self-download
  // used to double the bandwidth of every sync).
  const upToDate = snapshotsEqual(merged, mergeSnapshots({}, incoming));

  // Nothing new for the server → skip the (full-size) write entirely.
  if (baseTs && snapshotsEqual(merged, mergeSnapshots({}, base))) {
    // Refresh the TTL only (no data transfer) so an active key never expires.
    await Promise.all([getRedis().expire(dataKey, TTL_S), getRedis().expire(tsKey, TTL_S)]);
    return NextResponse.json({ ok: true, ts: baseTs, upToDate });
  }

  const ts = Date.now();
  // Stored gzip-compressed (see syncStore.ts) to cut Upstash bandwidth.
  await Promise.all([
    getRedis().set(dataKey, packForStore({ ...merged, ts }), { ex: TTL_S }),
    getRedis().set(tsKey, ts,      { ex: TTL_S }),
  ]);

  return NextResponse.json({ ok: true, ts, upToDate });
}

// GET /api/sync/live?key=...&since=... — poll for newer snapshot
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const key   = sanitizeKey(searchParams.get('key') ?? '');
  const since = Number(searchParams.get('since') ?? 0);

  if (!key) return NextResponse.json({ error: 'invalid key' }, { status: 400 });

  const ts = await getRedis().get<number>(`lily:live:${key}:ts`);
  if (!ts || ts <= since) return NextResponse.json({ changed: false });

  const snapshot = unpackFromStore<SyncSnapshot>(await getRedis().get(`lily:live:${key}:data`));
  if (!snapshot) return NextResponse.json({ changed: false });

  return NextResponse.json({ changed: true, ts, snapshot });
}
