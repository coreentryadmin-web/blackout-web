> **kind:** FINDING

## Meridian timeline `as_of` had no ET session anchor (Largo C1 known gap) — FIXED

| **Status** | Fixed |
|---|---|
| **Severity** | P2 |
| **Surface** | `GET /api/market/meridian/timeline` (`loadMeridianTimelineResponse`, Meridian desk + any Largo tool that reads the timeline payload) |
| **Root cause** | `as_of` stamped a bare UTC `toISOString()` instant with no ET session anchor |
| **Fix** | Added a `session_date` field anchored to the same instant, via the shared `etSessionDate` helper |

### Root cause

`src/lib/largo/contract/session-anchor.test.ts` enforces Largo contract C1: any Largo-facing
payload that stamps a UTC instant (`as_of`/`asOf` built from `.toISOString()`) must also carry a
real ET session anchor (`etSessionDate(...)` / `etStamp(...)`) alongside it. The test's own header
explains why this matters: a UTC ISO instant is unambiguous for machine ordering, but **after
~20:00 ET the UTC calendar date is already tomorrow** — so a reader (a model, or any consumer)
resolving "what session is this" purely from the UTC date reads a full session ahead for the last
~4 hours of every trading day. Three independent lanes shipped exactly this defect before the test
existed (#2418 OHLC bars, #2420 Helix expiry rows, #2422 Thermal's compare card).

`src/lib/meridian/meridian-snapshot.ts`'s `loadMeridianTimelineResponse` — the function behind
`GET /api/market/meridian/timeline`, which serves the Meridian desk's whole catalyst timeline
(macro/earnings/FDA/OpEx) — was one of the 40 construction sites discovered when the test's `ROOTS`
was widened from `["src/lib/largo","src/lib/bie"]` to `["src"]` on 2026-08-21. It was listed in the
test's `KNOWN_GAPS` allowlist ("meridian lane") as a real, acknowledged work item rather than an
exemption — the allowlist's own doc comment is explicit that an entry is "a real gap and a work
item for its owning lane, NOT an exemption on the merits," and a second test in the same file
(`"the known-gap list SHRINKS"`) exists specifically so a fixed entry doesn't quietly rot into a
permanent exemption.

```ts
return roundFloats({
  as_of: new Date().toISOString(),   // UTC instant, no ET anchor anywhere in the file
  days_ahead: daysAhead,
  ...
```

### Evidence (RED → GREEN)

Removing only the `KNOWN_GAPS` entry (`"src/lib/meridian/meridian-snapshot.ts": "meridian lane"`)
without the code fix reproduces the exact failure the guard exists to catch:

```
$ npx tsx --experimental-test-module-mocks --test src/lib/largo/contract/session-anchor.test.ts
# Subtest: no NEW Largo payload stamps a UTC instant without an ET session anchor
not ok 1 - ...
# tests 6
# pass 5
# fail 1
```

With the code fix restored (and the allowlist entry removed for good), the full suite is clean:

```
# tests 6
# pass 6
# fail 0
```

(Verified by `git stash push -- src/lib/meridian/meridian-snapshot.ts`, re-running the test to
observe the RED failure, then `git stash pop` to restore the fix and re-confirm GREEN.)

### Blast radius

Single call site: `loadMeridianTimelineResponse` is the only place in the repo that builds the
`MeridianTimelinePayload.as_of` field (checked via `grep -rn "as_of: new Date"` scoped to the
Meridian lane, and via the session-anchor scanner's own repo-wide walk, which found no sibling
offender in `src/lib/meridian/*` or `src/features/meridian/*`). The payload is served verbatim as
JSON by `GET /api/market/meridian/timeline` with no schema validation in between, and consumed by
`MeridianDesk.tsx` and (per the Largo capability registry's own test comment) `get_meridian_peer_cohort`'s
cohort lookup — both read the object loosely, so adding a field is purely additive and does not
require changes to either consumer.

### Fix rationale

Per the test's own doc comment, the fix is deliberately **additive**: "keep the instant, add the
ET session date" — `toISOString()` is not banned, a real anchor beside it is required. `as_of` is
left byte-for-byte unchanged (still a UTC ISO string, still parseable by every existing consumer)
and a new `session_date: string | null` field is added, anchored to the exact same `nowMs` instant
so the two fields can never describe different moments. The shared `etSessionDate` helper
(`@/lib/largo/temporal/bar-session-date`) is the same one eight other sites in the repo already use
for this identical `session_date: etSessionDate(nowMs)` pattern (`flow-service.ts`,
`zerodte/session-phase.ts`, `largo/contract/cross-product-read.ts`, `largo/gate-rules.ts`,
`largo/vector-analytics.ts`, `largo/product-reads.ts` ×2, and an admin route) — no second
derivation was invented. `MeridianTimelinePayload`'s type definition was extended to match so the
field is typed, not just present at runtime. `roundFloats` (the response-shaping wrapper the
payload already passes through) only rounds numeric leaves, so the new string field passes through
untouched.

### Verification

- `npx tsc --noEmit` — clean (no errors in `meridian-snapshot.ts`, `meridian-types.ts`, or
  `session-anchor.test.ts`).
- `npx tsx --experimental-test-module-mocks --test src/lib/largo/contract/session-anchor.test.ts` —
  6/6 pass.
- `npx tsx --experimental-test-module-mocks --test` over every `*.test.ts` under `src/lib/meridian`
  and `src/features/meridian` — 610/610 pass (no regression from the new payload field).
- Full `npm test` run in the background; will report status separately.
