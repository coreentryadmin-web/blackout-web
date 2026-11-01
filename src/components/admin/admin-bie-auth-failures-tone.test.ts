import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

// Regression for a live admin-UI bug: the BIE control-room hero's "Auth failures (24h)"
// MetricChip is the one security-relevant stat in that chip row (every sibling chip —
// Embeddings, DB pool, Redis, Missed alerts — conditions its `tone` on whether the metric
// is actually degraded) but was wired with a LITERAL `tone="bull"` (green), so the chip
// renders green regardless of `data.auth_failures.total_24h` — it can never turn amber no
// matter how many real auth failures `countAuthFailures()` (error-sink.ts) reports in the
// window. A dashboard whose whole purpose is to surface problems at a glance silently
// never surfaces this one. Source-text assertion (this repo's convention for "use client"
// components with no React Testing Library, see AdminLaunchStatusPanel.test.ts) rather
// than a render test.
test("AdminBieDashboard's Auth failures chip tone is conditioned on total_24h, not hardcoded", () => {
  const src = readFileSync(
    join(root, "src/components/admin/AdminBieDashboard.tsx"),
    "utf8"
  );
  const match = src.match(
    /label="Auth failures \(24h\)"[\s\S]{0,200}?tone=(\{[\s\S]*?\}|"[a-z]+")/
  );
  assert.ok(match, 'expected to find the "Auth failures (24h)" MetricChip with a tone prop');
  const toneProp = match![1];
  assert.notEqual(
    toneProp,
    '"bull"',
    'Auth failures chip tone must not be hardcoded to "bull" — it must reflect ' +
      "data.auth_failures.total_24h the same way the sibling Missed alerts chip conditions " +
      "its own tone on outage_count"
  );
  assert.match(
    toneProp,
    /total_24h/,
    "Auth failures chip tone must reference total_24h so it actually reflects the failure count"
  );
});
