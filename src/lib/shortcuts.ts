'use client';

// "Shortcuts" = one-tap canned prompts (e.g. 続きを書いて, メール文面). Tapping
// one drops its text into the input box so you can tweak it before sending.
// Unlike skills (which change behaviour via the system prompt) and slash
// commands (which trigger an action), a shortcut is just a reusable message.
// Users can create their own; the defaults below are editable samples.

import { useEffect, useState } from 'react';

export interface Shortcut {
  id: string;
  label: string;
  prompt: string;
}

const KEY = 'lily-shortcuts-v1';
const EVENT = 'lily-shortcuts-changed';

const VOCAB_SHORTCUT: Shortcut = {
  id: 'vocab',
  label: '🔤 英単語帳→問題',
  prompt: `この英単語帳の画像を解析して、qaか穴埋めの問題を作成してください。qaか穴埋め問題かはユーザーに必ず質問をすること。
以下のルールを厳守して出力してください。
フォーマット: 問題の出力番号.[英文の例文] [その日本語翻訳文] を1セットとする。また、隠された単語を答えとして1,2,3,のように該当の問題の番号をふる。
穴埋め問題化: 画像内で「赤色」で書かれている英単語は、テストに出る重要部分です。その部分は必ず [____] という空欄に置き換えて出力してください。空欄の先頭に答えの1文字目を事前に記述する。
不要な情報の除外: 単語の番号（1011など）、発音記号、品詞ラベル、見出し語単体などは含めず、純粋に「例文」と「訳」のペアだけを抽出してください。
出力例:
問題
1.Be careful! That glass is close to the [e____] of the table. 気をつけて！グラスがテーブルの端に近いよ。
2. . . . . 続く
答え
1.edge
2. 続く
そして生成した内容を問題セッションを問題に、答えのセッションを答えに挿入し、qaか穴埋め問題のどちらかの問題形式の問題を作成してください。`,
};

const DEFAULTS: Shortcut[] = [
  { id: 'nichikore', label: '📚 日これ', prompt: 'これらの資料から問題(qa)を作成して。単語を問う問題形式で全ての単語を網羅してください。また、時系列順に並べてください。\n答えには読み方をふってください。\n\n【絶対厳守】資料に含まれる全ての単語を1つも漏らさず必ず全て問題にすること。「など」「以下省略」「…」で途中で止めることは禁止。最後の単語まで出力すること。' },
  { id: 'continue', label: '▶ 続きを書いて', prompt: '問題が途中で止まっています。続きの未出題の単語を全て、同じ形式・同じqaブロック内で続けて出力してください。重複は入れず、まだ出題されていない単語だけを残らず書いてください。' },
  VOCAB_SHORTCUT,
  { id: 'email', label: '📧 メール文面', prompt: 'このメモの内容を元に、そのまま送れる丁寧なメールの下書きを作って。件名も付けてね。' },
  { id: 'blog', label: '📝 ブログ案', prompt: 'このメモを元に、ブログ記事のタイトル案を3つと、それぞれの構成案を提案して。' },
  { id: 'detail', label: '🔎 詳しく調べて', prompt: 'このメモに出てくる専門用語や関連トピックを、ネットの情報も使ってもう少し詳しく補足して。' },
];

function load(): Shortcut[] {
  if (typeof window === 'undefined') return DEFAULTS;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULTS;
    // Back-fill any built-in shortcuts that are missing from the stored list
    // (handles users whose localStorage pre-dates a default being added/restored).
    const storedIds = new Set(parsed.map((s: Shortcut) => s.id));
    const missing = DEFAULTS.filter(d => !storedIds.has(d.id));
    if (missing.length > 0) {
      const merged = [...missing, ...parsed];
      localStorage.setItem(KEY, JSON.stringify(merged));
      return merged;
    }
    return parsed;
  } catch {
    return DEFAULTS;
  }
}

function persist(list: Shortcut[]) {
  localStorage.setItem(KEY, JSON.stringify(list));
  window.dispatchEvent(new Event(EVENT));
}

export function getShortcuts(): Shortcut[] {
  return load();
}

export function saveShortcut(sc: Shortcut) {
  const list = load();
  const idx = list.findIndex(s => s.id === sc.id);
  if (idx >= 0) list[idx] = sc;
  else list.push(sc);
  persist(list);
}

export function deleteShortcut(id: string) {
  persist(load().filter(s => s.id !== id));
}

export function useShortcuts(): Shortcut[] {
  const [list, setList] = useState<Shortcut[]>(load());
  useEffect(() => {
    const handler = () => setList(load());
    window.addEventListener(EVENT, handler);
    window.addEventListener('storage', handler);
    return () => {
      window.removeEventListener(EVENT, handler);
      window.removeEventListener('storage', handler);
    };
  }, []);
  return list;
}
