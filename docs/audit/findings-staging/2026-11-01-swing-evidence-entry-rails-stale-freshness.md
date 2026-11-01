> **kind:** FINDING

## Ask Largo `evidenceFromContext` Entry/Exit-policy-rails facts stamped with read-time freshness instead of commit-time — FIXED

| | |
|---|---|
| **Area** | Night Hawk Swings / Ask Largo (`src/lib/swing/play-brief.ts`, `evidenceFromContext`) |
| **Severity** | P3 (freshness/provenance correctness — a `BieEvidence` fact self-contradicts a sibling fact from the identical commit) |
| **Status** | FIXED |
| **Found by** | Standing Ask Largo × Night Hawk Swings ownership mandate — deep-dive workflow `wf_dde7f6a4-a27`, 2026-11-01, adversarially verified |

### What was broken

For a COMMIT/OPEN swing position, `evidenceFromContext()` emitted the `"Entry: $X."` fact and the
`"Exit-policy rails: stop $X · target $Y."` fact with `provenance: { asOf: ctx.asOf, freshness:
"recent" }` **unconditionally** — the brief's read time, not the position's `committedAt` — even
though `play.entry` and `play.exitPolicy.stop_premium`/`target_premium` are frozen values written
once at commit (`entryPremium: row.entry_premium`, `banger-lane-merge.ts`) and never recomputed on
a later read.

This is the exact bug class the sibling `"Setup score"` evidence fact (same file, immediately
above) was fixed for on 2026-10-25 — anchoring `asOf`/`freshness` to `committedAt` instead of
`ctx.asOf` — but that fix was never extended to the Entry/Exit-policy-rails facts, added in the
same file on the same date for the identical reason.

Live-confirmed via the swing play-brief for CC (positionId 2320, committed 2026-10-30 16:15 ET,
brief read 2026-11-01 15:42 ET): the envelope carried, side by side, for the **same commit event**:

```
{text:"Setup score: 62 (Discovery gain +62).", provenance:{asOf:"2026-10-30 16:15 ET", freshness:"stale"}}
{text:"Entry: $0.60.",                          provenance:{asOf:"2026-11-01 15:42 ET", freshness:"recent"}}
{text:"Exit-policy rails: stop $0.24 · target $1.20.", provenance:{asOf:"2026-11-01 15:42 ET", freshness:"recent"}}
```

A two-session-old frozen entry/stop/target was overstated as freshly reconfirmed — the "stale
timestamp presented as fresh" defect class this audit watches for.

### Root cause

Only the "Setup score" fact derived `asOf`/`freshness` from `ctx.play.committedAt`
(`committedMs = Date.parse(ctx.play.committedAt)`, then `freshnessFromObservedMs(committedMs,
readMs)`). The Entry fact and Exit-policy-rails fact both hardcoded `asOf: ctx.asOf, freshness:
"recent"` with no `committedAt` derivation at all — a gap the pre-existing regression test never
caught, since it asserted only `.text`/`.provenance?.source`, never `.freshness`/`.asOf`.

### Fix

Factored the `committedAt`-anchored provenance derivation into a shared helper,
`commitTimeProvenance(committedAt, ctxAsOf, readMs)`, and applied it to all three facts (Setup
score, Entry, Exit-policy rails) so they can't independently drift into disagreement again.

### Blast radius

Three call sites, all within `evidenceFromContext` in the same file: the existing "Setup score"
fact (refactored to use the new shared helper, no behavior change) and the Entry/Exit-policy-rails
facts (the actual fix).

### Tests

`src/lib/swing/play-brief.test.ts`: new test "Entry and Exit-policy rails evidence are anchored to
the play's own committedAt, not the brief's read time" — an OPEN position committed 2 real days
before the brief's `asOf`, asserting both facts now cite `committedAt`-derived `asOf` and
`freshness: "stale"`, never the read-time `ctx.asOf`/`"recent"`.

RED→GREEN verified via `git stash push -u -- src/lib/swing/play-brief.ts` (fix only, tests kept):
the new test failed with the exact predicted `asOf` mismatch (`'2026-09-10 16:00 ET'` vs expected
`'2026-09-08 10:00 ET'`); restoring the fix passes all 196 tests in the file. `tsc --noEmit` clean.

### PR

`fix/swing-evidence-entry-rails-stale-freshness`
