import { db, type Note } from './db';

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
  timestamp: number;
  version?: number;
}

export async function buildBackupJson(): Promise<string> {
  const folders = await db.folders.toArray();
  const notes = await db.notes.toArray();

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
    timestamp: Date.now(),
    version: 1,
  };
  return JSON.stringify(data);
}

export async function restoreBackupFromJson(jsonText: string): Promise<void> {
  const data = JSON.parse(jsonText) as Partial<BackupPayload>;
  const imageMap: Record<string, string> = data.images ?? {};
  const notes: Note[] = (data.notes ?? []).map(note => {
    if (!note.content || note.type === 'handwriting') return note;
    return { ...note, content: restoreImages(note.content, imageMap) };
  });

  await db.transaction('rw', db.folders, db.notes, async () => {
    await db.folders.clear();
    await db.notes.clear();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (data.folders?.length) await db.folders.bulkPut(data.folders as any);
    if (notes.length) await db.notes.bulkPut(notes);
  });
}
