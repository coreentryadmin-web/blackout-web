#!/usr/bin/env node
/**
 * G-18/G-19 counterfactual report — BO-P1-0004 deliverable.
 *
 * Answers: "Did the early-window prime floor (G-18) and F-5 top-band block (G-19)
 * save money or forgo winners?" using production skip-grading counterfactuals +
 * optional session replay of committed plays.
 *
 * USAGE
 *   node --import tsx scripts/audit/g18-g19-counterfactual.mjs [--days=14] [--no-replay] [--json]
 *
 * Requires prod Clerk admin session (same as gate-calibration-live-report.mjs).
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mintClerkPremiumSession } from "./lib/prod-clerk-session.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

const G18_CODE = "early_window_prime_score";
const G19_CODE = "score_top_band";
const TARGET_GATES = [G18_CODE, G19_CODE];

function parseArgs(argv) {
  const args = { days: 14, skipGradeDays: 14, replay: true, json: false, base: process.env.VALIDATE_BASE || "https://blackouttrades.com" };
  for (const a of argv) {
    if (a === "--json") args.json = true;
    else if (a === "--no-replay") args.replay = false;
    else if (a.startsWith("--days=")) args.days = Number(a.slice(7));
    else if (a.startsWith("--skip-grade-days=")) args.skipGradeDays = Number(a.slice(19));
    else if (a.startsWith("--base=")) args.base = a.slice(7);
  }
  return args;
}

function line(ch = "─", n = 78) {
  return ch.repeat(n);
}

function fmtBlocked(l) {
  if (!l) return "  (no graded counterfactuals in window)";
  return [
    `  gate: ${l.gate_failed}`,
    `  graded: ${l.n}  ungradeable: ${l.ungradeable}  would_have_won: ${l.would_have_won}`,
    `  false-block rate (would-have-won %): ${l.would_have_won_rate_pct ?? "n/a"}${l.low_n ? "  [low_n]" : ""}`,
  ].join("\n");
}

function interpretGate(code, line) {
  if (!line || line.n === 0) return "INSUFFICIENT_DATA — no graded counterfactuals yet; run during/after RTH.";
  const rate = line.would_have_won_rate_pct;
  if (rate == null) return "UNGRADEABLE — counterfactuals exist but none gradeable.";
  if (code === G18_CODE) {
    if (rate < 40) return "KEEP — sub-prime early-window blocks mostly avoided winners.";
    if (rate > 55) return "REVIEW — gate may be forgoing too many winners in early window.";
    return "HOLD — mixed evidence; keep gate, re-check after more sessions.";
  }
  if (code === G19_CODE) {
    if (rate < 35) return "KEEP — 85+ FLOW blocks mostly avoided winners (matches F-5 inversion thesis).";
    if (rate > 50) return "REVIEW — top-band block may be too aggressive.";
    return "HOLD — mixed evidence; keep gate pending more FLOW 85+ samples.";
  }
  return "HOLD";
}

export function pickGateLines(blockedValue, codes = TARGET_GATES) {
  const list = Array.isArray(blockedValue) ? blockedValue : [];
  const out = {};
  for (const code of codes) {
    out[code] = list.find((l) => l.gate_failed === code) ?? null;
  }
  return out;
}

export function buildReport({ calibration, replay, calibrationError }) {
  const gates = pickGateLines(calibration?.blocked_value);
  return {
    ok: !calibrationError,
    task: "BO-P1-0004",
    window: calibration?.window ?? null,
    calibration_error: calibrationError ?? null,
    gates: {
      [G18_CODE]: { ...gates[G18_CODE], verdict: interpretGate(G18_CODE, gates[G18_CODE]) },
      [G19_CODE]: { ...gates[G19_CODE], verdict: interpretGate(G19_CODE, gates[G19_CODE]) },
    },
    replay: replay ?? null,
    total_blocked_gates: calibration?.blocked_value?.length ?? 0,
    graded_plays: calibration?.graded_plays ?? null,
  };
}

export function parseCalibrationResponse(res, report) {
  if (!res.ok) {
    return { error: `calibration GET failed HTTP ${res.status}: ${JSON.stringify(report).slice(0, 300)}` };
  }
  if (report.available === false) {
    return {
      error: report.reason ?? "calibration unavailable (empty window or insufficient data)",
      report,
    };
  }
  return { report };
}

async function fetchCalibration(args, headers) {
  const gradeRes = await fetch(`${args.base}/api/market/zerodte/calibration?grade_skips=1`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ days: args.skipGradeDays }),
  });
  const gradeJson = await gradeRes.json().catch(() => ({}));
  if (!gradeRes.ok || gradeJson.ok === false) {
    throw new Error(`grade_skips failed HTTP ${gradeRes.status}: ${JSON.stringify(gradeJson).slice(0, 300)}`);
  }

  const q = args.days ? `?days=${args.days}` : "";
  const res = await fetch(`${args.base}/api/market/zerodte/calibration${q}`, { headers });
  const report = await res.json().catch(() => ({}));
  const parsed = parseCalibrationResponse(res, report);
  if (parsed.error) {
    return { grade: gradeJson, report: parsed.report ?? null, error: parsed.error };
  }
  return { grade: gradeJson, report: parsed.report };
}

function runReplay(args) {
  const r = spawnSync("npm", ["run", "replay:0dte-session", "--", `--days=${args.days}`, "--json"], {
    encoding: "utf8",
    cwd: repoRoot,
    env: { ...process.env, VALIDATE_BASE: args.base },
  });
  try {
    const lastBrace = r.stdout.lastIndexOf("{");
    const json = lastBrace >= 0 ? JSON.parse(r.stdout.slice(lastBrace)) : { ok: false, error: "no json output" };
    return json;
  } catch {
    return { ok: false, error: r.stderr?.slice(0, 200) || "replay parse failed", stdout_tail: r.stdout?.slice(-200) };
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let session;
  try {
    session = await mintClerkPremiumSession({ appUrl: args.base });
    if (session.skip) {
      const out = { ok: false, skip: true, reason: session.reason ?? "Clerk unavailable" };
      if (args.json) console.log(JSON.stringify(out, null, 2));
      else console.log(`SKIP — ${out.reason}`);
      process.exitCode = 0;
      return;
    }

    const headers = { Cookie: session.cookieHeader, Accept: "application/json" };
    const { grade, report, error: calibrationError } = await fetchCalibration(args, headers);

    let replay = null;
    if (args.replay) replay = runReplay(args);

    const result = buildReport({ calibration: report, replay, calibrationError });

    if (args.json) {
      console.log(JSON.stringify({ ...result, grade_backfill: grade }, null, 2));
      return;
    }

    const g18 = result.gates[G18_CODE];
    const g19 = result.gates[G19_CODE];

    console.log(line("═"));
    console.log("  0DTE G-18/G-19 COUNTERFACTUAL — BO-P1-0004");
    console.log(line("═"));
    console.log(`\n  window: ${result.window?.since ?? "?"} .. ${result.window?.through ?? "?"} (${result.window?.days ?? "?"}d)`);
    if (result.calibration_error) {
      console.log(`  calibration: UNAVAILABLE — ${result.calibration_error}`);
    }
    console.log(`  skip-grade backfill: scanned=${grade.scanned ?? 0} graded=${grade.graded ?? 0} ungradeable=${grade.ungradeable ?? 0}`);

    console.log(`\n${line()}`);
    console.log("  G-18 — early_window_prime_score (sub-prime in [10:00, 10:45) ET)");
    console.log(line());
    console.log(fmtBlocked(g18));
    console.log(`  → ${g18.verdict}`);

    console.log(`\n${line()}`);
    console.log("  G-19 — score_top_band (FLOW 85+ inversion block)");
    console.log(line());
    console.log(fmtBlocked(g19));
    console.log(`  → ${g19.verdict}`);

    if (replay) {
      console.log(`\n${line()}`);
      console.log("  SESSION REPLAY (committed plays, current graders)");
      console.log(line());
      if (replay.ok) {
        console.log(`  session: ${replay.session_date ?? "?"}  replayed: ${replay.replayed ?? 0}  avg_exec_pnl: ${replay.avg_replay_exec_pnl_pct ?? "n/a"}%  win_rate: ${replay.win_rate_pct ?? "n/a"}%`);
      } else {
        console.log(`  replay skipped/failed: ${replay.error ?? replay.skip ?? "unknown"}`);
      }
    }

    console.log(`\n${line("═")}`);
    console.log("  Read-only measurement. No gate threshold changed.");
    console.log(line("═"));
  } finally {
    await session?.cleanup?.();
  }
}

if (process.argv[1]?.endsWith("g18-g19-counterfactual.mjs")) {
  main().catch((err) => {
    console.error(JSON.stringify({ ok: false, error: String(err?.message ?? err) }, null, 2));
    process.exitCode = 1;
  });
}
