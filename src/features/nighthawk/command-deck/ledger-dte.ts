import { parseOccSymbol } from "@/lib/largo/core/entities";
import { calendarDteBetween } from "@/lib/zerodte/board";
import { todayEt } from "@/lib/et-date";

/**
 * DTE for a LEDGER-ONLY row — the rows that make up the whole board once the session closes.
 *
 * THE BUG. `sourceFrom` synthesises a `setup` for any ledger row the current scan did not
 * re-surface, and that synthetic setup hardcoded `dte: null`. The adapter renders
 * `dte == null ? "?DTE"`, so the label came out `RIOT 21P · ?DTE`. During RTH this is invisible —
 * live setups carry a real dte — but after the close EVERY row is ledger-only, so the entire
 * board reads `?DTE`. Observed live on prod 2026-08-12: all 7 plays, every one of them.
 *
 * WHY THE DATA WAS ALWAYS THERE. The same row carries `occ`, and an OCC symbol packs the expiry
 * (`RIOT260812P00021000` → 2026-08-12). Nothing needed to be fetched or persisted; the synthetic
 * setup simply never looked. This parses it with the canonical `parseOccSymbol` and measures the
 * gap with `calendarDteBetween` — the SAME function the pin/breakout contract pickers use — so a
 * card can never disagree with the engine about what DTE means.
 *
 * WHICH DAY TO MEASURE FROM. Not today: a play from a past session would then count DOWN and a
 * closed 0DTE play would eventually render `-3DTE`. The honest label is the DTE the contract had
 * WHEN THE PLAY WAS LIVE, so the reference is the play's own first-flag instant, then its exit,
 * and only then today (a working row flagged this session). All three are read in ET, because the
 * trading day is an ET day — using UTC would roll a 20:15 ET flag onto tomorrow and report one
 * day too few.
 *
 * FAIL-CLOSED. No OCC, an unparseable OCC, or a nonsense gap returns null, and the card keeps
 * showing `?DTE`. `?` is honest when the contract genuinely cannot be identified; the bug was
 * showing it when it could.
 */

/** The ET calendar day (YYYY-MM-DD) an ISO instant falls on, or null if unparseable. */
export function etYmdOfInstant(iso: string | null | undefined): string | null {
  if (typeof iso !== "string" || iso.length === 0) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return todayEt(new Date(ms));
}

/**
 * Calendar DTE the contract had on the session this play belongs to.
 *
 * A sane result is 0…365 — anything outside that is a malformed OCC or a row pointing at the
 * wrong contract, and null (→ `?DTE`) is better than a wrong number rendered confidently.
 */
export function ledgerRowDte(
  occ: string | null | undefined,
  firstFlaggedAt: string | null | undefined,
  exitAt: string | null | undefined,
  now: Date = new Date()
): number | null {
  const parsed = parseOccSymbol(occ ?? null);
  if (!parsed) return null;

  const referenceYmd = etYmdOfInstant(firstFlaggedAt) ?? etYmdOfInstant(exitAt) ?? todayEt(now);
  const dte = calendarDteBetween(referenceYmd, parsed.expiry);
  if (!Number.isFinite(dte) || dte < 0 || dte > 365) return null;
  return dte;
}
