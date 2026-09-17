import { test } from "node:test";
import assert from "node:assert/strict";

import {
  directionFromCallPct,
  helixContribution,
  meridianContribution,
  nighthawkContribution,
  spxContribution,
  thermalContribution,
  vectorContribution,
} from "./product-adapters";
import { coverage, joinProductSignals } from "./cross-product";

test("the call-share deadband prevents manufactured disagreement around 50%", () => {
  // Without a band, two products straddling 50% read as a genuine split while measuring the same
  // balanced tape. 51% is not a bullish tape.
  assert.equal(directionFromCallPct(51), "neutral");
  assert.equal(directionFromCallPct(49), "neutral");
  assert.equal(directionFromCallPct(55), "bullish");
  assert.equal(directionFromCallPct(45), "bearish");
  assert.equal(directionFromCallPct(null), null);
});

test("helix derives direction from session skew and carries its evidence", () => {
  const c = helixContribution({ ticker: "SPX", session: { call_pct: 72, alert_count: 140 } });
  assert.equal(c.signal?.direction, "bullish");
  assert.ok(c.signal?.evidence.includes("session call share 72%"));
  assert.ok(c.signal?.evidence.includes("140 prints"));
});

test("helix prefers the authoritative session.direction over re-deriving one from call_pct", () => {
  // Regression: this adapter used to ignore `session.direction` entirely and always re-derive a
  // direction from `call_pct` alone -- the real CG case, 100% call premium but every call SOLD
  // (aggression-aware verdict: bearish), used to come back "bullish" here.
  const c = helixContribution({
    ticker: "CG",
    session: { call_pct: 100, alert_count: 12, direction: "bearish" },
  });
  assert.equal(c.signal?.direction, "bearish");
});

test("helix maps a 'mixed' session.direction to neutral, not a guessed vote", () => {
  const c = helixContribution({
    ticker: "SPX",
    session: { call_pct: 52, alert_count: 40, direction: "mixed" },
  });
  assert.equal(c.signal?.direction, "neutral");
});

test("helix reports 'undetermined' session.direction as no measurable direction, never a call_pct fallback", () => {
  // Even though call_pct alone would read bullish here (72%), the authoritative aggressor-aware
  // read says there isn't enough readable evidence -- that must not be second-guessed.
  const c = helixContribution({
    ticker: "SPX",
    session: { call_pct: 72, alert_count: 3, direction: "undetermined" },
  });
  assert.equal(c.signal, null);
  assert.match(String(c.missingReason), /no measurable call\/put skew/);
});

test("helix falls back to call_pct only when the payload carries no direction field at all", () => {
  const c = helixContribution({ ticker: "SPX", session: { call_pct: 72, alert_count: 140 } });
  assert.equal(c.signal?.direction, "bullish");
});

test("an empty helix tape is an explained absence, not a neutral vote", () => {
  const c = helixContribution({ ticker: "SPX", empty_reason: "no_prints_in_window" });
  assert.equal(c.signal, null);
  assert.match(String(c.missingReason), /no_prints_in_window/);
});

test("THERMAL never casts a directional vote — dealer gamma has no direction", () => {
  // The live P0 (#2422): a regex over regime prose matched "support" and reported bullish on a
  // short-gamma book, 3 of 3 tickers inverted. Gamma is not on a directional axis at all.
  const c = thermalContribution({ thermal: { gamma_posture: "short", volatility_regime: "amplifying" } });
  assert.equal(c.signal, null, "thermal must not vote on direction");
  assert.match(String(c.missingReason), /not a directional measurement/);
  // Its real axis still travels, so the model can use it.
  assert.match(String(c.missingReason), /short/);
  assert.match(String(c.missingReason), /amplifying/);
});

test("VECTOR's no-baseline case is named, not reported as quiet", () => {
  const c = vectorContribution({ ticker: "SPX", has_baseline: false, signals: [] });
  assert.equal(c.signal, null);
  assert.match(String(c.missingReason), /no baseline yet/);
  // And the genuinely-quiet case is a DIFFERENT reason.
  const quiet = vectorContribution({ ticker: "SPX", has_baseline: true, signals: [] });
  assert.match(String(quiet.missingReason), /no pulse signals fired/);
  assert.notEqual(c.missingReason, quiet.missingReason);
});

test("vector derives direction from pulse tone", () => {
  const c = vectorContribution({
    ticker: "I:SPX",
    has_baseline: true,
    signals: [
      { tone: "bearish", line: "gamma flipped short at 7650" },
      { tone: "bearish", line: "magnet moved down to 7620" },
      { tone: "bullish", line: "put wall thickened" },
    ],
  });
  assert.equal(c.signal?.direction, "bearish");
  assert.equal(c.signal?.ticker, "SPX", "I:SPX must fold to the canonical root");
});

test("meridian sizes risk but does not point a direction — an expected move is symmetric", () => {
  const c = meridianContribution({ events: [{ expected_move_pct: 6.4 }] });
  assert.equal(c.signal, null);
  assert.match(String(c.missingReason), /symmetric expected move of 6.4%/);
  const none = meridianContribution({ events: [] });
  assert.match(String(none.missingReason), /no earnings or catalyst event/);
});

test("night hawk votes from what the desk actually committed ON THE QUERIED TICKER", () => {
  const c = nighthawkContribution(
    {
      plays: [
        { ticker: "SPX", option_type: "PUT" },
        { ticker: "NVDA", option_type: "PUT" },
        { ticker: "QQQ", option_type: "CALL" },
      ],
    },
    "SPX"
  );
  assert.equal(c.signal?.direction, "bearish");
  assert.equal(c.signal?.ticker, "SPX");
  const empty = nighthawkContribution({ plays: [] }, "SPX");
  assert.match(String(empty.missingReason), /no committed 0DTE play on SPX/);
});

test("night hawk IDENTITY (regression): a whole-board vote must never be borrowed for an unrelated ticker", () => {
  // get_zerodte_plays returns the WHOLE multi-ticker board (no ticker filter at the tool layer —
  // cross-product-read.ts's `input: () => ({})`). Before this fix, nighthawkContribution ignored
  // the queried ticker entirely and voted off EVERY play on the board — asking about a ticker with
  // no 0DTE play today (TSLA) still returned a confident direction sourced from unrelated names
  // (here: 2 puts on SPX/NVDA vs 1 call on QQQ -> "bearish"), and the signal's own `ticker` field
  // read `p.ticker`, which the real board payload never carries, so it silently defaulted to "".
  const board = {
    plays: [
      { ticker: "SPX", option_type: "PUT" },
      { ticker: "NVDA", option_type: "PUT" },
      { ticker: "QQQ", option_type: "CALL" },
    ],
  };
  const tsla = nighthawkContribution(board, "TSLA");
  assert.equal(tsla.signal, null, "no committed play on TSLA -- must be an honest absence, never a borrowed board vote");
  assert.match(String(tsla.missingReason), /no committed 0DTE play on TSLA/);

  // A ticker that DOES have a play on the board must vote off ONLY its own row(s), not the board.
  const nvda = nighthawkContribution(
    {
      plays: [
        { ticker: "NVDA", option_type: "CALL" },
        { ticker: "SPX", option_type: "PUT" },
        { ticker: "SPX", option_type: "PUT" },
      ],
    },
    "NVDA"
  );
  assert.equal(nvda.signal?.direction, "bullish", "NVDA's own play is a call; the two unrelated SPX puts must not flip it bearish");
  assert.equal(nvda.signal?.ticker, "NVDA");
  assert.equal(nvda.signal?.native && (nvda.signal.native as { play_count?: number }).play_count, 1);
});

test("night hawk NEUTRAL-STRUCTURE (regression): a committed condor must never cast a directional vote", () => {
  // condor.ts's own buildCondorSetup comment: a condor row's `direction` field "carries the pin's
  // nominal fade side for provenance but is UNUSED by the neutral structure's gates/grader". Before
  // this fix, nighthawkContribution fell through to that same field (option_type ?? side ??
  // direction) for every play, so a condor with no option_type/side counted its nominal fade side
  // as a real call/put vote -- a delta-neutral SOLD structure with no directional thesis reporting
  // a confident bullish/bearish signal.
  const onlyCondor = nighthawkContribution(
    { plays: [{ ticker: "SPX", is_condor: true, play_type: "CONDOR", direction: "short" }] },
    "SPX"
  );
  assert.equal(onlyCondor.signal, null, "a lone condor must be an honest non-directional absence, never a vote");
  assert.match(String(onlyCondor.missingReason), /delta-neutral sold structure with no directional thesis/);
  assert.match(String(onlyCondor.missingReason), /1 committed 0DTE iron condor on SPX/);

  // A raw payload shape carrying only `play_type: "CONDOR"` (no `is_condor` flag) must be caught
  // the same way -- the two are alternate identifications of the same structural fact.
  const rawPlayType = nighthawkContribution(
    { plays: [{ ticker: "SPX", play_type: "CONDOR", direction: "long" }] },
    "SPX"
  );
  assert.equal(rawPlayType.signal, null);
  assert.match(String(rawPlayType.missingReason), /delta-neutral sold structure/);

  // A REAL directional play on the same ticker must still vote, and the condor must be excluded
  // from the tally (not flip a 1-call/1-nominal-condor tie into a false split) while still being
  // named in the evidence as context.
  const mixed = nighthawkContribution(
    {
      plays: [
        { ticker: "SPX", option_type: "CALL" },
        { ticker: "SPX", is_condor: true, play_type: "CONDOR", direction: "short" },
      ],
    },
    "SPX"
  );
  assert.equal(mixed.signal?.direction, "bullish", "the one real directional call must win the vote unopposed by the condor's nominal fade");
  assert.equal(
    (mixed.signal?.native as { play_count?: number; condor_count?: number } | undefined)?.play_count,
    1,
    "play_count must reflect only the directional plays actually voted on"
  );
  assert.equal(
    (mixed.signal?.native as { condor_count?: number } | undefined)?.condor_count,
    1
  );
  assert.ok(
    mixed.signal?.evidence.some((e) => /condor/i.test(e)),
    "the excluded condor should still surface as evidence/context, not vanish silently"
  );
});

test("spx votes from the play-engine direction on SPX/SPXW only", () => {
  const bullish = spxContribution({ available: true, direction: "long", grade: "A", phase: "OPEN", action: "HOLD" });
  assert.equal(bullish.signal?.direction, "bullish");
  assert.equal(bullish.signal?.ticker_class, "index");

  const scanning = spxContribution({ available: true, phase: "SCANNING", action: "SCANNING", direction: null });
  assert.equal(scanning.signal, null);
  assert.match(String(scanning.missingReason), /no committed direction/);

  const offScope = spxContribution({ available: true, direction: "long" }, "NVDA");
  assert.equal(offScope.signal, null);
  assert.match(String(offScope.missingReason), /only tracks SPX\/SPXW/);
});

test("every adapter survives a garbage payload rather than taking the read down", () => {
  // Five agents are rewriting these payloads concurrently. An adapter that throws would fail the
  // whole cross-product read instead of degrading one product.
  for (const fn of [helixContribution, thermalContribution, vectorContribution, meridianContribution, nighthawkContribution, spxContribution]) {
    for (const junk of [null, undefined, 42, "nope", [], { unexpected: true }]) {
      const c = fn(junk);
      assert.equal(c.signal, null);
      assert.ok(String(c.missingReason).length > 0, "an absence must always state a reason");
    }
  }
});

test("ticker_class is derived from the actual ticker, not a hardcoded per-product guess", () => {
  // Regression: helix hardcoded "equity", vector/nighthawk hardcoded "index" — correct only by
  // coincidence for SPX-only fixtures. Assert the real classification for tickers where the old
  // constants were wrong in each direction.
  const helixEquity = helixContribution({ ticker: "TSLA", session: { call_pct: 72, alert_count: 10 } });
  assert.equal(helixEquity.signal?.ticker_class, "equity");

  const helixIndex = helixContribution({ ticker: "SPX", session: { call_pct: 72, alert_count: 10 } });
  assert.equal(helixIndex.signal?.ticker_class, "index", "helix hardcoded equity — must read index for SPX");

  const vectorEquity = vectorContribution({
    ticker: "TSLA",
    has_baseline: true,
    signals: [{ tone: "bullish", line: "x" }],
  });
  assert.equal(
    vectorEquity.signal?.ticker_class,
    "equity",
    "vector hardcoded index — must read equity for TSLA"
  );

  const nighthawkEquity = nighthawkContribution(
    { plays: [{ ticker: "TSLA", option_type: "CALL" }] },
    "TSLA"
  );
  assert.equal(
    nighthawkEquity.signal?.ticker_class,
    "equity",
    "nighthawk hardcoded index — must read equity for TSLA"
  );

  const spy = vectorContribution({
    ticker: "SPY",
    has_baseline: true,
    signals: [{ tone: "bullish", line: "x" }],
  });
  assert.equal(spy.signal?.ticker_class, "etf");
});

test("END TO END — a real split, with honest coverage", () => {
  // The shape tonight actually produces: helix and night hawk vote, thermal abstains by design,
  // vector has no baseline, meridian has no event.
  const read = joinProductSignals("SPX", [
    helixContribution({ ticker: "SPX", session: { call_pct: 71, alert_count: 140 } }),
    nighthawkContribution({ plays: [{ ticker: "SPX", option_type: "PUT" }] }, "SPX"),
    thermalContribution({ thermal: { gamma_posture: "short", volatility_regime: "amplifying" } }),
    vectorContribution({ ticker: "SPX", has_baseline: false, signals: [] }),
    meridianContribution({ events: [] }),
  ]);

  assert.equal(read.verdict, "split");
  assert.equal(read.direction, null, "a split must not resolve to a direction");
  assert.deepEqual(read.reporting.sort(), ["helix", "nighthawk"]);
  assert.equal(coverage(read).label, "2/5 products reporting");
  // Each of the three absences says something DIFFERENT — no generic "unavailable".
  const reasons = read.missing.map((m) => m.reason);
  assert.equal(new Set(reasons).size, 3);
  assert.match(String(read.disagreement), /genuine disagreement/);
});
