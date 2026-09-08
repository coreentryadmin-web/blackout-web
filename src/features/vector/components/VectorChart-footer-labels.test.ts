/**
 * Regression guard for the chart-footer-legend overlap bug (docs/audit/UI-UX-MAP.md §5, finding
 * #3, 2026-08-23): the "dim = modeled" honesty label and the "· Reconstructed · spot-aligned"
 * GEX-scope chip were right-anchored `<p>` elements with no width bound and no background. On a
 * narrow (mobile) chart, the GEX chip's full text ran wide enough to overlap TWO of the chart's
 * own canvas-drawn x-axis time ticks underneath it — both label and tick text rendered
 * illegibly interleaved. A percentage max-width alone can't guarantee avoiding a tick (tick
 * positions move with zoom/pan/time-range), so the actual fix is an opaque background pill;
 * the width cap + truncate is a second, independent guard against the text overrunning the
 * chart's own right edge.
 *
 * Also covers the "SPY vol" volume-pane watermark label (found live 2026-09-03, same overlap
 * class as above but on the OPPOSITE corner: bottom-LEFT, where it collided with the chart's
 * first x-axis time tick, e.g. "19:00" — pixel-zoomed prod capture read as garbled "SPI9:00VOL").
 * The two labels above already had the opaque-pill fix at the time this one shipped; this one was
 * missed even though it sits in the identical bottom band. Its text is short and static ("SPY
 * vol"), so unlike the two right-anchored labels it doesn't need the width-cap/truncate guard —
 * only the background is asserted here.
 *
 * Does not render VectorChart (it's a 4900+ line canvas-heavy component with no local test
 * harness); asserts on the source className so a future edit near these labels that drops the
 * background or width cap fails loud instead of silently reintroducing the overlap. Verified by
 * an isolated static HTML/CSS repro (not committed) that both bugs reproduce without these
 * classes and are fixed with them, at a viewport width matching the live production screenshot
 * this finding was measured from. Run: `npx tsx --test
 * src/features/vector/components/VectorChart-footer-labels.test.ts`
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(process.cwd(), "src/features/vector/components/VectorChart.tsx"), "utf8");

function classNameNear(marker: string): string {
  const idx = src.indexOf(marker);
  assert.ok(idx >= 0, `expected to find ${JSON.stringify(marker)} in VectorChart.tsx`);
  // The nearest className="..." (or template-literal className={`...`}) BEFORE the marker —
  // take the LAST complete match in a window preceding it, not a backward-anchored regex (which
  // can't distinguish the attribute's own closing quote from "the end of what we're looking at").
  const before = src.slice(Math.max(0, idx - 400), idx);
  // Two shapes in this file: className="plain string" and className={`template ${literal}`} —
  // the latter's ternary branches carry their own nested "quotes", so match backtick-to-backtick
  // as one greedy unit rather than stopping at the first quote-like character found.
  const matches = [...before.matchAll(/className=(?:\{`([^`]*)`\}|"([^"]*)")/g)];
  assert.ok(matches.length > 0, `expected a className attribute before ${JSON.stringify(marker)}`);
  const last = matches[matches.length - 1];
  return last[1] ?? last[2];
}

test("VectorChart: the honesty label has a bounded width and an opaque background", () => {
  const cls = classNameNear("dim = modeled");
  assert.match(cls, /max-w-\[\d+%\]/, "must cap its own width — unbounded text can overrun the chart's right edge");
  assert.match(cls, /truncate/, "must truncate rather than silently overflow past its cap");
  assert.match(cls, /bg-black\/\d+/, "must have an opaque background — a transparent label over chart ticks is illegible regardless of width");
});

test("VectorChart: the GEX-scope reconstructed chip has a bounded width and an opaque background", () => {
  const cls = classNameNear("spot-aligned");
  assert.match(cls, /max-w-\[\d+%\]/, "must cap its own width — this exact text overlapped two chart axis ticks in production");
  assert.match(cls, /truncate/, "must truncate rather than silently overflow past its cap");
  assert.match(cls, /bg-black\/\d+/, "must have an opaque background — a percentage width cap alone can't guarantee dodging every possible tick position");
});

test("VectorChart: the SPY-vol volume-pane watermark has an opaque background", () => {
  // "SPY vol" alone is a substring of unrelated prose earlier in the file (e.g. the "SPY volume
  // backfill" comment) — anchor on the JSX text node's own closing tag to hit the right label.
  const cls = classNameNear("SPY vol\n        </p>");
  assert.match(
    cls,
    /bg-black\/\d+/,
    "must have an opaque background — this label sits in the same bottom band as the chart's own canvas-drawn x-axis time ticks (e.g. \"19:00\") and rendered illegibly interleaved with the first one on production"
  );
  assert.match(cls, /backdrop-blur-sm/, "must blur behind it like its two sibling labels, so partial-opacity tick glyphs don't show through");
});
