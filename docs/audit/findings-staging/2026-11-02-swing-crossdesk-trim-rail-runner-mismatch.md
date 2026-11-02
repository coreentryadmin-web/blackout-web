> **kind:** FINDING

## Swing `crossDeskResolution` "structure" conflict names a nonexistent "next trim rail" for TRIM/runner-phase positions — FIXED

| **Status** | FIXED (`fix/swing-crossdesk-trim-rail-runner-mismatch`) |
|---|---|

### Root cause

`src/lib/swing/play-brief-narrative-coaching.ts`'s `crossDeskResolution()` handles the "structure"
cross-desk-conflict case (Vector disagreeing with the swing's own direction) with two buckets:
`"watch"` (no position yet) and `"open"` (a real position). The `"open"` branch unconditionally
read:

```
watch for it to flip back before your next trim rail — until then, size down
```

`crossDeskCoaching()`'s bucket derivation collapsed `OPEN`/`HOLD`/`TRIM` statuses all into `"open"`:

```ts
const bucket: "watch" | "open" =
  play.status === "OPEN" || play.status === "HOLD" || play.status === "TRIM" ? "open" : "watch";
```

But `SWING_SCALE_OUT_POLICY` (`src/lib/swing/exit-policy.ts`) has exactly **one** trim rung
(`trim_levels` is a 1-element array, trigger at +100%/2x). Once a position's `status` reaches
`"TRIM"`, that one rung has already fired — there is no "next" trim rail, only the trailing
runner stop on the remaining `runner_fraction`. The text was telling the member to wait for a
rail that structurally cannot exist anymore for that position.

This is the same bug *class* already fixed once (2026-10-08) for the WATCH bucket — "position-
management language presupposing something that doesn't exist for this bucket" — but that earlier
fix only split watch-vs-open; it never added a third case for the runner phase.

### Evidence

Live repro found by the `five-engine-largo-cycle-73` workflow's Largo deep-dive agent on
`SWING:TXRH` (positionId 2252, `liveStatus: "TRIM"`, trim already banked at +100%). The brief's
"Trade manager read" section rendered:

> **Cross-desk friction** — Vector bearish (POSITION · momentum short on continuation → target put
> wall 180)... watch for it to flip back before your next trim rail — until then, size down.

while the **same brief's** Management section said:

> Trim ladder: +100% ✓ ... Rails: stop $0.50 _(no longer applies — already scaled; runner trail
> now $1.93)_ · target $2.50 ✓ (reached)

and the Trade-manager-read's own "Manage plan" bullet said "**all trims banked** — runner only" —
a direct self-contradiction inside one document.

Regression test (`src/lib/swing/play-brief-narrative-coaching.test.ts`, new test
`"crossDeskCoaching: TRIM-bucket (runner phase) structure conflict names the trailing stop, not a
nonexistent 'next trim rail'"`), RED before the fix (proven via `git stash` on the source file
alone — 200/201 pass, the new test failing on the unfixed `"open"`-bucket text), GREEN after
(201/201 pass). `npx tsc --noEmit` clean. Full `src/lib/swing/*.test.ts` suite: 2224/2224 pass.

### Blast radius

Single function (`crossDeskResolution`), single call site (`renderCrossDeskConflict` →
`crossDeskCoaching`). Every BANGER-origin swing position currently in `TRIM`/`SCALING_OUT` state
hits this wrong phrasing any cycle a Night Hawk/0DTE/Vector/HELIX cross-desk conflict exists
against it — at audit time ~11 live positions (SNDQ, GDDY, TDOC, OWL, VFC, FTAI, IP, TXRH, ACN,
SG, PPG). Only the `"structure"` evidence-kind case was affected; `"flow"`, `"intraday_scalp"` and
`"digest"` resolutions don't reference trim mechanics at all and were unaffected.

### Fix rationale

Added a third `"runner"` bucket value (alongside the existing `"watch"`/`"open"`), threaded through
`crossDeskResolution`, `renderCrossDeskConflict`, and `crossDeskCoaching`'s bucket derivation
(`status === "TRIM"` → `"runner"`; `"OPEN"`/`"HOLD"` → `"open"`; everything else → `"watch"`). The
`"runner"` case gets its own wording naming the trailing stop instead of a trim rail that no
longer exists: "watch for it to flip back before it threatens the trailing stop — until then,
consider sizing down." OPEN/HOLD keep the exact original "open" wording unchanged (a real trim
rail genuinely is still ahead of them), so this only narrows scope for the one bucket that was
wrong, per the same discipline the 2026-10-08 WATCH-bucket fix established.
