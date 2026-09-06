> **kind:** `FINDING`

## Hold plan (Ask Largo `?expandIntel=1`) repeated recNote AND the thesis-health advisory sentence — FIXED

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Pri** | P3 (narrative quality — Largo "one trade-manager voice" standard) |
| **Area** | Night Hawk Swings — Ask Largo play-brief, `play-brief-intel.ts` |
| **PR** | (pending) |

### Symptom

Flagged by Cursor's peer review on #4257 ("Note: `holdPlanSection` still repeats `recNote` for open
bucket... optional follow-up if we want strict single-voice everywhere") and independently confirmed
live. `holdPlanSection` pushed `play.recNote` verbatim — the same string `managementSection`
(`play-brief.ts`) already renders for the open bucket — and separately rendered
`play.thesisHealth.advisory` verbatim, the same sentence `tradeManagerNarrativeSection`'s pillar-fade
narration already carries in "Trade manager read".

This is normally invisible: `collapseRedundantIntelSections` drops the "Hold plan" section whenever
a narrative is present. But `GET /api/market/swing/play-brief?...&expandIntel=1` (the real, live
"expand via follow-up chips or Open Largo" path `play-brief.ts`'s route wires up) bypasses that
collapse entirely, so both sections render side by side. Confirmed live on `SWING_NRG_34`:

```
Management: "live hold — swing thesis Thesis health 46% — Thesis fading — tighten risk or trim into strength."
Hold plan:  "live hold — swing thesis Thesis health 46% — Thesis fading — tighten risk or trim into strength."
            ...
            "Thesis health 46% (Degraded) — Thesis fading — tighten risk or trim into strength."
```

Two separate verbatim repeats in the same section — the identical duplication class #4257 fixed in
`whyThisSetupSection`, just reachable via the expand path instead of by default.

### Fix

Removed the `recNote` push from `holdPlanSection` entirely. Kept `Thesis health **{health}%**
({rungLabel})` as a compact number (not duplicated anywhere else) but dropped the `— {advisory}`
sentence suffix, since that sentence is the exact text `tradeManagerNarrativeSection` already
narrates.

### Evidence (RED → GREEN)

Added 3 tests to `play-brief-intel.test.ts`: `holdPlanSection` no longer contains the verbatim
`recNote`, no longer contains the verbatim thesis-health advisory sentence, and still surfaces
desk stance / time-in-trade / rails. `git stash` on `play-brief-intel.ts` alone: RED — 2/21 fail
in that file. GREEN (post-fix): 21/21 in that file, 35/35 across
`play-brief-intel.test.ts` + `play-brief.test.ts`.

Full `src/lib/swing/*.test.ts`: 667/667 pass. `npx tsc --noEmit`: clean.

### Blast radius

Only `holdPlanSection` in `play-brief-intel.ts`. `managementSection`, `tradeManagerNarrativeSection`,
and `thesisHealthSection` are unchanged — each sentence still appears exactly once per brief, even
under `?expandIntel=1`.
