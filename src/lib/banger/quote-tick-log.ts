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
import type { QueryResultRow } from "pg";
import { dbQuery, isoTimestampString } from "@/lib/db";
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

/** A persisted row, as read back — carries the DB-assigned `id` the write-only `BangerQuoteTickRow`
 *  never has. */
export type BangerQuoteTickLogRow = BangerQuoteTickRow & { id: number };

/** Per-contract tick coverage since a given timestamp — cheap (one aggregate scan, no per-tick
 *  rows), so a caller can assess readiness across every logged contract before paying for any
 *  per-contract detail fetch. */
export type BangerQuoteTickCoverageRow = {
  contract_occ: string;
  tick_count: number;
  first_tick_at: string;
  last_tick_at: string;
};

function finite(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function mapBangerQuoteTickLogRow(r: QueryResultRow): BangerQuoteTickLogRow {
  return {
    id: Number(r.id),
    contract_occ: String(r.contract_occ),
    polled_at: isoTimestampString(r.polled_at) ?? new Date(0).toISOString(),
    bid: num(r.bid),
    ask: num(r.ask),
    last_trade: num(r.last_trade),
    raw_mark: num(r.raw_mark),
    reliable_mark: num(r.reliable_mark),
  };
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
  // Pass `snap.askSize` through — reliableMarkFromSnapshot does the same (THIN_ASK_SIZE_MAX
  // guard, options-snapshot.ts) and this function's own doc comment promises byte-identical
  // output for the same snapshot; omitting it here would silently break that guarantee for any
  // thin-ask (`askSize <= 1`) row the moment that guard engages.
  const reliableMark =
    rawMark == null ? null : reliableMarkFromQuote(rawMark, bid, last ?? dayClose, snap.askSize);
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

/**
 * Every logged tick for ONE contract within `[sinceIso, untilIso)`, oldest→newest — the replay
 * order a tick-by-tick management-loop clone needs (see `banger-quote-tick-replay-eval.mjs`).
 * Read-only; used only by offline validation tooling (scripts/audit/), never the live decision
 * path (which reads the fetched snapshot directly and never this table).
 */
export async function fetchBangerQuoteTicksForContract(
  occ: string,
  sinceIso: string,
  untilIso: string,
  limit = 5000,
): Promise<BangerQuoteTickLogRow[]> {
  const res = await dbQuery<QueryResultRow>(
    `SELECT * FROM banger_quote_tick_log
     WHERE contract_occ = $1 AND polled_at >= $2 AND polled_at < $3
     ORDER BY polled_at ASC, id ASC
     LIMIT $4`,
    [occ, sinceIso, untilIso, limit],
  );
  return res.rows.map(mapBangerQuoteTickLogRow);
}

/**
 * Per-contract tick coverage since `sinceIso` — one GROUP BY scan across every contract this table
 * has ever seen a tick for, cheap enough to call on every validation-framework run to decide WHICH
 * contracts are even worth a detailed per-tick fetch (see `BangerQuoteTickCoverageRow`'s own doc
 * comment). `limit` bounds the number of DISTINCT contracts returned, not tick rows.
 */
export async function fetchBangerQuoteTickCoverage(
  sinceIso: string,
  limit = 5000,
): Promise<BangerQuoteTickCoverageRow[]> {
  const res = await dbQuery<QueryResultRow>(
    `SELECT contract_occ, COUNT(*)::int AS tick_count, MIN(polled_at) AS first_tick_at, MAX(polled_at) AS last_tick_at
     FROM banger_quote_tick_log
     WHERE polled_at >= $1
     GROUP BY contract_occ
     ORDER BY contract_occ ASC
     LIMIT $2`,
    [sinceIso, limit],
  );
  return res.rows.map((r) => ({
    contract_occ: String(r.contract_occ),
    tick_count: Number(r.tick_count),
    first_tick_at: isoTimestampString(r.first_tick_at) ?? new Date(0).toISOString(),
    last_tick_at: isoTimestampString(r.last_tick_at) ?? new Date(0).toISOString(),
  }));
}
