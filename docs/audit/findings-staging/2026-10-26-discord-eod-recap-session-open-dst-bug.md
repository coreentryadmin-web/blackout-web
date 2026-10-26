> **kind:** `FINDING`

## HELIX + dark pool Discord EOD recap filtered the session window from a hardcoded EDT-only "9:30 AM ET" constant — leaked an hour of pre-market flow into the recap under EST — FIXED

**Status.** FIXED (same PR).

### Area

`src/lib/discord-eod-recap.ts` — the ~4:05 PM ET "session recap" Discord embeds for HELIX
whale-flow and dark-pool-block channels (`buildHelixEodRecapEmbed`/`buildDarkpoolEodRecapEmbed`,
via `filterHelixSessionFlows`/`filterDarkpoolSessionPrints`). Non-owned lane.

### Root cause

`sessionOpenMs(sessionDate)` hardcoded the session's 9:30 AM ET open as `"${sessionDate}T13:30:00.000Z"`,
with its own comment admitting "(EDT approx; filter is coarse)". 13:30 UTC is 9:30 AM ET **only**
under EDT (UTC-4, roughly mid-March to early November). Under EST (UTC-5, early November to
mid-March), 9:30 AM ET is **14:30 UTC**, not 13:30 — so the hardcoded constant actually pointed at
8:30 AM ET, an hour before the real open. Every flow/print timestamped between 8:30 and 9:30 AM ET
(genuine pre-market activity) would be incorrectly counted as "this session's" flow by
`filterHelixSessionFlows`/`filterDarkpoolSessionPrints`, inflating the recap's "N qualifying
prints" count, total premium, and leaderboard with pre-market data presented as regular-session
activity. DST ends 2026-11-01 (first Sunday of November) — this bug was dormant all summer/fall
under EDT and was about to start firing for real within days of this finding.

### Evidence

Confirmed via `Intl.DateTimeFormat` directly: formatting a fixed UTC instant with
`timeZone: "America/New_York", timeZoneName: "shortOffset"` returns `GMT-4` for 2026-10-26 (EDT,
in effect today) and `GMT-5` for 2026-11-15 (EST) — the two-sided boundary the hardcoded constant
never accounted for.

RED→GREEN: added two regression tests using a post-DST-end session date (`2026-11-16`, EST in
effect) with one pre-market flow/print (8:45 AM ET) and one genuine RTH flow/print (10:00 AM ET).
Pre-fix (`git stash` on the lib-only change): both new tests fail — the pre-market item is
incorrectly kept (2 kept instead of 1). Post-fix: 9/9 pass in
`discord-eod-recap.test.ts`.

### Fix

Replaced the hardcoded constant with a DST-correct `sessionOpenMs`: a new helper,
`etUtcOffsetHours(sessionDate)`, reads America/New_York's actual UTC offset at noon UTC on that
calendar date (safely past the 2 AM local DST transition, so the one date-dependent read never
straddles the flip) via `Intl.DateTimeFormat`'s `shortOffset`, then `sessionOpenMs` derives the
correct UTC hour for 9:30 AM ET from that offset (`9 - offsetHours`) instead of a fixed string.

### Blast radius

`sessionOpenMs` in this file is module-local (not exported) with exactly two call sites, both in
this same file (`filterHelixSessionFlows`, `filterDarkpoolSessionPrints`) — confirmed via
`grep -rn "sessionOpenMs" src` that every other same-named symbol in the repo
(`src/lib/largo/temporal/timeframe.ts`'s exported `sessionOpenMs(ms)`, a different
signature/module, Largo-owned) is an unrelated, differently-shaped function. No other consumer
touched.

### Tests

`npx tsc --noEmit` clean. Full suite: 16970 pass / 0 fail / 3 skipped (pre-existing, unrelated).
