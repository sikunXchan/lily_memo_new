import type { Config } from 'drizzle-kit';

export default {
  schema: './src/lib/server-db.ts',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'file:./lily.db',
  },
} satisfies Config;
