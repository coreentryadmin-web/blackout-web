/**
 * PROSPECTIVE NBBO QUOTE-TICK LOG for Banger (Engine B) — see the migration's own header
 * (`015_banger_quote_tick_log.sql`) for the full "why": a real historical-reconstruction validation
 * attempt found Polygon's archived `/v3/quotes` tape does not always reproduce what its own real-time
 * snapshot service reported at the exact instant `banger-live-sync` actually polled it, and there is
 * no way to recover that after the fact. This persists the SAME snapshot data the live-sync cron
 * already fetches every tick (zero additional Polygon calls), going forward, so a future exit-rule
 * validation has real ground truth instead of a second-guessed reconstruction.
 *
 * PURELY ADDITIVE, NEVER ON THE DECISION PATH. `buildBangerQuoteTickRow` is pure. `persistBangerQuoteTick`
 * does one INSERT and may reject — by design, it does NOT swallow its own errors, matching this
 * repo's existing fire-and-forget convention for non-critical side effects (see
 * `src/lib/banger/live-sync.ts`'s own `.catch((err) => console.warn(...))` on its Discord-notify call):
 * the CALLER is responsible for `.catch()`-ing this so a write failure can never affect the real
 * exit-management decision, which reads the live snapshot directly and never this table.
 */
import { dbQuery } from "@/lib/db";
import type { OptionSnapshot } from "@/lib/providers/options-snapshot";
import { midOf, reliableMarkFromQuote } from "@/lib/providers/options-snapshot";

export type BangerQuoteTickRow = {
  contract_occ: string;
  polled_at: string;
  bid: number | null;
  ask: number | null;
  last_trade: number | null;
  raw_mark: number | null;
  reliable_mark: number | null;
};

function finite(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

/**
 * Builds one durable tick row from an already-fetched `OptionSnapshot` — no IO, no re-derivation of
 * the mark logic (reuses the SAME `midOf`/`reliableMarkFromQuote` production's own resolution uses,
 * so this log's `reliable_mark` is guaranteed to equal whatever `reliableMarkFromSnapshot` computed
 * for the SAME snapshot, never a second, drifting formula).
 */
export function buildBangerQuoteTickRow(occ: string, snap: OptionSnapshot, polledAt: Date): BangerQuoteTickRow {
  const bid = finite(snap.bid) ? snap.bid : null;
  const ask = finite(snap.ask) ? snap.ask : null;
  const last = finite(snap.last) ? snap.last : null;
  const dayClose = finite(snap.dayClose) ? snap.dayClose : null;
  const mid = midOf(bid, ask);
  const rawMark = mid ?? last ?? dayClose ?? null;
  const reliableMark = rawMark == null ? null : reliableMarkFromQuote(rawMark, bid, last ?? dayClose);
  return {
    contract_occ: occ,
    polled_at: polledAt.toISOString(),
    bid,
    ask,
    last_trade: last,
    raw_mark: rawMark,
    reliable_mark: reliableMark,
  };
}

/** One INSERT. May reject — see this module's header on why it deliberately does not catch its own
 *  errors; the caller's fire-and-forget wrapper is responsible for that. */
export async function persistBangerQuoteTick(row: BangerQuoteTickRow): Promise<void> {
  await dbQuery(
    `INSERT INTO banger_quote_tick_log (contract_occ, polled_at, bid, ask, last_trade, raw_mark, reliable_mark)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [row.contract_occ, row.polled_at, row.bid, row.ask, row.last_trade, row.raw_mark, row.reliable_mark],
  );
}
