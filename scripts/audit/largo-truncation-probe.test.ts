import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { LARGO_TOOL_DEFS } from "@/lib/largo/tool-defs";

/**
 * largo-truncation-probe.mjs runs unconditionally on import (mints a live Clerk session, exits
 * the process) — it can never be imported directly by a test. Its LANE_TOOLS list is read as
 * source text instead, the same convention sse-stream-entitlement.test.ts uses for a file that
 * can't be safely imported either.
 *
 * `get_swing_discovery` sat in LANE_TOOLS from 2026-08-23 to 2026-09-09 despite never having been
 * a real tool — every probe run against it came back INDETERMINATE, and FINDINGS.md misattributed
 * that to "needs compound arguments a generic probe can't synthesize" rather than the real reason
 * (the model correctly said it has no such tool). This guard stops that class of drift: every name
 * in LANE_TOOLS must be a real, currently-defined Largo tool.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("every LANE_TOOLS entry in largo-truncation-probe.mjs names a real, currently-defined Largo tool", () => {
  const src = readFileSync(join(root, "scripts/audit/largo-truncation-probe.mjs"), "utf8");
  const laneToolsSrc = src.slice(src.indexOf("const LANE_TOOLS"), src.indexOf("const DEFAULT_CONTROL"));
  const names = [...laneToolsSrc.matchAll(/\["([a-z_]+)",/g)].map((m) => m[1]);
  assert.ok(names.length > 100, `expected 100+ probed tool names, found ${names.length} — the slice boundaries may be stale`);

  const realNames = new Set(LARGO_TOOL_DEFS.map((d) => d.name));
  const phantom = names.filter((n) => !realNames.has(n));
  assert.deepEqual(phantom, [], `LANE_TOOLS names a tool that does not exist in LARGO_TOOL_DEFS: ${phantom.join(", ")}`);
});

test("get_swing_discovery is gone for good — it was never a real tool", () => {
  const src = readFileSync(join(root, "scripts/audit/largo-truncation-probe.mjs"), "utf8");
  assert.doesNotMatch(src, /"get_swing_discovery"/);
});
