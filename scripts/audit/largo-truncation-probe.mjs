/**
 * LARGO TRUNCATION PROBE — does the model actually RECEIVE each tool's payload?
 *
 * WHY THIS EXISTS. `anthropicToolLoop` caps every `tool_result` at `MAX_TOOL_RESULT_CHARS` and
 * enforces it with a TAIL slice. A tool over that cap still "works": the call succeeds, the loop
 * completes, and the model writes a fluent answer from whatever survived. Three defects shipped
 * that way in the Night Hawk lane alone — `get_zerodte_record` delivered 1.5% of itself with every
 * aggregate cut off, `get_nighthawk_edition` cut off every play, and `get_nighthawk_outcomes` had
 * Largo quoting a 40% win rate over "5 plays" for a window whose real record was 74 resolved at
 * 50%. Every existing Largo audit graded whether an answer was CORRECT or ROUTED to the right
 * tool. None asked whether the payload ARRIVED.
 *
 * `largo-payload-hygiene.mjs` cannot answer this from the sandbox: it runs tools IN-PROCESS, and
 * every DB-backed tool is unreachable here (`DATABASE_URL` points at a host that does not resolve).
 * This probe goes the other way — it asks the LIVE agent, which runs where the data is.
 *
 * THE TRICK. The transport appends a literal `…[truncated]` marker to an over-cap result, and the
 * model can observe its own tool result. So "was this cut off?" is answerable without counting a
 * single byte.
 *
 * THE RULE THAT MAKES IT TRUSTWORTHY. The instrument is a model, so a run of all-COMPLETE is
 * indistinguishable from a run whose question never landed. Every run therefore probes a CONTROL
 * tool known to exceed the cap, and **if the control does not come back TRUNCATED, every COMPLETE
 * in the run is reported UNVERIFIED rather than clean** (see `lib/truncation-verdict.mjs`). A
 * probe that cannot fail proves nothing.
 *
 * READ-ONLY. Asks questions; changes nothing. One temp Clerk user, deleted in a `finally`.
 *
 * Run from the REPO ROOT:
 *   node --import tsx scripts/audit/largo-truncation-probe.mjs \
 *     [--tools=a,b] [--control=get_x] [--base=https://blackouttrades.com] [--json]
 */
import { mintClerkPremiumSession } from "./lib/prod-clerk-session.mjs";
import { parseProbeReply, probeQuestion, summarizeRun } from "./lib/truncation-verdict.mjs";

const arg = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};
const JSON_OUT = process.argv.includes("--json");
const BASE = arg("base", "https://blackouttrades.com").replace(/\/$/, "");

/**
 * Night Hawk lane tools, with the args each needs. Deliberately the LANE's list rather than all
 * 126 — another lane's owner is better placed to say which of theirs carry enough data to be at
 * risk, and `--tools=` lets them point this at their own without editing the file.
 */
const LANE_TOOLS = [
  ["get_zerodte_record", "days=30"],
  ["get_zerodte_plays", ""],
  ["get_zerodte_rejections", ""],
  ["get_nighthawk_edition", ""],
  ["get_nighthawk_outcomes", "window_days=30"],
  ["get_nighthawk_horizons", ""],
  ["get_nighthawk_dossier", "ticker NVDA"],
  ["get_horizon_outcomes", ""],
  ["get_cortex_decision", "ticker SPX"],
  ["get_gate_blocked_value", "days=30"],
  ["get_grader_agreement", "days=90"],
  ["get_banger_board", ""],
  ["get_swing_horizon", ""],
];

/**
 * The control must be a tool KNOWN to exceed the cap right now. `get_nighthawk_outcomes` at a wide
 * window is the current one (measured TRUNCATED 2026-08-21, last visible key `analytics`).
 *
 * NOTE FOR WHOEVER READS THIS AFTER #2480 SHIPS: that fix makes this control return COMPLETE, at
 * which point the run will correctly report UNVERIFIED and demand a new control rather than
 * quietly passing. That is the design working, not a break — pick another over-cap tool with
 * `--control=`, or retire the harness if nothing is over cap any more.
 */
const DEFAULT_CONTROL = ["get_nighthawk_outcomes", "window_days=180"];

const only = (arg("tools", "") || "").split(",").map((t) => t.trim()).filter(Boolean);
const TOOLS = only.length ? LANE_TOOLS.filter(([n]) => only.includes(n)) : LANE_TOOLS;
if (only.length) {
  const unknown = only.filter((n) => !LANE_TOOLS.some(([t]) => t === n));
  if (unknown.length) {
    console.error(
      `HARNESS ERROR — no argument recipe for: ${unknown.join(", ")}. ` +
        `Add them to LANE_TOOLS rather than letting the run quietly omit them.`
    );
    process.exit(2);
  }
}
const controlName = arg("control", "");
const CONTROL = controlName
  ? [controlName, LANE_TOOLS.find(([n]) => n === controlName)?.[1] ?? ""]
  : DEFAULT_CONTROL;

const session = await mintClerkPremiumSession({ appUrl: BASE });
if (session.skip) {
  console.error(`SKIP — could not mint a session: ${session.reason ?? "unknown"}`);
  process.exit(2);
}

async function probe(tool, args) {
  const res = await fetch(`${BASE}/api/market/largo/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: session.cookieHeader },
    body: JSON.stringify({ question: probeQuestion(tool, args), depth: "concrete" }),
  });
  if (!res.ok) return { tool, verdict: "INDETERMINATE", last_key: null, error: `HTTP ${res.status}` };
  const text = await res.text();
  const md = /"markdown":"((?:[^"\\]|\\.)*)"/.exec(text)?.[1] ?? text;
  const reply = md.replace(/\\n/g, "\n");
  // A run that never reached the tool is an UNKNOWN, not a pass — if the tool name is absent from
  // the trace the model answered from somewhere else and its verdict is about the wrong payload.
  const called = new RegExp(`\\b${tool}\\b`).test(text);
  const parsed = parseProbeReply(reply);
  return { tool, ...parsed, verdict: called ? parsed.verdict : "INDETERMINATE", called };
}

let exitCode = 1;
try {
  const control = await probe(CONTROL[0], CONTROL[1]);
  const rows = [];
  for (const [tool, args] of TOOLS) rows.push(await probe(tool, args));
  const summary = summarizeRun(rows, control.verdict);

  if (JSON_OUT) {
    console.log(JSON.stringify({ control, rows, summary }, null, 2));
  } else {
    console.log(`CONTROL ${control.tool} -> ${control.verdict}${control.last_key ? ` (last key: ${control.last_key})` : ""}`);
    console.log(
      summary.control_proven
        ? "  instrument PROVEN — it detected a real truncation, so COMPLETE below means clean\n"
        : "  instrument NOT PROVEN — the control did not truncate, so every COMPLETE below is UNVERIFIED\n"
    );
    for (const r of rows) {
      const mark = r.verdict === "TRUNCATED" ? "❌" : r.verdict === "COMPLETE" ? (summary.control_proven ? "✅" : "❔") : "❔";
      console.log(
        `  ${mark} ${r.tool.padEnd(26)} ${r.verdict.padEnd(14)}` +
          `${r.last_key ? ` last key: ${r.last_key}` : ""}${r.called === false ? "  (tool not in trace)" : ""}`
      );
    }
    console.log(
      `\n=== ${summary.truncated.length} TRUNCATED · ${summary.clean.length} clean · ` +
        `${summary.unverified.length} unverified · ${summary.indeterminate.length} indeterminate ===`
    );
    if (summary.truncated.length) console.log(`    truncated: ${summary.truncated.join(", ")}`);
  }
  exitCode = summary.ok ? 0 : 1;
} finally {
  // Cleanup BEFORE exiting, never in a finally racing process.exit(): an exit() inside the try
  // terminates the process at once and the awaited delete never lands, leaking the temp Clerk
  // user this run created. Set the code, let the finally complete, then exit.
  await session.cleanup?.();
}
process.exit(exitCode);
