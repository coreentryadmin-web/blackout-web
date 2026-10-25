## 2026-10-25 — [FINDING, P1 Night Hawk Swings / Ask Largo] Every Banger-origin committed SWING row served `thesisLevel:"intact"` from the raw API regardless of real P&L — three downstream guards each patched their own consumer, none patched the source — FIXED

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **Area** | Night Hawk Swings horizons board API — `src/lib/swing/banger-lane-merge.ts`'s `horizonPlayFromBangerPosition()` |
| **Found by** | Ask Largo × Night Hawk Swings standing ownership mandate — parallel correctness sweep, 2026-10-25 |

### Symptom

Live repro, `GET /api/market/nighthawk/horizons?view=swings` on 2026-10-25: `WEN` positionId 2098,
`status: "COMMIT"`, `serving: "MANAGING"`, `thesisLevel: "intact"`, `thesisNote: "below the 2× partial
and above the hard stop"`, `livePnlPct: -58.3`, `entryPremium: 0.06`, `peakPremium: 0.06` (never once
exceeded entry). 22 of the 90 live Banger-origin committed+watch rows showed `thesisLevel: "intact"`
at `livePnlPct < -20%`. A member reading the raw board — or Ask Largo answering a question off this
exact field — sees a green "thesis intact" claim on a position down more than half its value.

### Root cause

`horizonPlayFromBangerPosition` stamps `thesisLevel: "intact"` as a fixed literal on **every** row it
produces — there is no real per-position thesis dossier for this lane at all (a single mechanical
price trigger, per the file's own header comment), so "intact" was never a measured fact, just a
placeholder that happened to read as reassuring.

This exact fabrication has already been independently discovered and guarded against **three times**,
each time at a different downstream consumer rather than the source:
- `play-brief-intel.ts`'s `watchForSection` (fix #5693) — suppresses the narrative sentence.
- `thesis-health.ts`'s `calibratedThesisPillars` — omits the whole pillar breakdown when `regime`
  carries the Banger sentinel.
- `features/nighthawk/command-deck/adapters.ts`'s `thesisBreakResolved` (PR #6671, merged earlier
  **today**) — forces `level: "unknown"` for the Command Deck's own React rendering.

All three key off `regime === BANGER_LEDGER_REGIME_LABEL` and all three run *after* this function —
the Command Deck's guard in particular runs client-side (`"use client"`) on an already-fetched JSON
payload, so it can filter what gets *rendered* but cannot retroactively fix what the API itself
already *returned*. `GET /api/market/nighthawk/horizons?view=swings`'s raw HTTP response — read
directly by any API consumer, Ask Largo's own tooling included — still carried the unguarded
fabricated "intact" literal, because `route.ts` applies only `scopeBoardToHorizon`/`withLane`/
`roundFloats` before responding; none of them touch `thesisLevel`.

### Fix

Changed the literal at the one place it originates: `thesisLevel: "intact"` → `thesisLevel: "unknown"`
in `horizonPlayFromBangerPosition`. `"unknown"` is not a new state — it is the exact value
`serving-ingest.ts` already documents as the honest degrade ("thesisLevel degrades to 'unknown' when
no [dossier] data... NEVER a fabricated 'intact'") and that `ZeroDteCommandPanel.tsx` already renders
correctly (`level === "unknown"` → the real note, or "Thesis monitor unavailable for this play"). The
real mechanical `thesisNote` (e.g. "below the 2× partial and above the hard stop") is kept untouched —
only the fabricated level changes. Every future reader of this route now inherits the honest value for
free, instead of needing its own guard — fixing the source once, rather than the fourth downstream
consumer in a recurring pattern.

### Blast radius

Checked every other reader of `thesisLevel`/`horizonPlayFromBangerPosition` repo-wide
(`play-brief-narrative.ts` only branches on `level === "break"`; `serving-lane.ts` only passes the
field through or deliberately omits it elsewhere, unrelated to this path). The three existing guards
all key on the `regime` sentinel, not on `thesisLevel`'s value, so they are unaffected and remain in
place as defense-in-depth.

### Tests

`src/lib/swing/banger-lane-merge.test.ts` — new test
`"horizonPlayFromBangerPosition never fabricates thesisLevel:intact — reports unknown regardless of live P&L"`,
covering both a deeply-underwater row and a green row. Confirmed RED on pre-fix code (`actual: 'intact'`)
via `git stash`, GREEN after the fix. Full `src/lib/swing/*.test.ts` (2043 tests) and
`src/features/nighthawk/command-deck/*.test.ts` (459 tests) both pass; `npx tsc --noEmit` clean.
