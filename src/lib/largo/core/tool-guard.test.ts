import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkToolEntitlement,
  declaredEntitlement,
  formatToolDiagnostics,
  makeGuardedToolRunner,
  type ToolCallDiagnostic,
} from "./tool-guard";
import { LARGO_CAPABILITIES } from "@/lib/largo/registry/capability-registry";
import { LARGO_TOOL_DEFS } from "@/lib/largo/tool-defs";

const premiumTool = LARGO_CAPABILITIES.find((c) => c.entitlement === "premium")!.tool;

// A SYNTHETIC catalog. The real registry declares `premium` on all 49 of its capabilities today,
// so enforcement against it is armed but inert — testing the gate against the real catalog would
// pass vacuously and prove nothing. This proves the mechanism; the test below pins the real
// catalog's current state separately, so the day a capability is marked admin it is a deliberate,
// visible change.
const adminTool = "get_zerodte_rejections";
const CATALOG = [
  { ...LARGO_CAPABILITIES[0]!, id: "test.admin", tool: adminTool, entitlement: "admin" as const },
  { ...LARGO_CAPABILITIES[0]!, id: "test.premium", tool: premiumTool, entitlement: "premium" as const },
];
const uncatalogued = LARGO_TOOL_DEFS.map((t) => t.name).find(
  (n) => !LARGO_CAPABILITIES.some((c) => c.tool === n)
)!;

const ADMIN = { userId: "u_admin", isAdmin: true };
const MEMBER = { userId: "u_member", isAdmin: false };

test("the fixtures this file depends on actually exist", () => {
  assert.ok(premiumTool);
  assert.ok(uncatalogued, "no uncatalogued tool — the fail-open policy is untested");
  assert.ok(
    LARGO_TOOL_DEFS.some((t) => t.name === adminTool),
    "the synthetic admin fixture must name a REAL tool, or the test proves nothing about routing"
  );
});

test("the real registry currently restricts nothing — recorded, not assumed", () => {
  // Honest state, pinned. Every one of the 49 catalogued capabilities declares `premium`, so this
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
  // The policy that keeps this shippable. 49 of 116 tools are catalogued; failing closed on the
  // rest would silently disable most of Largo, and the symptom ("Largo got worse at everything")
  // would be almost impossible to trace here.
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
