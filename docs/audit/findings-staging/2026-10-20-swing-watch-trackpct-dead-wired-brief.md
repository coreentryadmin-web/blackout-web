## WATCH plays' already-computed "Since flag" underlying move never reached the Largo play-brief — dead-wired to the one bucket that never has it — FIXED

> **kind:** `FINDING`

| **Status** | Fixed |
|---|---|

**Found:** 2026-10-20, Ask Largo standing mandate live deep-dive (5-engine live-check workflow),
TSLA WATCH brief (`SWING:TSLA`, 385P short candidate, flagged 2026-10-20 17:14 ET). The brief gave
`Flag anchor: **374.50** — track move from here` and the live spot (`379.80`, a few lines later in
"Trade manager read") but never stated the actual move itself — the underlying had run ~1.4% in the
adverse direction for this SHORT since it was flagged. The identical row's live board card already
shows this exact number as a "Since flag" badge.

**Root cause:** `trackPct` (`TerminalPlay.trackPct`, command-deck/types.ts) is the direction-signed
underlying % move since the flag anchor — computed by `watchUnderlyingTrackPct`
(`src/lib/zerodte/watch-track.ts`) and stamped by command-deck/adapters.ts. Per
`adapters.test.ts`'s own pin (`assert.equal(open.trackPct, null)`), it is populated **only** for
WATCH/SKIP status — never for `open`. The one place that ever rendered it, `pnlSection`'s "Since
flag" line (`play-brief.ts:701`, `if (play.trackPct != null) lines.push(...)`), is only called from
`composeSwingPlayBrief`'s `bucket === "open"` branch (`play-brief.ts:1696`). So the rendering branch
and the populating branch never overlap: an open play's `trackPct` is always null (nothing to
render), and a watch play's real, non-null `trackPct` is never passed through a code path that
renders it. The line has been dead on arrival since it was written — confirmed via a repo-wide grep
(`grep -rn "trackPct"`): the ONLY consumer of `play.trackPct` anywhere in `src/lib/swing/` was this
one unreachable line.

**Fix:** Render `play.trackPct` in `watchForSection`'s `bucket === "watch"` branch
(`play-brief-intel.ts`), right beside the `Flag anchor` line it measures from — same wording as the
(unreachable) `pnlSection` copy (`Since flag: **${fmtPct(play.trackPct)}**`), so nothing new to
recognize.

**Fix rationale:** Minimal, additive: no new field, no new computation — `trackPct` was already
computed and already threaded onto `TerminalPlay`, it just never reached a bucket that calls a
section rendering it. Placed in `watchForSection` (not `watchEntrySection`) because that is where
`Flag anchor` already lives, and the two facts (anchor + move since anchor) belong together.

**Blast radius:** Single function (`watchForSection`), one new conditional line. No other call site
of `play.trackPct` exists to duplicate or contradict.

**Tests:** 2 new regression tests in `play-brief-intel.test.ts` — (1) a WATCH play with a real
`trackPct` renders `Since flag: **-1.4%**` beside the flag anchor; (2) a null `trackPct` (e.g. the
`open` bucket, where it is never populated) renders nothing. RED→GREEN proven via `git stash` on
just the source file (test (1) failed pre-fix with the line entirely absent; both pass post-fix).
Full `play-brief-intel.test.ts` (288 tests) green on Node 20. `tsc --noEmit` clean.
