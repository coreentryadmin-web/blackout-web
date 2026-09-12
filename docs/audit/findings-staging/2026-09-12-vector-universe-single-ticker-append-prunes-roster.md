> **kind:** `FINDING`

## Vector universe scanner snapshot collapsed to 5 rows (from a healthy 84) — a single member-viewed ticker's "append" wipes the rest of the roster whenever it runs more than 15 minutes after the last full cron rebuild

| | |
|---|---|
| **Status** | FIXED — `fix/vector-universe-single-ticker-append-prunes-roster` |
| **Found** | 2026-09-12, live 5-engine + Ask Largo cycle, Vector health check |
| **Severity** | P1 — the shared Vector/Thermal/Largo universe scanner served a near-empty roster off-hours/weekends, and could do the same during any RTH gap longer than 15 minutes (a cron hiccup, a deploy, a genuinely slow ticker) |

### What was broken

`GET /api/market/vector/universe` (the shared scanner snapshot Vector's own UI table, Thermal's
`heatmap-warm`, and Largo's Vector tool all read) returned only **5 rows** — `O`, `OR`, `ORC`,
`ORCL`, `SPX` — when queried live on Saturday 2026-09-12 ~21:30 UTC. CloudWatch confirms the last
**healthy, complete** cron build was Friday 2026-09-11 20:00:15 UTC with **84 rows** — the
`vector-universe-snapshot` cron is correctly RTH-gated (`isEtCashRth()`) and does not fire on
weekends, so nothing should have touched the persisted snapshot since. Yet the live roster had
collapsed to a handful of individually-viewed names.

Root cause: `ensureTickerInUniverseSnapshot` (`vector-universe.ts`) is the "append one missing
ticker immediately after a member view" helper (`registerVectorUniverseView`, fired from Vector,
Thermal's gex-heatmap route, Helix's flow filter, and Largo's `get_gex_heatmap` tool). It merges its
one freshly-built row into the stored snapshot via the shared `mergeUniverseSnapshot` helper —
**using that function's DEFAULT `maxAgeMs` (`UNIVERSE_ROW_MAX_AGE_MS`, 15 minutes)**, a threshold
that `vector-universe-merge.ts`'s own header explains is tuned for the cron's own 5-minute rebuild
cadence ("long enough to ride out a multi-minute upstream outage... short enough that a ticker
genuinely dropped from the universe disappears within a few rebuild cycles").

That threshold has no relationship to `ensureTickerInUniverseSnapshot`'s own cadence, which is
**member-view-driven, not cron-driven** — a member (or a Largo chat session) can open any ticker at
any hour, including every weekday evening after the cron's RTH gate stops firing and all weekend
when it does not run at all. Every time this function runs more than 15 minutes after the last
successful cron/append write, `mergeUniverseSnapshot` ages out **every row in the stored snapshot
older than 15 minutes** — i.e. the entire previously-healthy roster — and persists just the one new
row in its place. A second view 15+ minutes later repeats the collapse against whatever the first
view left behind, converging the "universe" down to whichever handful of tickers happen to have
been viewed within the last 15 minutes of each other.

This is a different bug from the two prior, already-fixed incidents in this same file:
- The 2026-08-18 "incomplete fan-out replaces a healthy roster" bug was about
  `buildVectorUniverseSnapshot`'s OWN completeness gate (`isCompleteBuild`) — fixed by making an
  incomplete FULL rebuild merge instead of replace.
- The 2026-09-12 (same day, PR #4881) cold-spot retry fix was about individual rows resolving
  `spot: null` within an otherwise-complete build.

Neither of those touches `ensureTickerInUniverseSnapshot`'s own single-row merge call, which
silently carried the cron-tuned 15-minute prune threshold into a completely different, unbounded
cadence.

### Evidence

- Live `GET /api/market/vector/universe` (Clerk-authenticated, temp premium user, always deleted):
  `rows.length === 5`, tickers `O, OR, ORC, ORCL, SPX` — none of the static allowlist's dozens of
  names (NVDA, AAPL, TSLA, SPY, QQQ, AMD, META, ...) survived.
- CloudWatch `/ecs/blackout-production`, filter `"vector-universe-snapshot"`: last log line before
  the gap is `2026-09-11 20:00:15 UTC ... rows=84 ... elapsed=11552ms` (a healthy, complete Friday
  RTH build). Zero matching log lines exist from then through the query time (Saturday ~21:40 UTC,
  confirmed via full pagination, not a single-page false negative) — consistent with the cron
  correctly self-skipping all weekend (`{ok:true, skipped:true, reason:"Outside cash RTH"}`), and
  with nothing else in the *cron* path having touched the persisted key.
- Code trace confirms the mechanism: `ensureTickerInUniverseSnapshot` (vector-universe.ts) calls
  `mergeUniverseSnapshot(latest, [built.row], Date.now())` with no 4th argument, so it uses the
  imported default `UNIVERSE_ROW_MAX_AGE_MS = 15 * 60 * 1000` from `vector-universe-merge.ts`. That
  function's age check (`ageMs > maxAgeMs`) applies uniformly to every row in `previous`, with no
  distinction between "pruned by the cron's own periodic merge" (correct, tuned) and "pruned by an
  unrelated one-ticker append" (the bug).
- A new regression test (`vector-universe.test.ts`, "does not prune the rest of an aged (but
  still-valid) roster") reproduces this directly: seeding a 25-hour-old two-row snapshot (SPY, NVDA)
  and calling `ensureTickerInUniverseSnapshot("HOOD")` — before the fix, the persisted snapshot
  collapsed to `["HOOD"]`; after the fix it correctly holds `["HOOD", "NVDA", "SPY"]`. Confirmed
  RED→GREEN via `git stash` (test fails without the fix, passes with it).

### Fix

`ensureTickerInUniverseSnapshot`'s merge call now passes `Number.POSITIVE_INFINITY` as the 4th
`maxAgeMs` argument to `mergeUniverseSnapshot`, so this call site never expires a previously-stored
row purely for being "old" — its only job is to add the one ticker that's missing. The
`FUTURE_STAMP_TOLERANCE_MS` clock-skew guard inside `mergeUniverseSnapshot` is independent of
`maxAgeMs` and still applies unchanged, so a genuinely bad future-dated row is still dropped.
Genuine staleness-based pruning of the roster stays exactly where it already correctly happens: the
cron's own `refreshVectorUniverseSnapshot` merge (unchanged, still uses the cron-tuned 15-minute
default), which runs on the cadence that threshold was actually calibrated for.

### Blast radius

Every consumer of `listSharedUniverseTickers()`'s persisted snapshot shares this one Redis key
(`vector:universe:snapshot`): Vector's own scanner table, Thermal's `heatmap-warm` fan-out, and
Largo's Vector tool (`get_gex_heatmap` / the Vector universe read) were all reading whatever
collapsed roster this bug left behind, any time a request happened to land between full cron
rebuilds — not just on weekends. The fix is entirely inside `ensureTickerInUniverseSnapshot` (a
single call-site argument + the pure `mergeUniverseSnapshot` function it calls, already correct and
untouched); no other file needed a change.

### Files

- `src/features/vector/lib/vector-universe.ts` — the fix (`ensureTickerInUniverseSnapshot`).
- `src/features/vector/lib/vector-universe.test.ts` — new regression test.
