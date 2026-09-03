#!/usr/bin/env node
/**
 * Prod monitor — 0DTE board payload shape + session funnel counters.
 * Usage: CRON_SECRET=... node scripts/audit/zerodte-board-ui-monitor.mjs [--base URL]
 */
const BASE = (process.argv.find((a) => a.startsWith("--base="))?.split("=")[1] ?? "https://blackouttrades.com").replace(/\/$/, "");
const SECRET = process.env.CRON_SECRET?.trim();
if (!SECRET) {
  console.error("CRON_SECRET required");
  process.exit(2);
}

const url = `${BASE}/api/market/zerodte/board`;
const res = await fetch(url, {
  headers: { Authorization: `Bearer ${SECRET}` },
  cache: "no-store",
});
const status = res.status;
let body;
try {
  body = await res.json();
} catch {
  body = null;
}

const report = {
  at: new Date().toISOString(),
  base: BASE,
  http: status,
  available: body?.available ?? null,
  upstream_ok: body?.upstream_ok ?? null,
  setups: Array.isArray(body?.setups) ? body.setups.length : null,
  ledger: Array.isArray(body?.ledger) ? body.ledger.length : null,
  session_stats: body?.session_stats ?? null,
  vector_near_misses: Array.isArray(body?.vector_near_misses) ? body.vector_near_misses.length : null,
  vector_pulse_keys: body?.vector_pulse_by_ticker ? Object.keys(body.vector_pulse_by_ticker).length : null,
  has_new_fields:
    body?.session_stats != null &&
    body?.vector_pulse_by_ticker != null &&
    Array.isArray(body?.vector_near_misses) &&
    (body?.veto_shadow != null || body?.veto_shadow === null),
  ledger_runner_profiles: Array.isArray(body?.ledger)
    ? body.ledger.filter((r) => r?.runner_profile != null).length
    : null,
  ledger_mfe_capture: Array.isArray(body?.ledger)
    ? body.ledger.filter((r) => r?.mfe_capture_pct != null).length
    : null,
  veto_shadow: body?.veto_shadow ?? null,
};

console.log(JSON.stringify(report, null, 2));
process.exit(status === 200 && report.has_new_fields ? 0 : status === 200 ? 1 : 1);
