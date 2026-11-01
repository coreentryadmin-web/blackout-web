> **kind:** FINDING

## Ask Largo swing play-brief: Meridian earnings-calendar truncation renders a false "not missing" claim, contradicted by the brief's own sibling section — FIXED

| **Status** | Fixed |
|---|---|

**Found by:** five-engine-largo-cycle-59 live audit (2026-11-01, Ask Largo deep-dive on QXO), per
the standing Ask Largo × Night Hawk Swings ownership mandate. Live repro: a real committed QXO
swing position's play-brief told the trader, in `meridianCatalystSection`, **"No catalysts in the
14-day Meridian window on this read — calendar is quiet, not missing."** — directly contradicted
three sections earlier in the SAME brief by `catalystsSection`'s **"Earnings: 2026-11-13 in 12 days
(afterhours)."** This is a Largo product contract **C3 (absence)** violation: a confident, false
"not missing" claim disproved by the brief's own sibling section.

### Root cause

`fetchBenzingaStructuredEarnings`'s pagination loop (`src/lib/providers/polygon.ts`) caps the
market-wide Benzinga earnings-window fetch at `MAX_EXTRA_PAGES = 20` extra pages (1 initial + 20
more = 21 total, `limit=120`/page). This cap feeds `loadBenzingaEarningsBundle`
(`src/lib/meridian/meridian-benzinga-earnings.ts`) → Meridian's timeline
(`loadMeridianEarningsTimeline`, `src/lib/meridian/meridian-timeline-server.ts`) →
`meridianCatalystSection`/`meridianPeerSection` (`src/lib/swing/play-brief-intel.ts`).

This is the **same cap** a 2026-10-18 fix (RBLX/SOFI, FINDINGS.md) already raised from 2 to 20
pages — and it is insufficient again for the current calendar density: a single reporting day
(2026-11-13) alone consumes over 120 rows across 3 pages, pushing QXO's real earnings row to **page
23** — past the 21-page ceiling the production code currently fetches (`dateGte`→`dateLte` sorted
`date.asc`, so a date this far into a dense window is simply never reached).

The pagination loop **already detects this exact condition**
(`pagesFollowed >= MAX_EXTRA_PAGES && nextPath`) but only `console.warn`ed it — the truncation
signal existed and was computed correctly, but was discarded rather than propagated to any caller.
Every consumer therefore saw a plain `rows: []` (for this ticker, after per-ticker filtering)
indistinguishable from a genuinely complete, quiet-calendar read.

### Why a bigger cap alone is not the fix

The 2026-10-18 fix already tried "raise the cap" once; it bought three weeks before the next
denser calendar week broke it again. A static page cap on a date-sorted market-wide fetch will
always eventually be exceeded by a sufficiently dense reporting day — the real fix has to let the
zero-items path distinguish "genuinely quiet calendar" from "fetch truncated, cannot claim quiet,"
regardless of where the cap sits. `MAX_EXTRA_PAGES` was left at 20 (not raised again) — the
disclosure propagation below is the actual fix and is cap-size-independent.

### Fix

Threaded a `truncated: boolean` flag from `fetchBenzingaStructuredEarnings`'s pagination loop (the
exact `pagesFollowed >= MAX_EXTRA_PAGES && nextPath` condition that already drove the `console.warn`)
up through every layer in the chain:

1. `BenzingaPartnerFetchResult<T>.truncated` (`polygon.ts`) — set on `fetchBenzingaStructuredEarnings`'s
   return; absent/false on any single-page (non-paginated) fetch.
2. `BenzingaEarningsBundle.window_truncated` (`meridian-benzinga-earnings.ts`) — forwarded from the
   market-wide `windowRes.truncated`; `false` in the bundle's own `.catch()` fallback (that path
   means the whole bundle build threw, a separate, already-`error`-flagged failure mode, not this
   specific pagination condition).
3. `MeridianEarningsTimelineResult.window_truncated` (`meridian-timeline-server.ts`) — forwarded
   from the bundle.
4. `MeridianTimelinePayload.earnings_window_truncated` (`features/meridian/lib/meridian-types.ts`)
   + `meridian-snapshot.ts`'s `loadMeridianTimelineResponse` — forwarded onto the public payload.
5. `SwingMeridianCatalystSlice.window_truncated` (`play-brief-meridian.ts`) — `fetchMeridianForTicker`
   reads it off the timeline payload onto the per-ticker Largo slice.
6. `meridianCatalystSection` (`play-brief-intel.ts`) — the zero-items branch now checks
   `slice.window_truncated`: when true, renders *"Meridian's market-wide earnings calendar fetch
   was truncated this read (hit its page cap before finishing) — cannot confirm this ticker has no
   catalyst in the 14-day window, not evidence the calendar is quiet."* instead of the previous
   unconditional "calendar is quiet, not missing." The genuinely-quiet (not truncated) case is
   unchanged.

### Secondary symptom (same root cause): missing "Earnings peer lens" section

QXO's brief was also missing its "Earnings peer lens" section entirely. `meridianPeerSection`'s
caller chain (`pickEarningsForSwingPeer`, `src/lib/swing/play-brief-meridian-peer-core.ts`) finds no
matching item in the (truncated) `ctx.meridian.items` and `meridianPeerSection` returned `null`
before reaching any fallback text — the section simply never appeared, identical from the reader's
side to a name with no earnings in the next 14 days.

Fixed at the same section-assembly layer: `meridianPeerSection` now checks, when no matching
earnings item was found, whether `ctx.meridian.window_truncated` is true AND the ticker is not one
of the market-wide index proxies (`SWING_MERIDIAN_INDEX_TICKERS` — those never get a per-name peer
item regardless of truncation, so the disclosure must not fire for them). When both hold, it
renders *"Cannot confirm this ticker's earnings peer lens — Meridian's market-wide calendar fetch
was truncated this read, not evidence this ticker has no upcoming print."* instead of silently
returning `null`. The disclosure also carries the same CLOSED-bucket "not what this trade traded
under" prefix every sibling return site in this file already carries, for consistency.

### Blast radius

All consumers of the market-wide Benzinga earnings window share this one root cause and are all
fixed by the same propagated flag:
- Meridian's own timeline (`loadMeridianTimelineResponse`'s `items`, consumed by the Meridian desk
  UI and `MeridianDesk.tsx`) — now carries `earnings_window_truncated` on its payload, available to
  any future UI consumer even though this fix's own rendering change is scoped to Largo's swing
  play-brief.
- Largo's `get_meridian_timeline` tool reads the same timeline payload.
- Swing's "Meridian catalysts" section (`meridianCatalystSection`) — primary fix.
- Swing's "Earnings peer lens" section (`meridianPeerSection`) — secondary fix, same root cause.

`loadBenzingaBoardEarnings` (the per-board-ticker fetch `loadMeridianEarningsTimeline` also merges
in) is a separate, single-page, explicitly-ticker-filtered fetch that never calls with
`paginate: true` — it cannot experience this specific pagination-cap truncation and was left
untouched; a board ticker genuinely missing from that fetch is a different, pre-existing gap out of
this fix's scope.

### Tests (RED → GREEN)

- `src/lib/providers/benzinga-earnings-pagination.test.ts` — extended the existing two real-pagination
  tests (mocked `polygonTrackedFetch`, the loop runs for real) to assert `res.truncated === false`
  on a fully-paginated fetch and `res.truncated === true` when the safety cap is hit with real pages
  still unread.
- `src/lib/meridian/meridian-benzinga-earnings.test.ts` — 3 new tests: `loadBenzingaEarningsBundle`
  forwards `truncated: true` as `window_truncated: true`; forwards an explicit `false` unchanged;
  and treats an absent `truncated` field (the single-page-fetch shape) as `false`.
- `src/lib/swing/play-brief-intel.test.ts` — 5 new tests: `meridianCatalystSection` renders the
  honest "cannot confirm — truncated" wording (never "quiet, not missing") when
  `window_truncated: true` and zero items (live QXO repro), and still renders the original "quiet,
  not missing" wording unchanged when `window_truncated: false` (no regression);
  `meridianPeerSection` renders its own "cannot confirm" disclosure instead of silently returning
  `null` when truncated with no matching item (live QXO repro), still returns `null` when not
  truncated (no regression), and still returns `null` for an index ticker even when truncated
  (truncation disclosure must not apply where the section was never going to cover the ticker
  anyway).

RED→GREEN proved by reverting the 7 non-test source files to `origin/main` (git checkout) while
keeping the test edits: all 3 pagination-layer assertions and both `meridianCatalystSection`/
`meridianPeerSection` truncation-specific tests failed (undefined vs. expected true/false; "cannot
confirm"/"truncated" wording absent); the no-regression companion tests still passed unchanged.
Restored the source files: all tests pass (358/358 across the two main suites, 744/744 across the
full affected-suite run below). `npx tsc --noEmit`: clean.

**Affected test suites run clean:** `benzinga-earnings-pagination.test.ts`,
`meridian-benzinga-earnings.test.ts`, `meridian-benzinga-earnings-core.test.ts`,
`play-brief-intel.test.ts`, `play-brief-meridian.test.ts`, `play-brief-narrative-coaching.test.ts`,
`play-brief-absence.test.ts`, `play-brief-context.test.ts`, `largo/registry/registry.test.ts`
(744 pass, 0 fail).

### Known follow-up (noted, not actioned — out of scope for this fix)

`loadBenzingaEarningsBundle`'s own `.catch()` fallback (a thrown exception anywhere in its
`Promise.all`, not specifically this pagination condition) reports `window_truncated: false` —
conservative and consistent with that same fallback's pre-existing `entitled: true` convention, but
it means a full bundle-build failure is NOT currently routed through the same "cannot confirm"
disclosure this fix adds for the narrower truncation case. That failure mode is already partially
surfaced via the bundle's own `error` field (not currently threaded onto the public timeline payload
at all — a separate, pre-existing gap), and via `fetchMeridianForTicker`'s outer
`withBriefSourceTimeout` catch producing `meridianUnavailableSlice()` for a hard timeout. Left as a
documented gap rather than widened into this fix, per the task's scope discipline.
