// PR-N10 — debrief aggregate tests: rolling failure-mode counts (anti-blend), the
// counterfactual publish-gate validation (blocked value + published mirror), and the
// improvement queue's LOW-N discipline (thin evidence is visible but NEVER suggests).
// Hermetic and pure — fixture rows in, deterministic report out.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  IMPROVEMENT_BLOCKED_WINNER_RATE_PCT,
  analyzeNighthawkDebriefs,
  buildImprovementQueue,
  gateBlockedValue,
  gateCodesFromSnapshot,
  gatePublishedMirror,
  readPinnedDebriefTag,
  readPinnedTier,
  pinnedTargetAtrMultiple,
  readRejectionCounterfactual,
  retroWouldBlock,
  summarizeDebriefPins,
  targetAtrDistribution,
  type DebriefAggregateRow,
  type NighthawkGateRejectionInput,
} from "./debrief-aggregate";
import { GRADE_METHODOLOGY_CURRENT, GRADE_METHODOLOGY_LEGACY } from "./grade-methodology";
import { GATE_TARGET_MAX_ATR_MULTIPLE } from "./publish-gates";
import { LOW_N_THRESHOLD } from "@/lib/zerodte/record";

const WINDOW = { since: "2026-06-14", through: "2026-07-14", days: 30 };

function pin(tag: string): Record<string, unknown> {
  return { debrief_version: 1, failure_mode: { tag, detail: "fixture" } };
}

function row(over: Partial<DebriefAggregateRow> = {}): DebriefAggregateRow {
  return {
    edition_for: "2026-07-14",
    ticker: "TEST",
    direction: "LONG",
    conviction: "B",
    outcome: "stop",
    pulled: false,
    grade_methodology: GRADE_METHODOLOGY_CURRENT,
    publish_context: null,
    entry_range_low: 100,
    entry_range_high: 102,
    target: 110,
    stop: 95,
    debrief: pin("stopped_normal"),
    ...over,
  };
}

function rejection(over: Partial<NighthawkGateRejectionInput> = {}): NighthawkGateRejectionInput {
  return {
    ticker: "DELL",
    edition_for: "2026-07-08",
    direction: "LONG",
    gate_codes: ["band_detached"],
    counterfactual: { version: 1, outcome: "unfilled", would_have_won: false },
    ...over,
  };
}

// ── Structural readers ───────────────────────────────────────────────────────────────

test("readPinnedDebriefTag: version-gated + taxonomy-gated (malformed/unknown → null)", () => {
  assert.equal(readPinnedDebriefTag(pin("clean_win")), "clean_win");
  assert.equal(readPinnedDebriefTag(null), null);
  assert.equal(readPinnedDebriefTag({ failure_mode: { tag: "clean_win" } }), null); // no version
  assert.equal(readPinnedDebriefTag(pin("not_a_real_tag")), null);
  assert.equal(readPinnedDebriefTag([pin("clean_win")]), null);
});

test("readPinnedTier: reads the real PR-N7 pinned shape ({ tier: { tier, factors } })", () => {
  // publish-context.ts pins tier as an OBJECT ({ tier, factors }), never a bare string —
  // this regression-guards that shape, not the pre-tier-engine placeholder shape.
  assert.equal(readPinnedTier({ context_version: 2, tier: { tier: "a", factors: [] } }), "A");
  assert.equal(readPinnedTier({ context_version: 2, tier: { tier: "B", factors: [{ label: "x" }] } }), "B");
  assert.equal(readPinnedTier({ context_version: 2 }), null, "no tier pinned → null, never fabricated");
  assert.equal(readPinnedTier({ context_version: 2, tier: null }), null, "explicit null tier (untiered play)");
  assert.equal(
    readPinnedTier({ context_version: 2, tier: "a" }),
    null,
    "a bare string is NOT the real pinned shape — must not silently accept it as if it were",
  );
  assert.equal(readPinnedTier(null), null);
});

test("readRejectionCounterfactual: ungradeable and malformed blobs read as not-graded", () => {
  assert.deepEqual(readRejectionCounterfactual({ outcome: "target", would_have_won: true }), {
    outcome: "target",
    would_have_won: true,
  });
  assert.equal(readRejectionCounterfactual({ outcome: "ungradeable" }), null);
  assert.equal(readRejectionCounterfactual(null), null);
  assert.equal(readRejectionCounterfactual("x"), null);
});

test("gateCodesFromSnapshot: parses + dedups the failed gate codes", () => {
  assert.deepEqual(
    gateCodesFromSnapshot({
      gate_blocks: [
        { code: "band_detached", reason: "..." },
        { code: "target_unreachable", reason: "..." },
        { code: "band_detached", reason: "dup" },
        { nope: true },
      ],
    }),
    ["band_detached", "target_unreachable"]
  );
  assert.deepEqual(gateCodesFromSnapshot(null), []);
  assert.deepEqual(gateCodesFromSnapshot({ gate_blocks: "x" }), []);
});

// ── Summary: anti-blend + LOW-N ──────────────────────────────────────────────────────

test("summarizeDebriefPins: counts current-methodology pins only; legacy rows CANNOT enter (anti-blend)", () => {
  const rows = [
    row({ edition_for: "2026-07-10", debrief: pin("clean_win") }),
    row({ edition_for: "2026-07-10", debrief: pin("gap_through_stop") }),
    row({ edition_for: "2026-07-11", debrief: pin("gap_through_stop") }),
    // A LEGACY row with a pinned clean_win — flipping it can never move the counts.
    row({ grade_methodology: GRADE_METHODOLOGY_LEGACY, debrief: pin("clean_win") }),
    // Unstamped provenance quarantines to legacy too.
    row({ grade_methodology: null, debrief: pin("clean_win") }),
    // Current but not yet debriefed.
    row({ debrief: null }),
    // Pending rows never count.
    row({ outcome: "pending", debrief: null }),
  ];
  const s = summarizeDebriefPins(rows);
  assert.equal(s.graded, 4); // 3 pinned + 1 unpinned current
  assert.equal(s.debriefed, 3);
  assert.equal(s.sessions, 2);
  assert.equal(s.legacy_excluded, 2);
  assert.equal(s.unpinned, 1);
  assert.deepEqual(s.failure_modes, [
    { tag: "gap_through_stop", n: 2 },
    { tag: "clean_win", n: 1 },
  ]);
  assert.equal(s.low_n, true); // 3 < LOW_N_THRESHOLD
});

test("summarizeDebriefPins: low_n clears at the shared threshold", () => {
  const rows = Array.from({ length: LOW_N_THRESHOLD }, (_, i) =>
    row({ edition_for: `2026-07-0${(i % 5) + 1}`, debrief: pin("stopped_normal") })
  );
  assert.equal(summarizeDebriefPins(rows).low_n, false);
});

// ── Blocked value ────────────────────────────────────────────────────────────────────

test("gateBlockedValue: per-gate n / graded / would-have-won rate; unfilled counterfactuals are separated", () => {
  const lines = gateBlockedValue([
    rejection(), // unfilled counterfactual — trivially right, not in the won/lost read
    rejection({ ticker: "A", counterfactual: { version: 1, outcome: "target", would_have_won: true } }),
    rejection({ ticker: "B", counterfactual: { version: 1, outcome: "stop", would_have_won: false } }),
    rejection({ ticker: "C", counterfactual: null }), // not graded yet
    rejection({
      ticker: "D",
      gate_codes: ["band_detached", "target_unreachable"], // counts under BOTH gates
      counterfactual: { version: 1, outcome: "stop", would_have_won: false },
    }),
  ]);
  const band = lines.find((l) => l.gate === "band_detached")!;
  assert.equal(band.blocked_n, 5);
  assert.equal(band.graded_n, 4);
  assert.equal(band.ungraded_n, 1);
  assert.equal(band.unfilled_n, 1);
  assert.equal(band.would_have_won, 1);
  assert.equal(band.would_have_won_rate_pct, 33.3); // 1 of 3 decisive
  assert.equal(band.decided_n, 3, "the rate denominator is wins+losses, NOT blocked_n(5) or graded_n(4)");
  assert.equal(band.low_n, true);
  // The verbatim sentence: every number in it must agree, so a model cannot print "1 of 5 (33.3%)".
  assert.match(band.summary, /blocked 5/);
  assert.match(band.summary, /of the 3 that would have decided/);
  assert.match(band.summary, /1 would have won \(33\.3%\)/);
  assert.match(band.summary, /1 more would not have filled/);
  const target = lines.find((l) => l.gate === "target_unreachable")!;
  assert.equal(target.blocked_n, 1);
  assert.equal(target.would_have_won_rate_pct, 0);
  assert.equal(target.decided_n, 1);
});

test("gateBlockedValue: a gate with no decisive counterfactual quotes NO rate, and says so", () => {
  const lines = gateBlockedValue([
    rejection({ gate_codes: ["stale_quote_basis"] }), // the default is an unfilled counterfactual
  ]);
  const g = lines.find((l) => l.gate === "stale_quote_basis")!;
  assert.equal(g.decided_n, 0);
  assert.equal(g.would_have_won_rate_pct, null);
  assert.match(g.summary, /no win rate to quote/);
  assert.doesNotMatch(g.summary, /%/, "a null rate must never render a percent");
});

// ── Published mirror (retro gates from the pinned margins) ───────────────────────────

test("retroWouldBlock: PINNED per-gate threshold wins over the live constant", () => {
  // The whole point: the mirror must be a FIXED historical fact. A play published under a
  // 2.5× bar stays judged at 2.5× forever, even though the live constant is now 3.5×.
  // |110 − 102| / 3 = 2.67× — over a PINNED 2.5×, under the LIVE 3.5×.
  const pinnedAt25 = row({
    publish_context: {
      context_version: 2,
      atr14: 3,
      band_distance_pct: -1.2,
      gates: {
        verdict: "PUBLISH",
        blocks: [],
        checks: [
          { code: "target_unreachable", passed: false, value: 2.6667, threshold: 2.5 },
          { code: "band_detached", passed: true, value: -1.2, threshold: 2.5 },
        ],
      },
    },
  });
  assert.equal(retroWouldBlock(pinnedAt25, "target_unreachable"), true); // pinned 2.5× → BLOCK
  assert.equal(retroWouldBlock(pinnedAt25, "band_detached"), false); // |−1.2| ≤ pinned 2.5

  // Same geometry, pinned at a LOOSER bar than the live constant → the pin still wins.
  const pinnedAt5 = row({
    publish_context: {
      context_version: 2,
      atr14: 2, // |110 − 102| / 2 = 4× — over the LIVE 3.5×, under a pinned 5×
      gates: { checks: [{ code: "target_unreachable", passed: true, value: 4, threshold: 5 }] },
    },
  });
  assert.equal(retroWouldBlock(pinnedAt5, "target_unreachable"), false);

  // Band gate honours its own pin independently of the target gate's.
  const bandPinned = row({
    publish_context: {
      context_version: 2,
      band_distance_pct: -4.0,
      gates: { checks: [{ code: "band_detached", passed: true, value: -4.0, threshold: 6 }] },
    },
  });
  assert.equal(retroWouldBlock(bandPinned, "band_detached"), false); // over live 3.5, under pinned 6
});

test("retroWouldBlock: pin present but threshold non-finite → null, never a live-constant guess", () => {
  // A corrupt/legacy checks[] entry must NOT silently fall through to the live constant —
  // that is precisely the silent-rewrite behaviour this fix removes.
  for (const bad of [null, "3.5", undefined, Number.NaN]) {
    const corrupt = row({
      publish_context: {
        context_version: 2,
        atr14: 2,
        band_distance_pct: -1.2,
        gates: { checks: [{ code: "target_unreachable", passed: true, value: 4, threshold: bad }] },
      },
    });
    assert.equal(retroWouldBlock(corrupt, "target_unreachable"), null, `threshold=${String(bad)}`);
    // The OTHER gate has no entry at all → still answerable from the live constant.
    assert.equal(retroWouldBlock(corrupt, "band_detached"), false);
  }
});

test("retroWouldBlock: pins that predate gate pinning fall back to the live constant", () => {
  // Pre-PR-N3 pins carry geometry but no gates.checks[]. A null bucket for the whole
  // pre-pin era would be worse than a stated approximation, so the live constant is used.
  const noGates = row({ publish_context: { context_version: 2, atr14: 2, band_distance_pct: -45.5 } });
  assert.equal(retroWouldBlock(noGates, "target_unreachable"), true); // 4× > live 3.5×
  assert.equal(retroWouldBlock(noGates, "band_detached"), true); // 45.5% > live 3.5%
  // A gates blob with no checks array, and one whose checks lack this gate, are both "absent".
  const emptyGates = row({ publish_context: { context_version: 2, atr14: 2, gates: {} } });
  assert.equal(retroWouldBlock(emptyGates, "target_unreachable"), true);
  const otherGate = row({
    publish_context: {
      context_version: 2,
      atr14: 2,
      gates: { checks: [{ code: "stale_quote_basis", passed: true, value: null, threshold: null }] },
    },
  });
  assert.equal(retroWouldBlock(otherGate, "target_unreachable"), true);
});

test("retroWouldBlock: uses the LIVE thresholds against the PINNED geometry; no pin → null", () => {
  const detached = row({ publish_context: { context_version: 2, band_distance_pct: -45.5 } });
  const healthy = row({ publish_context: { context_version: 2, band_distance_pct: -1.2, atr14: 2 } });
  assert.equal(retroWouldBlock(detached, "band_detached"), true);
  assert.equal(retroWouldBlock(healthy, "band_detached"), false);
  assert.equal(retroWouldBlock(row({ publish_context: null }), "band_detached"), null);
  // Target gate: |110-102|/2 = 4× > 3.5× → block; |110-102|/8 = 1× → pass.
  assert.equal(retroWouldBlock(healthy, "target_unreachable"), true);
  assert.equal(
    retroWouldBlock(row({ publish_context: { context_version: 2, atr14: 8 } }), "target_unreachable"),
    false
  );
  assert.equal(retroWouldBlock(row({ publish_context: { context_version: 2 } }), "target_unreachable"), null);
});

test("gatePublishedMirror: buckets resolved current rows by retro verdict; unfilled bucketed but out of the rate, pulled excluded", () => {
  const geoBlock = { context_version: 2, band_distance_pct: -10, atr14: 100 };
  const geoPass = { context_version: 2, band_distance_pct: -1, atr14: 100 };
  const rows = [
    row({ outcome: "stop", publish_context: geoBlock }),
    row({ outcome: "stop", publish_context: geoBlock }),
    row({ outcome: "target", publish_context: geoPass }),
    row({ outcome: "stop", publish_context: geoPass }),
    row({ outcome: "unfilled", publish_context: geoBlock }), // BUCKETED — never in the rate
    row({ outcome: "target", pulled: true, publish_context: geoPass }), // excluded — pulled
    row({ outcome: "open", publish_context: null }), // no geometry
  ];
  const band = gatePublishedMirror(rows).find((l) => l.gate === "band_detached")!;
  assert.equal(band.would_block.n, 3); // 2 stops + the unfilled row the gate exists for
  assert.equal(band.would_block.decided, 2);
  assert.equal(band.would_block.unfilled, 1);
  assert.equal(band.would_block.win_rate_pct, 0); // 0/2 decided — the unfilled row is NOT a loss
  assert.equal(band.would_block.unfilled_rate_pct, 33.3);
  assert.equal(band.would_pass.n, 2);
  assert.equal(band.would_pass.decided, 2);
  assert.equal(band.would_pass.unfilled, 0);
  assert.equal(band.would_pass.win_rate_pct, 50);
  assert.equal(band.would_pass.unfilled_rate_pct, 0);
  assert.equal(band.delta_win_rate_pts, 50);
  assert.equal(band.delta_unfilled_rate_pts, 33.3); // the read that was structurally invisible
  assert.equal(band.no_geometry_n, 1);
  assert.equal(band.would_block.low_n, true);
});

// ── The never-filled record defect (2026-08-06) ──────────────────────────────────────

test("gatePublishedMirror: an all-unfilled would_block bucket is VISIBLE and carries no win rate", () => {
  // THE REGRESSION THIS PINS. The mirror used to drop `unfilled` before retroWouldBlock,
  // so the band_detached gate's would_block bucket came back n:0 on live prod even though
  // the same window carried 19 unfilled plays. A gate that only ever blocks unenterable
  // geometry must be MEASURABLE, and must never book those plays as losses.
  const geoBlock = { context_version: 2, band_distance_pct: -10, atr14: 100 };
  const geoPass = { context_version: 2, band_distance_pct: -1, atr14: 100 };
  const rows = [
    ...Array.from({ length: 6 }, () => row({ outcome: "unfilled", publish_context: geoBlock })),
    ...Array.from({ length: 6 }, () => row({ outcome: "target", publish_context: geoPass })),
  ];
  const band = gatePublishedMirror(rows).find((l) => l.gate === "band_detached")!;
  assert.equal(band.would_block.n, 6); // visible at all — this was 0 before the fix
  assert.equal(band.would_block.decided, 0);
  assert.equal(band.would_block.win_rate_pct, null); // never a fabricated 0%
  assert.equal(band.would_block.losses, 0); // and never booked as losses
  assert.equal(band.would_block.unfilled_rate_pct, 100);
  assert.equal(band.would_pass.unfilled_rate_pct, 0);
  assert.equal(band.delta_win_rate_pts, null); // no decided evidence either side of the split
  assert.equal(band.delta_unfilled_rate_pts, 100); // but the fillability read is decisive
  const queue = buildImprovementQueue({
    summary: summarizeDebriefPins([]),
    blockedValue: [],
    mirror: gatePublishedMirror(rows),
    byConviction: [],
  });
  const fill = queue.find((i) => i.signal === "publish_gate:band_detached:published_mirror_fillability")!;
  assert.equal(fill.low_n, false);
  assert.equal(fill.evidence.delta, 100);
  assert.match(fill.suggestion!, /never have entered/);
});

test("NO unfillable or undecided row ever lands in a rate — mirror + per-conviction, one invariant", () => {
  const geo = { context_version: 2, band_distance_pct: -1, atr14: 100 };
  // A bucket of nothing but unfilled + no-touch plays: zero decided evidence.
  const rows = [
    ...Array.from({ length: 8 }, () => row({ conviction: "B", outcome: "unfilled", publish_context: geo })),
    ...Array.from({ length: 7 }, () => row({ conviction: "B", outcome: "open", publish_context: geo })),
  ];
  const report = analyzeNighthawkDebriefs({ rows, rejections: [], window: WINDOW });
  const b = report.by_conviction.find((c) => c.key === "B")!;
  assert.equal(b.n, 15);
  assert.equal(b.scoreable, 7); // opens are scoreable, unfilled are not
  assert.equal(b.decided, 0);
  assert.equal(b.undecided, 7);
  assert.equal(b.unfilled, 8);
  assert.equal(b.win_rate_pct, null); // was 0 — a 0% claim over zero decided plays
  assert.equal(b.low_n, true); // was false — n=15 badged as sufficient evidence
  const band = report.gate_validation.published_mirror.find((l) => l.gate === "band_detached")!;
  assert.equal(band.would_pass.win_rate_pct, null);
  assert.equal(band.would_pass.n, 15);
  assert.equal(band.would_pass.decided, 0);
  // No RATE-derived queue item can attach a suggestion on this evidence (the pinned
  // failure-mode item is a count, not a rate, and is deliberately unaffected).
  for (const item of report.improvement_queue) {
    if (item.signal.startsWith("failure_mode:")) continue;
    assert.equal(item.suggestion, null, item.signal);
  }
});

test("groupRecord: win_rate_pct is wins/decided, never wins/scoreable", () => {
  const rows = [
    row({ conviction: "A", outcome: "target" }),
    row({ conviction: "A", outcome: "stop" }),
    row({ conviction: "A", outcome: "stop" }),
    row({ conviction: "A", outcome: "stop" }),
    row({ conviction: "A", outcome: "stop" }),
    // Six no-touch plays: scoreable, but they decide nothing.
    ...Array.from({ length: 6 }, () => row({ conviction: "A", outcome: "open" })),
  ];
  const a = analyzeNighthawkDebriefs({ rows, rejections: [], window: WINDOW }).by_conviction.find(
    (c) => c.key === "A"
  )!;
  assert.equal(a.scoreable, 11);
  assert.equal(a.decided, 5);
  assert.equal(a.undecided, 6);
  assert.equal(a.win_rate_pct, 20); // 1/5, not 1/11 (9.1%)
  assert.equal(a.low_n, false); // decided=5 == LOW_N_THRESHOLD
});

// ── Improvement queue: shape + LOW-N never suggests ──────────────────────────────────

test("improvement queue: every item carries {signal, evidence:{n, delta}, suggestion, low_n}; LOW-N items NEVER suggest", () => {
  const rows = [
    row({ debrief: pin("gap_through_stop") }),
    row({ debrief: pin("gap_through_stop") }),
    row({ debrief: pin("clean_win"), outcome: "target" }),
  ];
  const report = analyzeNighthawkDebriefs({
    rows,
    rejections: [rejection(), rejection({ ticker: "A", counterfactual: { version: 1, outcome: "target", would_have_won: true } })],
    window: WINDOW,
  });
  assert.ok(report.improvement_queue.length > 0);
  for (const item of report.improvement_queue) {
    assert.equal(typeof item.signal, "string");
    assert.equal(typeof item.evidence.n, "number");
    assert.ok("delta" in item.evidence);
    assert.ok("suggestion" in item);
    assert.equal(typeof item.low_n, "boolean");
    // THE LOW-N CONTRACT: thin evidence is visible but never actionable.
    if (item.low_n) assert.equal(item.suggestion, null);
  }
  // Everything in this fixture is low-n, so nothing may suggest.
  assert.ok(report.improvement_queue.every((i) => i.low_n && i.suggestion === null));
});

test("improvement queue: at real n, a gate blocking winners earns a re-examine suggestion; one blocking losers earns keep-enforcing", () => {
  const winners = Array.from({ length: 5 }, (_, i) =>
    rejection({ ticker: `W${i}`, counterfactual: { version: 1, outcome: "target", would_have_won: true } })
  );
  const losers = Array.from({ length: 5 }, (_, i) =>
    rejection({
      ticker: `L${i}`,
      gate_codes: ["target_unreachable"],
      counterfactual: { version: 1, outcome: "stop", would_have_won: false },
    })
  );
  const queue = buildImprovementQueue({
    summary: summarizeDebriefPins([]),
    blockedValue: gateBlockedValue([...winners, ...losers]),
    mirror: [],
    byConviction: [],
  });
  const bad = queue.find((i) => i.signal === "publish_gate:band_detached:blocked_value")!;
  assert.equal(bad.low_n, false);
  assert.ok(bad.evidence.delta! >= IMPROVEMENT_BLOCKED_WINNER_RATE_PCT);
  assert.match(bad.suggestion!, /re-examine/);
  const good = queue.find((i) => i.signal === "publish_gate:target_unreachable:blocked_value")!;
  assert.match(good.suggestion!, /earning its keep/);
  // Actionable items sort ahead of low-n ones.
  assert.equal(queue[0]!.low_n, false);
});

test("improvement queue: dominant failure mode signals with its share; conviction inversion flagged at usable n", () => {
  const rows = [
    ...Array.from({ length: 4 }, (_, i) => row({ ticker: `G${i}`, debrief: pin("gap_through_stop") })),
    row({ debrief: pin("clean_win"), outcome: "target" }),
    row({ debrief: pin("stopped_normal") }),
  ];
  const summary = summarizeDebriefPins(rows);
  const queue = buildImprovementQueue({
    summary,
    blockedValue: [],
    mirror: [],
    byConviction: [
      { key: "A", n: 6, scoreable: 6, wins: 1, losses: 5, decided: 6, undecided: 0, unfilled: 0, pulled: 0, win_rate_pct: 16.7, dominant_failure_mode: null, low_n: false },
      { key: "B", n: 6, scoreable: 6, wins: 4, losses: 2, decided: 6, undecided: 0, unfilled: 0, pulled: 0, win_rate_pct: 66.7, dominant_failure_mode: null, low_n: false },
    ],
  });
  const dom = queue.find((i) => i.signal === "failure_mode:gap_through_stop:dominant")!;
  assert.equal(dom.evidence.n, 4);
  assert.equal(dom.evidence.delta, 66.7); // 4 of 6 debriefed
  assert.match(dom.suggestion!, /overnight gaps/);
  const inv = queue.find((i) => i.signal === "conviction:A_below_B:inversion")!;
  assert.equal(inv.low_n, false);
  assert.equal(inv.evidence.delta, 50);
  assert.match(inv.suggestion!, /mis-weighted/);
});

// ── Full report shape ────────────────────────────────────────────────────────────────

test("analyzeNighthawkDebriefs: report shape, per-conviction records, empty-tier honesty, availability", () => {
  const rows = [
    row({ conviction: "A", outcome: "target", debrief: pin("clean_win") }),
    row({ conviction: "A", outcome: "stop", debrief: pin("gap_through_stop") }),
    row({ conviction: "B", outcome: "unfilled", debrief: pin("band_detached") }),
    row({ conviction: "B", outcome: "target", pulled: true, debrief: pin("pulled_wrongly") }),
  ];
  const report = analyzeNighthawkDebriefs({ rows, rejections: [], window: WINDOW });
  assert.equal(report.available, true);
  assert.equal(report.window, WINDOW);
  assert.match(report.methodology, /anti-blend|legacy/i);
  const a = report.by_conviction.find((c) => c.key === "A")!;
  assert.equal(a.n, 2);
  assert.equal(a.scoreable, 2);
  assert.equal(a.win_rate_pct, 50);
  assert.equal(a.low_n, true);
  const b = report.by_conviction.find((c) => c.key === "B")!;
  assert.equal(b.scoreable, 0); // unfilled + pulled never enter the denominator
  assert.equal(b.win_rate_pct, null); // null, never a fake 0%
  assert.equal(b.unfilled, 1);
  assert.equal(b.pulled, 1);
  assert.deepEqual(report.by_tier, []); // no tier pinned anywhere yet — empty, not invented
  assert.equal(report.gate_validation.published_mirror.length, 2);
});

// ── Pinned target-ATR distribution ───────────────────────────────────────────────────

function gatePin(multiple: number | string | null): Record<string, unknown> {
  return {
    context_version: 2,
    gates: {
      verdict: "PUBLISH",
      blocks: [],
      checks: [
        { code: "band_detached", passed: true, value: -1.2, threshold: 3.5 },
        { code: "target_unreachable", passed: true, value: multiple, threshold: 3.5 },
      ],
    },
  };
}

test("pinnedTargetAtrMultiple: reads the pin structurally, refuses junk rather than coercing", () => {
  assert.equal(pinnedTargetAtrMultiple(gatePin(2.05)), 2.05);
  assert.equal(pinnedTargetAtrMultiple(gatePin(0)), 0);
  assert.equal(pinnedTargetAtrMultiple(gatePin("2.05")), null, "a string multiple is not a number");
  assert.equal(pinnedTargetAtrMultiple(gatePin(null)), null);
  assert.equal(pinnedTargetAtrMultiple(gatePin(-1)), null, "a negative multiple is impossible");
  // Pins that predate gate pinning, and every malformed shape, read as absent.
  assert.equal(pinnedTargetAtrMultiple({ context_version: 2, atr14: 8 }), null);
  assert.equal(pinnedTargetAtrMultiple({ context_version: 2, gates: {} }), null);
  assert.equal(pinnedTargetAtrMultiple({ context_version: 2, gates: { checks: "x" } }), null);
  assert.equal(pinnedTargetAtrMultiple({ gates: { checks: [null, 3, { code: "stale_quote_basis" }] } }), null);
  assert.equal(pinnedTargetAtrMultiple(null), null);
  assert.equal(pinnedTargetAtrMultiple([gatePin(2)]), null);
});

test("targetAtrDistribution: reads the PIN, never recomputes from levels", () => {
  // A row whose LEVELS would imply one multiple but whose PIN says another must report
  // the PIN — that is the whole point (production can take an hourly/prior-day ATR
  // fallback, so a Polygon reconstruction is not byte-identical to the pinned denominator).
  const rows = [
    row({ publish_context: gatePin(1.1) }),
    row({ publish_context: gatePin(1.49) }),
    row({ publish_context: gatePin(2.05) }),
    row({ publish_context: gatePin(3.65) }), // over the live 3.5 bar
    row({ publish_context: gatePin(8.23) }), // over the live 3.5 bar
    row({ publish_context: { context_version: 2, atr14: 8 } }), // pre-pin row — no multiple
  ];
  const dist = targetAtrDistribution(rows);
  assert.equal(dist.rows_n, 6);
  assert.equal(dist.pinned_n, 5);
  assert.equal(dist.median, 2.05);
  assert.equal(dist.over_gate_n, 2);
  assert.equal(dist.over_gate_threshold, GATE_TARGET_MAX_ATR_MULTIPLE);
  assert.equal(dist.low_n, false); // 5 === LOW_N_THRESHOLD
  assert.equal(dist.histogram.reduce((a, b) => a + b.n, 0), 5, "only pinned rows are bucketed");
});

test("targetAtrDistribution: even-count median, and an all-unpinned window reports null (never 0)", () => {
  const even = targetAtrDistribution([
    row({ publish_context: gatePin(1.0) }),
    row({ publish_context: gatePin(2.0) }),
  ]);
  assert.equal(even.median, 1.5);
  assert.equal(even.low_n, true);

  const none = targetAtrDistribution([row({ publish_context: null }), row({ publish_context: null })]);
  assert.equal(none.pinned_n, 0);
  assert.equal(none.median, null, "no pins → null median, never a fabricated 0");
  assert.equal(none.over_gate_n, 0);
  assert.equal(none.histogram.every((b) => b.pct === null), true);
});

test("analyzeNighthawkDebriefs: exposes the pinned target-ATR distribution over CURRENT rows only", () => {
  const report = analyzeNighthawkDebriefs({
    rows: [
      row({ publish_context: gatePin(2.05) }),
      // A LEGACY-methodology row can never enter any cut (#333 anti-blend).
      row({ grade_methodology: GRADE_METHODOLOGY_LEGACY, publish_context: gatePin(9.9) }),
    ],
    rejections: [],
    window: WINDOW,
  });
  assert.equal(report.target_atr_distribution.rows_n, 1);
  assert.equal(report.target_atr_distribution.pinned_n, 1);
  assert.equal(report.target_atr_distribution.median, 2.05);
  assert.equal(report.target_atr_distribution.over_gate_n, 0, "the legacy 9.9× row must not leak in");
});

test("analyzeNighthawkDebriefs: empty input → available:false, stable shape", () => {
  const report = analyzeNighthawkDebriefs({ rows: [], rejections: [], window: WINDOW });
  assert.equal(report.available, false);
  assert.equal(report.summary.debriefed, 0);
  assert.deepEqual(report.improvement_queue, []);
  assert.equal(report.by_conviction.length, 4);
});
