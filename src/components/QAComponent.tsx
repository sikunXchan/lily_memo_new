'use client';

import { NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react';
import { useState } from 'react';
import { Trash2, GripVertical, Sparkles } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { renderRich } from '@/lib/richText';
import { callGemini } from '@/lib/gemini';
import { getEffectiveApiKey } from '@/lib/appLang';

// Render a string with KaTeX math. For inline use (inside flex/inline containers),
// pass strip=true to remove the outer <p> wrapper that marked adds.
function R({ src, strip }: { src: string; strip?: boolean }) {
  let html = renderRich(src);
  if (strip) html = html.replace(/^\s*<p>([\s\S]*?)<\/p>\s*$/, '$1');
  // eslint-disable-next-line react/no-danger
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}

interface QAPair {
  q: string;
  a: string;
  opts?: string[];
  checked?: boolean;
}

function parseNumberedText(text: string): string[] {
  const trimmed = text.trim();
  const lines = trimmed.split('\n');

  // Count lines that start with a numbered item (e.g. "1." or "１．")
  const numberedLineCount = lines.filter(l => /^\s*\d+[.．]/.test(l)).length;

  if (numberedLineCount > 1) {
    // Multiline format: each item begins on its own line.
    // Numbers that appear mid-line (e.g. "3.5 liters", "in 2024.") are ignored.
    const items: string[] = [];
    let current: string | null = null;

    for (const line of lines) {
      const match = line.match(/^\s*\d+[.．]\s*(.*)/);
      if (match) {
        if (current !== null) items.push(current.trim());
        current = match[1];
      } else if (current !== null) {
        current += '\n' + line;
      }
    }
    if (current !== null) items.push(current.trim());
    return items.filter(Boolean);
  }

  // Single-line / inline format: items are separated by whitespace.
  // e.g. "1. lowering　2. shorten　3. risk …"
  const matches = Array.from(trimmed.matchAll(/\d+[.．]\s*(.*?)(?=\s*\d+[.．]|$)/g));
  return matches.map(m => m[1].trim()).filter(Boolean);
}

const KIND_LABEL: Record<string, string> = {
  qa: 'Q&A',
  fill: '穴埋め問題',
  order: '並べ替え問題',
  choice: '選択問題',
  truefalse: '○×問題',
  flash: '単語カード',
};

const norm = (s: string) =>
  s.replace(/\s+/g, '').replace(/[、。．,，.・]/g, '').toLowerCase();

// "日本の首都は？ A. 大阪 B. 東京 …" → stem + labelled options
function parseChoice(q: string): { stem: string; options: { label: string; text: string }[] } {
  const markerRe = /([A-DＡ-Ｄa-d1-4１-４①-④ア-エ])\s*[.)）.、:：]\s*/g;
  const markers: { label: string; idx: number; end: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = markerRe.exec(q)) !== null) {
    markers.push({ label: m[1], idx: m.index, end: m.index + m[0].length });
  }
  if (markers.length < 2) return { stem: q, options: [] };
  const stem = q.slice(0, markers[0].idx).trim();
  const options = markers.map((mk, i) => ({
    label: mk.label,
    text: q.slice(mk.end, i + 1 < markers.length ? markers[i + 1].idx : undefined).trim(),
  }));
  return { stem, options };
}

// true / false / unknown from an answer string like "○（…）" or "×（…）"
function answerBool(a: string): boolean | null {
  const t = a.trim();
  if (/^(○|〇|◯|正しい|正|true|t|はい|yes)/i.test(t)) return true;
  if (/^(×|✕|✗|☓|誤り|誤|間違|ちが|false|f|いいえ|no)/i.test(t)) return false;
  return null;
}

function splitItems(s: string): string[] {
  let body = s;
  const colon = Math.max(body.lastIndexOf(':'), body.lastIndexOf('：'));
  if (colon >= 0 && colon < body.length - 1) body = body.slice(colon + 1);
  return body
    .split(/→|->|⇒|\/|、|，|,|;|；|\s{2,}|　/)
    .map(x => x.replace(/^\s*\d+[.)、.]\s*/, '').trim())
    .filter(Boolean);
}

function QACard({
  pair, index, kind, revealAll, onToggleChecked,
}: {
  pair: QAPair;
  index: number;
  kind: string;
  revealAll: boolean;
  onToggleChecked: () => void;
}) {
  const t = useT();
  const [revealed, setRevealed] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [tf, setTf] = useState<boolean | null>(null);
  const [flipped, setFlipped] = useState(false);
  const [fills, setFills] = useState<string[]>([]);
  const [ordSel, setOrdSel] = useState<number[]>([]);
  const [submitted, setSubmitted] = useState(false);
  // 記述採点AI（qa/記述式のみ）: ユーザーの答えをLilyが採点・講評する
  const [myAnswer, setMyAnswer] = useState('');
  const [grading, setGrading] = useState(false);
  const [gradeResult, setGradeResult] = useState<string | null>(null);
  const [gradeError, setGradeError] = useState('');

  const gradeMyAnswer = async () => {
    const ans = myAnswer.trim();
    if (!ans || grading) return;
    const apiKey = getEffectiveApiKey();
    if (!apiKey) { setGradeError(t('設定画面で Gemini API キーを登録してね')); return; }
    setGrading(true); setGradeError(''); setGradeResult(null);
    try {
      const prompt =
        `あなたは学習者の記述解答を採点する優しく厳格な採点者です。以下を読み、日本語で簡潔に採点してください。\n` +
        `【問題】\n${pair.q}\n\n【模範解答】\n${pair.a}\n\n【学習者の解答】\n${ans}\n\n` +
        `次の形式で出力（前置き・余計な文章は不要）:\n` +
        `点数: ○/100\n` +
        `講評: 良い点と不足・誤りを2〜3文で。模範解答と照らして具体的に。甘い評価はせず、合っていれば正しく評価する。`;
      const reply = (await callGemini(prompt, apiKey)).trim();
      setGradeResult(reply);
    } catch (e) {
      setGradeError(e instanceof Error ? e.message : t('AI 処理に失敗したよ'));
    } finally {
      setGrading(false);
    }
  };

  const show = revealAll || revealed || submitted;

  const header = (
    <div className="qa-question">
      <input
        type="checkbox"
        className="qa-checkbox"
        checked={!!pair.checked}
        onChange={onToggleChecked}
      />
      <span className="qa-num">{index + 1}</span>
      <span className="qa-question-text">
        <R src={kind === 'choice' ? parseChoice(pair.q).stem : pair.q} strip />
      </span>
    </div>
  );

  // ── multiple choice ──
  if (kind === 'choice') {
    const LBL = 'ABCDEFGH';
    const stripMark = (s: string) =>
      s.replace(/^\s*(?:[A-Ha-hア-ク①-⑧]|[0-9０-９]+)\s*[.)）.、:：]\s*/, '').trim();
    const raw = (pair.opts && pair.opts.length >= 2)
      ? pair.opts
      : parseChoice(pair.q).options.map(o => `${o.label}. ${o.text}`);
    const options = raw.map(stripMark).filter(Boolean);
    if (options.length >= 2) {
      const a = pair.a.trim();
      const lblIdx = (() => {
        const m = a.match(/^\s*([A-Ha-h])\b/);
        if (m) return LBL.indexOf(m[1].toUpperCase());
        const nm = a.match(/^\s*([0-9０-９]+)/);
        if (nm) return Number(nm[1].replace(/[０-９]/g, d => String('０１２３４５６７８９'.indexOf(d)))) - 1;
        return -1;
      })();
      let correctIdx = lblIdx >= 0 && lblIdx < options.length ? lblIdx : -1;
      if (correctIdx < 0) {
        correctIdx = options.findIndex(o =>
          norm(o) === norm(a) ||
          (norm(a).length >= 2 && (norm(o).includes(norm(a)) || norm(a).includes(norm(o)))));
      }
      const pickedIdx = picked == null ? -1 : Number(picked);
      const done = pickedIdx >= 0 || show;
      return (
        <div className={`qa-card ${pair.checked ? 'qa-card-checked' : ''}`}>
          {header}
          <div className="qa-opts">
            {options.map((o, oi) => {
              const isPicked = pickedIdx === oi;
              const isCorrect = correctIdx === oi;
              const state = done ? (isCorrect ? 'correct' : isPicked ? 'wrong' : '') : '';
              return (
                <button
                  key={oi}
                  className={`qa-opt ${state} ${isPicked ? 'picked' : ''}`}
                  disabled={pickedIdx >= 0 || revealAll}
                  onClick={() => setPicked(String(oi))}
                >
                  <b>{LBL[oi]}.</b> <R src={o} strip />
                </button>
              );
            })}
          </div>
          {done && (
            <div className="qa-feedback">
              {pickedIdx >= 0 && (pickedIdx === correctIdx
                ? <span className="ok">{t('正解！🎉')}</span>
                : <span className="ng">{t('不正解…')}</span>)}
              <span className="qa-ans">
                {t('答え:')} <R src={correctIdx >= 0 ? `${LBL[correctIdx]}. ${options[correctIdx]}` : pair.a} strip />
              </span>
            </div>
          )}
          <CardStyles />
        </div>
      );
    }
  }

  // ── ○ / × ──
  if (kind === 'truefalse') {
    const truth = answerBool(pair.a);
    return (
      <div className={`qa-card ${pair.checked ? 'qa-card-checked' : ''}`}>
        {header}
        <div className="qa-tf">
          {[{ v: true, t: '○' }, { v: false, t: '×' }].map(b => {
            const isPicked = tf === b.v;
            const state = (tf != null || show)
              ? truth === b.v ? 'correct' : isPicked ? 'wrong' : ''
              : '';
            return (
              <button
                key={b.t}
                className={`qa-tf-btn ${state} ${isPicked ? 'picked' : ''}`}
                disabled={tf != null || revealAll}
                onClick={() => setTf(b.v)}
              >
                {b.t}
              </button>
            );
          })}
        </div>
        {(tf != null || show) && (
          <div className="qa-feedback">
            {tf != null && (tf === truth
              ? <span className="ok">{t('正解！🎉')}</span>
              : <span className="ng">{t('不正解…')}</span>)}
            <span className="qa-ans">{t('答え:')} <R src={pair.a} strip /></span>
          </div>
        )}
        <CardStyles />
      </div>
    );
  }

  // ── fill in the blank ──
  if (kind === 'fill') {
    const parts = pair.q.split(/_{2,}|＿{2,}|〔\s*〕|（\s*）|\(\s*\)/);
    const blanks = parts.length - 1;
    if (blanks >= 1) {
      const answers = blanks > 1 ? splitItems(pair.a) : [pair.a.trim()];
      const check = () => setSubmitted(true);
      const ok = (i: number) =>
        !!fills[i] && norm(fills[i]) === norm(answers[i] || '');
      return (
        <div className={`qa-card ${pair.checked ? 'qa-card-checked' : ''}`}>
          <div className="qa-question">
            <input type="checkbox" className="qa-checkbox" checked={!!pair.checked} onChange={onToggleChecked} />
            <span className="qa-num">{index + 1}</span>
            <span className="qa-question-text qa-fill-line">
              {parts.map((p, i) => (
                <span key={i}>
                  <R src={p} strip />
                  {i < blanks && (
                    <input
                      className={`qa-fill-input ${submitted ? (ok(i) ? 'correct' : 'wrong') : ''}`}
                      value={fills[i] || ''}
                      disabled={submitted || revealAll}
                      onChange={e => {
                        const n = [...fills]; n[i] = e.target.value; setFills(n);
                      }}
                      onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') check(); }}
                      placeholder={t('？')}
                    />
                  )}
                </span>
              ))}
            </span>
          </div>
          <div className="qa-feedback">
            {!submitted && !revealAll && (
              <button className="qa-mini-btn" onClick={check}>{t('答え合わせ')}</button>
            )}
            {(submitted || show) && <span className="qa-ans">{t('答え:')} <R src={pair.a} strip /></span>}
          </div>
          <CardStyles />
        </div>
      );
    }
  }

  // ── reorder ──
  if (kind === 'order') {
    const stripMark = (s: string) =>
      s.replace(/^\s*(?:[A-Ha-hア-ク①-⑧]|[0-9０-９]+)\s*[.)）.、:：]\s*/, '').trim();
    const items = (pair.opts && pair.opts.length >= 2)
      ? pair.opts.map(stripMark).filter(Boolean)
      : splitItems(pair.q);
    const rawSeq = splitItems(pair.a).map(stripMark);
    // answer may reference items by number/label instead of repeating text
    const answerSeq = rawSeq.map(tok => {
      const n = tok.match(/^([0-9０-９]+)$/);
      if (n) {
        const idx = Number(tok.replace(/[０-９]/g, d => String('０１２３４５６７８９'.indexOf(d)))) - 1;
        if (idx >= 0 && idx < items.length) return items[idx];
      }
      if (/^[A-Ha-h]$/.test(tok)) {
        const idx = 'ABCDEFGH'.indexOf(tok.toUpperCase());
        if (idx >= 0 && idx < items.length) return items[idx];
      }
      return tok;
    });
    if (items.length >= 2) {
      const built = ordSel.map(i => items[i]);
      const correct =
        built.length === answerSeq.length &&
        built.every((x, i) => norm(x) === norm(answerSeq[i]));
      return (
        <div className={`qa-card ${pair.checked ? 'qa-card-checked' : ''}`}>
          {header}
          <div className="qa-order-tray">
            {built.length === 0
              ? <span className="qa-order-hint">{t('下の項目を正しい順にタップ')}</span>
              : built.map((x, i) => (
                  <span key={i} className="qa-order-chip filled">{i + 1}. {x}</span>
                ))}
          </div>
          <div className="qa-order-pool">
            {items.map((it, i) => (
              <button
                key={i}
                className="qa-order-chip"
                disabled={ordSel.includes(i) || revealAll}
                onClick={() => setOrdSel([...ordSel, i])}
              >
                {it}
              </button>
            ))}
          </div>
          <div className="qa-feedback">
            {ordSel.length > 0 && !revealAll && (
              <button className="qa-mini-btn" onClick={() => setOrdSel([])}>{t('リセット')}</button>
            )}
            {built.length === items.length && (
              correct
                ? <span className="ok">{t('正解！🎉')}</span>
                : <span className="ng">{t('不正解…')}</span>
            )}
            {(revealAll || built.length === items.length || revealed) && (
              <span className="qa-ans">{t('答え:')} <R src={pair.a} strip /></span>
            )}
            {!revealAll && built.length !== items.length && (
              <button className="qa-mini-btn ghost" onClick={() => setRevealed(true)}>{t('答えを見る')}</button>
            )}
          </div>
          <CardStyles />
        </div>
      );
    }
  }

  // ── flashcard (flip) ──
  if (kind === 'flash') {
    const open = flipped || revealAll;
    return (
      <div className={`qa-card ${pair.checked ? 'qa-card-checked' : ''}`}>
        <div className="qa-flash-head">
          <input type="checkbox" className="qa-checkbox" checked={!!pair.checked} onChange={onToggleChecked} />
          <span className="qa-num">{index + 1}</span>
        </div>
        <button
          className={`qa-flash ${open ? 'open' : ''}`}
          onClick={() => setFlipped(f => !f)}
          disabled={revealAll}
        >
          <span className="qa-flash-face"><R src={open ? pair.a : pair.q} /></span>
          <span className="qa-flash-tag">{open ? t('答え（タップで戻る）') : t('タップで答え')}</span>
        </button>
        <CardStyles />
      </div>
    );
  }

  // ── default qa: 記述採点AI + reveal ──
  return (
    <div className={`qa-card ${pair.checked ? 'qa-card-checked' : ''}`}>
      {header}
      {!revealAll && (
        <div className="qa-grade">
          <textarea
            className="qa-grade-input"
            value={myAnswer}
            onChange={e => setMyAnswer(e.target.value)}
            placeholder={t('自分の答えを書いてLilyに採点してもらおう…')}
            rows={2}
          />
          <div className="qa-grade-row">
            <button
              className="qa-grade-btn"
              onClick={() => void gradeMyAnswer()}
              disabled={grading || !myAnswer.trim()}
            >
              <Sparkles size={13} />
              {grading ? t('採点中…') : t('採点してもらう')}
            </button>
          </div>
          {gradeError && <div className="qa-grade-error">{gradeError}</div>}
          {gradeResult && (
            <div className="qa-grade-result"><R src={gradeResult} /></div>
          )}
        </div>
      )}
      {show ? (
        <div className="qa-answer-reveal">
          <span className="qa-ans-body"><R src={pair.a} /></span>
          {!revealAll && (
            <button className="qa-hide-btn" onClick={() => setRevealed(false)}>
              {t('隠す')}
            </button>
          )}
        </div>
      ) : (
        <button
          className="qa-answer-btn"
          onClick={() => setRevealed(true)}
        >
          {t('答えを見る ▶')}
        </button>
      )}
      <CardStyles />
    </div>
  );
}

function CardStyles() {
  return (
    <style jsx global>{`
      .qa-card { border: 1px solid color-mix(in srgb, var(--border) 60%, transparent); border-radius: 14px; overflow: hidden; background: var(--background); box-shadow: 0 1px 2px rgba(0,0,0,0.04), 0 4px 14px rgba(0,0,0,0.05); transition: box-shadow 0.18s, transform 0.18s; }
      .qa-card:hover { box-shadow: 0 2px 4px rgba(0,0,0,0.05), 0 8px 22px rgba(0,0,0,0.07); }
      .qa-card-checked { opacity: 0.55; }
      .qa-card-checked .qa-question-text { text-decoration: line-through; }
      .qa-question { padding: 14px 16px; display: flex; gap: 10px; align-items: flex-start; font-size: 0.95rem; line-height: 1.65; }
      .qa-checkbox { margin-top: 2px; width: 18px; height: 18px; border-radius: 6px; accent-color: var(--primary); flex-shrink: 0; cursor: pointer; }
      .qa-num { font-weight: 800; color: #fff; background: var(--primary); width: 1.5rem; height: 1.5rem; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 0.8rem; flex-shrink: 0; }
      .qa-question-text { color: var(--foreground); font-weight: 600; padding-top: 1px; }
      .qa-answer-btn { width: 100%; padding: 13px 16px; border: none; border-top: 1px solid color-mix(in srgb, var(--border) 55%, transparent); background: color-mix(in srgb, var(--accent) 55%, transparent); color: var(--primary); font-size: 0.9rem; font-weight: 700; text-align: left; cursor: pointer; transition: background 0.15s; font-family: inherit; line-height: 1.6; }
      .qa-answer-btn:hover { background: var(--accent); }
      .qa-grade { border-top: 1px solid color-mix(in srgb, var(--border) 55%, transparent); padding: 11px 14px 12px; display: flex; flex-direction: column; gap: 8px; }
      .qa-grade-input { width: 100%; box-sizing: border-box; resize: vertical; min-height: 40px; padding: 8px 10px; border: 1px solid color-mix(in srgb, var(--border) 70%, transparent); border-radius: 10px; background: var(--background); color: var(--foreground); font-family: inherit; font-size: 0.86rem; line-height: 1.55; outline: none; }
      .qa-grade-input:focus { border-color: var(--primary); }
      .qa-grade-row { display: flex; justify-content: flex-end; }
      .qa-grade-btn { display: inline-flex; align-items: center; gap: 5px; padding: 6px 13px; border: none; border-radius: 999px; background: var(--primary); color: #fff; font-size: 0.8rem; font-weight: 800; cursor: pointer; font-family: inherit; transition: filter 0.14s, opacity 0.14s; }
      .qa-grade-btn:hover:not(:disabled) { filter: brightness(1.06); }
      .qa-grade-btn:disabled { opacity: 0.5; cursor: default; }
      .qa-grade-error { font-size: 0.78rem; color: #dc2626; font-weight: 600; }
      .qa-grade-result { background: color-mix(in srgb, var(--primary) 9%, transparent); border: 1px solid color-mix(in srgb, var(--primary) 26%, transparent); border-radius: 10px; padding: 10px 12px; font-size: 0.85rem; line-height: 1.65; color: var(--foreground); white-space: pre-wrap; }
      .qa-answer-reveal { border-top: 1px solid color-mix(in srgb, var(--border) 55%, transparent); background: var(--accent); padding: 13px 16px; display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
      .qa-ans-body { flex: 1; font-size: 0.9rem; font-weight: 600; color: var(--foreground); line-height: 1.6; white-space: pre-wrap; }
      .qa-hide-btn { flex-shrink: 0; padding: 3px 10px; border-radius: 999px; border: 1px solid color-mix(in srgb, var(--border) 70%, transparent); background: transparent; color: var(--fg-muted, #999); font-size: 0.75rem; cursor: pointer; font-family: inherit; transition: background 0.14s; }
      .qa-hide-btn:hover { background: color-mix(in srgb, var(--border) 30%, transparent); }
      .qa-opts { display: flex; flex-direction: column; gap: 8px; padding: 0 16px 14px; }
      .qa-opt { text-align: left; padding: 11px 14px; border: 1.5px solid color-mix(in srgb, var(--border) 70%, transparent); border-radius: 12px; background: var(--background); color: var(--foreground); font-size: 0.9rem; cursor: pointer; font-family: inherit; line-height: 1.5; transition: border-color 0.14s, background 0.14s, transform 0.1s; }
      .qa-opt:hover:not(:disabled) { border-color: var(--primary); background: color-mix(in srgb, var(--accent) 50%, transparent); transform: translateY(-1px); }
      .qa-opt.picked { border-color: var(--primary); }
      .qa-opt.correct { background: #e8f7ee; border-color: #36b37e; color: #1a7a4d; }
      .qa-opt.wrong { background: #fdebeb; border-color: #e0584f; color: #b02a25; }
      .qa-opt:disabled { cursor: default; }
      .qa-tf { display: flex; gap: 12px; padding: 4px 16px 16px; }
      .qa-tf-btn { flex: 1; padding: 18px 0; font-size: 1.7rem; font-weight: 800; border: 1.5px solid color-mix(in srgb, var(--border) 70%, transparent); border-radius: 14px; background: var(--background); color: var(--foreground); cursor: pointer; transition: border-color 0.14s, background 0.14s, transform 0.1s; }
      .qa-tf-btn:hover:not(:disabled) { border-color: var(--primary); transform: translateY(-1px); }
      .qa-tf-btn.correct { background: #e8f7ee; border-color: #36b37e; color: #1a7a4d; }
      .qa-tf-btn.wrong { background: #fdebeb; border-color: #e0584f; color: #b02a25; }
      .qa-tf-btn:disabled { cursor: default; }
      .qa-feedback { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 11px 16px; border-top: 1px solid color-mix(in srgb, var(--border) 55%, transparent); background: color-mix(in srgb, var(--accent) 45%, transparent); font-size: 0.88rem; }
      .qa-feedback .ok { color: #1a7a4d; font-weight: 800; }
      .qa-feedback .ng { color: #b02a25; font-weight: 800; }
      .qa-ans { color: var(--foreground); font-weight: 600; }
      .qa-mini-btn { padding: 6px 16px; border-radius: 999px; border: none; background: var(--primary); color: #fff; font-size: 0.82rem; font-weight: 700; cursor: pointer; font-family: inherit; transition: opacity 0.14s; }
      .qa-mini-btn:hover { opacity: 0.88; }
      .qa-mini-btn.ghost { background: transparent; color: var(--primary); border: 1.5px solid var(--primary); }
      .qa-fill-line { display: inline; }
      .qa-fill-input { display: inline-block; width: 7em; margin: 0 4px; padding: 3px 8px; border: none; border-bottom: 2px solid var(--primary); border-radius: 6px 6px 0 0; background: color-mix(in srgb, var(--accent) 60%, transparent); color: var(--foreground); font-size: 0.9rem; font-family: inherit; outline: none; transition: background 0.14s; }
      .qa-fill-input:focus { background: var(--accent); }
      .qa-fill-input.correct { border-color: #36b37e; color: #1a7a4d; }
      .qa-fill-input.wrong { border-color: #e0584f; color: #b02a25; }
      .qa-order-tray { min-height: 44px; margin: 4px 16px 8px; padding: 8px; border: 1.5px dashed color-mix(in srgb, var(--primary) 45%, transparent); border-radius: 12px; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
      .qa-order-hint { color: var(--fg-muted); font-size: 0.82rem; padding: 0 6px; }
      .qa-order-pool { display: flex; flex-wrap: wrap; gap: 8px; padding: 0 16px 14px; }
      .qa-order-chip { padding: 8px 14px; border: 1.5px solid color-mix(in srgb, var(--border) 70%, transparent); border-radius: 999px; background: var(--background); color: var(--foreground); font-size: 0.88rem; cursor: pointer; font-family: inherit; transition: border-color 0.14s, transform 0.1s; }
      .qa-order-chip:hover:not(:disabled) { border-color: var(--primary); transform: translateY(-1px); }
      .qa-order-chip:disabled { opacity: 0.3; cursor: default; }
      .qa-order-chip.filled { background: var(--primary); border-color: var(--primary); color: #fff; cursor: default; font-weight: 700; }
      .qa-flash-head { padding: 12px 16px 0; display: flex; gap: 10px; align-items: center; }
      .qa-flash { width: 100%; min-height: 120px; padding: 26px 18px; border: none; border-top: 1px solid color-mix(in srgb, var(--border) 55%, transparent); background: linear-gradient(135deg, color-mix(in srgb, var(--accent) 40%, transparent), color-mix(in srgb, var(--accent) 75%, transparent)); color: var(--foreground); cursor: pointer; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; font-family: inherit; transition: background 0.2s, transform 0.12s; }
      .qa-flash:hover { transform: scale(1.005); }
      .qa-flash.open { background: linear-gradient(135deg, color-mix(in srgb, var(--primary) 14%, var(--background)), color-mix(in srgb, var(--primary) 26%, var(--background))); }
      .qa-flash-face { font-size: 1.2rem; font-weight: 800; text-align: center; line-height: 1.55; color: var(--foreground); }
      .qa-flash.open .qa-flash-face { color: var(--primary); }
      .qa-flash-tag { font-size: 0.72rem; color: var(--fg-muted); letter-spacing: 0.3px; text-transform: uppercase; font-weight: 700; }
    `}</style>
  );
}

export default function QAComponent({ node: { attrs }, updateAttributes, deleteNode, editor, getPos }: ReactNodeViewProps) {
  const t = useT();
  const pairs: QAPair[] = attrs.pairs || [];
  const kind: string = attrs.kind || 'qa';
  const kindLabel = KIND_LABEL[kind] || 'Q&A';
  const [isEditing, setIsEditing] = useState(pairs.length === 0);
  const [editKind, setEditKind] = useState(kind);
  const [qText, setQText] = useState('');
  const [aText, setAText] = useState('');
  const [revealAll, setRevealAll] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  function moveBlock(dir: 'up' | 'down') {
    if (!editor || typeof getPos !== 'function') return;
    const pos = (getPos as () => number | undefined)();
    if (pos === undefined) return;
    const { state } = editor;
    const { doc, tr } = state;
    const $pos = doc.resolve(pos);
    const index = $pos.index();
    const parent = $pos.parent;
    const curNode = doc.nodeAt(pos);
    if (!curNode) return;
    if (dir === 'up') {
      if (index === 0) return;
      const prevNode = parent.child(index - 1);
      const prevPos = pos - prevNode.nodeSize;
      tr.delete(prevPos, pos + curNode.nodeSize);
      tr.insert(prevPos, [curNode, prevNode]);
    } else {
      const nextPos = pos + curNode.nodeSize;
      if (index >= parent.childCount - 1) return;
      const nextNode = parent.child(index + 1);
      tr.delete(pos, nextPos + nextNode.nodeSize);
      tr.insert(pos, [nextNode, curNode]);
    }
    editor.view.dispatch(tr);
  }

  const KIND_PLACEHOLDER: Record<string, { q: string; a: string; hint?: string }> = {
    qa:        { q: '1. 日本の首都は？\n2. 光合成に必要なものは？', a: '1. 東京\n2. 光・水・二酸化炭素' },
    fill:      { q: '1. 日本の首都は＿＿だ。\n2. 光合成で___が作られる。', a: '1. 東京\n2. 酸素' },
    choice:    { q: '1. 日本の首都は？ A. 大阪 B. 東京 C. 名古屋\n2. 光合成で作られるものは？ A. 二酸化炭素 B. 窒素 C. 酸素', a: '1. B\n2. C',
                 hint: '問題文に選択肢を含めてください（例: A. 東京 B. 大阪 C. 名古屋）' },
    truefalse: { q: '1. 富士山は日本最高峰である。\n2. 東京は大阪より南にある。', a: '1. ○\n2. ×' },
    order:     { q: '1. 春 → 夏 → 秋 → 冬', a: '1. 春→夏→秋→冬', hint: '問題文に「→」で区切って順番を書き、答えに正しい順を指定してください' },
    flash:     { q: '1. 首都\n2. 光合成', a: '1. 東京\n2. 光でデンプンを作る反応' },
  };

  const handleInsert = () => {
    const questions = parseNumberedText(qText);
    const answers = parseNumberedText(aText);
    const newPairs: QAPair[] = questions.map((q, i) => ({
      q,
      a: answers[i] ?? '',
    }));
    if (newPairs.length === 0) return;
    updateAttributes({ pairs: newPairs, kind: editKind });
    setIsEditing(false);
    setRevealAll(false);
  };

  const toggleRevealAll = () => setRevealAll(v => !v);
  const checkedCount = pairs.filter(p => p.checked).length;

  if (isEditing) {
    const ph = KIND_PLACEHOLDER[editKind] ?? KIND_PLACEHOLDER.qa;
    return (
      <NodeViewWrapper className="qa-wrapper">
        <div className="qa-editor" contentEditable={false}>
          <div className="qa-editor-header">{t(KIND_LABEL[editKind] ?? editKind)} {t('読み込み')}</div>
          <div className="qa-editor-body">
            <label className="qa-label">{t('問題形式')}</label>
            <select
              className="qa-select"
              value={editKind}
              onChange={e => setEditKind(e.target.value)}
            >
              {Object.entries(KIND_LABEL).map(([v, l]) => (
                <option key={v} value={v}>{t(l)}</option>
              ))}
            </select>
            <label className="qa-label">{t('問題をペースト')}</label>
            <textarea
              className="qa-textarea"
              value={qText}
              onChange={e => setQText(e.target.value)}
              onKeyDown={e => e.stopPropagation()}
              onWheel={e => e.stopPropagation()}
              placeholder={t(ph.q)}
            />
            <label className="qa-label">{t('答えをペースト')}</label>
            <textarea
              className="qa-textarea"
              value={aText}
              onChange={e => setAText(e.target.value)}
              onKeyDown={e => e.stopPropagation()}
              onWheel={e => e.stopPropagation()}
              placeholder={t(ph.a)}
            />
          </div>
          <div className="qa-editor-actions">
            {pairs.length > 0 && (
              <button className="qa-btn-cancel" onClick={() => setIsEditing(false)}>
                {t('キャンセル')}
              </button>
            )}
            <button className="qa-btn-insert" onClick={handleInsert}>
              {t('挿入する')}
            </button>
          </div>
        </div>

        <style jsx>{`
          .qa-wrapper {
            margin: 1.5rem auto;
          }
          .qa-editor {
            border: 1px solid var(--border);
            border-radius: 12px;
            overflow: hidden;
            background: var(--accent);
          }
          .qa-editor-header {
            padding: 8px 14px;
            background: var(--muted);
            border-bottom: 1px solid var(--border);
            font-size: 0.75rem;
            font-weight: 700;
            color: var(--primary);
            text-transform: uppercase;
            letter-spacing: 0.5px;
          }
          .qa-editor-body {
            padding: 14px;
            display: flex;
            flex-direction: column;
            gap: 8px;
          }
          .qa-label {
            font-size: 0.8rem;
            font-weight: 600;
            color: var(--foreground);
            opacity: 0.7;
          }
          .qa-select {
            width: 100%;
            padding: 8px 12px;
            border: 1px solid var(--border);
            border-radius: 8px;
            background: var(--background);
            color: var(--foreground);
            font-size: 0.875rem;
            font-family: inherit;
            outline: none;
            cursor: pointer;
          }
          .qa-select:focus { border-color: var(--primary); }
          .qa-textarea {
            width: 100%;
            min-height: 64px;
            padding: 10px 12px;
            border: 1px solid var(--border);
            border-radius: 8px;
            background: var(--background);
            color: var(--foreground);
            font-size: 0.875rem;
            font-family: inherit;
            resize: vertical;
            outline: none;
            line-height: 1.6;
          }
          .qa-textarea:focus {
            border-color: var(--primary);
          }
          .qa-editor-actions {
            padding: 10px 14px;
            display: flex;
            justify-content: flex-end;
            gap: 8px;
            border-top: 1px solid var(--border);
          }
          .qa-btn-cancel {
            padding: 6px 16px;
            border-radius: 8px;
            border: 1px solid var(--border);
            background: transparent;
            color: var(--foreground);
            font-size: 0.85rem;
            cursor: pointer;
          }
          .qa-btn-insert {
            padding: 6px 16px;
            border-radius: 8px;
            border: none;
            background: var(--primary);
            color: white;
            font-size: 0.85rem;
            font-weight: 600;
            cursor: pointer;
          }
        `}</style>
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper className="qa-wrapper" data-drag-handle>
      <div className="qa-block" contentEditable={false}>
        <div className="qa-block-header">
          <span className="qa-block-drag" draggable data-drag-handle title="ドラッグして移動">
            <GripVertical size={14} />
          </span>
          <span className="qa-block-title">
            {t(kindLabel)} <span className="qa-count">{t('{n}問', { n: pairs.length })}</span>
            {checkedCount > 0 && (
              <span className={`qa-progress-badge${checkedCount === pairs.length ? ' done' : ''}`}>
                {t('{done}/{total} 完了', { done: checkedCount, total: pairs.length })}
              </span>
            )}
          </span>
          <div className="qa-block-header-actions">
            <button className="qa-move-btn" onClick={() => moveBlock('up')} title={t('上へ移動')}>↑</button>
            <button className="qa-move-btn" onClick={() => moveBlock('down')} title={t('下へ移動')}>↓</button>
            <button className="qa-action-btn" onClick={toggleRevealAll}>
              {revealAll ? t('答えを隠す') : t('答え合わせ')}
            </button>
            {confirmDelete ? (
              <>
                <button className="qa-action-btn qa-delete-confirm-btn" onClick={() => deleteNode()}>{t('削除する')}</button>
                <button className="qa-action-btn" onClick={() => setConfirmDelete(false)}>{t('キャンセル')}</button>
              </>
            ) : (
              <button className="qa-action-btn qa-delete-btn" onClick={() => setConfirmDelete(true)} title={t('削除')}>
                <Trash2 size={13} />
              </button>
            )}
            <button
              className="qa-action-btn"
              onClick={() => {
                setEditKind(kind);
                setQText(pairs.map((p, i) => `${i + 1}.${p.q}`).join('\n'));
                setAText(pairs.map((p, i) => `${i + 1}.${p.a}`).join('\n'));
                setIsEditing(true);
              }}
            >
              {t('編集')}
            </button>
          </div>
        </div>

        <div className="qa-cards">
          {pairs.map((pair, i) => (
            <QACard
              key={i}
              pair={pair}
              index={i}
              kind={kind}
              revealAll={revealAll}
              onToggleChecked={() => {
                const next = pairs.map((p, j) =>
                  j === i ? { ...p, checked: !p.checked } : p
                );
                updateAttributes({ pairs: next });
                window.dispatchEvent(new CustomEvent('qa-checkbox-toggled'));
              }}
            />
          ))}
        </div>
      </div>

      <style jsx>{`
        .qa-wrapper {
          margin: 1.5rem auto;
        }
        .qa-block {
          border: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
          border-radius: 18px;
          overflow: hidden;
          background: color-mix(in srgb, var(--accent) 45%, var(--background));
          box-shadow: 0 4px 20px rgba(0,0,0,0.06);
        }
        .qa-block-header {
          padding: 10px 14px;
          background: transparent;
          border-bottom: 1px solid color-mix(in srgb, var(--border) 45%, transparent);
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
        }
        .qa-block-title {
          font-size: 0.95rem;
          font-weight: 800;
          color: var(--primary);
          letter-spacing: 0.2px;
        }
        .qa-count {
          font-size: 0.8rem;
          font-weight: 600;
          opacity: 0.65;
          margin-left: 4px;
        }
        .qa-progress-badge {
          display: inline-block;
          margin-left: 8px;
          font-size: 0.74rem;
          font-weight: 700;
          background: color-mix(in srgb, var(--primary) 15%, transparent);
          color: var(--primary);
          border-radius: 99px;
          padding: 1px 8px;
        }
        .qa-progress-badge.done {
          background: #e8f7ee;
          color: #1a7a4d;
        }
        .qa-block-header-actions {
          display: flex;
          gap: 8px;
        }
        .qa-action-btn {
          padding: 6px 14px;
          border-radius: 999px;
          border: 1.5px solid color-mix(in srgb, var(--primary) 35%, transparent);
          background: var(--background);
          color: var(--primary);
          font-size: 0.8rem;
          font-weight: 700;
          cursor: pointer;
          transition: background 0.14s, transform 0.1s;
        }
        .qa-action-btn:hover {
          background: var(--accent);
          transform: translateY(-1px);
        }
        .qa-move-btn {
          display: inline-flex; align-items: center; justify-content: center;
          background: transparent; border: 1.5px solid color-mix(in srgb, var(--border) 80%, transparent);
          color: var(--foreground); border-radius: 999px; padding: 4px 8px;
          font-size: 0.8rem; cursor: pointer; opacity: 0.55; transition: opacity 0.14s;
        }
        .qa-move-btn:hover { opacity: 1; background: var(--accent); }
        .qa-delete-btn {
          padding: 6px 10px;
          color: #ef4444;
          border-color: rgba(239,68,68,.3);
        }
        .qa-delete-btn:hover { background: rgba(239,68,68,.08); }
        .qa-delete-confirm-btn {
          background: #ef4444 !important; color: #fff !important;
          border-color: #ef4444 !important;
        }
        .qa-block-drag {
          display: flex; align-items: center; padding: 4px 2px;
          color: #aaa; cursor: grab; flex-shrink: 0;
        }
        .qa-block-drag:active { cursor: grabbing; }
        .qa-cards {
          padding: 10px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
      `}</style>
    </NodeViewWrapper>
  );
}
