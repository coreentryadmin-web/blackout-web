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
import { evaluateSwingConfluence } from "./v2/confluence";
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
  /** Entry-validity deadline already passed (evaluateSwingEntryEnterability's `expired` flag) —
   *  the same reason `sectionForSwingPlay` (serving.ts) routes a stale-but-triggered setup to
   *  RESEARCH. See `researchGateBlocks`'s own doc comment for why this needs its own case. */
  entryWindowExpired?: boolean | null;
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

/** Context needed to enrich a G-S6 confluence block with its real, already-computed diagnostic
 *  (how many independent kinds are present vs required) instead of the flat static reason —
 *  `evaluateSwingConfluence` computes this at gate-evaluation time and it was being thrown away
 *  before reaching the member-facing text. Optional: omitting it keeps the prior flat reason. */
export type SwingGateBlockDiagnosticContext = {
  signalKinds?: readonly string[] | null;
  archetype?: SwingArchetype | string | null;
};

/** Map commit `blockedBy` tokens to member-facing gate blocks. */
export function commitGateBlocksForVerdict(
  blockedBy: readonly string[],
  diagnostics?: SwingGateBlockDiagnosticContext
): SwingEntryGateBlock[] {
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
        const paths = (diagnostics?.signalKinds ?? []).filter((k): k is SwingDiscoveryPath =>
          DISCOVERY_PATH_KINDS.has(k as SwingDiscoveryPath)
        );
        const verdict =
          paths.length > 0
            ? evaluateSwingConfluence(paths, (diagnostics?.archetype as SwingArchetype) ?? null)
            : null;
        // GAP FOUND (2026-10-14, live verification of this same enrichment, AVGO repro):
        // `signalKinds` on a served WATCH row can accumulate past the last gate-evaluation pass
        // (gates stamp `commitGateBlockedBy` once per discovery scan; signal kinds can keep growing
        // between scans), and this function's own simple type-filter also doesn't replicate
        // `discoveryPathsForConfluence`'s POSITIONING-direction-mismatch drop. Either gap can make
        // this recompute disagree with the real, already-fired block — live repro showed AVGO
        // rendering "5/3 kinds agree (...)" (a PASSING-shaped label) directly inside a sentence
        // explaining why entry is still blocked, which reads as self-contradictory to a trader.
        // Only trust the enriched label when it AGREES the gate should still be failing; otherwise
        // fall back to the flat text rather than assert a passing count next to a live block.
        const reason =
          verdict && !verdict.pass
            ? `Independent signal confluence below commit threshold — ${verdict.label}.`
            : "Independent signal confluence below commit threshold — desk will not open.";
        return { code: "g_s6_confluence", reason };
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
        // BUG FIX (2026-10-25, Ask Largo standing mandate, live repro SOXX WATCH): this used to
        // collapse EVERY non-`cortex_unavailable` G-S14 code to "Cortex preflight vetoed this
        // setup" — but cortex-gate.ts's own decision table (see its header comment) distinguishes
        // a genuine VETO from four materially weaker, explicitly non-veto outcomes
        // (`cortex_net_negative`, `cortex_thin_evidence`, `cortex_contested`,
        // `cortex_gex_walls_oppose_unresolved`) and a fail-closed "could not verify either way"
        // outcome (`cortex_veto_blind`) — each already carries its own specific, honest reason
        // sentence in `cortexGateBlocks()` (cortex-gate.ts), but that text is discarded at the
        // point this gate's bare code gets persisted (discovery.ts only keeps
        // `pre.blockedBy`, never `pre.reason`), so by the time a brief/panel renders this gate it
        // has only the bare code to go on. Rather than re-derive the exact evidence sentence (that
        // needs a fresh, expensive Cortex read, not available at display time — unlike G-S6's
        // cheap confluence recompute above), this at least stops telling a member a hard veto fired
        // when the real decision was a materially weaker one. `code` is left as the existing
        // `g_s14_cortex` for every branch here (nothing downstream keys off a more granular code
        // yet) — only the member-facing reason text changes.
        if (b.includes("cortex_veto_blind")) {
          return {
            code: "g_s14_cortex",
            reason:
              "Cortex's veto-capable sources (dealer walls, flow) both failed to read — desk will not open until evidence recovers (fail-closed; not a confirmed veto).",
          };
        }
        if (b.includes("cortex_veto")) {
          return {
            code: "g_s14_cortex",
            reason: "Cortex preflight vetoed this setup — desk will not open.",
          };
        }
        if (b.includes("cortex_net_negative")) {
          return {
            code: "g_s14_cortex",
            reason:
              "Cortex evidence nets negative against this setup — desk will not open (no veto; the weight of evidence itself argues against it).",
          };
        }
        if (b.includes("cortex_thin_evidence")) {
          return {
            code: "g_s14_cortex",
            reason:
              "Cortex evidence is too thinly corroborated to trust — desk will not open (no veto; too few sources answered).",
          };
        }
        if (b.includes("cortex_gex_walls_oppose_unresolved")) {
          return {
            code: "g_s14_cortex",
            reason:
              "An active dealer-wall opposition is unresolved against this setup — desk will not open (no veto; the conviction floor wasn't cleared).",
          };
        }
        if (b.includes("cortex_contested")) {
          return {
            code: "g_s14_cortex",
            reason:
              "Cortex evidence is contested — real support and real opposition are both present — desk will not open (no veto; the read isn't clean either way).",
          };
        }
        return {
          code: "g_s14_cortex",
          reason: "Cortex preflight blocked this setup — desk will not open.",
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
        // BUG FIX (Ask Largo standing mandate, 2026-10-26, live repro SOXX): this used to say "price
        // CLOSED through the structural invalidation level" — but deriveSetupState (setup-state.ts)
        // compares the dossier's live (or last-known) INTRADAY spot against the level, never a
        // settled end-of-day close. "Closed through" claims a stable, settled fact; the real check is
        // re-evaluated on every scan and can genuinely flip back to FORMING minutes later if price
        // reclaims the level intraday — live-measured same session: SOXX read INVALIDATED at one
        // scan, then FORMING again (identical gate blocks otherwise) under an hour later, with no
        // session close in between. Saying "closed" when the read is intraday overstates how settled
        // the break is — exactly the precision violation the Largo product contract's "precision"
        // point exists to catch (same class of bug as this repo's BMO/AMC earnings-timing fixes:
        // never claim more finality than what was actually measured).
        reason: "Structure invalidated — price is through the structural invalidation level (live read; can still revert if price reclaims before the thesis window closes).",
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
  // Same live repro `watchEntryExpired` (adapters.ts) was built to fix for the WATCH-pill display
  // (2026-09-12: MU/AMD sat 46-49 days past their own 2-5 day entry window) — this is the sibling
  // gap for the RESEARCH-bucket verdict's own reason text. A row only reaches this branch once the
  // three checks above have all passed, so it is never a thin/invalidated/unclassified thesis —
  // it's a real, mature setup whose clean-fill window already lapsed. The prior fallback
  // ("thesis needs more work") misrepresented that as a weak thesis rather than a stale entry
  // opportunity — a real, still-scoring setup (live repro: AMD score 81.3, TRIGGERED+AT_TRIGGER,
  // first seen 2026-07-30, still routed RESEARCH via entryWindowExpired) read as if it had been
  // rejected on the merits.
  if (input.entryWindowExpired === true) {
    return [
      {
        code: "entry_window_expired",
        reason:
          "This setup triggered, but its entry window already lapsed — the thesis wasn't rejected, the clean-fill opportunity closed.",
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
    // GAP FOUND (2026-10-08, Ask Largo standing mandate, live AMD repro): `researchGateBlocks`
    // below returns exactly ONE reason from its own priority ladder (invalidated > persistence
    // gap > unclassified > entry-window-expired > generic "needs more work") and that single
    // reason was the WHOLE `gateBlocks` output — `input.commitGateBlockedBy` (the real, live
    // commit-gate stack: G-S3/G-S4/G-S6/G-S12/G-S14) was never consulted at all on this branch.
    // Live repro: AMD (RESEARCH, EVENT_DRIVEN/TACTICAL, entry window lapsed 8 days ago) ALSO
    // carried 3 active real gates (G-S12 halt_feed_stale, G-S4 regime_degraded, G-S14
    // cortex_net_negative) at the exact same moment — the play-brief Entry section rendered only
    // "entry_window_expired" and silently dropped all three, even though the data existed and was
    // already available via `resolveSwingCommitGateBlockedBy`/`commitGateBlocksForVerdict`. This
    // is the identical defect class the "past entry deadline + active commit gate blocks" WATCH-
    // section fix below already closed for the `dont_buy` branch ("commitGateBlockedBy is computed
    // ... regardless of which ... reason fired ... NOT specific to the wait branch") — that fix
    // never reached this earlier RESEARCH-section early return. Fix: append the real, mapped gate
    // evidence after the primary research-ladder reason, never replacing it (the ladder's own
    // reason — e.g. "thesis invalidated" — stays first and authoritative; the commit-gate detail
    // is additive context a member can act on, same as the WATCH-section sibling already does).
    const commitGateBlockedBy = resolveSwingCommitGateBlockedBy(input);
    const gateDiagnostics = { signalKinds: input.signalKinds, archetype: input.archetype };
    const realGateBlocks = commitGateBlockedBy.length
      ? commitGateBlocksForVerdict(commitGateBlockedBy, gateDiagnostics)
      : [];
    return {
      deckStatus: "SKIP",
      recommendation: "HOLD",
      recNote: "Desk is passing this setup — no entry recommended.",
      gateBlocks: [...researchGateBlocks(input), ...realGateBlocks],
      actionLabel: null,
      entryAction: "dont_buy",
    };
  }

  const commitGateBlockedBy = resolveSwingCommitGateBlockedBy(input);
  const gateDiagnostics = { signalKinds: input.signalKinds, archetype: input.archetype };
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
        gateBlocks: commitGateBlockedBy.length
          ? commitGateBlocksForVerdict(commitGateBlockedBy, gateDiagnostics)
          : null,
        actionLabel: "WAIT",
        entryAction: "wait",
      };
    case "dont_buy":
      if (input.setupState === "INVALIDATED" || input.persistenceObserved === true) {
        // BUG FIX (2026-10-25, Ask Largo standing mandate, live repro: servingSection stamped
        // "WATCH" while a freshly-read setupState already reads INVALIDATED): same defect class
        // as the two sibling fixes in this file (the RESEARCH-section early return above, and the
        // deadline-expired dont_buy branch below) — `commitGateBlockedBy` is computed once, above
        // the switch, regardless of which branch fires, but this branch was the one case that
        // still unconditionally discarded it. Reachable whenever `resolveSwingServingSection`
        // trusts a stamped `servingSection` that predates a newer setupState/persistenceObserved
        // read: `sectionForSwingPlay` would route straight to RESEARCH for either condition (which
        // DOES append the real gate evidence), but a caller that already stamped a non-RESEARCH
        // section on the row bypasses that recompute entirely (see this file's own
        // `resolveSwingServingSection`), landing here instead with the live gate codes already in
        // scope and silently dropped. Same fix: append the real, mapped gate evidence after the
        // primary thesis-invalidated/persistence-gap reason, never replacing it.
        const realGateBlocks = commitGateBlockedBy.length
          ? commitGateBlocksForVerdict(commitGateBlockedBy, gateDiagnostics)
          : [];
        return {
          deckStatus: "SKIP",
          recommendation: "HOLD",
          recNote: enter.reason,
          gateBlocks: [...researchGateBlocks(input), ...realGateBlocks],
          actionLabel: null,
          entryAction: "dont_buy",
        };
      }
      return {
        deckStatus: "WATCH",
        recommendation: "HOLD",
        recNote: enter.reason,
        // `commitGateBlockedBy` is computed above regardless of which `dont_buy` reason fired
        // (deadline-expired, contract-expired, extended-chase — see
        // evaluateSwingEntryEnterability's ordering, entry-enterability.ts) — it is NOT specific
        // to the "wait" branch two cases up. Dropping it here unconditionally silently discarded
        // real, already-mapped gate evidence (live repro: MU 2026-09-11 — 3 active commit gates
        // G-S12/G-S4/G-S6 computed and then thrown away because the entry-validity deadline had
        // ALSO expired, which fires first in evaluateSwingEntryEnterability's if-chain and wins
        // the `reason`/`recNote`) whenever a play was BOTH past its entry window AND still gate-
        // blocked — a common combination for a persistently-WATCH name. `recNote`/`actionLabel`
        // stay the deadline-expired text (that's still the primary, correct verdict); this only
        // restores the secondary gate detail so play-brief/play-brief-intel/narrative-coaching
        // (all gated on `play.gateBlocks?.length`) can surface it instead of rendering nothing.
        gateBlocks: commitGateBlockedBy.length
          ? commitGateBlocksForVerdict(commitGateBlockedBy, gateDiagnostics)
          : null,
        actionLabel: "WAIT",
        entryAction: "dont_buy",
      };
    default:
      return null;
  }
}
