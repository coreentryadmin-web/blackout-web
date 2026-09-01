#!/usr/bin/env node
/**
 * Cortex oppose-MAGNITUDE A/B — does a stronger gex-walls oppose at commit predict a worse
 * forward outcome, or is today's small-sample pattern noise?
 *
 * WHY THIS EXISTS (2026-08-28). A live session produced 3 real losses (SNDK -50.45%, MSFT
 * -52.07%, META -50.44%) alongside 3 real wins (QQQ +63.31%, APP +20%, MUU +4.65%). SNDK and
 * META both carried an active Cortex `gex-walls` OPPOSE at commit (weight 0.58 / 0.51) — the
 * two highest oppose weights of anything committed that morning — while APP and MUU carried the
 * SAME oppose source at lower weight (0.40 / 0.37) and still won. That is a plausible dose-
 * response pattern, but n=6 in one session is not evidence: a threshold set off one morning's
 * outcomes is fitting noise, not measuring a real relationship. This script asks the same
 * question over a REAL multi-session sample instead of eyeballing a screenshot.
 *
 * DATA SOURCE. `GET /api/market/zerodte/record?days=N` already serves `entry_context.cortex`
 * pinned on every committed row (#318, zerodte-service.ts:501) — the SAME opaque Cortex blob the
 * board's play card renders, never reimplemented here — plus `managed_outcome`/`managed_pnl_pct`,
 * the as-managed forward grade (the member-facing result, not the raw mechanical one). This
 * script reads both off the SAME real production rows; it invents no data and computes no new
 * P&L — it only buckets the ALREADY-GRADED numbers by the ALREADY-PINNED evidence.
 *
 * METHOD. For every graded row with a `gex-walls` entry in `entry_context.cortex.opposes`,
 * bucket by that source's `weight` into fixed bands (the bands are fixed BEFORE looking at
 * results, not fit to them): [0, 0.2), [0.2, 0.4), [0.4, 0.6), [0.6, 1]. Report n / win rate /
 * avg pnl per band. A monotonic decline in win rate (or avg pnl) as the band rises is the
 * "magnitude predicts outcome" signal; a flat or non-monotonic shape is the null result. Rows
 * with NO gex-walls oppose (clean or opposed by something else) are reported separately as a
 * baseline, not folded into band 0 (absence of the signal is not the same as a zero-weight
 * presence of it).
 *
 * A SEPARATE bucket answers the "thin evidence" question (MSFT/NVDA both lost/phantomed with
 * `entry_context.tier.factors` carrying the literal label "Cortex thin evidence" and a genuinely
 * clean cortex.opposes=[]) — thin-evidence rows vs rows with >=2 real cortex sources engaged.
 *
 * NEVER GATES ANYTHING. Read-only measurement — same INTENTIONAL-DESIGN.md discipline as
 * veto-flicker-rate.mjs / wall-temporal-stability.mjs: evidence first, a gate change (if any)
 * is a SEPARATE, deliberate follow-up once a real sample says so.
 *
 * Flags: --days=N (default 90) --min-n=N (per-bucket refusal floor, default 10) --json
 */
import { fetchAuditJson, releaseAuditClerkSession } from "./lib/audit-auth-fetch.mjs";

function parseArgs(argv) {
  const out = { days: 90, minN: 10, json: false };
  for (const a of argv) {
    if (a === "--json") out.json = true;
    else if (a.startsWith("--days=")) out.days = Number(a.slice(7)) || out.days;
    else if (a.startsWith("--min-n=")) out.minN = Number(a.slice(8)) || out.minN;
  }
  return out;
}

const BANDS = [
  { lo: 0, hi: 0.2, label: "[0.00, 0.20)" },
  { lo: 0.2, hi: 0.4, label: "[0.20, 0.40)" },
  { lo: 0.4, hi: 0.6, label: "[0.40, 0.60)" },
  { lo: 0.6, hi: 1.01, label: "[0.60, 1.00]" },
];

function bandFor(weight) {
  return BANDS.find((b) => weight >= b.lo && weight < b.hi) ?? null;
}

function isGraded(p) {
  return p.managed_outcome != null && typeof p.managed_pnl_pct === "number";
}

function isWin(p) {
  return (p.managed_pnl_pct ?? 0) > 0;
}

function summarize(rows) {
  const n = rows.length;
  if (n === 0) return { n: 0, win_rate_pct: null, avg_pnl_pct: null };
  const wins = rows.filter(isWin).length;
  const decided = rows.filter((r) => (r.managed_pnl_pct ?? 0) !== 0).length;
  const sum = rows.reduce((acc, r) => acc + (r.managed_pnl_pct ?? 0), 0);
  return {
    n,
    win_rate_pct: decided > 0 ? Math.round((wins / decided) * 1000) / 10 : null,
    avg_pnl_pct: Math.round((sum / n) * 100) / 100,
  };
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
  const graded = plays.filter(isGraded);

  const opposeBuckets = new Map(BANDS.map((b) => [b.label, []]));
  const cleanOrOtherOppose = [];
  const thinEvidence = [];
  const richEvidence = [];
  let noContext = 0;

  for (const p of graded) {
    const ctx = p.entry_context;
    const cortex = ctx && typeof ctx.cortex === "object" ? ctx.cortex : null;
    if (!cortex) {
      noContext++;
      continue;
    }
    const opposes = Array.isArray(cortex.opposes) ? cortex.opposes : [];
    const supports = Array.isArray(cortex.supports) ? cortex.supports : [];
    const gexWallsOppose = opposes.find((o) => o?.source === "gex-walls");

    if (gexWallsOppose && typeof gexWallsOppose.weight === "number") {
      const band = bandFor(gexWallsOppose.weight);
      if (band) opposeBuckets.get(band.label).push(p);
    } else {
      cleanOrOtherOppose.push(p);
    }

    // "Thin evidence" — the tier assignment's own factor label, same string the board shows.
    const tierFactors = ctx && typeof ctx.tier === "object" ? ctx.tier?.factors : null;
    const flaggedThin =
      Array.isArray(tierFactors) && tierFactors.some((f) => f?.label === "Cortex thin evidence");
    const realSourceCount = supports.filter((s) => (s?.weight ?? 0) > 0).length + opposes.length;
    if (flaggedThin || realSourceCount <= 1) thinEvidence.push(p);
    else richEvidence.push(p);
  }

  const results = {
    window_days: args.days,
    total_plays: plays.length,
    graded_plays: graded.length,
    no_entry_context: noContext,
    gex_walls_oppose_by_magnitude: BANDS.map((b) => ({
      band: b.label,
      ...summarize(opposeBuckets.get(b.label)),
    })),
    clean_or_other_oppose_baseline: summarize(cleanOrOtherOppose),
    thin_evidence_vs_rich: {
      thin_evidence: summarize(thinEvidence),
      rich_evidence: summarize(richEvidence),
    },
  };

  if (args.json) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  console.log(`\nCortex oppose-magnitude A/B — ${args.days}d window`);
  console.log(`Total plays: ${results.total_plays}, graded: ${results.graded_plays}, no entry_context.cortex: ${results.no_entry_context}\n`);

  console.log("gex-walls OPPOSE magnitude vs forward outcome:");
  let priorWinRate = null;
  let monotonicDecline = true;
  let anyBelowFloor = false;
  for (const row of results.gex_walls_oppose_by_magnitude) {
    const flag = row.n < args.minN ? "  [n < floor — NOT a verdict]" : "";
    if (row.n < args.minN) anyBelowFloor = true;
    console.log(
      `  ${row.band}  n=${String(row.n).padStart(3)}  win_rate=${row.win_rate_pct ?? "—"}%  avg_pnl=${row.avg_pnl_pct ?? "—"}%${flag}`
    );
    if (row.n >= args.minN && row.win_rate_pct != null) {
      if (priorWinRate != null && row.win_rate_pct > priorWinRate) monotonicDecline = false;
      priorWinRate = row.win_rate_pct;
    }
  }
  console.log(
    `\nClean/other-oppose baseline (no gex-walls oppose): n=${results.clean_or_other_oppose_baseline.n}  win_rate=${results.clean_or_other_oppose_baseline.win_rate_pct ?? "—"}%  avg_pnl=${results.clean_or_other_oppose_baseline.avg_pnl_pct ?? "—"}%`
  );

  console.log("\nThin evidence (<=1 real cortex source) vs rich evidence:");
  console.log(
    `  thin:  n=${results.thin_evidence_vs_rich.thin_evidence.n}  win_rate=${results.thin_evidence_vs_rich.thin_evidence.win_rate_pct ?? "—"}%  avg_pnl=${results.thin_evidence_vs_rich.thin_evidence.avg_pnl_pct ?? "—"}%`
  );
  console.log(
    `  rich:  n=${results.thin_evidence_vs_rich.rich_evidence.n}  win_rate=${results.thin_evidence_vs_rich.rich_evidence.win_rate_pct ?? "—"}%  avg_pnl=${results.thin_evidence_vs_rich.rich_evidence.avg_pnl_pct ?? "—"}%`
  );

  console.log("\nVERDICT:");
  if (anyBelowFloor) {
    console.log(
      `  INSUFFICIENT DATA for a full verdict — at least one magnitude band has n < ${args.minN}. ` +
        "Widen --days or treat this as directional only."
    );
  } else if (monotonicDecline) {
    console.log("  MONOTONIC DECLINE — higher gex-walls oppose magnitude does predict a worse forward win rate in this sample.");
  } else {
    console.log("  NOT MONOTONIC — magnitude alone does not cleanly predict outcome in this sample; today's 6-trade pattern does not generalize as-is.");
  }
}

main().catch((e) => {
  console.error("FATAL:", e?.stack ?? e);
  process.exitCode = 1;
});
