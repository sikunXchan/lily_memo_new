import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import {
  sqliteTable,
  text,
  integer,
  primaryKey,
} from 'drizzle-orm/sqlite-core';
import type { AdapterAccountType } from '@auth/core/adapters';

// --- Auth.js tables ---

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  name: text('name'),
  email: text('email').unique(),
  emailVerified: integer('emailVerified', { mode: 'timestamp_ms' }),
  image: text('image'),
});

export const accounts = sqliteTable('accounts', {
  userId: text('userId').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: text('type').$type<AdapterAccountType>().notNull(),
  provider: text('provider').notNull(),
  providerAccountId: text('providerAccountId').notNull(),
  refresh_token: text('refresh_token'),
  access_token: text('access_token'),
  expires_at: integer('expires_at'),
  token_type: text('token_type'),
  scope: text('scope'),
  id_token: text('id_token'),
  session_state: text('session_state'),
}, (t) => [primaryKey({ columns: [t.provider, t.providerAccountId] })]);

export const sessions = sqliteTable('sessions', {
  sessionToken: text('sessionToken').primaryKey(),
  userId: text('userId').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expires: integer('expires', { mode: 'timestamp_ms' }).notNull(),
});

export const verificationTokens = sqliteTable('verificationTokens', {
  identifier: text('identifier').notNull(),
  token: text('token').notNull(),
  expires: integer('expires', { mode: 'timestamp_ms' }).notNull(),
}, (t) => [primaryKey({ columns: [t.identifier, t.token] })]);

// --- App tables ---

export const notesServer = sqliteTable('notes_server', {
  id: text('id').primaryKey(),
  userId: text('userId').notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  content: text('content').notNull().default(''),
  folderId: text('folderId'),
  color: text('color'),
  createdAt: integer('createdAt').notNull(),
  updatedAt: integer('updatedAt').notNull(),
  deletedAt: integer('deletedAt'),
});

export const foldersServer = sqliteTable('folders_server', {
  id: text('id').primaryKey(),
  userId: text('userId').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  parentId: text('parentId'),
  color: text('color'),
  createdAt: integer('createdAt').notNull(),
  deletedAt: integer('deletedAt'),
});

export const shares = sqliteTable('shares', {
  id: text('id').primaryKey(),
  shareCode: text('shareCode').notNull().unique(),
  noteId: text('noteId').notNull(),
  ownerId: text('ownerId').notNull().references(() => users.id, { onDelete: 'cascade' }),
  permission: text('permission').notNull().default('view'),
  createdAt: integer('createdAt').notNull(),
  expiresAt: integer('expiresAt'),
});

// --- DB client ---

const schema = {
  users,
  accounts,
  sessions,
  verificationTokens,
  notesServer,
  foldersServer,
  shares,
};

function createDb() {
  const url = process.env.DATABASE_URL ?? 'file:./lily.db';
  const client = createClient({ url });
  return drizzle(client, { schema });
}

export const serverDb = createDb();

export type ServerDb = typeof serverDb;
export type NoteServer = typeof notesServer.$inferSelect;
export type FolderServer = typeof foldersServer.$inferSelect;
export type Share = typeof shares.$inferSelect;
