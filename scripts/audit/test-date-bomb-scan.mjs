#!/usr/bin/env node
/**
 * Which tests will turn CI red on a future date, purely because the date changed?
 *
 * WHY THIS EXISTS. `src/lib/swing/live-plays.test.ts` asserted `dte >= 0` and `dte !== 0` against a
 * hardcoded `contract_expiry`, while the code under test computes DTE from the REAL clock. It went
 * red on the expiry date, was patched by pushing the constant two days out, and was then re-armed
 * to fire again — with a comment claiming the value made it safe "regardless of run date". Nothing
 * in the suite could see that, because a date bomb passes every single run until the day it does
 * not. This repo auto-merges on green CI, so a bomb does not just fail a build: it stops the
 * pipeline on a day nobody is expecting it.
 *
 * HOW IT WORKS. Run the real suite (the same `npm test` entrypoint CI runs) several times with the
 * process clock shifted forward, and diff each run's failures against the unshifted baseline. A
 * test that passes at +0 and fails at +N is a bomb, and N brackets when it goes off. Only `Date.now`
 * and no-arg `new Date()` move (see lib/faketime-preload.mjs) — hardcoded dates stay put, which is
 * exactly the drift a bomb depends on.
 *
 * A test that fails at +0 too is NOT reported: it is already broken and belongs to whoever broke it,
 * not to this scan. And a test that only fails at a LARGE offset over a weekend or holiday boundary
 * is still a genuine finding — that is a real calendar the product will meet.
 *
 * Offline, read-only: runs tests, writes nothing but its own report.
 *
 * Run from the REPO ROOT (Node 20 — a Node 22 run is not evidence, see CLAUDE.md):
 *   node scripts/audit/test-date-bomb-scan.mjs [--offsets=3,10,45,120] [--json]
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const PRELOAD = join(HERE, "lib", "faketime-preload.mjs");

const argv = process.argv.slice(2);
const arg = (n, d) => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};
const JSON_OUT = argv.includes("--json");
const DAY_MS = 86_400_000;

// Defaults chosen to bracket the horizons this product actually trades and schedules against:
// this week, next OPEX, a quarter out, and far enough to cross a year-end.
const OFFSET_DAYS = arg("offsets", "3,10,45,120,400")
  .split(",")
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isFinite(n) && n > 0);

/** Run the suite once and return the set of failing test names. */
function runSuite(offsetDays) {
  const offsetMs = Math.round(offsetDays * DAY_MS);
  const env = { ...process.env };
  if (offsetMs > 0) {
    env.FAKE_TIME_OFFSET_MS = String(offsetMs);
    // Append rather than replace: the repo's own NODE_OPTIONS (heap ceiling, loaders) must survive.
    env.NODE_OPTIONS = `${process.env.NODE_OPTIONS ?? ""} --import ${PRELOAD}`.trim();
  }
  const t0 = Date.now();
  const res = spawnSync("npm", ["test"], {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024,
  });
  const out = `${res.stdout ?? ""}${res.stderr ?? ""}`;
  // TAP: "not ok <n> - <name>", then a YAML block carrying `location: '<file>:<line>:<col>'`.
  // The NAME is the stable identity across runs; the number is not, because a suite that throws
  // early renumbers everything after it. The LOCATION is kept so a candidate can be re-run on its
  // own file — see the flake-vs-bomb confirmation pass below.
  const failures = new Map(); // name -> file
  const lines = out.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = /^not ok \d+ - (.+)$/.exec(lines[i].trim());
    if (!m) continue;
    const name = m[1].trim();
    let file = null;
    // The YAML block is short; the location line sits within a handful of lines of the marker.
    for (let j = i + 1; j < Math.min(i + 12, lines.length); j++) {
      const loc = /^\s*location:\s*'?([^':]+):\d+/.exec(lines[j]);
      if (loc) { file = loc[1]; break; }
      if (/^not ok |^ok /.test(lines[j].trim())) break;
    }
    failures.set(name, file);
  }
  const passMatch = /^# pass (\d+)$/m.exec(out);
  const failMatch = /^# fail (\d+)$/m.exec(out);
  return {
    offsetDays,
    failures,
    pass: passMatch ? Number(passMatch[1]) : null,
    fail: failMatch ? Number(failMatch[1]) : null,
    exitCode: res.status,
    seconds: Math.round((Date.now() - t0) / 1000),
    // A suite that never printed a summary line did not run — a harness fault, not a green result.
    ran: Boolean(passMatch),
  };
}

const targetDate = (days) =>
  new Date(Date.now() + days * DAY_MS).toISOString().slice(0, 10);

console.error(`baseline run (+0d, today ${targetDate(0)}) …`);
const baseline = runSuite(0);
if (!baseline.ran) {
  console.error("baseline suite did not report a summary — aborting rather than reporting phantom bombs");
  process.exit(2);
}
console.error(`  baseline: ${baseline.pass} pass / ${baseline.fail} fail (${baseline.seconds}s)`);

const runs = [baseline];
for (const days of OFFSET_DAYS) {
  console.error(`clock +${days}d (${targetDate(days)}) …`);
  const r = runSuite(days);
  console.error(`  ${r.ran ? `${r.pass} pass / ${r.fail} fail` : "DID NOT RUN"} (${r.seconds}s)`);
  runs.push(r);
}

// A bomb = fails at some offset, passes at baseline. Report the EARLIEST offset that trips it, so
// the report says how long there is before it fires rather than only that it eventually does.
const candidates = new Map(); // name -> { days, file }
for (const r of runs) {
  if (r.offsetDays === 0 || !r.ran) continue;
  for (const [name, file] of r.failures) {
    if (baseline.failures.has(name)) continue; // already broken today — not this scan's finding
    if (!candidates.has(name)) candidates.set(name, { days: r.offsetDays, file });
  }
}

/**
 * FLAKE-VS-BOMB CONFIRMATION.
 *
 * A suite this size contains tests that measure real elapsed time, and under a loaded box those can
 * fail on any run for reasons that have nothing to do with the clock. Reported as bombs they would
 * send someone hunting a date bug in a scheduling race — so every candidate is re-run ALONE at the
 * offset that tripped it, twice, and only a test that fails BOTH times survives. Running the file on
 * its own also removes the load that produced the flake in the first place, which makes a surviving
 * failure that much more clearly about the date.
 */
function rerunFile(file, offsetDays) {
  const env = { ...process.env };
  env.FAKE_TIME_OFFSET_MS = String(Math.round(offsetDays * DAY_MS));
  env.NODE_OPTIONS = `${process.env.NODE_OPTIONS ?? ""} --import ${PRELOAD}`.trim();
  const res = spawnSync("npx", ["tsx", "--test", file], {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const out = `${res.stdout ?? ""}${res.stderr ?? ""}`;
  const failMatch = /^# fail (\d+)$/m.exec(out);
  return { ran: Boolean(/^# pass \d+$/m.exec(out)), failed: failMatch ? Number(failMatch[1]) > 0 : null };
}

const bombs = new Map();
for (const [name, { days, file }] of candidates) {
  if (!file) {
    // No location captured — cannot isolate it, so report it but say the confirmation was skipped
    // rather than silently upgrading a guess to a finding.
    bombs.set(name, { days, confirmed: false, note: "no test location in TAP output — unconfirmed" });
    continue;
  }
  console.error(`confirming candidate at +${days}d: ${file} …`);
  const a = rerunFile(file, days);
  const b = a.failed ? rerunFile(file, days) : null;
  if (a.ran && a.failed && b?.failed) bombs.set(name, { days, confirmed: true, file });
  else console.error(`  dropped (flaky or passes in isolation): ${name}`);
}

const report = {
  today: targetDate(0),
  baseline: { pass: baseline.pass, fail: baseline.fail, failures: [...baseline.failures.keys()] },
  runs: runs.map((r) => ({
    offsetDays: r.offsetDays,
    date: targetDate(r.offsetDays),
    pass: r.pass,
    fail: r.fail,
    ran: r.ran,
    seconds: r.seconds,
  })),
  bombs: [...bombs.entries()]
    .sort((a, b) => a[1].days - b[1].days)
    .map(([name, b]) => ({
      test: name,
      file: b.file ?? null,
      firesWithinDays: b.days,
      byDate: targetDate(b.days),
      confirmed: b.confirmed,
      ...(b.note ? { note: b.note } : {}),
    })),
};

if (JSON_OUT) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log("");
  console.log("DATE-BOMB SCAN — tests that pass today and fail purely because the clock moved");
  console.log(`today ${report.today} | baseline ${baseline.pass} pass / ${baseline.fail} fail`);
  console.log("");
  for (const r of report.runs) {
    console.log(
      `  +${String(r.offsetDays).padStart(4)}d  ${r.date}  ${r.ran ? `${String(r.pass).padStart(5)} pass / ${String(r.fail).padStart(3)} fail` : "DID NOT RUN"}  (${r.seconds}s)`
    );
  }
  console.log("");
  if (!report.bombs.length) {
    console.log("no date bombs found at the scanned offsets");
  } else {
    console.log(`${report.bombs.length} DATE BOMB(S):`);
    for (const b of report.bombs) {
      console.log(`  fires within +${b.firesWithinDays}d (by ${b.byDate})  ${b.test}`);
      console.log(`      ${b.file ?? "(location unknown)"}${b.confirmed ? "" : `  [${b.note ?? "unconfirmed"}]`}`);
    }
    console.log("");
    console.log("A bomb turns CI red on a date nobody chose. Make the fixture relative to the run");
    console.log("date instead of pushing the constant further out — that only re-arms it.");
  }
}

process.exit(report.bombs.length ? 1 : 0);
