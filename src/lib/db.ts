import Dexie, { type Table } from 'dexie';

export interface Folder {
  id?: number;
  name: string;
  parentId?: number;
  color?: string;
  createdAt: number;
}

export type NoteType = 'text' | 'handwriting';

export interface Note {
  id?: number;
  title: string;
  content: string;
  folderId?: number;
  color?: string;
  createdAt: number;
  updatedAt: number;
  type?: NoteType;
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

export const EMPTY_HANDWRITING: HandwritingDoc = { strokes: [], width: 1024, height: 768 };

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

export class LilyDatabase extends Dexie {
  folders!: Table<Folder>;
  notes!: Table<Note>;
  images!: Table<ImageAsset>;

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
  }
}

export const db = new LilyDatabase();
