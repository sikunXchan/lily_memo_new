'use client';

// Which built-in tones the user has enabled to show as chips in the chat. Kept
// small by default so the tone row stays uncluttered; users enable more from
// the toolbox modal. (Skills and shortcuts manage their own storage since
// they're user-authored — see lib/skills.ts and lib/shortcuts.ts.)

import { useEffect, useState } from 'react';

const KEY = 'lily-enabled-tones-v1';
const EVENT = 'lily-tones-changed';

const DEFAULT_TONES: string[] = [];

function load(): string[] {
  if (typeof window === 'undefined') return DEFAULT_TONES;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_TONES;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : DEFAULT_TONES;
  } catch {
    return DEFAULT_TONES;
  }
}

function save(list: string[]) {
  localStorage.setItem(KEY, JSON.stringify(list));
  window.dispatchEvent(new Event(EVENT));
}

export function toggleTone(id: string) {
  const list = load();
  save(list.includes(id) ? list.filter(x => x !== id) : [...list, id]);
}

export function useEnabledTones(): string[] {
  const [list, setList] = useState<string[]>(load());
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
