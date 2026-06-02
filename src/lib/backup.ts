import { db, type Folder, type Note, type SavedChat, type StudyCategory, type StudySession, newSyncId } from './db';

function extractImages(content: string): { content: string; images: Record<string, string> } {
  const images: Record<string, string> = {};
  const urlToId = new Map<string, string>();
  let counter = 0;
  const result = content.replace(/((?:data-src|src))="(data:[^"]+)"/g, (_, attr, dataUrl) => {
    let id = urlToId.get(dataUrl);
    if (!id) {
      id = `img_${counter++}`;
      images[id] = dataUrl;
      urlToId.set(dataUrl, id);
    }
    return `${attr}="asset://${id}"`;
  });
  return { content: result, images };
}

function restoreImages(content: string, imageMap: Record<string, string>): string {
  return content.replace(/((?:data-src|src))="asset:\/\/([^"]+)"/g, (_, attr, id) => {
    return `${attr}="${imageMap[id] ?? ''}"`;
  });
}

export interface BackupPayload {
  folders: unknown[];
  notes: Note[];
  images: Record<string, string>;
  savedChats?: SavedChat[];
  timestamp: number;
  version?: number;
}

export interface SyncPayload extends BackupPayload {
  studyCategories?: StudyCategory[];
  studySessions?: StudySession[];
}

export async function buildSyncJson(): Promise<string> {
  const base = JSON.parse(await buildBackupJson()) as BackupPayload;
  const studyCategories = await db.studyCategories.toArray();
  const studySessions = await db.studySessions.toArray();
  const payload: SyncPayload = { ...base, studyCategories, studySessions };
  return JSON.stringify(payload);
}

export async function restoreSyncFromJson(jsonText: string): Promise<void> {
  // Restore notes/folders/savedChats (same as backup)
  await restoreBackupFromJson(jsonText);

  const data = JSON.parse(jsonText) as Partial<SyncPayload>;

  // Restore study data (full replace)
  await db.transaction('rw', db.studyCategories, db.studySessions, async () => {
    await db.studyCategories.clear();
    await db.studySessions.clear();
    if (data.studyCategories?.length) {
      for (const c of data.studyCategories) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { id: _id, ...rest } = c;
        await db.studyCategories.add(rest as StudyCategory);
      }
    }
    if (data.studySessions?.length) {
      for (const s of data.studySessions) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { id: _id, ...rest } = s;
        await db.studySessions.add(rest as StudySession);
      }
    }
  });
}

export async function buildBackupJson(): Promise<string> {
  const folders = await db.folders.toArray();
  const notes = await db.notes.toArray();
  const savedChats = await db.savedChats.toArray();

  const allImages: Record<string, string> = {};
  const compactNotes = notes.map(note => {
    // Skip image extraction for non-text notes (handwriting content is pure JSON, no data URLs)
    if (!note.content || note.type === 'handwriting') return note;
    const { content, images } = extractImages(note.content);
    Object.assign(allImages, images);
    return { ...note, content };
  });

  const data: BackupPayload = {
    folders,
    notes: compactNotes,
    images: allImages,
    savedChats,
    timestamp: Date.now(),
    version: 1,
  };
  return JSON.stringify(data);
}

export async function restoreBackupFromJson(jsonText: string): Promise<void> {
  const data = JSON.parse(jsonText) as Partial<BackupPayload>;
  const imageMap: Record<string, string> = data.images ?? {};
  const now = Date.now();
  const notes: Note[] = (data.notes ?? []).map(note => {
    const content = (!note.content || note.type === 'handwriting')
      ? note.content
      : restoreImages(note.content, imageMap);
    return {
      ...note,
      content: content ?? '',
      syncId: note.syncId || newSyncId(),
      updatedAt: note.updatedAt ?? now,
    };
  });
  const folders: Folder[] = (data.folders ?? []).map(raw => {
    const f = raw as Partial<Folder>;
    return {
      ...f,
      name: f.name ?? '',
      createdAt: f.createdAt ?? now,
      updatedAt: f.updatedAt ?? f.createdAt ?? now,
      syncId: f.syncId || newSyncId(),
    } as Folder;
  });

  const savedChats: SavedChat[] = (data.savedChats ?? []).map(c => ({
    title: c.title ?? '',
    model: c.model === 'sikunlily' ? 'sikunlily' : 'lily',
    messages: c.messages ?? '[]',
    count: c.count ?? 0,
    createdAt: c.createdAt ?? now,
  }));

  await db.transaction('rw', db.folders, db.notes, db.savedChats, async () => {
    await db.folders.clear();
    await db.notes.clear();
    await db.savedChats.clear();
    if (folders.length) await db.folders.bulkPut(folders);
    if (notes.length) await db.notes.bulkPut(notes);
    if (savedChats.length) await db.savedChats.bulkPut(savedChats);
  });
}
