// src/lib/swing/entry-verdict.ts — member-facing BUY / STILL BUY / WAIT / SKIP for swing rows.
//
// Entry labels are driven by `entry-enterability.ts` ("can a member still enter?"), NOT only the narrow
// COMMIT_NOW serving slice. Desk model-book OPEN and member entry label are intentionally decoupled.
//
// PURE — no IO.

import { sectionForSwingPlay, type SwingServingSection } from "./serving";
import type { SwingSetupState, SwingEntryState, SwingArchetype, SwingSubLane } from "./taxonomy";
import type { SwingDiscoveryPath } from "./discovery";
import { isSwingConfluenceEnforced } from "./v2/config";
import { blockedByFromSwingGates, failingSwingCommitGates } from "./v2/gates";
import {
  evaluateSwingEntryEnterability,
  swingEntryActionLabel,
  type SwingEntryAction,
} from "./entry-enterability";
import { LEGACY_COMMIT_GATE_EXEMPT } from "./entry-gate-constants";

export { LEGACY_COMMIT_GATE_EXEMPT };

export type SwingEntryGateBlock = { code: string; reason: string };

export type SwingEntryVerdict = {
  deckStatus: "WATCH" | "SKIP";
  recommendation: "BUY" | "HOLD";
  recNote: string;
  gateBlocks: SwingEntryGateBlock[] | null;
  actionLabel: "BUY" | "STILL BUY" | "WAIT" | null;
  entryAction: SwingEntryAction | null;
};

export type SwingEntryVerdictInput = {
  servingSection?: SwingServingSection | null;
  setupState?: SwingSetupState | null;
  entryStatus?: SwingEntryState | null;
  /** Mechanical floor gate — COMMIT vs WATCH on the produced play. */
  aboveFloor?: boolean | null;
  persistenceObserved?: boolean | null;
  persistenceGapReason?: string | null;
  commitGateBlockedBy?: string[] | null;
  signalKinds?: string[] | null;
  archetype?: SwingArchetype | string | null;
  entryDeadline?: string | null;
  subLane?: SwingSubLane | string | null;
  anchoredAt?: string | null;
  deskCommitted?: boolean;
  nowMs?: number;
};

/** Resolve the serving section when the play was not stamped (tests / partial payloads). */
export function resolveSwingServingSection(input: SwingEntryVerdictInput): SwingServingSection | null {
  if (input.servingSection) return input.servingSection;
  if (input.setupState == null && input.entryStatus == null && input.persistenceObserved !== true) {
    return null;
  }
  return sectionForSwingPlay({
    setupState: input.setupState ?? null,
    entryStatus: input.entryStatus ?? null,
    aboveFloor: input.aboveFloor ?? null,
    persistenceObserved: input.persistenceObserved ?? null,
  });
}

const DISCOVERY_PATH_KINDS = new Set<SwingDiscoveryPath>([
  "FLOW",
  "STRUCTURE",
  "POSITIONING",
  "CATALYST",
  "BANGER",
  "VECTOR",
]);

/** Map commit `blockedBy` tokens to member-facing gate blocks. */
export function commitGateBlocksForVerdict(blockedBy: readonly string[]): SwingEntryGateBlock[] {
  return blockedBy
    .filter((b) => b.startsWith("gate:G-S") || b === LEGACY_COMMIT_GATE_EXEMPT)
    .map((b) => {
      if (b === LEGACY_COMMIT_GATE_EXEMPT) {
        return {
          code: "legacy_exempt",
          reason:
            "Legacy morning-confirm promotion — Swing V2 confluence/Cortex gates were not evaluated on this path.",
        };
      }
      if (b.startsWith("gate:G-S6:")) {
        return {
          code: "g_s6_confluence",
          reason: "Independent signal confluence below commit threshold — desk will not open.",
        };
      }
      if (b.startsWith("gate:G-S3:")) {
        return {
          code: "g_s3_earnings",
          reason: "Earnings print inside holding window — desk will not open into binary-gap risk.",
        };
      }
      if (b.startsWith("gate:G-S12:")) {
        return {
          code: b.includes("halt_feed_stale") ? "g_s12_halt_feed_stale" : "g_s12_halted",
          reason: b.includes("halt_feed_stale")
            ? "Trading-halt feed unavailable — desk will not open until halt/LULD data recovers."
            : "Underlying is halted or in LULD band — desk will not open until trading resumes.",
        };
      }
      if (b.startsWith("gate:G-S4:")) {
        return {
          code: "g_s4_regime",
          reason: "Broad-market regime degraded — desk will not open new swings (WATCH only).",
        };
      }
      if (b.startsWith("gate:G-S14:")) {
        if (b.includes("cortex_unavailable")) {
          return {
            code: "g_s14_cortex_unavailable",
            reason: "Cortex preflight could not complete — desk will not open until evidence recovers.",
          };
        }
        return {
          code: "g_s14_cortex",
          reason: "Cortex preflight vetoed this setup — desk will not open.",
        };
      }
      return { code: b.replace(/[^a-z0-9_]+/gi, "_").toLowerCase(), reason: `Commit gate blocked (${b}).` };
    });
}

/** Resolve V2 commit gate blocks — stamped discovery output wins; else evaluate G-S6 from signal kinds. */
export function resolveSwingCommitGateBlockedBy(input: SwingEntryVerdictInput): string[] {
  if (input.commitGateBlockedBy?.length) return [...input.commitGateBlockedBy];
  const kinds = input.signalKinds ?? [];
  const legacyOnly =
    kinds.length > 0 && kinds.every((k) => k === "NIGHT HAWK" || k === "NIGHT_HAWK");
  if (legacyOnly) return [LEGACY_COMMIT_GATE_EXEMPT];
  if (!isSwingConfluenceEnforced()) return [];
  const paths = (input.signalKinds ?? []).filter((k): k is SwingDiscoveryPath =>
    DISCOVERY_PATH_KINDS.has(k as SwingDiscoveryPath),
  );
  if (paths.length === 0) return [];
  const fails = failingSwingCommitGates(
    { discoveryPaths: paths, archetype: (input.archetype as SwingArchetype) ?? null },
    { enforceConfluence: true },
  );
  return blockedByFromSwingGates(fails);
}

function researchGateBlocks(input: SwingEntryVerdictInput): SwingEntryGateBlock[] {
  if (input.setupState === "INVALIDATED") {
    return [
      {
        code: "thesis_invalidated",
        reason: "Structure invalidated — price closed through the structural invalidation level.",
      },
    ];
  }
  if (input.persistenceObserved === true) {
    return [
      {
        code: "persistence_gap",
        reason:
          input.persistenceGapReason?.trim() ||
          "Seen but has not cleared cross-session persistence — not ready to serve yet.",
      },
    ];
  }
  if (input.setupState == null) {
    return [
      {
        code: "unclassified",
        reason: "No setup maturity read attached — needs classification before entry.",
      },
    ];
  }
  return [
    {
      code: "research_review",
      reason: "Desk is passing this name — thesis needs more work before it can be served.",
    },
  ];
}

function enterabilityInputFromVerdict(input: SwingEntryVerdictInput) {
  return {
    setupState: input.setupState,
    entryStatus: input.entryStatus,
    aboveFloor: input.aboveFloor,
    persistenceObserved: input.persistenceObserved,
    commitGateBlockedBy: resolveSwingCommitGateBlockedBy(input),
    signalKinds: input.signalKinds,
    archetype: input.archetype,
    entryDeadline: input.entryDeadline,
    subLane: (input.subLane as SwingSubLane) ?? null,
    anchoredAt: input.anchoredAt,
    deskCommitted: input.deskCommitted,
    nowMs: input.nowMs,
  };
}

/**
 * Pre-entry swing BUY/STILL BUY/WAIT/SKIP verdict. Returns null when observables are too sparse.
 * Live rows use `evaluateSwingEntryEnterability` directly in the adapter for the STILL BUY pill.
 */
export function swingEntryVerdict(input: SwingEntryVerdictInput): SwingEntryVerdict | null {
  const section = resolveSwingServingSection(input);
  if (!section) return null;

  if (section === "RESEARCH") {
    return {
      deckStatus: "SKIP",
      recommendation: "HOLD",
      recNote: "Desk is passing this setup — no entry recommended.",
      gateBlocks: researchGateBlocks(input),
      actionLabel: null,
      entryAction: "dont_buy",
    };
  }

  const commitGateBlockedBy = resolveSwingCommitGateBlockedBy(input);
  const enter = evaluateSwingEntryEnterability(enterabilityInputFromVerdict(input));

  switch (enter.action) {
    case "buy":
    case "still_buy":
      return {
        deckStatus: "WATCH",
        recommendation: "BUY",
        recNote: enter.reason,
        gateBlocks: null,
        actionLabel: swingEntryActionLabel(enter.action),
        entryAction: enter.action,
      };
    case "wait":
      return {
        deckStatus: "WATCH",
        recommendation: "HOLD",
        recNote: enter.reason,
        gateBlocks: commitGateBlockedBy.length ? commitGateBlocksForVerdict(commitGateBlockedBy) : null,
        actionLabel: "WAIT",
        entryAction: "wait",
      };
    case "dont_buy":
      if (input.setupState === "INVALIDATED" || input.persistenceObserved === true) {
        return {
          deckStatus: "SKIP",
          recommendation: "HOLD",
          recNote: enter.reason,
          gateBlocks: researchGateBlocks(input),
          actionLabel: null,
          entryAction: "dont_buy",
        };
      }
      return {
        deckStatus: "WATCH",
        recommendation: "HOLD",
        recNote: enter.reason,
        gateBlocks: null,
        actionLabel: "WAIT",
        entryAction: "dont_buy",
      };
    default:
      return null;
  }
}
