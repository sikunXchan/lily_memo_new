'use client';

// User-authored "skills" (Claude-skill style): each skill is a system-prompt
// instruction plus optional reference materials (PDF / URL / pasted text). When
// a skill is active, its instructions and references are injected into Lily's
// system prompt for the whole conversation — so it changes how she *behaves*,
// not just the text in the input box.

import { db, type Skill, type SkillReference } from './db';

export type { Skill, SkillReference };

// Seeded sample skills so the feature isn't empty on first run. These are real
// editable rows (the user can tweak or delete them) — they just ship by default
// so people can see what a good skill looks like.
const BUILTIN_SKILLS: Omit<Skill, 'id' | 'createdAt' | 'updatedAt'>[] = [
  {
    builtinKey: 'past-exam',
    emoji: '📝',
    name: '過去問の鬼',
    instructions:
      'あなたは資格試験の過去問解説に特化したモードです。\n\n【口調・形式】\n解説文体（〜である・〜だ）を使う。「だよ・だね」語尾は絶対に使わない。絵文字・褒め言葉・激励（「えらいえらい」「がんばれ」等）は禁止。問題文・設問文の再掲は禁止（ユーザーは手元で問題を見ている）。\n\n【解説の構造】\n複数設問がある場合、冒頭に1回だけ「■ この問題のテーマ」を置く。問われているテーマ・前提となる仕組みを1〜3文で整理し、処理フローや概念の図解が有効ならMermaid図を使う。\n\n各設問ごとに以下の型で解説する：\n1. 何を問われているか（1文で端的に）\n2. 正解とその根拠 — 本文の記述引用だけでなく「なぜその仕組みがそうなるのか」を説明する\n3. 誤答の否定 — 「関係ない」ではなく「なぜこの文脈で関係しないのか」を具体的に説明する\n4. 記述問題の場合 — 採点で点が取れる表現の条件（含めるべき情報・キーワード・文字数の使い方）を示す\n\n最後に「■ 試験ポイント」を置く。この問題から覚えるべき知識・用語を箇条書き3〜5個で整理する。\n\n【禁止事項】\n根拠のない断定（確証がない場合は「ここは確実ではない」と明示）、曖昧表現（「〜と思います」等）、本文引用のみで仕組みの説明がない解説。',
    references: [],
  },
  {
    builtinKey: 'study-plan',
    emoji: '🗓️',
    name: '学習プランナー',
    instructions:
      'あなたは学習計画づくりに特化したモードです。ユーザーの試験日・現在の理解度・使える時間から逆算して、現実的な学習計画を立ててください。詰め込みすぎず、復習の時間を必ず組み込む。週単位で「何を・どの順番で・なぜ」をセットで示す。情報が足りなければ、計画を作る前に試験日・苦手分野・1日の勉強時間を質問してください。',
    references: [],
  },
  {
    builtinKey: 'critic',
    emoji: '🎯',
    name: '弱点ハンター',
    instructions:
      'あなたはユーザーの理解の穴を見つけることに特化したモードです。ユーザーの説明・解答・メモを批判的に読み、理解が浅い・間違っている・曖昧なままの箇所を遠慮なく指摘してください。「だいたい合ってる」のような甘い評価は禁止。具体的にどこがどう不十分か、何を復習すべきかを挙げる。褒めるのは本当に正確で深い理解のときだけ。',
    references: [],
  },
];

let seedPromise: Promise<void> | null = null;

// Idempotently insert any built-in skills that aren't already present. Runs
// once per page load; safe to call from multiple components.
export function ensureSkillsSeeded(): Promise<void> {
  if (seedPromise) return seedPromise;
  seedPromise = (async () => {
    try {
      const all = await db.skills.toArray();
      const byKey = new Map(all.filter(s => s.builtinKey).map(s => [s.builtinKey, s]));
      const now = Date.now();
      const toAdd = BUILTIN_SKILLS.filter(s => !byKey.has(s.builtinKey));
      if (toAdd.length > 0) {
        await db.skills.bulkAdd(toAdd.map((s, i) => ({ ...s, createdAt: now + i, updatedAt: now + i })));
      }
      for (const builtin of BUILTIN_SKILLS) {
        const existing = byKey.get(builtin.builtinKey);
        if (existing?.id != null && existing.instructions !== builtin.instructions) {
          await db.skills.update(existing.id, { instructions: builtin.instructions, updatedAt: now });
        }
      }
    } catch (e) {
      console.error('skill seeding failed', e);
    }
  })();
  return seedPromise;
}

export async function saveSkill(skill: Skill): Promise<number> {
  const now = Date.now();
  if (skill.id != null) {
    await db.skills.update(skill.id, { ...skill, updatedAt: now });
    return skill.id;
  }
  return (await db.skills.add({ ...skill, createdAt: now, updatedAt: now })) as number;
}

export async function deleteSkill(id: number): Promise<void> {
  await db.skills.delete(id);
}

// Cap the reference text injected per skill so a big PDF can't blow up the
// context window (and the API bill). Roughly ~30k chars ≈ a long chapter.
const MAX_REF_CHARS = 30000;

// Build the text appended to the system prompt when a skill is active.
export function skillPromptAddon(skill: Skill): string {
  let out = `\n\n━━━━━━━━━━━━━━━\n【有効化中のスキル: ${skill.name}】\n${skill.instructions.trim()}`;
  if (skill.references.length > 0) {
    let budget = MAX_REF_CHARS;
    const parts: string[] = [];
    for (const ref of skill.references) {
      if (budget <= 0) break;
      const slice = ref.content.slice(0, budget);
      budget -= slice.length;
      const truncated = slice.length < ref.content.length ? '\n…(以下省略)' : '';
      parts.push(`◆ ${ref.name}\n${slice}${truncated}`);
    }
    out += `\n\n【スキルの参考資料 — これらの内容を根拠に答えること。資料に書かれていないことは推測せず「資料には無い」と言う】\n${parts.join('\n\n')}`;
  }
  out += '\n━━━━━━━━━━━━━━━';
  return out;
}

// Extract plain text from a PDF (base64, no data: prefix) using pdf.js. Used by
// the skill builder so a reference PDF becomes searchable text in the prompt.
export async function extractPdfText(base64Data: string): Promise<string> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
  const binaryStr = atob(base64Data);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
  const doc = await pdfjs.getDocument({ data: bytes }).promise;
  const MAX_PAGES = 50;
  const pages: string[] = [];
  for (let p = 1; p <= Math.min(doc.numPages, MAX_PAGES); p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const text = content.items.map((it: any) => ('str' in it ? it.str : '')).join(' ');
    pages.push(text);
  }
  return pages.join('\n\n').replace(/[ \t]+/g, ' ').trim();
}

// Fetch a URL through our server proxy and get back readable plain text.
export async function fetchUrlText(url: string): Promise<{ title: string; text: string }> {
  const res = await fetch(`/api/fetch-url?url=${encodeURIComponent(url)}`);
  if (!res.ok) {
    const msg = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(msg.error || `HTTP ${res.status}`);
  }
  return res.json();
}
