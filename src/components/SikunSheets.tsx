'use client';

// sikun's full-size sheets: the unified note quiz (flashcards) and the
// adjustable focus timer. Opened from sikun's long-press radial menu (see InstanceSikun).

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { X, Check, Sparkles, RotateCcw, Play, Pause, Square, Plus, Minus, ChevronLeft, Eye, BookmarkPlus } from 'lucide-react';
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

export function SikunSheet({ title, subtitle, onClose, footer, children }: {
  title: string; subtitle?: string; onClose: () => void; footer?: ReactNode; children: ReactNode;
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
          <div className={s.headText}>
            <h2>{title}</h2>
            {subtitle && <small>{subtitle}</small>}
          </div>
          <button className={s.iconBtn} onClick={onClose} aria-label={t('閉じる')}><X size={18} /></button>
        </div>
        <div className={s.body}>{children}</div>
        {footer && <div className={s.footer}>{footer}</div>}
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

type Filter = 'unchecked' | 'all';
type Result = 'known' | 'again';
const FILTER_KEY = 'lily_sikun_quiz_filter';

const cardKey = (c: Card) => (c.block !== undefined ? `${c.block}:${c.index}` : `ai:${c.q}`);
const stripP = (html: string) => html.replace(/^\s*<p>([\s\S]*?)<\/p>\s*$/, '$1');

export function QuizSheet({ noteId, en, onClose }: { noteId: number; en: boolean; onClose: () => void }) {
  const t = useT();
  const [title, setTitle] = useState('');
  const [all, setAll] = useState<Card[] | null>(null); // every question in the note
  const [deck, setDeck] = useState<Card[]>([]);
  const [pos, setPos] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [filter, setFilter] = useState<Filter>(() => (lsGet(FILTER_KEY) === 'all' ? 'all' : 'unchecked'));
  const [results, setResults] = useState<Record<string, Result>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const alive = useRef(true);
  const askedAi = useRef<string[]>([]);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const startDeck = (cards: Card[]) => {
    setDeck(shuffle(cards));
    setPos(0);
    setRevealed(false);
    setResults({});
    setError('');
  };

  const load = useCallback(async (f: Filter) => {
    const { html, title } = await readNoteHtml(noteId);
    if (!alive.current) return;
    const items: Card[] = extractQuizItems(html);
    setTitle(title);
    setAll(items);
    setDeck(shuffle(f === 'unchecked' ? items.filter(c => !c.checked) : items));
    setPos(0);
    setRevealed(false);
    setResults({});
    setError('');
  }, [noteId]);

  useEffect(() => { void load(filter); }, [load]); // eslint-disable-line react-hooks/exhaustive-deps

  const card = deck[pos] as Card | undefined;
  const total = all?.length ?? 0;
  const uncheckedTotal = all?.filter(c => !c.checked).length ?? 0;

  const patchCard = (at: number, patch: Partial<Card>) =>
    setDeck(d => d.map((c, i) => (i === at ? { ...c, ...patch } : c)));

  const writeCheck = async (c: Card, at: number, checked: boolean): Promise<boolean> => {
    if (c.block === undefined || c.index === undefined) return false;
    patchCard(at, { checked });
    const ok = await setQuizChecked(noteId, { ...c, block: c.block, index: c.index }, checked);
    if (!alive.current) return false;
    if (!ok) {
      patchCard(at, { checked: !checked });
      setError(t('メモの問題が変更されたため、チェックできませんでした。もう一度読み込みます。'));
      void load(filter);
      return false;
    }
    setAll(list => list?.map(x => (x.block === c.block && x.index === c.index ? { ...x, checked } : x)) ?? list);
    return true;
  };

  const advance = () => { setPos(p => p + 1); setRevealed(false); setError(''); };
  const back = () => { setPos(p => Math.max(0, p - 1)); setRevealed(false); setError(''); };

  const answer = async (r: Result) => {
    if (!card) return;
    setResults(m => ({ ...m, [cardKey(card)]: r }));
    if (r === 'known' && card.block !== undefined && !card.checked) {
      await writeCheck(card, pos, true);
    }
    advance();
  };

  const saveAi = async () => {
    if (!card?.ai || card.block !== undefined) return;
    const at = pos;
    const saved = await appendQuizPair(noteId, { q: card.q, a: card.a });
    if (!alive.current) return;
    if (!saved) { setError(t('メモに保存できませんでした。')); return; }
    patchCard(at, { block: saved.block, index: saved.index });
    setAll(list => [...(list ?? []), { ...saved }]);
  };

  const generate = async () => {
    const apiKey = getEffectiveApiKey();
    if (!apiKey) { setError(t('設定で Gemini API キーを保存してください。')); return; }
    setBusy(true);
    setError('');
    try {
      const { html, title } = await readNoteHtml(noteId);
      const body = noteHtmlToText(html, filter === 'unchecked');
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
      const at = Math.min(pos, deck.length);
      setDeck(d => [...d.slice(0, at), { ...pair, ai: true }, ...d.slice(at)]);
      setPos(at);
      setRevealed(false);
    } catch (err) {
      if (alive.current) setError(err instanceof Error ? err.message : t('問題を作れませんでした。もう一度試してね。'));
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  const unsavedAi = !!card?.ai && card.block === undefined;

  // Keyboard: Space/Enter = show answer · 1 = again · 2 = got it · ← = back
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey || !card) return;
      const onButton = e.target instanceof HTMLButtonElement;
      if (!revealed && (e.key === ' ' || e.key === 'Enter') && !onButton) { e.preventDefault(); setRevealed(true); }
      else if (revealed && e.key === '1') { e.preventDefault(); if (unsavedAi) advance(); else void answer('again'); }
      else if (revealed && e.key === '2') { e.preventDefault(); if (unsavedAi) void saveAi(); else void answer('known'); }
      else if (e.key === 'ArrowLeft') back();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const switchFilter = (f: Filter) => {
    if (f === filter || !all) return;
    setFilter(f);
    lsSet(FILTER_KEY, f);
    startDeck(f === 'unchecked' ? all.filter(c => !c.checked) : all);
  };

  const knownN = Object.values(results).filter(r => r === 'known').length;
  const againCards = deck.filter(c => results[cardKey(c)] === 'again');

  // ── footer: always exactly the next step ──
  let footer: ReactNode = null;
  if (card) {
    if (!revealed) {
      footer = (
        <button className={`${s.btn} ${s.primary}`} onClick={() => setRevealed(true)}>
          <Eye size={18} />{t('答えを見る')}<span className={s.kbd}>Space</span>
        </button>
      );
    } else if (unsavedAi) {
      footer = (
        <div className={s.row}>
          <button className={s.btn} onClick={advance}>{t('スキップ')}<span className={s.kbd}>1</span></button>
          <button className={`${s.btn} ${s.primary}`} onClick={() => void saveAi()}>
            <BookmarkPlus size={18} />{t('メモに追加')}<span className={s.kbd}>2</span>
          </button>
        </div>
      );
    } else {
      footer = (
        <div className={s.row}>
          <button className={s.btn} onClick={() => void answer('again')}>
            <RotateCcw size={17} />{t('もう一度')}<span className={s.kbd}>1</span>
          </button>
          <button className={`${s.btn} ${s.success}`} onClick={() => void answer('known')}>
            <Check size={18} strokeWidth={3} />{t('覚えた')}<span className={s.kbd}>2</span>
          </button>
        </div>
      );
    }
  }

  return (
    <SikunSheet title={t('問題')} subtitle={title || t('無題')} onClose={onClose} footer={footer}>
      {all && total > 0 && (
        <div className={s.segment} role="group" aria-label={t('出題範囲')}>
          <button aria-pressed={filter === 'unchecked'} onClick={() => switchFilter('unchecked')}>
            {t('未チェック')}<span className={s.count}>{uncheckedTotal}</span>
          </button>
          <button aria-pressed={filter === 'all'} onClick={() => switchFilter('all')}>
            {t('すべて')}<span className={s.count}>{total}</span>
          </button>
        </div>
      )}

      {all === null ? (
        <p className={`${s.muted} ${s.center}`}>{t('読み込み中…')}</p>
      ) : card ? (
        <>
          <div className={s.progressRow}>
            <button className={s.iconBtn} onClick={back} disabled={pos === 0} aria-label={t('前の問題')}>
              <ChevronLeft size={18} />
            </button>
            <div className={s.bar}><span style={{ width: `${(pos / deck.length) * 100}%` }} /></div>
            <span className={s.progressText}>{pos + 1} / {deck.length}</span>
          </div>

          <div
            className={`${s.card} ${card.checked ? s.cardChecked : ''}`}
            key={`${pos}-${card.q}`}
            role="button"
            tabIndex={0}
            aria-label={revealed ? undefined : t('タップで答えを表示')}
            onClick={() => setRevealed(true)}
          >
            <div className={s.cardTop}>
              <span className={`${s.tag} ${card.ai ? s.tagAi : ''}`}>
                {card.ai ? t('AI・本文から') : t('メモの問題')}
              </span>
              {card.block !== undefined && (
                <button
                  className={s.checkToggle}
                  aria-pressed={!!card.checked}
                  onClick={e => { e.stopPropagation(); void writeCheck(card, pos, !card.checked); }}
                  title={t('メモのチェックボックスと連動します')}
                >
                  <span className={s.checkCircle}>{card.checked && <Check size={11} strokeWidth={3.5} />}</span>
                  {card.checked ? t('チェック済み') : t('チェック')}
                </button>
              )}
            </div>

            <div className={s.question} dangerouslySetInnerHTML={{ __html: renderRich(card.q) }} />
            {Array.isArray(card.opts) && card.opts.length > 0 && (
              <ol type="A" className={s.opts}>
                {card.opts.map((o, i) => <li key={i} dangerouslySetInnerHTML={{ __html: stripP(renderRich(o)) }} />)}
              </ol>
            )}

            {revealed ? (
              <div className={s.answer}>
                <span className={s.answerLabel}>{t('答え')}</span>
                <div dangerouslySetInnerHTML={{ __html: renderRich(card.a || t('答えは未入力です')) }} />
              </div>
            ) : (
              <span className={s.hint}><Eye size={14} />{t('タップで答えを表示')}</span>
            )}
          </div>
        </>
      ) : deck.length > 0 ? (
        <div className={s.done}>
          <div className={s.doneEmoji}>🎉</div>
          <p className={s.doneTitle}>{t('{n}問おつかれさま！', { n: deck.length })}</p>
          <div className={s.stats}>
            <div className={`${s.stat} ${s.statGood}`}><strong>{knownN}</strong><span>{t('覚えた')}</span></div>
            <div className={`${s.stat} ${s.statAgain}`}><strong>{againCards.length}</strong><span>{t('もう一度')}</span></div>
          </div>
          <div className={s.row} style={{ width: '100%', marginTop: 6 }}>
            {againCards.length > 0 && (
              <button className={`${s.btn} ${s.primary}`} onClick={() => startDeck(againCards)}>
                <RotateCcw size={17} />{t('もう一度の{n}問', { n: againCards.length })}
              </button>
            )}
            <button className={s.btn} onClick={() => void load(filter)}>{t('最初から')}</button>
          </div>
        </div>
      ) : (
        <div className={s.done}>
          <div className={s.doneEmoji}>{total > 0 ? '✅' : '📄'}</div>
          <p className={s.doneTitle}>{total > 0 ? t('すべてチェック済みです') : t('このメモにはまだ問題がありません')}</p>
          <p className={s.muted}>
            {total > 0 ? t('「すべて」に切り替えると全部の問題を解けます。') : t('AIがメモの本文から問題を作れます。')}
          </p>
        </div>
      )}

      <button className={s.link} disabled={busy || all === null} onClick={() => void generate()}>
        <Sparkles size={15} />{busy ? t('問題を作成中…') : t('AIで本文から1問出題')}
      </button>
      {error && <p className={s.error} role="alert">{error}</p>}
    </SikunSheet>
  );
}

// ───────────────────────── Timer ─────────────────────────

const MIN_KEY = 'lily_sikun_timer_minutes';
const PRESETS = [5, 10, 15, 25, 30, 45, 60, 90, 120];
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
  const valid = minutes.trim() !== '' && Number.isFinite(value) && value >= 1 && value <= TIMER_MAX_MIN;
  const clamp = (n: number) => Math.max(1, Math.min(TIMER_MAX_MIN, n));
  const stepDown = () => setMinutes(String(clamp(value <= 5 ? value - 1 : value <= 60 ? value - 5 : value - 10)));
  const stepUp = () => setMinutes(String(clamp(!valid ? 5 : value < 5 ? value + 1 : value < 60 ? value + 5 : value + 10)));

  const remain = pausedMs ?? runningMs ?? 0;
  const R = 92;
  const C = 2 * Math.PI * R;
  const frac = active
    ? (totalMs > 0 ? Math.max(0, Math.min(1, remain / totalMs)) : 1)
    : (valid ? Math.min(1, value / 60) : 0); // setup: the ring shows the length on a 60-min face
  const endsAt = runningMs !== null && endAt ? new Date(endAt) : null;

  const start = () => {
    if (!valid) return;
    lsSet(MIN_KEY, String(value));
    onStart(value);
  };

  const ring = (center: ReactNode) => (
    <div className={`${s.ringWrap} ${pausedMs !== null ? s.ringPaused : ''}`}>
      <svg viewBox="0 0 210 210" aria-hidden>
        <circle className={s.ringTrack} cx="105" cy="105" r={R} fill="none" strokeWidth="12" />
        <circle className={s.ringFill} cx="105" cy="105" r={R} fill="none" strokeWidth="12" strokeLinecap="round"
          strokeDasharray={C} strokeDashoffset={C * (1 - frac)} />
      </svg>
      <div className={s.ringCenter}>{center}</div>
    </div>
  );

  if (active) {
    return (
      <SikunSheet
        title={t('集中タイマー')}
        subtitle={pausedMs !== null ? t('一時停止中') : endsAt
          ? t('{time} に終了', { time: endsAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) })
          : t('集中しよう！')}
        onClose={onClose}
        footer={
          <div className={s.row}>
            <button className={s.btn} onClick={onStop}><Square size={15} />{t('終了')}</button>
            {pausedMs !== null ? (
              <button className={`${s.btn} ${s.primary}`} onClick={onResume}><Play size={17} />{t('再開')}</button>
            ) : (
              <button className={`${s.btn} ${s.primary}`} onClick={onPause}><Pause size={17} />{t('一時停止')}</button>
            )}
          </div>
        }
      >
        <div className={s.dial}>
          {ring(<>
            <strong className={s.clock} role="timer">{fmt(remain)}</strong>
            <span className={s.ringUnit}>{pausedMs !== null ? t('一時停止中') : t('残り')}</span>
          </>)}
        </div>
        <div className={s.chips}>
          {[1, 5, 10, 15].map(n => (
            <button key={n} className={s.chip} onClick={() => onAdd(n)}>+{t('{n}分', { n })}</button>
          ))}
        </div>
      </SikunSheet>
    );
  }

  return (
    <SikunSheet
      title={t('集中タイマー')}
      subtitle={t('時間を決めてスタート')}
      onClose={onClose}
      footer={
        <button className={`${s.btn} ${s.primary}`} disabled={!valid} onClick={start}>
          <Play size={17} />{valid ? t('{n}分 スタート', { n: value }) : t('スタート')}
        </button>
      }
    >
      <div className={s.dial}>
        <button type="button" className={s.stepBtn} aria-label={t('減らす')} disabled={!valid || value <= 1} onClick={stepDown}>
          <Minus size={20} />
        </button>
        {ring(<>
          <input
            className={s.minInput} type="number" inputMode="numeric" min={1} max={TIMER_MAX_MIN} step={1}
            value={minutes} onChange={e => setMinutes(e.target.value)} aria-label={t('時間（分）')}
            onKeyDown={e => { if (e.key === 'Enter') start(); }}
          />
          <span className={s.ringUnit}>{t('分')}</span>
        </>)}
        <button type="button" className={s.stepBtn} aria-label={t('増やす')} disabled={valid && value >= TIMER_MAX_MIN} onClick={stepUp}>
          <Plus size={20} />
        </button>
      </div>
      <div className={s.chips}>
        {PRESETS.map(n => (
          <button type="button" key={n} className={`${s.chip} ${valid && value === n ? s.chipOn : ''}`}
            aria-pressed={valid && value === n} onClick={() => setMinutes(String(n))}>
            {t('{n}分', { n })}
          </button>
        ))}
      </div>
      {!valid && <p className={s.error}>{t('1〜{max}分で指定してね', { max: TIMER_MAX_MIN })}</p>}
    </SikunSheet>
  );
}

export { fmt as formatTimer };
