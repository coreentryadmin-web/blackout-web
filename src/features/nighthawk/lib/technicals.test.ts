import assert from "node:assert/strict";
import { test } from "node:test";
import { classifySetup, buildTechnicalSummary } from "./technicals";

// Audit 2026-07-28 (P1): classifySetup() used to fall back to the sentinel string
// ["no dominant pattern"] when no setup condition matched. That sentinel is an internal
// diagnostic label, not member-facing copy — but buildDeterministicThesis() in
// deterministic-edition.ts joins setup_tags directly into the thesis prose with no
// special-casing, so the raw string leaked into what members read (e.g. "NVDA showing
// no dominant pattern in mixed trend"). The fix is to return an empty array instead;
// callers already fall through cleanly to trend-only or generic-setup prose when
// setup_tags is empty.

test("classifySetup: returns an empty array (not a sentinel string) when nothing matches", () => {
  const tags = classifySetup({
    price: 100,
    ema20: null,
    ema50: null,
    ema200: null,
    rsi14: null,
    atr14: null,
    relVol: null,
    priorHigh: null,
    priorClose: null,
    weekHigh: null,
    weekLow: null,
    rangeHigh20: null,
  });
  assert.deepEqual(tags, []);
  assert.ok(!tags.includes("no dominant pattern"));
});

// 2026-09-13 finding: buildTechnicalCard's `summary` field used to interpolate
// `${trend_stack} · ${setupTags.join(" · ")}` directly. classifySetup's own empty-array
// contract (proven above) means setupTags is legitimately [] whenever nothing matches — and
// that plain interpolation left a dangling "trend · " with nothing after it, the exact
// "callers fall through cleanly" promise the 2026-07-28 fix relied on but this one caller
// never implemented. This surfaces in the dossier text fed to the LLM play-explainer prompt
// (format.ts: `Technicals: ${t.summary}`) and the evening edition build.
test("buildTechnicalSummary: no dangling separator when setup_tags is empty", () => {
  assert.equal(buildTechnicalSummary("mixed", []), "mixed");
  assert.ok(!buildTechnicalSummary("mixed", []).endsWith("·"));
  assert.ok(!buildTechnicalSummary("mixed", []).endsWith(" "));
});

test("buildTechnicalSummary: joins trend + up to 4 tags when tags are present", () => {
  assert.equal(
    buildTechnicalSummary("bullish stack", ["RSI overbought", "volume expansion"]),
    "bullish stack · RSI overbought · volume expansion"
  );
});

test("buildTechnicalSummary: caps at 4 tags", () => {
  const summary = buildTechnicalSummary("mixed", ["a", "b", "c", "d", "e"]);
  assert.equal(summary, "mixed · a · b · c · d");
});

test("classifySetup: still tags a real setup (RSI overbought) when a condition matches", () => {
  const tags = classifySetup({
    price: 100,
    ema20: null,
    ema50: null,
    ema200: null,
    rsi14: 75,
    atr14: null,
    relVol: null,
    priorHigh: null,
    priorClose: null,
    weekHigh: null,
    weekLow: null,
    rangeHigh20: null,
  });
  assert.deepEqual(tags, ["RSI overbought"]);
});
