/**
 * Regression: `darkPoolByRow` (the Gamma Profile's dark-pool overlay) must not snap a dark-pool
 * price level onto a profile row that is far outside the rendered strike band.
 *
 * `darkPoolLevels` comes from `buildDarkPoolLevels()` (gex-heatmap/route.ts) — the ticker's raw
 * dark-pool prints over a lookback window, ranked by notional — which is NOT constrained to the
 * `strikes`/`rows` the profile actually renders (unlike the HELIX flow overlay, whose server
 * builder IS passed `strikes`). So a dark-pool print at a materially different price than today's
 * (a pre-earnings-gap print, or any name whose rendered strike band is narrow) can sit far outside
 * the visible rows entirely.
 *
 * The client-side nearest-row mapping already carried a comment saying exactly this case should be
 * skipped — "Skip levels far outside the band (> half the strike step from any row)" — but had no
 * code enforcing it: it always picked *some* row (whichever was nearest, however far that still
 * was) and drew the dark-pool line across it, which silently mislabels a far-away print as having
 * happened AT that strike (found during the 2026-10-31 audit sweep).
 *
 * This test extracts the real `darkPoolByRow` useMemo body verbatim from the component source and
 * executes it (no React/DOM needed — it is pure over its three inputs), so it exercises the actual
 * shipped logic rather than a hand-written mirror that could silently drift from it.
 *
 * Run: `npx tsx --experimental-test-module-mocks --test src/features/thermal/components/GexHeatmap-darkpool-band.test.ts`
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(process.cwd(), "src/features/thermal/components/GexHeatmap.tsx"), "utf8");

function extractDarkPoolByRowBody(): string {
  const anchor = "const darkPoolByRow = useMemo(() => {";
  const start = src.indexOf(anchor);
  assert.ok(start > 0, "darkPoolByRow useMemo exists");
  const bodyStart = start + anchor.length;
  const end = src.indexOf("}, [darkPoolLevels, rows, showDarkPool]);", bodyStart);
  assert.ok(end > bodyStart, "darkPoolByRow useMemo close marker exists");
  return src.slice(bodyStart, end);
}

/** Builds the exact runtime function the component's useMemo factory evaluates. */
function buildDarkPoolByRow(): (
  darkPoolLevels: { price: number; notional: number }[] | null,
  rows: { strike: number }[],
  showDarkPool: boolean
) => Map<number, { price: number; notional: number }> {
  // Only ONE TS-only token appears in this body (the `Map<number, DarkPoolLevel>` generic on
  // construction) — stripped so `new Function` can parse it as plain JS. Everything else
  // (control flow, comparisons, the guard under test) is executed verbatim from the real source.
  const body = extractDarkPoolByRowBody().replace(/new Map<[^>]*>\(\)/, "new Map()");
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- extracting real source, not user input
  return new Function("darkPoolLevels", "rows", "showDarkPool", `${body}\nreturn map;`) as any;
}

test("GexHeatmap: darkPoolByRow still contains the band-distance guard", () => {
  const body = extractDarkPoolByRowBody();
  assert.match(
    body,
    /bestDist\s*<=\s*maxDist/,
    "the comment 'skip levels far outside the band' must be enforced by real code, not just stated"
  );
});

test("darkPoolByRow: a dark-pool print far outside the rendered strike band is dropped, not snapped to the nearest edge row", () => {
  const fn = buildDarkPoolByRow();
  // A normal SPY-shaped band: 20 rows, 1-pt strikes, centered near 600.
  const rows = Array.from({ length: 20 }, (_, i) => ({ strike: 610 - i }));
  // One real in-band print (602 — lands cleanly inside the band) and one print from a materially
  // different price (450 — e.g. a pre-earnings-gap tape print), ~150pts outside the band.
  const levels = [
    { price: 602, notional: 5_000_000 },
    { price: 450, notional: 9_000_000 },
  ];
  const map = fn(levels, rows, true);

  // The in-band print must still render (strike 602 is row index 8 in this fixture).
  assert.equal(map.size, 1, "exactly one level should resolve onto the rendered band");
  const resolved = [...map.values()][0];
  assert.equal(resolved.price, 602, "the in-band print is the one that renders");

  // The far-away print must NOT have been silently snapped onto the bottom edge row (591).
  for (const [, level] of map) {
    assert.notEqual(level.price, 450, "a far-outside-the-band print must never render on an edge row");
  }
});

test("darkPoolByRow: a genuinely in-band print at the very edge of the band still renders", () => {
  const fn = buildDarkPoolByRow();
  const rows = Array.from({ length: 20 }, (_, i) => ({ strike: 610 - i })); // 610..591
  // Half a strike-step (0.5) beyond the lowest row — still within tolerance.
  const levels = [{ price: 590.5, notional: 1_000_000 }];
  const map = fn(levels, rows, true);
  assert.equal(map.size, 1, "a print within half a strike-step of the edge row still renders");
});
