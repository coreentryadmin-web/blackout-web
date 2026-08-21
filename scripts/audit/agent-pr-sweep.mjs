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
 *   CONFLICTED       needs a rebase. NOTE: a conflicted PR also has NO CI RUN AT ALL — see below.
 *   MERGEABLE        non-draft and green — auto-merge should be taking it.
 *
 * ── "verify NEVER RAN" IS NOT A SECOND PROBLEM (measured 2026-08-21) ─────────────────────────
 *
 * A conflicted PR shows ZERO workflow runs on its head SHA — not queued, not skipped, absent. That
 * reads as a broken CI trigger and sends you looking for a cause that does not exist. It is the
 * SAME fact as the conflict: `ci.yml` runs `on: pull_request`, GitHub builds those runs against
 * `refs/pull/N/merge`, and for a conflicted PR that ref cannot be created, so no run is ever
 * started.
 *
 * Measured decisively on #2563, one branch, two pushes: an empty commit while the PR was
 * conflicted produced **0** workflow runs; resolving the conflict and pushing produced **4**
 * immediately. Nothing else changed.
 *
 * The consequence for this sweep: never report "no CI run" as its own bucket or chase it as its
 * own remedy. It resolves when the conflict does. Treating them as two problems doubles the work
 * and invents a phantom infrastructure fault — which is what happened before this note was written.
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
const CHOKEPOINTS = has("chokepoints");
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
  // `-w` appends the HTTP status on its own line. WITHOUT IT THIS FUNCTION CANNOT TELL A REAL
  // ANSWER FROM A REFUSAL: a 403 returns `{"message":"..."}`, which parses as perfectly good JSON.
  // The old version swallowed every failure into `null`, and `main()` then read a non-array as
  // "no more pages" and reported **"0 open agent PRs"** — a clean, confident, entirely false
  // all-clear from the one instrument built to catch silent jams. Found by the x-content lane,
  // whose token was unauthorized for the whole run while the sweep told it the backlog was empty.
  const a = ["-s", "-w", "\n%{http_code}", "-X", method,
    "-H", `Authorization: Bearer ${TOKEN}`,
    "-H", "Accept: application/vnd.github+json",
    `https://api.github.com/repos/${REPO}${path}`];
  if (body) a.push("-H", "Content-Type: application/json", "-d", JSON.stringify(body));

  let raw;
  try {
    raw = execFileSync("curl", a, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  } catch (e) {
    return { ok: false, status: 0, data: null, error: `curl failed: ${e.message}` };
  }
  const nl = raw.lastIndexOf("\n");
  const status = Number(raw.slice(nl + 1).trim());
  let data = null;
  try {
    data = JSON.parse(raw.slice(0, nl));
  } catch {
    /* a non-JSON body is itself reported below via `ok` */
  }
  const ok = status >= 200 && status < 300;
  // The API's own `message` is the most useful thing to show a human — "Bad credentials",
  // "API rate limit exceeded", "Not Found" each imply a different next move.
  const error = ok ? null : (data?.message ?? `HTTP ${status}`);
  return { ok, status, data, error };
}

/** For calls whose failure must stop the run rather than shrink the answer. */
function apiOrDie(path, what) {
  const r = api(path);
  if (!r.ok) {
    console.error(`\nagent-pr-sweep: FAILED to ${what}.`);
    console.error(`  HTTP ${r.status}: ${r.error}`);
    if (r.status === 401) console.error("  The token is not valid for this repo. Check GITHUB_TOKEN/GH_TOKEN.");
    if (r.status === 403) console.error("  Authorized but refused — usually a rate limit, or the repo is not in this session's scope.");
    if (r.status === 404) console.error(`  ${REPO} is not visible to this token (a private repo returns 404, not 403).`);
    console.error("\nRefusing to print a sweep. An empty roster and an unreachable API must never look the same.\n");
    process.exit(2);
  }
  return r.data;
}

/** Roll many check runs into one verdict. Unknown must never read as pass. */
function summarizeChecks(runs) {
  if (!runs || runs.length === 0) return "none";
  if (runs.some((r) => r.status !== "completed")) return "running";
  const cc = runs.map((r) => r.conclusion);
  if (cc.some((c) => c === "failure" || c === "timed_out" || c === "cancelled")) return "failed";
  return "pass";
}

/**
 * Which releasable PRs touch the same file — the ordering dependencies `automerge.yml` cannot see.
 *
 * WHY THIS EXISTS. On 2026-08-21 two individually-green PRs broke `main` when composed: #2482 fixed
 * a file that #2421's new allowlist still listed as broken, so whichever merged second was wrong.
 * `automerge.yml` merges by check-completion time, which is effectively random, so releasing both
 * at once is a coin flip. `CLAUDE.md` now carries the rule; this is the check that makes it
 * cheap enough to actually follow.
 *
 * `docs/` is excluded because `FINDINGS.md` collides between EVERY pair of agent PRs by
 * construction — every lane appends at the same anchor. Including it would flag all N-choose-2
 * pairs and the signal would be worth nothing. That collision is real but it is a known,
 * mechanically-resolved one (`findings-merge-resolve.mjs`), not an ordering dependency.
 */
function collisionsAmong(rows) {
  const files = new Map();
  for (const r of rows) {
    const res = api(`/pulls/${r.number}/files?per_page=100`);
    if (!res.ok || !Array.isArray(res.data)) {
      // An unreadable file list must not read as "touches nothing", which would report the PR as
      // safe to release beside anything. Same absence-as-measurement trap as everywhere else.
      files.set(r.number, null);
      continue;
    }
    files.set(r.number, new Set(
      res.data.map((f) => f.filename).filter((f) => !f.startsWith("docs/"))
    ));
  }

  const pairs = [];
  const unknown = [];
  const nums = rows.map((r) => r.number);
  for (const n of nums) if (files.get(n) === null) unknown.push(n);
  for (let i = 0; i < nums.length; i += 1) {
    for (let j = i + 1; j < nums.length; j += 1) {
      const a = files.get(nums[i]); const b = files.get(nums[j]);
      if (!a || !b) continue;
      const shared = [...a].filter((f) => b.has(f));
      if (shared.length) pairs.push({ a: nums[i], b: nums[j], files: shared.sort() });
    }
  }
  const entangled = new Set(pairs.flatMap((p) => [p.a, p.b]));
  const safe = nums.filter((n) => !entangled.has(n) && files.get(n) !== null);
  return { pairs, safe, unknown };
}

/**
 * Which FILES the open agent PRs contend on — the structural cause of the pair-wise collisions
 * that `collisionsAmong` reports one at a time.
 *
 * WHY THIS IS A DIFFERENT QUESTION. The pair list answers "can I release these two together". This
 * answers "why does that question keep having a bad answer". Measured 2026-08-21 across 30 open
 * agent PRs:
 *
 *     src/lib/largo/tool-defs.ts        16 PRs   helix,meridian,nighthawk,thermal,vector
 *     src/lib/largo/product-reads.ts     9 PRs   helix,nighthawk,thermal,vector
 *
 * More than half the fleet's open work touches ONE file, and every product lane touches it. That is
 * not bad luck, it is the shape of the code: both files are per-product registries in a single
 * module, so a lane cannot ship anything Largo-facing without editing a file every other lane is
 * also editing. Collisions are therefore permanent and independent of how carefully anyone
 * sequences releases.
 *
 * The fix is to split them per product behind a barrel, and the cost of that split is one rebase
 * for every PR currently touching the file — so it must be done when the backlog is SMALL. This
 * flag exists to tell you when that window has arrived, rather than guessing. Run it before
 * planning the split; if `tool-defs.ts` is still in double digits, it is not the moment.
 *
 * `docs/` is excluded for the same reason as everywhere else: FINDINGS.md is touched by every agent
 * PR by construction and would top this list while telling you nothing.
 */
function chokepoints(rows) {
  const counts = new Map();
  const lanes = new Map();
  let unreadable = 0;
  for (const r of rows) {
    const res = api(`/pulls/${r.number}/files?per_page=100`);
    if (!res.ok || !Array.isArray(res.data)) { unreadable += 1; continue; }
    const lane = r.branch.split("/")[1]?.split("-")[0] ?? "?";
    for (const f of res.data) {
      const fn = f.filename;
      if (fn.startsWith("docs/")) continue;
      counts.set(fn, (counts.get(fn) ?? 0) + 1);
      if (!lanes.has(fn)) lanes.set(fn, new Set());
      lanes.get(fn).add(lane);
    }
  }
  const ranked = [...counts.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .map(([file, n]) => ({ file, prs: n, lanes: [...lanes.get(file)].sort() }));
  return { ranked, unreadable, scanned: rows.length - unreadable };
}

/**
 * The set of green drafts that ACTUALLY merge together — established by trial merge, not by
 * guessing from filenames.
 *
 * WHY THIS REPLACED THE FILE-OVERLAP HEURISTIC. `collisionsAmong` blocks any two PRs that touch the
 * same file. That is sound but far too conservative: two PRs editing distant hunks of a 1154-line
 * registry do not conflict, and git knows it. Measured 2026-08-21 on 25 green drafts — file-overlap
 * cleared **1** for release; real trial merges cleared **5**. A 5x throughput difference, and the
 * heuristic was leaving four finished PRs sitting in the queue for no reason.
 *
 * That matters more than it sounds. A guard that is too strict does not look like a bug — the
 * output is a smaller number, not an error — so it can throttle the pipeline indefinitely while
 * appearing to work correctly. Over-blocking is as real a defect as under-blocking; it is just
 * quieter.
 *
 * HOW. `git merge-tree --write-tree` (git 2.38+) performs a real merge into a tree object without
 * touching the working tree or index, and exits non-zero on conflict. We accumulate: start at
 * `origin/main`, try each candidate against the running result, keep the ones that apply cleanly.
 * The accumulation is what makes this a RELEASE SET rather than a list of individually-mergeable
 * PRs — each is tested against the others already in the set, which is the actual question when
 * they will all land in the same window.
 *
 * ORDER IS OLDEST-FIRST and that is deliberate: the oldest PR has waited longest and is most likely
 * to be rebased away if it keeps losing. Greedy-by-age is fair; greedy-by-size would starve them.
 *
 * A candidate whose ref cannot be fetched is reported as UNKNOWN and excluded — never silently
 * treated as clean, which would recommend releasing something we could not test.
 */
function trialMergeSet(rows) {
  // FETCH FIRST. Without this every `rev-parse origin/<branch>` misses and the whole set reports
  // "ref not fetched" — which is not a wrong answer, but it is an EMPTY one, and an empty answer
  // here silently falls back to the conservative heuristic while looking like it ran. One fetch of
  // all candidate refs at once, quietly; a failure to fetch one branch is handled per-branch below.
  const refs = rows.map((r) => r.branch).filter(Boolean);
  if (refs.length) git(["fetch", "-q", "origin", "main", ...refs]);

  const base = git(["rev-parse", "origin/main"]);
  if (!base) return null;
  let acc = base;
  const taken = [];
  const blocked = [];
  for (const r of rows) {
    const head = git(["rev-parse", `origin/${r.branch}`]);
    if (!head) { blocked.push({ number: r.number, why: "ref not fetched — cannot test, excluded" }); continue; }
    const tree = git(["merge-tree", "--write-tree", acc, head]);
    if (tree) {
      const commit = git(["commit-tree", tree.split("\n")[0], "-p", base, "-m", "trial"]);
      if (!commit) { blocked.push({ number: r.number, why: "could not stage trial commit" }); continue; }
      acc = commit;
      taken.push(r.number);
    } else {
      blocked.push({ number: r.number, why: taken.length ? "conflicts with an earlier PR in this set" : "does not merge onto main" });
    }
  }
  return { taken, blocked };
}

/** Run a git command, returning trimmed stdout, or null if it failed. */
function git(args) {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

function classify(pr, verify, all) {
  if (verify === "failed" || all === "failed") return "CI-FAILED";

  // `mergeable` is NULL while GitHub recomputes the merge commit — which it does after every push
  // to the PR *and* after every merge into the base. During a busy merge window that is most of
  // the time. The old test was `pr.mergeable === false`, so a null fell through to MERGEABLE:
  // "we have not worked it out yet" was reported as "ready to merge".
  //
  // Caught live 2026-08-21: the sweep listed #2432 under MERGEABLE while the API said
  // `mergeable_state: "dirty"`. Acting on that means trying to merge a conflicted PR — and worse,
  // it makes the MERGEABLE bucket untrustworthy exactly when the backlog is moving fastest.
  //
  // `mergeable_state` is the more specific field and does not have the tri-state problem, so it is
  // consulted first. "unknown" is surfaced as its own bucket rather than folded into a verdict:
  // the honest answer is "ask again in a moment", and the sweep should say so.
  const st = pr.mergeable_state;
  if (st === "dirty") return "CONFLICTED";
  if (pr.mergeable === false) return "CONFLICTED";

  if (verify === "running" || all === "running") return "CI-RUNNING";
  if (pr.draft && verify === "pass") return "READY-BUT-DRAFT";
  if (!pr.draft && verify === "pass") {
    // A clean green non-draft is genuinely mergeable. Anything else that LOOKS mergeable but whose
    // state GitHub has not settled is reported as such, never as a green light.
    return st === "unknown" || st == null ? "MERGE-STATE-UNKNOWN" : "MERGEABLE";
  }
  return "OTHER";
}

function main() {
  const open = [];
  for (let page = 1; page <= 5; page += 1) {
    const batch = apiOrDie(`/pulls?state=open&per_page=100&page=${page}`, `list open PRs (page ${page})`);
    if (!Array.isArray(batch)) {
      console.error(`agent-pr-sweep: page ${page} returned a 200 that is not an array. Refusing to guess.`);
      process.exit(2);
    }
    if (batch.length === 0) break;
    open.push(...batch);
    if (batch.length < 100) break;
  }
  const agents = open.filter((p) => PREFIXES.some((pre) => p.head?.ref?.startsWith(pre)));

  // Per-PR failures degrade a ROW rather than the run, so they must be counted and shown. A PR
  // whose check-runs call failed lands in OTHER looking exactly like one with no checks — the same
  // absence-as-measurement mistake as the listing bug above, one level down.
  const degraded = [];

  const rows = agents.map((p) => {
    const fullRes = api(`/pulls/${p.number}`);
    const crRes = api(`/commits/${p.head.sha}/check-runs`);
    if (!fullRes.ok || !crRes.ok) {
      degraded.push({ number: p.number, error: (fullRes.ok ? crRes : fullRes).error });
    }
    const full = fullRes.data ?? p;
    const runs = crRes.data?.check_runs ?? [];
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
      // Zero check runs on the head SHA. Recorded so the printer can say WHY, rather than leaving
      // an operator to discover the absence and read it as a broken CI trigger — see the
      // "verify NEVER RAN" note at the top of this file.
      noRuns: runs.length === 0,
      bucket: classify(full, verify, all),
    };
  });
  rows.sort((a, b) => b.number - a.number);

  const buckets = {};
  for (const r of rows) (buckets[r.bucket] ??= []).push(r);

  if (CHOKEPOINTS) {
    const { ranked, unreadable, scanned } = chokepoints(rows);
    if (JSON_OUT) {
      console.log(JSON.stringify({ repo: REPO, scanned, unreadable, chokepoints: ranked }, null, 2));
    } else {
      console.log(`Merge chokepoints — ${REPO} (${scanned} agent PR(s) scanned)\n`);
      // Unreadable file lists are reported, never silently dropped: a PR whose files could not be
      // read contributes nothing to the counts, so the counts UNDERSTATE contention by exactly that
      // much. Saying so is the difference between a measurement and a guess.
      if (unreadable) console.log(`⚠ ${unreadable} PR(s) had unreadable file lists — counts below are a FLOOR, not a total.\n`);
      console.log(`  ${"file".padEnd(52)} ${"PRs".padStart(4)}  lanes`);
      for (const c of ranked.slice(0, 12)) {
        console.log(`  ${c.file.padEnd(52)} ${String(c.prs).padStart(4)}  ${c.lanes.join(",")}`);
      }
      if (ranked.length === 0) console.log("  (no file touched by more than one open agent PR)");
    }
    return;
  }

  if (JSON_OUT) {
    console.log(JSON.stringify({ repo: REPO, total: rows.length, degraded, buckets }, null, 2));
  } else {
    console.log(`Agent PR sweep — ${REPO} (${rows.length} open agent PRs)\n`);
    if (degraded.length) {
      // Printed FIRST, before the buckets, because it changes how the buckets should be read.
      console.log(`⚠ ${degraded.length} PR(s) could not be fully read — their bucket is a GUESS, not a verdict:`);
      for (const d of degraded) console.log(`   #${d.number}  ${d.error}`);
      console.log();
    }
    for (const [name, list] of Object.entries(buckets).sort((a, b) => b[1].length - a[1].length)) {
      console.log(`${name}  (${list.length})`);
      for (const r of list) {
        // A conflicted PR has no CI run BECAUSE it is conflicted (GitHub cannot build
        // refs/pull/N/merge), so the absence is explained inline instead of read as a second fault.
        const why = r.noRuns
          ? name === "CONFLICTED"
            ? "  [no CI run — expected while conflicted]"
            : "  [no CI run at all]"
          : "";
        console.log(`  #${r.number}  ${r.title.slice(0, 76)}${why}`);
      }
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
      if (jam.length > 1) {
        const { pairs, safe, unknown } = collisionsAmong(jam);
        if (pairs.length === 0) {
          console.log(`No file collisions among them — releasing together is safe.\n`);
        } else {
          console.log(`⚠ ORDERING DEPENDENCIES — these pairs touch the same file, so releasing them`);
          console.log(`  together lets automerge decide the order, and it decides by clock:`);
          for (const pr of pairs) {
            console.log(`   #${pr.a} ∩ #${pr.b}  ${pr.files.slice(0, 3).join(", ")}${pr.files.length > 3 ? ` (+${pr.files.length - 3})` : ""}`);
          }
          // The file-overlap set is a FLOOR. Ask git what actually merges — it is routinely several
          // times larger, and every PR it frees is finished work that would otherwise sit in the queue.
          // The trial merge is ALWAYS authoritative when it can run — it asks git instead of guessing.
          // Shown unconditionally, not only when it beats the heuristic: its most valuable output is
          // the "does not merge onto main" list, which appears precisely when the set is SMALL and
          // which the file-overlap heuristic structurally cannot produce.
          const trial = trialMergeSet(jam);
          if (trial) {
            console.log(`\n  SAFE TO RELEASE TOGETHER: ${trial.taken.length ? trial.taken.map((n) => "#" + n).join(", ") : "(none — release one at a time)"}`);
            if (trial.taken.length !== safe.length) {
              console.log(`    (file-overlap heuristic said ${safe.length}; trial merge says ${trial.taken.length} — git is the authority)`);
            }
            const stuck = trial.blocked.filter((b) => b.why === "does not merge onto main");
            if (stuck.length) {
              // A PR can be a GREEN DRAFT and still not merge. CI ran against the PR's own head, not
              // against the merge result, so these two facts are independent and one does not imply
              // the other. Without this line such a PR looks releasable forever and quietly is not.
              console.log(`\n  ⚠ green but will NOT merge onto main — needs a rebase: ${stuck.map((b) => "#" + b.number).join(", ")}`);
              console.log(`    CI green and mergeable are different facts: CI ran on the PR's head, never on the merge.`);
            }
            const unknown = trial.blocked.filter((b) => b.why.startsWith("ref not fetched") || b.why.startsWith("could not stage"));
            if (unknown.length) {
              console.log(`\n  ⚠ could not TEST (excluded, not cleared): ${unknown.map((b) => "#" + b.number).join(", ")}`);
            }
          } else {
            console.log(`\n  SAFE TO RELEASE TOGETHER: ${safe.length ? safe.map((n) => "#" + n).join(", ") : "(none — release one at a time)"}`);
            console.log(`    (trial merge unavailable — falling back to the conservative file-overlap heuristic)`);
          }
          if (unknown.length) console.log(`  UNKNOWN (file list unreadable, treat as unsafe): ${unknown.map((n) => "#" + n).join(", ")}`);
          console.log(`  Land one of an entangled pair, confirm it is in main, then release the next.\n`);
        }
      }
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
