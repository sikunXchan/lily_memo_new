'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, ChevronLeft, ChevronRight, Check, ListTodo, Heart, RefreshCw, CalendarDays, X, MessageCircle } from 'lucide-react';
import { db, newSyncId } from '@/lib/db';
import type { Diary, Todo } from '@/lib/db';
import { callGemini } from '@/lib/gemini';
import { useT } from '@/lib/i18n';
import { getAppLang, getUserName } from '@/lib/appLang';
import { useCharacterSkin, AmbientOverlay } from '@/components/CharacterSkinContext';
import DiaryFriends from '@/components/DiaryFriends';

const WEEKDAYS_JA = ['日', '月', '火', '水', '木', '金', '土'];
const WEEKDAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const MOODS = ['😄', '🙂', '😐', '😟', '😣'];
const MOOD_TINT: string[] = [
  'rgba(251,191,36,.35)',
  'rgba(163,230,53,.30)',
  'rgba(148,163,184,.20)',
  'rgba(107,114,128,.28)',
  'rgba(30,41,59,.38)',
];

function weekdayLabels(): string[] {
  return getAppLang() === 'en' ? WEEKDAYS_EN : WEEKDAYS_JA;
}
function isoOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function parseIso(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}
function fmtMonthTitle(d: Date): string {
  return getAppLang() === 'en'
    ? `${MONTHS_EN[d.getMonth()]} ${d.getFullYear()}`
    : `${d.getFullYear()}年 ${d.getMonth() + 1}月`;
}
function fmtDayLabel(iso: string): string {
  const d = parseIso(iso);
  return getAppLang() === 'en'
    ? `${WEEKDAYS_EN[d.getDay()]}, ${MONTHS_EN[d.getMonth()]} ${d.getDate()}`
    : `${d.getMonth() + 1}月${d.getDate()}日 (${WEEKDAYS_JA[d.getDay()]})`;
}
function addDays(iso: string, n: number): string {
  const d = parseIso(iso);
  d.setDate(d.getDate() + n);
  return isoOf(d);
}
function fmtClock(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// Story-tray "seen" state (has this past day's story been opened yet) — a
// plain localStorage set, mirroring AnnouncementModal's dismiss-tracking
// pattern. There's no server sync for this; it's a light UI nicety only.
const SEEN_KEY = 'diary-seen-days';
function loadSeenDays(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]')); } catch { return new Set(); }
}
function saveSeenDays(days: Set<string>): void {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify([...days])); } catch { /* unavailable */ }
}

function monthCells(viewDate: Date): { iso: string; inMonth: boolean }[] {
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const first = new Date(year, month, 1);
  const start = new Date(first);
  start.setDate(1 - first.getDay());
  const cells: { iso: string; inMonth: boolean }[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    cells.push({ iso: isoOf(d), inMonth: d.getMonth() === month });
  }
  return cells.slice(0, cells[35].inMonth || cells.slice(35).some(c => c.inMonth) ? 42 : 35);
}

// SNS-style comment prompt. The key design choice: Lily writes a FULL, heartfelt
// message (not a one-liner). A complete, warm message lands like a letter you
// received — it closes the loop, so it doesn't pull the user into a back-and-forth
// chat and the diary stays a diary. Lily never ends with a question.
function buildPostPrompt(lang: string, content: string, mood: string): string {
  const moodStr = mood || (lang === 'en' ? 'not set' : '未設定');
  const name = getUserName();
  const nameLine = name
    ? (lang === 'en'
        ? `\nThe friend's name is ${name} — address them by name naturally.`
        : `\nこの親友の名前は「${name}」です。自然に名前で呼びかけてください。`)
    : '';

  if (lang === 'en') {
    return `You are "Lily", the user's closest, kindest friend. The user just posted today's diary on a private social feed, and you're leaving a comment on their post.${nameLine}

How to write your comment:
- The user will NOT reply to you. Your comment should let them close out the day feeling good — so make it complete and heartfelt, not a quick one-liner.
- DO NOT end with a question. Don't invite a back-and-forth. Close with empathy, affirmation, and gentle encouragement instead.
- If the day was hard, truly acknowledge it first, then gently nudge them forward.
- Write 4–6 warm, thoughtful sentences. Friendly but with enough substance to feel like a real message from a friend.
- A few emojis are fine. Reply in English.

--- Today ---
Mood: ${moodStr}
Diary post:
${content}`;
  }

  return `あなたは「Lily」という、ユーザーの一番の親友のような存在です。ユーザーが今日の日記を、自分だけのSNSに投稿しました。あなたはその投稿に親友としてコメントを返します。${nameLine}

コメントの書き方：
・ユーザーは返信しません。あなたのコメントで気持ちよく一日を締めくくれるように、短い一言ではなく、しっかりと心のこもったメッセージを届けてください。
・質問で終えないでください。会話を続けさせない。問いかけではなく、共感・肯定・そっとした励ましで締めくくる。
・しんどい日は、まずちゃんと受け止めてから、そっと背中を押す。
・4〜6文くらいの、温かく丁寧なメッセージ。フレンドリーだけど、親友からの本物のメッセージらしい読みごたえのある長さで。
・絵文字は少し添えてOK。日本語で返してください。

--- 今日 ---
気分: ${moodStr}
日記の投稿:
${content}`;
}

interface DiaryScreenProps {
  onGoBack: () => void;
}

export default function DiaryScreen({ onGoBack }: DiaryScreenProps) {
  const t = useT();
  const { avatarSrc: lilyAvatarSrc, homeBackgroundSrc } = useCharacterSkin();
  const lang = getAppLang();
  const todayIso = isoOf(new Date());
  const [viewDate, setViewDate] = useState<Date>(() => new Date());
  const [selDay, setSelDay] = useState<string>(todayIso);
  const [draft, setDraft] = useState('');
  const [mood, setMood] = useState<string>('');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const [avatarOk, setAvatarOk] = useState(true);
  const [liked, setLiked] = useState(false);

  // Story view (default) vs. the classic month-calendar (for jumping to an
  // arbitrary past date). Both share all the state/persist logic above.
  const [viewMode, setViewMode] = useState<'story' | 'calendar'>('story');
  const [showFriends, setShowFriends] = useState(false);
  const [seenDays, setSeenDays] = useState<Set<string>>(() => loadSeenDays());
  const storyTouchX = useRef<number | null>(null);

  const diaries = useLiveQuery<Diary[]>(() =>
    db.diaries.filter(d => !d.deletedAt).toArray()
  );
  const ready = diaries !== undefined;

  const byDate = new Map<string, Diary>();
  for (const d of diaries ?? []) byDate.set(d.date, d);

  const current = byDate.get(selDay);
  const isToday = selDay === todayIso;
  const isPast = selDay < todayIso;

  const selDayDoneTodos = useLiveQuery(
    () => db.todos.filter(t => t.dueDate === selDay && t.done && !t.deletedAt).toArray(),
    [selDay],
  );

  const loadedDay = useRef<string | null>(null);
  useEffect(() => {
    if (!ready) return;
    if (loadedDay.current === selDay) return;
    loadedDay.current = selDay;
    setDraft(current?.content ?? '');
    setMood(current?.mood ?? '');
    setAiError('');
    setLiked(false);
  }, [ready, selDay, current]);

  const persist = useCallback(async (day: string, content: string, m: string) => {
    if (day !== todayIso) return; // only today is editable
    const existing = await db.diaries.where('date').equals(day).first();
    const now = Date.now();
    const empty = !content.trim() && !m;
    if (existing) {
      if (empty && !existing.aiComment) {
        await db.diaries.update(existing.id!, { deletedAt: now, updatedAt: now });
      } else {
        await db.diaries.update(existing.id!, { content, mood: m || undefined, deletedAt: undefined, updatedAt: now });
      }
    } else if (!empty) {
      await db.diaries.add({
        syncId: newSyncId(), date: day, content, mood: m || undefined,
        createdAt: now, updatedAt: now,
      });
    }
  }, [todayIso]);

  const scheduleSave = useCallback((content: string, m: string) => {
    if (!isToday) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const day = selDay;
    saveTimer.current = setTimeout(() => { void persist(day, content, m); }, 600);
  }, [selDay, isToday, persist]);

  const flushSave = useCallback(() => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
  }, []);
  useEffect(() => () => flushSave(), [flushSave]);

  const selectDay = (iso: string) => {
    if (iso > todayIso) return;
    if (iso === selDay) return;
    if (isToday) {
      flushSave();
      void persist(selDay, draft, mood);
    }
    setSelDay(iso);
  };

  const prevMonth = () => setViewDate(d => new Date(d.getFullYear(), d.getMonth() - 1, 1));
  const nextMonth = () => setViewDate(d => new Date(d.getFullYear(), d.getMonth() + 1, 1));
  const goToday = () => { setViewDate(new Date()); selectDay(todayIso); };

  const cells = monthCells(viewDate);
  const monthTouchX = useRef(0);

  // Last 7 days ending today, for the story tray. Always shown regardless of
  // whether an entry exists yet — matches a real IG-story day strip.
  const trayDays = useMemo(() => {
    const days: string[] = [];
    for (let i = 6; i >= 0; i--) days.push(addDays(todayIso, -i));
    return days;
  }, [todayIso]);

  const goPrevDay = () => selectDay(addDays(selDay, -1));
  const goNextDay = () => { if (selDay < todayIso) selectDay(addDays(selDay, 1)); };

  // A past day counts as "seen" once its story has been opened at least once.
  useEffect(() => {
    if (selDay === todayIso || seenDays.has(selDay)) return;
    setSeenDays(prev => {
      const next = new Set(prev).add(selDay);
      saveSeenDays(next);
      return next;
    });
  }, [selDay, todayIso, seenDays]);

  const handleStoryTouchStart = (e: React.PointerEvent) => { storyTouchX.current = e.clientX; };
  const handleStoryTouchEnd = (e: React.PointerEvent) => {
    if (storyTouchX.current === null) return;
    const dx = e.clientX - storyTouchX.current;
    storyTouchX.current = null;
    if (Math.abs(dx) < 40) return;
    if (dx < 0) goNextDay(); else goPrevDay();
  };

  const moodTint = (m?: string): string | undefined => {
    if (!m) return undefined;
    const idx = MOODS.indexOf(m);
    return idx >= 0 ? MOOD_TINT[idx] : undefined;
  };

  // Post the entry to Lily: she reads it and leaves a comment, stored on the
  // diary record (so it persists and syncs). No usage limit — re-post freely.
  const postToLily = async () => {
    const apiKey = localStorage.getItem('lily_gemini_api_key') || '';
    if (!apiKey) {
      setAiError(lang === 'en' ? 'Set your Gemini API key in Settings first.' : 'まず設定画面でGemini APIキーを設定してね。');
      return;
    }
    flushSave();
    await persist(selDay, draft, mood); // make sure today's entry exists
    setAiLoading(true);
    setAiError('');
    try {
      const prompt = buildPostPrompt(lang, draft, mood);
      const reply = (await callGemini(prompt, apiKey)).trim();
      const entry = await db.diaries.where('date').equals(selDay).first();
      const now = Date.now();
      if (entry) {
        await db.diaries.update(entry.id!, { aiComment: reply, aiAt: now, updatedAt: now });
      }
      setLiked(false);
    } catch {
      setAiError(lang === 'en' ? 'Lily could not reply right now.' : 'Lilyからのコメントを取得できなかった…');
    } finally {
      setAiLoading(false);
    }
  };

  const canPost = isToday && draft.trim().length > 0 && !aiLoading;
  const hasComment = !!current?.aiComment;

  const LilyAvatar = () => (
    avatarOk
      // eslint-disable-next-line @next/next/no-img-element
      ? <img src={lilyAvatarSrc('/lilygirls.PNG')} alt="Lily" className="dy-ava"
          style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover', objectPosition: 'top center', flexShrink: 0, border: '2px solid rgba(245,158,11,.35)' }}
          onError={() => setAvatarOk(false)} />
      : <span className="dy-ava dy-ava-fallback">🐕</span>
  );

  if (showFriends) {
    return <DiaryFriends onClose={() => setShowFriends(false)} />;
  }

  return (
    <div className="dy-root">
      <AmbientOverlay />
      {/* Header */}
      <div className="dy-header">
        <button
          className="dy-back"
          onClick={() => { flushSave(); void persist(selDay, draft, mood); onGoBack(); }}
          aria-label={t('戻る')}
        >
          <ArrowLeft size={17} strokeWidth={2.5} />
        </button>
        <div className="dy-header-mid">
          <span className="dy-title">{t('日記')}</span>
        </div>
        <button
          className="dy-view-toggle dy-friends-btn"
          onClick={() => setShowFriends(true)}
          aria-label={t('AIフレンド')}
          title={t('AIフレンド')}
        >
          <MessageCircle size={17} />
        </button>
        <button
          className={`dy-view-toggle${viewMode === 'calendar' ? ' on' : ''}`}
          onClick={() => setViewMode(v => v === 'story' ? 'calendar' : 'story')}
          aria-label={t('カレンダー')}
          title={t('カレンダー')}
        >
          <CalendarDays size={17} />
        </button>
      </div>

      <div className="dy-scroll">
        {viewMode === 'story' ? (
        <div className="dy-story-view">
          {/* Day tray */}
          <div className="dy-tray">
            {trayDays.map(iso => {
              const entry = byDate.get(iso);
              const isToday_ = iso === todayIso;
              const seen = seenDays.has(iso);
              const d = parseIso(iso);
              return (
                <button
                  key={iso}
                  className={`dy-tray-item${isToday_ ? ' today' : ''}${!isToday_ && seen ? ' seen' : ''}${iso === selDay ? ' active' : ''}`}
                  onClick={() => selectDay(iso)}
                >
                  <span className="dy-tray-ring">
                    <span className="dy-tray-in">{entry?.mood || (isToday_ ? '＋' : '')}</span>
                  </span>
                  <span className="dy-tray-label">{isToday_ ? t('今日') : WEEKDAYS_JA[d.getDay()]}</span>
                </button>
              );
            })}
          </div>

          {/* Story stage */}
          <div
            className={`dy-stage${homeBackgroundSrc ? ' has-photo' : ''}`}
            style={homeBackgroundSrc ? {
              backgroundImage: `url(${homeBackgroundSrc})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            } : undefined}
            onPointerDown={handleStoryTouchStart}
            onPointerUp={handleStoryTouchEnd}
            onPointerCancel={() => { storyTouchX.current = null; }}
          >
            {homeBackgroundSrc && <div className="dy-stage-topscrim" />}
            <div className="dy-stage-segbar">
              {trayDays.map(iso => (
                <span key={iso} className={`seg${iso <= selDay ? ' done' : ''}`} />
              ))}
            </div>
            <div className="dy-stage-topbar">
              <LilyAvatar />
              <span className="dy-stage-who">{fmtDayLabel(selDay)}</span>
              {current && <span className="dy-stage-when">・{fmtClock(current.updatedAt)}</span>}
              <button className="dy-stage-close" onClick={() => setViewMode('calendar')} aria-label={t('カレンダー')}>
                <X size={16} />
              </button>
            </div>

            {isToday ? (
              <div className="dy-stage-compose">
                <div className="dy-stage-mood-row">
                  {MOODS.map(m => (
                    <button
                      key={m}
                      className={`dy-stage-mood-btn${mood === m ? ' on' : ''}`}
                      onClick={() => { const next = mood === m ? '' : m; setMood(next); scheduleSave(draft, next); }}
                    >
                      {m}
                    </button>
                  ))}
                </div>
                <textarea
                  className="dy-stage-textarea"
                  value={draft}
                  placeholder={t('今日はどんな一日だった？')}
                  onChange={e => { setDraft(e.target.value); scheduleSave(e.target.value, mood); }}
                  onBlur={() => { flushSave(); void persist(selDay, draft, mood); }}
                />
              </div>
            ) : current ? (
              <>
                <div className="dy-stage-sticker">{current.mood || '📔'}</div>
                <div className="dy-stage-caption">
                  <span className="dy-stage-tag">✏️ {fmtDayLabel(selDay)}</span>
                  <p>{current.content}</p>
                </div>
              </>
            ) : (
              <div className="dy-stage-empty">
                <p>{lang === 'en' ? 'No entry for this day.' : 'この日の記録はありません。'}</p>
              </div>
            )}
          </div>

          {isToday && (
            <button
              className={`dy-post-btn${aiLoading ? ' loading' : ''}`}
              onClick={() => void postToLily()}
              disabled={!canPost}
            >
              {aiLoading
                ? (lang === 'en' ? 'Lily is reading…' : 'Lilyが読んでいる…')
                : hasComment
                  ? (<><RefreshCw size={14} strokeWidth={2.5} /> {lang === 'en' ? 'Ask Lily again' : 'もう一度Lilyに見せる'}</>)
                  : (lang === 'en' ? 'Show Lily' : 'Lilyに見せる')}
            </button>
          )}
          {aiError && <div className="dy-ai-error">{aiError}</div>}

          {current?.aiComment && (
            <div className="dy-reply-row">
              <LilyAvatar />
              <div className="dy-reply-bubble">
                <div className="dy-reply-lbl">{lang === 'en' ? "Lily's reply" : 'Lily からの返信'}</div>
                <p>{current.aiComment}</p>
              </div>
              {isToday && (
                <button
                  className={`dy-heart-btn${liked ? ' on' : ''}`}
                  onClick={() => setLiked(v => !v)}
                  aria-label={lang === 'en' ? 'Like' : 'いいね'}
                >
                  <Heart size={15} strokeWidth={2.5} fill={liked ? 'currentColor' : 'none'} />
                </button>
              )}
            </div>
          )}

          <div className="dy-swipe-hint">
            <ChevronLeft size={12} /> {lang === 'en' ? 'Swipe for the previous day' : 'スワイプで前の日の記録へ'}
          </div>
        </div>
        ) : (
        <>
        {/* Month nav */}
        <div className="dy-cal-head">
          <button className="dy-cal-nav" onClick={prevMonth} aria-label={t('前の月')}><ChevronLeft size={18} /></button>
          <button className="dy-cal-title" onClick={goToday}>{fmtMonthTitle(viewDate)}</button>
          <button className="dy-cal-nav" onClick={nextMonth} aria-label={t('次の月')}><ChevronRight size={18} /></button>
        </div>

        {/* Weekday header */}
        <div className="dy-wdrow">
          {weekdayLabels().map((w, i) => (
            <span key={w} className={`dy-wd${i === 0 ? ' sun' : ''}${i === 6 ? ' sat' : ''}`}>{w}</span>
          ))}
        </div>

        {/* Month grid */}
        <div
          className="dy-grid"
        >
          {cells.map(({ iso, inMonth }) => {
            const entry = byDate.get(iso);
            const d = parseIso(iso);
            const isFuture = iso > todayIso;
            const tint = (inMonth && !isFuture) ? moodTint(entry?.mood) : undefined;
            return (
              <button
                key={iso}
                className={`dy-cell${inMonth ? '' : ' off'}${isFuture ? ' future' : ''}${iso === selDay ? ' sel' : ''}${iso === todayIso ? ' today' : ''}`}
                style={tint ? { background: tint } : undefined}
                onClick={() => selectDay(iso)}
                disabled={isFuture}
              >
                <span className="dy-cell-num">{d.getDate()}</span>
                {(entry && !isFuture)
                  ? <span className="dy-cell-mark">{entry.mood || '●'}</span>
                  : <span className="dy-cell-mark ph" />}
              </button>
            );
          })}
        </div>

        {/* Selected-day editor */}
        <div className="dy-editor">
          <div className="dy-day-label">
            {fmtDayLabel(selDay)}
            {isToday ? ` ・${t('今日')}` : isPast ? (
              <span className="dy-readonly-badge">{lang === 'en' ? 'Read only' : '閲覧のみ'}</span>
            ) : null}
          </div>

          {/* Done todos summary pill */}
          {(selDayDoneTodos?.length ?? 0) > 0 && (
            <div className="dy-stats">
              <div className="dy-stat">
                <ListTodo size={12} strokeWidth={2.5} />
                <span>
                  {lang === 'en'
                    ? `${selDayDoneTodos!.length} task${selDayDoneTodos!.length > 1 ? 's' : ''} done`
                    : `${selDayDoneTodos!.length}件完了`}
                </span>
              </div>
            </div>
          )}

          {/* Completed todo list (up to 5) */}
          {(selDayDoneTodos?.length ?? 0) > 0 && (
            <div className="dy-todo-list">
              {selDayDoneTodos!.slice(0, 5).map(td => (
                <div key={td.id} className="dy-todo-item">
                  <Check size={10} strokeWidth={3.5} className="dy-todo-check" />
                  <span className="dy-todo-text">{td.text}</span>
                </div>
              ))}
              {selDayDoneTodos!.length > 5 && (
                <div className="dy-todo-more">
                  {lang === 'en' ? `+${selDayDoneTodos!.length - 5} more` : `他${selDayDoneTodos!.length - 5}件`}
                </div>
              )}
            </div>
          )}

          {/* Mood picker (today only) */}
          {isToday && (
            <div className="dy-moods">
              {MOODS.map(m => (
                <button
                  key={m}
                  className={`dy-mood${mood === m ? ' on' : ''}`}
                  onClick={() => { const next = mood === m ? '' : m; setMood(next); scheduleSave(draft, next); }}
                >
                  {m}
                </button>
              ))}
              {current && (
                <span className="dy-saved"><Check size={12} strokeWidth={3} /> {t('保存済み')}</span>
              )}
            </div>
          )}

          {/* Past: show mood read-only */}
          {isPast && current?.mood && (
            <div className="dy-moods-ro">
              <span className="dy-mood-ro-emoji">{current.mood}</span>
            </div>
          )}

          {/* The "post" — editable today, read-only past */}
          {isToday ? (
            <textarea
              className="dy-textarea"
              value={draft}
              placeholder={t('今日はどんな一日だった？')}
              onChange={e => { setDraft(e.target.value); scheduleSave(e.target.value, mood); }}
              onBlur={() => { flushSave(); void persist(selDay, draft, mood); }}
            />
          ) : (
            <div className="dy-textarea-ro">
              {current?.content
                ? <p>{current.content}</p>
                : <span className="dy-textarea-ro-empty">{lang === 'en' ? 'No entry for this day.' : 'この日の記録はありません。'}</span>}
            </div>
          )}

          {/* Post button (today only) */}
          {isToday && (
            <button
              className={`dy-post-btn${aiLoading ? ' loading' : ''}`}
              onClick={() => void postToLily()}
              disabled={!canPost}
            >
              {aiLoading
                ? (lang === 'en' ? 'Lily is reading…' : 'Lilyが読んでいる…')
                : hasComment
                  ? (<><RefreshCw size={14} strokeWidth={2.5} /> {lang === 'en' ? 'Ask Lily again' : 'もう一度Lilyに見せる'}</>)
                  : (lang === 'en' ? 'Show Lily' : 'Lilyに見せる')}
            </button>
          )}

          {aiError && <div className="dy-ai-error">{aiError}</div>}

          {/* Lily's comment (persisted on the entry; shows on past days too) */}
          {current?.aiComment && (
            <div className="dy-comment">
              <LilyAvatar />
              <div className="dy-comment-body">
                <div className="dy-comment-head">
                  <span className="dy-comment-name">Lily</span>
                  <span className="dy-comment-handle">@lily</span>
                </div>
                <p className="dy-comment-text">{current.aiComment}</p>
                {isToday && (
                  <button
                    className={`dy-like${liked ? ' on' : ''}`}
                    onClick={() => setLiked(v => !v)}
                    aria-label={lang === 'en' ? 'Like' : 'いいね'}
                  >
                    <Heart size={14} strokeWidth={2.5} fill={liked ? 'currentColor' : 'none'} />
                    <span>{lang === 'en' ? 'Thanks' : 'ありがとう'}</span>
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
        </>
        )}
      </div>

      <style jsx>{`
        .dy-root {
          flex: 1; display: flex; flex-direction: column;
          background: var(--background); overflow: hidden;
          position: relative;
        }
        /* iPad / PC: center and cap the width so the mobile-first story view
           doesn't stretch across a wide screen. */
        @media (min-width: 1025px) {
          .dy-header { max-width: 600px; margin: 0 auto; width: 100%; box-sizing: border-box; }
          .dy-scroll > * { max-width: 600px; margin-left: auto; margin-right: auto; width: 100%; box-sizing: border-box; }
          .dy-stage { max-height: 70vh; }
        }
        .dy-header {
          display: flex; align-items: center; gap: 10px;
          padding: 12px 14px 10px;
          background: var(--glass-tint, rgba(255,255,255,.88));
          backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
          flex-shrink: 0;
        }
        .dy-back {
          width: 34px; height: 34px; border-radius: 10px; flex-shrink: 0;
          border: 1px solid var(--border); background: var(--accent);
          display: flex; align-items: center; justify-content: center;
          cursor: pointer; color: var(--foreground);
        }
        .dy-back:active { opacity: .55; }
        .dy-header-mid { flex: 1; display: flex; flex-direction: column; gap: 1px; min-width: 0; }
        .dy-title {
          font-size: 18px; font-weight: 800; letter-spacing: -.025em; line-height: 1.15;
          background: linear-gradient(120deg, #f59e0b, #fb7185);
          -webkit-background-clip: text; background-clip: text; color: transparent;
        }

        .dy-scroll {
          flex: 1; overflow-y: auto; -webkit-overflow-scrolling: touch;
          display: flex; flex-direction: column;
        }

        /* ── Calendar ── */
        .dy-cal-head {
          display: flex; align-items: center; justify-content: space-between;
          padding: 10px 14px 6px; flex-shrink: 0;
        }
        .dy-cal-title {
          font-size: 1rem; font-weight: 800; color: var(--foreground);
          background: none; border: none; cursor: pointer; font-family: inherit;
          padding: 4px 10px; border-radius: 9px;
        }
        .dy-cal-title:active { background: var(--accent); }
        .dy-cal-nav {
          width: 34px; height: 34px; border-radius: 10px;
          border: 1px solid var(--border); background: var(--accent);
          display: flex; align-items: center; justify-content: center;
          cursor: pointer; color: var(--foreground);
        }
        .dy-cal-nav:active { opacity: .55; }
        .dy-wdrow {
          display: grid; grid-template-columns: repeat(7, 1fr);
          padding: 0 14px 4px; flex-shrink: 0;
        }
        .dy-wd {
          text-align: center; font-size: .62rem; font-weight: 800;
          color: var(--fg-muted); letter-spacing: .04em;
        }
        .dy-wd.sun { color: #f87171; }
        .dy-wd.sat { color: #60a5fa; }
        .dy-grid {
          display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px;
          padding: 0 14px; flex-shrink: 0; touch-action: pan-y;
        }
        .dy-cell {
          position: relative; aspect-ratio: 1; min-height: 0;
          display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
          border: 1.5px solid transparent; border-radius: 12px;
          background: var(--accent); cursor: pointer; font-family: inherit;
          transition: background .12s, border-color .12s;
        }
        .dy-cell.off { background: transparent; opacity: .32; }
        .dy-cell.future { opacity: .25; cursor: default; }
        .dy-cell.today { background: rgba(245,158,11,.14); }
        .dy-cell.sel {
          border-color: #f59e0b;
          background: linear-gradient(135deg, rgba(245,158,11,.18), rgba(251,113,133,.18));
          box-shadow: 0 0 0 2px rgba(245,158,11,.2);
        }
        .dy-cell-num { font-size: .9rem; font-weight: 700; color: var(--foreground); line-height: 1; }
        .dy-cell.off .dy-cell-num, .dy-cell.future .dy-cell-num { color: var(--fg-faint); }
        .dy-cell-mark {
          font-size: .72rem; line-height: 1; height: .8rem;
          display: flex; align-items: center; justify-content: center; color: #f59e0b;
        }
        .dy-cell-mark.ph { color: transparent; }

        /* ── Editor ── */
        .dy-editor {
          flex: 1; display: flex; flex-direction: column;
          padding: 14px 14px 96px;
        }
        .dy-day-label {
          font-size: .82rem; font-weight: 800; color: var(--foreground);
          padding: 0 2px 8px; flex-shrink: 0;
          display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
        }
        .dy-readonly-badge {
          font-size: .65rem; font-weight: 700; color: var(--fg-muted);
          background: var(--accent); border: 1px solid var(--border);
          border-radius: 6px; padding: 2px 7px;
        }
        .dy-stats {
          display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 8px; flex-shrink: 0;
        }
        .dy-stat {
          display: inline-flex; align-items: center; gap: 5px;
          font-size: .73rem; font-weight: 700; color: var(--fg-muted);
          background: var(--accent); border: 1px solid var(--border);
          border-radius: 20px; padding: 4px 10px;
        }
        .dy-todo-list {
          background: var(--accent); border: 1px solid var(--border);
          border-radius: 12px; padding: 8px 12px;
          margin-bottom: 10px; flex-shrink: 0;
          display: flex; flex-direction: column; gap: 5px;
        }
        .dy-todo-item { display: flex; align-items: center; gap: 7px; }
        .dy-todo-check { color: #16a34a; flex-shrink: 0; }
        .dy-todo-text {
          font-size: .78rem; color: var(--foreground);
          text-decoration: line-through; opacity: .6;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .dy-todo-more { font-size: .7rem; color: var(--fg-muted); text-align: right; padding-top: 2px; }
        .dy-moods {
          display: flex; align-items: center; gap: 6px; padding: 0 0 10px; flex-shrink: 0;
        }
        .dy-mood {
          width: 38px; height: 38px; border-radius: 11px; font-size: 1.2rem;
          border: 1.5px solid var(--border); background: var(--accent);
          cursor: pointer; display: flex; align-items: center; justify-content: center;
          transition: transform .1s, border-color .12s, background .12s; line-height: 1;
          filter: grayscale(.5); opacity: .7;
        }
        .dy-mood:active { transform: scale(.86); }
        .dy-mood.on {
          border-color: #f59e0b; background: rgba(245,158,11,.14);
          filter: none; opacity: 1;
        }
        .dy-saved {
          margin-left: auto; display: inline-flex; align-items: center; gap: 3px;
          font-size: .68rem; font-weight: 700; color: #16a34a;
        }
        .dy-moods-ro { padding: 0 0 10px; flex-shrink: 0; }
        .dy-mood-ro-emoji { font-size: 1.5rem; }
        .dy-textarea {
          min-height: 150px; width: 100%; resize: none;
          background: var(--accent); border: 1.5px solid var(--border);
          border-radius: 14px; padding: 14px 16px;
          font-size: .92rem; line-height: 1.7; color: var(--foreground);
          font-family: inherit; outline: none; transition: border-color .15s;
        }
        .dy-textarea::placeholder { color: var(--fg-faint); }
        .dy-textarea:focus { border-color: #f59e0b; }
        .dy-textarea-ro {
          min-height: 100px;
          background: var(--accent); border: 1.5px solid var(--border);
          border-radius: 14px; padding: 14px 16px;
          font-size: .92rem; line-height: 1.7; color: var(--foreground);
        }
        .dy-textarea-ro p { margin: 0; white-space: pre-wrap; }
        .dy-textarea-ro-empty { color: var(--fg-faint); font-style: italic; }

        /* ── Post button ── */
        .dy-post-btn {
          display: flex; align-items: center; justify-content: center; gap: 6px;
          margin-top: 10px; padding: 12px 18px; border-radius: 14px; flex-shrink: 0;
          border: none; width: 100%;
          background: linear-gradient(135deg, #f59e0b, #fb7185);
          color: #fff; font-size: .88rem; font-weight: 800; cursor: pointer;
          font-family: inherit; transition: opacity .15s, transform .1s;
          box-shadow: 0 4px 14px rgba(245,158,11,.3);
        }
        .dy-post-btn:active { transform: scale(.97); }
        .dy-post-btn:disabled {
          background: var(--accent); color: var(--fg-faint);
          box-shadow: none; cursor: default;
        }
        .dy-post-btn.loading { opacity: .85; cursor: default; }
        .dy-ai-error {
          margin-top: 10px; font-size: .78rem; color: #ef4444;
          text-align: center; font-weight: 600;
        }

        /* ── Lily's SNS comment ── */
        .dy-comment {
          margin-top: 14px; display: flex; gap: 10px; align-items: flex-start;
          flex-shrink: 0; animation: dy-pop .3s ease;
        }
        @keyframes dy-pop {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .dy-ava {
          width: 40px; height: 40px; border-radius: 50%; flex-shrink: 0;
          object-fit: cover; border: 2px solid rgba(245,158,11,.35);
          background: var(--accent);
          display: flex; align-items: center; justify-content: center;
        }
        .dy-ava-fallback { font-size: 1.3rem; }
        .dy-comment-body {
          flex: 1; min-width: 0;
          background: var(--accent); border: 1px solid var(--border);
          border-radius: 4px 16px 16px 16px; padding: 11px 14px;
        }
        .dy-comment-head { display: flex; align-items: baseline; gap: 6px; margin-bottom: 4px; }
        .dy-comment-name { font-size: .82rem; font-weight: 800; color: var(--foreground); }
        .dy-comment-handle { font-size: .7rem; color: var(--fg-faint); }
        .dy-comment-text {
          margin: 0; font-size: .88rem; line-height: 1.75; color: var(--foreground);
          white-space: pre-wrap;
        }
        .dy-like {
          margin-top: 9px; display: inline-flex; align-items: center; gap: 5px;
          padding: 5px 12px; border-radius: 20px; cursor: pointer;
          border: 1px solid var(--border); background: var(--background);
          color: var(--fg-muted); font-size: .74rem; font-weight: 700;
          font-family: inherit; transition: color .15s, border-color .15s, transform .1s;
        }
        .dy-like:active { transform: scale(.92); }
        .dy-like.on { color: #fb7185; border-color: rgba(251,113,133,.5); background: rgba(251,113,133,.08); }

        /* ── Header view toggle ── */
        .dy-view-toggle {
          width: 34px; height: 34px; border-radius: 10px; flex-shrink: 0;
          border: 1px solid var(--border); background: var(--accent);
          display: flex; align-items: center; justify-content: center;
          cursor: pointer; color: var(--fg-muted);
        }
        .dy-view-toggle.on { color: #fb7185; border-color: rgba(251,113,133,.5); background: rgba(251,113,133,.1); }
        .dy-view-toggle:active { opacity: .6; }

        /* ── Story view ── */
        .dy-story-view {
          display: flex; flex-direction: column; gap: 16px;
          padding: 14px 14px calc(24px + env(safe-area-inset-bottom));
        }
        .dy-tray { display: flex; gap: 12px; overflow-x: auto; padding: 2px 2px 4px; -webkit-overflow-scrolling: touch; }
        .dy-tray-item {
          display: flex; flex-direction: column; align-items: center; gap: 5px; flex-shrink: 0;
          background: none; border: none; cursor: pointer; font-family: inherit; padding: 0;
        }
        .dy-tray-ring {
          width: 46px; height: 46px; border-radius: 50%; padding: 2.5px;
          background: linear-gradient(135deg, #f59e0b, #fb7185);
          display: flex; align-items: center; justify-content: center;
        }
        .dy-tray-item.seen .dy-tray-ring { background: var(--border); }
        .dy-tray-item.active .dy-tray-ring { box-shadow: 0 0 0 2px var(--background), 0 0 0 3.5px #fb7185; }
        .dy-tray-in {
          width: 100%; height: 100%; border-radius: 50%; background: var(--background);
          display: flex; align-items: center; justify-content: center; font-size: 17px; color: var(--fg-muted);
        }
        .dy-tray-label { font-size: .6rem; font-weight: 700; color: var(--fg-muted); }
        .dy-tray-item.today .dy-tray-label { color: #fb7185; }

        .dy-stage {
          position: relative; border-radius: 22px; overflow: hidden;
          aspect-ratio: 9/13.5; max-height: 62vh;
          background: linear-gradient(165deg, #fb923c, #fb7185 55%, #9d174d);
          box-shadow: 0 16px 40px -14px rgba(140,40,60,.45);
          touch-action: pan-y;
        }
        .dy-stage-topscrim {
          position: absolute; top: 0; left: 0; right: 0; height: 110px; z-index: 1;
          background: linear-gradient(180deg, rgba(0,0,0,.4), transparent);
          pointer-events: none;
        }
        .dy-stage-segbar { position: absolute; top: 10px; left: 10px; right: 10px; display: flex; gap: 4px; z-index: 3; }
        .dy-stage-segbar .seg { flex: 1; height: 3px; border-radius: 2px; background: rgba(255,255,255,.35); overflow: hidden; }
        .dy-stage-segbar .seg.done { background: #fff; }
        .dy-stage-topbar {
          position: absolute; top: 20px; left: 14px; right: 14px; z-index: 3;
          display: flex; align-items: center; gap: 8px;
        }
        .dy-stage-topbar :global(.dy-ava) { width: 26px !important; height: 26px !important; border: 1.5px solid rgba(255,255,255,.8) !important; }
        .dy-stage-who { font-size: 11.5px; font-weight: 800; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .dy-stage-when { font-size: 10px; color: rgba(255,255,255,.75); flex-shrink: 0; }
        .dy-stage-close {
          margin-left: auto; flex-shrink: 0; width: 26px; height: 26px; border-radius: 50%;
          border: none; background: rgba(0,0,0,.18); color: rgba(255,255,255,.9);
          display: flex; align-items: center; justify-content: center; cursor: pointer;
        }
        .dy-stage-sticker {
          position: absolute; top: 38%; left: 50%; transform: translate(-50%,-50%) rotate(-6deg);
          width: 74px; height: 74px; border-radius: 50%; background: #fff;
          display: flex; align-items: center; justify-content: center; font-size: 34px;
          box-shadow: 0 10px 22px rgba(60,20,30,.3); z-index: 2;
        }
        /* Caption is a distinct card floated over the stage, not blended
           into the background image — its own opaque/frosted surface so
           the photo behind it stays readable as a photo. */
        .dy-stage-caption {
          position: absolute; left: 14px; right: 14px; bottom: 14px; z-index: 3;
          max-height: 46%; overflow-y: auto;
          background: rgba(24,12,18,.7); backdrop-filter: blur(14px);
          border: 1px solid rgba(255,255,255,.14);
          border-radius: 16px; padding: 13px 16px;
          box-shadow: 0 10px 30px -8px rgba(0,0,0,.5);
        }
        .dy-stage-tag {
          display: inline-flex; font-size: 10px; font-weight: 800; color: #ffe1e6;
          background: rgba(255,255,255,.18); padding: 4px 10px; border-radius: 999px;
          margin-bottom: 9px;
        }
        .dy-stage-caption p {
          font-family: 'Georgia', 'Noto Serif JP', serif; font-style: italic;
          font-size: 16px; line-height: 1.55; color: #fff; margin: 0;
          white-space: pre-wrap;
        }
        .dy-stage-empty {
          position: absolute; inset: 0; z-index: 2;
          display: flex; align-items: center; justify-content: center; padding: 24px;
        }
        .dy-stage-empty p { color: rgba(255,255,255,.85); font-size: .85rem; text-align: center; }

        /* Today: compose mode inside the stage */
        .dy-stage-compose {
          position: absolute; inset: 0; z-index: 2;
          display: flex; flex-direction: column; justify-content: flex-end; gap: 12px;
          padding: 60px 16px 16px;
        }
        .dy-stage-mood-row { display: flex; gap: 6px; justify-content: center; }
        .dy-stage-mood-btn {
          width: 36px; height: 36px; border-radius: 11px; font-size: 1.1rem;
          border: 1.5px solid rgba(255,255,255,.35); background: rgba(255,255,255,.14);
          cursor: pointer; display: flex; align-items: center; justify-content: center;
          filter: grayscale(.5); opacity: .75; transition: transform .1s, opacity .12s, filter .12s;
        }
        .dy-stage-mood-btn:active { transform: scale(.88); }
        .dy-stage-mood-btn.on { background: #fff; filter: none; opacity: 1; }
        .dy-stage-textarea {
          width: 100%; min-height: 96px; resize: none;
          background: rgba(0,0,0,.4); backdrop-filter: blur(10px);
          border: 1px solid rgba(255,255,255,.3); border-radius: 14px;
          padding: 12px 14px; color: #fff; font-family: 'Georgia', 'Noto Serif JP', serif; font-style: italic;
          font-size: .95rem; line-height: 1.6; outline: none;
        }
        .dy-stage-textarea::placeholder { color: rgba(255,255,255,.65); }

        /* ── Reply row ── */
        .dy-reply-row { display: flex; align-items: center; gap: 10px; }
        .dy-reply-row :global(.dy-ava) { width: 32px !important; height: 32px !important; }
        .dy-reply-bubble {
          flex: 1; min-width: 0; background: var(--accent); border: 1px solid var(--border);
          border-radius: 4px 16px 16px 16px; padding: 11px 14px;
        }
        .dy-reply-lbl { font-size: 10px; font-weight: 800; color: #fb7185; margin-bottom: 3px; }
        .dy-reply-bubble p { font-size: .82rem; line-height: 1.6; color: var(--foreground); margin: 0; white-space: pre-wrap; }
        .dy-heart-btn {
          width: 38px; height: 38px; border-radius: 50%; flex-shrink: 0;
          border: 1px solid var(--border); background: var(--background);
          display: flex; align-items: center; justify-content: center; cursor: pointer; color: var(--fg-muted);
        }
        .dy-heart-btn.on { color: #fb7185; border-color: rgba(251,113,133,.5); background: rgba(251,113,133,.08); }
        .dy-heart-btn:active { transform: scale(.92); }

        .dy-swipe-hint {
          display: flex; align-items: center; justify-content: center; gap: 3px;
          font-size: .7rem; color: var(--fg-faint); text-align: center;
        }
      `}</style>
    </div>
  );
}
