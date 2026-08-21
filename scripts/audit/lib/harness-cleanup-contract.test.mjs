/**
 * The audit harnesses' temp-Clerk-user cleanup contract, as a test.
 *
 * Most harnesses in scripts/audit/ mint ONE temp admin+premium Clerk user against PRODUCTION and
 * state in their header that it is "deleted in a `finally`". That user has no TTL: if a run ends
 * without deleting it, a privileged account sits on live Clerk until someone notices by hand.
 *
 * `gex-wall-snapshot-poll.mjs` carried that sentence and had no `finally` at all — cleanup was
 * three hand-placed calls (normal end, one early return, main().catch) which between them missed
 * the signal path. That file is documented to run unattended for tens of minutes under `nohup/&`,
 * so SIGINT/SIGTERM is not an edge case, it is the normal way it ends.
 *
 * Run: node --test scripts/audit/lib/harness-cleanup-contract.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const AUDIT_DIR = fileURLToPath(new URL("../", import.meta.url));

/** Header block comment, where the claim lives.
 *  Strip a shebang first: anchoring at `^\s*\/\*` makes every `#!/usr/bin/env node` harness fall
 *  out of the scan silently — a filter that does not filter, which is the exact defect class this
 *  file exists to catch. It skipped the very file this test was written for. */
function header(src) {
  const body = src.replace(/^#![^\n]*\n/, "");
  const m = body.match(/^\s*\/\*[\s\S]*?\*\//);
  return m ? m[0] : "";
}

const CLAIMS_FINALLY = /(deleted|released|cleaned up|delete[sd]?)[^.]{0,60}in an?\s*`?finally`?/i;
const HAS_FINALLY = /finally\s*\{|\.finally\s*\(/;

async function auditSources() {
  const out = [];
  for (const name of await readdir(AUDIT_DIR)) {
    if (!/\.(mjs|cjs|mts)$/.test(name) || /\.test\./.test(name)) continue;
    const full = join(AUDIT_DIR, name);
    out.push([name, await readFile(full, "utf8")]);
  }
  return out;
}

test("every harness that claims cleanup 'in a finally' actually has one", async () => {
  const offenders = [];
  for (const [name, src] of await auditSources()) {
    if (!CLAIMS_FINALLY.test(header(src))) continue;
    if (!HAS_FINALLY.test(src)) offenders.push(name);
  }
  assert.deepEqual(
    offenders,
    [],
    "These state in their header that the temp Clerk user is deleted in a `finally`, but contain " +
      "no finally construct. A leaked temp user is a live admin+premium account on production " +
      "Clerk with no TTL."
  );
});

test("gex-wall-snapshot-poll cleans up on SIGINT/SIGTERM, not just on the happy path", async () => {
  const src = await readFile(join(AUDIT_DIR, "gex-wall-snapshot-poll.mjs"), "utf8");

  assert.match(src, /process\.on\(\s*["']SIGINT["']/, "must register a SIGINT handler");
  assert.match(src, /process\.on\(\s*["']SIGTERM["']/, "must register a SIGTERM handler");
  assert.match(src, /\.finally\s*\(/, "the documented `finally` must exist");

  // The signal handler is worthless if it does not reach the delete.
  const handler = src.slice(src.indexOf("function _signalCleanup"), src.indexOf('process.on("SIGTERM"'));
  assert.match(handler, /cleanup\(\)/, "the signal handler must call cleanup()");

  // Idempotence: finally + signal + early-exit paths can all reach cleanup in one run.
  const body = src.slice(src.indexOf("async function cleanup()"));
  assert.match(body.slice(0, 200), /_cleanedUp/, "cleanup() must be idempotent");
});

test("the poller verifies the delete instead of assuming it", async () => {
  const src = await readFile(join(AUDIT_DIR, "gex-wall-snapshot-poll.mjs"), "utf8");
  const body = src.slice(src.indexOf("async function cleanup()"), src.indexOf("function _signalCleanup"));
  assert.match(body, /backend\("DELETE"/, "must DELETE the user");
  assert.match(body, /backend\("GET"/, "must read back to confirm the user is gone (404)");
});
