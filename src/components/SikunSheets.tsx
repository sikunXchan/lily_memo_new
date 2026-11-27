'use client';

// sikun's quiz (ring-bound word cards, red-sheet answer, 済 stamp) and focus
// timer (kitchen-timer dial). Opened from sikun's long-press radial menu.
// Design: Claude Design canvas "sikun 問題・タイマー".

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { X, Play, Pause, Plus, Minus, PenLine, ArrowRight, Eye, EyeOff, Check } from 'lucide-react';
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
      <section className={s.sheet} role="dialog" aria-modal="true" aria-label={title}>
        <div className={s.head}>
          <div className={s.headText}>
            <h2>{title}</h2>
            {subtitle && <small>{subtitle}</small>}
          </div>
          <button className={s.close} onClick={onClose} aria-label={t('閉じる')}><X size={18} /></button>
        </div>
        {children}
      </section>
    </div>
  );
}

// ───────────────────────── Quiz ─────────────────────────

interface Card extends QuizPair {
  /** set when the question lives in the note (so it can be stamped) */
  block?: number;
  index?: number;
  ai?: boolean;
}

type Result = 'known' | 'again';
const SKIP_KEY = 'lily_sikun_quiz_skip_checked';

const cardKey = (c: Card) => (c.block !== undefined ? `${c.block}:${c.index}` : `ai:${c.q}`);
const stripP = (html: string) => html.replace(/^\s*<p>([\s\S]*?)<\/p>\s*$/, '$1');

export function QuizSheet({ noteId, en, onClose }: { noteId: number; en: boolean; onClose: () => void }) {
  const t = useT();
  const [title, setTitle] = useState('');
  const [all, setAll] = useState<Card[] | null>(null); // every question in the note
  const [deck, setDeck] = useState<Card[]>([]);
  const [pos, setPos] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [skipChecked, setSkipChecked] = useState(() => lsGet(SKIP_KEY) !== '0');
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

  const load = useCallback(async (skip: boolean) => {
    const { html, title } = await readNoteHtml(noteId);
    if (!alive.current) return;
    const items: Card[] = extractQuizItems(html);
    setTitle(title);
    setAll(items);
    setDeck(shuffle(skip ? items.filter(c => !c.checked) : items));
    setPos(0);
    setRevealed(false);
    setResults({});
    setError('');
  }, [noteId]);

  useEffect(() => { void load(skipChecked); }, [load]); // eslint-disable-line react-hooks/exhaustive-deps

  const card = deck[pos] as Card | undefined;
  const total = all?.length ?? 0;

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
      void load(skipChecked);
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
      const body = noteHtmlToText(html, skipChecked);
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

  // 次へ = not learned yet (no extra "まだ" tap needed); 覚えた = stamp 済.
  const next = () => { if (unsavedAi) advance(); else void answer('again'); };
  const known = () => { if (unsavedAi) void saveAi(); else void answer('known'); };

  // Keyboard: Space = show/hide answer · 1 = 覚えた · 2 or → = 次へ · ← = back
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey || !card) return;
      const onButton = e.target instanceof HTMLButtonElement;
      if (e.key === ' ' && !onButton) { e.preventDefault(); setRevealed(r => !r); }
      else if (e.key === '2' || e.key === 'ArrowRight') { e.preventDefault(); next(); }
      else if (e.key === '1') { e.preventDefault(); known(); }
      else if (e.key === 'ArrowLeft') back();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const toggleSkip = (v: boolean) => {
    setSkipChecked(v);
    lsSet(SKIP_KEY, v ? '1' : '0');
    if (all) startDeck(v ? all.filter(c => !c.checked) : all);
  };

  const knownN = Object.values(results).filter(r => r === 'known').length;
  const againCards = deck.filter(c => results[cardKey(c)] === 'again');

  const aiLink = (
    <button className={s.textLink} disabled={busy || all === null} onClick={() => void generate()}>
      <PenLine size={15} />{busy ? t('問題を作成中…') : t('本文から1枚つくってもらう')}
    </button>
  );

  return (
    <SikunSheet title={t('問題')} subtitle={title || t('無題')} onClose={onClose}>
      {all === null ? (
        <p className={s.note}>{t('読み込み中…')}</p>
      ) : card ? (
        <>
          <div className={s.meta}>
            <label className={s.filter}>
              <input type="checkbox" checked={skipChecked} onChange={e => toggleSkip(e.target.checked)} />
              {t('済みのカードは出さない')}
            </label>
            <span className={s.count}>{pos + 1} <span>/ {deck.length}</span></span>
          </div>
          <div className={s.bar}><span style={{ width: `${(pos / deck.length) * 100}%` }} /></div>

          <div className={s.card} key={`${pos}-${card.q}`}>
              {(card.ai || card.checked) && <div className={s.cardTop}>
                {card.ai && <span className={s.tagAi}>{t('AIがつくった問題')}</span>}
                {/* Already 済 (shown when 済 cards aren't skipped): tap to undo. */}
                {card.block !== undefined && card.checked && (
                  <button
                    className={s.stamp}
                    aria-pressed
                    title={t('タップで済を外す（メモのチェックも外れます）')}
                    onClick={() => void writeCheck(card, pos, false)}
                  >
                    <Check size={14} strokeWidth={3} />{t('済')}
                  </button>
                )}
              </div>}

              <div className={s.question} dangerouslySetInnerHTML={{ __html: renderRich(card.q) }} />
              {Array.isArray(card.opts) && card.opts.length > 0 && (
                <ol type="A" className={s.opts}>
                  {card.opts.map((o, i) => <li key={i} dangerouslySetInnerHTML={{ __html: stripP(renderRich(o)) }} />)}
                </ol>
              )}

              <div
                className={s.answerZone}
                role="button"
                tabIndex={0}
                aria-pressed={revealed}
                aria-label={revealed ? undefined : t('答えを表示')}
                onClick={() => setRevealed(r => !r)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); setRevealed(r => !r); } }}
              >
                <div className={s.answer} aria-hidden={!revealed}>
                  <span className={s.answerLabel}>{t('答え')}</span>
                  <div className={s.answerText} dangerouslySetInnerHTML={{ __html: renderRich(card.a || t('答えは未入力です')) }} />
                </div>
                <span className={`${s.redSheet} ${revealed ? s.redSheetOff : ''}`} aria-hidden>
                  {revealed
                    ? <span className={s.hideTab}><EyeOff size={15} strokeWidth={2.2} />{t('隠す')}</span>
                    : <><Eye size={17} strokeWidth={2.2} />{t('タップで答えを表示')}<span className={s.kbd}>Space</span></>}
                </span>
              </div>
          </div>

          <div className={s.pair}>
            {unsavedAi ? (
              <button className={s.ink} onClick={known}>{t('メモに追加')}<span className={s.kbd}>1</span></button>
            ) : (
              <button className={s.stampBtn} onClick={known}>
                <Check size={18} strokeWidth={3} />{t('覚えた')}<span className={s.kbd}>1</span>
              </button>
            )}
            <button className={s.outline} onClick={next}>
              {t('次へ')}<ArrowRight size={17} strokeWidth={2.2} /><span className={s.kbd}>2</span>
            </button>
          </div>
          {aiLink}
        </>
      ) : deck.length > 0 ? (
        <>
          <div className={s.bar}><span style={{ width: '100%' }} /></div>
          <div className={s.done}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/sikun-character.png" alt="" />
            <p className={s.doneTitle}>{t('{n}枚、おわり！', { n: deck.length })}</p>
            {knownN > 0 && <p className={s.doneSub}>{t('覚えたカードはメモにも「済」がつきました')}</p>}
          </div>
          <div className={s.results}>
            <div className={s.result}>
              <span>{t('覚えた')}</span><strong>{knownN}</strong>
            </div>
            <div className={s.result}><span>{t('まだ')}</span><strong>{againCards.length}</strong></div>
          </div>
          {againCards.length > 0 && (
            <button className={s.ink} onClick={() => startDeck(againCards)}>{t('まだの{n}枚をもう一度', { n: againCards.length })}</button>
          )}
          <button className={againCards.length > 0 ? s.outline : s.ink} onClick={() => void load(skipChecked)}>{t('最初から')}</button>
          {aiLink}
        </>
      ) : (
        <>
          <div className={s.done}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/sikun-character.png" alt="" />
            <p className={s.doneTitle}>{total > 0 ? t('ぜんぶ「済」です') : t('このメモにはまだ問題がありません')}</p>
            <p className={s.doneSub}>{total > 0 ? t('済みのカードもやり直せます。') : t('メモの本文から1枚ずつつくれます。')}</p>
          </div>
          {total > 0 && <button className={s.ink} onClick={() => toggleSkip(false)}>{t('済みのカードもやる')}</button>}
          {aiLink}
        </>
      )}
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

/** Kitchen-timer face: a 60-minute dial with the time left as a wedge. */
function Dial({ minutes, paused, children }: { minutes: number; paused?: boolean; children: ReactNode }) {
  const deg = Math.max(0, Math.min(360, (minutes / 60) * 360));
  return (
    <div className={`${s.dial} ${paused ? s.paused : ''}`}>
      <div className={s.face} />
      <div className={s.wedge} style={{ background: `conic-gradient(var(--primary, #e08394) 0deg ${deg}deg, transparent ${deg}deg 360deg)` }} />
      <div className={s.ticks} />
      <div className={s.ticksMajor} />
      <span className={s.num} style={{ left: 111, top: 30 }}>0</span>
      <span className={s.num} style={{ left: 196, top: 116 }}>15</span>
      <span className={s.num} style={{ left: 111, top: 202 }}>30</span>
      <span className={s.num} style={{ left: 26, top: 116 }}>45</span>
      {children}
    </div>
  );
}

export function TimerSheet({ runningMs, pausedMs, endAt, onStart, onPause, onResume, onStop, onAdd, onClose }: {
  runningMs: number | null; pausedMs: number | null; totalMs?: number; endAt: number | null;
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

  const start = () => {
    if (!valid) return;
    lsSet(MIN_KEY, String(value));
    onStart(value);
  };

  if (active) {
    const remain = pausedMs ?? runningMs ?? 0;
    const endsAt = runningMs !== null && endAt ? new Date(endAt) : null;
    return (
      <SikunSheet
        title={t('集中タイマー')}
        subtitle={pausedMs !== null ? t('一時停止中') : endsAt
          ? t('{time} に終わります', { time: endsAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) })
          : undefined}
        onClose={onClose}
      >
        <div className={s.dialRow}>
          <Dial minutes={remain / 60000} paused={pausedMs !== null}>
            <div className={`${s.knob} ${s.knobWide}`}>
              <strong className={s.clock} role="timer">{fmt(remain)}</strong>
              <small>{pausedMs !== null ? t('一時停止中') : t('のこり')}</small>
            </div>
          </Dial>
        </div>
        <div className={`${s.ruler} ${s.rulerStrong}`}>
          <span>{t('延長')}</span>
          {[1, 5, 10, 15].map(n => (
            <button key={n} onClick={() => onAdd(n)} aria-label={t('{n}分延長', { n })}>+{n}</button>
          ))}
        </div>
        <div className={s.pair}>
          <button className={s.outline} onClick={onStop}>{t('やめる')}</button>
          {pausedMs !== null ? (
            <button className={s.ink} onClick={onResume}><Play size={16} fill="currentColor" />{t('再開')}</button>
          ) : (
            <button className={s.ink} onClick={onPause}><Pause size={16} fill="currentColor" />{t('一時停止')}</button>
          )}
        </div>
      </SikunSheet>
    );
  }

  return (
    <SikunSheet title={t('集中タイマー')} subtitle={t('何分やる？')} onClose={onClose}>
      <div className={s.dialRow}>
        <button className={s.round} aria-label={t('減らす')} disabled={!valid || value <= 1} onClick={stepDown}>
          <Minus size={18} strokeWidth={2.4} />
        </button>
        <Dial minutes={valid ? value : 0}>
          <div className={s.knob}>
            <input
              className={s.minInput} type="number" inputMode="numeric" min={1} max={TIMER_MAX_MIN} step={1}
              value={minutes} onChange={e => setMinutes(e.target.value)} aria-label={t('時間（分）')}
              onKeyDown={e => { if (e.key === 'Enter') start(); }}
            />
            <small>{t('分')}</small>
          </div>
        </Dial>
        <button className={s.round} aria-label={t('増やす')} disabled={valid && value >= TIMER_MAX_MIN} onClick={stepUp}>
          <Plus size={18} strokeWidth={2.4} />
        </button>
      </div>
      <div className={s.ruler}>
        {PRESETS.map(n => (
          <button key={n} aria-pressed={valid && value === n} onClick={() => setMinutes(String(n))} aria-label={t('{n}分', { n })}>
            {n}
          </button>
        ))}
      </div>
      <p className={valid ? s.note : s.error}>
        {valid ? t('真ん中の数字をタップすると直接入力できます（1〜600分）') : t('1〜{max}分で指定してね', { max: TIMER_MAX_MIN })}
      </p>
      <button className={s.ink} disabled={!valid} onClick={start}>
        <Play size={16} fill="currentColor" />{valid ? t('{n}分 はじめる', { n: value }) : t('はじめる')}
      </button>
    </SikunSheet>
  );
}

export { fmt as formatTimer };
