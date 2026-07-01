// In-memory-only chat context for the floating Instance Sikun. Deliberately
// not persisted anywhere — sikun has no memory of past sessions, and even
// within a single session only the most recent exchange pair is kept as
// context for short follow-up questions ("that", "the second one", etc.).

import type { ChatTurn } from './gemini';

const MAX_SIKUN_MESSAGES = 4; // 直前の会話2件（ユーザー発言+sikun応答のペア × 2）

export interface SikunMessage {
  id: string;
  role: 'user' | 'sikun';
  text: string;
  ts: number;
}

export function capSikunHistory(msgs: SikunMessage[]): SikunMessage[] {
  return msgs.slice(-MAX_SIKUN_MESSAGES);
}

export function toChatTurns(msgs: SikunMessage[]): ChatTurn[] {
  return msgs.map(m => ({
    role: m.role === 'user' ? 'user' : 'model',
    text: m.text,
  }));
}
