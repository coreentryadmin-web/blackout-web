import { test } from "node:test";
import assert from "node:assert/strict";
import { fitSignalBadges, estimateSignalBadgeWidthPx, SIGNALS_CELL_BUDGET_PX } from "./helix-signal-fit.ts";

function badge(label: string) {
  return { label };
}

/** Same layout math as `.helix-tape-signals` (`flex flex-nowrap gap-1`), used to independently
 *  re-total a chosen row's width from scratch rather than trusting the module's own bookkeeping. */
const GAP_PX = 4;
function rowWidthPx(labels: string[], overflowCount: number): number {
  let w = labels
    .map((l) => estimateSignalBadgeWidthPx(l))
    .reduce((sum, width, i) => sum + width + (i > 0 ? GAP_PX : 0), 0);
  if (overflowCount > 0) w += GAP_PX + estimateSignalBadgeWidthPx(`+${overflowCount}`);
  return w;
}

test("SIGNALS_CELL_BUDGET_PX is derived from the signals column's own floor width, not a magic number", () => {
  // HELIX_TABLE_COLUMNS pins the `signals` column floor at 8.5rem (136px @ 16px root); the CSS
  // `minmax(8.5rem, …fr)` track can never render narrower than that at ANY viewport/density. Minus
  // `.helix-tape-cell`'s own 20px of horizontal padding (px-2.5 each side) leaves 116px of usable
  // row content — the conservative, viewport-independent budget this module fits against.
  assert.equal(SIGNALS_CELL_BUDGET_PX, 116);
});

// ── RED: the bug as shipped ─────────────────────────────────────────────────────────────────────
// Reproduces the finding's exact live row: a stacked, freshly-opened, repeated-hits print carries
// 4 signal badges. The OLD render logic (`signals.slice(0, 3)`, a raw COUNT cap with zero notion of
// pixel width) would unconditionally render STACK + "NEW 4.2×" + REPEAT plus a trailing "+1" chip —
// which is exactly the row the live audit captured painting as "STACK", "NEW 4.2×", then a single
// clipped "R" with the "+1" never visible at all (`.helix-tape-signals` is `flex-nowrap
// overflow-hidden` with no scroll or wrap anywhere in its ancestor chain, so anything past the
// cell's edge is hard-clipped mid-glyph, not scrolled/ellipsized/wrapped).
test("the reproduced live row does not fit under the OLD signals.slice(0, 3) cap", () => {
  const signals = [badge("STACK"), badge("NEW 4.2×"), badge("REPEAT"), badge("0DTE")];
  const oldVisible = signals.slice(0, 3); // the exact expression HelixFlowTable.tsx used to run
  const oldOverflow = signals.length - oldVisible.length;
  const oldRowWidth = rowWidthPx(oldVisible.map((s) => s.label), oldOverflow);
  assert.ok(
    oldRowWidth > SIGNALS_CELL_BUDGET_PX,
    `expected the old fixed 3-badge cap to overflow the ${SIGNALS_CELL_BUDGET_PX}px cell, ` +
      `but it only measured ${oldRowWidth}px — the repro fixture no longer demonstrates the bug`
  );
});

// ── GREEN: fitSignalBadges ──────────────────────────────────────────────────────────────────────
test("fitSignalBadges keeps the same reproduced row inside the cell's budget", () => {
  const signals = [badge("STACK"), badge("NEW 4.2×"), badge("REPEAT"), badge("0DTE")];
  const { visible, overflowCount } = fitSignalBadges(signals);

  assert.equal(visible.length + overflowCount, signals.length, "every signal must be accounted for");
  assert.deepEqual(
    visible.map((s) => s.label),
    signals.slice(0, visible.length).map((s) => s.label),
    "visible badges are always a PREFIX of the input — flowSignals already orders by priority"
  );

  const width = rowWidthPx(visible.map((s) => s.label), overflowCount);
  assert.ok(
    width <= SIGNALS_CELL_BUDGET_PX,
    `fitted row (${width}px) must fit the ${SIGNALS_CELL_BUDGET_PX}px cell — nothing may be clipped`
  );
  // The old cap silently dropped the "+1" chip off the end of the DOM's painted content; the fit
  // must never do that — if anything overflowed, its count has to actually render.
  if (overflowCount > 0) assert.ok(visible.length < signals.length);
});

test("fitSignalBadges never drops a badge when everything already fits", () => {
  const signals = [badge("STACK"), badge("0DTE")];
  const { visible, overflowCount } = fitSignalBadges(signals);
  assert.equal(overflowCount, 0);
  assert.deepEqual(visible, signals);
});

test("fitSignalBadges handles zero signals", () => {
  assert.deepEqual(fitSignalBadges([]), { visible: [], overflowCount: 0 });
});

test("fitSignalBadges: the overflow count always reflects what was actually dropped", () => {
  // A synthetic worst case: more long labels than any budget this cell can render at.
  const signals = Array.from({ length: 8 }, (_, i) => badge(`≈C WALL ${i}`));
  const { visible, overflowCount } = fitSignalBadges(signals);
  assert.equal(visible.length + overflowCount, signals.length);
  assert.ok(overflowCount > 0, "sanity: this fixture must not all fit in the default budget");
  const width = rowWidthPx(visible.map((s) => s.label), overflowCount);
  assert.ok(width <= SIGNALS_CELL_BUDGET_PX);
});

test("a wider budget shows at least as many badges as the cell's own narrow floor", () => {
  const signals = [badge("STACK"), badge("NEW 4.2×"), badge("REPEAT"), badge("0DTE")];
  const narrow = fitSignalBadges(signals, SIGNALS_CELL_BUDGET_PX);
  const wide = fitSignalBadges(signals, 400);
  assert.equal(wide.overflowCount, 0, "a generous budget must fit every real-world signal combo");
  assert.ok(wide.visible.length >= narrow.visible.length);
});
