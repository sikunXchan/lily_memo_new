export type Plan = 'free' | 'plus' | 'pro' | 'developer';

export const PLAN_ORDER: Plan[] = ['free', 'plus', 'pro', 'developer'];

export const PLAN_DAILY_POINTS: Record<Plan, number> = {
  free: 500,
  plus: 1000,
  pro: 1500,
  developer: 10000,
};

export const PLAN_PRICE_YEN: Record<Plan, number> = {
  free: 0,
  plus: 30,
  pro: 100,
  developer: 750,
};

export const PLAN_LABEL: Record<Plan, string> = {
  free: 'Free',
  plus: 'Plus',
  pro: 'Pro',
  developer: 'Developer',
};

// Point costs per call type
export const PT = {
  lite: 20,      // gemini-3.1-flash-lite
  flash: 50,     // gemini-3.5-flash
  thinking: 70,  // flash + thinkingBudget
  ultra: 200,    // gemini-3.1-pro-preview
} as const;

const UNLOCK_PASSWORD = '4934';
const KEY_PLAN = 'lily-plan';
const KEY_DATE = 'lily-pts-date';
const KEY_USED = 'lily-pts-used';

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export function getPlan(): Plan {
  if (typeof window === 'undefined') return 'free';
  return (localStorage.getItem(KEY_PLAN) as Plan) ?? 'free';
}

export function setPlan(plan: Plan): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(KEY_PLAN, plan);
}

export function canUpgradeTo(plan: Plan): boolean {
  const currentIdx = PLAN_ORDER.indexOf(getPlan());
  const targetIdx = PLAN_ORDER.indexOf(plan);
  return targetIdx > currentIdx;
}

export function tryUnlockWithPassword(password: string, targetPlan: Plan): boolean {
  if (password !== UNLOCK_PASSWORD) return false;
  if (!canUpgradeTo(targetPlan)) return false;
  setPlan(targetPlan);
  return true;
}

function resetIfNewDay(): void {
  const t = todayStr();
  if (localStorage.getItem(KEY_DATE) !== t) {
    localStorage.setItem(KEY_DATE, t);
    localStorage.setItem(KEY_USED, '0');
  }
}

export function getPointsUsedToday(): number {
  if (typeof window === 'undefined') return 0;
  resetIfNewDay();
  return parseInt(localStorage.getItem(KEY_USED) ?? '0', 10);
}

export function getRemainingPoints(): number {
  return Math.max(0, PLAN_DAILY_POINTS[getPlan()] - getPointsUsedToday());
}

export function canAfford(cost: number): boolean {
  return getRemainingPoints() >= cost;
}

export function deductPoints(cost: number): void {
  if (typeof window === 'undefined') return;
  resetIfNewDay();
  const used = getPointsUsedToday() + cost;
  localStorage.setItem(KEY_USED, String(used));
}
