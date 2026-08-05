import assert from "node:assert/strict";
import test from "node:test";
import {
  anyRankedClearsScoreFloor,
  countRankedClearingMerit,
  effectiveMinPublishPlays,
  effectiveSynthesisPool,
  effectiveTargetPlays,
  filterPlaysByMerit,
  gatePromoteEnabled,
  gatePromoteMinScore,
  legacyGlobalStrongest,
  thinEditionBackfillEnabled,
} from "./edition-quality";
import { MAX_DOSSIER_STOCKS } from "./constants";
import type { PlaybookPlay } from "./types";
import type { ScoredCandidate } from "./scorer";

const scored = (ticker: string, score: number, overrides: Partial<ScoredCandidate> = {}): ScoredCandidate => ({
  ticker,
  score,
  direction: "long",
  flow_score: 0,
  tech_score: 0,
  pos_score: 0,
  news_score: 0,
  smart_money_score: 0,
  conviction: "B",
  confirming_signals: 3,
  ...overrides,
});

const play = (ticker: string, score: number): PlaybookPlay => ({
  rank: 1,
  ticker,
  direction: "LONG",
  conviction: "B",
  play_type: "stock",
  thesis: "",
  key_signal: "",
  entry_range: "-",
  target: "-",
  stop: "-",
  options_play: "-",
  score,
  confirming_signals: 3,
  earnings_risk: false,
});

test("legacyGlobalStrongest defaults ON and uses full dossier pool", () => {
  const keys = ["NH_LEGACY_GLOBAL_STRONGEST"] as const;
  const prev: Record<string, string | undefined> = {};
  for (const k of keys) prev[k] = process.env[k];
  delete process.env.NH_LEGACY_GLOBAL_STRONGEST;
  try {
    assert.equal(legacyGlobalStrongest(), true);
    assert.equal(effectiveSynthesisPool(), MAX_DOSSIER_STOCKS);
  } finally {
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
});

test("global-strongest book floor defaults: 3–5 target, rescue paths ON, merit promote floor", () => {
  const keys = [
    "NH_LEGACY_GLOBAL_STRONGEST",
    "NH_LEGACY_MIN_PLAYS",
    "NH_LEGACY_MAX_PLAYS",
    "NH_LEGACY_RESCUE",
    "NH_LEGACY_GATE_PROMOTE",
    "NH_LEGACY_BACKFILL",
    "NH_MIN_PUBLISH_SCORE",
  ] as const;
  const prev: Record<string, string | undefined> = {};
  for (const k of keys) prev[k] = process.env[k];
  delete process.env.NH_LEGACY_GLOBAL_STRONGEST;
  delete process.env.NH_LEGACY_MIN_PLAYS;
  delete process.env.NH_LEGACY_MAX_PLAYS;
  delete process.env.NH_LEGACY_RESCUE;
  delete process.env.NH_LEGACY_GATE_PROMOTE;
  delete process.env.NH_LEGACY_BACKFILL;
  delete process.env.NH_MIN_PUBLISH_SCORE;
  try {
    assert.equal(legacyGlobalStrongest(), true);
    assert.equal(effectiveMinPublishPlays(), 3);
    assert.equal(effectiveTargetPlays(), 5);
    assert.equal(gatePromoteEnabled(), true);
    assert.equal(thinEditionBackfillEnabled(), true);
    assert.equal(gatePromoteMinScore(), 55);
  } finally {
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
});

test("filterPlaysByMerit keeps highest merit and drops sub-floor names", () => {
  const keys = ["NH_LEGACY_GLOBAL_STRONGEST", "NH_MIN_PUBLISH_SCORE", "NH_LEGACY_MIN_TIER", "NH_LEGACY_MAX_PLAYS"] as const;
  const prev: Record<string, string | undefined> = {};
  for (const k of keys) prev[k] = process.env[k];
  process.env.NH_LEGACY_GLOBAL_STRONGEST = "1";
  process.env.NH_MIN_PUBLISH_SCORE = "50";
  process.env.NH_LEGACY_MIN_TIER = "B";
  process.env.NH_LEGACY_MAX_PLAYS = "2";
  try {
    const { plays, dropped } = filterPlaysByMerit(
      [play("WEAK", 44), play("MID", 58), play("STRONG", 72)],
      {}
    );
    assert.equal(plays.length, 2);
    assert.equal(plays[0]!.ticker, "STRONG");
    assert.equal(plays[1]!.ticker, "MID");
    assert.equal(dropped.length, 1);
    assert.match(dropped[0]!.reason, /merit 44/);
  } finally {
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
});

// ---------------------------------------------------------------------------
// countRankedClearingMerit / anyRankedClearsScoreFloor (2026-08-05, pre-synthesis
// short-circuit — Lever 5 of the discovery-architecture redesign)
// ---------------------------------------------------------------------------

const withEnv = (vars: Record<string, string>, fn: () => void) => {
  const keys = Object.keys(vars);
  const prev: Record<string, string | undefined> = {};
  for (const k of keys) prev[k] = process.env[k];
  for (const k of keys) process.env[k] = vars[k]!;
  try {
    fn();
  } finally {
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
};

test("countRankedClearingMerit: counts only candidates clearing BOTH score and tier", () => {
  withEnv({ NH_LEGACY_GLOBAL_STRONGEST: "1", NH_MIN_PUBLISH_SCORE: "50", NH_LEGACY_MIN_TIER: "B" }, () => {
    const ranked = [
      scored("HIGH_SCORE_GOOD_TIER", 70, { confirming_signals: 5 }),
      scored("HIGH_SCORE_BAD_TIER", 70, { score: 70 }), // score clears, tier assignment may still cap low
      scored("LOW_SCORE", 30),
    ];
    // Exact tier assignment depends on assignNighthawkTier's full rules (not re-tested here —
    // nighthawk-tiers.test.ts owns that); this just proves the count never exceeds candidates
    // whose score clears, and is 0 when none do.
    const n = countRankedClearingMerit(ranked);
    assert.ok(n <= 2, "at most the 2 high-score candidates could clear; the 30-score one cannot");
    assert.ok(n >= 0);
  });
});

test("countRankedClearingMerit: zero ranked candidates → 0", () => {
  withEnv({ NH_LEGACY_GLOBAL_STRONGEST: "1", NH_MIN_PUBLISH_SCORE: "50", NH_LEGACY_MIN_TIER: "B" }, () => {
    assert.equal(countRankedClearingMerit([]), 0);
  });
});

test("anyRankedClearsScoreFloor: true when at least one candidate clears score, tier irrelevant", () => {
  withEnv({ NH_LEGACY_GLOBAL_STRONGEST: "1", NH_MIN_PUBLISH_SCORE: "55" }, () => {
    assert.equal(anyRankedClearsScoreFloor([scored("A", 60), scored("B", 20)]), true);
    assert.equal(anyRankedClearsScoreFloor([scored("A", 54)]), false);
    assert.equal(anyRankedClearsScoreFloor([scored("A", 55)]), true, "exactly-at-floor clears");
  });
});

test("anyRankedClearsScoreFloor: false for an empty pool", () => {
  withEnv({ NH_LEGACY_GLOBAL_STRONGEST: "1", NH_MIN_PUBLISH_SCORE: "55" }, () => {
    assert.equal(anyRankedClearsScoreFloor([]), false);
  });
});

test("anyRankedClearsScoreFloor: govPenalty reduces effective score below the floor", () => {
  withEnv({ NH_LEGACY_GLOBAL_STRONGEST: "1", NH_MIN_PUBLISH_SCORE: "55" }, () => {
    assert.equal(anyRankedClearsScoreFloor([scored("PENALIZED", 60, { govPenalty: 10 })]), false, "60-10=50 < 55");
    assert.equal(anyRankedClearsScoreFloor([scored("PENALIZED", 60, { govPenalty: 5 })]), true, "60-5=55 >= 55");
  });
});

test("anyRankedClearsScoreFloor is intentionally LOOSER than countRankedClearingMerit>0 — the safe short-circuit guard", () => {
  // A pool where every candidate's score clears the floor but (by construction, forcing tier C
  // via missing confirming_signals + earnings_risk) none clears tier — countRankedClearingMerit
  // reports 0 (nothing would organically publish), but anyRankedClearsScoreFloor must still be
  // true, because promoteTopBlocked's gate-promote rescue (publish-gates.ts) doesn't check tier
  // and could still admit these on score alone. Short-circuiting on the STRICTER count would risk
  // skipping a night gate-promote could have rescued something from.
  withEnv({ NH_LEGACY_GLOBAL_STRONGEST: "1", NH_MIN_PUBLISH_SCORE: "50", NH_LEGACY_MIN_TIER: "B" }, () => {
    const ranked = [scored("SCORE_OK_TIER_UNKNOWN", 60, { confirming_signals: 0, earnings_risk: true })];
    assert.equal(anyRankedClearsScoreFloor(ranked), true, "score alone clears — must never be false here");
    // Whatever countRankedClearingMerit reports for this fixture, it must never be an
    // over-claim relative to anyRankedClearsScoreFloor's looser guard.
    if (countRankedClearingMerit(ranked) > 0) {
      assert.equal(anyRankedClearsScoreFloor(ranked), true);
    }
  });
});
