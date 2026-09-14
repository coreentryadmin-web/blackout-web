> **kind:** FINDING

## Ask Largo's "Round-tripped past breakeven" bullet read like the whole position lost its gains even when half was already banked profitably — fix/swing-round-trip-bullet-ignores-banked-trim — 2026-09-14

| **Status** | FIXED |
|---|---|

### What was broken

Found during the standing Night Hawk Swings AGGRESSIVE MODE audit, live on CRWD's real committed position (`GET /api/market/swing/play-brief?playId=SWING:CRWD:19`): entry $16.65, 50% banked at +100% ($33.30), runner mark $15.08 (pnlPct -9.5%, peak +129.7%). The Position section correctly discloses `Blended P&L (realized trim + open runner): +45.3%` — this is, overall, a solidly winning trade. But the "Trade manager read" section's first bullet read:

> **Desk says TRIM**. **Round-tripped past breakeven** — was up **130%** at peak, now **-10%** — consider protecting what's left.

`actionNarrative`'s round-trip bullet (`play-brief-narrative.ts`) computes `giveback` from `play.pnlPct`/`play.peak` alone — the RUNNER leg's own raw figures, with no awareness of whether any tranche had already been banked. This is the exact same class of "reads like nothing has happened yet, or the whole position is in trouble" ambiguity the file's own `Desk says TRIM` bullet a few lines above already disambiguates (its `trimsFired === 0` check, added for the NRG live repro documented in-code: "round-tripped from +132.7% to +2% with ZERO trim ever banked") — but the fix was never extended to this sibling bullet. A member reading only this bullet (the most prominent one, right after "Desk says TRIM") would have no way to tell CRWD's case (a comfortable +45.3% blended win, only the runner round-tripped) from the NRG case (the WHOLE position round-tripped with zero protection ever taken) — both render byte-identical wording.

### What changed

Added a local `anyTrimBanked` check (`play.exitPolicy?.trim_levels?.some(t => t.fired)`, computed once alongside the existing `giveback` calculation) and branched the round-trip bullet's wording on it:
- When a trim has already been banked: `**Runner round-tripped past breakeven** — was up X% at peak, now Y%; part of this position is already banked at a profit — consider protecting what's left of the runner.`
- When nothing has been banked (the original NRG-shape case): unchanged wording, `**Round-tripped past breakeven** — was up X% at peak, now Y% — consider protecting what's left.`

`blendedPnlPct` (the exact function that computes the real, already-correct +45.3% figure) lives in `play-brief.ts`, which itself imports FROM `play-brief-narrative.ts` (`resolveBreakInvalidation`) — importing it back here would be circular. The fix duplicates only the minimal `some(t => t.fired)` check locally rather than the full blended-P&L math, since the bullet only needs to know WHETHER to disambiguate, not restate the exact blended number (the Position section and the "Manage plan" bullet, right below, already state it).

### Evidence

RED→GREEN (Node 20, `git stash` isolation): a new test reproduces CRWD's exact shape (pnlPct -9.5→peak 129.7, one fired trim_level at trigger_pct 100) and asserts the banked-aware wording fires while the unqualified wording does NOT — failed pre-fix (got the unqualified "Round-tripped past breakeven ... consider protecting what's left" wording with no banked-profit disclosure), passed post-fix. A sibling test reproduces the original NRG-shape case (an UNFIRED trim_level) and asserts the original unqualified wording is preserved unchanged — passed both before and after, confirming the fix doesn't regress the case it was originally built for. Full `play-brief-narrative.test.ts`: 73/73 pass. Combined with `play-brief-narrative-coaching.test.ts` + `mfe-capture.test.ts`: 163/163 pass. `tsc --noEmit`: clean.

### Blast radius

The round-trip bullet has exactly one render call site (`actionNarrative`, `play-brief-narrative.ts`) — the sibling `degradedReadLine` function used to render the identical fact too but was already fixed (2026-09-12, in-code comment) to skip the `round_trip` case entirely since `actionNarrative` always runs first and already covers it, so no second call site needed the same fix. `blendedPnlPct`/the Position section (`play-brief.ts`) are untouched — this fix only changes the wording of one narrative bullet, not any P&L math.

### Fix rationale

Branching on a locally-duplicated minimal check (rather than importing `blendedPnlPct`) avoids a circular import between `play-brief.ts` and `play-brief-narrative.ts`. Keeping the exact blended-P&L number OUT of this bullet (rather than restating it) avoids drifting out of sync with `play-brief.ts`'s own single source of truth for that figure — the bullet only needs to say "part of this position is protected," the Position section right above it already says exactly how much.
