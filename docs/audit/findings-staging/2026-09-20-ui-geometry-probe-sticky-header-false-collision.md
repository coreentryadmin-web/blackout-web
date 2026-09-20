> **kind:** FINDING

# Live-UI audit tooling: `ui-geometry-probe.mjs` reported a false "text over control" collision on the sticky matrix-table header on `/vector` (and every other scrollable table using the same `position: sticky` header pattern)

| | |
|---|---|
| **Status** | FIXED — PR opened same session, verified RED→GREEN with a fixture reproducing the live geometry. |
| **Surface** | `scripts/audit/lib/ui-geometry-probe.mjs` (`probeGeometry`'s `layer()` and the COLLIDE loop), shared by `live-ui-interaction-audit.mjs` and `live-ui-deep-audit.mjs`. Tooling only — no application code, no runtime behavior change to the product. |
| **Severity** | P3 (tooling correctness) — no member-facing defect; same class of finding as the just-merged nav-brand fix (#5281), same risk (a false FAIL trains a reader to distrust real findings from this harness). |

## What was found

This cycle re-ran `live-ui-interaction-audit.mjs` against `/vector` (a different desk from
`/heatmap`, per the standing instruction to confirm #5281's fix generalizes and to check for any
other genuine collision the more-accurate tooling might newly surface). It reported:

```
FAIL /vector [desktop]: 4 COLLISION(s) on load
  "Strike" over control "7,675\t-$34.2M"
  "Strike" over control "7,670 ♛\t+$613.4M"
  "GEX · Δ%" over control "7,675\t-$34.2M"
```

Traced to `src/features/vector/components/VectorOdteMatrixRail.tsx` (the GEX/VEX matrix rail): a
scrollable `<table>` with a `position: sticky; top: 0; z-index: 10` `<thead>` (opaque
`bg-[#08080e]`) over a `<tbody>` whose rows carry `role="button"` (`onStrikeFocus`, clickable
strike rows). The component's own `useLayoutEffect(resetToSpot, …)` scrolls the spot-price row
into view on every mount/ticker/expiry change, which routinely lands a row directly beneath the
sticky header. A **fixture reproducing this exact structure** (`ui-geometry-probe.test.mjs`)
confirms the probe reported the header's own text as colliding with whichever row scrolled
nearest the top — a sticky table header legitimately painting over the content scrolling beneath
it, which is the entire point of a sticky header, not a layout defect.

This is the same false-positive *class* #5281 just fixed (an element that is supposed to visually
sit on top of something else gets flagged as fighting it for space), one layer down the CSS
stacking model: #5281 excluded `position: fixed` vs non-fixed pairs; `position: sticky` was never
given the same treatment.

## Root cause

`layer()` classified an element's containing block only as `fixed` / `absolute` / everything-else
("floating"); `position: sticky` fell through to "everything else" (non-floating, non-fixed), so a
sticky `<thead>`'s header text and a plain `<tbody>` row were treated as two ordinary page
elements sharing pixels by accident — exactly the "peers fighting for the same space" case the
COLLIDE loop is designed to flag — rather than as an intentional overlay-over-content pairing, the
same designation `fixed` already gets:

```js
if (s.position === "fixed") fixed = true;
if (s.position === "static") continue;
if (!seen) {
  floating = s.position === "absolute" || s.position === "fixed";   // sticky excluded
  ...
}
```

`hiddenByScroll()` does not catch this case: it excludes rows that have scrolled *entirely out* of
their scrollport, but a row sitting directly under a sticky header is still genuinely on-screen and
inside the scrollport — it just happens to render beneath a second, later-painted layer. That is a
real, different geometric situation from "scrolled away," and the probe's own comment already
names the scrolled-away version of this exact matrix rail as a previously-fixed false-positive
class — this is the case `hiddenByScroll` was never meant to (and cannot) cover.

## Fix

- `layer()` now also tracks a `sticky` flag (any ancestor with `position: sticky`, mirroring how
  `fixed` is tracked) and folds `sticky` into the `floating` classification alongside
  `absolute`/`fixed`.
- The COLLIDE loop gets one more early-exit, directly beside the existing `fixed`-parity check:
  `if (tLayer.sticky !== cLayer.sticky) continue;` — a sticky ancestor vs. a non-sticky one is an
  intentional overlay (header docking over scrolled content), not a collision candidate. Only a
  sticky-vs-sticky pair (two things genuinely pinned to the same scrollport) is still eligible to
  be flagged, matching the existing fixed-vs-fixed precedent (the iOS tool-label/hamburger defect
  #5281's own comment describes).

Both changes are scoped to the shared geometry-probe file only — no application code touched, no
change to what a member sees or how the product behaves.

## Evidence

- **Before (fix reverted):** a standalone repro script mirroring `VectorOdteMatrixRail`'s real
  structure (sticky `<thead>`, `role="button"` rows, scrolled so a row sits under the header)
  reported 2 collisions via `probeGeometry` — reproducing the exact `"Strike" over control
  "7680\t-$12.4M"` pattern seen live.
- **After (fix applied):** same repro reports `collide: []`.
- New regression tests added to `ui-geometry-probe.test.mjs`:
  1. `"a sticky table header is not reported as colliding with a row scrolled beneath it"` —
     GREEN post-fix (RED pre-fix, matching the repro above).
  2. `"two sticky peers sharing the same pixels are still a real collision"` — negative control:
     two independently `position: sticky` elements genuinely overlapping each other still report
     exactly 1 collision, proving the fix narrows the exclusion to sticky-vs-non-sticky pairs
     rather than blinding the detector to sticky elements outright.
  3. Both pre-existing nav-brand tests (from #5281) still pass unchanged.
  All 4 tests in the file: `4 pass / 0 fail`.
- `npx tsc --noEmit`: clean.
- Live re-check: `live-ui-interaction-audit.mjs --pages=/vector` on `main` before this fix
  reproducibly reported the 4 collisions above; the fixture-level RED→GREEN is the regression
  evidence (a second live run against prod is redundant once the fixture reproduces the exact live
  geometry and passes post-fix).

## Blast radius

`ui-geometry-probe.mjs` is shared by `live-ui-interaction-audit.mjs` and `live-ui-deep-audit.mjs`.
Any scrollable table/list with a `position: sticky` header anywhere in the product benefits, not
just Vector's matrix rail — e.g. the GEX depth ladder (`depth-ladder-ui-audit.mjs`'s own subject)
uses the same sticky-header-over-scrolling-rows pattern and would have been equally susceptible
the next time the interaction/deep-UI audits swept it. No other predicate changes behavior — this
is purely an additional exclusion in the COLLIDE path's layering logic, symmetric with the
existing `fixed` handling.

## Fix rationale

Mirrors #5281's fix shape deliberately: same file, same kind of "an intentional overlay read as an
accidental collision" bug, same layering-based fix (add the new position value to the existing
peer-vs-overlay distinction rather than inventing a new heuristic), and a negative-control test so
the exclusion is proven narrow rather than blanket. No alternative considered seriously — widening
`hiddenByScroll()` to also catch this case would conflate two genuinely different geometric
situations (fully off-screen vs. on-screen-but-behind-a-later-layer) that the codebase already
treats as distinct, and would weaken the CLIPPED-vs-COLLIDE separation the file's own header
comment explains.
