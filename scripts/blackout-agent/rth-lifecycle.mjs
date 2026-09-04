#!/usr/bin/env node
/**
 * BLACKOUT autonomous RTH lifecycle — single entry for market-open validation.
 *
 * Usage:
 *   npm run blackout:rth-lifecycle
 *   npm run blackout:rth-lifecycle -- --force   # run RTH checks off-hours
 *
 * Runs: session sync → select-task → ops:collect → deploy → platform-integrity → seo → rth-open (if window).
 * See docs/ops/RTH-VALIDATION-LEDGER-2026-09-05.md for per-fix validation matrix.
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const force = process.argv.includes("--force");

function run(cmd, args, opts = {}) {
  console.log(`\n▶ ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { encoding: "utf8", cwd: repoRoot, stdio: "inherit", ...opts });
  return r.status ?? 1;
}

function runJson(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: "utf8", cwd: repoRoot });
  if (r.status !== 0) return null;
  try {
    return JSON.parse(r.stdout);
  } catch {
    return null;
  }
}

console.log("=== BLACKOUT RTH lifecycle ===\n");

run("node", ["scripts/blackout-agent/session-start.mjs", "--agent=cursor"]);

const selected = runJson("node", ["scripts/blackout-agent/select-task.mjs", "--agent=cursor"]);
if (selected?.selected) {
  console.log(`\n📋 Selected: ${selected.selected.id} — ${selected.selected.title}`);
} else {
  console.log("\n⚠ select-task returned no candidates");
}

const steps = [
  ["npm", ["run", "ops:collect"]],
  ["npm", ["run", "validate:deploy"]],
  ["npm", ["run", "validate:api-auth"]],
  ["npm", ["run", "validate:platform-integrity"]],
  ["npm", ["run", "validate:seo"]],
];

if (force) {
  steps.push(["node", ["scripts/rth-open-check.mjs", "--force"]]);
} else {
  steps.push(["npm", ["run", "validate:rth-open"]]);
}

const results = [];
for (const [cmd, args] of steps) {
  const code = run(cmd, args);
  results.push({ step: `${cmd} ${args.join(" ")}`, ok: code === 0 });
}

console.log("\n=== Lifecycle summary ===");
for (const r of results) {
  console.log(`${r.ok ? "✅" : "❌"} ${r.step}`);
}

const failed = results.filter((r) => !r.ok);
if (failed.length) {
  console.log(`\n${failed.length} step(s) failed — see docs/ops/RTH-VALIDATION-LEDGER-2026-09-05.md`);
  process.exit(1);
}

console.log("\nGREEN — lifecycle sweep complete. Continue work loop (select → claim → fix → handoff).");
console.log("Ledger: docs/ops/RTH-VALIDATION-LEDGER-2026-09-05.md");
