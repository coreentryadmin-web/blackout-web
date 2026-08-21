/**
 * LARGO PAYLOAD HYGIENE — scan what the model actually receives, across the whole tool surface.
 *
 * WHY THIS EXISTS. Defects kept arriving one at a time, and each one read as its own story: a
 * dated close off by a session, a price printed with eleven decimals. They are one story. A number
 * reached the reader without the context needed to interpret it, and the reader filled the gap by
 * guessing. Fixing them individually is unbounded work; the only way to know how many there are is
 * to look at every tool result at once.
 *
 * So this runs the REAL `runLargoTool` against REAL upstreams and walks every leaf of every
 * response, flagging the two malformations that need no judgement to call (see
 * `lib/payload-hygiene.mjs`). It reports per-tool, so the output is a WORK LIST, not a verdict.
 *
 * Coverage is stated out loud. A tool that threw is reported as ERROR, never folded into "clean" —
 * "the probe never ran" must not read as "nothing wrong here", the same rule the Meridian
 * interaction audit learned the hard way.
 *
 * READ-ONLY. No DB writes, no Clerk user, no prod mutation — it calls read tools only.
 *
 * Run from the REPO ROOT:
 *   node --require ./scripts/audit/lib/allow-server-only.cjs --import tsx \
 *     scripts/audit/largo-payload-hygiene.mjs [--ticker=SPX] [--tools=a,b] [--timeout=90] [--json]
 */
import { classifyResult, countNumericLeaves, scanPayload, summarize } from "./lib/payload-hygiene.mjs";
import { resolveToolSelection } from "./lib/tool-selection.mjs";

// MEASURE WHAT THE MODEL ACTUALLY RECEIVES, not what runLargoTool returns.
//
// The model never sees a raw tool result: every call goes through makeGuardedToolRunner, which
// applies roundResultForReading at the boundary where data stops being computed with and starts
// being read (#2419). This harness called runLargoTool DIRECTLY, so it was scanning a payload that
// no model ever sees — it would have kept reporting hundreds of unrounded floats that are rounded
// by the time they reach the reader, and it could not verify the rounding fix at all.
//
// A scanner that measures the wrong surface is worse than no scanner, because its number looks
// authoritative. So the harness now mirrors the real path.

const arg = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};
const JSON_OUT = process.argv.includes("--json");
const TICKER = arg("ticker", "SPX");
/** Per-tool deadline. A tool that cannot reach its upstream must fail LOUDLY and let the
 *  run continue, not wedge it. Without this the scan hangs indefinitely on the first
 *  unreachable dependency — which is exactly what a sandbox with no route to Postgres
 *  does to every DB-backed tool in the list. A hang is an unknown, and this turns it
 *  into a reported ERROR, which the summary already refuses to count as a pass. */
const TIMEOUT_MS = Math.max(1, Number(arg("timeout", "90"))) * 1000;
/** `--tools=a,b` — scan only these. Documented since this file was written but never
 *  parsed, so passing it silently scanned the FULL default list and printed a verdict
 *  for tools the operator had not asked about. That is this file's own stated failure
 *  mode ("the probe never ran" must not read as "nothing wrong here") committed by the
 *  file itself: a scan you did not run, laundered as one you did. */
// POLYGON_API_BASE is often the unresolved `${{shared.*}}` placeholder in this sandbox
// (it arrives as the literal string "POLYGON_API_BASE") — accept it ONLY when it is a real
// http(s) URL, else fall back to the code's own default host. Same guard every sibling audit
// script carries; without it every Polygon-backed tool in the list ERRORs on a disallowed
// host, which is loud but makes the harness unrunnable out of the box.
const rawBase = process.env.POLYGON_API_BASE;
process.env.POLYGON_API_BASE =
  rawBase && /^https?:\/\//.test(rawBase) ? rawBase : "https://api.massive.com";

const ONLY = (arg("tools", "") || "")
  .split(",")
  .map((t) => t.trim())
  .filter(Boolean);

// Read-only tools whose results are DATA the model reasons over numerically. Deliberately not all
// 126: the rest are prose/product reads where a stray float changes nothing a member can see.
// Every skip is a judgement, so the list is explicit rather than a filter nobody can audit.
const TOOLS = [
  ["get_uw_bars", { ticker: TICKER, candle_size: "1d" }],
  ["get_uw_bars", { ticker: TICKER, candle_size: "5m" }],
  ["get_polygon", { endpoint: `/v2/aggs/ticker/I:SPX/range/1/day/2026-08-10/2026-08-20` }],
  ["get_polygon", { endpoint: `/v2/aggs/ticker/SPY/range/15/minute/2026-08-19/2026-08-20` }],
  ["get_quote", { ticker: TICKER }],
  ["get_nbbo", { ticker: "SPY" }],
  ["get_technicals", { ticker: TICKER }],
  ["get_gex_heatmap", { ticker: TICKER }],
  ["get_gex", { ticker: TICKER }],
  ["get_greeks", { ticker: TICKER }],
  ["get_greek_flow", { ticker: TICKER }],
  ["get_options_flow", { ticker: TICKER }],
  ["get_flow_per_strike", { ticker: TICKER }],
  ["get_flow_expiry_breakdown", { ticker: TICKER }],
  ["get_dark_pool", { ticker: "SPY" }],
  ["get_max_pain", { ticker: TICKER }],
  ["get_options_chain", { ticker: TICKER }],
  ["get_atm_chains", { ticker: TICKER }],
  ["get_oi_per_strike", { ticker: TICKER }],
  ["get_iv_stats", { ticker: TICKER }],
  ["get_positioning", { ticker: TICKER }],
  ["get_wall_dynamics", { ticker: TICKER }],
  ["get_spx_pin", { ticker: TICKER }],
  ["get_market_stats", {}],
  ["get_market_breadth", {}],
  ["get_hot_tickers", {}],
  ["get_vector_pulse", { ticker: TICKER }],
  ["get_vector_full_state", { ticker: TICKER }],
<<<<<<< HEAD
  // ── Night Hawk / 0DTE lane ────────────────────────────────────────────────────
  // Added for the same reason the rest of the list exists: these are DATA reads the
  // model reasons over numerically — option premiums, realized P&L, win rates,
  // gross-premium gates. A stray float or a bare epoch here reaches a member as a
  // trade number, which is the highest-consequence place on the surface for one.
  // (Every skip in this file is a judgement, so every ADDITION gets one too.)
  ["get_zerodte_plays", {}],
  ["get_zerodte_record", { days: 30 }],
  ["get_zerodte_rejections", {}],
  ["get_nighthawk_edition", {}],
  ["get_nighthawk_outcomes", {}],
  ["get_nighthawk_horizons", {}],
  ["get_nighthawk_dossier", {}],
  ["get_horizon_outcomes", {}],
  ["get_swing_horizon", {}],
  ["get_banger_board", {}],
  ["get_gate_blocked_value", { days: 30 }],
  ["get_grader_agreement", { days: 90 }],
  ["get_cortex_decision", { ticker: TICKER }],
  ["get_lotto_state", {}],
  ["get_lotto_live", {}],
  ["get_spx_play", {}],
  ["get_open_plays", {}],
  // Earnings surface. Scoped to a LARGE-CAP ticker on purpose: sampling earnings by date returns
  // micro-caps with no options market, against which the options-derived fields read as empty and
  // a reader would wrongly conclude the datasets are dead (the cohort trap
  // meridian-earnings-data-inventory.mjs carries a guard for). NVDA is optionable and liquid, so
  // an empty field here is a real finding rather than an artifact of the cohort.
  ["get_earnings", { ticker: "NVDA" }],
  ["get_earnings_history", { ticker: "NVDA" }],
  ["get_earnings_market", {}],
  ["get_earnings_calendar", { ticker: "NVDA" }],
=======
  // Vector's chart-analytics surface. Absent from this list until 2026-08-21, which is why its 21
  // bare-epoch leaves in `market_structure` went unscanned — a tool the scanner never calls is not
  // a clean tool, and the omission is invisible unless the list is read.
  ["get_vector_analytics", { ticker: TICKER }],
>>>>>>> 0f5f261 (fix(vector): structure breaks carried a bare epoch across a 3-session seed)
];

// tsx's CJS interop puts the exports under `default` on some resolution paths and at the top level
// on others, so take whichever one actually carries the function rather than assuming a shape.
const roundMod = await import(
  new URL("../../src/lib/largo/core/round-for-reading.ts", import.meta.url).pathname
);
const roundResultForReading =
  roundMod.roundResultForReading ?? roundMod.default?.roundResultForReading;
if (typeof roundResultForReading !== "function") {
  console.error("could not resolve roundResultForReading — refusing to scan the wrong surface");
  process.exit(2);
}

const mod = await import(new URL("../../src/lib/largo/run-tool.ts", import.meta.url).pathname);
const runLargoTool = mod.runLargoTool ?? mod.default?.runLargoTool;
if (typeof runLargoTool !== "function") {
  console.error("could not resolve runLargoTool; module keys:", Object.keys(mod));
  process.exit(2);
}

// Validate every name against the REAL registry before running anything. An invented tool name
// returns instantly with no data, which reads as EMPTY — i.e. "this tool has no data" rather than
// "this tool does not exist". The first run of this harness reported coverage of 9/19 on that
// basis, and five of the ten missing were names that had never existed. A typo must be a loud
// harness failure, never a quiet product verdict.
const defsMod = await import(new URL("../../src/lib/largo/tool-defs.ts", import.meta.url).pathname);
const defsNs = defsMod.default ?? defsMod;
const defs = Object.values(defsNs).find((v) => Array.isArray(v) && v[0]?.name);
const KNOWN = new Set((defs ?? []).map((d) => d.name));
const unknown = [...new Set(TOOLS.map(([n]) => n))].filter((n) => !KNOWN.has(n));
if (!KNOWN.size) {
  console.error("could not read the tool registry — refusing to run a scan that cannot be validated");
  process.exit(2);
}
if (unknown.length) {
  console.error(`HARNESS ERROR — these tool names do not exist: ${unknown.join(", ")}`);
  process.exit(2);
}

// Apply --tools AFTER the registry validation above, so a name that does not exist is a
// harness error rather than an empty selection that reads as "nothing to report".
// Selection logic lives in ./lib/tool-selection.mjs and is unit-tested, per this
// directory's rule that verdict-shaped helpers are not left inline and unproven.
const selection = resolveToolSelection(ONLY, TOOLS, KNOWN);
if (selection.unknown.length) {
  console.error(`HARNESS ERROR — not real tool names: ${selection.unknown.join(", ")}`);
  process.exit(2);
}
if (selection.uncurated.length) {
  console.error(
    `HARNESS ERROR — these are real tools but this harness has no argument recipe for them: ` +
      `${selection.uncurated.join(", ")}. Add them to TOOLS (with the inputs they need) rather ` +
      `than letting the scan quietly omit them.`
  );
  process.exit(2);
}
const SELECTED = selection.selected;
if (selection.filtered) {
  // Say what is being scanned. A narrowed run and a full run otherwise print the same
  // shape of summary, and mistaking one for the other is how a partial pass gets quoted
  // as whole-surface coverage.
  console.error(`(scanning ${SELECTED.length} selected tool(s) of ${TOOLS.length} curated)`);
}

const rows = [];
for (const [name, input] of SELECTED) {
  const label = `${name}(${Object.values(input).join(",") || "-"})`;
  const t0 = Date.now();
  try {
    // BOTH guards are wanted and they compose in this order. The timeout race stops one hung tool
    // stalling the whole audit; roundResultForReading is the same transform makeGuardedToolRunner
    // applies before the model sees anything — without it this scanner measures a surface no model
    // ever reads, and reports precision defects the guarded runner has already removed.
    const raw = await Promise.race([
      runLargoTool(name, input, "payload-hygiene-audit"),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`TIMEOUT after ${TIMEOUT_MS / 1000}s`)), TIMEOUT_MS).unref()
      ),
    ]);
    const result = roundResultForReading(raw);
    const { findings, truncated } = scanPayload(result);
    // A payload with (almost) no numbers in it did not really run — placeholder creds, a refused
    // host, an empty upstream. It scans clean by construction, so it must NOT be counted as clean.
    const status = classifyResult(result) === "empty" ? "EMPTY" : "OK";
    rows.push({ label, status, ms: Date.now() - t0, findings, truncated, leaves: countNumericLeaves(result) });
  } catch (e) {
    rows.push({
      label,
      status: "ERROR",
      ms: Date.now() - t0,
      error: e instanceof Error ? e.message : String(e),
      findings: [],
    });
  }
}

const all = rows.flatMap((r) => r.findings);
const ok = rows.filter((r) => r.status === "OK");
const empty = rows.filter((r) => r.status === "EMPTY");
const errored = rows.filter((r) => r.status === "ERROR");
const dirty = ok.filter((r) => r.findings.length > 0);

if (JSON_OUT) {
  console.log(JSON.stringify({ rows, summary: summarize(all) }, null, 2));
} else {
  for (const r of rows) {
    if (r.status === "ERROR") {
      console.log(`\n[ERROR] ${r.label} — ${r.error.slice(0, 160)}`);
      continue;
    }
    const tag =
      r.status === "EMPTY"
        ? `no data (${r.leaves} numeric leaves) — NOT a pass`
        : r.findings.length
          ? `${r.findings.length} FLAGGED`
          : `clean (${r.leaves} numeric leaves)`;
    console.log(`\n[${r.status}] ${r.label} ${r.ms}ms — ${tag}${r.truncated ? " (TRUNCATED)" : ""}`);
    for (const f of r.findings.slice(0, 6)) {
      console.log(`    ${f.kind.padEnd(16)} ${f.path} = ${f.value}  (${f.detail})`);
    }
    if (r.findings.length > 6) console.log(`    … ${r.findings.length - 6} more`);
  }
  console.log(
    `\n=== ${ok.length - dirty.length}/${ok.length} SCANNED tools clean · ${all.length} flagged leaves ` +
      `· ${empty.length} EMPTY · ${errored.length} ERRORED (neither counted as clean) ===`
  );
  if (empty.length || errored.length) {
    console.log(
      `    coverage: ${ok.length}/${rows.length} tools actually returned data. ` +
        `An EMPTY or ERRORED tool is an UNKNOWN, not a pass.`
    );
  }
  console.log(`    ${JSON.stringify(summarize(all))}`);
}

// A tool that threw or came back empty is an unknown, not a pass.
process.exit(all.length || errored.length || empty.length ? 1 : 0);
