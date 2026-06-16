// Pure, server-safe snapshot merge. NO Dexie / DOM imports — this runs inside
// the /api/sync/live route on the server.
//
// Why this exists: the live-sync endpoint used to OVERWRITE the stored snapshot
// with whatever a device pushed. With two+ devices active, that loses updates —
// when device B pushes, it wipes notes that device A created/deleted but B had
// not pulled yet. So creations and deletions silently vanished while edits to
// notes already present on both devices appeared to work.
//
// The fix: the server MERGES the incoming snapshot into the stored one, record
// by record, keeping the most-recently-edited version (last-write-wins). The
// server becomes the single point where the two devices' views are reconciled,
// so nothing is lost regardless of push ordering.

// Loose record shape — the route only forwards JSON, it doesn't need the exact
// Dexie interfaces (and importing db.ts here would boot a Dexie instance on the
// server, which has no indexedDB).
type Rec = Record<string, unknown>;

export interface SyncSnapshot {
  notes?: Rec[];
  folders?: Rec[];
  studySessions?: Rec[];
  studyCategories?: Rec[];
  exams?: Rec[];
  scheduleDays?: Rec[];
  savedChats?: Rec[];
  todos?: Rec[];
  earnedBadges?: Rec[];
  problemSets?: Rec[];
  diaries?: Rec[];
  lessonSessions?: Rec[];
  ts?: number;
  [k: string]: unknown;
}

const num = (v: unknown): number => (typeof v === 'number' ? v : 0);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

// Last-write-wins merge keyed by a stable identity. The record with the larger
// version clock survives; on a tie the incoming one wins (it's at least as
// fresh). Tombstones (deletedAt) carry a bumped clock, so a deletion beats an
// older live copy — and a later edit beats an older deletion.
function mergeLWW(
  base: Rec[],
  incoming: Rec[],
  keyOf: (r: Rec) => string | null,
  verOf: (r: Rec) => number,
): Rec[] {
  const map = new Map<string, Rec>();
  for (const r of base) {
    const k = keyOf(r);
    if (k != null) map.set(k, r);
  }
  for (const r of incoming) {
    const k = keyOf(r);
    if (k == null) continue;
    const cur = map.get(k);
    if (!cur || verOf(r) >= verOf(cur)) map.set(k, r);
  }
  return [...map.values()];
}

// Additive union for immutable / version-less records: keep the first seen.
function mergeUnion(base: Rec[], incoming: Rec[], keyOf: (r: Rec) => string | null): Rec[] {
  const map = new Map<string, Rec>();
  for (const r of [...base, ...incoming]) {
    const k = keyOf(r);
    if (k != null && !map.has(k)) map.set(k, r);
  }
  return [...map.values()];
}

// Badges are never revoked; keep the earliest earn date on conflict.
function mergeBadges(base: Rec[], incoming: Rec[]): Rec[] {
  const map = new Map<string, Rec>();
  for (const r of [...base, ...incoming]) {
    const k = str(r.badgeId);
    if (k == null) continue;
    const cur = map.get(k);
    if (!cur || num(r.earnedAt) < num(cur.earnedAt)) {
      map.set(k, { badgeId: k, earnedAt: num(r.earnedAt) });
    }
  }
  return [...map.values()];
}

// Merge an incoming device snapshot into the stored one. Returns the reconciled
// snapshot to persist. Either argument may be partial/empty.
export function mergeSnapshots(base: SyncSnapshot, incoming: SyncSnapshot): SyncSnapshot {
  const b = base ?? {};
  const i = incoming ?? {};
  return {
    notes: mergeLWW(b.notes ?? [], i.notes ?? [], r => str(r.syncId), r => num(r.updatedAt)),
    folders: mergeLWW(b.folders ?? [], i.folders ?? [], r => str(r.syncId), r => num(r.updatedAt)),
    studySessions: mergeLWW(
      b.studySessions ?? [], i.studySessions ?? [],
      r => str(r.syncId), r => num(r.updatedAt) || num(r.startTime),
    ),
    studyCategories: mergeLWW(
      b.studyCategories ?? [], i.studyCategories ?? [],
      r => str(r.syncId), r => num(r.updatedAt) || num(r.createdAt),
    ),
    todos: mergeLWW(
      b.todos ?? [], i.todos ?? [],
      r => (r.createdAt != null ? String(r.createdAt) : null),
      r => num(r.updatedAt) || num(r.createdAt),
    ),
    savedChats: mergeLWW(
      b.savedChats ?? [], i.savedChats ?? [],
      r => (r.createdAt != null ? String(r.createdAt) : null),
      r => num(r.updatedAt) || num(r.createdAt),
    ),
    problemSets: mergeLWW(
      b.problemSets ?? [], i.problemSets ?? [],
      r => (r.createdAt != null ? String(r.createdAt) : null),
      r => num(r.updatedAt) || num(r.createdAt),
    ),
    // Diaries: one entry per day, keyed by `date` (stable across devices).
    // updatedAt is the version clock incl. soft-delete, matching the client.
    diaries: mergeLWW(
      b.diaries ?? [], i.diaries ?? [],
      r => str(r.date),
      r => num(r.updatedAt) || num(r.createdAt),
    ),
    // Lesson sessions: keyed by `createdAt` (stable across devices — two lessons
    // started at the same ms on different devices are treated as the same one).
    // updatedAt is the version clock incl. soft-delete, matching the client.
    lessonSessions: mergeLWW(
      b.lessonSessions ?? [], i.lessonSessions ?? [],
      r => (r.createdAt != null ? String(r.createdAt) : null),
      r => num(r.updatedAt) || num(r.createdAt),
    ),
    exams: mergeUnion(b.exams ?? [], i.exams ?? [], r => `${str(r.name) ?? ''}|${str(r.examDate) ?? ''}`),
    scheduleDays: mergeUnion(b.scheduleDays ?? [], i.scheduleDays ?? [], r => str(r.date)),
    earnedBadges: mergeBadges(b.earnedBadges ?? [], i.earnedBadges ?? []),
  };
}
