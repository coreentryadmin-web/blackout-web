/**
 * Regression guard for the mobile header-overflow bug (docs/audit/UI-UX-MAP.md §3, finding #2,
 * 2026-08-23): the call/put stat row used `justify-between` with no explicit gap and no wrap. On
 * a narrow viewport, once the shared row (bias pill + this row + "Tide" label, all in one
 * flex-1-but-neighbors-are-shrink-0 header) got squeezed below the two stats' combined natural
 * width, justify-between had no surplus space to distribute — the two spans rendered back-to-back
 * with ZERO gap ("$17M calls sold$130M puts sold") and the whole row bled past the header's right
 * edge, clipping the "Tide" label. Fix: flex-wrap + an explicit column/row gap, so a too-narrow
 * row wraps to two lines with real spacing instead of overflowing horizontally with none.
 * Does not render the component (no market data in this test); asserts on the source className
 * so removing flex-wrap/gap while touching this row fails loud. Run: `npx tsx --test
 * src/features/helix/components/HelixTideBar.test.ts`
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(process.cwd(), "src/features/helix/components/HelixTideBar.tsx"), "utf8");

test("HelixTideBar: the calls/puts stat row wraps and has an explicit gap", () => {
  const rowMatch = src.match(/className="flex[^"]*font-mono text-\[9px\] tabular-nums"/);
  assert.ok(rowMatch, "expected to find the calls/puts stat row's className");
  const cls = rowMatch[0];
  assert.match(cls, /flex-wrap/, "row must wrap — a squeezed row must grow taller, not bleed past its container's right edge");
  assert.match(cls, /gap-x-\d|gap-\d/, "row must set an explicit gap — justify-between alone yields ZERO space once the row is narrower than its content");
});
