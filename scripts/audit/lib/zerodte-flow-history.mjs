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

// CORRECTNESS BUG, CAUGHT LIVE 2026-10-20 (building zerodte-min-dominance-real-cost-ab.mjs): the
// collector (`zerodte-history-collect.mjs`) persists each row's `dte` via `dteFromExpiry(f.expiry)`
// — which defaults to `Date.now()`, i.e. the COLLECTION run's own wall-clock "today", not the
// alert's own `alerted_at` date. That field is then read DIRECTLY by `deriveZeroDteSetups`'s own
// `dte <= SETUP_MAX_DTE (4) && dte >= 0` evidence-gate filter in every consuming replay script —
// so for any day other than the exact day the collector last ran, the persisted `dte` is simply
// wrong, and the filter silently admits/rejects the WRONG rows. Confirmed live on
// `2026-09-09.json`: of 1296 real alerts, the stored `dte` ranged from -40 to +11 (correct only
// for a "today" near the collector's own run date) — only 13 rows (those whose real expiry
// happened to land ~4 calendar days after COLLECTION time, by pure coincidence) passed the dte
// filter, and every one of those 13 was WRONGLY classified: their real dte on 2026-09-09 was
// nothing close to 4, and the true 0DTE population for that day (alerts whose real expiry WAS
// 2026-09-09) was entirely excluded because their stored dte was a large negative number.
// This recomputes `dte` fresh on every load, anchored to EACH ROW'S OWN `alerted_at` (exactly
// what `dteFromExpiry`'s optional `nowMs` parameter exists for) — point-in-time correct
// regardless of how long ago the collector actually ran. Every consumer of this loader gets the
// fix automatically; no call site needs to change.
function dteFromExpiryAsOf(expiryYmd, asOfMs) {
  const expiryMs = Date.parse(`${String(expiryYmd ?? "").slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(expiryMs) || !Number.isFinite(asOfMs)) return undefined;
  // Mirror flow-dte.ts's dteFromExpiry exactly (ET-session-anchored whole-day diff), just with
  // the "today" anchor supplied by the caller instead of defaulting to Date.now().
  const asOfYmd = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(asOfMs));
  const asOfMidnightMs = Date.parse(`${asOfYmd}T00:00:00Z`);
  if (!Number.isFinite(asOfMidnightMs)) return undefined;
  return Math.round((expiryMs - asOfMidnightMs) / 86_400_000);
}

/**
 * Returns a Map<day, rows[]> for every persisted day whose ET date falls within
 * [cutoffMs, endMs] (inclusive). Rows are the same compact shape the collector writes:
 * { ticker, premium, option_type, strike, expiry, dte, alert_rule, ask_pct, underlying_price,
 *   fill_price, open_interest, alerted_at } — EXCEPT `dte`, which is recomputed fresh here
 * relative to each row's own `alerted_at` (see the correctness note above; never trust the
 * persisted value, which reflects the collector's OWN run date, not the alert's).
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
      if (Array.isArray(rows)) {
        const fixed = rows.map((r) => {
          const alertMs = Date.parse(r.alerted_at ?? "");
          const dte = Number.isFinite(alertMs) ? dteFromExpiryAsOf(r.expiry, alertMs) : undefined;
          return { ...r, dte };
        });
        byDay.set(day, fixed);
      }
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
