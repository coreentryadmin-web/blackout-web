> **kind:** FINDING

## Vector standalone desk: `VectorChart` rendered with no per-pane error boundary — FIXED

**Status:** FIXED — PR (this branch), `fix/vector-pageshell-chart-error-boundary`.

### Root cause

`VectorPageShell.tsx`'s standalone `/vector` desk (`chartBlock`) rendered `<VectorChart>`
completely bare — no error boundary around it. A render-time throw inside `VectorChart` (a
malformed live payload reaching an overlay that assumes a shape, a charting-library edge case)
propagates up uncaught and is only caught by the app-level route error boundary
(`src/components/route-error-boundary.tsx`, wired via `app/(site)/error.tsx`), which unmounts the
**entire** `(site)` route segment — toolbar, side rails, everything — not just the chart.

This exact failure mode is already solved, and documented, for Vector's Compare mode:
`VectorCompareDesk.tsx` wraps each pane in `VectorPaneErrorBoundary`
(`src/features/vector/components/VectorPaneErrorBoundary.tsx`), whose own header comment states
the problem plainly: *"Without this, an uncaught render error thrown by ANY one pane … unmounts
the entire `(site)` route segment via the app-level error boundary, taking the other (working)
panes and the desk chrome down with it."* The boundary's `onRemove` prop is explicitly typed
optional with the comment *"the single-pane desk has nothing to remove"* — the component was
designed with dual-use (Compare mode AND the standalone desk) in mind from the start, but was
only ever actually wired into Compare mode. The standalone desk — Vector's primary, highest-
traffic view — never got it.

### Evidence

Confirmed via direct inspection: `VectorPageShell.tsx`'s `chartBlock` (the JSX block rendered on
the standalone page) rendered `<VectorChart ... />` with zero wrapping, while
`VectorCompareDesk.tsx`'s per-seed render wraps `VectorComparePane` in
`<VectorPaneErrorBoundary key={seed.ticker} ticker={seed.ticker} onRemove={...}>`. Grepped every
`VectorPaneErrorBoundary` import repo-wide — exactly one consumer (`VectorCompareDesk.tsx`) before
this fix.

### Blast radius

Only the standalone desk's `chartBlock` (line ~853) was fixed. `VectorPageShell.tsx` has a
**second** bare `<VectorChart>` call site — the `chartOnly` embed branch (line ~729), used by the
SPX Slayer flagship desk (`src/features/spx/`, an owned lane). That embed shares the identical gap
but was deliberately left untouched in this PR to keep the change small and avoid touching
anything that renders on an owned-lane page without that lane's own sign-off — flagging it here so
a future pass (ideally coordinated with the SPX/owned lane) can apply the same fix there.

### Fix rationale

Reused the existing, already-proven `VectorPaneErrorBoundary` component exactly as designed —
no new component, no new pattern, purely wiring an existing safety net into its second intended
call site. `onRemove` is omitted (matches the component's own documented single-pane case).
Added a source-level regression test (`VectorPageShell-chart-error-boundary.test.ts`) following
this repo's established convention for structural guarantees that don't need a full render
(no React Testing Library here) — asserts the import exists and `chartBlock`'s `VectorChart` is
wrapped. RED→GREEN proven via a temp-file swap of the pre-fix source (not `git stash`, per this
session's own standing avoidance of stash on the shared sandbox): the pre-fix shape fails the new
test, the fix passes it. Full Vector component suite (94/94) passes unchanged; lint and
`tsc --noEmit` clean.
