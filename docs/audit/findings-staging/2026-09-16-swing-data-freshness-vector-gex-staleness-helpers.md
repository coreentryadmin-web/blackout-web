> **kind:** FINDING

## Ask Largo "Data freshness" section reimplemented partial staleness checks instead of the shared helpers — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **Lane** | Night Hawk Swings — Ask Largo |
| **Severity** | P3 (narrative correctness / internal consistency, same shape as the just-shipped #5069 Largo C2 fix) |
| **File** | `src/lib/swing/play-brief-intel.ts` — `dataFreshnessSection` |

### Root cause

`dataFreshnessSection`'s Vector-age and GEX-age lines each reimplemented a raw comparison
against a field the codebase already has a shared, tested staleness helper for
(`vectorAgeStale` / `gexMatrixStale`, both in `play-brief-absence.ts`), and both reimplementations
missed a case the shared helper handles correctly:

1. **Vector**: `if (vec?.dataAgeMs != null && vec.dataAgeMs > 120_000)` then
   `` `${Math.round(vec.dataAgeMs / 1000)}s` ``. `vec.dataAgeMs` is stamped
   `Number.POSITIVE_INFINITY` by `withReadContext()` on future clock skew — `Infinity > 120_000`
   still trips the branch, but `Math.round(Infinity / 1000)` is `Infinity`, so the template
   literal renders the string **"Vector data \*\*Infinitys\*\* old"**. Separately, a `null`
   `dataAgeMs` (unparseable `asOf`) skipped the line entirely even when `vec.freshness === "stale"`
   or a parseable `vec.asOf` would correctly flag it via `vectorAgeStale`'s own fallback paths —
   a silent omission the shared helper doesn't have.
2. **GEX**: `if (gexAgeMs != null && gexAgeMs > GEX_MATRIX_STALE_MS)`. A future-skewed
   (negative) `gexAgeMs` reads as `false` here — silently "fresh" — while the shared
   `gexMatrixStale` helper explicitly fails closed on `ageMs < -WS_TIMESTAMP_FUTURE_TOLERANCE_MS`
   (the exact guard `gexMatrixStale` already applies at every other call site in this same file:
   lines 429/458/706/765/802/1213).

This is the same root-cause shape as the just-shipped #5069 (Largo C2, `optionMarkIsStale`):
a shared, already-tested staleness helper exists in `play-brief-absence.ts` and is used correctly
elsewhere in this same file, but one narrative line reinvented its own partial version instead of
calling it.

### Evidence

Two RED tests (failed against the pre-fix code, `git stash` proven):
- `dataFreshnessSection: future-skewed Vector dataAgeMs (Infinity) renders 'clock-skewed', never the literal 'Infinitys'` — pre-fix rendered `"Vector data **Infinitys** old"`.
- `dataFreshnessSection: null Vector dataAgeMs still flags staleness via vec.freshness` — pre-fix rendered no Vector line at all (section still non-null from other lines, but this specific caveat silently missing).
- `dataFreshnessSection: future-skewed GEX matrix age fails closed instead of silently reading as fresh` — pre-fix rendered no GEX line at all for a `matrix_age_sec: -500` fixture.

All three fail pre-fix, pass post-fix; full `src/lib/swing/*.test.ts` suite: 1198/1198 pass; `tsc --noEmit` clean.

### Blast radius

Single function, single file (`dataFreshnessSection`). No other call site duplicates this specific
comparison — `gexMatrixStale`/`vectorAgeStale` are already the correctly-used helpers everywhere
else in `play-brief-intel.ts`; this was the one narrative line that didn't call them.

### Fix rationale

Replace both raw comparisons with the shared boolean helpers (`vectorAgeStale`, `gexMatrixStale`)
to gate whether the line renders at all — matching every other staleness check in this file — while
keeping the raw age value only for the seconds label, falling back to a `"clock-skewed"` label when
the raw age is non-finite or negative (future-skewed) rather than rendering a nonsensical number.
`GEX_MATRIX_STALE_MS` import was removed as it became unused once the raw `>` comparison was
replaced by the helper call.

### Tests

`src/lib/swing/play-brief-intel.test.ts` — 3 new tests, all passing; full swing suite 1198/1198.
