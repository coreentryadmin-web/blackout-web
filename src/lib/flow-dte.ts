import { todayEt } from "@/lib/et-date";

/**
 * Days from TODAY to an option's expiry, anchored to the **ET session calendar**.
 *
 * ── WHY THIS MODULE EXISTS (HELIX-MAP.md §9.2) ──────────────────────────────────────────────────
 *
 * There were TWO derivations of this one number at ingest, both anchored to UTC:
 *
 *   `parseUwFlowAlert` (unusual-whales.ts) — `ceil((Date.parse(expiry) - Date.now()) / 86400000)`
 *   `dteFromExpiry`    (flow-persist.ts)   — the same diff against `toISOString().slice(0, 10)`
 *
 * `new Date("YYYY-MM-DD")` is UTC midnight, so between **20:00 and 24:00 ET** the UTC calendar date
 * is already tomorrow and a NEXT-SESSION expiry evaluates as 0DTE. Three consequences, one of which
 * outlives the window: an SSE row carries `route: "0dte"` for a 1DTE contract (surfaced by
 * `TickerDrawer`'s 0DTE badge); the ingest score adds its **+15 0DTE bonus** and that score is
 * **persisted**, so it shows in the Score column and its sort long after; and the print gets the
 * lower near-dated persistence floor.
 *
 * ── IMPACT: MEASURED, AND GENUINELY LOW ─────────────────────────────────────────────────────────
 *
 * The map assessed this LOW on the reasoning that US options do not trade 20:00–24:00 ET. Measured
 * rather than assumed — live prod tape, 5000 rows / 168h, 2026-08-23:
 *
 *   rows timestamped 20:00–23:59 ET                   0 of 5000
 *   route="0dte" but ET-anchored dte >= 1             0
 *   ET-anchored dte === 0 but route not 0dte/whale    0
 *
 * The window is empty, so this fixes no live defect. It ships because the derivation was wrong, it
 * is the exact class the C1 session-anchor ratchet exists to catch, and a latent off-by-one that
 * writes a **persisted** score is worth removing before some future ingest path runs in that window.
 * **Do not read this as an incident.**
 *
 * ── ONE DEFINITION, NOT TWO ─────────────────────────────────────────────────────────────────────
 *
 * §9.2's title is "two derivations", so the fix is to have one. Both callers import this. It is a
 * standalone module rather than living in `flow-persist` because the provider must not pull
 * `@/lib/db` in behind a date helper.
 *
 * The anchor matches the READ path exactly — `db.ts` computes
 * `(expiry - (NOW() AT TIME ZONE 'America/New_York')::date) AS dte` — so ingest and read now agree
 * on what day it is, which they did not before.
 */
export function dteFromExpiry(expiryYmd: string, nowMs = Date.now()): number | null {
  const expiryMs = Date.parse(`${String(expiryYmd).slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(expiryMs)) return null;
  // todayEt() is the repo's single source of truth for the ET session date and is deliberately
  // frozen in behaviour (see its header) — the same boundary every session comparison uses.
  const todayMs = Date.parse(`${todayEt(new Date(nowMs))}T00:00:00Z`);
  if (!Number.isFinite(todayMs)) return null;
  // Both operands are midnight-aligned, so this is an exact whole-day difference; `round` guards
  // only against float noise, never against a partial day.
  return Math.round((expiryMs - todayMs) / 86_400_000);
}
