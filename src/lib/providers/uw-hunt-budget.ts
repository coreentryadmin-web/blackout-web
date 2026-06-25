/**
 * Hunt-scoped LIVE-UW budget gate (cache-reader-rule enforcement for Night Hawk).
 *
 * THE PROBLEM. A Night Hawk hunt fans out ~240 per-candidate Unusual Whales calls
 * (dossier stage: ~10 UW endpoints × ~40 candidates, plus the market-wide context
 * scan). Every one of those calls is already paced through the shared 2-RPS
 * cluster-wide UW limiter (uw-rate-limiter.ts), but the limiter only SPACES calls
 * — it does not BOUND how many a single feature may make. So a hunt happily drains
 * the entire 2 RPS for minutes, starving the LIVE SPX desk + flow tape that share
 * the same budget, and a burst of cold misses can trip the 429 circuit breaker for
 * EVERY user cluster-wide. With Night Hawk admin-only that was tolerable; flipping
 * it to all-users at ~1000 concurrent makes it a launch-blocking landmine.
 *
 * THE RULE. A per-user feature must READ warmed caches, not fan out live upstream
 * calls per request. Most of the hunt's UW reads ARE cache-served (Redis L2 via
 * uwCacheGet, the in-process flow-alert cache, the per-build congress/predictions/
 * screener cache, and in-flight coalescing) — those never reach the network and so
 * never touch this budget. What remains are the genuinely-cold per-candidate datums
 * the warm crons don't pre-warm (dark pool, oi-change, iv-term, skew, etc. for
 * whatever tickers happen to be today's candidates).
 *
 * THE FIX. This module establishes a per-hunt budget via AsyncLocalStorage. While a
 * hunt runs inside `runWithUwHuntBudget`, every GENUINE live UW HTTP call (the ones
 * that reach throttleUw's fetch fn — coalesced/cached hits return before that) must
 * first claim a budget token. Once the small ceiling is spent, further live calls
 * SHORT-CIRCUIT with `UwHuntBudgetExhaustedError` instead of queuing on the shared
 * limiter. The dossier/market-wide fetchers already wrap every UW call in
 * `dossierFetch(...)` / `.catch(() => default)` with a graceful fallback, so an
 * exhausted-budget throw degrades cleanly to cached / last-known / empty data — the
 * hunt still completes, it just stops eating the live desk's UW budget.
 *
 * Result: a hunt consumes AT MOST `maxLiveUwCalls` live UW slots (default 12) and
 * can never monopolize the 2 RPS or trip the breaker. Outside a hunt context (the
 * live desk, crons, every other route) this module is inert — no context, no cap.
 *
 * Cron callers deliberately run with NO budget context (off-peak, trusted, they ARE
 * the warmers) so the nightly edition build keeps full data fidelity.
 */

import { AsyncLocalStorage } from "node:async_hooks";

/** Default ceiling on genuine live UW calls a single hunt may make. Small on purpose:
 *  the warm caches + coalescing cover the overwhelming majority of a hunt's reads, so
 *  this only needs to cover a handful of cold per-candidate misses without ever letting
 *  the hunt dominate the shared 2-RPS budget. Override via NH_HUNT_UW_BUDGET. */
function defaultHuntUwBudget(): number {
  const raw = process.env.NH_HUNT_UW_BUDGET?.trim();
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) return Math.floor(n);
  }
  return 12;
}

type HuntBudget = {
  /** Remaining genuine live UW calls this hunt may still make. */
  remaining: number;
  /** Total granted (for telemetry). */
  granted: number;
  /** Count of calls denied after exhaustion (for telemetry). */
  denied: number;
};

const huntBudgetStore = new AsyncLocalStorage<HuntBudget>();

/**
 * Sentinel thrown when a hunt has spent its live-UW budget. Distinct class so the
 * limiter/telemetry can tell a budget skip apart from a real upstream/network error
 * (it is NOT a 429 and must never feed the circuit breaker). The hunt's fetch
 * wrappers catch it and fall back to cached/empty data.
 */
export class UwHuntBudgetExhaustedError extends Error {
  readonly code = "UW_HUNT_BUDGET_EXHAUSTED" as const;
  constructor(message = "Night Hawk hunt live-UW budget exhausted — serving cached/last-known data") {
    super(message);
    this.name = "UwHuntBudgetExhaustedError";
  }
}

/** True when the given error is the hunt-budget sentinel (or carries its code). */
export function isUwHuntBudgetError(err: unknown): boolean {
  if (err instanceof UwHuntBudgetExhaustedError) return true;
  return Boolean(
    err &&
      typeof err === "object" &&
      (err as { code?: unknown }).code === "UW_HUNT_BUDGET_EXHAUSTED"
  );
}

/**
 * Run `fn` inside a fresh hunt budget context. Every genuine live UW call made while
 * `fn` (and anything it awaits) runs is charged against `maxLiveUwCalls`; once spent,
 * further live calls throw `UwHuntBudgetExhaustedError` at the limiter chokepoint and
 * never touch the shared 2-RPS limiter.
 *
 * Nested calls REUSE the outer context (a hunt within a hunt shares one budget) so the
 * ceiling is a true per-hunt cap, not per-nesting-level.
 */
export function runWithUwHuntBudget<T>(
  fn: () => Promise<T>,
  opts?: { maxLiveUwCalls?: number }
): Promise<T> {
  // Reuse an already-active budget rather than minting a second one — keeps the cap
  // honest if a hunt path is ever wrapped twice.
  const existing = huntBudgetStore.getStore();
  if (existing) return fn();

  const granted = Math.max(0, Math.floor(opts?.maxLiveUwCalls ?? defaultHuntUwBudget()));
  const budget: HuntBudget = { remaining: granted, granted, denied: 0 };
  return huntBudgetStore.run(budget, fn);
}

/**
 * Claim one live-UW budget token for the CURRENT async context.
 *
 * - No hunt context active (live desk, crons, other routes) → returns `true`
 *   immediately; this module is inert outside a hunt.
 * - Hunt context with budget left → consumes one token, returns `true`.
 * - Hunt context exhausted → records the denial, returns `false`. The caller
 *   (throttleUw) turns a `false` into `UwHuntBudgetExhaustedError` so it never
 *   queues on the shared limiter.
 *
 * Called once per GENUINE live UW HTTP call (inside throttleUw, after coalescing/
 * caching have already short-circuited the cheap hits).
 */
export function tryClaimHuntUwCall(): boolean {
  const budget = huntBudgetStore.getStore();
  if (!budget) return true; // not in a hunt — no cap
  if (budget.remaining <= 0) {
    budget.denied += 1;
    return false;
  }
  budget.remaining -= 1;
  return true;
}

/** Snapshot of the active hunt budget (telemetry/tests); null outside a hunt. */
export function huntUwBudgetSnapshot(): { remaining: number; granted: number; denied: number } | null {
  const budget = huntBudgetStore.getStore();
  if (!budget) return null;
  return { remaining: budget.remaining, granted: budget.granted, denied: budget.denied };
}

/** True when a hunt budget context is currently active. */
export function inHuntUwBudget(): boolean {
  return huntBudgetStore.getStore() != null;
}
