> **kind:** FINDING

## Play-brief lane-wide sweep: "Last snapshot (~Ns old)" narrative pattern rendered garbage on clock-skewed ages in 6 more call sites — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **Lane** | Night Hawk Swings — Ask Largo |
| **Severity** | P3 (narrative correctness — same shape as #5069/#5070) |
| **Files** | `src/lib/swing/play-brief-intel.ts` (4 call sites), `src/lib/swing/play-brief-narrative.ts` (1), `src/lib/swing/play-brief-narrative-coaching.ts` (1 Vector functional gap + 1 GEX display), `src/lib/swing/play-brief-absence.ts` (new shared helper) |

### Root cause

After #5070 fixed `dataFreshnessSection`'s Vector/GEX age lines, a deliberate sweep of the rest of
`src/lib/swing/*.ts` for the same anti-pattern (`Math.round(ageMs / 1000)` applied to a raw
millisecond age without checking whether the gate that decided "stale" also fails closed on
non-finite/negative ages) found **six more instances**, all sharing the identical root cause:

- `chartTechnicalsSection` (play-brief-intel.ts) — Vector, `Infinity` render risk.
- `vectorDeskSection` (play-brief-intel.ts) — Vector, `Infinity` render risk.
- `gexPostureSection` (play-brief-intel.ts) — GEX, negative-number render risk.
- `meridianCatalystSection` (play-brief-intel.ts) — Meridian, negative-number render risk.
- `dealerPostureLine` (play-brief-narrative.ts, via `tradeManagerNarrativeSection`) — Vector,
  `Infinity` render risk.
- `dataHonestyCoaching` (play-brief-narrative-coaching.ts) — Vector: not even gated on the shared
  `vectorAgeStale` helper (identical functional gap to #5070's pre-fix `dataFreshnessSection`:
  `if (vec?.dataAgeMs != null && vec.dataAgeMs > 120_000)` misses both the `Infinity` render and
  the null-with-`freshness:"stale"` silent-omission case). GEX in the same function was already
  correctly gated on `gexMatrixStale` but still had the negative-number display risk.

All six are the "Last snapshot (~Ns old)" / "warns Ns stale" narrative pattern, all downstream of
the same two provider behaviors already documented in #5070: Vector's `dataAgeMs` is stamped
`Number.POSITIVE_INFINITY` on future clock skew (`withReadContext()`), and GEX/Meridian ages can
be genuinely negative (future-skewed `as_of`/`matrix_age_sec`).

### Fix rationale

Rather than patch six call sites with six more one-off inline fixes (which is exactly how the
pattern proliferated to six copies in the first place), added one shared helper —
`ageSecondsLabel(ageMs)` in `play-brief-absence.ts` — and switched every call site to it:
returns `` `${Math.round(ageMs / 1000)}s` `` for a finite non-negative age, `"clock-skewed"` for
non-finite or negative, `null` for `null`/`undefined` (so the optional-suffix callers can omit the
parenthetical entirely, matching their pre-existing behavior for the harmless null case).
`dataHonestyCoaching`'s Vector check was additionally re-gated on the shared `vectorAgeStale`
helper (was previously a raw, ungated comparison) to close the functional gap, not just the
display gap.

### Evidence

7 new RED→GREEN tests (one per call site, plus a paired null-with-freshness-stale test for
`dataHonestyCoaching`), plus 4 direct unit tests for `ageSecondsLabel` itself. All fail against
the pre-fix code (`git stash` proven), all pass post-fix. Full `src/lib/swing/*.test.ts`: 1209/1209
pass. `tsc --noEmit` clean.

### Blast radius

Confirmed via `grep` across `src/lib/swing/` for the `Math.round(.*ge.*\/\s*1000)` shape — six
call sites found and fixed, none missed. `v2/gates.ts` and `legacy-calibration/gates-pr5.ts` have
superficially similar `Math.round(age / 1000)` patterns but those ages are always
non-negative-by-construction quote-freshness deltas (not Vector's Infinity-on-skew field or a
provider `as_of` that can be genuinely future-skewed), so they're a different shape and out of
scope here.

### Tests

`src/lib/swing/play-brief-intel.test.ts`, `play-brief-narrative.test.ts`,
`play-brief-narrative-coaching.test.ts`, `play-brief-absence.test.ts` — 11 new tests total, all
passing. Full `src/lib/swing/*.test.ts`: 1209/1209.
