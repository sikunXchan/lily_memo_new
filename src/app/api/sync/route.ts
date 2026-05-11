import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { serverDb, notesServer, foldersServer } from '@/lib/server-db';
import { eq, and, gt, isNull } from 'drizzle-orm';

interface PushNote {
  id: string;
  title: string;
  content: string;
  folderId?: string;
  color?: string;
  createdAt: number;
  updatedAt: number;
}

interface PushFolder {
  id: string;
  name: string;
  parentId?: string;
  color?: string;
  createdAt: number;
}

interface PushBody {
  notes: PushNote[];
  folders: PushFolder[];
  since?: number;
}

// GET /api/sync — pull user's data
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const sinceParam = url.searchParams.get('since');
  const since = sinceParam ? parseInt(sinceParam) : 0;

  const userId = session.user.id;

  const notesQuery = since > 0
    ? serverDb.select().from(notesServer)
        .where(and(eq(notesServer.userId, userId), gt(notesServer.updatedAt, since)))
    : serverDb.select().from(notesServer)
        .where(eq(notesServer.userId, userId));

  const foldersQuery = serverDb.select().from(foldersServer)
    .where(eq(foldersServer.userId, userId));

  const [notes, folders] = await Promise.all([notesQuery, foldersQuery]);

  const activeNotes = notes.filter(n => !n.deletedAt);
  const activeFolders = folders.filter(f => !f.deletedAt);
  const deletedNoteIds = notes.filter(n => !!n.deletedAt).map(n => n.id);
  const deletedFolderIds = folders.filter(f => !!f.deletedAt).map(f => f.id);

  return NextResponse.json({
    notes: activeNotes,
    folders: activeFolders,
    deletedNoteIds,
    deletedFolderIds,
  });
}

// POST /api/sync — push local data to server
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = session.user.id;
  const body: PushBody = await req.json();
  const { notes = [], folders = [] } = body;
  const now = Date.now();

  // Upsert folders
  for (const folder of folders) {
    const existing = await serverDb.select().from(foldersServer)
      .where(and(eq(foldersServer.id, folder.id), eq(foldersServer.userId, userId)))
      .get();

    if (!existing) {
      await serverDb.insert(foldersServer).values({
        id: folder.id,
        userId,
        name: folder.name,
        parentId: folder.parentId ?? null,
        color: folder.color ?? null,
        createdAt: folder.createdAt,
      });
    }
    // Folders: only insert if not present (local names take precedence)
  }

  // Upsert notes (last-write-wins by updatedAt)
  for (const note of notes) {
    const existing = await serverDb.select().from(notesServer)
      .where(and(eq(notesServer.id, note.id), eq(notesServer.userId, userId)))
      .get();

    if (!existing) {
      await serverDb.insert(notesServer).values({
        id: note.id,
        userId,
        title: note.title,
        content: note.content,
        folderId: note.folderId ?? null,
        color: note.color ?? null,
        createdAt: note.createdAt,
        updatedAt: note.updatedAt,
      });
    } else if (note.updatedAt > existing.updatedAt) {
      await serverDb.update(notesServer)
        .set({
          title: note.title,
          content: note.content,
          folderId: note.folderId ?? null,
          color: note.color ?? null,
          updatedAt: note.updatedAt,
        })
        .where(and(eq(notesServer.id, note.id), eq(notesServer.userId, userId)));
    }
  }

  // Return current server state so client can merge
  const [serverNotes, serverFolders] = await Promise.all([
    serverDb.select().from(notesServer).where(and(eq(notesServer.userId, userId), isNull(notesServer.deletedAt))),
    serverDb.select().from(foldersServer).where(and(eq(foldersServer.userId, userId), isNull(foldersServer.deletedAt))),
  ]);

  return NextResponse.json({
    notes: serverNotes,
    folders: serverFolders,
    deletedNoteIds: [],
    deletedFolderIds: [],
    syncedAt: now,
  });
}
