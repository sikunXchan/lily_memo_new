'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Sparkles, Send, ChevronDown, ChevronUp, RotateCcw, Book, Brush, FileText, Settings as SettingsIcon, Paperclip, X } from 'lucide-react';
import { db } from '@/lib/db';
import type { Note } from '@/lib/db';
import { callGeminiChat, LILY_CHAT_SYSTEM_PROMPT } from '@/lib/gemini';
import type { ChatTurn, ChatAttachment } from '@/lib/gemini';

const MAX_FILE_BYTES = 12 * 1024 * 1024; // 12MB
const ACCEPTED_FILE_TYPES = 'image/png,image/jpeg,image/webp,image/heic,image/heif,application/pdf,text/plain';

interface AttachmentMeta {
  name: string;
  mimeType: string;
  data: string; // base64
  isImage: boolean;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'lily';
  text: string;
  timestamp: number;
  extractedBlocks?: InsertableBlock[];
  attachment?: { name: string; isImage: boolean; data: string; mimeType: string };
}

interface InsertableBlock {
  id: string;
  type: 'mermaid' | 'chart' | 'qa';
  rawCode: string;
  previewLabel: string;
}

interface AIChatProps {
  onOpenSettings: () => void;
  onSwitchTab?: (tab: 'memos' | 'sketch' | 'pdf' | 'settings') => void;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim();
}

function escHtmlAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function detectMermaidLabel(code: string): string {
  if (/sequenceDiagram/i.test(code)) return 'シーケンス図';
  if (/classDiagram/i.test(code)) return 'クラス図';
  if (/gantt/i.test(code)) return 'ガントチャート';
  if (/pie/i.test(code)) return '円グラフ(Mermaid)';
  if (/erDiagram/i.test(code)) return 'ER図';
  if (/graph|flowchart/i.test(code)) return 'フローチャート';
  return 'Mermaid図';
}

function detectChartLabel(code: string): string {
  try {
    const p = JSON.parse(code);
    const m: Record<string, string> = { bar: '棒グラフ', line: '折れ線グラフ', pie: '円グラフ', scatter: '散布図' };
    return m[p.type as string] ?? 'グラフ';
  } catch { return 'グラフ'; }
}

function parseQAPairs(code: string): { q: string; a: string }[] {
  const lines = code.split('\n').map(l => l.trim()).filter(Boolean);
  const pairs: { q: string; a: string }[] = [];
  let pendingQ: string | null = null;
  for (const line of lines) {
    const qm = line.match(/^[Qq]\d*[:.：]\s*(.*)/);
    const am = line.match(/^[Aa]\d*[:.：]\s*(.*)/);
    if (qm) pendingQ = qm[1];
    else if (am && pendingQ !== null) {
      pairs.push({ q: pendingQ, a: am[1] });
      pendingQ = null;
    }
  }
  return pairs;
}

function parseAIResponse(text: string): { textContent: string; blocks: InsertableBlock[] } {
  const FENCE_RE = /```(mermaid|chart|qa)([\s\S]*?)```/g;
  const blocks: InsertableBlock[] = [];
  const textContent = text.replace(FENCE_RE, (_full, type, code) => {
    const trimmed = code.trim();
    const id = crypto.randomUUID();
    if (type === 'mermaid') {
      blocks.push({ id, type: 'mermaid', rawCode: trimmed, previewLabel: detectMermaidLabel(trimmed) });
      return `\n✨ [${detectMermaidLabel(trimmed)}を作成しました]\n`;
    }
    if (type === 'chart') {
      try { JSON.parse(trimmed); } catch { return '\n[グラフの生成に失敗しました]\n'; }
      blocks.push({ id, type: 'chart', rawCode: trimmed, previewLabel: detectChartLabel(trimmed) });
      return `\n✨ [${detectChartLabel(trimmed)}を作成しました]\n`;
    }
    if (type === 'qa') {
      const pairs = parseQAPairs(trimmed);
      if (pairs.length === 0) return '\n[Q&Aの解析に失敗しました]\n';
      const label = `${pairs.length}問のQ&A`;
      blocks.push({ id, type: 'qa', rawCode: trimmed, previewLabel: label });
      return `\n✨ [${label}を作成しました]\n`;
    }
    return '';
  }).trim();
  return { textContent, blocks };
}

async function insertBlockIntoNote(block: InsertableBlock, noteId: number): Promise<void> {
  const note = await db.notes.get(noteId);
  if (!note) throw new Error('メモが見つかりません');

  let appendHtml = '';
  if (block.type === 'mermaid') {
    appendHtml = `<div content="${escHtmlAttr(block.rawCode)}" width="100%" data-type="mermaid"></div>`;
  } else if (block.type === 'chart') {
    try {
      const parsed = JSON.parse(block.rawCode);
      const codeStr = `return ${JSON.stringify(parsed)};`;
      appendHtml = `<div code="${escHtmlAttr(codeStr)}" type="${escHtmlAttr(parsed.type || 'bar')}" width="100%" data-type="chart"></div>`;
    } catch { throw new Error('グラフデータの解析に失敗しました'); }
  } else if (block.type === 'qa') {
    const pairs = parseQAPairs(block.rawCode);
    if (pairs.length === 0) throw new Error('Q&Aの解析に失敗しました');
    appendHtml = `<div data-pairs="${escHtmlAttr(JSON.stringify(pairs))}" data-type="qa"></div>`;
  }

  if (!appendHtml) return;
  await db.notes.update(noteId, {
    content: (note.content || '') + appendHtml,
    updatedAt: Date.now(),
  });
}

function buildSystemPrompt(contextNotes: Note[]): string {
  if (contextNotes.length === 0) return LILY_CHAT_SYSTEM_PROMPT;
  const context = contextNotes
    .map(n => `## ${n.title || '無題'}\n${stripHtml(n.content || '').slice(0, 2000)}`)
    .join('\n\n---\n\n');
  return `${LILY_CHAT_SYSTEM_PROMPT}\n\n【参照中のメモ (${contextNotes.length}件)】\n${context}`;
}

function InsertableBlockCard({
  block,
  allNotes,
  defaultNoteId,
}: {
  block: InsertableBlock;
  allNotes: Note[];
  defaultNoteId?: number;
}) {
  const [targetNoteId, setTargetNoteId] = useState<number | undefined>(defaultNoteId ?? allNotes[0]?.id);
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const typeEmoji = block.type === 'mermaid' ? '🌊' : block.type === 'chart' ? '📊' : '📚';

  const handleInsert = async () => {
    if (!targetNoteId || status === 'loading') return;
    setStatus('loading');
    setErrorMsg('');
    try {
      await insertBlockIntoNote(block, targetNoteId);
      setStatus('success');
      setTimeout(() => setStatus('idle'), 2500);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : '挿入に失敗しました');
      setStatus('error');
      setTimeout(() => setStatus('idle'), 3000);
    }
  };

  return (
    <div className="insertable-block">
      <div className="block-header">
        <span className="block-type-badge">
          {typeEmoji} {block.previewLabel}
        </span>
      </div>
      <pre className="block-preview">{block.rawCode.slice(0, 120)}{block.rawCode.length > 120 ? '...' : ''}</pre>
      <div className="block-insert-row">
        {allNotes.length > 0 ? (
          <select
            className="note-select"
            value={targetNoteId ?? ''}
            onChange={e => setTargetNoteId(Number(e.target.value))}
          >
            {allNotes.map(n => (
              <option key={n.id} value={n.id}>{n.title || '無題のメモ'}</option>
            ))}
          </select>
        ) : (
          <span className="no-notes-hint">メモがありません</span>
        )}
        <button
          className={`insert-btn ${status}`}
          onClick={handleInsert}
          disabled={!targetNoteId || status === 'loading' || status === 'success'}
        >
          {status === 'loading' ? '...挿入中' : status === 'success' ? '✓ 挿入完了！' : status === 'error' ? '✕ 失敗' : 'メモに追加'}
        </button>
      </div>
      {errorMsg && <p className="block-error">{errorMsg}</p>}

      <style jsx>{`
        .insertable-block {
          background: var(--background);
          border: 1px solid var(--border);
          border-radius: 10px;
          padding: 10px 12px;
          margin-top: 8px;
        }
        .block-header { margin-bottom: 6px; }
        .block-type-badge {
          background: color-mix(in srgb, var(--primary) 15%, transparent);
          color: var(--primary);
          border-radius: 20px;
          padding: 3px 10px;
          font-size: 0.78rem;
          font-weight: 700;
        }
        .block-preview {
          font-family: 'Fira Code', 'Consolas', monospace;
          font-size: 0.72rem;
          color: var(--fg-muted);
          background: var(--accent);
          border-radius: 6px;
          padding: 6px 8px;
          margin: 6px 0 8px;
          white-space: pre-wrap;
          word-break: break-all;
          overflow: hidden;
          max-height: 70px;
          line-height: 1.4;
        }
        .block-insert-row {
          display: flex;
          gap: 8px;
          align-items: center;
        }
        .note-select {
          flex: 1;
          min-width: 0;
          background: var(--accent);
          border: 1px solid var(--border);
          border-radius: 8px;
          padding: 5px 8px;
          font-size: 0.8rem;
          color: var(--foreground);
          outline: none;
        }
        .no-notes-hint {
          flex: 1;
          font-size: 0.78rem;
          color: var(--fg-muted);
        }
        .insert-btn {
          flex-shrink: 0;
          background: var(--primary);
          color: white;
          border: none;
          border-radius: 8px;
          padding: 6px 14px;
          font-size: 0.8rem;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.2s;
          white-space: nowrap;
        }
        .insert-btn.success { background: #22863a; }
        .insert-btn.error { background: #cc0000; }
        .insert-btn:disabled { opacity: 0.6; cursor: default; }
        .block-error {
          font-size: 0.75rem;
          color: #cc0000;
          margin-top: 4px;
        }
      `}</style>
    </div>
  );
}

function LilyBubble({
  message,
  allNotes,
  selectedNoteId,
}: {
  message: ChatMessage;
  allNotes: Note[];
  selectedNoteId?: number;
}) {
  return (
    <div className="lily-bubble-row">
      <div className="lily-avatar">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/lily-character.png" alt="Lily" className="avatar-img" />
      </div>
      <div className="lily-bubble-wrap">
        <div className="lily-bubble">
          {message.text.split('\n').map((line, i) => (
            <span key={i}>{line}{i < message.text.split('\n').length - 1 && <br />}</span>
          ))}
        </div>
        {message.extractedBlocks && message.extractedBlocks.length > 0 && (
          <div className="block-list">
            {message.extractedBlocks.map(block => (
              <InsertableBlockCard
                key={block.id}
                block={block}
                allNotes={allNotes}
                defaultNoteId={selectedNoteId}
              />
            ))}
          </div>
        )}
      </div>

      <style jsx>{`
        .lily-bubble-row {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          align-self: flex-start;
          max-width: 85%;
        }
        .lily-avatar {
          flex-shrink: 0;
          width: 36px;
          height: 36px;
          border-radius: 50%;
          overflow: hidden;
          background: var(--accent);
          border: 2px solid var(--border);
        }
        .avatar-img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          object-position: top center;
        }
        .lily-bubble-wrap { flex: 1; min-width: 0; }
        .lily-bubble {
          background: var(--accent);
          border: 1px solid var(--border);
          border-radius: 4px 16px 16px 16px;
          padding: 10px 14px;
          font-size: 0.9rem;
          line-height: 1.65;
          color: var(--foreground);
          word-break: break-word;
        }
        .block-list { margin-top: 4px; }
      `}</style>
    </div>
  );
}

function UserBubble({ message }: { message: ChatMessage }) {
  const att = message.attachment;
  return (
    <div className="user-bubble-row">
      <div className="user-bubble">
        {att && (
          <div className="att-preview">
            {att.isImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`data:${att.mimeType};base64,${att.data}`} alt={att.name} className="att-img" />
            ) : (
              <span className="att-file">📎 {att.name}</span>
            )}
          </div>
        )}
        {message.text.split('\n').map((line, i) => (
          <span key={i}>{line}{i < message.text.split('\n').length - 1 && <br />}</span>
        ))}
      </div>
      <style jsx>{`
        .user-bubble-row {
          display: flex;
          justify-content: flex-end;
          align-self: flex-end;
          max-width: 80%;
        }
        .user-bubble {
          background: var(--primary);
          color: white;
          border-radius: 16px 4px 16px 16px;
          padding: 10px 14px;
          font-size: 0.9rem;
          line-height: 1.65;
          word-break: break-word;
        }
        .att-preview { margin-bottom: 6px; }
        .att-img {
          max-width: 200px;
          max-height: 200px;
          border-radius: 10px;
          display: block;
        }
        .att-file {
          display: inline-block;
          background: rgba(255,255,255,0.25);
          border-radius: 8px;
          padding: 4px 10px;
          font-size: 0.82rem;
        }
      `}</style>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="typing-row">
      <div className="typing-avatar">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/lily-character.png" alt="Lily" className="avatar-img" />
      </div>
      <div className="typing-bubble">
        <span className="dot" />
        <span className="dot" />
        <span className="dot" />
      </div>
      <style jsx>{`
        .typing-row {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          align-self: flex-start;
        }
        .typing-avatar {
          flex-shrink: 0;
          width: 36px;
          height: 36px;
          border-radius: 50%;
          overflow: hidden;
          background: var(--accent);
          border: 2px solid var(--border);
        }
        .avatar-img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          object-position: top center;
        }
        .typing-bubble {
          background: var(--accent);
          border: 1px solid var(--border);
          border-radius: 4px 16px 16px 16px;
          padding: 12px 16px;
          display: flex;
          gap: 5px;
          align-items: center;
        }
        .dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: var(--primary);
          animation: bounce 1.2s infinite ease-in-out;
        }
        .dot:nth-child(2) { animation-delay: 0.2s; }
        .dot:nth-child(3) { animation-delay: 0.4s; }
        @keyframes bounce {
          0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
          40% { transform: translateY(-6px); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

const SUGGESTIONS = [
  'このメモを要約して',
  'UML図を作って',
  '問題を5問作って',
  'グラフにして',
  'アドバイスして',
];

export default function AIChat({ onOpenSettings, onSwitchTab }: AIChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [selectedNoteId, setSelectedNoteId] = useState<number | undefined>();
  const [showContextPanel, setShowContextPanel] = useState(false);
  const [apiKey, setApiKey] = useState<string>('');
  const [attachment, setAttachment] = useState<AttachmentMeta | null>(null);
  const [fileError, setFileError] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const allNotes = useLiveQuery(
    () => db.notes.filter(n => !n.deletedAt && n.type !== 'handwriting').toArray(),
    []
  );

  useEffect(() => {
    const key = localStorage.getItem('lily_gemini_api_key') || '';
    setApiKey(key);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const autoResizeTextarea = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file
    if (!file) return;
    setFileError('');
    if (file.size > MAX_FILE_BYTES) {
      setFileError('ファイルが大きすぎます（12MBまで）');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1] ?? '';
      setAttachment({
        name: file.name,
        mimeType: file.type || 'application/octet-stream',
        data: base64,
        isImage: file.type.startsWith('image/'),
      });
    };
    reader.onerror = () => setFileError('ファイルの読み込みに失敗しました');
    reader.readAsDataURL(file);
  };

  const sendMessage = useCallback(async (text?: string) => {
    const userText = (text ?? input).trim();
    const sentAttachment = attachment;
    if ((!userText && !sentAttachment) || isLoading || !apiKey) return;

    setInput('');
    setAttachment(null);
    setFileError('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    setIsLoading(true);

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      text: userText || (sentAttachment ? '(ファイルを送信)' : ''),
      timestamp: Date.now(),
      attachment: sentAttachment
        ? {
            name: sentAttachment.name,
            isImage: sentAttachment.isImage,
            data: sentAttachment.data,
            mimeType: sentAttachment.mimeType,
          }
        : undefined,
    };
    setMessages(prev => [...prev, userMsg]);

    try {
      const contextNotes: Note[] = [];
      if (selectedNoteId) {
        const n = await db.notes.get(selectedNoteId);
        if (n) contextNotes.push(n);
      }
      const systemPrompt = buildSystemPrompt(contextNotes);

      const allMsgs = [...messages, userMsg];
      const history: ChatTurn[] = allMsgs.slice(-20).map(m => {
        const turn: ChatTurn = {
          role: m.role === 'user' ? 'user' : 'model',
          text: m.text,
        };
        if (m.attachment) {
          const a: ChatAttachment = { mimeType: m.attachment.mimeType, data: m.attachment.data };
          turn.attachments = [a];
        }
        return turn;
      });

      const aiText = await callGeminiChat(history, systemPrompt, apiKey);
      const { textContent, blocks } = parseAIResponse(aiText);

      const lilyMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'lily',
        text: textContent || '...',
        timestamp: Date.now(),
        extractedBlocks: blocks.length > 0 ? blocks : undefined,
      };
      setMessages(prev => [...prev, lilyMsg]);
    } catch (e) {
      const lilyMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'lily',
        text: `ごめんね、エラーが起きちゃった 🦊\n${e instanceof Error ? e.message : '不明なエラー'}`,
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, lilyMsg]);
    } finally {
      setIsLoading(false);
    }
  }, [input, attachment, isLoading, apiKey, messages, selectedNoteId]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const selectedNote = allNotes?.find(n => n.id === selectedNoteId);

  if (!apiKey) {
    return (
      <div className="ai-chat-container">
        <div className="setup-screen">
          <div className="setup-lily-wrap">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/lily-character.png" alt="Lily" className="setup-lily" />
          </div>
          <h2 className="setup-title">やあ！Lily だよ 🦊</h2>
          <p className="setup-desc">
            Gemini API キーを設定すると、メモの分析・図の作成・問題作りをお手伝いできるよ！
          </p>
          <button className="setup-btn" onClick={onOpenSettings}>
            <Sparkles size={18} />
            設定してみる
          </button>
        </div>

        <style jsx>{`
          .ai-chat-container {
            display: flex;
            flex-direction: column;
            height: 100%;
            background: var(--background);
            overflow: hidden;
          }
          .setup-screen {
            flex: 1;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 40px 24px;
            gap: 16px;
            text-align: center;
          }
          .setup-lily-wrap {
            width: 160px;
            height: 160px;
            animation: float 3s ease-in-out infinite;
          }
          .setup-lily {
            width: 100%;
            height: 100%;
            object-fit: contain;
          }
          @keyframes float {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-10px); }
          }
          .setup-title { font-size: 1.4rem; color: var(--primary); font-weight: 800; margin: 0; }
          .setup-desc { font-size: 0.9rem; color: var(--fg-muted); line-height: 1.6; max-width: 320px; margin: 0; }
          .setup-btn {
            display: flex;
            align-items: center;
            gap: 8px;
            background: var(--primary);
            color: white;
            border: none;
            border-radius: 12px;
            padding: 12px 24px;
            font-size: 1rem;
            font-weight: 700;
            cursor: pointer;
            margin-top: 8px;
          }
        `}</style>
      </div>
    );
  }

  return (
    <div className="ai-chat-container">
      {/* Header */}
      <div className="chat-header">
        <div className="header-left">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/lily-character.png" alt="Lily" className="header-avatar" />
          <div>
            <div className="header-title">Lily</div>
            <div className="header-sub">AIアシスタント ✨</div>
          </div>
        </div>
        <div className="header-right">
          <button
            className="context-toggle"
            onClick={() => setShowContextPanel(p => !p)}
            title="メモを選択"
          >
            {selectedNote ? (
              <span className="context-chip selected">
                📄 {selectedNote.title || '無題'}
                {showContextPanel ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              </span>
            ) : (
              <span className="context-chip">
                メモを選ぶ
                {showContextPanel ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              </span>
            )}
          </button>
          {messages.length > 0 && (
            <button
              className="clear-btn"
              onClick={() => setMessages([])}
              title="会話をリセット"
            >
              <RotateCcw size={15} />
            </button>
          )}
        </div>
      </div>

      {/* Context panel */}
      {showContextPanel && (
        <div className="context-panel">
          <button
            className={`note-chip ${!selectedNoteId ? 'active' : ''}`}
            onClick={() => { setSelectedNoteId(undefined); setShowContextPanel(false); }}
          >
            なし
          </button>
          {allNotes?.map(n => (
            <button
              key={n.id}
              className={`note-chip ${selectedNoteId === n.id ? 'active' : ''}`}
              onClick={() => { setSelectedNoteId(n.id); setShowContextPanel(false); }}
            >
              {n.title || '無題のメモ'}
            </button>
          ))}
        </div>
      )}

      {/* Messages */}
      <div className="messages-list">
        {messages.length === 0 && (
          <div className="welcome-screen">
            <div className="welcome-lily-wrap">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/lily-character.png" alt="Lily" className="welcome-lily" />
            </div>
            <p className="welcome-text">なんでも話しかけてね！<br />メモを選んだり、📎 で画像・PDFを添付して<br />「分析して」「グラフにして」とか言ってみて 🦊</p>
            <div className="suggestions">
              {SUGGESTIONS.map(s => (
                <button
                  key={s}
                  className="suggestion-chip"
                  onClick={() => sendMessage(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map(msg =>
          msg.role === 'user' ? (
            <UserBubble key={msg.id} message={msg} />
          ) : (
            <LilyBubble
              key={msg.id}
              message={msg}
              allNotes={allNotes ?? []}
              selectedNoteId={selectedNoteId}
            />
          )
        )}
        {isLoading && <TypingIndicator />}
        <div ref={messagesEndRef} />
      </div>

      {/* Mobile fullscreen bottom nav */}
      {onSwitchTab && (
        <nav className="ai-bottom-nav">
          <button className="ai-nav-item" onClick={() => onSwitchTab('memos')}>
            <Book size={22} />
            <span>メモ</span>
          </button>
          <button className="ai-nav-item" onClick={() => onSwitchTab('sketch')}>
            <Brush size={22} />
            <span>落書き</span>
          </button>
          <button className="ai-nav-item" onClick={() => onSwitchTab('pdf')}>
            <FileText size={22} />
            <span>PDF</span>
          </button>
          <button className="ai-nav-item active">
            <Sparkles size={22} />
            <span>Lily</span>
          </button>
          <button className="ai-nav-item" onClick={() => { onSwitchTab('settings'); onOpenSettings(); }}>
            <SettingsIcon size={22} />
            <span>設定</span>
          </button>
        </nav>
      )}

      {/* Attachment preview / error */}
      {(attachment || fileError) && (
        <div className="att-bar">
          {attachment && (
            <div className="att-chip">
              {attachment.isImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`data:${attachment.mimeType};base64,${attachment.data}`}
                  alt={attachment.name}
                  className="att-chip-thumb"
                />
              ) : (
                <span className="att-chip-icon">📎</span>
              )}
              <span className="att-chip-name">{attachment.name}</span>
              <button className="att-remove" onClick={() => setAttachment(null)} title="削除">
                <X size={14} />
              </button>
            </div>
          )}
          {fileError && <span className="att-error">{fileError}</span>}
        </div>
      )}

      {/* Input area */}
      <div className="input-area">
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_FILE_TYPES}
          hidden
          onChange={handleFileSelect}
        />
        <button
          className="attach-btn"
          onClick={() => fileInputRef.current?.click()}
          disabled={isLoading}
          title="ファイルを添付"
        >
          <Paperclip size={20} />
        </button>
        <textarea
          ref={textareaRef}
          className="chat-input"
          placeholder="Lily に話しかける..."
          value={input}
          onChange={e => { setInput(e.target.value); autoResizeTextarea(); }}
          onKeyDown={handleKeyDown}
          rows={1}
          disabled={isLoading}
        />
        <button
          className="send-btn"
          onClick={() => sendMessage()}
          disabled={(!input.trim() && !attachment) || isLoading}
          title="送信 (Enter)"
        >
          <Send size={20} />
        </button>
      </div>

      <style jsx>{`
        .ai-chat-container {
          display: flex;
          flex-direction: column;
          height: 100%;
          background: var(--background);
          overflow: hidden;
          position: relative;
        }

        /* ── Header ── */
        .chat-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 14px;
          border-bottom: 1px solid var(--border);
          background: var(--glass-tint, rgba(255,255,255,0.9));
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          flex-shrink: 0;
          gap: 8px;
        }
        .header-left {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .header-avatar {
          width: 38px;
          height: 38px;
          border-radius: 50%;
          object-fit: cover;
          object-position: top center;
          border: 2px solid var(--border);
          background: var(--accent);
        }
        .header-title { font-size: 0.95rem; font-weight: 800; color: var(--primary); }
        .header-sub { font-size: 0.7rem; color: var(--fg-muted); }
        .header-right { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
        .context-toggle { background: transparent; border: none; cursor: pointer; padding: 2px; }
        .context-chip {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          background: var(--accent);
          border: 1px solid var(--border);
          border-radius: 20px;
          padding: 4px 10px;
          font-size: 0.78rem;
          color: var(--fg-muted);
          white-space: nowrap;
          max-width: 180px;
          overflow: hidden;
          text-overflow: ellipsis;
          cursor: pointer;
        }
        .context-chip.selected { color: var(--primary); border-color: var(--primary); }
        .clear-btn {
          background: transparent;
          border: 1px solid var(--border);
          border-radius: 8px;
          padding: 5px 7px;
          cursor: pointer;
          color: var(--fg-muted);
          display: flex;
          align-items: center;
        }

        /* ── Context panel ── */
        .context-panel {
          display: flex;
          gap: 8px;
          padding: 8px 14px;
          border-bottom: 1px solid var(--border);
          background: var(--accent);
          overflow-x: auto;
          flex-shrink: 0;
        }
        .note-chip {
          flex-shrink: 0;
          background: var(--background);
          border: 1px solid var(--border);
          border-radius: 16px;
          padding: 5px 12px;
          font-size: 0.78rem;
          color: var(--fg-muted);
          cursor: pointer;
          white-space: nowrap;
          transition: all 0.15s;
        }
        .note-chip.active { background: var(--primary); color: white; border-color: var(--primary); }

        /* ── Messages ── */
        .messages-list {
          flex: 1;
          overflow-y: auto;
          padding: 16px 14px;
          display: flex;
          flex-direction: column;
          gap: 14px;
          /* extra bottom so last msg isn't hidden by input */
          padding-bottom: 20px;
        }

        /* ── Welcome screen ── */
        .welcome-screen {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
          padding: 20px 0;
          text-align: center;
        }
        .welcome-lily-wrap {
          width: 120px;
          height: 120px;
          animation: float 3s ease-in-out infinite;
        }
        .welcome-lily {
          width: 100%;
          height: 100%;
          object-fit: contain;
        }
        @keyframes float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-10px); }
        }
        .welcome-text {
          font-size: 0.9rem;
          color: var(--fg-muted);
          line-height: 1.6;
          margin: 0;
        }
        .suggestions {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          justify-content: center;
          max-width: 400px;
        }
        .suggestion-chip {
          background: color-mix(in srgb, var(--primary) 12%, transparent);
          border: 1px solid color-mix(in srgb, var(--primary) 30%, transparent);
          color: var(--primary);
          border-radius: 20px;
          padding: 6px 14px;
          font-size: 0.82rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.15s;
        }
        .suggestion-chip:hover {
          background: var(--primary);
          color: white;
        }

        /* ── Input area ── */
        .input-area {
          display: flex;
          align-items: flex-end;
          gap: 8px;
          padding: 10px 14px;
          padding-bottom: calc(10px + env(safe-area-inset-bottom));
          border-top: 1px solid var(--border);
          background: var(--glass-tint, rgba(255,255,255,0.9));
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          flex-shrink: 0;
        }
        .chat-input {
          flex: 1;
          min-height: 38px;
          max-height: 120px;
          background: var(--accent);
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 9px 12px;
          font-size: 0.9rem;
          color: var(--foreground);
          outline: none;
          resize: none;
          line-height: 1.5;
          font-family: inherit;
          overflow-y: auto;
        }
        .chat-input:focus { border-color: var(--primary); }
        .attach-btn {
          flex-shrink: 0;
          width: 40px;
          height: 40px;
          background: var(--accent);
          color: var(--fg-muted);
          border: 1px solid var(--border);
          border-radius: 12px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.15s;
        }
        .attach-btn:hover:not(:disabled) { color: var(--primary); border-color: var(--primary); }
        .attach-btn:disabled { opacity: 0.4; cursor: default; }
        .send-btn {
          flex-shrink: 0;
          width: 40px;
          height: 40px;
          background: var(--primary);
          color: white;
          border: none;
          border-radius: 12px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: opacity 0.15s;
        }
        .send-btn:disabled { opacity: 0.4; cursor: default; }

        /* ── Attachment bar ── */
        .att-bar {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px 14px;
          border-top: 1px solid var(--border);
          background: var(--accent);
          flex-shrink: 0;
        }
        .att-chip {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          background: var(--background);
          border: 1px solid var(--border);
          border-radius: 10px;
          padding: 5px 8px 5px 10px;
          max-width: 70%;
        }
        .att-chip-thumb {
          width: 32px;
          height: 32px;
          object-fit: cover;
          border-radius: 6px;
        }
        .att-chip-icon { font-size: 1rem; }
        .att-chip-name {
          font-size: 0.78rem;
          color: var(--foreground);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 160px;
        }
        .att-remove {
          background: transparent;
          border: none;
          cursor: pointer;
          color: var(--fg-muted);
          display: flex;
          align-items: center;
          padding: 2px;
        }
        .att-error { font-size: 0.78rem; color: #cc0000; }

        /* ── Mobile fullscreen bottom nav ── */
        .ai-bottom-nav {
          display: none;
          flex-shrink: 0;
        }
        @media (max-width: 1023px) {
          .ai-bottom-nav {
            display: flex;
            height: calc(56px + env(safe-area-inset-bottom));
            background: var(--glass-tint, rgba(255,255,255,0.9));
            backdrop-filter: blur(20px);
            -webkit-backdrop-filter: blur(20px);
            border-top: 1px solid var(--border);
            padding-bottom: env(safe-area-inset-bottom);
          }
          .ai-nav-item {
            flex: 1;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 3px;
            background: transparent;
            color: var(--fg-muted);
            transition: color 0.15s;
          }
          .ai-nav-item.active { color: var(--primary); }
          .ai-nav-item span { font-size: 0.65rem; font-weight: 600; }
          /* input area sits just above the nav — no extra padding needed */
          .messages-list { padding-bottom: 16px; }
        }
      `}</style>
    </div>
  );
}
