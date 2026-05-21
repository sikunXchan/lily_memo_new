// Lightweight localStorage persistence for the floating Instance Sikun
// chat. Keeps history independent from the AI-tab conversation.

import type { ChatTurn } from './gemini';

const KEY = 'lily_instance_sikun_history';
const MAX_TURNS = 20;

export interface SikunMessage {
  id: string;
  role: 'user' | 'sikun';
  text: string;
  ts: number;
}

export function loadSikunHistory(): SikunMessage[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SikunMessage[];
    return Array.isArray(parsed) ? parsed.slice(-MAX_TURNS) : [];
  } catch {
    return [];
  }
}

export function saveSikunHistory(msgs: SikunMessage[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(KEY, JSON.stringify(msgs.slice(-MAX_TURNS)));
  } catch {
    // localStorage full — drop oldest aggressively
    try {
      localStorage.setItem(KEY, JSON.stringify(msgs.slice(-10)));
    } catch { /* give up */ }
  }
}

export function clearSikunHistory(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(KEY);
}

export function toChatTurns(msgs: SikunMessage[]): ChatTurn[] {
  return msgs.map(m => ({
    role: m.role === 'user' ? 'user' : 'model',
    text: m.text,
  }));
}
