## Swing thesis-health's uncalibrated-regime detection only recognized the Banger-ledger sentinel — `regimeScore()`'s own "unread" default slipped through on native positions too

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED |
| **Date** | 2026-09-22 |
| **Severity** | P2 (Largo product-contract C6 violation, live and member-reachable via Ask Largo's swing play-brief — fabricated precision presented as calibrated on a NATIVE (non-Banger) position, no capital/gating impact) |
| **Surface** | Night Hawk Swings / Ask Largo — `src/lib/swing/thesis-health.ts` |

### Root cause

This is a second, independently-reachable instance of the exact bug class PR #5433 (merged just before
this one, same file) fixed for the Banger-ledger sentinel — found via the same-cycle live Ask Largo
play-brief deep audit on AAPL position 40 (the lane's one real native open swing chain) immediately
after #5433 landed.

`thesis-health.ts`'s `regimeScore(regime, factors)` has its OWN generic-default fallback, independent of
the Banger-ledger merge path:

```ts
return { commit: score, current: score, label: regime ?? (top ? top.label : "unread") };
```

When a position's `regime` input is `null`/`undefined` AND it has no `factors[0]` to borrow a label from
(both true for AAPL position 40 — a SECTOR_ROTATION archetype committed live-add, `regime: null`,
`factors: []`), the pillar's `currentLabel` becomes the literal string `"unread"` — a genuine, native
"nothing to read" default, structurally the same kind of fabricated-precision case as persistence's
`"unknown"`, entry_geometry's `"n/a"`, or flow_corroboration's `"no signals"`.

`UNCALIBRATED_PILLAR_LABELS` (the shared map both `thesisHealthUncalibrated` and `calibratedThesisPillars`
read from) was, until #5433, `Partial<Record<SwingThesisPillarId, string>>` — ONE default-label slot per
pillar id. #5433 correctly populated `regime`'s slot with `BANGER_LEDGER_REGIME_LABEL`, but that slot can
only ever hold one string, so `"unread"` — which was ALSO never recognized by the code that predated
#5433 (the old separate hardcoded check only ever matched the Banger sentinel, never `"unread"`) —
remained uncaught. The map's single-string-per-key shape structurally could not represent two
independently-triggering defaults for the same pillar.

### Evidence

Live repro: `GET /api/market/swing/play-brief?playId=SWING:AAPL:40&ticker=AAPL&positionId=40&expandIntel=1`
(AAPL, positionId 40, the lane's one real native committed position) rendered:

```
Aggregate score withheld — not every pillar input is wired for this position yet.

• **Persistence** — triggered (Δ +0.0 pts)
• **Entry geometry** — chase risk (Δ +0.0 pts)
• **Regime fit** — unread (Δ +0.0 pts)
• **Theta budget** — 8DTE runway (Δ +0.0 pts)
```

The aggregate was correctly withheld (via `flow_corroboration`'s own real "no signals" default — AAPL's
`signalKinds` is empty this session), but the "Regime fit — unread (Δ +0.0 pts)" bullet rendered as if it
were a calibrated per-position read, carrying a fabricated zero-delta precision, exactly the C6 violation
class `LARGO-PRODUCT-CONTRACT.md` names: *"If a product cannot produce a calibrated score, OMIT the
field... An invented score is worse than nothing."* Confirmed in source: `regimeScore`'s fallback branch
(`thesis-health.ts`), and that `UNCALIBRATED_PILLAR_LABELS.regime` pre-fix held only
`BANGER_LEDGER_REGIME_LABEL`.

New regression test in `thesis-health.test.ts` (isolates the regime pillar specifically — every other
input real/wired): asserts `calibratedThesisPillars(h)` drops the `"market"`-id pillar when `regime`/
`factors` are both omitted. RED confirmed via `git stash push -- src/lib/swing/thesis-health.ts` (test
failed pre-fix — regime pillar survived the filter). GREEN after restoring the fix.

Fixing this also surfaced two PRE-EXISTING test fixtures (`thesis-health.test.ts`'s `"thesisHealthUncalibrated:
false when commit inputs wired"` and `play-brief-narrative.test.ts`'s `"counterThesisLine: calibrated
thesisHealth with a genuinely faded pillar still steelmans it"`) that both omitted `regime` while
asserting the payload was fully calibrated — passing only because of this exact blind spot. Both updated
to wire a real `regime` value, matching what their own test names/assertions claim.

Full `thesis-health.test.ts`: 17/17 pass. Full collateral sweep — every test file in `src/lib/swing/` and
`src/features/nighthawk/command-deck/` (2019 tests across 29 suites): 2019/2019 pass. `npx tsc --noEmit`:
clean.

### Fix

Broadened `UNCALIBRATED_PILLAR_LABELS` from `Partial<Record<SwingThesisPillarId, string>>` to
`Partial<Record<SwingThesisPillarId, string[]>>` — an array of default labels per pillar id, so `regime`
can hold both `BANGER_LEDGER_REGIME_LABEL` and `"unread"` simultaneously. Updated both consuming loops
(`thesisHealthUncalibrated`'s main loop, and `calibratedThesisPillars`'s derived
`UNCALIBRATED_MAPPED_LABELS`) to check array membership (`.includes(...)`) instead of strict string
equality. No other pillar's real values collide with either sentinel string, so this is purely additive —
every other pillar's single-default behavior is unchanged (now expressed as a one-element array).

### Blast radius

One file changed for behavior (`thesis-health.ts`), plus the two pre-existing test fixtures corrected
(not new tests, but existing assertions whose fixtures didn't actually test what their names claimed).
`thesisHealthUncalibrated`'s return value now correctly flips to `true` for any payload whose ONLY
generic default is a native "unread" regime (previously such a payload could read as fully calibrated —
this was a real gap in the aggregate-withhold guard, not just the per-pillar filter, since the old
separate hardcoded check never covered "unread" either). `calibratedThesisPillars`'s per-pillar output
now also drops the regime pillar for this case. `play-brief.ts`'s `thesisHealthSection` is the only render
call site (repo-wide grep) and now correctly omits/withholds the fabricated line in both regime-default
scenarios. Collateral sweep (above) confirms no other caller assumed the old single-string behavior.

### Fix rationale

Same shared-data-layer fix shape as #5433: broaden the one map both functions read from rather than
adding a second bespoke check to either function individually, keeping the two mechanisms unable to
drift apart again. Chose an array (not a second map, not a Set) to keep the existing
`Object.entries`/`Object.fromEntries` derivation pattern intact with a minimal diff. Deliberately left
unchanged: every other pillar's calibrated/uncalibrated classification, and the aggregate-withhold
semantics (still an OR across all pillars, now correctly covering both regime defaults).
