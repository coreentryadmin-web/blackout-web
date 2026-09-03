#!/usr/bin/env node
/**
 * Prod monitor — 0DTE board payload shape + session funnel counters.
 * Usage: node scripts/audit/zerodte-board-ui-monitor.mjs [--base URL]
 *
 * Auth: CRON bearer first (AWS Secrets Manager when available), Clerk premium
 * session fallback — cloud-agent CRON_SECRET often mismatches prod.
 */
import { fetchAuditJson, releaseAuditClerkSession } from "./lib/audit-auth-fetch.mjs";

const BASE = (process.argv.find((a) => a.startsWith("--base="))?.split("=")[1] ?? "https://blackouttrades.com").replace(/\/$/, "");

const { ok, status, json: body, via } = await fetchAuditJson(BASE, "/api/market/zerodte/board");
await releaseAuditClerkSession();

const report = {
  at: new Date().toISOString(),
  base: BASE,
  http: status,
  via,
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
process.exit(ok && report.has_new_fields ? 0 : 1);
