import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyPlanCaveat,
  buildQueryPlan,
  formatPlanBlock,
  validatePlanExecution,
} from "./plan";
import { LARGO_CAPABILITIES, rankCapabilities } from "@/lib/largo/registry/capability-registry";
import { resolveTimeframe } from "@/lib/largo/temporal/timeframe";
import { canonicalTicker } from "./entities";

const NOW = Date.UTC(2026, 7, 10, 18, 0, 0);
const live = resolveTimeframe("where are the gamma walls", NOW);
const past = resolveTimeframe("what did flow look like yesterday", NOW);
const SPX = [canonicalTicker("SPX")!];

test("a historical question is planned ONLY against past-capable sources", () => {
  // Not a preference. A live_only source cannot answer about a past moment at all, and putting one
  // in the plan invites the exact substitution validatePlanExecution exists to catch.
  assert.equal(past.historical, true, "fixture must be historical");
  const plan = buildQueryPlan({ ranked: rankCapabilities("flow yesterday", 40), entities: SPX, timeframe: past });
  assert.ok(plan.parallel.length > 0, "a historical question must still get a plan");
  for (const step of plan.parallel) {
    const cap = LARGO_CAPABILITIES.find((c) => c.id === step.capabilityId)!;
    assert.ok(
      ["windowed", "point_in_time", "event_log"].includes(cap.temporal),
      `${cap.id} is ${cap.temporal} and cannot answer about the past`
    );
  }
});

test("a present-tense question plans against everything", () => {
  const plan = buildQueryPlan({ ranked: rankCapabilities("gamma walls", 40), entities: SPX, timeframe: live });
  assert.ok(plan.parallel.length > 0);
  assert.ok(
    plan.parallel.some((s) => {
      const cap = LARGO_CAPABILITIES.find((c) => c.id === s.capabilityId)!;
      return cap.temporal === "live_only" || cap.temporal === "as_of";
    }),
    "live sources are the right answer to a live question"
  );
});

test("join edges are DERIVED from the registry, never inferred", () => {
  // registry.test.ts already proves every declared join shares an entity key. This asserts the
  // planner only ever reports those, so a cross-product claim built on one is sound rather than a
  // string coincidence between two unrelated rows.
  const plan = buildQueryPlan({ ranked: rankCapabilities("SPX flow and gamma walls", 40), entities: SPX, timeframe: live, limit: 12 });
  const ids = new Set(plan.parallel.map((s) => s.capabilityId));
  for (const j of plan.joins) {
    assert.ok(ids.has(j.from) && ids.has(j.to), "a join must connect two PLANNED steps");
    const a = LARGO_CAPABILITIES.find((c) => c.id === j.from)!;
    const b = LARGO_CAPABILITIES.find((c) => c.id === j.to)!;
    assert.ok((a.joinsWith ?? []).includes(j.to), "the edge must be declared, not invented");
    assert.ok(a.entities.includes(j.on as never) && b.entities.includes(j.on as never), "and share the key");
  }
  // Each pair reported once, not once per direction.
  const keys = plan.joins.map((j) => [j.from, j.to].sort().join("|"));
  assert.equal(new Set(keys).size, keys.length, "duplicate join edge");
});

test("the plan block reads as a suggestion and says every tool stays callable", () => {
  // A plan the model reads as a limit recreates the deleted intent allowlist in prose form.
  const plan = buildQueryPlan({ ranked: rankCapabilities("gamma walls", 40), entities: SPX, timeframe: live });
  const block = formatPlanBlock(plan);
  assert.match(block, /NOT a limit/);
  assert.match(block, /every tool remains callable/i);
  assert.match(block, /ignore it and call what does/);
  assert.match(block, /ONE round/, "the point of a parallel plan is that it is issued at once");
  assert.match(block, /Instruments: SPX/);
});

test("an empty plan produces no block", () => {
  assert.equal(formatPlanBlock({ parallel: [], entities: [], timeframeLabel: "now", joins: [] }), "");
  assert.equal(
    formatPlanBlock(buildQueryPlan({ ranked: rankCapabilities("x", 40), entities: [], timeframe: live, limit: 0 })),
    ""
  );
});

// ── The control, not the instruction ──────────────────────────────────────────────────────────

const cap = (tool: string) => LARGO_CAPABILITIES.find((c) => c.tool === tool)!;
const liveOnlyTool = LARGO_CAPABILITIES.find((c) => c.temporal === "live_only")!.tool;
const pastTool = LARGO_CAPABILITIES.find((c) => c.temporal === "windowed")!.tool;

test("a historical question answered ONLY from live-only sources is flagged", () => {
  // The failure with no other detector: the number is real, it traces to this turn's tool results,
  // grounding is 1.0 — and the answer is about the wrong moment.
  const v = validatePlanExecution({ timeframe: past, toolsCalled: [liveOnlyTool], catalogue: LARGO_CAPABILITIES });
  assert.equal(v.ok, false);
  assert.equal(v.violations[0]!.code, "historical_answered_from_live_only");
  assert.match(v.violations[0]!.detail, new RegExp(liveOnlyTool));
  assert.match(v.violations[0]!.detail, /present-time data only/);
});

test("one past-capable source is enough to clear the check", () => {
  const v = validatePlanExecution({
    timeframe: past,
    toolsCalled: [liveOnlyTool, pastTool],
    catalogue: LARGO_CAPABILITIES,
  });
  assert.equal(v.ok, true, "using a live source ALONGSIDE a past-capable one is normal and fine");
  assert.equal(cap(pastTool).temporal, "windowed");
});

test("a present-tense question is never flagged", () => {
  assert.equal(
    validatePlanExecution({ timeframe: live, toolsCalled: [liveOnlyTool], catalogue: LARGO_CAPABILITIES }).ok,
    true
  );
});

test("silence means NO PROOF of a problem, never proven fine", () => {
  // 67 of 116 tools are uncatalogued. Treating "I cannot classify this tool" as "this tool cannot
  // reach the past" would fire the warning on turns that were fine, which is how a useful check
  // gets disabled by whoever gets tired of it.
  const v = validatePlanExecution({
    timeframe: past,
    toolsCalled: ["some_uncatalogued_tool", "live_feed_capture"],
    catalogue: LARGO_CAPABILITIES,
  });
  assert.equal(v.ok, true);
  assert.deepEqual(v.violations, []);
  assert.equal(
    validatePlanExecution({ timeframe: past, toolsCalled: [], catalogue: LARGO_CAPABILITIES }).ok,
    true,
    "no tools called is no evidence, not a violation"
  );
});

test("the caveat is APPENDED — an answer is never suppressed on a heuristic", () => {
  const answer = "**Verdict**\nSPX is at 7757.64.";
  const out = applyPlanCaveat(answer, [{ code: "historical_answered_from_live_only", detail: "X happened." }]);
  assert.ok(out.startsWith(answer), "the original answer survives verbatim");
  assert.match(out, /Timeframe caveat/);
  assert.match(out, /X happened\./);
  assert.match(out, /current, not as of that period/);
  assert.equal(applyPlanCaveat(answer, []), answer, "no violation, no change");
});

test("a historical question answered from only live sources is now CAUGHT", () => {
  // THE BEHAVIOURAL POINT OF COMPLETING THE CATALOG.
  //
  // Before coverage was completed, three of these four tools had no capability entry, so `real`
  // collapsed to the single catalogued one and the check went quiet on a turn that answered "what
  // happened last Tuesday" entirely from present-time data. That is the exact failure the registry
  // header calls the most damaging thing Largo can do — the answer looks perfect and is about the
  // wrong moment.
  // The REAL resolver, not a hand-built object — a cast here would let the test pass against a
  // timeframe shape production never produces.
  const timeframe = resolveTimeframe("what did flow look like yesterday", NOW);
  assert.equal(timeframe.historical, true, "fixture must actually resolve as historical");
  const liveOnly = ["get_positioning", "get_greeks", "get_options_chain", "get_iv_stats"];

  const caught = validatePlanExecution({ timeframe, toolsCalled: liveOnly, catalogue: LARGO_CAPABILITIES });
  assert.equal(caught.ok, false, "a live-only turn on a historical question must be flagged");
  assert.equal(caught.violations[0]!.code, "historical_answered_from_live_only");
  for (const t of liveOnly) {
    assert.ok(caught.violations[0]!.detail.includes(t), `${t} must be named in the violation`);
  }

  // One past-capable source is enough to clear it — the check asks whether the turn COULD have
  // seen the past, not whether every tool could.
  const withHistory = validatePlanExecution({
    timeframe,
    toolsCalled: [...liveOnly, "get_uw_bars"],
    catalogue: LARGO_CAPABILITIES,
  });
  assert.equal(withHistory.ok, true, "adding a windowed source must clear the violation");
});

test("a present-tense question is never flagged, however live the sources", () => {
  // The check must not become noise on the 90% case, or it gets ignored on the 10% that matters.
  const now = resolveTimeframe("where are the gamma walls right now", NOW);
  assert.equal(now.historical, false, "fixture must actually resolve as present-tense");
  const r = validatePlanExecution({
    timeframe: now,
    toolsCalled: ["get_positioning", "get_greeks"],
    catalogue: LARGO_CAPABILITIES,
  });
  assert.equal(r.ok, true);
});
