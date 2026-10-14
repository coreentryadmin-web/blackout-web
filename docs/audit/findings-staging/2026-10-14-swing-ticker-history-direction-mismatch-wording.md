> **kind:** FINDING

## Swing play-brief "Ticker history" coaching implies direction/archetype comparability it doesn't have — FIXED

| | |
|---|---|
| **Component** | `src/lib/swing/play-brief-narrative-coaching.ts` (`tickerHistoryCoaching`), `src/lib/swing/play-brief-ticker-history.ts` (`loadTickerTrackRecord`, `SwingTickerTrackRecord`) |
| **Status** | FIXED — this PR |

**Root cause.** `tickerHistoryCoaching` cites a ticker's plain closed-trade win/loss count
("INTC is 0W / 4L across 4 prior closed trades") with the fixed sentence "the desk hasn't found
an edge on this exact name yet; weigh that against the current setup." That sentence reads as a
judgment about the *current setup type* (today's direction), but the underlying count
(`loadTickerTrackRecord`) is direction-blind — it counts every resolved prior chain on the ticker
regardless of whether it was LONG or SHORT, or what archetype it traded under.

**Live repro** (raised on PR #4076, comment 6151970308, 2026-10-13 18:05 UTC): `SWING:INTC:56`
(today's play LONG, Event-driven directional) cited a 0W/4L record. Of the 4 prior closed INTC
chains: 2 were SHORT (the literal opposite directional bet) and the only archetype match was also
the opposite direction. **Zero of the 4 prior trades shared both direction and archetype with the
play under review**, yet the narrative implied the desk specifically lacks an edge on *this kind*
of INTC trade. A SHORT loss says nothing about whether a LONG thesis on the same ticker works.

**Fix.** `loadTickerTrackRecord` now additionally returns `directions` — each cited chain's own
entry-leg direction (`SwingLegGrade.direction` off `buildSwingRecord`'s first leg; a roll keeps the
same directional thesis, so the first leg is representative). `tickerHistoryCoaching` compares
every cited direction against the reviewed play's own `direction`:
- All cited chains share the play's direction → original wording stands ("the desk hasn't found an
  edge on this exact name yet").
- Any mismatch → softened wording naming the actual mix, e.g. *"INTC is 0W / 4L across 4 prior
  closed trades (mixed long/short) — not all directly comparable to today's LONG setup."* or
  *"(all short) — not all directly comparable to today's LONG setup."*

Only the WORDING changes — the win/loss count itself is untouched (still a plain factual count per
the module's own Largo C6 discipline; this is a Largo C9 precision fix, not a confidence/graduation
change). `directions` is optional on `SwingTickerTrackRecord` so a caller/fixture that predates the
field (none exist outside this module and its own tests) falls back to the original wording rather
than crashing.

**Evidence.** `src/lib/swing/play-brief-narrative-coaching.test.ts`: 4 new tests — all-opposite
direction (softened + names "all short"), mixed long/short (softened + names "mixed long/short"),
all-same-direction (original wording stands), and `directions` omitted (fallback, never crashes).
Confirmed RED→GREEN via `git stash` on the two source files: the two direction-mismatch tests fail
against the pre-fix source with the exact live symptom (`"the desk hasn't found an edge..."`
appearing where the softened wording should), and pass once restored.
`src/lib/swing/play-brief-ticker-history.test.ts`: existing `loadTickerTrackRecord` tests updated
to assert the new `directions` field (additive to their existing assertions, same fixture data —
the `row()` helper already defaults to `direction: "long"`, so only the 2-chain aggregation test
needed a genuine mixed-direction fixture tweak to also cover the new field meaningfully).
`npx tsc --noEmit` clean.

**Blast radius.** Two files touched: `play-brief-ticker-history.ts` (adds one optional field to the
return type, computed from data already fetched — no new DB read) and
`play-brief-narrative-coaching.ts` (`tickerHistoryCoaching`, the only consumer of the new field).
`tickerTrackRecordSection` (`play-brief-intel.ts`, the standalone "Ticker track record" section)
and the evidence-array citation (`play-brief.ts`) both read only `ticker`/`wins`/`losses`/
`priorClosedTrades` and are unaffected by the additive field.

**What was deliberately left unchanged.** The win/loss count and sample-size wording are untouched
— this is purely a comparability-framing fix. No minimum-sample/graduation gate was added (the
module's own header already establishes this is a plain count, not a calibrated score needing
Largo C6 graduation); adding one here would be a separate, larger design change out of scope for
this fix.
