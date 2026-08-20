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
 *     scripts/audit/largo-payload-hygiene.mjs [--ticker=SPX] [--tools=a,b] [--json]
 */
import { scanPayload, summarize } from "./lib/payload-hygiene.mjs";

const arg = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};
const JSON_OUT = process.argv.includes("--json");
const TICKER = arg("ticker", "SPX");

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
  ["get_spot_exposures", { ticker: TICKER }],
  ["get_greek_exposure", { ticker: TICKER }],
  ["get_flow_alerts", { ticker: TICKER }],
  ["get_darkpool", { ticker: "SPY" }],
  ["get_net_flow_expiry", { ticker: TICKER }],
  ["get_max_pain", { ticker: TICKER }],
  ["get_option_chain", { ticker: TICKER }],
  ["get_market_stats", {}],
  ["get_hot_tickers", {}],
  ["get_vector_pulse", { ticker: TICKER }],
  ["get_vector_full_state", { ticker: TICKER }],
];

// tsx's CJS interop puts the exports under `default` on some resolution paths and at the top level
// on others, so take whichever one actually carries the function rather than assuming a shape.
const mod = await import(new URL("../../src/lib/largo/run-tool.ts", import.meta.url).pathname);
const runLargoTool = mod.runLargoTool ?? mod.default?.runLargoTool;
if (typeof runLargoTool !== "function") {
  console.error("could not resolve runLargoTool; module keys:", Object.keys(mod));
  process.exit(2);
}

const rows = [];
for (const [name, input] of TOOLS) {
  const label = `${name}(${Object.values(input).join(",") || "-"})`;
  const t0 = Date.now();
  try {
    const result = await runLargoTool(name, input, "payload-hygiene-audit");
    const { findings, truncated } = scanPayload(result);
    rows.push({ label, status: "OK", ms: Date.now() - t0, findings, truncated });
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
    const tag = r.findings.length ? `${r.findings.length} FLAGGED` : "clean";
    console.log(`\n[${r.status}] ${r.label} ${r.ms}ms — ${tag}${r.truncated ? " (TRUNCATED)" : ""}`);
    for (const f of r.findings.slice(0, 6)) {
      console.log(`    ${f.kind.padEnd(16)} ${f.path} = ${f.value}  (${f.detail})`);
    }
    if (r.findings.length > 6) console.log(`    … ${r.findings.length - 6} more`);
  }
  console.log(
    `\n=== ${ok.length - dirty.length}/${ok.length} tools clean · ${all.length} flagged leaves ` +
      `· ${errored.length} ERRORED (not counted as clean) ===`
  );
  console.log(`    ${JSON.stringify(summarize(all))}`);
}

// A tool that threw is an unknown, not a pass — exit non-zero on findings OR on errors.
process.exit(all.length || errored.length ? 1 : 0);
