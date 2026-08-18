#!/usr/bin/env node
/**
 * Meridian earnings DATA INVENTORY — what is actually populated, per ticker, live.
 *
 * Built BEFORE the earnings-UI redesign, on the principle that a visualization of a field
 * nobody has measured is a promise the data may not keep. The type surface
 * (`meridian-types.ts`) declares ~40 earnings-related blocks; declaring them says nothing
 * about whether prod fills them. A chart designed against an optional field that is null
 * 90% of the time ships as a permanently empty panel.
 *
 * So this walks REAL prod earnings events and reports a per-field FILL RATE across them:
 *   ALWAYS (>=90%)  — safe to make a primary visual
 *   USUALLY (>=60%) — visual with an honest empty state
 *   SOMETIMES (>=20%)— secondary / progressive-disclosure only
 *   RARE (<20%)     — keep textual, or drop
 *
 * Read-only. One temp Clerk user via the shared helper, released in a finally.
 * Never prints secrets.
 *
 * Usage: node scripts/audit/meridian-earnings-data-inventory.mjs [--tickers=N] [--json]
 */
import { fetchAuditJson, releaseAuditClerkSession } from "./lib/audit-auth-fetch.mjs";

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v = "true"] = a.replace(/^--/, "").split("=");
    return [k, v];
  })
);
const BASE = args.get("base") ?? "https://blackouttrades.com";
const MAX = Number(args.get("tickers") ?? 12);
const JSON_OUT = args.get("json") === "true";

/** Leaf-path walker. Arrays report length; we care about "is there anything here", not shape. */
function walk(node, prefix, out) {
  if (node === null || node === undefined) {
    out.set(prefix, { present: false, empty: true });
    return;
  }
  if (Array.isArray(node)) {
    out.set(prefix, { present: node.length > 0, empty: node.length === 0, n: node.length });
    // Descend into the FIRST element only — element shape is uniform, and walking all of
    // them would swamp the report with per-index paths.
    if (node.length > 0 && typeof node[0] === "object" && node[0] !== null) {
      walk(node[0], `${prefix}[]`, out);
    }
    return;
  }
  if (typeof node === "object") {
    for (const [k, v] of Object.entries(node)) walk(v, prefix ? `${prefix}.${k}` : k, out);
    return;
  }
  // Scalars: "" and NaN count as absent — a field technically present but carrying nothing
  // is exactly the case that produces an empty chart.
  const empty = node === "" || (typeof node === "number" && !Number.isFinite(node));
  out.set(prefix, { present: !empty, empty });
}

function bucket(pct) {
  if (pct >= 90) return "ALWAYS";
  if (pct >= 60) return "USUALLY";
  if (pct >= 20) return "SOMETIMES";
  return "RARE";
}

async function main() {
  // fetchAuditJson returns an ENVELOPE ({ok,status,json,via}), not the body. Unwrapping is
  // not optional cleanliness — reading `.items` off the envelope silently yields [] and the
  // whole inventory reports "no earnings events" against a timeline holding hundreds.
  const timelineRes = await fetchAuditJson(BASE, "/api/market/meridian/timeline");
  const timeline = timelineRes?.json ?? timelineRes;
  const items = Array.isArray(timeline?.items) ? timeline.items : [];
  // SAMPLING BIAS GUARD. The timeline is date-ordered, so a naive head-slice returns whatever
  // micro-caps report next — names with no options market at all. Against that sample
  // flow/dark-pool/gamma read as 0% filled, and a redesign would wrongly conclude those
  // datasets are dead when they are simply absent for a $40M biotech. `--min-importance`
  // samples the liquid, optionable names those visuals are actually FOR. Always report which
  // cohort a fill rate came from; a fill rate without its cohort is not a fact about the field.
  const MIN_IMP = args.has("min-importance") ? Number(args.get("min-importance")) : null;
  const pool = items.filter((i) => i.kind === "earnings" && i.ticker);
  const earnings = (MIN_IMP == null
    ? pool
    : pool
        .filter((i) => Number(i.importance ?? -1) >= MIN_IMP)
        .sort((a, b) => Number(b.importance ?? 0) - Number(a.importance ?? 0))
  ).slice(0, MAX);
  console.log(
    `COHORT: ${MIN_IMP == null ? "next-by-date (ALL importances)" : `importance >= ${MIN_IMP}`} — ${earnings.length} of ${pool.length} earnings events`
  );

  if (earnings.length === 0) {
    console.log("INSUFFICIENT DATA — no earnings events on the live timeline right now.");
    return;
  }

  const fieldHits = new Map(); // path -> count present
  const perTicker = [];
  let sampled = 0;

  for (const ev of earnings) {
    let detail;
    try {
      const res = await fetchAuditJson(BASE, `/api/market/meridian/event?id=${encodeURIComponent(ev.id)}`);
      detail = res?.json ?? res;
    } catch (err) {
      perTicker.push({ ticker: ev.ticker, error: String(err?.message ?? err).slice(0, 120) });
      continue;
    }
    if (!detail || detail.kind !== "earnings") {
      perTicker.push({ ticker: ev.ticker, error: `kind=${detail?.kind ?? "none"}` });
      continue;
    }
    sampled += 1;
    const flat = new Map();
    walk(detail, "", flat);
    for (const [path, info] of flat) {
      if (info.present) fieldHits.set(path, (fieldHits.get(path) ?? 0) + 1);
      else if (!fieldHits.has(path)) fieldHits.set(path, fieldHits.get(path) ?? 0);
    }
    perTicker.push({
      ticker: ev.ticker,
      prints: detail.enrichment?.print_history?.length ?? 0,
      targets: detail.enrichment?.price_targets?.length ?? 0,
      revisions: detail.enrichment?.analyst_revisions?.length ?? 0,
      signals: detail.intel?.report?.signals?.length ?? 0,
      expMove: detail.intel?.expected_move_pct ?? null,
      darkPrints: detail.intel?.dark_pool?.top_prints?.length ?? 0,
      flowPrints: detail.intel?.flow_into_print?.top_prints?.length ?? 0,
      thermal: detail.intel?.thermal?.available ?? false,
    });
  }

  if (sampled === 0) {
    console.log("INSUFFICIENT DATA — every earnings event failed to load.");
    console.log(perTicker);
    return;
  }

  const rows = [...fieldHits.entries()]
    .map(([path, hits]) => ({ path, hits, pct: Math.round((hits / sampled) * 100) }))
    .sort((a, b) => b.pct - a.pct || a.path.localeCompare(b.path));

  if (JSON_OUT) {
    console.log(JSON.stringify({ sampled, perTicker, rows }, null, 2));
    return;
  }

  console.log(`\nMERIDIAN EARNINGS DATA INVENTORY — ${sampled} live earnings events\n`);
  console.log("PER-TICKER COUNTS");
  for (const t of perTicker) {
    if (t.error) {
      console.log(`  ${String(t.ticker).padEnd(6)} ERROR ${t.error}`);
      continue;
    }
    console.log(
      `  ${String(t.ticker).padEnd(6)} prints=${String(t.prints).padStart(2)} targets=${String(t.targets).padStart(2)} ` +
        `revisions=${String(t.revisions).padStart(2)} signals=${String(t.signals).padStart(2)} ` +
        `dark=${String(t.darkPrints).padStart(2)} flow=${String(t.flowPrints).padStart(2)} ` +
        `thermal=${t.thermal ? "Y" : "n"} expMove=${t.expMove ?? "—"}`
    );
  }

  for (const b of ["ALWAYS", "USUALLY", "SOMETIMES", "RARE"]) {
    const inBucket = rows.filter((r) => bucket(r.pct) === b);
    console.log(`\n── ${b} (${inBucket.length} fields) ──`);
    for (const r of inBucket) console.log(`  ${String(r.pct).padStart(3)}%  ${r.path}`);
  }
}

main()
  .catch((err) => {
    console.error("FAILED:", err?.message ?? err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await releaseAuditClerkSession().catch(() => {});
  });
