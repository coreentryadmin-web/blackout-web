/**
 * Server-side sticky decision layer for the member-facing SPX Slayer play card.
 *
 * ROOT CAUSE (see docs/audit/FINDINGS.md 2026-08-05): `evaluateSpxPlayCore` (spx-play-engine.ts)
 * fully recomputes confluence score, gates, MTF, and Cortex from scratch on every call, with zero
 * memory of the immediately-prior decision. The member card polls the read-only snapshot
 * (`getSpxPlaySnapshot` -> `readSpxPlaySnapshot`) every `SPX_PLAY_POLL_MS` (2000ms). A confluence
 * score wobbling +/-1-2 points around any hard threshold (playFullMinScore, playWatchMinScore,
 * the Cortex PASS/ABSTAIN/VETO boundary, etc.) flips `entry_mode`/`action` between
 * SCANNING/WATCHING/BUY on consecutive 2s polls, and the client's `mergePlayWithCache`
 * (useSpxPlay.ts) only smooths confirmations/technicals/mtf/watch/telemetry/gates.blocks — never
 * action/headline/direction/score — so nothing protects the user from the flip.
 *
 * FIX: a pure hysteresis function, `applyDecisionHysteresis`, plus a thin module-level wrapper,
 * `applySpxPlayDisplayHysteresis`, that sits between the engine's fresh-every-poll evaluation and
 * what actually reaches the member. Contract:
 *   - UPGRADES (SCANNING -> WATCHING -> BUY) apply immediately — this governs when a real
 *     opportunity is surfaced, so we must never add lag on the way up.
 *   - DOWNGRADES or lateral swaps (BUY -> WATCHING/SCANNING, or a direction flip at the same
 *     rank, e.g. BUY long -> BUY short) require the SAME proposed decision to recur for either
 *     HYSTERESIS_DWELL_MS elapsed or HYSTERESIS_MIN_STREAK consecutive polls (whichever comes
 *     first) before it is allowed to reach the display. A single noisy poll can never flip the
 *     card away from what's showing.
 *   - Every poll that doesn't confirm a pending swap keeps showing the last confirmed decision's
 *     full payload (only `as_of` is refreshed), so the headline/thesis/score the user sees always
 *     describe one coherent play — never a stale action paired with fresh numbers.
 *
 * SCOPE: this smooths the READ-ONLY display path only (`getSpxPlaySnapshot`/`readSpxPlaySnapshot`,
 * always `mutate: false`). It does NOT touch `runSpxEvaluator`/`evaluateSpxPlay({ mutate: true })`,
 * the cron-driven path that actually commits real trades (opens/closes `spx_play` rows, fires
 * Discord). Real capital timing is unchanged — only what members SEE on the card between commits
 * is stabilized. This also means it only ever applies to the pre-entry flat path (SCANNING /
 * WATCHING / BUY with no open position) — an already-OPEN play's exit management
 * (HOLD/TRIM/SELL from evaluateOpenPlay) has its own stop/target/thesis-break logic and must
 * never be delayed by dwell.
 */
import type { SpxPlayAction, SpxPlayDirection } from "@/features/spx/lib/spx-signals";
import type { SpxPlayPayload } from "@/features/spx/lib/spx-play-payload";

export type SpxFlatAction = "SCANNING" | "WATCHING" | "BUY";

export type HysteresisDecision = {
  action: SpxFlatAction;
  direction: SpxPlayDirection | null;
};

export type HysteresisState = {
  displayed: HysteresisDecision;
  /** Proposed decision not yet confirmed — null when nothing is pending. */
  pending: HysteresisDecision | null;
  pending_since_ms: number;
  pending_streak: number;
};

/** ~4-5 polls at the default 2s SPX_PLAY_POLL_MS cadence. */
export const HYSTERESIS_DWELL_MS = 8_000;
export const HYSTERESIS_MIN_STREAK = 4;

const ACTION_RANK: Record<SpxFlatAction, number> = {
  SCANNING: 0,
  WATCHING: 1,
  BUY: 2,
};

function sameDecision(a: HysteresisDecision, b: HysteresisDecision): boolean {
  return a.action === b.action && a.direction === b.direction;
}

/**
 * Pure state-transition function — no I/O, fully deterministic from its inputs.
 * `prev === null` means "no prior decision this session" (first observation): accepted
 * immediately, nothing to dwell against yet.
 */
export function applyDecisionHysteresis(
  prev: HysteresisState | null,
  next: HysteresisDecision,
  nowMs: number,
  opts?: { dwellMs?: number; minStreak?: number }
): { state: HysteresisState; decision: HysteresisDecision } {
  const dwellMs = opts?.dwellMs ?? HYSTERESIS_DWELL_MS;
  const minStreak = opts?.minStreak ?? HYSTERESIS_MIN_STREAK;

  if (!prev) {
    return {
      state: { displayed: next, pending: null, pending_since_ms: nowMs, pending_streak: 0 },
      decision: next,
    };
  }

  const isUpgrade = ACTION_RANK[next.action] > ACTION_RANK[prev.displayed.action];
  const isUnchanged = sameDecision(next, prev.displayed);

  if (isUpgrade || isUnchanged) {
    // Upgrades apply instantly (don't miss real entries); a repeat of what's already
    // displayed is a no-op that also clears any previously-pending swap that never confirmed.
    return {
      state: { displayed: next, pending: null, pending_since_ms: nowMs, pending_streak: 0 },
      decision: next,
    };
  }

  // Downgrade in rank, or a lateral swap at the same/lower rank (direction flip).
  const pendingMatches = prev.pending != null && sameDecision(prev.pending, next);
  const pendingSinceMs = pendingMatches ? prev.pending_since_ms : nowMs;
  const pendingStreak = pendingMatches ? prev.pending_streak + 1 : 1;
  const confirmed = nowMs - pendingSinceMs >= dwellMs || pendingStreak >= minStreak;

  if (confirmed) {
    return {
      state: { displayed: next, pending: null, pending_since_ms: nowMs, pending_streak: 0 },
      decision: next,
    };
  }

  // Not yet confirmed — keep showing the previously-displayed decision, remember the
  // candidate swap and how long/many-times it's been proposed so far.
  return {
    state: {
      displayed: prev.displayed,
      pending: next,
      pending_since_ms: pendingSinceMs,
      pending_streak: pendingStreak,
    },
    decision: prev.displayed,
  };
}

function isFlatAction(action: SpxPlayAction): action is SpxFlatAction {
  return action === "SCANNING" || action === "WATCHING" || action === "BUY";
}

type DisplayStore = {
  session_date: string;
  state: HysteresisState;
  payload: SpxPlayPayload;
};

// Module-level, per-process memory — deliberately NOT DB-backed. This only needs to survive
// ~8-10s of polling for the SAME shared SPX card (there is one board, not one per member), so a
// process-local cache is the low-risk choice here (consistent with the "don't touch the trade
// commit path" scoping). KNOWN LIMITATION (documented in FINDINGS.md): if blackout-production-web
// ever runs >1 ECS task without ALB session affinity, two members could poll different tasks and
// see the dwell window resolve independently (each still flicker-free on its own, but the two
// members could momentarily disagree with each other for up to one dwell window). Promoting this
// to a Redis-backed key (mirroring spx-play-watch.ts's getMeta/setMeta pattern) is the follow-up
// if that turns out to matter in practice.
let store: DisplayStore | null = null;

/** Test-only reset hook — mirrors the pattern used elsewhere for module-level engine state. */
export function resetSpxPlayHysteresisForTests(): void {
  store = null;
}

/**
 * Apply the sticky display layer to a freshly-evaluated read-only snapshot. Only the pre-entry
 * flat path (no open position, action in SCANNING/WATCHING/BUY) is eligible for smoothing — an
 * open position's own exit management always passes straight through.
 */
export function applySpxPlayDisplayHysteresis(
  payload: SpxPlayPayload,
  sessionDate: string,
  nowMs = Date.now()
): SpxPlayPayload {
  if (payload.open_play != null || !isFlatAction(payload.action)) {
    // Leaving the flat path (e.g. a play just opened) — drop any pending dwell state so it
    // can't leak into a future flat read once we're back to SCANNING/WATCHING/BUY.
    if (store && store.session_date === sessionDate) store = null;
    return payload;
  }

  if (!store || store.session_date !== sessionDate) {
    store = {
      session_date: sessionDate,
      state: {
        displayed: { action: payload.action, direction: payload.direction },
        pending: null,
        pending_since_ms: nowMs,
        pending_streak: 0,
      },
      payload,
    };
    return payload;
  }

  const { state, decision } = applyDecisionHysteresis(
    store.state,
    { action: payload.action, direction: payload.direction },
    nowMs
  );
  store.state = state;

  const decisionConfirmed = sameDecision(decision, { action: payload.action, direction: payload.direction });
  if (decisionConfirmed) {
    store.payload = payload;
    return payload;
  }

  // Pending swap not yet confirmed — keep the last confirmed decision's full payload so the
  // headline/thesis/score the member sees stay internally consistent, refreshing only `as_of`.
  const frozen: SpxPlayPayload = { ...store.payload, as_of: payload.as_of };
  store.payload = frozen;
  return frozen;
}
