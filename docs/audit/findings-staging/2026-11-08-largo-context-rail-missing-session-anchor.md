> **kind:** FINDING

## Largo contextual rail (`/api/market/largo/context`) stamped `as_of` with no ET session anchor

| | |
|---|---|
| **Status** | FIXED |
| **Area** | `src/app/api/market/largo/context/route.ts` (the "CONTEXTUAL RAIL" — the per-ticker live-object sidebar Largo keeps on screen during a follow-up chain) |
| **Severity** | P3 (data-completeness / Largo C1 contract gap, not a crash) |
| **Round** | 431 |

### Root cause

The route's GET handler stamped its top-level response with a bare UTC instant and nothing else:

```ts
as_of: new Date().toISOString(),
```

This file was already listed as an open gap in the Largo C1 session-anchor ratchet
(`src/lib/largo/contract/session-anchor.test.ts`'s `KNOWN_GAPS`), flagged in that file's own
triage comment as one of two entries that "assemble MODEL-facing payloads" (the other being
`/api/admin/bie-report`, out of scope here — hard-excluded this round).

Per the contract's own docblock: after ~20:00 ET the UTC *calendar date* is already tomorrow, so
any consumer resolving "today's session" purely from `as_of`'s own date reads a full session
ahead for the last ~4 hours of RTH — the same inversion class fixed in #2418/#2420/#2422 and, this
session, in #7593/#7595/#7596/#7597/#7598.

This route's own docblock makes the stakes explicit: the rail exists so a follow-up answer in a
conversation chain never *disagrees* with what the member is already looking at ("IT MUST NEVER
DISAGREE WITH THE ANSWER, which is the entire engineering problem"). A client that derives "what
session is this rail describing" from `as_of`'s bare UTC date, during the last ~4 hours of RTH,
would disagree with Largo's own ET-anchored answer for exactly the reason this contract exists.

### Evidence (RED → GREEN)

Reverting the route fix alone (with the `KNOWN_GAPS` entry for this file already removed) fails
two tests:
- the new regression test in `src/app/api/market/largo/context/route.test.ts` (asserts the
  `etSessionDate` import and the `nowMs`-derived `as_of`/`session_date` pair are both present);
- `session-anchor.test.ts`'s own "no NEW Largo payload stamps a UTC instant without an ET session
  anchor" guard, naming `src/app/api/market/largo/context/route.ts` as the offender.

Restoring the fix: all 8 subtests across both files pass clean (`8 pass / 0 fail`).
`tsc --noEmit` is clean project-wide.

### Blast radius

Single call site — `src/app/api/market/largo/context/route.ts` has exactly one literal response
construction (its `GET` handler). No other file in the repo references this route path by string
(checked via repo-wide grep for `largo/context`), so this is a self-contained fix with no sibling
construction sites to chase, unlike the `platform-context.ts`/`index.ts` pair in #7598.

### Fix rationale

Additive per the contract's own rule: `as_of` is unchanged byte-for-byte (still
`new Date(nowMs).toISOString()`, same instant, just bound to a named `nowMs` so the two fields
can never describe different moments), a new `session_date` field is added anchored to that exact
same `Date.now()` instant via the shared `etSessionDate()` helper
(`@/lib/largo/temporal/bar-session-date`), and the now-closed `KNOWN_GAPS` entry (plus the stale
triage comment naming this route as still-open) is removed. Same mechanical pattern as the five
prior C1 fixes this session (#7593/#7595/#7596/#7597/#7598) — no alternative considered.
