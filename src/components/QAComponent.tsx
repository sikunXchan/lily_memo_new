'use client';

import { NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react';
import { useState } from 'react';

interface QAPair {
  q: string;
  a: string;
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

function answerLabel(a: string): string | null {
  const m = a.trim().match(/^([A-DＡ-Ｄa-d1-4１-４①-④ア-エ])/);
  return m ? m[1] : null;
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
  const [revealed, setRevealed] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [tf, setTf] = useState<boolean | null>(null);
  const [flipped, setFlipped] = useState(false);
  const [fills, setFills] = useState<string[]>([]);
  const [ordSel, setOrdSel] = useState<number[]>([]);
  const [submitted, setSubmitted] = useState(false);

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
        {kind === 'choice' ? parseChoice(pair.q).stem : pair.q}
      </span>
    </div>
  );

  // ── multiple choice ──
  if (kind === 'choice') {
    const { options } = parseChoice(pair.q);
    if (options.length >= 2) {
      const correct = answerLabel(pair.a);
      return (
        <div className={`qa-card ${pair.checked ? 'qa-card-checked' : ''}`}>
          {header}
          <div className="qa-opts">
            {options.map(o => {
              const isPicked = picked === o.label;
              const isCorrect = correct != null && norm(o.label) === norm(correct);
              const state = (show || picked)
                ? isCorrect ? 'correct' : isPicked ? 'wrong' : ''
                : '';
              return (
                <button
                  key={o.label}
                  className={`qa-opt ${state} ${isPicked ? 'picked' : ''}`}
                  disabled={picked != null || revealAll}
                  onClick={() => setPicked(o.label)}
                >
                  <b>{o.label}.</b> {o.text}
                </button>
              );
            })}
          </div>
          {(picked || show) && (
            <div className="qa-feedback">
              {picked && (norm(picked) === norm(correct || '')
                ? <span className="ok">正解！🎉</span>
                : <span className="ng">不正解…</span>)}
              <span className="qa-ans">答え: {pair.a}</span>
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
              ? <span className="ok">正解！🎉</span>
              : <span className="ng">不正解…</span>)}
            <span className="qa-ans">答え: {pair.a}</span>
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
        !!fills[i] && (norm(fills[i]) === norm(answers[i] || '') ||
          norm(answers[i] || '').includes(norm(fills[i])) && norm(fills[i]).length >= 2);
      return (
        <div className={`qa-card ${pair.checked ? 'qa-card-checked' : ''}`}>
          <div className="qa-question">
            <input type="checkbox" className="qa-checkbox" checked={!!pair.checked} onChange={onToggleChecked} />
            <span className="qa-num">{index + 1}</span>
            <span className="qa-question-text qa-fill-line">
              {parts.map((p, i) => (
                <span key={i}>
                  {p}
                  {i < blanks && (
                    <input
                      className={`qa-fill-input ${submitted ? (ok(i) ? 'correct' : 'wrong') : ''}`}
                      value={fills[i] || ''}
                      disabled={submitted || revealAll}
                      onChange={e => {
                        const n = [...fills]; n[i] = e.target.value; setFills(n);
                      }}
                      onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') check(); }}
                      placeholder="？"
                    />
                  )}
                </span>
              ))}
            </span>
          </div>
          <div className="qa-feedback">
            {!submitted && !revealAll && (
              <button className="qa-mini-btn" onClick={check}>答え合わせ</button>
            )}
            {(submitted || show) && <span className="qa-ans">答え: {pair.a}</span>}
          </div>
          <CardStyles />
        </div>
      );
    }
  }

  // ── reorder ──
  if (kind === 'order') {
    const items = splitItems(pair.q);
    const answerSeq = splitItems(pair.a);
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
              ? <span className="qa-order-hint">下の項目を正しい順にタップ</span>
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
              <button className="qa-mini-btn" onClick={() => setOrdSel([])}>リセット</button>
            )}
            {built.length === items.length && (
              correct
                ? <span className="ok">正解！🎉</span>
                : <span className="ng">不正解…</span>
            )}
            {(revealAll || built.length === items.length || revealed) && (
              <span className="qa-ans">答え: {pair.a}</span>
            )}
            {!revealAll && built.length !== items.length && (
              <button className="qa-mini-btn ghost" onClick={() => setRevealed(true)}>答えを見る</button>
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
          <span className="qa-flash-face">{open ? pair.a : pair.q}</span>
          <span className="qa-flash-tag">{open ? '答え（タップで戻る）' : 'タップで答え'}</span>
        </button>
        <CardStyles />
      </div>
    );
  }

  // ── default qa: reveal ──
  return (
    <div className={`qa-card ${pair.checked ? 'qa-card-checked' : ''}`}>
      {header}
      <button
        className={`qa-answer-btn ${show ? 'revealed' : ''}`}
        onClick={() => setRevealed(r => !r)}
      >
        {show ? pair.a : '答えを見る ▶'}
      </button>
      <CardStyles />
    </div>
  );
}

function CardStyles() {
  return (
    <style jsx>{`
      .qa-card { border: 1px solid var(--border); border-radius: 8px; overflow: hidden; background: var(--background); }
      .qa-card-checked { opacity: 0.5; }
      .qa-card-checked .qa-question-text { text-decoration: line-through; }
      .qa-question { padding: 10px 12px; display: flex; gap: 8px; align-items: flex-start; font-size: 0.9rem; line-height: 1.6; }
      .qa-checkbox { margin-top: 3px; width: 16px; height: 16px; accent-color: var(--primary); flex-shrink: 0; cursor: pointer; }
      .qa-num { font-weight: 700; color: var(--primary); min-width: 1.2em; flex-shrink: 0; }
      .qa-question-text { color: var(--foreground); }
      .qa-answer-btn { width: 100%; padding: 8px 12px; border: none; border-top: 1px solid var(--border); background: var(--muted); color: var(--foreground); font-size: 0.875rem; text-align: left; cursor: pointer; opacity: 0.6; transition: opacity 0.15s; font-family: inherit; line-height: 1.6; }
      .qa-answer-btn.revealed { opacity: 1; background: var(--accent); font-weight: 500; }
      .qa-answer-btn:hover { opacity: 1; }
      .qa-opts { display: flex; flex-direction: column; gap: 6px; padding: 0 12px 10px; }
      .qa-opt { text-align: left; padding: 8px 11px; border: 1px solid var(--border); border-radius: 7px; background: var(--background); color: var(--foreground); font-size: 0.875rem; cursor: pointer; font-family: inherit; line-height: 1.5; transition: all 0.12s; }
      .qa-opt:hover:not(:disabled) { border-color: var(--primary); }
      .qa-opt.picked { border-color: var(--primary); }
      .qa-opt.correct { background: #e7f6ec; border-color: #3aa76d; color: #1c6b41; }
      .qa-opt.wrong { background: #fdeaea; border-color: #d9534f; color: #a02b27; }
      .qa-opt:disabled { cursor: default; }
      .qa-tf { display: flex; gap: 10px; padding: 0 12px 10px; }
      .qa-tf-btn { flex: 1; padding: 12px 0; font-size: 1.4rem; font-weight: 700; border: 1px solid var(--border); border-radius: 8px; background: var(--background); color: var(--foreground); cursor: pointer; transition: all 0.12s; }
      .qa-tf-btn:hover:not(:disabled) { border-color: var(--primary); }
      .qa-tf-btn.correct { background: #e7f6ec; border-color: #3aa76d; color: #1c6b41; }
      .qa-tf-btn.wrong { background: #fdeaea; border-color: #d9534f; color: #a02b27; }
      .qa-tf-btn:disabled { cursor: default; }
      .qa-feedback { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 8px 12px; border-top: 1px solid var(--border); background: var(--muted); font-size: 0.85rem; }
      .qa-feedback .ok { color: #1c6b41; font-weight: 700; }
      .qa-feedback .ng { color: #a02b27; font-weight: 700; }
      .qa-ans { color: var(--foreground); opacity: 0.85; }
      .qa-mini-btn { padding: 4px 12px; border-radius: 6px; border: none; background: var(--primary); color: #fff; font-size: 0.8rem; font-weight: 600; cursor: pointer; font-family: inherit; }
      .qa-mini-btn.ghost { background: transparent; color: var(--primary); border: 1px solid var(--primary); }
      .qa-fill-line { display: inline; }
      .qa-fill-input { display: inline-block; width: 7em; margin: 0 3px; padding: 2px 6px; border: none; border-bottom: 2px solid var(--primary); background: var(--accent); color: var(--foreground); font-size: 0.875rem; font-family: inherit; outline: none; }
      .qa-fill-input.correct { border-color: #3aa76d; color: #1c6b41; }
      .qa-fill-input.wrong { border-color: #d9534f; color: #a02b27; }
      .qa-order-tray { min-height: 38px; margin: 0 12px 6px; padding: 6px; border: 1px dashed var(--border); border-radius: 7px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
      .qa-order-hint { color: var(--fg-muted); font-size: 0.8rem; padding: 0 4px; }
      .qa-order-pool { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 12px 10px; }
      .qa-order-chip { padding: 6px 11px; border: 1px solid var(--border); border-radius: 999px; background: var(--background); color: var(--foreground); font-size: 0.85rem; cursor: pointer; font-family: inherit; }
      .qa-order-chip:hover:not(:disabled) { border-color: var(--primary); }
      .qa-order-chip:disabled { opacity: 0.35; cursor: default; }
      .qa-order-chip.filled { background: var(--accent); border-color: var(--primary); cursor: default; }
      .qa-flash-head { padding: 8px 12px 0; display: flex; gap: 8px; align-items: center; }
      .qa-flash { width: 100%; min-height: 90px; padding: 18px 14px; border: none; border-top: 1px solid var(--border); background: var(--background); color: var(--foreground); cursor: pointer; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; font-family: inherit; transition: background 0.15s; }
      .qa-flash.open { background: var(--accent); }
      .qa-flash-face { font-size: 1.05rem; font-weight: 700; text-align: center; line-height: 1.5; }
      .qa-flash-tag { font-size: 0.72rem; color: var(--fg-muted); }
    `}</style>
  );
}

export default function QAComponent({ node: { attrs }, updateAttributes }: ReactNodeViewProps) {
  const pairs: QAPair[] = attrs.pairs || [];
  const kind: string = attrs.kind || 'qa';
  const kindLabel = KIND_LABEL[kind] || 'Q&A';
  const [isEditing, setIsEditing] = useState(pairs.length === 0);
  const [qText, setQText] = useState('');
  const [aText, setAText] = useState('');
  const [revealAll, setRevealAll] = useState(false);

  const handleInsert = () => {
    const questions = parseNumberedText(qText);
    const answers = parseNumberedText(aText);
    const newPairs: QAPair[] = questions.map((q, i) => ({
      q,
      a: answers[i] ?? '',
    }));
    if (newPairs.length === 0) return;
    updateAttributes({ pairs: newPairs });
    setIsEditing(false);
    setRevealAll(false);
  };

  const toggleRevealAll = () => setRevealAll(v => !v);

  if (isEditing) {
    return (
      <NodeViewWrapper className="qa-wrapper">
        <div className="qa-editor" contentEditable={false}>
          <div className="qa-editor-header">{kindLabel} 読み込み</div>
          <div className="qa-editor-body">
            <label className="qa-label">問題をペースト</label>
            <textarea
              className="qa-textarea"
              value={qText}
              onChange={e => setQText(e.target.value)}
              onKeyDown={e => e.stopPropagation()}
              onWheel={e => e.stopPropagation()}
              placeholder={'1.LSIとして挙げられるものは？2.次の問題...'}
            />
            <label className="qa-label">答えをペースト</label>
            <textarea
              className="qa-textarea"
              value={aText}
              onChange={e => setAText(e.target.value)}
              onKeyDown={e => e.stopPropagation()}
              onWheel={e => e.stopPropagation()}
              placeholder={'1.(例)プロセッサ2.立ち上げ...'}
            />
          </div>
          <div className="qa-editor-actions">
            {pairs.length > 0 && (
              <button className="qa-btn-cancel" onClick={() => setIsEditing(false)}>
                キャンセル
              </button>
            )}
            <button className="qa-btn-insert" onClick={handleInsert}>
              挿入する
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
          .qa-textarea {
            width: 100%;
            min-height: 100px;
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
    <NodeViewWrapper className="qa-wrapper">
      <div className="qa-block" contentEditable={false}>
        <div className="qa-block-header">
          <span className="qa-block-title">{kindLabel} <span className="qa-count">{pairs.length}問</span></span>
          <div className="qa-block-header-actions">
            <button className="qa-action-btn" onClick={toggleRevealAll}>
              {revealAll ? '答えを隠す' : '答え合わせ'}
            </button>
            <button
              className="qa-action-btn"
              onClick={() => {
                setQText(pairs.map((p, i) => `${i + 1}.${p.q}`).join('\n'));
                setAText(pairs.map((p, i) => `${i + 1}.${p.a}`).join('\n'));
                setIsEditing(true);
              }}
            >
              編集
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
          border: 1px solid var(--border);
          border-radius: 12px;
          overflow: hidden;
          background: var(--accent);
        }
        .qa-block-header {
          padding: 8px 14px;
          background: var(--muted);
          border-bottom: 1px solid var(--border);
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .qa-block-title {
          font-size: 0.75rem;
          font-weight: 700;
          color: var(--primary);
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .qa-count {
          font-weight: 400;
          opacity: 0.7;
        }
        .qa-block-header-actions {
          display: flex;
          gap: 6px;
        }
        .qa-action-btn {
          padding: 3px 10px;
          border-radius: 6px;
          border: 1px solid var(--border);
          background: var(--background);
          color: var(--foreground);
          font-size: 0.75rem;
          cursor: pointer;
        }
        .qa-cards {
          padding: 10px 14px;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
      `}</style>
    </NodeViewWrapper>
  );
}
