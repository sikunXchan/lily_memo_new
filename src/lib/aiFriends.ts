// 日記タブの「AIフレンド」= SNS風チャット相手のロジック。
//
// - 各フレンドは persona（基本の性格・立ち位置・話し方）と learned（毎日の振り返りで
//   育つ学習メモ）を持つ。userPersona（ユーザーの性格・話し方）と合わせてシステム
//   プロンプトを組み立てる。
// - 1日の終わり（or 手動）に runDailyLearning() が、その日の日記＋チャットから
//   userPersona と各フレンドの learned を更新する ＝「自分に合ったAI」を育てる。
// - 呼び出すモデルは最安の gemini-3.1-flash-lite に固定。

import { db, type AiFriend } from './db';
import { callGeminiChat, type ChatTurn } from './gemini';

// 最安モデル（軽量・低コスト）。フレンドの会話も学習もこれで回す。
export const CHEAP_MODELS = ['gemini-3.1-flash-lite'];

export interface UserPersona {
  summary: string; // 性格・興味・今の状況
  style: string;   // 話し方の特徴
  updatedAt: number;
}

const UP_KEY = 'lily-diary-userpersona';
const LAST_LEARNED_KEY = 'lily-diary-last-learned';

export function getUserPersona(): UserPersona {
  if (typeof localStorage === 'undefined') return { summary: '', style: '', updatedAt: 0 };
  try {
    const raw = localStorage.getItem(UP_KEY);
    if (raw) return JSON.parse(raw) as UserPersona;
  } catch { /* ignore */ }
  return { summary: '', style: '', updatedAt: 0 };
}

export function setUserPersona(p: UserPersona): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(UP_KEY, JSON.stringify(p));
}

export function getLastLearnedDate(): string {
  if (typeof localStorage === 'undefined') return '';
  return localStorage.getItem(LAST_LEARNED_KEY) ?? '';
}
export function setLastLearnedDate(iso: string): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(LAST_LEARNED_KEY, iso);
}

// ── 既定フレンド ──
const DEFAULT_FRIENDS: Omit<AiFriend, 'id' | 'createdAt' | 'updatedAt'>[] = [
  {
    name: 'こはる', emoji: '🌸', color: '#ec4899', builtin: true, learned: '',
    persona: '明るくて共感的な聞き上手。ユーザーの気持ちにまず寄り添い、やさしく肯定する。ポジティブだが軽すぎず、友だちのような距離感。話し方はやわらかく、たまに絵文字。',
  },
  {
    name: 'ソラ', emoji: '🌙', color: '#6366f1', builtin: true, learned: '',
    persona: '落ち着いた頼れる相談相手。冷静で、少し大人びた視点をくれる。感情に流されず、要点を短く整理してくれる。絵文字は少なめ、丁寧だが堅すぎない。',
  },
  {
    name: 'モカ', emoji: '🐻', color: '#f59e0b', builtin: true, learned: '',
    persona: 'おちゃめで元気なムードメーカー。テンション高めで、軽いツッコミや冗談で場を和ませる。ユーザーを笑わせたい。くだけた話し方、絵文字多め。',
  },
];

// 既定フレンドを（無ければ）シードする。builtin 名で重複を避ける。
export async function seedDefaultFriends(): Promise<void> {
  const existing = await db.aiFriends.filter(f => !!f.builtin && !f.deletedAt).toArray();
  const have = new Set(existing.map(f => f.name));
  const now = Date.now();
  for (const f of DEFAULT_FRIENDS) {
    if (!have.has(f.name)) {
      await db.aiFriends.add({ ...f, createdAt: now, updatedAt: now });
    }
  }
}

// ── チャット用システムプロンプト ──
function fmtUserPersona(up: UserPersona): string {
  if (!up.summary && !up.style) {
    return '（まだよく知らない。会話や日記から少しずつ知っていく。）';
  }
  return `${up.summary || '（性格は未把握）'}${up.style ? `\n話し方の特徴: ${up.style}` : ''}`;
}

export function buildChatSystemPrompt(friend: AiFriend, up: UserPersona, otherNames?: string[]): string {
  const group = otherNames && otherNames.length > 0;
  return `あなたは「${friend.name}」。ユーザーの日記アプリに住む、AIの友だちです。SNSのDMのように短く自然に会話します。

【あなたの性格・立ち位置・話し方】
${friend.persona}
${friend.learned ? `\n【これまでに学んだこと（ユーザーに合わせた振る舞い）】\n${friend.learned}` : ''}

【ユーザーについて分かっていること】
${fmtUserPersona(up)}

【ルール】
- 返事は1〜3文の短さ。SNSのメッセージのように自然に。
- 説教くさくしない。友だちとして寄り添う。ユーザーの話し方のトーンに合わせる。
- 名前を名乗り直したり「AIとして」などのメタ発言はしない。
- 絵文字は性格に合わせて控えめ〜適度に。${group ? `\n- これはグループチャット。他の友だち（${otherNames!.join('・')}）も参加している。かぶらないよう「${friend.name}」らしく短く。時々ほかの子の発言に軽く反応してもよい。自分の発言の頭に名前は付けない。` : ''}`;
}

// フレンド1人の返信を得る。history は ChatTurn[]（user/model）。
export async function chatReply(
  friend: AiFriend, history: ChatTurn[], up: UserPersona, apiKey: string, otherNames?: string[],
): Promise<string> {
  const sys = buildChatSystemPrompt(friend, up, otherNames);
  const reply = await callGeminiChat(history, sys, apiKey, {
    models: CHEAP_MODELS,
    temperature: 0.9,
    maxOutputTokens: 400,
  });
  return reply.trim();
}

// ── 1日の振り返り学習 ──
const LEARNING_SYSTEM = `あなたは、ユーザー専用のAIを育てるための「観察役」です。その日の日記とチャットのやり取りから、ユーザー像と、各AIフレンドがユーザーに対してどう振る舞うと心地よいかを、簡潔に更新します。返答はJSONオブジェクト1つだけ（散文・コードフェンス禁止）。

スキーマ:
{
  "userSummary": "ユーザーの性格・興味・価値観・今の状況を3〜4文で（これまでの把握を踏まえ更新）",
  "userStyle": "ユーザーの話し方・語調の特徴を1〜2文で",
  "friends": [ { "name": "フレンド名", "learned": "この子がユーザーに対してどう振る舞うと良いか・何を避けるべきかを1〜2文で（既存メモを踏まえ更新）" } ]
}

注意: 断定しすぎず、その日の材料から言える範囲で。誇張や決めつけをしない。`;

function parseLearningJson(text: string): { userSummary?: string; userStyle?: string; friends?: { name: string; learned: string }[] } | null {
  let t = (text || '').trim();
  const fence = t.match(/^(?:`{3,})\s*[a-zA-Z]*\s*\n([\s\S]*?)\n(?:`{3,})\s*$/);
  if (fence) t = fence[1]!.trim();
  if (!t.startsWith('{')) {
    const s = t.indexOf('{'), e = t.lastIndexOf('}');
    if (s >= 0 && e > s) t = t.slice(s, e + 1);
  }
  try { return JSON.parse(t); } catch { return null; }
}

// その日の日記本文＋チャット転記＋現在のプロフィールを渡し、userPersona と各フレンドの
// learned を更新して保存する。成功したら true。
export async function runDailyLearning(
  apiKey: string, diaryText: string, chatTranscript: string, friends: AiFriend[], up: UserPersona,
): Promise<boolean> {
  const friendsBlock = friends
    .map(f => `- ${f.name}: ${f.learned || '（まだ学習メモなし）'}`)
    .join('\n');
  const payload = `【現在のユーザー像】\n${up.summary || '（未把握）'}\n話し方: ${up.style || '（未把握）'}\n\n【各フレンドの現在の学習メモ】\n${friendsBlock}\n\n【今日の日記】\n${diaryText || '（今日の日記はなし）'}\n\n【今日のチャット】\n${chatTranscript || '（今日のチャットはなし）'}\n\n以上から、userSummary / userStyle / friends[].learned を更新してJSONで返して。`;

  const reply = await callGeminiChat([{ role: 'user', text: payload }], LEARNING_SYSTEM, apiKey, {
    models: CHEAP_MODELS,
    temperature: 0.4,
    maxOutputTokens: 900,
  });
  const parsed = parseLearningJson(reply);
  if (!parsed) return false;

  const now = Date.now();
  if (parsed.userSummary || parsed.userStyle) {
    setUserPersona({
      summary: (parsed.userSummary ?? up.summary ?? '').slice(0, 1200),
      style: (parsed.userStyle ?? up.style ?? '').slice(0, 400),
      updatedAt: now,
    });
  }
  if (Array.isArray(parsed.friends)) {
    for (const upd of parsed.friends) {
      const target = friends.find(f => f.name === upd?.name);
      if (target && target.id != null && typeof upd.learned === 'string' && upd.learned.trim()) {
        await db.aiFriends.update(target.id, { learned: upd.learned.trim().slice(0, 600), updatedAt: now });
      }
    }
  }
  return true;
}
