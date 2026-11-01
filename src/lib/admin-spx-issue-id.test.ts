import { test } from "node:test";
import assert from "node:assert/strict";
import { pushWithStableId, stableIssueId } from "./admin-spx-issue-id";
import { maybeAlertCriticalIssues } from "./admin-critical-alerts";
import type { SpxAdminIssue } from "./admin-spx-issues";

test("stableIssueId: matches admin-incidents.ts's fingerprintFor format (category:title, no index, no truncation)", () => {
  assert.equal(stableIssueId("flow", "Flow data stale"), "flow:Flow data stale");
  // A title longer than the OLD formula's 24-char slice must survive in full — the id is now
  // the SAME string admin-incidents.ts's fingerprintFor computes, which never truncates either.
  const longTitle = "This title is deliberately longer than twenty-four characters";
  assert.equal(stableIssueId("websocket", longTitle), `websocket:${longTitle}`);
});

// `pushWithStableId` IS `admin-spx-issues.ts`'s `push()` helper's actual id-assignment
// mechanism — that function just delegates to this one. Exercising it directly here (rather
// than through `buildSpxAdminIssues`, which transitively imports "server-only"-guarded
// providers and cannot run under the plain node test runner) tests the real production code
// path the bug lived in, not just the standalone `stableIssueId` formula.
test("pushWithStableId: a later issue's id does not depend on how many unrelated issues were pushed before it", () => {
  type Row = { category: string; title: string; severity: "critical" };

  // Build A: an unrelated "database" issue fires FIRST (e.g. a transient Postgres hiccup),
  // landing ahead of "flow" in the array — this is the exact shape every `push()` call site in
  // admin-spx-issues.ts produces, since each one is gated by its own, unrelated condition.
  const buildA: Array<Row & { id: string }> = [];
  pushWithStableId(buildA, { category: "database", title: "Postgres unreachable", severity: "critical" });
  pushWithStableId(buildA, { category: "flow", title: "Flow data stale", severity: "critical" });

  // Build B: the database hiccup has already cleared by this poll, so "flow" is now the ONLY
  // (and therefore first) issue pushed — nothing about the flow issue itself changed.
  const buildB: Array<Row & { id: string }> = [];
  pushWithStableId(buildB, { category: "flow", title: "Flow data stale", severity: "critical" });

  const flowIdInBuildA = buildA.find((r) => r.category === "flow")!.id;
  const flowIdInBuildB = buildB.find((r) => r.category === "flow")!.id;

  // THIS IS THE REGRESSION: under the old `${category}:${issues.length}:${title.slice(0,24)}`
  // formula, flowIdInBuildA would be "flow:1:Flow data stale" (second item pushed) while
  // flowIdInBuildB would be "flow:0:Flow data stale" (first item pushed) — two different ids
  // for the exact same logical issue, purely because an unrelated issue's presence shifted its
  // array position.
  assert.equal(flowIdInBuildA, flowIdInBuildB);
  assert.equal(flowIdInBuildA, "flow:Flow data stale");
});

test("pushWithStableId: an explicitly supplied id is never overridden", () => {
  const issues: Array<{ id: string; category: string; title: string; severity: "warning" }> = [];
  pushWithStableId(issues, { id: "custom:fixed-id", category: "rate_limit", title: "x hit rate limits", severity: "warning" });
  assert.equal(issues[0].id, "custom:fixed-id");
});

function issueWithId(
  id: string,
  category: string,
  title: string,
  detail = ""
): SpxAdminIssue {
  return { id, severity: "critical", category, title, detail };
}

test("maybeAlertCriticalIssues: a persistent critical issue is not re-alerted merely because an unrelated earlier issue's presence changed its position in the array", async () => {
  // Force the DB-unconfigured path (bootstrapSeenFromDb no-ops) so this test exercises only the
  // in-memory dedup the bug actually lives in, rather than racing a real (and here, unreachable)
  // Postgres connection attempt. Restored afterward so no other test in this file/process sees a
  // mutated env.
  const prevDatabaseUrl = process.env.DATABASE_URL;
  const prevDatabasePublicUrl = process.env.DATABASE_PUBLIC_URL;
  delete process.env.DATABASE_URL;
  delete process.env.DATABASE_PUBLIC_URL;
  try {
    // End-to-end consequence of the bug: admin-critical-alerts.ts's dedup set is keyed by
    // `issue.id`. Build the SAME two polls `buildSpxAdminIssues`/`push()` would produce across
    // two real cycles — via the SAME `pushWithStableId` production code admin-spx-issues.ts's
    // `push()` delegates to — first with an unrelated "database" issue firing ahead of "flow",
    // then without it.
    type Row = { category: string; title: string; severity: "critical"; detail: string };
    const buildA: Array<Row & { id: string }> = [];
    pushWithStableId(buildA, { category: "database", title: "Postgres unreachable", severity: "critical", detail: "SELECT 1 failed" });
    pushWithStableId(buildA, { category: "flow", title: "Flow data stale", severity: "critical", detail: "Last flow update 200s ago" });

    const buildB: Array<Row & { id: string }> = [];
    pushWithStableId(buildB, { category: "flow", title: "Flow data stale", severity: "critical", detail: "Last flow update 260s ago" });

    const firstAlerted = await maybeAlertCriticalIssues(buildA.map((r) => issueWithId(r.id, r.category, r.title, r.detail)));
    assert.equal(firstAlerted, 2, "both issues are genuinely new on the first poll");

    // Second poll: the unrelated database issue has cleared, so "flow" is now built first
    // instead of second. With the pre-fix id scheme this is a DIFFERENT id and would wrongly
    // read as a brand-new critical issue, re-paging ops for an incident Discord already knows
    // about.
    const secondAlerted = await maybeAlertCriticalIssues(buildB.map((r) => issueWithId(r.id, r.category, r.title, r.detail)));
    assert.equal(
      secondAlerted,
      0,
      "the still-ongoing flow-stale issue must not re-alert just because an unrelated earlier issue disappeared"
    );
  } finally {
    if (prevDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = prevDatabaseUrl;
    if (prevDatabasePublicUrl === undefined) delete process.env.DATABASE_PUBLIC_URL;
    else process.env.DATABASE_PUBLIC_URL = prevDatabasePublicUrl;
  }
});
