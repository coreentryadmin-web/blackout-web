import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyPublicReadFreshnessGate,
  classifyWall,
  correctPublicRead,
  isPublicGexTicker,
  publicFreshnessCopy,
  publicGexTickers,
  publicSnapshotSessionFacts,
  sanitizePublicRead,
  shouldAlarmPublicGexWarming,
} from "./public-gex-snapshot-types.ts";

test("isPublicGexTicker accepts only the 3-ticker allowlist", () => {
  assert.equal(isPublicGexTicker("SPX"), true);
  assert.equal(isPublicGexTicker("SPY"), true);
  assert.equal(isPublicGexTicker("QQQ"), true);
});

test("isPublicGexTicker rejects anything outside the allowlist", () => {
  // Guards the public route's abuse surface — an arbitrary ticker must never
  // reach fetchGexHeatmap() from an unauthenticated caller.
  assert.equal(isPublicGexTicker("NVDA"), false);
  assert.equal(isPublicGexTicker(""), false);
  assert.equal(isPublicGexTicker("spx"), false, "case-sensitive — route uppercases before checking");
});

test("publicGexTickers matches the allowlist isPublicGexTicker checks against", () => {
  const list = publicGexTickers();
  assert.deepEqual([...list], ["SPX", "SPY", "QQQ"]);
  for (const t of list) assert.equal(isPublicGexTicker(t), true);
});

test("public read never discloses the data vendors or a provider outage", () => {
  // The UW-fallback producer in polygon-options-gex.ts appends this verbatim. On the members-only
  // desk it is useful honesty; on an unauthenticated endpoint it tells any anonymous poller which
  // vendors we buy AND signals in real time that our primary chain provider is down.
  const leaked =
    "Spot 7,757.64 is above the gamma flip (7,743.88) → long gamma: range-bound, fade extremes." +
    " (UW all-expiry dealer gamma — Polygon chain unavailable; levels are live UW OI, not the" +
    " canonical near-term Polygon matrix.)";
  const out = sanitizePublicRead(leaked);
  for (const vendor of ["UW", "Unusual Whales", "Polygon", "Massive", "unavailable"]) {
    assert.ok(!out.includes(vendor), `"${vendor}" must not survive into the public payload`);
  }
  // The trader-facing content — and the numbers already present as their own fields — survive.
  assert.ok(out.includes("gamma flip (7,743.88)"));
  assert.ok(out.includes("range-bound, fade extremes"));
});

test("the ordinary (non-fallback) read passes through untouched", () => {
  const normal = "Spot 592.20 is below the gamma flip (593.76) → short gamma: momentum / vol expansion, moves accelerate. Resistance 595, support 590.";
  assert.equal(sanitizePublicRead(normal), normal);
});

test("a future producer adding a new provider parenthetical is stripped too", () => {
  // Deliberately generic so this does not have to be revisited each time a vendor note is added.
  assert.equal(
    sanitizePublicRead("Regime is undecided. (Massive feed degraded — falling back.)"),
    "Regime is undecided."
  );
});

// ── wall role + read correction (the "support 250 points overhead" defect) ──────────────
// Live prod 2026-08-12, /api/public/gex-snapshot?ticker=SPX served:
//   spot 7748.5, call_wall 7800, put_wall 8000, read "... Resistance 7,800, support 8,000."
// The put wall is ABOVE spot, so "support" was a claim the page could not make.

test("classifyWall: a put wall above spot is a concentration, not support", () => {
  assert.equal(classifyWall("put", 8000, 7748.5), "concentration");
  assert.equal(classifyWall("put", 7400, 7748.5), "support");
});

test("classifyWall: applied symmetrically to the call side", () => {
  assert.equal(classifyWall("call", 7600, 7748.5), "concentration");
  assert.equal(classifyWall("call", 7800, 7748.5), "resistance");
});

test("classifyWall: degrades to no claim rather than guessing a side", () => {
  assert.equal(classifyWall("put", null, 7748.5), null);
  assert.equal(classifyWall("put", 8000, null), null);
  assert.equal(classifyWall("put", 8000, 0), null);
  assert.equal(classifyWall("put", Number.NaN, 7748.5), null);
});

test("correctPublicRead: drops the wrong-side support claim, keeps the true resistance", () => {
  const read =
    "Spot 7,748.5 is below the gamma flip (7,774.17) → short gamma: momentum / vol expansion, moves accelerate. Resistance 7,800, support 8,000.";
  const out = correctPublicRead(read, { spot: 7748.5, call_wall: 7800, put_wall: 8000 });
  assert.ok(!/support/i.test(out), `still claims support: ${out}`);
  assert.ok(out.includes("Resistance 7,800"), out);
  // The explanation before the clause is true and must survive untouched.
  assert.ok(out.includes("short gamma: momentum / vol expansion"), out);
});

test("correctPublicRead: leaves a fully coherent read alone", () => {
  const read = "Spot 772.49 is below the gamma flip (779.42) → short gamma. Resistance 775, support 770.";
  assert.equal(correctPublicRead(read, { spot: 772.49, call_wall: 775, put_wall: 770 }), read);
});

test("correctPublicRead: both walls wrong-side says so instead of leaving a bare sentence", () => {
  const read = "Spot 100 is above the gamma flip (95) → long gamma. Resistance 90, support 110.";
  const out = correctPublicRead(read, { spot: 100, call_wall: 90, put_wall: 110 });
  assert.ok(/neither is acting as a level/.test(out), out);
  assert.ok(!/Resistance 90/.test(out) && !/support 110/.test(out), out);
});

// Regression: the producer (gex-cross-validation-core.ts) emits "Resistance X" only when
// callWall != null and "support Y" only when putWall != null — EITHER half can be missing on its
// own (a one-sided book), leaving a bare single-wall clause ("Resistance X." or "support Y." with
// no comma, no sibling word). The original `clause` regex only matched the two-wall
// "Resistance X, support Y." form, so a wrong-side wall asserted ALONE passed straight through
// uncorrected — the exact defect this function exists to prevent.
test("correctPublicRead: a wrong-side wall asserted ALONE (no sibling wall in the clause) is still corrected", () => {
  const read =
    "Spot 7,748.5 is below the gamma flip (7,800) → short gamma: momentum / vol expansion, moves accelerate. Resistance 7,490.";
  assert.equal(classifyWall("call", 7490, 7748.5), "concentration", "precondition: the call wall sits BELOW spot");
  const out = correctPublicRead(read, { spot: 7748.5, call_wall: 7490, put_wall: null });
  assert.ok(!/Resistance 7,490/.test(out), `still asserts the wrong-side wall as resistance: ${out}`);
  // Only one wall was ever in the clause — the "Both gamma walls..." wording would be false here.
  assert.ok(!/Both gamma walls/i.test(out), out);
  assert.ok(out.includes("short gamma: momentum / vol expansion"), out);
});

test("correctPublicRead: a correctly-sided wall asserted alone (no sibling wall) survives unchanged", () => {
  const read = "Spot 7,748.5 is above the gamma flip (7,600) → long gamma: range-bound, fade extremes. Resistance 7,800.";
  assert.equal(classifyWall("call", 7800, 7748.5), "resistance", "precondition: the call wall sits ABOVE spot");
  assert.equal(correctPublicRead(read, { spot: 7748.5, call_wall: 7800, put_wall: null }), read);
});

test("correctPublicRead: a wrong-side support-only clause (no resistance half) is still corrected", () => {
  const read = "Spot 7,748.5 is below the gamma flip (7,800) → short gamma. support 8,000.";
  assert.equal(classifyWall("put", 8000, 7748.5), "concentration", "precondition: the put wall sits ABOVE spot");
  const out = correctPublicRead(read, { spot: 7748.5, call_wall: null, put_wall: 8000 });
  assert.ok(!/support 8,000/.test(out), `still asserts the wrong-side wall as support: ${out}`);
  assert.ok(!/Both gamma walls/i.test(out), out);
});

// Regression for a P1 finding (2026-09-02): the short/long-gamma regime read carries an
// ACTIONABLE momentum claim ("moves accelerate" / "fade extremes") with no gate on whether the
// underlying quote is actually live. `publicFreshnessCopy` already knows market_session outside
// RTH is not live and shows a `priceNote` warning, but nothing stopped the SAME snapshot from also
// publishing a fresh-sounding directional read next to it — a fresh recompute timestamp making a
// stale input look actionable.
test("applyPublicReadFreshnessGate: OPEN market passes the actionable read through unchanged", () => {
  const read = "Spot 7,671.33 is below the gamma flip (7,800.2) → short gamma: momentum / vol expansion, moves accelerate. Resistance 7,675, support 7,500.";
  assert.equal(applyPublicReadFreshnessGate(read, "OPEN"), read);
});

test("applyPublicReadFreshnessGate: pre-market suppresses the actionable short-gamma claim", () => {
  const read = "Spot 7,631.47 is below the gamma flip (7,800.2) → short gamma: momentum / vol expansion, moves accelerate. Resistance 7,675, support 7,500.";
  const out = applyPublicReadFreshnessGate(read, "PRE-MARKET");
  assert.ok(/^Prior-session structural reference/.test(out), out);
  assert.ok(!/moves accelerate/i.test(out), `still claims live momentum: ${out}`);
});

test("applyPublicReadFreshnessGate: after-hours suppresses the actionable long-gamma claim too", () => {
  const read = "Spot 7,900 is above the gamma flip (7,800.2) → long gamma: range-bound, fade extremes. Resistance 7,950, support 7,850.";
  const out = applyPublicReadFreshnessGate(read, "AFTER-HOURS");
  assert.ok(/^Prior-session structural reference/.test(out), out);
  assert.ok(!/fade extremes/i.test(out), `still claims live range-bound behavior: ${out}`);
});

test("applyPublicReadFreshnessGate: closed market also gates, and the net-short-everywhere read is covered", () => {
  const read =
    "No gamma flip — dealers are net short gamma at EVERY strike, so there is no long-gamma " +
    "region above spot 7,631.47 → short gamma: momentum / vol expansion, moves accelerate.";
  const out = applyPublicReadFreshnessGate(read, "CLOSED");
  assert.ok(/^Prior-session structural reference/.test(out), out);
  assert.ok(!/moves accelerate/i.test(out), `still claims live momentum: ${out}`);
});

test("applyPublicReadFreshnessGate: an unknown session is gated too — absence is not a green light", () => {
  const read = "Spot 100 is below the gamma flip (110) → short gamma: momentum / vol expansion, moves accelerate.";
  const out = applyPublicReadFreshnessGate(read, null);
  assert.ok(/^Prior-session structural reference/.test(out), out);
});

// Regression: a last-good snapshot's `read` can be re-gated against a DIFFERENT market session
// than the one it was originally gated/built for (see degradedFromLastGood in
// public-gex-snapshot.ts, which re-applies this gate to a snapshot served from the 24h last-good
// cache). The gate must therefore be idempotent/reversible — applying it twice for the same
// session is a no-op, and re-applying it for a different session correctly transitions, rather
// than stacking a second "Prior-session structural reference —" prefix or leaving stale wording.
test("applyPublicReadFreshnessGate: re-gating an already-gated read for the same session is a no-op", () => {
  const read = "Spot 7,631.47 is below the gamma flip (7,800.2) → short gamma: momentum / vol expansion, moves accelerate. Resistance 7,675, support 7,500.";
  const gatedOnce = applyPublicReadFreshnessGate(read, "CLOSED");
  const gatedTwice = applyPublicReadFreshnessGate(gatedOnce, "CLOSED");
  assert.equal(gatedTwice, gatedOnce, "re-gating for the same session must not stack another prefix");
  assert.equal(
    gatedOnce.match(/Prior-session structural reference/g)?.length,
    1,
    `prefix must appear exactly once: ${gatedOnce}`
  );
});

test("applyPublicReadFreshnessGate: re-gating for a DIFFERENT session transitions cleanly, not additively", () => {
  const read = "Spot 7,631.47 is below the gamma flip (7,800.2) → short gamma: momentum / vol expansion, moves accelerate. Resistance 7,675, support 7,500.";
  const gatedClosed = applyPublicReadFreshnessGate(read, "CLOSED");
  assert.match(gatedClosed, /^Prior-session structural reference/, gatedClosed);
  assert.ok(!/moves accelerate/i.test(gatedClosed), gatedClosed);

  // Market reopens — re-gating the already-closed-gated text for OPEN must restore the live,
  // ungated, actionable claim exactly, not leave stale "structurally" wording or a stray prefix.
  const reGatedOpen = applyPublicReadFreshnessGate(gatedClosed, "OPEN");
  assert.equal(reGatedOpen, read, `OPEN must fully restore the original live read: ${reGatedOpen}`);

  // And the long-gamma clause transitions the same way.
  const longRead = "Spot 7,900 is above the gamma flip (7,800.2) → long gamma: range-bound, fade extremes. Resistance 7,950, support 7,850.";
  const longGatedClosed = applyPublicReadFreshnessGate(longRead, "CLOSED");
  const longReGatedOpen = applyPublicReadFreshnessGate(longGatedClosed, "OPEN");
  assert.equal(longReGatedOpen, longRead, longReGatedOpen);
});

test("correctPublicRead: unmatched wording passes through — can only remove a false claim", () => {
  const read = "Spot 100 is above the gamma flip (95) → long gamma.";
  assert.equal(correctPublicRead(read, { spot: 100, call_wall: 90, put_wall: 110 }), read);
});


// ── Session + freshness disclosure (the public page's "Updated just now" defect) ──────────────
//
// MEASURED ON PRODUCTION 2026-08-22 23:15Z (Saturday, 19:15 ET): the public snapshot served SPX
// spot 7674.37 and SPY 765.72 — Polygon's 2026-08-21 closes to the cent — with `asof` under 20
// seconds old, rendered as "Updated just now" with no session label anywhere on the page. `asof`
// is the MATRIX COMPUTE time; on a closed market the builder recomputes over an unchanged book, so
// it is honestly fresh while the price it models is stale. These tests pin the two claims apart.

test("a closed market never lets the price read as live, however fresh the levels are", () => {
  const now = Date.parse("2026-08-23T00:00:00Z");
  const copy = publicFreshnessCopy({
    asof: "2026-08-22T23:59:55Z", // 5s old — genuinely "just now"
    market_session: "CLOSED",
    now,
  });
  assert.equal(copy.levels, "Levels computed just now", "the levels ARE that fresh — say so");
  assert.match(copy.priceNote ?? "", /not a live quote/i);
  assert.match(copy.priceNote ?? "", /last session's close/i);
});

test("an OPEN market is the only case with no price caveat", () => {
  const copy = publicFreshnessCopy({
    asof: "2026-08-21T15:00:00Z",
    market_session: "OPEN",
    now: Date.parse("2026-08-21T15:00:05Z"),
  });
  assert.equal(copy.priceNote, null, "during RTH the spot really is a live quote");
  assert.equal(copy.levels, "Levels computed just now");
});

test("pre-market and after-hours each name their own kind of not-live price", () => {
  const at = (session: "PRE-MARKET" | "AFTER-HOURS") =>
    publicFreshnessCopy({ asof: "2026-08-21T12:00:00Z", market_session: session, now: Date.parse("2026-08-21T12:00:00Z") });
  assert.match(at("PRE-MARKET").priceNote ?? "", /pre-market/i);
  assert.match(at("PRE-MARKET").priceNote ?? "", /not a live quote/i);
  assert.match(at("AFTER-HOURS").priceNote ?? "", /after hours/i);
  assert.match(at("AFTER-HOURS").priceNote ?? "", /not a live quote/i);
});

test("an UNKNOWN session is not treated as open — absence is not a green light", () => {
  // The failure mode this guards: a legacy Redis entry written before these fields existed arrives
  // with market_session undefined. Rendering no caveat there would silently restore the defect for
  // the whole cache TTL.
  const copy = publicFreshnessCopy({ asof: "2026-08-22T23:59:55Z", market_session: null, now: Date.parse("2026-08-23T00:00:00Z") });
  assert.notEqual(copy.priceNote, null, "unknown must still carry a caveat");
  assert.match(copy.priceNote ?? "", /unknown/i);
});

test("an unusable or future asof says so instead of inventing an age", () => {
  const now = Date.parse("2026-08-23T00:00:00Z");
  assert.match(publicFreshnessCopy({ asof: null, market_session: "CLOSED", now }).levels, /timing unavailable/i);
  assert.match(publicFreshnessCopy({ asof: "not-a-date", market_session: "CLOSED", now }).levels, /timing unavailable/i);
  // A clock-skewed future stamp must not render as a negative age.
  assert.match(
    publicFreshnessCopy({ asof: "2026-08-23T00:05:00Z", market_session: "CLOSED", now }).levels,
    /timing unavailable/i
  );
});

test("age wording is singular at one minute and plural beyond it", () => {
  const now = Date.parse("2026-08-23T00:10:00Z");
  assert.equal(publicFreshnessCopy({ asof: "2026-08-23T00:09:00Z", market_session: "OPEN", now }).levels, "Levels computed 1 min ago");
  assert.equal(publicFreshnessCopy({ asof: "2026-08-23T00:05:00Z", market_session: "OPEN", now }).levels, "Levels computed 5 min ago");
});

test("session facts are derived in ET, not UTC — the Saturday-evening case that produced the bug", () => {
  // 2026-08-23T00:00:00Z is Saturday 20:00 ET on 2026-08-22. A UTC-derived session date would say
  // 2026-08-23 (a Sunday) — a full session ahead, the #2418/#2420 class.
  const facts = publicSnapshotSessionFacts(new Date("2026-08-23T00:00:00Z"));
  assert.equal(facts.session_date, "2026-08-22", "the ET session date, not the UTC calendar date");
  assert.equal(facts.market_session, "CLOSED", "Saturday is closed regardless of the hour");
  assert.match(facts.as_of_et, /^2026-08-22 20:00 ET$/);
});

test("session facts track the RTH boundaries on a weekday", () => {
  // 13:30Z = 09:30 ET (EDT) — the open is inclusive.
  assert.equal(publicSnapshotSessionFacts(new Date("2026-08-21T13:30:00Z")).market_session, "OPEN");
  // 13:29Z = 09:29 ET — still pre-market.
  assert.equal(publicSnapshotSessionFacts(new Date("2026-08-21T13:29:00Z")).market_session, "PRE-MARKET");
  // 20:00Z = 16:00 ET — the close is exclusive, so this is after-hours.
  assert.equal(publicSnapshotSessionFacts(new Date("2026-08-21T20:00:00Z")).market_session, "AFTER-HOURS");
});

test("midnight ET renders as 00:xx, not 24:xx", () => {
  // `hour12: false` yields "24" for midnight in some ICU builds; unnormalised that is 1440 minutes,
  // which falls outside every phase window and would silently read CLOSED for the wrong reason.
  const facts = publicSnapshotSessionFacts(new Date("2026-08-21T04:07:00Z")); // 00:07 ET
  assert.match(facts.as_of_et, /00:07 ET$/);
  assert.equal(facts.session_date, "2026-08-21");
  assert.equal(facts.market_session, "CLOSED", "00:07 ET is before the 04:00 pre-market open");
});

test("classifyWall correctly handles inverted walls from constraint test data", () => {
  // classifyWall is part of the public snapshot's defensive constraint — it returns null
  // for walls that cannot be claimed as support/resistance given their spot position.

  // AAPL: spot 312.66, call_wall 310 (below spot, cannot be resistance).
  assert.equal(
    classifyWall("call", 310, 312.66),
    "concentration",
    "call wall below spot degrades to concentration"
  );

  // SPY: spot 763.11, put_wall 765 (above spot, cannot be support).
  assert.equal(
    classifyWall("put", 765, 763.11),
    "concentration",
    "put wall above spot degrades to concentration"
  );

  // AAPL corrected: call_wall 320 above spot 312.66 is valid resistance.
  assert.equal(
    classifyWall("call", 320, 312.66),
    "resistance",
    "call wall above spot is resistance"
  );

  // SPY corrected: put_wall 760 below spot 763.11 is valid support.
  assert.equal(
    classifyWall("put", 760, 763.11),
    "support",
    "put wall below spot is support"
  );
});

test("shouldAlarmPublicGexWarming fires only after the threshold", () => {
  const now = 1_000_000;
  assert.equal(shouldAlarmPublicGexWarming(null, now), false);
  assert.equal(shouldAlarmPublicGexWarming(now - 60_000, now), false);
  assert.equal(shouldAlarmPublicGexWarming(now - 301_000, now), true);
});
