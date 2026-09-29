// src/lib/swing/serving-board.ts — the SWING sectioned-lane assembler (PR-12). Pure, no IO.
//
// WHY (docs/audit/SWING-ENGINE.md §4 PR-12): the SWING lane does not render as a flat committed/watch split
// like 0DTE — it renders as the seven action-triage SECTIONS (serving.ts). This module assembles one
// `SwingServingLane`: it takes the lane's produced plays, groups them into the seven sections via the
// observable router (`buildSwingSections` → `sectionForSwingPlay`), and wraps them in the lane's spec
// metadata (label / tag / hold / exit / floor + whether the floor is calibration-graduated).
//
// FOUR PRE-ENTRY + THREE LIVE: pre-entry sections populate from discovery plays; live-position sections
// (MANAGING / SCALING_OUT / EXITING) populate when `getSwingServingLane` is given open ledger rows via
// `fetchOpenPositions`. Empty live buckets are still always present so the desk renders every section.
//
// CALIBRATION-FIRST / MEMBER-SAFE: the lane carries the PROVISIONAL-floor flag (`scoreFloorGraduated:false`
// for SWING — the desk marks the floor as not-yet-graded) and holds `calibratedProbability`/`expectedValue`
// at LITERAL null (nothing has graduated a calibrated surface; the desk shows "—", not a fabricated edge).
//
// PURE & deterministic — `asOf` is caller-stamped, so this never reads the clock.

import { HORIZONS } from "../horizons";
import type { HorizonLaneBoard } from "../horizon-board";
import type { HorizonPlay } from "../horizon-plays";
import { buildSwingSections, type SwingServingSections } from "./serving";

/**
 * The SWING lane as the desk renders it: the standard `HorizonLaneBoard` shape PLUS the always-populated
 * seven-section grouping and the (PR-12: null) calibrated surfaces. Extends `HorizonLaneBoard` so it splices
 * straight into a `HorizonBoard.lanes.SWING` slot — the extra fields ride along in the JSON the route serves.
 */
export interface SwingServingLane extends HorizonLaneBoard {
  /** Always present for the swing lane (all seven buckets, empty ones included). */
  sections: SwingServingSections;
  /** LITERAL null in PR-12 — no swing bucket has graduated a calibrated probability (PR-16 lights it). */
  calibratedProbability: number | null;
  /** LITERAL null in PR-12 — no graded EV surface until the ladder graduates the bucket. */
  expectedValue: number | null;
  /** ISO instant of the latest whole-market discovery scan (member-visible freshness). */
  scanAsOf?: string | null;
  /** ET session day the discovery scan is anchored to. */
  scanSessionDay?: string | null;
}

/**
 * Assemble the SWING serving lane from its produced plays. The plays should already carry their observable
 * swing state (setupState / entryStatus / status) — the serving router keys on those to place each into its
 * section; a play with no maturity read degrades honestly to RESEARCH (never a fabricated actionable bucket).
 *
 * `committed`/`watch` are the derived COMMIT/WATCH back-compat views (so the pre-section renderers and the
 * board totals keep working); `sections` is the real member-facing grouping.
 *
 * FIX (Ask Largo standing mandate, live-verified 2026-09-23): `watch` used to be re-derived independently
 * from raw `p.status === "WATCH"`, bypassing `buildSwingSections`/`sectionForSwingPlay` entirely — the
 * exact router `serving.ts`'s own header says decides "what bucket does this show in" and that "nothing
 * else in the engine" should. PR #337 (2026-09-22) taught the router to route a name whose entry-validity
 * window has expired to RESEARCH instead of WATCH — but only fixed `sections.WATCH`; this back-compat
 * `watch` field, independently re-filtered from raw status, never got the same fix and kept serving the
 * stale name anyway. Live repro: AMZN (TACTICAL sub-lane, 2-day entry window) first flagged 2026-09-08,
 * still 15 days later in `board.lanes.SWING.watch` on `GET /api/market/nighthawk/horizons?view=swings` —
 * the exact field Largo's tools and this route serve directly — while its own play-brief narrative
 * (which DOES read the router's verdict) correctly said "Serving section: RESEARCH... entry-validity
 * window expired". Fix: derive `watch` FROM the already-computed `sections.WATCH` instead of re-filtering
 * raw status, so it can never disagree with the router by construction.
 *
 * FIX 2 (Ask Largo standing mandate, live-verified 2026-09-25): `committed` had the exact same bug class —
 * re-derived independently from raw `p.status === "COMMIT"`, which is only the mechanical COMMIT/WATCH
 * floor-gate result (`aboveFloor`), not "this is an actionable-or-live thesis." The INTENDED semantics
 * (per two existing product-reads.ts regression tests from earlier live incidents —
 * `product-reads-swing-open-count.test.ts`, 2026-09-08, and `product-reads-swing-sample-gate-blocked
 * .test.ts`, 2026-09-22) are: `committed`/`committedCount` = every "floor cleared" thesis, i.e. everything
 * the router does NOT place in WATCH or RESEARCH (COMMIT_NOW ∪ WAITING_FOR_ENTRY ∪ the three live sections)
 * — INCLUDING a score-qualified thesis that is real-time-gate-blocked (`commitGateBlockedBy` non-empty,
 * e.g. `gate:G-S12:halt_feed_stale`) or hasn't reached the ledger yet (no `positionId`), which
 * `swingHorizonForLargo` deliberately keeps in the count and instead discloses via a separate
 * `open_position_count`/per-row `commit_gate_blocked`/`open_position` — that disambiguation lives at the
 * Largo product-read layer on purpose, not by filtering the board's own `committed` array.
 *
 * What was actually broken: an UNCLASSIFIED or FORMING pre-entry play (no real setup-maturity read, or a
 * thesis still building) can carry `status:"COMMIT"` from the mechanical floor gate alone, and the router
 * correctly places THAT in WATCH or RESEARCH — those plays were being wrongly counted as committed too.
 * Live repro: `board.lanes.SWING.committedCount` read 91 while `GET /api/market/swing/record`'s
 * `summary.opens` (the real tracked-position count) was 82; live-verified that every one of the 9
 * overcounted names had landed in `sections.WATCH`/`sections.RESEARCH` (FORMING/unclassified, not
 * COMMIT_NOW/WAITING_FOR_ENTRY), 6 of them byte-identical duplicate objects appearing in BOTH `committed`
 * and `watch`. The comment that used to sit here ("no live-position entry-window-expiry case exists for
 * `committed`, narrowing scope avoids risk") was itself the exact same staleness trap this file's own
 * #4076 corrections warn about — it was never re-verified against a live board. Fix: derive `committed`
 * FROM the router's own non-WATCH/RESEARCH sections instead of re-filtering raw status, so — like `watch`
 * — it can never disagree with the router by construction, while still matching the product-reads.ts
 * layer's documented "floor cleared, not necessarily open" semantics.
 */
export function assembleSwingServingLane(plays: readonly HorizonPlay[]): SwingServingLane {
  const spec = HORIZONS.SWING;
  const sections = buildSwingSections(plays);
  const committed = [
    ...sections.COMMIT_NOW,
    ...sections.WAITING_FOR_ENTRY,
    ...sections.MANAGING,
    ...sections.SCALING_OUT,
    ...sections.EXITING,
  ];
  const watch = sections.WATCH;
  return {
    horizon: "SWING",
    label: spec.label,
    tag: spec.tag,
    holdLabel: spec.holdLabel,
    exit: spec.exit,
    scoreFloor: spec.scoreFloor,
    // PROVISIONAL floor: SWING's floor is not calibration-graduated yet — the desk marks it as such so a
    // member never reads an ungraduated floor as a proven edge.
    scoreFloorGraduated: spec.scoreFloorGraduated,
    committed,
    watch,
    committedCount: committed.length,
    watchCount: watch.length,
    // The seven action-triage buckets (four pre-entry live in PR-12; three live-position empty until PR-13).
    sections,
    // Calibration-first: null until an archetype×sub-lane bucket graduates (PR-16). The desk renders "—".
    calibratedProbability: null,
    expectedValue: null,
  };
}

/** An empty-but-structured SWING serving lane — every section present and empty, provisional floor, null
 *  calibrated surfaces. The member-safe default the route serves before discovery is wired (PR-13). */
export function emptySwingServingLane(): SwingServingLane {
  return assembleSwingServingLane([]);
}
