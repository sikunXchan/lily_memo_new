'use client';

import { NodeViewContent, NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react';
import React, { useState, useEffect, CSSProperties } from 'react';

const LANGUAGES = [
  'javascript', 'typescript', 'python', 'rust', 'cpp', 'c', 'java', 'go',
  'bash', 'powershell', 'html', 'css', 'json', 'yaml', 'markdown'
];

export default function CodeBlockComponent({ node: { attrs }, updateAttributes }: ReactNodeViewProps) {
  // インラインスタイルで管理: styled-jsxはTiptap NodeViewRenderer内で正しく動作しないため
  const [theme, setTheme] = useState<'dark' | 'light'>(attrs.theme || 'dark');

  useEffect(() => {
    const incoming = (attrs.theme as 'dark' | 'light') || 'dark';
    if (incoming !== theme) setTheme(incoming);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attrs.theme]);

  const toggleTheme = () => {
    const next: 'dark' | 'light' = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    updateAttributes({ theme: next });
  };

  const isDark = theme === 'dark';

  const wrapperStyle: CSSProperties = {
    position: 'relative',
    margin: '1.5rem 0',
    borderRadius: '12px',
    overflow: 'hidden',
    background: isDark ? '#1e1e1e' : '#f6f8fa',
    border: isDark ? '1px solid #333' : '1px solid #d0d7de',
    boxShadow: isDark ? '0 4px 12px rgba(0,0,0,0.3)' : '0 2px 8px rgba(0,0,0,0.06)',
    transition: 'background 0.25s, border 0.25s',
  };

  const headerStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '6px 14px',
    background: isDark ? 'rgba(255,255,255,0.06)' : '#eaeef2',
    borderBottom: isDark ? '1px solid rgba(255,255,255,0.08)' : '1px solid #d0d7de',
  };

  const selectStyle: CSSProperties = {
    background: isDark ? 'rgba(255,255,255,0.1)' : '#d0d7de',
    color: isDark ? '#ccc' : '#444',
    border: 'none',
    fontSize: '0.75rem',
    padding: '2px 8px',
    borderRadius: '4px',
    outline: 'none',
    cursor: 'pointer',
  };

  const toggleBtnStyle: CSSProperties = {
    background: 'transparent',
    border: 'none',
    fontSize: '1rem',
    padding: '0 4px',
    cursor: 'pointer',
    opacity: 0.8,
    lineHeight: 1,
    transition: 'opacity 0.2s',
  };

  const langLabelStyle: CSSProperties = {
    fontSize: '0.68rem',
    textTransform: 'uppercase',
    color: isDark ? '#666' : '#8c959f',
    fontWeight: 700,
    letterSpacing: '1px',
  };

  const preStyle: CSSProperties = {
    margin: 0,
    padding: '1rem 1.25rem',
    overflowX: 'auto',
    fontFamily: "'Fira Code', 'Cascadia Code', 'Consolas', monospace",
    fontSize: '0.88rem',
    lineHeight: '1.6',
    color: isDark ? '#d4d4d4' : '#1f2328',
    background: 'transparent',
  };

  return (
    <NodeViewWrapper style={wrapperStyle}>
      <div style={headerStyle} contentEditable={false}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <select
            value={attrs.language || 'auto'}
            onChange={e => updateAttributes({ language: e.target.value })}
            style={selectStyle}
          >
            <option value="auto">auto</option>
            {LANGUAGES.map(lang => (
              <option key={lang} value={lang}>{lang}</option>
            ))}
          </select>
          <button style={toggleBtnStyle} onClick={toggleTheme} title={isDark ? 'ライトテーマに切替' : 'ダークテーマに切替'}>
            {isDark ? '☀️' : '🌙'}
          </button>
        </div>
        <span style={langLabelStyle}>{attrs.language || 'code'}</span>
      </div>
      <pre style={preStyle}>
        <NodeViewContent />
      </pre>
    </NodeViewWrapper>
  );
}
