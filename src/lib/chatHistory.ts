import { db, type SavedChat } from './db';

// We accept a loosely-typed message array (the ChatMessage shape lives in
// AIChat.tsx). Only the fields we serialize are referenced here.
type ChatLike = {
  role?: string;
  text?: string;
  attachments?: Array<Record<string, unknown>>;
} & Record<string, unknown>;

// Strip the heavy parts of attachments before persisting: PDF page renders
// and file blobs are large and not worth storing. Image thumbnails are kept
// so the restored chat still shows what was sent.
function stripHeavy(messages: readonly unknown[]): ChatLike[] {
  return (messages as ChatLike[]).map(m => {
    if (!m.attachments?.length) return m;
    const attachments = m.attachments.map(a => ({
      id: a.id,
      name: a.name,
      mimeType: a.mimeType,
      isImage: a.isImage,
      data: a.isImage ? a.data : '',
    }));
    return { ...m, attachments };
  });
}

function makeTitle(messages: readonly unknown[]): string {
  const firstUser = (messages as ChatLike[]).find(m => m.role === 'user');
  const raw = (String(firstUser?.text || '') || '新しい会話').replace(/\s+/g, ' ').trim();
  return raw.length > 40 ? raw.slice(0, 40) + '…' : raw;
}

export async function saveChat(
  model: 'lily' | 'sikunlily',
  messages: readonly unknown[],
): Promise<number> {
  const now = Date.now();
  const entry: SavedChat = {
    title: makeTitle(messages),
    model,
    messages: JSON.stringify(stripHeavy(messages)),
    count: messages.length,
    createdAt: now,
    updatedAt: now,
  };
  return (await db.savedChats.add(entry)) as number;
}

// Soft-delete (tombstone) so the deletion propagates through live sync — a hard
// delete would just vanish locally and the other device would re-add it.
export async function deleteSavedChat(id: number): Promise<void> {
  const t = Date.now();
  await db.savedChats.update(id, { deletedAt: t, updatedAt: t });
}

export async function clearSavedChats(): Promise<void> {
  const t = Date.now();
  const live = await db.savedChats.filter(c => !c.deletedAt).toArray();
  await Promise.all(live.map(c => db.savedChats.update(c.id!, { deletedAt: t, updatedAt: t })));
}

export function parseSavedMessages<T>(chat: SavedChat): T[] {
  try {
    return JSON.parse(chat.messages) as T[];
  } catch {
    return [];
  }
}
