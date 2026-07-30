// Regime Plane — single commit-time snapshot for fail-closed fresh opens (Wave A).
// Both 0DTE and Swing read the same confidence derivation so a blind regime never
// opens new risk while watch/research lanes stay live.

import { isPolygonCircuitOpen } from "@/lib/providers/polygon-rate-limiter";

export type RegimeGexQuality = "polygon_chain" | "uw_strike_fallback" | "empty";
export type RegimeCommitConfidence = "high" | "degraded" | "blind";

export interface RegimePlaneSnapshot {
  vixDayOpen: number | null;
  vixUnavailable: boolean;
  macroUnavailable: boolean;
  haltFeedStale: boolean;
  gexQuality: RegimeGexQuality;
  confidence: RegimeCommitConfidence;
  /** When true, fresh commits must HOLD (watch cards OK). */
  blockFreshCommits: boolean;
  humanReason: string | null;
}

function envFlag(name: string, defaultOn: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off") return false;
  if (raw === "1" || raw === "true" || raw === "on") return true;
  return defaultOn;
}

/** Kill-switch for regime-blind fail-closed (default ON). */
export const REGIME_BLIND_FAIL_CLOSED =
  envFlag("ZERODTE_REGIME_BLIND_FAIL_CLOSED", true);

export function buildRegimePlaneSnapshot(input: {
  vixDayOpen?: number | null;
  vixUnavailable?: boolean;
  macroUnavailable?: boolean;
  haltFeedStale?: boolean;
  /** When Polygon REST is degraded and GEX is on UW fallback only. */
  gexQuality?: RegimeGexQuality;
}): RegimePlaneSnapshot {
  const vixUnavailable = input.vixUnavailable === true;
  const macroUnavailable = input.macroUnavailable === true;
  const haltFeedStale = input.haltFeedStale === true;
  const gexQuality = input.gexQuality ?? "polygon_chain";

  let confidence: RegimeCommitConfidence = "high";
  if (vixUnavailable || macroUnavailable || haltFeedStale || gexQuality === "empty") {
    confidence = "blind";
  } else if (gexQuality === "uw_strike_fallback") {
    confidence = "degraded";
  }

  const blockFreshCommits =
    REGIME_BLIND_FAIL_CLOSED && confidence === "blind";

  let humanReason: string | null = null;
  if (blockFreshCommits) {
    const parts: string[] = [];
    if (vixUnavailable) parts.push("day-open VIX unreadable");
    if (macroUnavailable) parts.push("macro calendar unavailable");
    if (haltFeedStale) parts.push("halt feed stale");
    if (gexQuality === "empty") parts.push("GEX unavailable");
    humanReason =
      `Regime blind (${parts.join("; ")}) — no fresh commits until inputs recover.`;
  }

  return {
    vixDayOpen: input.vixDayOpen ?? null,
    vixUnavailable,
    macroUnavailable,
    haltFeedStale,
    gexQuality,
    confidence,
    blockFreshCommits,
    humanReason,
  };
}

/** Thesis exits on gex-walls veto require high-confidence GEX (not UW fallback). */
export function gexQualityDegradedForExit(gexQuality: RegimeGexQuality | undefined): boolean {
  return gexQuality != null && gexQuality !== "polygon_chain";
}

/** Infer GEX source quality at commit time without a per-ticker chain fetch. */
export function inferRegimeGexQuality(opts?: {
  polygonCircuitOpen?: boolean;
  gexUnavailable?: boolean;
}): RegimeGexQuality {
  if (opts?.gexUnavailable === true) return "empty";
  if (opts?.polygonCircuitOpen ?? isPolygonCircuitOpen()) return "uw_strike_fallback";
  return "polygon_chain";
}
