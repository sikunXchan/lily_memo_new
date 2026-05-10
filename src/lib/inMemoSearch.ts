import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as ProsemirrorNode } from '@tiptap/pm/model';

export interface SearchState {
  decos: DecorationSet;
  matches: Array<{ from: number; to: number }>;
  currentIndex: number;
}

export const searchPluginKey = new PluginKey<SearchState>('inMemoSearch');

export function getSearchMatches(doc: ProsemirrorNode, query: string): Array<{ from: number; to: number }> {
  const matches: Array<{ from: number; to: number }> = [];
  if (!query) return matches;
  const lower = query.toLowerCase();
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    const text = node.text.toLowerCase();
    let idx = text.indexOf(lower);
    while (idx !== -1) {
      matches.push({ from: pos + idx, to: pos + idx + lower.length });
      idx = text.indexOf(lower, idx + 1);
    }
  });
  return matches;
}

export const InMemoSearchExtension = Extension.create({
  name: 'inMemoSearch',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: searchPluginKey,
        state: {
          init(): SearchState {
            return { decos: DecorationSet.empty, matches: [], currentIndex: -1 };
          },
          apply(tr, prev): SearchState {
            const meta = tr.getMeta(searchPluginKey) as { query: string; currentIndex: number } | undefined;
            if (meta !== undefined) {
              const { query, currentIndex } = meta;
              const matches = getSearchMatches(tr.doc, query);
              const decos = matches.map((m, i) =>
                Decoration.inline(m.from, m.to, {
                  class: i === currentIndex ? 'search-highlight current' : 'search-highlight',
                })
              );
              return { decos: DecorationSet.create(tr.doc, decos), matches, currentIndex };
            }
            return {
              decos: prev.decos.map(tr.mapping, tr.doc),
              matches: prev.matches,
              currentIndex: prev.currentIndex,
            };
          },
        },
        props: {
          decorations(state) {
            return searchPluginKey.getState(state)?.decos ?? DecorationSet.empty;
          },
        },
      }),
    ];
  },
});
