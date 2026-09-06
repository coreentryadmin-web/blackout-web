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

async function loadOpenBook(): Promise<PortfolioPosition[]> {
  const rows = await fetchOpenSwingPositions().catch(() => []);
  return rows.map((r) => ({
    ticker: r.ticker,
    direction: r.direction === "short" ? ("SHORT" as const) : ("LONG" as const),
  }));
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
