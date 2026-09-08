/**
 * Regression guard for a future-timestamp bug in congressTradeDecayMultiplier (2026-09-03). A
 * filed_at/disclosure date from the FUTURE (external congressional-trade disclosure feeds are
 * known to carry messy/malformed dates) produced a negative ageDays that trivially satisfied
 * `<= 7`, handing a bad date the MAXIMUM 1.0x recency multiplier instead of the 0.4x discount every
 * other unverifiable date already gets.
 *
 * congressTradeDecayMultiplier is unexported and pure (no I/O), so this is a source-text
 * regression guard (same idiom as spx-play-engine.test.ts's getNhConfluenceBonus check) rather
 * than importing and calling it directly — matches this file's existing convention of not
 * exporting scoring internals.
 * Run: `npx tsx --test src/features/nighthawk/lib/scorer-congress-decay-freshness.test.ts`
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(process.cwd(), "src/features/nighthawk/lib/scorer.ts"), "utf8");

test("scorer.ts: ZERODTE_MARK_FUTURE_TOLERANCE_MS is imported from marks-math", () => {
  assert.match(
    src,
    /import\s*\{\s*ZERODTE_MARK_FUTURE_TOLERANCE_MS\s*\}\s*from\s*"@\/lib\/zerodte\/marks-math"/
  );
});

test("congressTradeDecayMultiplier: a future-dated filing is discounted (0.4x), not given the max 1.0x", () => {
  const start = src.indexOf("function congressTradeDecayMultiplier");
  assert.ok(start > 0, "congressTradeDecayMultiplier exists");
  const end = src.indexOf("\nexport function scoreSmartMoney", start);
  const body = src.slice(start, end > 0 ? end : undefined);
  assert.match(
    body,
    /if \(ageMs < -ZERODTE_MARK_FUTURE_TOLERANCE_MS\) return 0\.4;/,
    "a future-dated filing must fall through to the same 0.4x floor as any other unverifiable date"
  );
});
