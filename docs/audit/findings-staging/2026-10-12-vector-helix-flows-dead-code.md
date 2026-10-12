## 2026-10-12 — [FINDING, P4 dead-code] Two orphaned pieces in Vector's Helix-rail filter lib — FIXED
> **kind:** `FINDING`

| **Area** | **Severity** | **Status** |
|---|---|---|
| Vector desk / Helix rail lib | P4 — dead code, no runtime impact | FIXED |

**What's wrong.** `src/features/vector/lib/vector-helix-flows.ts` carried two genuinely dead
pieces, both left behind by earlier, already-shipped UI simplifications:

1. **`vectorLiveHelixSubtitle()`** — zero callers anywhere outside its own test. The sibling
   component test, `VectorHelixRail.test.ts`, already asserts the component source does **not**
   reference it (a regression guard dated 2026-08-27, title "verbose section/header qualifier text
   removed", quoting operator feedback: *"remove extra wordings on Helix rail... that's it"*). The
   subtitle line was cut from the UI; the now-orphaned lib function that built its text was never
   deleted.
2. **`VectorHelixFlowFilters.whalesOnly`/`.dteOnly`** — both permanently `false` in production.
   `git log -S whalesOnly -- VectorHelixRail.tsx` confirms commit `f3f71e976` ("Helix rail shows
   major prints only, not full tape") deliberately removed the UI toggles that used to flip these.
   Confirmed live: `VectorHelixRail.tsx`'s only `setFilters()` call site changes `typeFilter`
   only — `whalesOnly`/`dteOnly` can never become `true` in production, so the two filter branches
   in `sideAndFlagsFilter()` were unreachable dead branches.

**What was deliberately NOT touched.** `VECTOR_HELIX_WHALE_PREMIUM` stays — confirmed it's still a
real, live export, used by `VectorHelixRail.tsx:63` for the rail's own whale badge (`isWhale =
flow.premium >= VECTOR_HELIX_WHALE_PREMIUM`), unrelated to the removed filter field that shared its
name.

**Fix.** Deleted `vectorLiveHelixSubtitle()`. Removed `whalesOnly`/`dteOnly` from
`VectorHelixFlowFilters`, `VECTOR_HELIX_DEFAULT_FILTERS`, and `sideAndFlagsFilter()`.

**Test changes.** `vector-helix-flows.test.ts`: removed the `vectorLiveHelixSubtitle` test and the
now-removed `VECTOR_HELIX_WHALE_PREMIUM` import; replaced the whales+0DTE-exercising assertions in
"filterVectorHelixFlows" with a plain type-filter test, since `filterVectorHelixFlows` is still a
real, exported function that still needs coverage for the field that remains (`typeFilter`).
`VectorHelixRail.test.ts` left untouched — its `doesNotMatch(src, /vectorLiveHelixSubtitle/)`
assertion still correctly guards the component, now trivially (the name no longer exists anywhere
to accidentally re-import).

**Verification.** `tsc --noEmit` clean. Full Vector feature test suite:
`npx tsx --experimental-test-module-mocks --test $(find src/features/vector -name "*.test.ts" -o
-name "*.test.tsx")` — 1404/1404 pass.

**Blast radius.** `vector-helix-flows.ts` + `vector-helix-flows.test.ts` only. No change to
`VectorHelixRail.tsx` or any other consumer — confirmed `VectorHelixFlowFilters` has exactly one
constructor site in the whole repo.

Found via a background Explore-agent sweep of Vector desk components, independently re-verified
(confirmed zero outside callers via grep, the deliberate git-history removal of the UI toggles that
used to set these fields, and that `VECTOR_HELIX_WHALE_PREMIUM` remains genuinely live elsewhere)
before fixing.
