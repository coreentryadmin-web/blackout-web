import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkToolEntitlement,
  declaredEntitlement,
  formatToolDiagnostics,
  makeGuardedToolRunner,
  type ToolCallDiagnostic,
} from "./tool-guard";
import { exceedsToolResultCap } from "@/lib/providers/tool-result-cap";
import { LARGO_CAPABILITIES } from "@/lib/largo/registry/capability-registry";
import { LARGO_TOOL_DEFS } from "@/lib/largo/tool-defs";

const premiumTool = LARGO_CAPABILITIES.find((c) => c.entitlement === "premium")!.tool;

// A SYNTHETIC catalog. The real registry declares `premium` on all 130 of its capabilities today,
// so enforcement against it is armed but inert — testing the gate against the real catalog would
// pass vacuously and prove nothing. This proves the mechanism; the test below pins the real
// catalog's current state separately, so the day a capability is marked admin it is a deliberate,
// visible change.
const adminTool = "get_zerodte_rejections";
const CATALOG = [
  { ...LARGO_CAPABILITIES[0]!, id: "test.admin", tool: adminTool, entitlement: "admin" as const },
  { ...LARGO_CAPABILITIES[0]!, id: "test.premium", tool: premiumTool, entitlement: "premium" as const },
];
// A tool absent from CATALOG, used to prove the fail-open policy.
//
// This used to be picked by SEARCHING the real registry for an uncatalogued tool — which quietly
// made a passing test depend on the registry having a coverage gap. When coverage was completed
// the fixture became undefined and this file broke, having tested nothing about the gap it relied
// on. The policy under test is "a tool the catalog does not name is not restricted", and that is
// a property of CATALOG (the two-entry synthetic above), not of production coverage.
const uncatalogued = "get_quote";

const ADMIN = { userId: "u_admin", isAdmin: true };
const MEMBER = { userId: "u_member", isAdmin: false };

test("the fixtures this file depends on actually exist", () => {
  assert.ok(premiumTool);
  assert.ok(uncatalogued, "the fail-open fixture must be a real tool name");
  assert.ok(
    LARGO_TOOL_DEFS.some((t) => t.name === uncatalogued),
    "the fail-open fixture must name a REAL tool"
  );
  assert.ok(
    !CATALOG.some((c) => c.tool === uncatalogued),
    "the fail-open fixture must be absent from the SYNTHETIC catalog under test"
  );
  assert.ok(
    LARGO_TOOL_DEFS.some((t) => t.name === adminTool),
    "the synthetic admin fixture must name a REAL tool, or the test proves nothing about routing"
  );
});

test("the real registry currently restricts nothing — recorded, not assumed", () => {
  // Honest state, pinned. Every one of the 130 catalogued capabilities declares `premium`, so this
  // gate denies nothing in production today. It is here so that marking a capability `admin` is a
  // one-line change that takes effect in CODE. If this assertion ever fails, someone added a real
  // restriction — update it deliberately and check the blast radius.
  const admin = LARGO_CAPABILITIES.filter((c) => c.entitlement === "admin").map((c) => c.id);
  assert.deepEqual(admin, [], "an admin capability appeared — enforcement is now live, verify intent");
});

test("an admin-only tool is denied to a non-admin, in code", () => {
  // The registry has carried `entitlement` since it shipped and nothing read it. A prompt
  // instruction is not enforcement: the model is the thing choosing tools.
  const denial = checkToolEntitlement(adminTool, MEMBER, CATALOG);
  assert.ok(denial, "admin tool must be denied to a member");
  assert.equal(denial!.denied, true);
  assert.match(denial!.reason, /admin/i);
  assert.match(denial!.reason, /NOT run/, "the model must know it did not execute");
  assert.match(denial!.reason, /do not substitute/i, "and must not paper over it with another source");
});

test("an admin is not denied their own tools", () => {
  assert.equal(checkToolEntitlement(adminTool, ADMIN, CATALOG), null);
});

test("uncatalogued tools FAIL OPEN — the registry is an allowlist of restricted tools", () => {
  // The policy that keeps this shippable. Coverage is complete today, but the policy is about the
  // NEXT tool someone adds: failing closed on an uncatalogued tool would silently disable it, and
  // the symptom ("Largo got worse at that one thing") would be almost impossible to trace here.
  // The registry is an allowlist of RESTRICTED tools, not an allowlist of permitted ones.
  assert.equal(declaredEntitlement(uncatalogued, CATALOG), null);
  assert.equal(checkToolEntitlement(uncatalogued, MEMBER, CATALOG), null);
  assert.equal(checkToolEntitlement("a_tool_that_does_not_exist", MEMBER, CATALOG), null);
});

test("premium-entitled tools are not restricted", () => {
  assert.equal(checkToolEntitlement(premiumTool, MEMBER, CATALOG), null);
});

test("cataloguing a tool can only ADD a restriction, never remove one", () => {
  // Stated as a property so a future refactor that inverts the default is caught here rather than
  // in production. Every non-admin declaration must be permissive for everyone.
  for (const c of LARGO_CAPABILITIES.filter((x) => x.entitlement !== "admin")) {
    assert.equal(checkToolEntitlement(c.tool, MEMBER), null, c.id);
  }
});

function harness(viewer: { userId: string; isAdmin: boolean }, execute: (n: string) => Promise<unknown>) {
  const toolsUsed: string[] = [];
  const capturedResults: unknown[] = [];
  const diagnostics: ToolCallDiagnostic[] = [];
  let clock = 1000;
  const run = makeGuardedToolRunner({
    viewer,
    execute: async (name) => {
      clock += 250;
      return execute(name);
    },
    toolsUsed,
    capturedResults,
    diagnostics,
    now: () => clock,
    catalog: CATALOG,
  });
  return { run, toolsUsed, capturedResults, diagnostics };
}

test("a denied call does not execute and does not enter tools_used", () => {
  // `tools_used` is persisted to the interaction log and buckets calibration cohorts, so it must
  // record tools that RAN. Recording a denial would make an admin-denied turn indistinguishable
  // from one that used the tool.
  let executed = false;
  const h = harness(MEMBER, async () => {
    executed = true;
    return { ok: true };
  });
  return h.run(adminTool, {}).then((result) => {
    assert.equal(executed, false, "a denied tool must never reach the executor");
    assert.deepEqual(h.toolsUsed, []);
    assert.deepEqual(h.capturedResults, []);
    assert.equal((result as { denied: boolean }).denied, true);
    assert.equal(h.diagnostics[0]!.denied, true);
    assert.equal(h.diagnostics[0]!.bytes, 0);
  });
});

test("a denial is RETURNED, not thrown", async () => {
  // An exception would surface as a generic tool failure and get narrated as "that data isn't
  // available" — a different and misleading claim than "you don't have access".
  const h = harness(MEMBER, async () => ({ ok: true }));
  const result = await h.run(adminTool, {});
  assert.equal(typeof result, "object");
  assert.match((result as { reason: string }).reason, /admin/i);
});

test("an allowed call runs, is recorded, and is timed", async () => {
  const h = harness(MEMBER, async () => ({ spot: 7757.64 }));
  const result = await h.run(premiumTool, { ticker: "SPX" });
  assert.deepEqual(result, { spot: 7757.64 });
  assert.deepEqual(h.toolsUsed, [premiumTool]);
  assert.equal(h.capturedResults.length, 1);
  assert.equal(h.diagnostics[0]!.ms, 250);
  assert.equal(h.diagnostics[0]!.denied, false);
  assert.equal(h.diagnostics[0]!.failed, false);
  assert.ok(h.diagnostics[0]!.bytes > 0);
});

test("a throwing tool is recorded as FAILED and the error propagates unchanged", async () => {
  // Swallowing it would turn a hard failure into an empty result the model narrates as "no data".
  const h = harness(MEMBER, async () => {
    throw new Error("upstream 503");
  });
  await assert.rejects(() => h.run(premiumTool, {}), /upstream 503/);
  assert.equal(h.diagnostics[0]!.failed, true);
  assert.equal(h.diagnostics[0]!.denied, false, "a failure is not a denial — they need opposite fixes");
  assert.deepEqual(h.toolsUsed, [premiumTool], "it DID run; it just failed");
});

test("a silently-empty result is distinguishable from a successful one", async () => {
  const h = harness(MEMBER, async () => null);
  await h.run(premiumTool, {});
  assert.equal(h.diagnostics[0]!.bytes, 4, "JSON 'null' is 4 chars — recorded, not treated as a crash");
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  const h2 = harness(MEMBER, async () => circular);
  await h2.run(premiumTool, {});
  assert.equal(h2.diagnostics[0]!.bytes, 0, "a non-serializable result reports unknown size, not a throw");
});

test("the diagnostics line names the slowest tool first and never carries data", async () => {
  const line = formatToolDiagnostics([
    { tool: "get_quote", ms: 120, denied: false, failed: false, bytes: 300 },
    { tool: "get_postgres_flows", ms: 9200, denied: false, failed: false, bytes: 40_000 },
    { tool: "get_scan_rejections", ms: 1, denied: true, failed: false, bytes: 0 },
    { tool: "get_gex", ms: 40, denied: false, failed: true, bytes: 0 },
    { tool: "get_news", ms: 30, denied: false, failed: false, bytes: 0 },
  ]);
  assert.match(line, /get_postgres_flows 9200ms \| get_quote/, "slowest first — that is why anyone reads it");
  assert.match(line, /5 calls, 9391ms total/);
  assert.match(line, /1 denied/);
  assert.match(line, /1 failed/);
  assert.match(line, /1 empty/);
  assert.match(line, /get_scan_rejections 1ms DENIED/);
  // Names, ms and byte counts only. Inputs carry tickers and user ids; outputs carry positions.
  assert.ok(!/SPX|7757|u_member/.test(line));
});

test("no tool calls means no log line", () => {
  assert.equal(formatToolDiagnostics([]), "");
});

test("what the model receives is rounded for reading, and captured results match it", async () => {
  // The guarded runner is the boundary between data that is COMPUTED WITH and data that is READ.
  // Every other runLargoTool caller bypasses it and keeps full precision on purpose.
  const h = harness(MEMBER, async () => ({
    results: [{ t: 1787202000000, c: 7707.9800000000005, session_date: "2026-08-19" }],
    total_premium: 4276339.059400001,
    delta: 0.9160819881475173,
    uw_string: "45756696.409090909091",
    ticker: "SPX",
  }));
  const out = (await h.run("get_quote", { ticker: "SPX" })) as Record<string, any>;

  assert.equal(out.results[0].c, 7707.98);
  assert.equal(out.total_premium, 4276339.0594);
  assert.equal(out.delta, 0.916082);
  assert.equal(out.uw_string, "45756696.4091", "UW numeric strings are rounded and stay strings");
  assert.equal(out.results[0].t, 1787202000000, "an epoch is an integer and must not be touched");
  assert.equal(out.results[0].session_date, "2026-08-19", "labels survive rounding");
  assert.equal(out.ticker, "SPX");

  // capturedResults feeds the extractors that render levels, so it must carry the SAME numbers the
  // model was shown — otherwise a rendered level and a spoken level could disagree.
  assert.equal(h.capturedResults[0], out);
});

/**
 * ── TRUNCATION DETECTION (L-1) ────────────────────────────────────────────────────────────────
 *
 * This file has measured `bytes` on every tool call since it shipped, and NOTHING has ever compared
 * that number to the transport cap. The cost of the missing comparison: three defects
 * (#2433 `get_zerodte_record` delivering 1.5% of itself, #2436 `get_nighthawk_edition` cutting off
 * every play, #2480 `get_nighthawk_outcomes` quoting a 40% win rate over "5 plays" for a window whose
 * real record was 74 resolved at 50%), each found only by asking the LIVE model whether its payload
 * had arrived — because an over-cap tool still "succeeds": the call returns, the loop completes, and
 * the model writes a fluent answer from the fragment.
 *
 * The Phase 0 map counted the exposure: of then-129 tools, exactly TWO bound their payload before
 * this blind cut. The other 127 were capped with nothing watching.
 *
 * The comparison is exact, not a heuristic. `sizeOf` here stringifies the same object the loop then
 * stringifies, so `bytes` IS `raw.length` — which is why the boundary tests below are worth having:
 * an off-by-one would fire on the tools sitting closest to the cap, precisely the ones whose reports
 * need to be trustworthy.
 */

const CAP = 16_000;

function diag(over: Partial<ToolCallDiagnostic> = {}): ToolCallDiagnostic {
  return { tool: "get_thing", ms: 10, denied: false, failed: false, bytes: 100, truncated: false, ...over };
}

test("a result OVER the cap is flagged truncated, with the size that makes it actionable", () => {
  const line = formatToolDiagnostics([diag({ tool: "get_zerodte_record", bytes: 41_203, truncated: true })]);
  assert.match(line, /TRUNCATED 41203\/16000/, "the log must name both the size and the cap");
  assert.match(line, /1 TRUNCATED/, "the summary must count it");
  assert.match(line, /get_zerodte_record/);
});

test("a result UNDER the cap is not flagged", () => {
  const line = formatToolDiagnostics([diag({ bytes: 15_999 })]);
  assert.doesNotMatch(line, /TRUNCATED/);
});

test("BOUNDARY: exactly at the cap is NOT truncated — the loop cuts on strictly greater-than", () => {
  // The transport's own test is `raw.length > MAX_TOOL_RESULT_CHARS`. A payload landing exactly on
  // the cap survives whole, and reporting it as truncated would cry wolf on the tools closest to
  // the limit — the ones whose reports most need to be believed.
  assert.equal(exceedsToolResultCap(CAP), false, "exactly at the cap is not cut");
  assert.equal(exceedsToolResultCap(CAP + 1), true, "one over the cap is cut");
  assert.equal(exceedsToolResultCap(CAP - 1), false);
});

test("a non-finite or zero size is never reported as truncated", () => {
  // sizeOf returns 0 for a circular/non-serializable result, which means "unknown", not "huge".
  assert.equal(exceedsToolResultCap(0), false);
  assert.equal(exceedsToolResultCap(Number.NaN), false);
  assert.equal(exceedsToolResultCap(Number.POSITIVE_INFINITY), false, "Infinity is not a measurement");
});

test("TRUNCATED outranks EMPTY and does not mask DENIED or FAILED", () => {
  const line = formatToolDiagnostics([
    diag({ tool: "a", denied: true, bytes: 0 }),
    diag({ tool: "b", failed: true, bytes: 0 }),
    diag({ tool: "c", bytes: 0 }),
    diag({ tool: "d", bytes: 90_000, truncated: true }),
  ]);
  assert.match(line, /1 denied/);
  assert.match(line, /1 failed/);
  assert.match(line, /1 empty/);
  assert.match(line, /1 TRUNCATED/);
  assert.match(line, /a \d+ms DENIED/);
  assert.match(line, /d \d+ms TRUNCATED/);
});

test("the guard populates `truncated` from the size it already measured — end to end", async () => {
  const big = { rows: Array.from({ length: 4_000 }, (_, i) => ({ i, note: "padding-to-exceed-the-cap" })) };
  const diagnostics: ToolCallDiagnostic[] = [];
  const run = makeGuardedToolRunner({
    viewer: { userId: "u1", isAdmin: false },
    execute: async () => big,
    toolsUsed: [],
    capturedResults: [],
    diagnostics,
  });
  await run("get_big", {});
  assert.equal(diagnostics.length, 1);
  assert.ok(diagnostics[0]!.bytes > CAP, `fixture must actually exceed the cap, got ${diagnostics[0]!.bytes}`);
  assert.equal(diagnostics[0]!.truncated, true, "the guard must flag what it measured as over-cap");
});

test("a small real result is measured and NOT flagged — the guard does not over-report", async () => {
  const diagnostics: ToolCallDiagnostic[] = [];
  const run = makeGuardedToolRunner({
    viewer: { userId: "u1", isAdmin: false },
    execute: async () => ({ ticker: "SPX", spot: 6512.25 }),
    toolsUsed: [],
    capturedResults: [],
    diagnostics,
  });
  await run("get_quote", {});
  assert.equal(diagnostics[0]!.truncated, false);
  assert.ok(diagnostics[0]!.bytes > 0);
});

test("the measured size IS the string the transport measures — the comparison is exact, not a heuristic", async () => {
  // The whole detection rests on this equivalence. `anthropicToolLoop` does
  // `JSON.stringify(results[i])` on the value `runTool` returned and tests `raw.length > cap`; the
  // guard does `JSON.stringify(result).length` on that same value AFTER `roundResultForReading`,
  // which is also what the loop receives. Same object, same serializer, same length — so a
  // TRUNCATED flag here is a fact about the transport, not an estimate of one.
  //
  // Pinned as a test because the equivalence is invisible from either file alone: insert any
  // re-shaping between the guard's return and the loop's stringify and the flag silently starts
  // lying, in the direction of false confidence.
  const payload = { ticker: "SPX", rows: Array.from({ length: 50 }, (_, i) => ({ i, v: i * 1.5 })) };
  const diagnostics: ToolCallDiagnostic[] = [];
  const capturedResults: unknown[] = [];
  const run = makeGuardedToolRunner({
    viewer: { userId: "u1", isAdmin: false },
    execute: async () => payload,
    toolsUsed: [],
    capturedResults,
    diagnostics,
  });
  const returned = await run("get_rows", {});

  // What the transport would serialize is exactly what the guard returned.
  const transportRaw = JSON.stringify(returned) ?? "null";
  assert.equal(diagnostics[0]!.bytes, transportRaw.length, "guard bytes must equal the transport's raw length");
  assert.equal(diagnostics[0]!.truncated, transportRaw.length > 16_000);
});
