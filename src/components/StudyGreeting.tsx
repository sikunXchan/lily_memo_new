'use client';

import { useEffect, useState, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Trophy, Pencil, Flame } from 'lucide-react';
import { db } from '@/lib/db';
import { computeStudyStats, syncEarnedBadges, BADGES } from '@/lib/badges';
import type { BadgeDef } from '@/lib/badges';
import { getStudyProfile, daysUntilGoal, goalHoursForDate, isHolidayDate } from '@/lib/studyProfile';
import type { StudyProfile } from '@/lib/studyProfile';

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtHM(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}時間${m > 0 ? m + '分' : ''}`;
  return `${m}分`;
}

const CONFETTI_COLORS = ['#f472b6', '#fcd34d', '#60a5fa', '#34d399', '#a78bfa', '#fb923c'];
// Deterministic spread (golden-angle style) so there's no impure Math.random in render.
const CONFETTI = Array.from({ length: 44 }, (_, i) => ({
  left: +((i * 137.508) % 100).toFixed(2),
  delay: +(((i * 13.7) % 10) / 16).toFixed(2),
  dur: +(1.8 + ((i * 29) % 14) / 10).toFixed(2),
  color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
  size: 7 + ((i * 7) % 7),
}));

interface Props {
  onOpenTrophy: () => void;
  onEditProfile: () => void;
}

export default function StudyGreeting({ onOpenTrophy, onEditProfile }: Props) {
  const sessions = useLiveQuery(() => db.studySessions.filter(s => !s.deletedAt).toArray(), [], []);
  const earnedCount = useLiveQuery(() => db.earnedBadges.count(), [], 0);
  const [profile, setProfile] = useState<StudyProfile>(getStudyProfile);
  const [celebrate, setCelebrate] = useState<BadgeDef[]>([]);
  const firstSync = useRef(true);

  useEffect(() => {
    const onCh = () => setProfile(getStudyProfile());
    window.addEventListener('lily-settings-changed', onCh);
    return () => window.removeEventListener('lily-settings-changed', onCh);
  }, []);

  // Reconcile earned badges whenever the data changes. The very first run after
  // mount persists existing history silently; later unlocks pop a celebration.
  const sig = `${sessions?.length ?? 0}:${sessions?.reduce((s, x) => s + x.duration, 0) ?? 0}`;
  useEffect(() => {
    let cancelled = false;
    void syncEarnedBadges().then(nb => {
      if (cancelled) return;
      if (nb.length > 0 && !firstSync.current) setCelebrate(prev => [...prev, ...nb]);
      firstSync.current = false;
    });
    return () => { cancelled = true; };
  }, [sig, profile.weekdayGoalHours, profile.holidayGoalHours]);

  const stats = computeStudyStats(sessions ?? [], { weekday: profile.weekdayGoalHours, holiday: profile.holidayGoalHours });
  const today = todayStr();
  const todaySec = (sessions ?? []).filter(s => s.date === today).reduce((s, x) => s + x.duration, 0);
  const todayGoalHours = goalHoursForDate(profile);
  const goalSec = todayGoalHours * 3600;
  const pct = goalSec > 0 ? Math.min(100, (todaySec / goalSec) * 100) : 0;
  const remainingSec = Math.max(0, goalSec - todaySec);
  const goalDone = goalSec > 0 && todaySec >= goalSec;

  const hour = new Date().getHours();
  const timeGreet = hour < 5 ? 'こんばんは🌙' : hour < 11 ? 'おはよう☀️' : hour < 17 ? 'こんにちは' : 'こんばんは🌙';

  const goalLine = goalDone
    ? '今日の目標、達成だ！えらすぎ🎉'
    : goalSec > 0
    ? `今日はあと ${fmtHM(remainingSec)} がんばろう！`
    : '今日も少しずつ積み上げよう！';

  const gd = daysUntilGoal(profile);
  const aimLine = profile.goalText
    ? gd != null && gd >= 0
      ? `「${profile.goalText}」まであと ${gd}日。いっしょに頑張ろう！`
      : `「${profile.goalText}」に向けて、今日も一歩！`
    : '';

  const mascot = goalDone ? '/sikun-dribble.gif' : '/sikun-book-read.png';

  return (
    <div className="sg-wrap">
      <div className="sg-card">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="sg-mascot" src={mascot} alt="sikun" draggable={false} />
        <div className="sg-body">
          <p className="sg-hi">{timeGreet}</p>
          <p className="sg-goal">{goalLine}</p>
          {aimLine && <p className="sg-aim">{aimLine}</p>}

          {/* today progress */}
          <div className="sg-prog">
            <div className="sg-prog-bar"><div className="sg-prog-fill" style={{ width: `${pct}%` }} /></div>
            <span className="sg-prog-label">
              今日 {fmtHM(todaySec)}{goalSec > 0 ? ` / ${isHolidayDate() ? '休日' : '平日'}目標 ${todayGoalHours}時間` : ''}
            </span>
          </div>

          <div className="sg-chips">
            {stats.currentStreak >= 2 && (
              <span className="sg-streak"><Flame size={13} /> {stats.currentStreak}日連続中</span>
            )}
            <button className="sg-btn" onClick={onOpenTrophy}>
              <Trophy size={14} /> トロフィー <b>{earnedCount}/{BADGES.length}</b>
            </button>
            <button className="sg-btn ghost" onClick={onEditProfile}>
              <Pencil size={13} /> 目標を編集
            </button>
          </div>
        </div>
      </div>

      {/* New badge celebration */}
      {celebrate.length > 0 && (
        <div className="sg-celebrate" onClick={() => setCelebrate([])}>
          <div className="sg-confetti">
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
          <div className="sg-celebrate-card" onClick={e => e.stopPropagation()}>
            <p className="sg-celebrate-title">🎉 新しいバッジ獲得！</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="sg-celebrate-img" src={celebrate[0].image} alt={celebrate[0].title} />
            <p className="sg-celebrate-name">{celebrate[0].title}</p>
            <p className="sg-celebrate-desc">{celebrate[0].desc}</p>
            {celebrate.length > 1 && <p className="sg-celebrate-more">ほか {celebrate.length - 1} 個も獲得！</p>}
            <button className="sg-celebrate-ok" onClick={() => setCelebrate(c => c.slice(1))}>
              {celebrate.length > 1 ? '次へ' : 'やったー！'}
            </button>
          </div>
        </div>
      )}

      <style jsx>{`
        .sg-wrap { padding: 12px 14px 0; }
        .sg-card {
          display: flex; gap: 12px; align-items: center;
          background: linear-gradient(135deg, color-mix(in srgb, var(--primary) 14%, var(--background)), var(--background));
          border: 1px solid var(--border); border-radius: 18px; padding: 14px;
        }
        .sg-mascot { width: 74px; height: 74px; object-fit: contain; flex-shrink: 0; }
        .sg-body { flex: 1; min-width: 0; }
        .sg-hi { font-size: 0.78rem; font-weight: 700; color: var(--fg-muted); margin: 0 0 2px; }
        .sg-goal { font-size: 1rem; font-weight: 800; color: var(--foreground); margin: 0 0 2px; line-height: 1.35; }
        .sg-aim { font-size: 0.78rem; color: var(--primary); font-weight: 700; margin: 0 0 8px; }
        .sg-prog { display: flex; align-items: center; gap: 8px; margin-bottom: 9px; }
        .sg-prog-bar { flex: 1; height: 8px; background: var(--accent); border-radius: 99px; overflow: hidden; }
        .sg-prog-fill { height: 100%; background: linear-gradient(90deg, var(--primary), color-mix(in srgb, var(--primary) 50%, #fff)); border-radius: 99px; transition: width 0.5s; }
        .sg-prog-label { font-size: 0.72rem; font-weight: 700; color: var(--fg-muted); white-space: nowrap; }
        .sg-chips { display: flex; flex-wrap: wrap; gap: 7px; align-items: center; }
        .sg-streak { display: inline-flex; align-items: center; gap: 3px; font-size: 0.74rem; font-weight: 800; color: #f97316; background: rgba(249,115,22,0.12); border-radius: 99px; padding: 4px 9px; }
        .sg-btn {
          display: inline-flex; align-items: center; gap: 5px;
          font-size: 0.76rem; font-weight: 800; cursor: pointer;
          background: var(--primary); color: #fff; border: none;
          border-radius: 99px; padding: 6px 12px;
        }
        .sg-btn b { font-weight: 800; }
        .sg-btn.ghost { background: var(--accent); color: var(--foreground); border: 1px solid var(--border); }
        .sg-btn:hover { opacity: 0.88; }

        .sg-celebrate {
          position: fixed; inset: 0; z-index: 7000;
          background: rgba(0,0,0,0.6); backdrop-filter: blur(6px);
          display: flex; align-items: center; justify-content: center; padding: 20px;
        }
        .sg-celebrate-card {
          position: relative; z-index: 1;
          background: var(--background); border: 1px solid var(--border);
          border-radius: 22px; padding: 24px 22px; text-align: center; max-width: 320px;
          box-shadow: 0 20px 60px rgba(0,0,0,0.4); animation: pop 0.3s cubic-bezier(.2,1.4,.4,1);
        }
        .sg-confetti { position: absolute; inset: 0; overflow: hidden; pointer-events: none; z-index: 0; }
        .sg-confetti span {
          position: absolute; top: -20px; border-radius: 2px;
          animation-name: confetti-fall; animation-timing-function: linear; animation-iteration-count: infinite;
        }
        @keyframes confetti-fall {
          0%   { transform: translateY(-20px) rotate(0deg);    opacity: 1; }
          100% { transform: translateY(105vh)  rotate(720deg); opacity: 0.85; }
        }
        @keyframes pop { from { transform: scale(0.7); opacity: 0; } to { transform: scale(1); opacity: 1; } }
        .sg-celebrate-title { font-size: 0.95rem; font-weight: 800; color: var(--primary); margin: 0 0 12px; }
        .sg-celebrate-img { width: 150px; height: 150px; object-fit: contain; animation: bob 1.6s ease-in-out infinite; }
        @keyframes bob { 0%,100%{transform:translateY(0) rotate(-2deg)} 50%{transform:translateY(-8px) rotate(2deg)} }
        .sg-celebrate-name { font-size: 1.15rem; font-weight: 900; color: var(--foreground); margin: 8px 0 4px; }
        .sg-celebrate-desc { font-size: 0.82rem; color: var(--fg-muted); margin: 0 0 6px; }
        .sg-celebrate-more { font-size: 0.76rem; color: var(--primary); font-weight: 700; margin: 0 0 8px; }
        .sg-celebrate-ok {
          margin-top: 8px; background: var(--primary); color: #fff; border: none;
          border-radius: 14px; padding: 11px 28px; font-size: 0.92rem; font-weight: 800; cursor: pointer;
        }
        .sg-celebrate-ok:hover { opacity: 0.88; }
      `}</style>
    </div>
  );
}
