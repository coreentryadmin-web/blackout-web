## 2026-10-21 — [FINDING, swing] `meridianPeerEarningsCoaching` silently omitted the "Earnings peer lens" section for earnings 8-14 days out, inconsistent with its own 7-day-out siblings

> **kind:** `FINDING`

| Field | Value |
| --- | --- |
| **Status** | FIXED |
| **Severity** | P3 (silent absence — a real, in-window catalyst produces no coaching for some tickers but a thin fallback for others carrying the identical unavailable-cohort reason) |
| **Surface** | `src/lib/swing/play-brief-meridian-peer-core.ts` — `meridianPeerEarningsCoaching()` |

### Root cause

The function's own entry gate (`item.days_until > 14` → `null`) accepts any earnings item within a
14-day window, but the baseline "reports in Nd" line — the one piece of content guaranteed not to
depend on `expected_move_pct` or peer-cohort availability — was gated at `item.days_until <= 7`, a
narrower sub-window left over from before the entry gate was widened to 14 days. When an item has no
`expected_move_pct` quoted and an unavailable peer cohort (`peer.available === false`, contributing
nothing from the `if (peer && peer.available)` block), the ONLY source of content for `parts` is that
baseline line. For `days_until` in 8-14, the baseline line never fires, `parts` stays empty, and the
function returns `null` — silently dropping the whole "## Earnings peer lens" section — while a
sibling ticker at `days_until === 7` with the IDENTICAL unavailable-cohort reason gets the thin
fallback rendered.

### Evidence

Live cross-ticker comparison in the same Ask Largo audit cycle (broader multi-ticker Workflow sweep,
2026-10-21): SHOP (earnings 13 days out, peer cohort unavailable — `unclassified_sector`) omitted the
section entirely, while TDOC and GOOGL (earnings 7 days out, same `unclassified_sector` unavailable
reason) both rendered `**Earnings peer lens** — reports in **7d**. Peers that beat often gap through
implied — size down or hedge vol unless thesis is the print.` SHOP's own `unavailableSources` list
still names `Meridian peer cohort (unclassified_sector)`, confirming the condition was identical to
its siblings' — only the days-until threshold differed.

Added a RED repro (`days_until: 13`, `expected_move_pct: null`, peer unavailable) asserting the
section still renders, plus a control test for the existing `days_until <= 3` "print imminent"
emphasis. RED→GREEN, git-stash-verified on the source file alone: 11/12 (1 fail) before the fix,
12/12 after. `tsc --noEmit` clean.

### Blast radius

Single call site (`meridianPeerSection()` in `play-brief-intel.ts`, called unconditionally for every
bucket — WATCH/OPEN/CLOSED alike). All 10 pre-existing tests in `play-brief-meridian-peer.test.ts`
use `days_until` values `<= 7`, so the baseline line already fired for every one of them before this
fix — no behavior change for any previously-tested case, confirmed by the full suite staying green.

### Fix

Removed the `item.days_until <= 7` gate on the baseline "reports in Nd"/"reports today" line — it
now always pushes for any item the function is already entered for (`days_until` 0-14). The
`days_until <= 3` "print imminent" emphasis is unchanged and still additive.

### Why not a bigger fix

Did not add an explicit "peer cohort unavailable" bullet to this function — that information is
already surfaced separately via `collectBriefUnavailableSources`'s "Meridian peer cohort" entry in
the envelope's own `unavailableSources`/"_Unavailable this turn:_" disclosure; this fix only ensures
the coaching section itself doesn't vanish for a 8-14-day-out item the way it would for anything
reachable at all by this function.
