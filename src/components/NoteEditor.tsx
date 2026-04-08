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
  Undo, Redo, Image as ImageIcon, Loader2, Printer, Cloud,
  MoreVertical, Download, PlusSquare
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
  const [showFolderPicker, setShowFolderPicker] = useState(false);
  const [isMobileView, setIsMobileView] = useState(false);
  const [isTitleFocused, setIsTitleFocused] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const scrollerInnerRef = useRef<HTMLDivElement>(null);

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

  // --- Google Docs Style Viewport, Scroll & Cursor Tracking ---
  useEffect(() => {
    if (!isMobileView) return;

    let rafId: number;
    let lastBottomOffset = -1;

    const adjustScrollForCursor = () => {
      if (!isEditMode || !scrollerRef.current) return;

      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return;

      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();

      // カーソルが「見えない」座標（高さ0など）の場合はスキップ
      if (rect.height === 0) return;

      const scroller = scrollerRef.current;
      const header = headerRef.current;
      const vv = window.visualViewport;
      if (!vv) return;

      // 見える領域の定義 (上がヘッダー、下はビジュアルビューポートの底)
      const safeTop = header ? header.getBoundingClientRect().bottom + 10 : 80;
      const safeBottom = vv.height - 10;

      // 判定とスクロール実行
      if (rect.top < safeTop) {
        // 上に隠れた場合
        const scrollAmount = safeTop - rect.top + 40; // 少し余裕を持って戻す
        scroller.scrollBy({ top: -scrollAmount, behavior: 'smooth' });
      } else if (rect.bottom > safeBottom) {
        // 下（またはキーボードの裏）に隠れた場合
        const scrollAmount = rect.bottom - safeBottom + 40;
        scroller.scrollBy({ top: scrollAmount, behavior: 'smooth' });
      }
    };

    const updateControls = (source?: string) => {
      // カーソル追従 (入力時や選択変更時)
      if (source === 'selection' || source === 'input' || source === 'vv-resize') {
        adjustScrollForCursor();
      }
    };

    const handleSelectionChange = () => {
      // 選択変更時は少し待ってから判定（描画更新を待つ）
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => updateControls('selection'));
    };

    const handleInput = () => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => updateControls('input'));
    };

    const handleVVResize = () => {
      // iOS Safariのキーボード安定待ち
      setTimeout(() => {
        updateControls('vv-resize');
      }, 100);
    };

    const vv = window.visualViewport;
    const listeners: [EventTarget | undefined | null, string, any][] = [
      [vv, 'resize', handleVVResize],
      [vv, 'scroll', () => updateControls('vv-scroll')],
      [window, 'orientationchange', () => updateControls('orientation')],
      [document, 'focusin', () => updateControls('focus')],
      [document, 'focusout', () => updateControls('focus')],
      [document, 'selectionchange', handleSelectionChange]
    ];

    // エディタ本体のDOMにinputイベントを張る
    const editorDom = editor?.view.dom;
    if (editorDom) {
      editorDom.addEventListener('input', handleInput);
    }

    listeners.forEach(([target, event, cb]) => {
      target?.addEventListener(event, cb);
    });

    return () => {
      listeners.forEach(([target, event, cb]) => {
        target?.removeEventListener(event, cb);
      });
      if (editorDom) {
        editorDom.removeEventListener('input', handleInput);
      }
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [isMobileView, isEditMode, editor]);

  // ヘッダー高さに合わせて本文コンテナの padding-top を動的に設定（常に固定値を保つ）
  useEffect(() => {
    const header = headerRef.current;
    const inner = scrollerInnerRef.current;
    if (!header || !inner) return;

    const applyPadding = () => {
      const h = header.getBoundingClientRect().height;
      inner.style.paddingTop = `${h + 12}px`;
    };

    applyPadding();
    const observer = new ResizeObserver(applyPadding);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);


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
    const element = scrollerInnerRef.current;
    if (!element) return;
    
    // UIの一時隠ぺい用クラス追加
    document.body.classList.add('pdf-exporting');
    
    try {
      // @ts-ignore
      const html2pdf = (await import('html2pdf.js')).default;
      
      // クローンを作成して、PDF用のスタイルを適用する
      const contentClone = element.cloneNode(true) as HTMLElement;
      
      // クローンのスタイル調整: タイトル含め、PDFとして美しいレイアウトを強制
      // 全てのインライン・動的スタイルを完全にリセット
      contentClone.style.cssText = 'padding: 0 !important; margin: 0 !important; width: 100% !important; background: #ffffff !important; color: #000 !important;';
      
      // 個別にレイアウトを強制
      contentClone.style.display = 'block';
      contentClone.style.height = 'auto';
      contentClone.style.overflow = 'visible';

      // タイトル入力欄をテキストに置き換え（マージンによる空白を排除）
      const titleInput = contentClone.querySelector('.content-title-input') as HTMLInputElement;
      if (titleInput) {
        const titleDiv = document.createElement('h1');
        titleDiv.textContent = titleInput.value || 'Untitled';
        titleDiv.style.cssText = 'font-size: 28pt; font-weight: 800; margin: 0 0 20pt 0; padding: 0 0 10pt 0; border-bottom: 2pt solid #ffb6c1; color: #000; width: 100%;';
        titleInput.replaceWith(titleDiv);
      }

      // 不要なバナーやボタンを徹底的に削除
      contentClone.querySelectorAll('button, .read-mode-banner, .folder-picker-overlay').forEach(el => (el as HTMLElement).remove());
      
      // ProseMirror本体の余白リセット
      const proseMirror = contentClone.querySelector('.ProseMirror') as HTMLElement;
      if (proseMirror) {
        proseMirror.style.cssText = 'padding: 0 !important; margin: 0 !important; width: 100% !important; color: #000 !important;';
      }

      // PDF出力領域全体のパディング（20mm）を親要素に持たせるためのラップ
      const wrapper = document.createElement('div');
      wrapper.style.padding = '20mm';
      wrapper.style.background = '#ffffff';
      wrapper.appendChild(contentClone);

      const opt = {
        margin:       0,
        filename:     `${note?.title || 'Lily_Memo'}.pdf`,
        image:        { type: 'jpeg' as const, quality: 1 },
        html2canvas:  { 
          scale: 2, 
          useCORS: true,
          logging: false,
          letterRendering: true,
          scrollY: 0,
          scrollX: 0,
          windowWidth: 800
        },
        jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' as const },
        pagebreak:    { mode: ['css', 'legacy'], avoid: ['h1', 'h2', 'h3', 'li', 'pre', 'img', '.mermaid-wrapper', '.chart-wrapper'] }
      };
      
      await html2pdf().from(wrapper).set(opt).save();
    } catch (e) {
      console.error('PDF Download failed', e);
      alert('PDFの生成に失敗しました。');
    } finally {
      document.body.classList.remove('pdf-exporting');
    }
  };

  const downloadHtml = () => {
     const html = generateShareableHtml();
     if (!html) return;
     const blob = new Blob([html], { type: 'text/html' });
     const url = URL.createObjectURL(blob);
     const a = document.createElement('a');
     a.download = `${note?.title || 'Lily_Memo'}.html`;
     a.href = url;
     a.click();
     URL.revokeObjectURL(url);
  };

  if (!editor) return null;

  return (
    <div className={`editor-container bg-${bgType}`} data-edit-mode={isEditMode}>
      <header className="editor-header" ref={headerRef}>
        <div className="header-bar">
          {/* 左固定: 戻る + 保存状態 */}
          <div className="header-left">
            <button className="btn-tool btn-back" onClick={onClose} title="戻る">
              <ArrowLeft size={20} />
            </button>
            <div className="status-badge">
              {isSaving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
              <span>{isSaving ? 'Saving' : 'Saved'}</span>
            </div>
          </div>

          {/* 中央〜右: 全てのツールを一つの横スクロールエリアに統合 */}
          <div className="header-main-scroll main-toolbar">
            {isEditMode && (
              <>
                <button className="btn-tool" onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} title="戻る"><Undo size={18} /></button>
                <button className="btn-tool" onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} title="進む"><Redo size={18} /></button>
                <div className="header-divider" />
                <button className={`btn-tool ${editor.isActive('heading', { level: 2 }) ? 'active' : ''}`} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} title="大見出し"><Type size={18} /></button>
                <button className={`btn-tool ${editor.isActive('bulletList') ? 'active' : ''}`} onClick={() => editor.chain().focus().toggleBulletList().run()} title="箇条書き"><LayoutGrid size={18} /></button>
                <button className={`btn-tool ${editor.isActive('taskList') ? 'active' : ''}`} onClick={() => editor.chain().focus().toggleTaskList().run()} title="タスク"><CheckSquare size={18} /></button>
                <button className={`btn-tool ${editor.isActive('codeBlock') ? 'active' : ''}`} onClick={() => editor.chain().focus().toggleCodeBlock().run()} title="コード"><Binary size={18} /></button>
                <div className="header-divider" />
                <button className="btn-tool" onClick={addNoteAsset} title="画像"><ImageIcon size={18} /></button>
                <button className="btn-tool" onClick={insertMermaid} title="図解"><GitBranch size={18} /></button>
                <button className="btn-tool" onClick={insertChart} title="グラフ"><BarChart3 size={18} /></button>
                <div className="header-divider" />
              </>
            )}

            {/* 常時表示アクション */}
            <button className="btn-tool" onClick={shareNote} title="HTMLを共有"><Share2 size={18} /></button>
            <button className="btn-tool" onClick={downloadPdf} title="PDF保存"><Printer size={18} /></button>
            <button className="btn-tool" onClick={() => setShowFolderPicker(true)} title="フォルダ移動"><FolderInput size={18} /></button>
            <button className="btn-tool btn-tool-delete" onClick={deleteNote} title="削除"><Trash2 size={18} /></button>
            
            <div className="header-divider" />

            <button
              className={`btn-tool btn-tool-mode ${isEditMode ? 'active' : ''}`}
              onClick={() => setIsEditMode(!isEditMode)}
              title={isEditMode ? '閲覧モードへ' : '編集モードへ'}
            >
              {isEditMode ? (
                <div className="mode-active-indicator">
                  <Check size={20} strokeWidth={3} />
                </div>
              ) : (
                <Pencil size={18} />
              )}
            </button>
          </div>
        </div>
      </header>

      <div className="editor-content-wrapper" ref={scrollerRef}>
        <div className="editor-scroller" ref={scrollerInnerRef}>
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
        }

        /* ===== Header System ===== */
        .editor-header {
          position: fixed;
          top: 0; left: 0; right: 0;
          height: 60px;
          background: var(--background);
          border-bottom: 1px solid var(--border);
          z-index: 2000;
          display: flex;
          align-items: center;
          padding: 0 8px;
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
        }

        [data-theme='dark'] .editor-header {
          background: rgba(26, 26, 26, 0.9);
        }

        .header-bar {
          display: flex;
          align-items: center;
          width: 100%;
          gap: 4px;
        }

        .header-left {
          display: flex;
          align-items: center;
          flex-shrink: 0;
          gap: 4px;
        }

        .main-toolbar {
          padding-right: 12px;
        }

        .header-main-scroll {
          flex: 1;
          display: flex;
          align-items: center;
          gap: 4px;
          overflow-x: auto;
          scrollbar-width: none;
          -webkit-overflow-scrolling: touch;
        }
        .header-main-scroll::-webkit-scrollbar { display: none; }

        .header-divider {
          width: 1px;
          height: 20px;
          background: var(--border);
          margin: 0 4px;
          flex-shrink: 0;
        }

        .tool-group {
          display: flex;
          align-items: center;
          gap: 2px;
        }

        .mode-active-indicator {
          width: 36px;
          height: 36px;
          background: #ffc107;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          box-shadow: 0 0 10px rgba(255, 193, 7, 0.4);
          animation: pulse 2s infinite;
        }

        @keyframes pulse {
          0% { transform: scale(1); }
          50% { transform: scale(1.05); }
          100% { transform: scale(1); }
        }

        .btn-tool {
          width: 44px;
          height: 44px;
          border-radius: 10px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: transparent;
          color: var(--foreground);
          transition: background 0.15s, color 0.15s;
          flex-shrink: 0;
        }

        .btn-tool:hover {
          background: var(--accent);
        }

        .btn-tool.active {
          background: var(--primary);
          color: white;
        }

        .btn-tool:disabled {
          opacity: 0.3;
          cursor: default;
        }

        .btn-tool.btn-back {
          color: var(--primary);
        }

        .btn-tool.btn-tool-delete {
          color: #ef4444;
        }

        .btn-tool.btn-tool-mode.active {
          background: none;
          padding: 0;
        }

        .status-badge {
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 4px 8px;
          font-size: 0.65rem;
          font-weight: 700;
          color: #888;
          text-transform: uppercase;
          flex-shrink: 0;
        }

        /* ===== Content Layout Fix ===== */
        .editor-content-wrapper {
          flex: 1;
          display: flex;
          flex-direction: column;
          overflow-y: auto;
          overflow-x: hidden;
          -webkit-overflow-scrolling: touch;
          height: 100%;
          position: relative;
        }

        .editor-scroller {
          min-height: 100%;
          padding: 80px 40px 120px; 
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
            margin-top: 56px; 
        }

        @media (max-width: 768px) {
          .editor-scroller { padding: 70px 12px 40px; }
          .content-title-input { font-size: 1.3rem; margin-top: 8px; }
          .editor-content-wrapper { padding: 0; }
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
        }

        /* ===== Task List ===== */
        ul[data-type="taskList"] { list-style: none; padding: 0; }
        ul[data-type="taskList"] li {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          margin-bottom: 6px;
        }
        ul[data-type="taskList"] input[type="checkbox"] {
          width: 20px;
          height: 20px;
          accent-color: var(--primary);
        }
        ul[data-type="taskList"] li[data-checked="true"] > div {
          text-decoration: line-through;
          color: #999;
        }

        /* ===== Syntax Highlighting ===== */
        .hljs-comment { color: #8e908c; font-style: italic; }
        .hljs-keyword { color: #d73a49; font-weight: bold; }
        .hljs-string { color: #22863a; }

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

        /* ===== Print Optimization ===== */
        :global(.pdf-exporting p),
        :global(.pdf-exporting h1),
        :global(.pdf-exporting h2),
        :global(.pdf-exporting h3),
        :global(.pdf-exporting li),
        :global(.pdf-exporting img),
        :global(.pdf-exporting pre) {
            page-break-inside: avoid !important;
            break-inside: avoid !important;
        }

        .ProseMirror img {
          max-width: 100%;
          border-radius: 12px;
          margin: 16px 0;
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
        :global(body.pdf-exporting select) {
          display: none !important;
        }

        @keyframes slideUp {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
