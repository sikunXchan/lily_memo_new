import Dexie, { type Table } from 'dexie';

export interface Folder {
  id?: number;
  name: string;
  parentId?: number;
  color?: string;
  createdAt: number;
}

export interface Note {
  id?: number;
  title: string;
  content: string;
  folderId?: number;
  color?: string;
  createdAt: number;
  updatedAt: number;
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
  }
}

export const db = new LilyDatabase();
