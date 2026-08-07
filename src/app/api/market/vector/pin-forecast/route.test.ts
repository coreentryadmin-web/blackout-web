import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Source-level contract tests. The handler's substance is its GATING and its DEGRADE posture, both
// of which are one deleted line away from being wrong in a way no type check catches: dropping
// requireToolApi would serve a paid overlay to un-entitled members, and throwing instead of
// returning null would blank the whole chart on a thin chain. Neither is visible to a unit test of
// the builder (which needs live providers), so they are pinned here against the source.
const routeSrc = readFileSync("src/app/api/market/vector/pin-forecast/route.ts", "utf8");
const serverSrc = readFileSync("src/features/vector/lib/vector-pin-forecast-server.ts", "utf8");
// The already-shipped sibling read is the reference implementation for how a Vector overlay
// endpoint must be gated — comparing against it means this route cannot drift away from the
// convention without the drift showing up here.
const siblingSrc = readFileSync("src/app/api/market/vector/expected-move/route.ts", "utf8");

test("route carries the SAME three gates as the sibling expected-move read", () => {
  for (const gate of ["authorizePremiumDeskApi", 'requireToolApi("vector")', "isVectorTickerAllowed"]) {
    assert.ok(siblingSrc.includes(gate), `precondition: sibling should gate on ${gate}`);
    assert.ok(routeSrc.includes(gate), `pin-forecast must gate on ${gate} — it is a paid Vector overlay`);
  }
});

test("route is uncached and force-dynamic — a pin forecast is a live read", () => {
  assert.match(routeSrc, /NO_STORE_HEADERS/);
  assert.match(routeSrc, /dynamic = "force-dynamic"/);
});

test("route rounds floats at the data layer, per repo policy", () => {
  // The repo has a standing issue with endpoints serving unrounded floats (7499.360000000001).
  assert.match(routeSrc, /roundFloats\(/);
});

test("unknown ?target falls back to the everywhere-meaningful default rather than 400ing", () => {
  // "expiry" is the only target that means the same thing on every name; "eod" is a true pin only
  // where a daily expiry exists. A client bug must not deny a member the cone.
  assert.match(routeSrc, /=== "eod" \? "eod" : "expiry"/);
});

test("builder degrades to null and never throws — a live overlay must not blank the chart", () => {
  assert.match(serverSrc, /catch\s*\{\s*\n?\s*return null;/, "the whole build must be wrapped in a null-returning catch");
  // Every honest-refusal path returns null rather than substituting a default.
  assert.ok(
    (serverSrc.match(/return null;/g) ?? []).length >= 4,
    "no spot / empty chain / unresolvable target / one-sided expiry must each return null"
  );
});

test("builder forecasts ONE expiry's book, never a blend", () => {
  // Mixing expiries would fold a Friday wall into a monthly ladder and produce a magnet no single
  // book actually supports — a plausible-looking number with nothing behind it.
  assert.match(serverSrc, /filter\(\(c\) => c\.expiry === resolved\.chainExpiry\)/);
});

test("builder passes BOTH clocks the resolver computed", () => {
  // Passing closeMs without horizonMin (or vice versa) silently mixes trading-time and
  // session-length units in tFrac = tMin/horizonMin — the exact bug #1851 exists to prevent.
  assert.match(serverSrc, /closeMs: resolved\.closeMs/);
  assert.match(serverSrc, /horizonMin: resolved\.horizonMin/);
  assert.match(serverSrc, /structYears: resolved\.structYears/);
});

test("builder reuses the shared spot + cached chain, adding no provider RPS", () => {
  assert.match(serverSrc, /getGexPositioning/);
  assert.match(serverSrc, /loadCurrentChainContracts/);
});

test("Monte-Carlo seed is deterministic per ticker+target+session", () => {
  // Two polls in the same session must agree with each other, or the cone visibly jitters between
  // refreshes for reasons the member cannot see.
  assert.match(serverSrc, /seed: stableSeed\(`\$\{t\}:\$\{target\}:\$\{sessionYmd\}`\)/);
});
