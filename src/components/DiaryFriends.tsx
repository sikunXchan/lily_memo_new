'use client';

import { useState, useEffect, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import dynamic from 'next/dynamic';
import { ArrowLeft, Send, Users, UserPlus, Sparkles, Trash2, X, Loader2, Pencil, MessageCircle, Notebook, Sliders, Ghost, Lock, Info } from 'lucide-react';
import { db, softDeleteAiFriend, type AiFriend, type DiaryChatMsg } from '@/lib/db';
import type { ChatTurn } from '@/lib/gemini';
import {
  seedDefaultFriends, chatReply, runCharacterLearning, isGroupEligible,
  getLastLearnedDate, setLastLearnedDate, getAutoLearn, setAutoLearn,
  GROUP_MIN_CHATS, GROUP_MIN_LEARNS,
} from '@/lib/aiFriends';
import { getEffectiveApiKey } from '@/lib/appLang';
import { getAppLang } from '@/lib/appLang';
import { useCharacterSkin } from '@/components/CharacterSkinContext';

const DiaryScreen = dynamic(() => import('@/components/DiaryScreen'), { ssr: false });

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

// 最初に選べる性格の起点プリセット。ここからキャラが個人チャットで学習して育つ。
const PERSONA_PRESETS: { name: string; emoji: string; persona: string }[] = [
  { name: '聞き上手', emoji: '🌸', persona: '明るくて共感的な聞き上手。まず気持ちに寄り添い、やさしく肯定して背中を押す。話し方はやわらかく前向き、たまに絵文字。' },
  { name: 'クール', emoji: '🌙', persona: '落ち着いた頼れる相談相手。冷静で少し大人びた視点をくれる。感情に流されず要点を短く整理する。絵文字は少なめ、丁寧だが堅すぎない。' },
  { name: 'ムードメーカー', emoji: '🐻', persona: 'おちゃめで元気なムードメーカー。テンション高めで軽いツッコミや冗談で場を和ませる。くだけた口調、絵文字多め。' },
  { name: 'ストイック', emoji: '🔥', persona: '努力を後押しするストイックな相棒。甘やかしすぎず、具体的に励まして次の一歩を促す。まっすぐで熱い口調。' },
  { name: 'いやし系', emoji: '🍵', persona: 'のんびりした癒やし系。ゆるくて優しく、無理をさせない。そっと寄り添って安心させる。ふんわりした話し方。' },
  { name: 'ツンデレ', emoji: '🐱', persona: '素直じゃないけど本当は優しいツンデレ。ぶっきらぼうな言い方の中に気づかいがにじむ。短めの口調。' },
];

// avatarKey -> 画像パス。'lily' は選択中スキン、他は固定のキャラ画像。
function useAvatarImg() {
  const { avatarSrc } = useCharacterSkin();
  return (avatarKey?: string): string | null => {
    if (avatarKey === 'lily') return avatarSrc('/lilygirls.PNG');
    if (avatarKey === 'sikun') return '/sikun-character.png';
    if (avatarKey === 'chakun') return '/sikun-dribble.gif';
    return null;
  };
}

// 円形アバター: 画像アバターがあれば <img>、無ければ絵文字。
function Avatar({ img, emoji, color, size }: { img: string | null; emoji?: string; color?: string; size: number }) {
  return (
    <span className="df-ava" style={{ background: img ? '#fff' : (color || '#8b5cf6'), width: size, height: size, fontSize: size * 0.56 }}>
      {img
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={img} alt="" className="df-ava-img" />
        : (emoji || '🙂')}
    </span>
  );
}

export default function DiaryFriends({ onGoBack }: { onGoBack: () => void }) {
  const en = getAppLang() === 'en';
  const avatarImg = useAvatarImg();
  const friends = useLiveQuery<AiFriend[]>(
    () => db.aiFriends.orderBy('createdAt').filter(f => !f.deletedAt).toArray(), []
  ) ?? [];

  const [thread, setThread] = useState<string>('group'); // 'group' | `f{id}`
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [typingFriend, setTypingFriend] = useState<AiFriend | null>(null);
  const [learning, setLearning] = useState(false);
  const [toast, setToast] = useState('');
  const [editing, setEditing] = useState<AiFriend | 'new' | null>(null);
  const [ghost, setGhost] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showDiary, setShowDiary] = useState(false);
  const [menuMsg, setMenuMsg] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const seededRef = useRef(false);

  const messages = useLiveQuery<DiaryChatMsg[]>(
    () => db.diaryChats.where('thread').equals(thread).filter(m => !m.deletedAt).sortBy('createdAt'),
    [thread]
  ) ?? [];

  // 各フレンドの個人チャット回数（ユーザー発言数）→ グループ解放条件に使う。
  const chatCounts = useLiveQuery<Record<string, number>>(async () => {
    const rows = await db.diaryChats.filter(m => !m.deletedAt && m.role === 'user' && m.thread.startsWith('f')).toArray();
    const map: Record<string, number> = {};
    for (const m of rows) map[m.thread] = (map[m.thread] ?? 0) + 1;
    return map;
  }, []) ?? {};
  const chatCountOf = (f: AiFriend) => chatCounts[`f${f.id}`] ?? 0;
  const eligibleFriends = friends.filter(f => isGroupEligible(f, chatCountOf(f)));

  // 初回: 既定フレンドをシード。自動学習ON＆新しい日なら、キャラごとに個人チャットから学習。
  useEffect(() => {
    if (seededRef.current) return;
    seededRef.current = true;
    void (async () => {
      await seedDefaultFriends();
      if (!getAutoLearn()) return;
      const today = todayIso();
      if (getLastLearnedDate() === today) return;
      const apiKey = getEffectiveApiKey();
      if (!apiKey) return;
      const allFriends = await db.aiFriends.filter(f => !f.deletedAt).toArray();
      for (const f of allFriends) {
        if (f.id == null) continue;
        const rows = await db.diaryChats.where('thread').equals(`f${f.id}`)
          .filter(m => !m.deletedAt && !m.ghost && m.createdAt > (f.lastLearnedAt ?? 0)).sortBy('createdAt');
        if (rows.length < 2) continue; // 新しい会話が少なければスキップ
        const transcript = rows.map(m => `${m.role === 'user' ? 'ユーザー' : f.name}: ${m.text}`).join('\n');
        try { await runCharacterLearning(apiKey, f, transcript); } catch { /* silent */ }
      }
      setLastLearnedDate(today);
    })();
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, sending]);

  useEffect(() => { setMenuMsg(null); }, [thread]);

  const activeFriend = thread.startsWith('f') ? friends.find(f => `f${f.id}` === thread) : undefined;

  async function send() {
    const text = input.trim();
    if (!text || sending) return;
    const apiKey = getEffectiveApiKey();
    if (!apiKey) { setToast(en ? 'Set your API key in Settings.' : 'APIキーを設定してね'); return; }
    if (thread === 'group' && eligibleFriends.length === 0) {
      setToast(en ? 'No friend has joined the group yet.' : 'まだグループに参加できる子がいないよ');
      return;
    }
    setInput('');
    setSending(true);
    const now = Date.now();
    await db.diaryChats.add({ thread, role: 'user', text, ghost: ghost || undefined, createdAt: now });
    try {
      if (thread === 'group') {
        // グループは「解放済み」のフレンドだけが順に返信（後の子は前の子の発言も見える）。
        const participants = eligibleFriends;
        const otherNamesAll = participants.map(f => f.name);
        for (const f of participants) {
          setTypingFriend(f);
          const cur = await db.diaryChats.where('thread').equals('group').filter(m => !m.deletedAt).sortBy('createdAt');
          const turns = mergeTurns(cur.map<ChatTurn>(m =>
            m.role === 'user' ? { role: 'user', text: m.text }
              : m.friendId === f.id ? { role: 'model', text: m.text }
                : { role: 'user', text: `${m.friendName}: ${m.text}` }
          ));
          const others = otherNamesAll.filter(n => n !== f.name);
          const reply = await chatReply(f, turns, apiKey, others);
          if (reply) {
            await db.diaryChats.add({ thread: 'group', role: 'ai', friendId: f.id, friendName: f.name, emoji: f.emoji, avatarKey: f.avatarKey, color: f.color, text: reply, ghost: ghost || undefined, createdAt: Date.now() });
          }
        }
      } else if (activeFriend) {
        setTypingFriend(activeFriend);
        const history = await db.diaryChats.where('thread').equals(thread).filter(m => !m.deletedAt).sortBy('createdAt');
        const turns = mergeTurns(history.map<ChatTurn>(m => ({ role: m.role === 'user' ? 'user' : 'model', text: m.text })));
        const reply = await chatReply(activeFriend, turns, apiKey);
        if (reply) {
          await db.diaryChats.add({ thread, role: 'ai', friendId: activeFriend.id, friendName: activeFriend.name, emoji: activeFriend.emoji, avatarKey: activeFriend.avatarKey, color: activeFriend.color, text: reply, ghost: ghost || undefined, createdAt: Date.now() });
        }
      }
    } catch {
      setToast(en ? 'Something went wrong.' : 'うまくいかなかった…');
    } finally {
      setSending(false);
      setTypingFriend(null);
    }
  }

  // 送信取り消し（ソフト削除）。
  async function unsend(id: number) {
    setMenuMsg(null);
    await db.diaryChats.update(id, { deletedAt: Date.now() });
  }

  // このキャラの個人チャット（ゴースト除く）から手動学習。グループでは不可。
  async function learnFriend() {
    if (learning || !activeFriend || activeFriend.id == null) return;
    const apiKey = getEffectiveApiKey();
    if (!apiKey) { setToast(en ? 'Set your API key in Settings.' : 'APIキーを設定してね'); return; }
    setLearning(true);
    try {
      const rows = await db.diaryChats.where('thread').equals(`f${activeFriend.id}`)
        .filter(m => !m.deletedAt && !m.ghost).sortBy('createdAt');
      const recent = rows.slice(-60);
      const transcript = recent.map(m => `${m.role === 'user' ? 'ユーザー' : activeFriend.name}: ${m.text}`).join('\n');
      if (!transcript.trim()) { setToast(en ? 'Chat a bit first, then learn.' : 'まず少し会話してから学習してね'); return; }
      const ok = await runCharacterLearning(apiKey, activeFriend, transcript);
      setToast(ok
        ? (en ? `${activeFriend.name} learned from your chat ✨` : `${activeFriend.name}が会話から学んだよ ✨`)
        : (en ? 'Could not learn this time.' : 'うまく学習できなかった…'));
    } catch {
      setToast(en ? 'Could not learn this time.' : 'うまく学習できなかった…');
    } finally {
      setLearning(false);
    }
  }

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(''), 2800);
    return () => clearTimeout(id);
  }, [toast]);

  if (showDiary) {
    return <DiaryScreen onGoBack={() => setShowDiary(false)} />;
  }

  const learnedCount = activeFriend?.learnCount ?? 0;
  const groupLocked = thread === 'group' && eligibleFriends.length === 0;

  return (
    <div className="df-root">
      <div className="df-header">
        <button className="df-back" onClick={onGoBack} aria-label={en ? 'Back' : '戻る'}><ArrowLeft size={18} /></button>
        <MessageCircle size={16} className="df-head-ic" />
        <span className="df-title">DM</span>
        <button className="df-headbtn" onClick={() => setShowDiary(true)} title={en ? 'Diary' : '日記'}>
          <Notebook size={17} />
        </button>
        <button className="df-headbtn" onClick={() => setShowSettings(true)} title={en ? 'Chat settings' : 'チャット設定'}>
          <Sliders size={17} />
        </button>
      </div>

      {/* thread tabs: group + each friend */}
      <div className="df-tabs">
        <button className={`df-tab${thread === 'group' ? ' on' : ''}`} onClick={() => setThread('group')}>
          <Users size={14} /> {en ? 'Group' : 'グループ'}
          {eligibleFriends.length === 0 && <Lock size={11} className="df-tab-lock" />}
        </button>
        {friends.map(f => {
          const img = avatarImg(f.avatarKey);
          return (
            <button key={f.id} className={`df-tab${thread === `f${f.id}` ? ' on' : ''}`} onClick={() => setThread(`f${f.id}`)}>
              <span className="df-tab-ava" style={{ background: img ? '#fff' : f.color }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {img ? <img src={img} alt="" className="df-ava-img" /> : f.emoji}
              </span>
              {f.name}
            </button>
          );
        })}
        <button className="df-tab df-tab-add" onClick={() => setEditing('new')} title={en ? 'Add friend' : 'フレンドを追加'}>
          <UserPlus size={15} />
        </button>
      </div>

      {activeFriend && (
        <div className="df-friendbar">
          <span className="df-friendbar-persona">{activeFriend.persona}</span>
          <span className="df-friendbar-learn">🌱{learnedCount}</span>
          <button className="df-friendbar-btn" onClick={() => void learnFriend()} disabled={learning} title={en ? 'Learn from this chat' : 'この会話から学習'}>
            {learning ? <Loader2 size={13} className="df-spin" /> : <Sparkles size={13} />}
          </button>
          <button className="df-friendbar-btn" onClick={() => setEditing(activeFriend)} title={en ? 'Edit' : '編集'}><Pencil size={13} /></button>
        </div>
      )}

      <div className="df-thread" ref={scrollRef} onClick={() => menuMsg != null && setMenuMsg(null)}>
        {messages.length === 0 && !groupLocked && (
          <div className="df-empty">
            <div className="df-empty-emoji">
              {thread === 'group'
                ? '👥'
                : (avatarImg(activeFriend?.avatarKey)
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={avatarImg(activeFriend?.avatarKey)!} alt="" className="df-empty-avaimg" />
                  : (activeFriend?.emoji ?? '💬'))}
            </div>
            <p>{thread === 'group'
              ? (en ? 'Everyone is here. Say hi!' : 'みんないるよ。話しかけてみて！')
              : (en ? `Chat with ${activeFriend?.name ?? ''}` : `${activeFriend?.name ?? ''}とおしゃべり`)}</p>
            <p className="df-empty-sub">{thread === 'group'
              ? (en ? 'Only friends you have chatted with enough join the group.' : '個人チャットで十分に仲良くなった子だけがグループに参加するよ。')
              : (en ? 'This character learns only from your 1-on-1 chats.' : 'この子は個人チャットからあなたに合わせて育っていくよ。')}</p>
          </div>
        )}
        {groupLocked && (
          <div className="df-locked">
            <Lock size={26} />
            <p className="df-locked-title">{en ? 'Group is not open yet' : 'グループはまだ開放されていないよ'}</p>
            <p className="df-locked-sub">{en
              ? `A character joins the group after ${GROUP_MIN_CHATS} one-on-one messages and ${GROUP_MIN_LEARNS} learnings.`
              : `個人チャットで${GROUP_MIN_CHATS}回会話し、${GROUP_MIN_LEARNS}回学習した子がグループに参加できるよ。`}</p>
            <div className="df-progress-list">
              {friends.map(f => {
                const cc = chatCountOf(f), lc = f.learnCount ?? 0;
                return (
                  <div key={f.id} className="df-progress">
                    <span className="df-progress-name">{f.name}</span>
                    <span className="df-progress-bar"><i style={{ width: `${Math.min(100, cc / GROUP_MIN_CHATS * 100)}%` }} /></span>
                    <span className="df-progress-num">💬{cc}/{GROUP_MIN_CHATS}・🌱{lc}/{GROUP_MIN_LEARNS}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {messages.map(m => (
          m.role === 'user' ? (
            <div key={m.id} className="df-row df-row-me">
              {menuMsg === m.id && (
                <button className="df-unsend" onClick={() => void unsend(m.id!)}><Trash2 size={12} /> {en ? 'Unsend' : '取り消し'}</button>
              )}
              <div
                className={`df-bubble df-bubble-me${m.ghost ? ' df-bubble-ghost' : ''}`}
                onClick={(e) => { e.stopPropagation(); setMenuMsg(menuMsg === m.id ? null : m.id!); }}
              >
                {m.ghost && <Ghost size={12} className="df-ghost-ic" />}{m.text}
              </div>
            </div>
          ) : (
            <div key={m.id} className="df-row">
              <Avatar img={avatarImg(m.avatarKey)} emoji={m.emoji} color={m.color} size={34} />
              <div className="df-msg">
                <span className="df-name">{m.friendName}</span>
                <div className={`df-bubble${m.ghost ? ' df-bubble-ghost' : ''}`}>{m.text}</div>
              </div>
            </div>
          )
        ))}
        {sending && typingFriend && (
          <div className="df-row">
            <Avatar img={avatarImg(typingFriend.avatarKey)} emoji={typingFriend.emoji} color={typingFriend.color} size={34} />
            <div className="df-bubble df-typing"><span></span><span></span><span></span></div>
          </div>
        )}
      </div>

      <div className={`df-inputbar${ghost ? ' ghost' : ''}`}>
        <button className={`df-ghost-btn${ghost ? ' on' : ''}`} onClick={() => setGhost(g => !g)} title={en ? 'Ghost chat (not used for learning)' : 'ゴーストチャット（学習に使わない）'}>
          <Ghost size={17} />
        </button>
        <textarea
          className="df-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
          placeholder={groupLocked
            ? (en ? 'Group not open yet' : 'グループはまだ開放されていないよ')
            : ghost
              ? (en ? 'Ghost message (not learned)…' : 'ゴースト（学習しない）…')
              : thread === 'group' ? (en ? 'Message everyone…' : 'みんなにメッセージ…') : (en ? `Message ${activeFriend?.name ?? ''}…` : `${activeFriend?.name ?? ''}にメッセージ…`)}
          rows={1}
          disabled={sending || groupLocked}
        />
        <button className="df-send" onClick={() => void send()} disabled={!input.trim() || sending || groupLocked}>
          {sending ? <Loader2 size={16} className="df-spin" /> : <Send size={16} />}
        </button>
      </div>

      {toast && <div className="df-toast">{toast}</div>}
      {editing && <FriendEditor friend={editing === 'new' ? null : editing} avatarImg={editing !== 'new' ? avatarImg(editing.avatarKey) : null} onClose={() => setEditing(null)} en={en} />}
      {showSettings && <ChatSettings friends={friends} chatCountOf={chatCountOf} onClose={() => setShowSettings(false)} en={en} />}
      <DiaryFriendsStyles />
    </div>
  );
}

// ── チャット設定シート ──
function ChatSettings({ friends, chatCountOf, onClose, en }: { friends: AiFriend[]; chatCountOf: (f: AiFriend) => number; onClose: () => void; en: boolean }) {
  const [auto, setAuto] = useState(getAutoLearn());
  return (
    <div className="df-modal-bg" onClick={onClose}>
      <div className="df-modal" onClick={e => e.stopPropagation()}>
        <div className="df-modal-head">
          <span>{en ? 'Chat settings' : 'チャット設定'}</span>
          <button onClick={onClose}><X size={18} /></button>
        </div>

        <label className="df-set-row">
          <div className="df-set-txt">
            <span className="df-set-title">{en ? 'Auto-learn each day' : '自動学習（1日1回）'}</span>
            <span className="df-set-sub">{en ? 'Each character learns from its 1-on-1 chats automatically.' : 'キャラごとに個人チャットから自動で学習するよ。'}</span>
          </div>
          <button className={`df-toggle${auto ? ' on' : ''}`} onClick={() => { const v = !auto; setAuto(v); setAutoLearn(v); }}>
            <span className="df-toggle-knob" />
          </button>
        </label>

        <div className="df-set-note">
          <Ghost size={14} /> <span>{en ? 'Ghost chat: tap the ghost icon to send messages that are NOT used for learning.' : 'ゴーストチャット: 入力欄のゴーストを押すと、学習に使わないメッセージを送れるよ。'}</span>
        </div>
        <div className="df-set-note">
          <Info size={14} /> <span>{en
            ? `Group chat: a character joins after ${GROUP_MIN_CHATS} one-on-one messages and ${GROUP_MIN_LEARNS} learnings. Learning happens only in 1-on-1 chats.`
            : `グループ: 個人チャット${GROUP_MIN_CHATS}回＋学習${GROUP_MIN_LEARNS}回で参加できるよ。学習は個人チャットのみ。`}</span>
        </div>

        <div className="df-modal-label">{en ? 'Group progress' : 'グループ解放の進捗'}</div>
        <div className="df-progress-list">
          {friends.map(f => {
            const cc = chatCountOf(f), lc = f.learnCount ?? 0;
            const done = isGroupEligible(f, cc);
            return (
              <div key={f.id} className="df-progress">
                <span className="df-progress-name">{done ? '✅ ' : ''}{f.name}</span>
                <span className="df-progress-num">💬{cc}/{GROUP_MIN_CHATS}・🌱{lc}/{GROUP_MIN_LEARNS}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── フレンドの追加/編集 ──
function FriendEditor({ friend, avatarImg, onClose, en }: { friend: AiFriend | null; avatarImg?: string | null; onClose: () => void; en: boolean }) {
  const [name, setName] = useState(friend?.name ?? '');
  const [emoji, setEmoji] = useState(friend?.emoji ?? '🌸');
  const [color, setColor] = useState(friend?.color ?? '#ec4899');
  const [persona, setPersona] = useState(friend?.persona ?? '');
  const [confirmDel, setConfirmDel] = useState(false);
  const hasImg = !!avatarImg; // 画像アバターの既定フレンド（アイコン/色の変更は不可）

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
          <span className="df-modal-ava" style={{ background: hasImg ? '#fff' : color, overflow: 'hidden' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {hasImg ? <img src={avatarImg!} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} /> : emoji}
          </span>
          <input className="df-modal-name" value={name} onChange={e => setName(e.target.value)} placeholder={en ? 'Name' : '名前'} maxLength={16} />
        </div>
        {!hasImg && <>
          <div className="df-modal-label">{en ? 'Avatar' : 'アイコン'}</div>
          <div className="df-modal-emojis">
            {AVATAR_EMOJIS.map(e => <button key={e} className={`df-emo${emoji === e ? ' on' : ''}`} onClick={() => setEmoji(e)}>{e}</button>)}
          </div>
          <div className="df-modal-colors">
            {AVATAR_COLORS.map(c => <button key={c} className={`df-col${color === c ? ' on' : ''}`} style={{ background: c }} onClick={() => setColor(c)} />)}
          </div>
        </>}
        <div className="df-modal-label">{en ? 'Pick a personality to start from' : 'まず性格を選ぶ（起点）'}</div>
        <div className="df-preset-row">
          {PERSONA_PRESETS.map(p => (
            <button key={p.name} type="button" className="df-preset" onClick={() => { setPersona(p.persona); if (!name.trim()) setName(p.name); }}>
              {p.emoji} {p.name}
            </button>
          ))}
        </div>
        <div className="df-modal-label">{en ? 'Personality / role / speaking style' : '性格・立ち位置・話し方'}</div>
        <textarea className="df-modal-persona" value={persona} onChange={e => setPersona(e.target.value)}
          placeholder={en ? 'e.g. A calm, reliable listener who keeps things short.' : '例: 落ち着いた頼れる聞き上手。短く的確に返す。'} rows={4} />
        <p className="df-modal-hint">{en ? 'This is the starting point. The character then learns from your 1-on-1 chats.' : 'これが起点。ここからキャラが個人チャットで学習して育つよ。'}</p>
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

function DiaryFriendsStyles() {
  return (
    <style jsx global>{`
      .df-root { display: flex; flex-direction: column; height: 100%; min-height: 0; background: var(--background); max-width: 720px; margin: 0 auto; width: 100%; }
      .df-header { display: flex; align-items: center; gap: 8px; padding: 12px 14px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
      .df-back { display: flex; width: 34px; height: 34px; align-items: center; justify-content: center; border-radius: 50%; border: none; background: var(--accent); color: var(--foreground); cursor: pointer; }
      .df-head-ic { color: #8b5cf6; }
      .df-title { font-size: 1rem; font-weight: 800; color: var(--foreground); flex: 1; }
      .df-headbtn { display: flex; width: 34px; height: 34px; align-items: center; justify-content: center; border-radius: 10px; border: 1px solid var(--border); background: var(--accent); color: var(--fg-muted); cursor: pointer; flex-shrink: 0; }
      .df-headbtn:hover { color: #8b5cf6; border-color: #8b5cf6; }
      .df-tab-lock { margin-left: 2px; opacity: 0.7; }
      .df-tabs { display: flex; gap: 6px; padding: 10px 14px; overflow-x: auto; flex-shrink: 0; scrollbar-width: none; }
      .df-tabs::-webkit-scrollbar { display: none; }
      .df-tab { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 999px; border: 1.5px solid var(--border); background: var(--accent); color: var(--fg-muted); font-size: 0.82rem; font-weight: 700; cursor: pointer; white-space: nowrap; flex-shrink: 0; }
      .df-tab.on { background: linear-gradient(120deg, #8b5cf6, #ec4899); color: #fff; border-color: transparent; }
      .df-tab-ava { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; border-radius: 50%; font-size: 0.72rem; }
      .df-tab-add { padding: 6px 10px; }
      .df-friendbar { display: flex; align-items: center; gap: 8px; padding: 6px 16px 10px; }
      .df-friendbar-persona { flex: 1; font-size: 0.74rem; color: var(--fg-muted); line-height: 1.4; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
      .df-friendbar-learn { flex-shrink: 0; font-size: 0.72rem; font-weight: 800; color: #10b981; }
      .df-friendbar-btn { flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; background: transparent; border: 1px solid var(--border); color: var(--fg-muted); cursor: pointer; border-radius: 8px; }
      .df-friendbar-btn:hover:not(:disabled) { color: #8b5cf6; border-color: #8b5cf6; }
      .df-friendbar-btn:disabled { opacity: 0.5; cursor: default; }
      .df-thread { flex: 1; min-height: 0; overflow-y: auto; padding: 12px 14px 6px; display: flex; flex-direction: column; gap: 12px; }
      .df-empty { margin: auto; text-align: center; color: var(--fg-muted); padding: 20px; }
      .df-empty-emoji { font-size: 2.6rem; }
      .df-empty p { margin: 8px 0 0; font-size: 0.9rem; font-weight: 700; color: var(--foreground); }
      .df-empty-sub { font-size: 0.78rem !important; font-weight: 400 !important; color: var(--fg-muted) !important; }
      .df-row { display: flex; gap: 8px; align-items: flex-end; max-width: 100%; }
      .df-row-me { justify-content: flex-end; }
      .df-ava { flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; width: 34px; height: 34px; border-radius: 50%; font-size: 1rem; box-shadow: 0 1px 3px rgba(0,0,0,.12); overflow: hidden; }
      .df-ava-img { width: 100%; height: 100%; object-fit: cover; border-radius: 50%; }
      .df-empty-avaimg { width: 74px; height: 74px; object-fit: contain; }
      .df-tab-ava { overflow: hidden; }
      .df-msg { display: flex; flex-direction: column; gap: 2px; max-width: 78%; }
      .df-name { font-size: 0.68rem; color: var(--fg-muted); margin-left: 4px; font-weight: 700; }
      .df-bubble { padding: 9px 13px; border-radius: 16px; font-size: 0.9rem; line-height: 1.5; white-space: pre-wrap; word-break: break-word; background: var(--accent); color: var(--foreground); border-top-left-radius: 5px; }
      .df-bubble-me { background: linear-gradient(120deg, #8b5cf6, #ec4899); color: #fff; border-top-left-radius: 16px; border-top-right-radius: 5px; max-width: 78%; }
      .df-typing { display: inline-flex; gap: 4px; align-items: center; }
      .df-typing span { width: 6px; height: 6px; border-radius: 50%; background: var(--fg-muted); opacity: 0.5; animation: df-blink 1.2s infinite; }
      .df-typing span:nth-child(2) { animation-delay: .2s; } .df-typing span:nth-child(3) { animation-delay: .4s; }
      @keyframes df-blink { 0%,60%,100% { opacity: .3; } 30% { opacity: 1; } }
      .df-bubble-ghost { opacity: 0.65; border: 1px dashed color-mix(in srgb, var(--fg-muted) 55%, transparent); }
      .df-ghost-ic { vertical-align: -1px; margin-right: 4px; opacity: 0.8; }
      .df-unsend { align-self: center; display: inline-flex; align-items: center; gap: 4px; background: rgba(15,23,42,.9); color: #fff; border: none; border-radius: 8px; padding: 6px 10px; font-size: 0.74rem; font-weight: 700; cursor: pointer; margin-right: 4px; }
      /* locked group */
      .df-locked { margin: auto; text-align: center; color: var(--fg-muted); padding: 20px; max-width: 420px; }
      .df-locked > svg { color: #8b5cf6; opacity: 0.8; }
      .df-locked-title { margin: 10px 0 4px; font-size: 0.95rem; font-weight: 800; color: var(--foreground); }
      .df-locked-sub { font-size: 0.8rem; line-height: 1.6; margin: 0 0 14px; }
      .df-progress-list { display: flex; flex-direction: column; gap: 8px; }
      .df-progress { display: flex; align-items: center; gap: 8px; font-size: 0.76rem; }
      .df-progress-name { flex-shrink: 0; min-width: 66px; text-align: left; font-weight: 700; color: var(--foreground); }
      .df-progress-bar { flex: 1; height: 6px; border-radius: 3px; background: var(--border); overflow: hidden; }
      .df-progress-bar i { display: block; height: 100%; background: linear-gradient(90deg, #8b5cf6, #ec4899); }
      .df-progress-num { flex-shrink: 0; color: var(--fg-muted); font-weight: 700; }
      .df-inputbar { display: flex; gap: 8px; align-items: flex-end; padding: 10px 14px; border-top: 1px solid var(--border); flex-shrink: 0; }
      .df-inputbar.ghost { background: color-mix(in srgb, #64748b 8%, var(--background)); }
      .df-ghost-btn { flex-shrink: 0; width: 42px; height: 42px; border-radius: 50%; border: 1.5px solid var(--border); background: var(--accent); color: var(--fg-muted); display: flex; align-items: center; justify-content: center; cursor: pointer; }
      .df-ghost-btn.on { background: #475569; border-color: #475569; color: #fff; }
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
      .df-preset-row { display: flex; flex-wrap: wrap; gap: 6px; }
      .df-preset { background: var(--accent); border: 1.5px solid var(--border); border-radius: 999px; padding: 6px 12px; font-size: 0.78rem; font-weight: 700; color: var(--foreground); cursor: pointer; }
      .df-preset:hover { border-color: #8b5cf6; color: #8b5cf6; }
      .df-modal-hint { font-size: 0.72rem; color: var(--fg-muted); margin: 6px 2px 0; line-height: 1.5; }
      /* chat settings */
      .df-set-row { display: flex; align-items: center; gap: 12px; padding: 10px 0; }
      .df-set-txt { flex: 1; display: flex; flex-direction: column; gap: 2px; }
      .df-set-title { font-size: 0.9rem; font-weight: 700; color: var(--foreground); }
      .df-set-sub { font-size: 0.74rem; color: var(--fg-muted); line-height: 1.4; }
      .df-toggle { flex-shrink: 0; width: 46px; height: 27px; border-radius: 999px; border: none; background: var(--border); cursor: pointer; position: relative; transition: background .15s; }
      .df-toggle.on { background: #10b981; }
      .df-toggle-knob { position: absolute; top: 3px; left: 3px; width: 21px; height: 21px; border-radius: 50%; background: #fff; transition: transform .15s; box-shadow: 0 1px 3px rgba(0,0,0,.25); }
      .df-toggle.on .df-toggle-knob { transform: translateX(19px); }
      .df-set-note { display: flex; gap: 8px; align-items: flex-start; font-size: 0.76rem; color: var(--fg-muted); line-height: 1.5; padding: 8px 0; border-top: 1px solid var(--border); }
      .df-set-note svg { flex-shrink: 0; margin-top: 2px; color: #8b5cf6; }
    `}</style>
  );
}
