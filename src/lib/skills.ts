'use client';

// User-authored "skills" (Claude-skill style): each skill is a system-prompt
// instruction plus optional reference materials (PDF / URL / pasted text). When
// a skill is active, its instructions and references are injected into Lily's
// system prompt for the whole conversation — so it changes how she *behaves*,
// not just the text in the input box.

import { db, type Skill, type SkillReference } from './db';
import { getAppLang } from './appLang';

export type { Skill, SkillReference };

const BUILTIN_SKILLS_JA: Omit<Skill, 'id' | 'createdAt' | 'updatedAt'>[] = [
  {
    builtinKey: 'tutor',
    emoji: '🎓',
    name: '家庭教師',
    instructions: `あなたは優しくて丁寧な家庭教師です。以下のルールで教えてください。
- 概念を段階的に、わかりやすく説明する
- まず要点を簡潔にまとめ、次に詳しく解説する
- 具体例やたとえ話を積極的に使い、相手の頭にイメージが浮かぶようにする
- 途中の理屈や式変形（途中式）を飛ばさない。「なぜこの一歩を踏むのか」を毎回そえる。簡潔さを口実に、相手が追うのに必要なステップを省略しない
- ユーザーの理解を確認しながら進める
- 間違いは優しく指摘し、正しい考え方へ導く`,
    references: [],
  },
  {
    builtinKey: 'flashcard',
    emoji: '🃏',
    name: '暗記サポート',
    instructions: `あなたは暗記学習のスペシャリストです。
- 内容をQA形式・穴埋め・選択問題などに変換して記憶を定着させる
- 覚えるべきポイントを整理し、優先順位をつける
- 覚え方のコツ（語呂合わせ・ストーリー化・関連付け）を提案する
- 「テストしてほしい」と言われたら積極的に問題を出す`,
    references: [],
  },
  {
    builtinKey: 'english-coach',
    emoji: '🗣️',
    name: '英語コーチ',
    instructions: `あなたはプロの英語コーチです。
- 英作文・英会話の改善点を具体的に指摘する
- 修正例を必ず提示し、なぜその表現が自然かを説明する
- 日本語で質問してきた場合は英語での言い方も合わせて教える
- ネイティブがよく使う自然な表現を優先する`,
    references: [],
  },
];

const BUILTIN_SKILLS_EN: Omit<Skill, 'id' | 'createdAt' | 'updatedAt'>[] = [
  {
    builtinKey: 'tutor',
    emoji: '🎓',
    name: 'Tutor',
    instructions: `You are a patient and thorough personal tutor. Follow these rules:
- Explain concepts step by step, using clear and simple language
- Start with a concise summary, then go deeper
- Use concrete examples and analogies so the learner can picture it
- Never skip the intermediate reasoning or algebra steps; say why each step is taken. Don't cut steps the learner needs just to be brief
- Check for understanding as you go
- Point out mistakes gently and guide toward the correct thinking`,
    references: [],
  },
  {
    builtinKey: 'flashcard',
    emoji: '🃏',
    name: 'Memorization Coach',
    instructions: `You are a memorization specialist.
- Convert content into Q&A, fill-in-the-blank, and multiple-choice formats to reinforce memory
- Organize key points and prioritize what to study first
- Suggest memory techniques (mnemonics, storytelling, associations)
- Actively quiz the user when they ask to be tested`,
    references: [],
  },
  {
    builtinKey: 'english-coach',
    emoji: '🗣️',
    name: 'English Coach',
    instructions: `You are a professional English coach.
- Give specific, actionable feedback on writing and conversation
- Always provide corrected examples and explain why the phrasing is natural
- When asked in another language, also show the English equivalent
- Prioritize natural, native-sounding expressions`,
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
      const BUILTIN_SKILLS = getAppLang() === 'en' ? BUILTIN_SKILLS_EN : BUILTIN_SKILLS_JA;
      const all = await db.skills.toArray();
      const byKey = new Map(all.filter(s => s.builtinKey).map(s => [s.builtinKey, s]));
      const now = Date.now();
      const toAdd = BUILTIN_SKILLS.filter(s => !byKey.has(s.builtinKey));
      if (toAdd.length > 0) {
        await db.skills.bulkAdd(toAdd.map((s, i) => ({ ...s, createdAt: now + i, updatedAt: now + i })));
      }
      for (const builtin of BUILTIN_SKILLS) {
        const existing = byKey.get(builtin.builtinKey);
        if (existing?.id != null && (existing.name !== builtin.name || existing.instructions !== builtin.instructions)) {
          await db.skills.update(existing.id, { name: builtin.name, instructions: builtin.instructions, updatedAt: now });
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
