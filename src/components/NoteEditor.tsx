'use client';

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import ImageExtension from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import Link from '@tiptap/extension-link';
import { common, createLowlight } from 'lowlight';
import { useEffect, useState } from 'react';
import { db, type Note } from '@/lib/db';
import { Save, Trash2, Image as ImageIcon, Type, Palette } from 'lucide-react';

const lowlight = createLowlight(common);

interface NoteEditorProps {
  noteId: number;
}

export default function NoteEditor({ noteId }: NoteEditorProps) {
  const [note, setNote] = useState<Note | null>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: false, // Disable default code block
      }),
      CodeBlockLowlight.configure({
        lowlight,
      }),
      ImageExtension,
      Link,
      Placeholder.configure({
        placeholder: 'ここに入力してください...',
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
      window.location.reload(); // Simple way to reset state
    }
  };

  const addImage = () => {
    const url = prompt('画像のURLを入力してください');
    if (url && editor) {
      editor.chain().focus().setImage({ src: url }).run();
    }
  };

  if (!editor) return null;

  return (
    <div className="editor-container">
      <header className="editor-header">
        <input 
          type="text" 
          className="title-input" 
          value={note?.title || ''} 
          onChange={(e) => updateTitle(e.target.value)}
          placeholder="タイトル"
        />
        <div className="editor-toolbar">
          <button className="toolbar-btn" onClick={addImage} title="画像を追加">
            <ImageIcon size={20} />
          </button>
          <button className="toolbar-btn" onClick={() => editor.chain().focus().toggleCodeBlock().run()} title="コードブロック">
            <Type size={20} />
          </button>
          <button className="toolbar-btn delete" onClick={deleteNote} title="削除">
            <Trash2 size={20} />
          </button>
        </div>
      </header>

      <div className="editor-content-wrapper">
        <EditorContent editor={editor} />
      </div>

      <style jsx global>{`
        .editor-container {
          flex: 1;
          display: flex;
          flex-direction: column;
          height: 100vh;
          background: white;
          border-radius: var(--radius) 0 0 var(--radius);
          box-shadow: -4px 0 20px rgba(0,0,0,0.05);
          overflow: hidden;
        }

        .editor-header {
          padding: 24px 40px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          border-bottom: 2px solid var(--accent);
        }

        .title-input {
          font-size: 2rem;
          font-weight: 700;
          border: none;
          padding: 0;
          width: 100%;
          color: var(--foreground);
        }

        .editor-toolbar {
          display: flex;
          gap: 12px;
        }

        .toolbar-btn {
          width: 44px;
          height: 44px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--accent);
          color: var(--primary);
          border-radius: 12px;
        }

        .toolbar-btn:hover {
          background: var(--primary);
          color: white;
        }

        .toolbar-btn.delete:hover {
          background: #ff6b6b;
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
        }

        .ProseMirror p.is-editor-empty:first-child::before {
          content: attr(data-placeholder);
          float: left;
          color: #adb5bd;
          pointer-events: none;
          height: 0;
        }

        pre {
          background: #2d2d2d;
          border-radius: 12px;
          padding: 20px;
          color: #f8f8f2;
          font-family: 'JetBrains Mono', 'Fira Code', monospace;
          margin: 20px 0;
        }

        code {
          background: none;
          color: inherit;
        }

        img {
          max-width: 100%;
          height: auto;
          border-radius: 16px;
          margin: 20px 0;
          box-shadow: 0 4px 12px rgba(0,0,0,0.1);
        }

        /* Syntax Highlighting (Monokai-like) */
        .hljs-comment, .hljs-quote { color: #75715e; }
        .hljs-keyword, .hljs-selector-tag, .hljs-literal, .hljs-name { color: #f92672; }
        .hljs-attribute, .hljs-meta { color: #66d9ef; }
        .hljs-string, .hljs-type, .hljs-addition { color: #a6e22e; }
        .hljs-number, .hljs-symbol, .hljs-bullet { color: #ae81ff; }
      `}</style>
    </div>
  );
}
