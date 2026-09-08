/**
 * Regression guard: the market-wide BULLISH/BEARISH bias badge and the adjacent net-premium
 * figure/sparkline must read the SAME population of dark-pool prints.
 *
 * `load()` computes `latestNet` (drives the sparkline color and the +$X/-$X figure) from ALL
 * fetched rows (`allPrints`, up to 100 — `fetchDarkPoolPrints({ limit: 100 })`). The bias badge
 * used to be computed from `visible`, which in the unfiltered market view is `allPrints.slice(0,
 * 60)` — only the first 60 of that same fetch. Any poll where rows 1-60 skew one direction but
 * rows 61-100 skew hard enough the other way to flip the full-population sum produced two adjacent
 * indicators disagreeing about the same market read (e.g. a red BEARISH badge next to a green
 * "+$X" figure). Source-scanned rather than rendered — this codebase has no React Testing Library
 * harness for this component and the bug is a population-mismatch in plain data flow, not
 * something that needs a DOM.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(process.cwd(), "src/features/helix/components/DarkPoolPanel.tsx"), "utf8");

test("DarkPoolPanel: market-wide biasRead reads allPrints, not the 60-row visible slice", () => {
  const call = src.match(/const biasRead\s*=\s*readDarkPoolBias\(([^)]*)\)/);
  assert.ok(call, "expected to find the biasRead computation");
  const arg = call[1].trim();
  assert.match(
    arg,
    /filterTicker\s*\?\s*visible\s*:\s*allPrints/,
    "biasRead must use allPrints in the unfiltered (market) branch — the same population " +
      "latestNet/the sparkline are computed from — falling back to `visible` only decides the " +
      "already-consistent ticker-filtered case"
  );
});

test("DarkPoolPanel: latestNet is still derived from the full fetch, unchanged by the fix", () => {
  assert.match(
    src,
    /const rows = res\.prints \?\? \[\];[\s\S]{0,400}setHistory/,
    "latestNet's net buy-sell sum must still come from the unsliced fetched rows"
  );
});
