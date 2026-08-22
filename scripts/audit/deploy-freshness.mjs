#!/usr/bin/env node
/**
 * Is production actually running what is on `main`?
 *
 * ── WHY ──────────────────────────────────────────────────────────────────────────────────────
 *
 * Merging is loud; deploying is silent. A merge posts a green check and a notification. A deploy
 * that never STARTS posts nothing at all — there is no run to be red, no event to subscribe to,
 * nothing to notice. So "merged" quietly gets read as "shipped".
 *
 * Measured 2026-08-22: three commits touching `src/**` and `public/**` sat on `main` for ~5 hours
 * with no `ecr-push-production` run. CI, CodeQL and Deploy-smoke all fired on those same pushes;
 * the deploy workflow alone did not. The member-facing symptom was a 404 on an asset merged hours
 * earlier, and it was found by a lane trying to verify its own work on prod — not by any
 * coordinator check, mine included, while I ran a release loop straight through the window.
 *
 * ── WHAT IT ASKS ─────────────────────────────────────────────────────────────────────────────
 *
 * Not "was there a deploy recently" — that cries wolf on every docs merge, because the workflow
 * has a `paths:` filter and is SUPPOSED to skip those. The narrower, answerable question is:
 *
 *     is there a commit matching the deploy paths with no deploy run created after it?
 *
 * Verdict logic is pure and unit-tested in `lib/deploy-freshness-eval.mjs`; this file is the
 * git + GitHub plumbing around it.
 *
 * Usage:  node scripts/audit/deploy-freshness.mjs [--since=6h] [--json]
 * Exit 0 = ok or unknown, 1 = production is behind. Auth: GITHUB_TOKEN (never printed).
 */

import { execFileSync } from "node:child_process";

import { evaluateDeployFreshness } from "./lib/deploy-freshness-eval.mjs";

const REPO = "coreentryadmin-web/blackout-web";
const WORKFLOW = "ecr-push-production.yml";
const args = process.argv.slice(2);
const JSON_OUT = args.includes("--json");
const sinceArg = (args.find((a) => a.startsWith("--since=")) || "--since=12h").split("=")[1];

function hoursFrom(spec) {
  const m = /^(\d+)([hd])$/.exec(spec);
  if (!m) return 12;
  return m[2] === "d" ? Number(m[1]) * 24 : Number(m[1]);
}

function git(a) {
  try {
    return execFileSync("git", a, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return null;
  }
}

function api(path) {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!token) return null;
  try {
    const out = execFileSync(
      "curl",
      ["-s", "-H", `Authorization: Bearer ${token}`, `https://api.github.com${path}`],
      { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
    );
    return JSON.parse(out);
  } catch {
    return null;
  }
}

const hours = hoursFrom(sinceArg);
const sinceIso = new Date(Date.now() - hours * 3600_000).toISOString();

git(["fetch", "-q", "origin", "main"]);
const shas = (git(["log", "--format=%H", "origin/main", `--since=${sinceIso}`]) || "")
  .split("\n")
  .filter(Boolean);

const commits = shas.map((sha) => ({
  sha,
  isoDate: (git(["show", "-s", "--format=%cI", sha]) || "").trim(),
  files: (git(["show", "--name-only", "--format=", sha]) || "").split("\n").filter(Boolean),
  subject: (git(["show", "-s", "--format=%s", sha]) || "").trim(),
}));

const runs = api(`/repos/${REPO}/actions/workflows/${WORKFLOW}/runs?per_page=30`);
const deployRuns = runs?.workflow_runs?.map((r) => ({
  createdAt: r.created_at,
  headSha: r.head_sha,
  status: r.status,
  conclusion: r.conclusion,
}));

const result = evaluateDeployFreshness({
  commits,
  // Distinguish "the API failed" from "there are no runs" — the first is UNKNOWN, the second is
  // a real finding. Collapsing them would report an unreachable API as a healthy pipeline.
  deployRuns: runs == null ? undefined : (deployRuns ?? []),
  nowIso: new Date().toISOString(),
});

if (JSON_OUT) {
  console.log(JSON.stringify({ repo: REPO, window: sinceArg, ...result }, null, 2));
} else {
  console.log(`Deploy freshness — ${REPO} (last ${sinceArg}, ${commits.length} commit(s) on main)\n`);
  console.log(`  newest deploy run created: ${result.newestDeployAt ?? "(none in the last 30 runs)"}`);
  console.log(`  verdict: ${result.verdict.toUpperCase()} — ${result.reason}`);
  if (result.verdict === "behind") {
    console.log(`\n  Deploy-worthy commits with NO deploy run after them:`);
    for (const c of result.undeployed) {
      console.log(`    ${c.sha.slice(0, 8)}  ${c.isoDate}  ${(c.subject || "").slice(0, 62)}`);
    }
    if (result.ageMin != null) console.log(`\n  Oldest has been undeployed for ~${result.ageMin} minute(s).`);
    console.log(`\n  This is not self-healing on its own schedule — re-run the workflow`);
    console.log(`  (workflow_dispatch) or push a deploy-path commit to force it.`);
  }
  if (result.verdict === "unknown") {
    console.log(`\n  NOT a pass. The check could not read what it needs; do not treat this as healthy.`);
  }
}

process.exit(result.verdict === "behind" ? 1 : 0);
