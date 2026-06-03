// The user's study profile: drives tyakun's greeting, the progress widget,
// and the "daily goal" badge. Stored in localStorage (offline, no sync needed).

export interface StudyProfile {
  dailyGoalHours: number;   // target hours per day
  subjects: string[];       // what they're studying
  goalText: string;         // free-text goal, e.g. "宅建合格"
  goalDate: string;         // YYYY-MM-DD target date, '' if none
}

const LS_KEY = 'lily_study_profile';

export const DEFAULT_PROFILE: StudyProfile = {
  dailyGoalHours: 2,
  subjects: [],
  goalText: '',
  goalDate: '',
};

export function getStudyProfile(): StudyProfile {
  if (typeof window === 'undefined') return { ...DEFAULT_PROFILE };
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { ...DEFAULT_PROFILE };
    const parsed = JSON.parse(raw) as Partial<StudyProfile>;
    return { ...DEFAULT_PROFILE, ...parsed };
  } catch {
    return { ...DEFAULT_PROFILE };
  }
}

export function saveStudyProfile(profile: StudyProfile): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(LS_KEY, JSON.stringify(profile));
  window.dispatchEvent(new Event('lily-settings-changed'));
}

/** Days remaining until the goal date (null if no date / already passed today). */
export function daysUntilGoal(profile: StudyProfile): number | null {
  if (!profile.goalDate) return null;
  const target = new Date(profile.goalDate + 'T00:00:00');
  if (isNaN(target.getTime())) return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((target.getTime() - today.getTime()) / 86400000);
  return diff;
}
