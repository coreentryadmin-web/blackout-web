import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LARGO_TOOL_DEFS } from "@/lib/largo/tool-defs";
import { LARGO_CAPABILITIES } from "@/lib/largo/registry/capability-registry";
import { analyzeLargoQuestion } from "@/lib/largo/question-intent";

/**
 * VECTOR ANALYTICS WIRING — a declared tool must actually be reachable, and must call the REAL
 * production functions.
 *
 * THE GAP THIS PINS. A coverage audit of Largo's tool surface against every product panel found
 * SPX Slayer, Helix, Thermal and Night Hawk reachable at the data level and Vector NOT: nine
 * analytics — volume profile, market structure, auto-fib swing, key levels, OpEx, daily regime,
 * screener, ticker comparison, coaching — had ZERO references from `src/lib/largo` or
 * `src/lib/bie`, because all nine are computed in the browser from the drawn candles and the
 * universe snapshot. Asked "where is the point of control", Largo answered from walls and regime
 * and never mentioned that a volume profile exists. Nothing failed; no test, no error, no log line.
 *
 * Same shape as Vector Pulse, the Helix derivations and the helix-signal-outcomes cron. The
 * declaration lives in three separate files and missing any one produces a DIFFERENT silent
 * failure — a tool the model can call that throws, a tool nothing ranks so the model never reaches
 * for it, or a capability pointing at nothing — so all three are asserted here.
 */

const TOOL = "get_vector_analytics";

test("the analytics tool is DECLARED in the tool defs", () => {
  const def = LARGO_TOOL_DEFS.find((t) => t.name === TOOL);
  assert.ok(def, `${TOOL} missing from LARGO_TOOL_DEFS`);
  // Every one of the nine analytics has to be findable in the description, or the model will never
  // reach for the tool on the question that analytic answers.
  for (const term of [
    "volume_profile",
    "market_structure",
    "fib_swing",
    "key_levels",
    "opex",
    "daily_regime",
    "screener",
    "ticker_comparison",
    "coaching",
  ]) {
    assert.match(def!.description, new RegExp(term), `description must name ${term}`);
  }
  // The distinctions that stop an absence being reported as an emptiness.
  assert.match(def!.description, /BOS is continuation, CHOCH is a character change/);
  assert.match(def!.description, /unavailable_sections/);
  assert.match(def!.description, /not_applicable_non_spx/);
  // It must position itself ALONGSIDE the two existing Vector tools, not as a replacement — they
  // answer different questions and a model that treats them as interchangeable will pick wrong.
  assert.match(def!.description, /get_vector_full_state/);
  assert.match(def!.description, /get_vector_pulse/);
});

test("the analytics tool is DISPATCHABLE in run-tool", () => {
  // Read as source rather than executing: the dispatcher's imports reach Redis and the provider
  // stack, and the assertion here is purely that the case exists and routes to the real reader.
  const src = readFileSync("src/lib/largo/run-tool.ts", "utf8");
  assert.ok(src.includes(`case "${TOOL}"`), `${TOOL} has no case in run-tool.ts`);
  assert.ok(src.includes("vectorAnalyticsForLargo"), "the case must call the real product read");
});

test("the analytics tool is CATALOGUED as a capability", () => {
  const cap = LARGO_CAPABILITIES.find((c) => c.tool === TOOL);
  assert.ok(cap, `${TOOL} missing from LARGO_CAPABILITIES — nothing would ever rank it`);
  assert.equal(cap!.product, "VECTOR");
  for (const kw of ["volume profile", "poc", "market structure", "golden pocket", "opex", "floor pivots"]) {
    assert.ok(cap!.keywords.includes(kw), `capability must rank on "${kw}"`);
  }
});

test("the reader never reimplements a single Vector analytic", () => {
  // A parallel implementation would drift the moment a threshold is tuned, and Largo would then
  // describe a chart that does not match the one on screen — a disagreement no test would catch
  // and every member would see. This is the house rule the Helix derivations already follow.
  const core = readFileSync("src/lib/largo/vector-analytics-core.ts", "utf8");
  for (const fn of [
    "computeVolumeProfile",
    "labelPivots",
    "detectStructureEvents",
    "dominantSwing",
    "swingRetracement",
    "goldenPocket",
    "levelLinesFor",
    "lastSessionBars",
    "aggregateVectorBars",
    "opexDatesInRange",
    "isQuarterlyOpex",
  ]) {
    assert.ok(core.includes(fn), `must call the real ${fn}`);
  }

  const server = readFileSync("src/lib/largo/vector-analytics.ts", "utf8");
  for (const fn of [
    "fetchVectorSeedBars",
    "loadDailyRegime",
    "loadVectorUniverseSnapshot",
    "screenUniverse",
    "buildTickerComparisonRows",
    "buildCoachingAlerts",
  ]) {
    assert.ok(server.includes(fn), `must call the real ${fn}`);
  }
});

test("the daily-regime walk has ONE implementation, shared with the chart's route", () => {
  // The route used to own the walk inline. Largo needing the same series is exactly how a second,
  // slowly-diverging copy gets written; the extraction is the fix and this pins it.
  const route = readFileSync("src/app/api/market/vector/daily-regime/route.ts", "utf8");
  assert.ok(route.includes("loadDailyRegime"), "the route must delegate to the shared loader");
  assert.ok(
    !route.includes("reduceSessionToDaily"),
    "the route must not carry its own copy of the walk"
  );
});

test("the bar fetch happens ONCE, so every level is measured at the same instant", () => {
  // Four separate fetches could put the POC and the opening range on different bar sets, and the
  // disagreement would be invisible in the answer.
  const server = readFileSync("src/lib/largo/vector-analytics.ts", "utf8");
  const fetches = server.match(/fetchVectorSeedBars\(/g) ?? [];
  assert.equal(fetches.length, 1, `expected exactly one seed-bar fetch, found ${fetches.length}`);
});

test("chart-analytic questions hint the tool WITHOUT naming Vector", () => {
  // The failure this prevents: a member asks "where's the point of control on NVDA" — a Vector
  // question that never says "Vector" — and the product-vocabulary intent does not fire, so the
  // analytics tool is never hinted and the answer comes from walls and regime instead.
  for (const q of [
    "where is the point of control on NVDA",
    "did SPX break structure today",
    "is that a BOS or a CHoCH",
    "where's the golden pocket",
    "what's the opening range on TSLA",
    "where are today's floor pivots",
    "when is the next opex",
    "which names are nearest flip",
  ]) {
    const intent = analyzeLargoQuestion(q, []);
    assert.equal(intent.needsVectorAnalytics, true, `"${q}" must set needsVectorAnalytics`);
    assert.match(intent.guidance, new RegExp(TOOL), `"${q}" must hint ${TOOL} in the guidance`);
  }
});

test("the analytics intent does not swallow unrelated questions", () => {
  for (const q of ["what did night hawk pick last night", "how is my swing position doing"]) {
    assert.equal(analyzeLargoQuestion(q, []).needsVectorAnalytics, false, `"${q}" must not hint ${TOOL}`);
  }
});

// ---------------------------------------------------------------------------
// get_vector_full_state must never hand the model a bare `null`
// ---------------------------------------------------------------------------

test("get_vector_full_state returns an honest envelope, not a bare null", () => {
  // THE DEFECT: the case returned `fetchVectorFullState(...)` directly, which is `null` when there
  // is no live spot. A bare null carries no ticker, no reason, and cannot distinguish "market
  // closed" from "not optionable" from "GEX matrix cold" — three situations needing three
  // different answers. The BIE composer path (noLiveVectorStateMessage + context.reason) had
  // answered this honestly for months, so the same question got a good answer through one door
  // and an uninterpretable null through the other.
  const runTool = readFileSync("src/lib/largo/run-tool.ts", "utf8");
  const caseBody = runTool.slice(
    runTool.indexOf('case "get_vector_full_state"'),
    runTool.indexOf('case "get_hot_tickers"')
  );
  assert.ok(caseBody.includes("vectorFullStateForLargo"), "the tool must route through the enveloped reader");
  assert.ok(
    !/return fetchVectorFullState\(/.test(caseBody),
    "returning fetchVectorFullState directly re-introduces the bare null"
  );

  const reads = readFileSync("src/lib/largo/product-reads.ts", "utf8");
  assert.match(reads, /reason: "no_live_vector_state"/);
  // A throw is a THIRD state and must not be collapsed into "no live spot".
  assert.match(reads, /reason: "vector_full_state_failed"/);
  // The success path must return the state UNCHANGED — get_ecosystem_context's documented
  // "exact same object" promise depends on the populated case not being wrapped.
  assert.match(reads, /if \(state\) return state;/);
});

test("the description tells the model what the envelope means", () => {
  const def = LARGO_TOOL_DEFS.find((t) => t.name === "get_vector_full_state");
  assert.ok(def);
  assert.match(def!.description, /NO LIVE STATE/);
  assert.match(def!.description, /CANNOT tell those apart/);
  assert.match(def!.description, /never report it as the ticker having no levels/);
});


// ---------------------------------------------------------------------------
// Contract C1 — session-scoped analytics must carry the market's clock
// ---------------------------------------------------------------------------

test("vector-analytics anchors as_of and the screener sweep in ET", () => {
  // C1: a Largo payload that builds `as_of` from toISOString() must also stamp ET in the same
  // module. This one is not a formality — nearly every field below `as_of` here is session-scoped
  // (opening range, HOD/LOD, prior-day pivots, OpEx days_away, per-session daily_regime rows), and
  // after ~20:00 ET the UTC date is already TOMORROW. A reader resolving "today" from `as_of`
  // labels this session's data with the next one's date.
  const src = readFileSync("src/lib/largo/vector-analytics.ts", "utf8");
  assert.match(src, /import \{ etStamp, etSessionDate \} from "@\/lib\/largo\/temporal\/bar-session-date";/);
  assert.match(src, /as_of_et: etStamp\(nowMs\)/);
  assert.match(src, /session_date: etSessionDate\(nowMs\)/);
  // The universe sweep has its own age and needs its own anchor, not the read's.
  assert.match(src, /updated_at_et: etStamp\(universe\.updatedAt\)/);
  assert.match(src, /updated_at_session_date: etSessionDate\(universe\.updatedAt\)/);
});

test("the analytics description tells the model to use the ET fields", () => {
  const def = LARGO_TOOL_DEFS.find((t) => t.name === "get_vector_analytics");
  assert.ok(def);
  assert.match(def!.description, /use `as_of_et` and `session_date`/);
  assert.match(def!.description, /lands a session ahead of the data/);
});

/**
 * SCREENER DENOMINATORS — a ranked list with no denominator, and ranks filled by absence.
 *
 * These run the REAL `screenUniverse` (the same pure function `vectorAnalyticsForLargo` calls
 * behind its dynamic import) over a synthetic universe, then reproduce the boundary's own
 * filter-then-cap. They assert the two properties the payload must now carry; the payload wiring
 * itself is asserted by the source checks below.
 */
function fakeUniverse(count: number, populated: number, aboveEvery: (i: number) => boolean) {
  return Array.from({ length: count }, (_, i) => {
    const isPop = i < populated;
    const spot = 100 + i;
    const above = aboveEvery(i);
    return {
      ticker: `T${String(i).padStart(2, "0")}`,
      spot: isPop ? spot : null,
      gammaFlip: isPop ? (above ? spot - (1 + (i % 7)) : spot + (1 + (i % 5))) : null,
      topCallWall: isPop ? spot + 5 : null,
      topPutWall: isPop ? spot - 5 : null,
      topCallPct: isPop ? 5 + (i % 40) : null,
      topPutPct: isPop ? 4 + (i % 30) : null,
    };
  });
}

test("a preset's denominator is its OWN match count, never the universe size", async () => {
  const { screenUniverse } = await import("@/features/vector/lib/vector-screener");
  const rows = fakeUniverse(55, 46, (i) => i % 3 !== 0) as never[];

  // Two of the three presets FILTER by regime, so `universe_size` is the denominator for none of
  // them. Measured shape of the defect: 55 / 30 / 16 matched, all three served as a bare 15 beside
  // `universe_size: 55` — so "what share of the universe is pinned?" answered 15/55 = 27% when the
  // true share above the flip was 30/55.
  const matched = {
    nearest: screenUniverse(rows, { preset: "nearest-flip" }).length,
    pinned: screenUniverse(rows, { preset: "most-pinned" }).length,
    explosive: screenUniverse(rows, { preset: "most-explosive" }).length,
  };
  assert.equal(matched.nearest, 55, "nearest-flip does not filter");
  assert.ok(matched.pinned < rows.length, "most-pinned filters to spot >= flip");
  assert.ok(matched.explosive < rows.length, "most-explosive filters to spot < flip");
  assert.equal(matched.pinned + matched.explosive + 9, rows.length, "above + below + unknown = universe");
  // The three match counts genuinely differ — one shared denominator cannot describe them.
  assert.equal(new Set([matched.nearest, matched.pinned, matched.explosive]).size, 3);
});

test("rows with no metric are dropped BEFORE the cap, so absence cannot occupy a rank", async () => {
  const { screenUniverse, absFlipDistancePct } = await import("@/features/vector/lib/vector-screener");
  // Mid-warm universe: 6 of 55 populated — the partial-sweep state the cron deliberately produces.
  const rows = fakeUniverse(55, 6, () => true) as never[];
  const matched = screenUniverse(rows, { preset: "nearest-flip" });

  // THE DEFECT: a fixed-size prefix of the sorted list. `screenUniverse` correctly sorts
  // null-metric rows last and its docblock promises they "must never rank as nearest to flip" —
  // taking .slice(0, 15) broke that promise at the boundary, not in the library.
  const prefix = matched.slice(0, 15);
  const blanksInPrefix = prefix.filter((r) => absFlipDistancePct(r) == null).length;
  assert.equal(prefix.length, 15);
  assert.equal(blanksInPrefix, 9, "9 of 15 ranked rows had no gamma flip at all");

  // THE FIX: filter for a usable metric first, THEN cap.
  const rankable = matched.filter((r) => absFlipDistancePct(r) != null);
  const served = rankable.slice(0, 15);
  assert.equal(served.length, 6, "only the rows that can be ranked are served");
  assert.equal(served.filter((r) => absFlipDistancePct(r) == null).length, 0);
  // And the count that was hidden is now reportable.
  assert.equal(matched.length - rankable.length, 49, "excluded_no_metric");
});

test("truncation is disclosed, and `returned` is not mistaken for a count of anything", async () => {
  const { screenUniverse, absFlipDistancePct } = await import("@/features/vector/lib/vector-screener");
  const rows = fakeUniverse(55, 55, () => true) as never[];
  const matched = screenUniverse(rows, { preset: "nearest-flip" });
  const rankable = matched.filter((r) => absFlipDistancePct(r) != null);
  const served = rankable.slice(0, 15);
  assert.equal(rankable.length, 55);
  assert.equal(served.length, 15);
  assert.ok(rankable.length > served.length, "truncated must be true here");
  // 40 rows dropped with nothing in the old payload to say so.
  assert.equal(rankable.length - served.length, 40);
});

test("the screener payload ships per-list denominators and drops blanks before the cap", () => {
  const src = readFileSync("src/lib/largo/vector-analytics.ts", "utf8");
  // The exact shape of the regression: a bare slice straight into the payload.
  assert.doesNotMatch(
    src,
    /(nearest_flip|most_pinned|most_explosive):\s*screenUniverse\([^)]*\)\s*\.slice\(/,
    "a preset must not be served as a bare capped slice"
  );
  for (const field of ["matched_universe", "rankable_rows", "excluded_no_metric", "returned", "truncated", "universe_filter", "basis"]) {
    assert.match(src, new RegExp(`\\b${field}\\b`), `screener rows must carry ${field}`);
  }
  // Ordering is the whole fix — the filter must precede the slice in the served path.
  const serve = src.slice(src.indexOf("const servePreset"), src.indexOf("const hasFlip"));
  assert.ok(serve.indexOf(".filter(rankable)") < serve.indexOf(".slice(MAX_SCREENER_ROWS")
    || serve.indexOf(".filter(rankable)") < serve.indexOf(".slice(0, MAX_SCREENER_ROWS)"),
    "unrankable rows must be dropped before the cap, never after");
  // wallStrength coerces missing walls to 0, so eligibility must test the INPUTS.
  assert.match(src, /topCallPct != null \|\| r\.topPutPct != null/);
});

test("the tool description no longer calls the filtered lists 'over the universe'", () => {
  const src = readFileSync("src/lib/largo/tool-defs.ts", "utf8");
  const desc = src.slice(src.indexOf("Vector's CHART ANALYTICS"), src.indexOf("Vector's CHART ANALYTICS") + 6000);
  assert.match(desc, /matched_universe/, "the description must teach the per-list denominator");
  assert.match(desc, /truncated/, "…and that a list can be a top-N");

});
