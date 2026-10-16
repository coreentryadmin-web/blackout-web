import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(
  join(process.cwd(), "src/components/admin/AdminApiDashboard.tsx"),
  "utf8"
);

// Regression (found 2026-10-16, DISCOVERY sweep): the registry table's probe-status filter tabs
// were a hardcoded literal union ("all" | "ok" | "fail" | "blocked" | "unknown") that silently
// fell out of sync with RegistryProbeStatus (admin-endpoint-registry.ts), which has carried
// "rate_limited" since probeBadge() itself started rendering a dedicated "429" badge for it
// (probe.status === 429 is a real, observed live outcome). An admin had no way to filter the
// table down to just rate-limited endpoints, even though probeBadge/the data model already
// distinguish that status from a generic "fail". Source-text assertion (this repo's convention
// for "use client" components -- see AdminLaunchStatusPanel.test.ts) rather than a render test.
test("AdminApiDashboard: ProbeFilter type derives from RegistryProbeStatus, not a separately hand-maintained literal union", () => {
  assert.match(
    source,
    /type ProbeFilter = "all" \| RegistryProbeStatus;/,
    "ProbeFilter should be tied to the single source of truth so it can't drift from it again"
  );
});

test("AdminApiDashboard: the probe-filter tab list includes every RegistryProbeStatus value", () => {
  const tabsMatch = source.match(
    /\(\["all", "ok", "fail", "blocked", "rate_limited", "unknown"\] as const\)\.map/
  );
  assert.ok(tabsMatch, "probe-filter tabs should render all five statuses, including rate_limited");
});
