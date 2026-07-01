export type Plan = 'free' | 'plus' | 'pro' | 'max' | 'ultimate' | 'developer';

export const PLAN_ORDER: Plan[] = ['free', 'plus', 'pro', 'max', 'ultimate', 'developer'];

// Daily token budget per plan — the same raw-token unit shown throughout the
// UI. Bumped up from the old flat-per-call point costs now that usage is
// billed against what a message actually consumed (see tokenCost below)
// rather than a fixed amount per call.
export const PLAN_DAILY_TOKENS: Record<Plan, number> = {
  free: 30_000,
  plus: 75_000,
  pro: 150_000,
  max: 225_000,
  ultimate: 300_000,
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

// A message's real token cost (input+output+thoughts, from the Gemini
// response's usageMetadata) is multiplied by this factor before being
// deducted from the daily token budget — pricier modes weigh more heavily
// per token actually used, instead of charging a flat amount per call
// regardless of how long the exchange was.
export type ResponseMode = 'lite' | 'stable' | 'thinking' | 'ultra';

export const MODE_MULTIPLIER: Record<ResponseMode, number> = {
  lite: 1,
  stable: 2,
  thinking: 10,
  ultra: 15,
};

export function tokenCost(actualTokens: number, mode: ResponseMode): number {
  return Math.ceil(Math.max(0, actualTokens) * MODE_MULTIPLIER[mode]);
}

export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return tokens.toLocaleString();
}

const PLAN_PASSWORDS: Partial<Record<Plan, string>> = {
  developer: 'sikun0120493',
};
const DEFAULT_UNLOCK_PASSWORD = '4934';
const KEY_PLAN = 'lily-plan';
const KEY_PLAN_MONTH = 'lily-plan-month'; // 'YYYY-MM' of when a paid plan was set
const KEY_DEV_DAY = 'lily-plan-dev-day'; // 'YYYY-MM-DD' Developer was last unlocked/confirmed
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

// Developer is a same-day trial: it reverts to Free the moment the date
// changes, so it must be re-unlocked with the password every day. Other paid
// plans (Plus/Pro/Max/Ultimate) instead reset to Free at the start of a new
// calendar month.
function resetPlanIfExpired(): void {
  const plan = localStorage.getItem(KEY_PLAN) as Plan | null;
  if (plan === 'developer') {
    if (localStorage.getItem(KEY_DEV_DAY) !== todayStr()) {
      localStorage.setItem(KEY_PLAN, 'free');
      localStorage.removeItem(KEY_DEV_DAY);
      localStorage.removeItem(KEY_PLAN_MONTH);
    }
    return;
  }
  const month = currentMonthStr();
  const stored = localStorage.getItem(KEY_PLAN_MONTH);
  if (stored && stored !== month) {
    localStorage.setItem(KEY_PLAN, 'free');
    localStorage.removeItem(KEY_PLAN_MONTH);
  }
}

export function getPlan(): Plan {
  if (typeof window === 'undefined') return 'free';
  resetPlanIfExpired();
  return (localStorage.getItem(KEY_PLAN) as Plan) ?? 'free';
}

export function setPlan(plan: Plan): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(KEY_PLAN, plan);
  if (plan === 'developer') {
    localStorage.setItem(KEY_DEV_DAY, todayStr());
    localStorage.removeItem(KEY_PLAN_MONTH);
  } else if (plan !== 'free') {
    localStorage.setItem(KEY_PLAN_MONTH, currentMonthStr());
    localStorage.removeItem(KEY_DEV_DAY);
  } else {
    localStorage.removeItem(KEY_PLAN_MONTH);
    localStorage.removeItem(KEY_DEV_DAY);
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

export function getTokensUsedToday(): number {
  if (typeof window === 'undefined') return 0;
  resetIfNewDay();
  return parseInt(localStorage.getItem(KEY_USED) ?? '0', 10);
}

export function getRemainingTokens(): number {
  return Math.max(0, PLAN_DAILY_TOKENS[getPlan()] - getTokensUsedToday());
}

// Real cost is only known after a call finishes (it depends on actual
// usage), so there's no way to pre-check "can this specific message be
// afforded" the way a flat per-call cost could. Instead, only block sending
// once the budget is already fully spent — a message that pushes the count
// past zero is still allowed to complete, and the next one is blocked.
export function hasTokenBudget(): boolean {
  return getRemainingTokens() > 0;
}

export function deductTokens(cost: number): void {
  if (typeof window === 'undefined') return;
  resetIfNewDay();
  const used = getTokensUsedToday() + cost;
  localStorage.setItem(KEY_USED, String(used));
}

// --- Elevated-mode daily tickets --------------------------------------------
// 思考モード / Ultra思考モード are gated by a small number of uses per day,
// separate from the token budget. Free plan can't use them at all. Free's
// 安定モード (the plain, non-lightweight response) is likewise capped to one
// use per day. Developer is unrestricted.
//
// 演習タブの問題作成・授業 are also ticket-gated (not token-metered) since
// their token cost varies too much per generation to budget sensibly.
export type TicketMode = 'thinking' | 'ultra' | 'stable' | 'exercise' | 'lesson';

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

// 演習タブ「Lilyに問題を作ってもらう」: Free は1日1回、それ以外の有料プランは1日2回。
export const PLAN_EXERCISE_TICKETS: Record<Plan, number> = {
  free: 1,
  plus: 2,
  pro: 2,
  max: 2,
  ultimate: 2,
  developer: Number.MAX_SAFE_INTEGER,
};

// 演習タブ「授業」: 全プラン共通で1日1回（Developerも例外なし）。
export const PLAN_LESSON_TICKETS: Record<Plan, number> = {
  free: 1,
  plus: 1,
  pro: 1,
  max: 1,
  ultimate: 1,
  developer: 1,
};

const TICKET_LIMITS: Record<TicketMode, Record<Plan, number>> = {
  thinking: PLAN_THINKING_TICKETS,
  ultra: PLAN_ULTRA_TICKETS,
  stable: PLAN_STABLE_TICKETS,
  exercise: PLAN_EXERCISE_TICKETS,
  lesson: PLAN_LESSON_TICKETS,
};

const KEY_TICKET_DATE = 'lily-tickets-date';
const KEY_TICKET_USED: Record<TicketMode, string> = {
  thinking: 'lily-tickets-used-thinking',
  ultra: 'lily-tickets-used-ultra',
  stable: 'lily-tickets-used-stable',
  exercise: 'lily-tickets-used-exercise',
  lesson: 'lily-tickets-used-lesson',
};

function resetTicketsIfNewDay(): void {
  const t = todayStr();
  if (localStorage.getItem(KEY_TICKET_DATE) !== t) {
    localStorage.setItem(KEY_TICKET_DATE, t);
    for (const key of Object.values(KEY_TICKET_USED)) {
      localStorage.setItem(key, '0');
    }
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
