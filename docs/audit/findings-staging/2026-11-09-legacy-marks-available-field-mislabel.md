# `legacy-marks/route.ts` reports `available:true` even when every requested OCC's mark fails

> **kind:** `FINDING`

### Summary
`GET /api/market/nighthawk/legacy-marks` (`src/app/api/market/nighthawk/legacy-marks/route.ts`)
hardcoded `available: true` in its response whenever the request's `occs` query string was
non-empty, independent of whether `fetchLegacyOptionMarksServer` actually resolved any mark.
Confirmed live: 9 real OPEN Legacy positions (derived from `GET /api/market/nighthawk/edition`
merged with `GET /api/nighthawk/play-status`) all returned `{"available":true,"marks":[]}` — a
well-formed query with zero resolved marks, reported as "available."

### Root cause
`route.ts`'s only response-construction site for a non-empty `occs` query was
`roundFloats({ available: true, marks })` — `available` meant "a well-formed query was supplied,"
not "a live mark was found." The one existing branch that CAN report `available: false` is the
separate `occs.length === 0` case a few lines above, which is a different question entirely.

### Fix
Changed `available: true` to `available: marks.length > 0` — the field now actually reflects
whether any mark resolved, matching what a reader of the name would expect.

### Blast radius
Grepped the repo for every caller of this route: the only HTTP consumer is
`src/features/nighthawk/command-deck/use-legacy-option-marks.ts`, confirmed to never read
`data.available` at all (it branches on `Array.isArray(data.marks)` + per-row `mark != null`
checks) — so this had **zero live behavioral impact today**, exactly as the probe that found it
assessed. It is a latent footgun for any future consumer (a Largo tool, a new UI surface) that
might naively branch on `available` and be told marks exist when the array is empty. Found by the
same 5-engine live-monitor cycle as the sibling swing-closed-GEX-absence finding (same session
block); the root cause of the zero marks themselves in the live probe is the already-tracked
Polygon `/v3/snapshot` entitlement 403 (CLAUDE.md known issue), not re-reported here.

### Evidence
- RED: 2 of 3 tests in `route.test.ts` fail against pre-fix source (`git stash` of just
  `route.ts`): the existing `roundFloats` assertion (expected the old literal pattern) and the new
  regression test both fail.
- GREEN: 3/3 pass post-fix.
- `npx tsc --noEmit` clean project-wide.

| **Status** | FIXED — this PR. |
