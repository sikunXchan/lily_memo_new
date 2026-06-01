'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Send, CheckCircle2, SkipForward, ArrowLeft,
  Book, FileText, Brush, Sparkles, Settings as SettingsIcon,
  CalendarDays, MessageSquare,
} from 'lucide-react';
import { db } from '@/lib/db';
import type { Exam, ScheduleDay } from '@/lib/db';
import { callGeminiChat } from '@/lib/gemini';
import type { ChatTurn } from '@/lib/gemini';

// ─── Utilities ───

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysUntil(dateStr: string): number {
  const today = new Date(todayStr() + 'T00:00:00');
  const target = new Date(dateStr + 'T00:00:00');
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

function formatDayLabel(dateStr: string): string {
  const today = todayStr();
  const tomorrow = addDays(today, 1);
  const d = new Date(dateStr + 'T00:00:00');
  const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const dn = dayNames[d.getDay()];
  if (dateStr === today) return `今日 ${m}/${day}(${dn})`;
  if (dateStr === tomorrow) return `明日 ${m}/${day}(${dn})`;
  return `${m}/${day}(${dn})`;
}

function parseScheduleBlock(text: string): { date: string; tasks: string[] }[] | null {
  const m = text.match(/```schedule\s*([\s\S]*?)```/);
  if (!m) return null;
  try {
    const arr = JSON.parse(m[1].trim());
    if (Array.isArray(arr)) return arr;
  } catch {}
  return null;
}

function parseExamsBlock(text: string): { name: string; date: string }[] | null {
  const m = text.match(/```exams\s*([\s\S]*?)```/);
  if (!m) return null;
  try {
    const arr = JSON.parse(m[1].trim());
    if (Array.isArray(arr)) return arr;
  } catch {}
  return null;
}

function stripSpecialBlocks(text: string): string {
  return text.replace(/```schedule[\s\S]*?```/g, '').replace(/```exams[\s\S]*?```/g, '').trim();
}

// ─── System Prompt ───

const EXAM_BASE_PROMPT = `あなたは学習スケジュール管理の専門AIアシスタントです。ユーザーの試験情報・生活パターン・空き時間をヒアリングし、現実的で無理のない日割り学習スケジュールを作成します。

## スケジュール出力フォーマット
スケジュールを作成・更新する場合は、必ず以下のJSONブロックをテキストと一緒に出力してください:

\`\`\`schedule
[
  {"date": "YYYY-MM-DD", "tasks": ["タスク1", "タスク2"]},
  {"date": "YYYY-MM-DD", "tasks": ["タスク1"]}
]
\`\`\`

## スケジュール作成のルール
- 今日以降の日程のみ含める（過去の日は含めない）
- 1日あたりのタスクは最大3個（現実的な量に）
- 試験2〜3日前は復習・総まとめを入れる
- ユーザーが忙しいと言った日はタスクなしにする（その日をJSONから除く）
- 複数試験がある場合はタスクに "(試験名)" の形で付記する

## 試験登録
試験を追加・更新する場合は以下も出力してください（試験情報が変わった時のみ）:
\`\`\`exams
[
  {"name": "試験名", "date": "YYYY-MM-DD"},
  ...
]
\`\`\`

## スキップ・再配分
ユーザーが「スキップした」「今日できなかった」と言った場合:
- 残りの日数で学習内容を再分配する
- スキップした日は除外し、試験直前に復習を集中させる
- 必ず新しいscheduleブロックを出力すること

フレンドリーで励ましのある日本語で会話すること。`;

function buildSystemPrompt(exams: Exam[], scheduleDays: ScheduleDay[]): string {
  const today = todayStr();
  let prompt = EXAM_BASE_PROMPT + `\n\n今日の日付: ${today}`;
  if (exams.length > 0) {
    prompt += '\n\n## 登録済みの試験\n';
    for (const e of exams) {
      const days = daysUntil(e.examDate);
      prompt += `- ${e.name}: ${e.examDate} (あと${days}日)\n`;
    }
  }
  const future = scheduleDays.filter(d => d.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  if (future.length > 0) {
    prompt += '\n\n## 現在のスケジュール（今日以降）\n';
    for (const d of future.slice(0, 30)) {
      const tasks = JSON.parse(d.tasks) as string[];
      const st = d.completed ? '[完了]' : d.skipped ? '[スキップ]' : '';
      prompt += `- ${d.date}${st ? ' ' + st : ''}: ${tasks.join(', ')}\n`;
    }
  }
  return prompt;
}

// ─── Types ───

interface ChatMsg {
  id: string;
  role: 'user' | 'ai';
  text: string;
  timestamp: number;
}

export interface ExamSchedulerProps {
  onSwitchTab?: (tab: 'memos' | 'sketch' | 'pdf' | 'settings' | 'ai' | 'exam') => void;
  onOpenSettings: () => void;
}

// ─── Main Component ───

export default function ExamScheduler({ onSwitchTab, onOpenSettings }: ExamSchedulerProps) {
  const [view, setView] = useState<'schedule' | 'chat'>('schedule');
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const exams = useLiveQuery(() => db.exams.orderBy('examDate').toArray(), []) ?? [];
  const scheduleDays = useLiveQuery(() => db.scheduleDays.orderBy('date').toArray(), []) ?? [];

  useEffect(() => {
    setApiKey(localStorage.getItem('lily_gemini_api_key') || '');
  }, []);

  useEffect(() => {
    if (view === 'chat') messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, view]);

  const applyScheduleFromAI = useCallback(async (text: string) => {
    const scheduleData = parseScheduleBlock(text);
    const examsData = parseExamsBlock(text);
    const today = todayStr();

    if (examsData && examsData.length > 0) {
      const now = Date.now();
      await db.exams.clear();
      for (const e of examsData) {
        await db.exams.add({ name: e.name, examDate: e.date, createdAt: now });
      }
    }

    if (scheduleData && scheduleData.length > 0) {
      const existing = await db.scheduleDays.filter(d => d.completed || d.date < today).toArray();
      const completedDates = new Set(existing.map(d => d.date));
      await db.scheduleDays.filter(d => !d.completed && d.date >= today).delete();
      const now = Date.now();
      for (const item of scheduleData) {
        if (!completedDates.has(item.date) && item.date >= today && item.tasks.length > 0) {
          await db.scheduleDays.add({
            date: item.date,
            tasks: JSON.stringify(item.tasks),
            completed: false,
            skipped: false,
            createdAt: now,
          });
        }
      }
    }
  }, []);

  const sendMessage = useCallback(async (text?: string) => {
    const userText = (text ?? input).trim();
    if (!userText || isLoading || !apiKey) return;

    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    const userMsg: ChatMsg = { id: crypto.randomUUID(), role: 'user', text: userText, timestamp: Date.now() };
    setMessages(prev => [...prev, userMsg]);
    setIsLoading(true);

    try {
      const currentExams = await db.exams.orderBy('examDate').toArray();
      const currentSchedule = await db.scheduleDays.orderBy('date').toArray();
      const systemPrompt = buildSystemPrompt(currentExams, currentSchedule);

      const allMsgs = [...messages, userMsg];
      const history: ChatTurn[] = allMsgs.slice(-12).map(m => ({
        role: m.role === 'user' ? 'user' : 'model',
        text: m.text,
      }));

      const aiText = await callGeminiChat(history, systemPrompt, apiKey);
      await applyScheduleFromAI(aiText);
      const displayText = stripSpecialBlocks(aiText);

      setMessages(prev => [...prev, {
        id: crypto.randomUUID(),
        role: 'ai',
        text: displayText || 'スケジュールを更新したよ！',
        timestamp: Date.now(),
      }]);
    } catch (e) {
      setMessages(prev => [...prev, {
        id: crypto.randomUUID(),
        role: 'ai',
        text: `エラーが起きちゃった 😢\n${e instanceof Error ? e.message : '不明なエラー'}`,
        timestamp: Date.now(),
      }]);
    } finally {
      setIsLoading(false);
    }
  }, [input, isLoading, apiKey, messages, applyScheduleFromAI]);

  const handleComplete = useCallback(async (day: ScheduleDay) => {
    if (day.id == null) return;
    await db.scheduleDays.update(day.id, { completed: true });
  }, []);

  const handleSkip = useCallback(async (day: ScheduleDay) => {
    if (day.id == null) return;
    await db.scheduleDays.update(day.id, { skipped: true });
    const tasks = JSON.parse(day.tasks) as string[];
    setView('chat');
    const skipMsg = `${formatDayLabel(day.date)}のタスクをスキップしました: ${tasks.join('、')}。残りのスケジュールを現実的に再配分してください。`;
    await sendMessage(skipMsg);
  }, [sendMessage]);

  const today = todayStr();
  const upcomingDays = scheduleDays
    .filter(d => d.date >= today && !d.completed)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 21);
  const hasSchedule = scheduleDays.some(d => d.date >= today);

  if (!apiKey) {
    return (
      <div className="exam-container">
        <div className="exam-header">
          {onSwitchTab && <button className="back-btn" onClick={() => onSwitchTab('memos')}><ArrowLeft size={20} /></button>}
          <span className="exam-title-text">📅 試験スケジューラー</span>
        </div>
        <div className="exam-nokey">
          <p>Gemini APIキーを設定してください</p>
          <button className="setup-btn" onClick={onOpenSettings}>設定を開く</button>
        </div>
        <style jsx>{styles}</style>
      </div>
    );
  }

  return (
    <div className="exam-container">
      <div className="exam-header">
        {onSwitchTab && (
          <button className="back-btn" onClick={() => onSwitchTab('memos')} title="戻る">
            <ArrowLeft size={20} />
          </button>
        )}
        <span className="exam-title-text">📅 試験スケジューラー</span>
        <div className="view-tabs">
          <button
            className={`view-tab ${view === 'schedule' ? 'active' : ''}`}
            onClick={() => setView('schedule')}
          >
            <CalendarDays size={14} /> スケジュール
          </button>
          <button
            className={`view-tab ${view === 'chat' ? 'active' : ''}`}
            onClick={() => setView('chat')}
          >
            <MessageSquare size={14} /> AIに相談
          </button>
        </div>
      </div>

      {exams.length > 0 && (
        <div className="chips-bar">
          {exams.map(e => {
            const days = daysUntil(e.examDate);
            return (
              <span
                key={e.id}
                className={`exam-chip ${days <= 7 ? 'urgent' : days <= 14 ? 'soon' : ''}`}
              >
                📅 {e.name} あと{days}日
              </span>
            );
          })}
        </div>
      )}

      {view === 'schedule' && (
        <div className="schedule-view">
          {!hasSchedule ? (
            <div className="empty-state">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/allstar.PNG" alt="Lily" className="empty-lily" />
              <p className="empty-title">まだスケジュールがないよ！</p>
              <p className="empty-desc">試験情報を教えてくれると<br />日割りカリキュラムを作るよ 📚</p>
              <button className="create-btn" onClick={() => setView('chat')}>
                <MessageSquare size={15} /> AIに相談してスケジュールを作る
              </button>
            </div>
          ) : (
            <div className="days-list">
              {upcomingDays.map(day => {
                const tasks = JSON.parse(day.tasks) as string[];
                const isToday = day.date === today;
                return (
                  <div
                    key={day.id}
                    className={`day-card ${isToday ? 'today' : ''} ${day.skipped ? 'skipped' : ''}`}
                  >
                    <div className="day-head">
                      <span className="day-label">{formatDayLabel(day.date)}</span>
                      {isToday && !day.skipped && <span className="badge today-badge">今日</span>}
                      {day.skipped && <span className="badge skip-badge">スキップ済</span>}
                    </div>
                    <ul className="task-list">
                      {tasks.map((t, i) => <li key={i} className="task-item">{t}</li>)}
                    </ul>
                    {!day.skipped && (
                      <div className="day-actions">
                        <button className="action-btn done-btn" onClick={() => handleComplete(day)}>
                          <CheckCircle2 size={14} /> 完了
                        </button>
                        <button className="action-btn skip-btn" onClick={() => handleSkip(day)}>
                          <SkipForward size={14} /> スキップして再配分
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
              {upcomingDays.length === 0 && (
                <div className="all-done">🎉 すべてのスケジュールが完了！</div>
              )}
            </div>
          )}
        </div>
      )}

      {view === 'chat' && (
        <>
          <div className="chat-area">
            {messages.length === 0 && (
              <div className="chat-welcome">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/allstar.PNG" alt="Lily" className="welcome-lily" />
                <p className="welcome-text">試験情報を教えてね！<br />日割りスケジュールを作るよ 📚</p>
              </div>
            )}
            {messages.map(m => (
              <div key={m.id} className={`msg-row ${m.role}`}>
                <div className={`msg-bubble ${m.role}`}>
                  {m.text.split('\n').map((line, i, arr) => (
                    <span key={i}>{line}{i < arr.length - 1 && <br />}</span>
                  ))}
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="msg-row ai">
                <div className="msg-bubble ai typing">
                  <span className="dot" /><span className="dot" /><span className="dot" />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="input-area">
            <textarea
              ref={textareaRef}
              className="chat-input"
              value={input}
              onChange={e => {
                setInput(e.target.value);
                const ta = textareaRef.current;
                if (ta) { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 100) + 'px'; }
              }}
              placeholder="試験情報・生活パターンを教えて..."
              rows={1}
              disabled={isLoading}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendMessage(); }
              }}
            />
            <button
              className="send-btn"
              onClick={() => void sendMessage()}
              disabled={!input.trim() || isLoading}
            >
              <Send size={20} />
            </button>
          </div>
        </>
      )}

      {onSwitchTab && (
        <nav className="exam-bottom-nav">
          <button className="enav-item" onClick={() => onSwitchTab('memos')}><Book size={22} /><span>メモ</span></button>
          <button className="enav-item" onClick={() => onSwitchTab('sketch')}><Brush size={22} /><span>落書き</span></button>
          <button className="enav-item" onClick={() => onSwitchTab('pdf')}><FileText size={22} /><span>PDF</span></button>
          <button className="enav-item" onClick={() => onSwitchTab('ai')}><Sparkles size={22} /><span>AI</span></button>
          <button className="enav-item active"><CalendarDays size={22} /><span>試験</span></button>
          <button className="enav-item" onClick={() => { onSwitchTab('settings'); onOpenSettings(); }}><SettingsIcon size={22} /><span>設定</span></button>
        </nav>
      )}

      <style jsx>{styles}</style>
    </div>
  );
}

const styles = `
  .exam-container { display: flex; flex-direction: column; height: 100%; background: var(--background); overflow: hidden; }
  .exam-header { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-bottom: 1px solid var(--border); background: var(--glass-tint, rgba(255,255,255,0.9)); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); flex-shrink: 0; }
  .back-btn { width: 34px; height: 34px; display: flex; align-items: center; justify-content: center; border-radius: 10px; background: var(--accent); border: 1px solid var(--border); color: var(--foreground); cursor: pointer; flex-shrink: 0; }
  .back-btn:hover { opacity: 0.75; }
  .exam-title-text { font-size: 0.95rem; font-weight: 800; color: var(--foreground); flex: 1; }
  .view-tabs { display: flex; gap: 4px; }
  .view-tab { display: flex; align-items: center; gap: 5px; background: var(--accent); border: 1px solid var(--border); border-radius: 16px; padding: 5px 11px; font-size: 0.75rem; font-weight: 600; color: var(--fg-muted); cursor: pointer; white-space: nowrap; transition: all 0.15s; }
  .view-tab.active { background: var(--primary); color: #fff; border-color: var(--primary); }

  .chips-bar { display: flex; gap: 8px; padding: 8px 14px; border-bottom: 1px solid var(--border); background: var(--accent); overflow-x: auto; flex-shrink: 0; scrollbar-width: none; }
  .chips-bar::-webkit-scrollbar { display: none; }
  .exam-chip { flex-shrink: 0; background: color-mix(in srgb, var(--primary) 12%, transparent); border: 1px solid color-mix(in srgb, var(--primary) 30%, transparent); color: var(--primary); border-radius: 20px; padding: 4px 12px; font-size: 0.78rem; font-weight: 700; white-space: nowrap; }
  .exam-chip.soon { background: color-mix(in srgb, #f59e0b 12%, transparent); border-color: color-mix(in srgb, #f59e0b 40%, transparent); color: #b45309; }
  .exam-chip.urgent { background: color-mix(in srgb, #ef4444 12%, transparent); border-color: color-mix(in srgb, #ef4444 40%, transparent); color: #dc2626; animation: urgentPulse 1.5s ease-in-out infinite; }
  @keyframes urgentPulse { 0%,100%{opacity:1} 50%{opacity:0.7} }

  .schedule-view { flex: 1; overflow-y: auto; padding: 12px 14px; }
  .empty-state { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 30px 16px; text-align: center; }
  .empty-lily { width: 120px; height: 120px; object-fit: contain; animation: float 3s ease-in-out infinite; }
  @keyframes float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-8px)} }
  .empty-title { font-size: 1.1rem; font-weight: 800; color: var(--foreground); margin: 0; }
  .empty-desc { font-size: 0.88rem; color: var(--fg-muted); line-height: 1.6; margin: 0; }
  .create-btn { display: flex; align-items: center; gap: 7px; background: var(--primary); color: #fff; border: none; border-radius: 12px; padding: 11px 22px; font-size: 0.9rem; font-weight: 700; cursor: pointer; }
  .create-btn:hover { opacity: 0.88; }

  .days-list { display: flex; flex-direction: column; gap: 10px; }
  .day-card { background: var(--accent); border: 1.5px solid var(--border); border-radius: 14px; padding: 13px 14px; }
  .day-card.today { border-color: var(--primary); background: color-mix(in srgb, var(--primary) 6%, var(--background)); }
  .day-card.skipped { opacity: 0.55; }
  .day-head { display: flex; align-items: center; gap: 8px; margin-bottom: 9px; }
  .day-label { font-size: 0.88rem; font-weight: 700; color: var(--foreground); }
  .badge { font-size: 0.66rem; font-weight: 800; padding: 2px 8px; border-radius: 99px; }
  .today-badge { background: var(--primary); color: #fff; }
  .skip-badge { background: var(--border); color: var(--fg-muted); }
  .task-list { list-style: none; margin: 0 0 10px; padding: 0; display: flex; flex-direction: column; gap: 5px; }
  .task-item { font-size: 0.85rem; color: var(--foreground); padding: 5px 10px; background: var(--background); border: 1px solid var(--border); border-radius: 8px; line-height: 1.4; }
  .task-item::before { content: "•"; margin-right: 6px; color: var(--primary); font-weight: 700; }
  .day-actions { display: flex; gap: 8px; }
  .action-btn { display: flex; align-items: center; gap: 5px; border-radius: 8px; padding: 6px 12px; font-size: 0.78rem; font-weight: 700; cursor: pointer; border: 1px solid var(--border); background: var(--background); transition: all 0.15s; }
  .done-btn { color: #16a34a; border-color: rgba(22,163,74,0.35); }
  .done-btn:hover { background: rgba(22,163,74,0.1); border-color: #16a34a; }
  .skip-btn { color: #6366f1; border-color: rgba(99,102,241,0.35); }
  .skip-btn:hover { background: rgba(99,102,241,0.1); border-color: #6366f1; }
  .all-done { text-align: center; padding: 40px 16px; font-size: 1rem; font-weight: 700; color: var(--primary); }

  .chat-area { flex: 1; overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 12px; }
  .chat-welcome { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 20px 0; text-align: center; }
  .welcome-lily { width: 110px; height: 110px; object-fit: contain; animation: float 3s ease-in-out infinite; }
  .welcome-text { font-size: 0.92rem; color: var(--fg-muted); line-height: 1.6; margin: 0; }
  .sug-row { display: flex; flex-wrap: wrap; gap: 7px; justify-content: center; max-width: 360px; }
  .sug-chip { background: color-mix(in srgb, var(--primary) 12%, transparent); border: 1px solid color-mix(in srgb, var(--primary) 30%, transparent); color: var(--primary); border-radius: 20px; padding: 5px 13px; font-size: 0.78rem; font-weight: 600; cursor: pointer; transition: all 0.15s; }
  .sug-chip:hover:not(:disabled) { background: var(--primary); color: #fff; }
  .sug-chip:disabled { opacity: 0.5; cursor: default; }
  .msg-row { display: flex; }
  .msg-row.user { justify-content: flex-end; }
  .msg-row.ai { justify-content: flex-start; }
  .msg-bubble { max-width: 80%; padding: 10px 14px; border-radius: 16px; font-size: 0.9rem; line-height: 1.65; word-break: break-word; }
  .msg-bubble.user { background: var(--primary); color: #fff; border-radius: 16px 4px 16px 16px; }
  .msg-bubble.ai { background: var(--accent); border: 1px solid var(--border); color: var(--foreground); border-radius: 4px 16px 16px 16px; }
  .msg-bubble.typing { display: flex; gap: 5px; align-items: center; padding: 12px 16px; }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--primary); animation: bounce 1.2s infinite ease-in-out; }
  .dot:nth-child(2) { animation-delay: 0.2s; }
  .dot:nth-child(3) { animation-delay: 0.4s; }
  @keyframes bounce { 0%,80%,100%{transform:translateY(0);opacity:0.4} 40%{transform:translateY(-6px);opacity:1} }

  .input-area { display: flex; align-items: flex-end; gap: 8px; padding: 10px 14px; padding-bottom: calc(10px + env(safe-area-inset-bottom)); border-top: 1px solid var(--border); background: var(--glass-tint, rgba(255,255,255,0.9)); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); flex-shrink: 0; }
  .chat-input { flex: 1; min-height: 38px; max-height: 100px; background: var(--accent); border: 1px solid var(--border); border-radius: 12px; padding: 9px 12px; font-size: 0.9rem; color: var(--foreground); outline: none; resize: none; line-height: 1.5; font-family: inherit; overflow-y: auto; }
  .chat-input:focus { border-color: var(--primary); }
  .send-btn { flex-shrink: 0; width: 40px; height: 40px; background: var(--primary); color: white; border: none; border-radius: 12px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: opacity 0.15s; }
  .send-btn:disabled { opacity: 0.4; cursor: default; }

  .exam-nokey { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; padding: 32px; text-align: center; color: var(--fg-muted); }
  .setup-btn { background: var(--primary); color: #fff; border: none; border-radius: 12px; padding: 11px 24px; font-size: 0.9rem; font-weight: 700; cursor: pointer; }

  .exam-bottom-nav { display: none; flex-shrink: 0; }
  @media (max-width: 1023px) {
    .exam-bottom-nav { display: flex; height: calc(56px + env(safe-area-inset-bottom)); background: var(--glass-tint, rgba(255,255,255,0.9)); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); border-top: 1px solid var(--border); padding-bottom: env(safe-area-inset-bottom); order: 99; }
    .enav-item { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; background: transparent; color: var(--fg-muted); transition: color 0.15s; }
    .enav-item.active { color: var(--primary); }
    .enav-item span { font-size: 0.65rem; font-weight: 600; }
    .schedule-view { padding-bottom: 16px; }
    .chat-area { padding-bottom: 8px; }
  }
`;
