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
  diagramSets?: Rec[];
  // テーブルではない同期物（localStorage 産）。planState はプラン・当日の
  // トークン消費、profile は名前と所持/装備スキン。
  planState?: Rec;
  profile?: Rec;
  ts?: number;
  [k: string]: unknown;
}

const num = (v: unknown): number => (typeof v === 'number' ? v : 0);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

// Study records pushed by an older client can arrive WITHOUT a syncId (the
// focus-mode timer used to save sessions without one). A record with no key was
// silently dropped from the merge, so those study hours never reached the other
// device and the total study time drifted apart. Fall back to the same
// deterministic id the client migration assigns (`s_<date>_<startTime>` /
// `c_<name>`), so the identical record from two devices still collapses into
// one instead of being counted twice.
function sessionKey(r: Rec): string | null {
  const sid = str(r.syncId);
  if (sid) return sid;
  const date = str(r.date);
  const start = r.startTime;
  if (!date || typeof start !== 'number') return null;
  return `s_${date}_${start}`;
}

function categoryKey(r: Rec): string | null {
  const sid = str(r.syncId);
  if (sid) return sid;
  const name = str(r.name);
  return name ? `c_${name}` : null;
}

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

// 名前と所持/装備スキン（クライアント側は lib/profileSync.ts）。
// 所持スキンは必ず和集合 — ここで片方に寄せると、もう一方の端末でしか
// 当てていないスキンが同期のたびに消える。名前と装備スキンは打刻の新しい
// ほうが勝つ（クライアントのマージ規則と同じ）。
function mergeProfile(base: Rec | undefined, incoming: Rec | undefined): Rec | undefined {
  if (!base) return incoming;
  if (!incoming) return base;

  const owned = new Set<string>();
  for (const src of [base, incoming]) {
    const list = Array.isArray(src.ownedSkinIds) ? src.ownedSkinIds : [];
    for (const id of list) if (typeof id === 'string') owned.add(id);
  }

  const nameSrc = num(incoming.userNameAt) > num(base.userNameAt) ? incoming : base;
  const skinSrc = num(incoming.skinAt)     > num(base.skinAt)     ? incoming : base;

  return {
    userName:     str(nameSrc.userName) ?? '',
    userNameAt:   num(nameSrc.userNameAt),
    skinId:       str(skinSrc.skinId) ?? '',
    skinAt:       num(skinSrc.skinAt),
    ownedSkinIds: [...owned],
  };
}

// Merge an incoming device snapshot into the stored one. Returns the reconciled
// snapshot to persist. Either argument may be partial/empty.
export function mergeSnapshots(base: SyncSnapshot, incoming: SyncSnapshot): SyncSnapshot {
  const b = base ?? {};
  const i = incoming ?? {};
  return {
    // まず両方を丸ごと持ち越してから、テーブルごとのマージ結果で上書きする。
    // 以前はここで列挙したフィールドだけを組み立てて返していたため、書き忘れた
    // ものがサーバー側で毎回消えていた（planState / profile / diagramSets が
    // それで一度も相手に届いていなかった）。今後フィールドが増えても、最低限
    // 「新しい側で上書き」の形では通る。
    ...b,
    ...i,
    notes: mergeLWW(b.notes ?? [], i.notes ?? [], r => str(r.syncId), r => num(r.updatedAt)),
    folders: mergeLWW(b.folders ?? [], i.folders ?? [], r => str(r.syncId), r => num(r.updatedAt)),
    studySessions: mergeLWW(
      b.studySessions ?? [], i.studySessions ?? [],
      sessionKey, r => num(r.updatedAt) || num(r.startTime),
    ),
    studyCategories: mergeLWW(
      b.studyCategories ?? [], i.studyCategories ?? [],
      categoryKey, r => num(r.updatedAt) || num(r.createdAt),
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
    // Diagram sets: keyed by createdAt, updatedAt が版クロック（クライアントと同じ）。
    diagramSets: mergeLWW(
      b.diagramSets ?? [], i.diagramSets ?? [],
      r => (r.createdAt != null ? String(r.createdAt) : null),
      r => num(r.updatedAt) || num(r.createdAt),
    ),
    profile: mergeProfile(b.profile, i.profile),
    exams: mergeUnion(b.exams ?? [], i.exams ?? [], r => `${str(r.name) ?? ''}|${str(r.examDate) ?? ''}`),
    scheduleDays: mergeUnion(b.scheduleDays ?? [], i.scheduleDays ?? [], r => str(r.date)),
    earnedBadges: mergeBadges(b.earnedBadges ?? [], i.earnedBadges ?? []),
  };
}

// Order-independent JSON for comparing records.
function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).filter(k => o[k] !== undefined).sort()
      .map(k => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

// True when two snapshots hold the same data, ignoring `ts`, key order and the
// order of records inside each table. Used by the sync API to skip writes that
// change nothing and to tell a device it already has everything it pushed.
export function snapshotsEqual(a: SyncSnapshot, b: SyncSnapshot): boolean {
  const A = (a ?? {}) as Record<string, unknown>;
  const B = (b ?? {}) as Record<string, unknown>;
  const keys = new Set([...Object.keys(A), ...Object.keys(B)]);
  keys.delete('ts');
  for (const k of keys) {
    const x = A[k];
    const y = B[k];
    if (Array.isArray(x) || Array.isArray(y)) {
      const xs = (Array.isArray(x) ? x : []).map(stableStringify).sort();
      const ys = (Array.isArray(y) ? y : []).map(stableStringify).sort();
      if (xs.length !== ys.length) return false;
      for (let i = 0; i < xs.length; i++) if (xs[i] !== ys[i]) return false;
    } else if (stableStringify(x) !== stableStringify(y)) {
      return false;
    }
  }
  return true;
}
