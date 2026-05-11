import { createId } from '@paralleldrive/cuid2';
import { db } from './db';
import type { NoteServer, FolderServer } from './server-db';

export function generateServerId(): string {
  return createId();
}

export interface SyncPayload {
  notes: NoteServer[];
  folders: FolderServer[];
  deletedNoteIds: string[];
  deletedFolderIds: string[];
}

/**
 * Merges server notes and folders into local IndexedDB.
 * Server data wins when updatedAt is newer than local, or when local has no serverId.
 * Deleted IDs from server are removed from local.
 */
export async function mergeServerIntoLocal(payload: SyncPayload): Promise<void> {
  const { notes: serverNotes, folders: serverFolders, deletedNoteIds, deletedFolderIds } = payload;

  // Process server notes
  for (const sn of serverNotes) {
    if (!sn.userId) continue;
    const localNote = await db.notes.where('serverId').equals(sn.id).first();
    if (!localNote) {
      // New note from server — insert
      await db.notes.add({
        title: sn.title,
        content: sn.content,
        color: sn.color ?? undefined,
        createdAt: sn.createdAt,
        updatedAt: sn.updatedAt,
        serverId: sn.id,
        syncedAt: Date.now(),
        // folderId resolved after folders are merged
      });
    } else if (sn.updatedAt > localNote.updatedAt) {
      // Server is newer — update local
      await db.notes.update(localNote.id!, {
        title: sn.title,
        content: sn.content,
        color: sn.color ?? undefined,
        updatedAt: sn.updatedAt,
        syncedAt: Date.now(),
      });
    }
  }

  // Process server folders
  for (const sf of serverFolders) {
    const localFolder = await db.folders.where('serverId').equals(sf.id).first();
    if (!localFolder) {
      await db.folders.add({
        name: sf.name,
        color: sf.color ?? undefined,
        createdAt: sf.createdAt,
        serverId: sf.id,
        syncedAt: Date.now(),
      });
    }
  }

  // Remove deleted notes
  if (deletedNoteIds.length > 0) {
    const toDelete = await db.notes
      .filter(n => !!n.serverId && deletedNoteIds.includes(n.serverId))
      .primaryKeys();
    await db.notes.bulkDelete(toDelete as number[]);
  }

  // Remove deleted folders
  if (deletedFolderIds.length > 0) {
    const toDelete = await db.folders
      .filter(f => !!f.serverId && deletedFolderIds.includes(f.serverId))
      .primaryKeys();
    await db.folders.bulkDelete(toDelete as number[]);
  }
}

/**
 * Collects all local notes/folders and assigns serverIds if missing.
 */
export async function collectLocalData(since?: number): Promise<{
  notes: Array<{
    id: string; localId: number; title: string; content: string;
    folderId?: string; color?: string; createdAt: number; updatedAt: number;
  }>;
  folders: Array<{
    id: string; localId: number; name: string;
    parentId?: string; color?: string; createdAt: number;
  }>;
}> {
  const allNotes = since
    ? await db.notes.filter(n => n.updatedAt > since).toArray()
    : await db.notes.toArray();
  const allFolders = await db.folders.toArray();

  // Assign serverIds to notes that don't have one
  const notesWithServerId = await Promise.all(
    allNotes.map(async (n) => {
      let sid = n.serverId;
      if (!sid) {
        sid = generateServerId();
        if (n.id) await db.notes.update(n.id, { serverId: sid });
      }
      return { ...n, serverId: sid };
    })
  );

  // Assign serverIds to folders that don't have one
  const foldersWithServerId = await Promise.all(
    allFolders.map(async (f) => {
      let sid = f.serverId;
      if (!sid) {
        sid = generateServerId();
        if (f.id) await db.folders.update(f.id, { serverId: sid });
      }
      return { ...f, serverId: sid };
    })
  );

  // Build folder lookup: localId → serverId
  const folderIdMap = new Map<number, string>(
    foldersWithServerId.map(f => [f.id!, f.serverId!])
  );

  const notes = notesWithServerId.map(n => ({
    id: n.serverId!,
    localId: n.id!,
    title: n.title,
    content: n.content,
    folderId: n.folderId ? folderIdMap.get(n.folderId) : undefined,
    color: n.color,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
  }));

  const folders = foldersWithServerId.map(f => ({
    id: f.serverId!,
    localId: f.id!,
    name: f.name,
    parentId: f.parentId ? folderIdMap.get(f.parentId) : undefined,
    color: f.color,
    createdAt: f.createdAt,
  }));

  return { notes, folders };
}
