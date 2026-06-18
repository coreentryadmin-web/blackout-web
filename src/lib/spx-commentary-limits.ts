import { dbConfigured, getMeta, setMeta } from "@/lib/db";

const MIN_INTERVAL_MS = Number(process.env.SPX_COMMENTARY_MIN_INTERVAL_MS ?? 55_000);
const DAILY_CAP = Number(process.env.SPX_COMMENTARY_DAILY_CAP ?? 80);

type BudgetRow = { date: string; count: number };

function todayEt(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}

const lastCallByUser = new Map<string, number>();

function budgetKey(userId: string): string {
  return `spx_commentary_budget:${userId}:${todayEt()}`;
}

async function readBudget(userId: string): Promise<BudgetRow> {
  const today = todayEt();
  const key = budgetKey(userId);
  if (dbConfigured()) {
    const raw = await getMeta(key);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as BudgetRow;
        if (parsed.date === today) return { date: today, count: parsed.count ?? 0 };
      } catch {
        /* fresh */
      }
    }
  }
  return { date: today, count: 0 };
}

async function incrementBudget(userId: string): Promise<BudgetRow> {
  const current = await readBudget(userId);
  const next = { date: current.date, count: current.count + 1 };
  if (dbConfigured()) {
    await setMeta(budgetKey(userId), JSON.stringify(next));
  }
  return next;
}

export type CommentaryLimitResult =
  | { ok: true }
  | { ok: false; status: 429 | 503; error: string; retry_after_sec?: number };

/** Per-user throttle + daily Anthropic call cap for commentary. */
export async function checkCommentaryLimits(userId: string): Promise<CommentaryLimitResult> {
  const now = Date.now();
  const last = lastCallByUser.get(userId) ?? 0;
  const elapsed = now - last;
  if (elapsed < MIN_INTERVAL_MS) {
    return {
      ok: false,
      status: 429,
      error: "Commentary rate limit — wait before next request",
      retry_after_sec: Math.ceil((MIN_INTERVAL_MS - elapsed) / 1000),
    };
  }

  const budget = await readBudget(userId);
  if (budget.count >= DAILY_CAP) {
    return {
      ok: false,
      status: 429,
      error: `Daily commentary cap reached (${DAILY_CAP}/day)`,
    };
  }

  return { ok: true };
}

export async function recordCommentaryCall(userId: string): Promise<void> {
  lastCallByUser.set(userId, Date.now());
  await incrementBudget(userId);
}
