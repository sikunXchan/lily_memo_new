'use client';

import { NodeViewContent, NodeViewWrapper } from '@tiptap/react';
import React, { useState, useEffect } from 'react';

const LANGUAGES = [
  'javascript', 'typescript', 'python', 'rust', 'cpp', 'c', 'java', 'go',
  'bash', 'powershell', 'html', 'css', 'json', 'yaml', 'markdown'
];

export default function CodeBlockComponent({ node: { attrs }, updateAttributes }: any) {
  // ローカルstateで管理することでTiptapのre-render待ちなく即座にUIが切り替わる
  const [theme, setTheme] = useState<'dark' | 'light'>(attrs.theme || 'dark');

  // 保存済みコンテンツを読み込んだときにattrsと同期
  useEffect(() => {
    const incoming = attrs.theme || 'dark';
    if (incoming !== theme) {
      setTheme(incoming as 'dark' | 'light');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attrs.theme]);

  const toggleTheme = () => {
    const next: 'dark' | 'light' = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    updateAttributes({ theme: next });
  };

  return (
    <NodeViewWrapper className={`code-block-wrapper ${theme}-theme`}>
      <div className="code-block-header" contentEditable={false}>
        <div className="header-controls">
          <select
            value={attrs.language || 'auto'}
            onChange={event => updateAttributes({ language: event.target.value })}
            className="lang-select"
          >
            <option value="auto">auto</option>
            {LANGUAGES.map(lang => (
              <option key={lang} value={lang}>{lang}</option>
            ))}
          </select>
          <button className="btn-theme-toggle" onClick={toggleTheme} title="背景色切替">
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
          background: #1e1e1e;
          border-radius: 12px;
          overflow: hidden;
          box-shadow: 0 4px 12px rgba(0,0,0,0.15);
          transition: background 0.25s, border 0.25s;
        }
        .light-theme {
          background: #f8f8f8;
          border: 1px solid #e0e0e0;
          box-shadow: 0 2px 8px rgba(0,0,0,0.06);
        }
        .code-block-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 14px;
          background: rgba(255,255,255,0.05);
          border-bottom: 1px solid rgba(255,255,255,0.08);
        }
        .light-theme .code-block-header {
          background: #efefef;
          border-bottom: 1px solid #ddd;
        }
        .header-controls {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .lang-select {
          background: rgba(255,255,255,0.1);
          color: #ccc;
          border: none;
          font-size: 0.75rem;
          padding: 2px 8px;
          border-radius: 4px;
          outline: none;
          cursor: pointer;
        }
        .light-theme .lang-select {
          background: #ddd;
          color: #444;
        }
        .btn-theme-toggle {
          background: transparent;
          font-size: 1rem;
          padding: 0;
          opacity: 0.8;
          transition: opacity 0.2s, transform 0.2s;
          line-height: 1;
        }
        .btn-theme-toggle:hover { opacity: 1; transform: scale(1.1); }
        .lang-label {
          font-size: 0.68rem;
          text-transform: uppercase;
          color: #666;
          font-weight: 700;
          letter-spacing: 1px;
        }
        .light-theme .lang-label { color: #999; }
        .code-content {
          margin: 0;
          padding: 1rem 1.25rem;
          overflow-x: auto;
          font-family: 'Fira Code', 'Cascadia Code', 'Consolas', monospace;
          font-size: 0.9rem;
          line-height: 1.6;
          color: #d4d4d4;
        }
        .light-theme :global(.code-content) {
          color: #333;
        }
      `}</style>
    </NodeViewWrapper>
  );
}
