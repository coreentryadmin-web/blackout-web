/**
 * Shared loader for the persisted 0DTE flow-history store (`docs/audit/history/zerodte-flow/`,
 * built by `zerodte-history-collect.mjs`). Read-only, local-disk only — no network, no UW calls.
 *
 * Every point-in-time replay tool in this toolkit should load real session days from here FIRST
 * (free, instant, grows across runs as the collector keeps extending the store) and only fall
 * back to a live multi-day UW fetch for whatever recent days aren't on disk yet — never re-pay
 * the same page budget for history that's already been collected once.
 */
import fs from "node:fs";
import path from "node:path";

const HISTORY_DIR = new URL("../../../docs/audit/history/zerodte-flow/", import.meta.url).pathname;

/**
 * Returns a Map<day, rows[]> for every persisted day whose ET date falls within
 * [cutoffMs, endMs] (inclusive). Rows are the same compact shape the collector writes:
 * { ticker, premium, option_type, strike, expiry, dte, alert_rule, ask_pct, underlying_price,
 *   fill_price, open_interest, alerted_at }.
 */
export function loadHistoricalFlowDays({ cutoffMs, endMs = Date.now() } = {}) {
  const byDay = new Map();
  let files = [];
  try {
    files = fs.readdirSync(HISTORY_DIR).filter((f) => f.endsWith(".json") && !f.startsWith("."));
  } catch {
    return byDay; // store doesn't exist yet — nothing to load, never throws
  }
  for (const f of files) {
    const day = f.replace(/\.json$/, "");
    const dayMs = Date.parse(`${day}T12:00:00Z`); // midday anchor — any ET session day is within +/-12h
    if (!Number.isFinite(dayMs)) continue;
    if (cutoffMs != null && dayMs < cutoffMs - 86_400_000) continue;
    if (dayMs > endMs + 86_400_000) continue;
    try {
      const rows = JSON.parse(fs.readFileSync(path.join(HISTORY_DIR, f), "utf8"));
      if (Array.isArray(rows)) byDay.set(day, rows);
    } catch (e) {
      console.warn(`  [history] failed to read ${f}: ${e instanceof Error ? e.message : e}`);
    }
  }
  return byDay;
}

export function listHistoricalDays() {
  try {
    return fs.readdirSync(HISTORY_DIR).filter((f) => f.endsWith(".json") && !f.startsWith(".")).map((f) => f.replace(/\.json$/, "")).sort();
  } catch {
    return [];
  }
}
