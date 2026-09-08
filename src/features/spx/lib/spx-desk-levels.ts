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
    level("PDH", input.pdh, p, "resistance"),
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
    level("PDL", input.pdl, p, "support"),
    level("LOD", input.lod, p, "support"),
  ].filter((l) => l.value != null);

  return items.sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
}
