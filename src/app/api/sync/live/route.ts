import { Redis } from '@upstash/redis';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { mergeSnapshots, type SyncSnapshot } from '@/lib/syncMerge';

let _redis: Redis | null = null;
function getRedis(): Redis {
  if (!_redis) _redis = Redis.fromEnv();
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
  try {
    const raw = await getRedis().get<string>(dataKey);
    if (raw) base = (typeof raw === 'string' ? JSON.parse(raw) : raw) as SyncSnapshot;
  } catch { /* corrupt or missing — start from incoming only */ }

  const merged = mergeSnapshots(base, incoming);
  const ts = Date.now();
  const payload = JSON.stringify({ ...merged, ts });

  // Write merged snapshot and timestamp.
  await Promise.all([
    getRedis().set(dataKey, payload, { ex: TTL_S }),
    getRedis().set(tsKey, ts,      { ex: TTL_S }),
  ]);

  return NextResponse.json({ ok: true, ts });
}

// GET /api/sync/live?key=...&since=... — poll for newer snapshot
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const key   = sanitizeKey(searchParams.get('key') ?? '');
  const since = Number(searchParams.get('since') ?? 0);

  if (!key) return NextResponse.json({ error: 'invalid key' }, { status: 400 });

  const ts = await getRedis().get<number>(`lily:live:${key}:ts`);
  if (!ts || ts <= since) return NextResponse.json({ changed: false });

  const raw = await getRedis().get<string>(`lily:live:${key}:data`);
  if (!raw) return NextResponse.json({ changed: false });

  const snapshot = typeof raw === 'string' ? JSON.parse(raw) : raw;
  return NextResponse.json({ changed: true, ts, snapshot });
}
