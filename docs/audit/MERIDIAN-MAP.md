# MERIDIAN — THE MAP

**Phase 0 deliverable of the MERIDIAN owner lane (`docs/agents/briefs/meridian.md`).**
Living inventory. Kept current forever after — when this file and the code disagree, the code
wins and this file is a bug.

Its job is to let a stranger answer, for every displayed field: *what is this · where does it come
from · how is it calculated · what source generated it · when was it last updated · what units ·
what makes it unavailable · how do we know it is correct · where else is this value consumed.*

**Where an answer is not known, this file says `UNKNOWN`.** An honest gap is a finding; a
plausible guess is a lie that outlives whoever wrote it. Every `UNKNOWN` below is a work item.

> **Provenance.** Everything marked *verified* was read out of the code at `17eb87e5`
> (2026-08-22) or measured against live Polygon/Benzinga/UW data on 2026-08-22. Every number in
> §2 and §6 is from a run performed for this document, not carried over. §6 is what Phase 0
> found; §7 is what it could not establish.

---

## 1. Coordinates

**The member route is `/meridian`.** `src/app/(site)/meridian/page.tsx` →
`requireDeskTool("premium", "meridian")` → `<MeridianPageShell>`, else `<ComingSoon>`.
`force-dynamic`, `noindex`.

| Area | Where | Count |
|---|---|---|
| Engine / lib | `src/lib/meridian/` | 48 files, 14,642 lines (27 `*.test.ts`) |
| Feature lib | `src/features/meridian/lib/` | 8 files (4 tests) — thin: types, timeline build, deeplink, search |
| Components | `src/features/meridian/components/` | 20 files — 18 `.tsx`, 2 tests |
| Member APIs | `/api/market/meridian/{event,timeline,lookup}` | 3 |
| Cron | `meridian-warm` | 1 |
| Largo tools | `get_earnings`, `get_earnings_calendar`, `get_earnings_history`, `get_earnings_market`, `get_meridian_event`, `get_meridian_timeline` | 6 |
| Audit harnesses | `scripts/audit/meridian-*.mjs` | 8 |

All three member routes gate identically: `authorizePremiumDeskApi(req)` then
`requireToolApi("meridian")`, and all three serve `NO_STORE_HEADERS`.

### Test baseline

**495 pass / 0 fail**, Node 20.20.2, at `17eb87e5`, across **39 Meridian test files** — 33 in
the engine and feature dirs (436 tests) plus 6 at the repo root (59 tests):

```
node --import tsx --experimental-test-module-mocks --test \
  src/lib/meridian/*.test.ts src/features/meridian/lib/*.test.ts \
  src/features/meridian/components/*.test.ts        # 436 pass / 0 fail  (33 files)
node --import tsx --experimental-test-module-mocks --test src/meridian-*.test.ts   #  59 pass / 0 fail  (6 files)
```

The root-level ones are easy to miss and are not optional: `meridian-invariants`,
`meridian-earnings-cohort` and four `meridian-audit-*` suites live in `src/`, not under
`src/lib/meridian/`. Quote 495 as the baseline. A Node 22 run is not evidence, and neither is a
run before `npm ci`.

This container had Node 20 pre-installed at `/opt/node20/bin` and **an empty `node_modules`** —
check both, per `_COMMON.md` §2.

---

## 2. THE REACTION SPINE — read this before touching any earnings number

This is the load-bearing fact about MERIDIAN. **An earnings "reaction" is not a price change; it
is a price change over a window chosen by when the company reported.** Choose the window wrong
and the number does not get less accurate, it points the other way.

The lane has paid for this twice already (both in `CLAUDE.md`), and §6 records that half of it is
still unpaid.

### 2.1 The trace — verified live, MSFT, 2026-08-22

Six prints, every step named, every output checked by hand against raw Polygon bars.

| # | Function | File | Result |
|---|---|---|---|
| 1 | `benzingaTickerWindow(6)` | `meridian-benzinga-earnings-core.ts:560` | `lookbackDays=630`, `limit=18` |
| 2 | `loadBenzingaTickerEarnings` → `fetchBenzingaStructuredEarnings` | `meridian-benzinga-earnings.ts` / `polygon.ts:630` | `GET /benzinga/v1/earnings?ticker=MSFT&date.gte=2024-11-30&limit=18&sort=date.desc` → 11 rows |
| 3 | `benzingaRowsToPrintHistory(rows, 6)` | `meridian-benzinga-earnings-core.ts:261` | 6 settled prints (rows carrying an `actual_eps`/`actual_revenue`) |
| 4 | `classifyPrintTiming(report_time_et)` | `meridian-reaction-core.ts` | all six `16:05`–`16:07` → **`amc`** |
| 5 | `barWindowForDates` → `barLimitForWindow` | `meridian-reaction.ts` / `meridian-reaction-core.ts` | `from=2025-04-16 to=2026-08-22`, 493 calendar days → **`limit=363`** |
| 6 | `fetchStockDailyBars(MSFT, …, 363)` | `polygon.ts` | 339 bars, `2025-04-16 … 2026-08-21` |
| 7 | `reactionsForPrints(bars, prints, openSessionYmd())` | `meridian-reaction-core.ts` | table below |

```
print       timing  reaction_basis     reaction_measure      reaction_pct  session_change_pct  settled
2026-07-29  amc     amc_next_session   prior_close_to_close      15.51           3.01           true
2026-04-29  amc     amc_next_session   prior_close_to_close      -3.93          -0.74           true
2026-01-28  amc     amc_next_session   prior_close_to_close      -9.99          -1.48           true
2025-10-29  amc     amc_next_session   prior_close_to_close      -2.92          -0.89           true
2025-07-30  amc     amc_next_session   prior_close_to_close       3.95          -3.91           true
2025-04-30  amc     amc_next_session   prior_close_to_close       7.63          -1.32           true
```

**Step 7 checked by hand off the raw bars, 6/6 MATCH.** e.g. `2026-07-29` → anchor session
`2026-07-30`, prior close `390.54` → close `451.10` = `+15.51%`.

Two of the six are the defect this machinery exists to prevent, live: `2025-07-30` and
`2025-04-30` have `session_change_pct` of **−3.91%** and **−1.32%** against reactions of
**+3.95%** and **+7.63%**. A naive open→close read reports those two prints as losses. They were
gains. (`2025-04-30` is the MSFT case named in `meridian-reaction-core.ts`'s own comment —
**independently reproduced here**, not quoted from it.)

**Step 5 is the other paid-for trap, also live.** The window is 493 calendar days; the derived
limit is 363. The old hardcoded `120` would have dropped **243 sessions off the RECENT end**
(Polygon serves `sort=asc`), i.e. every reaction after roughly mid-2025 would read `null` —
presenting as "we have no data" rather than as a truncated fetch. `barLimitForWindow` holds at
both call sites in `meridian-reaction.ts` (index bars and stock bars); no other caller exists.
**Verified: the truncation trap is fixed and stays fixed.**

### 2.2 What each measure means

`reaction_basis` says WHICH session; `reaction_measure` says HOW it was read; `reaction_settled`
says whether that session has closed. All three are computed, typed, and returned.

| `reaction_basis` | anchor session | set when |
|---|---|---|
| `bmo_session` | the report date itself | `time` ≤ 09:30 ET |
| `amc_next_session` | the next session in the bar series | `time` ≥ 16:00 ET |
| `assumed_report_session` | the report date itself, **assumed** | `time` strictly inside RTH, or absent |

| `reaction_measure` | read | used for |
|---|---|---|
| `session_open_to_close` | anchor open → anchor close | BMO, settled — **see §6.1, this is wrong** |
| `prior_close_to_close` | last close before the print → anchor close | AMC, settled |
| `session_open_to_last` / `prior_close_to_last` | same, far end is the last trade | anchor session still open |

---

## 3. Data lanes — where every displayed value comes from

| Surface | Loader | Upstream | Cache |
|---|---|---|---|
| Timeline | `loadMeridianTimelineResponse` (`meridian-snapshot.ts`) | UW macro calendar + Benzinga structured earnings + UW FDA + local OpEx math | `meridian:timeline:v1:{etYmd}:{days}`, **120s** |
| Event detail | `loadMeridianEventResponse` | per-kind loader below | `meridian:event:v1:{id}`, **120s** |
| Earnings detail | `loadMeridianEarningsEventDetail` | Benzinga structured + Polygon daily bars + Polygon chain + UW flow/darkpool | inherits the event key |
| Print history | `loadMeridianEarningsPrintHistory` | Benzinga `/benzinga/v1/earnings` + Polygon `/v2/aggs` | `meridian:benzinga:ticker:{sym}:{event}:p{n}`, **10 min**; bars `meridian:bars:*`, **30 min** |
| Macro brief | `buildMeridianMacroBrief` | UW `/api/economy/{id}` + Polygon SPX daily/minute | via event key |
| OpEx brief | `buildMeridianOpexDetail` | Polygon GEX heatmap (max pain) + SPX desk | shared heatmap cache |
| FDA brief | `buildMeridianFdaDetail` | UW FDA calendar + Polygon bars | via event key |
| Ticker lookup | `loadMeridianTickerLookup` | Benzinga structured earnings | **uncached** — the route calls the loader directly |

TTLs are literals in `meridian-snapshot.ts` (`MERIDIAN_TIMELINE_TTL_MS`, `MERIDIAN_EVENT_TTL_MS`
= `120_000`). **Neither is env-tunable**, so unlike the SPX desk lanes there is no production
override to check — the code value is the deployed value. *(Verified by grep: no `process.env`
reference in `src/lib/meridian/`.)*

### The two facts that make the timeline honest

`loadMeridianTimelineResponse` publishes coverage counters alongside the values —
`non_optionable_hidden`, `expected_move_coverage`, `sectors_classified` /
`sectors_unclassified`, `earnings_calendar_entitled`. This is `_COMMON.md` §7 discharged: a
quietly shorter list is indistinguishable from a quietly broken feed, and a null
`expected_move_pct` means either "no chain" or "not queried" — the counters say which.

`loadBenzingaTickerEarnings` **throws** on a failed fetch so the cache stores nothing, and
carries the error forward as `history_error` / `calendar_error`. A failure that cached as
`{rows: []}` once rendered as "this company has no earnings history" for ten minutes
(FINDINGS 2026-08-18).

---

## 4. The Largo boundary — six tools

| Tool | Handler | Source | Reads Meridian's own engine? |
|---|---|---|---|
| `get_meridian_timeline` | `run-tool.ts:1597` | `loadMeridianTimelineResponse` + `meridian-timeline-for-largo` | yes |
| `get_meridian_event` | `run-tool.ts:1663` | `loadMeridianEventResponse` + `meridian-event-id` | yes |
| `get_earnings` | `run-tool.ts:790` | Benzinga structured + `loadMeridianEarningsPrintHistory` + UW | yes |
| `get_earnings_history` | `run-tool.ts:846` | UW `/api/earnings/{t}` only | **no** |
| `get_earnings_market` | `run-tool.ts:1458` | UW premarket/afterhours | **no** |
| `get_earnings_calendar` | `run-tool.ts:1715` | Alpha Vantage via `callInternalApiRead` | **no** |

**Contract compliance, verified by reading each handler:**

- **C1 (time).** `get_earnings_market`, `get_meridian_timeline` and `get_meridian_event` all
  stamp `as_of` + `as_of_session` + `as_of_weekday` from `todayEtYmd()`/`etStamp()`, never a bare
  UTC instant. `get_earnings` and `get_earnings_history` carry **no `as_of` at all** — see §7.
- **C3 (absence).** Both Meridian tools distinguish `bad_event_id` / `event_lookup_failed` /
  `not_found`, and say in the payload that a read failure is *not* evidence of absence.
  `get_earnings` carries `calendar_error` for the same reason.
- **Units.** `normalizeUwEarnings` (`uw-earnings-normalize.ts`) converts UW's unlabelled
  fractions to `_pct` numbers on all three UW-backed tools. Verified live 2026-08-22 against
  `/api/earnings/WMT`: every fraction field the live payload carries
  (`expected_move_perc`, `post_earnings_move_{1d,3d,1w,2w}`, `pre_earnings_move_*`,
  `{short,long}_straddle_*`) is in the rename table. **No gap.**
- **Payload size.** `meridian-timeline-for-largo` drops `earnings_analytics_rows` (111,348 of the
  raw payload's 151,595 chars) and says so, and fetches the cron-warmed 21-day window rather than
  the caller's, so a tool call rides the warm entry.

---

## 5. Cron

`meridian-warm` → `/api/cron/meridian-warm` → `warmMeridianCaches(21)`, which warms three things
in parallel: the 21-day timeline, the SPX GEX matrix, and SPX desk enrichment. It returns **202
immediately** and does the work in `after()` so the handshake stays under the edge timeout;
`logCronRun` records the dispatch, **not the outcome**.

It gates on `shouldRunCacheWarmer` → `isEtExtendedWarmHours` = weekday, trading day,
**04:00–20:00 ET**. That is an ET wall-clock gate on a fixed-UTC EventBridge rule, which is
exactly the class-A silent-drift shape `scripts/audit/cron-dst-audit.mjs` exists to catch —
but a 16-hour band is wide enough to bracket its window in both offsets, which that harness
classifies as CORRECT rather than drift. **Not verified here** — see §7.

---

## 6. WHAT PHASE 0 FOUND

### 6.1 — P1. The BMO half of the reaction anchor has the exact defect the AMC half was fixed for

**43.6% of all settled prints are BMO, and every one of them is read `open→close`, which excludes
the premarket gap that IS the reaction.**

`reactionForPrint` reads a pre-open print as `session_open_to_close`. Its stated rationale is
*"a pre-open print is read open→close, because the market has that whole session to price it."*
That is false for a print released before the bell: the premarket prices it, and it arrives as an
opening gap that an open→close read starts *after*.

This is the same argument the AMC path already accepts. `meridian-reaction-core.ts` says of AMC:
*"an open→close read on the anchor session would skip the gap that is the reaction."* A 07:00 ET
release is priced in the two and a half hours before the open for the same reason a 16:05 release
is priced overnight.

**Evidence — one named print, live 2026-08-22.** WMT, reported `2026-08-20` at **07:00:00 ET**
(Benzinga `time`; `classifyPrintTiming` → `bmo`):

```
prior close 2026-08-19   114.30
2026-08-20  open 106.38  close 103.84
  premarket gap                                     -6.93%
  Meridian get_earnings   reaction_pct              -2.39%   (session_open_to_close)
  UW get_earnings_history post_earnings_move_1d_pct -9.15%
```

Two Largo tools, one print, one model — **6.76 percentage points apart**, because one includes
the gap and one does not. A member asking "how did WMT trade its print" gets a different answer
depending on which tool Largo happened to call.

**Evidence — the cohort.** 519 settled BMO prints across 120 `importance>=4` tickers,
2025-08 → 2026-08, Benzinga timings, Polygon daily bars:

```
mean |open→close − prior_close→close|   4.31pp
median                                  2.86pp
p90                                    10.04pp
max                                    30.94pp
SIGN FLIPS                            140/519 = 27.0%
```

**27% of BMO prints are displayed pointing the wrong way.** The worst are not marginal:

```
DDOG  2026-08-06   served  +0.81%   actual  -19.03%   (gap -19.68%)
PODD  2026-08-05   served  +4.11%   actual  -20.12%   (gap -23.27%)
SE    2026-03-03   served  +9.23%   actual  -16.53%   (gap -23.58%)
ONON  2025-11-12   served  -5.31%   actual  +17.99%   (gap +24.62%)
VWDRY 2026-08-12   served  -1.01%   actual  +19.32%   (gap +20.53%)
```

DDOG fell 19% on its print and Meridian displays it as a small gain.

**Blast radius.** Everything downstream of `reaction_pct` for a BMO print:
`MeridianEarningsHistoryPanel` (implied-vs-realized, which is now comparing an implied *move* to
a partial one), `MeridianEarningsIntelPanel`, `MeridianEarningsTabs`, `printHistorySummary`'s
"avg reaction", and `get_earnings`/`get_meridian_event` at the Largo boundary.

**Why it was not caught.** The AMC fix was written as a fix to the *AMC* case — the measurement
that drove it (206 post-close prints) never sampled a pre-open one, so the symmetric question was
never asked. The tests assert the AMC branch anchors to the next session; none asserts the BMO
branch is measured correctly, because open→close was the assumed-correct baseline both branches
were compared against.

*Fix not written — Phase 0 gate. Ready to follow immediately; see the note at the end of §6.*

### 6.2 — P2. `reaction_basis` and `reaction_settled` reach the UI and no component reads them

`meridian-types.ts:406` instructs, of `assumed_report_session`: *"Mark these in the UI."* The
brief repeats it: *"`assumed_report_session` must be marked in the UI as assumed, never presented
as measured."*

Grep of `src/features/meridian/**`: `reaction_basis`, `reaction_measure` and `reaction_settled`
appear **only in the type definition**. All three render sites print the bare number —

```tsx
· {fmtPct(row.reaction_pct ?? row.session_change_pct)} reaction
```

— in `MeridianEarningsTabs.tsx:485`, `MeridianEarningsIntelPanel.tsx:110`, and (as `moves`)
`MeridianEarningsHistoryPanel.tsx:37`. Two distinct member-visible consequences:

**(a) An assumed session is presented as a measurement.** Cohort, live 2026-08-22, 11,956 settled
Benzinga prints 2026-02-01 → 2026-08-21:

```
bmo      5,211  43.6%
amc      6,526  54.6%
unknown    219   1.8%   → reaction_basis "assumed_report_session"
   of which: 0 have no time field; all 219 carry a time INSIDE RTH
importance>=3: 25/4,589 (0.5%)   importance>=4: 11/2,085 (0.5%)
```

Small, and honestly reported with its cohort — but the error when it lands is not small. Over
those 25 `importance>=3` prints, the displayed number against what it would be if the print were
in fact AMC: **mean |delta| 3.52pp, median 2.82pp, max 15.24pp, and 12/25 = 48% carry the
opposite sign.** e.g. `ASMIY 2026-03-03` displays **+11.60%**; read as AMC it is **−3.64%**.
The member cannot tell these apart from a measured one.

**(b) A still-moving number is presented as settled.** `reaction_settled: false` and the
`*_to_last` measures exist precisely because a same-session print's reaction is still forming —
measured on prod 2026-08-21 at 09:46 ET, BEKE moved from −4.74 to −4.24 between two reads a
minute apart. The payload now says so. **The UI still does not.** During RTH this affects every
one of today's BMO prints, not 1.8% of them.

The Largo boundary is *not* affected: `print_history` carries all three fields to the model.
This is a UI-only gap — which is the shape `_COMMON.md` §6b names, a correct payload with a
lossy consumer.

*Fix not written — Phase 0 gate.*

### 6.3 — P3, observation. `get_earnings_history`'s description names a field the payload lacks

The tool description promises *"`reaction_pct` is the print reaction,
`(post_close-pre_close)/pre_close x100`"*. Live `/api/earnings/{ticker}` rows sampled 2026-08-22
(WMT, DDOG, PODD, SE, ONON) carry **no `reaction` key at all** — the equivalent value is served
as `post_earnings_move_1d`, which the normalizer correctly renames to
`post_earnings_move_1d_pct`. So the description points the model at a field that will not be
there and stays silent about the one that will. Low severity (the units are right and the value
is present under its own name), but it is a boundary description that no longer matches the wire.

### 6.4 — GREEN, verified, do not re-litigate

- **Bar-limit truncation** — `barLimitForWindow` is used at both surviving call sites; the MSFT
  trace shows it deriving 363 where a fixed 120 would have lost 243 recent sessions. Fixed.
- **AMC anchoring** — six of six MSFT prints hand-checked; two would invert under a naive read.
  Fixed and demonstrably working.
- **UW unit normalization** — every fraction field on the live payload is in the rename table.
- **Cache-key collisions** — the Benzinga ticker cache key includes the print count, so two
  callers wanting different sample sizes cannot share an entry.
- **Coverage counters** — the timeline publishes what it filtered and what it could not classify.

> **On the Phase 0 gate.** The charter says *"do not open a fix PR until Phase 0's deliverable is
> merged"*, so §6.1 and §6.2 are documented here rather than fixed. Both fixes are scoped and
> ready. §6.1 needs a decision recorded before it is written — see §7.

---

## 7. UNKNOWN — every line here is a work item

1. **Is `prior_close_to_close` the right read for a BMO print, or is a premarket-aware read
   better?** §6.1 establishes that `session_open_to_close` is wrong. It does not establish which
   replacement is right. `prior_close_to_close` matches UW and is symmetric with the AMC path,
   but a stock that drifted overnight on unrelated news attributes that drift to the print.
   A premarket-VWAP-anchored read is the third option and needs Polygon minute bars to evaluate.
   **Measure before choosing.**
2. **`meridian-warm`'s deployed UTC schedule.** `blackout-infra` is not in this session, and
   `cron-dst-audit.mjs` refuses a verdict without the manifest — correctly. The 04:00–20:00 ET
   band is wide enough that drift is unlikely, but "unlikely" is not "checked".
3. **Whether `logCronRun("meridian-warm")` can ever report a real failure.** The route logs the
   *dispatch* and returns 202; the warm runs in `after()`. A background rejection is `console.error`
   only. So `stale_after_min: 10` watches a handshake, not a warm.
4. **Fill rate by cohort for the event-detail panels.** `meridian-earnings-data-inventory.mjs`
   encodes the cohort guard; it has not been re-run at this commit.
5. **`largo-truncation-probe.mjs` against all six tools.** Not run this session. `get_meridian_event`
   returns a whole enriched detail payload and is the obvious truncation candidate.
6. **Live UI state.** `meridian-interaction-audit.mjs` and `meridian-earnings-ui-audit.mjs` were
   not run at this commit — this was a Saturday session, outside the LIVE VALIDATION window
   (`_COMMON.md` §6c). The 2026-08-18 orbital label collision is fixed per the test suite; that
   is a test result, not a pixel measurement.
7. **`/api/market/meridian/lookup` is uncached.** Every call hits `loadMeridianTickerLookup`
   directly while the other two routes share a 120s `serverCache`. Whether that is deliberate
   (it is per-ticker and cheap) or an oversight is not established.
8. **Performance.** `meridian-viz-core.ts` (1,252 lines) and `meridian-earnings-analytics-core.ts`
   have not been profiled. `meridian-perf-probe.mjs` exists and was not run.

---

## 8. Method notes for whoever holds this next

- **Measure the cohort, always report it with the number.** §6.2's 1.8% becomes 0.5% at
  `importance>=3`. Both are true; neither is "the" fill rate. This is the trap
  `meridian-earnings-data-inventory.mjs` was built to prevent and it applies to every rate here.
- **Check the served number against raw bars by hand.** §2.1's step 7 is worth more than the
  test suite for this class of bug, because the test suite asserts the code does what it was
  written to do — which is the thing in question.
- **A sign flip is the unit of severity on this product.** "4.31pp mean error" understates it;
  "27% point the wrong way" is what a member experiences.
- `POLYGON_API_BASE` is set to the literal string `POLYGON_API_BASE` in this sandbox. Run every
  probe with `env -u POLYGON_API_BASE` and let the script self-default to `api.massive.com`.
