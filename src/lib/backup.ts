import { db, type Folder, type Note, type SavedChat, type StudyCategory, type StudySession, type Todo, type EarnedBadge, newSyncId } from './db';

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
  // Study history is now part of the basic backup so that "バックアップをダウンロード"
  // saves it and "復元ファイルをアップロード" restores it.
  studyCategories?: StudyCategory[];
  studySessions?: StudySession[];
  timestamp: number;
  version?: number;
}

export interface SyncPayload extends BackupPayload {
  todos?: Todo[];
  earnedBadges?: EarnedBadge[];
}

export async function buildSyncJson(): Promise<string> {
  // base already carries folders/notes/savedChats + study history (see buildBackupJson).
  const base = JSON.parse(await buildBackupJson()) as BackupPayload;
  const todos = await db.todos.toArray();
  const earnedBadges = await db.earnedBadges.toArray();
  const payload: SyncPayload = { ...base, todos, earnedBadges };
  return JSON.stringify(payload);
}

export async function restoreSyncFromJson(jsonText: string): Promise<void> {
  // Restore notes/folders/savedChats (same as backup)
  await restoreBackupFromJson(jsonText);

  const data = JSON.parse(jsonText) as Partial<SyncPayload>;

  // Restore study data + todos (full replace)
  await db.transaction('rw', db.studyCategories, db.studySessions, db.todos, async () => {
    await db.studyCategories.clear();
    await db.studySessions.clear();
    await db.todos.clear();
    if (data.studyCategories?.length) {
      for (const c of data.studyCategories) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { id: _id, ...rest } = c;
        // Backfill sync fields deterministically for older backups.
        rest.syncId = rest.syncId ?? `c_${rest.name}`;
        rest.updatedAt = rest.updatedAt ?? rest.createdAt ?? Date.now();
        await db.studyCategories.add(rest as StudyCategory);
      }
    }
    if (data.studySessions?.length) {
      for (const s of data.studySessions) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { id: _id, ...rest } = s;
        rest.syncId = rest.syncId ?? `s_${rest.date}_${rest.startTime}`;
        rest.updatedAt = rest.updatedAt ?? rest.startTime ?? Date.now();
        await db.studySessions.add(rest as StudySession);
      }
    }
    if (data.todos?.length) {
      for (const t of data.todos) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { id: _id, ...rest } = t;
        await db.todos.add(rest as Todo);
      }
    }
  });

  // Earned badges: additive merge (never remove a badge already unlocked here;
  // keep the earliest earnedAt when both sides have it).
  if (data.earnedBadges?.length) {
    const existing = new Map((await db.earnedBadges.toArray()).map(b => [b.badgeId, b.earnedAt]));
    const merged: EarnedBadge[] = data.earnedBadges.map(b => ({
      badgeId: b.badgeId,
      earnedAt: Math.min(b.earnedAt, existing.get(b.badgeId) ?? b.earnedAt),
    }));
    await db.earnedBadges.bulkPut(merged);
  }
}

export async function buildBackupJson(): Promise<string> {
  const folders = await db.folders.toArray();
  const notes = await db.notes.toArray();
  const savedChats = await db.savedChats.toArray();
  const studyCategories = await db.studyCategories.toArray();
  const studySessions = await db.studySessions.toArray();

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
    studyCategories,
    studySessions,
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

  // Study history: additive MERGE by syncId. Unlike notes/folders (full replace),
  // we never clear here — so restoring a backup never wipes existing study data
  // or todos, and re-importing the same file is idempotent.
  await mergeStudyData(data.studyCategories ?? [], data.studySessions ?? [], now);
}

// Merge study categories + sessions into the DB without removing anything.
// Categories are de-duplicated by syncId (falling back to name); sessions by syncId.
// Each session's categoryId is remapped to the actual DB id of its category so
// filtering-by-category keeps working even when local ids differ.
async function mergeStudyData(
  cats: StudyCategory[],
  sess: StudySession[],
  now: number,
): Promise<void> {
  if (!cats.length && !sess.length) return;
  await db.transaction('rw', db.studyCategories, db.studySessions, async () => {
    const existingCats = await db.studyCategories.toArray();
    const idBySyncId = new Map(existingCats.filter(c => c.syncId).map(c => [c.syncId as string, c.id as number]));
    const idByName = new Map(existingCats.map(c => [c.name, c.id as number]));

    // Map an incoming category's *original* id -> the resolved DB id, so sessions
    // that reference categoryId can be re-pointed correctly.
    const resolvedIdByOldId = new Map<number, number>();
    const resolvedIdBySyncId = new Map<string, number>();
    for (const c of cats) {
      const { id: oldId, ...rest } = c;
      const syncId = rest.syncId ?? `c_${rest.name}`;
      rest.syncId = syncId;
      rest.updatedAt = rest.updatedAt ?? rest.createdAt ?? now;
      let realId = idBySyncId.get(syncId) ?? idByName.get(rest.name);
      if (realId == null) {
        realId = await db.studyCategories.add(rest as StudyCategory) as number;
        idBySyncId.set(syncId, realId);
        idByName.set(rest.name, realId);
      }
      resolvedIdBySyncId.set(syncId, realId);
      if (oldId != null) resolvedIdByOldId.set(oldId, realId);
    }

    const existingSessionSyncIds = new Set(
      (await db.studySessions.toArray()).map(s => s.syncId).filter(Boolean) as string[],
    );
    for (const s of sess) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { id: _id, ...rest } = s;
      const syncId = rest.syncId ?? `s_${rest.date}_${rest.startTime}`;
      if (existingSessionSyncIds.has(syncId)) continue; // already present — skip
      rest.syncId = syncId;
      rest.updatedAt = rest.updatedAt ?? rest.startTime ?? now;
      if (rest.categoryId != null) {
        const remapped = resolvedIdByOldId.get(rest.categoryId);
        if (remapped != null) rest.categoryId = remapped;
      }
      await db.studySessions.add(rest as StudySession);
      existingSessionSyncIds.add(syncId);
    }
  });
}
