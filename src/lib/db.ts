import Dexie, { type Table } from 'dexie';

export interface Folder {
  id?: number;
  syncId: string;
  name: string;
  parentId?: number;
  color?: string;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
}

export type NoteType = 'text' | 'handwriting';

export interface Note {
  id?: number;
  syncId: string;
  title: string;
  content: string;
  folderId?: number;
  color?: string;
  createdAt: number;
  updatedAt: number;
  type?: NoteType;
  deletedAt?: number;
}

export function newSyncId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback (very unlikely on modern browsers)
  return 'sid-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export interface HandwritingStroke {
  points: { x: number; y: number }[];
  color: string;
  width: number;
}

export interface HandwritingDoc {
  strokes: HandwritingStroke[];
  width: number;
  height: number;
}

export const EMPTY_HANDWRITING: HandwritingDoc = { strokes: [], width: 1280, height: 1800 };

export function parseHandwriting(content: string): HandwritingDoc {
  if (!content) return { ...EMPTY_HANDWRITING };
  try {
    const data = JSON.parse(content) as Partial<HandwritingDoc>;
    return {
      strokes: Array.isArray(data.strokes) ? data.strokes : [],
      width: typeof data.width === 'number' ? data.width : EMPTY_HANDWRITING.width,
      height: typeof data.height === 'number' ? data.height : EMPTY_HANDWRITING.height,
    };
  } catch {
    return { ...EMPTY_HANDWRITING };
  }
}

export function serializeHandwriting(doc: HandwritingDoc): string {
  return JSON.stringify(doc);
}

export interface ImageAsset {
  id?: number;
  noteId: number;
  blob: Blob;
  type: string;
}

// A saved lily / sikunlily conversation. `messages` is a JSON-serialized
// ChatMessage[] (heavy attachment data stripped before saving).
export interface SavedChat {
  id?: number;
  title: string;
  model: 'lily' | 'sikunlily';
  messages: string;
  count: number;
  createdAt: number;
}

export class LilyDatabase extends Dexie {
  folders!: Table<Folder>;
  notes!: Table<Note>;
  images!: Table<ImageAsset>;
  savedChats!: Table<SavedChat>;

  constructor() {
    super('LilyDatabase');
    this.version(1).stores({
      folders: '++id, name, parentId, color, createdAt',
      notes: '++id, title, folderId, color, createdAt, updatedAt',
      images: '++id, noteId, type'
    });
    this.version(2).stores({
      notes: '++id, title, folderId, color, createdAt, updatedAt, syncCode'
    });
    this.version(3).stores({
      notes: '++id, title, folderId, color, createdAt, updatedAt, syncCode, serverId',
      folders: '++id, name, parentId, color, createdAt, serverId',
    });
    this.version(4).stores({
      notes: '++id, syncId, title, folderId, color, createdAt, updatedAt, syncCode, serverId',
    });
    this.version(5).stores({
      notes: '++id, title, folderId, color, createdAt, updatedAt',
      folders: '++id, name, parentId, color, createdAt',
    });
    this.version(6).stores({
      notes: '++id, title, folderId, color, createdAt, updatedAt, type',
      folders: '++id, name, parentId, color, createdAt',
    });
    this.version(7).stores({
      notes: '++id, syncId, title, folderId, color, createdAt, updatedAt, type, deletedAt',
      folders: '++id, syncId, name, parentId, color, createdAt, updatedAt, deletedAt',
    }).upgrade(async tx => {
      const now = Date.now();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await tx.table('folders').toCollection().modify((f: any) => {
        if (!f.syncId) f.syncId = newSyncId();
        if (!f.updatedAt) f.updatedAt = f.createdAt ?? now;
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await tx.table('notes').toCollection().modify((n: any) => {
        if (!n.syncId) n.syncId = newSyncId();
      });
    });
    this.version(8).stores({
      savedChats: '++id, model, createdAt',
    });
  }
}

export const db = new LilyDatabase();
