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
  return anchorMs + days * DAY_MS;
}

function pastEntryDeadline(input: SwingEntryEnterabilityInput, nowMs: number): boolean {
  const deadline = entryDeadlineMs(input);
  return deadline != null && nowMs > deadline;
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

  if (input.persistenceObserved === true) {
    return {
      action: "dont_buy",
      enterable: false,
      reason: "Below cross-session persistence bar — not served for entry yet.",
    };
  }

  if (setup === "INVALIDATED") {
    return {
      action: "dont_buy",
      enterable: false,
      reason: "Structure invalidated — no entry recommended.",
    };
  }

  if (pastEntryDeadline(input, nowMs)) {
    return {
      action: "dont_buy",
      enterable: false,
      reason: "Entry-validity window expired — wait for a fresh setup.",
    };
  }

  if (entry === "EXPIRED") {
    return {
      action: "dont_buy",
      enterable: false,
      reason: "Contract expired — no entry on this strike/expiry.",
    };
  }

  if (setup === "EXTENDED" || entry === "EXTENDED_CHASE") {
    return {
      action: "dont_buy",
      enterable: false,
      reason: "Extended past the valid entry window — do not chase; wait for a reset.",
    };
  }

  if (gateBlocked.length > 0) {
    return {
      action: "wait",
      enterable: false,
      reason: "At trigger, but commit gates have not cleared — wait before sizing.",
    };
  }

  if (setup === "FORMING") {
    return {
      action: "wait",
      enterable: false,
      reason: "Thesis is still building — track persistence before entry.",
    };
  }

  if (input.aboveFloor === false) {
    return {
      action: "wait",
      enterable: false,
      reason: "Below the lane commit floor — watch until conviction clears the bar.",
    };
  }

  if (setup === "TRIGGERED" && entry != null && ENTERABLE_ENTRY_STATES.has(entry)) {
    const action: SwingEntryAction = input.deskCommitted ? "still_buy" : "buy";
    const reason =
      entry === "PULLBACK_TO_ENTRY"
        ? input.deskCommitted
          ? "Pullback into the entry zone — desk is in; members can still work the limit."
          : "Pullback into the entry zone — actionable buy window at the limit."
        : input.deskCommitted
          ? "At trigger with clean geometry — desk is in; members can still enter."
          : "At trigger with clean entry geometry — actionable buy window.";
    return { action, enterable: true, reason };
  }

  if (setup === "TRIGGERED" && entry === "PRE_TRIGGER") {
    return {
      action: "wait",
      enterable: false,
      reason: "Waiting for price to reach the trigger — setup has not fired yet.",
    };
  }

  if (setup == null) {
    return {
      action: "wait",
      enterable: false,
      reason: "No setup maturity read — track until classified.",
    };
  }

  return {
    action: "wait",
    enterable: false,
    reason: "Thesis is live but entry geometry is not clean yet — wait for a better fill.",
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
