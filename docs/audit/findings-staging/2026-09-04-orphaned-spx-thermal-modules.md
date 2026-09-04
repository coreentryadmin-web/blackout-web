## 2026-09-04 — [FINDING, P3 dead code] Six modules across SPX/Thermal/marketing had zero importers anywhere in the repo — two unfinished features, three superseded components, one dead helper — REMOVED

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **Priority** | P3 — dead code, no behavior change, no member-visible effect |
| **Surface** | `src/features/spx/{hooks,lib}/`, `src/features/thermal/components/`, `src/components/{landing,learn}/` |
| **Status** | FIXED |

### Root cause

A dead-code sweep across `src/lib/{meridian,helix,vector,largo,nighthawk}/` had already run clean
this session; `src/features/{spx,thermal}/` and `src/components/` had not been swept. A basename+
export grep across the whole tracked tree (careful to search for the bare identifier, not the
filename with extension, to avoid false positives from Next.js's own file-based routing) found six
files with genuinely zero importers anywhere — not in a component, a route, a barrel re-export, or
a test:

- `src/features/spx/hooks/useSpxDayPerformance.ts` — a `useSWR`-backed hook computing "today's SPX
  win rate" off the live `/api/market/spx/outcomes` route (same route the public track-record page
  reads). Fully implemented, correctly typed, never called — no card was ever built to show it.
- `src/features/spx/lib/spx-sniper-backdrops.ts` — names `SPX_SNIPER_BACKDROP`, one of four shipped
  `/spx-sniper/*.webp` hero images (`vivid-neon`; `bg-winter`/`bg-sunset`/`bg-night` are unreferenced
  by any code), and emits `spx-sniper-tint-{buy,sell,watch,hold,scan}` CSS classes that are defined
  nowhere in the stylesheet — even wired up today it would render completely unstyled.
- `src/features/spx/lib/spx-session-phase.ts` — `spxSessionPhase()`, doc-commented "for commentary +
  BIE composers"; neither of those calls it.
- `src/features/thermal/components/ThermalFreshnessBar.tsx` — **superseded**, not abandoned:
  `ThermalTripleDesk.tsx` grew its own inline `ThermalMatrixFreshnessChip`, which renders only the
  Matrix chip — a strict subset of what `ThermalFreshnessBar` showed (Matrix + overlays + cross-val
  + wall-scope label). Nothing was ever pointed back at the fuller original.
- `src/components/landing/LandingBackdrop.tsx` — **superseded** by `StaticLandingBackdrop.tsx`
  (same layered-aurora idea, minus the framer-motion loops it itself notes were a GPU cost);
  `PricingBackdrop.tsx`'s own doc comment references it only to contrast itself against it.
- `src/components/learn/LearnPageShell.tsx` — **superseded**: `/learn/layout.tsx`'s own comment
  says it explicitly "drops the inner LearnPageShell/PageShell" to avoid a duplicate
  `<main id="main">` once `/learn` moved under the marketing group's shell.

The oldest (SPX/Thermal) date to the original `#684` "modular monolith feature folders" commit; the
newest (`LandingBackdrop`) to `#1210`. Long-standing dead weight, not a recent regression — `tsc`,
lint, and every existing test are silent on an unimported file, because nothing about one fails a
build.

### Evidence

RED→GREEN via a new `repo-hygiene.test.ts` assertion (`"known-orphaned modules stay removed"`)
checking the six paths are not `git ls-files`-tracked:
- **RED** (files present, pre-fix): `AssertionError` — all paths present in `tracked()`.
- **GREEN** (post-`git rm`): all 5 `repo-hygiene.test.ts` assertions pass.

`npx tsc --noEmit` clean before and after (confirming no type-only import my grep missed). Full
`npm test` on Node 20: 12214/12222 pass both before and after this diff — the 5 pre-existing
failures reproduce identically with none of this change applied, confirming this diff does not
cause or fix any of them (see the PR description for their names).

### Fix

Removed all six files (`git rm`). Left the three unreferenced `/spx-sniper/*.webp` public assets
alone — deleting static assets is a separate, lower-value, marginally riskier cleanup than removing
dead TypeScript, and out of scope here. Corrected one stale doc-comment in
`src/features/thermal/lib/thermal-desk-state.ts` that cited `ThermalFreshnessBar` by name as the
canonical example of the "resolve the clock in an effect" pattern — repointed it at
`ThermalMatrixFreshnessChip` in `ThermalTripleDesk.tsx`, which now carries that exact pattern.

### Blast radius

Searched the whole tracked tree for every exported symbol from all six files — the only other hits
were the prose comments already named above (each explaining non-use, never an import) and the
now-corrected `thermal-desk-state.ts` doc-comment. `thermalLayerFreshness`/`wallScopeLabel` (the
freshness-computation helpers `ThermalFreshnessBar` imported) are NOT dead —
`ThermalMatrixFreshnessChip` and `thermal-desk-state.test.ts` both use them directly — so only the
wrapper component was removed, not its live dependencies. Same check for `StaticLandingBackdrop`
(confirmed live, mounted by `MarketingPageShell.tsx`) and `PageShell` (confirmed live, widely used)
— removing `LandingBackdrop`/`LearnPageShell` does not touch either.

### What was deliberately NOT done

**Not wiring up `useSpxDayPerformance`.** It is a real, working capability someone built and never
shipped — a "today's SPX win rate" stat could be a genuine small product enhancement — but deciding
where it belongs on the desk, whether it duplicates an existing power-hour/lotto panel, and what it
should look like is a product/design call, not something to build unilaterally inside a dead-code
cleanup. Flagged for a future scoped enhancement PR if wanted.

**Not removing `src/components/ScrollProgressBar.tsx`, the same class of zero-importer orphan found
in the same sweep.** `FINDINGS.md` already carries a 2026-08-30 entry
("`ScrollProgressBar.tsx` is a fully-built, never-wired-in component") that deliberately flagged it
rather than removing it — "a real, non-trivial, UI-facing component... the call belongs to whoever
owns the landing page, not to an unattended sweep" — and left it **OPEN, no code change**, for that
owner to decide wire-in vs. delete. That decision has not been made since. Overriding a prior
lane's explicit "flag, don't act" call with a fresh unilateral deletion would be worse than leaving
it alone; this entry re-surfaces the still-open finding rather than re-deciding it.

**Not touching `src/components/render/DealersLadderBackground.tsx` (624 lines).** Same
sweep, same "flag, don't act" category, and it turns out this one was *already* independently
checked in the 2026-08-30 sweep too — that entry explicitly contrasted it against `ScrollProgressBar`
and concluded it should NOT be flagged as dead code, because it "carries an explicit design-intent
comment block ('the ONE sanctioned ambient loop in the motion system') that reads as an
intentionally built-ahead, documented extension point." Independently re-derived the identical
conclusion this session before finding that prior entry: a fully-built, extensively-documented
WebGL shader hero (hand-written fragment shader rendering the live gamma book — strike-ladder rungs,
gamma beads, integrity rings, CRT afterglow, dark-pool substrate — with `prefers-reduced-motion`
fallback, DPR capping, IntersectionObserver pause-when-offscreen, full teardown on unmount; `git log`:
`feat(marketing): WebGL "Phosphor Ladder" shader hero — the live dealer's gamma book`, #891) with
zero live references anywhere. Left untouched, consistent with the standing prior call.
