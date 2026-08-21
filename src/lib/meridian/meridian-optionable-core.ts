/**
 * Optionable-ticker membership — pure.
 *
 * Meridian's earnings lane carries ~360 prints in a 21-day window, and most of them are names
 * a member of this platform cannot trade: everything here is an options product. A print with
 * no listed chain is noise on a desk whose whole job is to point at a contract.
 *
 * ── THE TRAP THIS EXISTS TO AVOID ──────────────────────────────────────────────────
 * The membership list comes from UW (`/api/option-trades/optionable-tickers`), and UW writes
 * class shares WITHOUT the separator: probed live 2026-08-18, the list holds `BRKB`, `BFA`,
 * `BFB`, and contains ZERO entries with a `.` or `/` in 6328 rows. Benzinga's calendar writes
 * the same names as `BRK.B`, `BF.B`. So a plain `list.includes(ticker)` silently drops every
 * class-share name from the timeline — a filter that LOOKS like it works while hiding real,
 * tradeable earnings. Both sides are normalized to the same shape before comparison, and a
 * test covers the dotted cohort specifically.
 *
 * FAIL-OPEN, deliberately. If the list is missing or empty, nothing is filtered and the caller
 * is told the filter did not run. The failure mode of fail-closed here is an empty earnings
 * lane — the reader would see "there are no earnings this week", which is a lie, rather than
 * "here is everything", which is merely noisy. Hiding data on an infrastructure error is worse
 * than showing too much.
 */

/**
 * Reduce a symbol to its comparison form: uppercase, letters and digits only.
 *
 * Strips the class separator (`BRK.B` and `BRK/B` → `BRKB`) so a Benzinga symbol and a UW
 * symbol for the same security land on the same key. Deliberately NOT a general slug — a
 * symbol that normalizes to empty is treated as unmatched rather than matching everything.
 */
export function normalizeOptionableSymbol(value: unknown): string {
  return String(value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/** Build the membership index from whatever shape the provider returned. */
export function buildOptionableIndex(
  list: ReadonlyArray<string | { ticker?: string | null; symbol?: string | null }> | null | undefined
): Set<string> {
  const out = new Set<string>();
  for (const entry of list ?? []) {
    const raw = typeof entry === "string" ? entry : (entry?.ticker ?? entry?.symbol);
    const key = normalizeOptionableSymbol(raw);
    if (key) out.add(key);
  }
  return out;
}

export type OptionablePartition<T> = {
  /** Rows a member can actually trade. */
  kept: T[];
  /** Rows hidden because the name has no listed options. */
  hidden: T[];
  /**
   * False when the index was unusable, so `kept` is everything and `hidden` is empty. Callers
   * must not report "0 hidden" as "every name is optionable" — those are different facts.
   */
  applied: boolean;
};

/**
 * Split rows into tradeable and not.
 *
 * A suspiciously small index is treated as unusable rather than trusted: the live list carries
 * ~6.3k names, so a handful of entries means a truncated or partially-parsed response, and
 * filtering 360 earnings against it would empty the lane. `minIndexSize` is the guard.
 */
export function partitionOptionable<T>(
  rows: readonly T[],
  index: Set<string> | null | undefined,
  tickerOf: (row: T) => string | null | undefined,
  minIndexSize = 100
): OptionablePartition<T> {
  if (!index || index.size < minIndexSize) {
    return { kept: [...rows], hidden: [], applied: false };
  }
  const kept: T[] = [];
  const hidden: T[] = [];
  for (const row of rows) {
    const key = normalizeOptionableSymbol(tickerOf(row));
    // An unreadable ticker is KEPT. We cannot show that it is untradeable, and dropping a row
    // we simply failed to parse is the silent-filter failure this module exists to prevent.
    if (!key || index.has(key)) kept.push(row);
    else hidden.push(row);
  }
  return { kept, hidden, applied: true };
}
