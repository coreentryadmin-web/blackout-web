import { test } from "node:test";
import assert from "node:assert/strict";
import { LEARN_ARTICLES } from "./articles";
import { HEATMAP_PRESET_TICKERS } from "@/lib/heatmap-allowlist";

// Regression for a P3 finding (2026-09-04): the Vector Academy guide (articles.ts,
// "vector-scanner-guide") claimed "[SPX Slayer] and [Thermal] focus on SPX" and "[Thermal] gives
// you the deep heatmap for SPX" — implying Thermal is SPX-only, to differentiate it from Vector's
// real value prop (a universe-wide screener). That was false: Thermal's route
// (`/api/market/gex-heatmap`) accepts any valid ticker (no SPX-only gate), and
// HEATMAP_PRESET_TICKERS below lists 11 preset chips spanning indices AND single names — Thermal
// genuinely supports multiple tickers, you just pick one at a time (Vector's actual
// differentiator is scanning ALL of them automatically, not that Thermal is SPX-restricted).
// SPX Slayer, in contrast, genuinely IS SPX/SPXW-only (see its own manifest entry) — this test
// only guards the Thermal-specific overclaim, not the SPX Slayer one.
test("Thermal's real ticker-preset list is genuinely multi-ticker (grounds the Vector-guide fix)", () => {
  assert.ok(
    HEATMAP_PRESET_TICKERS.length > 1,
    "Thermal must have more than one preset ticker for the 'not SPX-only' framing to be true"
  );
  assert.ok(
    HEATMAP_PRESET_TICKERS.some((t) => t !== "SPX" && t !== "SPY"),
    "Thermal's presets must include non-index single names, not just SPX/SPY"
  );
});

const SPX_ONLY_THERMAL_PHRASES = [") focus on spx", "gives you the deep heatmap for spx"];

test("no Learn article claims Thermal is SPX-only (Thermal is genuinely multi-ticker)", () => {
  const offenders: string[] = [];
  for (const article of LEARN_ARTICLES) {
    const lower = article.body.toLowerCase();
    if (SPX_ONLY_THERMAL_PHRASES.some((phrase) => lower.includes(phrase))) {
      offenders.push(article.slug);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `these articles frame Thermal as SPX-only, contradicting its real multi-ticker preset list: ${offenders.join(", ")}`
  );
});
