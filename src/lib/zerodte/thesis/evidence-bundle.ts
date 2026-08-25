import "server-only";

import { readVectorFullStateCache } from "@/lib/bie/vector-full-state-cache";
import { gexPositioningFromHeatmap } from "@/lib/providers/gex-positioning";
import { readGexHeatmapCacheOnly } from "@/lib/providers/polygon-options-gex";
import {
  thesisEvidenceToLegacyExtras,
  selectThesisEvidenceTickers,
  thesisEvidenceMaxTickers,
  type ThesisEvidenceSnapshot,
} from "./evidence-bundle-map";
import type { LegacyBridgeExtras } from "./rails/legacy-bridge";

export type { ThesisEvidenceSnapshot } from "./evidence-bundle-map";
export {
  thesisEvidenceToLegacyExtras,
  mergeLegacyBridgeExtras,
  selectThesisEvidenceTickers,
  thesisEvidenceMaxTickers,
  THESIS_EVIDENCE_MAX_TICKERS_DEFAULT,
} from "./evidence-bundle-map";

/** Build one ticker's evidence from shared cache readers only (no upstream chain builds). */
async function fetchThermalEvidenceCacheOnly(ticker: string): Promise<ThesisEvidenceSnapshot["thermal"]> {
  const root = ticker.trim().toUpperCase();
  if (!root) return null;
  const hm = await readGexHeatmapCacheOnly(root).catch(() => null);
  const positioning = gexPositioningFromHeatmap(root, hm);
  if (!positioning || !(positioning.spot > 0)) return null;
  return {
    gamma_posture: positioning.gamma_posture,
    call_wall: positioning.call_wall,
    put_wall: positioning.put_wall,
    gex_king_strike: positioning.gex_king_strike,
    cross_validation_divergence:
      positioning.gex_cross_validation?.divergence != null &&
      Number.isFinite(positioning.gex_cross_validation.divergence)
        ? positioning.gex_cross_validation.divergence
        : null,
  };
}

/** Build one ticker's evidence from shared cache readers only (no upstream chain builds). */
export async function fetchThesisEvidenceForTicker(ticker: string): Promise<ThesisEvidenceSnapshot> {
  const root = ticker.trim().toUpperCase();
  const [thermal, vector] = await Promise.all([
    fetchThermalEvidenceCacheOnly(root),
    readVectorFullStateCache(root, "0dte").catch(() => null),
  ]);

  let vectorSnap: ThesisEvidenceSnapshot["vector"] = null;
  if (vector && vector.spot != null && vector.spot > 0) {
    const resistance =
      vector.gexWalls?.callWalls?.[0]?.strike ?? vector.confluenceZones?.[0]?.center ?? null;
    const support = vector.gexWalls?.putWalls?.[0]?.strike ?? null;
    const lastSample = vector.wallHistory?.[vector.wallHistory.length - 1];
    const bead =
      lastSample?.walls?.callWalls?.[0]?.strike ??
      lastSample?.walls?.putWalls?.[0]?.strike ??
      null;
    const emPct =
      vector.expectedMove?.movePct != null && Number.isFinite(vector.expectedMove.movePct)
        ? Math.round(vector.expectedMove.movePct * 1000) / 10
        : null;
    const dpBias = deriveDarkPoolBias(vector.darkPoolLevels ?? [], vector.spot);
    vectorSnap = {
      resistance: resistance != null && Number.isFinite(resistance) ? resistance : null,
      support: support != null && Number.isFinite(support) ? support : null,
      bead_wall_near_spot: bead != null && Number.isFinite(bead) ? bead : null,
      expected_move_pct: emPct,
      dark_pool_bias: dpBias,
    };
  }

  return { thermal, vector: vectorSnap };
}

function deriveDarkPoolBias(
  levels: Array<{ strike: number; premium?: number | null }>,
  spot: number
): "bullish" | "bearish" | "mixed" | null {
  if (!levels.length || !(spot > 0)) return null;
  let above = 0;
  let below = 0;
  for (const l of levels.slice(0, 5)) {
    if (!Number.isFinite(l.strike)) continue;
    const w = l.premium != null && Number.isFinite(l.premium) ? l.premium : 1;
    if (l.strike >= spot) above += w;
    else below += w;
  }
  if (above === 0 && below === 0) return null;
  const ratio = above / (above + below);
  if (ratio >= 0.65) return "bullish";
  if (ratio <= 0.35) return "bearish";
  return "mixed";
}

/**
 * Batch cache reads for a scan pass — one extras map per ticker.
 * `tickers` should arrive score-sorted; only the first `maxTickers` are fetched.
 */
export async function fetchThesisEvidenceForTickers(
  tickers: string[],
  opts: { maxTickers?: number } = {}
): Promise<Record<string, LegacyBridgeExtras>> {
  const max = opts.maxTickers ?? thesisEvidenceMaxTickers();
  const uniq = selectThesisEvidenceTickers(tickers, max);
  if (uniq.length === 0) return {};

  const settled = await Promise.allSettled(uniq.map((t) => fetchThesisEvidenceForTicker(t)));
  const out: Record<string, LegacyBridgeExtras> = {};
  for (let i = 0; i < uniq.length; i++) {
    const r = settled[i]!;
    if (r.status === "fulfilled") {
      out[uniq[i]!] = thesisEvidenceToLegacyExtras(r.value);
    }
  }
  return out;
}
