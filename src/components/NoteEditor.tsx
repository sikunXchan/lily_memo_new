'use client';

import { useEditor, EditorContent, ReactNodeViewRenderer } from '@tiptap/react';
import { useLiveQuery } from 'dexie-react-hooks';
import StarterKit from '@tiptap/starter-kit';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import ImageExtension from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import Link from '@tiptap/extension-link';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { common, createLowlight } from 'lowlight';
import { useEffect, useState, useRef } from 'react';
import { db, type Note } from '@/lib/db';
import {
  ArrowLeft, Trash2, Type,
  CheckSquare, BarChart3, Binary, LayoutGrid,
  Share2, GitBranch, X, Pencil, Eye, FolderInput, Check,
  Undo, Redo, Image as ImageIcon, Loader2, Printer, Cloud
} from 'lucide-react';
import CodeBlockComponent from './CodeBlockComponent';

import { MermaidExtension, ChartExtension } from '@/lib/extensions';

const lowlight = createLowlight(common);

const CustomTaskItem = TaskItem.extend({
  addNodeView() {
    return ({ node, HTMLAttributes, getPos, editor }) => {
      const listItem = document.createElement('li');
      const checkboxWrapper = document.createElement('label');
      const checkboxStyler = document.createElement('span');
      const checkbox = document.createElement('input');
      const content = document.createElement('div');

      checkboxWrapper.appendChild(checkbox);
      checkboxWrapper.appendChild(checkboxStyler);
      listItem.appendChild(checkboxWrapper);
      listItem.appendChild(content);

      Object.entries(HTMLAttributes).forEach(([key, value]) => {
        listItem.setAttribute(key, value as string);
      });

      checkbox.type = 'checkbox';
      checkbox.checked = node.attrs.checked;

      checkbox.addEventListener('change', () => {
        if (typeof getPos === 'function') {
          const pos = getPos();
          if (typeof pos === 'number') {
            editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, {
              checked: checkbox.checked,
            }));
          }
        }
      });

      return {
        dom: listItem,
        contentDOM: content,
        update: updatedNode => {
          if (updatedNode.type !== this.type) return false;
          checkbox.checked = updatedNode.attrs.checked;
          return true;
        },
      };
    };
  },
});

interface NoteEditorProps {
  noteId: number;
  onClose?: () => void;
}

export default function NoteEditor({ noteId, onClose }: NoteEditorProps) {
  const [note, setNote] = useState<Note | null>(null);
  const [bgType, setBgType] = useState<'plain' | 'grid' | 'ruled'>('plain');
  // スマホはデフォルト閲覧モード（テキストエリアをタップしてもキーボードが開かない）
  const [isEditMode, setIsEditMode] = useState(true);
  const [isMobileView, setIsMobileView] = useState(false);
  const [isTitleFocused, setIsTitleFocused] = useState(false);
  const [showFolderPicker, setShowFolderPicker] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // フォルダ一覧（移動機能用）
  const folders = useLiveQuery(() => db.folders.toArray());

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ codeBlock: false }),
      CodeBlockLowlight.configure({ lowlight }).extend({
        addAttributes() {
          return {
            ...this.parent?.(),
            theme: {
              default: 'dark',
              parseHTML: (element: HTMLElement) => element.getAttribute('data-theme') || 'dark',
              renderHTML: (attributes: Record<string, string>) => ({
                'data-theme': attributes.theme || 'dark',
              }),
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
      CustomTaskItem.configure({ nested: true }),
      ImageExtension,
      Link,
      Placeholder.configure({ placeholder: 'アイデアを書き留めましょう...' }),
    ],
    content: '',
    immediatelyRender: false,
    editorProps: {
      scrollThreshold: 0,
      scrollMargin: 0,
    },
    onUpdate: ({ editor }) => {
      if (noteId) saveNote(editor.getHTML());
    },
  });

  // スマホ検出 → 初期閲覧モード
  useEffect(() => {
    const mobile = window.innerWidth <= 768;
    setIsMobileView(mobile);
    if (mobile) setIsEditMode(false);
  }, []);

  // 編集モード↔閲覧モード切替でエディタのeditableを制御
  useEffect(() => {
    if (!editor) return;
    editor.setEditable(isEditMode);
  }, [editor, isEditMode]);

  // チェックボックスタップ時のキーボード抑制（iOS対応）
  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;
    let pendingCheckbox = false;

    const onTouchStart = (e: TouchEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' && target.getAttribute('type') === 'checkbox') {
        e.preventDefault();
        pendingCheckbox = true;
      }
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (!pendingCheckbox) return;
      pendingCheckbox = false;
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' && target.getAttribute('type') === 'checkbox') {
        e.preventDefault();
        target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
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

  const saveNote = (content: string) => {
    setIsSaving(true);
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(async () => {
      try {
        await db.notes.update(noteId, { content, updatedAt: Date.now() });
      } finally {
        setIsSaving(false);
      }
    }, 800);
  };

  const updateTitle = async (title: string) => {
    setNote(prev => prev ? { ...prev, title } : null);
    await db.notes.update(noteId, { title, updatedAt: Date.now() });
  };

  const deleteNote = async () => {
    if (confirm('このメモを削除してもよろしいですか？')) {
      await db.notes.delete(noteId);
      onClose?.();
    }
  };

  const handleSync = async () => {
    let code = note?.syncCode;
    if (!code) {
      if (!confirm('このメモをクラウドと同期させますか？ 新しい同期コードを発行します。')) return;
      code = Math.random().toString(36).substring(2, 8).toUpperCase();
      await db.notes.update(noteId, { syncCode: code });
      setNote(prev => prev ? { ...prev, syncCode: code } : null);
    }
    
    const choice = prompt(`【同期コード: ${code}】\n同期アクションを選んでください:\n1: クラウドへPush（この端末のデータを保存）\n2: クラウドからPull（PCなどで編集した内容を取得）`, '1');
    if (choice === '1') {
      try {
        await fetch('/api/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'push', code, payload: { title: note?.title, content: editor?.getHTML() } })
        });
        alert('クラウドに保存しました！別の端末（PC等）のリストでこのコード番号で取得できます。');
      } catch {
        alert('同期エラーが発生しました。');
      }
    } else if (choice === '2') {
      try {
        const res = await fetch('/api/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'pull', code })
        });
        const json = await res.json();
        if (json.success && json.data) {
          editor?.commands.setContent(json.data.content);
          updateTitle(json.data.title || '');
          alert('クラウドから復元しました！');
        } else {
          alert('同期データが見つかりません。先に別の端末からPushしてください。');
        }
      } catch {
        alert('同期エラーが発生しました。');
      }
    }
  };

  // フォルダ移動
  const moveToFolder = async (folderId: number | undefined) => {
    await db.notes.update(noteId, { folderId, updatedAt: Date.now() });
    setNote(prev => prev ? { ...prev, folderId } : null);
    setShowFolderPicker(false);
  };

  // 図/グラフ挿入: 選択範囲を消さずにキャレットの最後に挿入する
  const insertWithoutFocus = (content: object) => {
    if (!editor) return;
    const wasEditable = editor.isEditable;
    if (!wasEditable) editor.setEditable(true);
    const { to } = editor.state.selection;
    editor.chain().insertContentAt(to, content).run();
    if (!wasEditable) editor.setEditable(false);
  };

  const addNoteAsset = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file || !editor) return;
      const { to } = editor.state.selection;
      const reader = new FileReader();
      reader.onload = () => {
        const url = reader.result as string;
        editor.chain().insertContentAt(to, { type: 'image', attrs: { src: url } }).run();
      };
      reader.readAsDataURL(file);
    };
    input.click();
  };

  const insertMermaid = () => {
    insertWithoutFocus({
      type: 'mermaid',
      attrs: { content: 'graph TD\n  A[開始] --> B[処理]\n  B --> C[終了]' },
    });
  };

  const insertChart = () => {
    insertWithoutFocus({
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
    });
  };

  // 共有用HTML生成: Mermaid/Chart.jsをCDN経由で描画する自己完結型HTML
  const generateShareableHtml = (): string | null => {
    if (!note || !editor) return null;

    const rawHtml = editor.getHTML();
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<html><body>${rawHtml}</body></html>`, 'text/html');

    let chartIndex = 0;
    const chartScripts: string[] = [];

    // Mermaidノード → <pre class="mermaid">
    doc.querySelectorAll('div[data-type="mermaid"]').forEach(el => {
      const content = el.getAttribute('content') || '';
      const width = el.getAttribute('width') || '100%';
      const pre = doc.createElement('pre');
      pre.className = 'mermaid';
      pre.textContent = content;
      pre.style.width = width;
      pre.style.margin = '16px auto';
      el.replaceWith(pre);
    });

    // Chartノード → <canvas> + Chart.js初期化スクリプト
    doc.querySelectorAll('div[data-type="chart"]').forEach(el => {
      const codeAttr = el.getAttribute('code');
      const fileDataAttr = el.getAttribute('filedata') || 'null';
      
      const width = el.getAttribute('width') || '100%';
      
      const id = `chart-${chartIndex++}`;
      const wrapper = doc.createElement('div');
      wrapper.style.width = width;
      wrapper.style.margin = '24px auto';
      
      const canvas = doc.createElement('canvas');
      canvas.id = id;
      wrapper.appendChild(canvas);
      el.replaceWith(wrapper);

      if (codeAttr) {
        chartScripts.push(`
          (function() {
            try {
              const fileData = ${fileDataAttr};
              const func = new Function('fileData', ${JSON.stringify(codeAttr)});
              const config = func(fileData);
              if (config) {
                 new Chart(document.getElementById('${id}'), config);
              }
            } catch(e) {
              console.error('Chart Eval Error:', e);
            }
          })();
        `);
      } else {
        const chartType = el.getAttribute('type') || 'bar';
        const dataAttr = el.getAttribute('data');
        if (dataAttr) {
          chartScripts.push(
            `new Chart(document.getElementById('${id}'), { type: '${chartType}', data: ${dataAttr}, options: { responsive: true, plugins: { legend: { position: 'top' } } } });`
          );
        }
      }
    });

    // チェックボックスを無効化（見た目のみ）
    doc.querySelectorAll('input[type="checkbox"]').forEach(el => {
      el.setAttribute('disabled', '');
    });

    const body = doc.body.innerHTML;
    const title = note.title || 'Lily Memo';

    return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"><\/script>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"><\/script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 800px; margin: 0 auto; padding: 40px 20px; line-height: 1.8; color: #333; background: #fffafa; }
    h1.note-title { font-size: 2rem; font-weight: 700; border-bottom: 3px solid #ffb6c1; padding-bottom: 12px; margin-bottom: 32px; }
    h2, h3 { font-weight: 700; margin: 24px 0 12px; }
    p { margin: 10px 0; }
    ul, ol { padding-left: 24px; margin: 10px 0; }
    pre { background: #1e1e1e; color: #d4d4d4; padding: 16px; border-radius: 8px; overflow-x: auto; margin: 16px 0; font-family: monospace; font-size: 0.9rem; }
    code { background: #f0f0f0; padding: 2px 6px; border-radius: 4px; font-family: monospace; }
    pre code { background: none; padding: 0; }
    img { max-width: 100%; border-radius: 8px; margin: 16px 0; }
    canvas { max-width: 100%; margin: 24px auto; display: block; }
    pre.mermaid { background: transparent; color: inherit; text-align: center; margin: 24px 0; }
    ul[data-type="taskList"] { list-style: none; padding: 0; }
    ul[data-type="taskList"] li { display: flex; align-items: flex-start; gap: 8px; margin: 6px 0; }
    ul[data-type="taskList"] li[data-checked="true"] > div { text-decoration: line-through; color: #999; }
    input[type="checkbox"] { accent-color: #ffb6c1; }
    blockquote { border-left: 4px solid #ffb6c1; padding: 8px 16px; color: #666; margin: 16px 0; background: #fff0f5; border-radius: 0 8px 8px 0; }
    button, select { display: none !important; }
  </style>
</head>
<body>
  <h1 class="note-title">${title}</h1>
  ${body}
  <script>
    mermaid.initialize({ startOnLoad: true, theme: 'neutral' });
    window.addEventListener('load', function() {
      ${chartScripts.join('\n      ')}
    });
  <\/script>
</body>
</html>`;
  };

  const shareNote = async () => {
    if (!note || !editor) return;
    const title = note.title || 'Untitled';
    const html = generateShareableHtml();
    if (!html) return;

    const blob = new Blob([html], { type: 'text/html' });
    const file = new File([blob], `${title}.html`, { type: 'text/html' });

    if (navigator.share) {
      try {
        await navigator.share({ title, files: [file] });
      } catch (err) {
        console.error('Share failed:', err);
        // fallback: download
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.download = `${title}.html`;
        a.href = url;
        a.click();
        URL.revokeObjectURL(url);
      }
    } else {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.download = `${title}.html`;
      a.href = url;
      a.click();
      URL.revokeObjectURL(url);
    }
  };
  const downloadPdf = async () => {
    const element = editor?.view.dom;
    if (!element) return;
    
    // UIの一時隠ぺい用クラス追加
    document.body.classList.add('pdf-exporting');
    
    try {
      // @ts-ignore
      const html2pdf = (await import('html2pdf.js')).default;
      const opt = {
        margin:       15,
        filename:     `${note?.title || 'Lily_Memo'}.pdf`,
        image:        { type: 'jpeg' as const, quality: 1 },
        html2canvas:  { scale: 2, useCORS: true },
        jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' as const }
      };
      
      await html2pdf().from(element).set(opt).save();
    } catch (e) {
      console.error('PDF Download failed', e);
      alert('PDFの生成に失敗しました。');
    } finally {
      document.body.classList.remove('pdf-exporting');
    }
  };

  if (!editor) return null;

  return (
    <div className={`editor-container bg-${bgType}`}>
      <header className="editor-header">
        {/* 上部：戻る・共有・保存状態 (フローティングに近い丸ボタン) */}
        <div className="header-floating-top">
          <button className="btn-circle btn-back" onClick={onClose} title="戻る">
            <ArrowLeft size={24} />
          </button>
          
          <div className="header-group-right">
            <div className="status-badge">
              {isSaving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
              <span>{isSaving ? 'Saving' : 'Saved'}</span>
            </div>
            <button className="btn-circle" onClick={shareNote} title="共有"><Share2 size={20} /></button>
            <button className="btn-circle" onClick={() => setShowFolderPicker(true)} title="フォルダ"><FolderInput size={20} /></button>
            <button className="btn-circle btn-delete" onClick={deleteNote} title="削除"><Trash2 size={20} /></button>
            <button 
              className={`btn-circle btn-save ${isEditMode ? 'active' : ''}`} 
              onClick={() => setIsEditMode(!isEditMode)}
            >
              {isEditMode ? <Check size={24} strokeWidth={3} /> : <Pencil size={20} />}
            </button>
          </div>
        </div>
      </header>

      <div className="editor-content-wrapper">
        <div className="editor-scroller">
            <input
              type="text"
              className="content-title-input"
              value={note?.title || ''}
              onChange={(e) => updateTitle(e.target.value)}
              placeholder="タイトル..."
              readOnly={!isEditMode}
            />
            <EditorContent editor={editor} />
        </div>
      </div>

      {/* 下部：キーボードに吸い付く編集ツールバー (スマホ用) */}
      {isEditMode && (
        <div className="mobile-keyboard-toolbar glass">
          <div className="toolbar-scroll-x">
             <button onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()}><Undo size={20} /></button>
             <button onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()}><Redo size={20} /></button>
             <div className="v-divider" />
             <button onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} className={editor.isActive('heading', { level: 2 }) ? 'active' : ''}>あぁ</button>
             <button onClick={() => editor.chain().focus().toggleBulletList().run()} className={editor.isActive('bulletList') ? 'active' : ''}>・≡</button>
             <button onClick={() => editor.chain().focus().toggleTaskList().run()} className={editor.isActive('taskList') ? 'active' : ''}><CheckSquare size={20} /></button>
             <button onClick={() => editor.chain().focus().toggleCodeBlock().run()} className={editor.isActive('codeBlock') ? 'active' : ''}><Binary size={20} /></button>
             <div className="v-divider" />
             <button onClick={addNoteAsset}><ImageIcon size={20} /></button>
             <button onClick={insertMermaid}><GitBranch size={20} /></button>
             <button onClick={insertChart}><BarChart3 size={20} /></button>
          </div>
        </div>
      )}


      {/* フォルダ移動ピッカー */}
      {showFolderPicker && (
        <div className="folder-picker-overlay" onClick={() => setShowFolderPicker(false)}>
          <div className="folder-picker-sheet" onClick={e => e.stopPropagation()}>
            <div className="folder-picker-header">
              <span>フォルダに移動</span>
              <button onClick={() => setShowFolderPicker(false)}><X size={18} /></button>
            </div>
            <div className="folder-picker-list">
              <button
                className={`folder-picker-item ${!note?.folderId ? 'fp-selected' : ''}`}
                onClick={() => moveToFolder(undefined)}
              >
                <div className="fp-dot" style={{ background: '#ccc' }} />
                <span>フォルダなし</span>
                {!note?.folderId && <Check size={15} className="fp-check" />}
              </button>
              {folders?.map(folder => (
                <button
                  key={folder.id}
                  className={`folder-picker-item ${note?.folderId === folder.id ? 'fp-selected' : ''}`}
                  onClick={() => moveToFolder(folder.id!)}
                >
                  <div className="fp-dot" style={{ background: `var(${folder.color || '--folder-pink'})` }} />
                  <span>{folder.name}</span>
                  {note?.folderId === folder.id && <Check size={15} className="fp-check" />}
                </button>
              ))}
            </div>
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
          overflow: hidden; /* 子要素でスクロールさせるため */
          transition: background 0.3s;
          position: relative;
        }

        @media (max-width: 768px) {
          .editor-container {
            border-radius: 0;
            position: fixed;
            top: 0; left: 0;
            width: 100%;
            height: 100vh;
            height: 100dvh;
            z-index: 1001;
          }
          .editor-header {
            padding: 12px 14px !important;
          }
          .title-input {
            font-size: 1.1rem !important;
          }
        }

        /* ===== New Header Floating System ===== */
        .editor-header {
          position: absolute;
          top: 0; left: 0; right: 0;
          z-index: 1000;
          padding: 16px;
          pointer-events: none; /* Allow clicks to pass to editor if not on buttons */
        }

        .header-floating-top {
          display: flex;
          justify-content: space-between;
          align-items: center;
          width: 100%;
          pointer-events: auto;
        }

        .header-group-right {
          display: flex;
          align-items: center;
          gap: 10px;
          background: rgba(255,255,255,0.7);
          backdrop-filter: blur(10px);
          padding: 6px;
          border-radius: 40px;
          border: 1px solid rgba(0,0,0,0.05);
          box-shadow: 0 4px 15px rgba(0,0,0,0.05);
        }

        [data-theme='dark'] .header-group-right {
          background: rgba(0,0,0,0.5);
          border-color: rgba(255,255,255,0.1);
        }

        .btn-circle {
          width: 44px;
          height: 44px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          background: white;
          color: #333;
          box-shadow: 0 4px 12px rgba(0,0,0,0.1);
          transition: transform 0.2s, background 0.2s;
        }

        [data-theme='dark'] .btn-circle {
          background: #333;
          color: white;
        }

        .btn-circle.active {
          background: var(--primary);
          color: white;
        }

        .btn-circle.btn-save {
          background: #ffc107; /* Orange check color similar to image */
          color: white;
          box-shadow: 0 4px 12px rgba(255,193,7,0.3);
        }

        .btn-circle.btn-back {
          background: rgba(255,255,255,0.8);
          color: #ffc107;
        }

        .status-badge {
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 4px 12px;
          font-size: 0.7rem;
          font-weight: 700;
          color: #888;
          text-transform: uppercase;
        }

        /* ===== Mobile Keyboard Toolbar (Fixed at Bottom) ===== */
        .mobile-keyboard-toolbar {
          position: fixed;
          bottom: 0;
          left: 0;
          right: 0;
          background: rgba(255,255,255,0.85);
          backdrop-filter: blur(20px);
          border-top: 1px solid var(--border);
          padding: 8px 12px calc(8px + env(safe-area-inset-bottom));
          z-index: 1000;
        }

        [data-theme='dark'] .mobile-keyboard-toolbar {
          background: rgba(30,30,30,0.85);
        }

        .toolbar-scroll-x {
          display: flex;
          align-items: center;
          gap: 12px;
          overflow-x: auto;
          scrollbar-width: none;
          padding-bottom: 2px;
        }
        .toolbar-scroll-x::-webkit-scrollbar { display: none; }

        .toolbar-scroll-x button {
          flex-shrink: 0;
          width: 42px;
          height: 42px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: transparent;
          color: var(--foreground);
          font-weight: 800;
          font-size: 1.1rem;
          border-radius: 8px;
        }

        .toolbar-scroll-x button.active {
          background: var(--accent);
          color: var(--primary);
        }

        .v-divider {
          width: 1px;
          height: 24px;
          background: var(--border);
          flex-shrink: 0;
        }

        /* ===== Content Layout Fix ===== */
        .editor-content-wrapper {
          padding-top: 80px; /* Space for floating headers */
          padding-bottom: 80px; /* Space for keyboard toolbar */
        }

        .editor-scroller {
          flex: 1;
          padding: 0 40px 24px;
          display: flex;
          flex-direction: column;
        }

        .content-title-input {
          font-size: 1.8rem;
          font-weight: 800;
          border: none;
          background: transparent;
          color: var(--foreground);
          width: 100%;
          margin: 40px auto 20px;
          max-width: 860px;
          padding: 0;
          outline: none;
        }

        .bg-ruled .content-title-input {
            border-bottom: 2px solid var(--primary);
            padding-bottom: 8px;
            margin-top: 56px; /* ルールド背景に合わせる */
        }

        @media (max-width: 768px) {
          .editor-content-wrapper { padding: 14px; }
        }

        /* ===== Tiptap Toolbar ===== */
        .tiptap-toolbar {
          position: sticky;
          top: 0;
          z-index: 100;
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 4px;
          margin: 0;
          padding: 8px 16px;
          border-bottom: 1px solid var(--border);
          background: var(--background);
          width: 100%;
          flex-shrink: 0;
        }
        
        [data-theme='dark'] .tiptap-toolbar { background: var(--muted); }

        .tiptap-toolbar button {
          width: 34px;
          height: 34px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: transparent;
          color: var(--foreground);
          border-radius: 8px;
          font-weight: 700;
          font-size: 0.82rem;
        }

        .tiptap-toolbar button:hover { background: var(--primary); color: white; }
        .tiptap-toolbar button.active { background: var(--primary); color: white; }

        .divider {
          width: 1px;
          height: 18px;
          background: var(--border);
          margin: 0 2px;
        }

        /* 閲覧モードバナー */
        .read-mode-banner {
          display: flex;
          align-items: center;
          gap: 6px;
          margin-bottom: 12px;
          padding: 5px 10px;
          background: var(--muted);
          border-radius: 8px;
          font-size: 0.75rem;
          color: #888;
        }

        /* ===== ProseMirror ===== */
        .ProseMirror {
          min-height: 200px;
          outline: none;
          font-size: 0.95rem;
          line-height: 1.6;
          max-width: 860px;
          width: 100%;
          margin: 0 auto;
          color: var(--foreground);
          overflow-x: hidden;
        }

        @media (max-width: 768px) {
          .editor-scroller { padding: 0 12px 24px; }
          .content-title-input { font-size: 1.3rem; margin-top: 8px; }
          .editor-content-wrapper { padding: 0; }
          .editor-header { padding: 8px 12px; }
        }

        .ProseMirror p.is-editor-empty:first-child::before {
          color: #aaa;
          content: attr(data-placeholder);
          float: left;
          height: 0;
          pointer-events: none;
        }

        /* 閲覧モード時: カーソルをデフォルトに（テキスト選択は可能） */
        .ProseMirror[contenteditable="false"] {
          cursor: default;
          user-select: text;
          -webkit-user-select: text;
        }

        /* ===== Task List ===== */
        ul[data-type="taskList"] { list-style: none; padding: 0; }
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
        ul[data-type="taskList"] input[type="checkbox"]:disabled {
          pointer-events: none; /* Let clicks pass through to the label */
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
        .hljs-function, .hljs-title { color: #6f42c1; }
        .hljs-params { color: var(--foreground); }
        .hljs-built_in { color: #e36209; }
        [data-theme='dark'] .hljs-string { color: #4ec994; }
        [data-theme='dark'] .hljs-number { color: #79b8ff; }

        /* ===== Background Patterns ===== */
        .bg-grid {
          background-image:
            linear-gradient(rgba(255,182,193,0.1) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,182,193,0.1) 1px, transparent 1px);
          background-size: 20px 20px;
        }
        .bg-ruled {
          background-image: linear-gradient(transparent 27px, rgba(255,182,193,0.2) 28px);
          background-size: 100% 28px;
        }

        /* ===== Print Optimization (PDF Export) ===== */
        @media print {
          .editor-header, .tiptap-toolbar, .folder-picker-overlay, .read-mode-banner { 
            display: none !important; 
          }
          .editor-container { 
            box-shadow: none !important; 
            border: none !important; 
            height: auto !important; 
            position: static !important; 
            overflow: visible !important; 
            background: #fff !important;
          }
          .editor-content-wrapper, .editor-scroller { 
            padding: 0 !important; 
            overflow: visible !important; 
            height: auto !important; 
          }
          .content-title-input { 
            margin: 0 !important; 
            padding-top: 0 !important;
            border: none !important; 
            color: #000 !important;
          }
          .ProseMirror {
            padding-bottom: 0 !important;
            color: #000 !important;
          }
          button, select {
            display: none !important;
          }
        }

        :global(.pdf-exporting p),
        :global(.pdf-exporting h1),
        :global(.pdf-exporting h2),
        :global(.pdf-exporting h3),
        :global(.pdf-exporting li),
        :global(.pdf-exporting .mermaid-wrapper),
        :global(.pdf-exporting .chart-wrapper),
        :global(.pdf-exporting img),
        :global(.pdf-exporting pre) {
            page-break-inside: avoid !important;
            break-inside: avoid !important;
        }

        .ProseMirror img {
          max-width: 100%;
          max-height: 50vh;
          object-fit: contain;
          border-radius: 12px;
          margin: 16px 0;
          box-shadow: 0 4px 12px rgba(0,0,0,0.1);
          display: block;
        }

        /* ===== Folder Picker ===== */
        .folder-picker-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.4);
          z-index: 2000;
          display: flex;
          align-items: flex-end;
        }

        .folder-picker-sheet {
          width: 100%;
          max-width: 480px;
          margin: 0 auto;
          background: var(--background);
          border-radius: 20px 20px 0 0;
          padding: 8px 0 calc(16px + env(safe-area-inset-bottom));
          animation: slideUp 0.22s ease-out;
        }

        .folder-picker-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 20px 12px;
          border-bottom: 1px solid var(--border);
          font-weight: 700;
          color: var(--foreground);
        }

        .folder-picker-header button {
          background: transparent;
          color: var(--foreground);
          opacity: 0.6;
          padding: 4px;
        }

        .folder-picker-list {
          display: flex;
          flex-direction: column;
          padding: 8px 0;
        }

        .folder-picker-item {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 14px 20px;
          background: transparent;
          color: var(--foreground);
          text-align: left;
          font-size: 1rem;
          width: 100%;
          transition: background 0.15s;
        }

        .folder-picker-item:hover,
        .folder-picker-item:active {
          background: var(--accent);
        }

        .folder-picker-item.fp-selected {
          color: var(--primary);
          font-weight: 600;
        }

        .fp-dot {
          width: 12px;
          height: 12px;
          border-radius: 50%;
          flex-shrink: 0;
        }

        .folder-picker-item span {
          flex: 1;
        }

        .fp-check {
          color: var(--primary);
          flex-shrink: 0;
        }

        :global(body.pdf-exporting button),
        :global(body.pdf-exporting select),
        :global(body.pdf-exporting .tiptap-toolbar),
        :global(body.pdf-exporting .btn-back),
        :global(body.pdf-exporting .editor-toolbar) {
          display: none !important;
        }
      `}</style>
    </div>
  );
}
