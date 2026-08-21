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
