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
import { makeCookieJar } from "./lib/clerk-cookie-jar.mjs";
import { mentionsTool, parseProbeReply, probeQuestion, summarizeRun } from "./lib/truncation-verdict.mjs";

const arg = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};
const JSON_OUT = process.argv.includes("--json");
const BASE = arg("base", "https://blackouttrades.com").replace(/\/$/, "");

/**
 * Lane tools, with the args each needs. Deliberately the LANES' list rather than all 137 — a
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
  // ── SPX SLAYER lane (docs/spx/SLAYER-MAP.md §8 item 5) ────────────────────────────────────
  // Added 2026-08-23. This lane had never been probed at all, which is not the same as having
  // been probed clean: the three shipped truncation defects were all found by asking, and nobody
  // had asked here. Ordered biggest-payload-first from the tool descriptions, so a run that has
  // to be split with --tools= still covers the likeliest offenders in its first batch.
  //
  // `get_spx_play` and `get_spx_structure` are the two fat ones by construction — the play tool
  // returns "every confluence factor with its weight/detail, full gate pass/fail state, the
  // 10-item confirmation checklist, MTF/RSI/EMA technicals, adaptive-gate telemetry, watch state,
  // the AI arbiter's verdict, the option ticket", and the structure tool the whole desk including
  // the flow tape and dark pool. `get_spx_engine_snapshots` is a HISTORY, so it is probed at a
  // wide window rather than bare: a default-window read proves nothing about the cap.
  ["get_spx_play", ""],
  ["get_spx_structure", ""],
  // Probed at the tool's OWN DEFAULT (limit 20), not at "the largest window available".
  // Measured 2026-08-23: it truncates at a wide window, which is a weaker finding than it looks —
  // any list tool truncates if you ask for enough of it. The question that matters is whether it
  // truncates AS NORMALLY CALLED, so that is what this recipe asks.
  ["get_spx_engine_snapshots", "limit 20"],
  ["get_spx_confluence", ""],
  ["get_spx_pin", ""],
  ["get_spx_vs_nighthawk_comparison", ""],
  // Named `get_gate_rules`, not `get_spx_gates` — it is SPX Slayer's gate-threshold tool despite
  // the un-prefixed name, and guessing the prefixed one would have named a tool that does not
  // exist. Verified against tool-defs.ts:268 rather than inferred from the lane.
  ["get_gate_rules", ""],
  // Deliberately last and deliberately included: the lightest SPX tool by its own description
  // ("~2s lane"). A lane where every tool truncates and a lane where none does are both possible;
  // probing only the fat ones cannot tell those apart.
  ["get_spx_pulse", ""],
  // ── Full coverage (102 additional tools, all remaining from tool-defs.ts) ─────────────────────
  // Added 2026-08-23 for comprehensive then-129-tool truncation validation. Default arguments ("") are
  // safe for all tools; optional-argument tools will omit the args if empty string is passed.
  ["get_ah_movers", ""],
  ["get_analyst_ratings", ""],
  ["get_atm_chains", ""],
  ["get_catalysts", ""],
  ["get_company_profile", ""],
  ["get_confluence_outcomes", ""],
  ["get_congress_trades", ""],
  ["get_congress_unusual", ""],
  ["get_cross_product_read", ""],
  ["get_dark_pool", ""],
  ["get_dividends", ""],
  ["get_earnings", ""],
  ["get_earnings_calendar", ""],
  ["get_earnings_history", ""],
  ["get_earnings_market", ""],
  ["get_economic_calendar", ""],
  ["get_ecosystem_context", ""],
  ["get_etf_detail", ""],
  ["get_etf_flow", ""],
  ["get_fda_calendar", ""],
  ["get_financials", ""],
  ["get_flow_anomaly_near_misses", ""],
  ["get_flow_brief", ""],
  ["get_flow_expiry_breakdown", ""],
  ["get_flow_per_strike", ""],
  ["get_flow_tape", ""],
  ["get_gex", ""],
  ["get_gex_heatmap", ""],
  ["get_gex_matrix_changes", ""],
  ["get_gex_regime_events", ""],
  ["get_global_flow", ""],
  ["get_greek_flow", ""],
  ["get_greeks", ""],
  ["get_group_greek_flow", ""],
  ["get_hot_tickers", ""],
  ["get_insider_flow", ""],
  ["get_institutional", ""],
  ["get_ipo_calendar", ""],
  ["get_iv_stats", ""],
  ["get_iv_term_structure", ""],
  ["get_lotto_live", ""],
  ["get_lotto_state", ""],
  ["get_macro_indicator", ""],
  ["get_market_breadth", ""],
  ["get_market_context", ""],
  ["get_market_movers", ""],
  ["get_market_regime", ""],
  ["get_max_pain", ""],
  ["get_meridian_event", ""],
  ["get_meridian_timeline", ""],
  ["get_nbbo", ""],
  ["get_net_prem_ticks", ""],
  ["get_news", ""],
  ["get_nope", ""],
  ["get_oi_per_expiry", ""],
  ["get_oi_per_strike", ""],
  ["get_open_plays", ""],
  ["get_option_contract", ""],
  ["get_options_chain", ""],
  ["get_options_flow", ""],
  ["get_options_volume", ""],
  ["get_ownership", ""],
  ["get_peer_rs", ""],
  ["get_positioning", ""],
  ["get_postgres_flows", ""],
  ["get_power_hour", ""],
  ["get_predictions_consensus", ""],
  ["get_qqq_relative_strength", ""],
  ["get_quote", ""],
  ["get_realized_vol", ""],
  ["get_risk_reversal_skew", ""],
  ["get_screener", ""],
  ["get_seasonality", ""],
  ["get_sector_flow", ""],
  ["get_short_data", ""],
  ["get_short_interest", ""],
  ["get_signal_log", ""],
  ["get_similar_precedents", ""],
  ["get_stock_state", ""],
  ["get_swing_discovery", ""],
  ["get_technicals", ""],
  ["get_technicals_spx", ""],
  ["get_thermal_compare", ""],
  ["get_top_net_impact", ""],
  ["get_trade_history", ""],
  ["get_uw_bars", ""],
  ["get_uw_technicals", ""],
  ["get_unusual_trades", ""],
  ["get_vector_analytics", ""],
  ["get_vector_full_state", ""],
  ["get_vector_pulse", ""],
  ["get_vix_term", ""],
  ["get_volatility_regime", ""],
  ["get_wall_dynamics", ""],
  ["get_web_search", ""],
  ["get_lit_flow", ""],
  ["get_market_oi_change", ""],
  ["get_market_stats", ""],
  ["get_option_price_history", ""],
  ["get_platform_snapshot", ""],
  ["get_polygon", ""],
  ["get_price_targets", ""],
  ["get_setup_stats", ""],
  ["get_uw", ""],
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

// The `__session` JWT dies at ~72s and one Largo question takes seconds, so a multi-tool run
// ALWAYS outlives a single token. Before this the probe captured `session.cookieHeader` once:
// measured 2026-08-23, a four-tool run aborted at the fourth with HTTP 401 and that tool went
// unprobed. The abort is honest — it refuses to call the remainder clean — but it capped this
// probe at two or three tools per invocation, against a lane list of THIRTEEN, and the documented
// workaround was to keep splitting `--tools=` by hand.
const jar = makeCookieJar(session);

async function askLargo(tool, args, cookie) {
  return fetch(`${BASE}/api/market/largo/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ question: probeQuestion(tool, args), depth: "concrete" }),
  });
}

async function probe(tool, args) {
  let res = await askLargo(tool, args, await jar.get());
  // One forced re-mint + retry: the 45s timer can still lose a race against a token that expired
  // mid-request. A 401 that SURVIVES a fresh token is a real auth failure — the run aborts on it
  // below, exactly as before — so this narrows what "aborted" means rather than hiding it.
  if (res.status === 401 || res.status === 403) {
    res = await askLargo(tool, args, await jar.force());
  }
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
