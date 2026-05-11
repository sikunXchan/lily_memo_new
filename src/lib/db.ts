import Dexie, { type Table } from 'dexie';

export interface Folder {
  id?: number;
  name: string;
  parentId?: number;
  color?: string;
  createdAt: number;
  serverId?: string;
  syncedAt?: number;
}

export interface Note {
  id?: number;
  title: string;
  content: string;
  folderId?: number;
  color?: string;
  createdAt: number;
  updatedAt: number;
  syncCode?: string;
  serverId?: string;
  syncedAt?: number;
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
  }
}

export const db = new LilyDatabase();
