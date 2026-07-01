export type Plan = 'free' | 'plus' | 'pro' | 'max' | 'ultimate' | 'developer';

export const PLAN_ORDER: Plan[] = ['free', 'plus', 'pro', 'max', 'ultimate', 'developer'];

export const PLAN_DAILY_POINTS: Record<Plan, number> = {
  free: 100,
  plus: 250,
  pro: 500,
  max: 750,
  ultimate: 1000,
  developer: Number.MAX_SAFE_INTEGER,
};

export const PLAN_PRICE_YEN: Record<Plan, number> = {
  free: 0,
  plus: 100,
  pro: 200,
  max: 500,
  ultimate: 750,
  developer: 0,
};

export const PLAN_LABEL: Record<Plan, string> = {
  free: 'Free',
  plus: 'Plus',
  pro: 'Pro',
  max: 'Max',
  ultimate: 'Ultimate',
  developer: 'Developer',
};

// Point costs per call type
export const PT = {
  lite: 20,      // gemini-3.1-flash-lite
  flash: 50,     // gemini-3.5-flash
  thinking: 200, // flash + thinkingBudget
  ultra: 500,    // gemini-3.1-pro-preview
  // Task-based costs
  exercise: 100,  // 演習問題生成
  hardProblem: 500, // 鬼問題作成
  lesson: 50,     // 授業1セッション
} as const;

const PLAN_PASSWORDS: Partial<Record<Plan, string>> = {
  developer: 'sikun0120493',
};
const DEFAULT_UNLOCK_PASSWORD = '4934';
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

// If we've entered a new calendar month, reset the plan to Free (not for developer).
function resetPlanIfNewMonth(): void {
  const month = currentMonthStr();
  const stored = localStorage.getItem(KEY_PLAN_MONTH);
  if (stored && stored !== month) {
    const plan = localStorage.getItem(KEY_PLAN) as Plan | null;
    if (plan !== 'developer') {
      localStorage.setItem(KEY_PLAN, 'free');
      localStorage.removeItem(KEY_PLAN_MONTH);
    } else {
      localStorage.setItem(KEY_PLAN_MONTH, month);
    }
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
  const expected = PLAN_PASSWORDS[targetPlan] ?? DEFAULT_UNLOCK_PASSWORD;
  if (password !== expected) return false;
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

// Token-based surcharge applied post-call on top of the fixed base cost.
// Conversations within FREE_INPUT_TOKENS pay no surcharge.
// Large contexts (PDFs, very long histories) are charged proportionally.
export const FREE_INPUT_TOKENS = 16000;
export const PT_PER_1K_EXCESS_INPUT = 2;

export function calcTokenSurcharge(promptTokens: number): number {
  const excess = Math.max(0, promptTokens - FREE_INPUT_TOKENS);
  return Math.ceil(excess / 1000) * PT_PER_1K_EXCESS_INPUT;
}

// --- Elevated-mode daily tickets --------------------------------------------
// 思考モード / Ultra思考モード are gated by a small number of uses per day,
// separate from the point budget. Free plan can't use them at all. Free's
// 安定モード (the plain, non-lightweight response) is likewise capped to one
// use per day. Developer is unrestricted.
export type TicketMode = 'thinking' | 'ultra' | 'stable';

export const PLAN_THINKING_TICKETS: Record<Plan, number> = {
  free: 0,
  plus: 2,
  pro: 2,
  max: 2,
  ultimate: 2,
  developer: Number.MAX_SAFE_INTEGER,
};

export const PLAN_ULTRA_TICKETS: Record<Plan, number> = {
  free: 0,
  plus: 1,
  pro: 1,
  max: 1,
  ultimate: 1,
  developer: Number.MAX_SAFE_INTEGER,
};

export const PLAN_STABLE_TICKETS: Record<Plan, number> = {
  free: 1,
  plus: Number.MAX_SAFE_INTEGER,
  pro: Number.MAX_SAFE_INTEGER,
  max: Number.MAX_SAFE_INTEGER,
  ultimate: Number.MAX_SAFE_INTEGER,
  developer: Number.MAX_SAFE_INTEGER,
};

const TICKET_LIMITS: Record<TicketMode, Record<Plan, number>> = {
  thinking: PLAN_THINKING_TICKETS,
  ultra: PLAN_ULTRA_TICKETS,
  stable: PLAN_STABLE_TICKETS,
};

const KEY_TICKET_DATE = 'lily-tickets-date';
const KEY_TICKET_USED: Record<TicketMode, string> = {
  thinking: 'lily-tickets-used-thinking',
  ultra: 'lily-tickets-used-ultra',
  stable: 'lily-tickets-used-stable',
};

function resetTicketsIfNewDay(): void {
  const t = todayStr();
  if (localStorage.getItem(KEY_TICKET_DATE) !== t) {
    localStorage.setItem(KEY_TICKET_DATE, t);
    localStorage.setItem(KEY_TICKET_USED.thinking, '0');
    localStorage.setItem(KEY_TICKET_USED.ultra, '0');
    localStorage.setItem(KEY_TICKET_USED.stable, '0');
  }
}

export function getTicketLimit(mode: TicketMode): number {
  return TICKET_LIMITS[mode][getPlan()];
}

export function getTicketsUsedToday(mode: TicketMode): number {
  if (typeof window === 'undefined') return 0;
  resetTicketsIfNewDay();
  return parseInt(localStorage.getItem(KEY_TICKET_USED[mode]) ?? '0', 10);
}

export function getTicketsLeft(mode: TicketMode): number {
  return Math.max(0, getTicketLimit(mode) - getTicketsUsedToday(mode));
}

export function hasTicket(mode: TicketMode): boolean {
  return getTicketsLeft(mode) > 0;
}

export function consumeTicket(mode: TicketMode): void {
  if (typeof window === 'undefined') return;
  resetTicketsIfNewDay();
  const used = getTicketsUsedToday(mode) + 1;
  localStorage.setItem(KEY_TICKET_USED[mode], String(used));
}
