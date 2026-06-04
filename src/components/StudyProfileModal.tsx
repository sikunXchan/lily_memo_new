'use client';

import { useState } from 'react';
import { X, Minus, Plus } from 'lucide-react';
import { getStudyProfile, saveStudyProfile } from '@/lib/studyProfile';

interface Props { onClose: () => void; }

export default function StudyProfileModal({ onClose }: Props) {
  const init = getStudyProfile();
  const [weekdayHours, setWeekdayHours] = useState(init.weekdayGoalHours);
  const [holidayHours, setHolidayHours] = useState(init.holidayGoalHours);
  const [subjects, setSubjects] = useState(init.subjects.join('、'));
  const [goalText, setGoalText] = useState(init.goalText);
  const [goalDate, setGoalDate] = useState(init.goalDate);

  const clampHalf = (h: number) => Math.max(0, Math.round(h * 2) / 2);

  const save = () => {
    const weekday = clampHalf(weekdayHours);
    const holiday = clampHalf(holidayHours);
    saveStudyProfile({
      dailyGoalHours: weekday,
      weekdayGoalHours: weekday,
      holidayGoalHours: holiday,
      subjects: subjects.split(/[、,]/).map(s => s.trim()).filter(Boolean),
      goalText: goalText.trim(),
      goalDate,
    });
    onClose();
  };

  return (
    <div className="pm-overlay" onClick={onClose}>
      <div className="pm-card" onClick={e => e.stopPropagation()}>
        <div className="pm-header">
          <span className="pm-title">🎯 勉強の目標</span>
          <button className="pm-close" onClick={onClose}><X size={20} /></button>
        </div>

        <div className="pm-body">
          <label className="pm-label">平日の目標時間</label>
          <div className="pm-stepper">
            <button onClick={() => setWeekdayHours(h => Math.max(0, Math.round((h - 0.5) * 2) / 2))}><Minus size={16} /></button>
            <span className="pm-hours">{weekdayHours} <small>時間</small></span>
            <button onClick={() => setWeekdayHours(h => Math.round((h + 0.5) * 2) / 2)}><Plus size={16} /></button>
          </div>

          <label className="pm-label">休日の目標時間</label>
          <div className="pm-stepper">
            <button onClick={() => setHolidayHours(h => Math.max(0, Math.round((h - 0.5) * 2) / 2))}><Minus size={16} /></button>
            <span className="pm-hours">{holidayHours} <small>時間</small></span>
            <button onClick={() => setHolidayHours(h => Math.round((h + 0.5) * 2) / 2)}><Plus size={16} /></button>
          </div>

          <label className="pm-label">勉強している科目（読点・カンマ区切り）</label>
          <input className="pm-input" value={subjects} onChange={e => setSubjects(e.target.value)} placeholder="例: 数学、英語、世界史" maxLength={120} />

          <label className="pm-label">目標（なにを目指してる？）</label>
          <input className="pm-input" value={goalText} onChange={e => setGoalText(e.target.value)} placeholder="例: 共通テスト、宅建合格" maxLength={40} />

          <label className="pm-label">目標の日付</label>
          <input className="pm-input" type="date" value={goalDate} onChange={e => setGoalDate(e.target.value)} />
        </div>

        <div className="pm-footer">
          <button className="pm-save" onClick={save}>保存する</button>
        </div>
      </div>

      <style jsx>{`
        .pm-overlay {
          position: fixed; inset: 0; z-index: 6700;
          background: rgba(0,0,0,0.55); backdrop-filter: blur(8px);
          display: flex; align-items: center; justify-content: center; padding: 18px;
        }
        .pm-card {
          background: var(--background); border: 1px solid var(--border);
          border-radius: 22px; width: 100%; max-width: 380px; overflow: hidden;
          box-shadow: 0 20px 60px rgba(0,0,0,0.4);
        }
        .pm-header { display: flex; align-items: center; justify-content: space-between; padding: 15px 16px; border-bottom: 1px solid var(--border); }
        .pm-title { font-weight: 900; font-size: 0.98rem; color: var(--foreground); }
        .pm-close { width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; border-radius: 8px; color: var(--fg-muted); cursor: pointer; }
        .pm-close:hover { background: var(--accent); }
        .pm-body { padding: 16px; display: flex; flex-direction: column; gap: 7px; }
        .pm-label { font-size: 0.78rem; font-weight: 800; color: var(--fg-muted); margin-top: 8px; }
        .pm-stepper { display: flex; align-items: center; gap: 14px; }
        .pm-stepper button { width: 38px; height: 38px; border-radius: 12px; border: 1px solid var(--border); background: var(--accent); color: var(--foreground); display: flex; align-items: center; justify-content: center; cursor: pointer; }
        .pm-stepper button:hover { border-color: var(--primary); }
        .pm-hours { font-size: 1.5rem; font-weight: 900; color: var(--foreground); min-width: 96px; text-align: center; }
        .pm-hours small { font-size: 0.82rem; font-weight: 700; color: var(--fg-muted); }
        .pm-input {
          width: 100%; box-sizing: border-box; padding: 11px 13px;
          border: 1px solid var(--border); border-radius: 12px;
          background: var(--accent); color: var(--foreground); font-size: 0.9rem;
        }
        .pm-input:focus { outline: none; border-color: var(--primary); }
        .pm-footer { padding: 0 16px 16px; }
        .pm-save { width: 100%; background: var(--primary); color: #fff; border: none; border-radius: 14px; padding: 13px; font-size: 0.95rem; font-weight: 800; cursor: pointer; }
        .pm-save:hover { opacity: 0.88; }
      `}</style>
    </div>
  );
}
