'use client';

// sikun's full-size panels: the unified note quiz and the adjustable timer.
// They open from sikun's long-press menu (see InstanceSikun).

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { X, Check, Sparkles, RotateCcw, Play, Pause, Square, Plus, Minus, BookmarkPlus } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { renderRich } from '@/lib/richText';
import { noteHtmlToText } from '@/lib/noteText';
import { streamSikunlilyChat } from '@/lib/gemini';
import { getEffectiveApiKey } from '@/lib/appLang';
import {
  extractQuizItems, shuffle, readNoteHtml, setQuizChecked, appendQuizPair, parseQA,
  type QuizPair,
} from '@/lib/noteQuiz';
import s from './SikunSheet.module.css';

function lsGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function lsSet(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* ignore */ }
}

export function SikunSheet({ title, subtitle, onClose, children }: {
  title: string; subtitle?: string; onClose: () => void; children: ReactNode;
}) {
  const t = useT();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className={s.backdrop} onPointerDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={s.sheet} role="dialog" aria-modal="true" aria-label={title}>
        <div className={s.head}>
          <span className={s.avatar} aria-hidden />
          <div className={s.headText}>
            <h2>{title}</h2>
            {subtitle && <small>{subtitle}</small>}
          </div>
          <button className={s.iconBtn} onClick={onClose} aria-label={t('閉じる')}><X size={18} /></button>
        </div>
        <div className={s.body}>{children}</div>
      </div>
    </div>
  );
}

// ───────────────────────── Quiz ─────────────────────────

interface Card extends QuizPair {
  /** set when the question lives in the note (so it can be ticked) */
  block?: number;
  index?: number;
  ai?: boolean;
}

const EXCLUDE_KEY = 'lily_sikun_quiz_exclude_checked';

export function QuizSheet({ noteId, en, onClose }: { noteId: number; en: boolean; onClose: () => void }) {
  const t = useT();
  const [title, setTitle] = useState('');
  const [all, setAll] = useState<Card[] | null>(null); // every question in the note
  const [deck, setDeck] = useState<Card[]>([]);
  const [pos, setPos] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [exclude, setExclude] = useState(() => lsGet(EXCLUDE_KEY) !== '0');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const alive = useRef(true);
  const askedAi = useRef<string[]>([]);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const rebuild = useCallback(async (excl: boolean) => {
    const { html, title } = await readNoteHtml(noteId);
    if (!alive.current) return;
    const items: Card[] = extractQuizItems(html);
    setTitle(title);
    setAll(items);
    setDeck(shuffle(excl ? items.filter(c => !c.checked) : items));
    setPos(0);
    setRevealed(false);
    setError('');
  }, [noteId]);

  useEffect(() => { void rebuild(exclude); }, [rebuild]); // eslint-disable-line react-hooks/exhaustive-deps

  const card = deck[pos] as Card | undefined;
  const checkedTotal = all?.filter(c => c.checked).length ?? 0;

  const patchCard = (at: number, patch: Partial<Card>) => {
    setDeck(d => d.map((c, i) => (i === at ? { ...c, ...patch } : c)));
  };

  const toggleCheck = async () => {
    if (!card || card.block === undefined || card.index === undefined) return;
    const next = !card.checked;
    const at = pos;
    patchCard(at, { checked: next });
    const ok = await setQuizChecked(noteId, { ...card, block: card.block, index: card.index }, next);
    if (!alive.current) return;
    if (!ok) {
      patchCard(at, { checked: !next });
      setError(t('メモの問題が変更されたため、チェックできませんでした。もう一度読み込みます。'));
      void rebuild(exclude);
      return;
    }
    setAll(list => list?.map(c => (c.block === card.block && c.index === card.index ? { ...c, checked: next } : c)) ?? list);
  };

  const saveAiCard = async () => {
    if (!card || !card.ai || card.block !== undefined) return;
    const at = pos;
    const saved = await appendQuizPair(noteId, { q: card.q, a: card.a });
    if (!alive.current) return;
    if (!saved) { setError(t('メモに保存できませんでした。')); return; }
    patchCard(at, { block: saved.block, index: saved.index });
    setAll(list => [...(list ?? []), { ...saved }]);
  };

  const next = () => { setPos(p => p + 1); setRevealed(false); setError(''); };
  const prev = () => { setPos(p => Math.max(0, p - 1)); setRevealed(false); setError(''); };

  const generate = async () => {
    const apiKey = getEffectiveApiKey();
    if (!apiKey) { setError(t('設定で Gemini API キーを保存してください。')); return; }
    setBusy(true);
    setError('');
    try {
      const { html, title } = await readNoteHtml(noteId);
      const body = noteHtmlToText(html, exclude);
      if (!body.trim()) throw new Error(t('出題できる本文がありません。'));
      const avoid = [...(all ?? []).map(c => c.q), ...askedAi.current].slice(-40);
      const system = en
        ? 'You are sikun, a study buddy. Write exactly ONE review question about the note below, testing an important point. Do not repeat or paraphrase any question listed under "Already asked". Output only two lines in English:\nQ: <question>\nA: <short answer>'
        : 'あなたは学習相棒の sikun。下のメモ本文から、重要なポイントを確かめる復習問題を「1問だけ」作る。「出題済み」にある問題と同じ・言い換えの問題は禁止。出力は次の2行だけ:\nQ: 問題\nA: 簡潔な答え';
      const user = en
        ? `# Note: ${title || 'Untitled'}\n${body.slice(0, 12000)}${avoid.length ? `\n\n# Already asked\n${avoid.map(q => `- ${q}`).join('\n')}` : ''}`
        : `# メモ: ${title || '無題'}\n${body.slice(0, 12000)}${avoid.length ? `\n\n# 出題済み\n${avoid.map(q => `- ${q}`).join('\n')}` : ''}`;
      const reply = await streamSikunlilyChat([{ role: 'user', text: user }], system, apiKey, 0, {}, ['gemini-3.1-flash-lite'], false, 1024, 0.9);
      if (!alive.current) return;
      const pair = parseQA(reply);
      if (!pair) throw new Error(t('問題を作れませんでした。もう一度試してね。'));
      askedAi.current.push(pair.q);
      const at = Math.min(pos + (card ? 1 : 0), deck.length);
      setDeck(d => [...d.slice(0, at), { ...pair, ai: true }, ...d.slice(at)]);
      setPos(at);
      setRevealed(false);
    } catch (err) {
      if (alive.current) setError(err instanceof Error ? err.message : t('問題を作れませんでした。もう一度試してね。'));
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  // Keyboard: Space/Enter = reveal → next, C = tick, ←/→ = move
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return;
      if (!card) return;
      const onControl = e.target instanceof HTMLButtonElement || e.target instanceof HTMLTextAreaElement;
      if ((e.key === ' ' || e.key === 'Enter') && !onControl) { e.preventDefault(); if (revealed) next(); else setRevealed(true); }
      else if (e.key === 'c' || e.key === 'C') { e.preventDefault(); void toggleCheck(); }
      else if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') prev();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const deckChecked = useMemo(() => deck.filter(c => c.checked).length, [deck]);

  return (
    <SikunSheet title={t('問題')} subtitle={title || t('無題')} onClose={onClose}>
      <label className={s.switchRow}>
        <span>{t('チェック済みを除外')}{all && all.length > 0 && <span className={s.muted} style={{ display: 'inline', marginLeft: 6 }}>{t('{done}/{total} チェック済み', { done: checkedTotal, total: all.length })}</span>}</span>
        <input
          type="checkbox" className={s.switch} checked={exclude} disabled={busy}
          onChange={e => { const v = e.target.checked; setExclude(v); lsSet(EXCLUDE_KEY, v ? '1' : '0'); void rebuild(v); }}
        />
      </label>

      {all === null ? (
        <p className={s.muted}>{t('読み込み中…')}</p>
      ) : card ? (
        <>
          <div className={s.progress}>
            <span>{pos + 1} / {deck.length}</span>
            <div className={s.bar}><span style={{ width: `${((pos + 1) / deck.length) * 100}%` }} /></div>
          </div>

          <section className={`${s.card} ${card.checked ? s.cardChecked : ''}`} key={`${pos}-${card.q}`} aria-live="polite">
            <span className={`${s.tag} ${card.ai ? s.tagAi : ''}`}>
              {card.ai ? t('AI・本文から') : t('メモの問題')}
            </span>
            <div className={s.question} dangerouslySetInnerHTML={{ __html: renderRich(card.q) }} />
            {Array.isArray(card.opts) && card.opts.length > 0 && (
              <ol type="A" className={s.opts}>{card.opts.map((o, i) => <li key={i} dangerouslySetInnerHTML={{ __html: renderRich(o).replace(/^\s*<p>([\s\S]*?)<\/p>\s*$/, '$1') }} />)}</ol>
            )}
            {revealed ? (
              <div className={s.answer}>
                <span className={s.answerLabel}>{t('答え')}</span>
                <div dangerouslySetInnerHTML={{ __html: renderRich(card.a || t('答えは未入力です')) }} />
              </div>
            ) : (
              <button className={`${s.btn} ${s.primary}`} onClick={() => setRevealed(true)}>{t('答えを見る')}</button>
            )}

            {card.block !== undefined ? (
              <button className={s.checkBtn} aria-pressed={!!card.checked} onClick={() => void toggleCheck()}>
                <span className={s.box}>{card.checked && <Check size={14} strokeWidth={3} />}</span>
                {card.checked ? t('チェック済み（メモにも反映）') : t('覚えたらチェック')}
              </button>
            ) : (
              <button className={s.checkBtn} onClick={() => void saveAiCard()}>
                <BookmarkPlus size={16} />{t('この問題をメモに保存')}
              </button>
            )}
          </section>

          <div className={s.row}>
            <button className={s.btn} onClick={prev} disabled={pos === 0}>{t('前へ')}</button>
            <button className={`${s.btn} ${revealed ? s.primary : ''}`} onClick={next}>
              {pos + 1 === deck.length ? t('終わる') : t('次の問題')}
            </button>
          </div>
        </>
      ) : (
        <div className={s.done}>
          {deck.length > 0 ? (
            <>
              <div className={s.doneEmoji}>🎉</div>
              <p className={s.doneTitle}>{t('{n}問おつかれさま！', { n: deck.length })}</p>
              <p className={s.muted}>{t('今回チェックした問題: {n}問', { n: deckChecked })}</p>
              <button className={`${s.btn} ${s.primary}`} onClick={() => void rebuild(exclude)}><RotateCcw size={16} />{t('シャッフルしてもう一度')}</button>
            </>
          ) : (
            <>
              <div className={s.doneEmoji}>{all.length > 0 ? '✅' : '📄'}</div>
              <p className={s.doneTitle}>
                {all.length > 0 ? t('すべてチェック済みです') : t('このメモにはまだ問題がありません')}
              </p>
              <p className={s.muted}>
                {all.length > 0 ? t('「チェック済みを除外」をオフにすると全部の問題を解けます。') : t('AIがメモの本文から問題を作れます。')}
              </p>
            </>
          )}
        </div>
      )}

      <button className={`${s.btn} ${s.ghost}`} disabled={busy || all === null} onClick={() => void generate()}>
        <Sparkles size={16} />{busy ? t('問題を作成中…') : t('AIで本文から1問出題')}
      </button>
      {error && <p className={s.error} role="alert">{error}</p>}
    </SikunSheet>
  );
}

// ───────────────────────── Timer ─────────────────────────

const MIN_KEY = 'lily_sikun_timer_minutes';
const PRESETS = [5, 10, 15, 25, 30, 45, 60, 90];
export const TIMER_MAX_MIN = 600;

function fmt(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

export function TimerSheet({ runningMs, pausedMs, totalMs, endAt, onStart, onPause, onResume, onStop, onAdd, onClose }: {
  runningMs: number | null; pausedMs: number | null; totalMs: number; endAt: number | null;
  onStart: (min: number) => void; onPause: () => void; onResume: () => void; onStop: () => void;
  onAdd: (min: number) => void; onClose: () => void;
}) {
  const t = useT();
  const [minutes, setMinutes] = useState(() => {
    const v = Number(lsGet(MIN_KEY));
    return Number.isFinite(v) && v >= 1 && v <= TIMER_MAX_MIN ? String(v) : '25';
  });
  const active = runningMs !== null || pausedMs !== null;
  const value = Math.round(Number(minutes));
  const valid = Number.isFinite(value) && value >= 1 && value <= TIMER_MAX_MIN;
  const setVal = (n: number) => setMinutes(String(Math.max(1, Math.min(TIMER_MAX_MIN, n))));
  const step = value >= 60 ? 10 : 5;

  const remain = pausedMs ?? runningMs ?? 0;
  const R = 88;
  const C = 2 * Math.PI * R;
  const frac = active && totalMs > 0 ? Math.max(0, Math.min(1, remain / totalMs)) : 1;
  const endsAt = runningMs !== null && endAt ? new Date(endAt) : null;

  const start = () => {
    if (!valid) return;
    lsSet(MIN_KEY, String(value));
    onStart(value);
  };

  return (
    <SikunSheet title={t('集中タイマー')} subtitle={active ? (pausedMs !== null ? t('一時停止中') : t('集中しよう！')) : t('時間を決めてスタート')} onClose={onClose}>
      {active ? (
        <>
          <div className={`${s.ringWrap} ${pausedMs !== null ? s.ringPaused : ''}`}>
            <svg viewBox="0 0 200 200" aria-hidden>
              <circle className={s.ringTrack} cx="100" cy="100" r={R} fill="none" strokeWidth="12" />
              <circle className={s.ringFill} cx="100" cy="100" r={R} fill="none" strokeWidth="12" strokeLinecap="round"
                strokeDasharray={C} strokeDashoffset={C * (1 - frac)} />
            </svg>
            <div className={s.ringCenter}>
              <strong className={s.clock} role="timer">{fmt(remain)}</strong>
              <span className={s.muted}>{pausedMs !== null ? t('一時停止中') : t('残り')}</span>
            </div>
          </div>
          {endsAt && (
            <p className={s.endsAt}>{t('{time} に終了', { time: endsAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) })}</p>
          )}
          <div className={s.chips}>
            {[1, 5, 10].map(n => (
              <button key={n} className={s.chip} onClick={() => onAdd(n)}>+{t('{n}分', { n })}</button>
            ))}
          </div>
          <div className={s.row}>
            {pausedMs !== null ? (
              <button className={`${s.btn} ${s.primary}`} onClick={onResume}><Play size={16} />{t('再開')}</button>
            ) : (
              <button className={`${s.btn} ${s.primary}`} onClick={onPause}><Pause size={16} />{t('一時停止')}</button>
            )}
            <button className={s.btn} onClick={onStop}><Square size={14} />{t('終了')}</button>
          </div>
        </>
      ) : (
        <form onSubmit={e => { e.preventDefault(); start(); }} style={{ display: 'contents' }}>
          <div className={s.stepper}>
            <button type="button" className={s.stepBtn} aria-label={t('減らす')} disabled={!valid || value <= 1}
              onClick={() => setVal(value - step)}><Minus size={20} /></button>
            <input
              className={s.minInput} type="number" inputMode="numeric" min={1} max={TIMER_MAX_MIN} step={1}
              value={minutes} onChange={e => setMinutes(e.target.value)} aria-label={t('時間（分）')}
            />
            <button type="button" className={s.stepBtn} aria-label={t('増やす')} disabled={!valid || value >= TIMER_MAX_MIN}
              onClick={() => setVal((valid ? value : 0) + step)}><Plus size={20} /></button>
          </div>
          <div className={s.unit}>{t('分')}</div>
          <div className={s.chips}>
            {PRESETS.map(n => (
              <button type="button" key={n} className={`${s.chip} ${value === n ? s.chipOn : ''}`} onClick={() => setMinutes(String(n))}>
                {t('{n}分', { n })}
              </button>
            ))}
          </div>
          {!valid && <p className={s.error}>{t('1〜{max}分で指定してね', { max: TIMER_MAX_MIN })}</p>}
          <button type="submit" className={`${s.btn} ${s.primary}`} disabled={!valid}><Play size={16} />{t('スタート')}</button>
        </form>
      )}
    </SikunSheet>
  );
}

export { fmt as formatTimer };
