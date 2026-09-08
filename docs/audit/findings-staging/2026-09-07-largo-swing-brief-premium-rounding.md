# Ask Largo swing brief showed contradicting per-contract premiums in one document — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P2-largo-swing-brief-premium-rounding |
| **Priority** | P2 |
| **Area** | Ask Largo / Night Hawk Swings play brief (`src/lib/swing/play-brief-narrative.ts`) |
| **Status** | FIXED |

## Symptom

Live-fetched `GET /api/market/swing/play-brief?playId=SWING:NRG&ticker=NRG&status=COMMIT&positionId=34`
(2026-09-07, market closed/holiday, so Vector spot was unwired for the tick) rendered the SAME
underlying option-premium fields with two different values in one document:

- **Position** section: `Mark: **+$9.70**` (precise, from `play-brief.ts`'s own 2-decimal `fmtUsd`).
- **Trade manager read** section, same brief: `**Live read** — ... mark **$10**.` (rounded to a
  whole dollar, no sign) — the SAME `play.mark` field, rendered from a different formatter.
- Same section: `**Break watch** — lose premium stop **$2** → cut size or exit.` while the
  **Management** section two headings earlier printed `Rails: stop +$1.96 · target +$9.80` from
  the identical `exitPolicy.stop_premium` field.

A member reading top-to-bottom sees two different numbers for one fact, in the same answer — the
Largo product contract's **precision** point, violated within a single envelope.

## Root cause

Two independent `fmtUsd` helpers exist in the swing play-brief code:
- `play-brief.ts`'s `fmtUsd` — signed, 2-decimal (`+$9.70`) — correct for a per-contract option
  premium, where cents are a large fraction of the number.
- `play-brief-narrative.ts`'s `fmtUsd` — unsigned, whole-dollar/k/M scaled (`$${n.toFixed(0)}`,
  `$344k`, `$1.2M`) — built for FLOW/aggregate dollar amounts (HELIX premium, dark-pool notional),
  which are routinely in the hundreds-of-thousands-to-millions range where whole-dollar precision
  is the right call.

`degradedReadLine`'s "Live read" mark bullet and the `stop_premium` fallback "Break watch" bullet
(both in `tradeManagerNarrativeSection`) reused the narrative file's flow-scaled `fmtUsd` for a
per-contract premium instead — so a $9.70 mark became "$10" and a $1.96 stop became "$2", each
silently disagreeing with the precise value the Position/Management sections render from the exact
same field via the OTHER `fmtUsd`. `railsFallback`'s stop/target line (used when `breakTrigger`'s
price-level path doesn't apply) had the identical bug.

## Blast radius

Same root cause, same file, three call sites all using per-contract premiums through the
flow-scaled formatter:
- `degradedReadLine` — `markBit` (`play.mark`).
- `tradeManagerNarrativeSection`'s `stop_premium` fallback — both the LONG ("lose premium stop")
  and SHORT ("reclaim") branches.
- `railsFallback` — `stop_premium`/`target_premium` ("Manage rails — stop … · target …").

## Fix

Added `fmtOptionUsd` (2-decimal, signed — matches `play-brief.ts`'s `fmtUsd` exactly) in
`play-brief-narrative.ts` and switched the three premium call sites above to it. Left the
flow/aggregate call sites (`fmtUsd` for HELIX tape, dark-pool level/premium) untouched — those
correctly want whole-dollar/k/M scaling. Deliberately did not touch `play-brief.ts`'s formatter
or import one file's helper into the other — same semantics, kept as a small local function per
file (matching the existing pattern) rather than introducing a new shared module for one function.

Regression test: `src/lib/swing/play-brief-narrative.test.ts` — extended
`"tradeManagerNarrativeSection: degraded read when spot missing"` to assert the mark and
stop-premium bullets render the exact precise value (`+$2.45`, `+$1.96`), and updated
`"tradeManagerNarrativeSection: SHORT break watch uses stop_premium not target"` (previously
asserted the OLD rounded `$4` for `stop_premium: 3.5` — now asserts the precise `+$3.50`).
Confirmed RED pre-fix (`git stash` on `play-brief-narrative.ts` alone) / GREEN post-fix.

## What to check at next market open

Fetch a live OPEN swing play brief (any committed position with a fresh Vector tick, e.g. via
`/api/market/swing/play-brief?playId=...&positionId=...`) and confirm the mark/stop/target dollar
figures agree byte-for-byte across the Position, Management, and Trade-manager-read sections —
they should now always match since they're the same field through the same formatter.
