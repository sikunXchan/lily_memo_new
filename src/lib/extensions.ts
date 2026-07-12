import { Node, mergeAttributes, nodeInputRule } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import dynamic from 'next/dynamic';

const MermaidComponent = dynamic(() => import('@/components/MermaidComponent'), { ssr: false });
const ChartComponent = dynamic(() => import('@/components/ChartComponent'), { ssr: false });
const QAComponent = dynamic(() => import('@/components/QAComponent'), { ssr: false });
const ResizableImageComponent = dynamic(() => import('@/components/ResizableImageComponent'), { ssr: false });
const GeometryComponent = dynamic(() => import('@/components/GeometryComponent'), { ssr: false });
const HandwritingBlockComponent = dynamic(() => import('@/components/HandwritingBlock'), { ssr: false });
const MathComponent = dynamic(() => import('@/components/MathComponent'), { ssr: false });

export const MermaidExtension = Node.create({
  name: 'mermaid',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      content: { default: '' },
      width: { default: '100%' },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="mermaid"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'mermaid' })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(MermaidComponent);
  },
});

export const ChartExtension = Node.create({
  name: 'chart',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      data: { default: null },
      type: { default: 'bar' },
      code: { default: null },
      fileData: { default: null },
      fileName: { default: null },
      width: { default: '100%' },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="chart"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'chart' })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(ChartComponent);
  },
});

export const ResizableImageExtension = Node.create({
  name: 'image',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      src: {
        default: null,
        parseHTML: (element) =>
          element.getAttribute('data-src') || element.getAttribute('src'),
      },
      alt: {
        default: null,
        parseHTML: (element) =>
          element.getAttribute('data-alt') || element.getAttribute('alt'),
      },
      title: {
        default: null,
        parseHTML: (element) =>
          element.getAttribute('data-title') || element.getAttribute('title'),
      },
      width: {
        default: '100%',
        parseHTML: (element) =>
          element.getAttribute('data-width') || '100%',
      },
    };
  },
  parseHTML() {
    return [
      { tag: 'div[data-type="resizable-image"]' },
      { tag: 'img[src]' }, // 旧フォーマットとの後方互換
    ];
  },
  renderHTML({ HTMLAttributes }) {
    const { src, alt, title, width } = HTMLAttributes;
    const divAttrs: Record<string, string> = {
      'data-type': 'resizable-image',
      'data-src': src ?? '',
      'data-width': width ?? '100%',
    };
    if (alt) divAttrs['data-alt'] = alt;
    if (title) divAttrs['data-title'] = title;
    const imgAttrs: Record<string, string> = { src: src ?? '' };
    if (alt) imgAttrs.alt = alt;
    if (title) imgAttrs.title = title;
    return ['div', divAttrs, ['img', imgAttrs]];
  },
  addNodeView() {
    return ReactNodeViewRenderer(ResizableImageComponent);
  },
});

export const QAExtension = Node.create({
  name: 'qa',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      pairs: {
        default: [],
        parseHTML: (element) => {
          try {
            return JSON.parse(element.getAttribute('data-pairs') || '[]');
          } catch {
            return [];
          }
        },
        renderHTML: (attributes) => ({
          'data-pairs': JSON.stringify(attributes.pairs || []),
        }),
      },
      kind: {
        default: 'qa',
        parseHTML: (element) => element.getAttribute('data-kind') || 'qa',
        renderHTML: (attributes) => ({
          'data-kind': attributes.kind || 'qa',
        }),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="qa"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'qa' })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(QAComponent);
  },
});

export const GeometryExtension = Node.create({
  name: 'geometry',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      code: { default: '' },
      width: { default: '100%' },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="geometry"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'geometry' })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(GeometryComponent);
  },
});

export const HandwritingExtension = Node.create({
  name: 'handwriting',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      data: {
        default: JSON.stringify({ strokes: [], width: 1280, height: 900 }),
        parseHTML: el => el.getAttribute('data-hw') || '{}',
        renderHTML: attrs => ({ 'data-hw': attrs.data }),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="handwriting"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'handwriting' })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(HandwritingBlockComponent);
  },
});

// ── Math (KaTeX) ─────────────────────────────────────────────────────────────
// Two atom nodes: `mathInline` ($…$) lives inside a paragraph; `mathBlock`
// ($$…$$) is its own block. Both store raw LaTeX in the `latex` attribute
// (serialized as data-latex) and render via KaTeX in MathComponent. Input rules
// let the user type `$x^2$` / `$$…$$` and have it convert on the closing `$`.

const latexAttr = {
  latex: {
    default: '',
    parseHTML: (el: HTMLElement) => el.getAttribute('data-latex') || '',
    renderHTML: (attrs: Record<string, unknown>) => ({ 'data-latex': (attrs.latex as string) || '' }),
  },
};

export const MathInlineExtension = Node.create({
  name: 'mathInline',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return latexAttr;
  },
  parseHTML() {
    return [{ tag: 'span[data-type="math-inline"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-type': 'math-inline' })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(MathComponent);
  },
  addInputRules() {
    return [
      nodeInputRule({
        // `$…$` — no whitespace right inside the delimiters, no nested `$`.
        // Lookbehind (not a capture) so the char before `$` is not consumed,
        // and so a preceding `$` (i.e. `$$`) never triggers inline math.
        find: /(?<![\\$])\$([^$\n]+?)\$$/,
        type: this.type,
        getAttributes: match => ({ latex: (match[1] || '').trim() }),
      }),
    ];
  },
});

export const MathBlockExtension = Node.create({
  name: 'mathBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return latexAttr;
  },
  parseHTML() {
    return [{ tag: 'div[data-type="math-block"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'math-block' })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(MathComponent);
  },
  addInputRules() {
    return [
      nodeInputRule({
        // `$$…$$` typed on a line converts to a display-math block.
        find: /^\$\$([^$\n]+?)\$\$$/,
        type: this.type,
        getAttributes: match => ({ latex: (match[1] || '').trim() }),
      }),
    ];
  },
});
