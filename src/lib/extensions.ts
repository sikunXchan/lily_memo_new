import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import MermaidComponent from '@/components/MermaidComponent';
import ChartComponent from '@/components/ChartComponent';

export const MermaidExtension = Node.create({
  name: 'mermaid',
  group: 'block',
  atom: true,
  addAttributes() {
    return {
      content: { default: '' },
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
  addAttributes() {
    return {
      data: { default: null },
      type: { default: 'bar' },
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
