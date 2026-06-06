'use client';

// User-curated "toolbox": which tones / skills / shortcut commands show up in
// the chat UI. Default to a small starter set so the chat stays uncluttered;
// users can add more (or remove the defaults) from the toolbox modal.

import { useEffect, useState } from 'react';

export type ToolboxCategory = 'tones' | 'skills' | 'shortcuts';

export interface ToolboxState {
  tones: string[];
  skills: string[];
  shortcuts: string[];
}

const KEY = 'lily-toolbox-enabled-v1';
const EVENT = 'lily-toolbox-changed';

const DEFAULTS: ToolboxState = {
  tones: ['casual', 'easy'],
  skills: [],
  shortcuts: ['compact', 'clear', 'search', 'quiz', 'review'],
};

function load(): ToolboxState {
  if (typeof window === 'undefined') return DEFAULTS;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw);
    return {
      tones: Array.isArray(parsed.tones) ? parsed.tones : DEFAULTS.tones,
      skills: Array.isArray(parsed.skills) ? parsed.skills : DEFAULTS.skills,
      shortcuts: Array.isArray(parsed.shortcuts) ? parsed.shortcuts : DEFAULTS.shortcuts,
    };
  } catch {
    return DEFAULTS;
  }
}

function save(state: ToolboxState) {
  localStorage.setItem(KEY, JSON.stringify(state));
  window.dispatchEvent(new Event(EVENT));
}

export function getToolboxState(): ToolboxState {
  return load();
}

export function toggleToolboxItem(category: ToolboxCategory, id: string) {
  const state = load();
  const list = state[category];
  state[category] = list.includes(id) ? list.filter(x => x !== id) : [...list, id];
  save(state);
}

export function useToolbox(): ToolboxState {
  const [state, setState] = useState<ToolboxState>(load());
  useEffect(() => {
    const handler = () => setState(load());
    window.addEventListener(EVENT, handler);
    window.addEventListener('storage', handler);
    return () => {
      window.removeEventListener(EVENT, handler);
      window.removeEventListener('storage', handler);
    };
  }, []);
  return state;
}
