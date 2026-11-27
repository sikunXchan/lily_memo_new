// Server-only helpers for what the sync API routes keep in Upstash Redis.
//
// Upstash bills (and caps) bandwidth by the bytes moved between the API routes
// and Redis. Sync snapshots are mostly JSON text — notes, chats, study logs —
// which gzips to a fraction of its size, so values are stored gzip-compressed
// and base64-encoded behind a short prefix. Values written before this change
// (plain JSON, which the Upstash client may already have parsed into an
// object) are still read transparently, so no migration is needed.

import { gzipSync, gunzipSync } from 'node:zlib';

const PREFIX = 'gz1:';

/** Serialize a value (or an already-serialized JSON string) for storage. */
export function packForStore(value: unknown): string {
  const json = typeof value === 'string' ? value : JSON.stringify(value);
  return PREFIX + gzipSync(Buffer.from(json, 'utf8'), { level: 6 }).toString('base64');
}

/** Turn whatever Redis returned back into a JSON string (null if missing/corrupt). */
export function unpackJsonFromStore(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw === 'string') {
    if (!raw.startsWith(PREFIX)) return raw; // legacy plain JSON string
    try {
      return gunzipSync(Buffer.from(raw.slice(PREFIX.length), 'base64')).toString('utf8');
    } catch {
      return null;
    }
  }
  // Legacy value the Upstash client auto-deserialized into an object.
  try { return JSON.stringify(raw); } catch { return null; }
}

/** Parsed value from storage, or null. */
export function unpackFromStore<T>(raw: unknown): T | null {
  const json = unpackJsonFromStore(raw);
  if (json == null) return null;
  try { return JSON.parse(json) as T; } catch { return null; }
}
