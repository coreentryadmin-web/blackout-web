import { test } from "node:test";
import assert from "node:assert/strict";

// ── 2026-07-13 replay — the gate stack's regression fixture ────────────────────────
// The REAL session ledger that motivated the whole gate stack (1W/7L, all seven
// losers at/near the −50% stop), replayed play-by-play through evaluateZeroDteGates
// with the market context of that day. Assertion target: the projected-outcome
// table in docs/audit/NIGHTHAWK-0DTE-DECISION.md §2, adjusted where this
// implementation legitimately differs — each deviation documented inline.
//
// Fixture provenance (nh0dte forensics dataset, derived.json, pulled 2026-07-13):
// - 8 plays with flag times + ledger scores as committed that day.
// - SPY session bias: DOWN all session (SPX −0.43% open→close; the board's own
//   end-of-day fresh find was SPY short, score 93).
// - Day-open VIX (Polygon I:VIX daily bar): 16.32. NOTE: the decision doc's §2
//   G-4 row says "7/13 VIX open 17.2" — that contradicts the dataset it cites
//   (derived.json: vix_day_open 16.32, band 15-17, for every 7/13 row). The
//   DATASET wins here; at 16.32 the G-4 calibration verdict is tier "normal" for
//   every play. G-4 is calibration-only either way, so nothing blocks on it.
// - Night Hawk context: the 7/10 edition carried META LONG (conviction A) — the
//   canonical G-6 conflict. No Slayer play was open on 7/13 (its ledger's last
//   play closed 7/10; Monday's edition had 0 plays).
//
// G-2 ATTRIBUTION (user-authorized 2026-07-23, supersedes the 2026-07-13 boundary): the
// opening window now runs 9:30–10:00 ET (unlock 10:00), on evidence that 9:45 was the WORST
// entry time (−12% EV, docs/audit/0DTE-RESEARCH.md). In this replay the pre-10:00 entries
// (AMD 09:50, SPY/MU 09:55) now ALSO collect G-2; the ≥10:00 entries do not. The original
// F-3 finding still holds — the index-ETF opening longs (SPY) ALSO block on G-1 (tape
// alignment): counter-tape entries on index products, not clock position alone, are what
// killed the day; the extended window is a second, corroborating guard on the worst clock
// band. Single-name stocks (AMD, MU, NVDA, INTC) bypass G-1 entirely.

import { evaluateZeroDteGates, gateRejectionFor, type ZeroDteGateVerdict } from "./gates";
import type { ContractPlan } from "./plan";
import type { GovernorOpenPlan } from "./governor";
// ── Cortex layer (PR-B wire-in) — the same 7/13 session replayed through the FULL
// stack: hard gates first, then composeCortexEvidence over the design doc's own
// 7/13 fixtures on the gate survivors (NIGHTHAWK-CORTEX-DESIGN.md §2 wiring).
import { composeCortexEvidence, type CortexInputs } from "@/lib/nighthawk/cortex";
import { QQQ_SHORT_2026_07_13 } from "@/lib/nighthawk/cortex/fixtures-2026-07-13";
import { baseInputs } from "@/lib/nighthawk/cortex/test-helpers";
import { assessCortexVerdict, cortexEntryContextFor, cortexGateBlocks } from "./cortex-gate";

/** 2026-07-13 is EDT: ET minutes + 4h = UTC. */
const dayMs = (etMinutes: number) => Date.parse("2026-07-13T04:00:00Z") + etMinutes * 60_000;

type FixturePlay = {
  ticker: string;
  direction: "long" | "short";
  flag_et: string;
  et_minutes: number;
  /** Ledger score as committed that day (derived.json). */
  score: number;
  /** Provisional session P&L, % premium (context only — not a gate input). */
  pnl: number;
};

// The real ledger, in flag order.
const LEDGER_2026_07_13: FixturePlay[] = [
  { ticker: "AMD", direction: "long", flag_et: "09:50", et_minutes: 9 * 60 + 50, score: 58, pnl: -47.93 },
  { ticker: "SPY", direction: "long", flag_et: "09:55", et_minutes: 9 * 60 + 55, score: 93, pnl: -52.74 },
  { ticker: "MU", direction: "long", flag_et: "09:55", et_minutes: 9 * 60 + 55, score: 73, pnl: -46.0 },
  { ticker: "SPXW", direction: "long", flag_et: "10:00", et_minutes: 10 * 60, score: 78, pnl: -69.39 },
  { ticker: "QQQ", direction: "short", flag_et: "10:20", et_minutes: 10 * 60 + 20, score: 65, pnl: 76.57 },
  { ticker: "META", direction: "short", flag_et: "10:40", et_minutes: 10 * 60 + 40, score: 67, pnl: -50.11 },
  { ticker: "NVDA", direction: "long", flag_et: "12:40", et_minutes: 12 * 60 + 40, score: 40, pnl: -57.25 },
  { ticker: "INTC", direction: "short", flag_et: "12:51", et_minutes: 12 * 60 + 51, score: 61, pnl: -50.0 },
];

const VIX_DAY_OPEN = 16.32;

/** Historical replay assumes an enterable plan existed at flag time (G-8/G-9). */
const REPLAY_PLAN: ContractPlan = {
  occ: "O:REPLAY000000C00000000",
  flow_avg_fill: 2,
  bid: 1.9,
  ask: 2.1,
  mark: 2,
  entry_max: 2,
  vs_flow_pct: 0,
  entry_status: "IN_RANGE",
  spread_pct: 10,
  illiquid: false,
  stop_premium: 1,
  target_premium: 4,
  time_stop_et: "15:30",
  underlying_target: null,
  underlying_invalid: null,
};

/** Replay the session chronologically: each play evaluated at its flag time with
 *  the plays the gated desk would actually have open at that moment. */
function replaySession(): Map<string, ZeroDteGateVerdict> {
  const verdicts = new Map<string, ZeroDteGateVerdict>();
  const openPlans: GovernorOpenPlan[] = [];
  for (const p of LEDGER_2026_07_13) {
    const nowMs = dayMs(p.et_minutes);
    const v = evaluateZeroDteGates({
      ticker: p.ticker,
      direction: p.direction,
      score: p.score,
      nowEtMinutes: p.et_minutes,
      nowMs,
      bias: "down", // SPY sold off all session — bias was DOWN at every flag time
      biasAsOfMs: nowMs - 60_000, // fresh SPY bar at each evaluation
      governor: { open_plans: [...openPlans], stops: [] },
      vixDayOpen: VIX_DAY_OPEN,
      slayerLive: null, // no open Slayer play on 7/13
      nighthawkTake:
        p.ticker === "META" ? { direction: "long", edition_for: "2026-07-10" } : null,
      plan: REPLAY_PLAN,
      intradayConflict: false,
      halted: false,
      earnings: null,
      todayYmd: "2026-07-13",
      macroEvents: [],
    });
    verdicts.set(p.ticker, v);
    if (v.verdict === "COMMIT") openPlans.push({ ticker: p.ticker, direction: p.direction });
  }
  return verdicts;
}

test("7/13 replay: full verdict table matches the decision doc's §2 projection (G-2 attribution updated per user direction; G-17 extended 2026-08-28)", () => {
  const verdicts = replaySession();

  // The doc's projection (§2, adjusted for hardened G-6 + G-1 index-ETF-only + score floor 65
  // + G-17's 2026-08-28 extension to a universal 75 floor in the 65-74 band):
  //   AMD  long  09:50 → BLOCKED  G-2 + G-3  (single stock — G-1 tape_alignment bypassed;
  //                                           score 58 < 65 floor; pre-10:00 → opening_window)
  //   SPY  long  09:55 → BLOCKED  G-1 + G-2  (index ETF, counter-tape; 93-score clears floor;
  //                                           pre-10:00 → opening_window)
  //   MU   long  09:55 → BLOCKED  G-2 + G-17 (single stock — G-1 bypassed; score 73 clears G-3's
  //                                           65 floor but not G-17's 75; pre-10:00 → opening_window too)
  //   SPXW long  10:00 → BLOCKED  G-1        (index ETF, counter-tape; at unlock boundary)
  //   QQQ  short 10:20 → BLOCKED  G-17       (index ETF, aligned, ≥ 10:00 — clears G-3's 65 floor
  //                                           but score 65 < G-17's 75. This is the REAL winner
  //                                           (+76.57%) the tightened floor now also holds — the
  //                                           65-74 band trade-off measured 2026-08-28: it costs
  //                                           some real winners to also catch the real losers in
  //                                           the same band (net positive over the 90d sample).)
  //   META short 10:40 → BLOCKED  G-17       (score 67 < 75 — the G-6 conflict with NH 7/10 LONG
  //                                           no longer even needs deciding; G-17 holds it first.
  //                                           The real -50.11% loser this extension exists to catch.)
  //   NVDA long  12:40 → BLOCKED  G-3        (single stock — G-1 bypassed; score 40 < 65 floor)
  //   INTC short 12:51 → BLOCKED  G-3        (score 61 < 65 — below G-17's own 65-74 band, so
  //                                           only score_floor fires, not a redundant G-17 too)
  // 2026-07-23 (user-authorized): the opening-window unlock moved 9:45 → 10:00, so the pre-10:00
  // entries now ALSO collect G-2 (AMD 09:50, SPY/MU 09:55). SPXW at exactly 10:00 is unlocked
  // (boundary inclusive). Block order is tape_alignment → opening_window → score_floor → G-17.
  const expected: Record<string, string[] | "COMMIT"> = {
    AMD: ["opening_window", "score_floor"],
    SPY: ["tape_alignment", "opening_window"],
    MU: ["opening_window", "single_rail_corroboration"],
    SPXW: ["tape_alignment"],
    QQQ: ["single_rail_corroboration"],
    META: ["single_rail_corroboration"],
    NVDA: ["score_floor"],
    INTC: ["score_floor"],
  };

  for (const [ticker, want] of Object.entries(expected)) {
    const v = verdicts.get(ticker)!;
    if (want === "COMMIT") {
      assert.equal(v.verdict, "COMMIT", `${ticker} must commit`);
      assert.deepEqual(v.blocks, [], `${ticker} must have no blocks`);
    } else {
      assert.equal(v.verdict, "BLOCKED", `${ticker} must be blocked`);
      assert.deepEqual(
        v.blocks.map((b) => b.code),
        want,
        `${ticker} block attribution`
      );
    }
  }
});

test("7/13 replay: post-2026-07-23 the 10:00 unlock catches the pre-10:00 entries (AMD 09:50, SPY/MU 09:55); ≥10:00 entries are clean of G-2", () => {
  const verdicts = replaySession();
  const caught = new Set(["AMD", "SPY", "MU"]); // flagged before 10:00
  for (const [ticker, v] of verdicts) {
    const hasWindow = v.blocks.some((b) => b.code === "opening_window");
    if (caught.has(ticker)) {
      assert.ok(hasWindow, `${ticker} (flagged before 10:00) is now held by G-2's extended window`);
    } else {
      assert.ok(!hasWindow, `${ticker} (flagged ≥ 10:00) is past the window — G-2 clean`);
    }
  }
});

test("7/13 replay: META short clears G-6's OWN 65 floor (score 67 >= 65) despite opposing Night Hawk long — but is still held by G-17's separate 75 floor", () => {
  const meta = replaySession().get("META")!;
  // G-17 (extended 2026-08-28) now blocks first — score 67 < 75, no discovery_origin set in this
  // historical replay. G-6's OWN conflict floor is a SEPARATE question, checked via calibration
  // below (it still would NOT have blocked at 67 on its own — G-6 and G-17 are independent gates
  // that both happen to reach the same real 2026-07-13 loser).
  assert.equal(meta.verdict, "BLOCKED");
  assert.deepEqual(meta.blocks.map((b) => b.code), ["single_rail_corroboration"]);
  // Calibration still records the G-6 conflict for measurement, even though G-6 itself would not
  // have blocked this score on its own — it's G-17 doing the blocking here.
  assert.equal(meta.calibration.g6_conflict.conflict, true);
  assert.deepEqual(meta.calibration.g6_conflict.against, ["nighthawk_edition"]);
  assert.equal(meta.calibration.g6_conflict.would_block, false);
  assert.match(meta.calibration.g6_conflict.note, /2026-07-10/);
});

test("7/13 replay: G-4 verdict is tier=normal at the dataset's 16.32 day-open VIX (doc's 17.2 figure is contradicted by derived.json — dataset wins)", () => {
  for (const [, v] of replaySession()) {
    assert.equal(v.calibration.g4_vix.tier, "normal");
    assert.equal(v.calibration.g4_vix.would_block, false);
    assert.equal(v.calibration.g4_vix.day_open_vix, VIX_DAY_OPEN);
  }
});

test("7/13 replay: session economics — G-17's 2026-08-28 extension zeroes the session out (0 prints), trading away the real QQQ winner to also catch the real META loser", () => {
  const verdicts = replaySession();
  const printed = LEDGER_2026_07_13.filter((p) => verdicts.get(p.ticker)!.verdict === "COMMIT");
  const blocked = LEDGER_2026_07_13.filter((p) => verdicts.get(p.ticker)!.verdict === "BLOCKED");

  // Both QQQ (65) and META (67) now fall in G-17's universal 65-74/75-floor band and block —
  // the session prints NOTHING. This is the honest cost side of the 2026-08-28 measurement: on
  // this ONE real historical day, the tightened floor would have zeroed out a 1W/1L session
  // rather than improving it, because it caught the real winner along with the real loser. The
  // justification is the 90-day AGGREGATE (n=34 in-band multi-rail/FLOW commits graded 35.7% WR /
  // -10.43% avg pnl, worse than the 75+ floor), not a claim that every single blocked play in
  // this band was already a loser — it wasn't, and this fixture is the concrete counter-example.
  assert.deepEqual(printed, []);
  assert.equal(blocked.length, 8);

  // Calibration context still rides every verdict, committed or not (C-2 columns) — even a
  // blocked QQQ still reports what it WOULD have committed under, for the ledger's own record.
  const qqq = verdicts.get("QQQ")!;
  assert.equal(qqq.calibration.committed_at_et, "10:20");
  assert.equal(qqq.calibration.market_bias, "down");
  assert.equal(qqq.calibration.score_at_commit, 65);
});

// ── Full-stack replay: hard gates + the Cortex layer (PR-B wire-in) ────────────────
// Mirrors attachGateVerdicts' exact sequencing (scan.ts): evaluateZeroDteGates first;
// on COMMIT, compose the Cortex verdict and fold it via cortexGateBlocks — a
// non-empty block list flips the verdict to BLOCKED with the gate blocks REPLACED by
// the Cortex blocks (gate blocks were necessarily empty on a COMMIT).
//
// These tests exercise the CORTEX layer specifically, not the gate stack — they need a
// gate-COMMIT starting point to hand to Cortex. The real 2026-07-13 QQQ score (65) no longer
// clears gates alone after G-17's 2026-08-28 extension (see the gate-only tests above, which
// correctly assert QQQ now BLOCKS on single_rail_corroboration). So this synthetic fixture
// reproduces the SAME market conditions (aligned short tape, that day's VIX, post-unlock flag
// time) at a score high enough to clear every gate including G-17, purely so the Cortex-layer
// assertions below still have a COMMIT to build on — it is not a claim about what QQQ's real
// score would have done.
const QQQ_COMMIT_GATE_SYNTHETIC: ZeroDteGateVerdict = evaluateZeroDteGates({
  ticker: "QQQ",
  direction: "short",
  score: 90,
  nowEtMinutes: 10 * 60 + 20,
  nowMs: dayMs(10 * 60 + 20),
  bias: "down",
  biasAsOfMs: dayMs(10 * 60 + 20) - 60_000,
  governor: { open_plans: [], stops: [] },
  vixDayOpen: VIX_DAY_OPEN,
  slayerLive: null,
  nighthawkTake: null,
  plan: REPLAY_PLAN,
  intradayConflict: false,
  halted: false,
  earnings: null,
  todayYmd: "2026-07-13",
  macroEvents: [],
});
function applyCortex(gate: ZeroDteGateVerdict, inputs: CortexInputs) {
  assert.equal(gate.verdict, "COMMIT", "the Cortex only ever runs on gate survivors");
  const assessment = assessCortexVerdict(composeCortexEvidence(inputs));
  const blocks = cortexGateBlocks(assessment);
  const verdict: ZeroDteGateVerdict = blocks.length > 0 ? { ...gate, verdict: "BLOCKED", blocks } : gate;
  return { assessment, verdict };
}

/** The rejection-source fields of the 7/13 QQQ short, for gateRejectionFor. */
const QQQ_REJECTION_SOURCE = {
  ticker: "QQQ",
  direction: "short" as const,
  gross_premium: 1_250_000,
  aggression: 0.72,
  side_dominance: 0.7,
  otm_pct: 0.4,
  prints: 5,
  first_seen: "2026-07-13T14:08:00.000Z",
  last_seen: "2026-07-13T14:18:00.000Z",
};

test("7/13 full stack: QQQ short survives BOTH layers — gates COMMIT and the net-supportive fixture PASSES, evidence pinned for the ledger", () => {
  const gate = QQQ_COMMIT_GATE_SYNTHETIC;
  const { assessment, verdict } = applyCortex(gate, QQQ_SHORT_2026_07_13);

  assert.equal(verdict.verdict, "COMMIT", "the session's one real winner must still print");
  assert.deepEqual(verdict.blocks, []);
  assert.equal(assessment.decision, "PASS");

  // The entry_context.cortex blob the committed row would pin: the FULL vector.
  const blob = cortexEntryContextFor(assessment);
  assert.ok(blob && !blob.abstained);
  if (blob && !blob.abstained) {
    assert.ok(blob.score > 0);
    assert.equal(blob.conviction, "A");
    assert.ok(blob.supports.length >= 5);
    assert.deepEqual(blob.vetoes, []);
    assert.ok(blob.narrative.length > 0);
  }
});

test("7/13 full stack: a gate-passing find dies on a Cortex VETO — blocked exactly like a gate block, rejection row carries cortex_veto:<source> + the evidence sentence", () => {
  const gate = QQQ_COMMIT_GATE_SYNTHETIC;
  // Same winner, alternate tape: an opposing bullish sweep cluster ($1.3M / 2
  // prints inside 15 min) crosses flow-quality's veto floor. Everything else
  // still argues FOR the short — one loud opposing fact kills it anyway (§0).
  const { assessment, verdict } = applyCortex(gate, {
    ...QQQ_SHORT_2026_07_13,
    flow: {
      asOf: "2026-07-13T14:19:00.000Z",
      prints: [
        { premium: 700_000, direction: "bullish", kind: "sweep", at: "2026-07-13T14:10:00.000Z" },
        { premium: 600_000, direction: "bullish", kind: "sweep", at: "2026-07-13T14:16:00.000Z" },
      ],
    },
  });

  assert.equal(assessment.decision, "VETO");
  assert.equal(verdict.verdict, "BLOCKED");
  assert.deepEqual(verdict.blocks.map((b) => b.code), ["cortex_veto:flow-quality"]);

  // The BLOCKED verdict rides the SAME rejection plumbing as a hard-gate block:
  // persistZeroDteScan routes any non-COMMIT fresh find to zerodte_scan_rejections
  // (never to the ledger, never an entry_context — the blocked-find invariant).
  const rejection = gateRejectionFor(QQQ_REJECTION_SOURCE, verdict);
  assert.equal(rejection.gate_failed, "cortex_veto:flow-quality");
  assert.match(rejection.reason!, /Cortex veto \[flow-quality\]: opposing bullish sweep\/block cluster \$1\.3M/);
});

test("7/13 full stack: a gate-passing find dies on NET-NEGATIVE evidence (no veto) — cortex_net_negative", () => {
  const gate = QQQ_COMMIT_GATE_SYNTHETIC;
  // Only readable evidence opposes the short (positive breadth + positive net VEX,
  // asOf = now so the raw −0.9 sum survives undecayed); nothing veto-grade.
  const { assessment, verdict } = applyCortex(gate, baseInputs({
    ticker: "QQQ",
    direction: "short",
    now: QQQ_SHORT_2026_07_13.now,
    sector: {
      asOf: QQQ_SHORT_2026_07_13.now,
      sectorName: null,
      sectorChangePct: null,
      breadthTone: "strongly_positive",
      tickerChangePct: 0.8,
    },
    vex: { asOf: QQQ_SHORT_2026_07_13.now, netVex: 900_000_000, kingStrike: null },
  }));

  assert.equal(assessment.decision, "NET_NEGATIVE");
  assert.equal(verdict.verdict, "BLOCKED");
  assert.equal(verdict.blocks.length, 1);
  assert.equal(verdict.blocks[0]!.code, "cortex_net_negative");
  assert.equal(verdict.blocks[0]!.threshold, 0);
  assert.match(verdict.blocks[0]!.reason, /nets -0\.9 against this short/);

  const rejection = gateRejectionFor(QQQ_REJECTION_SOURCE, verdict);
  assert.equal(rejection.gate_failed, "cortex_net_negative");
  assert.equal(rejection.threshold, 0);
});

test("7/13 full stack: a total Cortex outage ABSTAINS — the commit proceeds on gates alone and the abstain is recorded, not hidden", () => {
  const gate = QQQ_COMMIT_GATE_SYNTHETIC;
  // Every reader down/timed out → every slice null → every source absent.
  const { assessment, verdict } = applyCortex(
    gate,
    baseInputs({ ticker: "QQQ", direction: "short", now: QQQ_SHORT_2026_07_13.now })
  );

  assert.equal(assessment.decision, "ABSTAIN");
  assert.equal(verdict.verdict, "COMMIT", "a Cortex outage must never halt the engine — the hard gates are the safety floor");
  assert.deepEqual(verdict.blocks, []);

  // ...but the row records the blindness honestly (entry_context.cortex).
  assert.deepEqual(cortexEntryContextFor(assessment), {
    abstained: true,
    reason: "no Cortex source produced evidence (8 absent) — commit proceeds on the hard gates alone.",
  });
});
