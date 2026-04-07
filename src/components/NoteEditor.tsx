'use client';

import { useEditor, EditorContent, ReactNodeViewRenderer } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import ImageExtension from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import Link from '@tiptap/extension-link';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { common, createLowlight } from 'lowlight';
import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { db, type Note } from '@/lib/db';
import { 
  ArrowLeft, Trash2, Image as ImageIcon, Type, 
  CheckSquare, BarChart3, Binary, LayoutGrid, 
  HelpCircle, Sparkles, Share2 
} from 'lucide-react';
import CodeBlockComponent from './CodeBlockComponent';

import { MermaidExtension, ChartExtension } from '@/lib/extensions';
import { callGemini, AI_SYSTEM_PROMPT } from '@/lib/gemini';

const lowlight = createLowlight(common);

interface NoteEditorProps {
  noteId: number;
  onClose?: () => void;
}

export default function NoteEditor({ noteId, onClose }: NoteEditorProps) {
  const [note, setNote] = useState<Note | null>(null);
  const [bgType, setBgType] = useState<'plain' | 'grid' | 'ruled'>('plain');

  const [aiInput, setAiInput] = useState('');
  const [isAiLoading, setIsAiLoading] = useState(false);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: false,
      }),
      CodeBlockLowlight.configure({
        lowlight,
      }).extend({
        addNodeView() {
          return ReactNodeViewRenderer(CodeBlockComponent);
        },
      }),
      MermaidExtension,
      ChartExtension,
      TaskList,
      TaskItem.configure({
        nested: true,
      }),
      ImageExtension,
      Link,
      Placeholder.configure({
        placeholder: 'アイデアを書き留めましょう...',
      }),
    ],
    content: '',
    onUpdate: ({ editor }) => {
      if (noteId) {
        saveNote(editor.getHTML());
      }
    },
  });

  useEffect(() => {
    async function loadNote() {
      const data = await db.notes.get(noteId);
      if (data) {
        setNote(data);
        if (editor && editor.getHTML() !== data.content) {
          editor.commands.setContent(data.content);
        }
      }
    }
    loadNote();
  }, [noteId, editor]);

  const saveNote = async (content: string) => {
    await db.notes.update(noteId, {
      content,
      updatedAt: Date.now(),
    });
  };

  const updateTitle = async (title: string) => {
    setNote(prev => prev ? { ...prev, title } : null);
    await db.notes.update(noteId, {
      title,
      updatedAt: Date.now(),
    });
  };

  const deleteNote = async () => {
    if (confirm('このメモを削除してもよろしいですか？')) {
      await db.notes.delete(noteId);
      onClose?.();
    }
  };

  const shareNote = async () => {
    if (!note || !editor) return;
    const title = note.title || 'Untitled';
    const text = editor.getText();
    const blob = new Blob([editor.getHTML()], { type: 'text/markdown' });
    const file = new File([blob], `${title}.md`, { type: 'text/markdown' });

    if (navigator.share) {
      try {
        await navigator.share({
          title,
          text: `Check out my note: ${title}`,
          files: [file],
        });
      } catch (err) {
        console.error('Share failed:', err);
      }
    } else {
        alert('共有機能はこのブラウザではサポートされていません。設定からバックアップを利用してください。');
    }
  };

  const runAi = async () => {
    if (!aiInput || !editor) return;
    const key = localStorage.getItem('gemini_api_key');
    if (!key) {
      alert('設定画面からGemini APIキーを入力してください。');
      return;
    }

    setIsAiLoading(true);
    try {
      const context = editor.getText();
      const prompt = `${AI_SYSTEM_PROMPT}\n\n現在のノート内容:\n${context}\n\nユーザーの指示: ${aiInput}`;
      const response = await callGemini(prompt, key);

      // Parse blocks
      const mermaidMatch = response.match(/```mermaid([\s\S]*?)```/);
      const chartMatch = response.match(/```chart([\s\S]*?)```/);
      const textOnly = response.replace(/```(mermaid|chart)[\s\S]*?```/g, '').trim();

      if (textOnly) {
        editor.chain().focus().insertContent(`<p>${textOnly}</p>`).run();
      }

      if (mermaidMatch) {
         editor.chain().focus().insertContent({ 
           type: 'mermaid', 
           attrs: { content: mermaidMatch[1].trim() } 
         }).run();
      }

      if (chartMatch) {
        try {
          const config = JSON.parse(chartMatch[1].trim());
          editor.chain().focus().insertContent({ 
            type: 'chart', 
            attrs: { config } 
          }).run();
        } catch (e) {
          console.error('Chart JSON parse error', e);
        }
      }

      setAiInput('');
    } catch (err: any) {
      alert(`AIエラー: ${err.message}`);
    } finally {
      setIsAiLoading(false);
    }
  };

  if (!editor) return null;

  return (
    <div className={`editor-container bg-${bgType}`}>
      <header className="editor-header">
        <div className="header-left">
          <button className="btn-back" onClick={onClose} title="戻る">
            <ArrowLeft size={24} />
          </button>
          <input 
            type="text" 
            className="title-input" 
            value={note?.title || ''} 
            onChange={(e) => updateTitle(e.target.value)}
            placeholder="タイトル"
          />
        </div>
        <div className="editor-toolbar">
          <button className="toolbar-btn" onClick={shareNote} title="共有/保存">
            <Share2 size={20} />
          </button>
          <button className="toolbar-btn" onClick={() => setBgType(bgType === 'plain' ? 'grid' : bgType === 'grid' ? 'ruled' : 'plain')} title="背景切替">
            <LayoutGrid size={20} />
          </button>
          <button className="toolbar-btn delete" onClick={deleteNote} title="削除">
            <Trash2 size={20} />
          </button>
        </div>
      </header>

      <div className="editor-content-wrapper">
        <div className="tiptap-toolbar glass">
          <button onClick={() => editor.chain().focus().toggleBold().run()} className={editor.isActive('bold') ? 'active' : ''}><Type size={18} /></button>
          <button onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} className={editor.isActive('heading', { level: 2 }) ? 'active' : ''}>H2</button>
          <button onClick={() => editor.chain().focus().toggleTaskList().run()} className={editor.isActive('taskList') ? 'active' : ''}><CheckSquare size={18} /></button>
          <div className="divider" />
          <button onClick={() => editor.chain().focus().toggleCodeBlock().run()} className={editor.isActive('codeBlock') ? 'active' : ''}><Binary size={18} /></button>
        </div>
        <EditorContent editor={editor} />
      </div>

      <div className="ai-assistant-bar glass">
        <div className="ai-input-wrapper">
          <Sparkles size={20} className="ai-icon" />
          <input 
            type="text" 
            placeholder="AIに指示（図解して、グラフにして...）" 
            value={aiInput}
            onChange={(e) => setAiInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && runAi()}
            className="ai-input"
          />
        </div>
        <button 
          className={`btn-ai-run ${isAiLoading ? 'loading' : ''}`} 
          onClick={runAi}
          disabled={isAiLoading || !aiInput}
        >
          {isAiLoading ? '生成中...' : '実行'}
        </button>
      </div>

      <style jsx global>{`
        .ai-assistant-bar {
          position: absolute;
          bottom: 24px;
          left: 50%;
          transform: translateX(-50%);
          width: 90%;
          max-width: 600px;
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px 20px;
          background: rgba(255, 255, 255, 0.85);
          backdrop-filter: blur(20px);
          border: 1px solid rgba(255, 182, 193, 0.2);
          border-radius: 20px;
          box-shadow: 0 10px 30px rgba(255, 182, 193, 0.15);
          z-index: 100;
        }

        .ai-input-wrapper {
          flex: 1;
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .ai-icon {
          color: #7c4dff;
          animation: pulse 2s infinite;
        }

        @keyframes pulse {
          0% { transform: scale(1); opacity: 0.8; }
          50% { transform: scale(1.1); opacity: 1; }
          100% { transform: scale(1); opacity: 0.8; }
        }

        .ai-input {
          flex: 1;
          background: transparent;
          border: none;
          outline: none;
          font-size: 0.95rem;
          color: var(--foreground);
        }

        .btn-ai-run {
          background: var(--primary);
          color: white;
          padding: 8px 20px;
          border-radius: 12px;
          font-weight: 600;
          font-size: 0.9rem;
          transition: all 0.2s;
        }

        .btn-ai-run:disabled {
          opacity: 0.5;
          filter: grayscale(1);
        }

        /* Tippap Toolbar */
        .tiptap-toolbar {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 24px;
          padding: 8px;
          border-radius: 12px;
          border: 1px solid var(--accent);
          background: rgba(255, 255, 255, 0.5);
          max-width: fit-content;
        }

        .tiptap-toolbar button {
          width: 36px;
          height: 36px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: transparent;
          color: #666;
          border-radius: 8px;
          font-weight: 700;
        }

        .tiptap-toolbar button:hover {
          background: var(--accent);
          color: var(--primary);
        }

        .tiptap-toolbar button.active {
          background: var(--primary);
          color: white;
        }

        .divider {
          width: 1px;
          height: 20px;
          background: var(--accent);
          margin: 0 4px;
        }
        .editor-container {
          flex: 1;
          display: flex;
          flex-direction: column;
          height: 100vh;
          background: white;
          border-radius: var(--radius) 0 0 var(--radius);
          box-shadow: -4px 0 20px rgba(0,0,0,0.05);
          overflow: hidden;
          transition: background 0.3s;
        }

        @media (max-width: 768px) {
          .editor-container {
            border-radius: 0;
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            z-index: 150;
          }
           .editor-header {
             padding: 12px 16px !important;
             flex-direction: column;
             gap: 12px;
           }
           .editor-toolbar {
             width: 100%;
             overflow-x: auto;
             padding-bottom: 4px;
           }
        }

        /* Background Patterns */
        .bg-grid {
          background-image: 
            linear-gradient(rgba(255, 182, 193, 0.1) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255, 182, 193, 0.1) 1px, transparent 1px);
          background-size: 20px 20px;
        }
        .bg-ruled {
          background-image: linear-gradient(transparent 19px, #ffe4e1 20px);
          background-size: 100% 20px;
        }

        .editor-header {
          position: sticky;
          top: 0;
          z-index: 100;
          padding: 24px 40px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          border-bottom: 2px solid var(--accent);
          background: rgba(255, 255, 255, 0.9);
          backdrop-filter: blur(20px);
        }

        .header-left {
          display: flex;
          align-items: center;
          gap: 16px;
          flex: 1;
        }

        .btn-back {
          background: transparent;
          color: var(--primary);
          padding: 8px;
        }

        .title-input {
          font-size: 1.8rem;
          font-weight: 700;
          border: none;
          padding: 0;
          width: 100%;
          color: var(--foreground);
          background: transparent;
        }

        .editor-toolbar {
          display: flex;
          gap: 8px;
        }

        .toolbar-btn {
          width: 40px;
          height: 40px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--accent);
          color: var(--primary);
          border-radius: 10px;
          flex-shrink: 0;
        }

        .toolbar-btn:hover {
          background: var(--primary);
          color: white;
        }

        .toolbar-btn.special {
          background: #f0f0ff;
          color: #7c4dff;
        }

        .toolbar-btn.delete {
          background: #fff0f0;
          color: #ff4d4d;
        }

        .editor-content-wrapper {
          flex: 1;
          padding: 40px;
          overflow-y: auto;
        }

        .ProseMirror {
          min-height: 100%;
          outline: none;
          font-size: 1.1rem;
          line-height: 1.7;
          max-width: 900px;
          margin: 0 auto;
        }

        /* Task List Styling */
        ul[data-type="taskList"] {
          list-style: none;
          padding: 0;
        }
        ul[data-type="taskList"] li {
          display: flex;
          align-items: flex-start;
          gap: 12px;
          margin-bottom: 8px;
        }
        ul[data-type="taskList"] input[type="checkbox"] {
          width: 20px;
          height: 20px;
          margin-top: 4px;
          accent-color: var(--primary);
        }
        ul[data-type="taskList"] li[data-checked="true"] {
          text-decoration: line-through;
          color: #999;
        }

        /* Syntax Highlighting Vibrant Colors */
        .hljs-comment { color: #8e908c; font-style: italic; }
        .hljs-keyword { color: #d73a49; font-weight: bold; }
        .hljs-string { color: #22863a; }
        .hljs-number { color: #005cc5; }
        .hljs-function { color: #6f42c1; }
        .hljs-title { color: #6f42c1; }
        .hljs-params { color: #24292e; }
        .hljs-built_in { color: #e36209; }

        img {
          max-width: 100%;
          height: auto;
          border-radius: 16px;
          margin: 20px 0;
          box-shadow: 0 4px 12px rgba(0,0,0,0.1);
        }
      `}</style>
    </div>
  );
}
