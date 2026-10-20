## `loadTickerTrackRecord`'s `MAX_ROOTS` cap slices in most-recent-first order BEFORE the chronological `asOfMs` filter runs, discarding exactly the chains the filter needs — can silently collapse a real ticker track record to no citation at all

> **kind:** `FINDING`

| Field | Value |
| --- | --- |
| **Status** | REPORTED, NOT FIXED — flagged for the swing-engine owner to decide the right shape (cheap pre-filter, disclosure of a clipped pool, raising the cap, or something else); not unilaterally touched, since the clean fix either widens scope into the shared `selectSwingRecordRootIds` (also used by the member-facing `/record` route) or risks a THIRD subtly-wrong ordering change in a function already fixed twice for ordering bugs (2026-09-18, 2026-09-21) |
| **Severity** | P3 (a real Largo C3/historical-context gap, bounded to tickers with a genuinely large trade history — the common case, per the file's own sizing note, has well under `MAX_ROOTS=20` roots and never triggers this) |
| **Surface** | `src/lib/swing/play-brief-ticker-history.ts` (`loadTickerTrackRecord`) |

### What it is

`loadTickerTrackRecord` builds the "desk has traded TICKER N times before" citation for the swing
play-brief. `MAX_ROOTS = 20` bounds how many chains it fetches per request (its own doc comment:
"keeps a pathological ticker (hundreds of historical rows) from fanning out into hundreds of DB
round trips"). The candidate order comes from `selectSwingRecordRootIds(rows)`
(`src/lib/swing/record.ts`), where `rows = await fetchSwingPositionsByTicker(ticker, 200)` is
`ORDER BY session_date DESC, id DESC` (most-recent-first, confirmed at `db.ts:8515-8521`) —
`selectSwingRecordRootIds` builds a `Set<number>` by scanning those rows in that same order, so
`[...roots]` preserves most-recent-activity-first ordering.

`rootIds.slice(0, MAX_ROOTS)` (line 111) keeps the 20 MOST RECENTLY ACTIVE roots — BEFORE the
temporal-ordering filter at lines 122-125 (`resolved.filter(({resolvedAtMs}) => resolvedAtMs ==
null || resolvedAtMs < asOfMs)`, added 2026-09-21 specifically to require a cited chain to have
resolved strictly BEFORE the reviewed play's own exit) ever runs. For a reviewed play that is
itself not recent (an older closed play, or any play where the ticker has accumulated meaningful
activity since), the kept 20 are exactly the chains MOST LIKELY to resolve AFTER `asOfMs` and
therefore get filtered out by the very next step — while the OLDER chains that filter needs (the
ones that genuinely resolved before the reviewed play) were already discarded by the slice and
never even fetched.

Compounding it: still-OPEN roots (added to `selectSwingRecordRootIds`'s set via
`OPEN_SWING_STATUSES.has(row.status)`, not just `graded_at`) also consume a slot in the same
slice, and an open root can structurally never satisfy `chainResolved` later — a slot spent
fetching a chain that was never going to count.

### Live impact

No field on `SwingTickerTrackRecord` or the function's return discloses that the cap (or the
open-root slot waste) ever clipped the candidate pool, so a caller reviewing an older play on a
ticker that has since accumulated significant newer activity cannot distinguish "genuinely no
prior history" from "prior history existed but was discarded by the recency-first cap before the
ordering filter ever ran." Downstream, `play-brief-intel.ts` renders `priorClosedTrades` as an
unqualified fact: *"The desk has traded **{ticker}** **{N}** times before this play: **{W}W /
{L}L**."* In the worst case (every one of the 20 kept roots resolves at/after `asOfMs`), `ordered`
is empty and the WHOLE section silently omits (line 126: `if (!ordered.length) return null`) —
degrading gracefully to no wrong number, but still erasing a real, citable track record with zero
disclosure that the erasure was a cap artifact rather than a genuine absence of history.

### Why reported, not fixed

The clean fix for the ordering half needs real design judgment this file's own history argues
should not be a drive-by call: `loadTickerTrackRecord` has already been fixed twice for temporal-
ordering bugs (2026-09-18 original chain-aware rewrite, 2026-09-21 the `asOfMs` cutoff itself), and
the natural fix — reorder candidates by proximity to `asOfMs` rather than by wall-clock recency, or
pre-filter out structurally-doomed open roots before slicing — either requires fetching more than
`MAX_ROOTS` candidates' chains to know their true resolution time cheaply (defeating the cap's own
purpose) or means touching `selectSwingRecordRootIds` in `record.ts`, which this file's own header
explicitly reuses rather than reimplementing BECAUSE the member-facing `/record` route depends on
the exact same function — widening that function's behavior for this file's benefit risks a
blast radius well beyond a single-issue PR.

### Suggested next step

Whoever owns the swing play-brief ticker-history citation should decide: (a) disclose when the cap
was hit (expose a `poolClipped: boolean`/similar on `SwingTickerTrackRecord` so
`tickerHistoryCoaching` can caveat "showing recent N of likely-more prior trades" instead of
presenting N as the complete count), (b) cheaply exclude already-known-open roots before the slice
(a local re-derivation in this file, not a change to the shared `selectSwingRecordRootIds`), (c)
raise `MAX_ROOTS` since the stated justification ("hundreds of historical rows") is itself
hypothetical — the file's own sizing note says the real closed population is ~30-40 chains
platform-wide, so a materially higher cap may cost little in practice, or (d) some combination.
Not landed here without that sign-off, given the file's own history of requiring more than one pass
to get temporal ordering right.
