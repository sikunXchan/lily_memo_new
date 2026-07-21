// DMタブの「AIフレンド」= SNS風チャット相手のロジック。
//
// - 各フレンドは最初に選ぶ persona（性格・立ち位置・話し方の起点）と、そこから
//   キャラごとに育つ learned（学習メモ）を持つ。
// - 学習は「キャラごと・個人チャットのみ」。runCharacterLearning() がそのキャラの
//   個人チャット（ゴースト除く）から learned を更新し learnCount を +1 する。
//   グループでは学習しない。ゴーストチャットは学習に使わない。
// - グループ参加・発言は「個人チャット30回＋学習10回」を満たしたキャラのみ。
// - 呼び出すモデルは最安の gemini-3.1-flash-lite に固定。

import { db, type AiFriend } from './db';
import { callGeminiChat, type ChatTurn } from './gemini';

// 最安モデル（軽量・低コスト）。フレンドの会話も学習もこれで回す。
export const CHEAP_MODELS = ['gemini-3.1-flash-lite'];

const LAST_LEARNED_KEY = 'lily-diary-last-learned';

// 自動学習を「1日1回」に抑えるための最終自動学習日（YYYY-MM-DD）。
export function getLastLearnedDate(): string {
  if (typeof localStorage === 'undefined') return '';
  return localStorage.getItem(LAST_LEARNED_KEY) ?? '';
}
export function setLastLearnedDate(iso: string): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(LAST_LEARNED_KEY, iso);
}

// ── 既定フレンド ──
// アバターはアプリのキャラクター画像を使う（avatarKey）。
//  - リリー: 選択中のスキン（動的に解決）
//  - しくん: instance sikun のキャラ（/sikun-character.png）
//  - ちゃくん: 学習タブで目標達成時に出るマスコット（/sikun-dribble.gif）
const DEFAULT_FRIENDS: Omit<AiFriend, 'id' | 'createdAt' | 'updatedAt'>[] = [
  {
    name: 'リリー', emoji: '🌸', color: '#fb7185', avatarKey: 'lily', builtin: true, learned: '',
    persona: 'このアプリの相棒AI「Lily」。明るくて温かく、いつも味方でいてくれる。ユーザーの気持ちにまず寄り添い、やさしく肯定して背中を押す。友だちのような距離感で、話し方はやわらかく前向き。たまに絵文字。',
  },
  {
    name: 'しくん', emoji: '🐻', color: '#c084fc', avatarKey: 'sikun', builtin: true, learned: '',
    persona: 'アプリのマスコット「sikun」というクマの男の子。のんびりマイペースで素直、ちょっと天然。勉強や毎日を一緒にがんばる相棒として、飾らない言葉で励ましてくれる。くだけた口調、絵文字は控えめ。',
  },
  {
    name: 'ちゃくん', emoji: '🧸', color: '#f59e0b', avatarKey: 'chakun', builtin: true, learned: '',
    persona: '目標達成のときに現れる、元気いっぱいの応援キャラ。テンション高めで、ユーザーの頑張りや小さな一歩をめいっぱい褒めてハイタッチする。ポジティブで勢いがあり、明るい口調、絵文字多め。',
  },
];

// 既定フレンドをシードする。名前が変わった過去の既定フレンド（builtin）は掃除して、
// 現在の既定セットに揃える（idempotent）。
export async function seedDefaultFriends(): Promise<void> {
  const now = Date.now();
  const names = new Set(DEFAULT_FRIENDS.map(f => f.name));
  const existing = await db.aiFriends.filter(f => !!f.builtin && !f.deletedAt).toArray();
  // 現在の既定セットに無い旧・既定フレンドはソフト削除（例: 旧こはる/ソラ/モカ）。
  for (const f of existing) {
    if (!names.has(f.name) && f.id != null) {
      await db.aiFriends.update(f.id, { deletedAt: now, updatedAt: now });
    }
  }
  const have = new Set(existing.filter(f => names.has(f.name)).map(f => f.name));
  for (const f of DEFAULT_FRIENDS) {
    if (!have.has(f.name)) {
      await db.aiFriends.add({ ...f, createdAt: now, updatedAt: now });
    }
  }
}

// ── グループ参加の解放条件 ──
// キャラは「個人チャットで最低30回会話」かつ「10回学習」してはじめてグループに
// 参加・発言できる。学習はキャラごと・個人チャットのみ（グループでは学習しない）。
export const GROUP_MIN_CHATS = 30;
export const GROUP_MIN_LEARNS = 10;

export function isGroupEligible(friend: AiFriend, chatCount: number): boolean {
  return chatCount >= GROUP_MIN_CHATS && (friend.learnCount ?? 0) >= GROUP_MIN_LEARNS;
}

// ── 自動学習のオン/オフ設定（チャット設定） ──
const AUTOLEARN_KEY = 'lily-diary-autolearn';
export function getAutoLearn(): boolean {
  if (typeof localStorage === 'undefined') return true;
  return localStorage.getItem(AUTOLEARN_KEY) !== '0'; // 既定 ON
}
export function setAutoLearn(on: boolean): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(AUTOLEARN_KEY, on ? '1' : '0');
}

// ── チャット用システムプロンプト（キャラごと。userPersona は使わない） ──
export function buildChatSystemPrompt(friend: AiFriend, otherNames?: string[]): string {
  const group = otherNames && otherNames.length > 0;
  return `あなたは「${friend.name}」。ユーザーのアプリに住む、AIの友だちです。SNSのDMのように短く自然に会話します。

【あなたの性格・立ち位置・話し方（最初に決めた起点）】
${friend.persona}
${friend.learned ? `\n【この子が個人チャットから学んだこと（ユーザーに合わせた振る舞い・ユーザー像）】\n${friend.learned}` : ''}

【ルール】
- 返事は1〜3文の短さ。SNSのメッセージのように自然に。
- 説教くさくしない。友だちとして寄り添う。ユーザーの話し方のトーンに合わせる。
- 名前を名乗り直したり「AIとして」などのメタ発言はしない。
- 絵文字は性格に合わせて控えめ〜適度に。${group ? `\n- これはグループチャット。他の友だち（${otherNames!.join('・')}）も参加している。かぶらないよう「${friend.name}」らしく短く。時々ほかの子の発言に軽く反応してもよい。自分の発言の頭に名前は付けない。` : ''}`;
}

// フレンド1人の返信を得る。history は ChatTurn[]（user/model）。
export async function chatReply(
  friend: AiFriend, history: ChatTurn[], apiKey: string, otherNames?: string[],
): Promise<string> {
  const sys = buildChatSystemPrompt(friend, otherNames);
  const reply = await callGeminiChat(history, sys, apiKey, {
    models: CHEAP_MODELS,
    temperature: 0.9,
    maxOutputTokens: 400,
  });
  return reply.trim();
}

// ── キャラごとの学習（個人チャットのみ） ──
// そのキャラの個人チャット（ゴースト除く）から、learned を1つの短いメモに更新し、
// learnCount を +1 する。最初に選んだ性格(persona)を起点に、少しずつ育つイメージ。
const CHAR_LEARNING_SYSTEM = `あなたは、あるAIキャラを「そのユーザー専用」に育てる観察役です。キャラの現在の設定と学習メモ、そして最近の個人チャットから、learned（このキャラがユーザーに対してどう振る舞うと心地よいか＋分かってきたユーザー像）を、これまでを踏まえて簡潔に更新します。返答はJSONオブジェクト1つだけ（散文・コードフェンス禁止）。

スキーマ:
{ "learned": "このキャラ用の学習メモ（3〜5文以内）。ユーザーの性格・興味・話し方・地雷、そしてこのキャラがどう接すると良いかを、性格(起点)を保ったまま反映する。" }

注意: 断定しすぎない。起点の性格を壊さない。今ある材料から言える範囲で更新する。`;

function parseLearnedJson(text: string): string | null {
  let t = (text || '').trim();
  const fence = t.match(/^(?:`{3,})\s*[a-zA-Z]*\s*\n([\s\S]*?)\n(?:`{3,})\s*$/);
  if (fence) t = fence[1]!.trim();
  if (!t.startsWith('{')) {
    const s = t.indexOf('{'), e = t.lastIndexOf('}');
    if (s >= 0 && e > s) t = t.slice(s, e + 1);
  }
  try {
    const obj = JSON.parse(t) as { learned?: string };
    return typeof obj.learned === 'string' ? obj.learned : null;
  } catch { return null; }
}

// 1キャラ分の学習。transcript はそのキャラとの個人チャット（ゴースト除く）の転記。
// 成功したら true（learned 更新 + learnCount +1 + lastLearnedAt）。
export async function runCharacterLearning(
  apiKey: string, friend: AiFriend, transcript: string,
): Promise<boolean> {
  if (!transcript.trim() || friend.id == null) return false;
  const payload = `【キャラ】${friend.name}\n【起点の性格】${friend.persona}\n【現在の学習メモ】${friend.learned || '（まだ無し）'}\n\n【最近の個人チャット】\n${transcript}\n\n以上から learned を更新してJSONで返して。`;
  const reply = await callGeminiChat([{ role: 'user', text: payload }], CHAR_LEARNING_SYSTEM, apiKey, {
    models: CHEAP_MODELS,
    temperature: 0.4,
    maxOutputTokens: 500,
  });
  const learned = parseLearnedJson(reply);
  if (!learned || !learned.trim()) return false;
  const now = Date.now();
  await db.aiFriends.update(friend.id, {
    learned: learned.trim().slice(0, 800),
    learnCount: (friend.learnCount ?? 0) + 1,
    lastLearnedAt: now,
    updatedAt: now,
  });
  return true;
}
