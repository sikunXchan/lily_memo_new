import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const syncSnapshots = sqliteTable('sync_snapshots', {
  code: text('code').primaryKey(),
  data: text('data').notNull(),
  updatedAt: integer('updatedAt').notNull(),
});

const schema = { syncSnapshots };

type Db = ReturnType<typeof drizzle<typeof schema>>;
let initPromise: Promise<Db> | null = null;

export function getServerDb(): Promise<Db> {
  if (!initPromise) {
    initPromise = (async () => {
      const url = process.env.DATABASE_URL ?? 'file:./lily.db';
      const client = createClient({ url });
      await client.execute(`
        CREATE TABLE IF NOT EXISTS sync_snapshots (
          code TEXT PRIMARY KEY NOT NULL,
          data TEXT NOT NULL,
          updatedAt INTEGER NOT NULL
        )
      `);
      return drizzle(client, { schema });
    })();
  }
  return initPromise;
}

export type SyncSnapshot = typeof syncSnapshots.$inferSelect;
