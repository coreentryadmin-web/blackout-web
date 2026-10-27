> **kind:** `FINDING`

## Mobile `/api/mobile/ticker/[ticker]` always served `nearestWall: null` — the vocabulary it compared against never matched the source payload — FIXED

| | |
|---|---|
| **Severity** | P3 (dead field in a mobile-only contract — no financial-correctness impact, no data corruption, but a real, silent "feature does nothing" defect on every request) |
| **Surface** | `src/app/api/mobile/ticker/[ticker]/route.ts` — the native iOS Watchlist row detail-sheet endpoint |
| **Status** | FIXED |

### Root cause

The route derives its mobile-facing `levels.nearestWall` field from `GexPositioning.nearest_wall`
(`src/lib/providers/gex-positioning.ts`), whose `kind` is typed — and always populated, via the
shared `nearestWallFromLevels` helper in `src/lib/providers/gex-nearest-wall.ts` — as
`"resistance" | "support"`. The route instead compared the raw value directly against the mobile
contract's own output literals:

```ts
const kind: "call" | "put" | null =
  nw?.kind === "call" || nw?.kind === "put" ? nw.kind : null;
```

`nw.kind` is never the string `"call"` or `"put"` — it is always `"resistance"` or `"support"` (or
absent). So this comparison can never match, `kind` is always `null`, and the `nearestWall` field
of the response (`nearestWall` requires `kind !== null` to be non-null) was unconditionally `null`
for every ticker, on every request, regardless of whether the backend genuinely had a nearest wall
with a real strike and distance. The native iOS Watchlist detail sheet's "nearest wall" UI element
was silently dead from the moment this route shipped — no error, no degraded flag, nothing to
distinguish it from "this ticker genuinely has no computable nearest wall" (which is a real, valid
state elsewhere in the same payload, e.g. when both `call_wall`/`put_wall` are null). This is the
same absence-as-fact failure shape this repo's CLAUDE.md records repeatedly elsewhere — a dead
field reading identically to a legitimately-empty one.

There is no test file for this route at all prior to this fix (`src/app/api/mobile/ticker/`
contains only `route.ts`), so nothing caught the mismatch.

### Evidence

New `src/app/api/mobile/ticker/[ticker]/route.test.ts`, three tests:

- A `nearest_wall: { strike: 590, kind: "resistance", distance_pts: 10 }` fixture (the call wall is
  nearer) — asserts the response's `levels.nearestWall` equals
  `{ strike: 590, kind: "call", distancePts: 10 }`.
- A `nearest_wall: { strike: 576, kind: "support", distance_pts: -4 }` fixture (the put wall is
  nearer) — asserts `{ strike: 576, kind: "put", distancePts: -4 }`.
- A `nearest_wall: null` fixture — asserts `nearestWall` stays `null` (the genuinely-absent case is
  unaffected by the fix).

RED→GREEN confirmed via `git stash` of just the route fix (keeping the new test file in place):
**before the fix**, 1/3 pass — both resistance/support fixtures fail with `actual: null` where
`{strike, kind, distancePts}` was expected (the null-case test, which doesn't depend on the broken
comparison, already passed). **After the fix**, 3/3 pass.

### Blast radius

`nearest_wall`'s `kind` vocabulary (`"resistance" | "support"`) is shared by every other consumer
of `GexPositioning`/`nearestWallFromLevels` (Thermal, Vector, the public gamma-snapshot tool,
`play-brief.ts`) — none of those compare it against `"call"`/`"put"` literals; this mobile route
was the only call site translating it to a different vocabulary, and the only one that got the
translation backwards. No other file references this route's local `kind` variable or its
`MobileTickerDetail` type outside `route.ts` itself (verified by grep), so the fix is fully
contained to this one file.

### Fix

Map the source vocabulary explicitly instead of literal-matching it: `"resistance"` strikes are
always the call wall (`nearest_wall`'s own doc comment and `nearestWallFromLevels`'s candidate
construction: the `call_wall` candidate is always tagged `"resistance"`, `put_wall` always
`"support"`), so `nw.kind === "resistance" ? "call" : nw.kind === "support" ? "put" : null`.

### Fix rationale

Translating the vocabulary (rather than, say, renaming the mobile contract's `kind` to
`"resistance" | "support"` to match the source) keeps the mobile app's existing `call`/`put`
labels — which already match every other field in this same payload (`levels.callWall`,
`levels.putWall`) — intact; this is purely a backend bug fix with zero mobile-client-side change
required.

### Tests

`src/app/api/mobile/ticker/[ticker]/route.test.ts` (new file, 3 tests, all pass post-fix).
`npx tsc --noEmit` clean repo-wide.
