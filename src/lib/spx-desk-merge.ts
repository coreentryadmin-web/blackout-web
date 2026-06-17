/**
 * Client-safe desk merge — do NOT import spx-desk.ts from client components
 * (it pulls Polygon/UW server providers into the browser bundle).
 */
import type { SpxDeskLevel, SpxDeskPayload, SpxDeskPulse } from "@/lib/providers/spx-desk";
import { distancePct } from "@/lib/providers/spx-session";

function level(
  label: string,
  value: number | null,
  price: number,
  kind: "support" | "resistance" | "neutral" = "neutral"
): SpxDeskLevel {
  return { label, value, kind, distance_pct: distancePct(price, value) };
}

function buildLevels(input: {
  price: number;
  lod: number | null;
  hod: number | null;
  vwap: number | null;
  pdh: number | null;
  pdl: number | null;
  ema20: number | null;
  ema50: number | null;
  ema200: number | null;
  sma50: number | null;
  sma200: number | null;
  gex_king: number | null;
  max_pain: number | null;
  gamma_flip: number | null;
}): SpxDeskLevel[] {
  const p = input.price;
  const items: SpxDeskLevel[] = [
    level("HOD", input.hod, p, "resistance"),
    level("PDH", input.pdh, p, "resistance"),
    level("GEX King", input.gex_king, p, "resistance"),
    level("Max Pain", input.max_pain, p, "neutral"),
    level("γ Flip", input.gamma_flip, p, "neutral"),
    level("EMA 20", input.ema20, p, "neutral"),
    level("VWAP", input.vwap, p, "neutral"),
    level("EMA 50", input.ema50, p, "neutral"),
    level("SMA 50", input.sma50, p, "neutral"),
    level("EMA 200", input.ema200, p, "neutral"),
    level("SMA 200", input.sma200, p, "neutral"),
    level("PDL", input.pdl, p, "support"),
    level("LOD", input.lod, p, "support"),
  ].filter((l) => l.value != null);

  return items.sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
}

/** Overlay fast Polygon pulse onto the slower UW desk snapshot. */
export function mergePulseIntoDesk(
  base: SpxDeskPayload,
  pulse: SpxDeskPulse
): SpxDeskPayload {
  const price = pulse.price || base.price;
  return {
    ...base,
    ...pulse,
    as_of: pulse.polled_at,
    polled_at: pulse.polled_at,
    source: base.source,
    levels: buildLevels({
      price,
      lod: pulse.lod ?? base.lod,
      hod: pulse.hod ?? base.hod,
      vwap: pulse.vwap ?? base.vwap,
      pdh: pulse.pdh ?? base.pdh,
      pdl: pulse.pdl ?? base.pdl,
      ema20: pulse.ema20 ?? base.ema20,
      ema50: pulse.ema50 ?? base.ema50,
      ema200: pulse.ema200 ?? base.ema200,
      sma50: pulse.sma50 ?? base.sma50,
      sma200: pulse.sma200 ?? base.sma200,
      gex_king: base.gex_king,
      max_pain: base.max_pain,
      gamma_flip: pulse.gamma_flip ?? base.gamma_flip,
    }),
  };
}
