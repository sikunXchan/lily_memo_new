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

const DEFAULTS: Shortcut[] = [
  { id: 'nichikore', label: '📚 日これ', prompt: 'これらの資料から問題(qa)を作成して。単語を問う問題形式で全ての単語を網羅してください。また、時系列順に並べてください。\n答えには読み方をふってください。\n\n【絶対厳守】資料に含まれる全ての単語を1つも漏らさず必ず全て問題にすること。「など」「以下省略」「…」で途中で止めることは禁止。最後の単語まで出力すること。' },
  { id: 'continue', label: '▶ 続きを書いて', prompt: '問題が途中で止まっています。続きの未出題の単語を全て、同じ形式・同じqaブロック内で続けて出力してください。重複は入れず、まだ出題されていない単語だけを残らず書いてください。' },
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
    return Array.isArray(parsed) ? parsed : DEFAULTS;
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
