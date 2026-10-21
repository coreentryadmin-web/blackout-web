## watchForSection's Premium stop/target rails never disclosed a stale mark, contradicting the Position section's own stale caveat on the identical quote — FIXED

> **kind:** `FINDING`

| **Status** | Fixed |
|---|---|

**Found:** 2026-10-21, Ask Largo standing mandate — a Workflow-based deep-dive (live-fetched real
swing play-brief envelopes across WATCH/OPEN/CLOSED buckets, then an adversarial verify pass before
acting) focused on "Hold plan"/"Watch levels"/"Data freshness", not yet audited this session.

**Root cause:** `watchForSection` (`src/lib/swing/play-brief-intel.ts`) computes the "Premium stop
rail" and "Premium target rail" cushion/room percentages from `play.mark`/`play.execMark` — the
exact same quote `play-brief.ts`'s `pnlSection` (Position section, same envelope) already flags via
a `staleCaveat` string whenever `optionMarkIsStale(play, readMs)`, applied there to the Greeks and
Spread lines. `watchForSection` already imports `optionMarkIsStale` and already computes `readMs`
at the top of the same function, but the rail-cushion gating only ever checked
`optionMarkGenuinelyUnknown(play)` (true only for the never-synced/fallback case) plus
position-specific checks (`executableCushionGone`/`targetAlreadyFired`) — never `optionMarkIsStale`,
a distinct, non-overlapping condition that catches the far more common case of a mark with a real
`markAsOf` timestamp that's simply old.

**Evidence:** Live repro #1 (MRNA, bucket TRIM, positionId 1958): Position section read "Mark:
$12.53 (2026-10-20 16:00 ET)" with Greeks/Spread both suffixed "_(stale — same quote Mark flagged
above)_", and the "Data freshness" section separately stated "Option mark **stale** — last synced
**2026-10-20 16:00 ET**" (compute time ~5h16m later, far past the 18-minute
`SWING_OPTION_MARK_STALE_MS` threshold). Yet the SAME envelope's "What to watch" section read
"Premium stop rail: **$2.60** — 79% cushion from current bid — thesis breaks if mark closes below"
with no stale qualifier at all — directly contradicting "Trade manager read"'s own "Data caveat ...
Treat levels as indicative until refresh" line two sections earlier. Live repro #2 (CRWV, bucket
HOLD, positionId 63): identical shape — Position section flags the mark stale, "What to watch"
renders both "Premium stop rail: $2.00 — 53% cushion" and "Premium target rail: $10.00 — 133% move
still needed" with zero staleness disclosure.

**Fix:** `src/lib/swing/play-brief-intel.ts` — added `railStaleCaveat` (identical wording/logic to
`play-brief.ts`'s own `staleCaveat`: `optionMarkIsStale(play, readMs) ? " _(stale — same quote Mark
flagged above)_" : ""`), computed once near the top of `watchForSection`, appended to both the
Premium stop rail and Premium target rail lines.

**Tests:** `src/lib/swing/play-brief-intel.test.ts` — added a new test pairing a stale-mark case
(markAsOf ~5h16m before `readMs`, mirroring the live repro) against a fresh-mark case (markAsOf
6 minutes before `readMs`) for both rails, asserting the caveat appears only in the stale case.
Full existing suite re-run unchanged (295/295 pass, no regressions to the extensive pre-existing
cushion/room-% coverage). RED→GREEN proven via `git stash` on the source file alone (1 fail / 294
pass without the fix, 295/295 with it). `tsc --noEmit` clean.

**Blast radius:** `watchForSection` only — purely additive text appended to two existing lines; no
cushion/room-% math, gating, or any other section touched.
