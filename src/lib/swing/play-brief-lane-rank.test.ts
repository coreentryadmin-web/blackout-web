import test from "node:test";
import assert from "node:assert/strict";
import type { TerminalPlay } from "@/features/nighthawk/command-deck/types";
import type { HorizonPlay } from "@/lib/horizon-plays";
import { computeLaneRank, laneRankSection, parseDeckContractLabel } from "./play-brief-lane-rank";

function play(overrides: Partial<TerminalPlay> = {}): TerminalPlay {
  return {
    id: "SWING:NRG",
    ticker: "NRG",
    direction: "LONG",
    contract: "110C · 13DTE",
    score: 45,
    status: "HOLD",
    horizon: "SWING",
    exitModel: "SCALE_OUT",
    factors: [],
    gates: [],
    ...overrides,
  };
}

function row(
  ticker: string,
  score: number,
  status: HorizonPlay["status"],
  contract?: { strike: number; right: "C" | "P" },
  manageAction?: HorizonPlay["manageAction"],
  setupState?: HorizonPlay["setupState"],
): HorizonPlay {
  const c = contract ?? { strike: 100, right: "C" as const };
  return {
    ticker,
    direction: "LONG",
    score,
    status,
    reason: "",
    contract: { strike: c.strike, right: c.right, expiry: "2026-09-20", dte: 14, mid: 1, delta: 0.5, gamma: 0, theta: 0, vega: 0, iv: 0.3 },
    factors: [],
    manageAction,
    setupState,
  };
}

test("computeLaneRank: ranks OPEN play among COMMIT peers (real HorizonPlay shape)", () => {
  const lanes = [row("NRG", 45, "COMMIT"), row("CRWD", 70, "COMMIT"), row("AAPL", 30, "COMMIT")];
  const snap = computeLaneRank(play({ ticker: "NRG", score: 45 }), lanes);
  assert.ok(snap);
  assert.equal(snap!.rank, 2);
  assert.equal(snap!.total, 3);
  assert.equal(snap!.medianScore, 45);
});

test("computeLaneRank: null when lane rows use DeckStatus literals (pre-fix bug shape)", () => {
  const lanes = [row("NRG", 45, "HOLD"), row("CRWD", 70, "OPEN")];
  const snap = computeLaneRank(play({ score: 45 }), lanes);
  assert.equal(snap, null, "HOLD/OPEN on HorizonPlay are not real — peers filter must use COMMIT");
});

test("laneRankSection: null for closed plays", () => {
  assert.equal(laneRankSection(play({ status: "CLOSED" }), [row("NRG", 50, "COMMIT")]), null);
});

test("laneRankSection: renders rank line for committed peers", () => {
  const sec = laneRankSection(play({ ticker: "NRG", score: 70 }), [row("NRG", 70, "COMMIT"), row("X", 40, "COMMIT")]);
  assert.ok(sec);
  assert.match(sec!.body, /#1 of 2/);
});

test("parseDeckContractLabel: extracts strike and right from deck label", () => {
  assert.deepEqual(parseDeckContractLabel("110C · 13DTE"), { strike: 110, right: "C" });
  assert.deepEqual(parseDeckContractLabel("192.5P · 0DTE"), { strike: 192.5, right: "P" });
  assert.deepEqual(parseDeckContractLabel(""), { strike: null, right: null });
});

test("computeLaneRank: disambiguates same-ticker WATCH rows by contract", () => {
  const lanes = [
    row("NRG", 70, "WATCH", { strike: 115, right: "C" }),
    row("NRG", 40, "WATCH", { strike: 110, right: "C" }),
  ];
  const snap = computeLaneRank(play({ ticker: "NRG", contract: "110C · 14DTE", score: 40, status: "WATCH" }), lanes);
  assert.ok(snap);
  assert.equal(snap!.rank, 2, "110C ranks second behind 115C — ticker-only match would wrongly rank #1");
  assert.equal(snap!.playScore, 40);
});

test("computeLaneRank: named leader skips a peer whose own manage engine says EXIT/EXIT_RUNNER", () => {
  // Live repro 2026-09-12: CRWD sat #1 by score (86.5) among real OPEN positions while its own
  // manage engine had already fired EXIT_RUNNER (round-tripped from +129.7% peak to -9.5%). NN's
  // brief still named "Leader: CRWD @ 86.5 — confirm before adding size" — reads as "put money
  // here" about a position the desk is telling members to exit.
  const lanes = [
    row("CRWD", 86.5, "COMMIT", undefined, "EXIT_RUNNER"),
    row("AAPL", 84.4, "COMMIT", undefined, "HOLD"),
    row("NN", 23, "COMMIT", undefined, "HOLD"),
  ];
  const snap = computeLaneRank(play({ ticker: "NN", score: 23 }), lanes);
  assert.ok(snap);
  assert.equal(snap!.topTicker, "AAPL", "the raw #1 (CRWD) is exiting — the named leader must skip it");
  assert.equal(snap!.topScore, 84.4);
  assert.equal(snap!.rank, 3, "rank still reflects the FULL peer set, exit state doesn't change standing");
  assert.equal(snap!.total, 3);
});

test("computeLaneRank: named leader falls back to the raw #1 when every peer is exiting", () => {
  const lanes = [
    row("CRWD", 86.5, "COMMIT", undefined, "EXIT_RUNNER"),
    row("NRG", 27.2, "COMMIT", undefined, "EXIT"),
  ];
  const snap = computeLaneRank(play({ ticker: "NRG", score: 27.2 }), lanes);
  assert.ok(snap);
  assert.equal(snap!.topTicker, "CRWD", "no non-exiting peer exists — fall back rather than show nothing");
});

test("computeLaneRank: WATCH-bucket rows never carry manageAction — leader pick unaffected", () => {
  const lanes = [row("NRG", 70, "WATCH"), row("FSLR", 40, "WATCH")];
  const snap = computeLaneRank(play({ ticker: "FSLR", score: 40, status: "WATCH" }), lanes);
  assert.ok(snap);
  assert.equal(snap!.topTicker, "NRG");
});

test("computeLaneRank: named leader skips a WATCH peer whose own setupState is INVALIDATED", () => {
  // Live repro 2026-09-12: SKHY sat #1 of 8 on WATCH by raw score (59) while its own Entry section
  // already read "Serving section: RESEARCH" / "Setup: INVALIDATED" (thesis broke pre-entry). A
  // different WATCH ticker's brief naming SKHY as "Desk leader: SKHY @ 59" would read as "look at
  // this one" about a setup the desk has already downgraded out of WATCH.
  const lanes = [
    row("SKHY", 59, "WATCH", undefined, undefined, "INVALIDATED"),
    row("COIN", 55.4, "WATCH", undefined, undefined, "TRIGGERED"),
    row("GOOGL", 51, "WATCH", undefined, undefined, "TRIGGERED"),
  ];
  const snap = computeLaneRank(play({ ticker: "GOOGL", score: 51, status: "WATCH" }), lanes);
  assert.ok(snap);
  assert.equal(snap!.topTicker, "COIN", "the raw #1 (SKHY) is invalidated — the named leader must skip it");
  assert.equal(snap!.topScore, 55.4);
  assert.equal(snap!.rank, 3, "rank still reflects the FULL peer set (raw score order) — invalidation doesn't change standing");
});

test("computeLaneRank: selfInvalidated is true only when THIS play's own setupState is INVALIDATED", () => {
  const lanes = [row("SKHY", 59, "WATCH"), row("COIN", 55.4, "WATCH")];
  const invalidated = computeLaneRank(play({ ticker: "SKHY", score: 59, status: "WATCH", setupState: "INVALIDATED" }), lanes);
  assert.ok(invalidated);
  assert.equal(invalidated!.selfInvalidated, true);

  const healthy = computeLaneRank(play({ ticker: "COIN", score: 55.4, status: "WATCH", setupState: "TRIGGERED" }), lanes);
  assert.ok(healthy);
  assert.equal(healthy!.selfInvalidated, false);
});

test("laneRankSection: suppresses the rank-1 praise line when the play's own thesis is invalidated", () => {
  // Same live repro as above — the rank-1 self-claim ("Top-ranked play... size and attention follow
  // score") must not render when this exact response's Entry section already says the thesis broke.
  const lanes = [row("SKHY", 59, "WATCH"), row("COIN", 55.4, "WATCH")];
  const sec = laneRankSection(play({ ticker: "SKHY", score: 59, status: "WATCH", setupState: "INVALIDATED" }), lanes);
  assert.ok(sec);
  assert.match(sec!.body, /#1 of 2/, "rank stats stay honest regardless of invalidation");
  assert.doesNotMatch(sec!.body, /Top-ranked play in this bucket/);
});

test("computeLaneRank: selfReducing is true only when THIS play's own manageAction calls for reducing", () => {
  const lanes = [row("AAPL", 84.4, "COMMIT"), row("NN", 23, "COMMIT"), row("CG", 3, "COMMIT")];
  const reducing = computeLaneRank(play({ ticker: "CG", score: 3, status: "HOLD", manageAction: "TAKE_PARTIAL" }), lanes);
  assert.ok(reducing);
  assert.equal(reducing!.selfReducing, true);

  const holding = computeLaneRank(play({ ticker: "AAPL", score: 84.4, status: "HOLD", manageAction: "HOLD" }), lanes);
  assert.ok(holding);
  assert.equal(holding!.selfReducing, false);
});

test("laneRankSection: below-median wording drops 'adding size' when the play's own plan is to reduce", () => {
  // Live repro 2026-09-12: CG sat #90/90 by raw entry-time score (3) — a real +169.2%/+134.6% exec
  // winner already on TRIM (manageAction TAKE_PARTIAL) — and this exact line said "confirm before
  // adding size" right after the brief's own "Desk says TRIM ... Bank partial into strength."
  const lanes = [row("AAPL", 84.4, "COMMIT"), row("NN", 23, "COMMIT"), row("CG", 3, "COMMIT")];
  const sec = laneRankSection(
    play({ ticker: "CG", score: 3, status: "HOLD", manageAction: "TAKE_PARTIAL" }),
    lanes,
  );
  assert.ok(sec);
  assert.doesNotMatch(sec!.body, /confirm before adding size/, "backwards advice on a position already being trimmed");
  assert.match(sec!.body, /reducing, not adding/);
});

test("laneRankSection: below-median wording keeps 'confirm before adding size' for a play that's just HOLDing", () => {
  const lanes = [row("AAPL", 84.4, "COMMIT"), row("CG", 23, "COMMIT"), row("NN", 3, "COMMIT")];
  const sec = laneRankSection(play({ ticker: "NN", score: 3, status: "HOLD", manageAction: "HOLD" }), lanes);
  assert.ok(sec);
  assert.match(sec!.body, /confirm thesis before adding size/, "a plain HOLD is still a legitimate add-size caution");
});

test("computeLaneRank: deltaFromMedian is rounded, not a raw float subtraction artifact", () => {
  const snap = computeLaneRank(play({ ticker: "AMZN", score: 57.2, status: "WATCH" }), [
    row("AMZN", 57.2, "WATCH"),
    row("FSLR", 45.4, "WATCH"),
  ]);
  assert.ok(snap);
  // Live repro (AMZN brief, 2026-09-09): 57.2 - 45.4 === 11.800000000000004 in raw IEEE754 math.
  assert.equal(snap!.deltaFromMedian, 11.8, "must round to 1dp, not leak 11.800000000000004 into the narrative");
});
