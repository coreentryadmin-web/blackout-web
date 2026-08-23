/**
 * LARGO TRUNCATION PROBE — does the model actually RECEIVE each tool's payload?
 *
 * WHY THIS EXISTS. `anthropicToolLoop` caps every `tool_result` at `MAX_TOOL_RESULT_CHARS` by
 * KEEPING THE FIRST that-many characters AND DISCARDING EVERYTHING AFTER — `raw.slice(0, MAX)`, so
 * key order decides what survives. A tool over that cap still "works": the call succeeds, the loop
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
import { mentionsTool, parseProbeReply, probeQuestion, summarizeRun } from "./lib/truncation-verdict.mjs";

const arg = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};
const JSON_OUT = process.argv.includes("--json");
const BASE = arg("base", "https://blackouttrades.com").replace(/\/$/, "");

/**
 * Lane tools, with the args each needs. Deliberately the LANES' list rather than all 129 — a
 * lane's owner is better placed to say which of theirs carry enough data to be at risk, and
 * `--tools=` lets them point this at their own subset.
 *
 * HELIX's four were added 2026-08-23 by that lane, per this file's own invitation. Their args are
 * chosen to make the payload as LARGE as it legitimately gets, because a probe run against a small
 * payload proves nothing about the cap: market-wide (no ticker) is bigger than any single name,
 * and the tape tools default to 500/400 rows over a 168h window.
 */
const LANE_TOOLS = [
  ["get_zerodte_record", "days=30"],
  ["get_zerodte_plays", ""],
  // Wide window deliberately. Measured 2026-08-23: at "the largest window available" this tool
  // comes back TRUNCATED, which is (a) the only over-cap tool found across five candidates and so
  // the current CONTROL, and (b) a real finding about this tool that the Night Hawk lane owns —
  // reported rather than quietly baked in. A bare "" probes a payload small enough to prove
  // nothing.
  ["get_zerodte_rejections", "the largest window available"],
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
  // ── HELIX lane (docs/audit/HELIX-MAP.md) ──────────────────────────────────────────────────
  // Market-wide deliberately: no ticker means the whole tape, which is the biggest this gets.
  ["get_helix_tape_analytics", "no ticker, since_hours=168"],
  ["get_helix_derived", "no ticker"],
  ["get_helix_signal_outcomes", ""],
  // The only one of the four that REQUIRES a ticker. SPX carries the most tape premium.
  ["get_helix_thermal_compare", "ticker SPX"],
];

/**
 * The control must be a tool KNOWN to exceed the cap right now. `get_nighthawk_outcomes` at a wide
 * window is the current one (measured TRUNCATED 2026-08-21, last visible key `analytics`).
 *
 * NOTE FOR WHOEVER READS THIS AFTER #2480 SHIPS: that fix makes this control return COMPLETE, at
 * which point the run will correctly report UNVERIFIED and demand a new control rather than
 * quietly passing. That is the design working, not a break — pick another over-cap tool with
 * `--control=` (it must be one of LANE_TOOLS, so it runs with real arguments), or retire the
 * harness if nothing is over cap any more.
 */
/**
 * UPDATED 2026-08-23, exactly as the note above anticipated. #2628 fixed `get_nighthawk_outcomes`,
 * so it now returns COMPLETE and can no longer prove the instrument — the first HELIX run with it
 * correctly reported 4 UNVERIFIED rather than 4 clean.
 *
 * Replacement found by probing five candidates at their widest windows: `get_zerodte_record`,
 * `get_grader_agreement`, `get_nighthawk_outcomes` and `get_gate_blocked_value` all came back
 * COMPLETE at 365 days; only `get_zerodte_rejections` truncated. That it was the ONLY one is worth
 * noting — the cap is not being hit widely any more, which is good news and also means the pool of
 * usable controls is thin. When this one is fixed too, the run will go UNVERIFIED again and the
 * next owner must find another rather than assume the check still works.
 */
const DEFAULT_CONTROL = ["get_zerodte_rejections", "the largest window available"];

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
// An unknown --control used to fall back to running that name with NO args. That is the worst
// possible failure for this harness: a control with the wrong args comes back COMPLETE, which
// correctly downgrades every other tool in the run to UNVERIFIED — so a typo reads exactly like
// a finding. Same rule as --tools above: name something the file has a recipe for, or stop.
const controlRecipe = LANE_TOOLS.find(([n]) => n === controlName);
if (controlName && !controlRecipe) {
  console.error(
    `HARNESS ERROR — no argument recipe for control \`${controlName}\`. ` +
      `Add it to LANE_TOOLS rather than probing it with no arguments: a control that is not ` +
      `actually over the cap reports COMPLETE and marks the whole run UNVERIFIED.`
  );
  process.exit(2);
}
const CONTROL = controlRecipe ?? DEFAULT_CONTROL;

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
  // A transport failure and a hedging model both used to land here as a bare INDETERMINATE, and
  // the report printed them identically. They are not the same finding: one says the harness
  // could not ask, the other says the product could not answer.
  if (!res.ok) {
    return { tool, verdict: "INDETERMINATE", reason: `HTTP ${res.status} — the question never reached the model`, last_key: null, reply: null };
  }
  const text = await res.text();
  const md = /"markdown":"((?:[^"\\]|\\.)*)"/.exec(text)?.[1] ?? text;
  const reply = md.replace(/\\n/g, "\n");
  // A run that never reached the tool is an UNKNOWN, not a pass — if the tool name is absent from
  // the trace the model answered from somewhere else and its verdict is about the wrong payload.
  const called = mentionsTool(text, tool);
  const parsed = parseProbeReply(reply);
  return {
    tool,
    ...parsed,
    verdict: called ? parsed.verdict : "INDETERMINATE",
    reason: called ? parsed.reason : `${tool} never appears in the trace — the model answered from somewhere else`,
    called,
    reply: reply.slice(0, 400),
  };
}

let exitCode = 1;
try {
  const control = await probe(CONTROL[0], CONTROL[1]);
  const rows = [];
  // A LOST SESSION IS NOT A LIST OF UNKNOWN TOOLS. The first live 13-tool run lost its Clerk
  // session partway and every remaining probe came back 401 — reported, before this, as twelve
  // indistinguishable INDETERMINATEs. One fact (the session died) had been smeared across twelve
  // rows that each looked like a finding about a tool. So an auth failure aborts the run and says
  // so once, instead of spending the rest of the run asking a door that is already locked.
  let aborted = null;
  for (const [tool, args] of TOOLS) {
    if (aborted) {
      rows.push({ tool, verdict: "INDETERMINATE", reason: `not probed — run aborted at ${aborted}`, last_key: null });
      continue;
    }
    const row = await probe(tool, args);
    rows.push(row);
    if (/^HTTP 40[13]\b/.test(row.reason ?? "")) aborted = tool;
  }
  const summary = { ...summarizeRun(rows, control.verdict), aborted_at: aborted };
  if (aborted) {
    console.error(
      `RUN ABORTED at ${aborted} — the session stopped authenticating. Everything after it is ` +
        `unprobed, not clean. Re-run; if it aborts at the same point the session is expiring ` +
        `mid-run and the tool list needs splitting with --tools=.`
    );
  }

  if (JSON_OUT) {
    console.log(JSON.stringify({ control, rows, summary }, null, 2));
  } else {
    console.log(`CONTROL ${control.tool} -> ${control.verdict}${control.last_key ? ` (last key: ${control.last_key})` : ""}${control.reason ? ` — ${control.reason}` : ""}`);
    console.log(
      summary.control_proven
        ? "  instrument PROVEN — it detected a real truncation, so COMPLETE below means clean\n"
        : "  instrument NOT PROVEN — the control did not truncate, so every COMPLETE below is UNVERIFIED\n"
    );
    for (const r of rows) {
      const mark = r.verdict === "TRUNCATED" ? "❌" : r.verdict === "COMPLETE" ? (summary.control_proven ? "✅" : "❔") : "❔";
      console.log(
        `  ${mark} ${r.tool.padEnd(26)} ${r.verdict.padEnd(14)}` +
          `${r.last_key ? ` last key: ${r.last_key}` : ""}${r.reason ? `  — ${r.reason}` : ""}`
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
