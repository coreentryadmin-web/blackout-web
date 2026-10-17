> **kind:** FINDING

## `vectorDeskSection`'s stale-Vector early return made PR #6115's own closed-market disclosure fix unreachable — FIXED

| **Status** | FIXED |
|---|---|
| **Severity** | P2 |
| **Area** | Night Hawk Swings — `src/lib/swing/play-brief-intel.ts`, `vectorDeskSection()` |
| **Found by** | Ask Largo × Night Hawk Swings standing mandate, post-merge verification cycle (independent background re-check of PR #6115) |

### Root cause

PR #6115 (merged earlier the same session, `701b5bcb`) added a `bucket === "closed"` branch to
`vectorDeskSection()` that calls the new `closedMarketSessionNote()` helper (`play-brief-absence.ts`)
so a CLOSED-bucket Largo play-brief read discloses when a fresh-looking compute is actually reporting
on a shut market (Largo C2 — "a stale reading presented as merely delayed, not session-closed").

The function's pre-existing structure put an UNCONDITIONAL `if (vectorStale) { ...; return ...}`
branch *before* the new `bucket === "closed"` branch. `vectorStale` is Vector's own snapshot-age
staleness (`vectorSnapshotStale`, threshold 120s) — and a real CLOSED-bucket read almost always has
a Vector snapshot older than that, because the position's own data is from whenever it closed and
Vector's live feed stops updating once the market shuts. So on essentially every real off-hours/
weekend CLOSED read, the function returned from the generic "Last snapshot ... may lag spot" branch
before ever reaching the `bucket === "closed"` branch — making PR #6115's fix dead code in exactly
the scenario it was built for.

This was not caught by PR #6115's own regression test
(`vectorDeskSection: CLOSED bucket also surfaces Vector's market_session_note`) because that test's
fixture used `freshness: "live", dataAgeMs: 0` — i.e. NOT Vector-stale — so it only ever exercised the
`bucket === "closed"` branch directly, never the real production combination
(`vectorStale === true` AND `bucket === "closed"`).

Two sibling sections named as "fixed" by the same PR (`chartTechnicalsSection`, `wallDynamicsSection`)
self-omit entirely under the identical stale condition, by design deferring to `vectorDeskSection` for
the grade/staleness disclosure (see their own code comments) — so the net effect was that 3 of the 5
sections PR #6115 named never actually surfaced the disclosure off-hours; only the two sections gated
on GEX-matrix staleness instead of Vector staleness (`gexPostureSection`, `chartLevelsSection`) worked.

### Evidence

Live-reproduced 2026-10-17 (Saturday, market closed since Friday) against two real CLOSED positions
(`SWING:TSLA:57`, `SWING:GOOGL:58`) via `GET /api/market/swing/play-brief`. Both envelopes' "Vector
desk" section read exactly `**Last snapshot** (~Ns old) — Vector desk read may lag spot.` with zero
occurrences of "CLOSED"/"market is"/"last session" — while the SAME envelopes' "GEX posture"/"Levels
on chart" sections correctly carried the market-closed disclosure, proving the underlying
`closedMarketSessionNote()`/`gexMarketSessionNote()` machinery is sound and the gap is specific to
`vectorDeskSection`'s own branch ordering.

RED→GREEN: a new test (`vectorDeskSection: CLOSED bucket reaches the closed-market disclosure even
when Vector itself is stale`) constructs the exact combination the live positions hit
(`dataAgeMs: 999_000` with `bucket: "closed"`, fixed `readMs` anchored to a known-CLOSED Sunday, fresh
GEX fallback data) — confirmed failing against the unmodified source (`git stash` of the source fix
alone) with the exact live failure text (`**Last snapshot** (~999s old) — Vector desk read may lag
spot.`), then passing once the fix was restored.

### Fix

Reordered `vectorDeskSection()` so the `bucket === "closed"` check runs BEFORE the `vectorStale`
early return, rather than after. A closed-bucket read now always takes its own framing ("Current
Vector read: grade **X** · conviction **Y** (since this play closed)" + `closedMarketSessionNote()`,
which itself already falls back to the GEX matrix when Vector is stale) regardless of Vector's own
staleness. OPEN/WATCH buckets are completely unchanged — the `vectorStale`/live-directive branches
below still apply exactly as before for those two buckets, since only CLOSED now short-circuits ahead
of them.

No change was needed in `chartTechnicalsSection`/`wallDynamicsSection` — their self-omission under
`vectorStale` is an intentional design choice deferring to `vectorDeskSection` as the one canonical
place the grade/staleness note lives (see their own code comments); fixing the one place it actually
lives resolves the cascade without touching either sibling.

### Blast radius

Single call site/root cause — `vectorDeskSection()` is Largo's only renderer of the "Vector desk"
section across Swings' WATCH/OPEN/CLOSED buckets. No other function duplicates this branch order.
