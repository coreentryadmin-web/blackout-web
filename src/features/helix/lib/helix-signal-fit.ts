import { HELIX_TABLE_COLUMNS } from "@/features/helix/lib/helix-table-columns";
import type { HelixFlowSignal } from "@/features/helix/lib/helix-flow-format";

/**
 * How many of a print's signal badges (STACK / NEW x.x× / REPEAT / …) actually fit inside the
 * print tape's fixed-width `signals` cell, so the render layer never emits more markup than the
 * box can show.
 *
 * ── THE BUG THIS REPLACES ───────────────────────────────────────────────────────────────────────
 * The tape used to render `signals.slice(0, 3)` unconditionally — a COUNT cap with no notion of
 * pixel width — plus a trailing `+N` chip for the remainder. `.helix-tape-signals` is
 * `flex flex-nowrap … overflow-hidden` with no scroll anywhere in its ancestor chain (confirmed
 * live: every ancestor up to `.helix-tape-scroll` reports `scrollWidth === clientWidth`), so
 * anything past the cell's right edge is not scrolled, wrapped, or ellipsized — it is hard-clipped
 * mid-glyph by the box boundary. Three real badges plus a `+N` chip routinely do not fit in the
 * `signals` column's ~136px floor (8.5rem, see `HELIX_TABLE_COLUMNS`) minus the cell's own 20px of
 * horizontal padding: on a reproduced row (`STACK` / `NEW 4.2×` / `REPEAT` / `+1`), only `STACK`
 * and `NEW 4.2×` rendered whole and `REPEAT` painted as a single clipped `R` — with the `+1` chip
 * present in the DOM's text content but never visually painted at all.
 *
 * ── THE FIX ──────────────────────────────────────────────────────────────────────────────────────
 * Estimate each badge's rendered width from its label (JetBrains Mono is a fixed-advance font, so
 * this is a per-character constant, not a guess) and greedily keep only as many badges — most
 * important first, `flowSignals` already orders the list that way — as fit inside the column's
 * FLOOR width (the CSS `minmax()` floor is a hard minimum the grid track can never render
 * narrower than, so budgeting against it is safe at every viewport/density the tape supports,
 * unlike the grown/actual width which varies with desk layout). Whenever any badge is dropped, a
 * `+N` chip sized the same way is reserved BEFORE it is promised — so the chip itself never
 * becomes the next thing to clip.
 *
 * The estimate is intentionally conservative (rounds character/chrome width up): a false negative
 * here means one fewer badge shown than the real box could physically fit, which is a wasted pixel
 * or two — not a defect. A false positive is the bug being fixed, so precision is traded away from
 * that side. See `helix-signal-fit.test.ts` for the reproduced-row regression proof.
 */

/** `.helix-tape-signal`: `px-1.5` (12px) + `border` (2px, box-sizing: border-box). */
const BADGE_CHROME_PX = 15;

/** JetBrains Mono `text-[9px]` advance width (~0.6em) plus `tracking-wider` (0.025em) at 9px,
 *  rounded up from ~5.63px/char so the estimate stays conservative rather than exact. */
const BADGE_CHAR_PX = 5.8;

/** `.helix-tape-signals`: `gap-1` (4px) between badges, including before the `+N` chip. */
const BADGE_GAP_PX = 4;

/** `.helix-tape-cell`: `px-2.5` = 10px each side = 20px of horizontal padding around the signals
 *  flex row, subtracted from the column's own floor width to get the row's true content budget. */
const SIGNALS_CELL_PADDING_PX = 20;

function signalsColumnFloorPx(): number {
  const col = HELIX_TABLE_COLUMNS.find((c) => c.id === "signals");
  // Guard against the column ever being renamed/removed out from under this — fall back to the
  // floor as measured live (2026-09) rather than silently budgeting against zero.
  const rem = col ? parseFloat(col.width) : 8.5;
  return Number.isFinite(rem) ? rem * 16 : 8.5 * 16;
}

/** The signals cell's usable content width, in px, at its narrowest (floor) rendered state. */
export const SIGNALS_CELL_BUDGET_PX = signalsColumnFloorPx() - SIGNALS_CELL_PADDING_PX;

/** Estimated rendered width (px) of one signal/overflow pill for the given label text. */
export function estimateSignalBadgeWidthPx(label: string): number {
  return BADGE_CHROME_PX + label.length * BADGE_CHAR_PX;
}

export type SignalBadgeFit<T extends { label: string }> = {
  /** Badges to actually render, in the original order — always a prefix of the input. */
  visible: T[];
  /** Count to show in the trailing "+N" chip. 0 means every badge fit and no chip is needed. */
  overflowCount: number;
};

/**
 * Pick the longest PREFIX of `signals` (order carries priority — see `flowSignals`) that fits,
 * together with a correctly-sized "+N" chip for whatever is left over, inside `budgetPx`.
 *
 * Checked as whole rows (not badge-by-badge) so the reserved "+N" chip always reflects the REAL
 * overflow count for the row actually chosen, not a guess made mid-scan.
 */
export function fitSignalBadges<T extends { label: string }>(
  signals: readonly T[],
  budgetPx: number = SIGNALS_CELL_BUDGET_PX
): SignalBadgeFit<T> {
  const n = signals.length;
  if (n === 0) return { visible: [], overflowCount: 0 };

  const widths = signals.map((s) => estimateSignalBadgeWidthPx(s.label));

  function rowWidthPx(k: number): number {
    if (k <= 0) return 0;
    let sum = 0;
    for (let i = 0; i < k; i++) sum += widths[i];
    return sum + BADGE_GAP_PX * (k - 1);
  }

  for (let k = n; k >= 0; k--) {
    const overflow = n - k;
    const overflowWidth = overflow > 0 ? BADGE_GAP_PX + estimateSignalBadgeWidthPx(`+${overflow}`) : 0;
    if (rowWidthPx(k) + overflowWidth <= budgetPx) {
      return { visible: signals.slice(0, k), overflowCount: overflow };
    }
  }
  // Unreachable in practice (k=0 always totals 0 <= any non-negative budget), kept for type safety.
  return { visible: [], overflowCount: n };
}

/** Re-exported so callers that only need the type don't have to reach into helix-flow-format. */
export type { HelixFlowSignal };
