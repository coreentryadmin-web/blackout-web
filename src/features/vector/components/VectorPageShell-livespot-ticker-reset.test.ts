/**
 * Regression guard for the 2026-08-27 fix: `liveSpot` (SSE-fed, threaded into
 * VectorOdteMatrixRail as its PRIMARY spot source — `liveSpot ?? data?.spot ?? initialSpot`) was
 * seeded once from the initial page load and never reset on a ticker switch. The alert-rules
 * state a few lines below it already resets correctly on `[activeTicker]`; `liveSpot` was the one
 * piece of ticker-scoped state that didn't follow the same pattern.
 *
 * Repro: switch the active ticker from A to B. Until B's first live tick arrives (a fresh SSE
 * reconnect plus first candle — can be several seconds), `liveSpot` kept holding A's last price,
 * so VectorOdteMatrixRail computed its spot row / King-strike / call-put-wall highlighting against
 * A's price on B's strike/GEX data — a direct cross-ticker misattribution, not merely a loading
 * state. If A and B don't share a strike range, the "spot" row pins to whatever real-but-
 * meaningless strike happens to be closest to the leftover number.
 *
 * Does not render VectorPageShell (no local test harness for this component family, per
 * VectorChart-footer-labels.test.ts's precedent); asserts on the source so a future edit near
 * this state can't silently drop the reset.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

test("guard: liveSpot resets on ticker switch so the 0DTE matrix rail can't inherit a foreign ticker's price", () => {
  const src = readFileSync(join(process.cwd(), "src/features/vector/components/VectorPageShell.tsx"), "utf8");
  assert.match(
    src,
    /const \[liveSpot, setLiveSpot\] = useState<number \| null>\(/,
    "expected the liveSpot state declaration"
  );
  const resetEffect = src.match(/useEffect\(\(\) => \{\s*setLiveSpot\([\s\S]*?\}, \[activeTicker\]\);/);
  assert.ok(resetEffect, "expected a useEffect resetting liveSpot keyed on [activeTicker]");
});
