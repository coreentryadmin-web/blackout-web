> **kind:** FINDING

## Ask Largo × Night Hawk Swings — "Trade manager read" TRIM-rail bullet ignores PEAK crossing, only checks CURRENT pnlPct — FIXED

**Status:** Fixed, regression tests added (`src/lib/swing/play-brief-narrative.test.ts`,
`src/lib/swing/play-brief-narrative-coaching.test.ts`).

### Root cause

Both "already crossed the trim rail" self-checks — `railAlreadyCrossed` in
`play-brief-narrative.ts`'s `actionNarrative` (TRIM branch, line ~927, feeding
`tradeManagerNarrativeSection`'s "Desk says TRIM" bullet) and `alreadyCrossed` in
`play-brief-narrative-coaching.ts`'s `manageLifecycleCoaching` (line ~177, feeding the
"Manage plan" bullet) — compared the unfired trim rung's `trigger_pct` only against the
position's CURRENT `play.pnlPct`. Neither checked `play.peak` (the ratcheted high-water
mark, already present on `TerminalPlay` and already used elsewhere in both files, e.g.
`mfeCaptureOutcome(play.pnlPct, play.peak, null)`).

That is the wrong basis: the swing scale-out engine that actually decides
`manageAction === "TAKE_PARTIAL"` (mapped to `recommendation: "TRIM"`) is
`deriveScaleOutAction` (`src/lib/zerodte/scale-out.ts:217`, mirrored into swing's own
`SWING_SCALE_OUT_POLICY` via `src/lib/swing/exit-policy.ts`):

```
if (peakPremium >= entryPremium * scale_at_mult) {
  return { action: "TAKE_PARTIAL", reason: `peak ≥ ${scale_at_mult}× entry — realize ...` };
}
```

— explicitly keyed on the RATCHETED PEAK, not the current mark (fixed to read the peak,
not `lastMark`, on 2026-09-28/29 specifically so a spike-then-retrace still fires the
partial — see that function's own in-code comment). Meanwhile `exitPolicy.trim_levels[].fired`
is deliberately forced to `false` pre-enforcement for a swing position whose DB `status`
hasn't reached `"TRIM"` yet (`adapters.ts`, the 2026-09-10 NRG fix: "a row can sit at HOLD
long after its peak cleared the trim trigger... gate the not-yet-enforced case"). So the
narrative correctly finds an unfired `next` trim rung, but then asked the WRONG question
of it — "is CURRENT price past this rung" — when the engine's own verdict two bullets
earlier was decided on "was PEAK ever past this rung."

**Live repro (production, 2026-10-31):** `GET /api/market/swing/play-brief?playId=SWING:MRNA:68`.
Horizons data for positionId 68: `entryPremium=14.80`, `peakPremium=32.20` (peak% = +117.6%,
clears the +100% trigger — `32.20 >= 14.80 * 2`), `livePnlPct=99.2` (current, just under
+100% after retracing from peak), `manageAction="TAKE_PARTIAL"`, `manageReason="profit_ladder"`,
`manageReasonDetail="peak ≥ 2× entry — realize 50%, trail the runner"`. The brief rendered:

> **Desk says TRIM** — next rail at **+100%**. Bank partial into strength...
>
> **Manage plan** — manage engine **TAKE PARTIAL** · next trim at **+100%** — bid **$27.80**,
> needs **$29.60** (+6% from here) ...

Both bullets phrase the rail as forward-looking ("next", "needs ... from here") — the
OPPOSITE of what `manageReasonDetail` states one clause earlier in the exact same response:
the rail was already cleared at peak, it just hasn't been banked.

**Why the 2026-09-14 fix (CG SWING:CG:25) didn't already cover this:** that fix added the
exact same current-pnlPct check (`pnlPct >= next.trigger_pct`) to correct the case where
CURRENT price had ALSO already crossed the trigger (pnlPct +169.2% vs trigger 100). It never
covered the case where only PEAK crossed and current has since retraced below the trigger —
the shape MRNA exhibits, and the shape the engine's own peak-based scale-out logic is
actually keyed on. Confirmed via `grep` across `FINDINGS.md`/`findings-staging/*.md` for
`alreadyCrossed`, `railAlreadyCrossed`, and `peak.*trigger_pct`: no prior fix or staged
finding addresses this gap, and both call sites in current `main` (verified by direct
`Read` before this fix) still compared only against `play.pnlPct`.

### Fix

`play-brief-narrative.ts`: split the single `railAlreadyCrossed` check into
`currentAlreadyCrossed` (unchanged — the existing, already-tested current-price check) and a
new `peakAlreadyCrossed` (`play.peak >= next.trigger_pct`, only consulted when
`currentAlreadyCrossed` is false). `railClause` now has three branches: cleared by current
price (existing wording, unchanged), cleared by peak only (new wording — "rail already
touched at peak (**+117.6%**), since retraced to **+99.2%**, not yet banked", explicitly
citing the PEAK number rather than reusing the "(now X%)" phrasing, which would misleadingly
imply the rail sits at the current price), or genuinely still ahead (existing "next rail at"
wording, unchanged).

`play-brief-narrative-coaching.ts`: `alreadyCrossed` is now
`(pnlPct >= trigger_pct) || (peak >= trigger_pct)`. This bullet's wording ("rail already
cleared, not yet banked") doesn't cite a specific "now" value, so no wording split was
needed there — the existing text is accurate for either sub-case. This also correctly
suppresses `distanceSuffix` (the "needs $X, +Y% from here" clause) once `alreadyCrossed` is
true via the peak path, removing the exact contradiction quoted above ("manage engine TAKE
PARTIAL" next to "needs ... from here").

### Blast radius

Two call sites, both fixed (`tradeManagerNarrativeSection`'s "Desk says TRIM" bullet in
`play-brief-narrative.ts`, and `manageLifecycleCoaching`'s "Manage plan" bullet in
`play-brief-narrative-coaching.ts`) — these are the only two places in the swing play-brief
that render a "next trim at / already crossed" framing off `exitPolicy.trim_levels`. No other
desk (0DTE, Legacy, Vector, SPX, Meridian) shares this narrative code; 0DTE's own terminal
display (`terminal-display.ts`) has its own, separate trim-ladder renderer not touched here.

### Fix rationale

Fixing at the two narrative call sites (rather than, say, forcing `exitPolicy.trim_levels[].fired`
to `true` once peak crosses) deliberately leaves `adapters.ts`'s pre-enforcement gating
UNCHANGED — that gating exists on purpose (the 2026-09-10 NRG fix) to keep "Trim ladder ✓" /
"all trims banked" claims honest while a real scale-out is still only advisory and unexecuted.
This fix only changes the FRAMING of the still-unfired rung (forward-looking vs. already-touched),
not whether it's reported as fired/banked — a position that peaked past its rung and retraced is
still 100%-exposed and still gets the "Nothing's banked yet — this is advisory only" disclosure,
exactly as before.

### Evidence

Regression tests added to both files, RED→GREEN proven via `git stash`:
- `play-brief-narrative.test.ts`: "TRIM's rail bullet says 'already touched at peak', not
  'next', when PEAK (not current price) cleared the unfired trigger" — failed before the fix
  (rendered "next rail at **+100%**" next to "manage engine **TAKE PARTIAL**"), passes after.
- `play-brief-narrative-coaching.test.ts`: "'next trim' becomes 'already cleared, not yet
  banked' when PEAK (not current price) cleared the unfired trigger" — failed before the fix
  (rendered "needs ... from here" next to "manage engine **TAKE PARTIAL**"), passes after, and
  also asserts the misleading distance clause no longer renders.

Full `src/lib/swing/*.test.ts` suite: 2170/2170 pass after the fix. `tsc --noEmit`: clean,
identical to the pre-fix baseline. `eslint` on touched files: clean.
