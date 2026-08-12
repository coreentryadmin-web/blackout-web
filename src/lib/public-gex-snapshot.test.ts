import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifyWall,
  correctPublicRead,
  isPublicGexTicker,
  publicGexTickers,
  sanitizePublicRead,
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

test("correctPublicRead: unmatched wording passes through — can only remove a false claim", () => {
  const read = "Spot 100 is above the gamma flip (95) → long gamma.";
  assert.equal(correctPublicRead(read, { spot: 100, call_wall: 90, put_wall: 110 }), read);
});
