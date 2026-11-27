'use client';

// Quiz helpers for sikun's in-note "問題" mode.
//
// Questions come from the note's Q&A blocks (`div[data-type="qa"]`, pairs in
// `data-pairs`). Ticking a question from the quiz writes `checked` back into
// the note. While the note is open in NoteEditor the editor owns the content
// (it would overwrite a direct DB write on its next save), so every read and
// write first goes through a window event that NoteEditor answers
// synchronously; only when nobody answers do we touch IndexedDB directly.

import { db } from './db';

export interface QuizPair { q: string; a: string; opts?: string[]; checked?: boolean }

export interface QuizItem extends QuizPair {
  /** index of the Q&A block in document order */
  block: number;
  /** index of the pair inside that block */
  index: number;
}

export const NOTE_HTML_EVENT = 'sikun-note-html';
export const QA_CHECK_EVENT = 'sikun-qa-check';
export const QA_APPEND_EVENT = 'sikun-qa-append';

export interface NoteHtmlDetail { noteId: number; html?: string }
export interface QaCheckDetail { noteId: number; block: number; index: number; q: string; checked: boolean; handled?: boolean }
export interface QaAppendDetail { noteId: number; pair: QuizPair; handled?: boolean; block?: number; index?: number }

function parsePairs(raw: string | null): QuizPair[] {
  try {
    const arr = JSON.parse(raw || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function validPair(p: unknown): p is QuizPair {
  const x = p as QuizPair;
  return !!x && typeof x.q === 'string' && x.q.trim() !== '' && typeof x.a === 'string';
}

export function extractQuizItems(html: string): QuizItem[] {
  if (!html || typeof DOMParser === 'undefined') return [];
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const items: QuizItem[] = [];
  doc.querySelectorAll('div[data-type="qa"]').forEach((el, block) => {
    parsePairs(el.getAttribute('data-pairs')).forEach((p, index) => {
      if (validPair(p)) items.push({ ...p, block, index });
    });
  });
  return items;
}

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Latest HTML of a note — from the live editor when it is open. */
export async function readNoteHtml(noteId: number): Promise<{ html: string; title: string }> {
  const detail: NoteHtmlDetail = { noteId };
  window.dispatchEvent(new CustomEvent(NOTE_HTML_EVENT, { detail }));
  const note = await db.notes.get(noteId);
  return { html: detail.html ?? note?.content ?? '', title: note?.title || '' };
}

function serialize(doc: Document): string {
  return doc.body.innerHTML;
}

/** Tick / untick one question. Returns false if the question moved or vanished. */
export async function setQuizChecked(noteId: number, item: QuizItem, checked: boolean): Promise<boolean> {
  const detail: QaCheckDetail = { noteId, block: item.block, index: item.index, q: item.q, checked };
  window.dispatchEvent(new CustomEvent(QA_CHECK_EVENT, { detail }));
  if (detail.handled !== undefined) return detail.handled;

  const note = await db.notes.get(noteId);
  if (!note?.content) return false;
  const doc = new DOMParser().parseFromString(note.content, 'text/html');
  const el = doc.querySelectorAll('div[data-type="qa"]')[item.block];
  if (!el) return false;
  const pairs = parsePairs(el.getAttribute('data-pairs'));
  if (pairs[item.index]?.q !== item.q) return false;
  pairs[item.index] = { ...pairs[item.index], checked };
  el.setAttribute('data-pairs', JSON.stringify(pairs));
  await db.notes.update(noteId, { content: serialize(doc), updatedAt: Date.now() });
  return true;
}

/** Save an AI-made question at the end of the note as a new Q&A block. */
export async function appendQuizPair(noteId: number, pair: QuizPair): Promise<QuizItem | null> {
  const detail: QaAppendDetail = { noteId, pair };
  window.dispatchEvent(new CustomEvent(QA_APPEND_EVENT, { detail }));
  if (detail.handled) {
    return detail.block !== undefined ? { ...pair, block: detail.block, index: detail.index ?? 0 } : null;
  }

  const note = await db.notes.get(noteId);
  if (!note) return null;
  const doc = new DOMParser().parseFromString(note.content || '', 'text/html');
  const block = doc.querySelectorAll('div[data-type="qa"]').length;
  const el = doc.createElement('div');
  el.setAttribute('data-type', 'qa');
  el.setAttribute('data-kind', 'qa');
  el.setAttribute('data-pairs', JSON.stringify([pair]));
  doc.body.appendChild(el);
  await db.notes.update(noteId, { content: serialize(doc), updatedAt: Date.now() });
  return { ...pair, block, index: 0 };
}

/** Parse "Q: …\nA: …" (answer may span several lines). */
export function parseQA(reply: string): QuizPair | null {
  const m = reply.trim().match(/Q\s*[:：]\s*([\s\S]+?)\n+\s*A\s*[:：]\s*([\s\S]+)$/i);
  if (!m) return null;
  const q = m[1].trim();
  const a = m[2].trim();
  return q && a ? { q, a } : null;
}
