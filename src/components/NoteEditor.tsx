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
    if (isEditMode) {
      setTimeout(() => editor.commands.focus('end'), 50);
    }
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
      const pre = doc.createElement('pre');
      pre.className = 'mermaid';
      pre.textContent = content;
      el.replaceWith(pre);
    });

    // Chartノード → <canvas> + Chart.js初期化スクリプト
    doc.querySelectorAll('div[data-type="chart"]').forEach(el => {
      const chartType = el.getAttribute('type') || 'bar';
      const dataAttr = el.getAttribute('data');
      if (!dataAttr) { el.remove(); return; }
      let chartData: unknown;
      try { chartData = JSON.parse(dataAttr); } catch { el.remove(); return; }

      const id = `chart-${chartIndex++}`;
      const canvas = doc.createElement('canvas');
      canvas.id = id;
      el.replaceWith(canvas);
      chartScripts.push(
        `new Chart(document.getElementById('${id}'), { type: '${chartType}', data: ${JSON.stringify(chartData)}, options: { responsive: true, plugins: { legend: { position: 'top' } } } });`
      );
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
        <div className="header-left">
          <button className="btn-back" onClick={onClose} title="戻る">
            <ArrowLeft size={24} />
          </button>
          <div className="title-container header-status">
            {isSaving ? (
              <div className="saving-indicator">
                <Loader2 size={14} className="animate-spin" />
                <span>保存中...</span>
              </div>
            ) : (
              <span className="saved-text">保存済み</span>
            )}
          </div>
        </div>
        <div className="editor-toolbar">
          {/* 閲覧/編集切替ボタン (スマホ・PC共通) */}
          <button
            className={`toolbar-btn edit-mode-btn ${isEditMode ? 'edit-active' : ''}`}
            onClick={() => {
              setIsEditMode(!isEditMode);
            }}
            title={isEditMode ? '閲覧モードへ' : '文字編集モードへ'}
          >
            {isEditMode ? <Eye size={20} /> : <Pencil size={20} />}
          </button>
          <button className="toolbar-btn" onClick={handleSync} title="PCなどと同期">
            <Cloud size={20} />
          </button>
          <button className="toolbar-btn" onClick={downloadPdf} title="PDFとしてダウンロード">
            <Printer size={20} />
          </button>
          <button className="toolbar-btn" onClick={shareNote} title="HTMLで共有（図・グラフ含む）">
            <Share2 size={20} />
          </button>
          <button className="toolbar-btn" onClick={() => setShowFolderPicker(true)} title="フォルダに移動">
            <FolderInput size={20} />
          </button>
          {isEditMode && (
            <>
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
            </>
          )}
        </div>
      </header>

      <div className="editor-content-wrapper">
        {/* ツールバー: タイトル編集中は非表示、図/グラフ/AIは常に表示、テキスト編集系は編集モードのみ */}
        {!isTitleFocused && <div className="tiptap-toolbar glass">
          {isEditMode && (
            <>
              <button
                onClick={() => editor.chain().focus().undo().run()}
                disabled={!editor.can().undo()}
                title="元に戻す"
              >
                <Undo size={18} />
              </button>
              <button
                onClick={() => editor.chain().focus().redo().run()}
                disabled={!editor.can().redo()}
                title="やり直し"
              >
                <Redo size={18} />
              </button>
              <div className="divider" />
              <button
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
              <button
                onClick={() => editor.chain().focus().toggleCodeBlock().run()}
                className={editor.isActive('codeBlock') ? 'active' : ''}
                title="コードブロック"
              >
                <Binary size={18} />
              </button>
              <div className="divider" />
            </>
          )}
          {/* 図・グラフ・画像は閲覧モードでも挿入可能 */}
          <button onClick={insertMermaid} title="図（Mermaid）を挿入 ※キーボード不要">
            <GitBranch size={18} />
          </button>
          <button onClick={insertChart} title="グラフを挿入 ※キーボード不要">
            <BarChart3 size={18} />
          </button>
          <button onClick={addNoteAsset} title="画像を挿入">
            <ImageIcon size={18} />
          </button>
        </div>}

        <div className="editor-scroller">
            <input
              type="text"
              className="content-title-input"
              value={note?.title || ''}
              onChange={(e) => updateTitle(e.target.value)}
              placeholder="タイトルを入力..."
              readOnly={!isEditMode}
              onFocus={() => setIsTitleFocused(true)}
              onBlur={() => setIsTitleFocused(false)}
            />
            <EditorContent editor={editor} />
        </div>
      </div>


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
          overflow: hidden;
          transition: background 0.3s;
        }

        @media (max-width: 768px) {
          .editor-container {
            border-radius: 0;
            position: fixed;
            top: 0; left: 0;
            width: 100%;
            height: 100vh;
            height: 100dvh;
            z-index: 1001; /* ボトムナビ(1000)より上 */
          }
          .editor-header {
            padding: 12px 14px !important;
          }
          .title-input {
            font-size: 1.1rem !important;
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
          gap: 8px;
          border-bottom: 1px solid var(--border);
          background: var(--background);
          flex-shrink: 0;
        }

        .header-left {
          display: flex;
          align-items: center;
          gap: 8px;
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
          min-width: 0;
        }

        .title-input {
          font-size: 1.4rem;
          font-weight: 700;
          border: none;
          padding: 2px 0;
          width: 100%;
          min-width: 0;
          color: var(--foreground);
          background: transparent;
          border-bottom: 2px solid transparent;
          transition: border-color 0.2s;
        }

        .title-input:focus {
          outline: none;
          border-bottom-color: var(--primary);
        }

        .header-status {
            font-size: 0.75rem;
            color: #999;
            display: flex;
            align-items: center;
            gap: 6px;
        }

        .saving-indicator {
            display: flex;
            align-items: center;
            gap: 4px;
            color: var(--primary);
        }

        .animate-spin {
            animation: spin 1s linear infinite;
        }

        @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }

        .editor-toolbar {
          display: flex;
          gap: 6px;
          flex-shrink: 0;
        }

        .toolbar-btn {
          width: 38px;
          height: 38px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--accent);
          color: var(--primary);
          border-radius: 10px;
          flex-shrink: 0;
        }

        .toolbar-btn:hover { background: var(--primary); color: white; }
        .toolbar-btn.delete { background: #fff0f0; color: #ff4d4d; }
        [data-theme='dark'] .toolbar-btn.delete { background: rgba(255,77,77,0.15); }
        .toolbar-btn.edit-mode-btn { background: var(--muted); color: var(--foreground); }
        .toolbar-btn.edit-mode-btn.edit-active { background: var(--primary); color: white; }

        /* ===== Content Wrapper ===== */
        .editor-content-wrapper {
          flex: 1;
          display: flex;
          flex-direction: column;
          padding: 0;
          overflow-y: auto;
          -webkit-overflow-scrolling: touch;
          overscroll-behavior: contain;
        }

        .editor-scroller {
          flex: 1;
          padding: 0 40px 100px;
          display: flex;
          flex-direction: column;
        }

        .content-title-input {
          font-size: 2.2rem;
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
          z-index: 10;
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 4px;
          margin-bottom: 16px;
          padding: 6px 10px;
          border-radius: 12px;
          border: 1px solid var(--border);
          background: var(--accent);
          max-width: fit-content;
          align-self: flex-start; /* flex child sticky fix */
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
          font-size: 1.05rem;
          line-height: 1.8;
          max-width: 860px;
          margin: 0 auto;
          color: var(--foreground);
          padding-bottom: 30vh; /* キーボード被り防止のための余白 */
        }

        .tiptap-toolbar {
          position: sticky;
          top: 0;
          z-index: 10;
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 4px;
          margin: 12px 40px;
          padding: 6px 10px;
          border-radius: 12px;
          border: 1px solid var(--border);
          background: var(--accent);
          max-width: fit-content;
          align-self: flex-start; /* flex child sticky fix */
        }

        @media (max-width: 768px) {
          .editor-scroller { padding: 0 16px 100px; }
          .content-title-input { font-size: 1.6rem; margin-top: 24px; }
          .tiptap-toolbar { margin: 4px 12px; }
          .editor-content-wrapper { padding: 0; }
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
