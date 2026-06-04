// The user's study profile: drives tyakun's greeting, the progress widget,
// and the "daily goal" badge. Stored in localStorage (offline, no sync needed).

export interface StudyProfile {
  dailyGoalHours: number;   // legacy field, kept in sync with the weekday goal
  weekdayGoalHours: number; // target hours on weekdays (Mon–Fri)
  holidayGoalHours: number; // target hours on weekends (Sat/Sun)
  subjects: string[];       // what they're studying
  goalText: string;         // free-text goal, e.g. "宅建合格"
  goalDate: string;         // YYYY-MM-DD target date, '' if none
}

const LS_KEY = 'lily_study_profile';

export const DEFAULT_PROFILE: StudyProfile = {
  dailyGoalHours: 2,
  weekdayGoalHours: 2,
  holidayGoalHours: 3,
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
    const merged = { ...DEFAULT_PROFILE, ...parsed };
    // Backfill the weekday/holiday goals from the legacy single goal for
    // profiles saved before they existed.
    if (parsed.weekdayGoalHours == null) {
      merged.weekdayGoalHours = parsed.dailyGoalHours ?? DEFAULT_PROFILE.weekdayGoalHours;
    }
    if (parsed.holidayGoalHours == null) {
      merged.holidayGoalHours = parsed.dailyGoalHours ?? DEFAULT_PROFILE.holidayGoalHours;
    }
    return merged;
  } catch {
    return { ...DEFAULT_PROFILE };
  }
}

export function saveStudyProfile(profile: StudyProfile): void {
  if (typeof window === 'undefined') return;
  // Keep the legacy field aligned with the weekday goal so older readers still work.
  const normalized: StudyProfile = { ...profile, dailyGoalHours: profile.weekdayGoalHours };
  localStorage.setItem(LS_KEY, JSON.stringify(normalized));
  window.dispatchEvent(new Event('lily-settings-changed'));
}

/** True if the given date falls on a weekend (Sat/Sun). */
export function isHolidayDate(date: Date = new Date()): boolean {
  const wd = date.getDay();
  return wd === 0 || wd === 6;
}

/** The goal hours that apply to a given date (weekend → holiday goal). */
export function goalHoursForDate(profile: StudyProfile, date: Date = new Date()): number {
  return isHolidayDate(date) ? profile.holidayGoalHours : profile.weekdayGoalHours;
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
