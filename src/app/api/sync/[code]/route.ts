import { Redis } from '@upstash/redis';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

let _redis: Redis | null = null;
function getRedis(): Redis {
  if (!_redis) _redis = Redis.fromEnv();
  return _redis;
}

const TTL_S    = 5 * 60;           // 5 minutes
const MAX_SIZE = 10 * 1024 * 1024; // 10 MB

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

  await getRedis().set(`sync:${code}`, body, { ex: TTL_S });
  return NextResponse.json({ ok: true });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code: rawCode } = await params;
  const code = sanitizeCode(rawCode);

  const data = await getRedis().get<string>(`sync:${code}`);
  if (!data) return NextResponse.json({ error: 'not found' }, { status: 404 });

  return new NextResponse(typeof data === 'string' ? data : JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code: rawCode } = await params;
  await getRedis().del(`sync:${sanitizeCode(rawCode)}`);
  return NextResponse.json({ ok: true });
}
