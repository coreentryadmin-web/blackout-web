/**
 * Server-side context loader for the Swing Play Intelligence Engine.
 * Reads the same caches / DB rows Largo tools use — no provider fan-out, no LLM.
 */
import { fetchEcosystemContext } from "@/lib/bie/ecosystem-context";
import { fetchVectorFullState } from "@/lib/bie/vector-full-state";
import { fetchOpenSwingPositions } from "@/lib/db";
import { etSessionDate } from "@/lib/largo/temporal/bar-session-date";
import { normalizeDteHorizon } from "@/features/vector/lib/vector-dte-horizon";
import type { SwingPlayBriefContext } from "./play-brief-types";
import { resolveSwingPlayForBrief, type SwingBriefResolveHints } from "./play-brief-resolve";
import { fetchMeridianForTicker } from "./play-brief-meridian";
import type { PortfolioPosition } from "./portfolio";

/**
 * The member's full open book as `PortfolioPosition[]` for the "Book context" theme-overlap
 * section. `direction` on the ledger row is lowercase ("long"/"short"); the overlap checker
 * (and the swing entry gate it shares code with) works in uppercase `PlayDirection`. The play
 * under review is NOT filtered out here — `checkPortfolioOverlap` already skips any existing
 * position with the SAME ticker AND SAME direction as the candidate (a rolled/duplicate row on
 * the same bet is not a second, separate overlap to report), so passing the raw book is correct.
 */
async function loadOpenBook(): Promise<PortfolioPosition[]> {
  const rows = await fetchOpenSwingPositions().catch(() => []);
  return rows.map((r) => ({ ticker: r.ticker, direction: r.direction === "short" ? ("SHORT" as const) : ("LONG" as const) }));
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
  const [ecosystem, vector, meridian, openBook] = await Promise.all([
    fetchEcosystemContext(ticker).catch(() => null),
    fetchVectorFullState(ticker, normalizeDteHorizon("all")).catch(() => null),
    fetchMeridianForTicker(ticker).catch(() => null),
    loadOpenBook(),
  ]);

  const nowMs = Date.now();
  const asOf = new Date(nowMs).toISOString();
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
    openBook,
  };
}
