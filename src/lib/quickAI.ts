import { callGeminiChat, type ChatTurn } from './gemini';

export type QuickActionId =
  | 'summary'
  | 'proofread'
  | 'translate_en'
  | 'flashcards'
  | 'todo';

export interface QuickActionMeta {
  id: QuickActionId;
  label: string;
  emoji: string;
  description: string;
}

export const QUICK_ACTIONS: QuickActionMeta[] = [
  { id: 'summary',      emoji: '📝', label: '要約を追加',           description: 'メモを3〜5文に要約して末尾に挿入' },
  { id: 'proofread',    emoji: '✨', label: '校正版を追加',         description: '誤字脱字・文法を直した版を末尾に挿入' },
  { id: 'translate_en', emoji: '🌐', label: '英語に翻訳',           description: 'メモを自然な英語にして末尾に挿入' },
  { id: 'flashcards',   emoji: '🧠', label: 'フラッシュカード生成', description: '重要語を抜き出し単語カード化（学習）' },
  { id: 'todo',         emoji: '✅', label: 'ToDoを抽出',           description: 'メモ内のアクションをチェックリスト化' },
];

export interface QAPair {
  q: string;
  a: string;
  opts?: string[];
}

export type QuickActionResult =
  | { kind: 'text';      html: string }
  | { kind: 'qa';        qaKind: 'flash'; pairs: QAPair[] }
  | { kind: 'tasklist';  items: string[] };

// Escape for HTML insertion.
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Convert plain text (possibly multi-paragraph) into safe HTML paragraphs.
function textToHtmlParagraphs(text: string): string {
  return text
    .split(/\n{2,}/)
    .map(p => p.trim())
    .filter(Boolean)
    .map(p => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

// Try to pull a JSON object/array out of a model response. Models sometimes
// wrap JSON in ```json ... ``` fences or add a brief preamble.
function extractJson(text: string): unknown | null {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fence ? fence[1] : text).trim();
  // Find the first { or [ and the matching last } or ].
  const start = Math.min(
    ...['{', '['].map(c => {
      const i = candidate.indexOf(c);
      return i < 0 ? Number.POSITIVE_INFINITY : i;
    })
  );
  if (!Number.isFinite(start)) return null;
  const open = candidate[start];
  const close = open === '{' ? '}' : ']';
  const end = candidate.lastIndexOf(close);
  if (end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

const SYSTEM_BASE = `あなたはメモアプリ「Lily Memo」の AI 支援機能です。ユーザーの指示に厳密に従い、要求された形式のみを返してください。前置きや言い訳は一切書かないこと。`;

function buildPrompt(action: QuickActionId, noteText: string, noteTitle: string): { system: string; user: string } {
  const head = `メモのタイトル: ${noteTitle || '(無題)'}\nメモの内容:\n"""\n${noteText}\n"""`;

  switch (action) {
    case 'summary':
      return {
        system: SYSTEM_BASE,
        user: `${head}\n\nこのメモを日本語で 3〜5 文に要約してください。要点だけを箇条書きではなく短い文章で。要約本文のみを出力（見出しや前置きは不要）。`,
      };
    case 'proofread':
      return {
        system: SYSTEM_BASE,
        user: `${head}\n\nこのメモの誤字脱字・てにをは・不自然な表現を直した日本語版を出力してください。元の意味と構成は保ち、できるだけ原文の表現を尊重すること。校正後の本文だけを出力（コメントや差分は不要）。`,
      };
    case 'translate_en':
      return {
        system: SYSTEM_BASE,
        user: `${head}\n\nこのメモを自然で読みやすい英語に翻訳してください。固有名詞はそのままで構いません。英訳本文のみを出力。`,
      };
    case 'flashcards':
      return {
        system: SYSTEM_BASE,
        user: `${head}\n\nこのメモから学習用の単語カードを 8〜16 枚作成してください。重要な用語・概念・人物・年号・式などを取り上げます。
出力は次の JSON 形式のみ（コードフェンスや説明文は不要）:
{"items":[{"q":"用語または短い質問","a":"その定義/答え（1〜2文）"}, ...]}
- q は 30 文字以内を目安に短く
- a は簡潔で正確に
- 同じ語の繰り返しは避ける`,
      };
    case 'todo':
      return {
        system: SYSTEM_BASE,
        user: `${head}\n\nこのメモから実行すべきタスク・ToDo・締切のあるアクションを抽出してください。
出力は次の JSON 形式のみ（コードフェンスや説明文は不要）:
{"items":["タスク1", "タスク2", ...]}
- 各タスクは命令形の短い1文（〜する／〜を確認する 等）
- メモに含まれない作業は捏造しない
- ToDo が見つからない場合は {"items":[]} を返す`,
      };
  }
}

interface FlashItem { q: string; a: string; }

export async function runQuickAction(
  action: QuickActionId,
  noteText: string,
  noteTitle: string,
  apiKey: string,
): Promise<QuickActionResult> {
  const { system, user } = buildPrompt(action, noteText, noteTitle);
  const history: ChatTurn[] = [{ role: 'user', text: user }];
  const raw = await callGeminiChat(history, system, apiKey);

  switch (action) {
    case 'summary': {
      const html =
        `<h3>📝 要約</h3>` + textToHtmlParagraphs(raw);
      return { kind: 'text', html };
    }
    case 'proofread': {
      const html =
        `<h3>✨ 校正版</h3>` + textToHtmlParagraphs(raw);
      return { kind: 'text', html };
    }
    case 'translate_en': {
      const html =
        `<h3>🌐 English Translation</h3>` + textToHtmlParagraphs(raw);
      return { kind: 'text', html };
    }
    case 'flashcards': {
      const data = extractJson(raw) as { items?: FlashItem[] } | null;
      const items = Array.isArray(data?.items) ? data!.items : [];
      const pairs: QAPair[] = items
        .filter(it => it && typeof it.q === 'string' && typeof it.a === 'string')
        .map(it => ({ q: it.q.trim(), a: it.a.trim() }));
      if (pairs.length === 0) throw new Error('フラッシュカードを生成できませんでした');
      return { kind: 'qa', qaKind: 'flash', pairs };
    }
    case 'todo': {
      const data = extractJson(raw) as { items?: string[] } | null;
      const items = Array.isArray(data?.items)
        ? data!.items.map(s => String(s).trim()).filter(Boolean)
        : [];
      if (items.length === 0) throw new Error('抽出できる ToDo が見つかりませんでした');
      return { kind: 'tasklist', items };
    }
  }
}
