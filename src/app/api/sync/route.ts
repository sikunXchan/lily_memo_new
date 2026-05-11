import { NextResponse } from 'next/server';
import { serverDb, syncSnapshots } from '@/lib/server-db';
import { eq } from 'drizzle-orm';

interface SyncData {
  notes: unknown[];
  folders: unknown[];
}

// GET /api/sync?code=xxx — pull data by sync code
export async function GET(req: Request) {
  const code = new URL(req.url).searchParams.get('code');
  if (!code) return NextResponse.json({ error: 'code required' }, { status: 400 });

  const row = await serverDb.select().from(syncSnapshots)
    .where(eq(syncSnapshots.code, code))
    .get();

  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const data: SyncData = JSON.parse(row.data);
  return NextResponse.json({ ...data, updatedAt: row.updatedAt });
}

// POST /api/sync — push data with sync code
export async function POST(req: Request) {
  const body: { code: string } & SyncData = await req.json();
  const { code, notes = [], folders = [] } = body;
  if (!code) return NextResponse.json({ error: 'code required' }, { status: 400 });

  const now = Date.now();
  const data = JSON.stringify({ notes, folders });

  const existing = await serverDb.select().from(syncSnapshots)
    .where(eq(syncSnapshots.code, code))
    .get();

  if (existing) {
    await serverDb.update(syncSnapshots)
      .set({ data, updatedAt: now })
      .where(eq(syncSnapshots.code, code));
  } else {
    await serverDb.insert(syncSnapshots).values({ code, data, updatedAt: now });
  }

  return NextResponse.json({ ok: true, updatedAt: now });
}
