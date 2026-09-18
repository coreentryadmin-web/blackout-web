// src/lib/swing/play-brief-ticker-history.ts — TICKER-scoped historical context for the swing
// play-brief (Largo product contract C10, "historical context"), the sibling of
// calibration-cache.ts's ARCHETYPE/sub-lane track record.
//
// GAP THIS CLOSES (Ask Largo standing mandate, round 19, 2026-09-18): `archetypeTrackRecordSection`
// (play-brief-intel.ts) cites "how did trades in THIS ARCHETYPE do" via a cron-distilled snapshot.
// calibration-cache.ts's own file header is explicit that this is a DELIBERATE, narrow slice —
// "most of it ... is not keyed by TICKER at all, so a brief has no way to attach it to 'this play'
// anyway." Grepped repo-wide for any ticker-scoped prior-trade citation (`priorTicker`,
// `sameTicker`, `tickerHistory`, `tickerTrackRecord`) before writing this file — zero hits outside
// this new module. A member reading a brief for a THIRD AAPL swing this quarter has no way to know
// from the brief itself that the desk has traded this exact name before, let alone how those
// trades went — the brief cites the archetype's aggregate record but never "AAPL specifically."
//
// WHY A LIVE READ, NOT A CRON-DISTILLED CACHE (unlike calibration-cache.ts): a single ticker's own
// trade population is small by construction (the ledger holds ~30-40 CLOSED chains platform-wide
// at any point in this mandate's other measurements) — querying and chain-assembling one ticker's
// rows is cheap enough to do per-request, with no statistical graduation gate to apply (this is a
// plain factual count — "the desk has traded AAPL N times, W wins / L losses" — not a calibrated
// score being compared cross-product, so the Largo C6 confidence-omission principle doesn't apply
// here the way it gates `archetypeTrackRecordSection`). Bounded and best-effort exactly like every
// other context read in play-brief-context.ts: a DB hiccup degrades to "no citation" instead of
// failing the brief.
//
// CHAIN-AWARE, NOT ROW-AWARE: a rolled position leaves MULTIPLE `swing_positions` rows for the same
// ticker sharing one economic trade (`root_position_id` thread) — counting rows instead of chains
// would double- or triple-count a single trade that got rolled. Reuses `record.ts`'s own
// `selectSwingRecordRootIds`/`buildSwingRecord` (the exact same root-selection + composite-outcome
// logic the member-facing `/record` route and `closedDeckSourcesFromChains` already use) rather
// than reimplementing chain assembly a second time.
//
// SELF-EXCLUSION: the play under review (when it has a ledger row) must not cite itself as "prior"
// evidence — `excludeRootId` drops its own chain's root before counting.

import { fetchSwingPositionChain, fetchSwingPositionsByTicker } from "../db";
import { buildSwingRecord, selectSwingRecordRootIds } from "./record";

/** Distilled ticker-scoped historical-context citation — a plain factual count, not a calibrated
 *  score (see file header for why this doesn't need the archetype section's graduation gate). */
export type SwingTickerTrackRecord = {
  ticker: string;
  /** Chains actually resolved (CLOSED, graded) — never counts a still-OPEN/ROLLED chain. */
  priorClosedTrades: number;
  wins: number;
  losses: number;
};

/** Cap on how many roots this reads chains for in one request — a ticker-scoped population is
 *  small in practice, but this keeps a pathological ticker (hundreds of historical rows) from
 *  fanning out into hundreds of DB round trips on a single brief request. */
const MAX_ROOTS = 20;

/**
 * Best-effort ticker-scoped track record. Returns `null` on any read failure, or when there is
 * no resolved prior trade to cite — Largo C6 omission discipline: absence is reported by leaving
 * the section out, never by rendering a fabricated "no history" line.
 */
export async function loadTickerTrackRecord(
  ticker: string,
  excludeRootId: number | null,
): Promise<SwingTickerTrackRecord | null> {
  try {
    const rows = await fetchSwingPositionsByTicker(ticker, 200);
    if (!rows.length) return null;

    const rootIds = selectSwingRecordRootIds(rows).filter((id) => id !== excludeRootId);
    if (!rootIds.length) return null;

    const chains = await Promise.all(
      rootIds.slice(0, MAX_ROOTS).map((rootId) => fetchSwingPositionChain(rootId)),
    );
    const records = chains.filter((chain) => chain.length > 0).map((chain) => buildSwingRecord(chain));
    const resolved = records.filter((r) => r.composite.chainResolved);
    if (!resolved.length) return null;

    const wins = resolved.filter((r) => r.composite.outcome === "win").length;
    const losses = resolved.filter((r) => r.composite.outcome === "loss").length;
    return { ticker: ticker.toUpperCase(), priorClosedTrades: resolved.length, wins, losses };
  } catch {
    return null;
  }
}
