/**
 * Server-side context loader for the Swing Play Intelligence Engine.
 * Reads the same caches / DB rows Largo tools use — no provider fan-out, no LLM.
 */
import { fetchEcosystemContext } from "@/lib/bie/ecosystem-context";
import { fetchVectorFullState } from "@/lib/bie/vector-full-state";
import { fetchOpenSwingPositions } from "@/lib/db";
import { etSessionDate, etStamp } from "@/lib/largo/temporal/bar-session-date";
import { normalizeDteHorizon } from "@/features/vector/lib/vector-dte-horizon";
import type { SwingPlayBriefContext } from "./play-brief-types";
import { resolveSwingPlayForBrief, type SwingBriefResolveHints } from "./play-brief-resolve";
import { fetchMeridianForTicker } from "./play-brief-meridian";
import { fetchMeridianPeerForBrief } from "./play-brief-meridian-peer";
import type { PortfolioPosition } from "./portfolio";
import { readSwingArchetypeTrackRecord } from "./calibration-cache";
import { withBriefSourceTimeout } from "./brief-source-timeout";

/**
 * The network-bound reads below (Meridian timeline/peer-cohort, ecosystem context, Vector
 * full-state) carry no timeout of their own, so an upstream stall used to propagate all the way
 * to Cloudflare's edge (~100s) before the member ever saw an error — a raw 504 instead of this
 * route's own graceful `degraded` response. Measured live 2026-09-09: a `play-brief` request
 * hung past a 120s client-side timeout while ALB TargetResponseTime for the same window showed
 * repeated p99 spikes to 90-104s. `withBriefSourceTimeout` (brief-source-timeout.ts) races each
 * call against an 8s budget so a single slow source degrades to "unavailable" for THIS section
 * instead of hanging the whole brief. This helper REJECTS on timeout (rather than degrading to
 * null itself) so callers that need to distinguish "genuinely no data" from "upstream stalled"
 * (the ecosystem/vector `*FetchFailed` flags below) still can — the archetype-track-record read
 * has no such distinction to make, so it wraps its own call in `.catch(() => null)`.
 */

/**
 * The member's full open book as `PortfolioPosition[]` for the "Book context" theme-overlap
 * section. `direction` on the ledger row is lowercase ("long"/"short"); the overlap checker
 * (and the swing entry gate it shares code with) works in uppercase `PlayDirection`. The play
 * under review is NOT filtered out here — `bookContextSection` passes the reviewed play's ledger
 * id into `checkPortfolioOverlap` so the correct row is excluded even when multiple independent
 * positions share ticker+direction.
 */
async function loadOpenBook(): Promise<PortfolioPosition[] | null> {
  try {
    const rows = await fetchOpenSwingPositions();
    return rows.map((r) => ({
      ticker: r.ticker,
      direction: r.direction === "short" ? ("SHORT" as const) : ("LONG" as const),
      positionId: r.id,
    }));
  } catch {
    return null;
  }
}

export type LoadSwingPlayBriefInput = SwingBriefResolveHints;

/**
 * Resolve a swing play for brief composition — open ledger + contract hints beat
 * naive ticker-only lane lookup.
 */
export async function loadSwingPlayBriefContext(
  input: LoadSwingPlayBriefInput,
): Promise<SwingPlayBriefContext | null> {
  const resolved = await resolveSwingPlayForBrief(input);
  if (!resolved) return null;

  const ticker = resolved.play.ticker.toUpperCase();
  const meridian = await withBriefSourceTimeout(fetchMeridianForTicker(ticker)).catch(() => null);
  const meridianPeer = await withBriefSourceTimeout(fetchMeridianPeerForBrief(meridian, ticker)).catch(() => null);

  // Distinguish a genuine "no data" null from a thrown fetch — FINDINGS 2026-09-06 (#11): an
  // ecosystem/vector fetch that THROWS must not read the same as one that legitimately returned
  // nothing, or a total upstream failure can still leave confidence.level at "high". A timeout
  // rejection is just another throw here, so it flows through the same failed-flag path.
  let ecosystemFetchFailed = false;
  let vectorFetchFailed = false;
  const [ecosystem, vector, openBook, archetypeTrackRecord] = await Promise.all([
    withBriefSourceTimeout(fetchEcosystemContext(ticker)).catch(() => {
      ecosystemFetchFailed = true;
      return null;
    }),
    withBriefSourceTimeout(fetchVectorFullState(ticker, normalizeDteHorizon("all"))).catch(() => {
      vectorFetchFailed = true;
      return null;
    }),
    loadOpenBook(),
    // Ask Largo C10 (historical context) — a plain, best-effort shared-cache read the cron writes
    // (calibration-cache.ts). Bounded so a wedged Redis hop degrades to "no citation" rather than
    // blocking the whole brief; unlike ecosystem/vector above this has no dedicated *FetchFailed
    // flag because a miss here is never surfaced as an absence/error to the member — an ungraduated
    // or unavailable track record simply omits the "Track record" section (Largo C6: omission, not
    // fabrication), the same as a play with no track record to cite at all. `withBriefSourceTimeout`
    // now REJECTS on timeout (see the import-site comment above), so this read keeps its own
    // `.catch(() => null)` to preserve that "never surfaces as a failure" contract.
    withBriefSourceTimeout(readSwingArchetypeTrackRecord()).catch(() => null),
  ]);

  const nowMs = Date.now();
  // Largo C1: brief read time on the market clock — same convention as Vector/BIE tools.
  const asOf = etStamp(nowMs) ?? new Date(nowMs).toISOString();
  return {
    play: resolved.play,
    asOf,
    sessionDate: etSessionDate(nowMs),
    scanAsOf: resolved.scanAsOf,
    scanSessionDay: resolved.scanSessionDay,
    ecosystem,
    vector,
    laneRows: resolved.laneRows,
    meridian,
    meridianPeer,
    openBook,
    ecosystemFetchFailed,
    vectorFetchFailed,
    archetypeTrackRecord,
  };
}
