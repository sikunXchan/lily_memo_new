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
      "explanation": "なぜその答えになるかの解説（必須・丁寧に）",
      "points": 0
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
- 難易度・分野はユーザーの要望に忠実に。

# 模試モード（[設定]で「模試形式」が指定された場合のみ）
- 本番の試験のように作る: 大問形式（passage/資料を共有する設問群）を中心に、易→難の流れで構成する。
- **全問に "points"（配点）を必ず付ける**。配点の合計がちょうど100点になるように割り振る（重要な設問・難しい設問ほど高配点）。
- 指定された制限時間内で解ける分量にする。時間に対して問題が多すぎない・少なすぎないように調整する。
- 分野を満遍なくカバーし、本番で問われる典型・頻出のポイントを押さえる。
- 模試モードでないときは "points" は省略してよい。

# 問題の質（最重要 — 悪問を1問でも混ぜない）
- **自己完結**: 各問は passage と prompt だけで問いとして成立すること。「資料の〜を参照」「教科書の図より」のように、解く人が見られないものを前提にしない。必要な前提・データはすべて問題文に書き込む
- **正解の一意性**: 答えが一つに定まる聞き方をする。複数の解釈ができる曖昧な問い、専門家でも意見が割れる問いは出さない
- **出題価値**: 内容の中心（重要概念・定義・因果関係・違い・計算・応用）を問う。資料のメタ情報（ページ番号・章の順番・例示の個数など）や、覚える価値のない瑣末な点は問わない
- **mcq の誤答**: 正解と同じカテゴリのもっともらしい誤答にする（典型的な誤解・計算ミスの結果などが理想）。無関係な選択肢での水増しや「上記すべて」のような逃げの選択肢は禁止
- **重複禁止**: 同じ知識を別の言い方で繰り返し問わない
- **出力前の自己検証**: 全問について「問題文だけで解けるか」「correct/answer は本当に正しいか」「explanation は答えと矛盾していないか」を確認し、1つでも満たさない問題は捨てて作り直す。検証せずに出力しない

# explanation（解説）の書き方
- 1文目で「なぜこの答えになるか」の核心を言い切る（結論先行）
- 専門用語を使ったら、その場で一言で平易に言い換える
- mcq では、主要な誤答についても「なぜ違うか」を一言ずつ添える
- 計算問題は途中式をステップで示す
- 長さは要点が伝わる最小限。同じことの言い換えで水増ししない

# 難易度の定義（[設定]に指定がある場合は厳守）
- **易しめ**: 基本用語の定義・確認。教科書の重要語句をそのまま問う。正解が一意に絞れるシンプルな問い。知識の有無を確認するレベル。
- **普通**: 概念の理解と標準的な応用。「なぜか」「どう違うか」を問う。教科書レベル。
- **難しめ**: 複数の概念を組み合わせた発展問題。「なぜそうなるのか」「どう影響するか」を論理的に説明させる。単純な暗記では解けない。見慣れない角度・具体的な事例への応用・複数ステップの思考を要求する。大学入試や資格試験の応用問題レベル。
- **鬼**: 最難関レベル。難関大学の入試・オリンピック・上位資格試験の難問に相当。複数分野の知識を横断的に統合し、非自明な着眼点や発想の転換、厳密な論証を要求する。一見して解法が思い浮かばず、深い洞察と粘り強い思考が必要。ありがちな引っかけや盲点も織り込む。安易に解けてしまう問題は絶対に出さず、本気で難しくすること。`;

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
      "explanation": "why the answer is correct (required, thorough)",
      "points": 0
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
- Default to 5 questions unless the user specifies a count.

# Exam mode (only when [Settings] requests "Exam format")
- Build it like a real exam: lead with compound (大問) groups that share a passage/source, ordered easy → hard.
- **Give every question a "points" value.** Allocate marks so the total is exactly 100 (weight important/harder questions higher).
- Size the paper to be completable within the given time limit — not too many, not too few.
- Cover the field broadly and hit the typical, frequently-tested points of a real exam.
- Outside exam mode, "points" may be omitted.

# Question quality (top priority — not a single bad question)
- **Self-contained**: every question must stand on passage + prompt alone. Never reference material the solver cannot see ("according to the document", "as in the textbook figure"); embed all needed premises and data in the question itself.
- **Unique answer**: phrase questions so exactly one answer is correct. No ambiguous wording, no questions experts would dispute.
- **Worth asking**: test the core content (key concepts, definitions, causality, differences, computation, application). Never ask about meta details of the source (page numbers, section order, number of examples) or trivia not worth memorising.
- **mcq distractors**: plausible wrong answers from the same category (ideally typical misconceptions or common calculation errors). No filler options, no "all of the above".
- **No duplicates**: don't ask the same fact twice in different words.
- **Self-check before output**: verify for every question that it is solvable from its own text, that correct/answer is actually right, and that the explanation doesn't contradict the answer. Discard and regenerate any question that fails. Never skip this check.

# How to write "explanation"
- First sentence states the core reason the answer is correct (conclusion first).
- Define any technical term in plain words the moment it appears.
- For mcq, add one short line on why each major distractor is wrong.
- Show step-by-step working for calculations.
- Keep it as short as clarity allows; no padding or restating.

# Difficulty definitions (follow strictly when specified in [Settings])
- **easy**: Recall of basic terms and definitions. Single-answer, unambiguous questions. Tests whether the student knows the fact at all.
- **medium**: Conceptual understanding and standard application. "Why?" and "What's the difference?" questions. Textbook level.
- **hard**: Multi-concept synthesis. Requires logical explanation of cause/effect, application to unfamiliar scenarios, or multi-step reasoning. Cannot be solved by rote memorisation alone. University entrance / professional exam level.
- **brutal (鬼)**: The very hardest level — top-tier university entrance exams, olympiad, advanced professional exams. Integrates knowledge across multiple fields, demands non-obvious insight, creative reframing, and rigorous proof. The solution path is not apparent at a glance and requires deep, persistent reasoning. Weave in subtle traps and common blind spots. Never produce something that can be solved easily — make it genuinely brutal.`;

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
  if (typeof q.points === 'number' && q.points > 0) out.points = q.points;
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

  // Extended thinking + a moderate temperature: question quality depends on
  // the model actually reasoning about source material and verifying its own
  // answers before emitting JSON, not on sampling variety.
  const reply = await callGeminiChat(history, sys, apiKey, {
    temperature: 0.5,
    maxOutputTokens: 65536,
    thinkingBudget: 4096,
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
export async function saveProblemSet(
  r: GenerateResult,
  extra?: { examMode?: boolean; timeLimitSec?: number },
): Promise<number> {
  const now = Date.now();
  const set: ProblemSet = {
    title: r.title,
    subject: r.subject,
    questions: r.questions,
    count: r.questions.length,
    examMode: extra?.examMode || undefined,
    timeLimitSec: extra?.examMode ? extra.timeLimitSec : undefined,
    createdAt: now,
    updatedAt: now,
    attempts: 0,
  };
  return await db.problemSets.add(set) as number;
}

// Soft-delete (tombstone) so the deletion propagates through live sync.
export async function deleteProblemSet(id: number): Promise<void> {
  const t = Date.now();
  await db.problemSets.update(id, { deletedAt: t, updatedAt: t });
}

export async function recordAttempt(id: number, correct: number): Promise<void> {
  const set = await db.problemSets.get(id);
  if (!set) return;
  await db.problemSets.update(id, {
    attempts: (set.attempts ?? 0) + 1,
    bestScore: Math.max(set.bestScore ?? 0, correct),
    updatedAt: Date.now(),
  });
}
