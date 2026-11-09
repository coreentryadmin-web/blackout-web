> **kind:** FINDING

## Swing play-brief's stale-quote caveat flattened a 19-minute-old mark and a 73+ hour-old one to the identical phrase on alarm-shaped lines — FIXED

| **Status** | FIXED |
|---|---|
| **Severity** | P3 (severity-calibration gap, not a correctness/hidden-absence violation — honored under the Ask Largo × Night Hawk Swings standing ownership mandate) |
| **Surface** | `src/lib/swing/play-brief-absence.ts`'s `optionMarkStaleCaveat()`, and its two most action-driving call sites: `tradeManagerNarrativeSection()`'s break-watch line and `pnlSection()`'s "executable exit is a total loss" line (`play-brief-narrative.ts`, `play-brief.ts`) |
| **Found by** | Ask Largo × Night Hawk Swings deep-dive, live repro SWING:HLF:2473 |

### Root cause

`optionMarkStaleCaveat()` had exactly one staleness tier (`SWING_OPTION_MARK_STALE_MS`, 18
minutes — a routine missed-refresh-tick bound). Once a quote cleared that bound, every caller got
the identical flat phrase — `" _(stale — same quote Mark flagged above)_"` — regardless of how far
past the bound the quote actually was. Live repro (HLF, during the still-open 2026-11-06/07
Polygon real-time-snapshot entitlement outage this repo's CLAUDE.md already documents) showed the
same brief emitting that identical phrase on two lines of very different weight:

```
"Break watch — stop already breached on the executable side ... → exit or cut size.
 _(stale — same quote Mark flagged above)_"
"Exec P&L: -100.0% (... the executable exit is a total loss) ...
 _(stale — same quote Mark flagged above)_"
```

Both quotes were ~264,780s (~73.5h, 3+ trading sessions) old — not a missed tick, a quote the
system had stopped refreshing entirely — yet the wording gave a trader no way to distinguish that
from a mark 19 minutes past its refresh schedule. This was never a hidden-absence (C2/C3)
violation: `envelope.age_seconds` and the brief's own Data-freshness section already carried the
true age honestly elsewhere. It is a severity-calibration gap in this one caveat's wording, and it
mattered most on exactly the two lines that tell a trader to act ("exit or cut size", "total
loss") — the lines where treating 73 hours of silence the same as 19 minutes of lag is costliest.

### Fix

Purely additive, two layers:
1. A second tier, `SWING_OPTION_MARK_SEVERELY_STALE_MS` (4 hours — comfortably past any single
   missed refresh tick, comfortably short of one ordinary RTH session or an overnight gap) and
   `optionMarkSeverelyStale()`. Once crossed, `optionMarkStaleCaveat()` names the actual elapsed
   span (`severelyStaleAgeLabel()`: `"Nh"` under 48h, `"Nd"` beyond) instead of the flat phrase.
2. A new 4th parameter, `actionable` (default `false` — every pre-existing call site is
   byte-for-byte unaffected). The two alarm-shaped call sites (`tradeManagerNarrativeSection()`'s
   break-watch line, `pnlSection()`'s total-loss line) now pass `actionable: true`, which further
   escalates the wording to explicitly flag the claim as "UNCONFIRMED by live data — do not treat
   it as a current, actionable signal" once a quote is severely stale.

The mild (18-minute) tier's own two return strings are untouched character-for-character — every
existing caller sees identical output until a quote crosses the new, higher 4-hour bar.

### Evidence

New/extended tests in `play-brief-absence.test.ts`, `play-brief-narrative.test.ts`,
`play-brief.test.ts` covering: the severely-stale branch's wording at both `sameContractAsMarkAbove`
values, the `actionable` escalation wording, and that every pre-existing (non-actionable,
mildly-stale) call site's output is unchanged. Full touched-file suite
(`play-brief.test.ts`, `play-brief-intel.test.ts`, `play-brief-narrative.test.ts`,
`play-brief-narrative-coaching.test.ts`, `play-brief-absence.test.ts`, `play-brief-adapter.test.ts`,
1091 tests) passes clean; `npx tsc --noEmit` clean.

### Blast radius

Every other `optionMarkStaleCaveat()` call site besides the two named above keeps its existing
3-argument call (or no 4th argument), so `actionable` defaults to `false` and their output is
unchanged. `optionMarkIsStale()` itself — the mild tier's own gate — is untouched.

### What was deliberately left unchanged

`optionMarkSeverelyStale()` deliberately duplicates `optionMarkIsStale()`'s own guard shape rather
than refactoring into a shared parse helper, so this fix stays additive and the mild tier's
existing behavior is provably untouched. Future skew (a negative raw age) reads as `false`, not
escalated — that is a distinct clock-skew problem the mild tier already handles on its own basis,
and conflating the two would mislabel a clock bug as "this is a 3-day-old quote".
