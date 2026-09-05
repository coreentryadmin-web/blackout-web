// src/lib/swing/entry-verdict.ts — member-facing BUY / WAIT / SKIP for pre-entry swing rows.
//
// Maps the serving router's observable section (serving.ts) onto deck lifecycle + action vocabulary:
//   COMMIT_NOW          → WATCH + BUY   ("you can still enter")
//   WAITING_FOR_ENTRY   → WATCH + WAIT  ("thesis live, no clean fill yet")
//   WATCH               → WATCH + WAIT  ("forming / below floor — track, don't chase")
//   RESEARCH            → SKIP + PASSED ("desk is passing — see gate blocks for why")
//
// PURE — no IO. Live positions (MANAGING/SCALING_OUT/EXITING) are out of scope; the adapter keys
// off liveStatus and leaves those on OPEN/HOLD/TRIM management vocabulary.

import { sectionForSwingPlay, type SwingServingSection } from "./serving";
import type { SwingSetupState, SwingEntryState, SwingArchetype } from "./taxonomy";
import type { SwingDiscoveryPath } from "./discovery";
import { isSwingConfluenceEnforced } from "./v2/config";
import { blockedByFromSwingGates, failingSwingCommitGates } from "./v2/gates";

export type SwingEntryGateBlock = { code: string; reason: string };

export type SwingEntryVerdict = {
  deckStatus: "WATCH" | "SKIP";
  recommendation: "BUY" | "HOLD";
  recNote: string;
  gateBlocks: SwingEntryGateBlock[] | null;
  actionLabel: "BUY" | "WAIT" | null;
};

export type SwingEntryVerdictInput = {
  servingSection?: SwingServingSection | null;
  setupState?: SwingSetupState | null;
  entryStatus?: SwingEntryState | null;
  /** Mechanical floor gate — COMMIT vs WATCH on the produced play. */
  aboveFloor?: boolean | null;
  persistenceObserved?: boolean | null;
  persistenceGapReason?: string | null;
  /** Stamped at discovery from computeSwingCommitPlan — authoritative G-S6/G-S14 blocks. */
  commitGateBlockedBy?: string[] | null;
  /** Discovery provenance kinds — used to evaluate G-S6 when commitGateBlockedBy is absent. */
  signalKinds?: string[] | null;
  archetype?: SwingArchetype | string | null;
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

function waitingRecNote(input: SwingEntryVerdictInput): string {
  if (input.setupState === "EXTENDED") {
    return "Extended past the trigger — wait for a pullback into the entry zone before sizing.";
  }
  switch (input.entryStatus) {
    case "PRE_TRIGGER":
      return "Waiting for price to reach the trigger — setup has not fired yet.";
    case "PULLBACK_TO_ENTRY":
      return "Pullback into the entry zone — wait for a clean retest fill.";
    case "EXTENDED_CHASE":
      return "Past the valid entry window (>0.5·ATR past trigger) — do not chase; wait for a reset.";
    case "AT_TRIGGER":
      return "At trigger but not yet in the commit window — wait for the desk commit signal.";
    case "EXPIRED":
      return "Contract expired — no entry available on this strike/expiry.";
    default:
      return "Thesis is live but entry geometry is not clean yet — wait for a better fill.";
  }
}

function watchRecNote(input: SwingEntryVerdictInput): string {
  if (input.setupState === "FORMING") {
    return "Thesis is still building — track persistence before entry.";
  }
  if (input.aboveFloor === false) {
    return "Below the lane commit floor — watch until conviction clears the bar.";
  }
  return "Not actionable yet — track the setup on the WATCH rail.";
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
    .filter((b) => b.startsWith("gate:G-S"))
    .map((b) => {
      if (b.startsWith("gate:G-S6:")) {
        return {
          code: "g_s6_confluence",
          reason: "Independent signal confluence below commit threshold — desk will not open.",
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

/**
 * Pre-entry swing BUY/WAIT/SKIP verdict. Returns null when the section cannot be resolved
 * (legacy payloads with no observables) — the adapter keeps its prior COMMIT→WATCH mapping.
 */
export function swingEntryVerdict(input: SwingEntryVerdictInput): SwingEntryVerdict | null {
  const section = resolveSwingServingSection(input);
  if (!section) return null;

  const commitGateBlockedBy = resolveSwingCommitGateBlockedBy(input);

  switch (section) {
    case "COMMIT_NOW":
      if (commitGateBlockedBy.length > 0) {
        return {
          deckStatus: "WATCH",
          recommendation: "HOLD",
          recNote:
            "At trigger, but commit gates have not cleared — wait for confluence/Cortex before sizing.",
          gateBlocks: commitGateBlocksForVerdict(commitGateBlockedBy),
          actionLabel: "WAIT",
        };
      }
      return {
        deckStatus: "WATCH",
        recommendation: "BUY",
        recNote: "At trigger with clean entry geometry — this is the actionable buy window.",
        gateBlocks: null,
        actionLabel: "BUY",
      };
    case "WAITING_FOR_ENTRY":
      return {
        deckStatus: "WATCH",
        recommendation: "HOLD",
        recNote: waitingRecNote(input),
        gateBlocks: null,
        actionLabel: "WAIT",
      };
    case "WATCH":
      return {
        deckStatus: "WATCH",
        recommendation: "HOLD",
        recNote: watchRecNote(input),
        gateBlocks: null,
        actionLabel: "WAIT",
      };
    case "RESEARCH":
      return {
        deckStatus: "SKIP",
        recommendation: "HOLD",
        recNote: "Desk is passing this setup — no entry recommended.",
        gateBlocks: researchGateBlocks(input),
        actionLabel: null,
      };
    default:
      return null;
  }
}
