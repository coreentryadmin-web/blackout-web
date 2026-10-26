> **kind:** FINDING

## Three `type="number"` inputs silently change value on an accidental page scroll — FIXED

**Status:** FIXED — PR #TBD

### Root cause

A browser's `<input type="number">` captures the `wheel` event by default while focused —
scrolling the page (or a scrollable panel) with the cursor sitting over the input silently
increments/decrements its value by one `step`, instead of scrolling the page. This is a
well-known, real browser footgun, not theoretical: it fires from an ordinary mouse-wheel scroll
gesture, with zero special action from the user.

Three number inputs in non-owned (Vector/Helix) code had no guard against this:
- `VectorAlertsPanel.tsx` — the wall-touch alert's tolerance-percent input, inline in a panel
  that can scroll as alerts are added.
- `VectorTimeframeSelect.tsx` — the custom chart-interval-minutes input, next to a dropdown.
- `HelixTickerAlertToggle.tsx` — the minimum-premium-threshold input inside a small popover.

Every other interactive surface in this repo that needs wheel-event handling (the chart's own
zoom/pan `wheel` listener in `VectorChart.tsx`) is deliberate and scoped; these three number
inputs simply never had the one-line guard applied.

### Evidence

`grep -rn 'type="number"' src/` found exactly these three non-owned call sites, none with an
`onWheel` handler. Confirmed each sits inside a plausibly-scrollable or adjacent-to-scroll
surface (an alerts panel, a dropdown-adjacent custom field, a popover), not an isolated static
page where a scroll-while-hovering would be impossible.

### Fix rationale

Added `onWheel={(e) => e.currentTarget.blur()}` to all three — the minimal, standard fix: blurring
on wheel makes a scroll always scroll (focus leaves the input, so the wheel event falls through
to the page/ancestor scroll container) instead of mutating the value. `VectorTimeframeSelect.tsx`
already had an `onBlur` that commits/normalizes the draft value, so blurring via wheel correctly
still commits whatever value was already typed — it only stops an *accidental scroll* from
silently changing that value in the first place.

Added `src/features/vector/components/number-input-wheel-guard.test.ts`: a source-grep test (same
convention as `Modal.test.ts`/`MembershipActivatingBanner.test.ts`) asserting every
`type="number"` input in each of the three files has exactly one matching `onWheel` blur guard —
so a future number input added to any of these files without the guard fails loudly.

RED→GREEN proven via a temp-file swap (not `git stash`): removing the guard from one file fails
1/3 tests; restoring it passes 3/3. `npx eslint`/`npx tsc --noEmit` clean; full
`src/features/vector/components/*.test.ts` + `src/features/helix/components/*.test.ts` suite
(141 tests) passes.
