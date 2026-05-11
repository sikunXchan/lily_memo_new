import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const syncSnapshots = sqliteTable('sync_snapshots', {
  code: text('code').primaryKey(),
  data: text('data').notNull(),
  updatedAt: integer('updatedAt').notNull(),
});

const schema = { syncSnapshots };

function createDb() {
  const url = process.env.DATABASE_URL ?? 'file:./lily.db';
  const client = createClient({ url });
  return drizzle(client, { schema });
}

export const serverDb = createDb();

export type SyncSnapshot = typeof syncSnapshots.$inferSelect;
