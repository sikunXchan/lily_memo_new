import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { serverDb, shares, notesServer } from '@/lib/server-db';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createId } from '@paralleldrive/cuid2';

// POST /api/share — create a share link for a note
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { noteId, permission = 'view' } = await req.json();
  if (!noteId) return NextResponse.json({ error: 'noteId required' }, { status: 400 });

  const userId = session.user.id;

  // Verify the note belongs to this user
  const note = await serverDb.select().from(notesServer)
    .where(and(eq(notesServer.id, noteId), eq(notesServer.userId, userId)))
    .get();
  if (!note) return NextResponse.json({ error: 'Note not found' }, { status: 404 });

  // Check if a share already exists for this note
  const existing = await serverDb.select().from(shares)
    .where(and(eq(shares.noteId, noteId), eq(shares.ownerId, userId)))
    .get();
  if (existing) {
    return NextResponse.json({ shareCode: existing.shareCode });
  }

  const shareCode = nanoid(12);
  await serverDb.insert(shares).values({
    id: createId(),
    shareCode,
    noteId,
    ownerId: userId,
    permission,
    createdAt: Date.now(),
  });

  return NextResponse.json({ shareCode });
}

// GET /api/share — list user's shares
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userShares = await serverDb.select().from(shares)
    .where(eq(shares.ownerId, session.user.id));

  return NextResponse.json({ shares: userShares });
}
