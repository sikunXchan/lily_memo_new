import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import dynamic from 'next/dynamic';

const MermaidComponent = dynamic(() => import('@/components/MermaidComponent'), { ssr: false });
const ChartComponent = dynamic(() => import('@/components/ChartComponent'), { ssr: false });
const QAComponent = dynamic(() => import('@/components/QAComponent'), { ssr: false });

export const MermaidExtension = Node.create({
  name: 'mermaid',
  group: 'block',
  atom: true,
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

export const QAExtension = Node.create({
  name: 'qa',
  group: 'block',
  atom: true,
  addAttributes() {
    return {
      pairs: { default: [] },
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
