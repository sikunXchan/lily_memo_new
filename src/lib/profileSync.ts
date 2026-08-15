// 端末をまたいで持ち回りたい「プロフィール」まわり — ユーザーの名前と、
// ガチャで当てたスキン（所持一覧＋今つけているもの）。
//
// これらは Dexie ではなく localStorage に居るので、notes/folders/学習履歴の
// 同期経路には乗らない。points.ts の PlanSyncState と同じ作りで、liveSync が
// スナップショットに畳み込めるようにしてある（lib/liveSync.ts）。
// バックアップ JSON にも同じ形で入る（lib/backup.ts）。
//
// import は appLang / characterSkins / gacha への一方向だけ。書き換え側
// （setUserName、ガチャ、スキンの付け替え）は既存の DOM イベントを投げる
// だけにして、こちら側がそれを拾う — こうしないと gacha ↔ profileSync が
// 循環 import になる。
import { USER_NAME_AT_KEY, USER_NAME_KEY } from './appLang';
import { CHARACTER_SKINS, CHARACTER_SKIN_AT_KEY, CHARACTER_SKIN_STORAGE_KEY, SKINS_CHANGED_EVENT } from './characterSkins';
import { getOwnedSkinIds, ownSkin } from './gacha';

const KEY_NAME = USER_NAME_KEY;
const KEY_NAME_AT = USER_NAME_AT_KEY;
const KEY_SKIN_AT = CHARACTER_SKIN_AT_KEY;
const USER_NAME_EVENT = 'lily-username-changed';

export interface ProfileSyncState {
  userName: string;
  userNameAt: number;   // 名前を最後に変えた時刻（新しいほうが勝つ）
  skinId: string;       // 今つけているスキン（'' = デフォルト）
  skinAt: number;       // 付け替えた時刻（新しいほうが勝つ）
  ownedSkinIds: string[]; // 所持スキン。マージは常に和集合
}

/**
 * liveSync から呼ぶ。名前・スキンが変わったら push を予約させる。
 * 名前とスキンの変更はどちらも DOM イベントで飛んでくるので、ここで拾って
 * そのままフックに流す。
 */
export function registerProfileSyncHook(fn: () => void): void {
  if (typeof window === 'undefined') return;
  // 取り込み中に自分が投げたイベントで push を予約し返さないようにする
  // （applyPlanSyncState が localStorage を直接書くのと同じ理由）。
  const relay = () => { if (!_applying) fn(); };
  window.addEventListener(USER_NAME_EVENT, relay);
  window.addEventListener(SKINS_CHANGED_EVENT, relay);
}

let _applying = false;

function readAt(key: string): number {
  const raw = localStorage.getItem(key);
  const n = raw ? parseInt(raw, 10) : 0;
  return Number.isFinite(n) ? n : 0;
}

export function getProfileSyncState(): ProfileSyncState {
  if (typeof window === 'undefined') {
    return { userName: '', userNameAt: 0, skinId: '', skinAt: 0, ownedSkinIds: [] };
  }
  return {
    userName: (localStorage.getItem(KEY_NAME) || '').trim(),
    userNameAt: readAt(KEY_NAME_AT),
    skinId: localStorage.getItem(CHARACTER_SKIN_STORAGE_KEY) || '',
    skinAt: readAt(KEY_SKIN_AT),
    ownedSkinIds: getOwnedSkinIds(),
  };
}

/**
 * 相手側の名前・スキンをこの端末に取り込む。
 *
 * - 所持スキンは **和集合**。ガチャで当てた記録は片方の端末からしか見えない
 *   ことがあるので、引き算は絶対にしない（同期で当たりが消えたら最悪）。
 * - 名前と装備スキンは打刻の新しいほうが勝つ。打刻が無い古いデータが相手の
 *   ときは、こちらが空のときだけ受け入れる（せっかく付けた名前を、まだ何も
 *   設定していない端末の空文字で上書きしないため）。
 * - 装備スキンは和集合を取ったあとの所持一覧に入っているものだけ受け付ける。
 *
 * 変化があったときだけイベントを投げる（毎ポーリングで UI が再読み込みするのを
 * 避けるため）。戻り値は「何か変わったか」。
 */
export function applyProfileSyncState(remote: ProfileSyncState | undefined): boolean {
  if (!remote || typeof window === 'undefined') return false;
  _applying = true;
  try {
    return applyInner(remote);
  } finally {
    _applying = false;
  }
}

function applyInner(remote: ProfileSyncState): boolean {
  let skinsChanged = false;
  let nameChanged = false;

  // ── 所持スキン: 和集合 ──────────────────────────────────────
  const localOwned = new Set(getOwnedSkinIds());
  for (const id of remote.ownedSkinIds ?? []) {
    if (!CHARACTER_SKINS.some(s => s.id === id)) continue; // 知らない id は捨てる
    if (localOwned.has(id)) continue;
    ownSkin(id);
    localOwned.add(id);
    skinsChanged = true;
  }

  // ── 名前: 打刻の新しいほうが勝つ ────────────────────────────
  const localName = (localStorage.getItem(KEY_NAME) || '').trim();
  const localNameAt = readAt(KEY_NAME_AT);
  const remoteName = (remote.userName || '').trim();
  const remoteNameAt = remote.userNameAt ?? 0;
  const nameWins = remoteNameAt > 0 ? remoteNameAt > localNameAt : (!localName && !!remoteName);
  if (nameWins && remoteName !== localName) {
    try {
      if (remoteName) localStorage.setItem(KEY_NAME, remoteName);
      else localStorage.removeItem(KEY_NAME);
      localStorage.setItem(KEY_NAME_AT, String(remoteNameAt || Date.now()));
    } catch { /* 使えなくても続行 */ }
    nameChanged = true;
  }

  // ── 装備スキン: 打刻の新しいほうが勝つ。ただし所持しているものだけ ──
  const localSkin = localStorage.getItem(CHARACTER_SKIN_STORAGE_KEY) || '';
  const localSkinAt = readAt(KEY_SKIN_AT);
  const remoteSkin = remote.skinId || '';
  const remoteSkinAt = remote.skinAt ?? 0;
  const skinWins = remoteSkinAt > 0 ? remoteSkinAt > localSkinAt : (!localSkin && !!remoteSkin);
  const wearable = !remoteSkin || localOwned.has(remoteSkin);
  if (skinWins && wearable && remoteSkin !== localSkin) {
    try {
      localStorage.setItem(CHARACTER_SKIN_STORAGE_KEY, remoteSkin);
      localStorage.setItem(KEY_SKIN_AT, String(remoteSkinAt || Date.now()));
    } catch { /* 使えなくても続行 */ }
    skinsChanged = true;
  }

  // 既存の表示（設定画面の名前欄、スキンを読む Context）はこの2つのイベントを
  // 見ているので、そのまま流用して画面を追従させる。
  if (nameChanged) window.dispatchEvent(new Event(USER_NAME_EVENT));
  if (skinsChanged) window.dispatchEvent(new Event(SKINS_CHANGED_EVENT));
  return nameChanged || skinsChanged;
}
