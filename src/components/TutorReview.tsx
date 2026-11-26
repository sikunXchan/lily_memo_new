import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { Editor } from '@tiptap/core';
import { X } from 'lucide-react';
import { getEffectiveApiKey } from '@/lib/appLang';
import { useT } from '@/lib/i18n';
import { noteHtmlToText } from '@/lib/noteText';
import { streamSikunlilyChat } from '@/lib/gemini';
import { renderRich } from '@/lib/richText';
import styles from './TutorPanel.module.css';

export interface TutorNote { id: number; title: string; editor: Editor }
interface Pair { q: string; a: string; checked?: boolean; opts?: string[] }
interface Card extends Pair { pos: number; index: number }

export function TutorPanel({ title, subtitle, onClose, children }: {
  title: string; subtitle?: string; onClose: () => void; children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const t = useT();
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return <dialog ref={ref} className={styles.dialog} aria-labelledby={id}
    onCancel={e => { e.preventDefault(); onClose(); }}
    onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className={styles.sheet}>
      <header><span className={styles.avatar} aria-hidden />
        <div><h2 id={id}>{title}</h2>{subtitle && <small>{subtitle}</small>}</div>
        <button className={styles.close} onClick={onClose} aria-label={t('閉じる')}><X size={18} /></button>
      </header>
      {children}
    </div>
  </dialog>;
}

function readCards(editor: Editor): Card[] {
  const result: Card[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== 'qa' || !Array.isArray(node.attrs.pairs)) return;
    node.attrs.pairs.forEach((pair: Pair, index: number) => {
      if (pair && typeof pair.q === 'string' && pair.q.trim() && typeof pair.a === 'string') {
        result.push({ ...pair, pos, index });
      }
    });
  });
  return result;
}

function draw(editor: Editor, exclude: boolean) {
  const deck = readCards(editor).filter(card => !exclude || !card.checked);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

const filterKey = 'lily_review_exclude_checked';

export function TutorReview({ note: { editor, title }, onClose }: { note: TutorNote; onClose: () => void }) {
  const t = useT();
  const [exclude, setExclude] = useState(() => localStorage.getItem(filterKey) !== '0');
  const [deck, setDeck] = useState(() => draw(editor, exclude));
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const alive = useRef(false);
  const card = deck[index];
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  function restart(filter: boolean) {
    setDeck(draw(editor, filter));
    setIndex(0);
    setRevealed(false);
    setError('');
  }

  function mark(checked: boolean) {
    const block = editor.state.doc.nodeAt(card.pos);
    const pairs: Pair[] = block?.attrs.pairs;
    const pair = pairs?.[card.index];
    if (block?.type.name !== 'qa' || pair?.q !== card.q || pair.a !== card.a) {
      restart(exclude);
      return;
    }
    const next = pairs.map((p, i) => i === card.index ? { ...p, checked } : p);
    editor.view.dispatch(editor.state.tr.setNodeMarkup(card.pos, undefined, { ...block.attrs, pairs: next }).setMeta('saveTutorReview', true));
    setDeck(items => items.map((p, i) => i === index ? { ...p, checked } : p));
  }

  async function generate() {
    const text = noteHtmlToText(editor.getHTML(), exclude);
    const key = getEffectiveApiKey();
    if (!text) { setError(t('出題できる本文がありません。')); return; }
    if (!key) { setError(t('設定で Gemini API キーを登録してください。')); return; }
    setBusy(true);
    setError('');
    try {
      const reply = await streamSikunlilyChat([{ role: 'user', text }],
        '本文から復習問題を1問作ってください。既存の問題との重複を避け、Q: 問題と A: 答えを別々の行に出力してください。',
        key, 0, {}, ['gemini-3.1-flash-lite'], false);
      if (!alive.current || editor.isDestroyed) return;
      const match = reply.trim().match(/^Q[:：]\s*([\s\S]+?)\n\s*A[:：]\s*([\s\S]+)$/i);
      if (!match || !match[1].trim() || !match[2].trim()) throw new Error(t('問題を作成できませんでした。'));
      const pair = { q: match[1].trim(), a: match[2].trim() };
      if (readCards(editor).some(p => p.q.trim() === pair.q)) throw new Error(t('同じ問題がすでにあります。'));
      const pos = editor.state.doc.content.size;
      const block = editor.schema.nodes.qa.create({ kind: 'qa', pairs: [pair] });
      editor.view.dispatch(editor.state.tr.insert(pos, block).setMeta('saveTutorReview', true));
      const next = card ? index + 1 : index;
      setDeck(items => [...items.slice(0, next), { ...pair, pos, index: 0 }, ...items.slice(next)]);
      setIndex(next);
      setRevealed(false);
    } catch (err) {
      if (alive.current) setError(err instanceof Error ? err.message : t('問題を作成できませんでした。'));
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  return <TutorPanel title={t('メモの復習')} subtitle={title} onClose={onClose}>
    <label><input type="checkbox" checked={exclude} disabled={busy} onChange={e => {
      const enabled = e.target.checked;
      localStorage.setItem(filterKey, enabled ? '1' : '0');
      setExclude(enabled);
      restart(enabled);
    }} />{t('チェック済みを除外')}</label>
    <section className={styles.card} aria-live="polite">
      {card ? <>
        <small>{t('{n} / {total} 問', { n: index + 1, total: deck.length })}</small>
        <div dangerouslySetInnerHTML={{ __html: renderRich(card.q) }} />
        {Array.isArray(card.opts) && <ol type="A">{card.opts.map((opt, i) => <li key={i}>{opt}</li>)}</ol>}
        {revealed && <div className={styles.answer} dangerouslySetInnerHTML={{ __html: renderRich(card.a || t('答えは未入力です')) }} />}
        <label><input type="checkbox" checked={!!card.checked} disabled={busy} onChange={e => mark(e.target.checked)} />{t('この問題にチェック')}</label>
        <div className={styles.actions}>
          {!revealed && <button onClick={() => setRevealed(true)}>{t('答えを見る')}</button>}
          <button className={styles.primary} disabled={busy} onClick={() => { setIndex(index + 1); setRevealed(false); setError(''); }}>
            {index + 1 === deck.length ? t('復習を終える') : t('次の問題')}
          </button>
        </div>
      </> : <>
        <p>{deck.length ? t('今回の復習が終わりました') : readCards(editor).length ? t('未チェックの問題はありません') : t('このメモにはまだ問題がありません')}</p>
        {deck.length > 0 && <button disabled={busy} onClick={() => restart(exclude)}>{t('もう一度復習する')}</button>}
      </>}
    </section>
    <button disabled={busy} onClick={() => void generate()}>{busy ? t('作成中…') : t('AIで本文から1問追加')}</button>
    {error && <p role="alert">{error}</p>}
  </TutorPanel>;
}
