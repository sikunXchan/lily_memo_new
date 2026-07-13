'use client';

import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { X, Lock } from 'lucide-react';
import { db } from '@/lib/db';
import {
  BADGES, ROOMS, computeStudyStats, condProgress,
} from '@/lib/badges';
import type { BadgeDef, BadgeCondition } from '@/lib/badges';

const CONFETTI_COLORS = ['#f472b6', '#fcd34d', '#60a5fa', '#34d399', '#a78bfa', '#fb923c'];
const CONFETTI = Array.from({ length: 44 }, (_, i) => ({
  left: +((i * 137.508) % 100).toFixed(2),
  delay: +(((i * 13.7) % 10) / 16).toFixed(2),
  dur: +(1.8 + ((i * 29) % 14) / 10).toFixed(2),
  color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
  size: 7 + ((i * 7) % 7),
}));
import { getStudyProfile } from '@/lib/studyProfile';
import { useT } from '@/lib/i18n';

interface Props { onClose: () => void; }

type TFn = (key: string, params?: Record<string, string | number>) => string;

function formatRemaining(cond: BadgeCondition, cur: number, target: number, t: TFn): string {
  const left = Math.max(0, Math.ceil(target - cur));
  switch (cond.kind) {
    case 'totalHours':      return t('あと {n} 時間', { n: left });
    case 'dailyHours':      return t('あと {n} 時間（1日で）', { n: left });
    case 'streak':          return t('あと {n} 日連続', { n: left });
    case 'totalDays':       return t('あと {n} 日', { n: left });
    case 'daysSinceFirst':  return t('あと {n} 日', { n: left });
    case 'sessionMinutes':  return t('あと {n} 分（1回で）', { n: left });
    case 'pomodoroCount':   return t('あと {n} 回', { n: left });
    case 'categoriesInDay': return t('あと {n} 科目（1日で）', { n: left });
    case 'categoriesTotal': return t('あと {n} 科目', { n: left });
    case 'morningCount':    return t('あと {n} 日（朝活）', { n: left });
    case 'weekendCount':    return t('あと {n} 日（週末）', { n: left });
    case 'nightCount':      return t('あと {n} 日（深夜）', { n: left });
    case 'comeback':        return t('一度お休みしてから再開しよう');
    case 'morning':         return t('朝5〜8時に勉強しよう');
    case 'weekend':         return t('土日に勉強しよう');
    case 'goalMet':         return t('1日の目標を達成しよう');
    case 'badgePercent':    return t('いろんなバッジを集めよう');
  }
}

function fmtDate(ts: number, t: TFn): string {
  const d = new Date(ts);
  return t('{date} 獲得', { date: `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}` });
}

export default function TrophyRoom({ onClose }: Props) {
  const t = useT();
  const sessions = useLiveQuery(() => db.studySessions.filter(s => !s.deletedAt).toArray(), [], []);
  const earned = useLiveQuery(() => db.earnedBadges.toArray(), [], []);
  const profile = getStudyProfile();
  const [selected, setSelected] = useState<BadgeDef | null>(null);
  const [celebrate, setCelebrate] = useState<BadgeDef[]>([]);

  // On first open, consume any pending badge IDs stored by syncEarnedBadges.
  useEffect(() => {
    try {
      const raw = localStorage.getItem('lily_pending_badge_show');
      if (!raw) return;
      const ids: string[] = JSON.parse(raw);
      if (!ids.length) return;
      localStorage.removeItem('lily_pending_badge_show');
      const defs = ids.map(id => BADGES.find(b => b.id === id)).filter((b): b is BadgeDef => !!b);
      if (defs.length > 0) setCelebrate(defs);
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') { if (celebrate.length > 0) { setCelebrate(c => c.slice(1)); } else if (selected) setSelected(null); else onClose(); } };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [selected, celebrate, onClose]);

  const stats = computeStudyStats(sessions ?? [], { weekday: profile.weekdayGoalHours, holiday: profile.holidayGoalHours });
  const earnedMap = new Map(earned.map(e => [e.badgeId, e.earnedAt]));
  const totalEarned = BADGES.filter(b => earnedMap.has(b.id)).length;

  const selCur = selected ? condProgress(selected.cond, stats) : null;

  return (
    <div className="tr-overlay">
      {/* Header */}
      <div className="tr-header">
        <span className="tr-title">🏆 {t('エンブレムルーム')}</span>
        <span className="tr-count">{totalEarned} / {BADGES.length}</span>
        <button className="tr-close" onClick={onClose}><X size={20} /></button>
      </div>

      <div className="tr-scroll">
        {ROOMS.map(room => {
          const list = BADGES.filter(b => b.room === room.id).sort((a, b) => a.sort - b.sort);
          const got = list.filter(b => earnedMap.has(b.id)).length;
          return (
            <section key={room.id} className={`tr-room ${room.id}`}>
              <div className="tr-room-head">
                <span className="tr-room-name">{room.emoji} TIER {room.tier}</span>
                <span className="tr-room-count">{got} / {list.length}</span>
              </div>
              <div className="tr-grid">
                {list.map(b => {
                  const isEarned = earnedMap.has(b.id);
                  return (
                    <button
                      key={b.id}
                      className={`tr-badge ${isEarned ? 'earned' : 'locked'}`}
                      onClick={() => setSelected(b)}
                    >
                      <div className="tr-badge-img-wrap">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={b.image} alt={t(b.title)} draggable={false} />
                        {!isEarned && <span className="tr-lock"><Lock size={14} /></span>}
                      </div>
                      <span className="tr-badge-title">{isEarned ? t(b.title) : '？？？'}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
        <div className="tr-foot">{t('バッジをタップすると獲得条件が見られるよ')}</div>
      </div>

      {/* Detail popup */}
      {selected && (
        <div className="tr-detail" onClick={() => setSelected(null)}>
          <div className="tr-detail-card" onClick={e => e.stopPropagation()}>
            {(() => {
              const isEarned = earnedMap.has(selected.id);
              const [cur, target] = selCur!;
              const pct = target > 0 ? Math.min(100, (cur / target) * 100) : 0;
              return (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img className={`tr-detail-img ${isEarned ? '' : 'locked'}`} src={selected.image} alt={t(selected.title)} />
                  <p className="tr-detail-name">{isEarned ? t(selected.title) : '？？？'}</p>
                  <p className="tr-detail-desc">{t(selected.desc)}</p>
                  {isEarned ? (
                    <p className="tr-detail-earned">✅ {fmtDate(earnedMap.get(selected.id)!, t)}</p>
                  ) : (
                    <>
                      <div className="tr-detail-bar"><div className="tr-detail-fill" style={{ width: `${pct}%` }} /></div>
                      <p className="tr-detail-remain">{formatRemaining(selected.cond, cur, target, t)}</p>
                    </>
                  )}
                  <button className="tr-detail-close" onClick={() => setSelected(null)}>{t('閉じる')}</button>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* Badge celebration overlay */}
      {celebrate.length > 0 && (
        <div className="tr-celebrate" onClick={() => setCelebrate(c => c.slice(1))}>
          <div className="tr-confetti">
            {CONFETTI.map((c, i) => (
              <span
                key={i}
                style={{
                  left: `${c.left}%`,
                  width: `${c.size}px`,
                  height: `${c.size}px`,
                  background: c.color,
                  animationDelay: `${c.delay}s`,
                  animationDuration: `${c.dur}s`,
                }}
              />
            ))}
          </div>
          <div className="tr-celebrate-card" onClick={e => e.stopPropagation()}>
            <p className="tr-celebrate-title">🎉 {t('新しいバッジ獲得！')}</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="tr-celebrate-img" src={celebrate[0].image} alt={t(celebrate[0].title)} />
            <p className="tr-celebrate-name">{t(celebrate[0].title)}</p>
            <p className="tr-celebrate-desc">{t(celebrate[0].desc)}</p>
            {celebrate.length > 1 && <p className="tr-celebrate-more">{t('ほか {n} 個も獲得！', { n: celebrate.length - 1 })}</p>}
            <button className="tr-celebrate-ok" onClick={() => setCelebrate(c => c.slice(1))}>
              {celebrate.length > 1 ? t('次へ') : t('やったー！')}
            </button>
          </div>
        </div>
      )}

      <style jsx>{`
        .tr-overlay {
          position: fixed; inset: 0; z-index: 6500;
          background: var(--background);
          display: flex; flex-direction: column;
        }
        .tr-header {
          display: flex; align-items: center; gap: 12px;
          padding: 14px 16px; border-bottom: 1px solid var(--border); flex-shrink: 0;
        }
        .tr-title { font-weight: 900; font-size: 1rem; color: var(--foreground); }
        .tr-count { font-weight: 800; font-size: 0.84rem; color: var(--primary); background: color-mix(in srgb, var(--primary) 14%, transparent); border-radius: 99px; padding: 3px 12px; }
        .tr-close { margin-left: auto; width: 34px; height: 34px; display: flex; align-items: center; justify-content: center; border-radius: 9px; color: var(--fg-muted); cursor: pointer; }
        .tr-close:hover { background: var(--accent); }

        .tr-scroll { flex: 1; overflow-y: auto; padding: 14px; padding-bottom: 40px; }

        .tr-room { border-radius: 20px; padding: 14px; margin-bottom: 16px; border: 1px solid rgba(255,255,255,0.08); }
        .tr-room.kids  { background: linear-gradient(160deg, #ffe4ef, #e0f2fe); }
        .tr-room.hall  { background: linear-gradient(160deg, #fef3c7, #fde9c8 60%, #e7d3a8); }
        .tr-room.glory { background: linear-gradient(160deg, #1e1b4b, #3b0764 55%, #7c2d12); }
        .tr-room.lily  { background: linear-gradient(160deg, #2e1065, #6d28d9 50%, #be185d); }
        .tr-room.legend {
          background:
            radial-gradient(circle at 30% 20%, rgba(212,175,55,0.25), transparent 60%),
            linear-gradient(160deg, #0b0b12, #1a1228 45%, #3b0a0a);
          border-color: rgba(212,175,55,0.4);
          box-shadow: inset 0 0 40px rgba(212,175,55,0.15);
        }
        .tr-room-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
        .tr-room.kids .tr-room-name, .tr-room.hall .tr-room-name { color: #3b2f1a; }
        .tr-room.glory .tr-room-name, .tr-room.lily .tr-room-name, .tr-room.legend .tr-room-name { color: #fde68a; }
        .tr-room-name { font-weight: 900; font-size: 0.95rem; display: flex; align-items: center; gap: 7px; }
        .tr-tier {
          font-size: 0.66rem; font-weight: 900; letter-spacing: 0.08em;
          padding: 2px 8px; border-radius: 7px;
          background: rgba(0,0,0,0.28); color: #fde68a;
          border: 1px solid rgba(253,230,138,0.45);
        }
        .tr-room.kids .tr-tier, .tr-room.hall .tr-tier { background: rgba(255,255,255,0.6); color: #7c2d12; border-color: rgba(124,45,18,0.3); }
        .tr-room-count { font-weight: 800; font-size: 0.78rem; padding: 2px 10px; border-radius: 99px; background: rgba(255,255,255,0.55); color: #1e293b; }
        .tr-room.glory .tr-room-count, .tr-room.lily .tr-room-count, .tr-room.legend .tr-room-count { background: rgba(255,255,255,0.18); color: #fff; }

        .tr-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(88px, 1fr)); gap: 10px; }
        .tr-badge {
          display: flex; flex-direction: column; align-items: center; gap: 5px;
          background: rgba(255,255,255,0.45); border: none; border-radius: 14px;
          padding: 9px 5px; cursor: pointer; transition: transform 0.12s;
        }
        .tr-room.glory .tr-badge, .tr-room.lily .tr-badge, .tr-room.legend .tr-badge { background: rgba(255,255,255,0.08); }
        .tr-badge:hover { transform: translateY(-3px); }
        .tr-badge-img-wrap { position: relative; width: 64px; height: 64px; }
        .tr-badge-img-wrap img {
          width: 100%; height: 100%; object-fit: contain;
          -webkit-touch-callout: none; -webkit-user-select: none; user-select: none;
          pointer-events: none;
        }
        .tr-badge.locked img { filter: brightness(0) saturate(0); opacity: 0.32; }
        .tr-badge.earned img { filter: drop-shadow(0 2px 5px rgba(0,0,0,0.28)); }
        .tr-lock { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: rgba(80,80,80,0.85); }
        .tr-badge-title { font-size: 0.66rem; font-weight: 800; text-align: center; line-height: 1.25; color: #334155; word-break: break-word; }
        .tr-room.glory .tr-badge-title, .tr-room.lily .tr-badge-title, .tr-room.legend .tr-badge-title { color: #e9d5ff; }
        .tr-badge.locked .tr-badge-title { color: #94a3b8; }

        .tr-foot { text-align: center; font-size: 0.74rem; color: var(--fg-muted); padding: 8px 0 0; }

        .tr-detail {
          position: fixed; inset: 0; z-index: 6600;
          background: rgba(0,0,0,0.6); backdrop-filter: blur(6px);
          display: flex; align-items: center; justify-content: center; padding: 20px;
        }
        .tr-detail-card {
          background: var(--background); border: 1px solid var(--border);
          border-radius: 22px; padding: 24px 22px; text-align: center; max-width: 320px; width: 100%;
          box-shadow: 0 20px 60px rgba(0,0,0,0.4); animation: pop 0.25s cubic-bezier(.2,1.4,.4,1);
        }
        @keyframes pop { from { transform: scale(0.8); opacity: 0; } to { transform: scale(1); opacity: 1; } }
        .tr-detail-img {
          width: 150px; height: 150px; object-fit: contain;
          -webkit-touch-callout: none; -webkit-user-select: none; user-select: none; pointer-events: none;
        }
        .tr-detail-img.locked { filter: brightness(0) saturate(0); opacity: 0.3; }
        .tr-detail-name { font-size: 1.2rem; font-weight: 900; color: var(--foreground); margin: 10px 0 4px; }
        .tr-detail-desc { font-size: 0.86rem; color: var(--fg-muted); margin: 0 0 10px; line-height: 1.5; }
        .tr-detail-earned { font-size: 0.82rem; font-weight: 800; color: #10b981; margin: 0; }
        .tr-detail-bar { height: 9px; background: var(--accent); border-radius: 99px; overflow: hidden; margin: 4px 0 6px; }
        .tr-detail-fill { height: 100%; background: linear-gradient(90deg, var(--primary), color-mix(in srgb, var(--primary) 50%, #fff)); border-radius: 99px; }
        .tr-detail-remain { font-size: 0.82rem; font-weight: 800; color: var(--primary); margin: 0; }
        .tr-detail-close {
          margin-top: 16px; background: var(--accent); color: var(--foreground);
          border: 1px solid var(--border); border-radius: 13px; padding: 10px 26px;
          font-size: 0.88rem; font-weight: 800; cursor: pointer;
        }
        .tr-detail-close:hover { opacity: 0.85; }

        .tr-celebrate {
          position: fixed; inset: 0; z-index: 6700;
          background: rgba(0,0,0,0.65); backdrop-filter: blur(6px);
          display: flex; align-items: center; justify-content: center; padding: 20px;
        }
        .tr-confetti {
          position: absolute; inset: 0; overflow: hidden; pointer-events: none;
        }
        .tr-confetti span {
          position: absolute; top: -12px; border-radius: 3px;
          animation: tr-fall linear both;
        }
        @keyframes tr-fall {
          0%   { transform: translateY(0)    rotate(0deg);   opacity: 1; }
          80%  { opacity: 1; }
          100% { transform: translateY(105vh) rotate(720deg); opacity: 0; }
        }
        .tr-celebrate-card {
          position: relative; z-index: 1;
          background: var(--background); border: 1px solid var(--border);
          border-radius: 22px; padding: 24px 22px; text-align: center; max-width: 320px; width: 100%;
          box-shadow: 0 20px 60px rgba(0,0,0,0.5); animation: pop 0.25s cubic-bezier(.2,1.4,.4,1);
        }
        .tr-celebrate-title { font-size: 1rem; font-weight: 900; color: var(--foreground); margin: 0 0 12px; }
        .tr-celebrate-img {
          width: 130px; height: 130px; object-fit: contain;
          -webkit-touch-callout: none; -webkit-user-select: none; user-select: none; pointer-events: none;
          filter: drop-shadow(0 4px 12px rgba(0,0,0,0.25));
        }
        .tr-celebrate-name { font-size: 1.15rem; font-weight: 900; color: var(--foreground); margin: 10px 0 4px; }
        .tr-celebrate-desc { font-size: 0.84rem; color: var(--fg-muted); margin: 0 0 8px; line-height: 1.5; }
        .tr-celebrate-more { font-size: 0.8rem; font-weight: 800; color: var(--primary); margin: 0 0 8px; }
        .tr-celebrate-ok {
          margin-top: 12px; background: var(--primary); color: #fff;
          border: none; border-radius: 13px; padding: 11px 28px;
          font-size: 0.9rem; font-weight: 900; cursor: pointer;
        }
        .tr-celebrate-ok:hover { opacity: 0.88; }
      `}</style>
    </div>
  );
}
