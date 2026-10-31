> **kind:** FINDING

## Public GEX snapshot hid a wrong-side gamma wall instead of honestly labelling it — FIXED

**Area:** `src/lib/public-gex-snapshot.ts` (the `/tools/gamma-snapshot` free lead magnet +
homepage promo, `HomeGammaPromo`/`HomeLiveDeskStrip`/`GammaSnapshotWidget`).

| **Status** | FIXED |
|---|---|

### Root cause

`buildSnapshotFromHeatmap` (the builder behind `buildPublicGexSnapshot`) computed
`constrainedCallWall`/`constrainedPutWall` — nulling `heatmap.gex.call_wall`/`put_wall` outright
whenever the wall landed on the "wrong" side of spot (a call wall at/below spot, a put wall
at/above it) — and fed those nulled values into `classifyWall`, `correctPublicRead`, and the
response's own `call_wall`/`put_wall` fields.

This directly undoes the design this same file already documents at length. `classifyWall` and
`correctPublicRead` (`public-gex-snapshot-types.ts`) exist specifically to handle a wrong-side
wall: their own doc comments cite a real production measurement (2026-08-12, SPX spot 7748.5,
put wall 8000 above it) and state the intended behavior in so many words — *"The number is right.
Calling it 'support' is what's wrong"* — i.e. degrade the LABEL to `"concentration"` while still
showing the real strike. Nulling the wall before it ever reaches `classifyWall` instead hides the
number entirely, which is the exact "the wall vanishes" failure #2128 ("honest wall labels") was
written to fix — just reintroduced one layer up, by a later, unrelated commit (#2832, "Apply
client-side wall constraint") that didn't account for the labelling mechanism already in place.

The regression was invisible to the existing test suite because every `classifyWall`/
`correctPublicRead` test calls those functions directly with raw wall values — none of them went
through `buildSnapshotFromHeatmap`/`buildPublicGexSnapshot`, so nothing ever exercised the
nulling that sat in front of them. The `"concentration"` branch was fully correct and fully
unreachable through this file's own public entry point at the same time.

### Evidence

Added `src/lib/public-gex-snapshot-wall-side.test.ts`, mocking `fetchGexHeatmap` to return the
exact documented scenario (spot 7748.5, `call_wall: 7490` — below spot, `put_wall: null`) and
calling the real `buildPublicGexSnapshot("SPX")`.

- **RED (pre-fix, confirmed via `git stash` on `public-gex-snapshot.ts` alone):**
  `snapshot.call_wall === null` and `snapshot.call_wall_role === null` — the member/visitor sees
  a bare `"—"` on the UI tile with no indication a wall even exists there.
- **GREEN (post-fix):** `snapshot.call_wall === 7490` (the real number, preserved) and
  `snapshot.call_wall_role === "concentration"`; the regime `read` no longer asserts
  `"Resistance 7,490."` (a level on the wrong side of spot) and instead reads the honest
  single-wall fallback `correctPublicRead` already had wired for exactly this case
  ("...isn't acting as a level.").
- A second case confirms the fix does **not** fabricate a wall that was never in the source data:
  with `put_wall: null` from the heatmap, the snapshot's `put_wall`/`put_wall_role` both stay
  `null` — this is strictly a labelling fix, never an invented level.

Full suite run clean: `npx tsx --experimental-test-module-mocks --test` across every
`public-gex-snapshot*.test.ts`, the homepage gamma seed test, and `HomeGammaPromo`/
`HomeLiveDeskStrip` tests (all pass, 0 regressions). `tsc --noEmit` clean.

### Blast radius

Single call site: `buildSnapshotFromHeatmap` is the only producer of `PublicGexSnapshot.call_wall`/
`put_wall`/`call_wall_role`/`put_wall_role`/`read` for this surface. Every consumer of the public
snapshot inherits the fix automatically — `/tools/gamma-snapshot` (`GammaSnapshotWidget.tsx`), the
homepage promo (`HomeGammaPromo.tsx`, `HomeLiveDeskStrip.tsx`), and the `GET /api/public/gex-snapshot`
route. No change to the authenticated/member Thermal matrix, GEX heatmap route, or any other
consumer of `fetchGexHeatmap` — those never passed through this file.

### Fix rationale

Removed the redundant, behavior-changing re-constraint and pass `heatmap.gex.call_wall`/`put_wall`
through unmodified to `classifyWall`/`correctPublicRead`/the response fields — trusting the
labelling mechanism this file already built and documented for exactly this situation, instead of
duplicating (and silently defeating) it with a cruder null-out.

This is a no-op for the live happy path: a freshly-computed matrix already has its walls
side-constrained at the SOURCE (`wallsFromStrikeTotals(strikeTotals, spot)` inside
`computeGexRegime`, `polygon-options-gex.ts`), so `heatmap.gex.call_wall`/`put_wall` can't actually
arrive inverted from a fresh build today. What the fix restores is correctness for the case the
removed code was nominally guarding against — a stale/cached heatmap, or any future regression at
the source that re-introduces an inverted wall — which would previously have silently hidden the
level instead of honestly labelling it as the file's own design says it should.

Left unchanged: the `heatmap.gex.call_wall`/`put_wall` computation itself (server-side,
`polygon-options-gex.ts`, out of scope here), `roundFloats` wrapping, and every other field on the
snapshot.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PzDkDzjR3bJQsFbXENzsVz
