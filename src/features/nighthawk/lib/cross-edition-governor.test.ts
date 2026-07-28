import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateGovernor,
  applyCrossEditionGovernor,
  buildSectorCounts,
  GOV_REPEAT_PENALTY_PER_APPEARANCE,
  GOV_PENDING_EXTRA_PENALTY,
  GOV_LOSS_STREAK_HALT_THRESHOLD,
  GOV_CROSS_EDITION_SECTOR_CAP,
  GOV_LOOKBACK_EDITIONS,
} from "./cross-edition-governor";
import type { RecentOutcomeRow } from "./cross-edition-governor";
import type { ScoredCandidate } from "./scorer";

function fakeCandidate(overrides: Partial<ScoredCandidate> = {}): ScoredCandidate {
  return {
    ticker: "AAPL",
    score: 50,
    direction: "long",
    flow_score: 15,
    tech_score: 12,
    pos_score: 8,
    news_score: 4,
    smart_money_score: 3,
    confirming_signals: 3,
    conviction: "A",
    sector: "technology",
    ...overrides,
  };
}

function fakeOutcome(overrides: Partial<RecentOutcomeRow> = {}): RecentOutcomeRow {
  return {
    edition_for: "2026-07-15",
    ticker: "AAPL",
    direction: "LONG",
    outcome: "target",
    sector: "technology",
    ...overrides,
  };
}

// ── evaluateGovernor ────────────────────────────────────────────────────────────

describe("evaluateGovernor", () => {
  test("pass: no recent outcomes → no action", () => {
    const action = evaluateGovernor(fakeCandidate(), [], new Map());
    assert.equal(action.type, "pass");
  });

  test("demote: repeat-ticker penalty per appearance", () => {
    const outcomes = [
      fakeOutcome({ edition_for: "2026-07-14" }),
      fakeOutcome({ edition_for: "2026-07-13" }),
    ];
    const action = evaluateGovernor(fakeCandidate(), outcomes, new Map());
    assert.equal(action.type, "demote");
    assert.equal(
      (action as { penalty: number }).penalty,
      GOV_REPEAT_PENALTY_PER_APPEARANCE * 2
    );
  });

  test("demote: pending outcome adds extra penalty", () => {
    const outcomes = [fakeOutcome({ outcome: "pending" })];
    const action = evaluateGovernor(fakeCandidate(), outcomes, new Map());
    assert.equal(action.type, "demote");
    assert.equal(
      (action as { penalty: number }).penalty,
      GOV_REPEAT_PENALTY_PER_APPEARANCE + GOV_PENDING_EXTRA_PENALTY
    );
  });

  test("cut: loss-streak halt when stops >= threshold", () => {
    const outcomes = Array.from({ length: GOV_LOSS_STREAK_HALT_THRESHOLD }, (_, i) =>
      fakeOutcome({ edition_for: `2026-07-${14 - i}`, outcome: "stop" })
    );
    const action = evaluateGovernor(fakeCandidate(), outcomes, new Map());
    assert.equal(action.type, "cut");
    assert.ok(
      (action as { reasons: string[] }).reasons.some((r) => r.includes("loss-streak-halt"))
    );
  });

  test("demote: cross-edition sector cap applies −10", () => {
    const sectorCounts = new Map([["technology", GOV_CROSS_EDITION_SECTOR_CAP]]);
    const action = evaluateGovernor(fakeCandidate(), [], sectorCounts);
    assert.equal(action.type, "demote");
    assert.equal((action as { penalty: number }).penalty, 10);
  });

  test("sector cap: below threshold → pass", () => {
    const sectorCounts = new Map([["technology", GOV_CROSS_EDITION_SECTOR_CAP - 1]]);
    const action = evaluateGovernor(fakeCandidate(), [], sectorCounts);
    assert.equal(action.type, "pass");
  });

  test("case-insensitive ticker matching", () => {
    const outcomes = [fakeOutcome({ ticker: "aapl" })];
    const action = evaluateGovernor(fakeCandidate({ ticker: "AAPL" }), outcomes, new Map());
    assert.equal(action.type, "demote");
  });

  test("cut overrides demote when both apply", () => {
    const outcomes = [
      fakeOutcome({ outcome: "stop", edition_for: "2026-07-14" }),
      fakeOutcome({ outcome: "stop", edition_for: "2026-07-13" }),
    ];
    const action = evaluateGovernor(fakeCandidate(), outcomes, new Map());
    assert.equal(action.type, "cut");
  });
});

// ── buildSectorCounts ───────────────────────────────────────────────────────────

describe("buildSectorCounts", () => {
  test("counts sectors case-insensitively", () => {
    const outcomes = [
      fakeOutcome({ sector: "Technology" }),
      fakeOutcome({ sector: "technology", ticker: "MSFT" }),
      fakeOutcome({ sector: "Energy", ticker: "XOM" }),
    ];
    const counts = buildSectorCounts(outcomes);
    assert.equal(counts.get("technology"), 2);
    assert.equal(counts.get("energy"), 1);
  });

  test("ignores null sectors", () => {
    const outcomes = [fakeOutcome({ sector: null })];
    const counts = buildSectorCounts(outcomes);
    assert.equal(counts.size, 0);
  });
});

// ── applyCrossEditionGovernor ─────────────────────────────────────────────────

describe("applyCrossEditionGovernor", () => {
  test("no history → all pass through unchanged", () => {
    const ranked = [fakeCandidate({ ticker: "AAPL" }), fakeCandidate({ ticker: "MSFT" })];
    const result = applyCrossEditionGovernor(ranked, []);
    assert.equal(result.ranked.length, 2);
    assert.equal(result.cut.length, 0);
    assert.equal(result.demoted.length, 0);
    assert.equal(result.notes.length, 0);
  });

  test("cuts loss-streaking tickers and removes from ranked", () => {
    const ranked = [
      fakeCandidate({ ticker: "AAPL", score: 60 }),
      fakeCandidate({ ticker: "MSFT", score: 50 }),
    ];
    const outcomes = [
      fakeOutcome({ ticker: "AAPL", outcome: "stop", edition_for: "2026-07-14" }),
      fakeOutcome({ ticker: "AAPL", outcome: "stop", edition_for: "2026-07-13" }),
    ];
    const result = applyCrossEditionGovernor(ranked, outcomes);
    assert.equal(result.ranked.length, 1);
    assert.equal(result.ranked[0].ticker, "MSFT");
    assert.equal(result.cut.length, 1);
    assert.equal(result.cut[0].ticker, "AAPL");
  });

  test("re-sorts by effective score after demotions", () => {
    const ranked = [
      fakeCandidate({ ticker: "AAPL", score: 60 }),
      fakeCandidate({ ticker: "MSFT", score: 55, sector: "healthcare" }),
    ];
    const outcomes = [
      fakeOutcome({ ticker: "AAPL", outcome: "target", edition_for: "2026-07-14" }),
      fakeOutcome({ ticker: "AAPL", outcome: "target", edition_for: "2026-07-13" }),
      fakeOutcome({ ticker: "AAPL", outcome: "target", edition_for: "2026-07-12" }),
    ];
    const result = applyCrossEditionGovernor(ranked, outcomes);
    assert.equal(result.ranked.length, 2);
    // AAPL: 60 - (5*3) = 45, MSFT: 55 - 0 = 55 → MSFT first
    // (MSFT in different sector so tonight's running sector count doesn't penalize it)
    assert.equal(result.ranked[0].ticker, "MSFT");
    assert.equal(result.ranked[1].ticker, "AAPL");
    assert.equal(result.demoted.length, 1);
  });

  test("preserves original score on candidate (penalty is for sorting only)", () => {
    const ranked = [fakeCandidate({ ticker: "AAPL", score: 60 })];
    const outcomes = [fakeOutcome({ ticker: "AAPL" })];
    const result = applyCrossEditionGovernor(ranked, outcomes);
    assert.equal(result.ranked[0].score, 60);
  });

  test("summary note when cuts or demotions occur", () => {
    const ranked = [fakeCandidate({ ticker: "AAPL", score: 60 })];
    const outcomes = [fakeOutcome({ ticker: "AAPL" })];
    const result = applyCrossEditionGovernor(ranked, outcomes);
    assert.ok(result.notes.some((n) => n.includes("[cross-edition-governor]")));
  });

  test("config constants are sane", () => {
    assert.ok(GOV_LOOKBACK_EDITIONS >= 1);
    assert.ok(GOV_REPEAT_PENALTY_PER_APPEARANCE > 0);
    assert.ok(GOV_PENDING_EXTRA_PENALTY > 0);
    assert.ok(GOV_LOSS_STREAK_HALT_THRESHOLD >= 1);
    assert.ok(GOV_CROSS_EDITION_SECTOR_CAP >= 1);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════
// SECOND-WAVE adversarial coverage — exact thresholds, stacked penalties, ranking.
// ════════════════════════════════════════════════════════════════════════════════════

describe("cross-edition-governor: second-wave boundaries", () => {
  test("loss-streak boundary: exactly THRESHOLD−1 stops demotes (repeat), exactly THRESHOLD cuts", () => {
    const belowThreshold = Array.from({ length: GOV_LOSS_STREAK_HALT_THRESHOLD - 1 }, (_, i) =>
      fakeOutcome({ edition_for: `2026-07-${14 - i}`, outcome: "stop" })
    );
    const demote = evaluateGovernor(fakeCandidate(), belowThreshold, new Map());
    assert.equal(demote.type, GOV_LOSS_STREAK_HALT_THRESHOLD - 1 > 0 ? "demote" : "pass");

    const atThreshold = Array.from({ length: GOV_LOSS_STREAK_HALT_THRESHOLD }, (_, i) =>
      fakeOutcome({ edition_for: `2026-07-${14 - i}`, outcome: "stop" })
    );
    assert.equal(evaluateGovernor(fakeCandidate(), atThreshold, new Map()).type, "cut");
  });

  test("sector cap boundary: exactly AT the cap demotes −10; one below passes", () => {
    const atCap = new Map([["technology", GOV_CROSS_EDITION_SECTOR_CAP]]);
    assert.equal(evaluateGovernor(fakeCandidate(), [], atCap).type, "demote");
    const below = new Map([["technology", GOV_CROSS_EDITION_SECTOR_CAP - 1]]);
    assert.equal(evaluateGovernor(fakeCandidate(), [], below).type, "pass");
  });

  test("sector cap: candidate sector is lower-cased before the count lookup (case-insensitive match)", () => {
    const counts = new Map([["technology", GOV_CROSS_EDITION_SECTOR_CAP]]);
    // Candidate sector supplied in mixed/upper case — must still hit the lower-cased count key.
    const action = evaluateGovernor(fakeCandidate({ sector: "Technology" }), [], counts);
    assert.equal(action.type, "demote");
    assert.equal((action as { penalty: number }).penalty, 10);
  });

  test("null candidate sector never trips the sector cap", () => {
    const counts = new Map([["technology", GOV_CROSS_EDITION_SECTOR_CAP + 5]]);
    assert.equal(evaluateGovernor(fakeCandidate({ sector: null }), [], counts).type, "pass");
  });

  test("stacked penalties: repeat + pending + sector-cap sum into one demote", () => {
    const outcomes = [
      fakeOutcome({ outcome: "pending", edition_for: "2026-07-14" }),
      fakeOutcome({ outcome: "target", edition_for: "2026-07-13" }),
    ];
    const sectorCounts = new Map([["technology", GOV_CROSS_EDITION_SECTOR_CAP]]);
    const action = evaluateGovernor(fakeCandidate(), outcomes, sectorCounts);
    assert.equal(action.type, "demote");
    // repeat (2×5) + pending (5) + sector (10) = 25.
    assert.equal(
      (action as { penalty: number }).penalty,
      GOV_REPEAT_PENALTY_PER_APPEARANCE * 2 + GOV_PENDING_EXTRA_PENALTY + 10
    );
  });

  test("apply: a hard-cut candidate is removed AND absent from the ranked survivors even if it scored highest", () => {
    const ranked = [
      fakeCandidate({ ticker: "LOSER", score: 99 }),
      fakeCandidate({ ticker: "MSFT", score: 40 }),
    ];
    const outcomes = [
      fakeOutcome({ ticker: "LOSER", outcome: "stop", edition_for: "2026-07-14" }),
      fakeOutcome({ ticker: "LOSER", outcome: "stop", edition_for: "2026-07-13" }),
    ];
    const result = applyCrossEditionGovernor(ranked, outcomes);
    assert.deepEqual(result.ranked.map((c) => c.ticker), ["MSFT"]);
    assert.ok(!result.ranked.some((c) => c.ticker === "LOSER"));
    assert.equal(result.cut[0].ticker, "LOSER");
  });

  test("apply: demotion can flip the order but a small penalty keeps a big lead (effective-score sort)", () => {
    // AAPL 60 with one repeat (−5) = 55; MSFT 58 clean = 58 → MSFT leads.
    const flip = applyCrossEditionGovernor(
      [fakeCandidate({ ticker: "AAPL", score: 60 }), fakeCandidate({ ticker: "MSFT", score: 58, sector: "energy" })],
      [fakeOutcome({ ticker: "AAPL", edition_for: "2026-07-14" })]
    );
    assert.deepEqual(flip.ranked.map((c) => c.ticker), ["MSFT", "AAPL"]);

    // Same penalty but a bigger lead: AAPL 70 (−5) = 65 > MSFT 58 → AAPL keeps the top.
    const keep = applyCrossEditionGovernor(
      [fakeCandidate({ ticker: "AAPL", score: 70 }), fakeCandidate({ ticker: "MSFT", score: 58, sector: "energy" })],
      [fakeOutcome({ ticker: "AAPL", edition_for: "2026-07-14" })]
    );
    assert.deepEqual(keep.ranked.map((c) => c.ticker), ["AAPL", "MSFT"]);
  });

  test("pending only counts among a ticker's OWN outcomes — a different ticker's pending is irrelevant", () => {
    const action = evaluateGovernor(
      fakeCandidate({ ticker: "AAPL" }),
      [fakeOutcome({ ticker: "MSFT", outcome: "pending" })],
      new Map()
    );
    assert.equal(action.type, "pass", "AAPL has no history of its own");
  });

  test("demoted candidates carry govPenalty on the ScoredCandidate for downstream sort", () => {
    const ranked = [
      fakeCandidate({ ticker: "AAPL", score: 60 }),
      fakeCandidate({ ticker: "MSFT", score: 55, sector: "energy" }),
    ];
    const outcomes = [
      fakeOutcome({ ticker: "AAPL", outcome: "target", edition_for: "2026-07-14" }),
    ];
    const result = applyCrossEditionGovernor(ranked, outcomes);
    const aapl = result.ranked.find(c => c.ticker === "AAPL");
    assert.ok(aapl, "AAPL should survive");
    assert.equal(aapl!.govPenalty, GOV_REPEAT_PENALTY_PER_APPEARANCE);
    const msft = result.ranked.find(c => c.ticker === "MSFT");
    assert.equal(msft!.govPenalty, undefined, "unpenalized candidates have no govPenalty");
  });
});
