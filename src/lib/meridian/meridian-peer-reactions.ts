import "server-only";

/**
 * Peer reaction history — the answer to "does this whole sector tend to gap the way this name
 * does?" for the names in a Sector Peers cohort (`MeridianPeerCohortPanel`).
 *
 * Before this, the Sector Peers card could only compare peers' FORWARD implied moves, and most
 * peers show a bare "—" there (thin options market, or too far out for an implied move yet) —
 * live-observed 2026-08-25 CTO audit, DKS earnings: 6/6 peers with no comparable number. This
 * loader reuses `loadMeridianEarningsPrintHistory` (the exact function the subject's own History
 * tab is built from) per peer, so "how did BBWI/ULTA/SPWH react to their last few prints" is
 * answerable from data the product already computes correctly elsewhere — not a new pipeline.
 *
 * CAPPED AND CACHED ON PURPOSE. Each peer fetch is a real Benzinga calendar call plus several
 * Polygon minute-bar reaction lookups (`stockReactionsForPrints`), so fetching this for an
 * unbounded peer list on every panel view would be slow and expensive. `MAX_PEERS` bounds the
 * fan-out; the per-ticker `serverCache` TTL is long (6h) because a name's historical print
 * record does not change intraday — only a NEW print (at most a few times a year per name) can
 * move it.
 */

import { serverCache } from "@/lib/server-cache";
import { loadMeridianEarningsPrintHistory } from "@/lib/meridian/meridian-earnings-history";
import { summarizePeerReaction, type PeerReactionSummary } from "@/lib/meridian/meridian-sector-core";

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const PRINTS_PER_PEER = 4;

async function loadOnePeerReaction(ticker: string): Promise<PeerReactionSummary> {
  const sym = ticker.trim().toUpperCase();
  return serverCache(`meridian:peer-reaction:v1:${sym}`, CACHE_TTL_MS, async () => {
    try {
      const { print_history } = await loadMeridianEarningsPrintHistory(sym, PRINTS_PER_PEER);
      return summarizePeerReaction(sym, print_history);
    } catch (error) {
      // A single peer's history fetch failing (rate limit, no calendar entry, transient
      // provider error) must not fail the whole cohort — the panel just shows that one peer as
      // "no data" the same way it already does for a missing implied move.
      console.error(`[meridian-peer-reactions] ${sym}`, error);
      return summarizePeerReaction(sym, []);
    }
  });
}

/**
 * Loads reaction summaries for up to `MAX_PEER_REACTION_TICKERS` tickers, in parallel. Extra
 * tickers beyond the cap are silently dropped by the CALLER's slice, not here — this function
 * always honours exactly the list it's given, so a caller that wants the cap enforced visibly
 * (e.g. to log what was dropped) does its own `.slice()` before calling in.
 */
export async function loadMeridianPeerReactions(
  tickers: readonly string[]
): Promise<PeerReactionSummary[]> {
  const unique = [...new Set(tickers.map((t) => t.trim().toUpperCase()).filter(Boolean))];
  return Promise.all(unique.map(loadOnePeerReaction));
}
