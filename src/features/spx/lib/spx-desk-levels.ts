// Shared level-ladder builder for the SPX desk, extracted so the initial server-side desk build
// (spx-desk.ts) and the client-side pulse/flow merge (spx-desk-merge.ts) cannot drift apart on the
// same derivation again — exactly what happened when #80 fixed the King node's `kind` to "neutral"
// in the merge file only, leaving the initial build hardcoded to "resistance" for the same field.
// No `server-only` and no provider import at scope, so this is unit-testable in isolation (the same
// reason spx-desk-numerics.ts exists) — the SpxDeskLevel import is type-only, erased at compile.
import { distancePct } from "@/lib/providers/spx-session";
import type { SpxDeskLevel } from "./spx-desk";

function level(
  label: string,
  value: number | null,
  price: number,
  kind: "support" | "resistance" | "neutral" = "neutral"
): SpxDeskLevel {
  return { label, value, kind, distance_pct: distancePct(price, value) };
}

/**
 * PDH/PDL role-reversal — PDH/PDL are prior-SESSION reference levels, not today's own bounds, so
 * price is free to trade through either of them (gap, breakout, breakdown). Unlike HOD/LOD
 * (today's own session extremes, which by construction always bound today's price — price can
 * never be below LOD or above HOD), a hardcoded "PDH=resistance, PDL=support" silently inverts
 * once price has actually moved through the level: a broken prior-day low sitting ABOVE spot is
 * overhead resistance, not support underneath, and a broken prior-day high sitting BELOW spot is
 * support underneath, not resistance overhead.
 *
 * Live bug (2026-10-14): on a session where price gapped/dropped below the ENTIRE prior day's
 * range (price 7718.94, PDL 7786.11 both measured live — PDL sitting 67pts ABOVE price), PDL was
 * hardcoded "support" even though it was broken-through overhead resistance. This isn't cosmetic —
 * `l.kind === "support"` directly feeds two live play-generation call sites:
 * `spx-play-confirmations.ts`'s `structureAligned()` (`supports.some(l => nearLevel(price, l.value))`
 * → "Long near PDL" confirmation) and `spx-play-mtf.ts`'s `keyLevelForDirection()`
 * (`.find(l => l.kind === "support")` as the long-trigger anchor whenever VWAP is unavailable) —
 * both would treat a broken-down PDL as a legitimate long-support node instead of the resistance
 * it actually is once price trades within proximity of it from below.
 *
 * Same role-reversal #80 already partially encoded for the GEX King node (by going neutral rather
 * than hardcoding a direction) — PDH/PDL get the stronger fix, since their role IS well-defined
 * once you know which side of the level price is actually on: a level price sits on/above is
 * support, a level price sits below is resistance. HOD/LOD keep their hardcoded kind — they are
 * tautologically bounded by today's own price action, so the role-reversal case cannot occur.
 */
function priorSessionLevelKind(value: number | null, price: number, fallback: "support" | "resistance"): "support" | "resistance" {
  if (value == null) return fallback; // unreachable in practice — caller filters null values out
  return price >= value ? "support" : "resistance";
}

export function buildLevels(input: {
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
    level("PDH", input.pdh, p, priorSessionLevelKind(input.pdh, p, "resistance")),
    // Anchor = argmax|net_gex|; it's often the PUT wall (support) and may sit below spot,
    // so it carries no directional meaning — mark it neutral (sky/gold) to match the
    // Heatmap ANCHOR node + Dealer Desk gold treatment, not unconditional resistance/red (#80).
    level("King node · GEX anchor", input.gex_king, p, "neutral"),
    level("Max Pain", input.max_pain, p, "neutral"),
    level("γ Flip", input.gamma_flip, p, "neutral"),
    level("EMA 20", input.ema20, p, "neutral"),
    level("VWAP", input.vwap, p, "neutral"),
    level("EMA 50", input.ema50, p, "neutral"),
    level("SMA 50", input.sma50, p, "neutral"),
    level("EMA 200", input.ema200, p, "neutral"),
    level("SMA 200", input.sma200, p, "neutral"),
    level("PDL", input.pdl, p, priorSessionLevelKind(input.pdl, p, "support")),
    level("LOD", input.lod, p, "support"),
  ].filter((l) => l.value != null);

  return items.sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
}
