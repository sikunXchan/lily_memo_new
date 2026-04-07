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
import { db, type Note } from '@/lib/db';
import {
  ArrowLeft, Trash2, Type,
  CheckSquare, BarChart3, Binary, LayoutGrid,
  Sparkles, Share2, GitBranch, X
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
  const [isAiPanelOpen, setIsAiPanelOpen] = useState(false);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: false,
      }),
      CodeBlockLowlight.configure({
        lowlight,
      }).extend({
        addAttributes() {
          return {
            ...this.parent?.(),
            theme: {
              default: 'dark',
              parseHTML: (element: HTMLElement) => element.getAttribute('data-theme') || 'dark',
              renderHTML: (attributes: Record<string, string>) => {
                if (!attributes.theme) return {};
                return { 'data-theme': attributes.theme };
              },
            },
          };
        },
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

  // チェックボックスタップ時にキーボードを開かない（iOS PWA対応）
  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;

    let touchedCheckbox = false;

    const onTouchStart = (e: TouchEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' && target.getAttribute('type') === 'checkbox') {
        e.preventDefault();
        touchedCheckbox = true;
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (!touchedCheckbox) return;
      touchedCheckbox = false;
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' && target.getAttribute('type') === 'checkbox') {
        e.preventDefault();
        // Tiptapのクリックハンドラを起動（フォーカスなし）
        const click = new MouseEvent('click', { bubbles: true, cancelable: true });
        target.dispatchEvent(click);
      }
    };

    dom.addEventListener('touchstart', onTouchStart, { passive: false });
    dom.addEventListener('touchend', onTouchEnd, { passive: false });
    return () => {
      dom.removeEventListener('touchstart', onTouchStart);
      dom.removeEventListener('touchend', onTouchEnd);
    };
  }, [editor]);

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
    const blob = new Blob([editor.getHTML()], { type: 'text/markdown' });
    const file = new File([blob], `${title}.md`, { type: 'text/markdown' });

    if (navigator.share) {
      try {
        await navigator.share({ title, text: `Check out my note: ${title}`, files: [file] });
      } catch (err) {
        console.error('Share failed:', err);
      }
    } else {
      alert('共有機能はこのブラウザではサポートされていません。設定からバックアップを利用してください。');
    }
  };

  const insertMermaid = () => {
    editor?.chain().focus().insertContent({
      type: 'mermaid',
      attrs: { content: 'graph TD\n  A[開始] --> B[処理]\n  B --> C[終了]' },
    }).run();
  };

  const insertChart = () => {
    editor?.chain().focus().insertContent({
      type: 'chart',
      attrs: {
        type: 'bar',
        data: {
          labels: ['項目A', '項目B', '項目C'],
          datasets: [{
            label: 'データ',
            data: [10, 20, 15],
            backgroundColor: 'rgba(255, 182, 193, 0.6)',
          }],
        },
      },
    }).run();
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

      const mermaidMatch = response.match(/```mermaid([\s\S]*?)```/);
      const chartMatch = response.match(/```chart([\s\S]*?)```/);
      const textOnly = response.replace(/```(mermaid|chart)[\s\S]*?```/g, '').trim();

      if (textOnly) {
        editor.chain().focus().insertContent(`<p>${textOnly}</p>`).run();
      }
      if (mermaidMatch) {
        editor.chain().focus().insertContent({
          type: 'mermaid',
          attrs: { content: mermaidMatch[1].trim() },
        }).run();
      }
      if (chartMatch) {
        try {
          const config = JSON.parse(chartMatch[1].trim());
          editor.chain().focus().insertContent({
            type: 'chart',
            attrs: { ...config },
          }).run();
        } catch (e) {
          console.error('Chart JSON parse error', e);
        }
      }


      setAiInput('');
      setIsAiPanelOpen(false); // 成功時にパネルを閉じる
    } catch (err: unknown) {
      alert(`AIエラー: ${(err as Error).message}`);
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
          <div className="title-container">
            <input
              type="text"
              className="title-input"
              value={note?.title || ''}
              onChange={(e) => updateTitle(e.target.value)}
              placeholder="タイトル"
            />
          </div>
        </div>
        <div className="editor-toolbar">
          <button className="toolbar-btn" onClick={shareNote} title="共有/保存">
            <Share2 size={20} />
          </button>
          <button
            className="toolbar-btn"
            onClick={() => setBgType(bgType === 'plain' ? 'grid' : bgType === 'grid' ? 'ruled' : 'plain')}
            title="背景切替"
          >
            <LayoutGrid size={20} />
          </button>
          <button className="toolbar-btn delete" onClick={deleteNote} title="削除">
            <Trash2 size={20} />
          </button>
        </div>
      </header>

      <div className="editor-content-wrapper">
        <div className="tiptap-toolbar glass">
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleBold().run()}
            className={editor.isActive('bold') ? 'active' : ''}
            title="太字"
          >
            <Type size={18} />
          </button>
          <button
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            className={editor.isActive('heading', { level: 2 }) ? 'active' : ''}
            title="見出し"
          >
            H2
          </button>
          <button
            onClick={() => editor.chain().focus().toggleTaskList().run()}
            className={editor.isActive('taskList') ? 'active' : ''}
            title="チェックリスト"
          >
            <CheckSquare size={18} />
          </button>
          <div className="divider" />
          <button
            onClick={() => editor.chain().focus().toggleCodeBlock().run()}
            className={editor.isActive('codeBlock') ? 'active' : ''}
            title="コードブロック"
          >
            <Binary size={18} />
          </button>
          <button onClick={insertMermaid} title="図（Mermaid）を挿入">
            <GitBranch size={18} />
          </button>
          <button onClick={insertChart} title="グラフを挿入">
            <BarChart3 size={18} />
          </button>
          <div className="divider" />
          <button 
            onClick={() => setIsAiPanelOpen(!isAiPanelOpen)} 
            className={isAiPanelOpen ? 'active' : ''}
            title="AIアシスタント"
            style={{ color: '#7c4dff' }}
          >
            <Sparkles size={18} />
          </button>
        </div>
        <EditorContent editor={editor} />
      </div>

      {isAiPanelOpen && (
        <div className="ai-assistant-bar glass slide-up">
          <div className="ai-input-wrapper">
            <Sparkles size={20} className="ai-icon" />
            <input
              type="text"
              placeholder="AIに指示（図解して、グラフにして...）"
              value={aiInput}
              onChange={(e) => setAiInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && runAi()}
              className="ai-input"
              autoFocus
            />
          </div>
          <div className="ai-actions">
            <button
              className={`btn-ai-run ${isAiLoading ? 'loading' : ''}`}
              onClick={runAi}
              disabled={isAiLoading || !aiInput}
            >
              {isAiLoading ? '生成中...' : '実行'}
            </button>
            <button className="btn-close-ai" onClick={() => setIsAiPanelOpen(false)}>
              <X size={18} />
            </button>
          </div>
        </div>
      )}

      <style jsx global>{`
        /* ===== Editor Container ===== */
        .editor-container {
          flex: 1;
          display: flex;
          flex-direction: column;
          height: 100vh;
          height: 100dvh;
          background: var(--background);
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
            height: 100vh;
            height: 100dvh;
            z-index: 150;
          }
          .editor-header {
            padding: 12px 16px !important;
          }
          .header-left {
            gap: 8px !important;
          }
          .title-input {
            font-size: 1.2rem !important;
          }
          .editor-toolbar {
            gap: 6px !important;
          }
        }

        /* ===== Header ===== */
        .editor-header {
          position: sticky;
          top: 0;
          z-index: 100;
          padding: 16px 32px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          border-bottom: 1px solid var(--border);
          background: var(--background);
          flex-shrink: 0;
        }

        [data-theme='dark'] .editor-header {
          background: var(--background);
          border-bottom-color: var(--border);
        }

        .header-left {
          display: flex;
          align-items: center;
          gap: 12px;
          flex: 1;
          min-width: 0;
        }

        .btn-back {
          background: transparent;
          color: var(--primary);
          padding: 8px;
          flex-shrink: 0;
        }

        .title-container {
          flex: 1;
          display: flex;
          align-items: center;
          min-width: 0;
          padding: 4px 8px;
        }

        .title-input {
          font-size: 1.5rem;
          font-weight: 700;
          border: none;
          padding: 4px 0;
          width: 100%;
          min-width: 0;
          color: var(--foreground);
          background: transparent;
          border-bottom: 2px solid transparent;
          transition: border-color 0.2s;
        }

        .title-input:focus {
          border-bottom-color: var(--primary);
        }

        .editor-toolbar {
          display: flex;
          gap: 8px;
          flex-shrink: 0;
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

        .toolbar-btn.delete {
          background: #fff0f0;
          color: #ff4d4d;
        }

        [data-theme='dark'] .toolbar-btn.delete {
          background: rgba(255, 77, 77, 0.15);
        }

        /* ===== Content Wrapper ===== */
        .editor-content-wrapper {
          flex: 1;
          padding: 32px 40px;
          overflow-y: auto;
          -webkit-overflow-scrolling: touch;
          overscroll-behavior: contain;
        }

        @media (max-width: 768px) {
          .editor-content-wrapper {
            padding: 16px;
          }
        }

        /* ===== Tiptap Toolbar ===== */
        .tiptap-toolbar {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 6px;
          margin-bottom: 20px;
          padding: 8px 12px;
          border-radius: 12px;
          border: 1px solid var(--border);
          background: var(--accent);
          max-width: fit-content;
        }

        [data-theme='dark'] .tiptap-toolbar {
          background: var(--muted);
          border-color: var(--border);
        }

        .tiptap-toolbar button {
          width: 36px;
          height: 36px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: transparent;
          color: var(--foreground);
          border-radius: 8px;
          font-weight: 700;
          font-size: 0.85rem;
        }

        .tiptap-toolbar button:hover {
          background: var(--primary);
          color: white;
        }

        .tiptap-toolbar button.active {
          background: var(--primary);
          color: white;
        }

        .divider {
          width: 1px;
          height: 20px;
          background: var(--border);
          margin: 0 2px;
        }

        /* ===== ProseMirror ===== */
        .ProseMirror {
          min-height: 200px;
          outline: none;
          font-size: 1.05rem;
          line-height: 1.8;
          max-width: 860px;
          margin: 0 auto;
          color: var(--foreground);
        }

        .ProseMirror p.is-editor-empty:first-child::before {
          color: #aaa;
          content: attr(data-placeholder);
          float: left;
          height: 0;
          pointer-events: none;
        }

        /* ===== Task List ===== */
        ul[data-type="taskList"] {
          list-style: none;
          padding: 0;
        }
        ul[data-type="taskList"] li {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          margin-bottom: 6px;
        }
        ul[data-type="taskList"] li > label {
          display: flex;
          align-items: center;
          padding-top: 3px;
          flex-shrink: 0;
          cursor: pointer;
          -webkit-tap-highlight-color: transparent;
        }
        ul[data-type="taskList"] input[type="checkbox"] {
          width: 20px;
          height: 20px;
          accent-color: var(--primary);
          cursor: pointer;
          touch-action: manipulation;
        }
        ul[data-type="taskList"] li[data-checked="true"] > div {
          text-decoration: line-through;
          color: #999;
        }

        /* ===== Syntax Highlighting ===== */
        .hljs-comment { color: #8e908c; font-style: italic; }
        .hljs-keyword { color: #d73a49; font-weight: bold; }
        .hljs-string { color: #22863a; }
        .hljs-number { color: #005cc5; }
        .hljs-function { color: #6f42c1; }
        .hljs-title { color: #6f42c1; }
        .hljs-params { color: var(--foreground); }
        .hljs-built_in { color: #e36209; }

        [data-theme='dark'] .hljs-string { color: #4ec994; }
        [data-theme='dark'] .hljs-number { color: #79b8ff; }
        [data-theme='dark'] .hljs-params { color: #e1e4e8; }

        /* ===== Image ===== */
        img {
          max-width: 100%;
          height: auto;
          border-radius: 12px;
          margin: 16px 0;
          box-shadow: 0 4px 12px rgba(0,0,0,0.1);
        }

        /* ===== Background Patterns ===== */
        .bg-grid {
          background-image:
            linear-gradient(rgba(255, 182, 193, 0.1) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255, 182, 193, 0.1) 1px, transparent 1px);
          background-size: 20px 20px;
        }
        .bg-ruled {
          background-image: linear-gradient(transparent 27px, rgba(255, 182, 193, 0.2) 28px);
          background-size: 100% 28px;
        }

        /* ===== AI Assistant Bar ===== */
        .ai-assistant-bar {
          display: flex;
          align-items: center;
          gap: 10px;
          margin: 8px 16px;
          margin-bottom: calc(12px + env(safe-area-inset-bottom));
          padding: 10px 16px;
          background: var(--accent);
          border: 1px solid var(--border);
          border-radius: 16px;
          flex-shrink: 0;
        }

        [data-theme='dark'] .ai-assistant-bar {
          background: var(--muted);
          border-color: var(--border);
        }

        .ai-input-wrapper {
          flex: 1;
          display: flex;
          align-items: center;
          gap: 8px;
          min-width: 0;
        }

        .ai-icon {
          color: #7c4dff;
          animation: pulse 2s infinite;
          flex-shrink: 0;
        }

        @keyframes pulse {
          0% { transform: scale(1); opacity: 0.8; }
          50% { transform: scale(1.1); opacity: 1; }
          100% { transform: scale(1); opacity: 0.8; }
        }

        .ai-input {
          flex: 1;
          min-width: 0;
          background: transparent;
          border: none;
          outline: none;
          font-size: 0.9rem;
          color: var(--foreground);
          padding: 0;
          border-radius: 0;
        }

        .btn-ai-run {
          background: var(--primary);
          color: white;
          padding: 7px 16px;
          border-radius: 10px;
          font-weight: 600;
          font-size: 0.85rem;
          white-space: nowrap;
          flex-shrink: 0;
        }

        .btn-ai-run:disabled {
          opacity: 0.5;
          filter: grayscale(1);
        }

        .ai-actions {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .btn-close-ai {
          background: var(--muted);
          color: var(--foreground);
          width: 32px;
          height: 32px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 50%;
        }

        .slide-up {
          animation: slideUp 0.3s ease-out;
        }

        @keyframes slideUp {
          from { transform: translateY(20px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
