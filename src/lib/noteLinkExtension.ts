import { Node, mergeAttributes, InputRule } from '@tiptap/core';

export const NoteLinkExtension = Node.create({
  name: 'noteLink',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return {
      title: { default: '' },
      noteId: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-note-link]' }];
  },

  renderHTML({ HTMLAttributes }) {
    const { title, noteId } = HTMLAttributes;
    return [
      'span',
      mergeAttributes(
        { 'data-note-link': '', 'data-note-title': title ?? '', 'data-note-id': noteId ?? '', class: 'note-link' },
      ),
      `[[${title ?? ''}]]`,
    ];
  },

  addInputRules() {
    return [
      new InputRule({
        find: /\[\[([^\[\]\n]+)\]\]$/,
        handler: ({ state, range, match }) => {
          const title = match[1].trim();
          if (!title) return null;
          const node = state.schema.nodes.noteLink.create({ title });
          return state.tr.replaceWith(range.from, range.to, node);
        },
      }),
    ];
  },
});
