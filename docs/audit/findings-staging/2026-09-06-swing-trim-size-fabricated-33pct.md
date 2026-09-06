> **kind:** FINDING

## managementActionDisplay fabricated a 33% trim size for SWING once its single trim tranche had already fired — FIXED

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Pri** | P1 |
| **Area** | Night Hawk Command Deck — `terminal-display.ts` / `ManagementActionCard` / `SwingBriefActionStrip` |
| **PR** | (pending) |

### Symptom

`managementActionDisplay()` rendered "TRIM 33%" for SWING plays in the Ask Largo action strip
(`SwingLargoInsightsPanel.tsx`'s `SwingBriefActionStrip`) and the main terminal's Management tab
(`TerminalPremiumPanels.tsx`'s `ManagementActionCard`) — a size that exists nowhere in SWING's
actual exit policy and directly contradicts the same panel's own narrative text ("all trims
banked — runner only … 50% runner after trims").

### Root cause

`terminal-display.ts` line 164 (pre-fix):
```ts
const next = play.exitPolicy.trim_levels.find((t) => !t.fired);
sizePct = next ? Math.round(next.fraction * 100) : 33;
```
The `33` fallback is a magic constant lifted from 0DTE's real trim ladder
(`TRIM_SCALE_RULES.tranche_fraction = 1/3`, three tranches). SWING's exit policy
(`SWING_SCALE_OUT_POLICY`, `src/lib/swing/exit-policy.ts`) is a **completely different
single-tranche ladder**: ONE level at `scale_at_mult` (100%/2x) banking `scale_fraction` (0.5 →
50%), then a `runner_fraction` (0.5) runner — confirmed directly from `exit-policy.ts:8-21`, no
`33` anywhere in the SWING policy. Once that one level fires — true for essentially every SWING
play whose `manageAction`/recommendation reaches `TRIM` — `trim_levels.find(t => !t.fired)`
returns `undefined`, and the function fell back to the hardcoded, 0DTE-shaped `33`. This was never
caught because `terminal-display.test.ts` only covered the SELL-sizing and WATCH-probability
paths for `managementActionDisplay`, never the SWING all-trims-fired TRIM path.

### Evidence

Live shape from the audit (`docs/audit/SWING-SYSTEM-CTO-AUDIT-2026-09-06.md` finding #19): CRWD
committed SWING position, entryPremium 16.65, peakPremium 38.25, `liveStatus TRIM`,
`manageAction TAKE_PARTIAL`. `buildTerminalExitLadder(SWING_SCALE_OUT_POLICY, 16.65, 38.25)`
produces `trim_levels=[{trigger_pct:100, fraction:0.5, premium:33.30, fired:true}]` (peak 38.25 ≥
33.30). Pre-fix, `managementActionDisplay(play, "TRIM", …)` returned `sizePct: 33` — reproduced
exactly by the new regression test (fixture below), which fails on the pre-fix code
(`assert.equal(action.sizePct, null)` got `33`) and passes post-fix.

A sibling function in the same codebase, `play-card-lifecycle.ts`'s `swingActionDisplay` (lines
~298-301), already handles this exact all-fired case honestly:
```ts
const next = play.exitPolicy?.trim_levels?.find((t) => !t.fired);
if (next) return { label: `TRIM ${Math.round(next.trigger_pct)}%`, tone: "active" };
return { label: "TRIM", tone: "active" };
```
— a bare `TRIM` label with no fabricated percentage. This is the proof the `33` fallback was the
outlier bug, not intended behavior.

### Blast radius

Both consumers of `managementActionDisplay` render `action.sizePct`, and both were already
null-safe (`action.sizePct != null ? <span>{action.sizePct}%</span> : null` — verified by reading
both render sites, no change needed there):
- `TerminalPremiumPanels.tsx:523-525` (`ManagementActionCard`, Night Hawk Command Deck Management
  tab)
- `SwingLargoInsightsPanel.tsx:53` (`SwingBriefActionStrip`, Ask Largo panel header)

No other caller of `managementActionDisplay` or `ManagementActionDisplay.sizePct` exists (grepped
the repo). 0DTE's own TRIM path is unaffected — its trim_scale ladder always has a real "next"
unfired tranche while any tranche remains unfired (3 tranches, so `find` only returns `undefined`
after all 3 have fired, a state 0DTE's own UI already treats the same honest way via the sibling
function — this fix makes `terminal-display.ts` consistent with that, not different from it).

### Fix

Removed the hardcoded `33` fallback; `sizePct` is now `null` when no unfired trim level remains
(bare "TRIM" verb, no percentage), matching `play-card-lifecycle.ts`'s already-correct behavior.
Considered computing a number from `runner_fraction` instead, but rejected: the runner's remaining
fraction (50%) is not a trim SIZE — showing "TRIM 50%" would incorrectly imply either "sell 50%
more now" (there is no further scripted trim) or double as the amount already banked, either of
which is a new fabrication in a different shape. Omitting the number is the honest option and
matches the sibling function's spirit exactly.

### Test

`src/features/nighthawk/command-deck/terminal-display.test.ts`: two new cases —
"SWING all-trims-fired never fabricates the 0DTE 33% fallback" (RED pre-fix: `sizePct` was `33`;
GREEN post-fix: `sizePct` is `null`) and "SWING with a genuine pending trim level still sizes it
honestly" (asserts the real 50% level still surfaces when a tranche genuinely hasn't fired,
guarding against an overcorrection to always-null). Full nighthawk command-deck suite: 387/387
pass. `npx tsc --noEmit`: clean.
