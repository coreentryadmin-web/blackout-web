/**
 * COORD: a dark-pool block and an options print on the same ticker, inside one window.
 *
 * ── WHY THIS IS ITS OWN MODULE ──────────────────────────────────────────────────────────────────
 *
 * The correlation lived inside a `useMemo` in `FlowFeed`, so the only way to exercise it was to
 * render the page. That is why the defect below survived a fix to its own other half.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────────────────────────
 *
 *     Math.abs(new Date(dp.executed_at).getTime() - alertTime) <= WINDOW_MS
 *
 * `Math.abs(NaN - t) <= WINDOW` is **false**, so a block whose time cannot be parsed does not
 * error — it silently never coincides with anything, and COORD simply never fires for it.
 *
 * The striking part is that the comment directly above that line already recorded this exact
 * failure, for the ALERT side of the same comparison:
 *
 *   > Gap #6: raw `new Date(alerted_at)` was NaN for undated rows, so `abs(NaN) > WINDOW` is
 *   > always false and COORD never fired.
 *
 * The fix was applied to one operand. The identical expression on the other operand stayed raw.
 * **One guarded operand and one unguarded one, in a single comparison, under a comment explaining
 * the bug.** Same shape this lane has now hit four times: the right rule, applied to one of the
 * paths that needed it.
 *
 * ── HOW BADLY IT BITES TODAY: MEASURED, AND SMALLER THAN IT LOOKS ────────────────────────────────
 *
 * Live prod `/api/market/dark-pool?limit=100&min_premium=500000`, 2026-08-23 (market closed):
 * **3 prints, 3/3 with a parseable `executed_at`, 3/3 carrying an explicit timezone**
 * (`"2026-08-21T23:59:52Z"`). So on the REST path this is currently latent robustness, not an
 * observed failure — and it is stated that way rather than dressed up. n=3 off-hours is a weak
 * sample, which is exactly why the guard is worth having rather than an argument that it is not.
 *
 * ── CORRECTION TO THAT MEASUREMENT (2026-08-23, later the same day) ─────────────────────────────
 *
 * "3/3 with a parseable `executed_at`" was measured THROUGH the endpoint, and at the time the
 * endpoint stamped `new Date().toISOString()` on any row upstream had not dated. So that number
 * could not tell an upstream timestamp from one invented at request time, and 3/3 was guaranteed
 * regardless of what the feed actually carried. It is retained above rather than deleted because a
 * measurement that turned out to be unfalsifiable is worth remembering as one.
 *
 * The endpoint no longer invents a time (`api/market/dark-pool/route.ts`), so the same probe re-run
 * now measures the real fill rate — and this module's `executed_at == null` skip, previously
 * unreachable on the REST path, is the branch that receives those rows.
 */

/** A dark-pool block, as much of one as the correlation needs. */
export type CoordBlock = { ticker: string; executed_at?: string | null };

/** Default correlation window — a block and a print within five minutes of each other. */
export const COORD_WINDOW_MS = 5 * 60 * 1000;

/**
 * Does any block coincide with this print? `alertMs` must already be a real print time — the
 * caller resolves it, because "this alert has no trustworthy time" is a different refusal from
 * "no block matched" and the two must not collapse into one `false`.
 */
export function hasCoincidentBlock(
  blocks: readonly CoordBlock[],
  ticker: string,
  alertMs: number,
  windowMs: number = COORD_WINDOW_MS
): boolean {
  if (!Number.isFinite(alertMs)) return false;
  for (const b of blocks) {
    if (b.ticker !== ticker) continue;
    const blockMs = b.executed_at == null ? Number.NaN : new Date(b.executed_at).getTime();
    // An unparseable block time is not evidence of anything — skip it rather than let NaN
    // silently answer "no" for a comparison that was never actually made.
    if (!Number.isFinite(blockMs)) continue;
    if (Math.abs(blockMs - alertMs) <= windowMs) return true;
  }
  return false;
}
