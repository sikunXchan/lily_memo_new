export type Plan = 'free' | 'plus' | 'pro' | 'max' | 'ultimate';

export const PLAN_ORDER: Plan[] = ['free', 'plus', 'pro', 'max', 'ultimate'];

export const PLAN_DAILY_POINTS: Record<Plan, number> = {
  free: 100,
  plus: 250,
  pro: 500,
  max: 750,
  ultimate: 1000,
};

export const PLAN_PRICE_YEN: Record<Plan, number> = {
  free: 0,
  plus: 100,
  pro: 200,
  max: 500,
  ultimate: 750,
};

export const PLAN_LABEL: Record<Plan, string> = {
  free: 'Free',
  plus: 'Plus',
  pro: 'Pro',
  max: 'Max',
  ultimate: 'Ultimate',
};

// Point costs per call type
export const PT = {
  lite: 20,      // gemini-3.1-flash-lite
  flash: 50,     // gemini-3.5-flash
  thinking: 70,  // flash + thinkingBudget
  ultra: 500,    // gemini-3.1-pro-preview
  // Task-based costs
  exercise: 100,  // 演習問題生成
  hardProblem: 500, // 鬼問題作成
  lesson: 50,     // 授業1セッション
} as const;

const UNLOCK_PASSWORD = '4934';
const KEY_PLAN = 'lily-plan';
const KEY_PLAN_MONTH = 'lily-plan-month'; // 'YYYY-MM' of when plan was set
const KEY_DATE = 'lily-pts-date';
const KEY_USED = 'lily-pts-used';

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function currentMonthStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// If we've entered a new calendar month, reset the plan to Free.
function resetPlanIfNewMonth(): void {
  const month = currentMonthStr();
  const stored = localStorage.getItem(KEY_PLAN_MONTH);
  if (stored && stored !== month) {
    localStorage.setItem(KEY_PLAN, 'free');
    localStorage.removeItem(KEY_PLAN_MONTH);
  }
}

export function getPlan(): Plan {
  if (typeof window === 'undefined') return 'free';
  resetPlanIfNewMonth();
  return (localStorage.getItem(KEY_PLAN) as Plan) ?? 'free';
}

export function setPlan(plan: Plan): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(KEY_PLAN, plan);
  // Record the month this plan was set so it auto-resets next month
  if (plan !== 'free') {
    localStorage.setItem(KEY_PLAN_MONTH, currentMonthStr());
  } else {
    localStorage.removeItem(KEY_PLAN_MONTH);
  }
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
