#!/usr/bin/env node
/**
 * Cortex gex-walls REGIME-STYLE-OPPOSE on CONDOR commits — a measurement, not a fix.
 *
 * WHY THIS EXISTS (2026-09-17, Night Hawk 0DTE architecture deep-dive, follow-up to the four
 * "condor cast a false directional vote" fixes shipped the same day — product-adapters.ts/
 * consensus-read-extract.ts, governor.ts, thesis-health.ts, confluence.ts). `scan.ts` calls
 * `evaluateCortexForCommit(ticker, direction, ...)` UNCONDITIONALLY for every gate-surviving
 * setup, CONDOR included, passing the condor's nominal `direction` (condor.ts's own doc: "carries
 * the pin's nominal fade side for provenance but is UNUSED by the neutral structure's
 * gates/grader"). `gex-walls.ts`'s own file header states an assumption that does not hold for a
 * condor: "Every 0DTE Command commit is momentum-style by construction... so posture 'long'
 * opposes any direction" — and `deriveGexWallsEvidence` has an unconditional
 * `if (gex.regimePosture === "long")` oppose (weight 0.6) whose detail text reads "mean-reversion
 * regime opposes trend-following entries." A condor is ONLY EVER sold in exactly that regime
 * (`condorSellRegime`'s own long-gamma-pin gate) — so on paper this oppose should fire on
 * essentially every real condor commit, mislabeling the market condition a condor WANTS as
 * evidence against the trade. THIS SCRIPT MEASURES WHETHER THAT ACTUALLY HAPPENS on real
 * committed condor rows, rather than trusting the code-reading hunch — same "measure before
 * guessing" discipline as `cortex-oppose-magnitude-ab.mjs` / `veto-flicker-rate.mjs`
 * (docs/audit/INTENTIONAL-DESIGN.md).
 *
 * NEVER GATES ANYTHING. Read-only measurement against the SAME already-pinned
 * `entry_context.cortex` blob every committed row carries off
 * `GET /api/market/zerodte/record?days=N` (real production data, one temp Clerk session,
 * released after) — nothing reimplemented, nothing recomputed from scratch. Answers three
 * questions, in order:
 *
 *   (1) How often does the gex-walls regime-style-oppose actually fire on a real committed
 *       CONDOR row (presence rate, weight distribution)?
 *   (2) Does it ever swing the CONVICTION BAND (A/B/C) for a condor specifically? Computed as a
 *       counterfactual off the row's OWN persisted `score` (score_without_oppose = score +
 *       oppose.weight) — informative even though it does NOT model the commit-relief/dwell layer
 *       (`applyCortexCommitRelief`/`applyCortexVetoDwell`), which this tool explicitly does not
 *       replay; see the "NOT MEASURED" disclosure below. A committed row's `decision` is always a
 *       PASS-shaped one by definition (a genuine BLOCK never reaches the ledger this route reads),
 *       so "swings a net decision" here means band suppression, not a resurrected veto.
 *   (3) Same question for gex-walls' OTHER evidence shape, wallPathCheck's veto/support framing —
 *       does a condor commit ever carry a gex-walls VETO at all (it should structurally never
 *       reach the ledger if so — a real hit here is itself an anomaly worth a human look), and how
 *       often does the (also nominal-direction-framed) wallPathCheck SUPPORT fire.
 *
 * NOT MEASURED (disclosed, not silently glossed over): the commit-relief/veto-dwell layer that
 * runs BETWEEN Cortex composing a verdict and it landing in `entry_context.cortex` — so a
 * `band_suppressed_by_regime_oppose:true` row here is evidence the RAW compose-time band was
 * pulled down by this specific item, not proof a real member-facing outcome differed (relief could
 * have already compensated in some other way this tool doesn't see). This is a bias in ONE
 * direction: it can only ever UNDERSTATE how often relief already fixed the effect, never invent a
 * suppression that wasn't really in the persisted evidence.
 *
 * Flags: --days=N (default 90) --json
 */
import { fetchAuditJson, releaseAuditClerkSession } from "./lib/audit-auth-fetch.mjs";
import { classifyCondorCortexRow } from "./lib/cortex-condor-oppose-eval.mjs";

function parseArgs(argv) {
  const out = { days: 90, json: false };
  for (const a of argv) {
    if (a === "--json") out.json = true;
    else if (a.startsWith("--days=")) out.days = Number(a.slice(7)) || out.days;
  }
  return out;
}

/** Same structural check production uses (condor-record.ts's own isCondorRow). */
function isCondorRow(entryContext) {
  return !!entryContext && entryContext.play_type === "CONDOR";
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const base = "https://blackouttrades.com";
  let record;
  try {
    const res = await fetchAuditJson(base, `/api/market/zerodte/record?days=${args.days}`);
    if (!res?.ok) {
      console.error(`FETCH FAILED — status ${res?.status}. INSUFFICIENT DATA.`);
      process.exitCode = 1;
      return;
    }
    record = res.json;
  } finally {
    await releaseAuditClerkSession();
  }

  const plays = Array.isArray(record?.plays) ? record.plays : [];
  const condorRows = plays.filter((p) => isCondorRow(p?.entry_context));

  let noCortexBlob = 0;
  let abstained = 0;
  const classified = [];
  for (const row of condorRows) {
    const cortex = row.entry_context && typeof row.entry_context.cortex === "object" ? row.entry_context.cortex : null;
    if (!cortex) {
      noCortexBlob++;
      continue;
    }
    if (cortex.abstained) {
      abstained++;
      continue;
    }
    const c = classifyCondorCortexRow(cortex);
    if (c) classified.push({ ticker: row.ticker, session_date: row.session_date, ...c });
  }

  const withRegimeOppose = classified.filter((c) => c.has_regime_oppose);
  const materialRegimeOppose = classified.filter((c) => c.regime_oppose_material);
  const bandSuppressed = classified.filter((c) => c.band_suppressed_by_regime_oppose);
  const wallVetoAnomalies = classified.filter((c) => c.has_wall_path_veto);
  const withWallSupport = classified.filter((c) => c.has_wall_path_support);

  const weights = withRegimeOppose.map((c) => c.regime_oppose_weight).filter((w) => typeof w === "number");
  const avgWeight = weights.length ? Math.round((weights.reduce((a, b) => a + b, 0) / weights.length) * 1000) / 1000 : null;

  const results = {
    window_days: args.days,
    total_plays: plays.length,
    condor_rows: condorRows.length,
    no_cortex_blob: noCortexBlob,
    abstained,
    classified: classified.length,
    q1_regime_oppose_presence: {
      n_with_regime_oppose: withRegimeOppose.length,
      n_material_ge_presence_floor: materialRegimeOppose.length,
      presence_rate_pct: classified.length ? Math.round((withRegimeOppose.length / classified.length) * 1000) / 10 : null,
      avg_weight: avgWeight,
    },
    q2_conviction_band_suppression: {
      n_band_suppressed: bandSuppressed.length,
      rows: bandSuppressed.map((c) => ({
        ticker: c.ticker,
        session_date: c.session_date,
        score: c.score,
        score_without_regime_oppose: c.score_without_regime_oppose,
        actual_band: c.conviction_band,
        counterfactual_band: c.counterfactual_band_without_regime_oppose,
      })),
    },
    q3_wall_path_framing: {
      n_veto_anomalies: wallVetoAnomalies.length,
      veto_anomaly_rows: wallVetoAnomalies.map((c) => ({ ticker: c.ticker, session_date: c.session_date })),
      n_with_support: withWallSupport.length,
      support_rate_pct: classified.length ? Math.round((withWallSupport.length / classified.length) * 1000) / 10 : null,
    },
  };

  if (args.json) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  console.log(`\nCortex gex-walls regime-style-oppose on CONDOR commits — ${args.days}d window`);
  console.log(
    `Total plays: ${results.total_plays}, condor rows: ${results.condor_rows}, ` +
      `no cortex blob: ${results.no_cortex_blob}, abstained: ${results.abstained}, classified: ${results.classified}\n`
  );

  if (results.classified === 0) {
    console.log("INSUFFICIENT DATA — no committed condor rows with a real (non-abstained) Cortex blob in this window.");
    console.log("Widen --days, or the condor engine hasn't committed enough this window to answer this yet.");
    return;
  }

  console.log("Q1 — regime-style-oppose PRESENCE:");
  console.log(
    `  ${results.q1_regime_oppose_presence.n_with_regime_oppose}/${results.classified} condor commits carry it ` +
      `(${results.q1_regime_oppose_presence.presence_rate_pct}%), ` +
      `${results.q1_regime_oppose_presence.n_material_ge_presence_floor} clear the 0.2 presence floor. ` +
      `Avg weight when present: ${results.q1_regime_oppose_presence.avg_weight ?? "—"}.`
  );

  console.log("\nQ2 — does it ever SUPPRESS the conviction band (A/B/C)?");
  if (results.q2_conviction_band_suppression.n_band_suppressed === 0) {
    console.log("  0 rows — in this sample, the oppose never pushed a condor's own persisted score across a band floor.");
  } else {
    console.log(`  ${results.q2_conviction_band_suppression.n_band_suppressed} row(s) suppressed:`);
    for (const r of results.q2_conviction_band_suppression.rows) {
      console.log(
        `    ${r.ticker} ${r.session_date}: score ${r.score} (${r.actual_band}) -> would be ${r.score_without_regime_oppose} (${r.counterfactual_band}) without the oppose`
      );
    }
  }

  console.log("\nQ3 — wallPathCheck veto/support framing:");
  console.log(
    `  gex-walls VETO on a committed condor row (should structurally never happen): ${results.q3_wall_path_framing.n_veto_anomalies}` +
      (results.q3_wall_path_framing.n_veto_anomalies > 0
        ? ` — ${results.q3_wall_path_framing.veto_anomaly_rows.map((r) => `${r.ticker} ${r.session_date}`).join(", ")} — INVESTIGATE`
        : "")
  );
  console.log(
    `  real wallPathCheck SUPPORT present: ${results.q3_wall_path_framing.n_with_support}/${results.classified} (${results.q3_wall_path_framing.support_rate_pct}%)`
  );

  console.log(
    "\nNOT MEASURED: the commit-relief/veto-dwell layer between compose-time and the persisted blob — " +
      "a band-suppressed row above is evidence in the raw pinned evidence, not a proven member-facing outcome difference. " +
      "See this script's own header for the full disclosure."
  );
}

main().catch((e) => {
  console.error("FATAL:", e?.stack ?? e);
  process.exitCode = 1;
});
