/**
 * HELIX market-open gate — the binary claims in MARKET-OPEN-VALIDATION.md, made executable.
 *
 * WHY IT EXISTS. On 2026-08-23, THREE criteria in that runbook were found to have inverted: §5k
 * told the reader to expect a jump where the measurement falls, §5f required a marker no row can
 * render, §5c diagnosed a regression that had not happened. Each was correct when written, each was
 * retired by a later fix, and NOT ONE of them failed. They could not — they were prose, and prose
 * does not run. Two of the three would have produced a FALSE FAILURE on a working deploy, on the
 * one morning the runbook has to be right.
 *
 * This does not replace the runbook, which carries the reasoning, the baselines and everything that
 * needs a human. It makes the handful of claims inside it that ARE binary fail loudly instead of
 * quietly inverting.
 *
 * WHAT IT DOES NOT DO, deliberately:
 *   - it does not re-measure anything. It runs the existing harnesses with `--json` and reads them.
 *     A gate that reimplements its inputs measures a product nobody ships (#2731).
 *   - it does not judge anything needing a moving tape. Both radars are empty off-hours; those rows
 *     are AMBER with the reason, never a silent pass.
 *   - it does not turn a harness failure into a product verdict. A sub-report that could not be
 *     produced is HARNESS. A mid-rollout 404 cost a false desktop verdict this morning; the /flows
 *     audit's own gate caught it, and this keeps the same rule.
 *
 * Exits NON-ZERO on RED (a stated expectation is violated) or HARNESS (something could not be
 * measured, which is not a pass). AMBER and GREEN exit 0.
 *
 * Usage (Node 20, from the repo root):
 *   env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY \
 *     node --import tsx scripts/audit/helix-market-open-check.mjs [--base=URL] [--json]
 */
import { spawnSync } from "node:child_process";
import { evaluateChecks, rollup } from "./lib/helix-market-open-eval.mjs";

const argv = process.argv.slice(2);
const arg = (n, d) => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};
const BASE = arg("base", process.env.VALIDATE_BASE ?? "https://blackouttrades.com");
const AS_JSON = argv.includes("--json");

/** Run a sibling harness and parse its `--json`. Returns null on ANY failure — the caller turns
 *  that into HARNESS, never into a product verdict. */
function runJson(script, extra = []) {
  const r = spawnSync(
    process.execPath,
    ["--import", "tsx", new URL(script, import.meta.url).pathname, "--json", `--base=${BASE}`, ...extra],
    { encoding: "utf8", timeout: 10 * 60_000, maxBuffer: 64 * 1024 * 1024 }
  );
  if (!r.stdout) return null;
  // These harnesses bracket their JSON with human output on BOTH sides — progress lines before,
  // and a `temp Clerk user released` cleanup line after. Slicing from the first brace to the end of
  // the string therefore leaves trailing text and fails to parse, which is how the dark-pool report
  // first came back as HARNESS despite being perfectly good. Take first `{` .. last `}`.
  const i = r.stdout.indexOf("{");
  const j = r.stdout.lastIndexOf("}");
  if (i < 0 || j <= i) return null;
  let parsed = null;
  try {
    parsed = JSON.parse(r.stdout.slice(i, j + 1));
  } catch {
    return null;
  }
  // A non-zero exit is NOT disqualifying on its own: several harnesses here signal a FINDING that
  // way while still emitting a complete report. What disqualifies a report is failing to parse.
  // (The first version of this required status 0 and discarded a valid report — and the exit code
  // that prompted the check turned out to be SIGPIPE from a `| head` in my own shell, not the
  // harness at all.)
  return parsed;
}

const SRC = new URL("../../src/", import.meta.url).pathname;
// The REAL horizon labeller, imported rather than restated — the same discipline that removed the
// tape inventory's stale claim about this very function.
const { expiryHorizonLabel } = await import(`${SRC}lib/largo/helix-tape-analytics.ts`);

const tape = runJson("./helix-tape-inventory.mjs");
const darkpool = runJson("./helix-darkpool-inventory.mjs");
const rows = evaluateChecks({ tape, darkpool, expiryMinus1: expiryHorizonLabel(-1) });
const verdict = rollup(rows);

if (AS_JSON) {
  console.log(JSON.stringify({ as_of: new Date().toISOString(), base: BASE, verdict, checks: rows }, null, 2));
} else {
  const ICON = { GREEN: "✅", AMBER: "⚠️ ", RED: "❌", HARNESS: "❔" };
  console.log(`\n=== HELIX MARKET-OPEN GATE — ${BASE}`);
  console.log(`    executable form of the binary claims in MARKET-OPEN-VALIDATION.md\n`);
  for (const r of rows) {
    console.log(`${ICON[r.verdict]} ${r.id.padEnd(5)} ${r.section.padEnd(20)} ${r.verdict}`);
    console.log(`       expect   ${r.expect}`);
    console.log(`       measured ${r.measured}`);
    if (r.note) console.log(`       note     ${r.note}`);
  }
  console.log(`\nOVERALL: ${verdict}`);
  if (verdict === "AMBER") console.log("  AMBER = measured, and legitimately not a pass — read the notes.");
  if (verdict === "HARNESS") console.log("  HARNESS = something could not be measured. NOT a pass, and not a product verdict.");
  console.log(`\nThis gate covers only the BINARY claims. Everything needing a moving tape — both`);
  console.log(`radars populated, the §5h horizon colours, the §5j badge count — is still owed to the`);
  console.log(`runbook and is NOT asserted here.`);
}

process.exit(verdict === "RED" || verdict === "HARNESS" ? 1 : 0);
