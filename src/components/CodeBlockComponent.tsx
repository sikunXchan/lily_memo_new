'use client';

import { NodeViewContent, NodeViewWrapper } from '@tiptap/react';
import React from 'react';

const LANGUAGES = [
  'javascript', 'typescript', 'python', 'rust', 'cpp', 'c', 'java', 'go', 
  'bash', 'powershell', 'html', 'css', 'json', 'yaml', 'markdown'
];

export default function CodeBlockComponent({ node: { attrs }, updateAttributes }: any) {
  return (
    <NodeViewWrapper className="code-block-wrapper">
      <div className="code-block-header" contentEditable={false}>
        <select
          defaultValue={attrs.language || 'auto'}
          onChange={event => updateAttributes({ language: event.target.value })}
          className="lang-select"
        >
          <option value="auto">auto</option>
          {LANGUAGES.map(lang => (
            <option key={lang} value={lang}>{lang}</option>
          ))}
        </select>
        <span className="lang-label">{attrs.language || 'code'}</span>
      </div>
      <pre className="code-content">
        <NodeViewContent as="div" />
      </pre>

      <style jsx>{`
        .code-block-wrapper {
          position: relative;
          margin: 1.5rem 0;
          background: #2d2d2d;
          border-radius: 12px;
          overflow: hidden;
          box-shadow: 0 4px 12px rgba(0,0,0,0.1);
        }
        .code-block-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 16px;
          background: rgba(255,255,255,0.05);
          border-bottom: 1px solid rgba(255,255,255,0.1);
        }
        .lang-select {
          background: #444;
          color: #eee;
          border: none;
          font-size: 0.75rem;
          padding: 2px 8px;
          border-radius: 4px;
          outline: none;
          cursor: pointer;
        }
        .lang-label {
          font-size: 0.7rem;
          text-transform: uppercase;
          color: #888;
          font-weight: 700;
          letter-spacing: 1px;
        }
        pre {
          margin: 0;
          padding: 1rem;
        }
      `}</style>
    </NodeViewWrapper>
  );
}
