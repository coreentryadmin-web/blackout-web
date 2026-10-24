## Largo swing play-brief: duplicate "Vector desk state"/"Vector state" unavailable-source entries — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED |
| **Area** | Ask Largo swing play-brief (`src/lib/swing/play-brief-absence.ts`) |
| **Found by** | Ask Largo fan-out audit (8-ticker parallel workflow, adversarially verified), 2026-10-24, live repro UMAC |

### Symptom

UMAC's live swing play-brief envelope's `confidence.why` read "9 sources unavailable this cycle (..., Vector desk state, ..., Vector state, ...)" — `unavailableSources[]` carried BOTH entries, both `reason: "fetch failed"`, with near-synonymous `what_is_missing` wording ("a Vector desk-state snapshot from the vector service" vs "the standalone Vector desk-state read for this ticker"). Both describe the exact same single fact (no live Vector read succeeded, from either the standalone fetch or the `ecosystem.vector_full_state` fallback) — the true distinct-gap count was 8, not 9.

### Root cause

`collectBriefUnavailableSources()` had two independent pushes keyed off the same `ctx.vectorFetchFailed` flag:
- An unconditional one (added 2026-10-18, PR #6145, "CLOSED-brief GEX/Vector race fix"): `if (ctx.vectorFetchFailed) { push "Vector desk state" }` — no check for the ecosystem fallback.
- An earlier, fallback-aware one (added 2026-09-06): `if (ctx.vectorFetchFailed === true && !ctx.vector && !ctx.ecosystem?.vector_full_state) { push "Vector state" }`.

The second condition is a strict subset of the first — every time it fires, the first fires too — so whenever the standalone fetch failed with no fallback, both pushed. The 2026-10-18 addition was made without noticing the pre-existing, more precisely-gated check covering the identical scenario.

### Fix

Added the same fallback guard (`!ctx.vector && !ctx.ecosystem?.vector_full_state`) to the "Vector desk state"/"fetch failed" push, and removed the now-fully-redundant standalone "Vector state" push entirely. "Vector desk state" is now the single source label for this absence, with two distinguishable `reason` values depending on which underlying condition caused it ("snapshot unavailable" when the ecosystem read succeeded but carried no live spot, vs "fetch failed" when the fetch itself failed with no fallback).

### Blast radius

Single file (`play-brief-absence.ts`), two existing tests updated to expect the surviving label (`"Vector desk state"` instead of `"Vector state"`), one new regression test asserting exactly one "fetch failed" entry for this scenario. No other call site referenced the `"Vector state"` label (confirmed by grep).

### Evidence

- RED→GREEN: `git stash` of only `play-brief-absence.ts` fails 2 tests (the updated-label assertion and the new exactly-one-entry regression test); both pass after the fix.
- `npx tsx --experimental-test-module-mocks --test src/lib/swing/play-brief*.test.ts` → 1147/1147 pass (Node 20).
- `npx tsc --noEmit` → clean.
