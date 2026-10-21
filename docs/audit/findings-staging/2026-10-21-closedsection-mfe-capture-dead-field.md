## closedSection's "MFE capture" line is permanently dead in production for swing CLOSED plays — FIXED

> **kind:** `FINDING`

| **Status** | Fixed |
|---|---|

**Found:** 2026-10-21, Ask Largo standing mandate — a Workflow-based deep-dive, round 2 (live-
fetched real swing play-brief envelopes across WATCH/OPEN/CLOSED buckets, adversarially verified
before acting), focused on "Data freshness"/"Position"/"Outcome" — sections not yet audited that
day.

**Root cause:** `closedSection` (`src/lib/swing/play-brief.ts`) gated its "MFE capture: X%" line
on the raw field check `play.mfeCapturePct != null`, instead of calling the shared
`mfeCaptureOutcome(play.exitPnlPct, play.peak, play.mfeCapturePct)` helper every other MFE-related
call site in this lane uses (`lessonsSection` in play-brief-intel.ts, plus the trade-manager
narrative sections). `mfe-capture.ts`'s own header comment states explicitly that `mfeCapturePct`
is "currently never populated... so the ratio fallback is what production actually serves today."
Tracing the data path confirms this for swing specifically: the real swing closed-play adapter
(`terminalPlayFromHorizon`, `adapters.ts`) never sets `mfeCapturePct` anywhere in its returned
object — not a null placeholder, simply absent — so `play.mfeCapturePct` is `undefined` for every
real swing CLOSED play. Since `undefined != null` is `false`, the MFE line in `closedSection` never
rendered live, even though `play.peak` and `play.exitPnlPct` (the two inputs the shared ratio-
fallback helper needs) were both already present on the same `play` object.

**Evidence:** NVDA (CLOSED, positionId 62): "## Outcome" rendered only `Exit P&L: **+7.2%**`,
`Reason: **target**`, `Closed: **2026-10-20 09:30 ET**` — no MFE-capture line. The SAME envelope's
"## Lessons" section (built via the shared `mfeCaptureOutcome` ratio-fallback off the identical
`play.peak`/`play.exitPnlPct` pair that `closedSection` also had in hand) stated `Peak was
**+66.1%** · exited **+7.2%**` followed by `MFE capture: **+10.9%** of peak move` (7.2/66.1≈10.9%,
confirming it's the ratio fallback, not a populated field). The existing regression test
("composeSwingPlayBrief: CLOSED play emits outcome section") only proved the dead `!= null` branch
works when a fixture directly injects `mfeCapturePct: 68` — a shape that never occurs in real
production data — so it never caught that the line never fires live.

**Fix:** `src/lib/swing/play-brief.ts` — `closedSection` now computes
`mfeCaptureOutcome(play.exitPnlPct, play.peak, play.mfeCapturePct)` and renders the MFE line only
when `outcome?.kind === "capture"`, matching the pattern already used in `lessonsSection`. A
round-trip-to-loss outcome (`kind === "round_trip"`) has no "capture" to report — that's a
different event per `mfe-capture.ts`'s own header comment — so the line is correctly omitted there
too, same as every other call site of this helper.

**Tests:** `src/lib/swing/play-brief.test.ts` — two new tests: (1) the real production shape (no
`mfeCapturePct`, `peak`/`exitPnlPct` present) now renders `MFE capture: **+10.9%**` via the ratio
fallback; (2) a round-trip-to-loss case (negative `exitPnlPct`, `peak`/`exitPnlPct` present, no
`mfeCapturePct`) correctly omits the MFE line rather than rendering a nonsensical negative
"capture." RED→GREEN proven via `git stash` on the source file alone (1 fail / 160 pass without
the fix, 161/161 with it). `tsc --noEmit` clean.

**Blast radius:** `closedSection`'s MFE-capture line only — every other line in the section
(Exit P&L, Reason, Closed) and every other section are untouched. The pre-existing test injecting
the unrealistic `mfeCapturePct: 68` fixture still passes unchanged (it never asserted on the MFE
line directly).
