import assert from "node:assert/strict";
import { test } from "node:test";
import { isPublicGexTicker, publicGexTickers, sanitizePublicRead } from "./public-gex-snapshot.ts";

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
