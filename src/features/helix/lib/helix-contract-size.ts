/**
 * Contracts implied by a print — ONE derivation, read by everything that needs it.
 *
 * ── THE IDENTITY ────────────────────────────────────────────────────────────────────────────────
 *
 *     contracts = premium / (fill_price × 100)
 *
 * `premium` is total dollars, `fill_price` is per share, 100 shares to a contract. It is an
 * ESTIMATE: a multi-leg print reports one averaged fill, and premium is rounded, so the result is
 * approximate and every surface that shows it says so.
 *
 * ── WHY THIS MODULE EXISTS ──────────────────────────────────────────────────────────────────────
 *
 * That one line was written out FIVE separate times, and the copies did not agree:
 *
 *   `helix-print-detail.ts`      `estContractSize`      — rounds to whole contracts
 *   `helix-position-intent.ts`   `impliedContractSize`  — did NOT round
 *   `helix-discord-format.ts`    inline                 — rounds, with its own guard
 *   `lib/helix-tape-inventory-eval.mjs`  `impliedContracts` — no rounding, no positive guard
 *   `lib/zerodte/board.ts`       inline                 — Night Hawk's lane, see below
 *
 * The second of those is mine, added in #2689 — in a PR whose own write-up argued that "a second
 * reader re-deriving one fact is the failure this lane has now fixed five times". I then wrote the
 * sixth. That is the honest reason this module exists, and it is worth stating plainly: the pattern
 * is easy to name and easy to repeat in the same breath.
 *
 * ── ONE DERIVATION, TWO ROUNDINGS, BOTH DELIBERATE ──────────────────────────────────────────────
 *
 * `contractSizeExact` is the raw quotient. `contractSizeRounded` is what a member is SHOWN, because
 * a fractional contract count is not a thing that trades. Callers pick, rather than each deciding in
 * private:
 *  - DISPLAY (`Size` chip, Discord line) wants the rounded one.
 *  - The `size > OI` counting argument (#2689) wants the EXACT one — its 1.05 margin was measured
 *    against the unrounded quotient, and rounding first would move the boundary by up to half a
 *    contract for no benefit.
 *
 * Both return `null` — never `0`, never `Infinity` — when either input is missing or non-positive.
 * A print of "0 contracts" compared against open interest would read as a real measurement.
 */

/** Shares per option contract. Named so the assumption is visible rather than a bare `100`. */
export const SHARES_PER_CONTRACT = 100;

/** The raw quotient. `null` when it cannot be derived — never a fabricated zero. */
export function contractSizeExact(
  premium: number | null | undefined,
  fillPrice: number | null | undefined
): number | null {
  const p = Number(premium);
  const f = Number(fillPrice);
  if (premium == null || fillPrice == null) return null;
  if (!Number.isFinite(p) || !Number.isFinite(f)) return null;
  if (p <= 0 || f <= 0) return null;
  const contracts = p / (f * SHARES_PER_CONTRACT);
  return Number.isFinite(contracts) && contracts > 0 ? contracts : null;
}

/** What a member is shown: whole contracts, because a fractional one does not trade. */
export function contractSizeRounded(
  premium: number | null | undefined,
  fillPrice: number | null | undefined
): number | null {
  const exact = contractSizeExact(premium, fillPrice);
  if (exact == null) return null;
  const rounded = Math.round(exact);
  // A quotient under half a contract rounds to 0, and 0 contracts is not a print. Report it as
  // underivable rather than as a measurement of nothing.
  return rounded > 0 ? rounded : null;
}
