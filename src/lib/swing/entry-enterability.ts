// src/lib/swing/entry-enterability.ts — "can a member still enter?" for swing rows.
//
// Decouples the member-facing BUY / STILL BUY label from the desk serving section and from whether the
// model book has already opened. Vector uses the same discipline (`still_buy` on ranked picks); swings
// need it with multi-day entry windows because members place orders slowly.
//
// PURE — no IO.

import type { SwingSetupState, SwingEntryState, SwingArchetype, SwingSubLane } from "./taxonomy";
import type { SwingDiscoveryPath } from "./discovery";
import { isSwingConfluenceEnforced } from "./v2/config";
import { blockedByFromSwingGates, failingSwingCommitGates } from "./v2/gates";
import { LEGACY_COMMIT_GATE_EXEMPT } from "./entry-gate-constants";
// Pure calendar math (Intl-based, no IO) — same NYSE trading-day/holiday table
// `docs/audit/LARGO-PRODUCT-CONTRACT.md`'s temporal contract already relies on elsewhere
// (session-calendar.ts). Needed here so a multi-day entry window counts real trading
// sessions, not raw calendar days — see the `advanceTradingDaysMs` comment below.
import { isTradingDayEt, formatEtDate } from "@/features/nighthawk/lib/session";

export type SwingEntryAction = "buy" | "still_buy" | "wait" | "dont_buy";

export type SwingEntryEnterabilityInput = {
  setupState?: SwingSetupState | null;
  entryStatus?: SwingEntryState | null;
  /** Mechanical floor gate — false keeps the name on the watch rail. */
  aboveFloor?: boolean | null;
  persistenceObserved?: boolean | null;
  commitGateBlockedBy?: string[] | null;
  signalKinds?: string[] | null;
  archetype?: SwingArchetype | string | null;
  /** ISO entry-validity deadline when known (entry-model). */
  entryDeadline?: string | null;
  /** Sub-lane for deadline fallback when entryDeadline is absent. */
  subLane?: SwingSubLane | null;
  /** Anchor instant for sub-lane deadline fallback (committedAt / firstSeenAt / asOf). */
  anchoredAt?: string | null;
  /** Model ledger has committed capital (liveStatus or committedAt). */
  deskCommitted?: boolean;
  nowMs?: number;
};

export type SwingEntryEnterability = {
  action: SwingEntryAction;
  reason: string;
  enterable: boolean;
  /** True only when `dont_buy` fired because the entry-validity deadline has passed — lets a
   *  caller distinguish "this setup's entry window is dead" from every other `dont_buy`/`wait`
   *  reason (invalidated, extended-chase, gate-blocked, not-yet-triggered), which otherwise all
   *  collapse into the same generic WAIT pill member-facing. */
  expired?: boolean;
  /**
   * The resolved entry-validity deadline as an ISO timestamp, whenever it could be computed —
   * present on EVERY branch (not just the `expired` one), so a caller can show the forward-looking
   * "entry window closes on X" fact while the setup is still enterable, not only retroactively once
   * it has already lapsed. Gap found 2026-09-18 (Ask Largo standing mandate): `entryDeadlineMs` was
   * already computed here (from `entryDeadline` or the `anchoredAt`+sub-lane fallback) to decide
   * `expired`, then discarded — only the boolean survived to any caller. A member watching a WATCH
   * play had no way to learn how much runway was left before the setup went stale; the first they'd
   * hear of it was the EXPIRED badge itself, after the window had already closed. Null when neither
   * `entryDeadline` nor a resolvable `anchoredAt` was supplied (never fabricated).
   */
  deadlineIso?: string | null;
};

const DISCOVERY_PATH_KINDS = new Set<SwingDiscoveryPath>([
  "FLOW",
  "STRUCTURE",
  "POSITIONING",
  "CATALYST",
  "BANGER",
  "VECTOR",
]);

const ENTRY_VALIDITY_DAYS: Record<SwingSubLane, number> = {
  TACTICAL: 2,
  STANDARD: 3,
  EXTENDED: 5,
};
const DEFAULT_ENTRY_VALIDITY_DAYS = 3;
const DAY_MS = 86_400_000;

const ENTERABLE_ENTRY_STATES = new Set<SwingEntryState>(["AT_TRIGGER", "PULLBACK_TO_ENTRY"]);

function resolveCommitGateBlockedBy(input: SwingEntryEnterabilityInput): string[] {
  if (input.commitGateBlockedBy?.length) return [...input.commitGateBlockedBy];
  const kinds = input.signalKinds ?? [];
  const legacyOnly =
    kinds.length > 0 && kinds.every((k) => k === "NIGHT HAWK" || k === "NIGHT_HAWK");
  if (legacyOnly) return [LEGACY_COMMIT_GATE_EXEMPT];
  if (!isSwingConfluenceEnforced()) return [];
  const paths = kinds.filter((k): k is SwingDiscoveryPath =>
    DISCOVERY_PATH_KINDS.has(k as SwingDiscoveryPath),
  );
  if (paths.length === 0) return [];
  const fails = failingSwingCommitGates(
    { discoveryPaths: paths, archetype: (input.archetype as SwingArchetype) ?? null },
    { enforceConfluence: true },
  );
  return blockedByFromSwingGates(fails);
}

/**
 * Advance `tradingDays` real NYSE sessions past `anchorMs`, counting only trading days but
 * otherwise stepping in exact 24h increments (so the deadline lands at the same clock time as
 * the anchor, just on a later session).
 *
 * THE BUG THIS FIXES: the old `anchorMs + days * DAY_MS` counted raw calendar days, so a
 * multi-day entry window silently SHRINKS whenever it spans a weekend (or holiday) — a setup
 * flagged Thursday with a 3-day STANDARD window read as EXPIRED by Sunday evening, before
 * Monday's market had even reopened, even though only ONE real trading session (Friday) had
 * actually elapsed. Live-reproduced 2026-09-13: GOOGL (flagged Thu 2026-09-10 12:05 ET,
 * `Entry stance: EXPIRED`) and ORCL (flagged Wed 2026-09-09) both read EXPIRED on a Sunday with
 * only one intervening trading day, member-facing copy telling holders to abandon a setup that
 * had barely had a chance to play out.
 */
function advanceTradingDaysMs(anchorMs: number, tradingDays: number): number {
  let cursorMs = anchorMs;
  let counted = 0;
  // Bounded rather than an unconditional loop: tradingDays is at most 5 (EXTENDED sub-lane) and
  // no real NYSE calendar strings together more than a handful of non-trading days in a row
  // (a long weekend plus an adjacent holiday), so this comfortably terminates — the cap just
  // stops a corrupted holiday table from spinning forever instead of failing loudly.
  for (let i = 0; i < tradingDays + 14 && counted < tradingDays; i++) {
    cursorMs += DAY_MS;
    if (isTradingDayEt(formatEtDate(new Date(cursorMs)))) counted++;
  }
  return cursorMs;
}

function entryDeadlineMs(input: SwingEntryEnterabilityInput): number | null {
  if (input.entryDeadline) {
    const t = Date.parse(input.entryDeadline);
    if (Number.isFinite(t)) return t;
  }
  const anchor = input.anchoredAt;
  if (!anchor) return null;
  const anchorMs = Date.parse(anchor);
  if (!Number.isFinite(anchorMs)) return null;
  const days = input.subLane ? ENTRY_VALIDITY_DAYS[input.subLane] : DEFAULT_ENTRY_VALIDITY_DAYS;
  return advanceTradingDaysMs(anchorMs, days);
}

function pastEntryDeadline(input: SwingEntryEnterabilityInput, nowMs: number): boolean {
  const deadline = entryDeadlineMs(input);
  return deadline != null && nowMs > deadline;
}

/**
 * Short reason a WATCH play's entry mechanics are already moot, independent of any gate state —
 * null while the play is still genuinely enterable. `evaluateSwingEntryEnterability`'s own
 * if-chain checks INVALIDATED/past-deadline/contract-expired/extended-chase BEFORE gate-blocked
 * (this file, above), so a play can be both dead-for-one-of-those-reasons AND gate-blocked at
 * once — entry-verdict.ts's `dont_buy` branch deliberately keeps the gate evidence attached in
 * that case (see its own comment: "regardless of which dont_buy reason fired (deadline-expired,
 * contract-expired, extended-chase)") rather than dropping it, but every renderer of that gate
 * text must know the gate is secondary: clearing it would NOT make the play enterable, because
 * one of these checks fires first regardless.
 *
 * GAP FOUND (Ask Largo standing mandate, 2026-09-18): this function only ever recognized 2 of the
 * 4 dead-entry states `evaluateSwingEntryEnterability` can return `dont_buy` for — INVALIDATED and
 * deadline-expired (`watchEntryExpired`) — leaving CONTRACT-EXPIRED (`entryStatus === "EXPIRED"`)
 * and EXTENDED-CHASE (`setupState === "EXTENDED"` or `entryStatus === "EXTENDED_CHASE"`) silently
 * uncovered, even though entry-verdict.ts's own comment (quoted above) names them explicitly as
 * cases where `gateBlocks` stays populated. Both fields are already rendered as raw facts by
 * `watchEntrySection` ("Setup: **EXTENDED**" / "Entry geometry: **EXPIRED**"), so a WATCH brief
 * could show those alongside an un-qualified "**Gates blocking entry:**" header — the exact same
 * "clearing the gate would reopen entry" false implication this function was written to prevent,
 * just for the two dead-reasons nobody had added yet. Narrow structural type (not the full
 * `TerminalPlay`) so this stays a dependency-free leaf export any brief-render module can import
 * without a cycle risk back through play-brief-narrative.ts/play-brief-intel.ts.
 */
export function deadPlayReason(play: {
  setupState?: string | null;
  entryStatus?: string | null;
  watchEntryExpired?: boolean | null;
}): string | null {
  if (play.setupState === "INVALIDATED") return "thesis already invalidated";
  if (play.watchEntryExpired === true) return "entry-validity window expired";
  if (play.entryStatus === "EXPIRED") return "contract expired";
  if (play.setupState === "EXTENDED" || play.entryStatus === "EXTENDED_CHASE") {
    return "extended past the valid entry window";
  }
  return null;
}

/**
 * Whether a member can enter now (or soon at limit) — independent of desk serving section / liveStatus.
 */
export function evaluateSwingEntryEnterability(
  input: SwingEntryEnterabilityInput,
): SwingEntryEnterability {
  const nowMs = input.nowMs ?? Date.now();
  const setup = input.setupState ?? null;
  const entry = input.entryStatus ?? null;
  const gateBlocked = resolveCommitGateBlockedBy(input);
  // Computed once, attached to EVERY branch below (see the `deadlineIso` doc comment on
  // `SwingEntryEnterability` for why this must not stay expired-only).
  const deadlineMs = entryDeadlineMs(input);
  const deadlineIso = deadlineMs != null ? new Date(deadlineMs).toISOString() : null;

  if (input.persistenceObserved === true) {
    return {
      action: "dont_buy",
      enterable: false,
      reason: "Below cross-session persistence bar — not served for entry yet.",
      deadlineIso,
    };
  }

  if (setup === "INVALIDATED") {
    return {
      action: "dont_buy",
      enterable: false,
      reason: "Structure invalidated — no entry recommended.",
      deadlineIso,
    };
  }

  if (pastEntryDeadline(input, nowMs)) {
    return {
      action: "dont_buy",
      enterable: false,
      reason: "Entry-validity window expired — wait for a fresh setup.",
      expired: true,
      deadlineIso,
    };
  }

  if (entry === "EXPIRED") {
    return {
      action: "dont_buy",
      enterable: false,
      reason: "Contract expired — no entry on this strike/expiry.",
      deadlineIso,
    };
  }

  if (setup === "EXTENDED" || entry === "EXTENDED_CHASE") {
    return {
      action: "dont_buy",
      enterable: false,
      reason: "Extended past the valid entry window — do not chase; wait for a reset.",
      deadlineIso,
    };
  }

  if (setup === "FORMING") {
    return {
      action: "wait",
      enterable: false,
      reason: "Thesis is still building — track persistence before entry.",
      deadlineIso,
    };
  }

  if (input.aboveFloor === false) {
    return {
      action: "wait",
      enterable: false,
      reason: "Below the lane commit floor — watch until conviction clears the bar.",
      deadlineIso,
    };
  }

  // Gate-blocked is only checked here, scoped to the branch that would otherwise return
  // buy/still_buy — NOT as an early, unconditional return before this point. A FORMING or
  // PRE_TRIGGER play can ALSO be gate-blocked (gates are evaluated independently of setup
  // maturity), and the old unconditional check fired first regardless, so a play that had not
  // yet reached its trigger still got told "At trigger, but commit gates have not cleared" —
  // a factually wrong claim live-reproduced on PLTR 2026-09-14 (FORMING/PRE_TRIGGER, gate-
  // blocked, entry geometry explicitly PRE_TRIGGER in the same brief). Scoping the check to
  // this branch keeps the message accurate: it's now only ever shown when the play genuinely
  // IS at trigger and gates are the one thing still holding it back.
  if (setup === "TRIGGERED" && entry != null && ENTERABLE_ENTRY_STATES.has(entry)) {
    if (gateBlocked.length > 0) {
      return {
        action: "wait",
        enterable: false,
        reason: "At trigger, but commit gates have not cleared — wait before sizing.",
        deadlineIso,
      };
    }
    const action: SwingEntryAction = input.deskCommitted ? "still_buy" : "buy";
    const reason =
      entry === "PULLBACK_TO_ENTRY"
        ? input.deskCommitted
          ? "Pullback into the entry zone — desk is in; members can still work the limit."
          : "Pullback into the entry zone — actionable buy window at the limit."
        : input.deskCommitted
          ? "At trigger with clean geometry — desk is in; members can still enter."
          : "At trigger with clean entry geometry — actionable buy window.";
    return { action, enterable: true, reason, deadlineIso };
  }

  if (setup === "TRIGGERED" && entry === "PRE_TRIGGER") {
    return {
      action: "wait",
      enterable: false,
      reason: "Waiting for price to reach the trigger — setup has not fired yet.",
      deadlineIso,
    };
  }

  if (setup == null) {
    return {
      action: "wait",
      enterable: false,
      reason: "No setup maturity read — track until classified.",
      deadlineIso,
    };
  }

  return {
    action: "wait",
    enterable: false,
    reason: "Thesis is live but entry geometry is not clean yet — wait for a better fill.",
    deadlineIso,
  };
}

export type SwingEntryActionLabel = "BUY" | "STILL BUY" | "WAIT";

/** Member-facing action pill text. */
export function swingEntryActionLabel(
  action: SwingEntryAction | null | undefined,
): SwingEntryActionLabel | null {
  switch (action) {
    case "buy":
      return "BUY";
    case "still_buy":
      return "STILL BUY";
    case "wait":
      return "WAIT";
    case "dont_buy":
      return null;
    default:
      return null;
  }
}
