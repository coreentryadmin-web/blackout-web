#!/usr/bin/env node
/**
 * AGENT PR SWEEP — find agent work that has fallen out of the merge pipeline.
 *
 * ── THE FAILURE THIS EXISTS TO CATCH (2026-08-21) ────────────────────────────────────────────
 *
 * The fleet accumulated 36 open PRs, 28 with `verify` GREEN, and not one could ever merge.
 * Nothing had failed — no red check, no error, no agent complaint. The PRs simply sat. Read from
 * the outside it looked like the agents had died or the connection to them had broken; in fact
 * they had finished their work correctly and handed it over exactly as instructed.
 *
 * Two standing rules, each sensible alone, formed a deadlock: the agent harness says "open the PR
 * as a draft", and repo policy says "do not auto-merge draft PRs". Every agent PR was therefore
 * born in a state policy forbids merging, and nothing ever moved it out of that state.
 *
 * THE GENERAL LESSON, which is why this is a committed tool and not a one-off query: a jam made of
 * two individually-correct rules produces NO error signal. There is nothing to alert on. It can
 * only be found by asking the system what state it is actually in — which means sweeping by STATE,
 * never by memory of what was launched. A coordinator that tracks "which agents did I start" will
 * miss this every time; one that asks "what is green and not merging" finds it immediately.
 *
 * ── WHAT IT REPORTS ──────────────────────────────────────────────────────────────────────────
 *
 * Every open agent PR bucketed by what is actually blocking it:
 *   READY-BUT-DRAFT  green CI, still a draft — finished work outside the pipeline. THE JAM.
 *   CI-RUNNING       still building; nothing to do but wait.
 *   CI-FAILED        needs an agent, not a merge.
 *   CONFLICTED       needs a rebase.
 *   MERGEABLE        non-draft and green — auto-merge should be taking it.
 *
 * Read-only unless `--mark-ready` is passed, which marks READY-BUT-DRAFT PRs ready for review so
 * `automerge.yml` picks them up. That flag is deliberately opt-in and bounded by `--limit`:
 * marking a PR ready starts a merge that ships to production, so it is a decision, not a sweep.
 *
 * Usage:
 *   node scripts/audit/agent-pr-sweep.mjs [--json] [--prefix=claude/,cursor/]
 *   node scripts/audit/agent-pr-sweep.mjs --mark-ready --limit=5 [--only=2422,2423]
 *
 * Auth: GITHUB_TOKEN (or GH_TOKEN). Never printed.
 */

import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const flag = (n, d = null) => {
  const hit = args.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};
const has = (n) => args.includes(`--${n}`);

const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
const REPO = flag("repo", "coreentryadmin-web/blackout-web");
// `fix/` and `batch/` are the COORDINATOR's own prefixes, and they are in the default set for a
// reason learned the hard way: on 2026-08-21 this sweep was used all day to find agent PRs that had
// gone green and stalled, while the coordinator's own #2456 sat green and drafted for six hours —
// invisible to the tool because it was on `fix/`. The coordinator tracked it from memory ("that one
// is in flight") instead of by state, which is precisely the failure this script exists to prevent,
// committed by the person running it.
//
// A coordinator's own PRs are the ones NOBODY ELSE is watching. They belong in the sweep most of all.
const PREFIXES = flag("prefix", "claude/,cursor/,fix/,batch/,docs/").split(",").filter(Boolean);
const JSON_OUT = has("json");
const MARK_READY = has("mark-ready");
const LIMIT = Number(flag("limit", "0")) || 0;
const ONLY = (flag("only", "") || "").split(",").map((s) => s.trim()).filter(Boolean);

if (!TOKEN) {
  console.error("GITHUB_TOKEN (or GH_TOKEN) is required.");
  process.exit(1);
}

/**
 * curl rather than fetch, and rather than the GitHub MCP server.
 *
 * The MCP server carries its OWN rate-limit budget, and exhausting it (a coordinator polling CI
 * every 45s will) takes down every GitHub capability at once while the REST quota on the same
 * token sits nearly untouched. Measured 2026-08-21: MCP exhausted, REST 14,983/15,000 remaining.
 */
function api(path, { method = "GET", body = null } = {}) {
  const a = ["-s", "-X", method,
    "-H", `Authorization: Bearer ${TOKEN}`,
    "-H", "Accept: application/vnd.github+json",
    `https://api.github.com/repos/${REPO}${path}`];
  if (body) a.push("-H", "Content-Type: application/json", "-d", JSON.stringify(body));
  try {
    return JSON.parse(execFileSync("curl", a, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }));
  } catch {
    return null;
  }
}

/** Roll many check runs into one verdict. Unknown must never read as pass. */
function summarizeChecks(runs) {
  if (!runs || runs.length === 0) return "none";
  if (runs.some((r) => r.status !== "completed")) return "running";
  const cc = runs.map((r) => r.conclusion);
  if (cc.some((c) => c === "failure" || c === "timed_out" || c === "cancelled")) return "failed";
  return "pass";
}

function classify(pr, verify, all) {
  if (verify === "failed" || all === "failed") return "CI-FAILED";
  if (pr.mergeable === false) return "CONFLICTED";
  if (verify === "running" || all === "running") return "CI-RUNNING";
  if (pr.draft && verify === "pass") return "READY-BUT-DRAFT";
  if (!pr.draft && verify === "pass") return "MERGEABLE";
  return "OTHER";
}

function main() {
  const open = [];
  for (let page = 1; page <= 5; page += 1) {
    const batch = api(`/pulls?state=open&per_page=100&page=${page}`);
    if (!Array.isArray(batch) || batch.length === 0) break;
    open.push(...batch);
    if (batch.length < 100) break;
  }
  const agents = open.filter((p) => PREFIXES.some((pre) => p.head?.ref?.startsWith(pre)));

  const rows = agents.map((p) => {
    const full = api(`/pulls/${p.number}`) ?? p;
    const cr = api(`/commits/${p.head.sha}/check-runs`);
    const runs = cr?.check_runs ?? [];
    const verify = summarizeChecks(runs.filter((r) => r.name.toLowerCase().includes("verify")));
    const all = summarizeChecks(runs);
    return {
      number: p.number,
      title: p.title,
      branch: p.head.ref,
      draft: Boolean(full.draft),
      mergeable: full.mergeable,
      verify,
      all,
      bucket: classify(full, verify, all),
    };
  });
  rows.sort((a, b) => b.number - a.number);

  const buckets = {};
  for (const r of rows) (buckets[r.bucket] ??= []).push(r);

  if (JSON_OUT) {
    console.log(JSON.stringify({ repo: REPO, total: rows.length, buckets }, null, 2));
  } else {
    console.log(`Agent PR sweep — ${REPO} (${rows.length} open agent PRs)\n`);
    for (const [name, list] of Object.entries(buckets).sort((a, b) => b[1].length - a[1].length)) {
      console.log(`${name}  (${list.length})`);
      for (const r of list) console.log(`  #${r.number}  ${r.title.slice(0, 76)}`);
      console.log();
    }
    const jam = buckets["READY-BUT-DRAFT"] ?? [];
    const mine = jam.filter((r) => !r.branch.startsWith("claude/") && !r.branch.startsWith("cursor/"));
    if (mine.length > 0) {
      console.log(
        `${mine.length} of these are on a COORDINATOR branch (${mine.map((r) => "#" + r.number).join(", ")}).\n` +
        `Nobody else is watching those — an agent PR at least has a lane that will notice.\n`
      );
    }
    if (jam.length > 0) {
      console.log(
        `THE JAM: ${jam.length} PR(s) have green CI and are still drafts. That is finished work\n` +
        `outside the merge pipeline, not work in progress. Review, then mark ready:\n` +
        `  node scripts/audit/agent-pr-sweep.mjs --mark-ready --limit=5\n`
      );
    }
  }

  if (!MARK_READY) return;

  let jam = buckets["READY-BUT-DRAFT"] ?? [];
  if (ONLY.length > 0) jam = jam.filter((r) => ONLY.includes(String(r.number)));
  if (LIMIT > 0) jam = jam.slice(0, LIMIT);
  if (jam.length === 0) {
    console.log("Nothing to mark ready.");
    return;
  }

  // Marking ready starts a merge that ships to production. Bounded and announced, never silent.
  console.log(`\nMarking ${jam.length} PR(s) ready for review…`);
  for (const r of jam) {
    const res = api(`/pulls/${r.number}`, { method: "PATCH", body: { draft: false } });
    const ok = res && res.draft === false;
    console.log(`  #${r.number}  ${ok ? "ready" : "FAILED — left as draft"}`);
  }
}

main();
