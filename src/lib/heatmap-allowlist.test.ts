import assert from "node:assert/strict";
import test from "node:test";
import { isHeatmapOverlayAllowed, vectorUniverseTickers } from "./heatmap-allowlist.ts";
import { THERMAL_COMPARE_PRESETS } from "@/features/thermal/lib/thermal-compare-presets";

/**
 * The Thermal sector grid and the UW overlay allowlist are two lists that have to agree, and
 * nothing connected them: #2137 shipped 8 presets of which 4 were 0/5 covered, so Space, Energy,
 * Financials and Biotech rendered the overlay chip in its "not offered" state on every column.
 * That is a silent drift — the grid still worked, it just quietly lost a feature — so it needs a
 * test rather than a comment asking the next person to remember.
 */
test("every sector-preset ticker can fetch UW overlays", () => {
  const missing: string[] = [];
  for (const preset of Object.values(THERMAL_COMPARE_PRESETS)) {
    for (const ticker of preset.tickers) {
      if (!isHeatmapOverlayAllowed(ticker)) missing.push(`${preset.label}:${ticker}`);
    }
  }
  assert.deepEqual(
    missing,
    [],
    `Sector-grid tickers missing from the overlay allowlist — add them to ` +
      `HEATMAP_EXTRA_LIQUID_TICKERS in heatmap-allowlist.ts, or drop them from the preset: ` +
      missing.join(", ")
  );
});

/**
 * The allowlist is ALSO the static half of the shared warm/record universe
 * (vectorUniverseTickers → listSharedUniverseTickers), and every static name is work the 5-min
 * recorder cron does on every run forever. The dynamic half is separately capped at 100. This
 * bound is a deliberate ceiling on the static side so a future preset spree can't quietly turn a
 * bounded cron into an unbounded one.
 */
test("static overlay universe stays within its cron budget", () => {
  const universe = vectorUniverseTickers();
  assert.ok(
    universe.length <= 60,
    `static universe is ${universe.length} tickers; each one is per-run work in the 5-min ` +
      `recorder cron. Raise this bound deliberately, with the cron runtime re-measured.`
  );
  assert.equal(new Set(universe).size, universe.length, "no duplicate tickers");
});
