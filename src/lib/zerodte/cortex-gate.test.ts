// Run: node --import tsx --experimental-test-module-mocks --test src/lib/zerodte/cortex-gate.test.ts
//
// The Cortex wire-in bridge (PR-B, NIGHTHAWK-CORTEX-DESIGN.md §2/§4) — decision
// table, gate-block bridging, payload summary and entry_context blob, all driven
// through the REAL composer over the 7/13 fixtures wherever a composition exists
// (no hand-built verdicts for the primary paths — the fixtures are the design
// doc's own acceptance surface).

import { test } from "node:test";
import assert from "node:assert/strict";

import { composeCortexEvidence, VETO_CAPABLE_SOURCES, type CortexConviction, type CortexInputs, type CortexVerdict } from "@/lib/nighthawk/cortex";
import { QQQ_SHORT_2026_07_13, SPY_LONG_2026_07_13 } from "@/lib/nighthawk/cortex/fixtures-2026-07-13";
import { baseInputs } from "@/lib/nighthawk/cortex/test-helpers";
import {
  assessCortexVerdict,
  cortexEntryContextFor,
  cortexGateBlocks,
  cortexSummaryFor,
  evaluateCortexForCommit,
  THIN_EVIDENCE_MIN_SOURCES,
  THIN_EVIDENCE_SCORE_FLOOR,
} from "./cortex-gate";

// ── Fixture variants ────────────────────────────────────────────────────────────

/** The 7/13 QQQ short with its flow tape REPLACED by an opposing bullish
 *  sweep cluster ($1.3M across 2 prints inside 15 min — over flow-quality's
 *  $1M/2-print veto floor). Everything else (walls, rail, breadth, VEX, dark
 *  pool, opening) still argues FOR the short — proving a single veto-grade fact
 *  kills an otherwise net-supportive play (design §0 veto asymmetry). */
function qqqShortWithOpposingWhales(): CortexInputs {
  return {
    ...QQQ_SHORT_2026_07_13,
    flow: {
      asOf: "2026-07-13T14:19:00.000Z",
      prints: [
        { premium: 700_000, direction: "bullish", kind: "sweep", at: "2026-07-13T14:10:00.000Z" },
        { premium: 600_000, direction: "bullish", kind: "sweep", at: "2026-07-13T14:16:00.000Z" },
      ],
    },
  };
}

/** A gate-passing QQQ short whose only readable evidence OPPOSES it (positive
 *  market breadth + positive net VEX vs a short), with no veto-grade fact:
 *  score composes to −0.9 → the cortex_net_negative block. */
function qqqShortNetNegative(): CortexInputs {
  return baseInputs({
    ticker: "QQQ",
    direction: "short",
    now: QQQ_SHORT_2026_07_13.now,
    // asOf = now on both slices → zero decay, so the composed score is the exact
    // raw sum −(0.5 + 0.4) = −0.9 (keeps the assertions on round constants).
    sector: {
      asOf: QQQ_SHORT_2026_07_13.now,
      sectorName: null,
      sectorChangePct: null,
      breadthTone: "strongly_positive", // the room fights the short (oppose 0.5)
      tickerChangePct: 0.8,
    },
    vex: {
      asOf: QQQ_SHORT_2026_07_13.now,
      netVex: 900_000_000, // positive: vol path favors dealer buying — fights a short (oppose 0.4)
      kingStrike: null,
    },
  });
}

// ── Decision table ──────────────────────────────────────────────────────────────

test("QQQ short 7/13 (the session's real winner): net-supportive fixture → PASS, zero blocks — the commit still prints", () => {
  const a = assessCortexVerdict(composeCortexEvidence(QQQ_SHORT_2026_07_13));
  assert.equal(a.decision, "PASS");
  assert.equal(a.abstained, false);
  assert.deepEqual(cortexGateBlocks(a), []);
});

test("SPY long 7/13: vetoed fixture → VETO with one gate block PER veto, code cortex_veto:<source> + the evidence sentence", () => {
  const a = assessCortexVerdict(composeCortexEvidence(SPY_LONG_2026_07_13));
  assert.equal(a.decision, "VETO");
  const blocks = cortexGateBlocks(a);
  // The fixture composes exactly two vetoes: the wall-path check and the opposing
  // whale cluster (compose.test.ts pins that) — one block each, all visible.
  assert.deepEqual(
    blocks.map((b) => b.code).sort(),
    ["cortex_veto:flow-quality", "cortex_veto:gex-walls"]
  );
  for (const b of blocks) {
    assert.match(b.reason, /^Cortex veto \[[a-z-]+\]: /);
    assert.equal(b.threshold, null);
    assert.equal(b.unlock_et, null);
  }
  // The rejection-row sentence is the SOURCE's own detail, not a paraphrase.
  const flowBlock = blocks.find((b) => b.code === "cortex_veto:flow-quality")!;
  assert.match(flowBlock.reason, /opposing bearish sweep\/block cluster/);
});

test("veto asymmetry: an otherwise net-supportive QQQ short dies on ONE opposing whale cluster", () => {
  const a = assessCortexVerdict(composeCortexEvidence(qqqShortWithOpposingWhales()));
  assert.equal(a.decision, "VETO");
  assert.ok(!a.abstained);
  if (!a.abstained) {
    // The structural supports are still there — the veto wins anyway (§0: one loud
    // opposing fact can kill an entry; support can never buy one back).
    assert.ok(a.verdict.supports.length >= 3, a.verdict.supports.map((s) => s.source).join(","));
  }
  const blocks = cortexGateBlocks(a);
  assert.deepEqual(blocks.map((b) => b.code), ["cortex_veto:flow-quality"]);
  assert.match(blocks[0]!.reason, /\$1\.3M/);
});

test("net-negative evidence (no veto) blocks with cortex_net_negative — the G-3-passing-but-net-negative rule", () => {
  const a = assessCortexVerdict(composeCortexEvidence(qqqShortNetNegative()));
  assert.equal(a.decision, "NET_NEGATIVE");
  assert.ok(!a.abstained);
  if (!a.abstained) {
    assert.equal(a.verdict.vetoes.length, 0);
    assert.ok(a.verdict.score < 0, `score ${a.verdict.score}`);
  }
  const blocks = cortexGateBlocks(a);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]!.code, "cortex_net_negative");
  assert.equal(blocks[0]!.threshold, 0); // judged against the 0 floor, cited live
  // The SKIP card argues the block: signed score + the actual opposing evidence.
  assert.match(blocks[0]!.reason, /nets -0\.9 against this short/);
  assert.match(blocks[0]!.reason, /\[sector-heat\]/);
  assert.match(blocks[0]!.reason, /\[vex-charm\]/);
});

test("net-zero is a wash, not net-negative: evidence that exactly cancels never overrules green gates", () => {
  // Symmetric 0.5-weight support/oppose pair (sector-heat cap is 0.5) composed
  // fresh → score 0 exactly. Built by composing two half-inputs is impossible in
  // one snapshot, so assert on the pure fold with a real composed shape: breadth
  // opposes (−0.5) while an equal support is simulated via direction flip parity.
  const opposed = composeCortexEvidence(
    baseInputs({
      ticker: "QQQ",
      direction: "short",
      now: QQQ_SHORT_2026_07_13.now,
      sector: {
        asOf: QQQ_SHORT_2026_07_13.now, // zero age → zero decay → weight exactly 0.5
        sectorName: null,
        sectorChangePct: null,
        breadthTone: "strongly_positive",
        tickerChangePct: null,
      },
    })
  );
  assert.equal(opposed.score, -0.5);
  // Flip the verdict's sign by hand-checking the boundary: a verdict at exactly 0
  // must PASS (score < 0 is the block condition, not score <= 0). Also clear the
  // absent list so the thin-evidence gate doesn't fire (this test is about the
  // score boundary, not evidence breadth — that's tested separately above).
  const washed = { ...opposed, score: 0, absent: [] };
  assert.equal(assessCortexVerdict(washed).decision, "PASS");
});

test("ABSTAIN: an all-absent composition (total outage) passes through with zero blocks and an honest reason", () => {
  const a = assessCortexVerdict(composeCortexEvidence(baseInputs({ ticker: "QQQ", direction: "short" })));
  assert.equal(a.decision, "ABSTAIN");
  assert.equal(a.abstained, true);
  if (a.abstained) {
    assert.match(a.reason, /no Cortex source produced evidence \(8 absent\)/);
    assert.match(a.reason, /commit proceeds on the hard gates alone/);
  }
  assert.deepEqual(cortexGateBlocks(a), []);
});

// ── Veto-blind firewall (Phase-0 fail-CLOSED, opt-in) ─────────────────────────────
// The two veto-capable sources (gex-walls + flow-quality) are the ONLY hard-block
// channels. When BOTH fail to read, a fresh 0DTE commit that opts in must HOLD
// (VETO_BLIND) instead of committing blind on the non-veto sources. Opt-OUT callers
// (SPX engine, exit engine) keep the pre-firewall pass-through behavior unchanged.

const AS_OF = "2026-07-17T15:00:00.000Z";
/** Minimal evidence item for a hand-built verdict (matches EvidenceItem's real shape). */
function ev(source: string, stance: string, weight: number, detail = "x") {
  return { source, stance, weight, halfLifeSec: 900, asOf: AS_OF, detail } as never;
}
function verdict(over: Partial<CortexVerdict>): CortexVerdict {
  return {
    ticker: "QQQ",
    direction: "short",
    asOf: AS_OF,
    score: 0,
    conviction: "C" as CortexConviction,
    vetoes: [],
    supports: [],
    opposes: [],
    absent: [],
    narrative: [],
    ...over,
  } as CortexVerdict;
}

test("VETO_CAPABLE_SOURCES is exactly the two veto emitters (single source of truth)", () => {
  assert.deepEqual([...VETO_CAPABLE_SOURCES].sort(), ["flow-quality", "gex-walls"]);
  // The real veto fixture only ever vetoes from these sources — proving the list matches
  // the sources that actually emit a veto stance (no brittle drift).
  const spy = composeCortexEvidence(SPY_LONG_2026_07_13);
  for (const v of spy.vetoes) assert.ok(VETO_CAPABLE_SOURCES.includes(v.source), v.source);
});

test("firewall: BOTH veto sources absent → VETO_BLIND HOLD (opt-in), even at a would-PASS score", () => {
  // Only a non-veto source (sector-heat) answered, +1.5 → this composite WOULD PASS today.
  const vetoBlind = verdict({
    score: 1.5,
    supports: [ev("sector-heat", "supports", 1.5)],
    absent: [
      "gex-walls: no GEX ladder",
      "flow-quality: no flow tape",
      "wall-trend: absent",
      "catalyst-news: absent",
      "vex-charm: absent",
      "darkpool-confluence: absent",
      "opening-harvest: absent",
    ],
  });
  // Opt-IN (0DTE fresh commit): HOLD.
  const held = assessCortexVerdict(vetoBlind, { failClosedOnVetoBlind: true });
  assert.equal(held.decision, "VETO_BLIND");
  assert.equal(held.abstained, false);
  const blocks = cortexGateBlocks(held);
  assert.deepEqual(blocks.map((b) => b.code), ["cortex_veto_blind"]);
  assert.match(blocks[0]!.reason, /blind to BOTH veto-capable sources/i);
  assert.equal(blocks[0]!.threshold, null);
  // Opt-OUT (SPX/exit): unchanged — the +1.5 composite still PASSes.
  const passed = assessCortexVerdict(vetoBlind);
  assert.equal(passed.decision, "PASS");
  assert.deepEqual(cortexGateBlocks(passed), []);
});

test("firewall: total outage (all sources absent) → VETO_BLIND when opted in, ABSTAIN when not", () => {
  const allAbsent = composeCortexEvidence(baseInputs({ ticker: "QQQ", direction: "short" }));
  assert.equal(assessCortexVerdict(allAbsent, { failClosedOnVetoBlind: true }).decision, "VETO_BLIND");
  assert.equal(assessCortexVerdict(allAbsent).decision, "ABSTAIN"); // pre-firewall behavior preserved
});

test("firewall: at least ONE veto source answered → today's behavior kept (no VETO_BLIND)", () => {
  // gex-walls (a veto source) answered with a support; flow-quality absent.
  const gexAnswered = verdict({
    score: 1.0,
    supports: [ev("gex-walls", "supports", 1.0)],
    absent: ["flow-quality: no flow tape", "wall-trend: absent", "sector-heat: absent", "catalyst-news: absent", "vex-charm: absent", "darkpool-confluence: absent", "opening-harvest: absent"],
  });
  assert.equal(assessCortexVerdict(gexAnswered, { failClosedOnVetoBlind: true }).decision, "PASS");

  // Mirror: flow-quality answered, gex-walls absent → still not blind.
  const flowAnswered = verdict({
    score: 1.0,
    supports: [ev("flow-quality", "supports", 1.0)],
    absent: ["gex-walls: no GEX ladder", "wall-trend: absent", "sector-heat: absent", "catalyst-news: absent", "vex-charm: absent", "darkpool-confluence: absent", "opening-harvest: absent"],
  });
  assert.equal(assessCortexVerdict(flowAnswered, { failClosedOnVetoBlind: true }).decision, "PASS");
});

test("firewall: all sources present is unchanged — real fixtures PASS/VETO identically with the opt on", () => {
  // Net-supportive winner still PASSes (both veto sources answered).
  const pass = assessCortexVerdict(composeCortexEvidence(QQQ_SHORT_2026_07_13), { failClosedOnVetoBlind: true });
  assert.equal(pass.decision, "PASS");
  assert.deepEqual(cortexGateBlocks(pass), []);
  // A real veto still VETOes (a veto source clearly answered) — never masked as blind.
  const veto = assessCortexVerdict(composeCortexEvidence(SPY_LONG_2026_07_13), { failClosedOnVetoBlind: true });
  assert.equal(veto.decision, "VETO");
});

test("firewall: evaluateCortexForCommit threads the opt — a both-veto-absent read HOLDs", async () => {
  // fetchInputs returns a snapshot with NO gex + NO flow slices → both veto sources absent.
  const a = await evaluateCortexForCommit(
    "QQQ",
    "short",
    new Date(AS_OF),
    { fetchInputs: async () => baseInputs({ ticker: "QQQ", direction: "short", now: AS_OF }) },
    { failClosedOnVetoBlind: true }
  );
  assert.equal(a.decision, "VETO_BLIND");
  assert.deepEqual(cortexGateBlocks(a).map((b) => b.code), ["cortex_veto_blind"]);
  // Without the opt, the same outage degrades to ABSTAIN (SPX/exit path unchanged).
  const b = await evaluateCortexForCommit("QQQ", "short", new Date(AS_OF), {
    fetchInputs: async () => baseInputs({ ticker: "QQQ", direction: "short", now: AS_OF }),
  });
  assert.equal(b.decision, "ABSTAIN");
});

// ── Thin-evidence gate ──────────────────────────────────────────────────────────

test("thin evidence: a bare +0.1 from <3 sources is blocked as NET_NEGATIVE — THIN_EVIDENCE_SCORE_FLOOR enforced", () => {
  assert.equal(THIN_EVIDENCE_MIN_SOURCES, 3);
  assert.equal(THIN_EVIDENCE_SCORE_FLOOR, 0.5);
  // Build a verdict with 6 absent sources (only 2 answered) and a thin positive score.
  const thinVerdict: CortexVerdict = {
    score: 0.1,
    conviction: "C" as CortexConviction,
    direction: "short",
    asOf: "2026-07-17T15:00:00.000Z",
    vetoes: [],
    supports: [{ source: "vex-charm", detail: "thin positive", weight: 0.1, asOf: "2026-07-17T15:00:00.000Z", halfLifeMs: 300_000 }],
    opposes: [],
    absent: ["gex-walls", "wall-trend", "flow-quality", "sector-heat", "darkpool-confluence", "opening-harvest"],
    narrative: ["thin"],
  };
  const a = assessCortexVerdict(thinVerdict);
  assert.equal(a.decision, "NET_NEGATIVE");
  assert.deepEqual(cortexGateBlocks(a).map(b => b.code), ["cortex_net_negative"]);
});

test("thin evidence: score at or above THIN_EVIDENCE_SCORE_FLOOR passes even with <3 sources", () => {
  const aboveFloor: CortexVerdict = {
    score: 0.5,
    conviction: "C" as CortexConviction,
    direction: "long",
    asOf: "2026-07-17T15:00:00.000Z",
    vetoes: [],
    supports: [{ source: "gex-walls", detail: "strong support", weight: 0.5, asOf: "2026-07-17T15:00:00.000Z", halfLifeMs: 300_000 }],
    opposes: [],
    absent: ["wall-trend", "flow-quality", "sector-heat", "darkpool-confluence", "vex-charm", "opening-harvest"],
    narrative: ["one strong source"],
  };
  assert.equal(assessCortexVerdict(aboveFloor).decision, "PASS");
});

test("thin evidence: >=3 sources answering allows any non-negative score through (no floor)", () => {
  const adequate: CortexVerdict = {
    score: 0.1,
    conviction: "C" as CortexConviction,
    direction: "short",
    asOf: "2026-07-17T15:00:00.000Z",
    vetoes: [],
    supports: [{ source: "gex-walls", detail: "weak positive", weight: 0.1, asOf: "2026-07-17T15:00:00.000Z", halfLifeMs: 300_000 }],
    opposes: [],
    absent: ["sector-heat", "darkpool-confluence", "opening-harvest", "catalyst-news", "wall-trend"],
    narrative: ["adequate breadth"],
  };
  // 8 total - 5 absent = 3 answering: at the threshold, so the floor does NOT apply.
  assert.equal(assessCortexVerdict(adequate).decision, "PASS");
});

// ── evaluateCortexForCommit (the IO seam) ───────────────────────────────────────

test("evaluateCortexForCommit: threads the scan's clock into the fetch and composes the real verdict", async () => {
  let seen: { ticker: string; direction: string; now: Date } | null = null;
  const now = new Date("2026-07-13T14:20:00.000Z");
  const a = await evaluateCortexForCommit("QQQ", "short", now, {
    fetchInputs: async (ticker, direction, opts) => {
      seen = { ticker, direction, now: opts.now };
      return QQQ_SHORT_2026_07_13;
    },
  });
  assert.deepEqual(seen, { ticker: "QQQ", direction: "short", now });
  assert.equal(a.decision, "PASS");
});

test("evaluateCortexForCommit: NEVER throws — a throwing reader degrades to ABSTAIN with the error class", async () => {
  const a = await evaluateCortexForCommit("QQQ", "short", new Date("2026-07-13T14:20:00.000Z"), {
    fetchInputs: async () => {
      const err = new Error("provider exploded");
      err.name = "CortexSourceTimeout";
      throw err;
    },
  });
  assert.equal(a.decision, "ABSTAIN");
  if (a.abstained) {
    // Error CLASS only — messages can carry URLs/params that don't belong in a
    // member-adjacent record (same rule as fetch.ts's errorClass).
    assert.match(a.reason, /Cortex evaluation failed \(CortexSourceTimeout\)/);
    assert.ok(!a.reason.includes("provider exploded"));
  }
});

// ── Payload summary + entry_context blob shapes ─────────────────────────────────

test("cortexSummaryFor: committed card carries score/conviction/top-3 one-liners; nothing ran → null", () => {
  const a = assessCortexVerdict(composeCortexEvidence(QQQ_SHORT_2026_07_13));
  const s = cortexSummaryFor(a);
  assert.ok(s && !s.abstained);
  if (s && !s.abstained) {
    assert.equal(s.decision, "PASS");
    assert.ok(!Number.isNaN(s.score) && s.score > 0);
    assert.equal(s.conviction, "A");
    assert.deepEqual(s.vetoes, []);
    assert.equal(s.top_supports.length, 3); // top-3 exactly, even with 5+ supports
    for (const line of s.top_supports) assert.match(line, /^\[[a-z-]+\] /);
    assert.ok(s.top_opposes.length <= 3);
  }
  assert.equal(cortexSummaryFor(null), null);
});

test("cortexSummaryFor: SKIP card carries the veto evidence (and net-negative carries the opposing lines)", () => {
  const veto = cortexSummaryFor(assessCortexVerdict(composeCortexEvidence(SPY_LONG_2026_07_13)));
  assert.ok(veto && !veto.abstained);
  if (veto && !veto.abstained) {
    assert.equal(veto.decision, "VETO");
    assert.equal(veto.vetoes.length, 2);
    assert.ok(veto.vetoes.every((v) => /^\[[a-z-]+\] /.test(v)));
  }
  const negative = cortexSummaryFor(assessCortexVerdict(composeCortexEvidence(qqqShortNetNegative())));
  assert.ok(negative && !negative.abstained);
  if (negative && !negative.abstained) {
    assert.equal(negative.decision, "NET_NEGATIVE");
    assert.equal(negative.score, -0.9);
    assert.equal(negative.top_opposes.length, 2);
  }
});

test("cortexEntryContextFor: the FULL evidence vector rides the commit blob; abstain rides as {abstained, reason}; null stays null", () => {
  const verdict = composeCortexEvidence(QQQ_SHORT_2026_07_13);
  const blob = cortexEntryContextFor(assessCortexVerdict(verdict));
  assert.ok(blob && !blob.abstained);
  if (blob && !blob.abstained) {
    // The §3.1 calibration loop needs the vector VERBATIM — decayed weights,
    // asOf stamps, absent list and narrative included, nothing summarized away.
    assert.deepEqual(blob.vetoes, verdict.vetoes);
    assert.deepEqual(blob.supports, verdict.supports);
    assert.deepEqual(blob.opposes, verdict.opposes);
    assert.deepEqual(blob.absent, verdict.absent);
    assert.deepEqual(blob.narrative, verdict.narrative);
    assert.equal(blob.score, verdict.score);
    assert.equal(blob.conviction, verdict.conviction);
    assert.equal(blob.as_of, verdict.asOf);
    assert.equal(blob.decision, "PASS");
  }

  const abstain = cortexEntryContextFor({ decision: "ABSTAIN", abstained: true, reason: "why" });
  assert.deepEqual(abstain, { abstained: true, reason: "why" });

  assert.equal(cortexEntryContextFor(null), null); // refresh lane: no blob, never a fake one
});
