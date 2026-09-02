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
//   - no veto, score ≥ 0 but < THIN_EVIDENCE_MIN_SOURCES answered AND score <
//     THIN_EVIDENCE_SCORE_FLOOR → BLOCKED with `cortex_thin_evidence` — a distinct
//                                  decision from NET_NEGATIVE (fixed 2026-09-01): the
//                                  score here is never negative, just too thinly
//                                  corroborated to trust;
//   - no veto, score ≥ 0, no active gex-walls oppose (or score ≥ CONVICTION_A_MIN_SCORE) →
//                                  PASS (commit proceeds; the full evidence vector is
//                                  pinned on the ledger row via entry_context);
//   - no veto, an active gex-walls oppose ≥ GEX_WALLS_OPPOSE_PRESENCE_MIN_WEIGHT AND
//     score < CONVICTION_A_MIN_SCORE → BLOCKED with `cortex_gex_walls_oppose_unresolved`
//                                  (added 2026-08-28; evidenced separately from the
//                                  score < 0 case above — see GEX_WALLS_OPPOSE_PRESENCE_MIN_WEIGHT);
//   - BOTH veto-capable sources absent (failed to read) AND fail-closed opted in →
//                                  VETO_BLIND (HOLD — fresh commit blocked). Restored
//                                  2026-07-29: the 07-27 ABSTAIN degradation reopened the
//                                  Phase-0 firewall leak on the exact days vetoes matter
//                                  (provider stress / missing GEX+flow). Opt-out still
//                                  exists for non-fresh paths (SPX/exit) that omit the flag.
//   - no source produced ANY evidence (outage/total timeout), fail-closed NOT opted in →
//                                  ABSTAIN — commit proceeds on the hard gates alone,
//                                  recorded honestly as {abstained: true, reason}.
//
// WHY ABSTAIN is (normally) a pass-through and not a fail-closed block (deliberate
// asymmetry with the gate stack's own "unreadable input blocks" rule): the hard gates
// are the SAFETY floor — they already fail closed on unreadable tape/ledger/governor
// state. The Cortex is a PRECISION layer stacked on top of that floor; it can only ever
// remove additional plays. A TOTAL Cortex outage (every reader down) without the
// veto-blind opt-in still ABSTAINs so one flaky upstream doesn't silently turn the whole
// 0DTE engine off. But for a FRESH commit that opts into failClosedOnVetoBlind, blindness
// to BOTH veto channels is a HOLD — opening new risk without dealer-wall / opposing-whale
// protection is exactly what fail-closed is for (0DTE-UNIFICATION-DESIGN §2).
//
// VETO-BLIND FIREWALL (opt-in via failClosedOnVetoBlind — scan.ts passes true for fresh
// commits): when BOTH veto-capable sources (gex-walls + flow-quality) fail to read, return
// VETO_BLIND (hard block + cortex_veto_blind rejection). Non-opted callers keep prior
// pass-through behavior.
//
// Like the gate stack itself, everything here except evaluateCortexForCommit is
// pure (unit-testable, replayable against the 7/13 fixtures); ./scan.ts assembles
// the async inputs and owns the sequencing.

import {
  composeCortexEvidence,
  fetchCortexInputs,
  CORTEX_SOURCES,
  CONVICTION_A_MIN_SCORE,
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

/**
 * GEX-WALLS OPPOSE PRESENCE (added 2026-08-28). `cortex-oppose-magnitude-ab.mjs` measured
 * 341 graded plays over a 90-day window (docs/audit/INTENTIONAL-DESIGN.md item #6): the
 * oppose-MAGNITUDE theory was NOT monotonic (a [0.40,0.60) weight band graded BETTER than
 * [0.20,0.40)), but a coarser pattern held cleanly — ANY active `gex-walls` oppose in
 * [0.20,0.60) graded 31-43% WR, worse than the 48.3% WR clean-signal baseline, independent
 * of the net score's sign. The live 2026-08-28 record independently reproduced the same
 * shape same-week: 22 of that week's 32 losing/losing-adjacent rows carried an active
 * `gex-walls` oppose at commit. Two independent samples agreeing is why this gate exists
 * now rather than waiting on a single measurement. This threshold (0.20) is the AB script's
 * own lower bucket boundary — the floor below which oppose weight wasn't part of either
 * measured claim, so this gate makes no claim about smaller residual opposition. */
export const GEX_WALLS_OPPOSE_PRESENCE_MIN_WEIGHT = 0.2;

/** What the Cortex layer decided about a gate-surviving find. */
export type ZeroDteCortexDecision =
  | "PASS"
  | "VETO"
  | "VETO_BLIND"
  | "NET_NEGATIVE"
  | "THIN_EVIDENCE"
  | "CONTESTED"
  | "OPPOSE_UNRESOLVED"
  | "ABSTAIN";

/** Rejection code for the veto-blind firewall block (mirrors board.ts's ZeroDteGateFailure). */
export const CORTEX_VETO_BLIND_CODE = "cortex_veto_blind" as const;

/**
 * The full Cortex assessment carried on a fresh find (EnrichedZeroDteSetup.cortex).
 * ABSTAIN deliberately carries NO verdict object: an all-absent verdict has no
 * evidence worth persisting, and shipping an empty vector dressed as one would be
 * the exact "nulls dressed as neutrality" the design forbids. VETO_BLIND carries the
 * verdict + reason so the SKIP card / rejection log can explain the HOLD.
 */
export type ZeroDteCortexAssessment =
  | { decision: "ABSTAIN"; abstained: true; reason: string }
  | { decision: "VETO_BLIND"; abstained: false; verdict: CortexVerdict; reason: string }
  | {
      decision: "PASS" | "VETO" | "NET_NEGATIVE" | "THIN_EVIDENCE" | "CONTESTED" | "OPPOSE_UNRESOLVED";
      abstained: false;
      verdict: CortexVerdict;
    };

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
  // VETO-BLIND FAIL-CLOSED (restored 2026-07-29): when both veto-capable sources are
  // dark on an opted-in FRESH commit, HOLD — do not open new risk without the two
  // protections Cortex exists to provide (dealer wall in path + opposing $1M cluster).
  if (opts?.failClosedOnVetoBlind) {
    const answered = new Set<CortexSourceId>();
    for (const it of verdict.supports) answered.add(it.source);
    for (const it of verdict.opposes) answered.add(it.source);
    const vetoBlind =
      VETO_CAPABLE_SOURCES.length > 0 && VETO_CAPABLE_SOURCES.every((s) => !answered.has(s));
    if (vetoBlind) {
      return {
        decision: "VETO_BLIND",
        abstained: false,
        verdict,
        reason:
          `Cortex is blind to BOTH veto-capable sources (${VETO_CAPABLE_SOURCES.join(" + ")} ` +
          `failed to read; ${verdict.absent.length} sources absent) — fresh commit HOLDS until ` +
          "at least one veto channel can see.",
      };
    }
  }

  // No veto, not veto-blind: an all-absent composite (no live evidence at all) honestly
  // ABSTAINs — commit proceeds on the hard gates alone. (With failClosedOnVetoBlind on,
  // the veto-blind path above already HOLDs, so this branch only fires for
  // non-opted / non-veto-blind all-absent cases.)
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

  // NH-R9 contested gate: verdict.contested means both a real support case AND a
  // real oppose case are on the table (compose.ts CONTESTED_MIN_MAGNITUDE on both
  // sides) — a genuine internal disagreement, not a quiet composite. Score alone
  // can't tell these apart: +2.0 support / -1.9 oppose nets to +0.1, identical to
  // two nearly-silent sources idling at +0.1/0. Below the A floor that fight isn't
  // resolved decisively enough to trust — BLOCK rather than let a contested wash
  // pass as if nothing argued against it. At/above CONVICTION_A_MIN_SCORE the
  // support side has already won decisively enough that residual opposition is
  // expected noise, not a live contest — that band still PASSes.
  if (verdict.contested && verdict.score < CONVICTION_A_MIN_SCORE) {
    return { decision: "CONTESTED", abstained: false, verdict };
  }

  // GEX-WALLS OPPOSE PRESENCE (see GEX_WALLS_OPPOSE_PRESENCE_MIN_WEIGHT doc): a real,
  // live gex-walls oppose is evidenced to predict a worse outcome even when it's too
  // small to win CONTESTED's both-sides-≥0.75 bar or drag the net score negative. Same
  // "below the decisive floor, don't let it pass silently" logic as CONTESTED above —
  // just triggered by a source proven to matter at a lower bar than the general
  // both-sides-real-fight case.
  const gexWallsOppose = verdict.opposes.find(
    (o) => o.source === "gex-walls" && o.weight >= GEX_WALLS_OPPOSE_PRESENCE_MIN_WEIGHT
  );
  if (gexWallsOppose != null && verdict.score < CONVICTION_A_MIN_SCORE) {
    return { decision: "OPPOSE_UNRESOLVED", abstained: false, verdict };
  }

  // Thin-evidence gate: few sources answered → require a meaningful positive
  // score, not just a bare non-negative. The number of answering sources is
  // total minus absent (each absent source is listed by ID in verdict.absent).
  //
  // THIN_EVIDENCE is its OWN decision, not NET_NEGATIVE (fixed 2026-09-01) — the
  // `verdict.score < 0` check above already returns NET_NEGATIVE for every genuinely
  // negative score, so by construction this branch only ever runs with `score >= 0`.
  // Labeling it NET_NEGATIVE therefore described a non-negative (sometimes clearly
  // positive) score as "against" the direction — cortexGateBlocks's reason text
  // literally read "Cortex evidence nets +0.1 against this short", which is false:
  // +0.1 supports the direction, it just isn't enough support from enough sources to
  // trust. The block is correct (thin evidence should not clear the bar); the label
  // describing WHY was not.
  const answering = CORTEX_SOURCES.length - verdict.absent.length;
  if (answering < THIN_EVIDENCE_MIN_SOURCES && verdict.score < THIN_EVIDENCE_SCORE_FLOOR) {
    return { decision: "THIN_EVIDENCE", abstained: false, verdict };
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
  if (assessment.decision === "VETO_BLIND") {
    return [
      {
        code: CORTEX_VETO_BLIND_CODE,
        reason: assessment.reason,
        threshold: null,
        unlock_et: null,
      },
    ];
  }
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
  if (assessment.decision === "CONTESTED") {
    // CONTESTED — one block; unlike NET_NEGATIVE (which only ever cites the
    // opposing side, since a negative score means opposition dominates), this
    // reason cites BOTH sides — the whole point is that support was real too, not
    // just noise the net score hid.
    const supports = topEvidenceLines(assessment.verdict.supports, 3);
    const opposes = topEvidenceLines(assessment.verdict.opposes, 3);
    return [
      {
        code: "cortex_contested",
        reason:
          `Cortex evidence is contested, not clean: real support and real opposition are ` +
          `both on the table (net ${fmtSigned(assessment.verdict.score)}, below the ` +
          `${CONVICTION_A_MIN_SCORE} decisive floor) — a gate-passing setup does not print on an ` +
          `unresolved internal disagreement. Supporting: ${supports.join(" ")} Opposing: ${opposes.join(" ")}`,
        threshold: CONVICTION_A_MIN_SCORE,
        unlock_et: null,
      },
    ];
  }

  if (assessment.decision === "OPPOSE_UNRESOLVED") {
    // Real, live gex-walls oppose below the decisive floor — evidenced (90-day +
    // same-week live) to predict a worse outcome even at net score ≥ 0, which is why
    // this checks separately from NET_NEGATIVE (which only fires on score < 0) and cites
    // the specific gex-walls oppose rather than the generic opposing-evidence list.
    const gexWallsOpposes = assessment.verdict.opposes.filter((o) => o.source === "gex-walls");
    const opposeLines = topEvidenceLines(gexWallsOpposes, 3);
    return [
      {
        code: "cortex_gex_walls_oppose_unresolved",
        reason:
          `Active gex-walls oppose at net ${fmtSigned(assessment.verdict.score)} — below the ` +
          `${CONVICTION_A_MIN_SCORE} decisive floor. A gex-walls oppose this size is measured to ` +
          "grade worse than a clean signal (31-43% WR vs 48.3% baseline, 90-day + " +
          `same-week live confirmation) even when net score stays non-negative. ${opposeLines.join(" ")}`,
        threshold: CONVICTION_A_MIN_SCORE,
        unlock_et: null,
      },
    ];
  }

  if (assessment.decision === "THIN_EVIDENCE") {
    // Too few sources answered to trust the (non-negative) score they produced — see
    // assessCortexVerdict's THIN_EVIDENCE comment. Cites SUPPORTS, not opposes: unlike
    // NET_NEGATIVE, the evidence that exists here favors the direction, it just isn't
    // corroborated by enough sources to clear the higher bar thin evidence requires.
    const answering = CORTEX_SOURCES.length - assessment.verdict.absent.length;
    const supportLines = topEvidenceLines(assessment.verdict.supports, 3);
    return [
      {
        code: "cortex_thin_evidence",
        reason:
          `Only ${answering} of ${CORTEX_SOURCES.length} Cortex sources answered (need ` +
          `${THIN_EVIDENCE_MIN_SOURCES}+) — net ${fmtSigned(assessment.verdict.score)} does not clear the ` +
          `${THIN_EVIDENCE_SCORE_FLOOR} floor required with this little corroboration, even though the ` +
          `score itself is not negative. ${supportLines.join(" ")}`,
        threshold: THIN_EVIDENCE_SCORE_FLOOR,
        unlock_et: null,
      },
    ];
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
      decision: "PASS" | "VETO" | "VETO_BLIND" | "NET_NEGATIVE" | "THIN_EVIDENCE" | "CONTESTED" | "OPPOSE_UNRESOLVED";
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
      decision: "PASS" | "VETO" | "VETO_BLIND" | "NET_NEGATIVE" | "THIN_EVIDENCE" | "CONTESTED" | "OPPOSE_UNRESOLVED";
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
