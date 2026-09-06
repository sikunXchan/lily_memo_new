'use client';

import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { X, Trash2, Volume2, BookOpen, List as ListIcon, ChevronLeft, ChevronRight, Check } from 'lucide-react';
import { db, softDeleteNewsWord } from '@/lib/db';
import { useT } from '@/lib/i18n';

interface NewsWordbookModalProps {
  onClose: () => void;
}

function speak(word: string) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(word);
  utterance.lang = 'en-US';
  utterance.rate = 0.9;
  window.speechSynthesis.speak(utterance);
}

export default function NewsWordbookModal({ onClose }: NewsWordbookModalProps) {
  const t = useT();
  const [mode, setMode] = useState<'list' | 'cards'>('list');
  const [cardIndex, setCardIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);

  const wordsRaw = useLiveQuery(() => db.newsWordbook.filter(w => !w.deletedAt).toArray(), []) ?? [];
  const words = [...wordsRaw].sort((a, b) => b.createdAt - a.createdAt);

  const goCard = (dir: 1 | -1) => {
    setFlipped(false);
    setCardIndex(i => Math.max(0, Math.min(words.length - 1, i + dir)));
  };

  const toggleMastered = async (id: number, mastered: boolean) => {
    await db.newsWordbook.update(id, { mastered: !mastered, updatedAt: Date.now() });
  };

  const current = words[cardIndex];

  return (
    <div className="nwb-backdrop" onClick={onClose}>
      <div className="nwb-modal" onClick={e => e.stopPropagation()}>
        <div className="nwb-header">
          <h2>{t('単語帳')} ({words.length})</h2>
          <div className="nwb-header-actions">
            <button
              className={`nwb-mode-btn${mode === 'list' ? ' active' : ''}`}
              onClick={() => setMode('list')}
              title={t('一覧')}
            ><ListIcon size={16} /></button>
            <button
              className={`nwb-mode-btn${mode === 'cards' ? ' active' : ''}`}
              onClick={() => { setMode('cards'); setCardIndex(0); setFlipped(false); }}
              title={t('フラッシュカード')}
              disabled={words.length === 0}
            ><BookOpen size={16} /></button>
            <button className="nwb-close" onClick={onClose}><X size={18} /></button>
          </div>
        </div>

        {words.length === 0 ? (
          <div className="nwb-empty">{t('ニュース記事の単語をタップすると、ここに保存されます')}</div>
        ) : mode === 'list' ? (
          <div className="nwb-list">
            {words.map(w => (
              <div key={w.id} className="nwb-row">
                <div className="nwb-row-main">
                  <div className="nwb-row-top">
                    <span className="nwb-row-word">{w.word}</span>
                    {w.phonetic && <span className="nwb-row-phonetic">{w.phonetic}</span>}
                    <button className="nwb-row-icon" onClick={() => speak(w.word)}><Volume2 size={14} /></button>
                  </div>
                  <p className="nwb-row-meaning">{w.meaning}</p>
                </div>
                <div className="nwb-row-actions">
                  <button
                    className={`nwb-mastered-btn${w.mastered ? ' active' : ''}`}
                    onClick={() => toggleMastered(w.id!, w.mastered)}
                    title={t('覚えた')}
                  ><Check size={14} /></button>
                  <button className="nwb-delete-btn" onClick={() => softDeleteNewsWord(w.id!)} title={t('削除')}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : current ? (
          <div className="nwb-cards">
            <div className={`nwb-flashcard${flipped ? ' flipped' : ''}`} onClick={() => setFlipped(f => !f)}>
              <div className="nwb-flashcard-face nwb-flashcard-front">
                <span className="nwb-flashcard-word">{current.word}</span>
                {current.phonetic && <span className="nwb-flashcard-phonetic">{current.phonetic}</span>}
                <span className="nwb-flashcard-hint">{t('タップして意味を見る')}</span>
              </div>
              <div className="nwb-flashcard-face nwb-flashcard-back">
                <span className="nwb-flashcard-meaning">{current.meaning}</span>
                {current.techContext && <p className="nwb-flashcard-context">{current.techContext}</p>}
              </div>
            </div>
            <div className="nwb-cards-nav">
              <button className="nwb-nav-btn" onClick={() => goCard(-1)} disabled={cardIndex === 0}><ChevronLeft size={18} /></button>
              <span className="nwb-cards-count">{cardIndex + 1} / {words.length}</span>
              <button className="nwb-nav-btn" onClick={() => goCard(1)} disabled={cardIndex === words.length - 1}><ChevronRight size={18} /></button>
            </div>
          </div>
        ) : null}
      </div>

      <style jsx>{`
        .nwb-backdrop {
          position: fixed; inset: 0; z-index: 9100;
          background: rgba(0,0,0,0.45);
          display: flex; align-items: center; justify-content: center; padding: 16px;
        }
        .nwb-modal {
          width: 100%; max-width: 480px; max-height: 82vh;
          background: var(--background); border-radius: 20px;
          padding: 18px; display: flex; flex-direction: column; gap: 14px;
          box-shadow: 0 8px 40px rgba(0,0,0,0.35);
        }
        .nwb-header { display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; }
        .nwb-header h2 { font-size: 1.05rem; font-weight: 800; color: var(--foreground); margin: 0; }
        .nwb-header-actions { display: flex; align-items: center; gap: 6px; }
        .nwb-mode-btn, .nwb-close {
          width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;
          background: var(--accent); border: 1px solid var(--border); border-radius: 8px;
          color: var(--foreground); cursor: pointer;
        }
        .nwb-mode-btn.active { background: var(--primary); color: #fff; border-color: var(--primary); }
        .nwb-mode-btn:disabled { opacity: 0.4; cursor: default; }
        .nwb-empty { text-align: center; color: #888; font-size: 0.85rem; padding: 40px 10px; }
        .nwb-list { overflow-y: auto; display: flex; flex-direction: column; gap: 8px; }
        .nwb-row {
          display: flex; align-items: center; justify-content: space-between; gap: 10px;
          background: var(--accent); border-radius: 12px; padding: 10px 12px;
        }
        .nwb-row-main { min-width: 0; flex: 1; }
        .nwb-row-top { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
        .nwb-row-word { font-weight: 800; color: var(--foreground); font-size: 0.95rem; }
        .nwb-row-phonetic { font-size: 0.72rem; color: #888; }
        .nwb-row-icon { background: none; border: none; color: var(--primary); cursor: pointer; padding: 2px; display: flex; }
        .nwb-row-meaning { margin: 2px 0 0; font-size: 0.82rem; color: var(--foreground); }
        .nwb-row-actions { display: flex; gap: 4px; flex-shrink: 0; }
        .nwb-mastered-btn, .nwb-delete-btn {
          width: 28px; height: 28px; display: flex; align-items: center; justify-content: center;
          background: var(--background); border: 1px solid var(--border); border-radius: 7px;
          color: var(--foreground); cursor: pointer;
        }
        .nwb-mastered-btn.active { background: #22c55e; color: #fff; border-color: #22c55e; }
        .nwb-delete-btn:hover { background: #fee2e2; color: #ef4444; border-color: #fecaca; }
        .nwb-cards { display: flex; flex-direction: column; align-items: center; gap: 16px; padding: 8px 0; }
        .nwb-flashcard {
          width: 100%; max-width: 340px; height: 200px; position: relative;
          cursor: pointer; perspective: 1000px;
        }
        .nwb-flashcard-face {
          position: absolute; inset: 0; border-radius: 16px;
          display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px;
          padding: 20px; text-align: center; backface-visibility: hidden;
          transition: transform 0.4s; border: 1px solid var(--border);
        }
        .nwb-flashcard-front { background: var(--accent); }
        .nwb-flashcard-back { background: var(--primary); color: #fff; transform: rotateY(180deg); }
        .nwb-flashcard.flipped .nwb-flashcard-front { transform: rotateY(180deg); }
        .nwb-flashcard.flipped .nwb-flashcard-back { transform: rotateY(360deg); }
        .nwb-flashcard-word { font-size: 1.6rem; font-weight: 800; color: var(--foreground); }
        .nwb-flashcard-phonetic { font-size: 0.85rem; color: #888; }
        .nwb-flashcard-hint { font-size: 0.72rem; color: #aaa; margin-top: 6px; }
        .nwb-flashcard-meaning { font-size: 1.3rem; font-weight: 800; }
        .nwb-flashcard-context { font-size: 0.8rem; opacity: 0.9; margin: 0; }
        .nwb-cards-nav { display: flex; align-items: center; gap: 14px; }
        .nwb-nav-btn {
          width: 36px; height: 36px; display: flex; align-items: center; justify-content: center;
          background: var(--accent); border: 1px solid var(--border); border-radius: 50%;
          color: var(--foreground); cursor: pointer;
        }
        .nwb-nav-btn:disabled { opacity: 0.35; cursor: default; }
        .nwb-cards-count { font-size: 0.85rem; font-weight: 700; color: var(--foreground); }
      `}</style>
    </div>
  );
}
