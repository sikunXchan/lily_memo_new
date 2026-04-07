'use client';

import { NodeViewContent, NodeViewWrapper } from '@tiptap/react';
import React from 'react';

const LANGUAGES = [
  'javascript', 'typescript', 'python', 'rust', 'cpp', 'c', 'java', 'go', 
  'bash', 'powershell', 'html', 'css', 'json', 'yaml', 'markdown'
];

export default function CodeBlockComponent({ node: { attrs }, updateAttributes }: any) {
  const theme = attrs.theme || 'dark';

  return (
    <NodeViewWrapper className={`code-block-wrapper ${theme}-theme`}>
      <div className="code-block-header" contentEditable={false}>
        <div className="header-controls">
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
          <button 
            className="btn-theme-toggle" 
            onClick={() => updateAttributes({ theme: theme === 'dark' ? 'light' : 'dark' })}
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
        </div>
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
          transition: all 0.3s;
        }
        .light-theme {
          background: #fdfdfd;
          border: 1px solid #ddd;
          box-shadow: 0 2px 8px rgba(0,0,0,0.05);
        }
        .light-theme :global(.code-content) {
          color: #333;
        }
        .code-block-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 16px;
          background: rgba(0,0,0,0.1);
          border-bottom: 1px solid rgba(0,0,0,0.1);
        }
        .light-theme .code-block-header {
          background: #f0f0f0;
          border-bottom: 1px solid #ddd;
        }
        .header-controls {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .lang-select {
          background: rgba(0,0,0,0.2);
          color: inherit;
          border: none;
          font-size: 0.75rem;
          padding: 2px 8px;
          border-radius: 4px;
          outline: none;
          cursor: pointer;
        }
        .btn-theme-toggle {
          background: transparent;
          font-size: 1rem;
          padding: 0;
          opacity: 0.7;
          transition: opacity 0.2s;
        }
        .btn-theme-toggle:hover {
          opacity: 1;
        }
        .lang-label {
          font-size: 0.7rem;
          text-transform: uppercase;
          color: #888;
          font-weight: 700;
          letter-spacing: 1px;
        }
        .code-content {
          margin: 0;
          padding: 1rem;
          overflow-x: auto;
        }
      `}</style>
    </NodeViewWrapper>
  );
}
