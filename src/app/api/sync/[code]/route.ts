import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// In-memory store: code → { data, ts }
// Works reliably for quick same-Wi-Fi sync (warm Vercel instance).
const store = new Map<string, { data: string; ts: number }>();

const TTL_MS   = 5 * 60 * 1000; // 5 minutes
const MAX_SIZE = 10 * 1024 * 1024; // 10 MB

function cleanExpired() {
  const now = Date.now();
  for (const [k, v] of store) {
    if (now - v.ts > TTL_MS) store.delete(k);
  }
}

function sanitizeCode(code: string): string {
  return code.replace(/[^a-zA-Z0-9]/g, '').slice(0, 16).toUpperCase();
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code: rawCode } = await params;
  const code = sanitizeCode(rawCode);
  if (!code) return NextResponse.json({ error: 'invalid code' }, { status: 400 });

  const body = await req.text();
  if (body.length > MAX_SIZE) return NextResponse.json({ error: 'payload too large' }, { status: 413 });

  cleanExpired();
  store.set(code, { data: body, ts: Date.now() });
  return NextResponse.json({ ok: true });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code: rawCode } = await params;
  const code = sanitizeCode(rawCode);
  cleanExpired();

  const entry = store.get(code);
  if (!entry) return NextResponse.json({ error: 'not found' }, { status: 404 });

  return new NextResponse(entry.data, {
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code: rawCode } = await params;
  store.delete(sanitizeCode(rawCode));
  return NextResponse.json({ ok: true });
}
