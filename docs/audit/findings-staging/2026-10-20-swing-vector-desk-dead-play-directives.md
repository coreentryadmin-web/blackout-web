## vectorDeskSection rendered live entry/target/invalidation directives for a genuinely dead WATCH play, contradicting the brief's own Verdict — FIXED

> **kind:** `FINDING`

| **Status** | Fixed |
|---|---|

**Found:** 2026-10-20, Ask Largo standing mandate — a fresh-angle Workflow audit of the swing
play-brief's chart/GEX technical-level sections, adversarially verified (3-agent pipeline,
confirmed real on independent verification, not a single-pass guess).

**Root cause:** `vectorDeskSection` (`src/lib/swing/play-brief-intel.ts`, feeds "Vector desk")
renders Vector's current live directive block — headline, thesis, entry zone, targets,
invalidation, "Watch now" bullets, badged bullish/bearish — for any non-closed, non-stale play.
Unlike its sibling `watchForSection` (fixed earlier the same day, PR #6337, same standing
mandate), it carried **no `deadPlayReason(play)` guard**. A genuinely dead WATCH candidate
(entry-validity window expired, extended past the valid entry window, contract expired, or
thesis already invalidated — `deadPlayReason`'s 4 cases) keeps `statusBucket === "watch"`, so
this section's live-directive block still rendered concrete, actionable instructions for a setup
the brief's own top-level Verdict already says not to chase.

**Live impact:** "Vector desk" is folded into the narrative by default and only reachable as its
own standalone section via the member-facing `expandIntel=1` ("Show detail") toggle
(`SwingLargoInsightsPanel.tsx`) — real traffic, not a theoretical path. On a dead WATCH play, a
member expanding the brief would see the Verdict section say *"Extended past the valid entry
window — do not chase; wait for a reset."* and then, further down, "Vector desk" say *"Entry
zone: **118-120** · Targets: **125** · **130** · Invalidation: **below 115**"* with a bullish/
bearish badge — concrete, specific numbers directly contradicting the instruction not to act.

**Fix:** Threaded the existing `ctx` parameter's `.play` into a `deadPlayReason(ctx.play) != null`
check (the identical helper and 4-case scope `watchForSection`'s own fix uses). When the play is
dead, the section keeps its informational content — headline, grade, conviction, thesis — the
same design `vectorDeskSection`'s own closed-bucket branch already established one branch up
(informational snapshot, no directives, forced-neutral bias) — and drops entry zone, targets,
invalidation, and "Watch now" before they're pushed, returning early with a neutral bias.

**Fix rationale:** Mirroring the closed-bucket branch's own established shape (rather than
inventing new framing) keeps the file internally consistent: both "this play is not something to
act on right now" states (closed, or dead-but-still-WATCH) now get the same treatment — keep the
read, drop the call to action. `ctx?.play` is optional in the signature (unchanged), so a caller
that doesn't supply `ctx` (or a `ctx` without `.play` set) defaults `isDeadPlay` to `false` —
identical to prior behavior, no regression for any existing call site.

**Blast radius:** `vectorDeskSection` has exactly one production call site
(`buildIntelSections`, same file), which already passes `ctx` — a one-line guard, not a new
computation or parameter.

**Tests:** 3 new regression tests in `play-brief-intel.test.ts` (dead WATCH play suppresses all
four directive lines + forces neutral bias; a live WATCH play keeps the full block, no
regression; no-`ctx.play`-supplied keeps the full block, safe default) — all fail against the
pre-fix code (verified via `git stash`), pass after. Full suite green on Node 20, `tsc --noEmit`
clean.
