'use client';

import { createPortal } from 'react-dom';
import { useEditor, EditorContent, ReactNodeViewRenderer } from '@tiptap/react';
import { useLiveQuery } from 'dexie-react-hooks';
import StarterKit from '@tiptap/starter-kit';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { ResizableImageExtension } from '@/lib/extensions';
import Placeholder from '@tiptap/extension-placeholder';
import Link from '@tiptap/extension-link';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { common, createLowlight } from 'lowlight';
import { useEffect, useState, useRef, useCallback, Component, type ErrorInfo, type ReactNode } from 'react';
import { db, type Note, type HandwritingDoc, parseHandwriting, serializeHandwriting, EMPTY_HANDWRITING, softDeleteNote } from '@/lib/db';
import {
  ArrowLeft, Trash2, Type,
  BarChart3, Binary,
  GitBranch, X, Pencil, FolderInput, Check,
  Undo, Redo, Image as ImageIcon, Loader2, BookOpen, Compass,
  Search, ChevronUp, ChevronDown, SquareCheck, Plus, Table2,
} from 'lucide-react';
import CodeBlockComponent from './CodeBlockComponent';
import HandwritingCanvas from './HandwritingCanvas';

import { MermaidExtension, ChartExtension, QAExtension, GeometryExtension, HandwritingExtension } from '@/lib/extensions';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableHeader } from '@tiptap/extension-table-header';
import { TableCell } from '@tiptap/extension-table-cell';
import { InMemoSearchExtension, searchPluginKey } from '@/lib/inMemoSearch';
import { NoteLinkExtension } from '@/lib/noteLinkExtension';
import { noteHtmlToText } from '@/lib/noteText';
import { getEffectiveApiKey } from '@/lib/appLang';
import { useT, translate } from '@/lib/i18n';

const lowlight = createLowlight(common);

class EditorErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Editor render error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '24px', color: '#ef4444', fontSize: '0.9rem' }}>
          {translate('このメモの表示中にエラーが発生しました。')}
          <button
            style={{ marginLeft: '12px', textDecoration: 'underline', background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}
            onClick={() => this.setState({ hasError: false })}
          >
            {translate('再試行')}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

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
  onSelectNote?: (id: number) => void;
  // When true, render constrained to the parent (no position:fixed
  // on container/header). Used by the sketch tab's split panel so the
  // editor doesn't escape its pane.
  embedded?: boolean;
}

export default function NoteEditor({ noteId, onClose, onSelectNote, embedded = false }: NoteEditorProps) {
  const t = useT();
  const [note, setNote] = useState<Note | null>(null);
  const [hwDoc, setHwDoc] = useState<HandwritingDoc>(EMPTY_HANDWRITING);
  const [isEditMode, setIsEditMode] = useState(false);
  const [showFolderPicker, setShowFolderPicker] = useState(false);
  const [isMobileView, setIsMobileView] = useState(false);
  const [isTitleFocused, setIsTitleFocused] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchCurrentIndex, setSearchCurrentIndex] = useState(-1);
  const [searchMatchCount, setSearchMatchCount] = useState(0);
  const [showInsertMenu, setShowInsertMenu] = useState(false);
const searchInputRef = useRef<HTMLInputElement>(null);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  // true で初期化: エディタ作成直後の onUpdate による空コンテンツ保存を防ぐ
  const isLoadingContentRef = useRef(true);
  const noteIdRef = useRef(noteId);
  noteIdRef.current = noteId;
  const headerRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const scrollerInnerRef = useRef<HTMLDivElement>(null);

  // フォルダ一覧（移動機能用）
  const folders = useLiveQuery(() => db.folders.toArray());
  // 全メモ一覧（リンク挿入用）
  const allNotes = useLiveQuery(() =>
    db.notes.filter(n => !n.deletedAt && n.id !== noteId).toArray()
  , [noteId]);

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
      QAExtension,
      GeometryExtension,
      HandwritingExtension,
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      TaskList,
      CustomTaskItem.configure({ nested: true }),
      ResizableImageExtension,
      Link,
      Placeholder.configure({ placeholder: t('アイデアを書き留めましょう...') }),
      InMemoSearchExtension,
      NoteLinkExtension,
    ],
    content: '',
    immediatelyRender: false,
    editorProps: {
      scrollThreshold: 0,
      scrollMargin: 0,
    },
    onUpdate: ({ editor }) => {
      if (noteIdRef.current && !isLoadingContentRef.current) {
        const currentNoteId = noteIdRef.current;
        const content = editor.getHTML();
        setIsSaving(true);
        if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = setTimeout(async () => {
          try {
            await db.notes.update(currentNoteId, { content, updatedAt: Date.now() });
          } finally {
            setIsSaving(false);
          }
        }, 800);
      }
    },
  });

  useEffect(() => {
    setIsMobileView(window.innerWidth <= 768);
  }, []);


  // QAチェックボックス切替時に即時保存（debounceを待たずに保存）
  useEffect(() => {
    const handler = () => {
      if (!editor || !noteIdRef.current) return;
      const noteId = noteIdRef.current;
      setTimeout(() => {
        const content = editor.getHTML();
        db.notes.update(noteId, { content, updatedAt: Date.now() });
      }, 0);
    };
    window.addEventListener('qa-checkbox-toggled', handler);
    return () => window.removeEventListener('qa-checkbox-toggled', handler);
  }, [editor]);

  // 編集モード↔閲覧モード切替でエディタのeditableを制御
  // setEditable(true)するとTipTapがcontenteditable要素にフォーカスしてiOSキーボードが出るため
  // requestAnimationFrameでblurして自動表示を防ぐ
  useEffect(() => {
    if (!editor) return;
    editor.setEditable(isEditMode);
    if (isEditMode) {
      requestAnimationFrame(() => {
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
      });
    }
  }, [editor, isEditMode]);

  // [[note]] リンクのクリックでメモを開く
  useEffect(() => {
    if (!editor || !onSelectNote) return;
    const dom = editor.view.dom;
    const handleClick = async (e: MouseEvent) => {
      const target = (e.target as HTMLElement).closest('[data-note-link]') as HTMLElement | null;
      if (!target) return;
      e.preventDefault();
      const title = target.getAttribute('data-note-title') || '';
      const rawId = target.getAttribute('data-note-id');
      if (rawId) {
        const id = parseInt(rawId);
        if (!isNaN(id)) { onSelectNote(id); return; }
      }
      if (title) {
        const { db } = await import('@/lib/db');
        const note = await db.notes
          .filter(n => !n.deletedAt && (n.title || '').toLowerCase() === title.toLowerCase())
          .first();
        if (note?.id) onSelectNote(note.id);
      }
    };
    dom.addEventListener('click', handleClick);
    return () => dom.removeEventListener('click', handleClick);
  }, [editor, onSelectNote]);

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
    const lastBottomOffset = -1;

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
    const updateHeaderPos = () => {
      if (!headerRef.current || !vv) return;
      // ビジュアルビューポートのオフセットに合わせてヘッダーを移動
      const offset = vv.offsetTop;
      headerRef.current.style.transform = `translateY(${Math.max(0, offset)}px)`;
    };

    const listeners: [EventTarget | undefined | null, string, EventListenerOrEventListenerObject][] = [
      [vv, 'resize', handleVVResize],
      [vv, 'scroll', () => {
        updateControls('vv-scroll');
        updateHeaderPos();
      }],
      [window, 'orientationchange', () => updateControls('orientation')],
      [document, 'focusin', () => updateControls('focus')],
      [document, 'focusout', () => updateControls('focus')],
      [document, 'selectionchange', handleSelectionChange]
    ];

    if (vv) {
      vv.addEventListener('resize', updateHeaderPos);
    }

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
    // ノート切替直後のセーブをブロック（非同期ロード完了まで）
    isLoadingContentRef.current = true;
    let cancelled = false;

    async function loadNote() {
      try {
        const data = await db.notes.get(noteId);
        if (cancelled) return;
        if (data && editor) {
          setNote(data);
          if (data.type === 'handwriting') {
            setHwDoc(parseHandwriting(data.content));
            editor.commands.setContent('');
          } else {
            setHwDoc(EMPTY_HANDWRITING);
            editor.commands.setContent(data.content || '');
          }
          // Prevent iOS keyboard from auto-showing after note load
          requestAnimationFrame(() => {
            if (document.activeElement instanceof HTMLElement) {
              document.activeElement.blur();
            }
          });
        }
      } catch (e) {
        console.error('Failed to load note:', e);
      } finally {
        if (!cancelled) {
          isLoadingContentRef.current = false;
        }
      }
    }

    if (editor) {
      loadNote();
    }

    return () => { cancelled = true; };
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

  const handleHandwritingChange = (next: HandwritingDoc) => {
    setHwDoc(next);
    setIsSaving(true);
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(async () => {
      try {
        await db.notes.update(noteId, { content: serializeHandwriting(next), updatedAt: Date.now() });
      } finally {
        setIsSaving(false);
      }
    }, 500);
  };

  const updateTitle = async (title: string) => {
    setNote(prev => prev ? { ...prev, title } : null);
    await db.notes.update(noteId, { title, updatedAt: Date.now() });
  };

  const deleteNote = async () => {
    if (confirm(t('このメモを削除してもよろしいですか？'))) {
      await softDeleteNote(noteId);
      onClose?.();
    }
  };

  const dispatchSearch = useCallback((query: string, index: number) => {
    if (!editor) return;
    editor.view.dispatch(
      editor.state.tr.setMeta(searchPluginKey, { query, currentIndex: index })
    );
    const state = searchPluginKey.getState(editor.state);
    const count = state?.matches.length ?? 0;
    setSearchMatchCount(count);
    setSearchCurrentIndex(index);
    if (state && state.matches[index]) {
      const { from, to } = state.matches[index];
      editor.commands.setTextSelection({ from, to });
      editor.commands.scrollIntoView();
    }
  }, [editor]);

  const openSearch = () => {
    setShowSearch(true);
    setTimeout(() => searchInputRef.current?.focus(), 50);
  };

  const closeSearch = useCallback(() => {
    setShowSearch(false);
    setSearchQuery('');
    setSearchCurrentIndex(-1);
    setSearchMatchCount(0);
    if (editor) {
      editor.view.dispatch(
        editor.state.tr.setMeta(searchPluginKey, { query: '', currentIndex: -1 })
      );
    }
  }, [editor]);

  const handleSearchChange = (q: string) => {
    setSearchQuery(q);
    dispatchSearch(q, 0);
  };

  const prevMatch = () => {
    const next = searchCurrentIndex <= 0 ? searchMatchCount - 1 : searchCurrentIndex - 1;
    dispatchSearch(searchQuery, next);
  };

  const nextMatch = () => {
    const next = searchCurrentIndex >= searchMatchCount - 1 ? 0 : searchCurrentIndex + 1;
    dispatchSearch(searchQuery, next);
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && showSearch) closeSearch();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [showSearch, closeSearch]);

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
      reader.onload = async () => {
        const url = reader.result as string;
        editor.chain().insertContentAt(to, { type: 'image', attrs: { src: url, width: '100%' } }).run();
        // 画像挿入後は即座に保存（デバウンスをバイパス）
        if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
        const content = editor.getHTML();
        try {
          await db.notes.update(noteId, { content, updatedAt: Date.now() });
        } catch (e) {
          console.error('Failed to save image:', e);
        }
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
            backgroundColor: ['rgba(255,99,132,0.75)','rgba(54,162,235,0.75)','rgba(255,206,86,0.75)'],
          }],
        },
      },
    });
  };

  const insertQA = () => {
    insertWithoutFocus({
      type: 'qa',
      attrs: { pairs: [] },
    });
  };


  const insertGeometry = () => {
    insertWithoutFocus({
      type: 'geometry',
      attrs: {
        code: JSON.stringify({
          title: '幾何の図',
          xRange: [-4, 4],
          yRange: [-3, 3],
          elements: [
            { type: 'vector', from: [0, 0], to: [3, 1], label: 'a', color: '#e84393' },
            { type: 'vector', from: [0, 0], to: [1, 2], label: 'b', color: '#2196f3' },
            { type: 'segment', from: [3, 1], to: [4, 3], color: '#2196f3', dashed: true },
            { type: 'segment', from: [1, 2], to: [4, 3], color: '#e84393', dashed: true },
            { type: 'vector', from: [0, 0], to: [4, 3], label: 'a+b', color: '#4caf50' },
            { type: 'point', x: 0, y: 0, label: 'O', color: '#333' },
          ],
        }, null, 2),
        width: '100%',
      },
    });
  };

  const insertTable = () => {
    if (!editor) return;
    editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
  };

  const insertHandwriting = () => {
    insertWithoutFocus({
      type: 'handwriting',
      attrs: { data: JSON.stringify({ strokes: [], width: 1280, height: 900 }) },
    });
  };






  if (!editor) return null;
  const isHandwriting = note?.type === 'handwriting';

  return (
    <div className={`editor-container${embedded ? ' embedded' : ''}`} data-edit-mode={isEditMode}>
      <header className="editor-header" ref={headerRef}>
        <div className="header-bar">
          {/* 左固定: 戻る + 保存状態 */}
          <div className="header-left">
            <button className="btn-tool btn-back" onClick={onClose} title={t('戻る')}>
              <ArrowLeft size={20} />
            </button>
            <div className="status-badge">
              {isSaving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
              <span>{isSaving ? 'Saving' : 'Saved'}</span>
            </div>
          </div>

          {/* 中央〜右: 全てのツールを一つの横スクロールエリアに統合 */}
          <div className="header-main-scroll main-toolbar">
            {isEditMode && !isHandwriting && (
              <>
                <button className="btn-tool" onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} title={t('戻る')}><Undo size={18} /></button>
                <button className="btn-tool" onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} title={t('進む')}><Redo size={18} /></button>
                <div className="header-divider" />
                <button className={`btn-tool ${editor.isActive('heading', { level: 2 }) ? 'active' : ''}`} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} title={t('大見出し')}><Type size={18} /></button>
<button className={`btn-tool ${editor.isActive('taskList') ? 'active' : ''}`} onClick={() => editor.chain().focus().toggleTaskList().run()} title={t('チェックリスト')}><SquareCheck size={18} /></button>
                <button className={`btn-tool ${editor.isActive('codeBlock') ? 'active' : ''}`} onClick={() => editor.chain().focus().toggleCodeBlock().run()} title={t('コード')}><Binary size={18} /></button>
                <div className="header-divider" />
                <button
                  className={`btn-tool${showInsertMenu ? ' active' : ''}`}
                  onClick={() => setShowInsertMenu(p => !p)}
                  title={t('挿入')}
                >
                  <Plus size={18} />
                </button>
                {showInsertMenu && typeof document !== 'undefined' && createPortal(
                  <div className="insert-sheet-backdrop" onClick={() => setShowInsertMenu(false)}>
                    <div className="insert-sheet" onClick={e => e.stopPropagation()}>
                      <div className="insert-sheet-handle" />
                      <div className="insert-sheet-title">{t('挿入')}</div>
                      <div className="insert-sheet-grid">
                        <button className="insert-sheet-item" onClick={() => { addNoteAsset(); setShowInsertMenu(false); }}><ImageIcon size={22} /><span>{t('画像')}</span></button>
                        <button className="insert-sheet-item" onClick={() => { insertMermaid(); setShowInsertMenu(false); }}><GitBranch size={22} /><span>{t('図解')}</span></button>
                        <button className="insert-sheet-item" onClick={() => { insertChart(); setShowInsertMenu(false); }}><BarChart3 size={22} /><span>{t('グラフ')}</span></button>
                        <button className="insert-sheet-item" onClick={() => { insertQA(); setShowInsertMenu(false); }}><BookOpen size={22} /><span>Q&A</span></button>
                        <button className="insert-sheet-item" onClick={() => { insertGeometry(); setShowInsertMenu(false); }}><Compass size={22} /><span>{t('幾何')}</span></button>
                        <button className="insert-sheet-item" onClick={() => { insertTable(); setShowInsertMenu(false); }}><Table2 size={22} /><span>{t('表')}</span></button>
                        <button className="insert-sheet-item" onClick={() => { insertHandwriting(); setShowInsertMenu(false); }}><Pencil size={22} /><span>{t('手書き')}</span></button>
                      </div>
                    </div>
                  </div>,
                  document.body
                )}
                <div className="header-divider" />
              </>
            )}

            {/* 常時表示アクション */}

            <button className="btn-tool" onClick={openSearch} title={t('メモ内検索')}><Search size={18} /></button>
            <button className="btn-tool" onClick={() => setShowFolderPicker(true)} title={t('フォルダ移動')}><FolderInput size={18} /></button>
            <button className="btn-tool btn-tool-delete" onClick={deleteNote} title={t('削除')}><Trash2 size={18} /></button>

            <div className="header-divider" />

            <button
              className={`btn-tool btn-tool-mode ${isEditMode ? 'active' : ''}`}
              onClick={() => setIsEditMode(!isEditMode)}
              title={isEditMode ? t('閲覧モードへ') : t('編集モードへ')}
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

        {showSearch && (
          <div className="in-memo-searchbar">
            <Search size={16} className="search-bar-icon" />
            <input
              ref={searchInputRef}
              type="text"
              className="search-bar-input"
              value={searchQuery}
              onChange={e => handleSearchChange(e.target.value)}
              placeholder={t('メモ内を検索...')}
            />
            <span className="search-bar-count">
              {searchMatchCount > 0 ? `${searchCurrentIndex + 1} / ${searchMatchCount}` : t('0件')}
            </span>
            <button className="btn-tool" onClick={prevMatch} disabled={searchMatchCount === 0} title={t('前へ')}>
              <ChevronUp size={16} />
            </button>
            <button className="btn-tool" onClick={nextMatch} disabled={searchMatchCount === 0} title={t('次へ')}>
              <ChevronDown size={16} />
            </button>
            <button className="btn-tool" onClick={closeSearch} title={t('閉じる')}>
              <X size={16} />
            </button>
          </div>
        )}
        {isEditMode && editor && editor.isActive('table') && (
          <div className="table-context-menu">
            <button className="btn-table-ctx" onClick={() => editor.chain().focus().addColumnBefore().run()} title={t('列を左に追加')}>{t('列+左')}</button>
            <button className="btn-table-ctx" onClick={() => editor.chain().focus().addColumnAfter().run()} title={t('列を右に追加')}>{t('列+右')}</button>
            <button className="btn-table-ctx" onClick={() => editor.chain().focus().addRowBefore().run()} title={t('行を上に追加')}>{t('行+上')}</button>
            <button className="btn-table-ctx" onClick={() => editor.chain().focus().addRowAfter().run()} title={t('行を下に追加')}>{t('行+下')}</button>
            <button className="btn-table-ctx btn-table-ctx-danger" onClick={() => editor.chain().focus().deleteRow().run()} title={t('行を削除')}>{t('行削除')}</button>
            <button className="btn-table-ctx btn-table-ctx-danger" onClick={() => editor.chain().focus().deleteColumn().run()} title={t('列を削除')}>{t('列削除')}</button>
            <button className="btn-table-ctx btn-table-ctx-danger" onClick={() => editor.chain().focus().deleteTable().run()} title={t('表を削除')}>{t('表削除')}</button>
          </div>
        )}
      </header>

      <div className="editor-content-wrapper" ref={scrollerRef}>
        <div className="editor-scroller" ref={scrollerInnerRef}>
            <input
              type="text"
              className="content-title-input"
              value={note?.title || ''}
              onChange={(e) => updateTitle(e.target.value)}
              placeholder={t('タイトル...')}
              readOnly={!isEditMode}
              tabIndex={isEditMode ? 0 : -1}
            />
            {isHandwriting ? (
              <div className="handwriting-host">
                <HandwritingCanvas
                  value={hwDoc}
                  onChange={handleHandwritingChange}
                  readOnly={!isEditMode}
                />
              </div>
            ) : (
              <EditorErrorBoundary>
                <EditorContent editor={editor} />
              </EditorErrorBoundary>
            )}
        </div>
      </div>


      {/* フォルダ移動ピッカー */}
      {showFolderPicker && (
        <div className="folder-picker-overlay" onClick={() => setShowFolderPicker(false)}>
          <div className="folder-picker-sheet" onClick={e => e.stopPropagation()}>
            <div className="folder-picker-header">
              <span>{t('フォルダに移動')}</span>
              <button onClick={() => setShowFolderPicker(false)}><X size={18} /></button>
            </div>
            <div className="folder-picker-list">
              <button
                className={`folder-picker-item ${!note?.folderId ? 'fp-selected' : ''}`}
                onClick={() => moveToFolder(undefined)}
              >
                <div className="fp-dot" style={{ background: '#ccc' }} />
                <span>{t('フォルダなし')}</span>
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
        /* ===== Search Highlight Decorations ===== */
        .search-highlight {
          background: rgba(255, 193, 7, 0.35);
          border-radius: 2px;
        }
        .search-highlight.current {
          background: rgba(255, 140, 0, 0.65);
          border-radius: 2px;
        }
        /* ===== Handwriting host ===== */
        .handwriting-host {
          padding: 8px 0 24px;
        }
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

        /* 横画面: サイドバーと並べて表示するため fixed を解除 */
        .landscape-mode .editor-container {
          border-radius: 0;
          position: relative;
          width: auto;
          z-index: auto;
        }

        /* モバイル横画面でメモを開いた時: サイドバーを非表示にして全画面表示 */
        .mobile-landscape-note .editor-container {
          border-radius: 0;
          position: fixed;
          top: 0; left: 0;
          width: 100%;
          height: 100vh;
          height: 100dvh;
          z-index: 1001;
        }

        /* 埋め込みモード（落書きタブの分割パネル等）。
           viewport を覆う position:fixed / 100dvh をすべて打ち消し
           親要素にぴったり収める。後置されているので cascade で勝つ。*/
        .editor-container.embedded {
          position: absolute;
          inset: 0;
          top: 0; left: 0;
          width: 100%;
          height: 100%;
          z-index: auto;
          border-radius: 0;
          box-shadow: none;
        }
        .editor-container.embedded .editor-header {
          position: absolute;
          top: 0; left: 0; right: 0;
          z-index: 1;
        }

        .desktop-sidebar .editor-header {
          left: 280px;
        }

        /* ===== Header System ===== */
        .editor-header {
          position: fixed;
          top: 0; left: 0; right: 0;
          min-height: 60px;
          background: var(--background);
          border-bottom: 1px solid var(--border);
          z-index: 2000;
          display: flex;
          flex-direction: column;
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
        }

        [data-theme='dark'] .editor-header {
          background: rgba(26, 26, 26, 0.9);
        }

        .in-memo-searchbar {
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 6px 12px;
          background: var(--accent);
          border-top: 1px solid var(--border);
          flex-shrink: 0;
        }
        .search-bar-icon {
          color: #999;
          flex-shrink: 0;
        }
        .search-bar-input {
          flex: 1;
          border: none;
          background: transparent;
          font-size: 0.9rem;
          color: var(--foreground);
          outline: none;
          padding: 2px 6px;
          min-width: 0;
        }
        .search-bar-count {
          font-size: 0.75rem;
          color: #888;
          white-space: nowrap;
          min-width: 52px;
          text-align: center;
        }
        .header-bar {
          display: flex;
          align-items: center;
          width: 100%;
          gap: 4px;
          height: 60px;
          padding: 0 8px;
          flex-shrink: 0;
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

        /* ===== 挿入ボトムシート ===== */
        .insert-sheet-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.4);
          z-index: 9000;
          display: flex;
          align-items: flex-end;
        }
        .insert-sheet {
          width: 100%;
          background: var(--background);
          border-radius: 20px 20px 0 0;
          padding: 12px 20px calc(24px + env(safe-area-inset-bottom));
          animation: sheetSlideUp 0.22s ease;
        }
        @keyframes sheetSlideUp {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
        .insert-sheet-handle {
          width: 36px; height: 4px;
          background: var(--border);
          border-radius: 2px;
          margin: 0 auto 14px;
        }
        .insert-sheet-title {
          font-size: 0.78rem;
          font-weight: 800;
          letter-spacing: 0.5px;
          text-transform: uppercase;
          color: var(--primary);
          margin-bottom: 16px;
        }
        .insert-sheet-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 10px;
        }
        .insert-sheet-item {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 6px;
          padding: 14px 8px;
          background: var(--accent);
          border: 1.5px solid var(--border);
          border-radius: 14px;
          cursor: pointer;
          color: var(--foreground);
          font-size: 0.78rem;
          font-weight: 600;
          transition: background 0.14s;
        }
        .insert-sheet-item:hover, .insert-sheet-item:active { background: color-mix(in srgb, var(--primary) 12%, transparent); border-color: var(--primary); color: var(--primary); }

        /* ===== AI クイック操作メニュー ===== */
        .ai-menu-wrap { position: relative; }
        .ai-menu-dropdown {
          position: absolute;
          top: calc(100% + 4px);
          right: 0;
          z-index: 200;
          background: var(--background);
          border: 1.5px solid var(--border);
          border-radius: 12px;
          box-shadow: 0 10px 32px rgba(0,0,0,0.18);
          min-width: 260px;
          overflow: hidden;
        }
        .ai-menu-header {
          padding: 8px 14px;
          font-size: 0.72rem;
          font-weight: 800;
          letter-spacing: 0.5px;
          text-transform: uppercase;
          color: var(--primary);
          background: color-mix(in srgb, var(--primary) 8%, transparent);
          border-bottom: 1px solid var(--border);
        }
        .ai-menu-item {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          width: 100%;
          padding: 10px 14px;
          background: none;
          border: none;
          text-align: left;
          cursor: pointer;
          border-bottom: 1px solid color-mix(in srgb, var(--border) 50%, transparent);
          transition: background 0.14s;
        }
        .ai-menu-item:last-child { border-bottom: none; }
        .ai-menu-item:hover:not(:disabled) { background: var(--accent); }
        .ai-menu-item:disabled { opacity: 0.5; cursor: default; }
        .ai-menu-emoji { font-size: 1.15rem; line-height: 1.4; }
        .ai-menu-text { display: flex; flex-direction: column; gap: 2px; flex: 1; }
        .ai-menu-label { font-size: 0.88rem; font-weight: 700; color: var(--foreground); }
        .ai-menu-desc { font-size: 0.74rem; color: var(--fg-muted); line-height: 1.4; }
        .ai-error-toast {
          position: fixed;
          bottom: 24px;
          left: 50%;
          transform: translateX(-50%);
          background: #e0584f;
          color: #fff;
          padding: 10px 18px;
          border-radius: 999px;
          font-size: 0.85rem;
          font-weight: 600;
          box-shadow: 0 6px 22px rgba(0,0,0,0.22);
          z-index: 9999;
          max-width: 90vw;
        }
        .ai-error-toast button {
          background: transparent;
          border: none;
          color: #fff;
          margin-left: 12px;
          font-weight: 800;
          cursor: pointer;
        }

        /* ===== メモ間リンク ===== */
        .note-link {
          display: inline-flex;
          align-items: center;
          background: color-mix(in srgb, var(--primary) 12%, transparent);
          color: var(--primary);
          border: 1px solid color-mix(in srgb, var(--primary) 35%, transparent);
          border-radius: 4px;
          padding: 1px 6px;
          font-size: 0.88em;
          cursor: pointer;
          user-select: none;
          transition: background 0.15s;
        }
        .note-link:hover { background: color-mix(in srgb, var(--primary) 22%, transparent); }

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

        @keyframes slideUp {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
