import test from "node:test";
import assert from "node:assert/strict";
import {
  tapeFreshness,
  tapeDirection,
  helixTickerIdentity,
  unavailable,
  HELIX_TAPE_PROVENANCE,
  TAPE_STALE_AFTER_SECONDS,
  TAPE_LIVE_WITHIN_SECONDS,
} from "./helix-contract";

// ── C2 freshness ─────────────────────────────────────────────────────────────

test("freshness uses the DESK's own stale threshold, not a new one", () => {
  // FlowFeed.tsx flips STALE at dataAgeMs > 5 * 60_000. Largo must never call a tape fresh
  // while the member's screen calls it stale.
  assert.equal(TAPE_STALE_AFTER_SECONDS, 300);
  assert.equal(TAPE_LIVE_WITHIN_SECONDS, 60);
  assert.equal(tapeFreshness(4).freshness, "delayed");   // 240s — under the flip
  assert.equal(tapeFreshness(5).freshness, "stale");     // 300s — at the flip
  assert.equal(tapeFreshness(0.5).freshness, "live");    // 30s
});

test("age is reported in seconds alongside the label", () => {
  assert.deepEqual(tapeFreshness(5), { freshness: "stale", age_seconds: 300 });
  assert.deepEqual(tapeFreshness(309), { freshness: "stale", age_seconds: 18540 });
});

test("an unmeasurable age reports null freshness, not 'stale'", () => {
  // Most of this tape is ingest-stamped (438/500 live), so a window can hold 500 prints and
  // still have no measurable age. "stale" would be as unfounded as "live".
  for (const v of [null, undefined, Number.NaN]) {
    assert.deepEqual(tapeFreshness(v as number | null), { freshness: null, age_seconds: null });
  }
});

// ── C5 direction ─────────────────────────────────────────────────────────────

test("direction uses the panel's own 55/45 cut", () => {
  assert.equal(tapeDirection(55), "bullish");
  assert.equal(tapeDirection(60), "bullish");
  assert.equal(tapeDirection(54), "neutral");
  assert.equal(tapeDirection(46), "neutral");
  assert.equal(tapeDirection(45), "bearish");
  assert.equal(tapeDirection(2), "bearish");
});

test("an unmeasurable skew yields null — NEVER 'neutral'", () => {
  // Neutral is a measurement: it says the tape was read and came back balanced. Collapsing
  // absence into it re-introduces the call_pct:50 defect this lane removed.
  assert.equal(tapeDirection(null), null);
  assert.equal(tapeDirection(undefined), null);
  assert.equal(tapeDirection(Number.NaN), null);
  assert.notEqual(tapeDirection(null), "neutral");
});

// ── C4 identity ──────────────────────────────────────────────────────────────

test("SPXW keeps its own ticker AND gains a canonical root — it is not rewritten", () => {
  // SPX 350 prints and SPXW 9 prints traded in the same live window; they settle differently.
  const i = helixTickerIdentity("SPXW");
  assert.equal(i.ticker, "SPXW", "the tape's own ticker survives");
  assert.equal(i.canonical_root, "SPX");
  assert.equal(i.weekly_variant, true);
  assert.equal(i.ticker_class, "index");
});

test("index / etf / equity are distinguished", () => {
  assert.equal(helixTickerIdentity("SPX").ticker_class, "index");
  assert.equal(helixTickerIdentity("VIX").ticker_class, "index");
  assert.equal(helixTickerIdentity("SPY").ticker_class, "etf");
  assert.equal(helixTickerIdentity("QQQ").ticker_class, "etf");
  assert.equal(helixTickerIdentity("NVDA").ticker_class, "equity");
});

test("lowercase and $-prefixed input still classify", () => {
  assert.equal(helixTickerIdentity("spy").ticker, "SPY");
  assert.equal(helixTickerIdentity("spy").ticker_class, "etf");
});

test("an unparseable ticker classifies as null rather than guessing 'equity'", () => {
  const i = helixTickerIdentity("what is the tape doing");
  assert.equal(i.ticker_class, null);
  assert.equal(i.canonical_root, null);
});

test("a market-wide read has no ticker and claims no class", () => {
  assert.deepEqual(helixTickerIdentity(null), {
    ticker: null, ticker_class: null, canonical_root: null, weekly_variant: false,
  });
});

// ── C3 absence / C8 provenance ───────────────────────────────────────────────

test("unavailable carries a reason, what is missing, and whether retrying helps", () => {
  const u = unavailable("database_unavailable", "HELIX signal-outcome ledger", false);
  assert.equal(u.available, false);
  assert.equal(u.unavailable.reason, "database_unavailable");
  assert.equal(u.unavailable.what_is_missing, "HELIX signal-outcome ledger");
  assert.equal(u.unavailable.retryable, false);
});

test("unavailable is a DIFFERENT shape from a measured-empty read", () => {
  // The quiet-tape payload is `available: true` + empty_reason. If these ever collapse into one
  // shape, a working tool reads as broken every off-hours evening.
  const u = unavailable("x", "y", true) as Record<string, unknown>;
  assert.equal(u.available, false);
  assert.equal(u.empty_reason, undefined);
});

test("provenance names the real source", () => {
  assert.equal(HELIX_TAPE_PROVENANCE.source, "internal_db");
  assert.ok(HELIX_TAPE_PROVENANCE.computed_by);
});
