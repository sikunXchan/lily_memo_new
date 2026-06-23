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

// Compare-and-set: write the merged snapshot only if the stored ts hasn't
// changed since we read it. Two devices pushing at the same time used to race
// the read-modify-write: the second write silently discarded every record the
// first device had just contributed. With CAS the loser retries the merge on
// top of the winner's data instead.
const CAS_SCRIPT = `
local cur = getRedis().call('GET', KEYS[2])
if (cur or '') ~= ARGV[2] then return 0 end
getRedis().call('SET', KEYS[1], ARGV[1], 'EX', tonumber(ARGV[3]))
getRedis().call('SET', KEYS[2], ARGV[4], 'EX', tonumber(ARGV[3]))
return 1
`;

// POST /api/sync/live — push snapshot from a device.
// The incoming snapshot is MERGED into the stored one (per-record
// last-write-wins) rather than overwriting it, so concurrent creations and
// deletions from another device are never lost.
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

  const MAX_ATTEMPTS = 3;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    // Read the stored snapshot (and its version stamp) and merge into it.
    let base: SyncSnapshot = {};
    let curTs: number | null = null;
    try {
      const [raw, storedTs] = await Promise.all([
        getRedis().get<string>(dataKey),
        getRedis().get<number>(tsKey),
      ]);
      if (raw) base = (typeof raw === 'string' ? JSON.parse(raw) : raw) as SyncSnapshot;
      curTs = storedTs ?? null;
    } catch { /* corrupt or missing — start from incoming only */ }

    const merged = mergeSnapshots(base, incoming);
    const ts = Date.now();
    const payload = JSON.stringify({ ...merged, ts });

    const ok = await getRedis().eval(
      CAS_SCRIPT,
      [dataKey, tsKey],
      [payload, curTs == null ? '' : String(curTs), String(TTL_S), String(ts)],
    );
    if (ok === 1) return NextResponse.json({ ok: true, ts });
    // Someone else wrote between our read and write — re-read and re-merge.
  }
  return NextResponse.json({ error: 'conflict' }, { status: 409 });
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
