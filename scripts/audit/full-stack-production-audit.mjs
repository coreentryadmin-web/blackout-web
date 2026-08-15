#!/usr/bin/env node
/**
 * Full-stack production audit orchestrator — membership, security, latency, deploy, ops.
 * Non-destructive probes against live production. Temp Clerk users deleted by child scripts.
 *
 * Usage:
 *   node --import tsx scripts/audit/full-stack-production-audit.mjs
 *   node --import tsx scripts/audit/full-stack-production-audit.mjs --skip-latency
 *   node --import tsx scripts/audit/full-stack-production-audit.mjs --json
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const JSON_OUT = args.includes("--json");
const SKIP_LATENCY = args.includes("--skip-latency");
const OUT = join(process.cwd(), "audit-output");
mkdirSync(OUT, { recursive: true });

const stages = [
  {
    id: "deploy",
    label: "Deploy / health",
    cmd: ["npm", "run", "validate:deploy"],
    required: true,
  },
  {
    id: "ops",
    label: "Ops action items",
    cmd: ["npm", "run", "ops:collect"],
    required: false,
  },
  {
    id: "api-auth",
    label: "API auth guard scan",
    cmd: ["npm", "run", "validate:api-auth"],
    required: true,
  },
  {
    id: "tier-access",
    label: "Tier access matrix (free/community/premium)",
    cmd: ["node", "--import", "tsx", "scripts/audit/tier-access-e2e.mjs"],
    required: true,
  },
  {
    id: "deep-security",
    label: "Deep security (IDOR, cron, webhooks, escalation)",
    cmd: ["node", "--import", "tsx", "scripts/audit/deep-security-audit.mjs"],
    required: true,
  },
  ...(SKIP_LATENCY
    ? []
    : [
        {
          id: "site-latency",
          label: "Site latency (API + browser paint)",
          cmd: ["npm", "run", "validate:site-latency"],
          required: false,
        },
      ]),
];

const results = [];
let anyRequiredFail = false;

function runStage(stage) {
  const t0 = Date.now();
  const r = spawnSync(stage.cmd[0], stage.cmd.slice(1), {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
    maxBuffer: 20 * 1024 * 1024,
  });
  const ms = Date.now() - t0;
  const ok = r.status === 0;
  if (!ok && stage.required) anyRequiredFail = true;
  const row = {
    id: stage.id,
    label: stage.label,
    ok,
    required: stage.required,
    exitCode: r.status ?? 1,
    ms,
    stdoutTail: (r.stdout || "").split("\n").slice(-12).join("\n"),
    stderrTail: (r.stderr || "").split("\n").slice(-6).join("\n"),
  };
  results.push(row);
  if (!JSON_OUT) {
    console.log(`\n── ${stage.label} ──`);
    console.log(ok ? "  GREEN" : stage.required ? "  FAIL (required)" : "  WARN (optional)");
    if (row.stdoutTail) console.log(row.stdoutTail);
    if (row.stderrTail) console.log(row.stderrTail);
  }
  return ok;
}

console.log("\n╔══════════════════════════════════════════════════════════════╗");
console.log("║  BLACKOUT full-stack production audit                        ║");
console.log("╚══════════════════════════════════════════════════════════════╝\n");

for (const stage of stages) {
  runStage(stage);
}

const report = {
  at: new Date().toISOString(),
  target: process.env.AUDIT_APP_URL || "https://blackouttrades.com",
  stages: results,
  summary: {
    total: results.length,
    passed: results.filter((r) => r.ok).length,
    requiredFailed: results.filter((r) => !r.ok && r.required).map((r) => r.id),
    optionalFailed: results.filter((r) => !r.ok && !r.required).map((r) => r.id),
  },
};

const reportPath = join(OUT, `full-stack-audit-${Date.now()}.json`);
writeFileSync(reportPath, JSON.stringify(report, null, 2));

console.log("\n══════════════════════════════════════════════════════════════");
console.log(
  `Summary: ${report.summary.passed}/${report.summary.total} stages green` +
    (report.summary.requiredFailed.length
      ? ` — REQUIRED FAIL: ${report.summary.requiredFailed.join(", ")}`
      : "") +
    (report.summary.optionalFailed.length
      ? ` — optional: ${report.summary.optionalFailed.join(", ")}`
      : "")
);
console.log(`Report: ${reportPath}`);
console.log("══════════════════════════════════════════════════════════════\n");

if (JSON_OUT) console.log(JSON.stringify(report, null, 2));

process.exit(anyRequiredFail ? 1 : 0);
