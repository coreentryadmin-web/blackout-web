## `calibratedThesisPillars` still rendered entry_geometry/flow_corroboration as calibrated on Banger-origin rows — the per-pillar filter can't see a whole-row fabrication

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED |
| **Date** | 2026-09-22 |
| **Severity** | P2 (Largo product-contract C6 violation, live and member-reachable via Ask Largo's swing play-brief — the third live instance of this bug class in two same-session cycles) |
| **Surface** | Night Hawk Swings / Ask Largo — `src/lib/swing/thesis-health.ts` |

### Root cause

Third, deepest instance of the bug class PR #5433 and #5434 (both merged this session, same file)
already fixed twice today for the `regime` pillar specifically. Found via a live Ask Largo play-brief
deep audit on AMDL (positionId 1210, a Banger-lane merged row at +395.6% live P&L) immediately after
verifying #5433's fix was working correctly in production.

`horizonPlayFromBangerPosition` (`banger-lane-merge.ts`) stamps `setupState: "TRIGGERED"`,
`entryStatus: "AT_TRIGGER"`, and `signalKinds: ["BANGER"]` as the SAME fixed constants on **every**
`banger_positions` row, regardless of ticker, contract, or price action — identical to how `regime` gets
the stamped `BANGER_LEDGER_REGIME_LABEL` constant. `entryGeometryScore("AT_TRIGGER")` and
`signalScore(["BANGER"])` therefore compute the exact same `currentLabel` ("at trigger" / "BANGER") for
every single Banger-origin position.

`calibratedThesisPillars`'s per-pillar filter (`UNCALIBRATED_MAPPED_LABELS`) only recognizes pillars
whose `currentLabel` matches a *generic-absence* sentinel ("n/a" for entry_geometry, "no signals" for
flow_corroboration) — sentinels that fire when an input is genuinely **missing**. A Banger row's
`entryStatus`/`signalKinds` are not missing — they're **populated with fake constants** — so neither
"at trigger" nor "BANGER" ever matched those sentinels, and the filter kept both pillars, rendering them
as if they were real, position-specific reads. This is the identical "byte-identical fabricated pillar
breakdown across every ticker" defect the 2026-09-15 fix closed for the aggregate score, reopened here
through the 2026-09-21 per-pillar filter, which has no way to see that an entire row — not just one
field — is fabricated.

### Evidence

Live repro: `GET /api/market/swing/play-brief?playId=SWING:AMDL:1210&ticker=AMDL&positionId=1210&expandIntel=1`
(AMDL, positionId 1210) rendered:

```
Aggregate score withheld — not every pillar input is wired for this position yet.

• **Persistence** — scale-out (Δ -10.0 pts)
• **Entry geometry** — at trigger (Δ +0.0 pts)
• **Signal stack** — BANGER (Δ +0.0 pts)
• **Theta budget** — DTE 3 migrate (Δ -3.0 pts)
```

`regime` was correctly absent (#5433/#5434 working as intended), but `entry_geometry` and
`flow_corroboration` rendered as if calibrated — a member reading this brief has no way to tell these
two lines are the same stamped constant every other Banger-origin position also shows.

New regression tests in `thesis-health.test.ts`'s existing Banger-origin describe block: one asserts
`calibratedThesisPillars(bangerLedgerInput)` returns a fully empty array (not just missing `regime`); a
second, trickier case confirms this holds even when a **real**, live `manageAction` (e.g. `TAKE_PARTIAL`)
degrades `persistence`'s label to something real-looking ("scale-out") via `degradeFromManage` — the
underlying setup that action is degrading is still 100% fabricated for a Banger row, so persistence must
be dropped too. RED confirmed via `git stash push -- src/lib/swing/thesis-health.ts` (both new
assertions failed pre-fix). GREEN after restoring the fix.

Full `thesis-health.test.ts`: 19/19 pass. Full `src/lib/swing/` + `src/features/nighthawk/command-deck/`
sweep: 2021/2021 pass. `npx tsc --noEmit`: clean.

### Fix

`calibratedThesisPillars` now checks the `regime` pillar's `currentLabel` FIRST: if it equals
`BANGER_LEDGER_REGIME_LABEL`, the whole row is Banger-origin and the function returns `[]` immediately —
no per-pillar filtering, because for this lane there is no real per-position dossier for ANY pillar
(single mechanical price trigger, per `horizonPlayFromBangerPosition`'s own header comment). Only when
the row is NOT Banger-origin does the general per-pillar sentinel filter run, preserving the
already-correct partial-calibration behavior for genuinely mixed native rows like AAPL (positionId 40).

`play-brief.ts`'s `thesisHealthSection` already has the right fallback for an empty pillar list —
`"Inputs not wired for committed positions — aggregate score withheld; pillar breakdown not shown."` —
so no render-layer change was needed; the fix at the data layer automatically produces the honest,
already-implemented empty-state message for every Banger-origin row.

### Blast radius

One file changed for behavior (`thesis-health.ts`). Every Banger-origin row's play-brief Thesis health
section now shows the honest "not wired" fallback instead of a partial, fabricated-looking pillar list —
this affects the majority of the SWING lane's `MANAGING`/`SCALING_OUT` sections (Banger-lane merged rows
make up most of the ~80+ live positions there). Native rows (AAPL and any future non-Banger-origin
position) are completely unaffected — the short-circuit only fires when the regime sentinel is present.
`play-brief.ts`'s `thesisHealthSection` is the only render call site (repo-wide grep).

### Fix rationale

A row-level check before the per-pillar filter, rather than trying to add MORE sentinel strings to
`UNCALIBRATED_PILLAR_LABELS` for `entry_geometry`/`flow_corroboration` — "at trigger" and "BANGER" are
both LEGITIMATE real values a native position can carry (a genuinely-triggered entry, or a native
position whose sole real discovery signal happens to be BANGER, per the existing "does NOT false-positive
on a NATIVE swing position" test in this same file) — blacklisting those literal strings globally would
wrongly suppress real data for native rows. The regime sentinel is the one unambiguous fingerprint of the
Banger merge path (per its own extensive doc comment), so checking it once and short-circuiting is the
only fix shape that doesn't reintroduce a false-positive risk on native rows.
