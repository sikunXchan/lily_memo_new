'use client';

// ── 演習 (Practice) ─────────────────────────────────────────────────────────
// A dedicated problem-set generator + store. The Practice screen has its OWN
// Lily AI: you describe what you want (or attach a photo of a textbook), and
// she returns a structured problem set that's solved full-screen — supporting
// long passages, charts, multiple-choice, written, fill-in and true/false.

import { db } from './db';
import type { ProblemSet, PracticeQuestion, PracticeQType } from './db';
import { callGeminiChat } from './gemini';
import type { ChatTurn, ChatAttachment } from './gemini';
import { getEffectiveApiKey, getAppLang } from './appLang';

export type { ProblemSet, PracticeQuestion, PracticeQType };

// The schema we force the model to emit. Kept terse so the model spends its
// budget on quality questions, not boilerplate.
const PRACTICE_SYSTEM_PROMPT = `あなたは「Lily」、学習アプリの問題作成AIです。ユーザーの要望（や添付画像/教科書）から、本格的な「問題セット」をJSONで作成します。

# 出力ルール（厳守）
- 出力は **JSONオブジェクト1つだけ**。前置き・説明・コードフェンス（\`\`\`）は一切書かない。
- **重要**: JSON文字列内でLaTeX（数式）を書くときは、バックスラッシュを必ず2つ重ねてエスケープする。例: \`\\\\vec{a}\`、\`\\\\frac{1}{2}\`、\`\\\\sqrt{2}\`。エスケープを忘れるとJSONが壊れる。
- スキーマ:
{
  "title": "問題セットの短いタイトル",
  "subject": "教科や分野（例: 英語長文 / 数学II / 世界史）",
  "questions": [
    {
      "type": "mcq" | "written" | "fill" | "tf",
      "passage": "（任意）長文読解の本文や共通の資料。複数問で共有する文脈はここに。",
      "prompt": "問題文。Markdownと数式($...$ や $$...$$)が使える。",
      "chart": "（任意）グラフ問題のときChart.jsのconfigをJSON文字列で。typeは bar/line/pie/scatter。",
      "choices": ["選択肢A", "選択肢B", "選択肢C", "選択肢D"],
      "correct": 0,
      "answer": "記述/穴埋めの模範解答",
      "explanation": "なぜその答えになるかの解説（必須・丁寧に）"
    }
  ]
}

# 各typeの使い方
- "mcq"（選択問題）: choices(3〜5個) と correct(正解のindex, 0始まり) を必ず付ける。
- "tf"（○×問題）: correct は 0=○(正しい) / 1=×(誤り)。choices は不要。
- "fill"（穴埋め）: prompt の空欄は ［　］ で示し、answer に正解を入れる。
- "written"（記述）: answer に模範解答。長めでよい。
- すべての問題に explanation（解説）を必ず付ける。
- 長文読解や資料問題は passage を使い、同じ passage を参照する問題を続けてよい（大問形式）。
- グラフの読み取り問題が有効なときは chart を活用する。
- 表（Markdown table形式 "| 列 | 列 |"）も使用可能。データや比較に適した場合は積極的に活用。
- 問題数はユーザー指定があれば従う。指定が無ければ5問。
- 難易度・分野はユーザーの要望に忠実に。`;

const PRACTICE_SYSTEM_PROMPT_EN = `You are "Lily", the problem-set generator AI of a study app. From the user's request (or an attached photo/textbook), create a serious "problem set" as JSON, solved full-screen — supporting long passages, charts, multiple-choice, written, fill-in and true/false questions.

# Output rules (strict)
- Output **exactly one JSON object**. No preamble, no explanation, no code fences.
- **Important**: when writing LaTeX (math) inside JSON strings, always double-escape backslashes, e.g. \`\\\\vec{a}\`, \`\\\\frac{1}{2}\`, \`\\\\sqrt{2}\`. Forgetting this breaks the JSON.
- Schema:
{
  "title": "short title of the set",
  "subject": "subject/field (e.g. English Reading / Calculus / World History)",
  "questions": [
    {
      "type": "mcq" | "written" | "fill" | "tf",
      "passage": "(optional) shared reading passage / source material",
      "prompt": "the question. Markdown and math ($...$, $$...$$) allowed.",
      "chart": "(optional) Chart.js config as a JSON string for graph questions (type bar/line/pie/scatter).",
      "choices": ["A", "B", "C", "D"],
      "correct": 0,
      "answer": "model answer for written/fill",
      "explanation": "why the answer is correct (required, thorough)"
    }
  ]
}

# Per-type rules
- "mcq": always include choices(3-5) and correct(index, 0-based).
- "tf": correct is 0=true / 1=false. No choices.
- "fill": mark the blank with [ ___ ] in prompt, put the answer in "answer".
- "written": put a model answer in "answer".
- Every question MUST have an explanation.
- Use "passage" for reading/source questions; consecutive questions may share it (compound/大問 format).
- Use "chart" when a graph-reading question fits.
- Markdown tables (| col | col |) are supported and encouraged for data/comparison content.
- Default to 5 questions unless the user specifies a count.`;

function genId(): string {
  return 'q' + Math.random().toString(36).slice(2, 9);
}

// Pull the first balanced JSON object out of a model response, tolerating
// stray prose or ```json fences the model may add despite instructions.
function extractJsonObject(raw: string): string {
  let s = raw.trim();
  // Strip code fences
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  const start = s.indexOf('{');
  if (start < 0) throw new Error('no json');
  // Walk to the matching closing brace (string-aware).
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
    } else {
      if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) return s.slice(start, i + 1); }
    }
  }
  return s.slice(start);
}

// Math/科学 questions are full of LaTeX (\vec, \frac, \sqrt, …). Models often
// emit those backslashes WITHOUT escaping them for JSON, so `JSON.parse` chokes
// on the invalid escape sequence. This repairs a JSON string by:
//  • doubling any backslash inside a string that isn't a valid JSON escape, and
//  • escaping raw control chars (newline/tab) that slipped inside a string.
// Only touches characters inside string literals so structure is untouched.
function repairJsonString(s: string): string {
  let out = '';
  let inStr = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (!inStr) {
      out += c;
      if (c === '"') inStr = true;
      continue;
    }
    // ── inside a string ──
    if (c === '"') { out += c; inStr = false; continue; }
    if (c === '\n') { out += '\\n'; continue; }
    if (c === '\r') { out += '\\r'; continue; }
    if (c === '\t') { out += '\\t'; continue; }
    if (c === '\\') {
      const next = s[i + 1];
      // Valid JSON escapes: " \ / b f n r t u
      if (next && '"\\/bfnrtu'.includes(next)) { out += c + next; i++; }
      else out += '\\\\'; // lone backslash (e.g. LaTeX \vec) → escape it
      continue;
    }
    out += c;
  }
  return out;
}

// Parse the model's JSON, retrying with a backslash/control-char repair pass
// before giving up — LaTeX-heavy answers routinely need it.
function parseModelJson(reply: string): Record<string, unknown> {
  const jsonStr = extractJsonObject(reply);
  try {
    return JSON.parse(jsonStr);
  } catch {
    return JSON.parse(repairJsonString(jsonStr));
  }
}

function normalizeQuestion(q: Record<string, unknown>): PracticeQuestion | null {
  const type = q.type as PracticeQType;
  if (!['mcq', 'written', 'fill', 'tf'].includes(type)) return null;
  const prompt = typeof q.prompt === 'string' ? q.prompt.trim() : '';
  if (!prompt) return null;
  const out: PracticeQuestion = { id: genId(), type, prompt };
  if (typeof q.passage === 'string' && q.passage.trim()) out.passage = q.passage.trim();
  if (typeof q.explanation === 'string' && q.explanation.trim()) out.explanation = q.explanation.trim();
  if (typeof q.chart === 'string' && q.chart.trim()) out.chart = q.chart.trim();
  else if (q.chart && typeof q.chart === 'object') out.chart = JSON.stringify(q.chart);

  if (type === 'mcq') {
    const choices = Array.isArray(q.choices) ? q.choices.map(c => String(c)) : [];
    if (choices.length < 2) return null;
    out.choices = choices;
    out.correct = typeof q.correct === 'number' ? q.correct : 0;
  } else if (type === 'tf') {
    out.correct = typeof q.correct === 'number' ? q.correct : 0;
  } else {
    out.answer = typeof q.answer === 'string' ? q.answer.trim() : '';
  }
  return out;
}

export interface GenerateResult {
  title: string;
  subject?: string;
  questions: PracticeQuestion[];
}

// Ask Lily to build a problem set. Throws a friendly error on failure.
export async function generateProblemSet(
  request: string,
  attachments: ChatAttachment[] = []
): Promise<GenerateResult> {
  const apiKey = getEffectiveApiKey();
  if (!apiKey) {
    throw new Error(getAppLang() === 'en'
      ? 'Set your Gemini API key in Settings first.'
      : '先に設定でGemini APIキーを入力してね。');
  }
  const sys = getAppLang() === 'en' ? PRACTICE_SYSTEM_PROMPT_EN : PRACTICE_SYSTEM_PROMPT;
  const userText = request.trim() ||
    (getAppLang() === 'en' ? 'Make a problem set from the attached material.' : '添付した資料から問題セットを作って。');

  const history: ChatTurn[] = [{ role: 'user', text: userText, attachments }];

  const reply = await callGeminiChat(history, sys, apiKey, {
    temperature: 0.7,
    maxOutputTokens: 65536,
  });

  let parsed: Record<string, unknown>;
  try {
    parsed = parseModelJson(reply);
  } catch {
    throw new Error(getAppLang() === 'en'
      ? 'Could not read the generated problems. Try rephrasing.'
      : '問題をうまく作れなかった…言い方を変えてもう一度試してね。');
  }

  const rawQs = Array.isArray(parsed.questions) ? parsed.questions : [];
  const questions = rawQs
    .map(q => normalizeQuestion(q as Record<string, unknown>))
    .filter((q): q is PracticeQuestion => q !== null);

  if (questions.length === 0) {
    throw new Error(getAppLang() === 'en'
      ? 'No valid questions were generated. Try again.'
      : '有効な問題ができなかった…もう一度試してね。');
  }

  return {
    title: typeof parsed.title === 'string' && parsed.title.trim()
      ? parsed.title.trim()
      : (getAppLang() === 'en' ? 'Problem set' : '問題セット'),
    subject: typeof parsed.subject === 'string' ? parsed.subject.trim() : undefined,
    questions,
  };
}

// ── Store helpers ────────────────────────────────────────────────────────────
export async function saveProblemSet(r: GenerateResult): Promise<number> {
  const set: ProblemSet = {
    title: r.title,
    subject: r.subject,
    questions: r.questions,
    count: r.questions.length,
    createdAt: Date.now(),
    attempts: 0,
  };
  return await db.problemSets.add(set) as number;
}

export async function deleteProblemSet(id: number): Promise<void> {
  await db.problemSets.delete(id);
}

export async function recordAttempt(id: number, correct: number): Promise<void> {
  const set = await db.problemSets.get(id);
  if (!set) return;
  await db.problemSets.update(id, {
    attempts: (set.attempts ?? 0) + 1,
    bestScore: Math.max(set.bestScore ?? 0, correct),
  });
}
