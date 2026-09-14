> **kind:** FINDING

## Vector universe snapshot's `updatedAt` is a misleading freshness signal — bumped by single-ticker appends, read "just updated" while most of the roster was ~71 minutes stale — FIXED

| **Status** | FIXED (this commit) |
|---|---|

**Root cause:** the Vector universe snapshot (`vector:universe:snapshot` in Redis, `vector-universe.ts`)
is written by two different paths — `refreshVectorUniverseSnapshot()` (the full cron-driven fan-out
rebuild of all ~57 tickers) and `ensureTickerInUniverseSnapshot()` (a single-ticker append triggered
whenever any member or Largo tool opens a ticker not yet in the roster). Both paths write
`{updatedAt: Date.now(), rows}` via `mergeUniverseSnapshot()` — and `mergeUniverseSnapshot`'s own
existing code comment already documented the consequence: "`updatedAt` is bumped to `Date.now()` on
every refresh regardless of which rows actually refreshed." So any member opening any single Vector
ticker anywhere resets the wrapper's freshness stamp for the *entire shared snapshot*, even though
only one of ~57 rows actually changed. Each row carries its own true `asOf`, but three consumers were
all reading the wrapper's `updatedAt` instead: two member-facing staleness chips
(`VectorScanner.tsx`, `VectorTickerComparisonStrip.tsx`, both built 2026-08-27 specifically to catch
a frozen 5-minute cron) and Largo's own `vector-analytics.ts` screener tool, whose own comment claims
"a scanner list is only as current as the sweep behind it" while reporting the same misleadingly-fresh
`updatedAt` as that currency.

**Evidence (live measurement, 2026-09-14):** fetched the live universe snapshot — `updatedAt` read
2.1 minutes old (because a ticker had just been opened moments earlier), while the **median row
`asOf` across all 57 tickers was 71.4 minutes old** (SPX/SPY at ~30min from a partial refresh,
one freshly-touched ticker at ~2min, everything else ~71-72min — the cron's actual last full sweep).
The staleness chips and the Largo tool both would have reported "just updated" / "fresh" the entire
time, giving no warning that the bulk of the roster hadn't refreshed in over an hour — exactly the
frozen-cron scenario those chips were built to catch.

**Blast radius:** three real consumers of the misleading `updatedAt`, all fixed at the same source:
`VectorScanner.tsx` (member-facing "Updated {age} ago" chip), `VectorTickerComparisonStrip.tsx`
(cross-ticker comparison strip's own age chip, same 2026-08-27 lineage), and
`src/lib/largo/vector-analytics.ts`'s screener block (`updated_at`/`updated_at_et`/
`updated_at_session_date`, which Largo relays to members asking "how fresh is this scanner list").

**Fix:** added `effectiveUniverseAsOf(snapshot)` to `vector-age-format.ts` — computes the MEDIAN of
every row's own `asOf` (filtering non-finite/non-positive values), falling back to the wrapper's
`updatedAt` only when no row carries a usable `asOf` (an empty or legacy snapshot; never fabricates a
timestamp). Median specifically: a single freshly-appended row must not mask a genuinely stale
roster (rules out max/latest), and a handful of tickers that never resolve (no chain, permanently
null `asOf`) must not permanently pin the whole snapshot "stale" either (rules out min/oldest) — the
median is resistant to either kind of outlier and tracks what the cron's own full fan-out actually
last touched for most of the roster. Wired into all three consumers: both UI components now compute
`effectiveUniverseAsOf(data)` once and feed that into `formatVectorAge`/`isVectorUniverseSnapshotStale`
instead of raw `data.updatedAt`; `vector-analytics.ts`'s screener block computes `screenerAsOf =
effectiveUniverseAsOf(universe)` once and derives `updated_at`/`updated_at_et`/
`updated_at_session_date` from it (each now nullable, matching the "never fabricates" contract).

**Fix rationale:** fixing at the shared `vector-age-format.ts` helper (rather than patching each
consumer's own staleness math independently) means any future consumer of the universe snapshot gets
the correct freshness signal by construction, and the three existing consumers stay in lockstep — no
consumer had to invent its own median logic. The wrapper's `updatedAt` field itself was deliberately
left unchanged (it is still useful as "last write time" for cache-debugging purposes) — only its use
as a *freshness-to-members* signal was corrected.

**Test:** RED→GREEN discipline followed via the existing regression test file's own source-scan
assertion, which explicitly asserted the OLD (bug-reproducing) call pattern
(`isVectorUniverseSnapshotStale(data.updatedAt, now)`) before this fix — updated it to assert the
corrected pattern (`effectiveUniverseAsOf(data)` feeding `isVectorUniverseSnapshotStale`) while
preserving its original intent (still asserts against a regression back to raw
`now - data.updatedAt` subtraction). Added 8 new unit tests for `effectiveUniverseAsOf` itself:
null/undefined snapshot, odd/even row-count median computation, filtering non-finite/non-positive
`asOf` values, a single fresh outlier not masking a stale roster, fallback-to-`updatedAt` when no row
has a usable `asOf`, and null-when-nothing-is-usable (never fabricates). Updated the Largo wiring
test (`vector-analytics-wiring.test.ts`'s "vector-analytics anchors as_of and the screener sweep in
ET" — this was a genuine break caught by the full suite, not written in anticipation) to assert the
corrected `screenerAsOf`-based source instead of the old raw-`universe.updatedAt` pattern. Full
`vector-age-format.test.ts` (16/16) + the four `vector-analytics*.test.ts` files (63/63 combined)
pass; `tsc --noEmit` clean.
