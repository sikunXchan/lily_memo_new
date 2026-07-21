'use client';

import { useState, useEffect, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, Send, Users, UserPlus, Sparkles, Trash2, X, Loader2, Pencil, MessageCircle } from 'lucide-react';
import { db, softDeleteAiFriend, type AiFriend, type DiaryChatMsg } from '@/lib/db';
import type { ChatTurn } from '@/lib/gemini';
import {
  seedDefaultFriends, chatReply, runDailyLearning,
  getUserPersona, getLastLearnedDate, setLastLearnedDate,
} from '@/lib/aiFriends';
import { getEffectiveApiKey } from '@/lib/appLang';
import { getAppLang } from '@/lib/appLang';

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// 連続する同roleターンを1つにまとめる（Gemini向けに整える）。
function mergeTurns(turns: ChatTurn[]): ChatTurn[] {
  const out: ChatTurn[] = [];
  for (const t of turns) {
    const last = out[out.length - 1];
    if (last && last.role === t.role) last.text += `\n${t.text}`;
    else out.push({ role: t.role, text: t.text });
  }
  // 先頭が model なら落とす（会話は user 始まり）
  while (out.length && out[0]!.role === 'model') out.shift();
  return out;
}

const AVATAR_EMOJIS = ['🌸', '🌙', '🐻', '🐱', '🦊', '🐧', '🌟', '🍀', '🎀', '🍵', '🐰', '🐥'];
const AVATAR_COLORS = ['#ec4899', '#6366f1', '#f59e0b', '#10b981', '#0ea5e9', '#8b5cf6', '#ef4444', '#14b8a6'];

export default function DiaryFriends({ onClose }: { onClose: () => void }) {
  const en = getAppLang() === 'en';
  const friends = useLiveQuery<AiFriend[]>(
    () => db.aiFriends.orderBy('createdAt').filter(f => !f.deletedAt).toArray(), []
  ) ?? [];

  const [thread, setThread] = useState<string>('group'); // 'group' | `f{id}`
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [learning, setLearning] = useState(false);
  const [toast, setToast] = useState('');
  const [editing, setEditing] = useState<AiFriend | 'new' | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const seededRef = useRef(false);

  const messages = useLiveQuery<DiaryChatMsg[]>(
    () => db.diaryChats.where('thread').equals(thread).filter(m => !m.deletedAt).sortBy('createdAt'),
    [thread]
  ) ?? [];

  // 初回: 既定フレンドをシード。新しい日なら前回以降の内容で軽く学習。
  useEffect(() => {
    if (seededRef.current) return;
    seededRef.current = true;
    void (async () => {
      await seedDefaultFriends();
      const last = getLastLearnedDate();
      const today = todayIso();
      if (last !== today) {
        // 新しい日: 直近の日記＋チャットで自動学習（材料があるときだけ）
        const apiKey = getEffectiveApiKey();
        if (!apiKey) return;
        const [recentDiary, recentChats, allFriends] = await Promise.all([
          db.diaries.orderBy('updatedAt').reverse().filter(d => !d.deletedAt).limit(1).toArray(),
          db.diaryChats.orderBy('createdAt').reverse().filter(m => !m.deletedAt).limit(40).toArray(),
          db.aiFriends.filter(f => !f.deletedAt).toArray(),
        ]);
        const diaryText = recentDiary[0]?.content ? stripHtml(recentDiary[0].content) : '';
        const transcript = recentChats.reverse().map(m => `${m.role === 'user' ? 'ユーザー' : m.friendName}: ${m.text}`).join('\n');
        if (diaryText || transcript) {
          try { await runDailyLearning(apiKey, diaryText, transcript, allFriends, getUserPersona()); } catch { /* silent */ }
        }
        setLastLearnedDate(today);
      }
    })();
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, sending]);

  const activeFriend = thread.startsWith('f') ? friends.find(f => `f${f.id}` === thread) : undefined;

  async function send() {
    const text = input.trim();
    if (!text || sending) return;
    const apiKey = getEffectiveApiKey();
    if (!apiKey) { setToast(en ? 'Set your API key in Settings.' : 'APIキーを設定してね'); return; }
    setInput('');
    setSending(true);
    const now = Date.now();
    await db.diaryChats.add({ thread, role: 'user', text, createdAt: now });
    try {
      const up = getUserPersona();
      const history = await db.diaryChats.where('thread').equals(thread).filter(m => !m.deletedAt).sortBy('createdAt');
      if (thread === 'group') {
        // 参加フレンド全員が順に返信（後の子は前の子の発言も見える）
        const participants = friends;
        const otherNamesAll = participants.map(f => f.name);
        for (const f of participants) {
          const cur = await db.diaryChats.where('thread').equals('group').filter(m => !m.deletedAt).sortBy('createdAt');
          const turns = mergeTurns(cur.map<ChatTurn>(m =>
            m.role === 'user' ? { role: 'user', text: m.text }
              : m.friendId === f.id ? { role: 'model', text: m.text }
                : { role: 'user', text: `${m.friendName}: ${m.text}` }
          ));
          const others = otherNamesAll.filter(n => n !== f.name);
          const reply = await chatReply(f, turns, up, apiKey, others);
          if (reply) {
            await db.diaryChats.add({ thread: 'group', role: 'ai', friendId: f.id, friendName: f.name, emoji: f.emoji, color: f.color, text: reply, createdAt: Date.now() });
          }
        }
      } else if (activeFriend) {
        const turns = mergeTurns(history.map<ChatTurn>(m => ({ role: m.role === 'user' ? 'user' : 'model', text: m.text })));
        const reply = await chatReply(activeFriend, turns, up, apiKey);
        if (reply) {
          await db.diaryChats.add({ thread, role: 'ai', friendId: activeFriend.id, friendName: activeFriend.name, emoji: activeFriend.emoji, color: activeFriend.color, text: reply, createdAt: Date.now() });
        }
      }
    } catch {
      setToast(en ? 'Something went wrong.' : 'うまくいかなかった…');
    } finally {
      setSending(false);
    }
  }

  async function learnNow() {
    if (learning) return;
    const apiKey = getEffectiveApiKey();
    if (!apiKey) { setToast(en ? 'Set your API key in Settings.' : 'APIキーを設定してね'); return; }
    setLearning(true);
    try {
      const today = todayIso();
      const [todayDiary, recentChats, allFriends] = await Promise.all([
        db.diaries.where('date').equals(today).filter(d => !d.deletedAt).toArray(),
        db.diaryChats.orderBy('createdAt').reverse().filter(m => !m.deletedAt).limit(60).toArray(),
        db.aiFriends.filter(f => !f.deletedAt).toArray(),
      ]);
      const diaryText = todayDiary[0]?.content ? stripHtml(todayDiary[0].content) : '';
      const transcript = recentChats.reverse().map(m => `${m.role === 'user' ? 'ユーザー' : m.friendName}: ${m.text}`).join('\n');
      const ok = await runDailyLearning(apiKey, diaryText, transcript, allFriends, getUserPersona());
      setLastLearnedDate(today);
      setToast(ok ? (en ? 'Learned from today ✨ Your AI grew.' : '今日から学んだよ ✨ AIが少し育った') : (en ? 'Could not learn this time.' : 'うまく学習できなかった…'));
    } catch {
      setToast(en ? 'Could not learn this time.' : 'うまく学習できなかった…');
    } finally {
      setLearning(false);
    }
  }

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(''), 2600);
    return () => clearTimeout(id);
  }, [toast]);

  return (
    <div className="df-root">
      <div className="df-header">
        <button className="df-back" onClick={onClose} aria-label={en ? 'Back' : '戻る'}><ArrowLeft size={18} /></button>
        <MessageCircle size={16} className="df-head-ic" />
        <span className="df-title">{en ? 'AI Friends' : 'AIフレンド'}</span>
        <button className="df-learn" onClick={() => void learnNow()} disabled={learning} title={en ? 'Reflect on today' : '今日を振り返って学習'}>
          {learning ? <Loader2 size={14} className="df-spin" /> : <Sparkles size={14} />}
          <span>{en ? 'Reflect' : '今日を振り返る'}</span>
        </button>
      </div>

      {/* thread tabs: group + each friend */}
      <div className="df-tabs">
        <button className={`df-tab${thread === 'group' ? ' on' : ''}`} onClick={() => setThread('group')}>
          <Users size={14} /> {en ? 'Group' : 'グループ'}
        </button>
        {friends.map(f => (
          <button key={f.id} className={`df-tab${thread === `f${f.id}` ? ' on' : ''}`} onClick={() => setThread(`f${f.id}`)}>
            <span className="df-tab-ava" style={{ background: f.color }}>{f.emoji}</span>
            {f.name}
          </button>
        ))}
        <button className="df-tab df-tab-add" onClick={() => setEditing('new')} title={en ? 'Add friend' : 'フレンドを追加'}>
          <UserPlus size={15} />
        </button>
      </div>

      {activeFriend && (
        <div className="df-friendbar">
          <span className="df-friendbar-persona">{activeFriend.persona}</span>
          <button className="df-friendbar-edit" onClick={() => setEditing(activeFriend)} title={en ? 'Edit' : '編集'}><Pencil size={13} /></button>
        </div>
      )}

      <div className="df-thread" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="df-empty">
            <div className="df-empty-emoji">{thread === 'group' ? '👥' : activeFriend?.emoji ?? '💬'}</div>
            <p>{thread === 'group'
              ? (en ? 'Everyone is here. Say hi!' : 'みんないるよ。話しかけてみて！')
              : (en ? `Chat with ${activeFriend?.name ?? ''}` : `${activeFriend?.name ?? ''}とおしゃべり`)}</p>
            <p className="df-empty-sub">{en ? 'They remember your diary and grow to fit you each day.' : '日記を覚えていて、毎日あなたに合わせて育っていくよ。'}</p>
          </div>
        )}
        {messages.map(m => (
          m.role === 'user' ? (
            <div key={m.id} className="df-row df-row-me">
              <div className="df-bubble df-bubble-me">{m.text}</div>
            </div>
          ) : (
            <div key={m.id} className="df-row">
              <span className="df-ava" style={{ background: m.color || '#8b5cf6' }}>{m.emoji || '🙂'}</span>
              <div className="df-msg">
                <span className="df-name">{m.friendName}</span>
                <div className="df-bubble">{m.text}</div>
              </div>
            </div>
          )
        ))}
        {sending && (
          <div className="df-row"><span className="df-ava df-ava-typing">💬</span><div className="df-bubble df-typing"><span></span><span></span><span></span></div></div>
        )}
      </div>

      <div className="df-inputbar">
        <textarea
          className="df-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
          placeholder={thread === 'group' ? (en ? 'Message everyone…' : 'みんなにメッセージ…') : (en ? `Message ${activeFriend?.name ?? ''}…` : `${activeFriend?.name ?? ''}にメッセージ…`)}
          rows={1}
          disabled={sending}
        />
        <button className="df-send" onClick={() => void send()} disabled={!input.trim() || sending}>
          {sending ? <Loader2 size={16} className="df-spin" /> : <Send size={16} />}
        </button>
      </div>

      {toast && <div className="df-toast">{toast}</div>}
      {editing && <FriendEditor friend={editing === 'new' ? null : editing} onClose={() => setEditing(null)} en={en} />}
      <DiaryFriendsStyles />
    </div>
  );
}

// ── フレンドの追加/編集 ──
function FriendEditor({ friend, onClose, en }: { friend: AiFriend | null; onClose: () => void; en: boolean }) {
  const [name, setName] = useState(friend?.name ?? '');
  const [emoji, setEmoji] = useState(friend?.emoji ?? '🌸');
  const [color, setColor] = useState(friend?.color ?? '#ec4899');
  const [persona, setPersona] = useState(friend?.persona ?? '');
  const [confirmDel, setConfirmDel] = useState(false);

  async function save() {
    if (!name.trim() || !persona.trim()) return;
    const now = Date.now();
    if (friend?.id != null) {
      await db.aiFriends.update(friend.id, { name: name.trim(), emoji, color, persona: persona.trim(), updatedAt: now });
    } else {
      await db.aiFriends.add({ name: name.trim(), emoji, color, persona: persona.trim(), learned: '', createdAt: now, updatedAt: now });
    }
    onClose();
  }

  return (
    <div className="df-modal-bg" onClick={onClose}>
      <div className="df-modal" onClick={e => e.stopPropagation()}>
        <div className="df-modal-head">
          <span>{friend ? (en ? 'Edit friend' : 'フレンドを編集') : (en ? 'New friend' : 'フレンドを追加')}</span>
          <button onClick={onClose}><X size={18} /></button>
        </div>
        <div className="df-modal-avarow">
          <span className="df-modal-ava" style={{ background: color }}>{emoji}</span>
          <input className="df-modal-name" value={name} onChange={e => setName(e.target.value)} placeholder={en ? 'Name' : '名前'} maxLength={16} />
        </div>
        <div className="df-modal-label">{en ? 'Avatar' : 'アイコン'}</div>
        <div className="df-modal-emojis">
          {AVATAR_EMOJIS.map(e => <button key={e} className={`df-emo${emoji === e ? ' on' : ''}`} onClick={() => setEmoji(e)}>{e}</button>)}
        </div>
        <div className="df-modal-colors">
          {AVATAR_COLORS.map(c => <button key={c} className={`df-col${color === c ? ' on' : ''}`} style={{ background: c }} onClick={() => setColor(c)} />)}
        </div>
        <div className="df-modal-label">{en ? 'Personality / role / speaking style' : '性格・立ち位置・話し方'}</div>
        <textarea className="df-modal-persona" value={persona} onChange={e => setPersona(e.target.value)}
          placeholder={en ? 'e.g. A calm, reliable listener who keeps things short.' : '例: 落ち着いた頼れる聞き上手。短く的確に返す。'} rows={4} />
        <div className="df-modal-actions">
          {friend && !friend.builtin && (
            confirmDel
              ? <button className="df-modal-del-confirm" onClick={async () => { if (friend.id != null) await softDeleteAiFriend(friend.id); onClose(); }}>{en ? 'Delete' : '削除する'}</button>
              : <button className="df-modal-del" onClick={() => setConfirmDel(true)}><Trash2 size={14} /></button>
          )}
          <div className="df-modal-spacer" />
          <button className="df-modal-cancel" onClick={onClose}>{en ? 'Cancel' : 'キャンセル'}</button>
          <button className="df-modal-save" onClick={() => void save()} disabled={!name.trim() || !persona.trim()}>{en ? 'Save' : '保存'}</button>
        </div>
      </div>
    </div>
  );
}

function stripHtml(html: string): string {
  if (typeof document === 'undefined') return html.replace(/<[^>]+>/g, ' ');
  const d = document.createElement('div');
  d.innerHTML = html;
  return (d.textContent || '').replace(/\s+/g, ' ').trim();
}

function DiaryFriendsStyles() {
  return (
    <style jsx global>{`
      .df-root { display: flex; flex-direction: column; height: 100%; min-height: 0; background: var(--background); max-width: 720px; margin: 0 auto; width: 100%; }
      .df-header { display: flex; align-items: center; gap: 8px; padding: 12px 14px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
      .df-back { display: flex; width: 34px; height: 34px; align-items: center; justify-content: center; border-radius: 50%; border: none; background: var(--accent); color: var(--foreground); cursor: pointer; }
      .df-head-ic { color: #8b5cf6; }
      .df-title { font-size: 1rem; font-weight: 800; color: var(--foreground); flex: 1; }
      .df-learn { display: inline-flex; align-items: center; gap: 5px; padding: 6px 12px; border-radius: 999px; border: 1.5px solid color-mix(in srgb, #8b5cf6 40%, var(--border)); background: color-mix(in srgb, #8b5cf6 10%, var(--accent)); color: #8b5cf6; font-size: 0.78rem; font-weight: 800; cursor: pointer; }
      .df-learn:disabled { opacity: 0.6; cursor: default; }
      .df-tabs { display: flex; gap: 6px; padding: 10px 14px; overflow-x: auto; flex-shrink: 0; scrollbar-width: none; }
      .df-tabs::-webkit-scrollbar { display: none; }
      .df-tab { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 999px; border: 1.5px solid var(--border); background: var(--accent); color: var(--fg-muted); font-size: 0.82rem; font-weight: 700; cursor: pointer; white-space: nowrap; flex-shrink: 0; }
      .df-tab.on { background: linear-gradient(120deg, #8b5cf6, #ec4899); color: #fff; border-color: transparent; }
      .df-tab-ava { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; border-radius: 50%; font-size: 0.72rem; }
      .df-tab-add { padding: 6px 10px; }
      .df-friendbar { display: flex; align-items: center; gap: 8px; padding: 6px 16px 10px; }
      .df-friendbar-persona { flex: 1; font-size: 0.74rem; color: var(--fg-muted); line-height: 1.4; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
      .df-friendbar-edit { flex-shrink: 0; background: transparent; border: none; color: var(--fg-muted); cursor: pointer; padding: 4px; border-radius: 6px; }
      .df-friendbar-edit:hover { color: #8b5cf6; }
      .df-thread { flex: 1; min-height: 0; overflow-y: auto; padding: 12px 14px 6px; display: flex; flex-direction: column; gap: 12px; }
      .df-empty { margin: auto; text-align: center; color: var(--fg-muted); padding: 20px; }
      .df-empty-emoji { font-size: 2.6rem; }
      .df-empty p { margin: 8px 0 0; font-size: 0.9rem; font-weight: 700; color: var(--foreground); }
      .df-empty-sub { font-size: 0.78rem !important; font-weight: 400 !important; color: var(--fg-muted) !important; }
      .df-row { display: flex; gap: 8px; align-items: flex-end; max-width: 100%; }
      .df-row-me { justify-content: flex-end; }
      .df-ava { flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; width: 34px; height: 34px; border-radius: 50%; font-size: 1rem; box-shadow: 0 1px 3px rgba(0,0,0,.12); }
      .df-msg { display: flex; flex-direction: column; gap: 2px; max-width: 78%; }
      .df-name { font-size: 0.68rem; color: var(--fg-muted); margin-left: 4px; font-weight: 700; }
      .df-bubble { padding: 9px 13px; border-radius: 16px; font-size: 0.9rem; line-height: 1.5; white-space: pre-wrap; word-break: break-word; background: var(--accent); color: var(--foreground); border-top-left-radius: 5px; }
      .df-bubble-me { background: linear-gradient(120deg, #8b5cf6, #ec4899); color: #fff; border-top-left-radius: 16px; border-top-right-radius: 5px; max-width: 78%; }
      .df-typing { display: inline-flex; gap: 4px; align-items: center; }
      .df-typing span { width: 6px; height: 6px; border-radius: 50%; background: var(--fg-muted); opacity: 0.5; animation: df-blink 1.2s infinite; }
      .df-typing span:nth-child(2) { animation-delay: .2s; } .df-typing span:nth-child(3) { animation-delay: .4s; }
      @keyframes df-blink { 0%,60%,100% { opacity: .3; } 30% { opacity: 1; } }
      .df-ava-typing { background: var(--muted); }
      .df-inputbar { display: flex; gap: 8px; align-items: flex-end; padding: 10px 14px; border-top: 1px solid var(--border); flex-shrink: 0; }
      .df-input { flex: 1; resize: none; max-height: 120px; min-height: 42px; padding: 10px 14px; border-radius: 20px; border: 1.5px solid var(--border); background: var(--accent); color: var(--foreground); font-size: 0.9rem; outline: none; font-family: inherit; box-sizing: border-box; }
      .df-input:focus { border-color: #8b5cf6; }
      .df-send { flex-shrink: 0; width: 42px; height: 42px; border-radius: 50%; border: none; background: linear-gradient(120deg, #8b5cf6, #ec4899); color: #fff; display: flex; align-items: center; justify-content: center; cursor: pointer; }
      .df-send:disabled { opacity: 0.45; cursor: default; }
      .df-spin { animation: df-rot 0.8s linear infinite; }
      @keyframes df-rot { to { transform: rotate(360deg); } }
      .df-toast { position: fixed; left: 50%; bottom: 84px; transform: translateX(-50%); background: rgba(15,23,42,.92); color: #fff; padding: 10px 18px; border-radius: 999px; font-size: 0.82rem; font-weight: 700; z-index: 60; box-shadow: 0 6px 20px rgba(0,0,0,.25); }
      .df-modal-bg { position: fixed; inset: 0; background: rgba(15,23,42,.45); display: flex; align-items: center; justify-content: center; z-index: 70; padding: 18px; }
      .df-modal { width: 100%; max-width: 420px; background: var(--background); border-radius: 18px; padding: 18px; box-shadow: 0 20px 50px rgba(0,0,0,.3); max-height: 90vh; overflow-y: auto; }
      .df-modal-head { display: flex; align-items: center; justify-content: space-between; font-size: 1rem; font-weight: 800; color: var(--foreground); margin-bottom: 14px; }
      .df-modal-head button { background: transparent; border: none; color: var(--fg-muted); cursor: pointer; }
      .df-modal-avarow { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
      .df-modal-ava { display: inline-flex; align-items: center; justify-content: center; width: 46px; height: 46px; border-radius: 50%; font-size: 1.4rem; flex-shrink: 0; }
      .df-modal-name { flex: 1; padding: 10px 12px; border-radius: 10px; border: 1.5px solid var(--border); background: var(--accent); color: var(--foreground); font-size: 0.95rem; outline: none; }
      .df-modal-label { font-size: 0.74rem; font-weight: 800; color: var(--fg-muted); margin: 10px 0 6px; }
      .df-modal-emojis { display: flex; flex-wrap: wrap; gap: 5px; }
      .df-emo { width: 34px; height: 34px; border-radius: 9px; border: 1.5px solid var(--border); background: var(--accent); font-size: 1.1rem; cursor: pointer; }
      .df-emo.on { border-color: #8b5cf6; background: color-mix(in srgb, #8b5cf6 12%, var(--accent)); }
      .df-modal-colors { display: flex; gap: 7px; margin-top: 8px; }
      .df-col { width: 26px; height: 26px; border-radius: 50%; border: 2px solid transparent; cursor: pointer; }
      .df-col.on { border-color: var(--foreground); }
      .df-modal-persona { width: 100%; box-sizing: border-box; padding: 10px 12px; border-radius: 10px; border: 1.5px solid var(--border); background: var(--accent); color: var(--foreground); font-size: 0.88rem; outline: none; resize: vertical; font-family: inherit; line-height: 1.5; }
      .df-modal-actions { display: flex; align-items: center; gap: 8px; margin-top: 16px; }
      .df-modal-spacer { flex: 1; }
      .df-modal-del { background: transparent; border: 1px solid var(--border); border-radius: 8px; padding: 7px 10px; color: #ef4444; cursor: pointer; }
      .df-modal-del-confirm { background: #ef4444; border: none; border-radius: 8px; padding: 8px 14px; color: #fff; font-weight: 700; font-size: 0.82rem; cursor: pointer; }
      .df-modal-cancel { background: transparent; border: 1px solid var(--border); border-radius: 8px; padding: 8px 14px; color: var(--fg-muted); cursor: pointer; font-size: 0.85rem; }
      .df-modal-save { background: linear-gradient(120deg, #8b5cf6, #ec4899); border: none; border-radius: 8px; padding: 8px 18px; color: #fff; font-weight: 800; font-size: 0.85rem; cursor: pointer; }
      .df-modal-save:disabled { opacity: 0.5; cursor: default; }
    `}</style>
  );
}
