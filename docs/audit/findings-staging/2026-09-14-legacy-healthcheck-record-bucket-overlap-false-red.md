> **kind:** FINDING

## The Legacy healthcheck's own record-consistency check double-counted the documented unfilled/pulled overlap, producing a false RED on healthy production data — FIXED

| **Status** | FIXED (PR fix/legacy-healthcheck-record-bucket-overlap) |
|---|---|

**Root cause.** `verdictForRecord` (`scripts/audit/lib/legacy-healthcheck-eval.mjs`, Stage C of
`legacy-e2e-healthcheck.mjs`) verified the live `/api/market/nighthawk/record` segment's own
bucket counts summed to its reported `resolved` total, by flatly adding
`wins + losses + opens + ambiguous + unfilled + pulled + stop_data_unavailable`.

`unfilled` and `pulled` are **documented as overlapping by design** —
`analytics.ts`'s `NighthawkRecordSegment` type doc comment states it explicitly: *"Rows whose
outcome is 'unfilled'. OVERLAPS `pulled` — see `excluded_total`."* A play can legitimately be
both pulled AND never filled. That same type ships `excluded_total` (the disjoint complement of
`scoreable`, guaranteeing `scoreable + excluded_total === resolved` always) and
`unfilled_not_pulled` (the disjoint slice of `unfilled` that sums cleanly alongside `pulled`)
specifically so a consumer never has to guess at the overlap — but the healthcheck's own bucket
check never used either field, and summed the raw overlapping `unfilled` and `pulled` counts
together instead.

**Evidence.** Live-caught today (2026-09-14, 20:36 UTC cycle): the healthcheck flipped `overall`
to RED for the first time this session. Live payload: `resolved=28`, `wins=0, losses=1, opens=16,
ambiguous=0, unfilled=4, pulled=8, stop_data_unavailable=0` — flat sum = 29, a false overshoot of
exactly 1. Fetching `unfilled_not_pulled` from the same live payload showed `3`, meaning 1 of the
4 "unfilled" rows was ALSO one of the 8 "pulled" rows — exactly the overlap `analytics.ts`'s own
doc comment describes, worked through with a structurally identical example
(`scoreable 27 + unfilled 13 + pulled 12 = 52` against `resolved 50`, "an overshoot of 2"). Using
`unfilled_not_pulled` (3) instead of the overlapping `unfilled` (4) in the sum gives
`0+1+16+0+3+8+0 = 28`, exactly matching `resolved`. The production record endpoint was correct
the whole time; this was a false positive in the audit tooling itself.

**Blast radius.** Contained to `verdictForRecord`. No other stage or file reads `unfilled`/`pulled`
this way. Re-ran the fixed check live against production: `C_record` now reports GREEN
(`resolved=28, buckets sum consistently`) on the exact same live data that produced today's false
RED before the fix.

**Fix rationale.** Read `unfilled_not_pulled` from the segment payload and use it in the sum in
place of the overlapping `unfilled`, falling back to `unfilled` itself when the payload doesn't
carry the field (an older/partial payload shape) — a strict widening that changes nothing for a
non-overlapping read (every pre-existing test, none of which has an overlap, stays GREEN
unmodified). This mirrors `analytics.ts`'s own already-computed, already-documented invariant
rather than re-deriving a new one.

**Severity/impact.** Medium — a false RED in the audit lane's own healthcheck is exactly the kind
of "the fix is broken" misdirection CLAUDE.md's cross-PR-ordering section warns is a strictly more
expensive way to find out something than a half-merged change; this could have led a future cycle
to chase a nonexistent production record-consistency bug instead of recognizing the tooling's own
false positive. No production code or member-facing data was ever wrong.

**Test evidence.** New regression test reproduces today's exact live payload (`resolved=28,
unfilled=4, unfilled_not_pulled=3, pulled=8`, etc.) and asserts GREEN; a second new test confirms
the fallback-to-flat-`unfilled` path still passes for a payload shape without `unfilled_not_pulled`.
RED confirmed pre-fix: the new overlap test failed with the exact live evidence string
(`bucket sum (29) != resolved (28)`). GREEN post-fix: 43/43 in this file. Re-ran the actual
`npm run healthcheck:legacy` against live production post-fix: `C_record` now GREEN on the same
data. `npx tsc --noEmit` clean. Full `npm test` run dispatched separately; see the PR for the
exact pass count.
