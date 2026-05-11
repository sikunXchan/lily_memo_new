import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { serverDb, shares, notesServer } from '@/lib/server-db';
import { and, eq } from 'drizzle-orm';

// GET /api/share/[code] — fetch shared note (public)
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;
  const share = await serverDb.select().from(shares)
    .where(eq(shares.shareCode, code))
    .get();
  if (!share) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (share.expiresAt && share.expiresAt < Date.now()) {
    return NextResponse.json({ error: 'Share link expired' }, { status: 410 });
  }

  const note = await serverDb.select().from(notesServer)
    .where(eq(notesServer.id, share.noteId))
    .get();
  if (!note || note.deletedAt) return NextResponse.json({ error: 'Note not found' }, { status: 404 });

  return NextResponse.json({ note, permission: share.permission });
}

// DELETE /api/share/[code] — revoke share (owner only)
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { code } = await params;
  const share = await serverDb.select().from(shares)
    .where(eq(shares.shareCode, code))
    .get();

  if (!share) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (share.ownerId !== session.user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  await serverDb.delete(shares).where(and(eq(shares.shareCode, code), eq(shares.ownerId, session.user.id)));

  return NextResponse.json({ ok: true });
}
