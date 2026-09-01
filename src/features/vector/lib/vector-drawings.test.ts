import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import {
  createDrawingFromClick,
  fibPrices,
  hitTestDrawing,
  newDrawingId,
  rayEndPoint,
  sanitizeDrawing,
  snapPriceToBar,
} from "./vector-drawings";

describe("vector-drawings", () => {
  test("sanitizeDrawing: keeps valid hline, drops garbage", () => {
    assert.ok(
      sanitizeDrawing({ id: "a", kind: "hline", color: "cyan", price: 100, createdAt: 1 })
    );
    assert.equal(sanitizeDrawing({ id: "a", kind: "hline", color: "cyan", price: -1 }), null);
    assert.equal(sanitizeDrawing(null), null);
  });

  test("fibPrices: 0 and 1 anchor the swing", () => {
    const levels = fibPrices(100, 200);
    assert.equal(levels[0]!.price, 100);
    assert.equal(levels[levels.length - 1]!.price, 200);
    assert.ok(levels.some((l) => l.ratio === 0.618));
  });

  test("rayEndPoint: extends through right time", () => {
    const end = rayEndPoint({ t: 100, p: 100 }, { t: 200, p: 200 }, 500);
    assert.equal(end.t, 500);
    assert.equal(end.p, 500);
  });

  test("snapPriceToBar: snaps to nearest OHLC", () => {
    const bar = { open: 10, high: 12, low: 9, close: 11 };
    assert.equal(snapPriceToBar(11.1, bar), 11);
    assert.equal(snapPriceToBar(9.2, bar), 9);
  });

  test("createDrawingFromClick: two-click trend", () => {
    const a = { t: 100, p: 50 };
    const b = { t: 200, p: 60 };
    const d = createDrawingFromClick("trend", "cyan", b, a);
    assert.equal(d?.kind, "trend");
    assert.equal((d as { t1: number }).t1, 100);
  });

  test("hitTestDrawing: finds nearest hline", () => {
    const drawings = [
      { id: "1", kind: "hline" as const, color: "cyan" as const, price: 100, createdAt: 1 },
      { id: "2", kind: "hline" as const, color: "red" as const, price: 200, createdAt: 1 },
    ];
    assert.equal(hitTestDrawing(drawings, 1000, 101, 60, 2), "1");
    assert.equal(hitTestDrawing(drawings, 1000, 500, 60, 2), null);
  });

  test("newDrawingId: unique strings", () => {
    const a = newDrawingId();
    const b = newDrawingId();
    assert.notEqual(a, b);
  });

  test("guard: switching draw tools clears the pending two-click draft anchor", () => {
    // Regression guard for the 2026-08-27 fix: switching tools mid-draft (e.g. clicking one point
    // of a trendline, then selecting "Select" or a different tool) used to leave draftAnchorRef
    // pointing at the abandoned click. A ghost preview line kept following the cursor regardless
    // of the active tool, and re-selecting a two-click tool later silently anchored the NEXT
    // drawing to that stale, long-abandoned point instead of starting fresh. There's no React
    // rendering harness in this repo to mount the hook directly, so this asserts the fix is wired
    // into the source: the drawTool-change effect must clear both the anchor ref and the
    // primitive's draft preview.
    const src = readFileSync(
      join(process.cwd(), "src/features/vector/lib/use-vector-chart-drawings.ts"),
      "utf8"
    );
    const effectMatch = src.match(
      /useEffect\(\(\) => \{\s*drawToolRef\.current = drawTool;[\s\S]*?\}, \[drawTool[^\]]*\]\);/
    );
    assert.ok(effectMatch, "expected the drawTool-sync effect to exist");
    assert.match(effectMatch![0], /draftAnchorRef\.current = null/);
    assert.match(effectMatch![0], /drawingsPrimitiveRef\.current\?\.setDraft\(null, null\)/);
  });
});
