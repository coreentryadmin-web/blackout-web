// 0DTE Command × Night Hawk Cortex — the wire-in bridge (PR-B of
// docs/audit/NIGHTHAWK-CORTEX-DESIGN.md §4; wiring spec §2: "the gate stack
// (G-1..G-7) runs first (cheap, fail-closed); Cortex runs on survivors; vetoes
// block; score modifies the commit floor").
//
// Decision table this module implements for a FRESH, gate-surviving find:
//   - any Cortex VETO            → BLOCKED, exactly like a hard-gate block
//                                  (rejection code `cortex_veto:<source>` + the
//                                  evidence detail sentence, surfaced as SKIP);
//   - no veto, score < 0         → BLOCKED with `cortex_net_negative` — the
//                                  design's "a G-3-passing setup with net-negative
//                                  Cortex evidence still doesn't print";
//   - no veto, score ≥ 0         → PASS (commit proceeds; the full evidence vector
//                                  is pinned on the ledger row via entry_context);
//   - BOTH veto-capable sources absent (failed to read) AND fail-closed opted in →
//                                  ABSTAIN (graceful degradation — commit proceeds on
//                                  hard gates alone, tier capped at B for thin evidence).
//                                  Was VETO_BLIND (hard block) before 2026-07-27; changed
//                                  because the hard block silently killed the entire 0DTE
//                                  engine whenever UW data was stale;
//   - no source produced ANY evidence (outage/total timeout), fail-closed NOT opted in →
//                                  ABSTAIN — commit proceeds on the hard gates alone,
//                                  recorded honestly as {abstained: true, reason}.
//
// WHY ABSTAIN is (normally) a pass-through and not a fail-closed block (deliberate
// asymmetry with the gate stack's own "unreadable input blocks" rule): the hard gates
// are the SAFETY floor — they already fail closed on unreadable tape/ledger/governor
// state. The Cortex is a PRECISION layer stacked on top of that floor; it can only ever
// remove additional plays. If a Cortex-wide outage (every reader down) also halted
// commits, one flaky upstream would silently turn the whole 0DTE engine off — a worse
// failure mode than briefly trading on gates alone, and an invisible one. The abstain is
// therefore allowed through BUT recorded on the row (entry_context.cortex.abstained), so
// the calibration loop can measure exactly how often — and how expensively — the desk
// traded without its evidence layer.
//
// VETO-BLIND DETECTION (opt-in, 0DTE fresh commits only):
// When BOTH veto-capable sources (gex-walls + flow-quality) fail to read, the Cortex is
// blind to every veto reason it exists to catch. This state is detected and logged, but
// as of 2026-07-27 it degrades to ABSTAIN (commit proceeds on hard gates) instead of the
// original VETO_BLIND hard block. The hard block was too aggressive: UW GEX/flow data is
// stale or absent for ~40% of tickers, so VETO_BLIND silently killed the entire 0DTE
// engine on most sessions. The hard gates (G-1..G-12) are the safety floor; the tier cap
// (CORTEX_THIN_EVIDENCE_MAX_ABSENT) handles quality downgrade for thin evidence. The
// veto-blind state is still recorded on the entry_context for calibration measurement.
//
// Like the gate stack itself, everything here except evaluateCortexForCommit is
// pure (unit-testable, replayable against the 7/13 fixtures); ./scan.ts assembles
// the async inputs and owns the sequencing.

import {
  composeCortexEvidence,
  fetchCortexInputs,
  CORTEX_SOURCES,
  VETO_CAPABLE_SOURCES,
  type CortexConviction,
  type CortexDirection,
  type CortexInputs,
  type CortexSourceId,
  type CortexVerdict,
  type EvidenceItem,
} from "@/lib/nighthawk/cortex";
import type { ZeroDteGateBlock } from "./gates";

/** When most sources are absent (fewer than this many answered), require a
 *  higher net score to PASS. A thin +0.1 from 2 sources is not the same
 *  confidence as +0.1 from 6 — without this floor a near-empty composite
 *  slides through identically to a well-corroborated one. */
// 2 not 3: on a normal trading day outside the 9:30-9:45 opening window, only
// ~2-3 of 8 Cortex sources can realistically answer (opening-harvest is
// time-locked, darkpool-confluence is bonus-only, wall-trend needs accumulated
// history, gex-walls/vex-charm need UW data often absent for non-index tickers).
// A threshold of 3 was a near-blanket block; 2 lets the score floor do the real
// filtering while still catching composites from a single stale source.
export const THIN_EVIDENCE_MIN_SOURCES = 2;
/** The score floor applied when evidence is thin (< THIN_EVIDENCE_MIN_SOURCES
 *  answered). Must be strictly positive — a thin wash (0) should not pass. */
export const THIN_EVIDENCE_SCORE_FLOOR = 0.5;

/** What the Cortex layer decided about a gate-surviving find. */
export type ZeroDteCortexDecision = "PASS" | "VETO" | "VETO_BLIND" | "NET_NEGATIVE" | "ABSTAIN";

/** Rejection code for the veto-blind firewall block (mirrors board.ts's ZeroDteGateFailure). */
export const CORTEX_VETO_BLIND_CODE = "cortex_veto_blind" as const;

/**
 * The full Cortex assessment carried on a fresh find (EnrichedZeroDteSetup.cortex).
 * ABSTAIN deliberately carries NO verdict object: an all-absent verdict has no
 * evidence worth persisting, and shipping an empty vector dressed as one would be
 * the exact "nulls dressed as neutrality" the design forbids. As of 2026-07-27,
 * veto-blind (both veto sources dark) also degrades to ABSTAIN — the reason string
 * records the veto-blind state for calibration. The VETO_BLIND variant is kept in
 * the decision type for backward compat with historical entry_context blobs.
 */
export type ZeroDteCortexAssessment =
  | { decision: "ABSTAIN"; abstained: true; reason: string }
  | { decision: "VETO_BLIND"; abstained: false; verdict: CortexVerdict; reason: string }
  | { decision: "PASS" | "VETO" | "NET_NEGATIVE"; abstained: false; verdict: CortexVerdict };

/** Signed score rendering ("+1.85" / "-0.6" / "0") — matches compose.ts's narrative. */
function fmtSigned(v: number): string {
  return v > 0 ? `+${v}` : `${v}`;
}

/** "[source] detail" one-liner for an evidence item — the payload/summary rendering. */
function evidenceLine(e: EvidenceItem): string {
  return `[${e.source}] ${e.detail}`;
}

/** Top-N evidence items by DECAYED weight (what the score actually used), rendered
 *  as one-liners. Stable for ties: sort is on weight desc only, and compose.ts
 *  already emits items in deterministic source order. */
function topEvidenceLines(items: EvidenceItem[], n: number): string[] {
  return [...items]
    .sort((a, b) => b.weight - a.weight)
    .slice(0, n)
    .map(evidenceLine);
}

/**
 * Fold a composed CortexVerdict into the commit decision (pure — the decision
 * table in the module doc). ABSTAIN is detected from the verdict itself: zero
 * vetoes/supports/opposes means NO source answered (every one reported absent),
 * which is "the Cortex cannot see", not "the Cortex sees nothing wrong".
 *
 * THIN-EVIDENCE GATE (added 2026-07-17): when fewer than THIN_EVIDENCE_MIN_SOURCES
 * answered, the score must clear THIN_EVIDENCE_SCORE_FLOOR to PASS. Live RTH
 * data showed 5/7 sources regularly timing out, yielding composites like +0.1
 * from 2 sources that passed identically to +2.5 from 6 — a false confidence
 * the system cannot afford on 0DTE entries.
 *
 * VETO-BLIND FIREWALL (opt-in via opts.failClosedOnVetoBlind — see the module doc): when
 * BOTH veto-capable sources (VETO_CAPABLE_SOURCES) failed to read, the Cortex cannot see
 * either hard-block reason it exists to catch. For an opted-in FRESH commit that is a HOLD
 * (VETO_BLIND), not a blind PASS/ABSTAIN. A veto that DID fire means a veto source
 * answered, so it is checked first and can never be masked by this. Off by default so the
 * SPX engine / exit engine keep their existing pass-through behavior.
 */
export function assessCortexVerdict(
  verdict: CortexVerdict,
  opts?: { failClosedOnVetoBlind?: boolean }
): ZeroDteCortexAssessment {
  // A veto is the loudest possible answer — if any source vetoed it clearly answered, so
  // block on it FIRST (this also means veto-blindness below can never mask a real veto).
  if (verdict.vetoes.length > 0) return { decision: "VETO", abstained: false, verdict };

  // ── Veto-blind firewall (opt-in) ──────────────────────────────────────────────────
  // "Answered" = the source contributed at least one live (non-absent, non-stale)
  // support/oppose item to the composed verdict. A source that only produced an absent
  // item, or self-silenced on staleness, is NOT in these lists (compose.ts routes those
  // to verdict.absent) — so it correctly counts as blind. Identifying the veto channel
  // from VETO_CAPABLE_SOURCES (not a hardcoded local list) keeps this in lockstep with
  // the source registry.
  // VETO-BLIND GRACEFUL DEGRADATION (changed 2026-07-27): when both veto-capable sources
  // are dark, the original firewall returned VETO_BLIND (hard block). In practice this
  // blocked ALL plays whenever UW GEX/flow data was stale or absent — which happens on
  // ~40% of tickers and most of Sunday/pre-market. The hard gates (G-1..G-12) are already
  // the safety floor; Cortex is the precision layer. If it can't see, the play is lower
  // confidence (tier cap at B handles this via CORTEX_THIN_EVIDENCE_MAX_ABSENT), not
  // forbidden. The veto-blind state is still detected and recorded on the entry_context
  // for calibration, but it no longer blocks the commit.
  if (opts?.failClosedOnVetoBlind) {
    const answered = new Set<CortexSourceId>();
    for (const it of verdict.supports) answered.add(it.source);
    for (const it of verdict.opposes) answered.add(it.source);
    const vetoBlind =
      VETO_CAPABLE_SOURCES.length > 0 && VETO_CAPABLE_SOURCES.every((s) => !answered.has(s));
    if (vetoBlind) {
      // Graceful degradation: fall through to ABSTAIN instead of hard-blocking.
      // The tier cap (tiers.ts CORTEX_THIN_EVIDENCE_MAX_ABSENT) already caps these
      // at B-tier, and the entry_context records the blind state for calibration.
      return {
        decision: "ABSTAIN",
        abstained: true,
        reason:
          `Cortex is blind to BOTH veto-capable sources (${VETO_CAPABLE_SOURCES.join(" + ")} ` +
          `failed to read; ${verdict.absent.length} sources absent) — commit proceeds on ` +
          "the hard gates alone (tier capped for thin evidence).",
      };
    }
  }

  // No veto, not veto-blind: an all-absent composite (no live evidence at all) honestly
  // ABSTAINs — commit proceeds on the hard gates alone. (With failClosedOnVetoBlind on,
  // the veto-blind path above already returns ABSTAIN, so this branch only fires for
  // non-veto-blind all-absent cases — kept as a defensive floor.)
  if (verdict.supports.length === 0 && verdict.opposes.length === 0) {
    return {
      decision: "ABSTAIN",
      abstained: true,
      reason:
        `no Cortex source produced evidence (${verdict.absent.length} absent) — ` +
        "commit proceeds on the hard gates alone.",
    };
  }

  if (verdict.score < 0) return { decision: "NET_NEGATIVE", abstained: false, verdict };

  // Thin-evidence gate: few sources answered → require a meaningful positive
  // score, not just a bare non-negative. The number of answering sources is
  // total minus absent (each absent source is listed by ID in verdict.absent).
  const answering = CORTEX_SOURCES.length - verdict.absent.length;
  if (answering < THIN_EVIDENCE_MIN_SOURCES && verdict.score < THIN_EVIDENCE_SCORE_FLOOR) {
    return { decision: "NET_NEGATIVE", abstained: false, verdict };
  }

  return { decision: "PASS", abstained: false, verdict };
}

/**
 * The gate-stack bridge: render a blocking assessment as ZeroDteGateBlock rows so
 * a Cortex block flows through the EXACT same plumbing as a hard-gate block —
 * same SKIP card rendering, same zerodte_scan_rejections persistence (via
 * gateRejectionFor: blocks[0].code becomes gate_failed, every reason sentence is
 * concatenated). PASS and ABSTAIN produce no blocks (commit proceeds).
 */
export function cortexGateBlocks(assessment: ZeroDteCortexAssessment | null): ZeroDteGateBlock[] {
  if (assessment == null || assessment.abstained || assessment.decision === "PASS") return [];
  // VETO_BLIND is now ABSTAIN (graceful degradation, 2026-07-27) — no blocks produced.
  if (assessment.decision === "VETO") {
    // One block per veto (not one merged block): each veto is an independent hard
    // fact with its own source + detail sentence, and the SKIP card should show all
    // of them — same "ALL failing gates, not just the first" rule as gates.ts.
    return assessment.verdict.vetoes.map(
      (v): ZeroDteGateBlock => ({
        code: `cortex_veto:${v.source}`,
        reason: `Cortex veto [${v.source}]: ${v.detail}`,
        threshold: null,
        unlock_et: null,
      })
    );
  }
  // NET_NEGATIVE — one block; the threshold is the 0 floor the score was judged
  // against, and the reason carries the top opposing evidence so the SKIP card
  // argues the block instead of just asserting it.
  const opposes = topEvidenceLines(assessment.verdict.opposes, 3);
  return [
    {
      code: "cortex_net_negative",
      reason:
        `Cortex evidence nets ${fmtSigned(assessment.verdict.score)} against this ` +
        `${assessment.verdict.direction} — a gate-passing setup with net-negative evidence ` +
        `still doesn't print. Opposing: ${opposes.join(" ")}`,
      threshold: 0,
      unlock_et: null,
    },
  ];
}

/** Compact verdict summary for board/Largo payloads: enough for a member-facing
 *  card (score, conviction, veto list, top-3 supports/opposes one-liners) without
 *  shipping the full evidence vector on every poll. */
export type ZeroDteCortexSummary =
  | { abstained: true; reason: string }
  | {
      abstained: false;
      decision: "PASS" | "VETO" | "VETO_BLIND" | "NET_NEGATIVE";
      score: number;
      conviction: CortexConviction;
      /** Every veto as a "[source] detail" line (empty when clear). */
      vetoes: string[];
      /** Top-3 supporting/opposing one-liners by decayed weight. */
      top_supports: string[];
      top_opposes: string[];
    };

export function cortexSummaryFor(assessment: ZeroDteCortexAssessment | null): ZeroDteCortexSummary | null {
  if (assessment == null) return null;
  if (assessment.abstained) return { abstained: true, reason: assessment.reason };
  const v = assessment.verdict;
  return {
    abstained: false,
    decision: assessment.decision,
    score: v.score,
    conviction: v.conviction,
    vetoes: v.vetoes.map(evidenceLine),
    top_supports: topEvidenceLines(v.supports, 3),
    top_opposes: topEvidenceLines(v.opposes, 3),
  };
}

/**
 * The entry_context.cortex blob pinned on a COMMITTED ledger row — the FULL
 * evidence vector (design §3.1: "persist the entire evidence vector on every
 * commit"; the nightly calibration job of PR-C grades per-source hit rates from
 * exactly this). Blocked finds never reach this function's output path: they go
 * to zerodte_scan_rejections and never write a ledger row / entry_context at all
 * (persistZeroDteScan's blocked-find invariant).
 */
export type ZeroDteCortexEntryContext =
  | { abstained: true; reason: string }
  | {
      abstained: false;
      decision: "PASS" | "VETO" | "VETO_BLIND" | "NET_NEGATIVE";
      as_of: string;
      score: number;
      conviction: CortexConviction;
      vetoes: EvidenceItem[];
      supports: EvidenceItem[];
      opposes: EvidenceItem[];
      absent: string[];
      narrative: string[];
    };

export function cortexEntryContextFor(
  assessment: ZeroDteCortexAssessment | null
): ZeroDteCortexEntryContext | null {
  if (assessment == null) return null; // Cortex never ran (refresh lane) — no blob, never a fake one
  if (assessment.abstained) return { abstained: true, reason: assessment.reason };
  const v = assessment.verdict;
  return {
    abstained: false,
    decision: assessment.decision,
    as_of: v.asOf,
    score: v.score,
    conviction: v.conviction,
    vetoes: v.vetoes,
    supports: v.supports,
    opposes: v.opposes,
    absent: v.absent,
    narrative: v.narrative,
  };
}

/** Injectable IO seams so the fail-soft contract below is testable without module
 *  mocks or a live platform (same idiom as fetch.ts's CortexFetchDeps). */
export type CortexCommitDeps = {
  fetchInputs?: (
    ticker: string,
    direction: CortexDirection,
    opts: { now: Date }
  ) => Promise<CortexInputs>;
  compose?: (inputs: CortexInputs) => CortexVerdict;
};

/**
 * The one IO entry point ./scan.ts calls per gate-surviving find: fetch the
 * (already time-budgeted) Cortex inputs, compose with the scan's own clock, fold
 * into the commit decision.
 *
 * FAIL-SOFT, HONESTLY: this function never throws. fetchCortexInputs already
 * never throws (worst case: every slice null → every source absent → ABSTAIN via
 * assessCortexVerdict, or VETO_BLIND when the caller opts into the firewall), so the
 * catch below only guards programmer error (compose's invalid-clock TypeError and the
 * like) — and even that degrades to an ABSTAIN with the error class in the reason, never a
 * stalled or halted scan. A Cortex outage must not turn the whole 0DTE engine off; the
 * hard gates are the safety floor (see the module doc).
 *
 * `opts.failClosedOnVetoBlind` (0DTE Command fresh commits pass true; the SPX engine and
 * exit engine leave it false) detects a both-veto-absent verdict and records it, but
 * degrades to ABSTAIN (commit proceeds on hard gates, tier capped) — see module doc.
 */
export async function evaluateCortexForCommit(
  ticker: string,
  direction: CortexDirection,
  now: Date,
  deps: CortexCommitDeps = {},
  opts?: { failClosedOnVetoBlind?: boolean }
): Promise<ZeroDteCortexAssessment> {
  try {
    const inputs = await (deps.fetchInputs ?? fetchCortexInputs)(ticker, direction, { now });
    const verdict = (deps.compose ?? composeCortexEvidence)(inputs);
    return assessCortexVerdict(verdict, opts);
  } catch (err) {
    const cls = err instanceof Error ? err.name || err.constructor.name : typeof err;
    return {
      decision: "ABSTAIN",
      abstained: true,
      reason: `Cortex evaluation failed (${cls}) — commit proceeds on the hard gates alone.`,
    };
  }
}
