/**
 * Server-side enrichment for Vector contract picks — cache readers only (GEX matrix,
 * Meridian earnings lookup, Benzinga catalysts/news). Never hits upstream per request
 * beyond what the shared caches already dedupe.
 */
import "server-only";

import { loadMeridianTickerLookup } from "@/lib/meridian/meridian-ticker-lookup";
import { getGexPositioning } from "@/lib/providers/gex-positioning";
import { fetchGexHeatmap } from "@/lib/providers/polygon-options-gex";
import { fetchBenzingaCatalysts, fetchBenzingaNews } from "@/lib/providers/polygon";
import type { VectorPickCatalyst } from "./vector-pick-types";

export type { VectorPickCatalyst } from "./vector-pick-types";

/** Desk context merged into pick ranking + evidence — all fields optional when cold. */
export type VectorPickEnrichment = {
  gexKingStrike: number | null;
  maxPain: number | null;
  /** Near-term net dealer GEX by strike (signed dollars). */
  strikeTotals: Record<string, number>;
  catalysts: VectorPickCatalyst[];
  newsHeadline: string | null;
};

export { strikeGexFromTotals, topGexPinStrikes } from "./strike-gex-lookup";

/**
 * Load shared desk enrichment for one ticker. Returns null only when the ticker is empty;
 * partial data is fine — missing sections are omitted downstream.
 */
export async function loadVectorPickEnrichment(ticker: string): Promise<VectorPickEnrichment> {
  const root = String(ticker ?? "").trim().toUpperCase();
  const empty: VectorPickEnrichment = {
    gexKingStrike: null,
    maxPain: null,
    strikeTotals: {},
    catalysts: [],
    newsHeadline: null,
  };
  if (!root) return empty;

  const [positioning, hm, meridian, catalysts, newsArticles] = await Promise.all([
    getGexPositioning(root).catch(() => null),
    fetchGexHeatmap(root).catch(() => null),
    loadMeridianTickerLookup(root).catch(() => null),
    fetchBenzingaCatalysts(root, 3).catch(() => [] as Awaited<ReturnType<typeof fetchBenzingaCatalysts>>),
    fetchBenzingaNews(5, { ticker: root }).catch(() => [] as Awaited<ReturnType<typeof fetchBenzingaNews>>),
  ]);

  const strikeTotals = hm?.gex?.strike_totals ?? {};
  const catalystList: VectorPickCatalyst[] = [];

  if (meridian?.found && meridian.earnings) {
    const e = meridian.earnings;
    const when =
      e.when === "premarket" || e.when === "afterhours" ? e.when : null;
    catalystList.push({
      kind: "earnings",
      label: `${root} earnings ${e.date}`,
      detail: e.status_label ?? (e.fiscal_period ? `${e.fiscal_period} ${e.fiscal_year ?? ""}`.trim() : undefined),
      daysUntil: e.days_until,
      when,
    });
  }

  for (const c of catalysts.slice(0, 2)) {
    if (!c.title) continue;
    catalystList.push({
      kind: "catalyst",
      label: c.title.slice(0, 140),
      detail: c.type !== "other" ? c.type : c.channel || undefined,
    });
  }

  const newsHeadline =
    typeof newsArticles[0]?.title === "string" && newsArticles[0].title.trim()
      ? newsArticles[0].title.trim().slice(0, 160)
      : null;

  return {
    gexKingStrike: positioning?.gex_king_strike ?? null,
    maxPain: positioning?.max_pain ?? null,
    strikeTotals,
    catalysts: catalystList,
    newsHeadline,
  };
}
