/**
 * Server-side context loader for the Swing Play Intelligence Engine.
 * Reads the same caches / DB rows Largo tools use — no provider fan-out, no LLM.
 */
import { fetchEcosystemContext } from "@/lib/bie/ecosystem-context";
import { fetchVectorFullState } from "@/lib/bie/vector-full-state";
import { fetchOpenSwingPositions, fetchSwingPositionById, fetchSwingPositionChain } from "@/lib/db";
import { etSessionDate, etStamp } from "@/lib/largo/temporal/bar-session-date";
import { normalizeDteHorizon } from "@/features/vector/lib/vector-dte-horizon";
import type { SwingPlayBriefContext, SwingRollHistory } from "./play-brief-types";
import { resolveSwingPlayForBrief, type SwingBriefResolveHints } from "./play-brief-resolve";
import { fetchMeridianForTicker } from "./play-brief-meridian";
import { fetchMeridianPeerForBrief } from "./play-brief-meridian-peer";
import type { PortfolioPosition } from "./portfolio";
import { readSwingArchetypeTrackRecord } from "./calibration-cache";
import { withBriefSourceTimeout } from "./brief-source-timeout";
import { swingRollHistoryLegFromRow } from "./play-brief-roll-history";

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

/**
 * Roll history disclosure (Ask Largo ownership mandate, 2026-09-11): `record.ts`'s chain
 * composite has always had the full `roll_seq` thread available, but the narrative never
 * mentioned it — a member reading "Trade manager read" on a twice-rolled position had no way to
 * know from the brief alone that it wasn't the original entry. Never rolled → `null` (Largo C6
 * omission, not a fabricated "no rolls" line); ledger read failure → `null` (best-effort, same
 * discipline as `archetypeTrackRecord` above — a brief must compose the same whether this landed).
 * `positionId` is the resolved LEG's own id (may be a child, not the chain root — WATCH candidates
 * have no `positionId` at all), so this looks up the row first to get its sticky `root_position_id`
 * before walking the chain (`fetchSwingPositionChain` only matches by root, per its own doc comment).
 */
/**
 * `TerminalPlay` has no discrete `positionId` field — `terminalPlayFromHorizon` (adapters.ts)
 * bakes it into the `id` string as `${horizon}:${ticker}:${positionId}` (a WATCH/lane-only
 * candidate's `id` carries no trailing id at all, e.g. `SWING:NRG`, and correctly parses to
 * `null` here — no ledger row means no chain to walk).
 */
function positionIdFromPlayId(id: string): number | null {
  const m = /:(\d+)$/.exec(id);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

async function loadRollHistory(positionId: number | null | undefined): Promise<SwingRollHistory | null> {
  if (positionId == null) return null;
  try {
    const row = await fetchSwingPositionById(positionId);
    if (!row) return null;
    const rootId = row.root_position_id ?? row.id;
    const chain = await fetchSwingPositionChain(rootId);
    if (chain.length < 2) return null; // never rolled — nothing to disclose
    return {
      rollCount: chain.length - 1,
      legs: chain.map((r) => swingRollHistoryLegFromRow(r)),
    };
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
  const [ecosystem, vector, openBook, archetypeTrackRecord, rollHistory] = await Promise.all([
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
    // Best-effort like the read above — a DB hiccup degrades to "no roll history cited" rather
    // than failing the whole brief; loadRollHistory already wraps its own try/catch.
    withBriefSourceTimeout(loadRollHistory(positionIdFromPlayId(resolved.play.id))).catch(() => null),
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
    rollHistory,
  };
}
