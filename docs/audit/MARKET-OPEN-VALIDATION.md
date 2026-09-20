## WATCH LIST — 2026-09-20 Vector universe null-spot completeness fix (PR pending)

**What was fixed:** `GET /api/market/vector/universe` was found live serving `spot:null` for 18/55
static-allowlist tickers (COIN, MSTR, PLTR, JPM, GS, and 13 more) while a same-tick direct
`GET /api/market/gex-heatmap?ticker=<X>` call resolved a real spot within ~1s for the same tickers.
Root cause: `isCompleteBuild` (`vector-universe-merge.ts`) only checked row-COUNT completeness (did
every ticker return SOME row object), never whether that row's spot actually resolved — so a
"complete" 55/55 build with 18 null-spot rows bypassed the merge-based carry-forward protection
entirely and replaced the stored snapshot outright, discarding any previously-good spot with zero
grace period. A second, layered gap in `mergeUniverseSnapshot` meant even a build that DID route
through the merge could still let an undated (null-spot) re-attempt overwrite a still-good, dated
carried row. Both fixed: `isCompleteBuild` now also requires a `producedWithUsableData` count to
clear `attempted`, and the merge's fresh-rows loop now refuses to let an undated row overwrite a
carried row that is still genuinely dated and unexpired. Full write-up:
`docs/audit/findings-staging/2026-09-20-vector-universe-null-spot-completeness.md`.

**Specific thing to check once this deploys and RTH is live:** poll `GET /api/market/vector/universe`
a few times ~5 min apart during RTH and confirm no static-allowlist ticker that had a real spot in
one build flips to `spot:null` in the very next build — it should now only go null after genuinely
going unrefreshed for the full 15-minute `UNIVERSE_ROW_MAX_AGE_MS` window, not on a single bad cycle.
If any ticker DOES show `spot:null` during RTH, cross-check it against a direct
`GET /api/market/gex-heatmap?ticker=<T>` call — a same-tick disagreement persisting past ~15-20
minutes would mean this fix did not fully take effect.

## WATCH LIST — 2026-09-19 Night Hawk Swings "Current" tile MOBILE overflow fix (PR pending, follow-up to #5257)

**What was fixed:** #5257 (below) fixed the "Current" P&L tile's desktop truncation but explicitly
flagged phone width (430px) as unverified. This cycle's retry of that exact check
(`proxy-browser.cjs`, 430x932, real HOLD swing position) found it was NOT fine — a live click-through
rendered "Current" as a visibly truncated `"+$..."`, and a direct DOM measurement confirmed it
mechanically: `scrollWidth 112px` vs `clientWidth 74px` for the plain text `"+$0.00"` (the shortest,
plainest dollar string this field ever produces — no negative sign, minimal digits). Fixed by adding
a `@media (max-width:480px)` block that widens the primary grid column further (`1.5fr` → `2.5fr`,
mobile-only) and drops the primary font-size to `18px` (from 22px) for both the plain and
`.nh-deck--swing-largo`-scoped `is-primary .v` selectors. Desktop is untouched (media-gated). Full
write-up: `docs/audit/findings-staging/2026-09-19-nh-swing-current-tile-mobile-overflow.md`.

**Specific thing to check once this deploys and RTH is live:** open `/nighthawk?view=SWING` on an
actual phone or a 430px-wide mobile UA, tap into any OPEN/HOLD/TRIM/CLOSED swing play, and confirm
the "Current" tile shows the FULL dollar string (even a short one like `"+$0.00"` or `"-$0.85"`)
with no ellipsis. Also re-confirm desktop (≥1024px) is still fine post-deploy — this fix is
media-gated to not touch desktop, but a live re-check costs one screenshot and closes the loop the
same way this cycle closed #5257's own open mobile question.

## WATCH LIST — 2026-09-19 Night Hawk Swings "Current" tile dollar-value truncation fix (PR pending)

**What was fixed:** the Night Hawk Command Deck trade hero's "Current" P&L tile (the only
dollar-formatted metric among the 5 hero tiles, and rendered at the largest font in the Swings
view) shared an even 1/5 grid column with 4 structurally-shorter percentage/rank/age tiles —
production live-repro'd a real `-$0.85` P&L rendering as literal `"$-0…"`, hiding the trader's own
number entirely. Found this cycle's first live-UI pass on `/nighthawk?view=SWING`
(`proxy-browser.cjs`, minted premium session) rather than an API-level check — every prior Ask
Largo audit this session read the same underlying JSON and would have called it correct, since the
data itself IS correct; the defect is purely in the rendered pixels. Fixed by widening the primary
grid column (`1fr` → `1.5fr`) and un-inflating the swing-largo view's primary font-size
(`28px` → `22px`, matching the base size). Full write-up:
`docs/audit/findings-staging/2026-09-19-nh-swing-current-tile-dollar-truncation.md`.

**Specific thing to check once this deploys and RTH is live:** open `/nighthawk?view=SWING` on
desktop (≥1024px, so the swing-largo CSS variant is in effect) with any OPEN/HOLD/TRIM/CLOSED swing
play selected whose entry premium and live/exit mark differ by a non-trivial dollar amount (most
real rows — this isn't a rare-state fix like the one below), and confirm the "Current" tile shows
the FULL dollar string (e.g. `"-$1.88"` or `"+$4.80"`) with no ellipsis, rather than a truncated
`"$-0…"`/`"$1,2…"`-shaped clip. Also spot-check the same tile at phone width (430px, mobile UA) —
this fix only touched the swing-largo desktop-scale override and the shared grid rule, so confirm
mobile wasn't already fine and isn't now regressed.

## WATCH LIST — 2026-09-19 Ask Largo `crossDeskCoaching` 4th-conflict silent-drop fix (PR pending)

**What was fixed:** `crossDeskCoaching`'s "Cross-desk friction" narrative line
(`src/lib/swing/play-brief-narrative-coaching.ts`) checks up to 4 desks (Night Hawk, 0DTE, Vector,
HELIX flow) against a swing's own direction, but `renderCrossDeskConflict` only ever NAMES the
lead conflict plus 2 more (`rest.slice(0, 2)`) — the genuine max-conflict case (all 4 disagreeing
at once) silently dropped the 4th desk's disagreement from the rendered text with zero trace, no
count, no disclosure. Found during this cycle's Ask Largo standing-mandate edge-case sweep
("does `crossDeskCoaching` handle 3+ desks disagreeing without degrading to generic prose").
Fixed by appending a `(+N more desk(s) also disagree — not detailed here.)` clause when the true
conflict count exceeds what gets named in full. Full write-up:
`docs/audit/findings-staging/2026-09-19-cross-desk-coaching-4th-conflict-silent-drop.md`.

**Specific thing to check once this deploys and RTH is live:** this is a genuinely rare state (all
4 checked desks disagreeing with one swing simultaneously) — a synthetic repro (RED→GREEN test) is
the only proof available right now. Once deployed, watch live `GET /api/market/swing/play-brief`
responses for any OPEN/COMMIT position during a session where Night Hawk, 0DTE, Vector, and HELIX
flow readings are all live and directionally opposed to the swing at once; confirm the rendered
"Cross-desk friction" text names 3 desks in full AND carries the "+1 more desk also disagree"
clause rather than silently showing only 3 disagreeing desks. If the 4-conflict state never
naturally occurs during a normal RTH sweep, that is expected (it is rare by construction, not a
sign the fix didn't deploy) — the regression test is the primary proof for this one.

## WATCH LIST — 2026-09-17 gate-calibration `days=N` window-truncation fix (PR pending)

**What was fixed:** `GET /api/market/zerodte/calibration?days=N`'s `blocked_value` (the per-gate
counterfactual outcome evidence `zerodte-gate-primary-ablation.mjs` and
`gate-calibration-live-report.mjs` both read) silently ignored any `days` wider than ~14 days —
`fetchGradedSkips`'s hardcoded `LIMIT 2000` (most-recent-first) was reached well inside 14 days of
live volume, so `days=14/30/60/90` all returned the byte-identical total. Found while re-running
today's gate-floor-audit TOP-3 item #1 (`zerodte-gate-primary-ablation.mjs --days=90`, watching
G-13/`flow_accumulation_conflict`) and seeing its reported blocked-n drop (12 → 10 → 5) across three
re-runs minutes apart with no explanation until the window-sweep isolated the cause. Fixed by scaling
`fetchGradedSkips`'s limit to the requested window (`days * 300`, raised internal ceiling to 30,000)
instead of a flat, silently-reused 2000. Full write-up:
`docs/audit/findings-staging/2026-09-17-zerodte-calibration-graded-skips-window-truncation.md`.

**Specific thing to check once this deploys and RTH is live:** re-run the exact
`days=7/14/30/60/90` sweep against `GET /api/market/zerodte/calibration` (or just re-run
`zerodte-gate-primary-ablation.mjs --days=90` two or three times a few minutes apart) and confirm
(1) `days=30/60/90` now report DIFFERENT (larger) totals than `days=14`, proportional to the wider
window, and (2) a single gate's reported blocked-n (G-13 is the one that surfaced this) is now
STABLE across repeated same-session re-runs rather than drifting down run-to-run. If either check
fails post-deploy, the fix didn't actually reach the deployed calibration report — re-verify against
`origin/main` per this repo's own "a merge is not a verification" discipline, not just that the PR
merged clean.

**CONFIRMED LIVE, 2026-09-17 (same day, post-deploy, RTH):** ran
`gate-calibration-live-report.mjs --days={14,30,60,90} --no-grade --json` against
`GET /api/market/zerodte/calibration` and summed `n + ungradeable` across every `blocked_value[]`
gate code (the actual row count `fetchGradedSkips` pulled from Postgres for that window) —
**days=14 → 4200 rows, days=30 → 9000, days=60 → 18000, days=90 → 22222.** The first three land
exactly on `days * 300` (the new `GRADED_SKIPS_PER_DAY_BUDGET` formula from PR #5140); days=90
comes in under `90*300=27000` only because the DB doesn't hold that many real rows for the period
— not because of a cap. Pre-fix, every one of these would have been flatlined at the old hardcoded
`2000`. Check (2) also passes: G-13/`flow_accumulation_conflict`'s graded `n` held at a flat **24**
across all four window widths (only `ungradeable` grew with window, exactly as expected since older
rejections are less likely to still have a matching Polygon bar) — no drift, unlike the pre-fix
12→10→5 pattern that surfaced this bug in the first place. Both watch-list checks pass; this entry
is resolved, no further action needed.

## WATCH LIST — 2026-09-17 RTH FLOW-vs-PIN gate-compound-funnel comparison — CLOSES item 1's open check from the entry below (COMPLETE, evidence-only, no gate changed)

**What this closes:** the entry directly below (2026-09-17 condor-directional-vote fix wave, item
1) named this exact re-run as tomorrow's open-question check. Run today at real RTH, same session,
back-to-back: `node --import tsx scripts/audit/zerodte-gate-compound-funnel.mjs` (FLOW) and
`node --import tsx scripts/audit/pin-gate-compound-funnel.mjs` (PIN), both with
`env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY`.

**First pass (09:35-09:36 ET) landed inside G-2's opening-window transient** (blocks all commits
before 10:00 ET by design — self-expiring, not a finding): FLOW's `opening_window` isolated-failed
30/30. Re-ran clean at **10:02-10:03 ET**, past the unlock:

- **FLOW: 3168 raw alerts → 29 setups → 0/29 (0.0%) joint commit.** Isolated:
  `early_window_prime_score` 93.1% (27/29 — G-18's real 10:00-10:45 unconditional-75+ band),
  `score_floor` 82.8% (24/29), `confluence_floor` 51.7% (15/29).
- **PIN: 30-ticker universe → 1/30 cleared `evaluatePinRegime` → 0/1 (0.0%) joint commit.** The
  ONE pin-regime-qualified candidate failed the SAME THREE gates FLOW fails: `score_floor`,
  `early_window_prime_score`, `confluence_floor` — all 100% (1/1).

**Reading it honestly:** n=1 for PIN is not statistically powerful (PIN's real base rate is
~15-16 candidate builds/day per item #10's CloudWatch evidence, so a single snapshot landing 1
qualifier is expected, not an anomaly) — but it IS a genuine same-session, same-clock corroborating
data point for the leading hypothesis (PIN dies in the identical hard-gate bottleneck FLOW already
dies in, not a PIN-specific defect): the one PIN candidate that qualified hit the exact same gate
trio dominating FLOW this same run. **No gate/threshold changed** — this is evidence, not a
mechanical bug; touching a threshold on an n=1 PIN sample would be exactly the discipline this repo
forbids. Full write-up: `docs/audit/INTENTIONAL-DESIGN.md` item #10's "SECOND UPDATE" section.

**Nothing to check live on the member-facing board from this entry** — it's a diagnostic/research
measurement (offline harnesses replaying the real gate functions against real live data), not a
code change with a rendered surface. The natural next step (not done this pass): repeated PIN
snapshots across multiple RTH sessions to build a real joint-pass-rate sample size beyond n=1.

## WATCH LIST — 2026-09-17 0DTE condor-directional-vote fix wave (PRs #5106/#5107/#5108/#5109) + open condor-commit/G-13 measurements

**What was fixed (all shipped, live on `main`):** a committed 0DTE iron condor's `direction` field
is nominal-only (the pin's fade side for provenance — `condor.ts`'s own doc: "UNUSED by the
neutral structure's gates/grader"), but four places were reading it as if it were a real directional
stance, fabricating signals for a delta-neutral, credit-sold structure:
- **#5106** — Largo's `nighthawkContribution`/`extractNightHawkRead` (cross-product read +
  whole-ecosystem consensus matrix) no longer casts a condor's nominal side as a bullish/bearish vote.
- **#5107** — the session governor's B-3 correlated-conflict and Q9 concentration checks now exclude
  condors from directional exposure (an open SPX/NDX condor could previously wrongly block a real
  uncorrelated SPY/QQQ/IWM/DIA trade, or inflate concentration count).
- **#5108** — `computeThesisHealth` now returns `null` for a condor row instead of a fabricated
  Thesis Health %/rung/pillar breakdown — **this is the one that reaches the live member command-deck**
  (`ThesisHealthPanel`/`PlayTerminal`/`CommandDeck`/`ZeroDteCommandPanel`).
- **#5109** — `computeConfluence` now returns `null` for a condor setup instead of a fabricated
  "triple-confirmed" tier — also reaches the live command-deck (`ZeroDteCommandPanel`'s
  "confluence N/2" line).

**Check at tomorrow's open, ONLY if a condor actually commits** (per the finding below, this has
not happened once in the last 90 days as of 2026-09-17, so this may stay unobserved for a while —
that's expected, not a sign the fix didn't work): pull up any live OPEN/HOLD/TRIM row where
`entry_context.play_type === "CONDOR"` (or `is_condor: true`) on the command-deck. It should show
**no Thesis Health card and no confluence line** (both silently omitted, not a broken/blank render),
and the governor's board summary (`GET /api/market/zerodte/board`'s `governor` block) should NOT
list that condor's nominal direction as contributing to `same_direction_open_count` or
`correlated_conflict` against a real directional candidate on a correlated ticker (SPX/NDX/SPY/QQQ/
IWM/DIA). If a condor is open and any of these show a fabricated directional read, the fix did not
actually reach production — flag immediately, this is a regression, not a known gap.

**Open, NOT fixed — genuine measurements in progress, do not "fix" these from this note alone:**
1. **0 of 411 committed 0DTE plays in the last 90 days are condors** (measured live 2026-09-17,
   `PR #5112`) — the condor engine is not committing in production at all right now. Root cause
   traced (not fixed) to the same hard-gate funnel already measured at ~0% joint pass rate for
   FLOW-origin setups; `scripts/audit/pin-gate-compound-funnel.mjs` (merged, `PR #5113`) was built
   to get a real PIN-origin number but only ran off-hours so far (0/30, expected — pre-open, no
   qualifying PIN regime). **Check at/after tomorrow's open:** re-run
   `node --import tsx scripts/audit/pin-gate-compound-funnel.mjs --json` and
   `node --import tsx scripts/audit/zerodte-gate-compound-funnel.mjs --json` back-to-back during real
   RTH for a same-session FLOW-vs-PIN joint-pass-rate comparison — this is the actual open question,
   not something this fix wave already answered.
2. **G-13 (`flow_accumulation_conflict`) gate ablation** (`PR #5117`, 2026-09-17 re-run post the
   2026-09-12 skip-grading fix): the population G-13 blocks graded **75.0% WR (n=12, 95% CI
   [46.8%, 91.1%])** vs the desk's real committed WR of 30.8% over the same 90-day window — a 44.2pt
   gap in the wrong direction for a filter gate. **n=12 is thin and no gate was changed on this
   evidence** — this is flagged for a dedicated re-run as G-13's rejection volume grows, not
   something to act on from one 90-day sample. Do not loosen or tighten G-13 off this note alone.
3. **Cortex `gex-walls` regime-style-oppose looks structurally mismatched for condors** (traced,
   not fixed) — it fires "momentum-style {direction} in a long-gamma tape opposes trend-following
   entries" on essentially every real condor commit, since `condorSellRegime` only sells in exactly
   that long-gamma regime. Not actioned because item 1 above means there's currently no live condor
   population for this to measurably harm — re-visit once condors start committing again.

Full write-ups: `docs/audit/INTENTIONAL-DESIGN.md` items #9 and #10;
`docs/audit/findings-staging/2026-09-17-condor-false-directional-vote-largo.md`,
`2026-09-17-governor-condor-directional-concentration.md`,
`2026-09-17-thesis-health-condor-fabricated-score.md`,
`2026-09-17-confluence-condor-fabricated-tier.md`.

## WATCH LIST — 2026-09-16 SPX `/play` session_phase flapping across the market-open boundary — NEEDS ISOLATED RE-TEST, no fix shipped (root cause ambiguous)

**What was observed:** live at 2026-09-16 market open (~9:30-9:45 ET), 8 consecutive
`GET /api/market/spx/play` requests through the same Clerk session returned WILDLY inconsistent
`session_phase` (`"premarket"`/`"cash"`/`"closed"` mixed within the same batch) and `score`
swinging from -20 to +28 — the SPX play panel would have shown a member a random mix of "Session
closed"/SCANNING-placeholder and a real live grade depending purely on which request landed. By
9:47 ET, 8/8 consecutive requests were fully consistent (`session_phase: cash, score: 4`) — it
self-resolved, it did not need intervention, but it was real and reproduced for at least 15
minutes.

**Two live hypotheses, NOT disambiguated — this is the open question for tomorrow's open:**
1. **A market-open-boundary gap in `isSpxPlaySnapshotFreshEnough`** (`spx-play-freshness.ts`) —
   `peekSpxPlayState()`'s fast path (`spx-service.ts`) trusts any cached snapshot up to
   `playMemberPeekMaxAgeSec()` (20s) old purely by AGE, with no awareness that the RTH
   open/close boundary itself can fall inside that 20s window — a snapshot cached at 9:29:59
   (correctly `market_open: false` at the time) reads as "fresh enough" until 9:30:19 even though
   the market state changed at 9:30:00. This alone only predicts ~20s of flapping, not the 15+
   minutes observed.
2. **A cross-replica cache-write race amplified by the concurrent PR #5071/#5072 deploy** —
   the observation window overlapped with an ECS rolling deploy (8-9 tasks split across
   `:1604`/`:1605` for ~25 minutes), each independently recomputing and writing
   `spx-play-read:${date}` to the shared Redis key (`getSpxPlayState()`/
   `evaluateSpxPlayStateCrossReplica`) on its own timer via `SPX_PLAY_EVAL_LOCK_TTL_SEC` advisory
   locking — if a slower-to-compute stale eval's write lands AFTER a fresher one's, last-write-wins
   would explain flapping that lasts as long as task churn does, not just 20s. Consistent with the
   flapping actually STOPPING once the deploy fully settled (single task-def version, one fewer
   concurrent writer set).

**Deliberately NOT fixed this cycle** — shipping a change to `isSpxPlaySnapshotFreshEnough` or the
cross-replica write path without knowing which hypothesis (or both, or neither) is real risks a
wrong/unnecessary change to sensitive live-play-serving cache logic. **Check at tomorrow's open**
(a day with NO concurrent deploy in the 9:25-9:45 ET window): run the same 8-consecutive-request
probe (`GET /api/market/spx/play` through one Clerk session) starting at 9:29 ET through 9:35 ET.
If it flaps cleanly in an ISOLATED (no-deploy) open, hypothesis 1 (boundary-unaware freshness
check) is confirmed and worth a scoped fix (reject a peeked snapshot whose `as_of` and `Date.now()`
fall on opposite sides of the RTH open/close boundary, not just age-based). If it stays clean with
no deploy, hypothesis 2 (deploy-churn write race) is the more likely explanation and the fix
belongs in the cross-replica write coordination instead.

---

## WATCH LIST — 2026-09-16 Swing record's `summary.opens` was structurally dead (always 0) — check at the open

### Fix: `/api/market/swing/record` now seeds chain roots from live OPEN/HOLD/TRIM rows too, not just graded ones

**What was broken:** found via the standing Ask Largo deep-dive mandate — a fresh look at
`GET /api/market/swing/record`'s summary showed `opens: 0` while the horizons board simultaneously
listed real, currently HOLD swing positions (CRWD #39, AAPL #38, AAPL #37, none ever graded or
rolled). Root cause: the route's root-selection loop only seeded a chain root from rows carrying
`graded_at` — but grading only happens once a leg closes or rolls, so a fresh, never-rolled OPEN
position can never have `graded_at` set, and so could never enter the summarized population at
all. `opens = records.length - resolved.length` was therefore mathematically guaranteed to read 0
regardless of the real open-position count. See
`docs/audit/findings-staging/2026-09-16-swing-record-opens-structurally-dead.md`.

**Fix:** extracted the root-selection logic into a new pure, tested helper
(`selectSwingRecordRootIds` in `src/lib/swing/record.ts`) that also seeds a root from any row
currently OPEN/HOLD/TRIM, in addition to the existing graded-row branch.

**Check at the open:** re-run `GET /api/market/swing/record?days=90` during RTH with at least one
real open swing position live and confirm `summary.opens` reports a real nonzero count matching
the horizons board's committed OPEN/HOLD/TRIM native-swing rows (not the Banger-merged ones, which
carry no `positionId` and are a separate ledger) — it should never silently read 0 again while a
genuine open position exists.

---

## WATCH LIST — 2026-09-16 Banger board silently dropped OPEN positions past a 60-row shared cap (Night Hawk Swings/Ask Largo, correctness — check at the open)

### Fix: `/api/market/banger/board` now pages open and closed positions independently

**What was broken:** found via the standing Ask Largo deep-dive mandate — a swing play-brief's
"Book context" section for CRWD cited a Banger-origin CRWD position the member board didn't show.
`GET /api/market/banger/board` reported `open: 33, closed: 27` (total exactly 60 — the shared
`fetchBangerBoardRows(60)` LIMIT fully saturated). Root cause: that query took the most recent 60
rows across ALL statuses combined, then filtered into open/closed in JS — so once total rows exceed
60, an older-but-still-OPEN position ages out of the window and silently vanishes from the board
while still being a real, live holding. See
`docs/audit/findings-staging/2026-09-16-banger-board-open-position-truncation.md`.

**Fix:** `open` now comes from `fetchBangerOpenBookRows(80)` (filters `status IN ('OPEN','PARTIAL')`
at the SQL level, no shared limit with closed rows) and `closed` from a new
`fetchBangerClosedBoardRows(60)`, fetched as two independent queries.

**Check at the open:** re-run `GET /api/market/banger/board` during RTH once the open-position count
naturally grows past what a single 60-row combined page would have held (or cross-check against a
play-brief's "Book context"/"Other concurrent position(s)" citations for a Banger-origin ticker) and
confirm every real open position is present — no ticker cited elsewhere as an open Banger holding
should be missing from this board's `open` array.

---

## VALIDATED — 2026-09-16 `withServerCache` COLD-START fallback unbounded block — correction/completion of the entry below, now confirmed fixed live

### Fix: `src/lib/server-cache.ts`'s cold-start "no pending" branch now also races `opts.fallback()` against `maxBlockMs`

**What was broken:** the entry immediately below (PR #5061) fixed the "already inflight" fallback
path, was deployed, and its ECS task definition was confirmed to run the exact fixed commit
(`blackout-web:1243c707623a2bf47d76740787403db821470c48`). Live re-verification AFTER that deploy
re-ran the same `curl` repro against `/api/market/spx/desk` — 8 consecutive requests, request #7
still took **42.209220s**. PR #5061 was real but incomplete: `withServerCache` has a SECOND,
structurally identical unraced `opts.fallback()` call in the cold-start branch (no build already
inflight — the more common real-world case, doesn't need a second concurrent request to trigger).
See `docs/audit/findings-staging/2026-09-16-server-cache-cold-start-fallback-unbounded.md`.

**Fix:** the cold-start branch's fallback call is now also raced against `maxBlockMs`; on timeout
it falls through to the branch's existing stale-value/background-refresh chain instead of blocking.

**VALIDATED live 2026-09-16, post-deploy (PR #5065, commit `133bfcea0c`, ECS task def
`blackout-production-web:1601`, rollout COMPLETED 09:48:07 UTC, 8/8 tasks confirmed running the
fixed image):** two separate live-curl bursts of 8 requests each against `/api/market/spx/desk`
(09:49 and 10:02 UTC) — all 16 fast (0.22-0.57s), zero outliers. ALB `TargetResponseTime` Max over
the full 13-minute post-rollout window (09:48-10:00 UTC) never exceeded 9.0s, vs the recurring
40s+ spikes measured before the fix (including one at 09:43 UTC, confirmed via ECS service events
to have been served by an old task instance still draining, i.e. pre-fix, not a residual bug).
Given the FIRST "fixed, verified via deploy" claim on this exact code path already proved wrong
once, this closure rests on the live curl re-run + sustained clean ALB window above, not on the
deploy alone. No further action needed unless new evidence recurs.

---

## WATCH LIST — 2026-09-16 `withServerCache` inflight-fallback unbounded block (platform-wide, latency — check at the open)

### Fix: `src/lib/server-cache.ts`'s "already inflight" branch now races `opts.fallback()` against `maxBlockMs`

**What was broken:** found live via the standing performance mandate — ALB `TargetResponseTime`
showed sitewide avg climbing to ~11-13s for 7+ minutes with flat/low ECS CPU and healthy RDS/Redis.
Direct `curl` reproduction against `/api/market/spx/desk` confirmed 1/5 consecutive requests took
42.8s (vs a documented 3s `deskBootstrapMaxBlockMs()` cap) while the rest were fast. Root cause: a
concurrent request landing while another build for the same key was already inflight (no local
hit, no Redis copy) called `opts.fallback()` with zero timeout — `deskCacheOpts.fallback` chains
into `loadSpxDeskPulse()`, itself a cache-wrapped builder that can block on a slow Polygon fetch.
See `docs/audit/findings-staging/2026-09-16-server-cache-inflight-fallback-unbounded.md`.

**Fix:** the fallback call in that branch is now raced against `maxBlockMs` the same way the
cold-start path already does; a slow fallback now throws (caller returns 502) within the cap
instead of blocking indefinitely.

**Check at the open:** during RTH, re-run the same repro (`curl -w "%{time_total}"` against
`/api/market/spx/desk` a handful of times back-to-back, or watch ALB `TargetResponseTime` p99/Max
on `blackout-production-app`) — a lingering multi-second outlier under real RTH concurrent load
(much higher request volume than overnight) would mean the fix didn't fully close the gap, or a
different unguarded fallback path exists elsewhere using the same shared cache opts shape.

---

## VALIDATED — 2026-09-14 Largo stress nightly recovery: Mode 2 confirmed fixed, Mode 1 not exercised (read this before re-litigating the watch-list entry below)

The scheduled 06:30 UTC run never fired (known GitHub Actions `schedule:` drift for this workflow under high fleet commit velocity — not a new issue, not either Mode). Manually triggered via `workflow_dispatch` at 07:17 UTC instead (same bank-rotation/`concurrency=2` config a real scheduled run uses): **run 34817210344, conclusion `success` — first green run since the failure streak began 2026-09-06.**

`live_ok: 84, live_bad: 0, live_warn: 16, live_skipped_transport: 9, live_quality_pct: 84`

**Mode 2 (honesty-check exemption, PR #4940) — CONFIRMED FIXED.** `live_bad: 0` — zero BAD verdicts across 100 answered questions, the field that fails the job. Closed #4654/#4724/#4783/#4922 (the 4 auto-created failure-tracking issues) with this evidence; #4585 had already been closed in an earlier sweep.

**Mode 1 (429 header capture, PR #4926) — still UNCONFIRMED against a real 429; this run didn't hit one.** The 9 skipped questions this run were a different transport failure: HTTP 401 session re-auth throttling (`[clerk-session] re-establish FAILED: sign_in_tokens mint failed (HTTP 404 resource_not_found)`, then "refresh returned no JWT; re-establish throttled") — no rate-limit lines anywhere in the log. Mode 1's fix remains untested either way; watch the next run that actually hits a 429 to see whether the captured `x-ratelimit-*` headers identify the upstream. The 401/re-auth-throttle pattern itself (8.3% coverage loss this run) is a distinct, smaller observation — not filed as a new issue on one occurrence, but worth a second look if it recurs.

---

## WATCH LIST — 2026-09-14 Largo stress nightly recovery: Mode 1 (429 rate-limit header capture) + Mode 2 (self-critical question exemption) (validation target: next scheduled 06:30 UTC nightly run)

### PR #4926 (merged) + PR #4940 (merged): two-part remediation for persistent `largo-stress-nightly` failures

**Mode 1 background:** sustained HTTP 429 rate-limit errors on production nightly runs (2026-09-06–present), source unknown. No upstream identification possible — response headers discarded on 429s, so whether limit comes from Largo API, Anthropic API, Clerk FAPI, Next.js, or Cloudflare remained invisible to operator/audit.

**Mode 1 fix:** `scripts/largo-stress-run.mjs` now captures `x-ratelimit-limit`, `x-ratelimit-remaining`, `x-ratelimit-reset` response headers on all 429 responses for later analysis of which upstream is rate-limiting. Committing headers to run log allows root-cause analysis without re-running.

**Mode 2 background:** `honestyIssues()` in `src/lib/bie/professional-tone.ts` falsely flagged qualitative answers to self-critical and comparative questions (e.g., "Where is the desk wrong?" / "Difference between Vector and Thermal?") as `no-grounded-numbers` — legitimate answers to architectural/feature-comparison questions, not data-lookup. Two real Largo answers scored BAD on 2026-09-11 and 2026-09-13 (only Mode 2 failures on record); gate otherwise working correctly.

**Mode 2 fix:** added narrow exemption pattern `(wrong|better|worse|difference|compare|versus|gap|limitation|weakness|strength|issue|problem|approach|strategy|design|architecture)` — answers matching these keywords skip the no-grounded-numbers check because they legitimately answer qualitative, not numerical, questions. 11/11 professional-tone tests pass (10 existing + 1 new comprehensive self-critical/comparative test).

**Nightly validation (06:30 UTC):** (1) Mode 2 exemption allows self-critical/comparative questions to pass without BAD verdicts; (2) Mode 1 captures headers if any 429 occurs (use logs to identify upstream); (3) close auto-created issues #4585, #4654, #4724, #4783, #4922 once both modes confirmed working live (or escalate if either fails again).

---

## WATCH LIST — 2026-09-13 Night Hawk: globalDiagnostics unbounded memory growth (platform-wide, CloudWatch check — no member-facing symptom) (read this before the routine pass)

### Fix: `nighthawk/lib/diagnostics.ts`'s `globalDiagnostics` singleton now bounds its trail/rejection arrays

**What was broken:** `recordDataSourceing` (called 3x per ticker from `polygon-largo.ts`'s
`fetchPolygonMtfTechnicals`, a shared hot path used by every Night Hawk product) pushed onto the
module-level singleton's `trails` array with no cap and no consumer ever draining it (`.summary()`
has zero production call sites) — unbounded growth for the life of the ECS container. See
`docs/audit/findings-staging/2026-09-13-nighthawk-diagnostics-unbounded-memory-growth.md`.

**Fix:** bounded `trails` and `gateRejections` to a 2000-entry ring buffer (oldest evicted first).

**Check at the open:** this has no member-facing symptom to click through — it's a pure memory-
growth issue in a background ECS process. Instead, check CloudWatch: `blackout-production-web`'s
container memory utilization graph should stop its slow upward drift over the following days/deploy
cycle (the leak was small-per-call, so the effect is a long-run trend, not a step change — compare
the memory trend over several days post-deploy against the days before).

## WATCH LIST — 2026-09-13 Night Hawk Legacy: morning-confirm DEGRADED reason quoted the same SPX gap twice (member-facing tooltip text — check at the open) (read this before the routine pass)

### Fix: check 1 and check 4 of `computePlayVerdict` both fired on the same against-direction gap

**What was broken:** a single-name LONG whose SPX gapped hard against it, but whose own premarket
was still within its plan (stop not breached), got a DEGRADED reason quoting the same gap twice:
`"SPX gapped -25.0 pts against LONG direction — ... treat as caution; SPX gapped -25.0 pts —
verify entry levels, stop may be unsafe"`. See
`docs/audit/findings-staging/2026-09-13-morning-confirm-duplicate-gap-reason.md`.

**Fix:** check 4 (the generic large-gap catch-all) now skips when check 1 already described the
identical gap event.

**Check at the open:** during the 9:10-9:45 ET `nighthawk-morning-confirm` cron window, watch for
any Legacy play whose DEGRADED reason mentions a gap — confirm the reason text names the SPX gap
exactly once, not twice back to back. Most likely to actually trigger on a morning with a real
macro gap ≥20 SPX points against at least one published single-name play's direction.

## WATCH LIST — 2026-09-13 Night Hawk Legacy: options_play year-inference used real "now" instead of the edition's publish date (calendar-strip historical view — check at the open) (read this before the routine pass)

### Fix (branch `fix/legacy-options-play-year-inference-historical-view`): reopening an old Legacy edition could resolve the wrong-year OCC for its plays

**What was broken:** `options_play` strings never carry a year (`shortExpiry()` prints "Aug 28",
never "2026-08-28"). `resolveLegacyPlayOcc`/`parseOptionsContract` reconstructed the missing year
from real wall-clock "now" every time — correct for a live/still-open play, but wrong for the
Legacy edition **calendar strip** (`legacy-board-calendar.ts`, up to 14 trading days back):
reopening an old, already-expired edition re-parsed its plays' `options_play` text anchored on
today's real date, and for an already-past month/day that reads as "before today" almost every
time, rolling the resolved expiry a full year FORWARD — a completely different, never-traded
contract. For a liquid underlying with a matching weekly/monthly strike, that wrong-year OCC can
resolve to a REAL, live Polygon quote and silently render a plausible but wrong mark/P&L for a
historical position. See
`docs/audit/findings-staging/2026-09-13-legacy-options-play-year-inference-historical-view.md`.

**Fix:** threaded an optional `referenceDate` through `parseOptionsContract` →
`resolveLegacyPlayOcc`; `terminalPlayFromEdition` now anchors it on the edition's own
`published_at` instead of real now. The two live-position call sites (`fetchLegacyDiscordLiveRows`,
the Discord notify path) keep the default (real now) — they only ever resolve near-term plays and
were never exposed to this bug.

**Check at the open:** on the live site, open `/nighthawk?view=legacy`, use the edition calendar
strip to jump to an edition from ~2-3 weeks back that had at least one real, already-expired play,
and open that play's detail panel. Confirm any mark/P&L shown (if the position still resolves a
live quote at all) is plausible for the ACTUAL expiry printed in the thesis panel, not a wildly
different number — and ideally cross-check the resolved OCC's expiry year directly via the
`/api/market/nighthawk/legacy-marks` network request in devtools while that old edition is open.

## WATCH LIST — 2026-09-13 Night Hawk Legacy: morning-status DB fallback dropped unverified plays (member-facing status list — check at the open) (read this before the routine pass)

### PR #4937 (merged): a play lacking a pinned morning_verdict was silently missing from the DB-fallback status list

**What was broken:** `GET /api/nighthawk/play-status`'s DB fallback (used once the 24h Redis cache
for a given edition's morning-confirm result expires) rebuilt the play-status list from durable
`morning_verdict` pins, but skipped any edition play that never got a pinned verdict instead of
showing it as `UNVERIFIED` — the same honest-absence status the LIVE cron already uses for exactly
this case. A member polling after the TTL window, for an edition with even one per-ticker
Cortex/data failure during the live 9:15 ET run, would see fewer plays than the edition actually
publishes. See `docs/audit/findings-staging/2026-09-13-morning-status-db-fallback-drops-plays.md`.

**Fix:** push an `UNVERIFIED` entry for any edition play lacking a pinned verdict, matching the
live cron's own convention exactly.

**Check at the open:** next trading day, once any edition's Redis play-status cache is old enough
to fall back to the DB path (or force it by checking status ~24h+ after a morning-confirm run),
confirm the returned play count always equals the edition's published play count — never fewer.
Most useful to check on a morning where CloudWatch shows at least one per-ticker Cortex/data error
during that day's `nighthawk-morning-confirm` run, since that's the exact condition this bug needed.

## WATCH LIST — 2026-09-13 Night Hawk Legacy: record-segment avg_return_pct false-zero (member/admin track-record number — check at the open) (read this before the routine pass)

### PR #4936 (merged): `buildRecordSegment`'s `avg_return_pct` could report a fabricated "+0.00%"

**What was broken:** `analytics.ts`'s `buildRecordSegment` (per-methodology record slice,
`GET /api/market/nighthawk/record`, rendered on `HawkRecordStrip.tsx`/`PlaybookBoard.tsx`) guarded
`avg_return_pct` against a segment with ZERO scoreable rows, but not against a segment whose
scoreable rows all lack a computable return (e.g. `next_day_close` not yet backfilled) — that case
fell through `avgReturn`'s empty-array default and reported `0` instead of `null`, the same
false-zero class this file already fixed on `winRate` (the 2026-08-06 "0% win rate on 68.2%
profitable" incident) and `profitableRate`. See
`docs/audit/findings-staging/2026-09-13-record-segment-avg-return-false-zero.md`.

**Fix:** gate `avg_return_pct` on the actual list of computed returns, not on `scoreable.length`.

**Check at the open:** pull `GET /api/market/nighthawk/record` for a fresh/thin methodology
segment (or right after `regrade-legacy.ts` promotes a batch of rows) and confirm `avg_return_pct`
reads `null` rather than `0.00` when that segment's rows are still mid-grading — the member-facing
`HawkRecordStrip` should show the low-n/no-data state instead of a flat "+0.00%".

## WATCH LIST — 2026-09-13 Night Hawk Legacy: technical-summary dangling separator (dossier/LLM-prompt text quality, no member-facing UI change) (read this before the routine pass)

### PR #4929 (merged): `buildTechnicalCard`'s `summary` field left `"trend · "` dangling when `setup_tags` was empty

**What was broken:** `technicals.ts`'s `classifySetup()` was fixed 2026-07-28 to return `[]`
instead of a sentinel string when nothing matches — specifically so callers "fall through
cleanly." `buildTechnicalCard`'s own `summary` field never implemented that fallback: plain
`${trend_stack} · ${tags.join(" · ")}` interpolation left `"mixed · "` (dangling separator,
nothing after) whenever `setup_tags` is empty — the documented, common "nothing notable" state.
Feeds `format.ts`'s `formatTickerDossierText`, read by `edition-builder.ts`'s evening compose and
`play-explainer.ts`'s LLM briefing prompt. See
`docs/audit/findings-staging/2026-09-13-technical-summary-trailing-separator.md`.

**Fix:** extracted `buildTechnicalSummary(trendStack, setupTags)` returning the bare trend stack
when tags are empty; non-empty case unchanged (same join, same 4-tag cap).

**Check at the open:** no member-facing UI surface reads this directly — it's LLM-prompt/dossier
text only. Nothing to regression-check on the live board.

## WATCH LIST — 2026-09-13 Night Hawk Legacy: play-explainer risk signals not surfaced (member-visible text change — worth a glance at the open) (read this before the routine pass)

### PR #4928 (merged): "Full Hawk Intel" briefing now reports `earnings_risk` and `gate_promoted`/`gate_warnings`

**What was broken:** `play-explainer.ts`'s LLM data block (`formatPlayBlock`) and
`play-explainer-fallback.ts`'s no-LLM fallback (`buildGroundedPlayExplanationFallback`) both
promise a "Risks & invalidation" section, but neither ever read `PlaybookPlay.earnings_risk` or
`.gate_promoted`/`.gate_warnings` — real, already-computed risk signals present on the published
play object. A member requesting the deep-dive briefing for a play with an upcoming earnings print
or that was rescued past a failed publish-time gate would get a Risks section silent about either.
See `docs/audit/findings-staging/2026-09-13-play-explainer-risk-signals-not-surfaced.md`.

**Fix:** added a shared `playRiskLines(play)` helper (in the fallback module, imported by the LLM
path) so both consumers read the exact same risk facts off the same object. Also surfaced
`sector`/`rr_ratio`/`target_atr_multiple`/`confirming_signals`/`exit_style` into the LLM data block.
Purely additive to the grounding-guard's known-numbers set — strengthens grounding, never loosens it.

**Check at the open:** this DOES change member-visible text (the `explanation` string returned from
`POST /api/market/nighthawk/play-explain`, shown when a member clicks "Full Hawk Intel" on a play).
Not a regression risk in the usual sense (additive only, no schema change), but worth pulling one
real briefing for a play carrying `earnings_risk:true` or `gate_promoted:true` once the market opens
and plays are live, and confirming the "Risks & invalidation" section now actually names the
earnings/gate-promotion fact instead of reading like before.

## WATCH LIST — 2026-09-13 Night Hawk Legacy: morning Cortex re-veto skip-reason conflation (cron log/meta only, no live check needed) (read this before the routine pass)

### PR #4927 (merged): `applyCortexMorningReveto`'s `skipped` bucket mixed two different meanings

**What was broken:** `morning-cortex-reveto.ts`'s `CortexRevetoResult.skipped: string[]` pushed a
ticker into the same array whether it was already INVALIDATED by the mechanical morning check
(expected, benign) or had **no Cortex verdict at all** (errored fetch, or absent from the caller's
map — the re-veto never actually ran for that play). Both were indistinguishable in the returned
result and in `nighthawk-morning-confirm/route.ts`'s own logged/persisted `cortex_reveto.skipped`
meta, so a real coverage gap (Cortex silently not running for some plays) could grow invisibly
inside a bucket dominated by the harmless case.

**Fix:** split into `skipped_already_invalidated: string[]` and `skipped_no_verdict: string[]`,
threaded both through the cron route's `cortexRevetoMeta` (old total `skipped` count kept for
backward-compat). New test asserts the two buckets stay disjoint on a mixed batch.

**Check at the open:** none needed on the member-facing product — this only affects the cron's own
logged/persisted diagnostic meta, never grading or the live board. If curious, the next real
`nighthawk-morning-confirm` cron run (9:15 ET on a session day) should show `cortex_reveto` meta
with both new split fields populated instead of one merged `skipped` count; worth a glance if
`skipped_no_verdict` is ever unexpectedly large, since that would now be visible as a real signal
instead of hidden inside the old mixed bucket.

## WATCH LIST — 2026-09-13 Night Hawk Legacy: bearish-posture's dead 'flipped' field (internal diagnostic only, no live check needed) (read this before the routine pass)

### PR #4924 (merged): `applyBearishPosture`'s "flipped to short" count was structurally always zero

**What was broken:** `bearish-posture.ts`'s `PostureResult.flipped` field was declared, initialized to `0`, and never incremented — the function only adjusts candidate scores (bonus for existing SHORT, penalty for LONG) and re-sorts; it deliberately never changes a candidate's direction (a long's sub-scores are direction-specific and would be wrong on a flipped short). But `edition-builder.ts`'s own comment claimed "Thin-flow longs get flipped to short," and its `console.info` log printed `${flipped} candidate(s) flipped to short` — which could never report anything but 0, on every bearish-posture-engaged night, forever. See `docs/audit/findings-staging/2026-09-13-bearish-posture-flipped-dead-field.md` for the full writeup.

**Fix:** replaced the dead `flipped` field with two real ones — `shortsBoosted`/`longsPenalized` — reflecting what the function actually does, and corrected the caller's stale comment/log to match.

**Check at the open:** none needed — this only changes an internal `console.info` diagnostic log line and a code comment; no member-facing UI, API response, or grading path reads this field. If curious, the next real BEARISH-tape evening build's CloudWatch logs will show the corrected `"N short(s) boosted, M long(s) penalized"` line instead of the old always-`"0 candidate(s) flipped to short"` line — purely informational, not something to regression-test.

## WATCH LIST — 2026-09-13 Night Hawk Legacy: flow-polarity bid-put-share measurement gap (research-tool only, no live check needed) (read this before the routine pass)

### PR #4921 (merged): `compareFlowPolarity`'s `bid_put_share_of_puts` silently dropped moderate `ask_side_pct` rows

**What was broken:** `flow-polarity.ts`'s `compareFlowPolarity` (a measurement-only research probe, `npm run probe:nighthawk-flow-polarity` — does NOT feed live Legacy scoring) computed its "classic misread bucket" statistic with a gap: a put row with a finite `ask_side_pct` strictly between 40 and 100 (e.g. 45, genuinely 55% bid-side) contributed **zero** to `bid_put_share_of_puts` instead of its real proportional share. `docs/audit/FINDINGS.md` cites this exact statistic as the gate for a future real scorer change, so an under-counted measurement could mislead that eventual decision. See `docs/audit/findings-staging/2026-09-13-flow-polarity-bid-put-share-gap.md` for the full root-cause writeup.

**Fix:** any finite `ask_side_pct` in `[0, 100]` now contributes its real proportional bid share; only a genuinely missing/non-finite value falls back to 50/50.

**Check at the open:** none needed — this is a pure measurement-tool correctness fix with no live UI, board, or scoring surface. If `npm run probe:nighthawk-flow-polarity` is ever re-run against real live flow data, its `bid_put_share_of_puts` numbers will now be accurate; no regression to watch for on the member-facing product.

## WATCH LIST — 2026-09-13 Night Hawk Legacy: `resolveOutcome` vs `debrief.ts` fillability disagreement — OPEN, needs a product decision (read this before the routine pass)

### PR #4910 (docs-only, merged) flagged a real grading-logic disagreement; no code changed, no fix to validate at the open

**What was found:** `play-outcomes.ts`'s `resolveOutcome` (the live mechanical outcome grader) and
`debrief.ts`'s `computeFill` (the per-play post-mortem's own fill check) disagree on whether a LONG
that gaps clean through and below its entire published entry band counts as "filled". Reproduced
against the real AMD 2026-07-07 shape: `resolveOutcome` grades it `"unfilled"`; `debrief.ts` and the
actual historical record both treat it as filled (graded `"stop"`). A draft fix aligning the two was
written and verified, then reverted on discovering `play-outcomes.test.ts` has an existing,
deliberately-written test asserting the current `"unfilled"` behavior as correct on the same shape
class — two defensible, undocumented fillability philosophies (mechanical-fill vs plan-integrity),
each with its own test. See `docs/audit/findings-staging/2026-09-13-play-outcomes-fillability-vs-debrief-disagreement.md`.

**No fix shipped** — this is a genuine product decision (which philosophy should govern Legacy's
live win-rate), not something to resolve unilaterally by picking a side and rewriting whichever test
disagrees. Status: OPEN, held per the standing escalation policy.

**Check at the open (informational, not a regression check):** there is no code change to validate
here. The item to watch for is any LIVE session where a Legacy play gaps clean through its entire
entry band (same shape as the AMD anchor) — if one occurs, that is a live, concrete instance of the
disagreement (not just a historical reconstruction) and is worth surfacing on the PR/finding thread
as fresh evidence toward whichever direction the product decision eventually goes.

## WATCH LIST — 2026-09-13 Meridian estimate-revision timeline: "+0%" noise entries (read this before the routine pass)

### DISCOVERY-cycle live spot-check found a real-but-invisible revision polluting the feed; fixed same cycle

**What was broken:** `GET /api/market/meridian/timeline`'s `estimate_revision_timeline`/
`recent_earnings_revisions` surfaced a live entry `{"ticker":"ZS", "change_kind":"revenue",
"revenue_delta_pct":0, "headline":"ZS Rev est revised +0%"}` — a real underlying revenue-estimate
change (raw values differed) that rounded to `0.0` at the 1-decimal display precision on a
~$958M revenue base still got pushed as a visible timeline entry. See
`docs/audit/findings-staging/2026-09-13-meridian-estimate-revision-zero-delta-noise.md`.

**Fix:** `diffEstimateRevisionTimeline` (`src/lib/meridian/meridian-benzinga-analytics.ts`) now
skips emitting a revenue-revision entry when the DISPLAYED `revenue_delta_pct` rounds to exactly
`0` — the Redis snapshot still updates unconditionally so the next diff compares against the
latest value rather than accumulating unreported drift.

**Check at next market open (Monday RTH, live earnings-estimate activity resumes):** pull
`GET /api/market/meridian/timeline?days=14` and confirm (a) no entry in
`estimate_revision_timeline`/`recent_earnings_revisions` has `revenue_delta_pct: 0` or a headline
ending in `+0%`/`-0%`; (b) a genuine material revenue revision (any ticker whose estimate moves by
a rounded-nonzero percentage that session) still appears normally — the fix should be invisible to
real revisions and only suppress the zero-display noise case.

## WATCH LIST — 2026-09-12 `db-cleanup` nightly cron: concurrent-invocation deadlock + contentless alert (read this before the routine pass)

### Investigated a live "Cron failure: db-cleanup" alert; fixed the same day

**What was broken:** the nightly `db-cleanup` cron (07:00 UTC / ~3 AM ET) deadlocked
(`deadlock detected`, Postgres 40P01) pruning `vector_wall_history` on 2026-09-12. CloudWatch
evidence strongly points to a concurrent SECOND invocation of the same route (its own BIE-ingest
log line fired 3x within ~4 minutes that night) racing itself for row locks across ~26 shared
tables — `hit-cron` retries a non-2xx response, and this route had no overlap guard at all. The
resulting Discord alert also carried zero actionable detail (`logCronRun` only ever read a
singular `error`/`reason` field; db-cleanup's failure payload is a plural `errors[]` array, so the
alert body collapsed to the bare word "failed"). See
`docs/audit/findings-staging/2026-09-12-db-cleanup-concurrent-invocation-deadlock.md`.

**Fix:** added a `sharedCacheSetNx` cross-invocation overlap lock (same pattern already used by
`vector-pick-sweep`/`banger-discovery`/etc.) so a second/third concurrent invocation is now a
cheap idempotent skip instead of racing the first; added a bounded, jittered retry
(`src/lib/deadlock-retry.ts`) for Postgres `40P01` specifically on each batched DELETE, so a real
deadlock against a genuine concurrent writer (not just a duplicate invocation) no longer fails
that table's prune outright; and `cron-run.ts`'s alert-message derivation now falls back to
summarizing a plural `errors[]` array when no singular `error`/`reason` is set, so a future
db-cleanup failure (or any other cron shipping the same payload shape) alerts with the actual
table + Postgres error text instead of the bare word "failed".

**Check at the next 3 AM ET run (this cannot be validated outside its own real overnight
schedule):** pull `GET /api/admin/cron-health` (or query `cron_job_runs` for `job_key='db-cleanup'`
directly) the morning after this deploys and confirm (a) exactly one real run committed that
night — no second `ok:true, skipped:true, reason:"previous db-cleanup run still in flight..."` row
UNLESS a genuine overlap actually occurred, in which case confirm the skip fired cleanly instead of
a second deadlock; (b) if any table still fails, the resulting "Cron failure: db-cleanup" Discord
alert (if one fires) now names the actual table + Postgres error text rather than the bare word
"failed"; (c) CloudWatch does not show `ingestBieKnowledge`'s log line firing more than once for
that night's run now that the overlap guard is in place.

## WATCH LIST — 2026-09-12 Ask Largo swing Structure Ladder: OPEN-position stop labeling + duplicate levels (read this before the routine pass)

### Adversarial review of #4875 (Structure Ladder) found two real, member-visible defects, both fixed same-day (#4878, #4879)

**What was broken (#1 — labeling):** the new Structure Ladder widget always computes its
"Structural stop" live from today's spot (`deriveSwingPlanLevels`), correct for a WATCH candidate
but not for an already-committed OPEN/HOLD/TRIM position, which has a real, frozen stop
(`thesis_invalidation_px`) that actively drives real exit recommendations and can differ from this
recompute once the underlying has moved since entry. The widget showed the recompute under the
plain label "Structural stop" with no indication it could be a different number from the trade's
actual, system-governing risk level. See
`docs/audit/findings-staging/2026-09-12-structure-ladder-open-position-stop-estimate.md`.

**Fix:** added `StructureLadder.positionState`; an OPEN/HOLD/TRIM read now shows "Reference stop"
plus an explicit caveat that it's recomputed from today's spot and may differ from the position's
real committed invalidation level. WATCH copy is unchanged.

**What was broken (#2 — duplication):** the ladder and the pre-existing Key Levels table both
render call wall/put wall/gamma flip/GEX king/max pain/gamma magnet independently, off the same
underlying reads, directly adjacent on the same swing OPEN/WATCH answer — so a member saw the same
price for each level printed twice, in two different formats. See
`docs/audit/findings-staging/2026-09-12-structure-ladder-duplicate-levels.md`.

**Fix:** `BieAnswer.tsx` now filters the six single-instance labels out of the Key Levels table
whenever a Structure Ladder is present on the same envelope (dark pool/spot/confluence rows are
deliberately left alone — see the finding for why).

**Check at the open:** pull a real swing Ask Largo play brief for an OPEN position (`GET
/api/market/swing/play-brief?playId=SWING:<ticker>` for any live committed name) and confirm (a)
the Structure Ladder's stop line reads "Reference stop ... may differ" rather than the unqualified
"Structural stop" WATCH copy, and (b) the Key Levels table above it no longer repeats the same call
wall/put wall/gamma flip prices the ladder itself shows. Then pull a WATCH candidate and confirm
its ladder still reads the original, unqualified "Structural stop" copy (no regression there).

## WATCH LIST — 2026-09-12 Night Hawk "Flow by expiry" narrative line always printed $0 (read this before the routine pass)

### `formatTickerDossierText`'s flow-by-expiry premium used a guessed field name that never matches real UW data

**What was broken:** real `/api/stock/{ticker}/flow-per-expiry` rows carry `call_premium`/
`put_premium` (separate fields), never a single `premium`/`total_premium` field — so the "Flow by
expiry: <date>: $X" line in the Legacy dossier text (fed into the edition's Claude prompt) always
computed `$0`, regardless of real flow, for every ticker/expiry. See
`docs/audit/findings-staging/2026-09-12-nighthawk-flow-by-expiry-premium-field.md`.

**Fix:** extracted `flowByExpiryPremium(row)` (new, exported, tested helper) that sums the real
`call_premium`+`put_premium` fields, falling back to the old guess only if that's falsy. 3 new
regression tests in `format.test.ts`.

**Check at the open:** pull a Legacy ticker dossier with real near-term flow-per-expiry data (any
active name) and confirm the "Flow by expiry" text now shows real, non-zero dollar figures per
expiry instead of a row of "$0"s.

## WATCH LIST — 2026-09-12 Ask Largo dealer gamma posture: Vector "unknown" silenced a real GEX answer (read this before the routine pass)

### `resolveGammaPosture` treated Vector's "unknown" regime as resolved, suppressing the GEX-matrix fallback — fix/swing-gamma-posture-unknown-silences-gex

**What was broken:** `resolveGammaPosture` (`src/lib/swing/play-brief-absence.ts`) checked only
`vecPosture != null` before trusting Vector's own regime read over the GEX-matrix fallback — but
Vector's regime posture is a four-value enum (`long`/`short`/`transition`/`unknown`), and the
literal string `"unknown"` is non-null. So when Vector genuinely couldn't resolve a posture, this
function returned `"unknown"` directly instead of falling through to a live, resolved GEX-matrix
posture. Live repro: CG's own COMMIT brief showed "GEX posture: Gamma posture: dealers **short
gamma**... Net GEX: -4.3M" in one section, and "dealer gamma posture not resolved on this read" in
the "Trade manager read" section three bullets earlier — same brief, same fact, contradicting
itself. See `docs/audit/findings-staging/2026-09-12-swing-gamma-posture-unknown-vector-suppresses-gex.md`.

**Fix:** `resolveGammaPosture` now defers to the GEX-matrix fallback whenever Vector's own regime is
`"unknown"`, the same as when it's null/absent. `"transition"` is untouched (a real Vector state
already handled gracefully downstream). Fixes every consumer (`dealerPostureLine`, `narrateMaxPain`,
`narrateKing`, `narrateMagnet`, lane-rank coaching) at the one shared resolver.

**Check at the open:** pull a live COMMIT/WATCH `GET /api/market/swing/play-brief` for any ticker
and confirm the "Trade manager read"'s dealer-posture bullet and the "GEX posture" section never
disagree on whether dealer posture is known — if GEX posture shows a real long/short reading, the
Trade manager read should name the same posture, never "not resolved on this read", whenever the
GEX matrix itself is fresh.

## WATCH LIST — 2026-09-12 Night Hawk dossier recency window used trade date, not disclosure date (read this before the routine pass)

### `parseTradeDate` measured congress/insider recency off `transaction_date` instead of the real `filed_at_date`/`filing_date` disclosure fields

**What was broken:** `getEditionCongressTrades`'s 30-day recency filter and `isRecentInsiderBuy`'s
window check (`dossier.ts`) both ran through `parseTradeDate`, whose fallback chain never checked
`filed_at_date` (real congress disclosure field) or `filing_date` (real insider disclosure field)
— only the trade date (`transaction_date`). Congress can disclose up to 45 days after the trade,
so a trade disclosed today but executed 40 days ago was silently dropped as "stale." Same root
cause already fixed once this session in `congressTradeDecayMultiplier` (#4844), found again as a
blast-radius instance while auditing #4860's insider-ticker-filter fix. See
`docs/audit/findings-staging/2026-09-12-nighthawk-dossier-recency-disclosure-date.md`.

**Fix:** added `filed_at_date`/`filing_date` as the first-checked fields in `parseTradeDate`'s
fallback chain. Exported `parseTradeDate`/`isWithinRecentSignalWindow` for direct testing; added
`dossier.test.ts` (new file) with 5 regression tests.

**Check at the open:** pull a Legacy dossier for a ticker with a congress trade disclosed in the
last 30 days but executed further back (or an insider Form 4 filed recently for an older
transaction), and confirm it now appears in `congress_trades`/counts toward `insider_buys` where
it previously would have been silently excluded.

## WATCH LIST — 2026-09-12 Night Hawk insider-transactions ticker filter was silently ignored (read this before the routine pass)

### `fetchUwInsiderTransactions` sent the wrong query-param name — `ticker`, not the real `ticker_symbol` — so every ticker's "insider activity" was a random other ticker's

**What was broken:** `/api/insider/transactions?ticker=X` (and every other spelling tried —
`symbol`/`symbols`/`tickers`/`ticker_symbols`) silently ignores the filter and returns the
unfiltered market-wide latest-insider-filings feed, HTTP 200, no error. The real filter param is
`ticker_symbol`. This fed Night Hawk's shared dossier's `insider_buys` (identical across every
ticker's dossier in the same window — not a per-ticker signal at all, feeding a `+2` scoring bonus
and a hunt-builder eligibility gate on pure noise) and Largo's `get_insider_flow` tool (`transactions`
field showed a random other ticker's real insider trades, not the one asked about). See
`docs/audit/findings-staging/2026-09-12-nighthawk-insider-ticker-param.md`.

**Fix:** `fetchUwInsiderTransactions` now sends `ticker_symbol` instead of `ticker` — the one-line
root-cause fix; no consumer changes needed since the function's contract (that ticker's own
transactions) is now actually true. Regression test pins the outgoing request param.

**Check at the open:** ask Largo `get_insider_flow` for two different tickers with genuinely
different real insider histories (e.g. one mega-cap with frequent 10b5-1 sales, one small-cap with
none) and confirm the `transactions` arrays are now DIFFERENT and each one's rows carry that
ticker's own name in `ticker`/`owner_name` fields — not the same handful of rows for both. Also spot-
check two Legacy dossier tickers built in the same cache window and confirm `insider_buys` is no
longer identical between them by coincidence of both reading the same market-wide feed.

## WATCH LIST — 2026-09-12 Ask Largo lane-rank leader could name the play's own ticker (read this before the routine pass)

### "Desk leader" pointer could self-reference the play's own ticker — fix/swing-lane-rank-self-named-leader

**What was broken:** `computeLaneRank`'s leader-eligibility filter (`src/lib/swing/play-brief-lane-rank.ts`)
excluded exiting/invalidated peers from the "Desk leader" pointer (per #4842/#4849) but never excluded
the play's OWN row from that same filtered list. Whenever the play is not raw rank #1 but IS the best
real eligible candidate (because the actual #1 is excluded), the pointer resolves to the play's own
ticker. Live repro: COIN's own WATCH brief (SKHY #1 by raw score but INVALIDATED, COIN next-best and
eligible) rendered "**#2 of 8** on WATCH lane... Desk leader: **COIN** @ **55.4**" — naming itself.
See `docs/audit/findings-staging/2026-09-12-swing-lane-rank-self-named-leader.md`.

**Fix:** `computeLaneRank` now excludes the play's own matching row(s) from the leader candidate list
(and its exiting/invalidated fallback) before picking `topTicker`/`topScore`. `rank`/`total`/
`medianScore` are untouched. Both `laneRankSection` and `laneRankCoaching` inherit the fix for free.

**Check at the open:** pull `GET /api/market/swing/play-brief` for a WATCH or OPEN ticker that is NOT
raw rank #1 in its bucket but whose real rank #1 is invalidated/exiting (or any ticker at all — the
"Desk leader" line, when shown, should now always name a DIFFERENT ticker than the one the brief is
for). Confirm the "Desk leader: **X** @ **Y**" line never matches the brief's own headline ticker.

## WATCH LIST — 2026-09-12 Night Hawk Legacy thesis positioning driver note (read this before the routine pass)

### Thesis now names WHICH positioning evidence drove a "positioning" scoring tag — feat/nighthawk-legacy-thesis-positioning-driver-note

**What was missing:** `buildDeterministicThesis` could publish `key_signal` reading e.g.
`"BULLISH — positioning + flow · score 78 (A)"`, but the thesis prose only ever surfaced dealer
greek-flow bias -- never dark-pool prints, strike-stack accumulation, or aligned OI growth, the
other three sources `scoreOptionsPositioning` blends into `pos_score`. Same gap class already
fixed for "news" (#4821) and "smart-money" (#4827) this session. See
`docs/audit/findings-staging/2026-09-12-legacy-thesis-positioning-driver-note.md`.

**Fix:** new `positioningDriverNote` names dark-pool prints, strike-stack accumulation, or rising
aligned OI -- whichever has direction-aligned evidence, checked in the same priority order the
score itself weighs them -- as `Positioning: <note>.` in the thesis, but ONLY when positioning is
already a top-2 `key_signal` driver. Additive only, coexists with the existing dealer-greek-flow
line (a separate data source), never fabricates.

**Check at the open:** once a future edition publishes a play whose `key_signal` names
"positioning" as a driver, pull that ticker's full thesis text via `GET /api/market/nighthawk/edition`
and confirm it carries a `Positioning: ...` sentence naming real, direction-aligned evidence
(dark-pool/strike-stack/OI), and that plays where positioning wasn't a driver do NOT carry the
sentence even if the ticker has some dark-pool/strike-stack data on file. Per the #4820
rollout-timing lesson, this text is generated once at publish time (5:30pm ET nightly cron), so it
won't appear in an already-published edition until the next regeneration.

## WATCH LIST — 2026-09-12 Ask Largo lane-rank praise/caution wording on reducing positions (read this before the routine pass)

### Lane-rank lines said "confirm before adding size"/"Lane leader" on positions already being trimmed or exited — fix/swing-lane-rank-below-median-reduce-wording

**What was broken:** `computeLaneRank`/`laneRankCoaching`/`laneRankSection` (`src/lib/swing/play-brief-lane-rank.ts`,
`play-brief-narrative-coaching.ts`) render self-referential rank praise/caution lines with no check on
the play's own `manageAction`. Two live repros the same cycle: **CG** sat #90/90 by raw entry-time
score (dead last) while being the book's best-performing real position (+169.2%/+134.6% exec, already
`TAKE_PARTIAL`) — its own brief said "Desk says TRIM ... Bank partial into strength" three bullets
before "confirm before adding size." **CRWD** sat #1 of 90 on OPEN by raw score (87) with its own
manage engine `EXIT_RUNNER` (round-tripped +130% peak → -10%) — its brief said "Desk says TRIM ...
consider protecting what's left" three bullets before "Lane leader ... Desk attention follows the top
row." See `docs/audit/findings-staging/2026-09-12-swing-lane-rank-below-median-adding-size-wording.md`.

**Fix:** a new `selfReducing` flag (true for `TAKE_PARTIAL`/`EXIT_RUNNER`/`STOP_OUT`/`EXIT`) gates
off every self-referential praise/caution branch in both functions — rank-1 "Lane leader"/"Top-ranked
play", rank≤3 "Top-tier setup", and the below-median "adding size" line (which renders a reduce-aware
variant instead of suppressing outright). A plain `HOLD`/`ADD` is unaffected.

**Check at the open:** once Monday's session produces new reducing committed positions (`TRIM`/
`EXIT_RUNNER`/`STOP_OUT`), spot-check their briefs for any "Lane leader"/"Top-tier setup"/"confirm
before adding size" line — none should appear on a position the desk is telling the member to reduce,
and a plain-HOLD position at any rank should still get the original wording.

## WATCH LIST — 2026-09-12 Night Hawk overnight scorer: institutional smart-money leg was dead code (read this before the routine pass)

### `institutionalNetSignal`/`smartMoneyDriverNote` now read the real UW `units_changed` field — fix/nighthawk-institutional-units-changed-field

**What was broken:** `institutionalNetSignal` (`scorer.ts`, feeds `scoreSmartMoney`'s institutional
+3/-2 bonus) and `smartMoneyDriverNote`'s institutional presence check (`deterministic-edition.ts`,
#4827) both guessed field names (`units_change`, `action`, `transaction_type`) that never exist on
the real UW `/api/institution/{ticker}/ownership` row (confirmed live: the real field is
`units_changed`, and real rows carry no transaction-verb field at all — they're 13F position
snapshots). Both branches of the fallback logic always missed, so the ENTIRE institutional leg of
smart-money scoring was permanent dead code — more complete a failure than the two other scorer
bugs fixed earlier this session (OI-change #4839, congress-decay #4844), which under-weighted
rather than never fired. See
`docs/audit/findings-staging/2026-09-12-nighthawk-institutional-units-changed.md`.

**Fix:** added `units_changed` as the first-checked field in both functions. Purely additive/
corrective — institutional accumulation/distribution that was previously invisible to scoring can
now contribute its intended +3/-2 (scorer) and narrative note (`smartMoneyDriverNote`); nothing
that scored before will score differently, since the signal was always exactly 0 pre-fix.

**Check at the open:** pull a fresh `GET /api/market/nighthawk/edition` play whose `key_signal`
names "smart-money" — for the first time, `smart_money_score` can reflect real institutional
13F accumulation/distribution instead of always excluding it. If `smartMoneyDriverNote` names
"institutional accumulation/distribution flagged" on a live card, spot-check that ticker's real UW
institution-ownership data to confirm the direction actually agrees (net `units_changed` positive
for a long / negative for a short). This is a scoring-input fix, not a new UI field, so the
confirmation is a sane, in-range `smart_money_score`/`key_signal`, same as every other cycle's
healthcheck already verifies.

## WATCH LIST — 2026-09-12 Night Hawk overnight scorer: congressional-trade decay measured the wrong date (read this before the routine pass)

### `congressTradeDecayMultiplier` now decays on the real UW `filed_at_date`, not stale `transaction_date` — fix/nighthawk-congress-decay-filed-date-field

**What was broken:** `congressTradeDecayMultiplier` (`scorer.ts`, shared smart-money scoring for
Legacy's overnight digest and edition-builder) claims to weight congressional trades by disclosure
recency, but its field fallback chain never checked `filed_at_date` -- the real field UW's
`/api/congress/recent-trades` uses for the filing/disclosure date (confirmed via a live pull; see
`docs/audit/findings-staging/2026-09-12-nighthawk-congress-decay-filed-date.md`). It always fell
through to `transaction_date`, silently measuring trade age instead of disclosure age -- a real,
live scoring error (a live DASH row: 15 days old by transaction date = 0.4x decay, vs 1 day old by
actual filing date = 1.0x decay).

**Fix:** added `filed_at_date` as the first-checked field. Purely additive/corrective to
`smart_money_score` -- congressional evidence that was wrongly discounted for staleness can now
score at its true (often higher) weight; nothing that previously scored will score lower, since the
old wrong date only ever under- or equally-weighted a row relative to using the real filing date.

**Check at the open:** pull a fresh `GET /api/market/nighthawk/edition` play whose `key_signal`
names "smart-money" and, if `smartMoneyDriverNote` (#4827) names a congressional signal, spot-check
that ticker's `smart_money_score` looks reasonably weighted for how recently the disclosure (not
necessarily the trade) actually happened -- e.g. a disclosure filed within the last week should
not read as scoring at the 0.4x "old" tier just because the underlying transaction happened weeks
earlier. This is a scoring-input fix, not a new UI field, so the confirmation is a sane, in-range
`smart_money_score`/`key_signal`, same as every other cycle's healthcheck already verifies.

## WATCH LIST — 2026-09-12 Ask Largo lane-rank leader on an invalidated WATCH thesis (read this before the routine pass)

### "Lane leader"/"Top-ranked play" self-praise could fire on a WATCH setup whose own thesis already broke — fix/swing-lane-rank-invalidated-leader

**What was broken:** `computeLaneRank`/`laneRankCoaching` (`src/lib/swing/play-brief-lane-rank.ts`,
`play-brief-narrative-coaching.ts`) already skip an *exiting* COMMIT-bucket peer when picking the
named "leader" (#4825, same day — CRWD's brief). The WATCH-bucket analog was uncovered: a peer (or
the play itself) whose `setupState` is `INVALIDATED` (thesis broke pre-entry) could still be named
the rank-1 "leader." Live-observed: SKHY sat #1 of 8 WATCH candidates by raw score (59) while its
own Entry section already read `Serving section: RESEARCH` / `Setup: INVALIDATED`, yet the same
folded narrative said "Lane leader — #1 of 8 on WATCH — Desk attention follows the top row" three
bullets after "Thesis BREAK ... don't add size." See
`docs/audit/findings-staging/2026-09-12-swing-lane-leader-invalidated-watch-thesis.md`.

**Fix:** the named-leader peer filter now also excludes `setupState === "INVALIDATED"` peers
(alongside the existing `EXIT`/`EXIT_RUNNER` exclusion); a new `selfInvalidated` flag suppresses
the self-referential "leader"/"top-tier" praise lines when the PLAY ITSELF is invalidated. Rank/
median stats are unchanged — only the self-congratulatory narrative lines are gated.

**Check at the open:** once Monday's discovery scan runs and the WATCH lane repopulates, spot-check
a couple of WATCH-lane briefs for any name whose Entry section shows `Setup: INVALIDATED` — confirm
its own brief never says "Lane leader"/"Top-ranked play" and that OTHER WATCH briefs never name it
as `Desk leader: <ticker> @ <score>`.

## WATCH LIST — 2026-09-12 Night Hawk overnight scorer: OI-change alignment bonus dead-coded (read this before the routine pass)

### `scoreOptionsPositioning`'s +2 OI-change-alignment bonus never fired against real data — fix/nighthawk-oi-change-field-mismatch

**What was broken:** `scoreOptionsPositioning` (`scorer.ts`, shared by both Legacy's overnight
digest and edition-builder) filtered OI-change rows on `r.option_type` to find rows whose rising
call/put open interest aligns with a candidate's direction, worth +2 to `pos_score`. The real data
source, `fetchUwOiChange` (`unusual-whales.ts`), returns rows shaped `{strike, oi_change, kind}` —
`option_type` never exists on this data, so the filter always saw `""`, never matched `"c"`/`"p"`,
and the +2 bonus has been silently dead code in production since it was written. See
`docs/audit/findings-staging/2026-09-12-nighthawk-oi-change-field-mismatch.md` for the full root
cause, live proof, and why the existing unit tests never caught it (their fixtures matched the
scorer's own wrong assumption, not the real UW API shape).

**Fix:** renamed the field read (and both inline type declarations) from `option_type` to `kind`.
Purely additive to scoring — no other behavior changed, no gate touched, `pos_score` can now only
go UP for tickers with real aligned OI-change data (never down), so any composed `key_signal`/score
seen at the open should be read as an honest, slightly-more-complete positioning score than before,
not a regression.

**Check at the open:** pull a fresh `GET /api/market/nighthawk/edition` play and confirm nothing
regressed — `pos_score` values should be equal-or-higher than a pre-fix run would have shown for
tickers with real UW OI-change data on file, never lower, and no play should show `pos_score`
suddenly swinging negative or NaN. This is a scoring-input fix, not a UI-visible field, so there is
no direct card text to check — the confirmation is that the fixed scorer keeps producing sane,
in-range `pos_score`/`key_signal` output exactly like every other cycle's healthcheck already
verifies.

## WATCH LIST — 2026-09-12 Night Hawk Legacy thesis smart-money driver note (read this before the routine pass)

### Thesis now names WHICH smart-money signal drove a "smart-money" scoring tag — feat/nighthawk-legacy-thesis-smart-money-note

**What was missing:** `buildDeterministicThesis` could publish `key_signal` reading e.g.
`"BULLISH — smart-money + flow · score 78 (A)"`, but the thesis prose never named which of
`scoreSmartMoney`'s three real sub-signals (congressional trades, institutional flow,
prediction-market consensus) actually fired — the identical gap class fixed for "news" the same
day (see the entry below). See
`docs/audit/findings-staging/2026-09-12-legacy-thesis-smart-money-note.md`.

**Fix:** new `smartMoneyDriverNote` names congressional buying/selling, institutional
accumulation/distribution, or the prediction-market's own real headline — whichever has
direction-aligned evidence, checked in the same priority order the score itself sums them — as
`Smart money: <note>.` in the thesis, but ONLY when smart-money is already a top-2 `key_signal`
driver. Additive only, never fabricates.

**Check at the open:** once a future edition publishes a play whose `key_signal` names
"smart-money" as a driver, pull that ticker's full thesis text via
`GET /api/market/nighthawk/edition` and confirm it carries a `Smart money: ...` sentence naming a
real, direction-aligned source (congressional/institutional/prediction-market), and that plays
where smart-money wasn't a driver do NOT carry the sentence even if the ticker has some
congressional/institutional data on file.

## WATCH LIST — 2026-09-12 Night Hawk Legacy thesis catalyst-headline enhancement (read this before the routine pass)

### Thesis now quotes WHICH news drove a "news" scoring tag instead of naming it with no explanation — feat/nighthawk-legacy-thesis-catalyst-headline

**What was missing:** `buildDeterministicThesis` (`deterministic-edition.ts`) could publish a card
with `key_signal` reading e.g. `"BULLISH — news + flow · score 82 (A)"`, but the thesis prose never
read `dossier.news_headlines` or `dossier.polygon_sentiment` — both already fetched and already
scored into `news_score` by `scoreNewsCatalyst` — so a member had no way to see WHAT the news
actually was anywhere on the card. See
`docs/audit/findings-staging/2026-09-12-legacy-thesis-catalyst-headline.md`.

**Fix:** new `pickCatalystHeadline` surfaces one real, direction-matching piece of text (preferring
Polygon's own sentiment-reasoning string over a plain headline) as `Catalyst: "<text>".` in the
thesis, but ONLY when news is already one of the top-2 scoring drivers (the same `topDrivers` gate
`key_signal` itself uses) — additive only, never fabricates a catalyst when no real text exists.

**Check at the open:** once Monday 9/14's edition (or a future one) publishes a play whose
`key_signal` names "news" as a driver, pull that ticker's full thesis text via
`GET /api/market/nighthawk/edition` and confirm it now carries a `Catalyst: "..."` sentence quoting
real, direction-relevant text (not a fabricated or generic line), and that plays where news wasn't a
driver do NOT carry the sentence even if the ticker has news coverage.

## WATCH LIST — 2026-09-11 swing/banger zombie-OCC follow-up (read before the routine pass)

- **What was broken:** `src/lib/swing/live-marks-active.ts`'s `swingRowToActivePlay()`/
  `bangerRowToActivePlay()` had no expiry-of-contract check at all — a swing/banger open position
  whose OCC had already expired but was never flagged CLOSED stayed in the shared 0DTE live-marks
  poller forever, `mark:null`/`source:"none"`/`stale:true`. Confirmed live 2026-09-11 across 14
  rows (OKTA, BLSH, ASST, MSTX, ETH, GBTC, ETHU, BITX, FBTC, BITO, ETHA, CRM, MSTR, IBIT, CRCG) —
  this was a DIFFERENT, unfixed lane from #4790's own `toActivePlay()` guard (which only covers
  `zerodte_setup_log` rows), confirmed #4790 WAS already deployed via `ecr-push-production.yml`
  ancestry before this was found.
- **What the fix changed:** both row-builders now exclude a row whose OCC's own embedded expiry is
  strictly before `todayEt()` (NOT compared to the row's own `session_date`, which for swing/banger
  is the ENTRY date and can legitimately be weeks before a still-live contract's real expiry).
- **Specific thing to check at next RTH open:** re-run `GET /api/market/zerodte/marks` (or
  `npm run healthcheck:0dte` Stage D) and confirm the 14 tickers above no longer appear with
  `mark:null`/`source:"none"` — and that any GENUINELY still-open swing/banger position (expiry in
  the future) is still tracked and quoting normally (the regression risk this fix could introduce
  is over-excluding a healthy position, not under-excluding a zombie one).
- **Still open, NOT fixed here (see the staged finding for the DB-level follow-up needed):** why the
  upstream close/expiry-sweep never flipped these swing/banger rows to CLOSED in the first place —
  needs raw Postgres access this sandbox cannot reach.

# Market-Open Data-Correctness Validation

A cross-provider validator that confirms the numbers members see on
blackouttrades.com match **ground truth** from Polygon + Unusual Whales, catches
malformed numbers, and checks internal/arithmetic consistency.

Tool: [`scripts/audit/data-validator.mjs`](../../scripts/audit/data-validator.mjs)

## What it validates
- **Prices/indices** — app SPY/SPX/VIX vs Polygon (`/v2/aggs/.../prev` off-hours, live during RTH).
- **Cross-endpoint agreement** — `quote.price` == `gex.spot`, SPX/SPY ratio ≈ 10.
- **GEX/greeks consistency** — wall ordering, gamma/dex/vanna posture matches sign, plus the app's own `gex_cross_validation` vs UW, plus a UW greek-exposure sign cross-check.
- **Track record arithmetic** — `wins+losses+breakeven == total_closed`, `win_rate_pct` recompute.
- **Malformed-number scan** — every payload flagged for NaN/Infinity and **unrounded float noise** (e.g. `7499.360000000001`, `ema20=7428.6691886260705`).

Exit code is **non-zero if any check FAILs** (usable as a CI/trigger gate). Reports land in `audit-output/` (gitignored) as timestamped `.json` + `.md`.

## What it does NOT cover (environment limits)
- **WebSocket feeds** — agent/CI proxies block WS upgrades. Members receive WS data via the REST endpoints above, which *are* validated. True WS-stream validation must run server-side (inside ECS).
- **Rendered UI / visual / client console errors** — NOT covered by this validator, but **NOT impossible either**: use `proxy-browser.cjs` per [`LIVE-UI-CONNECTION.md`](./LIVE-UI-CONNECTION.md). Plain Playwright fails here (Chromium egress is blocked; `--proxy-server` does not help), which is why this line used to read "blocked in sandboxed/proxied envs" — that was wrong and cost a session's worth of wrong conclusions on 2026-08-06.
- UW-sourced numbers are only cross-checked where an independent Polygon equivalent exists; pure-UW figures are checked for internal consistency + UW self-agreement.

## Run manually
```bash
CLERK_SECRET_KEY=...            \
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_... \
POLYGON_API_KEY=...             \
UW_API_KEY=<uuid-token>         \
node scripts/audit/data-validator.mjs
```

## Secrets checklist (must be **literal** values, not `${{shared.*}}` refs)
| Env var | Purpose | Notes |
|---|---|---|
| `CLERK_SECRET_KEY` | mint sign_in_token, create/delete temp user | production backend key |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | derive Frontend API host | `pk_live_...` |
| `POLYGON_API_KEY` | Polygon ground truth | ⚠️ the `${{shared.*}}` reference does **not** resolve — set the literal key |
| `UW_API_KEY` | UW ground truth | ⚠️ must be the literal **UUID** token, not `${{shared.UW_API_KEY}}` |

## Scheduled trigger (daily at market open)
Configure a **Claude Code scheduled trigger** on this repo at **13:32 UTC, weekdays**
(= 9:32 AM ET / 6:32 AM PT — a couple minutes after the 9:30 open so the first prints settle).
Use this prompt:

> Run the daily market-open data-correctness audit for blackouttrades.com.
> 1. Confirm env has literal `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `POLYGON_API_KEY`, and `UW_API_KEY` (UUID). If any is an unresolved `${{...}}` placeholder, stop and report it.
> 2. Run `node scripts/audit/data-validator.mjs` (it authenticates once as a temp admin/premium Clerk user and ALWAYS deletes it).
> 3. Read the newest report in `audit-output/` and compare to `docs/audit/BASELINE-2026-07-01.md`.
> 4. For every `FAIL`, and any number that materially disagrees with Polygon/UW ground truth, read the source that computes it and document the root cause.
> 5. Write findings to `docs/audit/RESULTS-<YYYY-MM-DD>.md`, commit to the branch, and reply with a concise pass/fail summary (top issues, severity). Confirm the temp user was deleted (report shows `cleanup: temp user deleted PASS`).

### Operational caveats
- **Authenticate once per run.** Rapid Clerk sign-in/token cycles get FAPI-rate-limited (429 → app returns `Unauthorized`). The script mints one session and reuses it.
- **One temp user per run, always deleted** in a `finally` block; it self-heals by adopting+deleting any leftover `claude-audit-temp@` user.
- **Clerk instance requires a phone number** on user creation (default `+14155550123`).
- **Market awareness** — the script reads Polygon market status and tightens price tolerance during RTH; off-hours it compares against prior close (VIX prev-close vs a live app VIX will differ — expected).
- **Ephemeral sessions** — each triggered run starts clean; everything it needs is in this repo. Reports in `audit-output/` do not persist across sessions unless committed.

---

# 0DTE "Night Hawk" End-to-End Health Check

A companion to the data-correctness validator that answers a different question: **is the
WHOLE 0DTE system actually live, producing, tracking, and grading end-to-end before the
open — INCLUDING the iron condor?** Where `data-validator.mjs` cross-checks individual
numbers, this walks the pipeline stage by stage and prints a GREEN/AMBER/RED matrix.

Tool: [`scripts/audit/zerodte-e2e-healthcheck.mjs`](../../scripts/audit/zerodte-e2e-healthcheck.mjs)
(`npm run healthcheck:0dte`).

It is **read-only** — it logs in as ONE temp admin+premium Clerk user (the proven
data-validator auth block: mint `sign_in_token` → FAPI ticket exchange → `__session`
cookie), reads the SAME authenticated board / marks / record endpoints the desk polls,
cross-checks marks against Polygon, and (only when AWS creds are present) inspects ECS. It
writes nothing to prod, mutates no board state, and ALWAYS deletes its temp user in a
`finally` block (self-healing a leftover `claude-audit-temp@` user). Authenticates once per
run.

### The stage matrix — how to read it
Each stage reports one verdict; the run exits **non-zero if any non-skipped stage is RED**
(usable as a pre-open gate). Verdict vocabulary: **GREEN** = asserted live/coherent,
**AMBER** = indeterminate or a legitimate-but-empty state (never assumed correct — the
captured reason is printed), **RED** = a subsystem that should be live is broken/incoherent,
**⚪ SKIPPED** = not applicable this run.

| Stage | Asserts | AMBER when |
|---|---|---|
| **A INFRA/CONFIG** | ECS `blackout-production-web` + `blackout-production-market-worker` healthy (`running==desired`, PRIMARY rollout not FAILED) on the latest image, and the `ZERODTE_*` discovery flags (whole-market + `SRC_BREAKOUT` + `SRC_PIN` + `CONDOR`) present in the worker task def. **NEVER prints secret values** — only flag presence/on-off. | **SKIPPED** (not RED) when AWS creds are absent/placeholder or unusable. |
| **B DISCOVERY ×3** | the live board carries setups from each origin **FLOW / BREAKOUT / PIN** (`setup.discovery_origin`). | an origin has 0 setups → AMBER **with the captured reason** (session heat, governor state, gate-block codes) — empty is never assumed correct. |
| **C COMMIT/LEDGER** | every committed play (`board.ledger`) carries `entry_premium`, `direction`, `top_strike`, `first_flagged_at`, and a **frozen decision snapshot** (`cortex`/`tier` passthrough). | 0 committed rows, or legacy rows predating the cortex/tier wiring. |
| **D LIVE MARKS+P&L** | each OPEN play (`/marks`) has a **fresh** live mark (age ≤ 20s during RTH) + a coherent `live_pnl_pct`, and the displayed mark is **cross-checked against Polygon's own option quote** (`/v3/snapshot/options`). | no open plays / off-hours (lane idles) / no Polygon quote to compare (thin contract). |
| **E EXIT MGMT** | OPEN/HOLD/TRIM/CLOSED lifecycle values are internally coherent (a CLOSED-**stopped** row shows the pinned −50% stop P&L; a live row carries an entry premium). | 0 ledger rows. |
| **F IRON CONDOR** *(first-class)* | the condor is **selected + tracked** — a routed `play_type:"CONDOR"` with real 4-leg geometry (short/long both sides, `net_credit`, `wing_pts`, breach levels), OR (when no live condor is routed) every directional setup carries well-formed calibration `condor` geometry, proving the engine is wired. | no live CONDOR routed (needs a PIN candidate + `ZERODTE_CONDOR`/`SRC_PIN` on) — engine proven wired but not actionable, or an empty board. |
| **G GRADING/RECORD** | `/record` arithmetic holds (`wins+losses+breakeven == graded`) and today's CLOSED rows carry a graded outcome. | closed rows still pending the post-close grade pass / no graded rows in the window. |

The condor (**F**) is a **first-class stage, never skipped**: it is the SELL-side half of the
board (the negative-skew premium engine) and the easiest subsystem to silently lose — a
flag flip or a routing regression leaves the directional board looking healthy while the
condor quietly stops selling. The stage asserts real geometry either way, so a broken
condor cannot hide behind a green directional board.

### Run manually
```bash
# This tool WANTS AWS creds for stage A when available — do NOT strip them.
CLERK_SECRET_KEY=...            \
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_... \
POLYGON_API_KEY=...             \
npm run healthcheck:0dte
# subset + machine output:
npm run healthcheck:0dte -- --stage=B,F,G --json
```
Flags: `--json` (full matrix + per-check evidence), `--quiet` (drop the per-check chatter),
`--stage=A,B,...` (subset). `POLYGON_API_BASE` self-defaults to `https://api.polygon.io`
(with a `/^https?:/` guard) like the sibling audit tools. Secrets are read from env only and
never printed. Pure verdict/coherence logic lives in
[`scripts/audit/lib/zerodte-healthcheck-eval.mjs`](../../scripts/audit/lib/zerodte-healthcheck-eval.mjs)
(unit-tested: `node --test scripts/audit/lib/zerodte-healthcheck-eval.test.mjs`).

---

## WATCH LIST — 2026-09-12 Night Hawk record/funnel UTC-anchor fix (read this before the routine pass)

### `GET /api/market/nighthawk/record` and the admin funnel dashboard drifted a day near UTC midnight — fix/nighthawk-record-window-et-anchor

**What was broken:** `fetchNighthawkOutcomeAnalytics` and `fetchNighthawkFunnelStats` (`src/lib/db.ts`)
windowed their `edition_for` cutoff off bare Postgres `CURRENT_DATE`, which resolves in the DB
session's UTC timezone, while `edition_for` is an ET trading-day date. Between ~8pm and midnight ET
(i.e. after UTC has already ticked to the next calendar day but it's still the same ET trading
evening), the computed cutoff was a day later than intended and prematurely dropped the oldest day
out of the window. Live-observed: `segments.current.resolved` on `/record?days=14` dropped 30→26
within one ~15-minute audit cycle, exactly at the UTC-midnight boundary with no market activity in
between (Friday evening, RTH long closed). See
`docs/audit/findings-staging/2026-09-12-nighthawk-record-window-utc-anchor.md`.

**Fix:** both functions now anchor the cutoff to `(NOW() AT TIME ZONE 'America/New_York')::date`,
matching the existing ET-day pattern already used elsewhere in `db.ts` (the flow-alerts DTE query).
Applied at all three `edition_for` filter sites (one in `fetchNighthawkOutcomeAnalytics`, two in
`fetchNighthawkFunnelStats`) so the record endpoint and the funnel dashboard stay windowed
identically, per the funnel function's own "windows the same way" doc comment.

**Check at the open:** during Monday 9/14's ~8pm–midnight ET evening window (or any evening this
week), pull `GET /api/market/nighthawk/record?days=14` twice — once before ~8pm ET and once after
midnight ET the same evening — and confirm `segments.current.resolved`/`win_rate_pct` do NOT change
between the two reads unless a real new outcome was graded in between. Also worth a one-time spot
check on the admin funnel dashboard's published/rejected counts for the same non-movement property.

## WATCH LIST — 2026-09-11 Ask Largo crossDeskCoaching condor-direction fix (read this before the routine pass)

### "Cross-desk friction"/"Desk alignment" narrative could mislabel a committed CONDOR's nominal direction as a real directional 0DTE call — fix/swing-crossdesk-condor-direction-mislabel

**What was broken:** `crossDeskCoaching` (`play-brief-narrative-coaching.ts`, the "Trade manager
read" narrative's cross-desk conflict/alignment bullet) read `zerodte_today.direction` and compared
it to the swing's own direction without checking `is_condor` — the same defect #4788 fixed the same
day in `flowIntelSection`'s separate "0DTE desk: aligned/conflict" line, but that fix's blast-radius
check missed this second call site reading the identical field. A committed iron CONDOR's direction
is nominal-only (the fade side of the pin); the structure is delta-neutral. See
`docs/audit/findings-staging/2026-09-11-swing-crossdesk-condor-direction-mislabel.md`.

**Fix:** `zLong`/`zShort` in `crossDeskCoaching` now also require `z?.is_condor !== true`, so a
condor row contributes to neither the "Cross-desk friction" conflict bullet nor the "Desk
alignment" fallback line.

**Check at the open:** if a session commits an iron condor (`zerodte_today` row with
`entry_context` carrying condor legs) on the same ticker/day as a live swing position, re-pull that
swing's play-brief and confirm the "Trade manager read" narrative never renders "0DTE
long/short(...)" as a friction or alignment claim against it — `flowIntelSection`'s own "Flow &
positioning" section is the only place that should name the condor, and it should read "sold iron
condor (structure-neutral, not a directional call)".

## WATCH LIST — 2026-09-11 Ask Largo Position-section Mark-sync-echo fix (read this before the routine pass)

### Position section's "Mark" line silently echoed Entry for unsynced Engine-B/banger quotes — fix/swing-position-mark-sync-echo (PR #4775)

**What was broken:** live capture from `GET /api/market/swing/play-brief?playId=SWING:IMPP` (and
`SWING:EBS`, `SWING:QCML` — all real open Engine-B/banger-lane positions) showed `Entry: **$0.10**
/ Mark: **$0.10** / P&L: **—** / Peak: **—**` — Mark byte-identical to Entry because
`horizonPlayFromBangerPosition`'s `mid = last_mark ?? entry_premium` fallback flows straight into
`play.mark` with no disclosure on the Position section itself (the rest of the brief already
disclosed it via `unavailableSources`/"Data freshness", just not on this specific line). See
`docs/audit/findings-staging/2026-09-11-swing-position-mark-sync-echo.md`.

**Fix:** `pnlSection()` (`play-brief.ts`) now renders `Mark: **unknown** _(sync quote, no live
price yet — do not read as flat)_` instead of the raw fallback number whenever
`play.markIsSync === true` for an OPEN/HOLD/TRIM row (`playExpectsLiveOptionMark`).

**Check at the open:** re-pull the play-brief for any Engine-B/banger swing position that is open
but has not yet received a live quote sync this session (check the "Data freshness" section for
"Mark age unknown") and confirm the Position section's own Mark line now reads "unknown", not a
specific dollar figure equal to Entry. Also confirm a position that HAS synced (a real, different
`mark` value, `markAsOf` populated) still shows its real Mark price normally — this fix must not
suppress genuine live marks, only the sync-fallback case.

## WATCH LIST — 2026-09-10 Ask Largo CLOSED-play run-on bullet fix (read this before the routine pass)

### CLOSED-play "Trade manager read" jammed 2-3 post-mortem points into one illegible bullet — fix/swing-closed-coaching-run-on-bullet

**What was broken:** live capture from `GET /api/market/swing/play-brief?playId=SWING:AAPL&ticker=AAPL&positionId=36`
showed one `•` bullet reading "Exited -56.2% vs peak +1.3% Round-tripped past breakeven — was up
+1.3% at peak, closed at -56.2%; tighten at first trim rail next time. Stop fired (stopped) —
check if entry was extended past invalidation." — three distinct facts with no separator. See
`docs/audit/findings-staging/2026-09-10-swing-closed-coaching-run-on-bullet.md`.

**Fix:** `closedCoaching()` (`play-brief-narrative-coaching.ts`) now joins its internal points
with `\n• ` instead of a bare space, so each renders as its own bullet — matching every other
coaching point in the system (one `push()` call = one bullet).

**Check at the open:** re-pull any CLOSED swing play-brief whose position has both a peak/exit P&L
outcome AND a `closedReason` (e.g. a stopped-out or thesis-broken position) and confirm "Trade
manager read" shows 2-3 separate `•` lines, not one run-on sentence. Also confirm a closed play
with only ONE of those inputs (e.g. no `closedReason`) still renders a single clean bullet, not an
empty leading `•`.

## WATCH LIST — 2026-09-10 Ask Largo SELL exit-reason accuracy fix (read this before the routine pass)

### Ask Largo's live "Exit now" bullet claimed "thesis or ladder fired" on a genuine time-based (expiry-risk) force-manage — fix/swing-sell-exit-reason-manage-rung

**What was broken:** live capture from `GET /api/market/swing/play-brief?playId=SWING:NRG&ticker=NRG&positionId=34`
showed "**Exit now** — thesis or ladder fired" in Trade manager read, while the SAME response's
"What to watch" section said "Thesis intact" and the ladder section showed no rung fired. The real
reason NRG's manage engine forced EXIT was `expiry_risk` (8 DTE, a purely time-based force-manage
per `manage.ts`'s own docs — thesis stays intact by definition of that rung), not a broken thesis
or a fired trim. See `docs/audit/findings-staging/2026-09-10-swing-sell-exit-reason-mislabeled.md`.

**Fix:** `manage.ts`'s deciding rung is now threaded end-to-end (`live-plays.ts` →
`horizon-plays.ts` → `play-brief-resolve.ts` → `adapters.ts` → `TerminalPlay.manageReason`) so
`play-brief-narrative.ts`'s SELL bullet states the real reason (`expiry_risk` → time-based,
thesis intact; `structural_stop`/`thesis_stop` → thesis broke; `premium_stop` → premium stop hit;
etc.) instead of a single hardcoded, sometimes-false claim.

**Check at the open:** re-pull the same NRG play-brief (or any other live SWING row whose
`manageAction` is `EXIT`/`STOP_OUT`) and confirm the "Exit now" bullet's stated reason is
consistent with the rest of the same brief — a row still showing `expiry_risk`-driven EXIT should
read "time-based ... thesis still intact" and its "What to watch" section should still say
"Thesis intact"; a row whose thesis has genuinely broken should read "thesis broke" and its "What
to watch" section should agree. Also spot-check a row with no manage-sync snapshot yet (a pure
spot-detected structural break) to confirm it still says "thesis broke" via the `thesisLevel`
fallback, not a blank/generic line.

## WATCH LIST — 2026-09-10 Night Hawk Legacy recap text fix (read this before the routine pass)

### Overnight edition `recap_summary` double-periods whenever market tide is unavailable — fix/legacy-recap-tide-double-period

**What was broken:** live capture from `GET /api/market/nighthawk/edition` during the standing
5-engine live monitor cycle (pre-open, ~13:52 UTC) showed `"recap_summary": "Market tide
unavailable.. SPX 7636.36 (-0.48%) ..."` — a double period right after "unavailable". Root cause:
`tideSummary()` (`src/features/nighthawk/lib/format.ts`) baked its own trailing period into the
null and flat-tide branches, and `buildMarketRecap()`'s summary template appended a second period
after it. See `docs/audit/findings-staging/2026-09-10-legacy-recap-tide-double-period.md`.

**Fix:** `tideSummary()` no longer self-punctuates on any branch; the two call sites
(`buildMarketRecap()`'s summary template, `formatEtfTides()`'s per-ETF tide line) now each own
their own trailing period.

**Check at the open:** re-pull `GET /api/market/nighthawk/edition` on a morning where UW tide data
is genuinely absent/flat (the honest absence case, not a bug) and confirm `recap_summary` reads
`"Market tide unavailable. SPX ..."` / `"Market tide flat / no premium. SPX ..."` — single period,
no `".."`. Also spot-check a session with real tide data (`recap_summary` should start
`"BULLISH — calls NN% ($X) vs puts $Y. SPX ..."`) to confirm the real-data branch is unaffected,
and confirm any `etf_tides` line still ends in exactly one period.

## WATCH LIST — 2026-09-10 Night Hawk Swings live audit (read this before the routine pass)

### Swing Command Deck + Ask Largo play-brief showed a false "trim banked" on a position still fully exposed at HOLD — fix/swing-trim-ladder-enforced-gate

**What was broken:** live-caught during the hourly Night Hawk Swings audit, positionId 34
(NRG, LONG, STANDARD sub-lane, entry $4.90, peak $11.40 = +132.7%, mark $6.85 = +39.8%). The
board's own `liveStatus` (`GET /api/market/nighthawk/horizons?view=swings`) correctly reported
`HOLD` — manage-sync.ts's calibration-gated `enforced` flag had never actually banked a trim on
this row. But both the Command Deck terminal panel and Ask Largo's play-brief
(`GET /api/market/swing/play-brief?playId=SWING:NRG...`) rendered `Trim ladder: +100% ✓` /
"**all trims banked** — runner only" for the same position at the same instant — a mechanical
peak-vs-trigger check (`buildTerminalExitLadder`) that ignored manage-sync's enforcement gate
entirely. A member reading either surface would reasonably believe half the position had already
been de-risked when 100% of it was still exposed to the original stop.

**Fix:** `terminalPlayFromHorizon` (`src/features/nighthawk/command-deck/adapters.ts`) now forces
every trim rung's `fired` flag to `false` unless the row's resolved `status` has actually reached
`TRIM` — the mechanical ladder read is only trusted once manage-sync's enforcement gate agrees
with it. See `docs/audit/findings-staging/2026-09-10-swing-trim-ladder-fired-ignores-enforced-gate.md`
for the full root cause and blast-radius (one shared code path feeds both consumers).

**Check at the open:** re-pull `GET /api/market/nighthawk/horizons?view=swings` for any OPEN swing
row whose `liveStatus` is `HOLD` but `peakPremium` has cleared its +100% trim level (i.e. exactly
NRG's situation) — its play-brief and Command Deck panel should now show the ladder as un-fired
("next trim at +100%"), not "✓"/"banked". Also confirm a row that HAS genuinely reached `TRIM`
(e.g. CRWD, FSLY, SRPT as of 2026-09-10) still shows its ladder correctly fired — this fix must not
suppress the real, enforced case.

### Ask Largo's WATCH play-brief never said how long a thesis had been building — feat/swing-watch-age-narrative (#4721)

**What was missing:** live sweep of the WATCH lane found real rows sitting well below the
60-point commit score floor for extended periods with zero narrative distinction from a
freshly-flagged candidate: AMD (score 20.6, `firstSeenAt` 2026-07-27 — 45 days), FSLR (score
59.1, 10 days), PLTR (score 34.3, 10 days). A member asking Largo about any of these got no
"how long has this been building without graduating" context, even though the same timestamp
(`TerminalPlay.detectedAt`) was already rendered on the Command Deck panel — just never narrated
in the play-brief text itself.

**Fix:** `watchEntrySection` (`src/lib/swing/play-brief.ts`) now emits `"First flagged **N days
ago** (ET date) — still on WATCH, not yet graduated to a real position."` whenever `detectedAt` is
present on a WATCH-status play; omitted (never fabricated) when absent. Purely additive — no new
data plumbing, `detectedAt` was already populated end-to-end.

**Check at the open:** pull `GET /api/market/swing/play-brief?playId=SWING:<ticker>&ticker=<ticker>`
for any current WATCH-lane name (e.g. AMD, or whichever has the oldest `firstSeenAt` at open) and
confirm the "Entry" section's body now contains a "First flagged N days ago" line matching the
board's own `firstSeenAt`. Also confirm a WATCH row with no `firstSeenAt` (should be rare/none in
practice) omits the line rather than showing "First flagged 0 days ago" or similar fabricated text.

---

## WATCH LIST — 2026-09-08 evidence-based gate loosening (read this before the routine pass)

### 0a-3a. Swing cross-session persistence floor loosened for 5 standard archetypes — fix/swing-persistence-loosen-standard-archetypes

**What was broken:** operator complaint (repeated) that Swing Command shows too few promoted plays
and that "winning plays on watch aren't getting promoted." Live-observed several high-scoring
TRIGGERED+AT_TRIGGER setups (HOOD 83.6, EWY 84.9, AMD 75.9, XME 69.7, CCJ 67.3) blocked purely by
the persistence gate requiring 2 distinct session days for BREAKOUT/PULLBACK_CONTINUATION/
MEAN_REVERSION/FLOW_ACCUMULATION/SECTOR_ROTATION — a gate already documented as "provisional, never
validated." A real 90-day backtest (`scripts/audit/swing-persistence-recall.mjs`,
`docs/audit/INTENTIONAL-DESIGN.md` item #7) found persistence-cleared candidates did NOT
outperform blocked ones at any horizon (+1d 45.5% vs 58.8% WR; +3d 52.6% vs 50.0%; +5d 55.3% vs
43.8%).

**Fix:** loosened those 5 archetypes from `minDistinctSessions: 2, requiresCorroboration: false` to
`minDistinctSessions: 1, requiresCorroboration: true` — matching the already-shipped
EVENT_DRIVEN/POST_EARNINGS_DRIFT treatment. Same-day corroboration (≥2 independent signal kinds)
still required; a lone print never promotes. `FAILED_BREAKDOWN` and the unclassified-candidate
default (2 sessions, no corroboration) are unchanged.

**Check at the open:** compare WATCH→COMMIT promotion volume for BREAKOUT/PULLBACK_CONTINUATION/
MEAN_REVERSION/FLOW_ACCUMULATION/SECTOR_ROTATION candidates against pre-2026-09-08 baseline — expect
MORE same-day promotions for multi-signal-corroborated names (a real quality bar, not a blanket
loosening). Watch for any single-signal-kind name incorrectly promoting (would indicate a
corroboration-check regression) — should NOT happen, `hasCorroboration` still requires 2+ distinct
kinds. If promoted volume rises with a WORSE realized win rate over the following 1-2 weeks, that
would be the first real evidence against this change and should prompt revisiting it.

---

## WATCH LIST — 2026-09-11 coordinator sweep (read this before the routine pass)

- **Ask Largo swing brief: duplicate flow-anomaly bullet.** `flowIntelSection`
  (`src/lib/swing/play-brief-intel.ts`) rendered the exact same HELIX flow-anomaly
  bullet twice on live NRG (`DIRECTIONAL_FLOW_SKEW` printed back-to-back, byte-
  identical) because the `flow_anomalies` write-time dedup window (15min) is
  narrower than the writer's own 30-min cron interval, so a persisting pattern
  writes a fresh identical-content row every cycle. Fixed by deduping on
  `(anomaly_type, detail)` at render time (keeps the most recent, since the query
  is already `ORDER BY detected_at DESC`). **Check at the open:** pull
  `GET /api/market/swing/play-brief?playId=SWING:<T>&ticker=<T>&status=WATCH` (or
  OPEN) for any ticker whose flow anomaly has been live for >30min and confirm the
  "Flow anomalies" section shows it once, not repeated. Also worth periodically
  re-checking whether the underlying DB-side dedup window itself should widen to
  match the writer's cadence (noted but deliberately not touched by this fix —
  see the staged finding for why).

---

## WATCH LIST — 2026-09-08 live-incident fix (read this before the routine pass)

### 0a-2a. Largo's swing `committed_count` conflated with open positions — docs/swing-committed-vs-open-clarification

**What was broken:** the operator asked (twice) why the Swings board looked underactive. Live UI
screenshot (`proxy-browser.cjs` on `/nighthawk?view=swings`) showed **Open 4 / Watch 26 / Closed
24**, while the API's `committedCount` read **14** and rising — `assembleSwingServingLane` counts
every play with `status === "COMMIT"`, which for SWING means "score cleared the commit floor"
(stamped pre-entry, before any real capital moves) — a real ledger position is ALSO stamped
`status: "COMMIT"` for back-compat, so the one number mixes pre-entry candidates with real open
positions. The command-deck UI already resolves this correctly (`horizonDeckStatus()` downgrades a
COMMIT-status play with no `liveStatus` to `WATCH` for display); the gap was that Largo's own tool
payload (`compactSwingLane`) forwarded the raw, ambiguous `committed_count` with no accompanying
open-position total.

**Fix:** added `open_position_count` (sum of `section_counts.MANAGING + SCALING_OUT + EXITING`) and
a `committed_count_note` to `swingHorizonForLargo`'s payload in `src/lib/largo/product-reads.ts`.
Not a bug in the swing engine/commit funnel — that funnel (score floor → entry execution →
budget/caps/idempotency gates → real position or shadow row) is working as designed.

**Check at the open:** ask Largo "how many swing plays are open right now" during RTH — the answer
should match the live board's Open count, and if `committed_count` is quoted at all it should be
qualified as pre-entry+open candidates, not presented as the open-position count.

---

## WATCH LIST — 2026-09-08 live incident fix (read this before the routine pass)

### 0a-1am. Banger position session_date/expiry served as a garbled, year-less label — live P0 error spike — fix/banger-position-date-bomb (pending)

**What was broken:** `mapBangerPositionRow()` (`src/lib/banger/positions-db.ts`) built `session_date`/`contract_expiry` via `String(r.field).slice(0, 10)` on the raw pg row — correct only if the driver hands back an already-ISO string, wrong for the raw `Date` object node-postgres actually returns for `DATE` columns (no `setTypeParser` override in this repo). `String(date)` runs `.toString()` ("Wed Aug 19 2026 …") and slicing the first 10 chars gives "Wed Aug 19" — not a valid date. That garbled `session_date` flowed into the shared ~1s live-marks poller's `updateZeroDteLiveState($1::date, ...)` call for every open banger position, and Postgres rejected it every tick: **2000+ `error_events` rows per 15-minute window**, live and ongoing when caught (flagged by the ops error-spike alert). Also fixed the identical bug on the four TIMESTAMPTZ columns in the same mapper (`first_seen_at`/`committed_at`/`closed_at`/`updated_at`), which leaked the same garbled format to API responses/Discord without throwing.

**Fix:** Switched to `isoDateString()`/`isoTimestampString()` — the helpers every other row mapper in this codebase already uses for exactly this bug class.

**Check at the open:** `GET /api/admin/errors?limit=20` should show **zero** new `db_query` events with message `invalid input syntax for type date` after this deploys (confirm the deploy landed — check `ecr-push-production.yml` succeeded for the merge commit). `GET /api/market/banger/board` — every open banger row's `expiry` should read as a clean `YYYY-MM-DD`, matching the contract's real expiry, not a truncated weekday-first label.

---

## WATCH LIST — 2026-09-07 coordinator sweep (read this before the routine pass)

### 0a-1al. Vector scenario provenance future-skew reads as unknown — fix/scenario-read-future-skew-freshness (pending)

**What was broken:** `buildScenarioEnvelope()` stamped Vector scenario provenance via `freshnessFromAgeMs(Date.now() - Date.parse(state.asOf))` without the `WS_TIMESTAMP_FUTURE_TOLERANCE_MS` guard already on swing brief paths (#4454/#4455). Clock-skewed future `asOf` returned `"unknown"` instead of fail-closed `"stale"`.

**Fix:** Hoist shared `freshnessFromObservedMs()` to `answer-envelope.ts`; scenario-read provenance delegates to it (play-brief deduped to same helper).

**Check at the open:** Ask Largo a Vector what-if scenario (e.g. "if SPX drops 1%") — section provenance freshness on a healthy snapshot should read `live`/`recent`, not `STALE` or `age unknown`; only future-skewed `asOf` should read stale.

### 0a-1ak. Option mark provenance future-skew reads as unknown — fix/largo-mark-freshness-future-skew (pending)

**What was broken:** `evidenceFromContext` stamped option-mark provenance via `freshnessFromAgeMs(readMs - markMs)`. Clock-skewed future `markAsOf` returned `"unknown"` instead of fail-closed `"stale"` — same class as #4452/#4454 for GEX/fundamentals.

**Fix:** `freshnessFromObservedMs()` applies `WS_TIMESTAMP_FUTURE_TOLERANCE_MS` before `freshnessFromAgeMs`; fundamentals and option-mark paths both delegate to it.

**Check at the open:** OPEN swing row → Ask Largo brief → option-mark evidence freshness must read `stale` (not `unknown`) when mark timestamp is >5s ahead of read time.

## WATCH LIST — 2026-09-06 coordinator sweep (read this before the routine pass)

### 0a-1aj. Ask Largo swing brief future-skew reads as fresh — fix/largo-brief-future-skew-staleness (pending)

**What was broken:** `gexMatrixStale()` and `vectorAgeStale()` in `play-brief-absence.ts` did not fail-closed on clock-skewed future timestamps — negative age read as "not stale", so dealer posture and Vector levels still drove Ask Largo narrative while provenance said unknown.

**Fix:** Mirror `gexStaleFromAge` / `FreshnessChip` semantics — treat `ageMs < -WS_TIMESTAMP_FUTURE_TOLERANCE_MS`, `dataAgeMs === POSITIVE_INFINITY`, and `freshness === "unknown"` as stale for gating.

**Check at the open:** Swings Ask Largo on a play when Vector/GEX snapshot carries future-skewed `asof` — `unavailableSources` must include stale GEX/Vector entries; `resolveGammaPosture` must not cite stale dealer posture.

### 0a-1ai. Stale Vector chart/level fields still read as live in Ask Largo — fix/largo-stale-vector-chart-gating (pending)

**What was broken:** After #4376–#4394 GEX-wall and Vector `play.bias` gates, chart technicals still
badged bullish/bearish off >120s snapshots; `chartLevelsSection` still showed max pain / dark pool /
confluence; `gexPostureSection` still printed net GEX / nearest wall while `unavailableSources` also
flagged stale matrix.

**Fix:** Gate with `vectorSnapshotStale()` / `gexMatrixStale()` in `chartTechnicalsSection`,
`technicalsCoaching`, `chartLevelsSection`, `collectFocalLevels`, and `gexPostureSection`.

**Check at the open:** Swings Ask Largo on a play with stale Vector (`dataAgeMs` > 120) — chart
technicals badge neutral, no "chart reads bullish/bearish" coaching, GEX posture shows only staleness
disclaimer (no net GEX numbers).

---

### 0a-1ah. Stale Vector play.bias in Largo cross-desk coaching — fix/largo-stale-vector-coaching-bias (pending)

**What was broken:** `counterThesisLine()` gated stale Vector `play.bias`, but `crossDeskCoaching()` and
`vectorPlayCoaching()` still cited Vector bearish/bullish alignment from snapshots >120s old — members
saw **"Cross-desk friction — Vector bearish"** or **"aligned with swing lane"** off stale desk reads.

**Fix:** Gate Vector bias usage in `play-brief-narrative-coaching.ts` with `vectorSnapshotStale()` (same
pattern as `counterThesisLine`).

**Check at the open:** Swings Ask Largo on a play where Vector snapshot is stale (`dataAgeMs` > 120 or
`freshness: stale`) — Trade manager read must NOT cite Vector desk alignment/friction unless Vector is live.

---

### 0a-1ag. Stale GEX-only walls/posture in Largo envelope levels + evidence — #4377 (pending)

**What was broken:** `BieAnswerEnvelope.levels` / `.evidence` (Largo desk read key-levels table +
evidence panel) cited stale GEX-only call/put walls, gamma flip, GEX king, and dealer posture when
Vector was absent — sixth Largo C2 surface after chartLevels/watchFor/king-magnet fixes.

**Fix:** Per-side `gexMatrixStale` gating in `levelsFromContext` + `evidenceFromContext`
(`play-brief.ts`). Vector `regime.posture` still drives dealer posture when GEX matrix is stale.

**Check at the open:** Open swing play-brief with `matrix_age_sec` > 120 and no Vector snapshot —
key levels must omit walls/flip/king; evidence must not show `Dealer posture: γ …` unless Vector
regime is live.

---

### 0a-1ac. Short interest missing from envelope.evidence (Largo C7) — fix/largo-short-interest-evidence (pending)

**What was broken:** Catalysts/coaching prose showed DTC and short vol ratio from
`arsenal.fundamentals`, but `envelope.evidence[]` had no structured row — same failure mode #4311
fixed for HELIX flow premiums. Largo evidence rail could not ground short-interest claims.

**Fix:** `evidenceFromContext()` emits `Short interest: DTC … · short vol ratio …` with
`provenance.asOf` from `fundamentals.as_of`.

**Check at the open:** WATCH swing with fundamentals populated — play-brief API returns evidence row
starting with `Short interest:` matching Catalysts section numbers.

---

### 0a-1af. WATCH rows falsely flagged option mark unavailable in Ask Largo — fix/swing-brief-watch-mark-absence-false-positive (pending)

**What was broken:** WATCH candidates carry a static chain mid with no `markAsOf` (`markIsSync: true`
by design). The play-brief absence collector, `dataHonestyCoaching`, and `dataFreshnessSection`
treated this as a C3 failure (`option mark: sync quote without freshness timestamp`), surfacing an
`UnavailableChip` on the most common Ask Largo surface even though the quote shape is expected
pre-entry.

**Fix:** Introduced `playExpectsLiveOptionMark()` — only OPEN/HOLD/TRIM rows expect live mark
freshness. Applied consistently across absence, coaching, and intel sections.

**Evidence:** 3 new tests (absence + coaching + intel). 73/73 in touched test files GREEN.

**Check at the open:** Swings desk WATCH tab → select a candidate → Ask Largo panel must NOT show
an `UnavailableChip` for "option mark" when the only signal is the expected static chain mid.

---

### 0a-1aa. Hold plan still repeated the thesis-health advisory sentence after #4261's recNote fix — fix/swing-brief-holdplan-thesis-advisory-dup (pending)

**What was broken:** #4261 fixed `holdPlanSection` repeating `recNote`/rails/manage-engine content
already owned by Management, but left a second, same-class duplicate: the
`play.thesisHealth.advisory` sentence rendered verbatim — the exact text
`tradeManagerNarrativeSection`'s pillar-fade narration already carries in "Trade manager read"
(both sections render together for any live play). Confirmed still present on `main` post-#4261.

**Fix:** Dropped the `— {advisory}` suffix from Hold plan's thesis-health line; kept
`Thesis health **{health}%** ({rungLabel})` as a compact number, not a repeated sentence.

**Evidence:** 1 new test in `play-brief-intel.test.ts` (RED pre-fix: 1/21 fail in that file; GREEN
post-fix). `play-brief-intel.test.ts` + `play-brief.test.ts`: 36/36. Full `src/lib/swing/*.test.ts`:
678/678. `npx tsc --noEmit`: clean.

**Blast radius:** `holdPlanSection` only.

**Check at the open:** `GET /api/market/swing/play-brief?playId=...&expandIntel=1` on a live OPEN
position with a degraded thesis health — confirm the advisory sentence appears once (in Trade
manager read), not repeated under Hold plan.

---

### 0a-1ab. Swing Ask Largo dark pool level provenance mislabeled HELIX — fix/swing-brief-darkpool-provenance (pending)

**What was broken:** `levelsFromContext()` stamped Vector-sourced dark pool strikes (`ctx.vector.darkPoolLevels` from `getVectorDarkPoolLevels`) with `envelope.levels[].provenance.source: "HELIX"` while confluence/max-pain rows from the same Vector snapshot correctly read `"Vector"` — Largo C8 provenance violation that corrupts cross-product joins.

**Fix:** Change dark pool level `provenance.source` from `"HELIX"` → `"Vector"`. Regression test in `play-brief.test.ts`.

**Check at the open:** Swings desk → select a play with Vector dark pool levels → Ask Largo level table / SourceStamp for dark pool row must show **Vector**, not HELIX.

---

### 0a-1ae. Stale Vector narrated as "Right now" in dealer posture — fix/swing-brief-stale-vector-right-now (pending)

**What was broken:** `dealerPostureLine()` always led with **"Right now"** even when Vector snapshot was stale (`dataAgeMs > 120s` or `freshness === "stale"`), while structured absence and data honesty coaching correctly flagged staleness — Largo C2 contradiction.

**Fix:** Qualify lead-in as **"Last snapshot (~Ns old)"** when Vector is stale; keep **"Right now"** only on fresh reads.

**Check at the open:** On Swings with a stale Vector read (>2 min), Ask Largo Trade manager read dealer posture line must say **Last snapshot**, not **Right now**.

---

### 0a-1ad. Stale HELIX mislabeled "quiet" in dataHonestyCoaching — fix/swing-brief-helix-stale-coaching-copy (pending)

**What was broken:** When `flow_feed_fresh === false`, `dataHonestyCoaching()` said "HELIX feed quiet" while `unavailableSources` and `dataFreshnessSection()` correctly labeled pipeline **stale** — C3 absence contradiction.

**Fix:** Align coaching copy: "HELIX pipeline stale — flow read unavailable, not evidence of quiet tape".

**Check at the open:** During HELIX pipeline stale window, open Ask Largo on a swing row — Trade manager read Data caveat must say **pipeline stale**, not "feed quiet".

---

### 0a-1ac. HELIX put-only flow build missed by "what changed" diff — fix/swing-brief-helix-put-flow-diff (pending)

**What was broken:** `diffBriefSnapshots()` only entered the HELIX flow-shift branch when call premium moved >$50k. Put-building was nested inside that branch, so flat call + surging puts emitted zero diff lines on refresh.

**Fix:** Independent `putMoved` check mirrors call logic; put-only builds emit `HELIX tape: put flow building`.

**Check at the open:** On Night Hawk Swings OPEN tab, refresh a SHORT play where put premium is building but call is flat — Trade manager read pulse should include put flow building line.

---

### 0a-1ad. Desk context rendered "closed **open**" for an unresolved last swing — fix/swing-brief-desk-context-unresolved-outcome (pending)

**What was broken:** `deskConsensusSection` hardcoded "closed **{outcome}**" but `outcome` can be `"open"`/`"pending"` (unresolved), producing a live contradiction — confirmed on `SWING:AAPL` positionId 36's CLOSED brief.

**Fix:** Render "is still **unresolved**" for `outcome === "open" | "pending"`; terminal outcomes (`target`/`stop`/`ambiguous`/`unfilled`) keep the existing "closed **{outcome}**" phrasing.

**Check at the open:** Pull a CLOSED swing brief (`?status=CLOSED&expandIntel=1`) for any ticker whose last Night Hawk swing is still open/pending — "Desk context" should read "is still unresolved", never "closed open"/"closed pending".

---

### 0a-1z. A total ecosystem/Vector fetch failure was indistinguishable from legitimately-empty data — never reached the structured unavailableSources channel — fix/swing-ecosystem-vector-total-fetch-failure-absence (pending)

**What was broken:** `fetchEcosystemContext`/`fetchVectorFullState` were wrapped in
`.catch(() => null)` in `play-brief-context.ts` with no signal captured — a total fetch failure
(network, timeout, provider error) was structurally indistinguishable from "legitimately nothing
to report." The existing `unavailableSources` plumbing only covered a failure WITHIN a successful
ecosystem read (`arsenal.unavailable_sources`), not the whole call throwing.

**Fix:** Added `ecosystemFetchFailed`/`vectorFetchFailed` booleans to `SwingPlayBriefContext`, set
in the loader's `.catch()` handlers, read by `collectBriefUnavailableSources()` to push a
structured entry — same shape as the existing HELIX/open-book/Meridian/option-mark absence
entries.

**Check at the open:** No easy live repro (requires an actual Polygon/UW/Vector fetch failure at
brief-composition time). Note "no fetch failure observed this session" rather than treating
silence as a pass.

---

### 0a-1y. Option-mark "not synced to live tape" caveat was narrated in prose but never reached the structured unavailableSources channel — fix/swing-markissync-not-structured-absence (merged #4245)

**What was broken:** `dataHonestyCoaching()` already computes `play.markIsSync === true` (sync
quote without a freshness timestamp) and turns it into a "Data caveat" bullet in the "Trade manager
read" narrative. `collectBriefUnavailableSources()` — the function populating the envelope's
structured `unavailableSources` array (Largo C3) — never read this boolean at all, only
`flow_feed_fresh`. A consumer reading the structured contract fields (the entire reason C3 mandates
a structured absence channel) would conclude the mark is fully live when the system's own code
already knows it isn't.

**Fix:** Added `markIsSync === true` to `collectBriefUnavailableSources()`, pushing
`{ source: "option mark", reason: "sync quote without freshness timestamp" }` — same shape as the
existing HELIX/open-book/Meridian entries in the same function.

**Check at the open:** For any live position whose Ask Largo brief narrative shows "mark not
synced to live tape" in its Data caveat, confirm the same brief's `envelope.unavailableSources`
now also carries `{"source":"option mark","reason":"sync quote without freshness timestamp"}` —
not just prose.

---

### 0a-1x. Ex-dividend read failure silently re-enabled the Q39 fail-open structural-stop bug on a still-valid LONG thesis — fix/ex-dividend-fail-open-structural-stop (merged #4239)

**What was broken:** `resolveSwingExDividendContext` (`ex-dividend-reads.ts`) caught ANY
`fetchPolygonDividends` failure (rate limit, timeout, network blip) and returned
`{ exDividendSession: false, exDividendCash: null }` — byte-identical to "confirmed: today is not
an ex-dividend day." `manage.ts`'s `structuralStopBroken()` only adjusts the LONG structural-stop
compare (adds the cash dividend back onto spot) when `exDividendSession === true` — Q39's whole
point (#3909) is to stop a legitimate ex-div mechanical price drop from reading as a real thesis
break. A Polygon error on the dividends fetch — nothing to do with whether the ticker actually
went ex-div — collapsed straight into the un-adjusted compare, so a real ex-div gap on a day the
dividends feed happened to be flaky could fire a capital-preservation `EXIT`/`structural_stop` on
a position whose thesis never actually broke. Same fail-open shape was duplicated in
`swing-active-refresh/route.ts`'s outer `.catch` around the same call.

**Fix:** `resolveSwingExDividendContext` now returns a third field, `dataUnavailable: boolean`
(`true` only when the Polygon read itself failed; `false` on every real resolution, including a
genuine non-ex-div day). Forwarded through `ManageSyncReads.exDividendDataUnavailable` →
`SwingManageInput.exDividendDataUnavailable`. `structuralStopBroken()` now fails SAFE: when the
LONG compare is about to declare a breach AND this cycle's ex-div data was unavailable, it returns
`broken: false` (skip enforcement this cycle — the next ~15-min refresh retries with fresh data)
instead of trusting the unverifiable `false`. Scoped to LONG only (the adjustment never touches
SHORT) and only when a breach would otherwise fire — a genuine SHORT breach, or a LONG position
nowhere near its stop, behaves identically to before. Also added the first REAL behavior tests for
`resolveSwingExDividendContext` (`ex-dividend-reads.test.ts`) — the pre-existing
`ex-dividend-reads-freshness.test.ts` only regex-scans the source file and never calls the
function, so it could not have caught this.

**Check at the open:** No user-visible UI change expected under normal conditions (the fix only
changes behavior on a real Polygon-dividends fetch failure, which is rare and transient). If any
swing position's Ask Largo brief or the `/nighthawk` Swings board shows a `structural_stop` EXIT
around 09:30–10:00 ET on a name that is confirmed ex-dividend that same session (check
`GET /api/market/swing/record` for the position's ticker against a dividends calendar), cross-check
CloudWatch logs (`/ecs/blackout-production`, filter on `swing-active-refresh`) for a
`fetchPolygonDividends`/dividends-related error around the same timestamp — if present, the
position should NOT have been exited (the fail-safe should have skipped it that cycle) and is worth
flagging as a regression. Absent any observed Polygon dividends-fetch failure during the session,
there is nothing to observe live (the code path is a rare-error branch) — note "no ex-div fetch
failure observed this session" rather than treating silence as a pass.

---

### 0a-1w. Option-mark timestamps reached the swing play-brief as raw ISO-8601 UTC instead of the Largo C1 ET stamp — fix/swing-markasof-raw-iso-not-et (merged #4236)

**What was broken:** `play.markAsOf` (a raw ISO string from the DB) was inserted unconverted into
three places: the "Position" section body (`Mark: **$X** (2026-09-04T21:45:18.663Z)`), the
top-level evidence array (`text`/`provenance.asOf`), and the "Data freshness" section — all
violating Largo contract C1 ("YYYY-MM-DD HH:mm ET", never a bare epoch/ISO instant). The brief's
own top-level `asOf` was already fixed this way in PR #4142, but that fix didn't touch `markAsOf`.
Live evidence: all 4 sampled open-position envelopes (CG, NN, NRG, CRWD) showed the raw-ISO pattern.

**Fix:** Added `etStampFromIso()` to `bar-session-date.ts` (parses a raw ISO instant, falls back to
the original string if unparseable) and wired it into all three `markAsOf` render sites. The
internal freshness-age math (`Date.parse` against the raw value) is untouched — only the displayed
string changed.

**Check at the open:** Open any live SWING position's Ask Largo brief
(`GET /api/market/swing/play-brief?playId=SWING:<TICKER>`) and confirm the "Position" and "Data
freshness" sections, plus the top-level `evidence[].text`/`provenance.asOf` for the option-mark
entry, all show `YYYY-MM-DD HH:mm ET` — never a string ending in `Z` or containing `T`.

---

### 0a-1u. CLOSED swing positions served a live-recomputed (negative/nonsensical) DTE instead of the frozen exit-date DTE — fix/swing-closed-dte-negative (merged #4231)

**What was broken:** `closedDeckSourceFromRow` (`closed-plays.ts`) computed a CLOSED position's
`contract.dte` as `calendarDte(etYmd(), expiry)` — days between **today** (the moment the record is
being *viewed*) and the contract's expiry — for a trade that already finished, possibly weeks ago.
The swing ledger carries no dedicated dte-at-entry/dte-at-exit column, so this live-recomputed
number was the only DTE ever served for a closed trade, and it silently changed (and eventually
went negative once the contract itself expired) every time the record was re-viewed. Live
production evidence: EWZ and GLW (expiry 2026-09-04, viewed 2026-09-06) both showed `dte: -2`; a
graded AAPL row (true DTE at entry 6 / at exit 5) showed `dte: 3` — neither true value, just "days
from right now." The number flows straight into the member-facing `contract` string
(`${strike}${right} · ${dte}DTE`, `adapters.ts` `terminalPlayFromHorizon`/`terminalPlayFromClosedSwing`)
rendered on both `/api/market/swing/record`'s closedDeck array and the Ask Largo play-brief headline
for a closed position (`/api/market/swing/play-brief` resolves a CLOSED play via
`play-brief-resolve.ts`'s `loadClosedPlay` → the same `closedDeckSourceFromRow`).

**Fix:** `dte` for a CLOSED row is now frozen to the trade's own exit timestamp
(`row.closed_at ?? row.graded_at`, both fields the ledger already carries) instead of `etYmd()`
(today) — `calendarDte(exitAt, expiry)`, "days to expiry as of the day this trade actually closed."
This value never moves on re-view and stays 0 (not negative) for a contract that expired the same
session it closed, instead of drifting further negative every day the record is read afterward.
Left untouched on purpose: live OPEN/HOLD/TRIM positions (`live-plays.ts`'s `contractFromRow`),
where "DTE as of right now" IS the meaningful, correctly-live number for a still-open position.

**Check at the open:** Open `/nighthawk` → Swings → CLOSED tab (or fetch
`GET /api/market/swing/record`) and inspect any graded CLOSED row whose contract has since expired
(expiry date at or before today) — `contract.dte` must read `0` or a small non-negative number tied
to how many days before/at expiry the trade actually closed, never negative. Cross-check the same
position's Ask Largo brief (`GET /api/market/swing/play-brief?playId=SWING:<TICKER>&positionId=<id>`)
renders the identical frozen DTE in its headline/contract string, not a different (live-recomputed)
one. If every currently-graded CLOSED row happens to still be pre-expiry, note "no post-expiry CLOSED
row observed at open" rather than treating silence as a pass, and instead confirm the DTE shown for
any CLOSED row matches `calendarDte(closed_at date, expiry date)` by hand for at least one row.

---

### 0a-1w. Ask Largo swing brief repeated the SAME recNote sentence in two sections — "Why this setup" read as a bullet dump, not one trade-manager voice — fix/swing-brief-why-setup-recnote-dup (merged #4257)

**What was broken:** found live during the 2026-09-06 5-engine monitor's Ask Largo deep-dive on
`SWING_NRG_34` (NRG 110C, HOLD, thesis health 46%). `play.recNote` is already rendered verbatim —
once, correctly — by `managementSection` for the open bucket (`play-brief.ts:64`) or by the Verdict
section for the watch bucket (`play-brief.ts:292`). `whyThisSetupSection` (`play-brief-intel.ts:55`)
pushed the exact same string a SECOND time for any non-CLOSED play (`play.status !== "CLOSED"`),
so the composed brief showed:

> Management: "live hold — swing thesis Thesis health 46% — Thesis fading — tighten risk or trim into strength."
> Why this setup: "live hold — swing thesis Thesis health 46% — Thesis fading — tighten risk or trim into strength." *(then, separately, "No pillar breakdown on this row — grade is from lane score only.")*

Word-for-word repetition of a full sentence across two sections in one brief — the opposite of the
"one connected trade-manager-voice synthesis instead of separate bullet-dump sections" standard
`tradeManagerNarrativeSection` (#4084) set for this product, and it crowded out "Why this setup"'s
actual job (the pillar/signal breakdown behind the grade) with a repeat of text the member had
already read one section above.

**Fix:** Removed the duplicate `recNote` push from `whyThisSetupSection`; the section now carries
only signals-fired / archetype / regime / pillar-or-lane-score content — exactly what its title
promises and nothing already said above it.

**Evidence:** 2 new tests in `play-brief-intel.test.ts` (RED pre-fix: `whyThisSetupSection` still
contained the verbatim `recNote`; GREEN post-fix). `play-brief-intel.test.ts` + `play-brief.test.ts`:
31/31 pass. Full `src/lib/swing/*.test.ts`: 660/660 pass. `npx tsc --noEmit`: clean.

**Blast radius:** `whyThisSetupSection` only — `managementSection`/Verdict's own `recNote` rendering
is untouched, so the sentence still appears exactly once per brief.

**Check at the open:** Open `/nighthawk` → Swings → Ask Largo on any live OPEN or WATCH position
carrying a `recNote` (e.g. a HOLD/TRIM play with a thesis-fading note) and confirm the note text
appears in Management (open) or Verdict (watch) but is NOT repeated verbatim under "Why this
setup" — that section should show only signals/archetype/pillar content.

---

### 0a-1x. Hold plan duplicated Management stance/note/rails on OPEN swings — fix/swing-hold-plan-recnote-dup (pending)

**What was broken:** For OPEN/HOLD plays where Hold plan renders (no Trade manager read narrative, or
`expandIntel`), `holdPlanSection` repeated `recNote`, desk stance, trim ladder, rails, and manage
engine — all already in **Management** one section above.

**Fix:** `holdPlanSection` now carries only hold-specific coaching (DTE/theta, earnings window,
session time stop, runner fraction, thesis-health fade/giveback).

**Check at the open:** On a live HOLD swing with `recNote` and DTE on the contract, confirm the note
appears once under Management; Hold plan (if visible) shows time/earnings/theta only.

---

### 0a-1v. Chart technicals bias badge echoed the play's LONG/SHORT direction instead of the technicals it labels — fix/swing-chart-technicals-bias-direction-echo (merged #4232)

**What was broken:** `chartTechnicalsSection`'s `bias` field (`play-brief-intel.ts`) was set from
`play.direction === "SHORT" ? "bearish" : play.direction === "LONG" ? "bullish" : "neutral"` — a pure
echo of the position's own direction, carrying zero information from the EMA stack / MACD / VWAP
side / market-structure lines the badge is attached to. Live evidence: an INTC SHORT play tagged
`[bearish]` while its own body read EMA-up, price-above-VWAP, RSI 67, MACD bull, CHOCH up (an
entirely bullish tape); an NN LONG play tagged `[bullish]` while its body read EMA-down,
price-below-VWAP, MACD bear, BOS down (entirely bearish); a closed AAPL LONG play tagged `[bullish]`
on its own post-mortem while its technicals read entirely bearish. Misleading exactly when it
matters most — reviewing why a losing play failed, or judging whether current technicals still
support an open position.

**Fix:** Added `technicalsBias()` — a majority vote across the four directional signals already
rendered in the section (EMA stack up/down, MACD bull/bear, spot-vs-VWAP side, market-structure
BOS/CHOCH direction). A 2-2 split or no readable signals falls back to `neutral`. `chartTechnicalsSection`
no longer takes a `play: TerminalPlay` param at all — its bias is derived entirely from the
technicals it already has in hand.

**Check at the open:** Open `/nighthawk` → Swings and inspect the "Chart technicals" section's bias
badge on a live position — confirm it agrees with the EMA stack / MACD / VWAP-side / structure lines
printed directly below it (majority read), not with whether the play itself is LONG or SHORT. A
SHORT play with a bullish-reading tape should show a bullish (not bearish) badge, and vice versa.

---

### 0a-1t. SWING Management Action card fabricated a "TRIM 33%" size once the single trim tranche had already fired — fix/swing-trim-size-fabricated-33pct (pending)

**What was broken:** `managementActionDisplay` (`terminal-display.ts`) sized every TRIM action
off `play.exitPolicy.trim_levels.find(t => !t.fired)`, falling back to a hardcoded `33` when no
unfired level remained. SWING's exit policy (`SWING_SCALE_OUT_POLICY`) is a single-tranche ladder
(one level banks 50% at 2x, then a runner) — once that level fires, which is true for essentially
every SWING play whose recommendation reaches TRIM, the `33` fallback fired, rendering "TRIM 33%"
in both the Ask Largo action strip (`SwingLargoInsightsPanel.tsx`) and the main terminal's
Management tab (`TerminalPremiumPanels.tsx`), directly contradicting the SAME panel's own
narrative text ("all trims banked — runner only"). The `33` is a 0DTE-only constant (0DTE's real
trim ladder is 3 tranches of ⅓ each) with no relationship to SWING's policy at all.

**Fix:** Removed the hardcoded fallback; `sizePct` is now `null` (bare "TRIM" verb, no percentage)
when no unfired trim level remains — matching `play-card-lifecycle.ts`'s `swingActionDisplay`,
which already handles this exact case honestly. Both render call sites were already null-safe.

**Check at the open:** For any live SWING position whose `liveStatus`/recommendation is TRIM and
whose single trim tranche has already fired (peak premium ≥ entry × 2), the Management tab
(`/nighthawk` → open a live SWING position → Management tab) and the Ask Largo action strip
should show a bare **"TRIM"** pill with NO percentage — not "TRIM 33%". Cross-check against the
same position's Ask Largo narrative text, which should independently say something like "all
trims banked — runner only" for the same position; the two should now agree instead of
contradicting each other. If no live SWING position is in this exact state at open, note "no
qualifying all-fired TRIM position observed" rather than treating silence as a pass — also spot
check a SWING position whose trim tranche has NOT yet fired still shows the real percentage
(e.g. "TRIM 50%"), confirming the fix didn't overcorrect to always-null.

---

### 0a-1p. Swing serving-snapshot TTL (26h) doesn't survive the weekend — silently zeroed thesis-health enrichment for every live position — fix/swing-serving-snapshot-weekend-ttl (PR #4202, pending)

**What was broken:** `SWING_SERVING_TTL_SEC` was `26h`, sized for the ordinary weekday scan cadence but `swing-discovery` is `weekdays_only` — so the Friday POST_CLOSE write expires Saturday evening and the persisted snapshot stays empty through Monday morning (~35h+/week). Both `getSwingServingLane` (main board) and `play-brief-resolve.ts`'s `loadOpenTerminalPlay` (Ask Largo, #4182) key their `attachThesisExplanation` factors/regime enrichment off this one snapshot, so an expired key silently reverted **every live committed position's** Ask Largo thesis-health panel to the generic `46% · Degraded`/`unread` defaults — confirmed live 2026-09-06 (Sunday): all 4 open positions (NRG:34, NN:32, CG:25, CRWD:19) byte-identical to the pre-#4182 audit snapshot, `scanAsOf: null` on `/horizons?view=swings`.

**Fix:** `SWING_SERVING_TTL_SEC` raised `26h → 120h` (5 days), sized past the measured worst ordinary gap (Friday POST_CLOSE → Monday PRE_OPEN, ~58h) plus headroom for a Monday holiday (~82h). New regression test derives the worst-case gap from `SWING_SCAN_PHASES` itself so it can't silently drift again.

**Check at the open (Monday 2026-09-07, a market holiday — so also check Tuesday):** `GET /api/market/nighthawk/horizons?view=swings` should show a non-null `scanAsOf`/`scanSessionDay` even first thing Monday/Tuesday morning before the day's own scan has run; `GET /api/market/swing/play-brief` for any live committed position should show a "Thesis health" regime pillar that is NOT the generic `unread`/`46% · Degraded` default if a matching discovery dossier exists from the prior week.

### 0a-1q. Stale HELIX coached cross-desk friction + counter-thesis — fix/swing-stale-helix-crossdesk (pending)

**What was broken:** When `flow_feed_fresh === false`, Ask Largo still cited stale `recent_flow` in `crossDeskCoaching` (`HELIX call-led` / `HELIX put-led`) and `counterThesisLine`, contradicting the C2/C3 absence contract already enforced in `flowNarrative` and `collectBriefUnavailableSources`.

**Fix:** Route both paths through `trustedHelixFlow()` — stale pipeline rows become absence, not signal.

**Check at the open:** For a ticker whose HELIX feed is quiet (`flow_feed_fresh: false` in ecosystem context), Ask Largo brief must show the `HELIX flow · pipeline stale` unavailable chip and must NOT include `HELIX call-led` / `HELIX put-led` in Trade manager read or counter-thesis bullets.

### 0a-1r. Meridian absence + Vector cross-desk friction missing from Ask Largo envelope/narration — fix/swing-largo-meridian-absence-vector-crossdesk (pending)

**What was broken:** (1) Meridian timeline fetch failures set `meridian.unavailable: true` and honest prose in the catalyst section, but `collectBriefUnavailableSources` never forwarded it to `envelope.unavailableSources` — Largo C3 violation; `UnavailableChip` stayed silent. (2) `crossDeskCoaching` named NH/0DTE/HELIX friction but never Vector `play.bias`, and `vectorPlayCoaching` falsely aligned on thesis substring (`"long"` inside `"Long gamma"`).

**Fix:** Forward Meridian unavailable into envelope sources; add Vector bias to cross-desk friction; align `vectorPlayCoaching` on `vp.bias`.

**Check at the open:** On a ticker where Vector `play.bias` opposes the swing direction, Trade manager read should include `Vector bearish`/`Vector bullish` in the cross-desk friction line. If Meridian timeline is unavailable (simulate or catch a real failure), `unavailableSources` should list `Meridian catalysts · timeline read failed`.

### 0a-1s. checkPortfolioOverlap's self-match exclusion swallowed a genuine second same-ticker/same-direction position — fix/swing-portfolio-overlap-self-match (pending)

**What was broken:** `checkPortfolioOverlap` excluded EVERY existing row matching the candidate's
ticker+direction (not just the one meant to represent "the candidate's own position"), so two
independent open positions on the same ticker+direction (allowed by design — `commit.ts`'s
`swingThesisKey(ticker, direction, archetype)` treats a different archetype on the same name+side
as a different thesis) both got excluded, silently hiding the concentration from Ask Largo's "Book
context" section and the swing entry gate's `portfolio_overlap` soft penalty. Live evidence: the
book's own `record.json` shows EWZ (rootPositionId 29 & 26) and WULF (rootPositionId 17 & 13) each
with two separate `long` position chains — exactly the shape this bug could not see.

**Fix:** Self-match exclusion now skips only the FIRST row sharing ticker+direction; any additional
matching row is correctly counted in `sameThemeSameDirection`.

**Check at the open:** For any live position whose ticker has (or gains) a second independent
open position in the same direction (check `GET /api/admin/zerodte/tier-export`-style ledger export
or the book itself for a repeated ticker+direction pair), Ask Largo's play-brief "Book context"
section for either position should now show a **Concentration** line naming the OTHER position —
not silence. If no such double-position ticker exists live at open, this is unverifiable that day;
note "no qualifying ticker pair observed" rather than treating silence as a pass.

---

### 0a-1o. Ask Largo swing thesis-health dead-wired to identical reading for every live position — docs/swing-brief-thesis-health-dead-wired (pending, follows the deep audit PR #4178)

**What was broken:** Every live/committed swing position's Ask Largo play-brief rendered the byte-identical `46% · Degraded` thesis-health score regardless of real P&L (confirmed on all 4 currently-open positions: +98.0%, 0.0%, +33.7%, +24.6% all identical). `livePlayFromSwingPosition` never populates `factors`/`regime`, and the fix that already exists for the main board (`serving-lane.ts`'s `attachThesisExplanation`) was never wired into the Ask Largo play-brief resolver.

**Fix:** `loadOpenTerminalPlay` (`play-brief-resolve.ts`) now calls `discoverSwingFromPersisted()` + `attachThesisExplanation()` before building the `TerminalPlay`, mirroring the board's own restoration. Restores the **regime** pillar (15% weight) with real data; persistence/entry_geometry/flow_corroboration (70% weight) remain a tracked follow-up — see the finding's "Scope note" for why those three are NOT safely fixable the same way.

**Check at the open:** `GET /api/market/swing/play-brief` for a live OPEN/HOLD/TRIM position whose ticker still has an active discovery dossier — the "Regime fit" pillar line should show a real regime/archetype read, not the generic "unread" default. Compare two different live positions' thesis-health panels — they should no longer be byte-identical if their dossiers differ.

---

### 0a-1m. Swing Ask Largo — fabricated play-brief confidence — fix/swing-brief-omit-fabricated-confidence (merged #4174)

**What was broken:** `composeSwingPlayBrief()` always stamped `envelope.confidence` as `high` or `moderate` from a coarse `hasRichData` boolean. Largo contract C6 requires omitting confidence when the lane cannot calibrate it — the fabricated score could corrupt cross-product ranking and mislead markdown/Largo exports.

**Fix:** Remove the swing play-brief confidence block; stop `buildRichEnvelope()` from defaulting missing confidence to `high` (concept answers still pass explicit confidence).

**Check at the open:** `GET /api/market/swing/play-brief` for any swing row — `envelope.confidence` should be absent/undefined; Ask Largo panel should not show a confidence badge on the full brief export.

---

### 0a-1n. Thermal `/heatmap` pulse SSE header change_pct session-open anchor — fix/thermal-pulse-change-pct-anchor (pending)

**What was broken:** When the pulse SSE overlay won on SPX/VIX index tickers, `GexHeatmap` fell back to raw `pulseSnap.change_pct` from `indexStore` — measured from session open (ws-bar anchor), not prior close. Same failure class as the 2026-08-07 SPX desk P0; `usePulseStream` was fixed but Thermal called `createPulseEventSource` directly.

**Fix:** (1) V-channel ticks only recompute `change_pct` when `open_source === "rest"`; (2) pulse SSE route sanitizes index wire via `clusterIndexSpotChangePct`; (3) GexHeatmap derives SPX from prior close and gates VIX on REST anchor.

**Check at the open:** `/heatmap` with SPX selected during a gapped session — header day-change% must match SPX desk pulse tile (not invert sign vs true prior-close move). Toggle VIX index header the same way.

---

### 0a-1l. Night Hawk deck etClock — duplicate parser missed Largo C1 asOf — fix/play-terminal-etclock-c1-parse (pending)

**What was broken:** `PlayTerminal.tsx` exported a local `etClock` that only `Date.parse()`d ISO strings. After #4142/#4152 stamped play-brief `asOf` as `YYYY-MM-DD HH:mm ET`, any C1 stamp routed through the deck why-now ribbon or CommandDeck row chips would render blank time (`— ET`).

**Fix:** Delegate `PlayTerminal.etClock` to `@/lib/et-clock` with `{ hour12: false, pad: true }` so ISO and C1 stamps share `parseEtStamp()`.

**Check at the open:** Swings OPEN row with play-brief `asOf` in C1 format → why-now ribbon and deck row chips show `HH:MM ET`, not `— ET`.

---

### 0a-1k. Swing Ask Largo — Desk context duplicated HELIX anomalies — fix/swing-brief-desk-context-dedup (merged #4128)

**What was broken:** `deskConsensusSection` repeated `recent_anomalies[0]` even though Trade manager read (`flowNarrative`) and Flow & positioning already surface the same sweep — members saw the anomaly up to three times. Stale collapse title `Desk consensus` never matched section title `Desk context`.

**Fix:** Desk context renders only Night Hawk outcome history (unique vs `crossDeskCoaching`); remove stale collapse allowlist entry.

**Check at the open:** Swings OPEN row with a live HELIX anomaly → Ask Largo panel mentions the sweep once in Trade manager read; Desk context appears only when NH outcome history exists.

---

## WATCH LIST — 2026-09-07 coordinator sweep (read this before the routine pass)

### #67. Largo swing brief per-contract premium rounding — fix/largo-swing-premium-format — #4556 (merged)

**What was broken:** `play-brief-narrative.ts` reused the flow-scaled whole-dollar `fmtUsd` for
per-contract option premiums (mark, stop_premium rails) — same brief showed `+$9.70` in Position
and `$10` in the Trade Manager narrative for the same field.

**Fix:** Added `fmtOptionUsd` (2-decimal signed, matching `play-brief.ts`'s formatter) and switched
the three per-contract call sites; flow/aggregate call sites (HELIX tape, dark-pool notional)
correctly kept the original scaled `fmtUsd`.

**Check at the open:** Open Ask Largo on any live swing position with a fractional per-contract
mark/stop — Position section and the narrated Trade Manager read must show the SAME precise value
(e.g. `+$9.70`, not `$10`), not two different roundings of the same field.

### desk-warm `?force=1` off-window hammering — fix/desk-warm-off-window-force-cooldown (pending)

**What was broken:** On Labor Day (NYSE full-day closure, a weekday — market closed), CloudWatch
showed 166 `force=1` bypasses of the desk-warm hours gate in 6h from 47+ distinct source IPs (not
any known in-app dispatcher), 70 full runs completed, correlating with a measured ALB p99 68s /
Max 100s spike. Root external caller not identified from repo code; fixed defensively at the route.

**Fix:** `desk-warm/route.ts`'s force=1 rate-limit floor now widens from 60s to 300s when the call
lands outside the extended warm window (`isEtExtendedWarmHours`) — a single on-demand debug hit is
unaffected, a repeated off-window caller is throttled 5x harder.

**Check at the open:** Next off-hours/holiday window, re-run the same CloudWatch query
(`filterPattern='"force=1 bypassed" "desk-warm"'` over `/ecs/blackout-production`) — completions
should now be capped at roughly 1 per 5 min even if the same external caller is still hammering it,
and ALB TargetResponseTime p99/Max should no longer show the same tail-latency spike shape during
a market-closed window. If the mystery caller is still found, identify and fix it at the source
too — this PR only hardens the receiving end.

## WATCH LIST — 2026-09-05 coordinator sweep (read this before the routine pass)

### 0a-1j. Swing Ask Largo OPEN brief — ticker collision picked WATCH lane row — fix/swing-play-brief-ticker-collision (pending)

**What was broken:** Selecting an OPEN swing row (e.g. NRG 110C HOLD) fetched `/api/market/swing/play-brief?playId=SWING:NRG` and resolved the WATCH lane row (115C) — UI showed `Entry` sections instead of `Management`, headline contract mismatch. Post-#4056 prod validation OPEN tab RED.

**Fix:** Stamp ledger `positionId` on live horizon rows → `SWING:{TICKER}:{id}` play ids; pass `positionId` in brief URL; prefer live ledger row in `pickLanePlayForBrief` when status hint absent; disambiguate multi-row open ledger by contract/status.

**Check at the open:** Swings desk OPEN tab → select a ticker with both OPEN capital and WATCH lane rows (NRG if still present) → Ask Largo panel must show **Management** + **Position** sections matching the selected row's contract; re-run `node scripts/audit/ask-largo-swing-brief-validate.mjs` → OPEN pass.

### 0a-1i. Cluster health future-skew + VIX SSE change% gate — fix/cluster-health-vix-sse-change — #4054 (pending)

**What was broken:** (1) `buildUwClusterHealth` / `readPolygonClusterHealth` used `Math.max(0, now - at)` — a clock-skewed future heartbeat read as age 0 and `cluster_live: true` on web-tier followers while `uw-socket.ts` already used `isWsUpdatedAtFresh`. (2) SSE pulse overlay transported `vix_change_pct` verbatim; ws-bar anchors measure from session open, not prior close — same failure class as the 2026-08-07 SPX P0 but VIX has no prior close to derive from.

**Fix:** Route cluster liveness through `isWsUpdatedAtFresh` + `wsUpdatedAtAgeMs`. Gate VIX SSE overlay via `restAnchoredIndexChangePct()` (`open_source === "rest"` only).

**Check at the open:** Admin Operations → socket-health during RTH — follower replicas must not show UW/Polygon cluster live when heartbeat timestamp is skewed. SPX desk header VIX change% must agree with REST pulse when SSE stream carries ws-bar anchor (toggle network: compare `/api/market/spx/pulse` vs live SSE overlay during first 30 min after open).

### 0a-1h. Polygon single-ticker snapshot fabricated flat 0% change — cursor/autopilot-work-loop-ce5a (pending)

**What was broken:** `fetchStockSnapshot()` → `_rowToSnapshot()` returned `change_pct: 0` when Polygon omitted `todaysChangePerc` and `prevDay.c`, while batch movers already used `snapshotChangePctFromRow()` (null when absent).

**Fix:** Wire `_rowToSnapshot` to `snapshotChangePctFromRow(row)`; type `change_pct` as `number | null`.

**Check at the open:** `/api/market/quote?ticker=SPY` during pre-open with no prior close must omit change % (null/—), not show flat `0.00%`.

### 0a-1g. SPX play gate: future-skewed gex_age_ms bypassed stale block — fix/spx-play-gate-gex-age-future-guard (pending)

**What was broken:** `gexStaleFromAge()` correctly lit the GEX stale pill when `pos.asof` was clock-skewed into the future (>5s), but `evaluatePlayGates()` passed the raw negative `gex_age_ms` as a negative `gexSec` that never exceeded `playGexStaleMaxSec()`. A desk with a lit GEX-stale pill could still open plays when `polled_at` was fresh.

**Fix:** Apply `WS_TIMESTAMP_FUTURE_TOLERANCE_MS` fail-closed guard to `gex_age_ms` in play gates (same pattern as `polled_at` fix 2026-09-03).

**Check at the open:** If GEX snapshot age shows stale on SPX desk during RTH, confirm play rail does not surface new BUY entries for that desk state.

### 0a-1e. Vector Largo freshness: future `asOf` clamped to "live" — #3979 MERGED

**What was broken:** `describeVectorFreshness()` clamped negative age to 0 and classified `freshnessFromAgeMs(0)` as **live**. A Vector snapshot stamped >5s ahead of the reader (cron writer vs API reader clock skew) read as falsely fresh — Largo/Cortex consumers could present stale tape as live.

**Fix:** Apply `WS_TIMESTAMP_FUTURE_TOLERANCE_MS` guard (same as `FreshnessChip`, `ageSecFromIso`) → `freshness: unknown`, `age_seconds: null`, disclosure note. Within tolerance, keep clamp-to-zero.

**Check at the open:** Ask Largo a Vector question during RTH; if the underlying Redis snapshot is genuinely stale (>10m), the tool response should carry `freshness: recent/stale` with a note — never `live` on an unparseable or clock-skewed `observed_at`.

### 0a-1f. SPX desk spot 0 off-hours — fix/spx-desk-offhours-last-spot (pending)

**What was broken:** `buildSpxDeskPulse()` off-hours branch returned `price:0` and overwrote `lastPulseForSignals`, erasing the last RTH print. `buildSpxDesk()` returned empty when Polygon had no live index tick. `validate:platform-integrity` FAILed `spx-desk-spot — SPX 0` while Thermal matrix showed spot≈7718.

**Fix:** Closed-market pulse reuses `lastPulseForSignals` with updated market labels (never clobbers). Full desk build falls back to `lastPulseForSignals` then prior session close from daily bars.

**Check at the open:** Weekend/off-hours load `/terminal` — header SPX spot must match Thermal matrix within 1%, never 0 when chain data exists.

### 0a-1d. BIE SPX desk brief mislabeled GEX king as generic "pin" — fix/bie-spx-brief-magnet-labels (pending)

**What was broken:** `composeSpxDeskBrief` WHY / LEVELS / NEXT 5M lines used hardcoded `"pin"` even when the magnet was `desk.gex_king` (GEX king node) — same pin-vs-king confusion the SPX pin panel already disambiguated via `spx-metric-labels.ts`.

**Fix:** `resolveDeskMagnet()` tracks source; prose uses `SPX_PIN_GEX_KING_LABEL_PROSE` or lower-case `SPX_DESK_MAX_PAIN_LABEL`. Regression tests in `spx-desk-brief.test.ts`.

**Check at the open:** SPX Slayer live commentary / Largo SPX brief during RTH — WHY and LEVELS should say "GEX king node" when king is the magnet, never bare "pin".

### 0a-1c. Thermal triple-desk header change_pct not rebased on live push — fix/thermal-triple-desk-header-rebase (pending)

**What was broken:** `ThermalTripleDesk` column headers used `pushChangePct ?? matrixChangePct` with no `rebaseChangePct` when a live push spot overlayed a matrix snapshot. Spot could update while day-change % stayed frozen at the matrix-era value — same class as the GexHeatmap header fix (2026-09-04).

**Fix:** When push spot and matrix spot both exist, `rebaseChangePct(pushSpot, { price: matrixSpot, change_pct: matrixChangePct })` before falling back to push/matrix change.

**Check at the open:** On `/heatmap` triple-desk view during RTH, each column's spot vs day-change % should stay coherent when the live quote stream moves away from the matrix snapshot spot.

### 0a-1b. Swing discovery WATCH spot refresh trusted stale last trades — fix/swing-discovery-underlying-spot-freshness (pending, #3893 sibling)

**What was broken:** `swing-discovery` refreshed WATCH-name underlying spots via `fetchStockLastTrade` trusting any finite positive `.p` with no SIP timestamp check. A degraded-but-200-OK feed could overwrite plan-entry fallback with a stale price, skewing FORMING/TRIGGERED/EXTENDED setup-maturity flags on the member board.

**Fix:** Route through shared `spotFromLastTradeResult()` — stale trades return `null` and the existing fail-soft path keeps the plan-entry fallback.

**Check at the open:** On `/swings`, WATCH setup-maturity chips should track live tape during RTH; on single-name feed degradation, names should keep plan-entry spots rather than showing hours-old "live" refreshes.

### 0a-1. Swing structural-stop fed by a stale-but-200-OK underlying spot — fix/swing-underlying-spot-staleness-guard (merged #3893, deep-dive Q38)

**What was broken:** `loadUnderlyingSpot` (`swing-active-refresh/route.ts`) trusted any finite positive `.p` from Polygon's `/v2/last/trade` with no check on the trade's own timestamp. That spot feeds `structuralStopBroken` (`manage.ts`), the highest-precedence GATE rung that fires an unconditional real-money `EXIT`. A hard outage already fails closed (throws/invalid shape → skip); a feed that stays UP but goes STALE (still 200 OK, still a finite positive price) did not — it looked perfectly healthy while silently feeding an old price into the one rung designed to override every other consideration.

**Fix (merged #3893):** New pure `spotFromLastTradeResult` (`src/lib/swing/underlying-spot-freshness.ts`) also validates the trade's SIP timestamp (`t`, nanoseconds) via the shared `isWsUpdatedAtFresh` helper — a trade older than 15 minutes (one full active-refresh cron interval) now reads as `null`, routing through the same existing fail-soft skip path as a hard outage.

**Check at the open:** Watch `swing-active-refresh` CloudWatch logs during RTH for this guard actually firing (should be rare — only on genuine feed degradation, not on ordinary thin trading). Cross-check any real position that DOES get a `structural_stop` EXIT against its ticker's actual live tape on a public chart at the same timestamp, to confirm the exit was driven by a genuinely fresh read.

### 0a0. SPX playbook breakout HOD/LOD used extended-hours bars — fix/spx-playbook-breakout-rth-filter (pending)

**What was broken:** `sessionBreakoutExtremesFromBars` computed session HOD/LOD from all Polygon minute bars including premarket/after-hours. Premarket spikes could inflate HOD and suppress `hod_break` during RTH (desk session stats already RTH-gated via `filterRthBars`).

**Fix:** Export `filterRthBars` from `spx-session.ts` and apply inside `sessionBreakoutExtremesFromBars` before excluding the forming last bar.

**Check at the open:** SPX playbook `hod_break`/`lod_break` flags should only react to cash-session (09:30–16:00 ET) extremes — compare against desk ladder, not premarket wicks.

### 0ax. SPX desk in-process caches future-at guard — fix/spx-desk-inprocess-cache-future-guard (merged #3862)

**What was broken:** SPX desk dark pool REST cache, prior-day OHLC, and pulse structure caches used raw `now - fetchedAt < ttlMs`, so clock-skewed future `fetchedAt` stamps read as infinitely fresh (same class as #3844 / #3849).

**Fix:** Route all three in-process cache-hit gates through `isWsUpdatedAtFresh(fetchedAt, ttlMs, now)` (5s future tolerance).

**Check at the open:** SPX desk pulse lane (prior-day levels, structure refresh cadence) and dark pool panel should refresh on TTL during RTH — no stuck stale marks after deploy clock skew.

### 0ay. Polygon market-status cache future-at guard — fix/polygon-market-status-cache-future-guard (merged #3855)

**What was broken:** `fetchMarketStatusNow()` gated its 60s in-process cache with raw `Date.now() - fetchedAt < MARKET_STATUS_CACHE_MS`. A clock-skewed future `fetchedAt` yields negative age, which still satisfies `< 60_000`, pinning market-status as infinitely fresh until real time catches up — same class as `fetchVixIvRankPercentile` (fixed #3846) and UW/LULD halt gates.

**Fix:** Route cache hit through `isWsUpdatedAtFresh(marketStatusCache.fetchedAt, MARKET_STATUS_CACHE_MS, now)`.

**Check at the open:** SPX desk market-phase chip (open/closed/extended) should still flip correctly at session boundaries; no stuck "closed" or "open" state after deploy if a process clock was ahead.

### 0az. VWAP proxy / macro predictions / live-marks active set / stock candle fallback — fix/spx-vwap-signal-log-live-marks-future-guard (pending)

**What was broken:** Four tail caches still used raw `now - fetchedAt < ttl`: SPY volume map for SPX VWAP proxy, UW macro predictions in signal log, 0DTE live-marks active-play set (10s), stock-candle Redis fallback refresh. Future stamps pin each indefinitely.

**Fix:** Route all four through `isWsUpdatedAtFresh`.

**Check at the open:** SPX VWAP weighting refreshes on TTL; Night Hawk open-play marks pick up new commits within ~10s; stock spot candles still cross-replica fallback on demand.

### 0aw. Lit/dark ratio + Vector universe age chips future-at guard — fix/future-timestamp-lit-dark-vector-universe (PR #3853)

**What was broken:** `computeLitDarkRatio()` and Vector universe staleness chips (`VectorScanner`, `VectorTickerComparisonStrip`) used raw `now - updatedAt` without the shared future-timestamp guard. Clock-skewed future store timestamps read as fresh (SPX desk lit/dark ratio served from untrusted data); far-future universe `updatedAt` never flipped the stale warning chip while `formatVectorAge` clamped display to `"0s"`.

**Fix:** Route lit/dark freshness through `isWsUpdatedAtFresh`; add `isVectorUniverseSnapshotStale()` for Vector consumers.

**Check at the open:** Vector scanner age chip should turn amber after ~10m without a cron rebuild; SPX desk lit/dark ratio should absent (not serve) when UW stores carry only future `updatedAt` (synthetic/off-hours only).

### 0at. Off-hours `?force=1` desk-warm storm still unexplained — now logs caller IP/UA — fix/cache-warmer-caller-identity (merged #3847)

**What was broken:** Live measurement (this sweep) found `AWS/ApplicationELB` `TargetResponseTime` holding a healthy p50/p90 but p99 3.1-8.2s / Max 10.4-34.0s across 3+ straight off-hours hours (Sat 01:12-04:05 UTC) — tail latency, not fleet load. Root cause: `[cron/desk-warm]` fired 81 times in 3 hours (avg 28s, max 108.5s) via the documented `?force=1` off-hours bypass, entirely outside its deployed EventBridge schedule (weekday 11-21 UTC only). This is the SAME shape a 2026-09-04 investigation found and rate-limited (60s cooldown) after ruling out every known in-app dispatcher (EventBridge, `rth-warm-leader`, `cron-staleness-watchdog`) — the caller holds a valid `CRON_SECRET` but was never identified, because nothing captured about the request itself.

**Fix:** Pure observability — `shouldRunCacheWarmer` now logs `callerInfo` (client IP + user-agent, via a new `callerInfoFromRequest()` helper) alongside the cron key on every off-hours force bypass, across all four warm crons (desk-warm/zerodte-warm/heatmap-warm/meridian-warm). No behavior change to the gate, cooldown, or overlap lock.

**Check at the open:** This doesn't fix the underlying storm — it only makes the NEXT one traceable. Grep CloudWatch for `[cache-warmer-gate] force=1 bypassed` during any future off-hours window and read the `(caller: ip=... ua=...)` field; if it's a known internal IP/UA, route the fix to that caller directly instead of re-running this same "rule out the usual suspects" investigation a third time.

### 0as. SPX graded + lotto ticket caches future-at guard — fix/spx-ticket-lotto-cache-future-guard (merged #3856)

**What was broken:** `pickChainContract()` and `pickLottoChainContract()` in-process ticket caches (45s / 60s TTL) used raw `now - entry.at < ttlMs`, so clock-skewed future `at` stamps read as infinitely fresh — same class as #3844/#3846/#3849.

**Fix:** Route both through `isWsUpdatedAtFresh(at, ttlMs, now)` (5s future tolerance).

**Check at the open:** Open SPX Slayer play rail during RTH — graded tickets and lotto tickets should refresh chain quotes normally after deploy; no stuck stale ticket from a skewed cache stamp.

### 0ar. SPX play technicals + adaptive gates cache future-at guard — fix/spx-play-technicals-telemetry-future-guard (pending)

**What was broken:** `spx-play-technicals.ts` and `spx-play-telemetry.ts` in-process caches used raw `now - entry.at < ttlMs`, so clock-skewed future `at` stamps read as infinitely fresh (ticket/lotto paths fixed in #3856).

**Fix:** Route both through `isWsUpdatedAtFresh(at, ttlMs, now)` (5s future tolerance).

**Check at the open:** SPX Open desk technicals panel and adaptive gate banner should refresh on TTL during RTH — no stuck stale marks after deploy clock skew.

### 0au. VIX IV rank + SPX UW ladder cache future-at guard — fix/cache-future-guard-polygon-uw-ladder (merged #3846)

**What was broken:** `fetchVixIvRankPercentile()` and `getSpxOdteScopedUwLadderMap()` used raw `now - entry.at < ttlMs`, so a clock-skewed future `at` read as infinitely fresh (same class as #3844 GEX overlay gates).

**Fix:** Route both in-process cache-hit gates through `isWsUpdatedAtFresh(at, ttlMs, now)` (5s future tolerance).

**Check at the open:** SPX bootstrap / Thermal matrix overlay should refresh VIX IV rank and 0DTE UW ladder overlay normally during RTH — no stuck stale IV rank after deploy clock skew.

### 0av. Legacy swing promotion fabricated REL_STRENGTH via `?? 0` — fix/swing-legacy-rel-strength-null-honesty (merged #3845)

**What was broken:** `buildLegacySwingArtifacts()` passed `relStrength: { nameReturnPct: reads.returnPct10d ?? 0, spyReturnPct: reads.spyReturnPct10d ?? 0 }` even though `swingReadsForLegacy()` intentionally leaves both 10d returns `null`. `relStrengthSignal()` treats `0` as present, scoring `relativeStrengthScore(0,0)=0` — worst case — on every morning-confirm promoted name instead of omitting REL_STRENGTH from the pillar denominator.

**Fix:** Only pass `relStrength` when both 10d returns are grounded; otherwise omit the cluster so `buildSwingDossier` marks REL_STRENGTH absent.

**Check at the open:** After morning-confirm promotes a Legacy CONFIRMED name to Swings, dossier scoring must not include a fabricated REL_STRENGTH=0 contribution — pillar should be absent/missing.

### 0as. Swing TRIM latch ignored `verdict.enforced`, could silently disable the −60% premium_stop — fix/swing-trim-latch-enforced (merged #3842)

**What was broken:** `latchSwingLiveStatus()` (`manage-sync.ts`) flipped a swing position's ledger `status` to `TRIM` on ANY `TAKE_PARTIAL`/`EXIT_RUNNER` verdict, without checking `verdict.enforced`. Those two actions are exclusively produced by EDGE rungs (`profit_ladder`, `catalyst_shift`, `regime_shift`, `flow_decay`, `rel_strength_loss`, `vol_collapse`) — advisory-only until the PR-16 calibration ladder graduates them — so an un-graduated 2× profit-ladder recommendation that nobody actually executed still latched TRIM. The very next refresh tick derives `scaledAlready` from `row.status === "TRIM"`, and `deriveScaleOutAction` disables the −60% `premium_stop` hard stop entirely once `scaledAlready` is true (only the trailing-stop rule re-arms). Net effect: an un-enforced advisory partial could permanently disable capital-preservation on a position that was, in reality, still 100% open and fully exposed. Found during a Swing V2 architecture-review pass (`docs/audit/SWING-V2-DEEPDIVE-QUESTIONS-2026-09-05.md` #18), independently confirmed by Cursor.

**Fix:** `latchSwingLiveStatus()` now only latches TRIM when `verdict.enforced === true`; an un-enforced TAKE_PARTIAL/EXIT_RUNNER leaves `status` unchanged, so `scaledAlready` stays false and the hard stop stays live next tick.

**Check at the open:** For any swing position that hits a 2× profit-ladder-style mark during RTH while `profit_ladder` has NOT yet graduated (check the calibration ladder state), confirm the ledger row's `status` stays `OPEN`/`HOLD` (not `TRIM`) and that a subsequent adverse move to −60% still triggers a `STOP_OUT` rather than being silently skipped.

### 0ap. Cluster snapshot change_pct without open_source guard — fix/cluster-spot-change-open-source-guard (merged #3837)

**What was broken:** `readClusterIndexSpot()` served `change_pct` from `spx:pulse:snapshot` whenever finite, without checking `open_source`. Web-tier GEX/Thermal cache readers on the Redis cluster fallback could pair a live price with session-open–anchored change% (`ws-bar`), while the SPX desk and `liveWsIndexSpot` already null non-REST anchors.

**Fix:** `clusterIndexSpotChangePct()` — only returns change% when `open_source === "rest"`.

**Check at the open:** Thermal SPX matrix header day-change% vs SPX desk pulse — must agree or both show honest absence; never diverge on anchor basis when reading via cluster snapshot on a cold web replica.

### 0ar. Vector universe null-spot fail-closed — fix/vector-universe-spot-fail-closed (pending)

**What was broken:** When `fetchGexHeatmap` returned `strike_totals` but `spot` was still `null` (cold-cache Polygon contention), `buildVectorUniverseRow` passed `undefined` spot into `computeGexWalls`, running the unconstrained peak scan. That served wrong-side `topCallWall` / `topPutWall` on `/api/market/vector/universe` and persisted the same into narrowed 0DTE/weekly/monthly wall-history rails.

**Fix:** Fail-closed — skip `computeGexWalls` for GAMMA walls when `spot` is unknown; emit empty wall arrays (mirrors `getVectorGexWalls()` returning null).

**Check at the open:** During the first minutes of RTH, poll `/api/market/vector/universe` for tickers that briefly show `spot:null` — they must not carry a non-null `topCallWall` below the spot that resolves seconds later on solo `/api/market/gex-heatmap`.

### 0aq. Largo technicals live change_pct + Night Hawk record roundFloats — fix/largo-technicals-change-pct-nighthawk-record-roundfloats (merged #3836)

**What was broken:** `buildLargoTechnicals` returned live WS spot for stocks but dropped `changePct` (null day % during RTH). Index path (SPX/VIX) used REST-only snapshots instead of the live `indexStore` overlay the quote route uses. `GET /api/market/nighthawk/record` omitted the standard `roundFloats` API boundary.

**Fix:** Stock WS → `changePct = wsCandle.changePct`; index → `resolveLiveIndexWsEntry` + `overlayRestIndexWithWs`; record route wraps payload in `roundFloats`.

**Check at the open:** Largo `get_technicals` for NVDA during RTH must return non-null `change_pct` beside live spot when REST seed landed. SPX technicals spot/`change_pct` must track desk header (not lag REST-only). Night Hawk record JSON must have clean 2dp numerics.

---

### 0ao. Vector volume profile extended-hours pollution — fix/vector-volume-profile-rth-scope (pending)

**What was broken:** Default-on Vector volume profile fed the full multi-session minute buffer (including premarket/after-hours) into `computeVolumeProfile`, so POC and value-area bands on equities could anchor to extended-hours spikes instead of the current RTH session. HOD/LOD, opening range, and VWAP got the RTH gate in the 2026-08-05 audit; volume profile was missed.

**Fix:** Add `sessionRthVolumeProfileBars()` (`lastSessionBars` + `filterRthBarsSec`) and scope `VectorChart.tsx` + `vector-analytics-core.ts` through it.

**Check at the open:** On `/vector` with volume profile enabled for NVDA or TSLA during RTH, POC must sit near the RTH price cluster — not at a premarket spike level visible only in extended hours.

---

## WATCH LIST — 2026-09-04 coordinator sweep (read this before the routine pass)

### 0an. Night Hawk hunt roundFloats — fix/nighthawk-hunt-roundfloats (pending)

**What was broken:** `POST /api/market/nighthawk/hunt` returned raw IEEE floats in `platform_context.spx_price` and play `score` fields while sibling Night Hawk routes (`edition`, `horizons`, `play-bars`, `legacy-marks`) already wrap with `roundFloats`.

**Fix:** Wrap assembled `HuntResponse` in `roundFloats` before `NextResponse.json`.

**Check at the open:** Run a day or swing hunt from Night Hawk — response JSON must show 2dp numerics, no `7499.360000000001`-class tails on scores or SPX context.

### 0am. Dark-pool ticker roundFloats + nighthawk-edition UW sweep — fix/dark-pool-ticker-roundfloats-nighthawk-uw-sweep (pending)

**What was broken:** `GET /api/market/dark-pool/ticker` returned raw IEEE floats at the JSON boundary while sibling `/dark-pool` already calls `roundFloats`. Separately, `GET /api/cron/nighthawk-edition` dispatched `buildEveningEdition` without `runWithBackgroundUwSweep`, so nightly dossier UW fan-out raced live member reads for the same 2-RPS cluster ceiling.

**Fix:** Wrap ticker success payload in `roundFloats({ snapshot, symbol })`; wrap edition build dispatch in `runWithBackgroundUwSweep(() => buildEveningEdition(...))`.

**Check at the open:** Thermal heatmap overlay drilldown on a liquid name (SPY/NVDA) — premiums/sizes must not show IEEE tails. During edition window (~16:00 ET), confirm no spike in live UW queue-wait on member Vector/HELIX reads coinciding with `[cron/nighthawk-edition] background build done` log lines.

### 0al. SPX desk peek served price:0 bootstrap shell — fix/spx-desk-peek-zero-price (merged #3803)

**What was broken:** `GET /api/market/spx/desk` returned any `peekSpxDesk()` cache hit immediately, including bootstrap fast-lane shells with `price: 0` before `buildSpxDesk()` finished — members could flash SPX 0 while Thermal matrix already showed a grounded spot (~7718).

**Fix:** Peek fast-path only when `instant.price > 0`; otherwise fall through to `loadSpxDesk()`.

**Check at the open:** Cold-load `/terminal` after deploy — SPX header spot must match Thermal matrix within 1%, never 0 during a session with live index data.

### 0af. Polygon batch snapshot fabricated flat 0% — fix/polygon-snapshot-change-pct-null (merged #3789)

**What was broken:** `fetchStockSnapshotPerformance` (sector ETFs, leader stocks, breadth universe) and `fetchMarketMovers` used `todaysChangePerc ?? 0`, so a missing provider field read as a flat day on SPX desk `sector_heat` / breadth-derived internals.

**Fix:** `snapshotChangePctFromRow()` returns `null` when change cannot be grounded (provider % or day-close derivation). Breadth internals skip null samples; movers filter null change out.

**Check at the open:** SPX desk sector heat rows should show real +/- % or omit/null — never 0.00% for a ticker with no session change data pre-open. Cross-check XLK/XLF on desk vs `GET /api/market/heatmap` sector panel.

### 0ag. UW spot-fallback fabricated flat 0% — fix/spot-fallback-change-pct-null (merged #3790)

**What was broken:** `resolveSpotFromUwStockState()` returned `change_pct: 0` when UW `/stock-state` omitted `prev_close` — members saw "unchanged" with no prior-close anchor.

**Fix:** `change_pct` is `null` when `prev_close` is absent; `SpotQuote` + pulse snapshot types allow null.

**Check at the open:** `GET /api/market/quote?ticker=<equity>` on UW fallback path — missing prior close must show absent change %, not `0.00%`.

### 0an. Pricing's SEO description still said "six trading modules" after the catalog grew to seven — fix/pricing-seo-stale-six-modules (merged #3797)

**What was broken:** `pricing/page.tsx`'s `publicPageMetadata()` description and `WebPageJsonLd` description both hardcoded "all six trading modules plus Discord" — driving `<meta name="description">`, canonical-adjacent title, OG/Twitter copy, and JSON-LD structured data — even though the visible page and `SoftwareApplicationJsonLd`'s `featureList` already correctly describe all 7 products.

**Fix:** Added `manifestProductCountWord()` to derive the spelled-out count from the live manifest instead of a hardcoded word; both description copies now read from one shared constant. Added "six trading modules" to `BANNED_PUBLIC_MARKETING_PHRASES` and `pricing/page.tsx` to the `PUBLIC_SURFACES` scan.

**Check at the open:** View-source (not just rendered DOM) on `/pricing` for `<title>`, `<meta name="description">`, canonical, OG/Twitter tags, and JSON-LD — confirm no "six"/6-module references remain. Once deployed, request a recrawl in Search Console/Bing Webmaster Tools and verify the refreshed SERP description after re-indexing.

### 0ai. Night Hawk's Learn-chapter SEO metadata still said "Swing Trading Setups" — fix/guide-seo-night-hawk-stale-metadata (merged #3791)

**What was broken:** `GUIDE_SEO["night-hawk"]` (`guide-seo.ts`) — a third, independent copy of the same stale "evening/swing-only" framing already fixed today in `PRODUCT_MANIFEST.hawk` and `LEARN_NAV` — read "Swing Trading Setups Explained" / "runs its evening scanner" as the literal `<title>` and SERP snippet.

**Fix:** Updated to "0DTE Command & Evening Edition" / a description leading with 0DTE Command scanning intraday, Evening Edition as next-session prep. Added a regression test.

**Check at the open:** Google/search-console snippet for `/learn/night-hawk` and the Course JSON-LD chapter list should show the corrected title; confirm no SERP-truncation regression (title 49/60 chars, description 146/160 chars).

### 0ah. Meridian manifest undersold catalyst coverage as earnings-only — fix/meridian-manifest-catalyst-coverage (pending)

**What was broken:** `PRODUCT_MANIFEST.meridian` framed the product as narrowly "Earnings intelligence" (homepage card, pricing matrix, SEO schema, marketing email all derive from this one object) — but Meridian genuinely ships four catalyst classes (earnings, macro, OpEx, FDA), each with its own filter chip and detail panel, confirmed in `meridian-types.ts`/`MeridianDesk.tsx`/`MeridianEventDetailPanel.tsx`. Meridian's own Academy guide already documented this correctly; only the manifest (and a hand-duplicated About-page line) was stale.

**Fix:** Broadened the manifest's `tag`/`positioning`/`lifecycle`/`capabilities`/`faqAnswer` to name all four classes, keeping earnings as the deepest workflow. Synced `about/page.tsx`. Added "Earnings intelligence" to `BANNED_PUBLIC_MARKETING_PHRASES` and a dedicated regression test.

**Check at the open:** Homepage Meridian card should read "Catalyst intelligence" with macro/OpEx/FDA mentioned; `/meridian` desk filter chips (Macro/Earnings/FDA/OpEx) should all resolve real data during a session with active catalysts of each type.

### 0ak. Learn hub Night Hawk descriptor still said "Evening playbook" after the 0DTE Command redesign — fix/learn-nav-night-hawk-stale-descriptor (merged #3784)

**What was broken:** `LEARN_NAV`'s `night-hawk` entry (`src/lib/learn/nav.ts`) described the
chapter as "Evening playbook — tomorrow's setups, scored tonight." — contradicting the homepage's
"0DTE Command runs during RTH... not a swing-only product" positioning (`PRODUCT_MANIFEST.hawk`).
An earlier fix already closed this exact gap in the marketing manifest, but `LEARN_NAV` is a
separate hand-authored array the earlier fix never reached.

**Fix:** Updated the descriptor to "Always-on 0DTE scanner during RTH, plus next-session Evening
Edition prep." Added a regression test tying `LEARN_NAV`'s night-hawk descriptor to the same
"not evening/swing-only" guard the manifest test already has.

**Check at the open:** `/learn` chapter nav and the Course JSON-LD schema (view-source or a
structured-data testing tool) should show the corrected Night Hawk descriptor; confirm it still
reads naturally alongside the dedicated Night Hawk guide's own overview content.

### 0aj. Academy's structured curriculum had no Vector or Meridian chapter — feat/academy-vector-meridian-chapters (pending)

**What was broken:** `LEARN_NAV` (Academy's structured chapter list) had 7 entries — Getting Started, SPX Slayer, HELIX, Largo, Night Hawk, Thermal, Glossary — with no chapter for Vector or Meridian, even though `PRODUCT_MANIFEST` already lists all 7 as live products. Their guides existed only in the unstructured Guides catalog, never as numbered curriculum chapters.

**Fix:** Added real, code-grounded Vector and Meridian chapters (8 and 9), wired through the existing `defineToolGuide` pattern with matching SEO metadata. Added an invariant test asserting every live manifest product has exactly one first-class Academy chapter.

**Check at the open:** `/learn` hub should show "9 chapters" and Vector/Meridian in the sidebar chapter list (not just the flat Guides catalog below it); `/learn/vector` and `/learn/meridian` should render with real content and correct prev/next chapter navigation.

### 0ag. Vector Academy guide falsely framed Thermal as SPX-only — fix/vector-guide-thermal-multiticker-claim (merged #3786)

**What was broken:** the Vector guide (`articles.ts`, `vector-scanner-guide`) said "[Thermal] focus[es] on SPX" and "[Thermal] gives you the deep heatmap for SPX" — contradicting the homepage's own accurate "Multi-ticker GEX/VEX/DEX/CHARM matrix" framing and Thermal's real route/UI (11 preset tickers spanning indices and single names, plus live ticker search — no SPX-only gate).

**Fix:** Corrected both passages to reflect Thermal's real multi-ticker capability while keeping Vector's accurate differentiator (automated universe-wide scanning, no manual ticker selection) intact. Added `thermal-ticker-scope-consistency.test.ts` grounding the fix in `HEATMAP_PRESET_TICKERS` and guarding against the SPX-only framing recurring.

**Check at the open:** `/learn/vector-scanner-guide` should read Thermal as multi-ticker; spot-check `/heatmap` with a non-SPX preset (e.g. NVDA, QQQ) still renders a full GEX/VEX/DEX/CHARM matrix, confirming the guide now matches live behavior.

### 0ae. `zerodte-warm` cron raced live member requests for the UW rate-limiter ceiling on a false premise — fix/zerodte-warm-uw-sweep-tag (merged #3775)

**What was broken:** the `zerodte-warm` cron's dispatch (`warmZeroDteBoard()` +
`refreshZeroDteBoardSnapshot()`, firing ~every 1-5 min during market hours) was explicitly NOT
wrapped in `runWithBackgroundUwSweep` — the helper that reserves one UW rate-limiter concurrency
slot for live member traffic, already used by four sibling Vector-family crons — on the claim that
its work was "platform-local, not a UW REST fan-out." That premise was false: both functions call
`scanZeroDteBoard()` internally, whose top-rank enrichment loop calls `fetchTickerDossier`
(`runUwPooled` from `uw-rate-limiter.ts`) in bounded parallel batches. So every cron tick was
competing for the FULL UW ceiling instead of leaving one slot for live traffic. Live evidence
(0aa's own instrumentation, same day): a 30s window of near-continuous UNTAGGED 10-19s UW
admissions correlating with `[zerodte-scan]` log lines on the same ECS task.

**Fix:** wrap the cron's own dispatch in `runWithBackgroundUwSweep`, matching the exact pattern the
four existing Vector-family crons use. The live read path (`/api/market/zerodte/board`,
`/api/market/nighthawk/horizons` — same `scanZeroDteBoard`/`buildZeroDteBoardPayload` functions,
called from genuinely live requests) stays untagged, same as before.

**Check at the open:** filter CloudWatch Logs on `[uw] queue wait` during RTH (0aa's
instrumentation) — the untagged (non-background-sweep) share of queue waits during zerodte-warm's
firing windows should measurably drop now that its dispatch reserves a slot instead of competing
for the full ceiling. Also confirm `zerodte-warm`'s own `elapsed=` in `[cron/zerodte-warm]
background done` log lines didn't regress (the fix changes which ceiling it competes against, not
its own admission logic) and that `/nighthawk` board reads stay responsive during a `zerodte-warm`
tick.

### 0af. Open Banger positions vanish under 5 DTE — fix/banger-sub5dte-visibility (merged #3778)

**What was broken:** `horizonPlayFromBangerPosition()` gated an OPEN/PARTIAL banger ledger row's
Swing Command visibility with the discovery-side admission floor (`HORIZONS.SWING.dteMin=5`) instead
of a not-yet-expired check — a live position with real capital simply disappeared from every view
(nothing else reads `banger_positions`) for its final days before expiry or close.

**Fix:** Floor at `dte >= 0` instead of `dteMin`; a row that would fall inside the 0DTE window
(`dte < 5`) is tagged "closing soon" in its `reason` string. Pre-entry discovery admission
(`horizonPlayFromBangerWatch`) is unchanged.

**Check at the open:** Find a live OPEN banger position (Swing Command → MANAGING) whose contract is
inside its final week before expiry — confirm it is still rendered (with a "closing soon" cue)
rather than missing from the desk.

### 0ad. UW in-process REST cache + Polygon index overlay future guards — fix/uw-index-future-timestamp-guards (merged #3771)

**What was broken:** Three paths still used raw `Date.now() - timestamp` without the shared future guard: `readUwCache` (negative age → infinitely fresh UW REST cache), `getIndexFeedFreshness` + `index-snapshot-overlay` (future `updatedAt` clamped to age 0 → live overlay), `resolvePulseFeedStalled` (Redis pulse snapshot), and `HomeGammaPromo.fmtAgeFromAsof` (future `asof` → "live").

**Fix:** Apply `WS_TIMESTAMP_FUTURE_TOLERANCE_MS` / `isWsUpdatedAtFresh` / `ageSecFromIso` — same pattern as #3760/#3762.

**Check at the open:** SPX desk feed-stalled pill still fires on genuine index silence (not on normal ticks); VIX/SPX index overlays fall back to REST when WS stamp is skewed; homepage gamma promo chip does not show "live" beside a warming snapshot.

### 0ad. Stock SSE change_pct ws-bar authority gate — merged #3769

**What was broken:** `/api/market/stocks/spot-stream` and Thermal's stock push path served `changePct` computed from the first WS bar's open (`openSource === "ws-bar"`) before the REST `prev_close` seed landed — session-open drift, not true day change vs prior close. `/api/market/quote` could show a different % when its REST cache was hot.

**Fix:** `authoritativeStockChangePct()` — member-facing `changePct` is `null` until `openSource === "rest"`. Redis snapshots carry `openSource`; stale/empty paths return `null` not fabricated `0`.

**Check at the open:** On Thermal `/heatmap` with NVDA (or any stock preset): header change % should appear within ~30s of first load and must match `GET /api/market/quote?ticker=NVDA` `change_pct` once both are live. Mid-session reconnect must NOT flash a ws-bar–anchored %.

### 0af. Night Hawk play-bars + legacy-marks roundFloats — fix/nighthawk-api-roundfloats (pending)

**What was broken:** `GET /api/market/nighthawk/play-bars` and `GET /api/market/nighthawk/legacy-marks` returned raw Polygon/provider IEEE floats at the JSON boundary without `roundFloats`.

**Fix:** Wrap both success payloads in `roundFloats(...)` at the route edge.

**Check at the open:** Open a Legacy play detail rail — mark/bid/ask show at most 2dp (no `24.750000000001` noise); play mark history chart tooltip prices are clean.

### 0ac. Vector GEX walls spot constraint — fix/vector-gex-walls-spot-constraint (pending)

**What was broken:** on a cold Vector task before heatmap primed `fallbackSpot`, `getVectorGexWalls()` called `computeGexWalls()` without a spot — unconstrained mode lets call walls sit below spot and put walls above it (inverted resistance/support).

**Fix:** `resolveVectorWallSpot()` prefers heatmap spot, falls back to live candle close; returns `null` (honest empty) when neither is available instead of unconstrained walls.

**Check at the open:** load `/terminal` or `/vector` for a non-oracle ticker immediately after a deploy/cold task — walls should be briefly absent rather than showing inverted call/put levels; once spot resolves, call walls must sit above spot and put walls below.

### 0aa. UW rate limiter queue-wait observability — fix/uw-rate-limiter-queue-wait-observability (merged #3759)

**What was broken:** a UW request that queued behind the rate limiter for 15+ seconds and then
successfully acquired a slot left zero trace anywhere — `RateLimiterQueueTimeoutError` only fires
once the budget is fully exhausted, so the whole admitted-but-slow middle of the distribution was
invisible to CloudWatch Logs. Blocked the follow-up two earlier entries today (vector-pick-sweep
tail latency, `contract-picks` live timeout) both named as the correct next step.

**Fix:** `throttleUw` now logs `[uw] queue wait <ms>ms` (tagged `(background sweep)` when
applicable) whenever an admission takes ≥500ms. Pure instrumentation — no change to admission
timing, concurrency, or rate limiting itself.

**Check at the open:** filter CloudWatch Logs on `[uw] queue wait` during RTH — the `(background
sweep)` tag separates expected cron-sweep queueing from live member-request queueing, which is
what the two prior entries' follow-up measurement needs. No product-facing behavior to check; this
is instrumentation only.

### 0ad. Dark-pool roundFloats + Vector live-quote future guard — fix/dark-pool-roundfloats-vector-live-future-guard (pending)

**What was broken:** `/api/market/dark-pool` returned `premium` without `roundFloats` at the JSON boundary; `isLiveQuotesStale()` had no future-timestamp guard (clock-skewed success time read as live).

**Fix:** Wrap dark-pool response with `roundFloats`; gate live-quote staleness with `WS_TIMESTAMP_FUTURE_TOLERANCE_MS`.

**Check at the open:** Poll `/api/market/dark-pool?limit=5` — premiums are clean decimals; Vector contract-pick live badge flips stale when quotes stop updating.

### 0ac. UW stall + L1 cache + SPX GEX stale future guards — fix/uw-future-timestamp-guards (pending)

**What was broken:** Two paths missed the #3745/#3760 future-timestamp sweep: `isUwSocketStalled()` (OPEN socket with future `freshestMessageAt` never reconnects), `gexStaleFromAge()` (future GEX `asof` clamped to age 0 → `gex_stale: false`). (`readUwCache` on separate branch `fix/uw-cache-index-overlay-future-timestamp`.)

**Fix:** Gate stall via `!isWsUpdatedAtFresh`; treat future GEX age as stale.

**Check at the open:** Admin System Vitals UW socket tile still reconnects on genuine silence; SPX desk GEX stale pill fires on real 30s+ lag (not on normal 10–20s ages).

### 0ad. UW L1 cache + stocks/polygon stall future guards — fix/ws-stall-uw-cache-future-timestamp (pending)

**What was broken:** Three paths missed the #3745/#3760 future-timestamp sweep: `readUwCache()` (in-process UW REST L1 — future `fetchedAt` reads as fresh forever), `startStocksWatchdog()` (stocks `A.*` stall — future `lastMessageAt` never triggers reconnect), polygon indices watchdog (same on `lastIndicesMessageAt`).

**Fix:** Route all three through `isWsUpdatedAtFresh` from `timestamp-freshness.ts`.

**Check at the open:** Admin System Vitals stocks + indices socket tiles still reconnect on genuine silence; UW-backed desk supplements (dark pool, flow) still serve from cache during normal RTH without false cache hits from skewed clocks.

### 0ab. LULD halt future-timestamp guard — fix/luld-halt-future-timestamp-guard (pending)

**What was broken:** `isLuldHaltSourceStaleForState()` and `isLuldHaltFeedStale()` used raw `Date.now() - timestamp` age math without a future guard — clock-skewed future cluster/local `last_message_at` stamps read as live/trusted (same class as the UW halt bug fixed in #3745).

**Fix:** Gate all LULD freshness probes through shared `isWsUpdatedAtFresh`.

**Check at the open:** Admin System Vitals → Massive LULD tile shows live during RTH when feed is healthy; 0DTE halt gate still blocks when BOTH UW and LULD are genuinely down (not on a single future-skewed stamp).

### 0za. 0DTE live marks SSE quiet gate future-at guard — fix/zerodte-live-marks-sse-future-guard (pending)

**What was broken:** `useZeroDteLiveMarks` poll fallback used `Date.now() - lastSseAtRef < SSE_QUIET_MS`. A clock-skewed future SSE timestamp suppresses REST fallback while marks may be stale.

**Fix:** Route quiet gate through `isWsUpdatedAtFresh(lastSseAtRef.current, SSE_QUIET_MS)`.

**Check at the open:** Night Hawk 0DTE board with open plays — live marks continue updating via poll when SSE proxy breaks; no frozen premiums after a skewed SSE heartbeat.

### 0z. SPX pulse stream local freshness future guard — fix/spx-pulse-stream-future-guard (pending)

**What was broken:** `refreshSnapshot()` in `/api/market/spx/pulse/stream` preferred local `indexStore` when `Date.now() - fresh < 10_000` with no future-timestamp guard — clock-skewed future `updatedAt` reads as infinitely fresh and skips cross-replica Redis fallback.

**Fix:** Route local freshness through `isWsUpdatedAtFresh(fresh, 10_000)`.

**Check at the open:** SPX pulse rail shows live spot during RTH; no stale local indexStore stuck when Redis has fresher cross-replica snapshot.

### 0y. HELIX score probe lacked real-ledger mode — fix/helix-score-signal-ledger-mode (pending)

**What was broken:** `helix-score-signal.mjs` could only grade flow prints via Polygon minute-bar replay; the signal-outcome ledger writer is live since 2026-09-03 but the probe had no path to use official continued/reversed outcomes.

**Fix:** `--source=ledger` mode — reads `GET /api/market/helix/signal-outcomes`, maps job outcomes, matches conviction score from flow tape (±30m).

**Check at the open:** `node --import tsx scripts/audit/helix-score-signal.mjs --source=ledger` returns graded rows when ledger has directional outcomes; re-run weekly as ledger accumulates past the 50-row API cap.

### 0z. vector-walls-warm missing force=1 cooldown — fix/vector-walls-warm-cooldown (pending)

**What was broken:** `vector-walls-warm` had `OVERLAP_LOCK` but no `RERUN_COOLDOWN`. `?force=1` bypasses the cash-RTH gate; on a hot walls cache the background warm can finish in seconds, so replay loops could fan out Polygon chain fetches faster than any legitimate trigger (rth-warm-leader 20s heal threshold).

**Fix:** Added `RERUN_COOLDOWN_KEY = "vector-walls-warm:cooldown"` with 10s TTL (below the 20s leader heal threshold, mirroring heatmap-warm).

**Check at the open:** `/admin` → Operations → cron health shows `vector-walls-warm` completing normally during RTH; no burst of concurrent wall-warm completions in CloudWatch within seconds of each other after a mid-session deploy.

Every item below was fixed off-hours today (weekday, pre-open) and has **not been seen under a
moving tape or real member traffic**. Per the newly-recorded `FULL-LIFECYCLE SCOPE EXPANSION`
standing instruction in `CLAUDE.md` (2026-09-04), this list is now maintained every sweep — not
just for performance findings — and is separate from, and in addition to, each fix's own
`docs/audit/findings-staging/` entry (the audit record; this is the next-session checklist).

### 0aa. Desk enrichment UW fan-out missing background sweep — fix/desk-enrichment-uw-sweep (pending)

**What was broken:** `fetchDeskEnrichmentFields()` in `spx-desk.ts` fans out to 5 UW REST endpoints via `runUwPooled` but was not tagged with `runWithBackgroundUwSweep`. Desk-touching crons (`spx-evaluate`, `spx-signal-observe`, `market-regime-detector`, `data-correctness`) that call `loadMergedSpxDesk()` could trigger enrichment refresh on a stale sticky without reserving a background UW slot.

**Fix:** Wrap `fetchDeskEnrichmentFields` body in `runWithBackgroundUwSweep` at the single fan-out site.

**Check at the open:** Admin Operations → UW rate limiter during RTH — no member-facing 429s when `spx-evaluate` fires on a cold enrichment sticky; SPX desk enrichment panels (greek exposure, flow by expiry, macro) still populate normally.

### 0ab. SPX desk GEX age Math.max(0) false-fresh on future asof — fix/spx-desk-gex-age-future-skew (pending)

**What was broken:** `gexDataAgeMs()` and the canonical desk GEX path clamped `Date.now() - asofMs` with `Math.max(0, …)` before `gexStaleFromAge()`. A clock-skewed future `pos.asof` became `gex_age_ms: 0` → `gex_stale: false` even though `gexStaleFromAge(-60000)` already fail-closes.

**Fix:** Remove the `Math.max(0, …)` clamp at both sites so negative age reaches `gexStaleFromAge`.

**Check at the open:** SPX desk GEX stale pill fires when matrix `pos.asof` lags or skews; `/api/market/spx/bootstrap` `gex_age_ms` / `gex_stale` coherent under RTH.

### 0z. Vector API unrounded floats + UW halt future-timestamp guard — fix/vector-roundfloats-uw-halt-freshness (pending)

**What was broken:** Five Vector cache-reader routes (`universe`, `wall-history`, `daily-regime`, `rail-bootstrap`, `contract-picks`) returned raw IEEE float noise at the JSON boundary while sibling Vector routes already call `roundFloats`. Separately, `isUwHaltSourceStale()` used raw `Date.now() - freshest > maxAgeMs` — a clock-skewed future `effectiveFreshestUwMessageAt()` reads as live/trusted.

**Fix:** Wrap all five route responses with `roundFloats(...)`; replace halt proxy check with `!isWsUpdatedAtFresh(freshest, maxAgeMs)`.

**Check at the open:** Poll `/api/market/vector/universe` and `/api/market/vector/daily-regime?ticker=SPX` — strike/flip/spot fields should be 2dp with no long float tails. Confirm 0DTE halt gate still blocks entries when UW socket is genuinely down (admin System Vitals).

### 0y. darkpool-discord missing runWithBackgroundUwSweep — fix/darkpool-discord-uw-sweep (pending)

**What was broken:** `darkpool-discord` cron called `fetchUwDarkPoolRecent` (live scan, 15m digest, EOD recap) without the shared `runWithBackgroundUwSweep` tag, competing with member UW REST traffic on cache miss.

**Fix:** Wrapped tick body in `runWithBackgroundUwSweep(() => runDarkpoolDiscordTick(...))`.

**Check at the open:** Admin Operations → UW rate limiter / cron health shows `darkpool-discord` completing without member-facing UW 429s during RTH; Discord #blackout-darkpool live alerts still post during active tape.

### 0x. Flow WS cluster heartbeat future timestamp falsely fresh — fix/flow-liveness-future-guard (pending)

**What was broken:** `isFlowFrameFreshFromCluster`, `isFlowFrameFreshAnywhere`, and
`peekFlowLivenessHeartbeat` used raw `Date.now() - record.at <= maxAgeMs`. A far-future heartbeat
timestamp yields negative age that passes the gate → flow-ingest skips REST and admin health can
report cluster WS "fresh" when no live frames are arriving.

**Fix:** route all three through `flowHeartbeatAgeMs()` → shared `signalWindowAgeMs()` (same guard as
`probePgFlowAlertsFresh`).

**Check at the open:** `/admin` Operations → flow liveness tile tracks real WS delivery during RTH;
after a genuine UW flow stall the tile must not stay green off a corrupted future-dated heartbeat.

### 0w. Quote route index WS `change_pct` not rebased on ws-bar anchor — fix/quote-index-change-pct-rebase (pending)

**What was broken:** `/api/market/quote` Thermal header tape (SPX/VIX polled ~1.5s) served raw
`indexStore` `change_pct` on the WS fast path. When `open_source === "ws-bar"` (mid-session cold
start), that percentage is anchored to the first bar at boot — not prior close — while stock path
and `indices/route` already rebase via `withFreshPrice` / `overlayRestIndexWithWs`.

**Fix:** `buildIndexWsQuote()` overlays live WS price on shared REST quote cache via
`overlayRestIndexWithWs`; emits `null` change when no REST baseline and anchor isn't authoritative.

**Check at the open:** On `/heatmap` with SPX selected, compare header day-change% against
`/api/market/indices` SPX `change_pct` after a mid-session deploy or socket reconnect — they should
agree within rounding. Specifically watch VIX: ws-bar anchor previously showed +0.07% while REST
reported -0.35% (measured 2026-09-04).

### 0x. Admin cron health `evaluateJob` age_min unguarded against clock-skewed future `started_at` — fix/admin-cron-age-skew-guard (pending)

**What was broken:** `evaluateJob` computed cron run age as raw `(now - started_at) / 60_000`. Cross-replica clock skew could stamp `started_at` in the future → negative `age_min` on `/admin` System Vitals cron board, or falsely mark the job healthy (negative age never exceeds stale threshold).

**Fix:** Route through `ageMinFromIso`; when age cannot be trusted (clock-skewed future), treat as `staleThreshold + 1` so the job surfaces stale instead of infinitely fresh.

**Check at the open:** `/admin` → Operations → cron health — no negative `age_min` values; jobs with skewed timestamps show stale, not OK.

### 0y. UW / options WS freshness gates treated future timestamps as live — fix/uw-channel-future-timestamp-freshness (pending)

**What was broken:** `isUwChannelFresh`, `getLiveOptionMarkSync`, and admin `cluster_live` used raw `Date.now() - at <= maxAgeMs`. A clock-skewed future stamp yields negative age, which still passes the threshold — falsely reporting a channel as live. (Flow cluster heartbeat was fixed separately in #3718 via `flowHeartbeatAgeMs`.)

**Fix:** Route UW/options freshness through `isWsUpdatedAtFresh` / `wsUpdatedAtAgeMs`. Admin `cluster_live` and `last_message_age_ms` reporting clamped the same way.

**Check at the open:** `/admin` → Operations → UW socket health — `last_message_age_ms` never negative; during RTH with live flow, `cluster_live` true only when frames actually arrived within 120s (not on skew alone).

### 0v. ISO age helpers treated clock-skewed future timestamps as fresh — fix/iso-age-future-guard-combined (pending)

**What was broken:** `public-gex-snapshot` coerced negative `asof` age to **0 seconds** (reads as just refreshed on the marketing gamma snapshot). Night Hawk Legacy `legacyMarkAgeLabel` and admin Night Hawk playbook `ageMin` used raw `Date.now() - new Date(iso)` without the shared future guard — future-skewed `updated_at` bypassed stuck detection.

**Fix:** `ageSecFromIso` / `ageMinFromIso` in `timestamp-freshness.ts`; `nighthawkJobAgeMin()` for admin cron health (clock-skew → `stuckThresholdMin + 1`).

**Check at the open:** `/tools/gamma-snapshot` age honest during RTH; Legacy Night Hawk mark age does not read "0s ago" on skewed `markAsOf`; `/admin` cron health escalates skewed Night Hawk builds to stale.

### 0u. `/vs/others` comparison table missed the same "every setup graded" overclaim fix — fix/vs-others-track-record-scope (pending)

**What was broken:** #3643 (item 0n below) scoped "every setup logged"-style claims on the About
page, homepage, and `WhyBlackoutContent.tsx` to the three products `/methodology` actually covers.
`src/app/(marketing)/vs/others/page.tsx`'s comparison table carried the identical overclaim in
different wording — "Every setup graded A–F with a logged track record" — and wasn't part of that
fix's surface search, so it survived unscoped.

**Fix:** reworded the row to "SPX Slayer, Night Hawk, and 0DTE Command plays graded A–F with a
logged track record", matching #3643's wording pattern. Extended
`public-record-scope-claims.test.ts`'s `SURFACES` list to include this page so the same claim
class can't regress here again.

**Check at the open:** none — pure marketing-copy correction, no RTH-dependent behavior. Confirm
`https://blackouttrades.com/vs/others` names the three products next to the "Alert accountability"
row rather than an unscoped "every setup".

### 0t. Two more "every setup logged" overclaim instances (About page + homepage) missed by both #3643 and #3664 — fix/vs-others-remaining-overclaim-instances (merged #3683)

**What was broken:** `RedesignHome.tsx`'s own "them vs us" list bullet (a second, separate copy of
the sentence `/vs/others/page.tsx` mirrors) and `about/page.tsx`'s `WHAT_WE_DO` intro paragraph both
still said an unscoped "every setup ... logged"/"grade every setup" — surviving both #3643 (earlier
today) and the same-day follow-up #3664, because `public-record-scope-claims.test.ts`'s check was
whole-file ("do the three product names appear anywhere in this file"), not per-claim, so it passed
even though these two specific claims weren't actually scoped.

**Fix:** named the three products inline (same pattern as #3643/#3664). Rewrote the regression test
to check per-claim proximity (200-char window) instead of whole-file existence, so a third instance
like this can't recur undetected. Shipped as its OWN PR rather than a further push onto #3664's
branch — that branch has been silently rebased-and-reset by another lane twice today, each time
dropping this exact fix; a standalone PR survives independently of whatever keeps resetting it.

**Check at the open:** none — pure marketing-copy correction. Confirm `https://blackouttrades.com/`
(homepage "them vs us" section) and `https://blackouttrades.com/about` both name the three products
next to their own copies of this claim.

### 0s. `cron-registry.test.ts` coverage check broke on `main` — PR #3668 shipped an unregistered `logCronRun` key — fix/cron-registry-self-heal-key (merged #3678)

**What was broken:** PR #3668 added a second, conditional `logCronRun("cron-staleness-watchdog-self-heal", ...)`
call to the already-registered `cron-staleness-watchdog` route, but never added the new key to
`cron-registry.test.ts`'s coverage check (`CRON_JOBS` or `INTENTIONALLY_UNREGISTERED`). That test runs
in `npm test`/CI `verify`, so `main` itself started failing `verify` on every commit after #3668
merged — including on two unrelated open PRs (#3664, #3667) that merged `main` in and inherited the
red check despite neither touching cron code.

**Fix:** added `cron-staleness-watchdog-self-heal` to `INTENTIONALLY_UNREGISTERED` with a reason —
it's a conditional follow-up write (only fires when self-heal actually dispatches a re-warm), not a
standalone scheduled job in blackout-infra's `cron-jobs.json`, so a `CRON_JOBS`/`stale_after_min`
entry would false-alarm on any quiet stretch with no incident. `logCronRun`'s own failure path
already fires the standard Discord alert on a failed re-warm.

**Check at the open:** none — pure CI/test-coverage fix, no production behavior changed. Confirm
`main`'s own `verify` check is green on its latest commit once this merges.

### 0q. cron-staleness-watchdog's self-heal outcome never reached the persisted `cron_job_runs` record — fix/cron-staleness-watchdog-healed-array (pending)

**What was broken:** `runSelfHeal` computed a per-job re-warm result (`ok`/`status`/`error`/`detail`)
for every stale cron it dispatched via `dispatchCronWarm`, but only `console[...]`-logged it — the
`healed` array declared to carry it into the persisted run record was never pushed into, so it
stayed `[]` forever. Compounding this, self-heal dispatches via `after()` specifically so it can't
block the response (Cloudflare's ~100s origin timeout), which means the `result` object embedding
`self_healed` is built and persisted via `logCronRun` *before* the background self-heal work has
even started — so a naive `healed.push(...)` fix alone still couldn't reach that already-written
row. Net effect: a self-heal re-warm that FAILED during a real incident was durably invisible —
`cron_job_runs` always showed `self_healed: []` / `ok:true` for the watchdog's own run regardless
of outcome, with the only trace a `console.error` line in raw CloudWatch.

**Fix:** `runSelfHeal` now actually accumulates results, and once the background work settles it
persists a SECOND, distinctly-keyed `cron_job_runs` row (`cron-staleness-watchdog-self-heal`)
carrying the real per-job outcome — marked `"failed"` by `logCronRun` (firing the same Discord
alert every other cron failure gets) if any re-warm did not succeed. The synchronous response no
longer claims a settled `self_healed: []` when self-heal was actually dispatched; it reports
`self_healed: null` (pending) plus a `self_heal_log_key` pointing at the follow-up row.

**Check at the open:** this only matters when `CRON_WATCHDOG_SELF_HEAL=1` is set AND a market-hours
cron actually goes stale during RTH (rare by design — self-heal exists for exactly that incident).
If a real self-heal fires during tomorrow's open, confirm a second `cron_job_runs` row appears
under job key `cron-staleness-watchdog-self-heal` (query `GET /api/admin/cron-health` or the
`cron_job_runs` table directly) with a `healed` array naming the re-warmed job(s) and their real
`ok`/`status` — not just the watchdog's own always-`ok:true` row. No self-heal firing at all during
RTH (the common case) means nothing to check — the fix is dormant, not exercised, that day.
### 0o. `spx-signal-weight-optimize` cron threw an uncaught RangeError on `?days=`/`?days=abc` — fix/spx-signal-weight-optimize-nan-crash (pending)

**What was broken:** `GET /api/cron/spx-signal-weight-optimize?days=` (empty value, or a bare
`?days`) or `?days=abc` (non-numeric) hit `parseInt("", 10)` = `NaN` (the `??` fallback only fires
on `null`/`undefined`, and `URLSearchParams.get()` returns `""` not `null`), which flowed into
`new Date(NaN).toISOString()` and **threw** `RangeError: Invalid time value` ABOVE the route's own
try/catch — so the crash was never caught, `logCronRun` never fired, and the failure was invisible
to `cron_job_runs`/`cron-staleness-watchdog`. Sibling crons (`largo-cleanup`, `nighthawk-outcomes`)
already guarded the identical kind of `?days` override; this one had not.

**Fix:** guard the parsed value with the same idiom `nighthawk-outcomes/route.ts` already uses —
`Number.isFinite(rawLookbackDays) && rawLookbackDays > 0 ? rawLookbackDays :
DEFAULT_LOOKBACK_DAYS` — before it reaches any date arithmetic. A valid numeric override still
works unchanged; only the malformed/missing cases changed, from an uncaught crash to a clean
fallback to the 30-day default.

**Check at the open:** no RTH-dependent behavior — this cron reads `spx_signal_observations` and
runs on its own nightly 10 PM UTC schedule with no query param, so the scheduled run was never
affected by this bug and needs no re-check. The one thing worth confirming once, at any time (not
specifically at the open): `curl` the route with a valid `CRON_SECRET` Bearer token and
`?days=`/`?days=abc` and confirm a clean `200 {"ok":true,"skipped":...}` (or a real report once 10+
days of data exist) instead of a `500` — proving the fix holds against the live route, not just the
mocked unit test.

### 0p. `GexPositioning.nearest_wall` went stale across the live-WS wall override — fix/gex-positioning-nearest-wall-stale (pending)

**What was broken:** `getGexPositioning()` overwrites `call_wall`/`put_wall` in place with fresher
UW WS strike-ladder walls during RTH (`hasLiveGexStrikeExpiry(root)` true), but `nearest_wall` was
computed once, earlier, inside `gexPositioningFromHeatmap()` from the **pre-override** Polygon-only
walls and never re-derived. So a live RTH response could serve `call_wall`/`put_wall` from the WS
ladder while `nearest_wall` still named a stale strike/side/distance from before the override —
read directly by `spx-desk-intel.ts` (Live Desk brief grounding numbers), Largo's positioning tools,
`/api/market/gex-positioning`, the mobile ticker route, and the Meridian positioning panel.

**Fix:** extracted the "closer of call_wall/put_wall to spot" logic into a shared
`nearestWallFromLevels()` helper in `gex-positioning.ts`; the WS-override block now recomputes
`nearest_wall` from the POST-override `call_wall`/`put_wall` whenever either one actually changed,
using the same helper the base derivation uses (so the two can't drift apart again).

**Check at the open:** on a WS-active ticker (SPX/SPY/QQQ) during RTH, confirm the served
`nearest_wall.strike` always equals either `call_wall` or `put_wall` in the SAME
`/api/market/gex-positioning?ticker=SPX` (or equivalent Largo tool call) response, with the correct
side (`resistance` for call_wall, `support` for put_wall) and a `distance_pts` consistent with
`nearest_wall.strike - spot`. Pay particular attention right after a fast intraday gamma migration
(a real WS wall move), since that's the moment pre-fix and post-fix values would have diverged most.

### 0r. `stock-candle-store` REST session-open seed could stamp a new ET session with yesterday's `prev_close` — fix/stock-candle-store-seed-day-rollover-race (pending)

**What was broken:** `seedSessionOpenIfNeeded()`'s `.then()` callback only guarded against a
*concurrent* REST seed landing twice for the SAME session (`s.openSource === "rest"`) — its own
comment claimed it also checked "this ticker is still on the session we seeded for", but nothing
in the code compared the ticker's CURRENT session date against the date active when the fetch
FIRED. `recordStockTick`'s day-rollover branch resets `openSource` back to `""` (not `"rest"`) on
a new ET session day, so a REST fetch fired just before an ET session boundary and resolving just
after would sail past the only guard that existed and permanently stamp the NEW session with an
anchor fetched for the OLD one — "rest" is never downgraded back to "ws-bar", so the wrong anchor
then stays authoritative for every `change_pct` computed for that ticker for the rest of the new
session.

**Fix:** capture the session date at the moment the seed fires (`firedForSessionDate`) and require
it to still match `s.sessionDate` at resolution time, in addition to the pre-existing
`openSource === "rest"` concurrent-seed guard (left unchanged, still needed for the in-session
case). RED→GREEN proof: `git stash` on just the source fix reproduced `changePct` computed off the
stale anchor (`-92.99` instead of `0`) via a new `t.mock.timers.enable({apis:["Date"]})`-driven test
that crosses a real ET midnight mid-flight; restoring the fix makes it pass (20/20 in the file,
139/139 across `src/lib/ws/*.test.ts`).

**Check at the open:** this only manifests right at an ET session boundary for a ticker with an
in-flight demanded REST seed at that exact moment — genuinely hard to trigger deliberately live.
The useful live check is a NEGATIVE one: watch any actively-viewed 24-hour-eligible/overnight
symbol's `change_pct` across today's session open (13:32 UTC / 09:30 ET) for a value that looks
anchored against a stale multi-day-old close rather than today's real open — that would be this
exact bug recurring on a boundary this fix did not touch (e.g. a rollover mid-fetch during RTH
itself, which the fix now also covers, so it should NOT recur at all). No dedicated live probe
exists for this narrow a race window; the regression test is the durable guard.

### 0n. "Every setup logged publicly" overclaimed against a 3-of-7-product methodology page — fix/public-record-scope-overclaim (pending)

**What was broken:** About page, homepage, and `WhyBlackoutContent.tsx` all said "Every setup BlackOut
flags is logged publicly"/"the full ledger, always" and pointed to `/methodology` for "how each
product is scored" — but `/methodology`'s own payload type (`TrackRecordPagePayload`) is hard-typed
to exactly SPX Slayer, Night Hawk, and 0DTE Command. HELIX/Thermal/Vector/Meridian/Largo have no
public ledger section there.

**Fix:** scoped the "every setup"/"each product" claims on all three surfaces to name the three
products `/methodology` actually covers — no change to whether HELIX/Vector's own internal
tracking should eventually be exposed publicly (a separate, still-open product question).

**Check at the open:** none — pure marketing-copy correction, no RTH-dependent behavior. Confirm
the live About/homepage/Why-BlackOut pages name SPX Slayer/Night Hawk/0DTE Command next to the
transparency claim rather than an unscoped "every setup"/"each product."

### 0m. SPX Slayer marketing claimed GEX/VEX/DEX/CHARM lenses — real UI only has GEX/VEX — fix/spx-slayer-lens-overclaim (pending)

**What was broken:** homepage/pricing copy said SPX Slayer provides "GEX / VEX / DEX / CHARM lenses
on the 0DTE ladder" (`PRODUCT_MANIFEST.spx`). SPX Slayer's own live matrix component
(`SpxGexMatrixHeatmap.tsx`) only ever renders a GEX/VEX toggle — confirmed by an exact-string grep
across `src/features/spx/*.tsx` returning zero hits for `"dex"`/`"charm"` as a UI value. The
dedicated Academy guide already correctly documented only 2 lenses; the marketing copy was the one
that overclaimed, likely copied from Thermal's genuinely-accurate 4-lens entry in the same file.

**Fix:** corrected `PRODUCT_MANIFEST.spx.lifecycle`/`.capabilities` to say GEX/VEX only; Thermal's
real 4-lens entry is untouched.

**Check at the open:** none — pure marketing-copy correction, no RTH-dependent behavior. Confirm
`https://blackouttrades.com/` no longer shows "GEX / VEX / DEX / CHARM" attributed to SPX Slayer
specifically (Thermal's own card should still show all four, correctly).

### 0n2. Thermal GexHeatmap fabricated flat +0.00% when change_pct absent — fix/thermal-header-change-pct-null (pending)

**What was broken:** When the matrix payload omitted `change_pct` and the live quote had not arrived,
the Thermal ticker header rendered `+0.00%` via `data?.change_pct ?? 0` and `quote!.change_pct ?? 0`
fallbacks. Sibling `ThermalCompareStrip` already hid the chip with `?? null`.

**Fix:** Thread `matrixChangePct` as `number | null`; only render the header % chip when finite.

**Check at the open:** On `/heatmap`, switch to a ticker whose matrix is loading — header spot may
show but day-change chip should be absent (not `+0.00%`) until a real quote or matrix change arrives.

### 0l. Pricing comparison table omitted the $49 SPX Slayer plan entirely — fix/spx-slayer-pricing-comparison-column (pending)

**What was broken:** `/pricing` sells three commercial choices — SPX Slayer $49/mo, Premium Monthly
$199/mo, Premium Yearly — but `FeatureComparison` (the "What you get" matrix) only had Free and
Premium columns. Every SPX Slayer-only row (the SPX Slayer desk itself included) rendered as
`— / ✓`, giving a $49 visitor zero representation of what they'd actually get in the page's primary
feature matrix — reported as a P3 pricing/conversion defect (concrete purchase-decision gap: no way
to compare $49 vs $199 in the matrix a visitor is looking at to decide).

**Root cause:** `FeatureComparison`/`FEATURE_MATRIX` still modeled the original Free|Premium
entitlement structure and was never migrated when SPX Slayer became an independently purchasable
tier — each row's `community` (SPX Slayer) access was a marketing boolean nobody had ever checked
against a real gate.

**Fix:** new `src/lib/desk-tier-requirements.ts` — the minimum `Tier` each desk's own
`layout.tsx` actually enforces (`requireDeskTool`/`requireTier`), verified against those layout
files by `desk-tier-requirements.test.ts` (source-scan, same pattern
`desk-protected-route-coverage.test.ts` already proved for the protected-route lists). Every desk
row in `FEATURE_MATRIX` now derives its SPX Slayer/Premium columns from that manifest via
`tierAtLeast` instead of a hand-typed boolean; the two rows with no code-level gate (0DTE graded
plays, private Discord) are cross-checked against `PLAN_MATRIX.spx_slayer.includes`'s own canonical
perk list instead. `FeatureComparison` now renders Free | SPX Slayer ($49/mo) | Premium ($199/mo).

**Check at the open:** none — this is a static marketing page with no RTH-dependent data; `/pricing`
should show three columns with the SPX Slayer desk row (and every other SPX-desk-scoped row) marked
✓ under SPX Slayer, and every premium-only desk (HELIX, Largo, Night Hawk, Thermal, Vector,
Meridian) marked — under SPX Slayer / ✓ under Premium.

### 0m. `bie/decompose.ts` — dead compound-question splitter removed — fix/remove-dead-bie-decompose (pending)

**What was broken:** nothing member-visible — `src/lib/bie/decompose.ts` (a pure "15 questions in
one ask" splitter, task #57) was never wired into `composeCompound` or called by anything else;
zero non-test importers anywhere in `src/`. Flagged 2026-08-30 in `FINDINGS.md` as the one of four
related `bie/*` files that was safe to delete outright (its three siblings — `router.ts` still
needed for a live type import, `composers.ts`/`dynamic-format.ts` referenced only by a test that
can't run in this sandbox — were correctly left untouched then and remain untouched now).

**Fix:** `git rm src/lib/bie/decompose.ts src/lib/bie/decompose.test.ts`; extended
`repo-hygiene.test.ts`'s existing orphan allowlist so it can't silently be reintroduced dead.

**Check at the open:** none — there is no live-RTH-dependent behavior to verify (the module was
never reachable from any request path before removal). `tsc --noEmit` clean and the full test
suite passing (recorded in the PR) are the complete verification for a fix of this kind; listed
here only because the standing instruction asks every fix to be logged, not because there is an
RTH-specific check to run.

### 0n. Night Hawk readiness chip falsely green on future `as_of` — fix/nighthawk-readiness-future-asof (pending)

**What was broken:** On `/nighthawk`, the header readiness chip could show green **READY** when the
board's `as_of` timestamp was materially in the future (client/server clock skew). Negative
`asOfAgeMs` never exceeded the 60s stale threshold, so freshness could not be verified but the
chip still read ready.

**Fix:** `resolveZeroDteReadiness` in `pane.ts` now treats `asOfAgeMs <
-ZERODTE_MARK_FUTURE_TOLERANCE_MS` the same as stale age — amber **DELAYED** — matching sibling
`resolveZeroDteFreshness` in `ZeroDteBoard.tsx`.

**Check at the open:** On `/nighthawk` during RTH with live board data, confirm the readiness chip
is **READY** only when `as_of` is plausibly current; if a skew incident occurs, chip should read
**DELAYED** not **READY**.

### 0k. Six orphaned modules removed (SPX/Thermal/marketing) — fix/orphaned-spx-thermal-modules (pending)

**What was broken:** nothing member-visible — `src/features/spx/{hooks/useSpxDayPerformance.ts,
lib/spx-sniper-backdrops.ts, lib/spx-session-phase.ts}`,
`src/features/thermal/components/ThermalFreshnessBar.tsx`, `src/components/landing/LandingBackdrop.tsx`,
and `src/components/learn/LearnPageShell.tsx` had zero importers anywhere in the repo (two
unfinished features, one dead helper, and three components superseded by a later replacement —
`ThermalMatrixFreshnessChip`, `StaticLandingBackdrop`, and `/learn/layout.tsx`'s own marketing
shell, respectively). Pure dead-code removal, no route or rendered output changed. Two other
same-class orphans were found and deliberately left untouched, both per a **standing prior
decision already on record in `FINDINGS.md` (2026-08-30)**: `src/components/ScrollProgressBar.tsx`
(flagged OPEN for the landing-page owner to decide, not this sweep) and
`src/components/render/DealersLadderBackground.tsx` (a 624-line WebGL shader hero explicitly
NOT flagged as dead in that same 2026-08-30 sweep, for carrying a deliberate design-intent
comment) — see the findings-staging entry for the full writeup.

**Fix:** `git rm` the six files; corrected one stale doc-comment that named a removed component
by name (`thermal-desk-state.ts`); guarded against reintroduction with a `repo-hygiene.test.ts`
assertion.

**Check at the open:** none — there is no live-RTH-dependent behavior to verify (nothing rendered
or served by these files was reachable before removal). `tsc --noEmit` clean and the full test
suite passing (recorded in the PR) are the complete verification for a fix of this kind; listed
here only because the standing instruction asks every fix to be logged, not because there is an
RTH-specific check to run.

### 0j. Night Hawk PASSED/WATCH list rendered trackPct with no qualifier — fix/nighthawk-passed-list-trackpct-label (pending)

**What was broken:** the compact play-list row (`PlayLifecycleCardBody`, every board's actual live
row renderer) showed a never-entered WATCH/SKIP play's hypothetical `trackPct` as a bare colored
`+N%` with no label — indistinguishable from real P&L. A member screenshotted the mobile PASSED
tab full of "+PNL%"-style green numbers and asked why none of the "winners" ever opened; they were
never entered at all. `primaryReturnLabel` ("Since flag" for WATCH/SKIP, "Peak Return" for CLOSED)
already existed and was already unit-tested — it just wasn't called from this component.

**Fix:** `PlayLifecycleCardBody` now renders `primaryReturnLabel(play)` beside the return figure,
reusing the existing `.nh-deck-premlab` class. Label-only change — no gate, number, or trading
logic touched.

**Check at the open:** open `/nighthawk` on a phone-width viewport (or `proxy-browser.cjs --viewport
430x932`), filter to PASSED/WATCH, and confirm every row's return figure now carries a small
"Since flag" caption under it, and every CLOSED row carries "Peak Return" — never a bare number.

### 0j-c. Admin panel timeAgo "just now" on clock-skewed ISO timestamps — fix/admin-time-ago-future-guard (pending)

**What was broken:** `timeAgo(iso)` in Operations + X Marketing admin panels used raw `Date.now() - new Date(iso)`
without a future guard — same failure class as #3627 `storeAge()`.

**Fix:** Shared `timeAgoFromIso()` in `admin-time-ago.ts` with `WS_TIMESTAMP_FUTURE_TOLERANCE_MS`.

**Check at the open:** `/admin` → Operations incidents/audit rows show plausible relative times, not "just now" on skewed timestamps.

### 0j-b. Admin ops store-age "just now" on clock-skewed timestamps — fix/admin-store-age-future-guard (merged #3627)

**What was broken:** `storeAge()` in the admin Operations dashboard computed `Date.now() - updatedAt`
without a future guard. A timestamp more than a few seconds ahead of wall clock produced negative age;
`Math.floor(negative / 1000) < 10` evaluated true, so the tile read **"just now"** with ok=true.

**Fix:** Extracted to `admin-store-age.ts` with `WS_TIMESTAMP_FUTURE_TOLERANCE_MS`; beyond tolerance
returns `{ label: "clock skew", ok: false }`; otherwise clamps with `Math.max(0, ...)`.

**Check at the open:** `/admin` → Operations → UW/Polygon store tiles show plausible ages during RTH
(e.g. "12s ago"), not "just now" on a store that hasn't ticked.

### 0j-c. Admin API feed + SPX terminal fmtRel future-skew — fix/admin-fmtrel-future-guard (pending)

**What was broken:** `AdminApiLiveFeed.tsx` and `AdminSpxTerminal.tsx` had local `fmtRel()` helpers
computing `Date.now() - new Date(iso)` without a future guard — same false **"just now"** / **"now"**
class as #3627/#3641.

**Fix:** Extended `admin-time-ago.ts` with shared `isoAgeSec()` + compact/open-duration formatters;
removed duplicate local helpers.

**Check at the open:** `/admin` API live feed + SPX terminal show plausible relative times (or
"clock skew"), not "just now" on skewed event timestamps.

### 0i. Platform-integrity probe tier-gate false-WARN — fix/platform-integrity-clerk-auth (merged #3605)

**What was broken:** `npm run validate:platform-integrity` hit tier-gated desk routes without Clerk auth,
WARNing on empty SPX matrix / vector walls even when live member data was healthy.

**Fix:** Mint temp admin+premium Clerk session in `validate-platform-integrity.mjs`; assert vector walls
via `callWalls`/`putWalls` counts.

**Check at the open:** `npm run validate:platform-integrity` → 0 warn on `thermal-spx-matrix`,
`vector-spx-0dte-walls`, `gex-positioning-spx` during RTH with strikes > 0.

### 0i-b. Platform-integrity 401 SKIP when Clerk absent — fix/platform-integrity-tier-skip-v2 (pending #3617)

**What was broken:** When Clerk keys are absent (sandbox / lifecycle without auth), `gex-positioning-spx`,
`thermal-matrix-SPY/QQQ`, and `vector-spx-0dte-walls` returned HTTP 401 but the probe still WARNed instead
of SKIP — unlike desk/flows/nighthawk/zerodte probes.

**Fix:** Map 401 → SKIP + `tier-gated` for those three probes (complements #3605 auth mint path).

**Check at the open:** `npm run validate:platform-integrity` with no Clerk keys → **0 warn** (tier-gated
SKIP). With auth during RTH, premium probes PASS with strikes > 0.

### 0g. RTH-open options-socket retry false-fail — fix/rth-open-socket-retry-false-fail (merged #3600)

**What was broken:** `validate:rth-open` called `fail()` on the first options-socket probe attempt even
when attempt 2/3 returned green (`ingest leader lock held — marks warming`), leaving a stale failure in
the harness exit code.

**Fix:** `scripts/lib/rth-socket-probe.mjs` — retry up to 3 times; hard-fail only after all attempts.

**Check at the open:** Run `npm run validate:rth-open` during RTH; transient "no ingest leader" on
attempt 1 must not fail the run when attempt 2 shows warming/fresh marks.

### 0i. Indices VIX change_pct wrong sign — fix/indices-vix-change-pct-ws-overlay (pending)

**What was broken:** `/api/market/indices` served VIX `change_pct` with the wrong sign (+0.07% vs Polygon
-0.35% on 2026-09-04 RTH) because the route overlaid index REST snapshots with stock-candle-store ticks
(session-open anchor) instead of indices-WS (`I:VIX` / `spx:pulse:snapshot` prior-close anchor).

**Fix:** `index-snapshot-overlay.ts` — same open_source/rest rebase guard as spx-desk `mergeWsIndexSnapshots`.

**Check at the open:** `NODE_USE_ENV_PROXY=1 node scripts/audit/data-validator.mjs` → `VIX change_pct sign matches Polygon` PASS during RTH.

### 0h. Sentry auth + stale Server Action noise — fix/auth-failure-benign-denylist-and-server-action-reload (pending)

**What was broken:** `validate:deploy` Sentry sample showed `ClerkAuthFailure: You're already signed in`
(normal navigation to `/sign-in` while authenticated) and `UnrecognizedActionError: Server Action … was not found`
(deploy-race stale action IDs) as top unresolved issues.

**Fix:** Benign Clerk message denylist in `auth-failure-detect.ts`; extend chunk-reload guard for stale Server Actions.

**Check at the open:** After any deploy rollout, confirm Sentry top issues no longer include these two patterns; members mid-rollout should get a one-shot reload instead of a stuck page on stale Server Actions.

### 0i. Platform-integrity false WARN on tier-gated GEX routes — fix/platform-integrity-tier-gated-skip (pending)

**What was broken:** `validate:platform-integrity` graded `gex-positioning-spx`, `thermal-matrix-SPY/QQQ`,
and `vector-spx-0dte-walls` as WARN (`strikes=0 spot=—`) when those routes returned **401** after
#3603 aligned desk auth — the harness already SKIP'd other tier-gated routes but not these four.

**Fix:** `tierGatedStatus()` helper — HTTP 401 → SKIP `tier-gated` for all GEX/vector probes.

**Check at the open:** `npm run validate:platform-integrity` off-session (no Clerk) → **0 warn**,
10 skip; with admin Clerk session → thermal-matrix SPY/QQQ strikes > 0 PASS.

### 0f. SPX dashboard E2E cross-tool stale matrix flip — fix/spx-dashboard-cross-tool-stale-matrix (pending)

**What was broken:** `spx-dashboard-e2e-audit.mjs` compared gamma flip from a matrix snapshot fetched
at audit start (after full cell validation) against a fresh `gex-positioning` read. SPX matrix cache
turns every ~8s RTH — produced false 500pt+ FAILs when the book re-crossed between fetches (e.g.
matrix 6990 vs positioning 7795 on 2026-09-04 ~10:04 ET).

**Fix:** Re-fetch `/api/market/gex-heatmap?ticker=SPX` inside `crossToolIntegration` alongside
positioning; annotate flip FAILs with `calculation_id` match/mismatch.

**Check at the open:** `node scripts/spx-dashboard-e2e-audit.mjs` → `integration:spx-cross-tool` PASS
during RTH; flip delta should be 0 when `calculation_id` matches on back-to-back probe.

### 0c. HELIX FlowAnomalyBanner future-timestamp recency — fix/flow-anomaly-future-timestamp (pending)

**What was broken:** `FlowAnomalyBanner` on `/flows` treated a future-dated `detectedAt` as "recent"
because `Date.now() - future < RECENCY_MS` — could flash the anomaly banner for events that have not
happened yet under clock skew.

**Fix:** `isFlowAnomalyRecent()` clamps future skew to not-recent.

**Check at the open:** On `/flows` during RTH, banner only shows anomalies within 15 minutes; no
spurious banner from skewed rows after deploy.

### 0d. GEX heatmap Night Hawk context future-timestamp gate — fix/gex-heatmap-nh-context-future-timestamp (pending)

**What was broken:** `/api/market/gex-heatmap` could attach `nighthawk_context` from an edition whose
`published_at` was in the future — negative age never tripped the 24h freshness gate.

**Fix:** `isNighthawkContextEditionFresh()` via shared `isZeroDteMarkStale()` (24h max age + future skew reject).

**Check at the open:** On `/heatmap` or SPX matrix during RTH, Night Hawk context only appears for editions
published within 24h; no spurious context from skewed/future `published_at` after deploy.

### 0e. Night Hawk verifier premium-vs-chain future-timestamp gate — fix/nighthawk-verifier-future-published-at (pending)

**What was broken:** The correctness-audit verifier's L4 chain-confirm premium check
(`nighthawk-verifier.ts`) treated a future-dated edition `published_at` as fresh — `Date.now() -
publishedAtMs` goes negative under clock skew, which always satisfies the `<= 4h` freshness gate,
letting the premium-vs-chain comparison run on data whose freshness was actually unproven and
risking a false `flag` verdict from garbage clock-skewed input.

**Fix:** `premiumFresh` now uses the shared `isZeroDteMarkStale()` (4h max age + 60s future-skew
reject), same pattern as items 0c/0d above.

**Check at the open:** This is correctness-audit tooling, not a member-facing surface — nothing to
check on the live UI. Confirm instead that the Night Hawk correctness score (wherever the
correctness-audit run is read from) does not show a spurious `premium` metric `flag` for the
day's published edition; a real chain-band mismatch should still flag normally.

### 0f. Vector volume-profile POC/VAH/VAL label axis collision — fix/vector-vp-label-collision (pending)

**What was broken:** On SPX Slayer `/dashboard` (shared Vector chart), volume-profile level labels
("POC", "VAH", "VAL") were drawn at `rightX - 6` flush against the price axis — native lightweight-charts
price-line axis badges (Pin, Gamma flip, VWAP, etc.) painted on top whenever both levels landed near the
same price, making the profile label unreadable.

**Fix:** Anchor labels at `gutterLeft + 4px` with left text alignment — inside the profile bar band,
away from axis badges (`volumeProfileLabelX()`).

**Check at the open:** On `/dashboard` SPX Slayer with volume-profile enabled during RTH, when Pin (or
any price-line badge) and POC are near the same price, both labels must be independently legible in a
`proxy-browser.cjs` capture of the chart's right edge (no gray "POC" text hidden under an orange Pin badge).

### 0. Discord digest crons on admin health board — PR #3543 (merged)
EventBridge crons logging `cron_job_runs` rows, but absent from `CRON_JOBS` — invisible to
`cron-staleness-watchdog` and the admin cron-health board.

**Fix:** added three registry entries with deployed schedules (`*/2`, `*/15`, `*/15` UTC) and
`stale_after_min` 10/45/45; `produces_member_alert: true`.

**Check at the open:**
- `GET /api/admin/cron/health` (admin) shows all three with recent `last_run_at` during RTH.
- If any Discord channel goes quiet, confirm the watchdog would now alert (not first noticed by members).

### 0b. Warm-cron `force=1` replay floors — desk-warm #3540, heatmap-warm #3542, zerodte-warm #3550 (merged), meridian-warm (pending)

**What was broken:** `desk-warm`, `heatmap-warm`, `zerodte-warm`, and `meridian-warm` (and peers)
had overlap locks but no minimum re-run floor — `?force=1` could replay the full warm pass (or, for
`zerodte-warm`, the 0DTE scanner tick + board snapshot rebuild) in a tight loop faster than any
legitimate trigger.

**Fix:** atomic `sharedCacheSetNx` cooldown keys checked before overlap lock (desk-warm 60s,
heatmap-warm 10s, zerodte-warm 60s, meridian-warm 60s); all fail open on a Redis error.

**Check at the open:**
- CloudWatch `/ecs/blackout-production`: no burst of `[cron/<name>] background done` lines closer
  than each cron's own floor apart from an out-of-band `?force=1` caller, for any of the four crons.
- ALB `TargetResponseTime` p99 stays bounded during warm windows (no overnight replay storms).
- `zerodte-warm` specifically: legitimate 4 min rth-warm-leader heals unchanged.

### 1. `CACHE_WARM_ALWAYS` leftover staging bypass — PR #3512 (merged)

**What was broken:** `shouldRunCacheWarmer()` bypassed its weekday 4am-8pm ET hours gate whenever
`CACHE_WARM_ALWAYS=1` was set — a knob documented as staging-only. Staging was decommissioned
2026-07-25, but the **production** secret `blackout-production/app/env` still carried
`CACHE_WARM_ALWAYS=1`, so `desk-warm`, `zerodte-warm`, `heatmap-warm`, and `meridian-warm` were all
running 24/7 instead of only 4am-8pm ET.

**Evidence (pre-fix, 2026-09-04 00:21-06:18 UTC):** 40+ `desk-warm` background runs (10-33s
elapsed) firing every 1-3 minutes overnight; `AWS/ECS` CPUUtilization on `blackout-production-web`
Max 80-90% against a 2-8% average in nearly every 15-min bucket; `AWS/ApplicationELB`
TargetResponseTime p50/p90 healthy (37-79ms/91-377ms) but **p99 1.7-3.6s, Max 9-41 seconds**.

**Fix:** removed the `CACHE_WARM_ALWAYS` escape hatch entirely from `cache-warmer-gate.ts`; `force=1`
remains for on-demand warms. Pure code change — does not touch the stale secret value directly
(deliberately, to stay inside the reviewed PR path), so the secret is now inert post-deploy rather
than removed.

**Check at the open:**
- Re-pull the SAME three CloudWatch series (ECS CPU Max, ALB TargetResponseTime p99/Max, `desk-warm`
  `elapsed=` log frequency) for an **overnight window AFTER this deploys** and confirm: `desk-warm`
  (and the 3 sibling warm crons) stop firing outside 4am-8pm ET entirely, ECS CPU Max drops back
  toward the 2-8% average band overnight, and ALB p99/Max tighten toward the p50/p90 band overnight.
  A continued 24/7 firing pattern post-deploy means the deploy does not carry this fix — confirm by
  `git merge-base --is-ancestor` against the deployed SHA before concluding the fix failed.
- During the 4am-8pm ET window itself (i.e. during today's RTH), confirm the 4 warm crons still run
  normally — this fix must not have silently narrowed the window itself, only removed the bypass.

### 2. Vector GEX wall spot-side inversion — PR #3495 (merged)

**What was broken:** `computeGexWalls(ladder, {maxPerSide})` picked the top-N call/put walls by
raw gamma magnitude with no spot-side constraint, so a call wall could resolve BELOW spot (or a
put wall ABOVE spot) whenever the opposite side carried more total gamma than the correct side —
inverting which strike Vector's GEX lens, per-expiry DTE walls, and the GEX-reconstruction rail all
displayed as the nearest resistance/support level.

**Fix:** added an optional `spot` parameter that side-constrains `callWalls` (strike > spot) and
`putWalls` (strike < spot) with no fallback to the wrong side; wired through all 6 call sites across
`vector-universe.ts`, `vector-dte-walls-core.ts`, `vector-gex-reconstruct.ts`, and
`vector-snapshot.ts`'s 3 GEX-lens sites. VEX-lens call sites deliberately left unconstrained
(different semantics, per the PR's own doc comment).

**Check at the open:** on `/vector` (`proxy-browser.cjs`, desktop + mobile), for several liquid
tickers (SPX, SPY, QQQ, and at least one where the pre-fix inversion was plausible — a name with a
lopsided gamma book, e.g. IWM/NDX-shaped), confirm the displayed call wall strike is always ABOVE
the live spot and the put wall strike always BELOW it, across the GEX matrix tab, the per-expiry DTE
wall view, and the GEX-reconstruction rail. A call wall at or below spot (or vice versa) means the
fix is not deployed or a call site was missed.

### 3. PgBouncer cross-service/autoscaling budget blindness — PR #3499 (merged)

**What was broken:** `computeSafePgPoolMaxDefault` derived the per-replica Postgres pool ceiling
from `PGBOUNCER_BACKEND_BUDGET / REPLICA_COUNT_MAX_FOR_POOL` alone, with no carve-out for other
services sharing the same PgBouncer backend budget (cron Lambda, market-worker, admin tooling) —
so under a full autoscale-up, real backend connections could exceed the actual PgBouncer budget.

**Fix:** added `PGBOUNCER_RESERVED_FOR_OTHER_SERVICES` (env, defaults 0) as a third parameter,
reserved BEFORE dividing by replica count, plus a second oversubscription warning that checks
`poolMax * REPLICA_COUNT_MAX_FOR_POOL + PGBOUNCER_RESERVED_FOR_OTHER_SERVICES` against the budget.

**Check at the open:** this is an infra/config change with no visible UI surface — confirm instead
via CloudWatch Logs `/ecs/blackout-production` for absence of new PgBouncer connection-exhaustion
warnings/errors during RTH (peak concurrent-request load), and confirm `PGBOUNCER_RESERVED_FOR_OTHER_SERVICES`
is actually set to a non-zero value in the production secret if the operator intends the reservation
to do anything live (the fix ships a safe default of 0, i.e. no behavior change, until the env var is
set — this is a capability, not yet an active guard, unless the secret was updated separately).

### 4. Night Hawk tier drift — unpinned `score_floor` — PR #3505 (merged)

**What was broken:** `tierFromEntryContext` recomputed `scoreFloorForOrigin(origin)` fresh every
read instead of using the floor that was actually in effect at commit time. If `ZERODTE_SCORE_FLOOR*`
env constants changed between a play's commit and any later read (including the record/tier-export
endpoints), the SAME historical play could tier differently depending on when it was read — measured
live on a real ASST play (score 59): tier A under the pinned floor of 50, tier B under a later
recomputed floor of 65.

**Fix:** `buildZeroDteEntryContext` now pins `score_floor` into `entry_context` at commit time;
`tierFromEntryContext` reads the pinned value when present, falling back to recompute only for
legacy rows with no pinned floor.

**Check at the open:** open a handful of TODAY's newly-committed 0DTE plays (post-open) in the
Night Hawk board and the `/api/market/zerodte/record` / tier-export endpoints, and confirm the same
play reports the SAME tier across both surfaces and across repeated reads through the session — a
play that tiers differently between two reads (without an intervening `ZERODTE_SCORE_FLOOR*` env
change) means the pin did not take effect.

### 5. Largo consensus extractor — HELIX/VECTOR field mismatches — PR #3508 (merged)

**What was broken:** `extractHelixRead` read `get_flow_tape`/`get_helix_derived` payload shapes that
do not carry a real aggressor-aware direction field (only `call_pct`, which per the repo's own C3
precedent must never be read as bullish/bearish — a bought call is bullish but a sold call is
bearish). `extractVectorRead` read a non-existent top-level `bias`/`magnet` shape instead of the
real `result.play.bias` / `result.magnet.pull`. Both fed Largo's cross-product consensus verdict
with either fabricated or absent directional signal.

**Fix:** `extractHelixRead` now reads `get_helix_tape_analytics`'s real `session.direction` (falling
back to `directionFromCallPct` only when no real direction field is present); `extractVectorRead`
now reads `result.play.bias` for direction and `result.magnet.pull` only as supporting strength
evidence, never as a direction override. The old mismatched tool calls (`get_flow_tape`,
`get_helix_derived`, `get_vector_pulse`) no longer contribute a vote at all.

**Check at the open, live, with real flow:** ask Largo *"is the flow on \<ticker\> bullish or
bearish?"* for a ticker whose Helix/Vector panels show a clear, high-confidence direction, and
confirm Largo's answer matches the panel. Then ask about a ticker where Helix's own panel would
read neutral/unreadable (e.g. one dominated by unreadable aggressor-side flow) and confirm Largo
also declines to assert a direction rather than fabricating one from `call_pct`. This is the exact
CG-incident shape (2026-08-23: 100% call premium, panel BEARISH, old Largo logic BULLISH) — the
check is whether that disagreement can recur.

### 6. SPX EOD pin forecaster long-gamma bearish lock — PR #3497 (cursor, merged — not authored by this session, logged here for completeness)

**What was broken (per PR description):** the EOD pin forecaster's magnet-selection logic could
lock onto a distant max-pain strike below spot even in a long-gamma regime where the nearest
meaningful OI concentration (the "king" node) sat above spot, producing a persistently bearish
projected close regardless of where dealer positioning actually clustered.

**Fix:** added `pickLongGammaMagnet` — prefers the nearest meaningful OI concentration to spot
(king node) over a distant max-pain strike when closer, so a long-gamma session can now project a
close ABOVE spot when warranted. Also wires real prior-day OHLC (`vector-prior-day-server.ts`,
new) and recent-returns/macro-event trend inputs into the Vector pin forecast, replacing a
derived-from-day-change approximation.

**Check at the open, on a genuinely long-gamma session:** compare the SPX/Vector EOD pin forecast's
projected close and drift direction against where the GEX wall/king-node structure actually sits
relative to spot — confirm the forecast is no longer mechanically pinned bearish/below-spot on a
day where OI clusters above spot. No pre-fix baseline exists from this session to diff against
(cursor-authored, evidence lives in the PR's own commit history) — treat today's open as the first
live observation.

### 7. Meridian timeline showed a live "implied move" beside "· printed" on a same-day print — PR TBD (DISCOVERY lane)

**What was broken:** `overlayTimelineExpectedMoves` (the Meridian earnings **calendar/timeline**
lane, a different surface from the earnings-detail panel #3474/#3482 already fixed) stamped the
LIVE Polygon chain-IV expected move onto every timeline row keyed by ticker, with no check of that
row's own `is_printed` flag. `loadMeridianEarningsTimeline` keeps rows with `report_date >=
todayYmd`, so a same-day BMO print that has already reported by the time a member loads the page
mid-session still reached the overlay — pairing a forward-looking "~X% implied move" with the same
row's own "· printed" label in one rendered string (`meridian-timeline.ts`'s timeline-item
subtitle), asserting a pre-print expectation for an event the label itself says already happened.

**Fix:** `overlayTimelineExpectedMoves` now returns the row unchanged (no overlay) when
`row.is_printed` is true — same withhold-not-relabel treatment #3482 already established for the
detail panel, applied to the second, independent call site that had the same gap.

**Check at the open:** open the Meridian timeline/calendar strip and find a name that reported
before or at the open (a real BMO print). Confirm its row shows NO "~X% implied move" text
alongside "· printed" — either the move fragment is absent entirely, or (if the row has not yet
been enriched this load) it should never coexist with the printed label. A row that shows both
means the withhold did not take effect. Also spot-check an UNPRINTED same-day AMC print still shows
a real chain-IV expected move when a chain exists (the withhold must not have gone too far and
suppressed the legitimate case).

### 8. desk-warm STILL firing off-hours after item #1's `CACHE_WARM_ALWAYS` fix — `force=1` was a separate, unthrottled bypass — PR pending (branch `fix/desk-warm-off-hours-trigger`)

**What was broken:** item #1 above ("Check at the open" #1) worried a continued 24/7 firing pattern
post-deploy would mean the deploy didn't carry the `CACHE_WARM_ALWAYS` fix. That did NOT happen —
re-checked live 2026-09-04: 314 `desk-warm` background completions between 00:29-07:59 UTC, i.e.
the pathological pattern continued for hours AFTER #3512 deployed (~07:32 UTC). But the deploy DID
carry the fix — proved directly, not assumed: `rth-warm-leader`'s own `isEtExtendedWarmHours` gate
(shared code with `shouldRunCacheWarmer`) stayed completely silent (zero log lines of any kind) the
entire off-hours window and resumed at the exact 08:00:02 UTC ET-4am boundary, which is only
possible if the underlying hours check is correct on the running image. EventBridge and
cron-staleness-watchdog's self-heal were also positively ruled out with direct CloudWatch/Lambda log
evidence (see the findings-staging entry). The real gap: `force=1` was ALWAYS a fully separate,
unconditional bypass of the hours gate (intentional, for on-demand/debug warms) that nothing rate-
limited — a caller replaying `?force=1` in a loop could re-trigger the route's full UW/Polygon fan-
out as fast as it liked, since the only existing protection (`OVERLAP_LOCK`) is released the instant
each run completes (often under a second). Whatever external caller was doing this (not traced to
any code path this repo owns — all four scripts that construct that exact request are one-shot/
manual, not scheduled) is now capped regardless of identity.

**Fix:** a second guard, `RERUN_COOLDOWN_KEY`/`RERUN_COOLDOWN_SEC = 60`, checked before the overlap
lock and before dispatch, claimed via the same atomic `sharedCacheSetNx` primitive but — unlike
`OVERLAP_LOCK` — never released early, so it holds for its full 60s TTL regardless of how fast the
run itself finishes. 60s sits below every legitimate cadence (rth-warm-leader's 90s heal threshold,
EventBridge's 5-min schedule), so it never blocks real traffic.

**Check at the open:** re-pull `desk-warm` `elapsed=` log frequency for an overnight window AFTER
this deploys and confirm off-hours completions are now capped at roughly one per 60s at most (i.e.
whatever is still calling `force=1` gets a `"rate-limited"` skip response, logged via
`logCronRun("desk-warm", …)`, instead of a full re-run) — a continued sub-60s cadence means this fix
is not yet deployed, not that it failed. During the 4am-8pm ET window itself, confirm `desk-warm`
still runs on its normal ~90s (leader-heal) / 5-min (EventBridge) cadence — this fix must not have
introduced any new throttling of legitimate in-window traffic, since 60s is strictly below both.

### 9. PgBouncer follow-up config from #3499 still never set — zero-headroom condition still live — NOT FIXED, needs operator authorization

**What was found:** #3499 (item #3 above) shipped the CODE to defend against web's connection pool
oversubscribing the shared PgBouncer/RDS budget, but its own write-up said explicitly this stays a
no-op until an operator sets two new env vars. Re-checked live 2026-09-04: neither
`REPLICA_COUNT_MAX` nor `PGBOUNCER_RESERVED_FOR_OTHER_SERVICES` has been set on either service —
the zero-headroom condition #3499 was built to defend against is still live, and still correlates
with real ALB 5xx + `[db] transient query error` clusters during RTH. Exact remediation values are
computed and documented in `docs/audit/findings-staging/2026-09-04-pgbouncer-followup-config-never-set.md`
— this was NOT applied because a live Secrets Manager write was blocked by the coordinator's
auto-mode classifier as a production-infra change requiring explicit authorization.

**Check at the open:** if an operator has applied the documented remediation, confirm
`REPLICA_COUNT_MAX`/`PGBOUNCER_RESERVED_FOR_OTHER_SERVICES` are set correctly on both services and
watch for the new `[db]` warning logs (should stay silent if sized correctly) plus a drop in
`[db] transient query error`/ALB 5xx clustering during RTH. If NOT yet applied, this item stays
open — the underlying condition is unchanged from #3499's own original measurement.

### 10. ElastiCache Redis chronically near its effective memory budget, evicting during RTH — NOT FIXED, needs an operator capacity decision

**What was found:** `blackout-production-redis-rg-001` runs 94-99.9% of its effective (post-reservation)
memory budget continuously, evicting up to 620 TTL'd keys/hour during RTH despite real physical
headroom on the node (~26-30% free). Three remedies exist (upsize the node, reduce
`reserved-memory-percent`, or audit cache-key TTL/footprint), each with real cost/risk tradeoffs —
see `docs/audit/findings-staging/2026-09-04-elasticache-redis-memory-pressure.md` for the full
evidence and tradeoff analysis. Deliberately left as a documented finding for an explicit operator
decision rather than executed unilaterally.

**Check at the open:** if a remedy has been applied, confirm `AWS/ElastiCache` `Evictions` trends
back toward the near-zero off-RTH baseline. If not yet applied, this item stays open.

### 11. market-worker ECS CPU-pinned near 100% during RTH, no autoscaling — NOT FIXED, needs a correctness check before any capacity change

**What was found:** the single-task `blackout-production-market-worker` service (sole owner of live
Polygon/UW WebSocket ingestion) runs CPU-pinned at 99.6-99.9% for extended stretches during RTH,
with no registered autoscaling target. A vertical scale (raise task-level `cpu`, keep
`desiredCount=1`) is the safe remediation; a horizontal scale (autoscaling to N>1 replicas) carries
a real, unverified correctness risk (duplicate WS subscriptions if the ingestion code isn't built
for multi-replica coordination) — see
`docs/audit/findings-staging/2026-09-04-market-worker-cpu-pinned-no-scaling.md` for the full
analysis. Not executed this pass.

**Check at the open:** if a fix has been applied, confirm `AWS/ECS` `CPUUtilization` for
market-worker shows real headroom during RTH, and confirm live-data freshness (WS ingestion lag)
did not regress. If not yet applied, this item stays open.

### 12. RTH ALB tail latency + real 5xx (`vector-pick-sweep` lock TTL + UW-sweep-concurrency) — PR #3411 + PR #3479 (both merged, NEITHER validated under a live RTH tape yet)

**What was broken:** `AWS/ApplicationELB` `TargetResponseTime` on `blackout-production-app`'s
target group showed p50 healthy (0.03-1.1s) but p99/Max climbing sharply and staying high across
nearly every RTH minute — not isolated bursts — with Max repeatedly landing 95-119s, within
seconds of the ALB's 120s `idle_timeout`. Two independent, previously-shipped fixes target this:
`vector-pick-sweep`'s cross-replica overlap lock TTL (480s) was shorter than real observed sweep
runtime (up to 693684ms), so the lock could expire mid-sweep and let a second sweep start while the
first was still running (#3411, TTL raised to 900s); separately, even a single non-overlapping run
of any of 4 crons (`vector-pick-sweep`, `vector-dark-pool-warm`, `vector-full-state-snapshot`,
`bie-full-state-snapshot`) could occupy both of the shared cluster-wide UW rate limiter's ~2
concurrency slots continuously for up to ~5 minutes, racing live member requests for the same slots
the whole time (#3479, added `runWithBackgroundUwSweep()`/`reserveForLiveTraffic()` so a tagged
background sweep can never claim the last slot). Full root-cause detail in both PRs' own
findings-staging entries: `docs/audit/findings-staging/2026-09-03-vector-pick-sweep-lock-ttl-shorter-than-runtime.md`
and `docs/audit/findings-staging/2026-09-04-uw-sweep-concurrency-starves-live-traffic.md`.

**Why this item exists separately from those two entries:** neither fix's own "Check at the open"
step ever made it into this WATCH LIST — a genuine gap in the pipeline the FULL-LIFECYCLE mandate
above is meant to close. This entry closes it, and adds independent re-confirmation gathered
2026-09-04 (pre-open) specifically re-measuring the ORIGINAL (pre-#3479) RTH session named in that
finding, rather than taking its numbers on faith:
- Re-pulled 1-minute-granularity `TargetResponseTime` (p50/p90/p99/Max) + `HTTPCode_*_5XX_Count` for
  the FULL 2026-09-03 RTH session (13:00-20:29 UTC): Max ≥95s in **49/450 minutes (11%)** of the
  session, p99 across the day p50=14.3s/p90=50.2s, while p50 stayed 0.03-1.1s throughout — confirms
  the tail-latency shape (not a fleet-capacity problem) persisted across the WHOLE session, not a
  handful of windows. Total 5xx in this RTH-only window: **105 ELB-5xx + 82 target-5xx over 101807
  requests** — matching the original finding's 24h total of 105 ELB-5xx almost exactly, meaning
  essentially every ELB-5xx that day happened DURING RTH, consistent with a market-hours-only-cron
  driven mechanism rather than general traffic volume.
- Ruled out an ECS rolling deploy as the driver of the worst 5xx cluster (17:04-17:11 UTC, 45
  ELB-5xx in 8 minutes): `HealthyHostCount`/`UnHealthyHostCount` on the target group stayed pinned
  at 8/0 for the ENTIRE RTH session — no target ever deregistered, so deploy churn is excluded.
- Checked raw per-task `AWS/ECS` `CPUUtilization` Max at 1-minute resolution against 5xx
  occurrence: weak, not the primary driver — `cpu_max` during the 93 minutes carrying any 5xx
  averaged 77.2%, barely above the day-wide p50 of 78.0% (day-wide p90 89.7%, p99 94.1%); CPU was
  hot most of the RTH day regardless of whether a 5xx fired that minute.
- Independently reproduced the exact overlap `CloudWatch Logs /ecs/blackout-production` `elapsed=`
  timestamps #3479's own commit message cites for the worst cluster: `vector-pick-sweep` "done"
  lines at 17:06:52 (elapsed=693684ms, i.e. started ~16:55) and 17:09:31 (elapsed=252495ms, started
  ~17:05:16) — a second sweep starting and finishing while the first was still in flight, landing
  squarely inside the 17:04-17:11 UTC 5xx cluster — plus dense concurrent completions from
  `zerodte-warm` (elapsed=212590ms), `vector-dark-pool-warm` (elapsed=173224ms, `failed=12`), and
  `bie-full-state-snapshot` (elapsed=162304ms) in the same 8-minute window.

**Why this is still unvalidated:** #3411 merged 2026-09-03 20:08 UTC — at the very TAIL of the RTH
session the evidence above measures (RTH closes 20:00 UTC), so it had essentially no chance to
affect that session's numbers. #3479 merged 2026-09-04 03:38 UTC — AFTER that RTH session closed
and BEFORE today's (2026-09-04) open. **Today's open is the first live RTH tape either fix has
run against.**

**Check at the open:** re-pull the same three series (`TargetResponseTime` p99/Max 1-min, both
`HTTPCode_*_5XX_Count`, `HealthyHostCount`) for TODAY's RTH session and compare directly against
the 2026-09-03 baseline above — expect Max to no longer sit repeatedly at 95-119s and the ≥95s
minute-share to drop well below 11%, and `HTTPCode_ELB_5XX_Count` to drop well below the ~105/day
baseline. Also grep `elapsed=` for `vector-pick-sweep`/`vector-dark-pool-warm`/
`vector-full-state-snapshot`/`bie-full-state-snapshot` and confirm no two "done" lines for the SAME
cron key ever overlap in wall-clock time (start-of-run = done-timestamp minus `elapsed=`). **If the
pattern is materially unchanged**, that does not necessarily mean the fix is broken — it may mean a
DIFFERENT cron is now the dominant contributor: `zerodte-warm` (212590ms in the same worst window
above) does NOT appear to route through `uw-rate-limiter.ts` anywhere in its reachable dependency
tree (`src/lib/zerodte/scan.ts`, `src/lib/platform/zerodte-service.ts` — no `runWithBackgroundUwSweep`
wiring, unlike the other four), so it was NOT covered by #3479 and is not yet confirmed either way;
it already carries its own overlap guard (900s TTL, #3502-era fix) but not a UW/Polygon budget
reservation. Flagged here as a candidate follow-up, not a confirmed cause — its long runtime is more
likely dominated by Polygon calls or general compute than the UW ceiling #3479 fixed, and that would
need its own measurement before a fix is warranted, per this file's own "never fix from a guess"
standing method.

### 18. Meridian earnings detail header — title overlapped the SUMMARY tab pill on tablet/mobile — PR #3563 (merged, branch `fix/meridian-earnings-header-tab-overlap`)

**What was broken:** `.meridian-detail-head-v2` (the `<header>` row pairing the earnings event
title with the SUMMARY/REPORT/ESTIMATES/POSITIONING/HISTORY tab strip in
`MeridianEventDetailPanel.tsx`) had no `flex-wrap` of its own while its title child
(`.meridian-detail-title-v2`) IS `flex-wrap: wrap` by design. At >=1440px the title fits on one
line and nothing overlaps; at 1024px and 430px the title wraps to 2-3 lines, the row grows tall,
and `align-items: center` centered the still-single-line tab strip vertically against that tall
block — landing the tail of the title ("earnings", right after the "EARNINGS · HIGH IMPACT"
kicker) directly on top of the SUMMARY pill's left half. Reproduced on every one of the desk's
~131 live earnings events, on both tablet and mobile, regardless of which tab was active.

**Fix:** added `flex-wrap: wrap` to `.meridian-detail-head-v2` so the tab strip drops to its own
row once it no longer fits beside the title, instead of being squeezed onto the same nowrap line
and centered into the middle of the wrapped text. `.meridian-earnings-tablist`'s own
`flex-wrap: nowrap` (keeps the five tab pills on one row) is untouched. Full root-cause detail:
`docs/audit/findings-staging/2026-09-04-meridian-earnings-detail-header-tab-overlap.md`.

**Check at the open:** open any live earnings event's detail on `/meridian` at both 1024px and
430px viewports (or via `proxy-browser.cjs` against production) and confirm the h2 title and the
SUMMARY/REPORT/ESTIMATES/POSITIONING/HISTORY tab strip render on visually separate lines with no
overlapping glyphs, across at least 2-3 different real earnings events (title length varies by
ticker/company name, and this defect is title-length-and-viewport-width dependent) — this could
only be confirmed pre-open against static/cached data; the specific value of re-checking at the
open is seeing it against the FULL, currently-live set of ~131 earnings events (including any that
rolled onto/off the calendar overnight) rather than the handful captured in the original finding's
screenshots. Also spot-check that the >=1440px desktop rendering is visually unchanged (title and
tab strip still share one row) — the fix should be a no-op at that width.

### 17. Helix print tape signal badges hard-clipped mid-character in FULL columns — PR #3558 (merged, branch `fix/helix-signals-badge-clip`)

**What was broken:** the `/flows` print tape's Signals cell (`.helix-tape-cell--signals`, FULL
columns density, desktop with the analytics sidebar hidden) rendered `signals.slice(0, 3)` — a raw
badge-count cap with no notion of pixel width — inside a `flex-nowrap overflow-hidden` box with no
scroll or wrap anywhere in its ancestor chain. On a real row carrying 4 signals (STACK / NEW 4.2× /
REPEAT / a 4th collapsed into `+1`), only STACK and NEW 4.2× rendered whole; REPEAT painted as a
single clipped `R`, and the `+1` overflow chip was present in the DOM's text but never visually
painted at all — full write-up in
`docs/audit/findings-staging/2026-09-04-helix-tape-signal-badge-clip.md`.

**Fix:** new `fitSignalBadges()` (`src/features/helix/lib/helix-signal-fit.ts`) estimates each
badge's real width from its label and shows only the priority-ordered PREFIX that actually fits the
column's floor width, with a correctly-sized `+N` chip reserved for whatever is dropped — so the row
never emits more markup than the 116px cell can paint. Code-level fix only; nothing here depends on
a live measurement, so this item is about confirming it under real tape volume/variety, not about
proving the fix exists.

**Check at the open:** on `/flows` in FULL columns density (desktop, hide the analytics sidebar),
watch a real RTH tape for rows carrying 3+ signals (STACK/WHALE prints with a fresh NEW badge and a
REPEAT rule are the most likely combo) and confirm every visible badge renders whole — no clipped
glyphs — and that whenever badges are hidden, a legible `+N` chip is visible summarizing them (never
a phantom count that never paints). Also worth a spot-check at a narrower desktop width (browser
window resized down, still above the mobile breakpoint) since the fix budgets against the column's
CSS floor specifically to stay safe there.

### 16. Vector desk mobile chart collapse — PR #3556 (pending, branch `fix/vector-mobile-chart-collapse`)

**What was broken:** the standalone `/vector` desk's price chart (candles + wall overlay + volume
pane) never rendered below the 1280px desktop breakpoint — present in the DOM, laid out with a
real 320px `min-height` floor on its own canvas element, but clipped to nothing by an ancestor
chain (`.vector-chart-terminal-chart` → `.vector-chart-wrap` → `.vector-chart-stage`) that
computed to a literal 0px box on every phone/tablet width, because the flex-fill technique those
three carried unconditionally (`flex: 1 1 0; min-height: 0;`) only resolves correctly when some
ancestor up the chain has a DEFINITE height to distribute — true only from 1280px up. Independently
reproduced live 2026-09-04 (fresh temp Clerk session, `proxy-browser.cjs` at 430x932): full-page
capture showed header → Live Helix → 0DTE Matrix → SCALP play card → SPX Plays, no chart anywhere;
a DOM probe measured `.vector-chart-canvas` at h=320 while all three ancestors measured h=0,
unchanged after a 30s settle (ruling out a data/timing race). Full evidence and root cause in
`docs/audit/findings-staging/2026-09-04-vector-mobile-chart-collapse.md`.

**Fix:** scoped the `flex: 1 1 0; min-height: 0;` triple to the existing `@media (min-width: 1280px)`
block (byte-identical to what the base rule used to carry, so desktop's resolved CSS is unchanged);
the base/mobile rule now lets the default `flex: 0 1 auto` + `min-height: auto` apply, so the chart
column sizes to its own content (the canvas's 320px floor) instead of forcing itself to zero. No JS
change — `VectorChart.tsx`'s existing `ResizeObserver` autosize nudge was already correctly wired to
react once the container gets a real size.

**Check at the open:** this fix was built and verified entirely OFF-HOURS (market closed, "Session
closed" shown on Live Helix) — the chart's underlying data feed (live bars, wall overlay, SSE
ticks) has not been seen rendering into the now-fixed layout under a moving RTH tape. Load
`/vector` on a phone (or a <1280px-wide window) once the market is open and confirm: (1) the
candle chart renders above the fold, between the ticker-chip row and the Live Helix card, with
visible candles/wall beads and a volume sub-pane, matching the desktop layout's content
(no longer just absent); (2) it stays correctly sized and does not clip/collapse again as live bars
stream in and the chart's content height changes; (3) the desktop (>=1280px) layout is pixel-for-pixel
unchanged from before this fix — this was verified via CSS-cascade inspection and existing
regression tests (`vector-chart-viewport.test.ts`) but not via a fresh live desktop screenshot,
since the fix's own scope was mobile-only.

### 14b. Legacy→Swing promotion dte<5 dual-admission — PR pending (`fix/legacy-swing-dte-floor`)

**What was broken:** Legacy morning-confirm promotions could land on the Swing board with a picked
contract at dte 3–4 while `HORIZONS.SWING.dteMin` is 5 — the same dual-admission overlap the
2026-08-06 horizons widening closed for organic discovery, but via a second code path
(`legacy-confirm-promote.ts`).

**Fix:** filter chain rows to `[SWING.dteMin, SWING.dteMax]` before fan-out; dossier `intendedDte`
derives from the picked contract's actual DTE (not a hardcoded 14).

**Check at the open:** after a Legacy morning-confirm cycle, inspect `/nighthawk` Swings lane (or
`GET /api/market/nighthawk/horizons`) for any `signalKinds` containing `NIGHT HAWK` — every such
row's `contract.dte` must be ≥ 5 and `subLane` must match `subLaneForDte(contract.dte)`.

### 14. Night Hawk mobile 430x932 — view-tab row overlapped the theme-toggle pill — PR pending (branch `fix/nighthawk-legacy-tab-toggle-overlap`)

**What was broken:** live `/nighthawk` at 430x932 (both default and analytics-expanded states):
the 5-tab view switcher's "Legacy" tab visually overlapped the adjacent dark/light theme-toggle
pill — the "L" of "LIGHT" and the moon icon rendered on top of the tail of "Legacy" ("...gacy")
instead of the row wrapping, truncating, or scrolling. `.nh-v2-page .ios-native-segment` had no
`overflow-x`/`flex-wrap`, so once VECTOR became the row's 5th tab, the five content-width
(`flex: 0 0 auto`) tab buttons' combined width could exceed the box the flex algorithm assigned
the segment (its `min-w-0 flex-1 shrink` classes remove the default min-content floor so it can be
squeezed below its content width) — the excess used the CSS-default `overflow: visible` and
painted past the segment's edge, landing on the theme toggle, which paints after it in DOM order.

**Fix:** `.nh-v2-page .ios-native-segment` now scrolls horizontally
(`overflow-x: auto; overflow-y: hidden; overscroll-behavior-x: contain;
-webkit-overflow-scrolling: touch; scrollbar-width: none;` + a hidden `::-webkit-scrollbar`) —
the same pattern `.nh-history-tablewrap` already uses elsewhere in the desk — instead of leaving
the overflow unclipped. `.ios-native-segment-btn` is unchanged (`flex: 0 0 auto` stays; tabs must
not squash/truncate).

**Check at the open:** on live `/nighthawk` at 430x932 (`proxy-browser.cjs`), confirm the view-tab
row (0DTE/Swings/Bangers/Vector/Legacy) no longer paints "Legacy" (or any tab) through the theme
toggle in either the default or analytics-expanded state, and that swiping/scrolling the tab row
horizontally reveals the full "Legacy" label with the theme toggle staying put, fully legible, at
its own fixed position to the row's right. Also spot-check desktop width (≥1440px) is visually
unchanged — the fix is a CSS overflow behavior change with no effect once the row already fits.

### 13. Vector chart volume-pane "SPY vol" watermark overlapped the first x-axis tick — PR pending (branch `fix/vector-volume-pane-label-overlap`)

**What was broken:** the volume sub-pane's "SPY vol" watermark label (`VectorChart.tsx`,
bottom-left corner of the chart stage, just above the x-axis) was a plain transparent `<p>` with no
background, sitting in the same screen band as the chart's own canvas-drawn x-axis time-tick labels
at the left edge. Live pixel-zoomed capture of `/vector` (desktop 1440×900) showed it painting
directly over the first tick ("19:00"), producing garbled interleaved text. Two sibling labels a few
lines below it in the same file (the "◇ dim = modeled" honesty label and the GEX-scope
"spot-aligned" chip) already had this exact overlap class fixed on 2026-08-23 (opaque
`bg-black/70 backdrop-blur-sm` pill) — this third label was simply missed at the time because it
sits on the opposite corner and the earlier fix was validated on mobile, where this collision does
not occur (it's a desktop-width-only overlap).

**Fix:** gave the "SPY vol" label the same `rounded bg-black/70 px-1.5 py-0.5 backdrop-blur-sm`
opaque-pill treatment as its two siblings, position unchanged (`bottom-2 left-2`). Deliberately did
NOT add the siblings' `max-w-[42%] truncate` width guard — that guard protects variable-length,
right-anchored text from overrunning the chart's right edge, which doesn't apply to this label's
short, static text.

**Check at the open, live tape, desktop viewport:** open `/vector` at 1440×900 (or wider) and look
at the volume sub-pane's bottom-left corner. Confirm "SPY vol" reads cleanly on its own opaque pill
with the first x-axis time tick (whatever time it now shows, live) visible and legible either beside
or behind the pill — not interleaved into garbled combined text. Check across a few different zoom/
pan states, since tick positions move with the visible time range and the original bug's window
(the label colliding with whichever tick happens to land at the left edge) is a function of viewport
width and time-range, not a single fixed state. Also spot-check mobile (430×932) to confirm the fix
didn't regress the already-working sibling labels' layout there.

### 20. Helix `/flows` mobile print card showed a bare negative DTE for an already-expired print — PR #3561 (merged, branch `fix/helix-mobile-card-expired-dte`)

**What was broken:** the mobile print card (`HelixMobileFlowTape.tsx`) computed
`dte = flow.dte ?? daysToExpiry(flow.expiry)` and only special-cased `dte === 0` (0DTE, ember
badge + hidden bare-number segment). UW's own `dte` field goes negative for a print reported after
its contract's expiry has already passed (an observed, not hypothetical, feed value — see
`helix-flow-format.ts`'s `fmtIv` doc comment for a live `dte: -1` example) and that raw value is
what usually reaches the card, since the clamped `daysToExpiry()` fallback only runs when
`flow.dte` itself is null. So an already-expired print rendered a bare `"-1d"` in the exact same
plain styling as an ordinary future DTE like `"32d"`, with none of the visual urgency same-day
(0DTE) prints get from their highlighted treatment one row up. The desktop table
(`HelixFlowTable.tsx`) has the identical root-cause pattern at its own `dte`/`is0dte` computation
and DTE table cell — deliberately left unfixed in this PR (out of this finding's stated scope,
flagged as a follow-up) but worth checking too.

**Fix:** added `dtePrintLabel(dte)` (exported pure helper next to the mobile card component,
following this repo's `ExpiryConcentration.tsx` pattern of testing a card's display logic directly)
that returns `{ text: "EXPIRED", expired: true }` for `dte < 0` and `{ text: "${dte}d", expired:
false }` otherwise; the card now renders `dteLabel.text` with an ember/bold treatment when
`expired`, matching the sibling 0DTE badge's ember tone, instead of the raw negative number. The
`!is0dte` gate that hides the whole DTE segment for 0DTE prints is unchanged.

**Check at the open, live tape, mobile viewport (430×932):** open `/flows` on mobile and watch for
any print whose expiry has just passed intraday (or catch a stale/late print against a prior day's
expiry, which is the scenario the original evidence captured — `09/03/26 · -1d` observed the day
after that expiry). Confirm the card shows `EXPIRED` in the highlighted ember/bold treatment, never
a bare negative number like `-1d`/`-2d`. Also confirm ordinary future-dated prints on the same tape
are unaffected (still plain `"<n>d"`) and that a genuine same-day 0DTE print still hides the DTE
segment and shows its own "0DTE" badge unchanged — this fix must not have touched that branch.

### 15. Night Hawk mobile play-history table's P&L column was scrolled off-screen — PR pending (branch `fix/nighthawk-mobile-pnl-column-offscreen`)

**What was broken:** the expanded Session Analytics panel's play-history table renders 6 columns
(Date, Ticker, Dir, Tier, Outcome, P&L) inside `.nh-history-tablewrap` — `overflow-x-auto` around a
`min-w-[440px]` table — which overflows a 430px phone's card width. The overflow clip always eats
the rightmost column first, and P&L was last, so it required an extra horizontal swipe to see even
though `globals.css`'s own comment calls it "the single most-scanned value in this table."

**Fix:** reordered columns to Date, Ticker, **P&L**, Dir, Tier, Outcome (P&L moved from 6th to 3rd,
right after Ticker) — pure JSX reorder, no CSS/data change. See
`docs/audit/findings-staging/2026-09-04-nighthawk-history-pnl-column-mobile-offscreen.md`.

**Check at the open:** on `/nighthawk` (`proxy-browser.cjs`, 430×932 mobile viewport), open Session
Analytics, expand a session with graded plays, and confirm the P&L value for each row is visible
in the table WITHOUT any horizontal swipe — it should render as the 3rd visible column right after
the ticker, still tone-colored (green/red/amber) and bold. Also confirm Dir/Tier/Outcome are still
reachable (now via swipe or the row's existing tap-to-expand drawer) and that desktop/tablet
rendering (where the table already fit) is visually unchanged.

### 21. `thermal-discord` cron logging "Fontconfig error: No writable cache directories" every ~15-30min RTH — PR #3571 (merged, branch `fix/thermal-discord-fontconfig-cache-dir`)

**What was broken:** CloudWatch showed 72 occurrences/24h of the bare stderr line `Fontconfig
error: No writable cache directories`, clustered in groups of exactly 4, RTH-only, on the
`thermal-discord` cron's own ~15-30min cadence. `renderThermalDiscordCardPng` rasterises its SVG
through `sharp(svg).png()` (librsvg, a real fontconfig client), and the ECS runtime user (`nextjs`,
created without `-m` in `deploy/Dockerfile`) has no home directory and no `$XDG_CACHE_HOME`, so
fontconfig had nowhere writable to persist its cache and rebuilt it from scratch on every single
cold render — silent (nothing threw, the same cron logged success right around these lines), but a
real per-invocation latency tax.

**Fix:** `ensureFontconfigCacheDir()` in `src/lib/thermal-discord-card.ts`, called before the
`sharp()` call, points `XDG_CACHE_HOME` at a writable dir under `os.tmpdir()` (Fargate ephemeral
`/tmp`) once per process and creates it if needed, so fontconfig can keep a warm cache across
renders within one task's lifetime. Never overrides an operator-supplied `XDG_CACHE_HOME`. See
`docs/audit/findings-staging/2026-09-04-thermal-discord-fontconfig-cache-dir.md` for the full root
cause (including the exact Dockerfile lines) and the infra-level follow-up this code-level fix
deliberately does not attempt.

**Check at the open:** CloudWatch Logs Insights, `/ecs/blackout-production`, same 24h-window query
(`fields @timestamp, @message | filter @message like /Fontconfig error/`) run AFTER this deploys —
confirm the line's occurrence count drops to (ideally) zero, or at minimum to once per task
lifetime instead of once per cron firing, since the fix only makes the cache warm-reusable within a
task, not eliminate the very first cold render after a fresh deploy/task start. Also spot-check that
`thermal-discord` embeds still post normally to Discord during RTH (unaffected functionally either
way, but confirm the fix didn't introduce a regression) via the admin cron-health board or the
Discord channel itself.

### 19. Vector SPX PLAYS card's off-hours loading copy read as a stalled live scan — PR #3566 (merged, branch `fix/vector-contract-picks-closed-market-loading`)

**What was broken:** a discovery-pass finding reported the mobile `/vector` contract-picks card
("PLYS · SPX PLAYS · loading" / "Scanning the chain for a contract worth showing…") appearing
identically across 3 captures ~10 minutes apart, all off-hours, never resolving — unlike the
adjacent Live Helix panel, which shows an honest "Session closed — Live Helix resumes at the open"
once it has nothing to show. Independently reproduced live 2026-09-04 (temp Clerk session,
`proxy-browser.cjs`, 430×932, pre-open ~06:47-06:54 AM ET): the "never resolving" framing did NOT
hold literally — 2 of 3 fresh page loads resolved to real, populated picks within the capture's own
wait window (6-20s), and the 3rd (also 6s wait) reproduced the exact reported stuck-looking state.
So the fetch genuinely runs off-hours and genuinely can resolve with real last-session picks, but
resolution time off-hours is variable and can run past what a member reasonably waits, and the copy
gave no signal the delay was expected — read stuck/broken exactly as the discovery pass described,
even though it wasn't literally permanent. Full evidence, the "why not just copy Helix's exact
pattern" reasoning (it would hide real off-hours content this card is designed to still show), and
root cause in `docs/audit/findings-staging/2026-09-04-vector-contract-picks-closed-market-loading-copy.md`.

**Fix:** added an optional `liveSession` prop to `VectorContractPicksCard` (default `true`) and
branched ONLY the loading-state body copy on it — unchanged live-session wording, vs "Session
closed — resolving the last session's chain scan (can take longer off-hours)…" when closed. The
fetch itself, its timing, and every other state (populated picks, "no contract cleared the bar",
pivot-wait) are untouched. Wired through both real call sites (`VectorPageShell.tsx`,
`VectorComparePlayStrip.tsx`).

**Check at the open:** this fix was built and verified entirely OFF-HOURS. Once the market is open,
confirm on `/vector` (`proxy-browser.cjs`, 430×932 mobile, and desktop) that: (1) the loading state,
if seen at all during RTH, still shows the ORIGINAL "Scanning the chain for a contract worth
showing…" copy (not the closed-market variant) — `liveSession` should read `true` throughout RTH;
(2) real contract picks still populate normally once a play exists, at the same cadence as before
this PR (this fix must not have changed fetch timing, only closed-market copy); (3) re-check the
card off-hours AFTER today's close and confirm the closed-market copy now appears instead of the
bare "Scanning the chain…" sentence when the loading state is hit.

### 22. `db.ts` checked-out pool clients had no `'error'` listener — raw `uncaughtException` on connection drop — PR #3570 (merged, branch `fix/db-transaction-raw-client-uncaught`)

**What was broken:** one live CloudWatch `uncaughtException: [Error: Connection terminated
unexpectedly]` in a 24h window, despite `db.ts` already routing essentially every query through
`dbQuery`'s try/catch+retry and already carrying a `livePool.on("error", ...)` handler for idle
pooled clients. Root cause was NOT a missing try/catch (every raw `pool.connect()` site already had
one) — `pg-pool` removes a client's `'error'` listener for the entire time it's checked out
(`pool.on('error')` only ever covers idle clients), and `pg.Client` emits `'error'` on the client
object itself UNCONDITIONALLY on an unexpected connection drop, separately from rejecting whatever
query happens to be in flight — a promise-based `try/catch` can never intercept that second,
independent emission. See `docs/audit/findings-staging/2026-09-04-db-checked-out-client-error-listener.md`
for the full node-postgres source trace.

**Fix:** added `guardCheckedOutClient()`, attached at all 7 raw `pool.connect()` sites in `db.ts`
(migration advisory lock, `spx_signal_log` dedup transaction, `deleteUserDataForClerkId`,
`dbClient()`, `acquireHeldLock`/`releaseHeldLock`, `insertOpenSpxPlay`, `withSwingRollTx`) —
mirrors the existing pool-level swallow+log convention, scoped to the checked-out-client gap that
convention doesn't reach.

**Check at the open:** this is a backend crash-prevention fix with no UI surface — nothing to
visually confirm on a live desk/board. Instead, pull `/ecs/blackout-production` CloudWatch Logs for
a full RTH session after this deploys and confirm **zero** further raw
`uncaughtException: [Error: Connection terminated unexpectedly]` events, with particular attention
to `spx-evaluate` (holds the SPX-eval advisory lock for its whole run via `acquireHeldLock` — the
longest-held, highest-risk checkout of the 7) and any DB reconnect/blip windows already visible in
RDS/PgBouncer metrics that day.

### 23. `data-integrity-verifier.ts`'s own `ageMin()` read a future-dated timestamp as trustworthy — PR pending (branch `fix/data-integrity-verifier-future-timestamps`)

**What was broken:** the shared `ageMin(thenMs, now)` helper every freshness check in
`data-integrity-verifier.ts` goes through (Postgres `flow_alerts`/`cron_job_runs` latest-row age,
the Redis GEX matrix `asof` age, and the writer target-freshness reconciliation that suppresses a
stale `failed` cron handshake row) computed a plain `(now - thenMs) / 60_000` with no guard for
`thenMs` being in the future. A future-dated row (cross-process clock skew, or a corrupted/
miswritten timestamp) produced a NEGATIVE age, which trivially passes every `aMin <= threshold`
freshness check in the file — this is the DATA-CORRECTNESS AUDITOR's own core age computation, so
being blind to this exact corruption shape undermines the surface whose entire job is to catch it
(see the file's own "HONESTY" comment: "Nothing here is a false green"). Same bug shape as 16+
sites already fixed this session (SPX Slayer #3423, coaching alerts #3442, GEX heatmap cache
#3481, GEX heatmap context editions #3573, Helix flow-anomaly banner #3559, …) — found by sweeping
for un-guarded `Date.now() - <timestamp>` age comparisons per the standing mandate's named angle 2.

**Fix:** `ageMin()` now returns `Infinity` (the SAME sentinel this file already uses for a NaN/
unparseable timestamp) when `thenMs` is more than `ZERODTE_MARK_FUTURE_TOLERANCE_MS` (60s — the
same constant SPX Slayer's #3423 fix uses for this identical shape) ahead of `now`, so a future-
dated row now surfaces as a FLAG instead of a silent PASS. The one inline duplicate of this same
calculation (the writer target-freshness check, `targetFreshDespiteFailedHandshake`) was rewired to
call the now-guarded `ageMin()` instead of re-deriving its own unguarded copy, closing all 4 call
sites in the file at once rather than one at a time.

**Check at the open:** this is an audit-tooling correctness fix with no member-facing UI surface —
nothing to visually confirm on a live desk/board. Instead, confirm the `data-correctness` cron
(`GET /api/cron/data-correctness`) still reports its DATALAYER scorecard normally during RTH (no
new unexpected FLAGs — a genuine future-dated row should now show as a FLAG where previously it
would have silently PASSED, so a new FLAG here is the fix working as intended, not a regression).

---

## WATCH LIST — HELIX, first session on 2026-08-24 (read this before the routine pass)

**Every item below is a HELIX fix merged over 2026-08-22/23 that has not been seen under a moving
tape.** The list IS the count — a hand-maintained total in this paragraph drifted out of date within
a day and has been removed rather than re-synced, which is the same one-source-of-truth problem
several of the fixes below are about.

§5k is the highest-impact item and should be checked first — its **parse half is now live-validated
off-hours (2026-08-23) and needs no re-run**; what remains there is the consequence, which only a
moving tape can show.

**What HAS been validated off-hours, so nobody re-runs it:** the `/flows` UI audit passes both
viewports on the deployed build (`OVERALL: PASS`, `EXIT=0`, deploy `f0e7b791`), which confirms the
panels render, the expiry buckets file expired prints under `0DTE`, the NEW badges agree with their
own columns, and the signal-coverage note correctly stays quiet at 5000/5000 eligible. All four
HELIX Largo tools are COMPLETE against a proven control, so no payload exceeds the 16k tool-result
cap. See `RUN-LOG.md`. **What that does NOT cover is anything needing live flow** — both radars are
empty off-hours, so every populated-state assertion below is still owed.

This section is the list of things that are *only* checkable at the open, with the baseline each one
must be diffed against.

**Run the whole list, then the routine pass.** Order matters only for step 0.

> **#2723 EXPIRED THREE OF THE CRITERIA BELOW — the sweep is done, do not redo it, and do not
> extend it (2026-08-23).** §5k, §5f and §5c were each correct when written, each written against
> the pre-#2723 population, and each now returns a **wrong verdict** rather than a stale note: two
> false failures and one false alarm. All three are rewritten in place with the measurement that
> retired them.
>
> **The boundary is exact, and was checked rather than assumed.** #2723 changed which rows carry a
> **print time**, so the checks that expired are precisely the ones gated on *time*-eligibility.
> §5h and §5j also reference §4A and the writer groups, and **both remain correct**: they depend on
> **aggressor-side coverage** (`ask_pct`), which #2723 did not touch — measured unchanged at
> **1454/1500 Group A and 0/3500 Group B**, the exact figures §5h already quotes. §5b, §5d, §5e,
> §5g and §5i carry no population dependency at all. **Do not "correct" §5h or §5j to match; they
> are not stale.**
>
> The rule worth carrying forward: **when a fix changes a POPULATION, every check written against
> the old one is a false verdict waiting to fire** — not a stale note, a wrong answer delivered
> confidently on the morning you most need the runbook to be right. Sweep them together, on one
> body of evidence, and record which checks you verified were NOT affected — otherwise the next
> reader re-sweeps, or worse, "fixes" the ones that were fine.

### 0. FIRST — prove the deploy actually carries these, before measuring anything

The single most expensive mistake available here: measuring a pre-fix bundle and reporting correct
fixes as broken. It has already cost this repo an hour once (2026-08-12) and nearly again on
2026-08-23.

```bash
export PATH=/opt/node20/bin:$PATH
node scripts/audit/deploy-freshness.mjs --since=12h
# then confirm the RUN COMPLETED — freshness only says a run was CREATED:
#   gh/API: actions/workflows/ecr-push-production.yml/runs  -> status=completed conclusion=success
```

A deploy here is **~1 hour end-to-end** (24 min runner queue + 5 min build + 26 min ECS roll +
worker roll). Confirm by **ancestry**, not by timestamp:

```bash
git merge-base --is-ancestor <fix-sha> <deployed-head-sha> && echo IN || echo NOT-IN
```

The six SHAs to check are the merge commits of **#2647 (§9.8)**, **#2669 (§9.4)**, **#2670 (§9.3)**,
**#2673 (§9.5)**, **#2680 (§9.10)** and — if merged by then — **#2681 (§9.0)**.

### 0b. THEN run the gate — the binary claims, executable

```bash
env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY \
  node --import tsx scripts/audit/helix-market-open-check.mjs
```

Seven rows, each printing its **expectation** beside what it measured, rolled up to
GREEN / AMBER / RED / HARNESS. It exits non-zero on RED **or HARNESS** — something that could not be
measured is not a pass.

**Why this exists, and what it is not.** On 2026-08-23 three criteria in this very document were
found to have INVERTED — §5k told the reader to expect a jump where the measurement falls, §5f
required a marker no row can render, §5c diagnosed a regression that had not happened. Each was
correct when written, each was retired by a later fix, and **not one of them failed**. They could
not: they were prose, and prose does not run. Two of the three would have produced a **false
failure on a working deploy.** The gate is those claims restated so they CAN fail.

It is **not** a replacement for this list. It covers only what is binary; everything needing a
moving tape — both radars populated, §5h's horizon colours, §5j's badge count — is still owed to the
sections below, and the gate says so in its own output rather than implying coverage it lacks.

- **GREEN on all seven** means the parse, the eligibility denominator, the writer split, Group A
  aggressor coverage, the IV units and the expiry bucketing are all where they were measured today.
  Start the RTH-only work below.
- **RED** names the expectation it violated. Read that row before anything else — a red here means a
  baseline this whole list rests on has moved.
- **HARNESS** means a sub-harness could not run. That is **not** a product verdict and must not be
  recorded as one; re-run it directly to see why.
- **AMBER** is measured-and-legitimately-not-a-pass. §5l is AMBER whenever the dark-pool feed reports
  no side, which is its normal state — read the note, do not open a finding.

### 1. §9.5 — VALIDATED off-hours 2026-08-23; re-check under the RTH population (#2673)

`bucketLabel` tested `dte === 0` exactly, so already-expired prints (negative `dte`) fell through to
`dte <= 7` and were filed under **"This week"** — a future horizon for a contract that has expired.

- **Pre-fix baseline:** 803 of 5000 rows (**16.1%**) carry a negative `dte`.
- **Measured 2026-08-23 (closed):** 801 of 5000 (**16.0%**), `dte === 0`: **zero**, top names
  `SPY:250 · TSLA:59 · QQQ:57 · SPXW:54`.
- **Validated 2026-08-23 post-deploy:** all four buckets matched the rendered tape exactly —
  `0DTE 11/11 · This week 18/18 · Monthly 140/140 · LEAPS 331/331`. Pre-fix "This week" would
  have read 29.
- **What is still open at the open:** the 0DTE bucket carries those rows and **"This week" no
  longer does**, During RTH the population changes shape — genuinely-0DTE contracts appear
  (`dte === 0`, which did not exist at all in the closed window) alongside the expired ones. **That
  mix is the case nobody has seen**, and it is the case where a wrong bucket is most visible.

### 2. §9.10 — VALIDATED off-hours 2026-08-23; re-check the word/`—` mix under RTH (#2680)

The column headed **Rule** substituted `flow.route` — our own premium/tenor bucket — where UW
reported no rule.

- **Pre-fix baseline, 500 rendered rows:** `stock:271 · whale:126 · REPEAT:99 · FLOOR:3 · SWEEP:1`
  — **397 of 500 (79.4%)** showing an internal bucket name.
- **Validated 2026-08-23 post-deploy:** `—:397 · REPEAT:99 · FLOOR:3 · SWEEP:1`. Zero `stock`,
  `whale` or `0dte`, and the 103 real rule words preserved exactly.
- **Why RTH matters:** under a live tape the rule-carrying feed is much more active, so the *mix*
  shifts toward real words. A run that shows mostly `—` off-hours and mostly words at the open is
  correct in both cases — do not read the shift as a regression.

### 3. §9.3 — flag VALIDATED; the CAP itself is still untested (#2670)

An absent GEX badge meant three different things; only one of them was "the strike is not near a
level". The cap is `clamp(ceil((qualifying) × 0.30), 40, 100)` names.

- **What to check:** rows whose ticker falls **beyond** the cap carry `gex_evaluated: false`, and
  rows inside it carry `true` whether or not a proximity was found.
- **Validated 2026-08-23 post-deploy — the FLAG only.** Present on 5000/5000 rows, **zero absent**,
  split `true 689 / false 4311`. But only **5 of 272** tickers were evaluated, far below the
  `clamp(…, 40, 100)` cap: off-hours the GEX matrices are not rebuilt, so most lookups return empty
  rather than being CUT BY THE CAP. **The cap as a binding constraint is still untested** — that is
  the RTH-only half.
- Off-hours the tape is narrow enough that the cap may not bind at all, so an all-`true` reading
  proves nothing. **Confirm the cap actually bound** (count distinct
  tickers in the payload against the cap) before recording a verdict — an unbound cap is a
  `HARNESS` result, not a PASS.

### 4. §9.0 — the coverage line is VALIDATED; the POPULATED radars are still unseen (#2681)

Both HELIX signals skip every print with no real UW timestamp.

- **Measured 2026-08-23 (closed):** 1500 of 5000 eligible (**30.0%**); **3500 (70.0%) ineligible,
  spanning exactly SPX (3079) and SPY (421)**, ~92% of tape premium.
- **VALIDATED post-deploy 2026-08-23** — the empty-state line renders verbatim: *"Scanned 103 of 500
  prints — 397 (SPX, SPY) carry no reported print time and cannot be scanned for this signal."*
  Note **103 of 500**, not the 30% measured over the 5000-row API window: the panel reads the
  RENDERED page. A percentage is only meaningful with the population it was taken over.
- **Still to check:** `get_helix_derived` carries a non-zero `signal_ineligible_prints` naming
  SPX/SPY, and the line renders in the **populated** state too.
- **The part that has never been seen:** off-hours both radars are **empty**, so only the empty-state
  line has ever rendered. At the open, spikes and splits actually fire — that is the first time the
  populated-state line renders **beside real entries**, which is the layout most likely to be wrong.
- **Also worth capturing while the tape is live:** whether the eligible fraction stays ~30% under
  RTH. If the index feed's share of prints changes intraday, the coverage number changes with it,
  and that is worth knowing before anyone quotes 30% as a constant.

### 5. §9.8 + §9.4 — already live-validated, but only against a CLOSED tape

Both passed on production 2026-08-23 (`RUN-LOG.md`). Both baselines were taken with the market shut
and are worth re-taking once, because both are population-dependent:

| | validated off-hours | what to re-check at the open |
|---|---|---|
| §9.8 Route Breakdown | `UNREPORTED 95% · REPEAT 4% · FLOOR 0% · SWEEP 0%`, `OTHER` gone | `OTHER` must stay at 0%. The premium-weighted `UNREPORTED` share should FALL as the rule-carrying feed wakes up — a fall is health, not regression |
| §9.4 IV column | `median 15% / max 6921%`, 0 unparseable, 4 cells >500% | every cell still a percent or `—`. **The >500% tail should shrink toward zero**: every degenerate solve measured was an *expired* contract, so a live tape should carry far fewer |

That IV tail is also the evidence for an open question — whether degenerate IV should be suppressed,
and whether "expired" is a better gate than any IV threshold. **An RTH reading is the measurement
that decides it**, so capture it rather than just passing the check.

### 5b. NEW-positioning badges — VALIDATED off-hours 2026-08-23; only the RTH mix is left (#2689)

The tape now proves which prints cannot be entirely closing: `size = premium / (fill_price × 100)`
against `open_interest`, with a 1.05 margin. This is the **only genuinely new member-facing signal**
in the batch, so it has no prior baseline to diff against — the check is coherence, not delta.

- **VALIDATED post-deploy 2026-08-23** (deploy `32621010394`): 500 rendered rows, 10 badged, and all
  three criteria passed — **0** badges on a row whose OI reads `—`, **8/8** ratios agreeing with the
  row's own columns, every pill visible rather than collapsed, **10/10** tooltips explaining. One
  real row: `WHALE NEW 5.7× REPEAT` — the badge sits second, ahead of the rule badge.
- **Measured off-hours 2026-08-23:** of 1500 judgeable rows, **220 decisive** (12 at `OI === 0`,
  208 clearing the margin) = 4.4% of the tape, 14.7% of the judgeable population.
- **What to check on screen, per badged row:**
  1. a **NEW** badge never appears on a row whose **OI** column reads `—` (that row was never
     examined; a badge there is fabrication);
  2. the ratio in `NEW ×N` matches the row's own **OI** and **Prem** columns — the badge and the
     columns are derived from the same three numbers and must agree on screen;
  3. the badge is **actually visible**, not collapsed into the `+N` overflow. It is ordered third at
     the latest for exactly this reason, and RTH is when rows carry the most competing badges —
     which is the condition that would expose an ordering mistake.
- **Also check `VectorHelixRail` on `/vector`.** `flowSignals` is shared, so NEW propagates there
  too, and Vector's rail budgets only **2** badges. A whale print with a rule badge may push NEW out
  of view there. That is Vector's display budget, not a HELIX defect — record what it does rather
  than "fixing" it from this lane.
- **The RTH-only question this answers:** off-hours the decisive population is 4.4% of a stale tape.
  Under live flow, opening trades are exactly what a busy session is made of, so **the decisive share
  should RISE**. If it does not, the margin or the OI freshness is worth re-examining.

### 5c. Split Flow direction — a graded prediction that changed definition (#2691)

**The highest-stakes item on this list, and the only one that cannot be checked off-hours at all**
— split flow needs a live 30-minute window, so both radars are empty until the open.

`detectSplitFlow` read direction from option type alone, counting sold calls as bullish premium.
`printBias` — the contract drilldown, on the same page — already read option type **×** aggressor
side. Measured 2026-08-23 over the 1454 rows carrying `ask_pct`: **37 of 83 tickers (44.6%)
sign-flip** between the two rules, and 47.7% of all call premium was SOLD.

**Why this one matters more than a label:** `direction` is persisted and `gradeOutcome` scores it
continued/reversed, so it is a prediction the record grades. Rows before this change were graded
under the old rule.

- **Check on screen:** a ticker showing `▲ BULLISH` must agree with the **contract drilldown's own
  bias** for prints from that ticker. Open one and compare — they now read the same rule, and this
  is the first session where both can be seen populated at once.
- **⚠️ Check the refusal works — REWRITTEN 2026-08-23, because #2723 inverted its conclusion.**
  This bullet used to say: *"If `— UNREAD` dominates a busy tape, `ask_pct` coverage has regressed
  … split flow only ever sees Group A."* **Split flow no longer only sees Group A.** #2723 made the
  whole tape eligible, and Group B carries `ask_pct` on **0 of 3500** rows against Group A's
  **1454 of 1500 (96.9%)**. So `— UNREAD` now dominates *by construction*, and the old text
  diagnoses that as a regression that has not happened.
  Measured off-hours over the same 67-step replay: **`undetermined` is the plurality direction —
  162 of 333 firings (48.6%)** — and **every single index firing is undetermined: SPX 67/67,
  SPY 65/65.** Combined with the saturation in §5k, the two most prominent rows in the Split Flow
  Radar are now **permanently present and permanently unreadable**.
  - **The check that still works:** `— UNREAD` on a **Group A** ticker must be rare. Group A
    coverage is the number that can regress; measure it directly with
    `node --import tsx scripts/audit/helix-tape-inventory.mjs` (`ask_pct`, group-A column) and
    compare against 96.9%. A drop there is a real regression.
  - **`— UNREAD` on SPX or SPY is EXPECTED and is not a defect** — that feed sends no aggressor
    side at all. Do not open a finding for it.
  - **What it costs is a real question and is raised in §6** for the coordinator: whether a signal
    that can never state a direction for a ticker should rank that ticker at the top of a
    direction radar.
- **Check `⇋ MIXED` still occurs.** MIXED (read, genuinely two-sided) and UNREAD (could not read)
  are different facts and must both be reachable. If MIXED never appears, the margin is wrong.
- **Ledger, worth capturing once:** new rows carry `context.direction_basis =
  "aggression_aware_v1"`. Confirm it is present on rows written after the deploy — rows without it
  are the old rule and **must not be pooled** with the new ones in any track-record number.

### 5d. The COORD signal's dark-pool population — RTH-only by construction (#2708)

`FlowFeed` fetched its dark-pool prints with **no `limit`**, taking `/api/market/dark-pool`'s default
of **50**, while `DarkPoolPanel` beside it asks for the API's max of **100**. That population is the
input to the **COORD** badge — the dark-pool-block-plus-options-sweep coincidence search — so the
search ran over half the available prints, by omission rather than decision. Fixed to an explicit
`limit: 100`.

**Cannot be validated off-hours, and the reason is the point.** The whole feed returned **20–40
prints** on the weekend, below even the 50 default, so the cap never binds and the fix changes
nothing observable. Under live volume it binds hard.

- **What to check at the open:** call `/api/market/dark-pool?limit=100&min_premium=500000` and count.
  If it returns **more than 50**, the old code was silently discarding the remainder and the fix is
  doing work — record the number.
- **Then check the badge:** COORD should appear on more tickers than it used to. There is no
  before/after baseline to diff against, because the defect produced **false negatives** — the
  missing badges were never visible. Record the count as the new baseline.
- **Also run** `node --import tsx scripts/audit/helix-darkpool-inventory.mjs`. Two things it may say
  under RTH that it cannot say now: whether `side` ever becomes informative (all 20 weekend prints
  were the literal `"neutral"`, so the field is 100% filled and carries nothing), and whether the
  feed goes **`MINORITY_VERDICT_RISK`** — some prints sided, most not, which is the case
  `DarkPoolPanel`'s `biasFromSide` guard does **not** cover. It exits non-zero if so; that is the
  signal to fix the guard, which was deliberately left alone while the case cannot occur.
- **`newestPrintAgeHours` must be a real number, not `null`,** once the tape is live. It returns
  `null` rather than `0` when there is no print at all — correct, and it means the populated branch
  of the freshness clock has never executed. `null` under RTH means the clock has no input, which is
  a different defect from a stale one.

### 5e. The tide bar — a signed split that was rendered as magnitudes (#2704)

`helix-tide-split.ts` was splitting **signed** net premiums as if they were magnitudes, so a net
SHORT-call flow contributed to the bullish side of the bar. Off-hours the tape is one-sided enough
that the bar renders plausibly either way, which is exactly why this could not be validated at merge
time.

- **Check on screen (`/flows`, tide bar):** the bullish share must move in the same direction as the
  Net Premium panel over the session. A session whose net call premium is NEGATIVE must not paint a
  majority-bullish bar.
- **Check the refusal:** when total directional premium is `0`, `bullishPct` is `null` and the bar
  must render as *no reading* — **never a 50/50 split**, which would imply a measured balance where
  nothing was measured. Reachable pre-open (empty tape); confirm it once before the bell and then
  confirm the bar populates after.
- **The RTH-only question:** off-hours the four quadrants are barely populated. Under live flow all
  four (long call / short call / long put / short put) should carry premium at once — that is the
  first condition under which the sign error would have been visible by eye, and it is the condition
  the fix has never been seen in.

### 5f. Print time on mobile — there was none at all (#2707)

The desktop tape marked an *estimated* tape time with a `~` prefix that was **hover-only**, and the
mobile card carried **no timestamp whatsoever** — not a wrong time, an absent one. (The write-up on
#2706 said mobile showed "a timestamp with no indication it is an ingest time"; that was wrong and is
corrected here: there was no timestamp.)

> **⚠️ THIS SECTION'S PASS CONDITION EXPIRED WHEN #2723 DEPLOYED — corrected 2026-08-23.** It used
> to require that *"a Group B row (SPX / SPY — no `event_at`, §4A) shows it **prefixed `~`**"*, and
> that under live flow *"SPX/SPY keep it"*. **Both are now impossible.** `resolveFlowTimes` sets
> `tape_time_estimated: false` whenever an `event_at` resolves, and #2723 gave every index row one.
> Measured on the live tape: **0 of 5000 rows carry `tape_time_estimated` — 0 of 3621 SPX+SPY.**
> A checker following the old text finds no `~` anywhere and marks a working #2707 FAILED. This is
> the second criterion in this runbook that #2723 expired (see §5k); when a fix changes a
> population, every check written against the old one becomes a false negative, not a stale note.

- **Check on mobile 430×932 (`proxy-browser.cjs`, `flow-card`):** **every card shows a print time.**
  That is #2707's actual fix and it is still fully checkable — the defect was an *absent* timestamp,
  not a mislabelled one.
- **Check on desktop 1440:** where a `~` does render it is visible in the cell, not only in the
  `title`. Note this is now hard to exercise — see below.
- **The `~` path is currently unfalsifiable, and that is the honest status.** With every row
  carrying a real `event_at`, no row takes the estimated branch, so neither the mobile nor the
  desktop `~` assertion can pass or fail. Do **not** record "no `~` seen" as either a pass or a
  failure of the marker itself. If you need it exercised, the only rows that can reach that branch
  are ones with no parseable time at all — count them first:
  `node --import tsx scripts/audit/helix-tape-inventory.mjs` → the `event_at` presence row. At 100%
  there is nothing to render and nothing to check.
- **What to watch for instead, and it is more interesting than the original check:** a row that
  DOES show `~` under a moving tape is now a genuine outlier — a print whose `executed_at` the
  magnitude parser could not read. **Capture it.** That is the population #2723's write-up said it
  could not name off-hours, and one live example would settle what the wire format actually is.

### 5g. Contract size — one derivation, and a `0` that was a measurement (#2710)

`contracts = premium / (fill_price × 100)` existed as five separate implementations that disagreed.
`estContractSize` checked `contracts <= 0` *before* rounding, so a 0.4-contract quotient came back as
`0` — and the drilldown rendered a `Size` chip of **`0`** and an est. notional of **`$0`**. All HELIX
callers now read one module; display rounds, the size-vs-OI counting argument does not.

- **Check on screen (drilldown):** `Size` must still equal `Prem ÷ (Fill × 100)` for the row it was
  opened from — the chip and the columns are derived from the same two numbers and must agree by eye.
- **Check the refusal:** no row may show `Size 0` or `Notional $0`. Either is now impossible by
  construction; seeing one means the deploy does not carry this.
- **Cross-surface, the one this actually buys:** a Discord alert's `(~N contracts est.)` must match
  the drilldown for the **same print**. They were separate copies of the arithmetic until now, so
  this is the first session in which they are guaranteed to agree — and the first in which a
  disagreement would mean something.
- **The RTH-only question:** sub-half-contract quotients need cheap fills and small premiums, which
  is a live-tape population. Off-hours none exist, so the corrected branch has never executed on
  production data.

### 5h. Direction from call-vs-put premium — FOUR panels, one wrong rule (#2713)

`ExpiryConcentration`, `NetPremiumLeaderboard`, `TickerDrawer`'s bias pill and
`CumulativeNetPremiumChart` all derived a DIRECTION claim from call-vs-put premium — the rule #2691
replaced everywhere else on this page. Measured off-hours (5000 rows / 168h): **all four expiry
horizons rendered BULLISH GREEN and all four disagree**, and **7 of the leaderboard's top 10
tickers disagree with the arrow they render**. Two numbers carry it: `This week`'s bearish premium
(**$26,302,085**) slightly exceeded its bullish (**$26,231,879**) under a green bar; and the
leaderboard's own TOP ROW was **SPX — a green ▲ over $4,022,945,927 whose direction is 0.1%
readable**.

- **Run the probe first, it gates:** `node --import tsx scripts/audit/helix-direction-read-probe.mjs`.
  It exits **non-zero on any disagreement**, so after deploy it must report **0/4**. A non-zero exit
  means the deploy does not carry the fix — check that before reading anything else here.
- **Check on screen — expiry:** `Monthly` and `LEAPS` must render **neutral purple** with an amber
  `direction unread · N% sided` note, **not green**. Off-hours their premium is 6.1% and 3.2%
  readable respectively, because `ask_pct` is a Group A field and both horizons are dominated by
  the SPX/SPY index feed (§4A).
- **Check on screen — leaderboard:** the **SPX** row must show a neutral `◆`, not a green ▲, while
  still reading `+$4.0B`. **AMD and MU must stay green, SMH must stay red** — that half of the check
  matters as much as the first: if everything went neutral, the gate is mis-set and the panel has
  stopped saying anything rather than started saying it honestly.
- **`net` was NOT redefined.** It is still `calls − puts` and its sign still colours the figure. A
  row showing `+$4.0B` beside a neutral or bearish arrow is **correct, not a bug** — that
  divergence is the finding, and it is the first session in which it is visible.
- **The RTH-only question, and it is a real one:** does the readable share RISE under live flow?
  Group A prints arrive all session and carry `ask_pct`; the index feed's share of premium should
  fall as they accumulate. If Monthly/LEAPS/SPX stay near 0–6% readable through a full session,
  those surfaces are structurally uncolourable and the honest follow-up is to say so outright
  rather than keep withholding a colour without explanation. **Capture the readable % per horizon
  and per leader at the open, at midday and at the close** — that series is the argument either way.
- **Expect `CumulativeNetPremiumChart` to render a NEUTRAL line most of the session.** It reads the
  whole loaded tape, which the index feed dominates. That is the honest state, not a rendering
  failure — do not file it as a regression.
- **Watch for the opposite failure:** a horizon crossing 50% readable and turning green or red for
  the first time. That is the fix working, not a regression — but it is also the first time this
  panel has ever asserted a direction on evidence, so **check one bar's colour against its own
  tooltip numbers by hand** before trusting the rest.

### 5i. Largo answered bullish/bearish from `call_pct` — the AI and the UI disagreeing (#2718)

`get_helix_tape_analytics`'s own tool description told the model to use `session.call_pct` for
*"ANY 'call vs put', 'skew', or bullish/bearish premium question"*. Since #2691/#2713/#2715 the
member panels do NOT read direction that way, so the two audiences for one tape were about to give
opposite answers. Measured 2026-08-23: **CG was 100% call premium at 100% readable and BEARISH** —
the panel says bearish, Largo with only `call_pct` says bullish, about the same $8.0M.

`direction` / `direction_readable_pct` / `direction_minority_evidence` / `direction_basis` are now
on `session`, on every `net_premium_leaders` row and on every `expiry_horizons` row. `call_pct`
stays — it is a real quantity, correctly named, and the contract is additive.

- **Ask Largo directly, at the open:** *"is the flow on <ticker> bullish or bearish?"* for a ticker
  whose panel reads neutral or bearish while its call share is high. **The answer must match the
  panel.** This is the whole point of the change and the only check that exercises it end-to-end.
- **Then ask a name the index feed dominates** (SPX): Largo must say it cannot determine direction
  and **state the readable share**, not fall back to `call_pct`. If it quotes a direction for SPX,
  the model is ignoring `direction_minority_evidence` and the tool description needs sharpening.
- **RE-RUN THE TRUNCATION PROBE — this is a gate, not a nicety:**
  `node --import tsx scripts/audit/largo-truncation-probe.mjs --tools=get_helix_tape_analytics`.
  The change adds **~1,515 chars (9.5% of the 16,000-char cap)** to a payload that measured
  **COMPLETE** on production on 2026-08-23 (control PROVEN in the same run). The probe is BINARY —
  it says truncated or not, never how much headroom is left — so *"it was complete before"* is not
  evidence it still is. **#2480 was exactly this failure**: a HELIX tool silently delivering a
  fraction of itself while the model answered fluently from what survived. Under RTH the tape is
  busier and the payload larger, so the open is when it would first bite.
- **If it comes back TRUNCATED:** the aggregates are cut from the tail, so `expiry_horizons` and
  `session` go first. Do not "fix" it by dropping the direction fields — trim `recent`, which is
  the print list and is already available in full from `get_postgres_flows`.

### 5j. "Tape agrees with long thesis" on bearish flow (#2717)

`FlowFeed` gave every Night Hawk play a `flowAgreement` BOOLEAN from `callPremium/totalPremium`,
rendered as prose beside a tradeable play. Measured over the **59 tickers at the $2M
strong-conviction gate: 32 disagree (54%)**. `CG` — 100% call premium, 100% readable, verdict
**BEARISH** — printed `✓ tape agrees with long thesis`. And `false` meant two opposite things:
with no readable side it printed `⚠ tape diverges`, a fabricated disagreement (SPX, 0.1% readable).

- **Check on screen (`/flows`, Night Hawk panel):** no play may show `✓ tape agrees` unless its own
  call/put split AND the aggression-aware read support it. Open one and check the numbers by hand.
- **`◆ tape direction unread` must appear** on index-dominated tickers, with its coverage stated.
  Four distinct lines exist (agrees / diverges / two-sided / unread); seeing only two means the
  deploy does not carry this.
- **The `strong` badge count must FALL.** 42 of 59 gate-eligible tickers claimed agreement under
  the old rule; the honest count is 20. **A count that does not fall is the failure signal here** —
  and it is the opposite of the usual instinct, so record the before/after rather than eyeballing.
- **The RTH-only part:** off-hours the tape is stale and Night Hawk's edition may be empty, so the
  panel renders nothing at all. This has never been seen with live plays AND live flow at once,
  which is the only condition under which the four states can all occur.

### 5k. `event_at` on 70% of the tape — a parse, not a feed limitation (#2723) ⚠️ HIGHEST-IMPACT ITEM

**§4A records that the SPX/SPY index feed carries no print time, and that this makes the population
holding 92.1% of tape premium structurally unable to fire either persisted HELIX signal. On the
evidence below that is not a property of the feed — it is `new Date("1787343258239")` returning
Invalid Date.**

Measured 2026-08-23, live member tape, 5000 rows / 168h: **3500 rows (70%) carry no `event_at`**,
and `event_at` is present on a row **iff** `alert_rule` is — SPX **39/39**, SPY **82/82**. The other
3500 carry `implied_volatility`, whose only writer is the `option_trades` WS path, which DROPS
prints with a falsy `executed_at`. So every one of those rows arrived WITH a truthy `executed_at`
that `new Date()` could not parse.

- **✅ ANSWERED OFF-HOURS 2026-08-23 — the parse half is live-validated; do not re-run it.**
  `node --import tsx scripts/audit/helix-tape-inventory.mjs` against production, same 5000-row/168h
  query as the pre-deploy run: **`event_at` presence 30% → 100%, `alert_rule` unchanged at 30%.**
  The two counts have stopped co-varying, which is exactly what this bullet asked for, so the
  wire format IS within the magnitude parser and no raw `option_trades` capture is needed.
  Group B is intact at **3500 rows / 2 tickers / $9,992,246,317 = 92.1% of tape premium** — the
  §4A figure recovered exactly — and signal eligibility went **1500/5000 → 5000/5000**.
  The times are coherent, not merely present: 5000 dated prints span **363 minutes** (one RTH
  session), newest **2392 min** old against a market closed since Friday. So the parser picked the
  right unit, and the last bullet below is answered too.
  *(Reading this required fixing the instrument first — the harness classified writers by the
  absence of `event_at` and so reported the fix as Group B vanishing. See
  `findings-staging/2026-08-23-helix-inventory-eligibility-rule.md`. Any harness output from
  before that fix is void on these four numbers.)*
- **⚠️ THE RISKY HALF — MEASURED, AND IT DOES NOT GO THE WAY THIS SECTION ORIGINALLY SAID.**
  This bullet used to read *"expect the Velocity and Split Flow radars to fire on SPX/SPY for the
  first time ever … a large jump is the fix working."* **Half of that is backwards, and following
  it would mis-diagnose a working deploy.** Replayed off-hours over the same live session with both
  real detectors — `node --import tsx scripts/audit/helix-signal-population-ab.mjs`, 363 min,
  67 five-minute steps:
  - **SPLIT FLOW rises and then SATURATES.** SPX **24 → 67 firings of 67 steps**, SPY 23 → 65.
    At mid-session SPX's legs are **$246,955,657 call / $186,889,748 put** against a **$500,000**
    per-leg threshold — 494× and 374× over. It now fires on **every scan** of both index names,
    which is not a strong signal but an absent one.
  - **VELOCITY FALLS.** Total ticker-firings **239 → 220**, and **SPX 13 → 1**, SPY 13 → 6. SPX
    drops out of the top-6 entirely. **A reader expecting a jump sees this and concludes the deploy
    does not carry #2723.** It does.
  - **Why**, and it is a third defect the parse was hiding: the old detectors saw **39 of SPX's
    3118 prints — 1.3%**. Every one of those 13 firings was `recent=3, prior=0, ratio=3.0` — three
    prints against a **literally empty** prior window, cleared by the `max(1, prior)` floor. The
    same instants on the full population read `recent=34, prior=86, **ratio=0.40**`. SPX was never
    quiet-then-spiking; the Velocity Radar was showing members a spike the full tape contradicts,
    and the fix **removes a false positive** rather than adding a true one.
  - **The control**: SPY (16.3% visible) keeps its genuine spike — 15:51 reads `recent=42, prior=9`
    on the full population and fires in **both** runs — while losing the artifacts. Real spikes
    survive; only the sample artifacts go.
  - **What to check at the open, then:** that SPX/SPY split flow is firing (it will be, constantly)
    and that SPX velocity is *quiet*. Both are the fix working. n=1 session — re-run the harness on
    the live session and compare.
  - **The part that is genuinely still open:** this is a large change in what members are shown,
    and whether the thresholds still suit a population 3× larger is the **coordinator's call** —
    see §6, where `SPLIT_MIN_LEG`, the unreadable-index-row question and the velocity
    `max(1, prior)` floor are each recorded with the measurement that raises them.
- **The coverage note must be GONE, not merely smaller.** It rendered *"Scanned 103 of 500 prints —
  397 (SPX, SPY) carry no reported print time"*. At 5000/5000 eligible the note renders **nothing**
  by design, so on the open both radars should show no coverage line at all. A note still naming
  SPX or SPY means that request's tape disagrees with this measurement — capture it, it is news.
- **The mobile `~` marker (5f) is GONE, not merely rarer** — measured, not projected: **0 of 5000
  rows** carry `tape_time_estimated`, 0 of 3621 SPX+SPY. `resolveFlowTimes` clears the flag whenever
  an `event_at` resolves, and every row now has one. A row still showing `~` under a moving tape is
  therefore a genuine outlier — a print whose `executed_at` the magnitude parser could not read —
  and is worth capturing rather than ignoring. §5f is rewritten accordingly; do not read "no `~`
  anywhere" as a failure of #2707.
- **Sanity-check the times themselves, do not just count them — partly answered.** A magnitude-scaled
  epoch that picked the wrong unit yields a plausible-looking but wrong instant. The 363-minute span
  over 5000 prints above rules out a unit error by three orders of magnitude in either direction.
  What it does NOT rule out is a small forward skew, so still compare a handful of new `event_at`
  values against the same prints' `alerted_at` under a moving tape: they should be close, and
  `event_at` should never be in the future. #2725 keeps a future-stamped print out of both
  detectors, so a future value would be silently *excluded* rather than visibly wrong — check the
  ineligible count, not the radars.

### 5l. Dark-pool bias — a ratio that excluded its own denominator (#2739)

`DarkPoolPanel`'s BULLISH / BEARISH / MIXED badge was `buy / (buy + sell)` over premium — a ratio
whose denominator is the **sided** premium only. Prints carrying no direction never entered it. The
one guard fired only when **no** print carried a side, so the all-or-nothing case was handled and the
**partial** case was not: with 5% of premium sided and leaning buy, the panel would render a
confident `BULLISH` drawn from a twentieth of the tape, with nothing on screen saying so.

**Measured off-hours 2026-08-23, before changing anything:** the market-wide feed and the
ticker-scoped feed for NVDA, SPY, TSLA and AAPL each returned 50 prints — **250 prints, every one
`neutral`, 0.0% sided premium coverage.** So the partial case is **latent, not live**, and the fix is
behaviour-neutral on that population. It was made anyway because the defect is in the SHAPE of the
computation, not in whether this week's feed triggers it — and the off-hours number is a floor.

- **Run first:** the coverage measurement, under RTH volume. `GET /api/market/dark-pool` market-wide
  and per ticker; count `side` values (`buy` / `sell` / `neutral`) and compute sided premium as a
  share of total. Off-hours that is 0.0% on every endpoint; the question is whether UW populates
  `sentiment`/`direction` when the tape is moving.
- **⚠️ THE READING THAT WILL LOOK LIKE A REGRESSION AND IS NOT.** If coverage rises above 0% but
  stays under `MIN_READABLE_PCT_FOR_VERDICT` (50%), the panel now shows **`—` plus
  `side known on N% of premium`** where the old code would have shown a confident BULLISH or
  BEARISH. **That is the fix working.** Do not open a finding for a dash that carries a coverage
  note beside it — the note is the evidence the gate fired deliberately.
- **If coverage clears the threshold**, the badge lights up for the first time on this feed. Spot-check
  it by hand against the print list before trusting it — that path has never rendered against real
  sided data.
- **`— ` with no coverage note at all** means `readablePct` was `null`, i.e. the population carried no
  premium whatsoever. That is different from 0% coverage and is deliberately not labelled: 0% would
  assert a measurement over an empty population.
- **Cross-check, cheap and worth doing once:** the same threshold governs the flow tape's direction
  read (`helix-direction-read.ts`). If the dark-pool badge and the tape's verdict disagree about
  whether something is readable, one of them is not using the shared constant — they are supposed to
  be the same rule on two surfaces.

### 6. Open questions an RTH session can actually answer

These are recorded as needing a decision; RTH is when the data exists to inform them.

- **The `whale`-outranks-`0dte` collision** (`db.ts:2646`). `route` is `premium >= $1M ? 'whale' : expiry = TODAY ? '0dte' : 'stock'`, so the largest 0DTE prints never get the 0DTE badge. **Unmeasurable off-hours** — the closed window holds **zero** `dte === 0` rows. At the open, count prints with `expiry = TODAY` **and** `premium >= $1M`: that is the exact population being denied the badge.
- **A permanently unreadable row at the top of a direction radar — AWAITING COORDINATOR.** Follows
  from the item below and is arguably worse than it. Split flow reports `direction` from option type
  **×** aggressor side, and the index feed sends **no `ask_pct` at all** (0 of 3500 rows vs Group
  A's 1454/1500). So SPX and SPY now fire on essentially every scan and report `— UNREAD` on every
  one of them — measured 67/67 and 65/65. The refusal is **correct**: the rule cannot read that
  flow and says so rather than guessing, exactly as the contract requires. The question is whether a
  ticker whose direction can never be stated belongs at the TOP of a direction radar, above names
  the signal can actually read. Options: rank readable tickers first, exclude no-aggressor feeds
  from this signal, or accept it and label it. Each changes a persisted, graded row — coordinator's
  call.
  - **What it costs the panel, measured 2026-08-23 so this is not decided on adjectives.** Replaying
    the real detector over one live session, 67 populated scans: the radar shows a **median of 5
    rows** (range 1–9); SPX/SPY rank **median 1**, the top row; they are **40% of everything
    visible**; and they occupy **BOTH top-2 rows on 84% of scans (56/67)**. So a member reading the
    Split Flow Radar typically sees five names, two of which are permanently unreadable and sit
    above the three the signal can actually read. Reproduce with
    `scripts/audit/helix-signal-population-ab.mjs`.
- **`SPLIT_MIN_LEG` against an index feed — NEW, and the sharpest of these. AWAITING COORDINATOR;
  do not tune it from this lane.** Split flow fires when a ticker shows opposing call AND put
  premium of **$500K each** inside 30 minutes. That threshold was set against single names. #2723
  admitted a feed carrying **$9.99B/week across two tickers**, and measured off-hours SPX clears it
  by 494× on every scan — 67 of 67 replay steps, SPY 65 of 67. **A signal that is always on for a
  name carries no information about that name**, and both radars now lead with SPX and SPY. The
  options are a premium-relative leg threshold, a per-ticker floor, or accepting index saturation as
  correct; each changes when a **persisted, graded** row is written, so each breaks continuity of
  the record and none is this lane's call. Re-measure under RTH volume first —
  `scripts/audit/helix-signal-population-ab.mjs` — the off-hours number is a floor.
- **The velocity `max(1, prior)` floor.** Observed rather than fixed: `ratio = recent / max(1,
  prior)` means 3 prints against an EMPTY prior window scores exactly 3.0 and fires. On the
  pre-#2723 tape that produced 13 phantom SPX spikes off a 1.3% sample. With the full population it
  no longer misfires there, so nothing was changed — but the floor still makes "3 prints after
  silence" indistinguishable from a real burst on any genuinely thin name. Worth a decision, not an
  edit.
- **§9.7 score saturation.** $1.3B and $1.0M prints both score 60; 24.1% of tape pinned at saturation, measured off-hours. Re-measure under RTH volume — saturation should be *worse*, and the size of that is the argument.
- **Whether Route Breakdown should stay premium-weighted.** The 95%-vs-79% gap is entirely premium weighting. Under RTH the two diverge differently; capture both.
- **`helix-signal-outcomes` has no writer.** The cron is fully registered in `cron-registry.ts` and **absent from the deployed manifest** (`blackout-infra/cron-jobs.json`, 39 jobs, none mentioning helix). So the signal ledger is never written and every "graded" HELIX signal number rests on an empty table. **Not fixable from this lane** — it is an infra change in another repo against production. Raised on #2698; awaiting a decision to either schedule it or list it INTENTIONALLY_UNSCHEDULED. Until then, **treat any HELIX track-record figure as unbacked**, and say so rather than reporting a rate. **#2712 makes the gap visible in the product** rather than fixing it: the Signal Outcomes panel now separates an empty ledger from an unwritten one, so at the open it must read **"Not recording"**, not "No firings yet". If it reads the latter, something is writing `cron_job_runs` under this key that the deployed manifest says cannot exist — chase that discrepancy before trusting anything else here.
- **Whether the index-dominated surfaces can EVER carry a colour.** #2713 withholds a directional colour below 50% readable premium. Off-hours: Monthly **6.1%**, LEAPS **3.2%**, **SPX 0.1%** — because `ask_pct` is a Group A field and all three are dominated by the index feed. If a full RTH session does not move them, they are structurally uncolourable, and the honest follow-up is to say so outright in the product rather than withhold a colour without explanation. The same gap makes `CumulativeNetPremiumChart` render a permanently neutral line. **The fix, if one is wanted, is to source ask-side data for the index feed — not to resume colouring on a rule that does not hold.** The measurement that decides it is 5h's readable-% series (open / midday / close). Same root as the print-time question below, surfacing on four more panels.
- **Whether the SPX/SPY index feed should get a print time at all.** Group B carries 92.1% of premium and no `event_at`, so it can never fire either persisted signal (§4A) and now renders a permanent `~` (5f). Adding a synthetic time would make it *look* eligible without making it so — worse than the gap. The decision is whether to source a real one upstream or to state the exclusion in the product. Awaiting the coordinator.

### Commands

```bash
export PATH=/opt/node20/bin:$PATH NODE_USE_ENV_PROXY=1

# Rendered UI — Route Breakdown, Net Premium, Expiry Concentration, freshness (desktop + mobile)
node scripts/audit/helix-flows-ui-audit.cjs

# API-side tape inventory — writer groups, route keys, IV units, signal eligibility
node scripts/audit/helix-tape-inventory.mjs

# Aggregate DIRECTION claims (expiry bars + Net Premium leaders) — EXITS NON-ZERO on disagreement (#2713)
node --import tsx scripts/audit/helix-direction-read-probe.mjs

# Dark-pool field inventory + COORD directional coverage (#2708)
node --import tsx scripts/audit/helix-darkpool-inventory.mjs

# Largo payload arrival (needs the live agent)
node scripts/audit/largo-truncation-probe.mjs
```

**The tape is a CSS GRID, not a `<table>`** — `role=grid`, headers in `.helix-tape-col-row`, body
cells `role=gridcell`. A probe written against `<table>`/`<th>`/`<tbody>` returns zero rows and reads
as "the tape is empty", which is a harness failure wearing a product verdict. This cost seven false
results on 2026-08-23; read a component's real class names before writing an assertion.

## WATCH LIST — first session on 2026-08-12 (read this before the routine pass)

Five fixes plus one new surface shipped overnight on 2026-08-11/12. **Two of them changed what members SEE and are
deployed but NOT verified** — the board rolls empty after the close, so there were no committed
rows to render and a "zero defects" reading would have been vacuous. These are the first things to
check when rows exist, ahead of the routine pass.

### 0. Thermal Depth tab — brand-new surface, never seen live under RTH (#2089)
The synthetic order book ships a THIRD Thermal tab (`Forced Flow (Depth)`), GEX-lens only. Its
numbers were validated pre-deploy against 14 live chains (`scripts/audit/gex-depth-validate.mjs`,
all PASS, flow/gamma coherence 100%) and its render was validated on prod at desktop 1440 + phone
430 (`scripts/audit/depth-ladder-ui-audit.mjs`). **But every one of those runs happened outside RTH.**
What is genuinely unproven until the open:
- the ladder under a MOVING spot — every rung is recomputed on each fresh matrix build, so a fast
  tape is the first time the bars animate rather than sit still;
- the `crossing` line when a ticker actually crosses its regime intraday;
- whether the anchor stays inside its 0.4–2.5 band once RTH greeks and IV are live (off-hours IV is
  the stalest input the ladder has).
Re-run both harnesses during RTH. **Remember the matrix is CACHED** — a check within seconds of a
deploy proves nothing until the cache turns over.

### 1. `?DTE` on the 0DTE board — the fix is live, the proof is not (#2075)
Before the fix, EVERY row on the closed board read `RIOT 21P · ?DTE`. `zerodte-sources.ts`
hardcoded `dte: null` when synthesising a setup for a ledger-only row, and after the close every
row is ledger-only. The fix recovers it from the row's own OCC (`ledgerRowDte`).

**Check:** load `/nighthawk` once committed rows exist. Every play must show a real `NDTE`
(`0DTE` for a same-day, `2DTE` etc. for a later expiry) and **zero** `?DTE`.
**A board with no rows proves nothing** — confirm `ALL n` is non-zero before reading the result.
A `?DTE` that survives means the row's OCC is absent or unparseable, which is a different bug
worth its own look (`ledgerRowDte` is fail-closed by design).

### 2. Swing committed rows carrying their factors again (#2077)
Measured on prod 2026-08-12: of 21 SWING rows, 15 carried factors and the 6 without them were
exactly the committed ones (MANAGING + SCALING OUT). The desk explained what you were watching and
went quiet on what held your capital.

**Check:** on the Swings tab, a MANAGING or SCALING OUT row must show real components under
**"WHY THIS PLAY WAS PICKED"** — not `Component breakdown not served for this lane yet — score N`.
Also confirm the lifecycle did NOT regress: a TRIMMING row must stay in **SCALING OUT** and not
fall back to MANAGING (that trap is what `attachThesisExplanation` copies factors ONLY to avoid).

### 3. Legacy lane — never actually looked at
The tab sweep (#2076) reached 0DTE, Swings and Bangers; Legacy's capture was lost to a container
restart before review. It is the one lane with **no** live-eyes confirmation.

**Check:** `/nighthawk` → Legacy renders content, not an empty frame. Legacy is a post-close
next-day digest, so judge it during/after RTH, not pre-open.

### 4. Re-run the sweep — three false-finding sources are now fixed
`node --import tsx scripts/audit/nighthawk-ui-sweep.mjs`

It previously audited `/record` (a 404 — the route is `/track-record`), reported 8 invented empty
panels on a healthy `/vector` (the selector matched decorative leaves), and printed two permanent
`FAIL … timeout` lines for SSE streams that are supposed to stay open. All three are fixed, so a
finding from this run is far likelier to be real. It now also drives all four lanes.

**Node 20 first** — `bash -lc 'nvm install 20'`, then
`export PATH=/opt/nvm/versions/node/v20.20.2/bin:$PATH`. It is NOT pre-installed and does not
survive a restart, and a Node 22 run is not evidence.

### 5. Deploy gate — watch it pass, or fail honestly (#2079)
The post-rollout asset gate now waits 5 minutes and needs **two consecutive** passes. On
2026-08-12 the old 2.5-minute single-pass gate failed a good deploy and four merged fixes sat
unshipped for ~25 minutes while every PR showed green.

**Check:** the next production deploy's *Validate static assets on origin* step. Healthy looks
like ~35-40s (pass, 15s, pass). If it burns the full 5 minutes and fails, that is a REAL
convergence problem, not the flake this replaced — and note that a failed deploy is still not
loud in-band, so the live product is the check that matters.

### Known-good baselines from the overnight session
- `/nighthawk` healthy authenticated load routes **~145** requests (below ~20 means it did not load).
- Bangers lane on 2026-08-11: **48 OPEN**, real scale-out states, AURA at 21.00x on a trailing runner.
- Swings lane: 21 rows across six sections.
- `/api/market/quote` cold ~560ms vs ~85ms warm; the gex-heatmap SPX build ~12.5s cold vs 0.1-1.8s
  warm. Both are cold-cache shape, not faults — do not file them as endpoint failures.

## WATCH LIST — first session on 2026-08-07 (read this before the routine pass)

The 2026-08-06 batch merged **21 PRs with NO CI** — GitHub Actions was in `major_outage` for
most of that day, so every change was verified locally only. Three of them changed behaviour that
only a live tape can exercise. Run the standard pass below, but these are the priorities:

### 1. The two merges that change trading behaviour — highest priority
- **#1819 — exit engine's operative stop moved to the LEDGER entry basis.** Pre-fix, live evidence
  showed **8 of 24** setups carrying an operative stop worse than −50%, one at **−62.9%**. Watch that
  stops fire at the intended −50% of the ledger basis and that no `thesis_break`/`flat_timeout`
  is stamped at a mark the protective rule should have owned.
- **#1818 — `underlying_price` now refreshes from the live option snapshot** and recomputes
  `otm_pct`, which is a **gate input**. Watch that setups price sanely against spot and that the
  moneyness gate isn't newly admitting/rejecting differently than expected.

### 2. Heap-fix validation — needs a deploy-quiet hour
`--max-old-space-size=2560` (NODE_OPTIONS on the web task def) has **never been validated**: every
deploy on 2026-08-06 replaced the tasks before the ~46-min historical crash cycle elapsed. Best
evidence so far is tasks reaching 39/45/52 min with **zero exit 139**. Check:
`aws ecs describe-tasks ... --query 'tasks[].[containers[0].exitCode]'` on STOPPED tasks. **139 is
the Node self-abort signature** — the kernel never OOM-kills it, so CloudWatch `MemoryUtilization`
caps around 62% and *structurally cannot* show this. If a task exceeds ~60 min with no 139, say so
plainly; if a deploy reset the clock again, say that instead of claiming validation.

### 3. GEX snapshot capture — ONLY possible during RTH
`wall-temporal-stability.mjs` (INTENTIONAL-DESIGN item #3) has **never produced a measurement** —
it returns INSUFFICIENT DATA without an intraday snapshot series, and that series can only be
captured while the market is open. Start `scripts/audit/gex-wall-snapshot-poll.mjs` early in the
session; it is the only one of the three parked design questions that is time-boxed to RTH.
(The other two — `veto-flicker-rate`, `merge-precedence-ab` — need exports, not market hours.)

### 4. Confirm the deck-header overlap fix on the real page
#1828 was proven in an isolated harness (13 overlapping text pairs → 0) but **never rendered on the
live board**. One shot settles it:
`node proxy-browser.cjs "https://blackouttrades.com/nighthawk" out.png --cookie "$CK" --viewport 430x932 --wait 24000`
Expect the status strip on one scrollable line, no overlap, `RISK` reachable by horizontal scroll.
Also worth a `--viewport 1440x900` pass to confirm desktop is unchanged.

### Known-good baselines to diff against
- healthcheck stage D should read **AMBER off-hours** (not RED) — that was #1821; a RED there again
  means a real regression, not the old false alarm.
- prod web deployment configuration should be **`minimumHealthyPercent=100 / maximumPercent=120`**.
  If it reads `50/112`, the deploy workflow regressed — see the drift entry in FINDINGS.md.

### Deliberately NOT done, in case it comes up
The **governor stop-time recording gap** (#1810 follow-up). An untimed stop currently fails closed
for the whole session where the design intent is a 20-minute lock. It was left alone on purpose: it
LOOSENS a fail-closed guard on a live risk device, and that deserves a deliberate decision rather
than an end-of-session patch.

### 19. Vector universe GEX wall spot-zero guard — 2026-09-04

- **What was broken:** `vector-universe.ts` passed `spot: 0` into `computeGexWalls` when chain spot was transiently zero, persisting wrong-side walls into narrowed-horizon history.
- **What changed:** Both blended and narrowed-horizon `computeGexWalls` calls now use `spot != null && spot > 0 ? spot : undefined`.
- **RTH check:** On `/vector` during RTH, pick a dynamic ticker (e.g. INVERT fixture row in admin) and confirm top call/put walls sit on the correct side of spot; no wall-history samples with inverted geometry after a spot=0 chain miss.

### 20. `/meridian` missing from protected-route lists — 2026-09-04

- **What was broken:** `/meridian` (a real tier-gated premium desk) was absent from `isProtectedRoute` (middleware-clerk.ts), `PROTECTED_PREFIXES` (middleware-shared.ts), and `DISALLOWED_ROOTS` (robots.ts). Live-confirmed: anonymous `curl` to `/meridian` returned HTTP 200 with a 1s `<meta http-equiv="refresh">` client-side redirect instead of the clean top-level 307 `/vector` gets from Clerk's `auth.protect()`; `/meridian` also fell through to a no-op edge-cache header in production (no `CDN-Cache-Control: no-store`) instead of the explicit no-store every other protected desk gets.
- **What changed:** Added `/meridian` to all three lists. New `src/desk-protected-route-coverage.test.ts` scans every `(site)/*/layout.tsx` for the tier-gate pattern and asserts the matching prefix exists in all three lists, so the next gated desk cannot repeat this silently.
- **RTH check:** Re-run the anonymous curl check against prod: `curl -sD- -o /dev/null https://blackouttrades.com/meridian` should now return a top-level `HTTP/2 307` with `location: /sign-in?redirect_url=%2Fmeridian` (matching `/vector`'s shape) instead of `HTTP/2 200` with a body. Also confirm the response carries `cdn-cache-control: no-store`. No RTH-specific behavior — this is a routing/auth-plumbing fix, safe to check anytime, but flagged here per the standing next-session-validation logging requirement.

### 21. `largo-stress-run.mjs` broken import after `decompose.ts` removal — fix/bie-decompose-dead-code-safe — 2026-09-04

- **What was broken:** `main` already removed `src/lib/bie/decompose.ts` but `scripts/largo-stress-run.mjs` still imported `isCompoundQuestion` from it — `ERR_MODULE_NOT_FOUND` on every Largo stress nightly run (same regression class as #3219).
- **What changed:** Inlined compound-question detection in `largo-stress-run.mjs`; extended `repo-hygiene.test.ts` allowlist comment.
- **Check:** `LARGO_STRESS_LIMIT=5 node --import tsx scripts/largo-stress-run.mjs` → `router_mismatch: 0`. No member-visible surface.

### 22. HELIX `/flows` — earnings-badge TZ off-by-one + replay NaN sort — fix/flowfeed-date-handling-bugs — 2026-09-04

- **What was broken (badge):** `FlowFeed.tsx`'s `earningsDays` computed the EARN/E{n}D badge's
  day-count against browser-LOCAL midnight (`new Date().setHours(0,0,0,0)` /
  `new Date(dateStr + "T00:00:00")`), not the ET trading-calendar date `earningsMap` actually
  carries — a member off US/Eastern could see the badge off by exactly one day for the hours
  around either midnight where the local and ET calendar dates disagree (verified: a West Coast
  member at 2026-09-04 22:00 PT, when the ET day has already rolled to 2026-09-05, saw "E1D"
  instead of "EARN"/E0D for a same-ET-day report).
- **What changed:** Extracted `earningsDayDiffEt()`, ET-anchored via the same technique
  `daysToExpiry` already uses (`Intl.DateTimeFormat` → `Date.parse` of literal UTC midnight for
  both endpoints). Also fixed `startReplay()`'s tape sort, which used raw
  `new Date(a.alerted_at).getTime() - new Date(...)` and returned `NaN` (an
  `Array.prototype.sort` contract violation, unspecified ordering) for any row with
  `alerted_at: ""` (a freshly-streamed SSE row with unknown print time, per `flow-persist.ts`) —
  now uses the extracted null-safe `compareFlowAlertsByTimeAsc()`, matching `displayAlerts`'s
  existing convention a few lines below.
- **RTH check:** On `/flows`, with the ET session open, compare the EARN/E{n}D badge day-count
  against the ticker's actual next report date for a few names spot-checked against Meridian's own
  `report_date`; there should be no case where a badge reads one day off from what Meridian shows
  for the SAME print. Separately, run a live Replay (▶ Replay button) during/soon-after RTH once
  the tape has accumulated at least one freshly-streamed row (new SSE prints briefly carry no
  `alerted_at` before the DB round-trip lands it) and confirm the replay plays in a clean
  chronological order with no visibly out-of-order jump.

### 23. SPX Slayer spot headers — null `spx_change_pct` painted bullish — fix/spx-change-pct-null-neutral-tone — 2026-09-04

- **What was broken:** `SpxLiveSpotPrice`, `SpxSniperHeader` strip spot, and `SpxIosMarketStrip` used `(desk?.spx_change_pct ?? 0) >= 0` for bull/bear text and border classes. When day change was genuinely unknown (`null`), price and % chip showed green bull styling while `fmtPct` correctly rendered `—`.
- **What changed:** `dayChangeTextClass()` / `dayChangeBorderClass()` in `src/lib/api.ts`; all three surfaces use neutral white tone when change is absent.
- **RTH check:** On `/dashboard` during a brief window where SPX spot is live but `spx_change_pct` is still warming (or force a null in dev), confirm SPX price/% use neutral white styling — not green bull — while the % reads `—`.

### 24. SPX pulse SSE stream — unrounded IEEE floats on wire — fix/spx-pulse-stream-round-floats — 2026-09-04

- **What was broken:** `/api/market/spx/pulse/stream` SSE events serialized raw `indexStore` / UW tide numbers without `roundFloats`, so members on the live stream lane could still see tails like `7718.600000000001` while REST `/spx/pulse` was already rounded (PR #3751).
- **What changed:** Wrap the SSE payload in `roundFloats()` before `JSON.stringify` in `pulse/stream/route.ts`.
- **RTH check:** Open SPX desk with pulse stream connected (Network tab → EventStream on `/api/market/spx/pulse/stream`); confirm `spx.price` and tide `net`/`call_premium` values are 2dp-clean with no IEEE tails during RTH ticks.

### 25. HELIX flows SSE stream — unrounded IEEE floats on wire — fix/flows-stream-round-floats — 2026-09-04

- **What was broken:** `/api/market/flows/stream` SSE events serialized raw flow premiums/strikes without `roundFloats`, so members on the live HELIX tape could still see IEEE tails while REST `/flows` was already rounded.
- **What changed:** Wrap the SSE payload in `roundFloats()` before `JSON.stringify` in `flows/stream/route.ts`.
- **RTH check:** Open `/flows` with live stream connected (Network tab → EventStream on `/api/market/flows/stream`); confirm `premium`, `strike`, and GEX enrichment numbers are 2dp-clean with no IEEE tails on incoming flow events during RTH.

### 26. Vector contract-picks/live + play-bie — unrounded floats at API boundary — fix/vector-live-picks-bie-roundfloats — 2026-09-04

- **What was broken:** `POST /api/market/vector/contract-picks/live` (live bid/ask/mid/greeks on pick monitor) and `POST /api/market/vector/play-bie` (`favPct` historical rate) returned raw IEEE floats while sibling Vector reads already call `roundFloats`.
- **What changed:** Wrap both success responses in `roundFloats(...)`; add `favPct: 4` to `VECTOR_FRACTION_DP`.
- **RTH check:** On Vector with an active play, open pick live monitor — confirm option marks are 2dp-clean; BIE evidence line shows a non-zero historical rate when `favPct` is small (e.g. 0.4% not 0.00%).

### 27. Vector snapshot GEX walls — WS ladder race without spot constraint — fix/vector-snapshot-spot-constraint — 2026-09-04

- **What was broken:** `getVectorGexWalls()` in `vector-snapshot.ts` could compute unconstrained gamma walls from the live UW WS ladder when `fallbackSpot` was still null (heatmap fetch in flight), placing call walls below spot or put walls above spot.
- **What changed:** WS ladder path returns cached walls until spot is known; horizon WS path skips unconstrained compute when spot missing. Builds on spot > 0 guard from prior commit on this branch.
- **RTH check:** On `/vector` for SPX/SPY/QQQ at session open (first ~30s after 09:30 ET), confirm call walls sit above spot and put walls below spot — no inverted geometry flash.

### 28. 0DTE admin sim board — unrounded floats at API boundary — fix/zerodte-board-sim-roundfloats — 2026-09-04

- **What was broken:** `GET /api/market/zerodte/board?sim=1` (admin-only) served sim frames from Redis without `roundFloats` at the route boundary. Member path rounds inside `zerodte-service.ts`, but sim ingest bypasses that pipeline — synthetic/replay frames could expose IEEE float tails on the admin sim desk.
- **What changed:** Wrap both sim and member board success responses in `roundFloats()` at `board/route.ts`.
- **RTH check:** Seed admin sim (`/nighthawk?sim=1`), inspect board JSON or rendered premiums/PnL — confirm 2dp-clean values with no IEEE tails on sim frames.

### 29. Stock spot SSE stream — unrounded IEEE floats on wire — fix/spot-stream-roundfloats — 2026-09-04

- **What was broken:** `/api/market/stocks/spot-stream` SSE frames serialized raw `price` and `changePct` from `stock-candle-store` without `roundFloats`, so members on the push spot lane could see IEEE tails while REST `/api/market/quote` was already rounded.
- **What changed:** Apply `roundFloats(frame)` inside `encodeSpotFrame()` in `stocks-spot-stream-hub.ts` before `JSON.stringify`.
- **RTH check:** Open any desk surface using the spot SSE stream (Network tab → EventStream on `/api/market/stocks/spot-stream?tickers=NVDA,AAPL`); confirm `quotes.*.price` and `changePct` are 2dp-clean with no IEEE tails during RTH ticks.

### 31. Swing Q40/Q41 — mark freshness dropped + SSE tier never rechecked — fix/swing-mark-asof-sse-tier-recheck — 2026-09-05

- **What was broken (Q40):** `swing_positions.last_mark_at` and manage-snapshot `quote.asOf` were persisted but never reached `HorizonDeck`/`terminalPlayFromHorizon`, so swing OPEN rows showed SYNC (not STALE) when the incidental 0DTE SSE lane wasn't carrying their OCC.
- **What was broken (Q41):** `/api/market/zerodte/marks/stream` and `/api/market/vector/stream` checked tier/tool only at connection open — a lapsed Whop member kept receiving live swing + 0DTE P&L until tab close.
- **What changed:** `HorizonPlay.markAsOf` from `last_mark_at` (quote.asOf fallback); `recheckSseUserEntitlement()` on every user SSE tick.
- **RTH check:** Night Hawk Swing lane — OPEN position with stale `last_mark_at` should show STALE chip without 0DTE SSE carrying the OCC. Tier revocation mid-session should close SSE within ~1s.

### 32. Vector snapshot VEX/flip/dark-pool + GEX cache reader — future-timestamp guards — fix/vector-snapshot-gex-cache-future-guards — 2026-09-05

- **What was broken:** After gamma-wall memo was migrated to `isWsUpdatedAtFresh`, sibling Vector snapshot caches (VEX walls, gamma flip, dark-pool refresh triggers, wall-history recordability) still used raw `Date.now() - at` — a future stamp reads as infinitely fresh and can skip background refresh or record stale walls into durable rails. `readGexHeatmapCacheOnly` and `pickStaleHeatmapForHandoff` had the same shape for 0DTE thesis evidence reads.
- **What changed:** Route VEX walls, flip, dark-pool, and recordability gates through `isWsUpdatedAtFresh`; cache-only reader uses `gexHeatmapCacheEntryStale`; handoff uses `gexHeatmapCacheEntryWithinTtl` and skips far-future entries from the `any` fallback.
- **RTH check:** Vector stream (`/vector` or SPX desk embed) — VEX lens + gamma-flip line should refresh on cadence; no indefinitely-stale wall chips after deploy. Admin GEX health panel `age_sec` should not read negative.


- **What was broken:** `buildVectorUniverseSnapshot` fired every universe ticker's `fetchGexHeatmap` at once via a raw `Promise.allSettled` (no concurrency bound). Live-confirmed: `GET /api/market/vector/universe` served fully-null rows (`spot`, `gammaFlip`, walls all null) for `DIA`, `AAOI`, `DRAM`, `ZS`, `NOK` while a solo `GET /api/market/gex-heatmap?ticker=<T>` for each of those same tickers, run ~20 minutes later with no contention, returned `available: true` with a real spot price — proving the batch fan-out (not real data absence) dropped them. Same root-cause shape as the already-fixed `vector-dark-pool-warm` unbounded fan-out (entry above this file's predecessor list, FINDINGS.md 2026-09-02).
- **What changed:** Added `runPolygonPool` (`polygon-rate-limiter.ts`, mirrors `runUwPool`), bounded-concurrency default 8 (`POOL_MAX_CONCURRENCY`, env-overridable). `buildVectorUniverseSnapshot`'s ticker fan-out now routes through it instead of the raw `Promise.allSettled`.
- **RTH check:** During/soon after RTH, hit `GET /api/market/vector/universe` and spot-check a handful of non-preset dynamic-universe tickers (names outside the ~11 warm presets — e.g. whichever mid-liquidity names are currently in the dynamic universe) for `spot: null`/`gammaFlip: null` rows; cross-check any null row directly against `GET /api/market/gex-heatmap?ticker=<T>` — if the direct check returns `available: true` with a real spot, the fan-out is still dropping rows and this fix needs a second look (e.g. `POOL_MAX_CONCURRENCY` too high, or a sibling unbounded fan-out — `heatmap-warm`/`vector-walls-warm`, both flagged as blast-radius follow-ups in the finding — needs the same fix).

### 33. SPX desk UW supplemental + flow lane — missing background sweep tag — fix/spx-desk-uw-sweep-rest-flow — 2026-09-05

- **What was broken:** `fetchUwDeskRestSupplemental` (NOPE/max pain/IV) and `buildSpxDeskFlow` (6-endpoint UW fan-out) called `runUwPooled` without `runWithBackgroundUwSweep`, unlike `fetchDeskEnrichmentFields` and `desk-warm`. Cron cold rebuilds (`spx-evaluate`, `spx-signal-observe`, `market-regime-detector`) could consume UW slots reserved for live member traffic.
- **What changed:** Wrap both UW blocks in `runWithBackgroundUwSweep`; extend static regression test to cover all three paths.
- **RTH check:** During RTH, confirm SPX desk flow lane + supplemental fields (NOPE, max pain, IV rank on SPX Slayer) populate normally; no elevated UW 429s or member-facing staleness on concurrent desk loads when crons fire (CloudWatch `uw-rate-limiter` / cron `elapsed=` logs).

### 34. Thermal CHARM — call-shaped formula used for puts too, wrong at nonzero dividend yield — test/charm-numerical-derivative-check — 2026-09-05

- **What was broken:** `charmPerShare` used ONE call-shaped closed-form expression for both call and put contracts ("type-independent... like gamma"), true only at dividend yield `q=0`. Missing the `q`-dependent term from differentiating `e^(-qT)` in `Delta(T)`, so even calls were subtly wrong at `q>0`. SPY/QQQ/IWM carry a material dividend yield per this repo's own GEX findings (`gex-depth-validate.mjs`).
- **What changed:** `charmPerShare(..., type: "call"|"put")` now implements the full dividend-yield-correct formula per-type; the one call site passes the contract's real type through.
- **RTH check:** On `/heatmap` (Thermal desk) for SPY/QQQ/IWM during RTH, spot-check the CHARM tab's per-strike dollar-charm values before/after this deploys — magnitudes should shift (calls slightly larger in magnitude, puts now genuinely distinct from calls rather than mirroring them) with no sign flips or NaN/null cells. No live provider ground truth exists for charm (Polygon doesn't supply it), so this is a magnitude/shape sanity check, not a numeric cross-check.

### 35. GEX full-chain escalation — flat 12-page guard truncated megacap chains (NFLX/GOOGL) — fix/gex-heatmap-unfiltered-page-guard — 2026-09-05

- **What was broken:** `fetchHeatmapBandUnfiltered`'s page cap (`HEATMAP_UNFILTERED_PAGE_GUARD = 12`) was sized for "tiny low-priced chains" per its own doc comment, but `shouldEscalateToFullChain` escalates on ANY thin banded ladder regardless of price — live-caught truncating both NFLX and GOOGL mid-session ("hit 12-page guard... walls/OI/IV understated"), the third occurrence of a bug class this file already fixed twice (`fetchPolygonOiByExpiry`, the OI-by-expiry term-structure loop).
- **What changed:** `HEATMAP_UNFILTERED_PAGE_GUARD` now shares the already-fixed, env-overridable `HEATMAP_PAGE_GUARD` (floor 40) instead of a flat 12.
- **RTH check:** During RTH, watch CloudWatch `/ecs/blackout-production` for `[polygon-gex] fetchHeatmapBandUnfiltered(<ticker>) truncated` on any megacap/thin-ladder name that triggers full-chain escalation (NFLX/GOOGL are known repeaters) — should no longer appear at 12 pages; if it does, the shared guard's floor may need raising further, not a fourth bespoke constant.

### 36. SPX desk pulse — cold replica off-hours still served price:0 when the fast lane's own background fetch hadn't landed yet — fix/spx-desk-pulse-cold-prior-close — 2026-09-05

- **What was broken:** `buildSpxDeskPulse`'s off-hours branch fell through to `price:0` on a fresh ECS replica whenever `lastPulseForSignals` was empty. The original fix in this PR added an `await priorDayForPulseLane()` call, but that helper is itself "never block cold" — on a TRUE cold cache it fires the real prior-day fetch in the background and returns `pdc:null` immediately, so the very first off-hours request after a rollout still saw `price:0` (only the second request onward benefited).
- **What changed:** When `priorDayForPulseLane()` comes back with `pdc:null`, `buildSpxDeskPulse` now awaits `fetchPriorDayCached()` directly as a fallback before giving up — a real blocking Polygon daily-bar read, safe here because off-hours has no fast-lane RTH latency budget to protect. `buildSpxDeskPulseMinimal` deliberately left unchanged (it guards a real RTH latency budget via `Promise.race(...400ms)`).
- **RTH/off-hours check:** After this deploys, hit `/api/market/spx/desk` off-hours (pre-market or weekend) on a FRESH ECS replica (right after a deploy/rollout, before any RTH request has warmed `lastPulseForSignals`) — the very first request should already return `price > 0` (prior-session close) rather than `0`, and `/terminal`'s SPX header should not flash `0` on first paint after a cold rollout.

### 37. Vector universe scanner — undated rows never aged out — META stuck at spot:null indefinitely — fix/vector-universe-undated-row-never-expires — 2026-09-05

- **What was broken:** `mergeUniverseSnapshot` fell back to the SNAPSHOT's own `updatedAt` to age a row with no usable `asOf` — but `updatedAt` is bumped to `Date.now()` on every 5-min refresh cycle regardless of which rows actually refreshed, so an undated row's computed age reset to ~0 every cycle it merely survived and could never cross the 15-min expiry. Live-caught: `GET /api/market/vector/universe` served `META` with `spot:null`/`asOf:null` while all 8 other universe tickers had real, fresh data, and a solo `GET /api/market/gex-heatmap?ticker=META` at the same moment returned a real spot price — proving META's own data was fine and only the universe snapshot was stuck.
- **What changed:** Added `undatedSince` to the row shape — frozen the first cycle a row goes undated (using the same `previous.updatedAt` fallback as before for that one cycle), then carried forward unchanged on every subsequent cycle instead of re-derived from the moving container timestamp. An undated row now genuinely expires after ~15 min of real elapsed time without a successful refresh.
- **RTH check:** Poll `GET /api/market/vector/universe` a few times ~5 min apart during RTH; no static-allowlist ticker (AAPL/AMZN/META/MSFT/NVDA/QQQ/SPX/SPY/TSLA) should sit at `spot:null` for more than ~20 minutes straight — a null during a genuine transient upstream blip should self-heal on the next successful build.

### 38. Ask Largo swing closed-play post-mortem — MFE capture rendered a nonsensical negative percentage on a round-trip loss — fix/swing-mfe-capture-roundtrip — 2026-09-06

- **What was broken:** Both `lessonsSection` (`play-brief-intel.ts`) and `closedCoaching` (`play-brief-narrative-coaching.ts`) computed "MFE capture" as `(exitPnlPct / peak) * 100` whenever the never-populated `mfeCapturePct` field was absent (confirmed zero producers of `mfe_capture_pct` anywhere in the codebase — it's always null in production). Live-caught on `GET /api/market/swing/play-brief` for `SWING:INTC:35`: peak +25.7%, exited -40.8%, rendered "**Gave back the move** — only **-158.9%** MFE capture" — a percentage with no honest reading once a play round-trips past breakeven into a net loss.
- **What changed:** New shared helper `mfeCaptureOutcome()` (`mfe-capture.ts`) distinguishes a real capture (non-negative exit) from a "round-trip past breakeven" (negative exit despite a positive peak) and both call sites now render an honest, specific sentence for the round-trip case instead of forcing it through the capture-percentage phrasing.
- **RTH check:** Next time a swing position closes at a net loss after having been up meaningfully at peak, confirm the closed play's brief ("Trade manager read" and any lessons/outcome section) reads "Round-tripped past breakeven — was up +X% at peak, closed at -Y%" rather than a large negative "MFE capture" percentage. Also spot-check a normal winning-exit closed play still shows the ordinary "MFE capture: N%" / "Strong discipline" / "Gave back the move" phrasing unaffected.

### 39. Ask Largo swing brief — book concentration duplicated across "Trade manager read" and "Book context" — fix/swing-remove-duplicate-book-context-coaching — 2026-09-06

- **What was broken:** PR #4110 added `bookContextCoaching()` calling the same `checkPortfolioOverlap()` as the existing `bookContextSection()` (#4101), rendering the identical concentration warning twice on one brief for any play whose ticker overlaps the member's open book by theme. Flagged with a full repro before merge (⏳ WAIT verdict) but merged anyway by `cursor[bot]` itself.
- **What changed:** Removed the duplicate `bookContextCoaching()` and its call site; `bookContextSection()` remains the single source for this check.
- **RTH check:** Open Ask Largo for a swing play whose ticker shares a theme with an existing open position (e.g. a semis name while holding AMD/SMH/NVDA) — the concentration/conflict warning should appear ONCE, in the "Book context" section, not also repeated inside "Trade manager read."

### 40. Ask Largo swing collapse — Desk context hardening + stale title cleanup (P2) — fix/swing-collapse-desk-context-hardening — 2026-09-06

- **What was broken:** #4123 fixed Book context being collapsed; #4128 removed the stale `"Desk consensus"` entry and deduped flow anomalies from `deskConsensusSection`. This PR adds inline docs + NEVER-drop regression tests so a future title rename cannot silently delete Book/Desk context again.
- **What changed:** Documented why Book context and Desk context must stay excluded from `NARRATIVE_COVERED_TITLES`; hardened regression tests.
- **RTH check:** For an OPEN/HOLD swing with NH trade history on the name, confirm "Desk context" still appears even when "Trade manager read" leads; flow anomalies appear once in Trade manager read, not again in Desk context.

### 41. Ask Largo swing play-brief — `asOf` was UTC ISO instead of ET stamp — fix/swing-play-brief-asof-et — 2026-09-06

- **What was broken:** `loadSwingPlayBriefContext()` stamped `asOf` with `new Date().toISOString()` (`…Z`), violating Largo C1 (time must be `YYYY-MM-DD HH:mm ET`). Vector/BIE tools already use `etStamp()`; the swing brief was the outlier, making cross-product freshness joins unreliable.
- **What changed:** `play-brief-context.ts` now sets `asOf` from `etStamp(nowMs)` (ISO fallback only if stamping fails).
- **RTH check:** `GET /api/market/swing/play-brief` for any swing row — response `asOf` and `envelope.asOf` should read like `2026-09-06 09:32 ET`, not a `…Z` UTC instant.

### 42. Ask Largo swing play-brief — envelope levels hardcoded `live` freshness — fix/swing-brief-vector-freshness — 2026-09-06

- **What was broken:** `levelsFromContext()` stamped Vector spot and related levels as `provenance.freshness: "live"` regardless of `vector.asOf` age; GEX walls were always `"recent"`. Off-hours cached Vector state could be 10–15 minutes old while the structured levels table still read live.
- **What changed:** Level provenance now uses `describeVectorFreshness(vec.asOf, readMs)` and `freshnessFromAgeMs` on `gex_positioning.asof`; option-mark evidence uses measured age when parseable.
- **RTH check:** Night Hawk Swings → OPEN/HOLD row → Largo brief levels table: when Vector cache is aged (>60s), spot/wall provenance should show `recent` or `stale`, aligned with the "Data freshness" section.

### 43. Ask Largo swing play-brief — cold GEX / missing Vector silent in unavailableSources — fix/swing-brief-gex-vector-absence — 2026-09-06

- **What was broken:** When `fetchEcosystemContext` succeeded but `gex_positioning` was null (cold matrix), or ecosystem loaded but neither `ctx.vector` nor `ecosystem.vector_full_state` had a live spot, GEX/Vector sections were omitted with no `UnavailableChip`. Total fetch failures were already surfaced via `ecosystemFetchFailed`/`vectorFetchFailed` (#11); cold-matrix / no-spot cases were not.
- **What changed:** `collectBriefUnavailableSources()` emits structured absence entries for cold GEX and missing Vector desk state when the upstream read succeeded but returned no usable positioning/snapshot.
- **RTH check:** Night Hawk Swings → open row → Ask Largo: when matrix is cold or Vector has no spot, confirm `UnavailableChip` shows "GEX positioning" and/or "Vector desk state" (not silent omission).

### 44. Ask Largo swing play-brief — BieLevel provenance `asOf` was raw UTC ISO — fix/swing-brief-levels-asof-et — 2026-09-06

- **What was broken:** `levelsFromContext()` stamped every `BieLevel.provenance.asOf` with raw `gex.asof` / `vec.asOf` UTC ISO (`…Z`) while evidence rows already used `etStampFromIso()` — C1 violation that broke cross-product level joins against Vector/Thermal reads carrying `as_of_et`.
- **What changed:** `levelProvenanceAsOf()` prefers `gex.as_of_et` / `vec.asOfEt`, falling back to `etStampFromIso()` on the raw ISO fields.
- **RTH check:** `GET /api/market/swing/play-brief` for any row with levels — inspect `envelope.levels[].provenance.asOf`; each must read like `2026-09-06 09:32 ET`, never a `…Z` UTC instant.

### 46. Ask Largo swing lane rank — same-ticker multi-contract collision — fix/swing-lane-rank-contract-match — 2026-09-06

- **What was broken:** `computeLaneRank()` matched peers by ticker only. NRG 110C and NRG 115C WATCH rows both attributed rank #1 to whichever row appeared first — wrong contract identity in Lane rank section and coaching.
- **What changed:** Parse strike/right from deck contract label and match lane peers by contract before falling back to ticker-only.
- **RTH check:** Open Ask Largo on a ticker with two WATCH contracts at different strikes — confirm Lane rank reflects the selected row's score position, not the other contract's.

- **What was broken:** `scanSessionDay` from the serving snapshot was never compared to the brief's `sessionDate`. A WATCH row from yesterday's scan still showed a scan timestamp with no staleness warning and no `unavailableSources` entry — discovery looked current when today's scan had not run.
- **What changed:** `collectBriefUnavailableSources()` emits a structured C3 entry when `scanSessionDay !== sessionDate`; `dataFreshnessSection()` and `dataHonestyCoaching()` narrate the same fact in prose.
- **RTH check:** Pre-open Monday (or any session before `swing-discovery` cron runs), open Ask Largo on a WATCH swing row — confirm "Data freshness" and/or `UnavailableChip` shows prior-session discovery scan warning, not a silent yesterday timestamp.

### 46. Swing entry gate — lone same-ticker row invisible to portfolio_overlap soft penalty — fix/swing-gate-portfolio-overlap-no-self-skip — 2026-09-06

- **What was broken:** `checkPortfolioOverlap`'s first-match self-exclusion (correct for Ask Largo where the reviewed play is in `openBook`) also ran for uncommitted gate dossiers. A lone pre-existing NVDA LONG in the book was skipped as "self," so `portfolio_overlap` never fired when evaluating a new NVDA LONG candidate.
- **What changed:** `checkPortfolioOverlap` accepts `{ excludeSelfMatch?: boolean }` (default `true`); `gates-pr5.ts` passes `false`.
- **RTH check:** During discovery, inspect a dossier whose ticker+direction already exists in the open book — `evaluateSwingGates` soft penalties should include `portfolio_overlap` with concentration reason text, not silence.

### 47. Ask Largo swing play-brief — HELIX pipeline staleness missing from Data freshness — fix/swing-brief-helix-freshness-section — 2026-09-06

- **What was broken:** When `flow_feed_fresh === false`, structured `unavailableSources` and `dataHonestyCoaching()` warned, but `dataFreshnessSection()` stayed silent if mark/scan/Vector were all fine — no Data freshness section at all despite stale HELIX pipeline.
- **What changed:** `dataFreshnessSection()` adds a HELIX pipeline stale line when `flow_feed_fresh === false`.
- **RTH check:** During a HELIX pipeline stale window, open Ask Largo on a swing row with fresh mark/scan/Vector — confirm Data freshness section mentions HELIX pipeline stale (not only UnavailableChip/coaching).


### 48. Ask Largo swing brief — uncalibrated thesis-health % leaked back into Verdict/Management — fix/swing-thesis-health-uncalibrated-leak — 2026-09-06

- **What was broken:** #4318 taught `thesisHealthSection()`/`holdPlanSection()` to withhold the aggregate thesis-health `%` when committed-position pillars are uncalibrated (generic defaults, not real setup/entry/signal inputs). Three OTHER call sites (`thesisStrengthPct()`, `thesisManagementOverlay()` via `swingManagementVerdict()`, `managementReason()`/`actionProbability()`) read `play.thesisHealth.health` directly with no calibration gate, leaking the exact withheld number back out through the Verdict and Management sections of the SAME brief. Reproduced live on `SWING:NN` (2026-09-06): "Thesis health" section said withheld, but Verdict showed "Thesis strength 46%" and Management showed "Thesis health 46% — Thesis fading...".
- **What changed:** Added `healthIsCalibrated(play)` gate (SWING-scoped only — 0DTE's thesis health is always live-calibrated) to all three call sites in `terminal-display.ts`, and gated `adapters.ts`'s `swingManagementVerdict()` overlay call the same way.
- **RTH check:** Open Ask Largo on any committed SWING HOLD/OPEN/TRIM row whose "Thesis health" section shows "Inputs not wired... withheld" — confirm Verdict has NO "Thesis strength X%" line and Management's recNote does NOT contain "Thesis health X%". Also check the live command-deck Conviction panel for the same row doesn't show a numeric conviction score under this condition.

### 49. Ask Largo swing brief — fabricated 45% thesis strength via thesisBreak warn fallback — fix/swing-thesis-strength-warn-fallback-leak — 2026-09-06

- **What was broken:** #4335 gated the direct `thesisHealth.health` path in `thesisStrengthPct()` but left `thesisBreak.level === "warn"` returning a hardcoded **45%** (and `break` → 15%). On uncalibrated committed SWING rows, `thesisBreak` is derived from the same generic-default health — Verdict could show `Thesis strength **45%**` while Thesis health correctly said withheld.
- **What changed:** `thesisStrengthPct()` returns `null` when `!healthIsCalibrated(play)` before any thesisBreak fallback.
- **RTH check:** Same as #48 — committed SWING row with withheld thesis health; confirm Verdict has no `Thesis strength` line and Conviction panel shows `—` not 45.

### 50. Ask Largo swing brief — GEX-only dealer posture says "Right now" on stale matrix — fix/largo-gex-stale-dealer-posture — 2026-09-06

- **What was broken:** When Vector desk state was absent and dealer posture came solely from `ecosystem.gex_positioning`, a matrix older than 120s still produced "**Right now**" in the Trade manager narrative. Vector staleness was gated; GEX `matrix_age_sec`/`asof` was ignored in narrative, Data freshness, and `unavailableSources`.
- **What changed:** Shared `gexMatrixAgeMs`/`gexMatrixStale` helpers; narrative lead uses "Last snapshot" when GEX-sourced posture is stale; Data freshness warns; `unavailableSources` emits `{ source: "GEX matrix", reason: "stale — dealer posture may lag spot" }`.
- **RTH check:** Night Hawk Swings → row with GEX positioning but no Vector regime → Ask Largo Trade manager read: when matrix is >120s old, confirm "Last snapshot (~Ns old)" not "Right now", and UnavailableChip/Data freshness mention stale GEX matrix.

### 51. Ask Largo swing brief — Meridian peer earnings cohort dropped by narrative bullet cap — fix/largo-meridian-peer-section — 2026-09-06

- **What was broken:** `fetchMeridianPeerForBrief()` loaded sector peer beat-rate cohort on earnings plays, but only `meridianPeerEarningsCoaching()` in `collectCoachingBullets()` consumed it. When Vector/GEX coaching filled `MAX_BULLETS` (14), peer earnings history could be silently dropped despite live cohort data on the read.
- **What changed:** Added `meridianPeerSection()` wired into `buildIntelSections()` as **Earnings peer lens** — outside `NARRATIVE_COVERED_TITLES`, so collapse logic cannot remove it.
- **RTH check:** Open Ask Largo on a single-name earnings swing (e.g. retail name within 14d print) with rich Vector/GEX context — confirm **Earnings peer lens** section appears with peer beat rates (`n=`) even when Trade manager read is long.

### 52. Ask Largo swing brief — "Vector regime" label read as a directional call, not dealer gamma posture — fix/swing-chart-vector-regime-gamma-label — 2026-09-06

- **What was broken:** `chartTechnicalsSection()` printed `Vector regime: **long**`/`**short**` bare — this is a dealer GAMMA regime (spot vs gamma flip), not a directional call — sitting in the same section as directional signals (EMA, MACD, structure) and right before the separate "Vector desk" section's own directional POSITION call. Live repro (`SWING:NN`): Chart technicals showed "Vector regime: long" while Vector desk showed "momentum short" for the same ticker.
- **What changed:** Relabeled to `Dealer gamma regime: **long gamma**`/`**short gamma**`/`**transition** (near flip)` — matches the labeling already used everywhere else this field is surfaced (`play-brief-narrative.ts`'s `dealerPostureLine`). No data changed, only the label.
- **RTH check:** Open Ask Largo on any swing row with a resolved Vector gamma regime — confirm "Chart technicals" reads "Dealer gamma regime: X gamma", never a bare "Vector regime: long/short" that could be misread as contradicting the Vector desk section's directional call.

### 53. Ask Largo swing brief — Benzinga headlines leak raw HTML entities into Catalysts & news — fix/swing-arsenal-news-headline-html-entities — 2026-09-06

- **What was broken:** Benzinga news headlines (via the Polygon-keyed feed) arrive HTML-entity-encoded; `assembleEcosystemArsenal()` mapped `headline` straight into `arsenal.news.headlines` with no decode step, so the swing brief's "Catalysts & news" section literally rendered `&#39;`/`&amp;` instead of `'`/`&`. Live repro (`SWING:NN`, 2026-09-06): "Tuesday&#39;s Intraday Session", "Safran Electronics &amp; Defense". Same class of bug `meridian-feed-text.ts` fixed for the Meridian desk on 2026-08-21, missed here because this call site feeds the swing brief instead.
- **What changed:** Headlines now run through the existing `sanitizeFeedText()` decoder before reaching `arsenal.news.headlines` — same decoder Largo tool answers and the Meridian desk already use.
- **RTH check:** Open Ask Largo on any swing row with recent ticker news containing an ampersand or apostrophe in the headline (or in an FDA/M&A-channel market catalyst) — confirm "Catalysts & news" renders the plain character, never a raw `&amp;`/`&#39;`/`&lt;` entity.

### 54. Ask Largo swing brief — stale GEX-only wall levels still steelman counter-thesis — fix/largo-gex-stale-wall-steelman — 2026-09-06

- **What was broken:** `counterThesisLine()`'s call-wall/put-wall steelman reasons read `eco.gex_positioning.call_wall`/`put_wall` with no staleness gate when no live Vector wall was present — a >120s-old GEX matrix could still steelman "call wall X overhead" as a counter-thesis reason, the same dishonesty class #4355/#4360 fixed for dealer posture. Flagged by Cursor's peer review on #4360 as a follow-up.
- **What changed:** Gated each wall independently (`callWallFromStaleGex`/`putWallFromStaleGex`) — suppresses only the side whose wall came from the stale GEX-only fallback, so a live Vector wall on one side still steelmans even when the other falls back to stale GEX.
- **RTH check:** Open Ask Largo on a swing row with GEX positioning but no Vector wall data, matrix >120s old — confirm "Trade manager read"'s Counter-thesis line does not cite a call/put wall as a steelman reason.

### 55. Ask Largo swing brief — stale GEX-only gamma posture drove GEX-king narration — fix/largo-gex-stale-posture-magnet-king — 2026-09-06

- **What was broken:** `narrateKing`/`narrateMagnet` resolved `posture` inline as `vec?.regime?.posture ?? ecosystem.gex_positioning?.gamma_posture ?? null` with no staleness gate — a fifth instance of the same class #4360/#4364/#4367/#4372 fixed elsewhere on this read path. A Vector-sourced (live, fresh) king strike could still get its "Pin risk" vs "acceleration" directional call from an independently-stale GEX-only `gamma_posture` read.
- **What changed:** Shared `resolveGammaPosture(ctx, vec)` helper — live Vector regime always wins; GEX-only fallback suppressed once `gexMatrixStale()`. Both `narrateKing` and `narrateMagnet` call sites now go through it.
- **RTH check:** Open Ask Largo on an open swing position whose GEX king strike is Vector-sourced (live) while `gex_positioning.matrix_age_sec` is independently stale (>120s) — confirm the king-strike line reads "Max-gamma node" (posture-unknown), not a confident "Pin risk" call.

### 56. Ask Largo swing brief — envelope GEX provenance ignored matrix_age_sec — fix/largo-gex-freshness-matrix-age-sec — 2026-09-06

- **What was broken:** `gexFreshness()` in `play-brief.ts` derived envelope provenance freshness only from `gex.asof`, ignoring `matrix_age_sec` that every other GEX staleness gate on the swing path uses. When `asof` was recent but `matrix_age_sec` > 120s, narrative sections correctly treated the matrix as stale while BIE envelope evidence still labeled dealer posture as **live**.
- **What changed:** `gexFreshness()` now routes through shared `gexMatrixAgeMs()` — same age source as `gexMatrixStale()` and `unavailableSources`.
- **RTH check:** Pull `GET /api/market/swing/play-brief` for a position where `gex_positioning.matrix_age_sec` > 120 but `asof` is recent — confirm envelope dealer-posture evidence provenance is not `live` (should be `recent` or `stale` per age).

### 57. Ask Largo swing brief — stale GEX-only flip qualified live dealer posture — fix/largo-gex-stale-dealer-posture-flip — 2026-09-06

- **What was broken:** `dealerPostureLine()` took `flip = vec?.gammaFlip ?? gex?.flip` with no staleness gate. Live Vector `regime.posture` could render under **"Right now"** while a stale GEX-only `flip` still appeared in the `γ-flip` suffix — sixth instance of the Largo C2 stale-GEX class on this read path.
- **What changed:** Per-value stale GEX gating on flip (mirrors break-watch/counter-thesis/focal-levels): suppress flip when from stale GEX-only fallback; live Vector `gammaFlip` still wins.
- **RTH check:** Open Ask Largo on a swing with live Vector dealer posture but no Vector flip, GEX matrix >120s old — confirm "Trade manager read" dealer line shows posture without a `γ-flip` cite.

### 58. Ask Largo swing brief — magnet coaching claimed "long-gamma regime" regardless of measured posture — fix/largo-magnet-coaching-posture — 2026-09-06

- **What was broken:** `magnetCoaching()` hardcoded "Dealer hedging center of mass — price gravitates here in long-gamma regimes." for any far-from-spot gamma magnet, never consulting actual measured posture. Live repro (`SWING:NRG`, 2026-09-06): the same brief's own dealer-posture line said "dealers **short gamma**" while the magnet line asserted a long-gamma regime — an internally contradictory, factually wrong claim (not a staleness issue — both reads were fresh).
- **What changed:** `magnetCoaching()` now takes `ctx` and resolves posture via the shared `resolveGammaPosture(ctx, vec)` helper (relocated to `play-brief-absence.ts`); when posture isn't measured "long" it now says "Pivot node — acceleration risk if the magnet fails to hold." instead.
- **RTH check:** Open Ask Largo on an open swing position with a far gamma magnet (>1.2% from spot) while the desk's dealer-posture line reads "short gamma" or unresolved — confirm the magnet line says "Pivot node — acceleration risk", never "long-gamma regimes".

### 59. Ask Largo swing brief — Vector desk intel-card bias chip ignored snapshot staleness — #4388 — 2026-09-06

- **What was broken:** `vectorDeskSection()` stamped the intel-card `bias` chip straight from `vec.play.bias` with no staleness gate — seventh/eighth instance of the Largo C2 class on this read path (#4387 had already gated the same `play.bias` value inside the narrative-coaching call sites `crossDeskCoaching`/`vectorPlayCoaching`, but this separate `play-brief-intel.ts` intel-card path was missed).
- **What changed:** `vectorDeskSection()` now gates the bias chip behind `!vectorSnapshotStale(vec)` — same shared helper #4387 uses. Stale → `neutral`; body/headline content unaffected.
- **RTH check:** Open Ask Largo on a swing row whose Vector snapshot is stale (>120s / `freshness: "stale"`) but still carries a directional `play.bias` — confirm the Vector desk intel card's bias chip reads neutral, not bullish/bearish.

### 60. Ask Largo swing brief — chart-read narrative silently dropped the dissenting MACD vote — fix/swing-technicals-coaching-omits-macd — 2026-09-06

- **What was broken:** `technicalsBias()` computes "chart reads bullish/bearish" from four votes — emaStack, MACD, spot-vs-VWAP, structure direction — but `technicalsCoaching()`'s printed "Chart read" line only ever surfaced three of them (VWAP, RSI, emaStack, structure), never MACD. A MACD vote that dissented from the printed verdict (live repro, `SWING:NRG` 2026-09-06: bear MACD inside an otherwise 3-bull read) was invisible — the narrative said "chart reads bullish" with no way to see one of its own four inputs disagreed, even though the raw "Chart technicals" section on the same brief plainly showed `MACD: bear`.
- **What changed:** Added `MACD **bullish**/**bearish**` to the `parts` list `technicalsCoaching()` renders, using the same phrasing convention `vector-desk-intel.ts` already uses for MACD elsewhere. `technicalsBias()` itself was untouched — only the narrative's transparency into its own scoring was incomplete, not the scoring itself.
- **RTH check:** Open Ask Largo on any swing row where Vector's MACD read disagrees with its other three technicals inputs (e.g. bear MACD inside an up-EMA-stack/above-VWAP/up-structure bullish read) — confirm the "Trade manager read" → "Chart read" bullet explicitly names the MACD reading, not just the winning votes.

### 61. Ask Largo swing brief — 7 coaching helpers + wall-dynamics section + trade-manager proximity/wall bullets + stale Vector spot still narrated off stale snapshots — #4411 — 2026-09-06

- **What was broken:** #4400–#4402 gated `chartTechnicalsSection`, `chartLevelsSection`'s walls, `watchForSection`'s walls, `vectorDeskSection`, `vectorPlayCoaching`, `collectFocalLevels`'s king strike, and `counterThesisLine`'s walls against `vectorSnapshotStale()` — but seven coaching helpers in `play-brief-narrative-coaching.ts` (`magnetCoaching`, `expectedMoveCoaching`, `confluenceCoaching`, `wallIntegrityCoaching`, `vexCoaching`, `flowPrintsCoaching`, `wallDynamicsCoaching`) still narrated directional/level content straight off `vec.*` with no staleness check. `wallDynamicsSection` (the intel-section counterpart) had the identical gap, `tradeManagerNarrativeSection`'s "Nearest wall"/"Wall just moved" bullets were ungated, and — a level below any of the above — a stale Vector **spot** could still win over a live GEX spot at the source in `chartLevelsSection`, `watchForSection`, `levelsFromContext` (`play-brief.ts`), and `tradeManagerNarrativeSection`'s own spot resolution, silently propagating a stale price into every level/break-trigger computed downstream of it. Multiple parallel PRs (#4404-#4407, #4413) converged on parts of this gap; #4411 was independently verified as the superset (785/785 tests pass, tsc clean) and merged over the others to avoid a duplicate/conflicting landing.
- **What changed:** Added `vectorSnapshotStale()` early-return gates to all 7 coaching helpers and to `wallDynamicsSection`; gated `tradeManagerNarrativeSection`'s proximity/wall-event bullets; nulled stale Vector spot **at the source** (not via a separate suppression flag) in `chartLevelsSection`, `watchForSection`, `levelsFromContext`, and `tradeManagerNarrativeSection` so a live GEX spot still falls through via `??`; added a null-spot guard on `breakTrigger`/`dealerPostureLine`'s flip resolution so a fully-stale-Vector, GEX-absent row degrades cleanly instead of computing off `undefined`.
- **RTH check:** Open Ask Largo on a swing row with a stale Vector snapshot (>120s / `freshness: "stale"`) carrying a gamma magnet, expected-move band, confluence zone, wall-integrity tier, VEX flip, flow print, or wall-dynamics event — confirm none of those coaching bullets render, and that the Trade manager read's "Nearest wall"/"Wall just moved" bullets are absent. Separately, on a row where Vector is stale but GEX has a live spot/wall for the same level, confirm the level still renders (sourced from GEX), not dropped entirely.

### 62. Ask Largo swing brief — stale GEX-only spot could still surface in trade-manager narrative + no GEX-matrix-age caveat in data-honesty coaching — #4415 — 2026-09-06

- **What was broken:** #4411 nulled stale Vector spot at source in `tradeManagerNarrativeSection` but still fell through to `gex_positioning.spot` unconditionally, so a stale GEX matrix (Vector also stale/absent) could still print `Spot **X.XX**` in the unresolved-posture line with no freshness caveat — the same Largo C2 class #4401/#4411 fixed for walls/flip, just left open for spot's GEX-side fallback. Separately, `dataHonestyCoaching` warned on Vector age and HELIX pipeline staleness but never on GEX matrix age, even though `dataFreshnessSection` already surfaces that caveat elsewhere — so a collapsed intel layout could miss it in the Trade manager read specifically.
- **What changed:** Null `gex?.spot` at source when `gexMatrixStale()` in `tradeManagerNarrativeSection` (same null-at-source pattern as #4401/#4411) — when both Vector and GEX are stale, spot resolves to absent rather than a stale price. Added a `GEX matrix **Ns** stale — dealer posture may lag spot` line to `dataHonestyCoaching` when matrix age exceeds 120s.
- **RTH check:** Open Ask Largo on a swing row where both the Vector snapshot and the GEX matrix are stale (>120s) — confirm the Trade manager read's posture line shows no spot price (not a stale one), and confirm the "Data honesty" coaching bullet explicitly names the GEX matrix staleness, not just Vector/HELIX.

### 63. Ask Largo swing brief — chart-technicals body still rendered in full under a stale-Vector "Last snapshot" prefix — #4414 — 2026-09-06

- **What was broken:** `chartTechnicalsSection()` prefixed a stale Vector read with "Last snapshot" but still rendered the full body — Spot, EMA 9/21/50 stack, VWAP, RSI, MACD, structure, and dealer gamma regime — as if live; only the section's `bias` chip was neutralized (#4387/#4402). The regression coverage at the time only checked bias + prefix, so a stale snapshot could still narrate a confident-looking technicals readout under a caveat nobody would read past.
- **What changed:** Mirrored `vectorDeskSection()`'s early-return pattern — when stale, the section now returns only the age caveat plus, if present, the desk grade labeled "(from prior snapshot)"; the live path (full technicals body) is unchanged.
- **RTH check:** Open Ask Largo on a swing row with a stale Vector snapshot (>120s) — confirm "Chart technicals" shows only the "Last snapshot (~Ns old)" caveat (and, if present, a "(from prior snapshot)"-labeled grade), never Spot/EMA/VWAP/RSI/MACD/structure/gamma-regime lines.

### 64. Ask Largo swing brief — stale GEX-only spot still drove level-formatting and flip-watch lines — #4419 — 2026-09-06

- **What was broken:** #4415 nulled stale GEX spot at source in `tradeManagerNarrativeSection`, but `chartLevelsSection`, `watchForSection`, and `levelsFromContext` (`play-brief.ts`) still resolved `vec?.spot ?? gex?.spot` unconditionally — a stale GEX matrix (with Vector also stale/absent) could still drive wall-distance percentage strings or enable flip-watch lines off an aged spot price.
- **What changed:** Suppressed `gex?.spot` at each of the three remaining spot-resolution sites when `gexMatrixStale()`, mirroring #4415's pattern exactly; `levelsFromContext` reuses the function's already-in-scope `gexStale` variable rather than recomputing it.
- **RTH check:** Open Ask Largo on a swing row where both Vector and the GEX matrix are stale (>120s) — confirm "Chart levels", "What to watch", and the envelope's `levels` array do not show a numeric spot or a flip-watch line derived from the stale GEX fallback.

### 65. Ask Largo swing brief — prior-session 0DTE stance could drive cross-desk friction after close or before board refresh — #4424 — 2026-09-06

- **What was broken:** `crossDeskCoaching`, `counterThesisLine`, and `flowIntelSection` consumed `eco.zerodte_today` whenever non-null, without verifying `zerodte_today.session_date === ctx.sessionDate` — the same Largo C2 dishonesty class already fixed for Vector snapshots and stale GEX matrix reads, but for 0DTE cross-desk stance specifically. After the close or before today's 0DTE board refreshes, yesterday's short/long 0DTE stance could still produce live-looking cross-desk friction lines in the swing brief.
- **What changed:** Added shared `zerodteLiveForSession(z, sessionDate)` in `play-brief-absence.ts` — nulls the 0DTE take when its `session_date` doesn't match the brief's session date. Gated all three call sites (`crossDeskCoaching`, `counterThesisLine`, `flowIntelSection`) through it. Also fixed a CodeQL-flagged unused import (`gexMatrixAgeMs`) introduced in the same PR.
- **RTH check:** Off-hours or before the 0DTE board's first refresh of the session — confirm the swing brief's cross-desk coaching and flow-intel sections do not cite yesterday's 0DTE short/long stance as live cross-desk friction.

### 66. SPX Slayer desk_context countdowns rendered live on an NYSE holiday — fix/spx-play-desk-context-holiday-gate — 2026-09-07

- **What was broken:** `GET /api/market/spx/play`'s `desk_context` sub-object (`minutes_to_close`, `minutes_to_no_entry`, `minutes_to_force_exit`) was gated by `isEtWeekday` (Sat/Sun only) instead of `isTradingDayEt` (weekday AND not an NYSE holiday). Live repro on Labor Day 2026-09-07 (a Monday): `desk_context.minutes_to_close: 97` rendered at 14:21 ET in the same payload whose top-level `gates.blocks` already said `["Session closed"]`.
- **What changed:** Swapped the gate to `isTradingDayEt(formatEtDate(now))` in all three countdown helpers in `spx-play-context.ts` — same helper `isSpxEngineCronWindow` already uses for the equivalent check elsewhere in this feature.
- **RTH check:** On the next NYSE holiday that falls on a weekday, confirm `GET /api/market/spx/play`'s `desk_context.minutes_to_close`/`minutes_to_no_entry`/`minutes_to_force_exit` are all `null` throughout the day. On an ordinary trading day, confirm they still count down normally during RTH (the control case this fix's regression test also covers).

### 67. Ask Largo swing brief — mark/stop-premium rounded to a whole dollar, contradicting the same field elsewhere in the same brief — fix/largo-swing-premium-format — 2026-09-07

- **What was broken:** Live-fetched `SWING:NRG` brief (2026-09-07, holiday, Vector spot unwired): Position section showed `Mark: **+$9.70**` while the Trade-manager-read section's "Live read" bullet showed `mark **$10**` for the identical `play.mark` field — and the Management section's `Rails: stop +$1.96` sat beside a "Break watch — lose premium stop **$2**" bullet from the identical `exitPolicy.stop_premium` field. Root cause: `play-brief-narrative.ts` had its own `fmtUsd` built for FLOW/aggregate dollar amounts (whole-dollar/k/M, correct for HELIX/dark-pool premium in the hundreds-of-thousands+ range) and reused it for per-contract option premiums, where cents are a large fraction of the number — a different, precise 2-decimal `fmtUsd` already lives in `play-brief.ts` for exactly this and was not the one used.
- **What changed:** Added `fmtOptionUsd` (2-decimal, signed) in `play-brief-narrative.ts` and switched the three per-contract-premium call sites (`degradedReadLine`'s mark, `tradeManagerNarrativeSection`'s `stop_premium` fallback break-watch line, `railsFallback`'s stop/target) to it. Flow/aggregate call sites (HELIX tape, dark-pool premium) were left on the original `fmtUsd` — those correctly want whole-dollar/k/M scaling.
- **RTH check:** Open Ask Largo on any live OPEN swing position with a fresh mark — confirm the dollar figure for mark/stop/target reads identically (same digits, same precision) in the Position section, the Management section's "Rails" line, and the Trade-manager-read section's "Live read"/"Break watch" bullets.

### 68. Ask Largo swing brief — HELIX flow evidence used raw dollars while narrative used k/M — fix/largo-helix-flow-premium-format — 2026-09-07

- **What was broken:** HELIX 24h flow aggregate appeared as `+$1000000.00` in envelope evidence while the Trade-manager-read / Flow intel sections showed `$1.0M` for the same `call_premium` field — Largo contract precision violated within one brief.
- **What changed:** Routed HELIX aggregate flow and dark-pool notional formatting through `fmtPremium` from `@/lib/fmt-money` in `play-brief.ts`, `play-brief-intel.ts`, and `play-brief-narrative.ts` (via `fmtFlowUsd` wrapper).
- **RTH check:** Open Ask Largo on a swing row with HELIX flow >$100k — confirm evidence chips and trade-manager narrative show identical k/M strings (e.g. both `$1.2M`, not mixed with `$1200000.00`).

### 69. Ask Largo swing brief — "Vector desk" section rendered a live, actionable directive on CLOSED plays — fix/closed-vector-desk-live-recommendation — 2026-09-07

- **What was broken:** Live repro across four CLOSED swing chains (CCI/AMZN/GLW/NOW, 2026-09-07): `vectorDeskSection()` had no `bucket` parameter and rendered the full CURRENT Vector directive block — entry zone, targets, invalidation, starred "Watch now" call — bullish/bearish-badged, on a play that already closed days earlier. Same defect class as the "Watch levels" fix immediately preceding this one, in a different section that was never made bucket-aware to begin with.
- **What changed:** `vectorDeskSection` now takes a `bucket` param; for `"closed"` it renders only an informational grade/conviction line framed "since this play closed" with a forced neutral bias, dropping thesis/entryZone/targets/invalidation/starred entirely. Watch/open buckets are unchanged.
- **RTH check:** Open Ask Largo on any CLOSED swing position — confirm "Vector desk" shows only a neutral "since this play closed" grade line, never an Entry zone/Targets/Invalidation/"Watch now" block, and never a bullish/bearish bias badge.

### 70. Night Hawk 0DTE — whole-market discovery/commit gates loosened for volume — fix/loosen-nighthawk-discovery-gates — 2026-09-08

- **What was broken (operator-reported):** whole-market 0DTE produced ~1 committed play for the entire session, repeatedly flagged by the operator as evidence the discovery/gate architecture itself was too tight.
- **What changed:** Loosened 10 pure count-limiting knobs with no direct negative-EV evidence tied to the specific number raised — `ZERODTE_CONFLUENCE_MIN` (G-12) 2→1, `CONFLICT_SCORE_FLOOR` (G-6) 65→55, `SETUP_MIN_GROSS` $200k→$150k, `SETUP_MAX_OTM_PCT`/`RUNNER_SETUP_MAX_OTM_PCT` 12%/20%→16%/26%, `GOVERNOR_MAX_SESSION_STOPS` 3→4, `GOVERNOR_REENTRY_LOCK_MS` 20m→10m, the `breakout-cap.ts` dynamic-N ceiling/pool-pct 150/0.30→220/0.40, and `BREAKOUT_MIN_VOLUME`/`BREAKOUT_MIN_GAIN` 1M/3%→750k/2%. Deliberately left `ZERODTE_SCORE_FLOOR`/`_BREAKOUT`/`_PIN` (65), `ZERODTE_SINGLE_RAIL_PRIME_MIN` (75), and `GOVERNOR_MAX_CORRELATED_SAME_DIR` (2) untouched — those specific bands have their own direct, recently-measured negative-EV evidence (F-2, the G-17 90-day re-run, and the 2026-07-30 concentration incident respectively). See the staged finding for the full per-knob table and rationale.
- **RTH check:** Compare committed-play VOLUME (not just presence) across the whole 0DTE board for the first full session after this ships against recent pre-change sessions — confirm meaningfully more than 1 play/day market-wide while spot-checking a sample of the newly-admitted plays for obviously bad geometry (e.g. a 20-26% OTM runner-relax play) that the wider caps might have let through. Also confirm the 4th-stop session halt and 10-minute re-entry lock are firing at the new thresholds, not the old ones (CloudWatch `/ecs/blackout-production`, `governor_session_stops`/`governor_reentry_lock` block reasons).

### 71. Night Hawk Swings — whole-market discovery-pool gates loosened for volume — fix/loosen-swing-discovery-gates — 2026-09-08

- **What was broken (operator-reported):** whole-market swing discovery produced too few candidates, same complaint as the companion 0DTE fix, in the same breath ("0dte and swings should have had more plays... the entire architecture on these 2 engines is broken") — separate from the persistence/corroboration promotion gate already loosened earlier this session (finding `2026-09-08-swing-persistence-loosened-standard-archetypes.md`), this addresses the upstream discovery pool: how many candidates ever get scored at all.
- **What changed:** Raised the dynamic Tier-1 cap (the single biggest lever — everything else in the swing pipeline sees only what survives it) ceiling/pool-pct 200/0.35→300/0.45; lowered `swingCorroboratedFlowMinPremium`/`swingLegacyFlowMinPremium` $150k/$250k→$100k/$175k; raised `swingCortexPreflightCap` 12→20 (hard ceiling 25 unchanged); raised `maxStructureMovers` 40→60; raised the Vector-leader fetch limit feeding POSITIONING/VECTOR origins 80→110 alongside `positioning-screen.ts`'s own ticker slice 60→90 (kept in lockstep so the downstream cap doesn't become the new bottleneck); lowered the BANGER-origin screen's `minVol`/`minGain` 1M/5%→750k/4%. Shares the `BREAKOUT_MIN_VOLUME`/`BREAKOUT_MIN_GAIN` edit in `candidates.ts` with the companion 0DTE fix (`fix/loosen-nighthawk-discovery-gates`, #4608) — same file, same change, not a conflict.
- **RTH check:** Compare WATCH-tier candidate volume for the first full session after this ships against recent pre-change sessions — confirm meaningfully more candidates reach Tier-1 scoring. Spot-check that the wider Vector-leader/positioning pool didn't silently truncate anywhere (compare `cappedOut`/recall instrumentation counts, `discovery.ts`, against the new ceiling rather than the old one).

### 72. NEW TOOL — 0DTE gate-compound funnel: measure the real joint bottleneck, not another guess — feat/zerodte-gate-compound-funnel — 2026-09-08

- **Why:** the 2026-09-08 gate-loosening pass (#4608/#4610) turned ~10 individual knobs without ever measuring whether any single knob was the actual bottleneck, or whether the real problem is ~15 independently-tuned gates compounding multiplicatively when a setup must clear all of them at once. `scripts/audit/zerodte-gate-compound-funnel.mjs` closes that gap: real `deriveZeroDteSetups` + real `evaluateZeroDteGates` fed real UW flow / VIX / Polygon intraday data, reporting per-gate ISOLATED failure incidence alongside the JOINT commit rate.
- **First run (off-hours, `--now-et=11:00` synthetic RTH clock):** 1377 raw UW alerts → 15 setups survived the evidence gates → **0/15 cleared every hard gate jointly**. `score_floor` 80%, `confluence_floor` 60%, `no_market_bias`/`single_rail_corroboration` 20% each. Confirms the joint-compounding hypothesis even at this small off-hours sample.
- **RTH check:** re-run `node --import tsx scripts/audit/zerodte-gate-compound-funnel.mjs --days=3` LIVE during RTH (no `--now-et` override needed) once the market opens, and compare the joint-pass rate against this off-hours baseline — a representative live sample is the actual next step in deciding whether the 2026-09-08 gate-loosening pass touched the real bottleneck or whether a structural fix (percentile floors, joint-gate-aware tuning, time-of-day pacing) is still needed. Also worth widening `--max-tickers` for a bigger sample once real RTH flow volume is available.

### 73. Ask Largo swing brief — `invalidation` showed the same generic halt-feed gate reason for every gate-blocked ticker — fix/swing-invalidation-generic-halt-gate-reason — 2026-09-09

- **What was broken:** Standing Ask Largo cycle, live check of three gate-blocked WATCH swing setups (`SWING:NBIS`, `SWING:CRCL`, `SWING:MU`, all pending on the G-S12 halt/LULD-feed gate at the time): all three returned the LITERAL SAME string in `envelope.invalidation` — "Trading-halt feed unavailable — desk will not open until halt/LULD data recovers." — rendered as the UI's labeled "Invalidation" callout. `play-brief.ts` fell straight from `thesisBreak` to `play.gateBlocks?.[0]?.reason`, and G-S12 is a system-wide operational gate that fails identically for every ticker when the halt feed is cold, even though each of the three briefs already computed a real per-ticker technical level (gamma flip / put wall) elsewhere in the same response.
- **What changed:** Exported `resolveBreakInvalidation()` from `play-brief-narrative.ts` (the same staleness-guarded level computation the "Trade manager read" narrative's own "Break watch" bullet already used internally) and wired it into `play-brief.ts`'s `invalidation` fallback ahead of the raw gate reason. Gate reason / premium-stop fallbacks unchanged for when no real level is computable at all.
- **RTH check:** Next time the board is carrying gate-blocked WATCH setups (any `commitGateBlockedBy`/`gateBlocks` non-empty), pull 2-3 of their play-briefs and confirm `envelope.invalidation` differs per ticker (references a real price level — gamma flip, put/call wall, or structural support — that matches `envelope.levels` for that same ticker) rather than repeating one identical operational-gate sentence across all of them. If the halt feed is healthy at that point (no G-S12 block to reproduce with), the same check applies to whichever gate is first in `gateBlocks` for any live WATCH row.

### 74. Ask Largo swing brief — Chart-read VWAP-vs-spot clause stated the relationship backwards — fix/swing-brief-vwap-spot-label-inverted — 2026-09-09

- **What was broken:** Live `SWING:POET` brief (2026-09-09, off-hours): the "Trade manager read" section's `Chart read` line printed `VWAP **8.44** (below spot)` while the same brief's separate "Chart technicals" section printed the correct `VWAP 8.44 — price below session VWAP` for the identical spot 8.38 / vwap 8.44 pair — i.e. spot is below vwap, so VWAP is genuinely ABOVE spot, and the Chart-read clause said the opposite. `technicalsCoaching()` (`play-brief-narrative-coaching.ts`) computed `above = spot >= vwap` (answers "is spot at/above vwap") and fed it straight into a label claiming to describe "is VWAP above/below spot" — the two facts are inverses, so every brief's Chart-read VWAP clause was backwards. The overall bullish/bearish chart verdict itself (`technicalsBias()`) was NOT affected — only this one display clause.
- **What changed:** Swapped the ternary in `technicalsCoaching()` so the printed word matches the fact named (`spot >= vwap` → "below spot", correctly describing where VWAP sits). No change to bias/vote math or any other section.
- **RTH check:** Open Ask Largo (or `GET /api/market/swing/play-brief`) on any OPEN/WATCH swing play with a live Vector snapshot during RTH — confirm the "Chart read" line's VWAP clause (`(above spot)` / `(below spot)`) agrees with the separate "Chart technicals" section's `price above/below session VWAP` line for the same numbers, on both a spot-above-vwap and a spot-below-vwap ticker.

### 75. Ask Largo swing brief — entry/mark/stop/target premium prices carried a spurious "+" sign, including on the stop-loss trigger — fix/swing-brief-premium-sign-format — 2026-09-09

- **What was broken:** live `SWING:NN:32` brief (open, −30.8% P&L) rendered `Entry: **+$1.95**` / `Mark: **+$1.35**` in the Position section and `Rails: stop +$0.78 · target +$3.90` in Management — a "+" on every absolute premium price regardless of whether the position was up or down, including the stop-loss trigger itself, which reads as a gain when hitting it is a ~60% loss. Root cause: `play-brief.ts`'s file-local `fmtUsd` was a signed-delta formatter (`n >= 0 ? "+" : ""`) misapplied to an absolute price (never negative to begin with).
- **What changed:** Dropped the sign branch from that `fmtUsd`, matching the already-correct sign-free absolute-price formatter in `play-brief-intel.ts`. Contained to the one file; percentage fields (P&L/Peak/trim triggers) untouched.
- **RTH check:** Open Ask Largo on any live OPEN/HOLD/TRIM swing position — confirm the Position section's `Entry:`/`Mark:` and the Management section's `Rails: stop … · target …` never show a `+` before the `$`, on both winning and losing positions (a losing position is the sharper check, since that's where the old "+" was most misleading).

### 76. Night Hawk 0DTE — a live COMMIT could print off a gate verdict the library correctly, but honestly, could not have verified — fix/zerodte-live-commit-preconditions — 2026-09-09

- **What was broken:** `evaluateZeroDteGates` deliberately fails OPEN on four specific reads when they are absent — G-9's quote-age timestamp, G-12's confluence read, and both G-20 legs' cross-input timestamps (`#4621`/`#4646`) — so a generic/test/fixture caller isn't penalized for a gap that was never real. Correct for the pure library, but nothing distinguished that generic case from the ONE caller that actually commits real capital (`persistZeroDteScan`): a live setup whose verdict was `COMMIT` only because one of those reads was never actually present could print unverified, even though the gate itself had nothing to check.
- **What changed:** New `liveCommitPreconditionsUnmet`/`liveCommitPreconditionBlock` (`gates.ts`) — a separate, additional check computed alongside (never inside) the gate verdict, scoped identically to each underlying gate. Wired into `scan.ts`'s `attachGateVerdicts` (both the ordinary and thesis-first deferred-refresh call sites) and, at the actual live-commit decision point in `persistZeroDteScan`, downgrades a `COMMIT` verdict to `BLOCKED` (new distinct code `live_commit_precondition_unmet`, `board.ts`) when any precondition is unmet — additively alongside the pre-existing plan-quality downgrade. `evaluateZeroDteGates`'s own behavior is unchanged for every other caller (regression-tested).
- **RTH check:** In steady-state live traffic the four reads are almost always present (a live quote batch carries `quoteAgeMs`, confluence is attached to every setup before gating, `underlying_price_as_of` is stamped whenever the batch snapshot returns a usable underlying), so this fix is EXPECTED to have no visible effect on committed-play volume or win rate for a normal session — confirm exactly that: compare first-session-after-ship committed-play count against recent pre-change sessions, expect no meaningful change. Separately, grep CloudWatch Logs (`/ecs/blackout-production`) and/or `zerodte_scan_rejections` for the new `live_commit_precondition_unmet` code — if it appears at all, pull that specific rejection's `blocks`/`reason` and confirm it correctly names which of the four reads (quote age / confluence / SPY-tape timestamps / underlying-quote timestamps) was actually missing for that setup, and that the setup did NOT also appear as a committed row that session (the downgrade must be exclusive with a commit, never both).

### 77. Ask Largo swing brief — the same Vector-vs-swing conflict was restated as three separate facts in one document — fix/swing-narrative-vector-conflict-dedup — 2026-09-09

- **What was broken:** `crossDeskCoaching`, `vectorPlayCoaching` (both `play-brief-narrative-coaching.ts`), and `counterThesisLine` (`play-brief-narrative.ts`) each independently derive the same Vector-vs-swing-direction misalignment from the same `vec.play.bias`/`play.direction` inputs, with zero cross-awareness. Live `SWING:NRG` brief (2026-09-09): all three fired for the same Vector conflict, so the "Trade manager read" section stated the identical fact three times — `Cross-desk friction — Vector bearish (...)`, then `Vector desk: ... — cross-check Vector thesis vs swing direction`, then `Counter-thesis (bear case) — Vector bearish (...)` — the exact "bullet dump instead of a trade manager" pattern the standing Ask Largo mandate calls out.
- **What changed:** Threaded a boolean through the composition pipeline: `collectCoachingBullets` computes `crossDeskCoaching`'s result first and passes whether it already named a Vector conflict into `vectorPlayCoaching` (which still shows its own headline/invalidation, only drops the redundant "cross-check" clause); `tradeManagerNarrativeSection` checks the already-built bullet list the same way before calling `counterThesisLine` (which still shows its OTHER independent reasons — EMA stack, GEX walls, fading pillar — only drops the redundant Vector-specific one).
- **RTH check:** Next time a live swing position has a genuinely misaligned Vector desk read (`vec.play.bias` opposite the swing's direction), pull that ticker's play-brief and confirm the "Trade manager read" section states the Vector disagreement bullet exactly once (in the `Cross-desk friction` bullet, with `Vector desk:`'s own bullet keeping its headline/invalidation but omitting `cross-check`, and `Counter-thesis` — if it fires — omitting the Vector-specific reason while keeping any other independent reasons present that session).

### 78. Ask Largo swing brief — closed-play "round-tripped past breakeven" fact restated verbatim across "Trade manager read" and "Lessons" — fix/swing-lessons-roundtrip-dedup — 2026-09-09

- **What was broken:** `closedCoaching` (feeds "Trade manager read") and `lessonsSection` (feeds "Lessons") both independently derive the same round-trip-past-breakeven fact from the same peak/exitPnlPct via the same `mfeCaptureOutcome` helper, with zero cross-awareness. A live AAPL closed-play brief rendered the identical "Round-tripped past breakeven — was up +1.3% at peak, closed at -56.2%" sentence in both sections.
- **What changed:** `buildIntelSections` already computes the "Trade manager read" `RichSection` before calling `lessonsSection` — threaded a `roundTripAlreadyNoted` boolean (checking the already-built narrative body for the sentence) into `lessonsSection`, suppressing only the redundant sentence while keeping the rest of "Lessons" (gave-back-the-move coaching, exit reason, archetype tag) unchanged.
- **RTH check:** Pull a live CLOSED swing play brief whose exit round-tripped past breakeven (peak positive, exit negative) and confirm the "Round-tripped past breakeven" fact appears exactly once across the whole document (in "Trade manager read"), not duplicated in "Lessons". Separately confirm "Lessons" for a NON-round-trip closed play (e.g. a clean MFE-capture exit) is unaffected — this fix must not suppress the sentence when "Trade manager read" never said it.

### 79. Ask Largo swing brief — DTE-runway context silently deleted for any live position with DTE > 7 — fix/swing-manage-plan-dte-runway-gap — 2026-09-09

- **What was broken:** `holdPlanSection`'s "Contract runway" DTE/theta fact is collapsed out of the envelope whenever a "Trade manager read" narrative is present, on the claim it's "folded into Trade manager read above" — but the narrative's own DTE line (`manageLifecycleCoaching`) only fired at `dte<=7`, so any live position with DTE > 7 lost the fact entirely (not deduped — deleted, with the collapse note falsely claiming it survived). Live repro: a 9DTE CRWD brief's 17-bullet "Trade manager read" section had no DTE mention anywhere.
- **What changed:** `manageLifecycleCoaching` now always includes a DTE line — the existing `**N DTE** — theta accelerating; don't over-hold` urgency framing at `dte<=7`, and a new plain `**N DTE** remaining` framing above that threshold — so the collapse mechanism's own "folded into narrative" claim is true for every DTE value.
- **RTH check:** Pull a live swing brief for an OPEN/HOLD/TRIM position with DTE > 7 and confirm the "Manage plan" bullet in "Trade manager read" now names the DTE count (e.g. "9 DTE remaining"). Separately confirm a DTE <= 7 position still shows the urgency framing ("theta accelerating"), not the plain one — this fix must not blur the two together.

### 80. Night Hawk 0DTE — a play committed via Cortex relief self-vetoed within 1 second, netting ~0% — fix/zerodte-relieved-gex-walls-instant-reveto — 2026-09-09

- **What was broken (operator-reported):** "still only 3 plays 0dte and all under 1% gain" — investigated live rather than assumed. All 3 of the session's committed plays (SHOP, LUNR, MSTR) were near-flat CLOSED; their frozen `entry_context.cortex` blobs each showed `decision: "PASS"`/`vetoes: []` while their own `narrative` array said "BLOCKED by 1 veto" and quoted a `gex-walls` wall fact — commit relief (`applyCortexCommitRelief`) had stripped the veto to let Vector-confirmed entries through, but the live exit-time thesis check (`exit-sync.ts`) recomposed Cortex fresh with no memory of that relief, saw the same still-standing wall, and fired `thesis_break:gex-walls` almost instantly (SHOP/MSTR within 1 second of entry, LUNR after 22 minutes).
- **What changed:** New `gexWallsVetoWasRelieved()` (`cortex-vector-relief.ts`) detects the narrative/vetoes mismatch on the post-relief assessment; persisted as `entry_context.cortex.gex_walls_veto_relieved` at commit (`cortex-gate.ts`/`scan.ts`). Exit side reads it (`entryGexWallsVetoReliefOf`, `exit-sync.ts`) and feeds it into `detectThesisBreak`'s existing `skipGexWallsVeto` grace period (`exit-engine.ts`, both call sites) — the same exemption the pre-existing "degraded GEX feed" case already had, now also covering "this exact veto was relieved at entry."
- **RTH check:** Watch for the next play whose `entry_context.cortex.gex_walls_veto_relieved` is `true` (any play where Vector strongly confirmed direction and the desk would otherwise have gex-walls-vetoed) — confirm it does NOT close within seconds of entry on a `thesis_break:gex-walls` reason. If one still does, the fix isn't reaching that code path and needs re-tracing. More generally, watch whether today's low commit-count/near-zero-gain pattern (3 plays, all sub-1%) improves on the next full session — this fix addresses one confirmed mechanism (2 of the 3 today's plays), not necessarily the only one.

### 81. Ask Largo swing brief — raw IEEE754 subtraction artifact leaked into the "vs median" lane-rank narrative — fix/swing-lane-rank-delta-float-precision — 2026-09-09

- **What was broken:** `computeLaneRank`'s `deltaFromMedian` was a raw `playScore - medianScore` float subtraction with no rounding, formatted directly into two narrative call sites (`laneRankSection`'s "Lane rank" body, `laneRankCoaching`'s "Top-tier setup"/"Below lane median" trade-manager bullet). A live AMZN WATCH-bucket brief rendered `**+11.799999999999997** vs median` — a 17-digit float in a trader-facing sentence.
- **What changed:** `computeLaneRank` now rounds `deltaFromMedian` to one decimal place at the point of computation (`Math.round((playScore - medianScore) * 10) / 10`) — a single fix point covers both consumers since they both read the same snapshot field.
- **RTH check:** Pull a live swing brief (OPEN or WATCH bucket, any ticker) whose "Lane rank" section or "Top-tier setup"/"Below lane median" trade-manager bullet renders a "vs median" delta, and confirm the number has at most one decimal place — never a long tail of 9s/0s. This is a display-only fix (no ranking/threshold logic changed), so lane rank order and the ±10/±15 threshold behavior should be unchanged from before.

### 82. Ask Largo swing brief — LIVE-play "Gave back X% from peak" bullets were a percentage-POINT subtraction, not a relative retracement — fix/swing-live-giveback-relative — 2026-09-10

- **What was broken:** Live `SWING:NRG` open position (positionId 34, peak 132.7, current pnl 39.8): four independent call sites — `actionNarrative` and `degradedReadLine` (`play-brief-narrative.ts`), `underlyingExcursionCoaching` (`play-brief-narrative-coaching.ts`), and `holdPlanSection` (`play-brief-intel.ts`) — computed `play.peak - play.pnlPct` (132.7-39.8≈93) and printed "Gave back **93%** from peak" on a position still up +39.8%. The honest relative retracement (39.8/132.7 retained) is ~70% given back, not 93% — the point-difference formula reads as "almost totally round-tripped" when the position kept 30% of its peak gain, and its error grows unbounded on larger peaks (can print over 100%, or understate a real round-trip on a small peak). The analogous CLOSED-play bug was already fixed 2026-09-06 (`mfeCaptureOutcome`, `mfe-capture.ts`) but never extended to the live/open path; the 4th site (`degradedReadLine`) wasn't in the original bug report at all — found because the RED test run showed the same "93%" bug duplicated twice in one rendered body.
- **What changed:** All four sites now reuse `mfeCaptureOutcome` (unchanged core logic) with the play's current `pnlPct` in place of an exit pnl, converting each site's raw point-difference threshold to a relative capture-floor (70/75/80/80 per site, documented in-line, all four verified to still fire on the live NRG numbers) and adding a present-tense "Round-tripped past breakeven — was up X% at peak, now Y%" phrasing for the case where current pnl has gone negative after a positive peak (previously that case still rendered a "gave back" percentage, sometimes over 100%).
- **RTH check:** Pull a live OPEN/HOLD/TRIM swing position with a large peak-vs-current gap (mark a real `board.lanes.SWING.committed[]` row where `peakPremium` is well above the current mark) via `GET /api/market/swing/play-brief` and confirm every "gave back" bullet in the response (Trade manager read's "Hold the line"/"Live read" lines, "Underlying tape"'s option-giveback aside, "Hold plan"'s giveback bullet if thesisHealth is present) reads as an honest relative retracement — a position still up double-digits should never show a giveback number anywhere close to 90-100%. Separately, if any live position's current pnl has gone negative after a positive peak, confirm the "Round-tripped past breakeven" wording appears instead of a giveback percentage.

### 83. UW rate-limiter had no live-traffic reservation on its RPS layer, only concurrency — recurring member-facing flow-alerts outage — fix/uw-rate-limiter-rps-reservation — 2026-09-09

- **What was broken:** `acquireGlobalRedisSlot()` (`uw-rate-limiter.ts`) paced every caller — background sweep or live member traffic alike — against the same raw `GLOBAL_MAX_RPS` (default 2) on the RPS sliding-window admission stage. A prior fix (2026-09-03) had already added `reserveForLiveTraffic()` — a background-sweep-tagged caller sees its ceiling reduced by one so it can never claim the LAST slot from live traffic — but only wired it into the CONCURRENCY stage, never the RPS stage. Live evidence 2026-09-09 ~22:41-23:40 UTC: ALB `TargetResponseTime` p99/Max tail-latency spikes up to 49.6s against a low average and low ECS CPU/Memory (ruling out fleet capacity), and directly, `[uw] flow-alerts cache too stale — not serving: [unusual_whales] rate-limiter queue budget exceeded at global_rps: waited 20001ms of 20000ms` — the queue's own 20s admission budget exhausted specifically at the RPS stage, members not served flow-alerts data.
- **What changed:** `acquireGlobalRedisSlot()` now passes `reserveForLiveTraffic(GLOBAL_MAX_RPS)` instead of the raw ceiling — same already-tested primitive the concurrency stage already used, applied to the second stage that needed it. The local per-process token bucket (`effectiveMaxRps()`) was deliberately left unchanged (see the staged finding for why — shared mutable refill-rate state makes that a materially riskier change, and the live evidence named the Redis `global_rps` stage specifically).
- **RTH check:** This is the most important RTH check on this list — the underlying incident was LIVE and member-facing, not merely code-review-visible. Pull ALB `blackout-production-app` `TargetResponseTime` p99/Max for the next RTH session and confirm the recurring 10-50s single-minute spikes seen 2026-09-09 evening do not repeat at the same magnitude/frequency during real trading hours; grep `CloudWatch Logs /ecs/blackout-production` for `rate-limiter queue budget exceeded at global_rps` and confirm it either stops appearing or appears far less often than the pre-fix baseline (5+ occurrences in under 20 minutes). If it still recurs at similar severity, the RPS ceiling itself (not just its reservation) may need raising, or another caller entirely may be saturating the budget — re-open the investigation rather than assuming the fix was insufficient without re-measuring.
  - **RE-CHECKED 2026-09-10, actual next-RTH-open (Night Hawk Legacy audit lane, 13:24-13:39 UTC = 9:24-9:39 ET, market opened 9:30 ET): IT RECURRED, same severity class.** ALB `TargetResponseTime` p99 was a healthy 4-8s pre-open (13:24-13:30 UTC) and spiked to **83.80s at 13:31 UTC** (the minute right after open), staying elevated 12-30s p99 through at least 13:37; 3 real `HTTPCode_Target_5XX_Count` in the same window. `CloudWatch Logs` confirms the SAME log line as the original incident: `[uw] flow-alerts failed: [unusual_whales] rate-limiter queue budget exceeded at global_rps: waited 20002ms of 20000ms` at 13:31:10 (2 instances, right at market open, before any audit-lane traffic that session) and a further cluster of 6 at 13:35:27-41 (this second cluster's timing overlaps this audit lane's own re-test loop, so it is NOT cleanly attributable to member traffic alone — disclosed, not hidden). The Legacy healthcheck (`npm run healthcheck:legacy`) directly observed this as real flakiness: 3 consecutive fresh runs in this window scored RED/GREEN/RED on the EDITION stage, with a bare `fetchAuditJson` call to the same endpoint succeeding cleanly moments apart — consistent with genuine intermittent upstream exhaustion, not a script bug. `GLOBAL_MAX_RPS` is still the same default (`envNumber("UW_GLOBAL_MAX_RPS", 2)`, `uw-rate-limiter.ts:36`) the original incident measured against. **Not fixed by this session** — the deeper "is 2 RPS actually sized for real concurrent RTH-open demand across every desk, or does it need raising" measurement CLAUDE.md's own note calls for was not done here (would need a careful cross-desk caller-count/latency study, out of scope for a single 15-min Legacy-lane cycle) — flagging for whichever lane/session has capacity to take the RPS-ceiling measurement next, rather than guessing at a new value.
  - **FOLLOW-UP 13:51-14:08 UTC (same lane, same morning): SUSTAINED, NOT A BLIP — and NO OPS ALERT FIRES FOR IT.** Re-checked twice more, ~20 and ~37 minutes after open. ALB p99 never returned to the 4-8s pre-open baseline — it stayed 12-47s continuously the entire time (13:32 through 14:07, spot-checked every few minutes, never a clean recovery window). The `queue budget exceeded at global_rps` log line kept recurring in GROWING clusters — 10 simultaneous failures in one second at 13:45:36, 7+ simultaneous at 14:05:25 — i.e. still fully active 37+ minutes into RTH, not tapering off. Legacy's OWN member-facing surface (edition/marks/record) recovered to GREEN by ~13:51 and stayed there on every subsequent check, because `GET /api/market/nighthawk/edition` reads a pre-built DB row from the evening cron rather than live UW flow-alerts per-request — Legacy is structurally insulated from this specific failure mode, which almost certainly means live-polling desks (Vector, 0DTE, Helix, `/flows`) are experiencing WORSE and CONTINUING degradation this whole time. **Checked whether ops would even know:** `uw-rate-limiter.ts`'s only Discord ops alert (`alertRedisDegradedOnce`, ~line 203) fires exclusively when the shared Redis ceiling itself becomes unreachable (the limiter falling back to per-replica local pacing) — a DIFFERENT failure mode from what's happening now, where Redis is healthy and the rate limiter is working exactly as designed, just against a ceiling (`GLOBAL_MAX_RPS=2`) that real RTH-open demand exceeds. **There is no alert anywhere for a sustained `RateLimiterQueueTimeoutError`/`queue budget exceeded` condition** (`queue-budget.ts` — shared by both the UW and Polygon limiters) — a 37+-minute, platform-wide, real-money-adjacent degradation was invisible to anyone watching Discord ops alerts the entire time it was measured. **Not built this session** (deliberately — this is shared, hot-path infrastructure used by every provider call on the platform; getting the alert threshold/cooldown right needs the same care as the existing `alertRedisDegradedOnce` fire-once-with-rearm pattern, not a rushed patch at the tail of a 15-min cycle) but the fix shape is fully scoped and ready to build: a fire-once-with-rearm Discord alert in `queue-budget.ts` (or a small wrapper each limiter calls) that fires when `isQueueTimeout()` errors cross a sustained-rate threshold (e.g. N timeouts within a rolling window, not a single one — a single queue timeout is normal/expected burst behavior and must never page), mirroring `alertRedisDegradedOnce`/`clearAlertOnRedisRecovery`'s exact latch shape so it can't spam. Whoever picks this up next: the hook point is `QueueBudget.assertWithinBudget()`/`RateLimiterQueueTimeoutError` construction in `queue-budget.ts`, shared by `uw-rate-limiter.ts` and `polygon-rate-limiter.ts` alike.

### 84. Ask Largo swing WATCH brief — gate-block text duplicated back-to-back in "Trade manager read" — fix/swing-watch-gate-bullet-dedup — 2026-09-10

- **What was broken:** For a WATCH-lane swing candidate with commit gates blocking entry, `tradeManagerNarrativeSection` rendered the SAME gate code+reason text twice back-to-back — `actionNarrative`'s "Entry stance — WAIT. Clear gates: g_s12_...: ... · g_s6_...: ..." bullet, immediately followed by `watchGateCoaching`'s "Gates blocking entry — g_s12_...: ... · g_s6_...: ..." bullet — because the section's own de-dup guard keys on each line's first 48 characters, and the two bullets open with different wording. Live repro: `SWING:EWY` WATCH brief (2 blocking gates: `g_s12_halt_feed_stale`, `g_s6_confluence`).
- **What changed:** `actionNarrative`'s watch branch now states only the blocking-gate COUNT ("2 gates blocking entry — see below.") instead of re-rendering the first two gates' reason text; `watchGateCoaching`'s bullet (which already covers up to 3 gates plus the `unlock_et` clearing-time hint) stays the single place the reasons are spelled out.
- **RTH check:** Pull a live WATCH-lane swing brief for any candidate with `gateBlocks` set (e.g. blocked on halt-feed-stale, confluence, or cortex-thin-evidence) and confirm each gate's reason text appears exactly once in "Trade manager read" — the "Entry stance" bullet should name only a count ("N gates blocking entry — see below"), with the full code+reason detail appearing once, in the very next "Gates blocking entry" bullet.

### 85. All three SSE stream routes could throw an unhandled promise rejection on every tick of a live connection — fix/sse-stream-tick-unhandled-rejection — 2026-09-09

- **What was broken (operator-reported):** live production alert (Discord `#website-logs`) — two `🛑 Unhandled promise rejection` alerts ~19 minutes apart, both an async stack bottoming out through `market/vector/stream/route.js`. Root cause: `recheckSseUserEntitlement` re-throws any error that isn't a degraded-mode `TierUnavailableError`, and all three SSE stream routes (`vector/stream`, `zerodte/marks/stream`, `flows/stream`) call it inside a per-tick `send()` invoked fire-and-forget (`void send()`) with no `.catch()` anywhere in the chain. `send()` runs every 1s (or per live event) for the life of a long-lived connection, so a single transient Clerk/Redis hiccup produced a fresh unhandled rejection on every subsequent tick until the client disconnected, not just once.
- **What changed:** New `runSseTickSafely(tick, routeLabel)` (`src/lib/sse-safe-tick.ts` — a pure, dependency-free file, split out for the same `import "server-only"` testability reason `sse-backpressure.ts` already was) wraps a tick in try/catch and logs instead of letting it escape — the same "skip this tick, try again next tick" treatment the existing `"unavailable"` verdict already gets. All three routes' `send()` (and, in `flows/stream`, its flow-event subscriber callback too) now route through it.
- **RTH check:** Watch Discord `#website-logs` (or CloudWatch Logs `/ecs/blackout-production` for `[sse-stream:` entries) — a transient tier/tool-access hiccup on a live SSE connection should now show as a normal `console.error` log line (`[sse-stream:<route>] tick failed unexpectedly: ...`) with the connection continuing to serve subsequent ticks, never as another `🛑 Unhandled promise rejection` Discord alert. If one still appears with a stack through any of the three stream routes, the fix isn't reaching that call site and needs re-tracing.

### 86. Ask Largo swing brief — `GET /api/market/swing/play-brief` could hang past Cloudflare's edge timeout instead of returning its own graceful degraded response — fix/swing-play-brief-source-timeout — 2026-09-09

- **What was broken:** A live `play-brief` request for a real committed NRG swing position ran past a 120s client timeout, then a retry returned Cloudflare's raw `504: Gateway time-out` HTML instead of the route's own `{available:false, degraded:true}` 503. `loadSwingPlayBriefContext`'s network-bound reads (Meridian timeline, Meridian peer-cohort, ecosystem context, Vector full-state, archetype track record) had `.catch()` guards for thrown failures but no timeout — a hang, as opposed to a rejection, was never caught. `AWS/ApplicationELB` `TargetResponseTime` on `blackout-production-app` confirmed a real tail-latency pattern in the same hour: p99 spiking to 88-104s against a 0.4-5s average, with matching intermittent 5xx counts.
- **What changed:** New `withBriefSourceTimeout()` (`src/lib/swing/brief-source-timeout.ts`) races each network-bound call against an 8s budget (same shape as the existing `CORTEX_SOURCE_TIMEOUT_MS` pattern in `nighthawk/cortex/fetch.ts`), feeding the existing `.catch()` paths on timeout exactly as it would on a genuine failure. Worst case is now bounded well inside the route's own intended (but ECS-unenforced) `maxDuration = 30`. This landed alongside an independently-written archetype-track-record timeout (`readSwingArchetypeTrackRecord`, already on `main`) — both call sites now share the same `withBriefSourceTimeout` primitive, one rejecting (network reads, caught by each site's own `.catch(() => null)`), one already non-throwing by design (track-record read, wrapped with its own `.catch(() => null)` at the call site to preserve that contract).
- **RTH check:** Pull a live swing play-brief for any committed/watch position during RTH (when Meridian/Vector fan-out is under real load) and confirm it always returns within a few seconds — never a multi-minute hang or a raw Cloudflare 504 page. If a slow-path IS hit, confirm the response is the route's own `{available:false, degraded:true}` JSON, not an infrastructure error page. Also worth re-pulling ALB `TargetResponseTime` p99 for `blackout-production-app` a few hours into RTH to see whether the tail-latency spikes recur even with this route now bounded — if they do, the actual long-pole (likely Meridian's per-ticker earnings enrichment fan-out, not yet traced) still needs its own fix.

### 87. Night Hawk Legacy — play thesis silently dropped the gap's own directional explanation — fix/nighthawk-thesis-gap-fill-tag-truncation — 2026-09-10

- **What was broken:** Live 2026-09-10 edition, FICO (SHORT, conviction A): the member-facing thesis read "FICO showing prior day HOD break, gap up 49.89 in bearish trend" — two classically bullish continuation facts (breaking the prior high, gapping up) shown with no stated reason a member should read them as support for a SHORT. `classifySetup()` (`technicals.ts`) already computes the missing reasoning — it always pushes a `"gap-fill risk below"`/`"gap-fill bounce zone above"` tag immediately after its own gap tag, the one `setup_tag` in the list that argues a direction — but `buildDeterministicThesis()`'s unconditional `setupTags.slice(0, 2)` dropped it whenever two other tags (here `"prior day HOD break"` + `"gap up X"`) filled both opener slots first.
- **What changed:** `buildDeterministicThesis` now appends the gap-fill companion tag whenever the gap tag itself made the first-two cut but its own companion didn't — narrow by construction (a play whose opener never mentions the gap gets no orphaned gap-fill commentary either).
- **RTH check:** Once tonight's edition build runs (21:30-23:45 UTC / ~5:30-7:45pm ET), pull `GET /api/market/nighthawk/edition` and find any play whose thesis mentions a `"gap up"`/`"gap down"` tag in its opener sentence — confirm the sentence also carries `"gap-fill risk below"` or `"gap-fill bounce zone above"` right after it (previously silently dropped whenever two other tags sorted ahead of the gap-fill tag in `setup_tags`). Not every play will have a gap tag at all that session — this only confirms the pairing holds when one is present.

### 88. Ask Largo swing brief — Verdict section showed raw "SKIP" contradicting the "HOLD" headline in the same answer — fix/swing-brief-verdict-skip-headline-mismatch — 2026-09-10

- **What was broken:** Live SLV WATCH brief (`GET /api/market/swing/play-brief?playId=SWING:SLV&ticker=SLV&status=WATCH`, 2026-09-10 09:47 ET, a RESEARCH-section row with `thesis_invalidated` blocking entry): the envelope's top-level `headline` correctly read "HOLD — SLV 59C 6DTE" (its fallback chain is `action.label -> recommendation -> status`), but the Verdict section's own inline line — a separate string built two lines later in `composeSwingPlayBrief` with a SHORTER fallback chain (`action.label -> status`, skipping `recommendation` entirely) — read "**SLV 59C 6DTE** · LONG · SKIP" followed immediately by "Desk is passing this setup — no entry recommended." Same brief, same request, two different verdict words for the identical underlying concept (`entry-verdict.ts` deliberately splits an internal `deckStatus:"SKIP"` from a member-facing `recommendation:"HOLD"` for exactly this RESEARCH case — the bug was that only one of the two rendered strings applied that split correctly).
- **What changed:** The Verdict line's fallback chain now matches the headline's exactly (`action?.label ?? play.recommendation ?? play.status`), so the two can no longer disagree — same source fields, same precedence.
- **RTH check:** Pull a live swing WATCH brief for any candidate currently classified into the RESEARCH serving section (commonly one with `thesis_invalidated` or another hard pre-entry gate, `status` internally "SKIP") and confirm the envelope headline and the Verdict section's inline line show the SAME leading verdict word (both "HOLD", never headline "HOLD" + Verdict "SKIP"). SLV was WATCH/RESEARCH at time of writing and may have graduated or been dropped by market open — any other RESEARCH-section WATCH row proves the same fix.

### 89. Vector GEX bead rail — combined book denominator collapsed the weaker side's beads into uniform size/color — fix/vector-bead-side-denominator — 2026-09-10

- **What was broken (member-reported live, 2026-09-10):** "The current model all beads look same .. cant differentiate .. it was like this before September 3rd" — on production Vector, SPX, GEX·4S, 0DTE tab. Root cause: `WallRailPrimitive` normalized BOTH the bead size (`targetHalfPx`) and color/alpha (`fillAlpha`) channels off one shared `maxPct` — the strongest wall across the WHOLE book (calls + puts combined) — instead of each side's own peak. On a lopsided book (live SPX 0DTE numbers that day: put top strikes 16.3/6.26/6.21/5.73/5.72% vs call top strikes only 0.89/0.45/0.40/0.35/0.22% — an ~18x gap), the weaker side's entire pct range sat far below the shared denominator and collapsed toward the floor on both channels.
- **What changed:** New `sidePctMaxima()` computes each side's own peak (`callMaxPct`/`putMaxPct`) alongside the existing combined `maxPct`; `feedWallRail`/`WallRailData`/`addTrail` now normalize SIZE and COLOR per-side, while the combined `maxPct` is kept only to gate overall rail visibility. Verified with the live pcts above: alpha spread on the call side goes from a compressed 0.370-0.412 (pre-fix, shared denominator) to a legible 0.556-0.980 (post-fix, own-side denominator).
- **RTH check:** Once the market opens and a real intraday book forms, pull the Vector desk (SPX or any ticker) on GEX·4S/0DTE and visually confirm BOTH the gold call-side and purple put-side bead rails show clear strike-to-strike size/color differentiation — not just the historically-dominant side. Specifically check a session where one side's book share is much larger than the other's (the exact condition that exposed this bug) — the weaker side's beads should still show a visible gradient from its own strongest to weakest strike, not render as a uniform blob. Also confirm the previously-working strong side (e.g. puts on a put-heavy day) still looks unchanged, since the fix is a no-op there by construction.

### 90. Ask Largo swing brief — Premium stop rail now shows a live cushion percentage, not just the dollar level (enhancement) — feat/swing-brief-stop-rail-cushion-pct — 2026-09-10

- **What was missing:** `watchForSection`'s OPEN-bucket "Premium stop rail" line showed only the raw dollar stop level ("Premium stop rail: **$6.66** — thesis breaks if mark closes below"). The member already sees the current mark elsewhere in the same brief (the Position section's "Mark: **$19.57**") but nothing connects the two into the one number a trader actually wants at a glance: how much room remains before the stop fires. Found during a full ten-point LARGO-PRODUCT-CONTRACT pass on CRWD's live brief.
- **What changed:** The line now appends a live cushion percentage — `(mark - stop) / mark * 100` — the same spot-relative-distance framing `fmtDist` already uses elsewhere in this file for gamma-flip/wall distances: "Premium stop rail: **$6.66** — 66% cushion from current mark — thesis breaks if mark closes below". Additive only (the existing dollar level and "thesis breaks if..." wording are unchanged); the cushion note is omitted (never fabricated or shown negative) when `mark` is unavailable or at/below the stop.
- **RTH check:** Pull a live swing OPEN/HOLD/TRIM play-brief (`GET /api/market/swing/play-brief`) for any real committed position and confirm the "What to watch" section's Premium stop rail line now carries an "N% cushion from current mark" clause whose number is consistent with the Position section's own Mark and the stop dollar level shown in Management's "Rails: stop $X". A row with no live mark (shouldn't normally occur for a genuinely open row) should show the old bare-dollar phrasing with no cushion clause, never a fabricated or negative one.

### 91. Ask Largo swing brief — TRIM coaching claimed "into strength" the same sentence it said the peak was already gone — fix/swing-trim-strength-line-vs-round-trip — 2026-09-10

- **What was broken:** Live NN brief (`SWING:NN:32`, 2026-09-10 12:00 ET, a real committed position): `actionNarrative`'s TRIM branch always rendered "Bank partial into strength; don't give back peak" regardless of the play's current state, then a separate `mfeCaptureOutcome`-driven bullet independently appended "Round-tripped past breakeven — was up 24% at peak, now -35% — consider protecting what's left" right after. Both fired together, contradicting each other in the same sentence: telling the member to protect a peak the very next clause says is already gone, past breakeven, into a loss.
- **What changed:** The `mfeCaptureOutcome` computation now runs before the recommendation branch instead of after, so the TRIM branch can check the same round-trip condition and omit "Bank partial into strength; don't give back peak" when `giveback?.kind === "round_trip"` — the round-trip bullet immediately after already carries the real, current guidance, so nothing is lost.
- **RTH check:** Pull a live swing OPEN/TRIM play-brief for any real committed position whose recommendation is TRIM. If the position has round-tripped past breakeven (current pnl negative after a positive peak), confirm "Trade manager read" no longer says "Bank partial into strength; don't give back peak" — only the accurate "Round-tripped past breakeven..." bullet should appear. A TRIM position still genuinely in profit (has NOT round-tripped) should still show "Bank partial into strength; don't give back peak" exactly as before — this is a conditional fix, not a removal.

### 92. 0DTE ratchet floor "cannot finish red" guarantee silently broke at a cent-rounding boundary — fix/ratchet-floor-honor-rounding-boundary — 2026-09-10

- **What was broken (live forensic audit, real committed play):** QQQ short, entry 0.22, peaked +47.73%, correctly armed the ratchet's breakeven floor (0%). The engine's own `exit_detail` read "the protective floor exits so the green trade cannot finish red" — but the ledger persisted `exit_pnl_pct: -2.27` and `exit_mark_honored: false`. Root cause: the raw observed print (0.215) sat below the floor (0.22) by less than half a cent, so both cent-round to the SAME value (0.22) — `buildExitContext`'s `mark_honored` flag was derived by comparing the two ALREADY-ROUNDED numbers, which read "equal, not honored" even though the floor mechanism (comparing the RAW values via `Math.max`) is what actually determined the fill. `pnl_pct` then branched on that wrong flag and computed off the raw (worse) print instead of the floor.
- **What changed:** `resolveExitMark` now returns `{ mark, honored }` directly, computing `honored` from the SAME raw (pre-rounding) comparison its own `Math.max` selection uses — a single source of truth, so the flag can never disagree with which value actually determined the fill. `buildExitContext` consumes that result instead of re-deriving "honored" by comparing two independently-rounded numbers.
- **RTH check:** Watch for any ratchet-mode 0DTE exit whose `exit_detail` claims a floor "cannot finish red" (breakeven or higher armed) — confirm `exit_pnl_pct` on that row is actually ≥ the armed floor level, never negative when a 0%+ floor was armed. This specific rounding-boundary shape (raw print within ~0.5¢ of the floor) is narrow and may not recur every session — the regression test (`exit-engine.test.ts`) now covers it permanently either way.

### 93. 0DTE board — CLOSED rows disclosed a rounding-distorted live_pnl_pct instead of the true exit_pnl_pct — fix/zerodte-closed-row-frozen-live-pnl — 2026-09-10

- **What was broken (live cross-check, real closed play):** The same QQQ row from #92 above: the board's ledger row carries BOTH `live_pnl_pct: 0` and `exit_pnl_pct: -2.27` for the identical closed position. `live_pnl_pct` is DELIBERATELY recomputed post-`roundFloats()` from the ROUNDED `entry_premium`/`last_mark` (`reconcileLedgerLivePnlPct`, `zerodte-service.ts`) — correct, intentional design for that field's OWN live-monitoring self-consistency purpose (independently confirmed the same day by a Legacy-lane cross-check on RDDT, `nighthawk-0dte-live-journal.json` 19:07Z, a smaller 0.43pp gap ruled not-a-bug for `live_pnl_pct` itself). But `closedPnlDisplay` (the ONE shared function deciding what a CLOSED row shows) reused that field for a DIFFERENT purpose — "what did this position actually realize" — where rounding-to-the-same-value can zero out a real result: for a peak-tranche row it disclosed "as-managed realized +0.0%" via a hover tooltip when the raw-precision truth was -2.27%, and for an UNBANKED row (no tranche armed) the PRIMARY badge itself would show the rounding-distorted number instead of the real exit.
- **What changed:** `closedPnlDisplay` now derives `realized = row.exit_pnl_pct ?? row.live_pnl_pct ?? null` (raw-precision `exit_pnl_pct` first) and uses it for both the primary badge (unbanked case) and the disclosure (`realized_pct`); `exit_pnl_pct` is wired through the client `LedgerRow`/`PlayRow` types and `mergePlays` (it was being silently dropped despite sitting right beside the already-mapped `exit_reason`/`exit_detail`), and the `StatsCell` tooltip now reads the function's own `pnlView.realized_pct` output instead of reaching around it to read `row.live_pnl_pct` directly. `live_pnl_pct`'s own computation is untouched — it is correct for its own purpose.
- **RTH check:** Pull the live 0DTE board (`GET /api/market/zerodte/board`) for any newly-CLOSED row and confirm its displayed P&L (badge and, for a banked-tranche row, the hover disclosure) matches that same row's own `exit_pnl_pct`/`exit_detail` — not a different, rounding-distorted number. Most sessions this will already agree (the bug only bites when entry/exit round to the same display value while differing at raw precision); the regression tests (`marks-math.test.ts`) cover the mismatch case permanently either way.

### 94. Swing positions past contract expiry never closed — a stale latched mark deferred the grade forever — fix/swing-expired-position-never-closes — 2026-09-10

- **What was broken (cross-lane finding, 28 real rows):** The 0DTE lane's `zerodte-e2e-healthcheck.mjs` Stage D found 28 real `swing_positions` rows stuck OPEN/HOLD/TRIM with option expiries 6-27 days in the past, occupying ~28% of the shared 100-slot live-marks pool both 0DTE and Swing members draw from. Root cause: `buildSwingRollPlan`'s `resolveParentGradeMark` refuses to freeze a real-money grade off a latched `last_mark` older than 90 minutes (`MAX_LATCHED_MARK_AGE_MS`) — correct for a LIVE position, but once a contract expires it can never again produce a fresher quote, so that 90-minute trust window becomes a PERMANENT block: `evaluateSwingManagement`'s `expiry_risk` rung correctly fired an EXIT decision every cron cycle, but the write path that would freeze the grade and close the row could never produce one, so the position simply never closed, forever.
- **What changed:** `resolveParentGradeMark` now accepts the position's DTE and, only once it's negative (contract definitively expired), uses the stale latched mark anyway — tagged with a new, distinct `latched_last_mark_expired` source so `grade_json` stays honest about which trust path produced the freeze. Still a REAL observed price, never a fabricated one; only the trust window is relaxed, and only once "wait for a fresher quote" has become a promise that can never be kept.
- **RTH check:** Once tonight's `swing-active-refresh` cron runs (every ~15 min during RTH) against any of the previously-stuck rows, confirm via `GET /api/market/swing/record?days=45` that they now show `status: CLOSED` with a `grade_json.mark_source: "latched_last_mark_expired"` (or a normal source, if a live/fresh mark happened to resolve first) rather than remaining in the OPEN/HOLD/TRIM live-marks pool. Also worth a spot-check on the 0DTE lane's own `zerodte-e2e-healthcheck.mjs` Stage D — it should stop reporting the permanent false RED these 28 dead rows were causing.

### 95. Ask Largo swing brief — "Night Hawk Legacy" absence chip falsely claimed the Legacy edition hadn't run, when it had — fix/swing-brief-legacy-stale-ticker-misclaim — 2026-09-10

- **What was broken (live GOOG WATCH brief, found during the standing Ask Largo deep-dive):** `GET /api/market/swing/play-brief` for GOOG showed `unavailableSources: [{"source":"Night Hawk Legacy","reason":"prior session (2026-08-03) — today's edition not yet run"}]` — a 5+ week-old date — while `GET /api/market/nighthawk/edition` confirmed the real Legacy edition had published on schedule the evening before (`published_at: 2026-09-09T21:34:32Z`). Root cause: the query behind `ctx.ecosystem.nighthawk_recent` has no date filter (`WHERE ticker=$1 ORDER BY edition_for DESC LIMIT 1`) — it's "the last time THIS TICKER was featured in Legacy," not "when Legacy last published." The absence chip compared that per-ticker date to today and asserted a false, unverifiable system-wide claim whenever a ticker simply hadn't been picked recently (true for most tickers most days).
- **What changed:** The claim "today's edition not yet run" is now bounded to a small gap window (1-4 calendar days, covering a normal weekend) where it's still a plausible same-cycle read. Beyond that, the chip surfaces an honest, ticker-scoped fact instead — `"no recent Legacy edition for this ticker (last featured <date>)"` — without asserting anything about the system-wide pipeline.
- **RTH check:** Pull a live swing WATCH/OPEN play-brief for any ticker NOT in the last few days' Legacy editions and confirm the `unavailableSources` Legacy entry reads the new ticker-scoped wording, not "today's edition not yet run" — and separately confirm `GET /api/market/nighthawk/edition`'s own `published_at` is in fact current, proving the two are now correctly decoupled.

### 96. Ask Largo swing brief — a separately-supplied positionId could resolve to an unrelated live WATCH row instead of the CLOSED position asked for — fix/swing-brief-closed-position-id-resolution — 2026-09-11

- **What was broken (live repro, `GET /api/market/swing/play-brief?playId=SWING:INTC&ticker=INTC&positionId=30`):** `resolveSwingPlayForBrief` accepts a position ID either embedded in `playId` (`SWING:TICKER:ID`) or as a separate `?positionId=` query param — the route's own documented shape. It correctly merges both into one `positionId` variable early on, but its two "does the caller want a specific closed position?" guards read `parsed.positionId` instead (parsed ONLY from the playId string, always null when the id arrives as a separate param) — so a caller supplying positionId separately, for a ticker that also currently has an unrelated live WATCH/discovery candidate, silently got that unrelated live row back instead of the closed position it asked for.
- **What changed:** Both guards now read the fully-resolved `positionId` variable instead of `parsed.positionId`.
- **RTH check:** For any ticker that has BOTH a recent closed/graded swing position AND a current live WATCH-lane candidate, pull `GET /api/market/swing/play-brief?playId=SWING:<TICKER>&ticker=<TICKER>&positionId=<closed id>` (positionId as a separate param, NOT embedded in playId) and confirm the response resolves the CLOSED position (an Outcome/Lessons section, a terminal headline) — not a live WAIT/BUY verdict for a different, currently-forming setup on the same ticker.

### 97. Sibling-session swing fixes (#4760 blended P&L, #4762 Watch-levels dedup) — verified live in production, 2026-09-11

- **#4760 (`fix/swing-blended-trim-pnl` class):** Live CRWD (`SWING:CRWD:19`) play-brief confirmed showing `Blended P&L (realized trim + open runner): **+51.2%**` in the Position section once the fix's own ECS deploy (task def `:1438`, image `e09221d6f`) completed rollout — matches the fix's own commit-message math exactly (peak $38.25/+129.7%, trim fired at +100%, mark back to $17.05/+2.4% runner-only). No further action needed; verification complete.
- **#4762 (Watch-levels/Trade-manager-read dedup):** Live GOOG (`SWING:GOOG`) WATCH-bucket play-brief confirmed the "Flag anchor"/"Entry geometry" pair now renders exactly once (in "Watch levels" only) once the deploy (task def `:1439`, image `661e1b22d`, which superseded #4762's own cancelled ECR run but still carries its commit — confirmed via `git merge-base --is-ancestor`) completed rollout. No further action needed; verification complete.
- **CORRECTION, 2026-09-11 13:47 UTC (~17min into RTH) — the prediction above was based on a wrong assumption, not a real gap.** CG's mark is fresh (`markAsOf: 2026-09-11T13:45:59Z`, i.e. seconds old) and `manageAction: "TAKE_PARTIAL"`/`manageReason: "profit_ladder"` confirm the manage-sync cron HAS correctly identified the +100% crossing — but `liveStatus` is still `"HOLD"`, not `"TRIM"`, and the Position section correctly still omits "Blended P&L". Traced to `adapters.ts:866-879` (`terminalPlayFromHorizon`), which has an explicit in-code comment for exactly this shape: `exitPolicy.trim_levels[].fired` is forced to `false` unless the row's `status` has actually reached `"TRIM"` — a documented, deliberate gate (`manage-sync.ts`'s real scale-out enforcement, "so a bare peak crossing can't fabricate a scale-out that never happened") citing an identical prior live repro on NRG (2026-09-10, peak +132.7%, still HOLD). The original prediction assumed the rung would auto-fire once RTH data refreshed the mark — it does not; `manageAction: TAKE_PARTIAL` is the actionable signal telling a member to trim manually (this is an advisory product, not an auto-execution bot), and `status` only reaches `TRIM` once that real-world action is reflected back into the ledger. **Not a bug — working exactly as documented.** No RTH check needed on this one; closing it out.

### 98. Ask Largo swing entry-verdict silently dropped real commit-gate reasons for names past their entry-validity window — fix/swing-entry-verdict-dropped-gate-blocks — 2026-09-11

- **What was broken (live MU WATCH brief, found during the standing Ask Largo deep-dive):** `GET /api/market/nighthawk/horizons?view=swings` shows MU carrying 3 real, live commit-gate blocks (`gate:G-S12:halt_feed_stale`, `gate:G-S4:regime_degraded`, `gate:G-S6:confluence`) — but `GET /api/market/swing/play-brief?playId=SWING:MU&ticker=MU`'s "Entry" section only said "First flagged 48 days ago... still on WATCH" with no "Gates blocking entry" detail at all. Root cause: `evaluateSwingEntryEnterability` checks the entry-validity deadline before its own gate-blocked check, so a name that is BOTH past its entry window AND still gate-blocked returns `action: "dont_buy"` with the generic deadline-expired reason before ever reaching the gate branch. One layer up, `swingEntryVerdict`'s `case "dont_buy":` fallback then unconditionally returned `gateBlocks: null` for anything short of INVALIDATED/persistence-gap — discarding the already-computed `commitGateBlockedBy` evidence instead of surfacing it (the sibling `case "wait":` branch two lines up did this correctly; the `dont_buy` branch did not).
- **What changed:** `entry-verdict.ts`'s `dont_buy` fallback now forwards `commitGateBlocksForVerdict(commitGateBlockedBy)` exactly like the `wait` branch — purely additive, no change to `recNote`/`actionLabel`/`recommendation`/`deckStatus`.
- **RTH check:** Pull the live play-brief for MU (or any other WATCH name that is both past its entry-validity window AND still failing a real commit gate — check `commitGateBlockedBy` on its `GET /api/market/nighthawk/horizons?view=swings` row first) and confirm the "Entry" section now shows a "Gates blocking entry:" block naming the real gate codes/reasons instead of silently omitting them. This should also now surface in `play-brief-intel.ts`'s "Before entry, clear:" section and the Command Deck's own WAIT pill for the same rows.

### 99. Night Hawk Legacy edition recap printed raw unrounded macro floats to members and Largo — fix/nighthawk-recap-macro-unrounded-float — 2026-09-11

- **What was broken (live repro during the standing Ask Largo/5-engine sweep):** `GET /api/market/nighthawk/edition`'s `recap_summary` read `"...Macro: GDP 23850.442 · CPI 333.918. Leaders: ..."` — raw, unrounded provider floats shown verbatim to every member reading the evening digest and to Largo whenever it quotes the recap. `buildMarketRecap()`'s `macroLine` never called `.toFixed()` on `m.latest_value`, while the sibling `formatMacroIndicators()` twelve lines above it, reading the identical field, already did.
- **What changed:** `macroLine` now rounds with the same `.toFixed(2)` pattern `formatMacroIndicators()` already uses. No other formatting/order/slice logic touched.
- **RTH check:** Pull `GET /api/market/nighthawk/edition` once a fresh edition publishes and confirm `recap_summary`'s `Macro:` segment shows 2-decimal values (e.g. `GDP 23850.44 · CPI 333.92`), never a longer raw float — and spot-check `market_recap.spx_desk`/other numeric fields in the same payload for the same raw-float pattern while there, since this is the second instance of this exact bug class found in this file.

### 100. `peekServerCache` had no staleness ceiling — SPX Slayer score/grade could flicker between stale replica snapshots — fix/peek-server-cache-stale-ceiling — 2026-09-11

- **What was broken (live repro, `GET /api/market/spx/play`, 5-engine sweep):** Three consecutive polls from the SAME client, ~4s apart, returned THREE different scores (24, 10, 0) — one `as_of` timestamp was ~21 minutes stale. Root cause: `peekServerCache`'s final fallback (`if (hit) return hit.value`) had no staleness check at all, unlike `withServerCache`'s own `MAX_STALE_AGE_MS` (10 min) guard. `store` is per-ECS-replica in-memory, and `writeRedisCache` sets the Redis copy's TTL to the same short `ttlMs` (5s for spx-play-read) as the local entry — so once ~5s pass with no write from ANY replica, the Redis backstop also expires, and a replica that hasn't served traffic in a while had nothing stopping it from handing out its own arbitrarily-old local entry via the "instant read, refresh in background" path every one of 5 routes uses (spx/play, nighthawk/edition, spx-desk-loader, flows-member-cache, flow-brief).
- **What changed:** `peekServerCache` now applies the same `MAX_STALE_AGE_MS` ceiling (measured from `refreshedAt`) — an entry older than that returns `null` instead of stale data, which is already every caller's documented "go compute fresh" signal. No caller code changed.
- **RTH check:** Poll `GET /api/market/spx/play` several times a few seconds apart during RTH and confirm `as_of`/`score`/`grade` stay internally consistent across consecutive polls (no jump backward in `as_of`, no flicker between distinct stale values) — same spot-check worth doing on `GET /api/market/nighthawk/edition` and the SPX desk route, the other consumers of this same cache function.

### 101. 0DTE ledger achievability ceiling used the wrong threshold — a 50-54.99% stale-fill dead zone let already-doomed entries grade as instant stops — fix/ledger-entry-premium-ceiling-stop-gap — 2026-09-11

- **What was broken (confirmed systemic via a 90-day record backtest, 7 instances, reported on PR #4076):** `resolveLedgerEntryPremium`'s achievability ceiling (a prior 2026-08-27 fix) caps the graded entry basis down to the live mark when a stale/outlier flow fill sits far above it — but its trigger threshold reused `CHASE_PCT` (55%), a constant tuned for an unrelated question (normal 0DTE gamma-driven premium swing). The play's own hard stop is fixed at -50%, so a fill dislocated 50-54.99% above the live mark stayed uncorrected, letting several real commits (QQQ 2026-09-09 -51.42%, SPXW 2026-08-12 -52.96%, NVDA 2026-08-27 -52.90%, MSFT 2026-08-28 -52.07%) grade a "stopped" exit within seconds of commit off an entry price nobody could ever have gotten.
- **What changed:** the ceiling now triggers at `STOP_TRIGGER_PCT` (= `|PLAN_RULES.stop_pct|` = 50%), derived from the play's actual stop rule instead of the unrelated chase-band constant, closing the 5-point dead zone. `CHASE_PCT` itself (the separate UP-side "MOVED" logic) is untouched.
- **RTH check:** Watch `GET /api/market/zerodte/record?days=1` for any new "stopped" exit landing within a few seconds of its own `flagged_at` — should no longer happen for a dislocation in the 50-54.99% band; if one still occurs, capture `entry_context.exit`/`flow_avg_fill`/the commit-time flow print age, since (per this finding's own blast-radius note) the more extreme historical instances (-63% to -90%) are NOT fully explained by this fix and may indicate `s.plan.mark` was genuinely null at commit for those — worth a fresh trace if it recurs live.

### 102. `legacy-e2e-healthcheck.mjs` Stage B falsely went RED on a normal pre-market no-live-quote state — fix/legacy-healthcheck-zero-bidask-false-positive — 2026-09-11

- **What was broken (live repro, ~08:08am ET, routine per-cycle healthcheck run):** `npm run healthcheck:legacy` reported `overall: RED`, Stage B flagging both AAPL and SWKS with `"mark (5.01) outside [bid=0, ask=0]"` / `"mark (2.51) outside [bid=0, ask=0]"`. Traced to `options-snapshot.ts`'s own documented convention (`midOf()`: "bid may be 0 for deep-OTM; require ask>0 so it is a REAL quote") — pre-market, before any market maker posts a two-sided NBBO, Polygon genuinely returns `bid: 0, ask: 0`, and the product code correctly falls back the mark to the prior session's close (hence the plausible, non-zero 5.01/2.51 values). `verdictForMarkRow` in the healthcheck's own eval helper never applied that same `ask > 0` convention, so it treated the literal `[0, 0]` as a real quoted band and flagged the correctly-computed mark as "outside" it.
- **What changed:** `verdictForMarkRow` now reads `ask <= 0` as "no live two-sided quote" (AMBER, not RED) before applying the band check — matching `midOf()`'s existing convention. A `bid=0` with a real positive `ask` (genuine deep-OTM quote) is unaffected and still gets the full band check.
- **RTH check:** This was an audit-tooling-only fix (never touched the live member-facing `legacy-marks`/`edition` routes), so there's nothing on the live board to re-verify — but worth confirming `npm run healthcheck:legacy` reads GREEN (not AMBER) once RTH is underway and real market-maker quotes are live on both AAPL/SWKS calls, i.e. that the AMBER state was genuinely pre-market-specific and clears on its own once trading starts.

### 103. 0DTE live-marks lane tracked a zombie row whose OCC had already expired — permanent stage-D RED — fix/zerodte-zombie-expired-occ-live-marks — 2026-09-11

- **What was broken (live repro, `npm run healthcheck:0dte`, reproduced twice ~10 min apart during RTH open):** `GET /api/market/zerodte/marks` carried an OKTA row (`status: "TRIM"`, `entry_premium: 5.97`) under **today's** (2026-09-11) tracked set, but its plan OCC (`O:OKTA260904C00140000`) expired **2026-09-04**, a week earlier — `mark: null`, `source: "none"`, `stale: true`, pinning stage D (LIVE MARKS+P&L) RED on every run. `toActivePlay()` only excluded `status === "CLOSED"` rows; nothing checked whether a still-open row's OCC had already expired, so once an end-of-day close was missed for this row, the live-marks poller kept re-including it and polling a dead contract every ~1s tick forever.
- **What changed:** `toActivePlay()` now parses the OCC's embedded expiry and excludes the row (same early-return shape as the CLOSED guard) when that expiry disagrees with the row's own `session_date` — 0DTE's entire premise is same-day expiry, so any mismatch means the row can never be a live position. Applies to both the single-leg and 4-leg condor paths (same `occ` resolution point).
- **RTH check:** Pull `GET /api/market/zerodte/marks` during the next RTH session and confirm the OKTA row (or any other stuck zombie row) no longer appears in the tracked/entered set, and that `npm run healthcheck:0dte` stage D is no longer pinned RED by a dead-OCC row. A fresh RED for a genuinely different, currently-live contract is a separate, real finding — this fix only removes the permanent false pin from an already-dead one. Root cause of *why* the end-of-day close was missed for this row in the first place is still open (needs DB-side investigation this sandbox can't reach — raw Postgres is blocked here).

### 104. Legacy healthcheck had no cross-check between the morning-confirm verdict and the edition's pulled overlay — new Stage D — fix/legacy-healthcheck-pull-status-consistency — 2026-09-11

- **What was missing (found while live-tracing today's real AAPL/SWKS morning-confirm pull event):** Two independently-read surfaces describe the same morning-confirm event — `GET /api/nighthawk/play-status` (the CONFIRMED/DEGRADED/INVALIDATED verdict the 9:15am ET cron writes, Redis-cached with a DB fallback) and `GET /api/market/nighthawk/edition`'s `pulled`/`pulled_reason` overlay (merged at read time from the same underlying DB row by `pull-overlay.ts`). Both trace back to one write (`recordNighthawkMorningVerdict`), so they should always agree, but `legacy-e2e-healthcheck.mjs` never checked `/api/nighthawk/play-status` at all — a real divergence (a member seeing a "Pulled" strikethrough with no matching verdict badge, or the reverse) would have gone uncaught by the standing per-cycle healthcheck.
- **What changed:** New Stage D (`verdictForPullConsistency`) cross-checks every edition play's `pulled` boolean against its `play-status` verdict (`pulled === (status === "INVALIDATED")`) per ticker — a mismatch in either direction is RED with an explicit split-brain evidence string; a ticker with no recorded verdict is AMBER; before the cron has fired for the date, the stage honestly reads SKIPPED rather than fabricating a verdict.
- **RTH check:** This was an audit-tooling-only addition (no product code touched), so nothing new to check on the live board — but worth confirming `npm run healthcheck:legacy` keeps reporting Stage D GREEN through the rest of today's session (both AAPL/SWKS already verified GREEN at build time) and correctly flips to SKIPPED overnight once the date rolls and tomorrow's morning-confirm hasn't fired yet.

### 105. Ask Largo swing play-brief discarded a committed position's ledger OCC symbol before it reached TerminalPlay — C4 IDENTITY — fix/swing-play-brief-occ-identity-gap — 2026-09-11

- **What was missing (found auditing `GET /api/market/swing/play-brief` against `docs/audit/LARGO-PRODUCT-CONTRACT.md`'s IDENTITY point for three live committed positions — NRG#34, NN#32, CG#25):** `horizonRowToDeckSource()` (`play-brief-resolve.ts`) hardcoded `occ: null` for every caller, including `loadOpenTerminalPlay`'s live-ledger-row path where `row.contract_occ` — the exact OCC `commit.ts`/`roll-plan.ts` stamp at commit/roll time — was already in scope and simply discarded. `terminalPlayFromHorizon` (`adapters.ts`) papers over an empty `occ` by reconstructing one from strike/expiry/right, so no envelope ever showed a blank symbol, but a same-tick reconstruction was silently preferred over the ledger's own authoritative identity, and `use-live-marks.ts`'s SSE live-mark overlay keys its lookup on this same `occ` field.
- **What changed:** `horizonRowToDeckSource()` takes an optional `occ` param (default `null`, WATCH-lane caller unchanged); `loadOpenTerminalPlay` now passes `occSymbolFromSwingRow(row)` (the existing fail-closed helper, never reconstructs) so a committed position's brief carries its ledger value, preferred over reconstruction.
- **RTH check:** Pull `GET /api/market/swing/play-brief?playId=SWING:<ticker>:<positionId>` for a currently-committed swing position once the deploy is live and confirm the resolved play's underlying OCC (checked server-side/DB, not currently exposed in the envelope body) still matches the actual held contract — especially useful to re-check on any position that has rolled recently, the one case where reconstruction and the ledger value could genuinely have diverged.

### 106. Legacy scorecard reported a fabricated "Hit rate 0%" on a day where every play was pulled pre-open — fix/legacy-vector-scorecard-all-pulled-hitrate — 2026-09-11

- **What was broken (live repro via `proxy-browser.cjs` screenshot of `/nighthawk?view=legacy`, 2026-09-11):** Both today's plays (AAPL, SWKS) were pulled pre-open by the Cortex `gex-walls` veto and both carried strongly positive counterfactual premium moves (+85%/+162%, SWKS at "100% to stock target") — yet the board's summary line read `0 winners · 0 runners · 2 closed · Hit rate 0%`. `vectorBoardScorecard`'s hit-rate fallback (`hitDenom = closedResolved > 0 ? closedResolved : rows.length`) correctly excludes pulled rows from `closedResolved`, but on a day where 100% of rows are pulled, `closedResolved` stays 0 and the code falls through to `rows.length`/`winners` — a denominator that is entirely phantom (pulled) rows, producing a fabricated 0% that reads as "today's picks lost" when the honest state is "no capital was ever at risk."
- **What changed:** The fallback denominator now excludes never-entered pulls the same way `closedResolved` already does (`nonPulledTotal`). When every row is pulled, `nonPulledTotal` is 0 and the scorecard's existing `hitDenom > 0 ? ... : null` guard correctly returns `null` ("no resolved data") instead of 0%. A mixed day (pulls alongside real open/closed rows) is unchanged — real rows already dominated the old `rows.length` fallback there too.
- **RTH check:** Reload `/nighthawk?view=legacy` on a day where every published play has been pulled pre-open and confirm the scorecard shows an honest "no data yet" state (not "Hit rate 0%") for the Today view; also worth spot-checking Vector's own board (`/vector` or wherever `VectorPickLogBoard` renders) is visually unaffected, since `vectorBoardScorecard` is shared — Vector rows never carry the `PULLED` label so its numbers should be byte-identical to before this fix.

### 107. Banger-origin Swing live positions served a mark with NO freshness timestamp — `npm run healthcheck:swing` Stage F AMBER on ~70/73 positions — fix/banger-swing-mark-freshness — 2026-09-11

- **What was broken (first live run of `npm run healthcheck:swing` this session):** Stage F (MARKS) read AMBER `mark=<value> age=unknown` for the large majority of live Swing MANAGING/SCALING_OUT positions. Traced to `horizonPlayFromBangerPosition` (Engine B positions merged into the Swing lane for display) never setting `markAsOf` at all — `banger_positions` had no per-mark timestamp column, only a generic `updated_at` stamped on every write regardless of whether a fresh mark landed. Confirmed via live CloudWatch that `swing-active-refresh` (the REAL swing_positions marker) only ever touches 4 positions/tick while the live board serves 73 — the rest are banger-merged rows that were silently freshness-blind.
- **What changed:** Added `banger_positions.last_mark_at`, CASE-guarded in `updateBangerLiveState` to advance only on an actual fresh mark (mirrors `swing_positions.last_mark_at`/`updateSwingLiveState` exactly); `horizonPlayFromBangerPosition` now surfaces it as `markAsOf`.
- **RTH check:** Re-run `npm run healthcheck:swing` once a live tick has landed a fresh mark on a banger-origin position post-deploy and confirm Stage F now reports a real age (not "unknown") for that position — and spot-check `GET /api/market/swing/play-brief` on a banger-origin committed position (`signalKinds` includes `"BANGER"`) for a populated mark-freshness read in Ask Largo's own narrative, the other consumer of this same field.

### 108. Ask Largo swing play-brief could not resolve a chain rolled TWICE via an intermediate leg's id — fix/swing-brief-multiroll-chain-identity — 2026-09-11

- **What was broken (roll-narrative end-to-end trace, the natural follow-up to #4794's OCC-identity fix which explicitly flagged rolls as the one case reconstruction/ledger values could diverge):** `root_position_id` sticks to a chain's very FIRST leg only (`roll.ts`'s own design), never to an immediate parent. So root(id=1) → rolled child(id=2, `root_position_id=1`) → currently-open grandchild(id=3, `root_position_id=1`) has no code path that resolves id=2 to the live continuation: no open row has `id=2` or `root_position_id=2`, and the graded row that IS id=2 is `ROLLED` (not `CLOSED`), which `closedDeckSourceFromRow` correctly refuses. A caller referencing that intermediate leg's id (e.g. from a brief shown between the two rolls) silently fell through to an unrelated ticker-only WATCH/closed fallback instead of the live position.
- **What changed:** Added `resolveChainRootId()` (`play-brief-resolve.ts`) — one extra `fetchSwingPositionsRange` lookup, additive and only reached when the existing direct id matches come back empty (zero extra cost for the common single-roll-or-fewer case) — that finds the referenced leg wherever it lives and resolves to its OWN `root_position_id ?? id`, then retries both the open and closed lookups against that resolved root.
- **RTH check:** This needs a real multi-roll chain (roll_seq >= 2) to observe live, which may not exist yet in the current book — when one occurs, pull `GET /api/market/swing/play-brief?playId=SWING:<ticker>:<intermediate-leg-id>` (using an id from BEFORE the second roll, not the current one) and confirm it resolves the currently-open/latest leg rather than an unrelated fallback. Until such a chain exists live, the regression test (`play-brief-resolve.test.ts`, RED→GREEN proven via git-stash) is the only available proof.

### 109. Ask Largo swing play-brief never disclosed roll history — new "Rolled N times" narrative line — fix/swing-brief-roll-history-disclosure — 2026-09-11

- **What was broken (Ask Largo ownership mandate, genuine feature gap flagged in the prior coordinator cycle):** `record.ts`'s chain composite has always had the full `roll_seq` thread available for a rolled swing position, but `tradeManagerNarrativeSection` ("Trade manager read") never mentioned it — a member reading the brief on a rolled position had no way to know from the brief text alone that the current contract wasn't the original entry.
- **What changed:** New `rollHistory?: SwingRollHistory | null` field on `SwingPlayBriefContext` (`play-brief-types.ts`), populated by `play-brief-context.ts`'s `loadRollHistory()` (resolves `positionId` out of `TerminalPlay.id`, looks up the row for its sticky `root_position_id`, walks the full chain via `fetchSwingPositionChain`; `null`/never-rolled when `chain.length < 2` — Largo C6 omission, never fabricated). `play-brief-narrative.ts`'s new `rollHistoryLine()` cites only the MOST RECENT roll (e.g. `**Rolled once** — most recently from the $100 call to the $110 call on 2026-08-20.`), wired into both the open and closed buckets of "Trade manager read." Additive only — a never-rolled position (the large majority) renders identically to before.
- **RTH check:** Pull `GET /api/market/swing/play-brief` for a currently-open or recently-closed swing position that has actually been rolled (check `roll_seq` on the live ledger, or watch for the next roll event) and confirm the "Trade manager read" section now carries the "Rolled N times — most recently from … to … on …" line with the correct strike/right/date for the ACTUAL most recent roll; also confirm a never-rolled position's brief is byte-identical to its pre-fix rendering (no spurious line).

### 110. Roll-history disclosure (#109, deploy above) rendered "$90 contract" instead of "$90 put" — fix/swing-roll-history-right-code — 2026-09-11

- **What was broken (live repro immediately after #109's own deploy reached 8/8, on the FIRST real rolled-chain closed position to hit production — INTC:35):** `GET /api/market/swing/play-brief?playId=SWING:INTC:35&ticker=INTC&positionId=35`'s roll-history line read `"Rolled once — most recently from the $91 contract to the $90 contract"` instead of `"...$91 put to the $90 put"`. Root cause: `loadRollHistory`'s row→leg mapping passed `row.contract_type` straight through (stored as the full word `"put"`/`"call"`), but `rollHistoryLine`'s `fmtLeg` only recognizes the short `"P"`/`"C"` code every other reader in the codebase already converts to (`closed-plays.ts`, `play-brief-resolve.ts`, `live-plays.ts`) — so every leg fell through to the generic `"contract"` fallback, discarding exactly the put/call information the disclosure exists to surface.
- **What changed:** Extracted the row→leg conversion into a new pure function (`swingRollHistoryLegFromRow`, in a new standalone file `play-brief-roll-history.ts` — needed so it could be unit-tested without dragging in `play-brief-context.ts`'s heavy `server-only`-guarded import chain), applying the same `contract_type === "put" ? "P" : "C"` conversion the other three readers already use. No other narrative/gating logic touched.
- **RTH check:** Pull `GET /api/market/swing/play-brief` for INTC (positionId 35, or any other rolled CLOSED/OPEN position) and confirm the roll-history line now correctly names "put" or "call" (never the generic "contract") for both the FROM and TO leg.

### 111. Swing command-deck card could show a realized loss worse than its own labeled "full excursion" trough — fix/swing-watermark-bracket-at-exit — 2026-09-11

- **What was broken (found during the standing CLOSED-play retrace against the 5-truth grader, 6 recent closed chains pulled via `GET /api/market/swing/record?days=14`):** 4 of 5 losing closed positions (AAPL:36, MSTR:33, CCI:31, IGV:28) showed a realized exit WORSE than their own tracked `trough_premium` — e.g. AAPL's card would show "Trough -30.5%" (`PlayTerminal.tsx`'s literal caption: "the full excursion since entry") next to a realized exit of -56.19%. Root cause: `trough_premium`/`peak_premium` are latched only during RTH on `swing-active-refresh`'s 15-minute cadence, so they can never capture an overnight/pre-market gap or an intrabar move between samples — and `gradeSwingPosition` (the terminal grader) never bracketed the watermarks around the actual realized exit the way an earlier fix (2026-08-06) already brackets them around `entry_premium`.
- **What changed:** `gradeSwingPosition`'s SQL now widens `peak_premium`/`trough_premium` to bracket the implied exit premium at grade time (same GREATEST/LEAST widen-only shape as the entry fix); a new one-time `ensureSchema` migration backfills already-graded historical rows the same way.
- **RTH check:** Pull `GET /api/market/swing/record?days=N` for a ticker whose closed chain previously showed this pattern (AAPL:36, MSTR:33, CCI:31, IGV:28 as of this writing) and confirm `troughPremium`/`peakPremium` now bracket `exitPnlPct` — i.e. the implied exit premium (`entryPremium * (1 + exitPnlPct/100)`) falls within `[troughPremium, peakPremium]`. Also worth a visual spot-check on the command-deck card (`/nighthawk`, Swing tab) for one of these tickers once its historical row is backfilled, to confirm "Trough" no longer reads shallower than the realized P&L shown elsewhere on the same card.

### 112. Production Next.js had an unauthenticated RCE (GHSA-2xp9-vwfh-vxw4) — patched 8 other npm-audit findings same PR — fix/npm-audit-next-critical-rce-patch — 2026-09-11

- **What was broken (found via a full adversarial security audit, operator-requested, 6 parallel domains — this was the one Critical result):** Production ran `next@15.5.23` — vulnerable to GHSA-2xp9-vwfh-vxw4, an unauthenticated RCE in the Image Optimization API's AVIF handling, and to the bundled `sharp` copy's own inherited libvips/libheif CVEs. Confirmed live on a clean `origin/main` checkout: `npm audit --production` → 1 critical / 6 high / 2 moderate, 9 total. Also caught and self-corrected a git-state-drift error mid-investigation (HEAD had silently drifted onto the fix PR's own branch commit rather than true `origin/main` while re-checking — the documented shallow-clone/container hazard) before it could mislead a "refuted" conclusion to the operator.
- **What changed:** `npm audit fix` (no `--force`) bumped `next` to `15.5.25` plus the 8 secondary findings (sharp, browserslist, fast-uri, js-yaml, nanoid, baseline-browser-mapping, colord, docx-nested-nanoid) — all patch/minor-range, zero breaking changes, verified via `npm audit fix --dry-run` before applying and via a real `npm ci` + `npm audit` on the PR's own head commit after (0 vulnerabilities, `next@15.5.25`).
- **RTH check:** Confirm `npm audit --production` on `origin/main` reports 0 critical/high (should already hold post-deploy); spot-check `next/image`-served pages render normally with no regression from the `sharp` bump; this is a routine dependency patch with no product-code changes, so the main risk is a silent build-tooling incompatibility, not a behavior change — a clean `npx tsc --noEmit` + full `npm test` (13756/13756 pass, confirmed pre-merge) already covers that.

### 113. Vector background crons blocked the shared web ECS event loop, causing ALB p99 25-50s tail-latency spikes during RTH — fix/vector-background-cron-event-loop — 2026-09-11

- **What was broken (measured via CloudWatch during the standing performance-mandate sweep, cross-lane collaboration — Claude measured/raised, Vector lane fixed):** `AWS/ApplicationELB` `TargetResponseTime` on `blackout-production-app` hit p99 25-50s repeatedly across every 15-min window during RTH (18:07-19:52 UTC) while p50 stayed low (0.05-0.17s) — a tail-latency signature, not fleet capacity (`blackout-production-web` ECS CPU max hit 90-95% in the same windows while average stayed 20-25%). Correlated CloudWatch Logs: three Vector background crons (`vector-pick-sweep` 2min schedule, `vector-dark-pool-warm` 10min, `vector-full-state-snapshot` 5min) each ran 130-256s, all dispatched via `after()` onto the SAME `blackout-production-web` ECS service/ALB target group that serves live member traffic (confirmed via the cron Lambda's `CRON_TARGET_BASE_URL` pointing at the production ALB directly, not the separate `blackout-production-market-worker` service) — the fire-and-forget dispatch doesn't stop the CPU-bound ranking/scoring work inside each sweep from blocking the single Node.js event loop on whichever of the 8 web tasks the ALB happened to route the cron to, stalling any live member request concurrently routed to that same task.
- **What changed:** Added `await new Promise(resolve => setImmediate(resolve))` yields between ticker batches in `runVectorPickUniverseSweep()` (4-ticker batches) and `runVectorFullStateSnapshot()` (3-ticker batches) — `setImmediate` is a real macrotask-level yield (unlike a microtask-only `Promise.resolve()`), so it actually lets the event loop service pending HTTP request callbacks between batches. Caps the maximum contiguous event-loop block to roughly one batch's CPU work instead of the whole multi-minute sweep. Reviewed independently (diff, regression tests, yield technique) before this was merged — sound and minimal.
- **RTH check:** Tomorrow at RTH open, re-pull `AWS/ApplicationELB` `TargetResponseTime` p99 for the same 15-min-window granularity during active `vector-pick-sweep`/`vector-dark-pool-warm`/`vector-full-state-snapshot` windows — should stay materially below today's 25-50s spikes (a few seconds at most would confirm the fix; anything still spiking into the double-digit seconds means the yield granularity needs tightening, e.g. smaller batch sizes, not that the approach was wrong).

### 114. Legacy thesis text's R:R display could round across the label's own threshold, printing a self-contradictory number — fix/legacy-rr-display-rounding-boundary — 2026-09-11

- **What was broken (live spot-check, 2026-09-11 evening edition's fresh HPE/DELL picks):** `buildDeterministicThesis`'s R:R clause labels quality from the true ratio (`rr >= 0.5 ? "acceptable" : "tight"`, etc.) but displayed it with `rr.toFixed(1)` (round-to-nearest) — so `rr=0.49` (labeled "tight") printed as `R:R 0.5:1 (tight)`, a number sitting right on the ladder's own "acceptable" cutoff next to the "tight" label. Live-reproduced on **both** of today's fresh picks: HPE (`rr=0.49`) and DELL (`rr=0.45`), both printing "0.5:1 (tight)" — not a rare edge case, it fires for any ratio in the last tenth below a threshold.
- **What changed:** The displayed number now floors instead of rounding to-nearest (`Math.floor(rr * 10 + 1e-9) / 10`), so it can never read higher than the true ratio and can never cross into a higher label's territory than the label reflects. `0.49` now prints `R:R 0.4:1 (tight)`. Only the display changed — `computeRiskReward`'s own math and the label thresholds are untouched.
- **RTH check:** Audit-tooling/narrative-text-only fix, no live data path touched — nothing to re-verify against live prices. Worth a quick visual spot-check on the next edition with a play whose R:R lands near a threshold boundary (0.45-0.49, 0.95-0.99, or 1.95-1.99) to confirm the printed number and label read as consistent (e.g. "0.4:1 (tight)", never "0.5:1 (tight)").
- **Follow-up (2026-09-12, ~00:41 UTC) — the check above already caught a real rollout-timing gap, not a code bug.** Re-pulled the currently-published `edition_for: 2026-09-14` (Monday) edition live: both HPE (`rr_ratio: 0.49`) and DELL (`rr_ratio: 0.45`) still print **"R:R 0.5:1 (tight)"** — the PRE-fix text — not the corrected "0.4:1 (tight)" the fix should produce (verified `Math.floor(0.49*10+1e-9)/10 === 0.4` in isolation; the fix logic itself is correct). Root cause of the mismatch: this edition was published 2026-09-11T21:40:55Z (the nightly `nighthawk-playbook`/`nighthawk-edition` cron, 5:30 PM ET weekdays), and the R:R fix (`ab3781aa`, PR #4813) didn't deploy until 2026-09-11T23:31:26Z — the edition's thesis TEXT is generated once at publish time and stored, so a display-only fix that lands after that day's 5:30pm publish does not retroactively correct the already-published edition; the NEXT regeneration is Monday 5:30pm ET (for Tuesday's edition), not before Monday's market open. **So Monday 9/14's live Legacy board will show the pre-fix "0.5:1 (tight)" for HPE/DELL all session** — the true floored value is a hair tighter (0.4:1) than what members will see. Not a data-correctness bug (the underlying `rr_ratio`/label are correct, only the displayed number is one edition-cycle stale) — flagging here so nobody mistakes Monday's still-wrong display for the fix having failed, and as a general note: any Legacy thesis-TEXT fix merged after 5:30pm ET on a given day won't reach members until the FOLLOWING day's edition, a rollout lag worth remembering for any future narrative/display fix to this pipeline.

### 115. Raw NUL bytes silently corrupted three tracked source files (one swing, one 0DTE, one audit script) — fix/swing-anomaly-dedup-key-null-byte — 2026-09-11

- **What was broken (found auditing `play-brief-intel.ts` for the standing Ask Largo mandate — `grep`/`file` reported the file as binary):** A byte-level scan found a raw NUL byte, introduced by PR #4799, sitting inside a dedup-key template literal where a plain space was clearly intended (`` `${a.anomaly_type}\x00${a.detail}` ``) — rendered as ordinary whitespace by every editor, this session's own `Read`/`Edit` tools, and `git blame`. A repo-wide byte scan found the identical corruption in `src/lib/zerodte/calibration.ts` (0DTE lane) and a third, functionally-harmless-but-still-stylistically-corrupting instance in `scripts/audit/upstream-ws-probe.cjs` (a control-character-stripping regex written with literal raw bytes instead of `\xHH` escapes — rigorously verified byte-for-byte behaviorally identical before/after).
- **What changed:** All three fixed (space character restored in the two dedup keys; explicit escapes in the regex, zero behavior change). New `src/repo-hygiene.test.ts` guard scans every tracked source file for an embedded NUL byte going forward.
- **RTH check:** No live product behavior changed (the dedup logic worked correctly either way; the regex is provably identical) — nothing to re-verify against live traffic. Worth confirming `grep` (without `-a`) now searches all three files normally instead of reporting "binary file matches" as a quick sanity check that the byte-level fix actually landed.

### 116. Ask Largo swing play-brief never surfaced the actual entry-trigger price — only a "flag anchor" easily mistaken for it — fix/swing-entry-trigger-price-transparency — 2026-09-12

- **What was broken (found live, in a real conversation — asked which price to watch for a WATCH-lane entry, read "Flag anchor: 175.87 — track move from here" as the breakout level, which it is not):** `flagUnderlyingPx` is the underlying price pinned when the thesis was FIRST FLAGGED — a historical reference, not the level that flips the setup from PRE_TRIGGER/FORMING to AT_TRIGGER/TRIGGERED. The real trigger level (`setup-state.ts`'s `triggerPx`, sourced from `dossier.plan.entryUnderlyingPx`) was already computed server-side for every WATCH row — it's what drives the PRE_TRIGGER/AT_TRIGGER/EXTENDED classification the brief already shows — but was never threaded through to the member-facing text. The two numbers can genuinely diverge (flag anchor is pinned; the trigger tracks the dossier's live plan) — confirmed live on COIN, where the real resistance/trigger structure sat near a $182.50 call wall, well above the $175.87 flag anchor.
- **What changed:** Threaded the already-computed `triggerPx` through `HorizonPlay` → `TerminalPlay` as a new `entryTriggerUnderlyingPx` field (additive only, no new computation) and added an "Entry trigger: **$X** — Break/reclaim above/below this is what actually fires the setup" line to the WATCH-bucket "Watch levels" section, right after "Flag anchor" — direction-aware, omitted when absent, never fabricated.
- **RTH check:** Pull `GET /api/market/swing/play-brief` for any live WATCH-lane candidate with a grounded plan (e.g. COIN, MRVL) once RTH data refreshes and confirm the new "Entry trigger" line renders with a real number distinct from "Flag anchor," and that the direction wording (above for LONG, below for SHORT) matches the play's actual direction.

### 117. Swing lane-rank "leader" callout could name a position the desk is already telling members to exit — fix/swing-lane-rank-exiting-leader — 2026-09-12

- **What was broken (found live, sweeping the real OPEN book):** `computeLaneRank` picked the named "leader" pointer purely by static score, with no regard for the position's current management state. CRWD sat #1 by score (86.5) among real OPEN positions while its own manage engine had already fired `EXIT_RUNNER` (round-tripped from +129.7% peak to -9.5% mid). NN#32's brief still read "Leader: **CRWD** @ **86.5** — confirm before adding size" — advice that reads as "put money here" about the exact position the desk was telling members to exit.
- **What changed:** `computeLaneRank` now picks the named leader from peers whose `manageAction` isn't `EXIT`/`EXIT_RUNNER`, falling back to the raw #1 only if every peer is exiting. `rank`/`medianScore` are unchanged (still computed against the full peer set — an honest "where do you stand" regardless of exit state); only the pointer that reads as "look at this one" is fixed. WATCH-bucket rows never carry `manageAction`, so WATCH-lane behavior is unchanged.
- **RTH check:** Pull `GET /api/market/swing/play-brief` for a real OPEN position that is below the lane median while the current score-#1 peer has round-tripped into TRIM/EXIT, and confirm the "Leader: ..." callout names a peer that's actually still held open, not the exiting one.

### 118. Swing/Banger "score pillars" never summed to the score shown next to them — fix/swing-banger-factors-score-mismatch — 2026-09-12

- **What was broken (5-engine health check + Ask Largo deep-dive, live `GET /api/market/nighthawk/horizons?view=swings`, 90 committed SWING rows):** 85 of 90 committed rows are BREAKOUT/Banger-lane-merged positions whose `factors` array (`[{label:"Discovery gain", points: <raw gain%>}]`) never summed to the `score` shown right next to it — every one short by roughly half its own score (e.g. `ODD` score 66 vs a single "Discovery gain +13 pts" factor, `HPE` 65 vs 10, `DLLL` 69 vs 18). `score` is `60 + round(gainPct/2)` while `factors[0].points` was the raw, untransformed gain% — two different quantities sharing the same field the true swing-pillar dossiers (`swing-pillars.ts`) always sum exactly to `score`. Both `PlayTerminal.tsx`'s "Why this play was picked" panel and Ask Largo's `play-brief-intel.ts::whyThisSetupSection` ("**Score pillars:**") render this array as an itemized explanation of the score — so a member expanding either panel on any of these 85 rows saw a factor breakdown that didn't add up, with no note that ~half the score was unaccounted for. A second, independent instance of the same root cause: `vector-lane-enrich.ts`'s Vector-corroboration score bump (+3 to +8) was never recorded in `factors` at all.
- **What changed:** `banger-lane-merge.ts` now sets `factors: [{label: "Discovery gain", points: score}]` (attributing the WHOLE score to the one real signal in this lane — the honest read, not just an arithmetic patch; the raw gain% stays visible via the `reason` field). `vector-lane-enrich.ts` now appends a `{label: "Vector corroboration", points: appliedBump}` factor using the ACTUALLY-applied score delta (correctly smaller than the raw bump when the 99-point ceiling clamp reduces it).
- **RTH check:** Open a live BREAKOUT/Banger-origin SWING position's "Why this play was picked" panel (command deck, `/nighthawk` Swing tab) and its Ask Largo play-brief "Why this setup" section, and confirm the single "Discovery gain" factor now equals the SCORE shown next to it. Also check any position that has recently picked up a Vector corroboration badge (`signalKinds` includes `"VECTOR"` via a leader-hint match, not just a discovery-origin tag) for a "Vector corroboration" line in the same breakdown.

### 119. Ask Largo "Book context" rendered a pending-entry-decision framing on an already-CLOSED trade — fix/swing-book-context-closed-bucket — 2026-09-12

- **What was broken (live repro, `GET /api/market/swing/play-brief` on a real closed AAPL position, positionId 36):** `bookContextSection` fires for every bucket (WATCH/OPEN/CLOSED) with present/future-tense "Adding {ticker} stacks the same wager rather than diversifying risk" copy, comparing against the member's CURRENT live book. On the closed AAPL:36 brief this rendered a concentration warning against the member's separate, LATER, unrelated AAPL:37 re-entry — reading as live guidance about a decision that doesn't exist on a CLOSED brief.
- **What changed:** `bookContextSection` now returns `null` immediately for `play.status === "CLOSED"`, before checking book overlap at all — gated out entirely (not reworded) since "book overlap at review time" isn't a fact about the closed trade being reviewed.
- **RTH check:** Pull `GET /api/market/swing/play-brief` for any CLOSED position whose ticker/theme overlaps the member's current live book and confirm "Book context" no longer renders (WATCH/OPEN briefs with a genuine overlap should still show it).

### 120. Ask Largo's entire swing play-brief engine was unreachable from live chat — no tool wraps it — fix/largo-swing-play-brief-tool — 2026-09-12

- **What was broken (found during a dedicated multi-agent research pass across the whole Night Hawk product):** `composeSwingPlayBrief()` — the function CLAUDE.md itself names as "Ask Largo" — was reachable only from the Command Deck UI panel's own route, never from a Largo chat tool call. `grep -rn "composeSwingPlayBrief" src/lib/largo/` returned nothing; the only swing tool Largo could call, `get_swing_horizon`, returns board counts, not per-play detail. Every fix landed under the standing Ask Largo mandate for weeks (narrated dealer read, archetype track record, book context, tonight's lane-rank/factors-score fixes) has been invisible to an actual chat conversation, visible only in the panel.
- **What changed:** New `get_swing_play_brief` Largo tool (`tool-defs.ts` + `run-tool.ts` + new `swing-play-brief-read.ts`), calling the EXACT SAME resolve → compose pipeline the panel's route uses. Accepts `ticker` (required) plus optional `positionId`/`strike`/`right`/`status` disambiguation hints. Registered in the Largo capability registry alongside `get_swing_horizon`. Purely additive — no existing tool/route/UI behavior touched.
- **RTH check:** Ask Largo chat "what's your read on my [ticker] swing position" for a real open position at the next RTH session and confirm the answer now cites book-context/thesis-health/dealer-read content matching that ticker's Command Deck panel, not just a board-count summary.

### 121. 0DTE skip-grading's `session_date` normalization fetched the WRONG day's minute bars on every row — all 18 hard-gate codes read `n=0` graded — fix/skip-grading-session-date-utc-anchor — 2026-09-12

- **What was broken (traced from `docs/audit/0DTE-RESEARCH.md`'s "Gate-overlap ablation" 2026-09-10 finding — every one of 18 hard-gate codes in `GET /api/market/zerodte/calibration`'s `blocked_value[]` read `n=0` graded outcomes on the Blocked side over a 90-day window, dominant ungradeable reason "no underlying bar at/after the block time"):** `runSkipGrading` normalized a `zerodte_scan_rejections` row's `session_date` (a plain `DATE` column, no timezone) by running node-postgres's returned JS `Date` object — anchored at UTC MIDNIGHT for that calendar day, standard pg behavior — through `etYmd()`, a helper built for converting a REAL epoch instant to its ET calendar day. Because America/New_York sits behind UTC, midnight UTC always reads as the previous evening in ET, so `etYmd()` silently returned the day BEFORE the row's real, stored `session_date` on every single row, every day of the year (deterministic, not occasional). That wrong date drove the underlying minute-bar fetch to the WRONG session, so no bar ever landed at/after the correctly-computed block instant — the counterfactual "what did the hard gates cost us?" grader had been producing zero usable evidence platform-wide. **The research doc's own hypothesis (a timezone bug in the ADJACENT `observed_at`/`Date.parse` field) was investigated and REFUTED** — that field round-trips correctly (verified empirically across 3 process timezones) — the real bug was one field over, on `session_date`.
- **What changed:** `session_date` is now read through `db.ts`'s own `isoDateString` helper (the established idiom already used for every other `DATE` column in this codebase — reads the UTC Y-M-D directly, never through an ET conversion), instead of `etYmd()`. No gate/scoring logic touched. Regression test added (`skip-grading.test.ts`) supplying `session_date` in pg's real Date-at-UTC-midnight shape (every prior hermetic test in this file used a plain string, which is why this shipped undetected) — RED pre-fix (fetched `2026-07-09` bars for a `2026-07-10` row), GREEN post-fix.
- **RTH check:** Once a fresh population of `zerodte_scan_rejections` rows has been graded under the fix (the admin-triggered `runSkipGrading`, or the next scheduled pass that calls it), re-run `scripts/audit/zerodte-gate-primary-ablation.mjs --days=90` (or pull `GET /api/market/zerodte/calibration`'s `blocked_value[]` directly) and confirm at least one previously-`n=0` gate code (e.g. `score_floor`, `thesis_rank_reject`, `late_afternoon`, `min_gross`) now shows a nonzero graded Blocked-side count. This is a data-plumbing fix only — no live member-facing surface changes, so the check is specifically about the calibration/ablation tooling starting to produce real numbers, not a UI or board check.

### 126. catalystCoaching's earnings-gap-safety check ignored BMO/AMC timing on a same-day expiry — fix/swing-earnings-gap-premarket-same-day — 2026-09-12

- **What was broken (found reviewing coaching functions adjacent to the in-flight #4825 lane-rank fix):** The earnings-gap-safety check (`expiry <= earnings.earnings_date` → "no earnings-gap exposure") treated a contract expiring on the SAME day as the print as automatically safe. That's only true for an after-hours print (option settles at that day's close before the print lands); a PREMARKET print gaps the stock before the bell, so a contract alive through that day's open was exposed to the gap despite "expiring on/before the print."
- **What changed:** Same-day expiry is now only called safe when `report_time` is confirmed after-hours (`/^(after|post)/i`). Unknown/unconfirmed timing on a same-day expiry defaults to NOT safe, falling through to the original warning — matching this file's existing honest-absence discipline. A strictly-earlier expiry is unchanged (always safe).
- **RTH check:** Find a live WATCH/OPEN brief whose own contract expires the SAME day as its ticker's next earnings print and confirm the copy matches the print's actual timing — "no earnings-gap exposure" only for a confirmed after-hours print, the standard warning for premarket or unconfirmed timing.

### 127. Ask Largo swing "Book context" concentration check was blind to 94% of the live open book — fix/swing-book-context-banger-blind-spot — 2026-09-12

- **What was broken (task-directed investigation confirmed against live data — `GET /api/market/nighthawk/horizons?view=swings`, `GET /api/market/swing/play-brief`):** `bookContextSection`'s theme/direction overlap check reads `ctx.openBook`, populated by `loadOpenBook()` which called only `fetchOpenSwingPositions()` — `swing_positions` table only. Engine B (Banger) open positions live in the separate `banger_positions` table, merged into the Swing lane's DISPLAY by `banger-lane-merge.ts` but never into this book. Confirmed live: of 85 open SWING positions, 80 (94%) are banger-origin; sampling all 5 swing-native positions (AAPL, NRG, NN, CG, CRWD) plus 4 banger-origin ones (EBS, CRMG, QCML, CRSR) showed "Book context" never rendered for ANY of them — the 5 swing-native rows also share no theme with each other, so the tiny book the check could ever see never overlapped either.
- **What changed:** `loadOpenBook()` now also merges `fetchBangerOpenBookRows()` (the same accessor `fetchActiveSwingPlaysForMarks` in `live-marks-active.ts` already uses for the equivalent live-marks merge), gated by the same `isBangerEngineEnabled()` kill-switch, direction hardcoded `"LONG"` (banger positions are always long calls — no `direction` column exists on that table), `positionId` deliberately left unset (banger/swing id sequences can collide — `checkPortfolioOverlap`'s ticker+direction fallback is exact here since direction is a fixed constant). Banger fetch fails soft independently of the swing fetch.
- **RTH check:** Pull `GET /api/market/swing/play-brief` for a currently-open banger-origin position (`signalKinds` includes `"BANGER"` on the horizons board) that shares a theme (per `theme-cluster.ts`'s resolver) with another live position — swing-native or banger-origin — and confirm "Book context" now renders concentration/conflict language that references the OTHER position by ticker+direction. Also spot-check a swing-native position against a same-theme banger-origin position to confirm the reverse direction of the merge works too.

### 130. A live committed Swing position's "score pillars" drift away from its own score the longer it's held — fix/swing-live-factors-score-mismatch — 2026-09-12

- **What was broken (5-engine live monitor + Ask Largo deep-dive, live `GET /api/market/nighthawk/horizons?view=swings`):** `score` on a committed row is `feature_vector.evidence_score`, deliberately PINNED at commit (so calibration/trajectory studies can grade the AT-COMMIT prediction). But `attachThesisExplanation` borrowed `factors` from a same-ticker dossier RE-RUN TODAY — whose pillar reads legitimately drift day to day — so the two silently disagreed the longer a position aged. Live repro: `AAPL` positionId 37 (SECTOR_ROTATION, real open capital, committed 2026-09-11) showed "score 84.4" beside factor rows summing to only 75.0, a 9.4pt/11% unexplained gap; two more genuine (non-Banger) swing-pillar rows in the same snapshot (MRVL, IREN) showed the same pattern. A third, distinct occurrence of the exact failure mode #4826 (finding #118 above) fixed for Banger/Vector-bump paths — this one on the plain live-managed-position path neither of those touched.
- **What changed:** `live-plays.ts`'s `livePlayFromSwingPosition` now reconstructs `factors` from the position's own FROZEN `pil_*` pillar signals + archetype (pinned in `feature_vector` at commit, right alongside `evidence_score`) by re-running the same pure `scoreSwingPillars` on those frozen inputs — deterministic, so the sum-to-score invariant holds by construction. `serving-lane.ts`'s `attachThesisExplanation` now prefers this pinned reconstruction over a fresh dossier borrow, falling back to the old dossier-borrow behavior only for older rows with no pinned pillar detail. `score` itself is untouched (still correctly pinned).
- **RTH check:** Once a genuine swing-pillar-scored (non-Banger) position has been open across at least one full session, open its "Why this play was picked" panel and Ask Largo play-brief "Why this setup" section and confirm the factor rows sum to exactly the score shown — check a position held several sessions in particular, where the pre-fix drift would have been largest.

### 132. 0DTE trim_scale's TREND-regime dead zone still dumped a double-digit peak to flat breakeven — closed with a graduated floor — fix/trim-scale-trend-dead-zone-partial-floor — 2026-09-12

- **What was broken (already documented/measured, verified still live on `main` today):** the 2026-08-27 dead-zone fix (`FINDINGS.md`) explicitly left `trend`-regime peaks in [20%, 40%) unprotected — no `trim_scale` tranche is armed yet in that window (trend's first tranche is +40%), so the shared ratchet breakeven floor (flat 0%) was the only guard, dumping the WHOLE position on a retrace. `docs/audit/0DTE-RESEARCH.md`'s 2026-09-04 measurement found this live: 37/372 graded plays (9.9%) exited via `ratchet_breakeven_floor` after a median +26.67% peak (up to +48.56%) — e.g. BULL +20.45%→0%, CLS +31.18%→0%. Re-checked the shipped code directly this session (not trusting the prior write-up) and confirmed the gap was still exactly as measured.
- **What changed:** New `trimScaleFloorPct()` (`exit-engine.ts`), used only by `decideTrimScale`, floors at HALF the peak (instead of flat 0%) specifically inside a regime's own genuine dead zone — non-empty only for `trend` today. `TRIM_SCALE_RULES.tranches_by_regime` (the trim schedule itself, including trend's own +40/+80) is completely untouched — this does not make trend trim earlier, it only stops the floor from wiping the position with zero graduated protection while waiting for the first real tranche. New reason `trim_scale_dead_zone_floor` distinguishes this tier in the ledger. `ratchetFloorPct` itself (ratchet-mode rows, and the board's display floor in `zerodte-service.ts`) is untouched.
- **RTH check:** Once a live `trend`-regime `trim_scale` position peaks in the 20-39% range and then retraces, pull its row via `GET /api/market/zerodte/record` and confirm the exit (if it fires) shows `reason: "trim_scale_dead_zone_floor"` with `floorPnlPct` at roughly half its peak — not `ratchet_breakeven_floor` at 0%. Also worth a `regime-dead-zone-ab.mjs` re-run (per its own 2026-09-04 "re-run in 2-3 weeks" note, now closer due) once the trend-regime closed population has grown past its prior 0-3 samples, to see whether the graduated floor actually improved realized outcomes versus the historical flat-breakeven dumps.

### 133. PR #4822's GEX-heatmap event-loop yield left 3 sibling `buildDepthBlockForExpiries` calls un-yielded — completed — fix/gex-heatmap-depth-block-event-loop-yield — 2026-09-12

- **What was broken (measured live, 2026-09-12):** Pulled fresh `AWS/ApplicationELB` `TargetResponseTime` at 60s granularity and found a recurring pattern of ~1-minute windows with p99/max spiking to 41-42s (e.g. 04:21, 04:25 UTC) even AFTER PR #4822 (merged 03:13:57 UTC, fully rolled out by 04:25:19 UTC) shipped its event-loop yield fix for `buildGexHeatmapUncached`. A dedicated investigation traced the residual gap directly in the code: #4822 added a `setImmediate` yield to the `maxPainByExpiry` loop and to the depth-block loop over `nearKeep`, but left 3 sibling calls to the same expensive `buildDepthBlockForExpiries` helper (the initial whole-nearTermKeep-scope `depth` build, the `nearPresetBlock` rebuild, and the `farBlock` build for far-dated expiries) completely un-yielded — each one an O(depthContracts) pass over the same ~11K-contract (SPX) array with zero opportunity for the event loop to service concurrent member requests in between.
- **What changed:** Added the identical `await new Promise((resolve) => setImmediate(resolve))` yield already used elsewhere in this function after each of the 3 previously-un-yielded `buildDepthBlockForExpiries` calls in `src/lib/providers/polygon-options-gex.ts`. No computation logic changed — byte-identical results, just interleaved with real macrotask yields so a large chain's depth-ladder build can no longer run as one uninterrupted synchronous block.
- **RTH check:** Once this fix is live, re-pull `AWS/ApplicationELB` `TargetResponseTime` at 60s granularity during RTH for `blackout-production-app` and confirm the 41-42s single-task-blocking spike pattern is gone (a distinct, SEPARATE contributing mechanism was also identified — `runWithBackgroundUwSweep`'s cluster-wide UW rate-limiter reservation showing up as `[uw] queue wait 15000-18500ms` under `nighthawk-edition`'s long overnight run, visible as p50-elevated spikes like 04:36 UTC's p50=11.2s — that is a deliberate, already-mitigated tradeoff and is NOT touched by this fix, so some spikes may persist from that separate cause and should not be mistaken for this fix failing).

### 134. 0DTE ratchet-mode backtest harnesses never set `exitMode`, silently grading `trim_scale` logic instead — corrected historical "ratchet wins" conclusion is now unverified — fix/zerodte-ratchet-backtest-exitmode-bug — 2026-09-12

- **What was broken (found during the Night Hawk three-engine deep audit, cross-questioning a proposed new ratchet rung):** `scripts/audit/zerodte-sim.mjs`'s `gradeThroughExitEngine` and `scripts/audit/tier-exit-mode-ab.mjs`'s own copy both build the "ratchet" grading arm's input without ever setting `exitMode`, so the real `evaluateExitState` falls back to `DEFAULT_EXIT_MODE` — which is `"trim_scale"`, not `"ratchet"` as a stale doc-comment claimed. Proved directly: the same input graded through `evaluateExitState` with vs. without an explicit `exitMode:"ratchet"` produces different actions/reasons. This means the 2026-08-29 "RATCHET wins 45.5%WR/+5.5%P&L vs trim_scale" finding (cited since in `docs/audit/0DTE-RESEARCH.md` and PR history) never measured real ratchet behavior — both arms of that comparison were grading trim_scale. A quick uncommitted spot re-measurement this session found genuine ratchet grading materially worse (30%WR/−6.8% avg P&L) — directional evidence the conclusion changes, not a new authoritative number.
- **What changed:** Both scripts' ratchet-arm builders now set `exitMode: "ratchet"` explicitly (matching the sibling `trim_scale`-arm builders in the same files, which already did this correctly); `exit-engine.ts`'s stale doc-comment on `exitMode` corrected to say the true default (`"trim_scale"`). `scripts/audit/regime-dead-zone-ab.mjs` was checked directly and does NOT share this bug (it has no separate ratchet-mode grader at all) — confirmed, not assumed. No production gate/floor/exit behavior touched — this is a backtest-tooling input-construction fix only; real committed 0DTE plays always pass an explicit `exitMode` via `resolveExitModeForTier` and were never affected.
- **RTH check:** No live board/member-facing behavior changed, so nothing to re-verify on the live site. The follow-up that DOES matter: re-run the now-corrected `scripts/audit/tier-exit-mode-ab.mjs` for a fresh, citable ratchet-vs-trim_scale verdict, and treat every prior "ratchet wins" citation in this repo's docs as unverified until that re-run lands — do not quote the pre-fix 45.5%/+5.5% number as settled.

### 135. `swing-active-refresh`'s registry `description` still said "Hourly" after the cadence was raised to every 15 minutes — fix/swing-active-refresh-cron-description-stale — 2026-09-12

- **What was broken (found during the Night Hawk three-engine deep audit):** `src/lib/cron-registry.ts`'s `swing-active-refresh` entry had `schedule_label: "Every 15 min (market hours)"` and `stale_after_min: 25` sitting next to a `description` that still said "Hourly refresh...". Traced to PR #1324 (2026-07-29), which correctly raised the cadence to every 15 minutes but missed the sibling `description` field. Confirmed 15-minute cadence is the real deployed behavior via three independent, convergent, recent sources already in `FINDINGS.md` (live `events.describe_rule` 2026-09-02/09-08 + 2026-09-11 CloudWatch logs); `blackout-infra`'s `cron-jobs.json` entry for this key is the stale artifact (unmodified since 2026-07-28), not this file.
- **What changed:** `description` corrected to match the real 15-minute cadence. `schedule_label`/`stale_after_min` left untouched (already correct). Confirmed zero call sites parse/branch on `description` (display-only) — a pure text fix, no behavior change.
- **RTH check:** None needed — display-string-only change, no live data path touched. Worth confirming the admin cron-health dashboard/`bie/discovery.ts` payload shows the corrected description text next time it's viewed. Separately flagged (not fixed here): `swing-active-refresh` only refreshes 4 real `swing_positions` rows per tick while the live Swing board serves ~73 positions (mostly Banger-origin, merged in for display) — a real staleness/architecture question worth chasing next.

### 136. G-23's qualify-to-commit dislocation check had a real predicate but no way to measure its real distribution — new commit-time telemetry — fix/zerodte-g23-dislocation-telemetry — 2026-09-12

- **What was broken (0DTE `NEEDS_MEASUREMENT` item from the Night Hawk three-engine deep audit):** G-23 (`qualificationDislocationGateBlocks`, shipped 2026-09-09) blocks a fresh 0DTE commit on a fast/large underlying move since qualification, or a crossed/locked book — the predicate itself was already correct and tested, but it only ever surfaced as a formatted `reason` string on the rare commit it actually blocks. Nothing pinned the same elapsed-ms/move-pct math for the (much larger) population of commits that cleared the gate, so there was no way to ask, from real production data, how large the real qualify-to-commit gap typically is, or whether the 1.5%/5-minute threshold is well-calibrated against that distribution.
- **What changed:** `persistZeroDteScan` now pins a `qualification_dislocation_telemetry` blob (`qualification_underlying_price(_as_of)`, `current_underlying_price(_as_of)`, `elapsed_ms`, `move_pct`) onto `entry_context` for EVERY committed row, computed with the exact same formula the gate itself uses — deliberately recomputed rather than read off the gate verdict so the telemetry can never disagree with what actually decided a block. Omitted (never zero-filled) when either snapshot is missing. No gate/scoring/behavior change — purely additive observability.
- **RTH check:** No live board/member-facing behavior changed, so nothing to visually re-verify. The actual follow-up: once 1-2 weeks of live commits have accumulated this field, pull `GET /api/market/zerodte/record` and build the real qualify-to-commit elapsed/move-pct distribution before considering any premium-side (contract mark) dislocation check or threshold retune — the next `NEEDS_MEASUREMENT` step this telemetry exists to unblock.

### 137. Legacy morning-confirm-promoted Swing plays showed "score pillars" that never summed to their own score — fix/swing-legacy-promote-factors-score-mismatch — 2026-09-12

- **What was broken (5-engine live monitor + Ask Largo deep-dive, live `GET /api/market/nighthawk/horizons?view=swings`):** `buildLegacySwingArtifacts` (`legacy-confirm-promote.ts`) set a Legacy-morning-confirm-promoted play's `score` to Legacy's own published edition conviction score, but its `factors` (rendered as "Score pillars" in the command deck and Ask Largo's "Why this setup" section) came from a freshly re-run swing dossier's own INDEPENDENT synthetic pillar score — two different scoring runs paired as one breakdown. Live repro, all three real Legacy-promoted rows in the same snapshot: MRVL score 81 vs factors summing to 74.7, IREN score 61 vs 75.8 (factors LARGER than score), SKHY (WATCH) score 59 vs 26.6. Confirmed live in the actual Ask Largo play-brief too (`GET /api/market/swing/play-brief?playId=SWING:MRVL...`): the "Why this setup" section literally printed "Score pillars" summing to 74.7 directly under a "Grade A+ · score 81" verdict line. Fourth occurrence of the same bug class (#4826's Banger/Vector-lane fixes; finding #130 above's live-position drift fix).
- **What changed:** `factors` for a Legacy-promoted play is now a single honest entry, `[{ label: "Night Hawk edition score", points: swingPlay.score }]`, instead of the borrowed dossier decomposition — sums to the displayed score by construction, since Legacy's edition score is the one real signal this promotion path actually has (there is no honest way to sub-decompose a score computed entirely inside the separate Legacy pipeline). `archetype`/`regime`/`thesisLevel`/etc. are unaffected.
- **RTH check:** Once a Legacy-morning-confirm-promoted Swing row is live during RTH (`reason` field carries "Legacy morning confirm"), open its Ask Largo play-brief "Why this setup" section and the command deck's "Why this play was picked" panel and confirm the single "Night Hawk edition score" factor now equals exactly the score shown in the Verdict line above it.

### 138. Ask Largo swing play-brief's "Data freshness" section narrated live desk staleness on CLOSED (historical) positions — fix/swing-play-brief-closed-freshness-staleness — 2026-09-12

- **What was broken (Ask Largo deep-dive, live `GET /api/market/swing/play-brief` on a real CLOSED position):** `play-brief-absence.ts`'s `collectBriefUnavailableSources` already gates HELIX/GEX/Vector/discovery-scan staleness behind `status !== "CLOSED"` — its own comment explains why: those all measure whether TODAY's live desk state is current, which is meaningless once a play is a historical record, and left ungated they "fire forever" once any time has passed since close. But `play-brief-intel.ts`'s `dataFreshnessSection` (the narrative "Data freshness" section body, a separate code path from that structured `unavailableSources` array) never got the same gate. Live repro: INTC's CLOSED play-brief (`playId=SWING:INTC`, closed 2026-09-04, read 2026-09-11 — a full week later) still rendered "Swing scan: prior session 2026-09-11 — today's discovery not yet run" and "HELIX flow: pipeline stale — tape read may lag" in its "Data freshness" section, both claims about "today" on a trade that had been closed for a week.
- **What changed:** `dataFreshnessSection` now skips the scan/Vector-data-age/GEX-matrix-age/HELIX-pipeline-stale lines entirely when `play.status` is `CLOSED` — mirroring the exact gate and rationale already established in `collectBriefUnavailableSources`. The option-mark lines are untouched (already correctly scoped to OPEN/HOLD/TRIM via `playExpectsLiveOptionMark`, and a bare historical `markAsOf` timestamp is a fact, not a staleness claim). A CLOSED play with none of these lines now renders no "Data freshness" section at all, same as before this fix for a CLOSED play with no markAsOf.
- **RTH check:** Pull `GET /api/market/swing/play-brief` for any real CLOSED Swing position (`status=CLOSED` in `swing/record`'s `closedDeck`) and confirm the brief either omits "Data freshness" entirely or, if present, contains no "today's discovery not yet run" / "HELIX flow: pipeline stale" / "GEX matrix ... old" / "Vector data ... old" language — those claims should now only ever appear on a live OPEN/WATCH/HOLD/TRIM brief.

### 139. Vector's wall-proximity "callout" was double-stated (strike/side/"wall" restated verbatim) at two independent call sites — fix/vector-starred-wall-duplicate-text — 2026-09-12

- **What was broken (Ask Largo deep-dive, live `GET /api/market/swing/play-brief` on a real OPEN and a real CLOSED AAPL position):** `buildVectorPlay`'s `starred` array (`vector-play-engine.ts`) and `chartLevelsSection`'s "Nearest wall" line (`play-brief-intel.ts`) each independently PREPENDED a synthesized `"{strike} {side} wall {nearness} —"` / `"{strike} ({side}, {pct}% away) —"` prefix ahead of `WallProximity.callout` (`vector-wall-proximity.ts`), which already states the same strike/side/"wall" itself as a complete sentence. Live repro (OPEN AAPL, positionId 37): Ask Largo's "Trade manager read" rendered "...starred level 332.5 put wall at — Testing 332.5 put wall (0.02% below) — dealers buy weakness...". Live repro (CLOSED AAPL, positionId 36): "Levels on chart" rendered "Nearest wall: 332.50 (put, -0.0% away) — Testing 332.5 put wall (0.02% below) — ...". `starred` also feeds Vector's own desk UI (`VectorPlayAnalyticsDrawer.tsx`), `GET /api/market/vector/contract-picks`, and BIE's `vector-desk-brief.ts`/`play-suggest-read.ts` — not swing-only.
- **What changed:** Both call sites now push the callout as-is (no prepended prefix). Nothing is lost — the callout already states strike/side/"wall" and a precise distance %, strictly more informative than the coarse labels the old prefixes contributed.
- **RTH check:** Pull `GET /api/market/swing/play-brief` for any live OPEN/WATCH position whose Vector desk read is currently testing/at a call or put wall and confirm the "Trade manager read"'s Vector-desk bullet and any "Levels on chart" → "Nearest wall" line each state the strike/wall exactly ONCE, not twice. Also spot-check Vector's own desk UI (`/vector`) for the same wall-proximity "starred" callout — it should read as one clean sentence, not a doubled one.

### 140. Swing play-brief narrative restated the same fact twice at three independent call-site pairs — gate-block reasons across two sections, a doubled trailing period, and a duplicated round-trip fact — fix/swing-gate-block-duplicate-and-punctuation — 2026-09-12

- **What was broken (Ask Largo deep-dive, live `GET /api/market/swing/play-brief` on a real gated WATCH candidate ORCL, and a real OPEN/TRIM position CRWD):** `watchForSection`'s "Watch levels" section ("Before entry, clear:") and `watchEntrySection`'s "Entry" section ("Gates blocking entry:") both independently rendered the full `` `${code}: ${reason}` `` text for every `play.gateBlocks` entry — the same duplication shape the codebase had already found and fixed ONCE, in a different pair of sections (`play-brief-narrative.ts`'s "Entry stance" bullet vs `watchGateCoaching`'s "Gates blocking entry" bullet, both inside "Trade manager read"). Separately, `watchGateCoaching` unconditionally appended a `"."` after joining gate reasons that ALREADY end in their own period (`entry-verdict.ts`'s gate-block map), producing a doubled `".."` whenever the last rendered gate has no `unlock_et` — live repro: "...Cortex preflight vetoed this setup — desk will not open..". A third, independent instance of the same "restate a fact nobody checked was already stated" shape: `degradedReadLine` (the "Live read" fallback, fires whenever Vector spot isn't wired) unconditionally restated the exact "round-tripped past breakeven" fact `actionNarrative` (the SAME section's leading bullet) already renders whenever `giveback.kind === "round_trip"` — live repro CRWD OPEN/TRIM brief: "Round-tripped past breakeven — was up 130% at peak, now -10%" in the "Desk says TRIM" bullet, then the identical fact again inside the "Live read" bullet.
- **What changed:** `watchForSection`'s gate-block bullet now states a count + pointer ("N gates — see Entry section above") instead of repeating the full reason text, mirroring the already-established "the reason text has exactly one home" pattern. `watchGateCoaching` only appends a closing period when the joined text doesn't already end in one. `degradedReadLine` no longer restates the `round_trip` giveback (already always stated by `actionNarrative`); its separate `capture`-kind branch (different floor, 80% vs actionNarrative's 75%) is untouched since no live evidence shows it double-firing.
- **RTH check:** Pull `GET /api/market/swing/play-brief` for any live gated WATCH candidate and confirm: (1) the full gate reason text appears in the "Entry" section only, with "Watch levels" showing just a count + pointer; (2) the "Trade manager read" section's "Gates blocking entry" bullet ends in exactly one period, never two. Separately, for any live OPEN/HOLD/TRIM position that has round-tripped past breakeven (peak positive, current pnl negative) AND whose "Live read" fallback fires (Vector spot not wired that tick), confirm "round-tripped past breakeven" appears exactly once in "Trade manager read", not twice.

### 141. Ask Largo swing play-brief's "Premium stop rail" cushion fabricated a percentage from the true entry-fallback mark — fix/swing-cushion-genuinely-unknown-mark — 2026-09-12

- **What was broken (5-engine live monitor + Ask Largo deep-dive, live `GET /api/market/swing/play-brief` on a real OPEN Banger-lane position EBS):** `watchForSection`'s "Premium stop rail" cushion percentage (`play-brief-intel.ts`) computed `(mark − stop) / mark` off `play.mark` whenever it was a positive number above the stop — a guard the TRUE entry-fallback case always satisfies, since a banger-lane row with no live quote yet carries `play.mark === play.entry` (`horizonPlayFromBangerPosition`'s `mid = last_mark ?? entry_premium`) and the stop is set below entry by construction. Live repro: EBS (entry/fallback-mark $0.10, stop $0.04) rendered "Premium stop rail: $0.04 — 60% cushion from current mark" in "What to watch" in the SAME envelope whose Position section, a few lines above, correctly read "Mark: unknown _(sync quote, no live price yet — do not read as flat)_" — a confident percentage computed from the exact number the document itself says isn't known. Same self-contradiction class `play-brief.ts`'s own `pnlSection` fix already covers for its "Mark: $X" line (2026-09-11, live repro SWING:ALAB/IMPP/EBS/QCML) — this was a second, previously unguarded call site for the identical fallback value.
- **What changed:** Extracted the shared "is this mark the true fallback" test as `optionMarkGenuinelyUnknown(play)` in `play-brief-absence.ts` (`markIsSync && playExpectsLiveOptionMark(status) && pnlPct == null`); `play-brief.ts`'s `pnlSection` now delegates to it (behavior unchanged, own test suite still 50/50); `play-brief-intel.ts`'s cushion computation now additionally requires `!optionMarkGenuinelyUnknown(play)`. The dollar stop level is untouched and always shown regardless — only the fabricated cushion percentage is now omitted, never fabricated.
- **RTH check:** Pull `GET /api/market/swing/play-brief` for any live OPEN/HOLD/TRIM position whose option mark has not yet synced (Position section reads "Mark: unknown") and confirm "Premium stop rail" shows only the dollar stop level with no cushion percentage, while a position with a real synced mark still shows its cushion as before.

### 142. Ask Largo swing play-brief's "Invalidation" callout showed live "exit or cut size" guidance on CLOSED (weeks-old) plays — fix/swing-brief-closed-invalidation — 2026-09-12

- **What was broken (5-engine live monitor + Ask Largo deep-dive, live `GET /api/market/swing/play-brief` on real CLOSED positions NVDA and TSM):** `composeSwingPlayBrief`'s `envelope.invalidation` fallback chain (`thesisBreak.note` -> `resolveBreakInvalidation(ctx)` -> `gateBlocks?.[0]?.reason` -> premium-stop) only bucket-gated the LAST fallback (`bucket === "open"`); the first three ran unconditionally. `resolveBreakInvalidation` computes a real per-ticker break level off TODAY's live Vector spot/GEX walls/gamma flip (built 2026-09-09 for WATCH-bucket gate reasons) — for a position closed weeks earlier this produced a labeled "Invalidation" UI callout (`BieAnswer.tsx`) reading "Break watch — lose 217.50 on a closing basis -> structural support failed; exit or cut size." on NVDA (STOPPED 2026-08-21, read 2026-09-12 — three weeks later) and the same shape on TSM (STOPPED 2026-08-19). Both briefs' own "Since it closed" section correctly discloses today's spot as historical context, but the separate, unlabeled "Invalidation" callout carried no such disclosure and read as live, actionable risk-management guidance on a position with no more risk to manage.
- **What changed:** Added a `bucket === "closed"` short-circuit to `null` ahead of the existing fallback chain in `src/lib/swing/play-brief.ts`. A CLOSED play now renders no "Invalidation" callout at all — its "Outcome"/"Since it closed"/"Lessons" sections already carry the historical read. `resolveBreakInvalidation` itself, and its use inside the bucket-gated "Trade manager read" narrative (only rendered for open/watch), are unchanged.
- **RTH check:** Pull `GET /api/market/swing/play-brief` for any real CLOSED swing position (`status=CLOSED` in `swing/record`'s `closedDeck`) and confirm the JSON's `envelope.invalidation` is `null`/absent and the UI shows no "Invalidation" callout — while a live OPEN/WATCH position's callout is unaffected.

### 143. Swing play-brief's "Desk context" narrated a weeks-old Legacy pick as live sizing context — contradicted its own unavailableSources chip — fix/swing-desk-context-stale-legacy-pick — 2026-09-12

- **What was broken (5-engine live monitor + Ask Largo deep-dive, live `GET /api/market/swing/play-brief` on a real WATCH candidate GOOGL):** `deskConsensusSection` (`play-brief-intel.ts`) narrated `eco.nighthawk_recent` — "the last time this ticker appeared in a Legacy edition," queried with no date filter — unconditionally, regardless of age: "Night Hawk Legacy's last pick on this name (**2026-08-26**) is still **unresolved** — weigh that track record against today's **SHORT** setup before sizing," 17 days stale on a 2026-09-12 read. The SAME response's `unavailableSources` array (fixed 2026-09-10 for this exact staleness pattern, its own comment citing a 5-week-old GOOG example) correctly labeled the identical fact `"no recent Legacy edition for this ticker (last featured 2026-08-26)"`, non-retryable — the chip and the narrative section disagreed about the same data in the same payload.
- **What changed:** `deskConsensusSection` now takes an optional `sessionDate` (default `null`, preserving prior behavior for any caller that omits it); the real caller now passes `ctx.sessionDate`. When supplied, the section is suppressed once `daysBetweenYmd(nh.edition_for, sessionDate) > 4` — the identical bound the 2026-09-10 absence-chip fix already uses, so the two code paths can't disagree by construction. Only the narrative section's staleness handling changed; the absence-chip path is untouched.
- **RTH check:** Pull `GET /api/market/swing/play-brief` for any live OPEN/WATCH position on a ticker Legacy hasn't featured in over a week and confirm "Desk context" is now absent (was previously narrating the stale pick as current sizing guidance), while a ticker Legacy featured within the last few days still shows the section normally.

### 144. WATCH board's "WAIT" pill gave no member-facing signal that a setup's entry window had already expired — fix/swing-watch-headline-entry-expired — 2026-09-12

- **What was broken (Ask Largo deep audit follow-up on PR #4076 comment 5646063107, live swing WATCH lane, 2026-09-12):** `evaluateSwingEntryEnterability` already computes, per row, whether the entry-validity deadline (`entry-model.ts`'s `ENTRY_VALIDITY_DAYS`, 2-5 days by sub-lane) has passed, but `terminalPlayFromHorizon` narrowed the result down to `swingEntryAction?: "buy" | "still_buy" | null` — every `dont_buy`/`wait` reason, expiry included, collapsed to `null` — and `swingActionDisplay` rendered the identical generic `WAIT` pill regardless of cause. Live repro: 5 of 8 (62.5%) of the entire WATCH board were already past their own stated window, including MU (49 days stale) and AMD (46 days stale) against a 2-5 day design window — all rendering the same `WAIT` pill as genuinely fresh 1-2 day-old candidates (COIN, GOOGL).
- **What changed:** `SwingEntryEnterability` gained an additive `expired?: boolean` field (true only in the deadline-passed branch); `terminalPlayFromHorizon` now also carries `watchEntryExpired` onto `TerminalPlay` from the same already-computed result; `swingActionDisplay`'s WATCH branch renders `EXPIRED` instead of `WAIT` when set. Flows straight into the Ask Largo play-brief headline (`play-brief.ts` uses `action?.label` there) with the one change. Ships the smaller, presentational half of the original design question — whether to actively prune stale WATCH rows from the board remains open, still held for Cursor's input per the CARVE-OUT discipline (architecturally-significant, not this PR's scope).
- **RTH check:** Pull the live swing WATCH lane and confirm any candidate past its own entry-validity deadline now shows `EXPIRED` (both on the command-deck pill and in the Ask Largo play-brief headline) instead of the generic `WAIT`, while a genuinely fresh, still-enterable candidate is unaffected.

### 145. "Book context" narrated an already-open, being-trimmed position as a pending "adding" decision — fix/swing-book-context-already-open-tense — 2026-09-12

- **What was broken (Ask Largo deep audit, live `GET /api/market/swing/play-brief` on a real TRIM position CRWD, positionId 19):** `bookContextSection`'s concentration copy is written in the present/future tense of a pending entry decision — "Adding {ticker} stacks the same wager rather than diversifying risk." — correct for a WATCH candidate but not for an already-committed position. A prior fix the same day gated this section out entirely for CLOSED plays for the identical tense reason, but left OPEN/HOLD/TRIM untouched. Live repro: CRWD's brief reads "Desk says TRIM" / `manageAction: EXIT_RUNNER` ("all trims banked — runner only") in "Trade manager read", then a few sections later "Book context" reads "Adding CRWD stacks the same wager..." — framed as a pending new-entry decision on a position the desk is actively telling members to reduce.
- **What changed:** The "Adding {ticker} stacks..." phrasing now only fires when `play.status === "WATCH"`. Every other rendered bucket (OPEN/HOLD/TRIM) reads as an existing-exposure state fact instead: "{ticker} stacks the same wager rather than diversifying risk." The overlap FACT itself is unchanged and still shown — only the one sentence's tense changed.
- **RTH check:** Pull `GET /api/market/swing/play-brief` for any live OPEN/HOLD/TRIM position whose book overlaps a theme it already holds, and confirm "Book context" reads as an existing-exposure fact (no "Adding" framing), while a WATCH candidate with the same overlap still reads "Adding {ticker} stacks...".

### 146. Ask Largo swing play-brief's "Entry trigger" line claimed a level "actually fires the setup" even after the setup was provably dead — fix/swing-entry-trigger-dead-setup-claim — 2026-09-12

- **What was broken (Ask Largo deep-dive, live `GET /api/market/swing/play-brief` on real WATCH candidates SKHY and MRVL):** `watchForSection`'s "Entry trigger" bullet (`play-brief-intel.ts`) unconditionally appended "this is what actually fires the setup" to `play.entryTriggerUnderlyingPx`, regardless of whether the setup could still fire. Live repro, SKHY (`setupState: "INVALIDATED"`, thesis already broke): rendered "Entry trigger: **177.00** — Break/reclaim above this is what actually fires the setup" while spot was already **190.38** — above the stated trigger — with no entry ever firing, directly contradicting the sentence next to the number. Live repro, MRVL (`watchEntryExpired: true`, entry-validity deadline passed): the Verdict headline correctly read `EXPIRED — wait for a fresh setup`, but "Watch levels" four sections later still rendered the same unqualified claim with no cross-reference. Both dead-state fields (`setupState`, `watchEntryExpired`) were already computed and used elsewhere in the same file/finding (#144 above added `watchEntryExpired` specifically for this "is the setup still alive" question) — this bullet was the one place that didn't consult either.
- **What changed:** Added `entryTriggerDeadReason(play)` — returns a short honest reason when `setupState === "INVALIDATED"` or `watchEntryExpired === true`, else `null`. The bullet now reads e.g. "Entry trigger: **177.00** — Break/reclaim above, but thesis already invalidated — this level no longer fires the setup" when dead; a live, still-enterable trigger keeps the original sentence verbatim (this fix narrows a false claim, never softens a true one). The numeric level itself is unchanged either way.
- **RTH check:** Pull `GET /api/market/swing/play-brief` for any live WATCH candidate that is either `setupState: "INVALIDATED"` or shows `EXPIRED` on its headline, and confirm "Watch levels" → "Entry trigger" now states the corrected reason instead of "this is what actually fires the setup". Separately confirm a genuinely fresh, still-enterable WATCH candidate's "Entry trigger" bullet is unchanged.

### 147. A cold SPX desk replica served THURSDAY's close as "today's" price for ~50 minutes after Friday's own 4pm ET close — three real Discord correctness alerts, one stale number — fix/spx-cold-replica-stale-close — 2026-09-12

- **What was broken (investigation of a live 2026-09-12 `data-correctness` cron Discord alert burst):** `buildSpxDeskPulse()`'s off-hours cold-replica branch (`spx-desk.ts`) serves `priorDayFromDailyBars()`'s `pdc` as the current off-hours `price` when the in-process pulse cache is cold (ECS restarts the web tier every 1-3 minutes in normal operation, so some replica is essentially always cold). That function walks Polygon daily bars back to the last bar dated strictly BEFORE today — correct pre-market/RTH (today's own bar is either absent or an in-progress partial), but wrong once today's OWN regular session has actually ended: Polygon's daily-bars endpoint by then already carries today's own settled bar, but the ET calendar date hasn't rolled over yet (still "today" until midnight ET), so the function skipped it anyway and returned YESTERDAY's close. Confirmed live: a cold replica served Thu 2026-09-10's close (7591.7) as the current price for ~50 minutes after Fri 2026-09-11's real 4pm ET close, tripping the `[invariant/spot]` day-range check (compared against Friday's real 7636.75-7677.02 range) and both `[cross-provider/spot]`/`[cross-provider/spx]` checks (compared against two independent fresh Polygon reads correctly showing Friday's real 7656.98 close) — three alerts, one stale number, read three different ways. Self-resolved once the ET calendar date rolled to Saturday, which is why it read as "not currently live" at investigation time even though the root cause recurs every trading day between close and midnight ET.
- **What changed:** `priorDayFromDailyBars(bars, todayYmd, anchorSessionComplete = false)` gained a third, default-`false` parameter — when `true`, a bar dated exactly `todayYmd` is eligible (not skipped). Default stays `false`, so every existing call site (RTH price/pivot lookups, the Vector prior-day chart anchor) is unchanged. New `fetchTodaysOwnCloseIfSessionComplete()` in `spx-desk.ts` does a fresh (deliberately uncached) Polygon daily-bars read with the flag set to `true`; the cold-replica branch now prefers its result over the exclusive-of-today `prior` specifically when `market_label === "EXTENDED"` (past today's close, still the same ET calendar day). Known residual gap, not fixed here: `marketStatusLabel()`'s "EXTENDED" threshold is a fixed 4pm ET close and doesn't account for early-close days — see the staged finding for why that's out of scope.
- **RTH check:** No live board/member-facing RTH behavior changed by this fix (RTH pricing is untouched — only the off-hours cold-replica anchor moved). The actual thing to check is time-of-day-specific and can't be verified during RTH: on a future trading evening, watch the `data-correctness` cron's Discord channel between ~4:00pm and ~4:10pm ET (the highest-risk window right after close, before every replica's in-process cache has naturally warmed) for a recurrence of the `[invariant/spot]`/`[cross-provider/spot]`/`[cross-provider/spx]` trio; none should fire referencing a value one full session stale. If AWS creds are available next session, also pull `GET /api/market/spx/merged` a few times in that same post-close window across a natural ECS restart and confirm `price`/`prior_close` match Polygon's `I:SPX` same-day close, not the prior session's.
### 148. Vector universe snapshot served `spot:null` for 35 of 64 rows on a "complete" build — none of them a live pool-contention or missed-ticker case — fix/vector-universe-cold-spot-retry — 2026-09-12

- **What was broken (standing performance/latency + 5-engine live monitor sweep, live `GET /api/market/vector/universe`, 2026-09-12):** `fetchGexHeatmap`'s cold/inflight-build block cap (`gexHeatmapMaxBlockMs`, 3s) is tuned for a live member request, but the Vector universe snapshot's 5-min recorder cron shares the exact same call and cap even though it is a fire-and-forget background job with no one waiting on it. The 11 UI preset chips (SPY/QQQ/NVDA/...) get real member-view traffic that keeps them cache-warm; the extended allowlist names (GOOG, BAC, GS, INTC, ORCL, TSM, UNH, V, COIN, ...) are NOT preset chips, so the cron's own tick is usually the only thing asking for them, and several carry deep many-expiry chains that can take longer than 3s to build cold. Live repro: 35/64 rows null on a build `isCompleteBuild` reports COMPLETE (attempted===produced — that check only knows whether a row came back, not whether its price resolved); solo, uncontended, SEQUENTIAL probes of `GET /api/market/gex-heatmap` for GOOG/BAC/COIN each failed on the first call and succeeded with a real, current spot on a retry ~4s later — the cold build was still finishing in the background, never actually unavailable.
- **What changed:** Added a bounded retry pass (`retryNullSpotRows`) to `buildVectorUniverseSnapshot`: after the main pooled fan-out, re-attempt only the rows whose spot came back null, through the same bounded pool. By then the earlier cold build has usually already warmed the cache, so the retry is normally a cheap hit, not a second cold build. Deliberately did NOT touch the shared `fetchGexHeatmap`/`gexHeatmapMaxBlockMs` (every desk's live GEX read depends on that 3s live-request cap staying tight). A genuinely dead/unresolvable ticker just retries to another null and is left as first-built.
- **RTH check:** During real RTH, pull `GET /api/market/vector/universe` and confirm the extended-allowlist names (GOOG, BAC, GS, INTC, ORCL, TSM, UNH, V, COIN, ABBV, ANET, ARM, ASTS, BA, COP, CVX, GILD, GLD, HOOD, IBIT, LUNR, MARA, MRK, MS, OXY, PL, PLTR, RIOT, RKLB, SLB, SMH, VRT, XOM) resolve a real `spot` at a materially higher rate than the pre-fix ~50% null rate observed off-hours — a handful of transient nulls right at the top of a cold session (first tick after a long gap) is expected and fine; a majority-null snapshot persisting across several consecutive ticks would mean the retry isn't landing warm and needs a second look.
### 149. SPX Slayer board badge's tooltip called a routine "market closed" state "SPX Slayer desk unavailable", on every evening/weekend render — fix/spx-slayer-badge-unavailable-reason — 2026-09-12

- **What was broken (standing 5-engine live monitor, live `GET /api/market/zerodte/board`, off-hours/weekend, 2026-09-12):** `mapSpxPlayToBadge`'s `unavailable_reason` read `payload.idle_message ?? "SPX Slayer desk unavailable"`. The real CLOSED-SESSION terminal payload (`spx-play-engine.ts`'s `evaluateSpxPlayCore`, the `!market_open && !premarket` branch — every evening and all weekend, whenever no open play needs force-settling) sets `idle_message: null` while ALSO setting a perfectly good, specific `headline: "Session closed"` right next to it — the mapper discarded that real headline and fell to the generic string instead. Live repro: `spx_slayer_badge.headline: "Session closed"` but `.unavailable_reason: "SPX Slayer desk unavailable"` — the badge's own tooltip (the only text shown for a non-live badge) told members the desk was broken/retrying on every single routine market-closed render, not merely closed for the day.
- **What changed:** `unavailable_reason` now prefers `idle_message`, then `headline`, then the generic string (`payload.idle_message || payload.headline || "SPX Slayer desk unavailable"`). The only other real `available:false` shape ("Desk warming") sets both fields identically, so this is a no-op there — the fix only changes the CLOSED-SESSION case, which is the far more common of the two.
- **RTH check:** No live behavior change during RTH (this only affects the badge's idle tooltip off-hours). Confirm during any evening/weekend check that `GET /api/market/zerodte/board`'s `spx_slayer_badge.unavailable_reason` reads `"Session closed"` (or whatever real headline applies), never the generic `"SPX Slayer desk unavailable"`, whenever `headline` itself is informative.
### 150. Ask Largo swing play-brief's "Premium stop rail" cushion percentage ignored the real executable (bid) price — fix/swing-premium-stop-cushion-executable-check — 2026-09-12

- **What was broken (live operator conversation, real OPEN position NN, positionId 32):** `watchForSection`'s "Premium stop rail" cushion percentage (`play-brief-intel.ts`) computed `(mark − stop) / mark` off `play.mark` (the MID) whenever positive and above the stop, never consulting `play.execMark` (the honest bid-side/executable price `TerminalPlay` already carries). Live repro: NN's real numbers were mark $1.10 / stop $0.78 / execMark (bid) $0.70 — already through the stop — yet the brief rendered "Premium stop rail: $0.78 — 29% cushion from current mark," a confident safety-margin claim a member could not actually realize given the real bid/ask spread.
- **What changed:** Added an `execMark`-based guard — when `execMark` is known and already at/below the stop, the cushion percentage is replaced with "no real cushion on the executable side (bid already at/through this level)." The dollar stop level is unchanged either way; behavior is unaffected when `execMark` is unavailable or still healthily above the stop.
- **RTH check:** Pull `GET /api/market/swing/play-brief` for any live OPEN position whose `execMark` (bid) has fallen to or below its `exitPolicy.stop_premium` while the mid mark is still above it, and confirm "Premium stop rail" now shows "no real cushion on the executable side" instead of a percentage — while a position with a healthy executable price still shows its normal cushion percentage.

### 151. Ask Largo swing play-brief's per-contract `$` formatter disagreed with itself — same number, two different cents, same API response — fix/swing-playbrief-option-usd-rounding-mismatch — 2026-09-12

- **What was broken (standing Ask Largo × Night Hawk Swings ownership mandate, live `GET /api/market/swing/play-brief` deep-dive, 2026-09-12):** `play-brief.ts`'s `fmtUsd`, `play-brief-narrative.ts`'s `fmtOptionUsd`, `play-brief-narrative-coaching.ts`'s `fmtUsd`, and `play-brief-intel.ts`'s `fmtUsd` were four byte-identical copies of `` `$${n.toFixed(2)}` `` for absolute per-contract option premium prices. Every route in this lane wraps its JSON response in `roundFloats()` (`Math.round(n*100)/100`), which disagrees with plain `n.toFixed(2)` for a raw float sitting near an exact half-cent boundary (`(6.175).toFixed(2)` is `"6.17"` — 6.175 is actually stored as 6.1749999999999998... — while `Math.round(6.175*100)/100` is `6.18`). `roundFloats()` can't fix the `toFixed()` copies because the number is already baked into markdown TEXT by the time the route's rounding pass runs. Live repro: AAPL swing position #37's play-brief response carried the SAME raw `mark` value twice — the response's own `briefContentKey` diagnostic field (`roundFloats`'d) correctly read `"mark":6.18`, while the SAME response's "Position" and "Trade manager read" markdown sections both printed "Mark: $6.17" for the identical number; the same position's `entryPremium` showed the identical one-cent gap against `GET /api/market/nighthawk/horizons?view=swings` (6.73 there vs "Entry: $6.72" in the brief).
- **What changed:** Added `fmtOptionUsd(n)` to `src/lib/fmt-money.ts` as the single source of truth — rounds via the exact same algorithm as `roundFloats` (`Math.round(n*100)/100`) before `.toFixed(2)`, guaranteeing byte-for-byte agreement with any `roundFloats()`-processed JSON number carrying the same raw value elsewhere in the payload. Removed all four local duplicate definitions in favor of importing this one function (aliased to the local name `fmtUsd` where that was already the call-site name, so no call site needed to change). Deliberately left the sign-free contract, `fmtPct`, and the unrelated GEX-wall/spot/VWAP price-level `.toFixed(2)` calls in these same files untouched — a different quantity class, not implicated in this specific live repro.

### 152. Vector universe scanner snapshot collapsed to 5 rows (from a healthy 84) — a single member-viewed ticker's "append" silently pruned the rest of the roster — fix/vector-universe-single-ticker-append-prunes-roster — 2026-09-12

- **What was broken (live 5-engine health cycle, Vector check, off-hours weekend):** `GET /api/market/vector/universe` served only 5 rows (`O, OR, ORC, ORCL, SPX`) when the last healthy, complete cron build (confirmed via CloudWatch, Friday 2026-09-11 20:00:15 UTC) had persisted 84. `ensureTickerInUniverseSnapshot` — the "append one ticker right after a member view" helper Vector/Thermal/Helix/Largo's `get_gex_heatmap` tool all trigger — merged its one new row using `mergeUniverseSnapshot`'s DEFAULT 15-minute prune threshold, a value tuned for the CRON's own 5-minute rebuild cadence. That threshold has no relationship to a member opening a ticker at an arbitrary hour: any time this ran more than 15 minutes after the last cron/append write (every weekday evening once the cron's RTH gate stops firing, and all weekend when it doesn't run at all), it expired every row in the stored roster older than 15 minutes and persisted just the one freshly-touched ticker in its place — repeat views converge the "universe" down to whatever handful of tickers were opened within 15 minutes of each other.
- **What changed:** `ensureTickerInUniverseSnapshot`'s merge call now passes `Number.POSITIVE_INFINITY` as `mergeUniverseSnapshot`'s `maxAgeMs`, so this single-ticker append never expires a previously-stored row purely for being old (the independent future-clock-skew guard still applies). Genuine staleness pruning stays exactly where it already correctly runs — the cron's own periodic merge, on the cadence that threshold was calibrated for. New regression test reproduces the collapse with a 25h-old two-row snapshot and confirms it survives a single new-ticker append after the fix (RED→GREEN via git stash).
- **RTH check:** Once Monday's market-open cron (`vector-universe-snapshot`) has run at least once, spot-check `GET /api/market/vector/universe` off-hours later that evening (after the cron's RTH gate stops firing) or over the following weekend and confirm the roster stays at its full size (dozens of rows, not 5) rather than shrinking toward whatever few tickers were most recently viewed. Also worth a direct repro: open a non-static ticker on `/vector` or `/heatmap` that hasn't been viewed in >15 minutes, then immediately re-check `/api/market/vector/universe` and confirm the rest of the roster (NVDA/AAPL/SPY/etc.) is still present alongside the newly-opened name.
- **RTH check:** No live behavior change expected during RTH beyond the cents shown for entry/mark/stop/target premiums on the swing play-brief now always matching `roundFloats`'d values shown elsewhere (the Command Deck board, `GET /api/market/nighthawk/horizons`). Spot-check a live OPEN swing position's play-brief "Position" section (`Entry:`/`Mark:`) against the same position's `entryPremium`/mark-implied value on `GET /api/market/nighthawk/horizons?view=swings` during real RTH and confirm they agree to the cent — before this fix, roughly 1 in 100 raw premium values (any value landing within ~$0.005 of an exact half-cent) would silently disagree by a cent between the two.

### 153. Night Hawk Legacy's catalyst-awareness flags carried no freshness — a member couldn't tell last night's headline from a 3-week-old one — feat/nighthawk-catalyst-flag-recency — 2026-09-12

- **What was broken (Night Hawk Legacy aggressive-improvement-hunting audit, live `GET /api/market/nighthawk/edition`, 2026-09-12):** `scoreCatalystAwareness()` (`scorer.ts`) read only each `BenzingaCatalyst`'s `type`, never its real `published` timestamp, even though `fetchBenzingaCatalysts` already sorts newest-first. Every "Watch: guidance update / insider transaction / offering (potential dilution)" clause in a play's thesis text was undated — live repro, DELL's real 2026-09-14 thesis carried exactly that clause with no way to tell a fresh headline from a stale, already-priced-in one. This same thesis text feeds Ask Largo's edition prompt, so the freshness gap reached Largo too. Separately, `guidance`/`insider`/`short` had no per-type dedup guard (unlike `binary`/`buyback`/`m&a`), silently relying on `deterministic-edition.ts`'s downstream `Set` string-dedup — which only worked because the pushed strings were always byte-identical.
- **What changed:** Added `catalystRecencySuffix(published, now)` (`" (today)"` / `" (yesterday)"` / `" (Nd ago)"`, empty when unparseable or future-dated) appended to every catalyst flag, plus explicit per-type guards for `guidance`/`insider`/`offering`/`short` matching the existing `binary`/`buyback`/`m&a` pattern, so a name with several same-type headlines still flags once using the freshest occurrence.
- **RTH check:** Once Monday's edition rebuilds (or any subsequent evening publish) with a ticker carrying a real Benzinga catalyst, pull `GET /api/market/nighthawk/edition` and confirm the thesis's "Watch: ..." clause now carries a recency suffix per flag (e.g. "guidance update (2d ago)") instead of a bare undated label, and that a ticker with multiple same-type headlines still shows exactly one flag for that type.

### 154. Ask Largo CLOSED-play brief's "Desk context" cited a Legacy pick dated AFTER the trade's own exit as "reference against the setup this play traded" — fix/swing-desk-context-closed-anachronism — 2026-09-12

- **What was broken (Ask Largo deep-dive, live `GET /api/market/swing/play-brief` on a real CLOSED position AAPL, positionId 36):** `deskConsensusSection`'s staleness gate (added 2026-09-10 for a different bug — a Legacy pick weeks old read as current sizing context) compared `nighthawk_recent.edition_for` against `sessionDate` (today) for every bucket, including CLOSED. That gate answers "is this pick recent relative to today" — the wrong question for a CLOSED play, whose relevant question is "could this pick have existed at the time the trade was live." Live repro: AAPL#36 closed 2026-09-04, but its brief's "Desk context" read "Night Hawk Legacy's last pick on this name (**2026-09-11**)... for reference against the **LONG** setup this play traded" — a full week AFTER the trade had already exited, impossible to have informed that decision, yet framed as retrospective reference material.
- **What changed:** For `bucket === "closed"`, the gate now anchors to the play's own `exitAt` (via `etSessionDate`) instead of `sessionDate`; `gapDays < 0` (the Legacy pick postdates the reference date) is now also rejected alongside the existing `gapDays > 4` (too stale) check — a case the sessionDate-only gate could never trip, since Legacy history is never dated after "today," but very much can postdate an already-closed trade. OPEN/WATCH buckets are unchanged (still gated against `sessionDate`, as before).
- **RTH check:** Pull `GET /api/market/swing/play-brief` for any real CLOSED swing position and confirm "Desk context" — when present — only cites a Legacy pick dated at or before that position's own exit date; a pick dated after the trade closed should be suppressed instead of narrated as "reference against the setup this play traded."

### 155. Night Hawk options-contract side parser could misread a PUT as a CALL for ticker "C" — fix/nighthawk-option-parse-ticker-side-collision — 2026-09-13

- **What was broken (Night Hawk Legacy aggressive-improvement-hunting audit, 2026-09-13):** `parseOptionsContract()` (`option-contract-parse.ts`), the shared pure parser reused by `grounding.ts`, `legacy-discord-trade-notify.ts`, `play-outcomes.ts`, `deterministic-edition.ts`, `legacy-play-contract.ts`, and `nighthawk-verifier.ts`, used a single combined side-detection regex `/\b(CALL|PUT|C|P)\b/i`. A JS regex without `/g` returns the match at the first position ANY alternative succeeds — for a real single-letter ticker like Citigroup ("C"), the bare `C` alternative matched the TICKER SYMBOL ITSELF (leftmost) before the engine ever reached a real "PUT" token later in the string: `"C $62 PUT @ $2.91 — Sep 25"` parsed as `side: "call"`. A CALL play on ticker C parsed correctly by coincidence (bare "C" already means "call"), which is why this went unnoticed — only PUT plays on a same-letter ticker were affected. No production ticker-C PUT play was found in the current edition — caught proactively, not a live incident.
- **What changed:** The parser now tries an unambiguous full-word match (`/\b(CALL|PUT)\b/i`) before ever falling back to the bare single-letter abbreviation (`/\b(C|P)\b/i`), so an explicit PUT/CALL token anywhere in the string always wins over a same-letter ticker symbol. Added `option-contract-parse.test.ts` (7 tests) — this parser had zero test coverage repo-wide before this fix.
- **RTH check:** No live behavior change expected under normal conditions (production has not been observed to pick ticker "C" as a play). The concrete thing to check: if/when Night Hawk Legacy ever picks Citigroup ("C") as a PUT play, confirm `GET /api/market/nighthawk/edition`'s `options_play` text (e.g. "C $62 PUT @ ...") and the play's live-grounded `entry_premium` both correctly reflect the PUT side of the chain (put_ask, not call_ask) — and separately, if a live Discord BTO/STC alert fires for that play, confirm it posts the correct SHORT direction, not LONG.

### 156. Ask Largo swing play-brief's "confluence" level could cite a different call/put wall than the primary displayed one, under the identical name — fix/swing-confluence-wall-label-disambiguation — 2026-09-13

- **What was broken (Ask Largo deep-dive, confirmed a 3-instance live pattern across real NRG/MU/SKHY reads, raised on #4076 before shipping):** `vector-full-state.ts`'s confluence engine is fed the FULL ranked `gexWalls.callWalls`/`putWalls` list (not just the top-ranked `[0]` this file's own primary "call wall"/"put wall" level uses), so a lower-ranked wall could cluster with max-pain/gamma-flip/golden-pocket under the identical `call-wall`/`put-wall` kind name at a materially different price. Live repro: NRG's brief showed "call wall: 145" (Key levels) beside "confluence (call-wall+max-pain): 125" (Trade manager read) — two different strikes sharing one name, with no indication they disagree; the same shape recurred on MU (call side, WATCH bucket) and SKHY (put side, WATCH bucket).
- **What changed:** `confluenceZoneLabel()` (`play-brief.ts`) now qualifies a kind name with its own price (e.g. `call-wall@125`) only when it differs from the primary wall already shown elsewhere in the same brief — the common case (confluence agrees with the top-ranked wall) renders byte-identical to before. Scoped entirely to this file's own labeling of a zone it already receives — does not touch `confluenceZones()`'s scoring/clustering or what feeds it, so Vector's own UI and Thermal (separate render call sites over the same shared engine) are unaffected.
- **RTH check:** Pull `GET /api/market/swing/play-brief` for any live OPEN/WATCH position whose confluence zone happens to include a call-wall or put-wall candidate different from the primary displayed wall, and confirm the confluence label now reads e.g. `confluence (call-wall@125+max-pain)` rather than the bare `confluence (call-wall+max-pain)` that previously implied agreement with the primary wall.

### 157. Night Hawk thesis's flow-streak sentence fabricated agreement with the play's direction — fix/nighthawk-flow-streak-direction-mislabel — 2026-09-13

- **What was broken (Night Hawk Legacy aggressive-improvement-hunting audit, 2026-09-13):** `buildDeterministicThesis()`'s flow-conviction sentence (`deterministic-edition.ts`) labeled `dossier.flow_streak` (a ticker-level, direction-independent 10-day net-premium rollup) using the PLAY's own direction word rather than the streak's own measured direction. `scorer.ts`'s `scoreFlowQuality()` already guards its scoring bonus on this exact agreement check, but that guard never reached the thesis text, and `flow_score` can clear its own gate purely from tonight's live flow with zero streak contribution. Reproduced: a 4-day PUT-dominated (bearish) streak on a LONG play rendered as "4-day bullish flow streak with aggressive options activity" — fabricated corroboration, the opposite of what the streak data showed.
- **What changed:** The streak clause now uses the streak's own measured direction ("bearish"/"bullish" from `flow_streak.direction`), falling back to the play's direction word only when a dossier carries no streak direction at all.
- **RTH check:** Pull `GET /api/market/nighthawk/edition` for any published play whose thesis mentions a flow streak and cross-check against the ticker's own recent options-flow history (or the admin export, if available) — confirm the streak's stated direction (bullish/bearish) matches which side (call/put) actually dominated premium over those days, not just the play's overall LONG/SHORT direction.

### 158. Ask Largo swing WATCH brief could surface a raw pillar-score fallback ("Discovery read: regime 0.33") with no archetype context — fix/swing-watch-regime-placeholder-fallback — 2026-09-13

- **What was broken (Ask Largo deep-dive, live BE WATCH play-brief, 2026-09-13):** `serving-ingest.ts`'s `swingServingMetaFromDossier` blends the archetype label with the normalized REGIME pillar score (`` `${archetypeLabel} · regime ${regime01.toFixed(2)}` ``), but when `classifyArchetype`'s honest null-when-thin design (EVIDENCE_FLOOR) leaves `archetypeLabel` null — the exact shape already noted for MU/AMD/BE's WATCH rows in earlier cycles — the code fell all the way through to the BARE `regimePart` string alone. `play-brief-intel.ts`'s `whyThisSetupSection` pushes this field verbatim under `**Discovery read:**`, so BE's real, live WATCH-bucket brief (`GET /api/market/swing/play-brief?playId=SWING:BE`) rendered "Discovery read: regime 0.33" to a real member — a raw 0-1 pillar fit score with no label, already shown elsewhere (labeled) under "Score pillars: Regime — +4.8 pts". This is the same bug class as the committed-row `regime` field, which was already corrected to honest omission (`null`) on 2026-09-07 (`live-plays.ts`) — this WATCH-lane sibling call site (`serving-ingest.ts`/`serving-lane.ts`'s `enrichPlay`) was the one left unfixed.
- **What changed:** `swingServingMetaFromDossier` now returns `regime: null` (omitting the "Discovery read" line entirely) whenever `archetypeLabel` is null, instead of falling back to the bare numeric string. The combined `"<Archetype> · regime N.NN"` case (archetype present) is unchanged.
- **RTH check:** Pull `GET /api/market/swing/play-brief` for any live WATCH-bucket ticker whose board row shows `archetype:undefined`/thin evidence (e.g. BE, MU, AMD have shown this shape recently) and confirm the "Why this setup" section no longer shows a bare "Discovery read: regime N.NN" line — it should simply omit that line.

### 159. Night Hawk trend-conflict thesis sentence invented a flow signal that never existed — fix/nighthawk-trend-conflict-driver-attribution — 2026-09-13

- **What was broken (Night Hawk Legacy aggressive-improvement-hunting audit, 2026-09-13):** `buildDeterministicThesis()`'s trend-conflict sentence (`deterministic-edition.ts`) hard-coded "Flow conviction overrides {trend} technicals — institutional money is {dirWord}" whenever the technical trend disagreed with the play's final direction, with no check on whether flow actually drove the pick. Reproduced: a candidate with `flow_score: 0` whose direction was actually driven by news + smart-money still printed the fabricated flow claim.
- **What changed:** The sentence now names whichever dimension is actually the top scoring driver (reusing the same `topDrivers` computation the catalyst/smart-money sections already gate on) — "Flow conviction..." only when flow genuinely leads, "Smart-money conviction...", "News conviction...", or "Options-positioning conviction..." otherwise, or nothing at all when the top driver doesn't map to a clean phrase.
- **RTH check:** Pull `GET /api/market/nighthawk/edition` for any published play whose thesis includes a "{X} conviction overrides {trend} technicals" sentence and confirm the named driver (flow/smart-money/news/options-positioning) actually matches which scoring dimension was strongest for that pick (cross-check against the admin tier-export or the raw factor_breakdown if available) — a play should never claim "Flow conviction" when its real top driver was news or smart-money.

### 160. Ask Largo swing play-brief rendered the same archetype value THREE different ways in one document — fix/swing-archetype-label-render-consistency — 2026-09-13

- **What was broken (Ask Largo deep-dive, live COIN WATCH play-brief, 2026-09-13):** the identical PULLBACK_CONTINUATION archetype rendered three different ways in one brief — Verdict's raw enum (`Archetype: PULLBACK_CONTINUATION`), `play-brief-intel.ts`'s own underscore-replace-only Archetype line (`**Archetype:** PULLBACK CONTINUATION`), and the already-correct, humanized `ARCHETYPE_META` label used on the Discovery-read/Cross-desk-friction lines (`Pullback continuation`). Not a wrong-data bug — a narrative-consistency defect visible within seconds of reading the same document.
- **What changed:** added `archetypeLabelFromRaw()` to `taxonomy.ts` — a single shared, honest narrowing of the loosely-typed `TerminalPlay.archetype` field to the canonical `ARCHETYPE_META[...].label`, returning `null` (never a guessed label) for anything that isn't one of the 8 real `SwingArchetype` values. Wired into `play-brief.ts`'s Verdict line and `play-brief-intel.ts`'s Why-this-setup Archetype line, replacing their ad hoc raw-enum / underscore-replace-only renderings.
- **RTH check:** Pull `GET /api/market/swing/play-brief` for any live WATCH/OPEN ticker with a classified archetype and confirm the Verdict section's "Archetype:" line and the "Why this setup" section's "**Archetype:**" line both now show the identical, human-readable label (e.g. "Pullback continuation") matching the Discovery-read/Cross-desk-friction lines elsewhere in the same brief — no more raw `PULLBACK_CONTINUATION`/`PULLBACK CONTINUATION` variants anywhere in the document.

### 160. Night Hawk catalyst headline could quote a sentiment entry of the opposite direction — fix/nighthawk-catalyst-opposite-direction-sentiment — 2026-09-13

- **What was broken (Night Hawk Legacy aggressive-improvement-hunting audit, 2026-09-13):** `pickCatalystHeadline()` (`deterministic-edition.ts`) fell back to `sentiment[0]` regardless of its own tag whenever no direction-matching entry existed in `dossier.polygon_sentiment`. `scoreNewsCatalyst` can make news a top driver purely from a plain-text keyword hit (upgrade/beat/etc.) in `news_headlines`, independent of what's tagged in `polygon_sentiment` (same underlying fetch, scored separately). Reproduced: a LONG pick scored bullish via a "beat" keyword, but the only `polygon_sentiment` entries were both negative-tagged — the thesis quoted "guidance disappoints analysts" as the "Catalyst:" line for a BULLISH play.
- **What changed:** falls back to a plain (untagged) headline from `news_headlines` instead of an opposite-direction sentiment entry; omits the line entirely if neither exists.
- **RTH check:** Pull `GET /api/market/nighthawk/edition` for any published play whose thesis includes a "Catalyst: ..." line and confirm the quoted text's tone actually agrees with the play's stated direction (LONG → the quote should read positive/supportive; SHORT → negative/cautionary) — never the opposite.

### 161. Structure Ladder gains gatekeeper annotations + a "risk — the other side" callout (operator direct request, competitor-panel parity) — feat/structure-ladder-gatekeeper-risk-callout — 2026-09-13

- **What was missing:** The Structure Ladder widget (#4875/#4878, shipped 2026-09-12) already beats a competitor's single-source "Launchpad Ladder" panel on real per-level R:R and cross-desk agreement, but the operator flagged two of that panel's presentation ideas as still worth having: (1) a "gatekeeper" annotation on each favorable-side level explaining that clearing it is what exposes the next one out, and (2) a "risk — the other side" callout naming the nearest real structural level on the unfavorable side of the thesis, not just the favorable-side targets. Deliberately NOT attempted here: the competitor's "moonshot"/far-dated tier — `buildStructureLadder`'s own header still documents why (needs new Thermal-matrix far-expiry plumbing this pass doesn't have; fabricating a placeholder tier would violate the Largo product contract's absence principle).
- **What changed:** `buildStructureLadder` (`play-brief-ladder.ts`) now derives `target.gatekeeper` (true on every favorable-side rung except the single farthest one) and `riskTheOtherSide` (the nearest real rung WITHOUT a target — i.e. on the unfavorable side) purely from the SAME rung set already built, never a second independently-derived level. `BieStructureLadder.tsx` renders a small "gatekeeper" tag next to a qualifying rung's R:R and a bordered "Risk — the other side" callout below the ladder when `riskTheOtherSide` is present.
- **RTH check:** Pull `GET /api/market/swing/play-brief` for a live OPEN/WATCH swing ticker with structure on both sides of spot and confirm: (a) the nearer of two-or-more favorable-side rungs shows a "gatekeeper" tag and the farthest one does not, (b) a "Risk — the other side" box appears naming the nearest real level on the wrong side of the thesis with a role-correct verb (closing above/below, or trading through for a neutral pivot), (c) the box is absent entirely when every real rung on that ticker's ladder happens to sit on the favorable side.

### 162. Night Hawk Legacy healthcheck's own marks verdict false-GREENed on null bid/ask — fix/legacy-healthcheck-null-bid-ask-verdict — 2026-09-13

- **What was broken (Night Hawk Legacy audit-tooling correctness pass, 2026-09-13):** `verdictForMarkRow` (`scripts/audit/lib/legacy-healthcheck-eval.mjs`, Stage B of `legacy-e2e-healthcheck.mjs`) only ran its "no live two-sided quote" AMBER classification and `[bid,ask]` band check inside an `if (bid != null && ask != null)` guard. The file's own 2026-09-11 fix already treats `bid=0,ask=0` as an honest no-live-quote AMBER, but `bid`/`ask` being `null` (not `0`) is the same real condition via a different, at least as common path (`options-socket.ts`'s `handleTrade()` after a trade print with no prior quote on file; `options-snapshot.ts`'s REST parse when the provider returns no `last_quote` object at all) — both skipped the guard and fell through to a bare GREEN "within [?, ?]", claiming a band check that never happened.
- **What changed:** folded null/undefined bid-or-ask into the same guard as `ask<=0`, so every representation of "no live two-sided quote" gets the same honest AMBER. A one-sided null is also now AMBER.
- **RTH check:** This is audit-tooling only, not a product route — no live member-facing check applies. Confirm on the next `npm run healthcheck:legacy` run against a live illiquid Legacy OCC (a weekly name whose last tick was a lone trade print with no active NBBO) that Stage B reports AMBER rather than GREEN for that row.

### 163. `findings-reconcile.mjs` never checked status on an entry that already carried a kind line — fix/findings-fold-and-hygiene-guard-anchor — 2026-09-13

- **What was broken (Night Hawk Legacy audit-tooling correctness pass, 2026-09-13):** `findings-reconcile.mjs --apply`'s "already tagged, return unchanged" shortcut fired on the mere presence of a `> **kind:**` line, treating it as proof the whole entry (status included) had already been reconciled. `findings-fold-staging.mjs` stamps that same kind line on every staged file it folds in, independently of whether the file's own author ever wrote a status — so a freshly-folded entry with no status (or a stale "PR pending" one) never got its status checked, on any run, forever. Found live while folding this session's own staged findings: two long-standing entries (one no-status, one stale) sailed through `--apply` with 0 `UNRECONCILED` tags, caught by `findings-hygiene.test.ts`'s own idempotency test disagreeing with a from-scratch regeneration.
- **What changed:** compute the needed status note unconditionally and only truly skip a block when nothing is left to add; when a kind line exists but a note is still needed, strip it and re-run the exact same from-scratch insertion path. Also anchored `findings-hygiene.test.ts`'s own vacuous-pass guard regex to match the real stripping regex exactly (it was previously unanchored and false-failed on a folded entry's prose quoting the tag syntax as a documentation example).
- **RTH check:** Audit-tooling only, no live product check applies. Confirm on the next `findings-fold-staging.mjs` + `findings-reconcile.mjs --apply` cycle that any freshly-folded entry with no status (or a stale mid-flight one) picks up an `UNRECONCILED` tag rather than silently passing through untouched.

### 164. Ask Largo CLOSED-play "Lessons" section rendered the archetype label raw, unlike the rest of the same brief — fix/swing-lessons-archetype-label-consistency — 2026-09-13

- **What was broken (Ask Largo deep-dive, live EWZ:29 CLOSED play-brief, 2026-09-13):** a third, missed call site of the same defect PR #4896 fixed earlier today — `play-brief-intel.ts`'s `lessonsSection` (the CLOSED-bucket "Lessons"/post-mortem section) still used its own inline `play.archetype.replace(/_/g, " ")` transform, rendering `Archetype **PULLBACK CONTINUATION**` while the SAME brief's Verdict and Why-this-setup sections (already fixed by #4896) correctly showed `Pullback continuation`.
- **What changed:** `lessonsSection` now calls the same `archetypeLabelFromRaw` helper #4896 introduced, so all three archetype-render sites in a CLOSED play's brief agree.
- **RTH check:** Pull `GET /api/market/swing/play-brief` for any CLOSED position with a classified archetype and confirm the "Lessons" section's `Archetype **...**` tag reads the same humanized label (e.g. "Pullback continuation") as the Verdict/Why-this-setup sections in the same brief — no raw `PULLBACK_CONTINUATION`/`PULLBACK CONTINUATION` variants anywhere in the document.

### 165. Debrief thesis scorecard's "regime" factor read backwards for a contrarian play — fix/debrief-regime-factor-contrarian-play — 2026-09-13

- **What was broken (Night Hawk Legacy outcome-honesty audit, 2026-09-13):** `buildThesisScorecard`'s "regime" factor (the persisted per-play post-mortem `debrief-persist.ts` writes for every graded Legacy row) only checked whether the session moved the way the pinned regime predicted, never whether the regime actually supported the PLAY's own direction. Legacy does publish contrarian plays that fight the pinned regime (`play-critic.ts`'s `tideContradictsDirection` flags, doesn't veto, exactly this). Reproduced: a SHORT published against a bullish pin, stopped out by a rally exactly as the bullish pin predicted, recorded `regime: "confirmed"` while `direction` correctly read `"refuted"` — two factors in the same scorecard contradicting each other on the same play.
- **What changed:** the regime factor now requires BOTH conditions its own docstring already promised — the pin must have supported the play's own direction AND the session must have moved that way — before reading "confirmed"; otherwise "refuted", with the detail string naming the mismatch explicitly.
- **RTH check:** No live UI currently renders `.thesis` (it is a persisted-only field, `debriefPlay`'s only caller is `debrief-persist.ts`), so there is no live page to check. Once a future admin/audit surface reads this field, confirm any contrarian-direction graded Legacy play's regime factor reads "refuted" (not "confirmed") when the market moved against the play's own direction, even if that move happened to match the pinned regime's own call.

### 166. Ask Largo's Structure Ladder / risk read was invisible on mobile for Night Hawk Swings — fix/swing-largo-mobile-visibility — 2026-09-13

- **What was broken (operator direct report, live 2026-09-13):** comparing our Swing play detail against a competitor's full-screen structural readout, the operator reported that tapping a Swing play on a phone never showed the Ask Largo panel (Structure Ladder, gatekeeper tags, "Risk — the other side" callout) at all — only the position stats. Root cause: the desktop 3-column layout's Largo rail (`.nh-deck-largo`) is unconditionally `display:none` below the 1100px 3-column breakpoint, and `PlayTerminal.tsx` (the component rendering the mobile full-screen detail overlay) never rendered `SwingLargoInsightsPanel` at all — a total reach gap for any viewport under 1100px, not a rendering bug.
- **What changed:** `PlayTerminal.tsx` now mounts a second `SwingLargoInsightsPanel` for Swing plays, wrapped in `.nh-deck-right-largo-mobile`, positioned at the top of the mobile detail overlay. `globals.css` shows it only below 1100px (a 3-class selector beats the existing 2-class hide rule on specificity) so the desktop rail is never duplicated. Same component/SWR cache key as the desktop rail — no new data path.
- **RTH check:** On a phone (or a browser window narrower than 1100px), tap into a live OPEN/WATCH Swing play on `/nighthawk?view=swing` and confirm the Ask Largo panel — including the Structure Ladder with gatekeeper tags and the "Risk — the other side" callout — now renders at the top of the detail view, matching what the desktop 3-column layout already shows.

### 167. Night Hawk publish-context's synthetic ATR14 was never actually labeled — fix/publish-context-atr14-estimated-label — 2026-09-13

- **What was broken (Night Hawk Legacy audit, 2026-09-13):** `estimateAtr()`'s own docstring (PR-N21) claimed "the estimate is CLEARLY labeled in the geometry so calibration knows it's synthetic", but `NighthawkPublishGeometry` carried exactly one `atr14` field — no companion label existed anywhere, grepped repo-wide, and no test exercised the fallback path. This ATR is load-bearing: `publish-gates.ts`'s `target_unreachable` gate thresholds on it, and `target-reachability.ts`'s member-facing "Target sits Nx ATR14 ... traded that far X% of the time" sentence is calibrated against a population of REAL, provider-measured ATR14s — silently feeding it a synthetic estimate borrows from a different, uncalibrated population.
- **What changed:** added `atr14_estimated: boolean` to the geometry type (true only when a real ATR14 was absent AND a synthetic one was actually produced), threaded through to the pinned `publish_context`. `PUBLISH_CONTEXT_VERSION` bumped 2→3.
- **RTH check:** Audit-tooling/data-honesty fix, not a rendering change — no live UI check applies directly. Once a future calibration read or admin view consumes `publish_context.atr14_estimated`, confirm any play whose Polygon data had fewer than 14 daily bars (a newly-listed or thinly-traded name) carries `atr14_estimated: true` in its pinned context, and that any reachability-sentence or gate-rejection read built on top of it accounts for the distinction rather than treating all ATR14s as equally measured.

### 168. Command Deck mobile detail view stayed closed for a `?ticker=` deep link that coincided with the board's own default selection — fix/swing-mobile-focus-ticker-overlap — 2026-09-13

- **What was broken (live screenshot evidence, operator-requested):** captured `https://blackouttrades.com/nighthawk?view=swings&ticker=AAPL` at 430×932 via `proxy-browser.cjs` — the list rail (ticker table, session analytics, filters) and the AAPL play-brief detail rail rendered stacked/overlapping instead of the mobile single-column "detail" view. Root cause: `CommandDeck.tsx`'s cross-deck-focus effect (the mechanism a Legacy hand-off link AND `?ticker=` deep links both use to select a ticker's row and open the mobile detail view) guarded on `selId !== match.id` — a proxy for "has this focus request already been handled." AAPL was ALSO the board's own default selection (rank #2, status HOLD, picked by `preferredPlayId` before the focus effect ran), so `selId` already equalled `match.id` on the first render and the guard silently skipped `setMobileDetailOpen(true)`, even though the focus request had never actually fired. Purely a view-mode bug — the right data WAS correctly selected.
- **What changed:** added `resolveFocusTickerMatch` (`deck-session-ui.ts`) tracking "has this focusTicker VALUE been handled" via new `handledFocusTicker` state, decoupled from `selId` entirely — see `docs/audit/findings-staging/2026-09-13-swing-mobile-focus-ticker-overlap.md` for the full root-cause/fix write-up.
- **RTH check:** Reload `/nighthawk?view=swings&ticker=<a currently top-ranked OPEN/HOLD ticker>` on a phone-width viewport (or Chrome DevTools mobile emulation) during RTH and confirm ONLY the single-column detail rail renders (no overlapping/bleed-through list content behind it), and that the `‹ Plays` mobile-back control returns to the list view cleanly. Also spot-check the Legacy → Swings "moved to Open" hand-off link still opens mobile detail correctly (shared code path).

### 169. Ask Largo's gamma-flip "Lose"/"Reclaim" phrasing was chosen from trade direction alone, contradicting the brief's own dealer-regime line — fix/swing-gamma-flip-lose-reclaim-direction-only — 2026-09-13

- **What was broken (live play-brief pull, deep-audit cross-check):** `GET /api/market/swing/play-brief?playId=SWING:COIN:WATCH` — the "Watch levels" section said "Lose gamma flip 183.49 — dealer posture turns against longs" for a LONG play whose spot (174.98) was already well BELOW the flip, while the SAME brief's own Chart-technicals line (driven by the real computed regime) correctly said "Dealer gamma regime: short gamma" — i.e. the flip was already lost, not still at risk. Root cause: both `watchForSection` (`play-brief-intel.ts`) and `narrateFlip` (`play-brief-narrative.ts`, Trade-manager-read's gamma-flip bullet) picked "Lose"/"Reclaim" purely from `play.direction`, never checking which side of the flip level spot actually sat on — the identical bug class already fixed once in the same file for `narrateMaxPain` (live RDDT repro, 2026-09-11).
- **What changed:** both sites now compare spot to the flip level directly before choosing the verb, covering all four `(direction × spot-side)` combinations correctly. See `docs/audit/findings-staging/2026-09-13-swing-gamma-flip-lose-reclaim-direction-only.md` for the full write-up.
- **RTH check:** Pull a live WATCH/OPEN play-brief for a LONG name currently trading below its own gamma flip (or a SHORT trading above), and confirm the "Watch levels"/"What to watch" section and the "Trade manager read" gamma-flip bullet (when within ~3% of the flip) both say "Reclaim"/"Lose" correctly for the CURRENT spot-vs-flip relationship, not just the trade direction — and that neither line contradicts the same brief's own "Dealer gamma regime" statement.

### 170. A swing position that closed at EXACTLY its entry price (0% P&L) was labeled "stopped" — implying a stop-loss fired when nothing actually did — fix/swing-closed-chain-flat-mislabeled-stopped — 2026-09-13

- **What was broken (live `/api/market/swing/record` pull, WATCH/OPEN/CLOSED forensics pass):** 5 of 21 closed swing positions (NFLX#12, WULF#13, IGV#16, WULF#17, PYPL#24, all from the engine's earliest days 2026-08-17…21) carry `entryPremium === peakPremium === troughPremium` byte-identical — the premium never moved a cent — yet render `closedReason: "stopped"`. Root cause: `closedDeckSourcesFromChains` (`closed-plays.ts`) mapped the chain-composite's conservative `outcome === "loss"` (correctly assigned whenever a leg didn't strictly win, including an exact-0% tie — this scoring choice is intentional and untouched) straight to the label `"stopped"`, collapsing a real third case (flat/breakeven) into the word reserved for an actual stop-loss trigger. The sibling single-leg mapper three lines above, the record summary's own `breakevens` field, and the Command Deck UI's dedicated `"SCRATCH"` badge all already treat flat as distinct from stopped — this one chain-composite path just never reached that vocabulary.
- **What changed:** the composite reason now checks whether the served `worstLegPnlPct` is exactly `0` before falling back to `"stopped"`, emitting `"flat"` instead — win/loss scoring math is untouched. See `docs/audit/findings-staging/2026-09-13-swing-closed-chain-flat-mislabeled-stopped.md` for the full write-up.
- **RTH check:** On the Swings CLOSED tab, confirm the 5 named historical rows (NFLX#12, WULF#13, IGV#16, WULF#17, PYPL#24) now show a "SCRATCH" badge, not "STOPPED" — and that their Ask Largo play-brief Lessons sections say "Exit: flat", not "Stop loss — check if invalidation level was respected." This is a latent code path (no recurrence in 3+ weeks since 2026-08-21), so also watch for any FUTURE position that closes at exactly its own entry price and confirm it lands in the same "flat"/"SCRATCH" bucket rather than "stopped"/"STOPPED".

### 171. Night Hawk Legacy option marks conflated "we just fetched" with "the quote is fresh" — a genuinely stale book always read `stale: false` — fix/legacy-marks-asof-quote-clock — 2026-09-13

- **What was broken (parallel audit workflow's Legacy health-check lane, 2026-09-13):** `buildLegacyOptionMarkRow()` preferred `snap.observedAtMs` (our own fetch clock) over `snap.quoteUpdatedMs` (the real `last_quote.last_updated` market clock) when deriving `asof`/`stale`. Against the shared 5s `ZERODTE_MARK_STALE_MS` bound, a successful re-fetch of a genuinely quiet/thinly-traded contract's identical old quote restamped `asof` to "just now" every time, so `stale` could never trigger for a live-returned snapshot no matter how old the real quote was. Same-shape bug also found (and fixed) in `src/lib/swing/contract-ranker.ts`'s `chainContractFromSnapshot()`, which feeds swing's own `evaluateQuoteStaleGate` — though that function currently has no live call site (grepped repo-wide), so that half is a latent-bug fix, not a live behavior change.
- **What changed:** both call sites now prefer the real `quoteUpdatedMs`, falling back to `observedAtMs` only when the provider gives no quote timestamp at all. 0DTE's own `observedAtMs` usage in `scan.ts` (fed by a synchronous just-completed live fetch, where the two clocks genuinely coincide) was investigated and left unchanged — it is a different, correct design, not the same bug.
- **RTH check:** once the market is open, pull `GET /api/market/nighthawk/legacy-marks?occs=<a few real Legacy OCCs>` for a mix of active and thinly-traded contracts and confirm `stale` actually goes `true` for any contract whose real quote hasn't moved recently, rather than every returned mark reading fresh regardless of how old its `last_quote` is. If `legacy-e2e-healthcheck.mjs`'s MARKS stage was previously blind to this class of staleness, it should now be able to catch it.

### 172. SPX Slayer's `/api/market/spx/play` fast-path peek served up to ~234s-stale snapshots, `as_of` jumping backward between polls — fix/spx-play-peek-staleness-bound — 2026-09-13

- **What was broken (parallel audit workflow's SPX health-check lane, 2026-09-13):** polling `GET /api/market/spx/play` at ~1s intervals in production returned snapshots up to ~234s stale, with `as_of` jumping BACKWARD between consecutive requests and `assessed`/`score` flapping `true`/`39` ↔ `false`/`0` a second apart on the same poll loop. Root cause: `peekSpxPlayState()`'s fast path returned any non-null cached value (in-process `mem` or Redis-backed `hit.value`) unconditionally, trusting `peekServerCache`'s generic 10-minute staleness tolerance instead of this route's real ~5s freshness contract — and `peekServerCache`'s backing store is a per-process Map, not shared across ECS replicas, so different replicas served different stale ages on the same poll loop.
- **What changed:** both peek paths now run through a new fail-closed freshness check (`isSpxPlaySnapshotFreshEnough`, `src/features/spx/lib/spx-play-freshness.ts`) against a real 20s bound (`playMemberPeekMaxAgeSec()`); a too-stale peek falls through to `null` so the route's existing cross-replica-coordinated `getSpxPlayState()` fallback takes over instead of silently serving stale data.
- **RTH check:** once the market is open, poll `GET /api/market/spx/play` a handful of times over ~10-15s (the way the live audit did) and confirm `as_of` only ever moves FORWARD, never repeats a stale value across consecutive requests, and `assessed`/`score` don't flap independent of any real underlying move. If a stale/backward `as_of` is ever observed again, check whether `playMemberPeekMaxAgeSec()`'s 20s default needs tightening against the route's actual measured TTL rather than assuming the fix regressed.

### 173. Swing thesis-health's Persistence pillar showed stale point values after a manage-action degrade — fix/swing-thesis-health-persistence-recompute — 2026-09-13

- **What was broken (parallel audit workflow's Ask Largo × Night Hawk Swings deep-dive, 2026-09-13):** `computeSwingThesisHealth()` computed each pillar's `contributionPts`/`deltaPts` BEFORE `degradeFromManage()` mutated the Persistence pillar's `currentScore`/`status`/`currentLabel` on EXIT/STOP_OUT/TAKE_PARTIAL/EXIT_RUNNER — so a pillar correctly relabeled `status: "lost"`/`currentLabel: "exit signal"` could still display its OLD, pre-degrade point values, contradicting its own row. The Ask Largo brief's "Pillar fade" narrative (`play-brief-narrative-coaching.ts`) reads the same `deltaPts` field and inherited the identical stale value.
- **What changed:** `contributionPts`/`deltaPts` are now recomputed in a final pass AFTER `degradeFromManage()` runs, from each pillar's own (possibly-mutated) `currentScore`/`commitScore`/`weight`. The aggregate `health` score was never wrong (it always read post-mutation scores) — only the per-pillar displayed points were stale.
- **RTH check:** On a live OPEN/HOLD/TRIM swing position whose manage action is currently EXIT/STOP_OUT/TAKE_PARTIAL/EXIT_RUNNER (or the next one that transitions into one), check the thesis-health panel's Persistence pillar row: `contributionPts` should read 0 (or the capped value) matching the pillar's own `status`/`currentLabel`, not a stale positive number. Also check the Ask Largo brief's "Pillar fade" sentence for the same play shows a delta consistent with the degraded score.

### 174. Ask Largo swing play-brief's blended P&L was opaque arithmetic a member had to trust — now shows the fired rung(s) that produced it (product enhancement) — feat/swing-brief-banked-trim-detail — 2026-09-13

- **What was broken (Night Hawk Swings standing mandate, aggressive-mode enhancement hunt):** not a defect — the blended P&L number (`blendedPnlPct`, banked-trim + open-runner weighted average) was already correct, but the Position section showed only the final composite (e.g. "Blended P&L: +51.2%") with no way for a member to verify it without independently knowing the ladder's own fired rung(s).
- **What changed:** `pnlSection` now appends a `Banked:` line whenever the blended line shows, naming every fired `trim_levels` rung's fraction, trigger, and (when priced) absolute premium level, e.g. "Banked: 50% @ +100% ($33.30)". Never fabricates a dollar figure for a rung with no priced `premium`.
- **RTH check:** Pull a live Ask Largo swing play-brief for any position that has fired at least one trim rung (`GET /api/market/swing/play-brief?ticker=<T>`, look for "Blended P&L" in the Position section) and confirm the new `Banked:` line appears directly below it, its fraction/trigger/dollar figure match the position's actual exit-policy ladder, and — for a multi-tranche trim_scale position if/when one exists live — multiple fired rungs join with " · " rather than only showing the first.

### 175. `closedCapturePct` rendered "Captured -4014% of peak" on a real closed swing position — fix/closed-capture-pct-round-trip — 2026-09-13

- **What was broken (found live via a `proxy-browser.cjs` post-deploy visual check of the Ask Largo Structure Ladder redesign):** `closedCapturePct()` (`play-card-lifecycle.ts`) guarded `peak <= 0` but never `realized < 0` — once a closed trade round-trips past breakeven into a loss, `(realized/peak)*100` blows up to an arbitrary sign-flipped magnitude. Live screenshot of a real closed AAPL 327.5C 5DTE (peak +1.4%, realized -56%) rendered "Captured -4014% of peak" on `ZeroDteCommandPanel.tsx`'s trade-outcome rail. This exact failure mode was already fixed TWICE elsewhere in this codebase (`mfe-capture.ts`'s `mfeCaptureOutcome`, `zerodte-service.ts`'s `mfeCapturePct`) — `closedCapturePct` was a third, independent copy of the same math that never got the guard.
- **What changed:** added `|| realized < 0` to the existing guard, so a round-tripped loss returns `null` (the panel already omits the "Captured" line entirely when null) — consistent with both sibling implementations.
- **RTH check:** Open any CLOSED swing/LEAPS position whose realized P&L is negative and whose peak excursion was small/positive (the "round-tripped past a tiny peak into a loss" shape) and confirm the trade-outcome rail's "Captured X% of peak" line is simply ABSENT rather than showing any negative/absurd percentage. Also spot-check a few ordinary CLOSED wins still show a sane positive "Captured" percentage (the fix only narrows the guard, doesn't touch the winning-trade path).

### 176. Ask Largo's CLOSED-play "round-tripped past breakeven" lesson gave trim-discipline advice even when the peak never got near a trim rail (product enhancement) — feat/swing-closed-round-trip-small-peak-coaching — 2026-09-13

- **What was broken (Night Hawk Swings standing mandate, aggressive-mode enhancement hunt):** not a defect — every number in the CLOSED-play Lessons section was correct. But the round-trip lesson always said "tighten at first trim rail next time" regardless of peak size; for a position whose peak (e.g. AAPL#36, +1.3%) never got anywhere near the swing ladder's first real trim rail (+100%), that advice implies a trim decision was missed when there was never room to make one. (Same live AAPL#36 shape — small peak, round-tripped to a loss — independently surfaced entry #175's `closedCapturePct` display bug too; two unrelated fixes from the same repro.)
- **What changed:** `closedCoaching()` now reuses the sibling capture-branch's existing `peak > 20` threshold to pick the trailing advice clause: a real peak (>20%) still gets the unchanged trim-rail advice; a near-zero peak (<=20%) instead gets "barely cleared breakeven before reversing — a trim rail wouldn't have helped here; review entry timing or thesis strength instead."
- **RTH check:** On the next CLOSED swing position whose peak was small (<=20%) before it round-tripped into a loss, pull its Ask Largo brief's Lessons section and confirm it shows the new entry/thesis-strength advice, not "tighten at first trim rail next time." Also spot-check a position with a large peak (>20%) that round-tripped and confirm the trim-rail advice still shows unchanged.

### 177. Ask Largo's counter-thesis line rendered a single signal and a triple-corroborated one with identical prose weight — feat/swing-counter-thesis-evidence-weight — 2026-09-13

- **What was broken (not a defect — every reason cited was already real and honestly gated; a presentation gap, part of the standing "steelman the counter-thesis" open item):** `counterThesisLine()` always rendered `**Counter-thesis (bear case)** — <reason(s)>.` the same way whether it had gathered 1 reason or 3. Live-confirmed 2026-09-13: AAPL's counter-thesis carried 3 corroborating reasons (call wall, EMA stack, dealer posture); NRG/NN/META each carried exactly 1 — all rendered with identical prose weight, so a member couldn't tell an isolated signal from a corroborated one without counting `·`-separated clauses.
- **What changed:** the line now names the real evidence weight — `a single, uncorroborated signal —` for exactly 1 reason, `corroborated across N independent reads —` for 2+ — using the real `reasons.length` already computed, not a fabricated score.
- **RTH check:** Pull a few live counter-thesis lines (`GET /api/market/swing/play-brief`, "Trade manager read" section) across different tickers and confirm single-reason cases say "a single, uncorroborated signal" and multi-reason cases say "corroborated across N independent reads" with N matching the actual number of `·`-separated reasons shown.

### 178. Ask Largo's live "what changed" diff still gave option mark/GEX wall moves as bare numeric deltas — feat/swing-diff-structural-level-narration — 2026-09-13

- **What was broken (not a defect — #4682 already narrated thesis/spot/P&L/recommendation shifts; four fields were simply never swept into that pass):** `diffBriefSnapshots` still emitted `Option mark $5.90 → $6.18` and `Call wall 110 → 113 (+3.0)` for mark/gamma-flip/call-wall/put-wall moves — a member had to do their own arithmetic to know whether a wall drifting mattered.
- **What changed:** option mark now reads `**Option mark built/slipped** — $X → $Y (±Z)`; GEX walls/gamma flip now read as room-to-spot compressing/receding — `**Call wall closing in** — $110.00 → $104.00, now $4.00 away (was $10.00) — less room before it matters` — using each snapshot's own contemporaneous spot, falling back to the old plain delta only when spot is unavailable or the cushion genuinely didn't change.
- **RTH check:** Pull a few live "what changed" diffs across active swing positions during a session with real intraday wall movement (`GET /api/market/swing/play-brief` refreshed a few minutes apart) and confirm a moved wall reads as "closing in"/"receding" with a room figure, not a bare `$X → $Y`.

### 179. `vectorPlayCoaching` still repeated Vector's headline verbatim after a 2026-09-09 fix that claimed to remove it — fix/vector-play-coaching-headline-duplication — 2026-09-13

- **What was broken:** live on a real AAPL brief today, `**Cross-desk friction** — Vector bearish (POSITION · momentum short...)` was immediately followed later in the same section by `Vector desk: **POSITION · momentum short...**` — the identical Vector headline quoted twice. A 2026-09-09 fix for this exact bug only dropped a trailing "cross-check" sentence and left the headline itself duplicated; its own regression test asserted the headline was kept, codifying the bug as intended.
- **What changed:** `vectorPlayCoaching` now also omits the headline (not just the cross-check clause) when `crossDeskCoaching` already quoted it elsewhere in the same brief; returns `null` instead of a bare "Vector desk:" bullet if nothing non-duplicative (invalidation/starred level) is left to say.
- **RTH check:** Pull a live brief for any swing play whose direction currently conflicts with Vector's own read (a "Cross-desk friction" bullet fires) and confirm the "Vector desk:" bullet does NOT repeat the same headline text — it should show only invalidation/starred-level content, or be absent entirely.

### 180. Swing entry-validity window counted raw calendar days, expiring WATCH setups over a weekend before the market ever reopened — fix/swing-entry-deadline-weekend-expiry — 2026-09-13

- **What was broken (found live via the Ask Largo standing deep-dive, real WATCH-bucket briefs, on a Sunday):** `entryDeadlineMs()` computed a multi-day entry window as `anchorMs + days * DAY_MS` — raw 24h increments with no weekend/holiday awareness. GOOGL (flagged Thu 2026-09-10 12:05 ET, STANDARD 3-day window) and ORCL (flagged Wed 2026-09-09) both rendered `**Entry stance:** EXPIRED` by Sunday evening — before Monday's market had even opened — even though only Friday's one real trading session had elapsed since either was flagged.
- **What changed:** the `anchoredAt`+`subLane` fallback path now advances real NYSE trading days (via the existing `isTradingDayEt`/`formatEtDate` calendar) rather than raw calendar days — the explicit `entryDeadline` ISO-string path is untouched.
- **RTH check:** On the next WATCH-bucket swing name whose entry window spans a weekend (flagged Wed/Thu, still on WATCH into the following Mon/Tue), pull its Ask Largo brief and confirm `Entry stance` reads something other than `EXPIRED` if fewer real trading sessions than the sub-lane's day count have actually elapsed — cross-check against `GET /api/market/nighthawk/horizons?view=swings`'s watch rows for the exact `firstSeen`/sub-lane to compute the expected real-trading-day count by hand.

### 181. Swing play-brief's `envelope.asOf` silently dropped the "Assembled Xm ago" freshness label everywhere the brief renders through the shared Largo answer UI — fix/swing-brief-envelope-asof-not-iso — 2026-09-14

- **What was broken:** `envelope.asOf` is typed/consumed as ISO by `relativeTime()`/`formatEt()` (the shared "Assembled Xm ago"/"as of HH:MM ET" labels), but swing play-briefs stamp it with a Largo C1 ET display string (`"2026-09-13 20:35 ET"`) instead — `Date.parse`/`new Date(...)` both fail on that shape, so both helpers silently omitted the freshness label (their designed fail-closed behavior) rather than crashing or showing garbage.
- **What changed:** `relativeTime()` and both `formatEt()` copies (`LargoDeskRead.tsx`, `LargoConcreteAnswer.tsx`) now fall back to `parseEtStamp` when `Date.parse` returns NaN — the same ISO-or-ET-stamp dual parsing `@/lib/et-clock` already uses (PR #4152) for the identical problem elsewhere. No change to swing's own `envelope.asOf` convention, which is deliberate and test-locked.
- **RTH check:** Open a swing play's Ask Largo panel on the command deck (any WATCH/OPEN/CLOSED row) during RTH and confirm the brief footer shows "Assembled Xm ago" (not silently absent) alongside the existing "Updated HH:MM ET" label the dedicated panel header already renders correctly.

### 182. Command Deck's SWING/LEAPS letter grade computed (and displayed) a mapping this codebase's own comments document as empirically inverted — fix/swing-leaps-tierlabel-honest-omission — 2026-09-14

- **Credit:** cross-lane finding — reported, not fixed, by the Night Hawk Legacy audit lane (PR #4950, correctly held as out-of-scope for that lane) while reviewing unrelated `scorer.ts`/`conviction.ts` code; verified and fixed here as the Swings lane owner.
- **What was broken:** `terminalPlayFromHorizon` unconditionally computed SWING/LEAPS `tierLabel` via `convictionFromScore` — the exact score→letter mapping `nighthawk-tiers.ts`'s own header documents as empirically inverted for the product it was calibrated on (`A+ >=70` scored 0 wins/1 loss; `B 40-54` scored +2.99% avg, the best performer) — never validated for swing's own, separately-measured-as-unreliable score distribution (`swing-score-calibration.mjs`, PR #4716: "SPREAD WITHOUT ORDER"). Two display-layer fallbacks (`playGradeLabel`, `convictionDisplay`) independently re-derived the same mapping whenever `tierLabel` was empty — fixing only the adapter would have made those fallbacks fire for the first time and silently restore the bad grade at render time.
- **What changed:** `tierLabel` is now honestly `null` for SWING/LEAPS (an already-tested, already-supported state); both display-layer fallbacks to `convictionFromScore` were removed, not gated, since no swing-calibrated tier engine exists yet to fall back to.
- **RTH check:** Pull a live SWING or LEAPS row on the Command Deck (any WATCH/OPEN/CLOSED play, `GET /api/market/nighthawk/horizons?view=swings` or the play-brief route) and confirm the Grade column/letter-grade display shows nothing (not a fabricated A+/A/B/C) unless a real pinned tier exists. Confirm 0DTE and Legacy rows are unaffected (their tierLabel still comes from a real pinned tier, untouched by this fix).

### 183. Ask Largo's swing "Manage plan" bullet showed a full-exit recommendation next to a still-pending trim ladder and runner allocation — fix/swing-full-flatten-trim-ladder-contradiction — 2026-09-14

- **What was broken:** live on NRG's real committed position (`GET /api/market/swing/play-brief?playId=SWING:NRG:34`), the "Manage plan" bullet read `manage engine **EXIT** · next trim at **+100%** (+100%) · session exit **16:00 ET** · **50% runner** after trims` — telling the reader to flatten the whole position now AND, in the same breath, to wait for a future trim and keep a runner. `manageLifecycleCoaching` built the trim-ladder/runner fragments off the static exit-policy shape without checking whether `manageAction` had already moved past scale-out into a full flatten (`EXIT`/`STOP_OUT`).
- **What changed:** the trim-ladder-progress and runner-fraction fragments are now suppressed specifically when `manageAction` is `EXIT` or `STOP_OUT` (a full flatten); `EXIT_RUNNER`'s "all trims banked — runner only" framing is untouched since that's the consistent state behind that recommendation, not a contradiction of it.
- **RTH check:** Pull a live swing play-brief for any OPEN position whose manage engine has moved to EXIT or STOP_OUT (time-stop, thesis break, or hard stop) and confirm the "Manage plan" bullet no longer mentions a future trim trigger or a runner allocation — only the manage-engine verdict, session exit time, and DTE context.

### 184. Ask Largo's swing "Desk says TRIM"/"Manage plan" bullets called an already-crossed trim rail "next" — fix/swing-trim-rail-already-crossed-framing — 2026-09-14

- **What was broken:** live on CG's real committed position (`GET /api/market/swing/play-brief?playId=SWING:CG:25`, pnlPct +169.2%, unfired `trim_levels[0].trigger_pct` 100), both `actionNarrative`'s "Desk says TRIM — next rail at +100%" and `manageLifecycleCoaching`'s "Manage plan — next trim at +100%" described the +100% rail as forward-looking ("next"/"coming up") when price had already run 69 points past it — the rail was behind current price, already cleared and simply not yet banked, not ahead of it. `play-brief-narrative.ts`'s own existing comment on this exact branch already states the invariant plainly ("the trigger has already been crossed — that's why rec is TRIM at all"), but the wording itself was never revisited to reflect it.
- **What changed:** both bullets now compare the unfired trigger's `trigger_pct` against the play's live `pnlPct` at render time (not assumed from `recommendation`/`manageAction`, since `manageLifecycleCoaching`'s branch can also fire for a plain HOLD genuinely still building toward its first rail) — when price has already passed the trigger, the copy reads "+100% rail already cleared, not yet banked" instead of "next rail"/"next trim at"; a genuinely-still-ahead trigger (or an unavailable `pnlPct`) keeps the original forward-looking wording untouched.
- **RTH check:** Pull a live swing play-brief for any OPEN TRIM-recommended position with `pnlPct` already past its own unfired trim trigger and confirm both the "Desk says TRIM" and "Manage plan" bullets read "already cleared, not yet banked" rather than "next rail"/"next trim at" — and confirm a position genuinely still building toward its first rail (pnlPct below the trigger) still reads "next" correctly.

### 185. Ask Largo's swing play-brief showed open-position exit-management language on a never-entered WATCH setup — fix/swing-watch-bucket-manage-rails-scope — 2026-09-14

- **What was broken:** live on SKHY's real WATCH-bucket brief (`GET /api/market/swing/play-brief?playId=SWING:SKHY`), thesis already INVALIDATED pre-entry (a setup that has never been traded and per its own gate never will be), the "Trade manager read" section rendered `**Manage rails** — trim ladder +100%. Honor stops on closing basis; bank trims into strength` — open-position exit-management guidance on a setup with no position to manage. `railsFallback` is an OPEN-bucket fallback (for when `manageLifecycleCoaching`, which itself only ever fires for `bucket==="open"`, has nothing to say), but its call-site guard only checked whether a "Manage plan" bullet had already rendered — never the bucket itself — and `manageLifecycleCoaching` always returns null for `bucket==="watch"`, so that guard was always true there, making the fallback fire as the de-facto WATCH path instead of the rare open-only edge case it was built for.
- **What changed:** the call site now also requires `bucket === "open"` explicitly. WATCH-bucket plays never see this fallback's output; the genuine open-bucket edge case (a contract with no parseable DTE token) still falls back to it exactly as before.
- **RTH check:** Pull a live swing play-brief for any WATCH-bucket setup with a degraded (unavailable) Vector/GEX spot read and confirm the "Trade manager read" section never shows a "Manage rails" bullet — only the "Live read"/degraded-state line and whatever gate/level context applies pre-entry.

### 186. Ask Largo's live "what changed" diff engine could crash on a schema-stale `sessionStorage` snapshot — fix/swing-brief-diff-malformed-session-storage-crash — 2026-09-14

- **What was broken:** `loadPersistedBriefSnapshot` (`play-brief-diff.ts`) hydrates the "Since last read" diff baseline from `sessionStorage`, validating only that the parsed value is an object with a string `headline` — every other `BriefSnapshot` field is trusted as-is. `diffBriefSnapshots` then reads `prev.sectionTitles.includes(t)` with no null guard (the one field in that function without an `!= null` check). `sessionStorage` outlives a deploy, so a snapshot written under an older schema (or corrupted by devtools/an extension) can pass the old validation missing `sectionTitles`, and `diffBriefSnapshots` throws `TypeError: Cannot read properties of undefined (reading 'includes')` uncaught inside `useSwingPlayBrief`'s effect — crashing that component's render.
- **What changed:** `loadPersistedBriefSnapshot` now also requires `Array.isArray(parsed.sectionTitles)`, rejecting a malformed stored snapshot (returns `null` — the existing "no prior baseline" fallback) exactly as it already rejects a non-string `headline`.
- **RTH check:** Not directly observable live (this is a client-storage edge case, not a data-freshness one) — covered by the RED→GREEN regression test instead; no live check needed.

### 187. A swing roll/close's trailing snapshot-append failure was reported as `parentGraded:false`, silently dropping the member-facing terminal Discord notification — fix/swing-roll-snapshot-failure-masks-completed-roll — 2026-09-14

- **What was broken:** `closeAndRollSwingPosition` (`roll.ts`) writes the terminal parent grade (+ child insert on a ROLL) atomically, then appends an evidence-only management snapshot in a separate step outside that transaction — by design. But the snapshot insert ran inside the SAME `try` block as the terminal write, so if it threw (a transient DB blip), the function's outer `catch` returned `{ parentGraded: false, childId: null, error }` — even though the terminal write had already genuinely succeeded. `swing-active-refresh/route.ts` gates its member-facing terminal Discord notification on `roll.parentGraded`, so this silently dropped the roll/close notification for a position that had actually rolled or closed, and undercounted the cron's own `rolled=`/`closed=` summary log metrics.
- **What changed:** the snapshot insert now runs in its own inner `try/catch`. Its failure surfaces as `snapshotId: null` plus its own error message, without overwriting the already-true `parentGraded`/already-set `childId` from the terminal write that actually succeeded.
- **RTH check:** Not directly observable live under normal conditions (requires a transient DB failure on the specific tick a roll/close's trailing snapshot insert runs) — covered by the RED→GREEN regression test instead. If a "roll executed but no Discord notification arrived" report ever surfaces, check whether `roll.error` was set on an otherwise-successful roll before assuming the roll itself failed.

### 188. Ask Largo's "Round-tripped past breakeven" bullet read like the whole position lost its gains even when half was already banked profitably — fix/swing-round-trip-bullet-ignores-banked-trim — 2026-09-14

- **What was broken:** live on CRWD's real committed position (`GET /api/market/swing/play-brief?playId=SWING:CRWD:19`, 50% banked at +100%, runner round-tripped from +129.7% to -9.5%, Blended P&L (realized trim + open runner) still +45.3% — a solid overall win), the "Trade manager read" section's first bullet read `**Round-tripped past breakeven** — was up **130%** at peak, now **-10%** — consider protecting what's left`, with no disclosure that half the position was already locked in profitably. `actionNarrative`'s round-trip bullet computes `giveback` from the runner leg's raw `pnlPct`/`peak` alone, with no awareness of whether any tranche had been banked — the same "reads like nothing has happened yet" ambiguity the sibling "Desk says TRIM" bullet already disambiguates (its `trimsFired === 0` check, built for the NRG live repro where the WHOLE position round-tripped with zero ever banked), but that fix was never extended to this bullet.
- **What changed:** the round-trip bullet now branches on whether any trim has fired: when one has, it reads `**Runner round-tripped past breakeven** — ...; part of this position is already banked at a profit — consider protecting what's left of the runner`; when nothing has been banked, the original unqualified wording is unchanged.
- **RTH check:** Pull a live swing play-brief for any OPEN position that has both (a) at least one fired trim and (b) a runner leg whose current pnlPct has gone negative after a positive peak, and confirm the bullet reads "Runner round-tripped..." with the banked-profit disclosure, not the unqualified "Round-tripped past breakeven" wording. Confirm a position with ZERO fired trims that has round-tripped still reads the original unqualified wording.

### 189. Swing "Structure ladder" desk-agreement badge used a generic label that reads as blanket cross-desk reassurance, when it only measures dealer gamma-regime posture — fix/ladder-agreement-badge-label-scope — 2026-09-14

- **What was broken:** live on PLTR's real play-brief (`GET /api/market/swing/play-brief?playId=SWING:PLTR`, pulled 2026-09-14 ~13:00 UTC), the Structure Ladder header's badge read a bare `"Desks aligned"` (`structureLadder.crossDeskAgreement.status === "aligned"`) while the SAME brief's narrative explicitly called Vector's bullish PLTR read vs. this swing's SHORT thesis "the most load-bearing disagreement." The badge is computed by `crossDeskAgreementFor` (`play-brief-ladder.ts`) comparing Vector's gamma-regime posture against what the GEX matrix's flip implies — a dealer-positioning-regime comparison, correctly named in the code's own doc comment ("cross-desk gamma-regime agreement") — but the member-facing label dropped the "gamma-regime" qualifier and read as if it compared directional calls across desks, the job of the separate `crossDeskCoaching` narrative engine.
- **What changed:** renamed the badge to `"Dealer regime aligned"` / `"Dealer regime differs"` and added a `title` tooltip on both states stating it does not compare directional calls across desks. No data/logic change — `crossDeskAgreementFor`'s computation and its `note` text were already correct.
- **RTH check:** Pull a live swing play-brief for a ticker where Vector's directional call disagrees with the swing's own thesis (per `crossDeskCoaching`'s narrative) but the dealer gamma-regime badge reads "aligned" (or vice versa), and confirm the badge now reads "Dealer regime aligned/differs" with a tooltip, never the old bare "Desks aligned/disagree" wording.

### 190. Swing/banger live P&L used an unfillable zero-bid "backstop" quote as a real mark, inflating displayed gains by up to 100x+ — fix/swing-banger-zero-bid-backstop-mark — 2026-09-14

- **What was broken:** live on the Night Hawk Swings board (`GET /api/market/nighthawk/horizons?view=swings`, 2026-09-14 ~13:45 UTC), 7 of 77 committed positions (BANGER-origin BREAKOUT plays) showed absurd `livePnlPct`: PAGS +18650%, CRSR +10614.3%, EBS/CPRI +7400%, BW +4900%, BAND +1082.5%, ACVA +721.4%. Confirmed against live Polygon quotes directly: CRSR's real quote was `bid: 0, ask: 15` (midpoint $7.50, matching what the app showed) while its `last_trade.price`/`session.close` were BOTH $0.07 — the same as its entry premium, i.e. essentially flat. `midOf`'s `bid >= 0` guard (deliberately permissive for genuinely worthless deep-OTM contracts) had no cross-check against the contract's own last-traded price, so a market-maker "backstop" ask 200x+ above the last real trade got averaged into a fabricated live mark.
- **What changed:** added `reliableMarkFromSnapshot()` — when `bid === 0` and the doc-priority mark exceeds 10x the contract's own last-trade/day-close reference, falls through to that reference instead. Wired into `swing-active-refresh`'s two mark-read sites and `banger-live-sync`'s `fetchMarks`. `midOf`/`zeroDteMidOf` (shared with 0DTE) are untouched — raised on the #4076 collaboration thread for whether 0DTE/Vector/Legacy need the same treatment.
- **RTH check:** re-pull the live swing horizons board and confirm any still-open BANGER position no longer shows a 4-digit-percent `livePnlPct` when a direct Polygon query of its real last trade doesn't support it.

### 191. Cortex sector-heat evidence rendered a ticker's own directional change % without a sign, reading as same-signed as an oppositely-signed sector — fix/sector-heat-signed-ticker-pct — 2026-09-14

- **What was broken:** live on IONQ's real committed 0DTE position (`entry_context.cortex`, 2026-09-14 ~10:16 ET), the sector-heat evidence sentence read `sector Technology is -1.9% on the day (IONQ 2.94%) — the room opposes a long.` `fmtNum` rounds via `toFixed(2)` then bare `.toString()`, which shows a leading `-` for a negative number but never a `+` for a positive one — so IONQ's own +2.94% (genuinely up while its sector was down) rendered as bare `2.94`, giving no visual cue it was moving opposite its sector. This is exactly the idiosyncratic-decoupling case the source exists to surface, per its own file header.
- **What changed:** added `fmtSigned` to `sources/shared.ts` (always shows the sign — the codebase already had an equivalent local helper, unexported, in `compose.ts`'s score-narrative header) and switched only the per-ticker `tickerChangePct` render in `sector-heat.ts` to use it; the sector's own `chg` renders were left as `fmtNum` since those three sentences already state direction in words.
- **RTH check:** Not directly observable as a live UI check (this is a backend Cortex evidence-narrative string, not a rendered panel) — covered by the RED→GREEN regression test instead (`sector-heat.test.ts`, confirmed 1/9 fail pre-fix via git-stash / 9/9 pass post-fix). If reviewing a live `entry_context.cortex` sector-heat evidence line for any committed play whose ticker diverges from its sector, confirm the per-ticker percentage shows an explicit `+` when positive.

### 192. Ask Largo swing WATCH briefs framed a moot gate as an active, clearable blocker after the play's entry window already expired — fix/swing-gate-blocking-entry-moot-after-expiry — 2026-09-14

- **What was broken:** live on ORCL's real play-brief (`GET /api/market/swing/play-brief?playId=SWING:ORCL&ticker=ORCL`), the "Entry" section correctly said `**Entry stance:** EXPIRED` / "Entry-validity window expired — wait for a fresh setup," but the very same section then printed `**Gates blocking entry:**\n• g_s4_regime: ...` with nothing marking the gate as moot — implying clearing the gate would open entry, when `evaluateSwingEntryEnterability` (`entry-enterability.ts`) checks the entry deadline BEFORE the gate, so entry stays dead regardless. "Trade manager read" repeated the identical unqualified framing. Same root cause `entryTriggerDeadReason` (`play-brief-intel.ts`) already fixed once, 2026-09-12, for the sibling "Entry trigger" line — never extended to these two "Gates blocking entry" render sites.
- **What changed:** extracted the shared check into `deadPlayReason()` (`entry-enterability.ts`), reused by `entryTriggerDeadReason` and by both real "Gates blocking entry" render sites (`watchEntrySection` in `play-brief.ts`, `watchGateCoaching` in `play-brief-narrative-coaching.ts`). When the play is already expired/invalidated, the header becomes `**Also gate-blocked** (moot — ...)` instead of asserting the gate as the operative blocker. Gate code/reason text itself unchanged.
- **RTH check:** pull a live swing WATCH play-brief for any ticker whose entry-validity window has expired (headline reads "EXPIRED") and that also carries an active `gateBlocks` entry, and confirm both the "Entry" section and "Trade manager read" section now read "Also gate-blocked (moot — entry-validity window expired)" rather than the old unqualified "Gates blocking entry:" framing. Confirm a genuinely still-enterable gated WATCH play (not expired/invalidated) still reads the normal "Gates blocking entry:" framing unchanged.

### 193. Ask Largo's "Premium stop rail" cushion percentage used the optimistic mid price instead of the real executable bid — overstated real safety margin by ~4x on a live losing position — fix/swing-stop-cushion-exec-basis — 2026-09-14

- **What was broken:** live on NN's real open position (entry $1.95, mark $1.13, mid P&L -42.3%, exec P&L -56.4%, premium stop $0.78), the brief showed `Premium stop rail: **$0.78** — 31% cushion from current mark`. The 2026-09-12 fix for this same field only handled the binary case (executable price already at/through the stop); whenever `execMark` was still above the stop, the percentage kept computing from the mid unconditionally. Back-solving the executable fill (~$0.85) gives a real cushion of only ~8.2% — the displayed 31% was ~4x too generous on a position already down 42-56%, exactly when a member deciding whether they have room to hold matters most.
- **What changed:** the cushion basis now prefers `execMark` (already fetched for the adjacent Executable P&L bullet) whenever known and positive, falling back to the mid only when `execMark` itself is unavailable. The label now says "cushion from current bid" vs. "cushion from current mark" so it discloses which price it's measuring against. Dollar stop level and the "no real cushion" binary branch unchanged.
- **RTH check:** pull a live swing OPEN play-brief for any position where mid and exec marks diverge meaningfully but the exec price is still above the stop, and confirm the displayed cushion % matches `(execMark - stop) / execMark`, not the more optimistic mid-based figure, and reads "cushion from current bid".

### 194. Ask Largo swing brief claimed a FORMING/PRE_TRIGGER play was "At trigger" whenever it was also gate-blocked — fix/swing-entry-gate-false-at-trigger-framing — 2026-09-14

- **What was broken:** live on PLTR's real WATCH play-brief (`GET /api/market/swing/play-brief?playId=SWING:PLTR&ticker=PLTR`), the Verdict headline and "Trade manager read" section both said `"At trigger, but commit gates have not cleared — wait before sizing."` while the same brief's own fields, lines away, read `Entry geometry: PRE_TRIGGER` / `Setup: FORMING` — the play had explicitly NOT reached its trigger (167.23). `evaluateSwingEntryEnterability`'s (`entry-enterability.ts`) if-chain checked `gateBlocked.length > 0` unconditionally BEFORE the `FORMING`/`PRE_TRIGGER` checks further down, so any not-yet-triggered gate-blocked play got the "At trigger..." wording regardless.
- **What changed:** the gate-blocked check now lives INSIDE the branch that already confirms `setup === "TRIGGERED"` and `entry` is an enterable state (the one branch where "At trigger..." is actually true) rather than firing unconditionally before it. A FORMING or TRIGGERED+PRE_TRIGGER gate-blocked play now correctly falls through to its own accurate, gate-agnostic wording ("Thesis is still building..." / "Waiting for price to reach the trigger...").
- **RTH check:** pull a live swing WATCH play-brief for a ticker whose Entry geometry reads PRE_TRIGGER or Setup reads FORMING and that also carries an active commit-gate block, and confirm the Verdict/"Trade manager read" text no longer says "At trigger" — it should read the FORMING/PRE_TRIGGER-specific wording instead. Confirm a genuinely triggered, gate-blocked play (Entry geometry AT_TRIGGER/PULLBACK_TO_ENTRY) still reads the original "At trigger, but commit gates have not cleared" wording unchanged.

### 195. Ask Largo's "Pillar fade" narrative rendered "drifted DTE 4 migrate → DTE 4 migrate" — a no-op-looking transition despite a real score fade — fix/swing-theta-pillar-drift-label — 2026-09-14

- **What was broken:** live on CLSK's real open position, the "Trade manager read" section said `"Pillar fade — Theta budget drifted DTE 4 migrate → DTE 4 migrate (Δ -3 pts)"`. `thetaBudgetScore` (`thesis-health.ts`) returns commit/current scores that genuinely diverge from a single `dte` read (time decay, e.g. 0.75→0.55 in the migrate band — a real, correctly-flagged "faded" status), but shared one `label` string for both, and `toPillarPair` copied it into both `commit.label` and `current.label` — so the narrative's "drifted X → Y" template rendered X and Y identically.
- **What changed:** `thetaBudgetScore` now returns a distinct `commitLabel` ("full runway assumed") in the cliff/migrate bands where the score actually fades; the ample-runway band (no fade) keeps commit and current labels identical, correctly. `toPillarPair` accepts an optional `commitLabel`, defaulting to `label` — every other pillar scorer (persistence/entry_geometry/flow_corroboration/regime) is unaffected. Scores themselves untouched.
- **RTH check:** pull a live swing OPEN/HOLD/TRIM play-brief for a position whose theta-budget pillar is in the cliff or migrate DTE band (check `dte` against the position's sub-lane cliff/migration thresholds) and confirm any "Pillar fade — Theta budget drifted..." line shows two DIFFERENT labels (e.g. "full runway assumed → DTE N migrate"), never the same label on both sides.

### 196. Ask Largo's "Why this setup" section showed a pinned Archetype next to a freshly re-derived regime label with no framing — read as an internal contradiction — fix/swing-regime-read-label-disambiguation — 2026-09-14

- **What was broken:** live on KR's real committed swing position, the "Why this setup" section read `**Archetype:** Breakout continuation` immediately followed by `**Discovery read:** Event-driven directional · regime 0.67`. `play.archetype` is pinned at commit day; `play.regime` is deliberately re-derived fresh on every scan (`attachThesisExplanation`, `serving-lane.ts`) — a real, legitimate divergence over time, not a data bug — but the bare "Discovery read:" label gave no signal the two lines read different points in time, so the document read as internally contradictory.
- **What changed:** relabeled `**Discovery read:**` to `**Today's regime read:**` in `whyThisSetupSection` (`play-brief-intel.ts`) — always accurate regardless of whether the two values happen to agree, so no drift-detection logic was added. Pure label change; `play.regime`/`play.archetype` construction and every other line in the section are untouched.
- **RTH check:** pull a live swing play-brief for any position whose pinned Archetype differs from its current regime classification (or just confirm the label reads "Today's regime read:" generally) and confirm the section no longer shows the old bare "Discovery read:" wording.

### 197. 0DTE ratchet "locked" floor was a flat +20% regardless of peak size, giving back ~44pp on average on real winners — fix/0dte-ratchet-lock-floor-scales-with-peak — 2026-09-14

- **What was broken:** prompted by the operator directly asking why 0DTE winners top out at 2-5% instead of 50-100%+. Traced the 90-day graded ledger's `ratchet_profit_floor` exits (`entry_context.exit.reason`, the C-tier/untiered ratchet exit's "locked" tier): **9/9 (100%) closed inside [18.9%, 21.1%] despite peaks ranging 51.0%-89.3%** — `ratchetFloorPct`'s locked tier was a flat `EXIT_RULES.ratchet_lock_floor_pct` (+20%) once peak cleared +50%, unconditionally, giving back ~44pp on average (worst case LUNR: +89.3% peak closed at +20.5%).
- **What changed:** the locked-tier floor now scales with the peak — `round2(peakPnlPct * EXIT_RULES.ratchet_lock_floor_fraction)`, fraction=0.4, chosen as the conservative pick that beat the old flat floor on all 9 real historical cases in a counterfactual backtest (30% was net worse; 50% was better still but judged too aggressive without a live re-measurement). Continuous at the +50% threshold (0.4×50=20, matches the old flat value exactly there). `trimScaleFloorPct`'s own locked tier now delegates to the same computation instead of an independent flat-20 branch. `EXIT_VERSION` bumped v4→v5; only rows committed after this ships get the new floor (frozen `exit_policy_snapshot` protects already-graded history).
- **RTH check:** watch the live 0DTE board/record for the next C-tier/untiered play whose peak P&L clears +50%, and confirm its reported/armed floor is `peak * 0.4` (e.g. a +70% peak arms a +28% floor), not a flat +20% — cross-check against `entry_context.exit_policy_snapshot.trailing_rule`, which should read `lock@+50%->floor=peak*0.4` for that row.

### 198. Ask Largo's "Lane rank" median picked the lower of two middle scores on an even-sized peer lane, not the statistical median — fix/swing-lane-rank-even-n-median — 2026-09-14

- **What was broken:** live on TSM's real WATCH play-brief (`GET /api/market/swing/play-brief?playId=SWING:TSM&ticker=TSM`), the "Lane rank" section read `Lane median: **51.8**` / `(+7.2 vs median)` against a WATCH lane with exactly 2 peers (TSM 59.2, ORCL 51.8). `computeLaneRank` (`play-brief-lane-rank.ts`) computed the median as `scores[Math.floor(scores.length / 2)]` against the descending-sorted peer array — correct for an odd peer count, but for an even count this indexes directly into the LOWER of the two middle scores instead of averaging them. The real median of `{59.2, 51.8}` is their average, 55.5; TSM's true delta-from-median was +3.7, not the +7.2 shown.
- **What changed:** even peer counts now average the two middle scores (`(scores[n/2-1] + scores[n/2]) / 2`), rounded to 1dp with the same guard `deltaFromMedian` already uses against IEEE754 float artifacts. Odd-count behavior (already correct, well-tested) is byte-identical.
- **RTH check:** pull a live swing play-brief for any ticker whose OPEN or WATCH lane has an even number of live peer rows at request time, and confirm the displayed "Lane median" equals the average of the two middle scores in that lane (not the lower one) — cross-check against the board's own live score list for that bucket.

### 199. Ask Largo's degraded-spot "Live read" bullet showed the entry-premium fallback as a confident live mark, 3rd instance of an already-fixed root cause — fix/swing-degraded-read-line-mark-fallback — 2026-09-14

- **What was broken:** live on RKLX and PGY's real fresh banger-lane HOLD positions, the "Live read" bullet (fires only when Vector spot isn't wired) read `mark **$0.51**` (RKLX) / `mark **$0.17**` (PGY) — both the entry premium, not a real live quote — right alongside the SAME brief's Position section (`Mark: **unknown** _(sync quote, no live price yet — do not read as flat)_`) and Data caveat bullet (`mark not synced to live tape`) correctly disclosing the mark isn't known. `degradedReadLine`'s `markBit` rendered any non-null `play.mark` unconditionally, never picking up the shared `optionMarkGenuinelyUnknown` guard two sibling call sites (`pnlSection`, the "Premium stop rail" cushion) already use for this identical root cause.
- **What changed:** `markBit` now also requires `!optionMarkGenuinelyUnknown(play)` — omits the clause entirely (no fabricated placeholder) when the mark is the true entry-fallback echo. Every other clause in the bullet (`healthBit`, `givebackBit`, the recommendation itself) is untouched.
- **RTH check:** pull a live swing play-brief for a fresh banger-lane OPEN/HOLD/TRIM position with no synced quote yet (Position section reads "Mark: unknown") whose Vector spot also isn't wired on that tick (the brief shows a "Live read" bullet at all), and confirm that bullet never shows a "mark $X.XX" clause. Confirm a position with a real (if untimestamped) mark and a genuine P&L still shows its mark in the same bullet.

### 200. Vector universe snapshot's `updatedAt` misled staleness chips + Largo screener into reporting "just updated" while most of the roster was ~71 minutes stale — fix/vector-universe-staleness-median-asof — 2026-09-14

- **What was broken:** the shared Vector universe snapshot's top-level `updatedAt` is stamped to `Date.now()` on EVERY write, including `ensureTickerInUniverseSnapshot`'s single-ticker append (any member opening any single Vector ticker refreshes just that one row but bumps the whole snapshot's `updatedAt`). Live-measured 2026-09-14: `updatedAt` read 2.1min old while the MEDIAN row `asOf` across 57 tickers was 71.4min old. Three consumers read raw `updatedAt` as their freshness signal: `VectorScanner.tsx`/`VectorTickerComparisonStrip.tsx`'s member-facing staleness chips (built 2026-08-27 specifically to catch a frozen 5-minute cron) and Largo's `vector-analytics.ts` screener tool (`updated_at`/`updated_at_et`/`updated_at_session_date`) — all three would report "just updated"/"fresh" continuously during market hours regardless of whether the bulk of the roster had actually refreshed.
- **What changed:** added `effectiveUniverseAsOf(snapshot)` (median of every row's own `asOf`, falling back to `updatedAt` only when no row has a usable one) to `vector-age-format.ts`, wired into all three consumers in place of raw `data.updatedAt`/`universe.updatedAt`. Median chosen over max/min: resistant to both a single freshly-appended outlier (rules out max) and permanently-null tickers (rules out min).
- **RTH check:** during live RTH, open the Vector scanner UI and a comparison strip on a ticker that hasn't been viewed recently, then immediately view a *different*, just-opened ticker elsewhere on the site; confirm the scanner's own "Updated X ago" chip does NOT reset to a fresh reading purely because of that unrelated single-ticker view — it should continue reflecting the bulk roster's real last-sweep age. Separately, ask Largo "how fresh is the vector scanner list" and confirm the reported freshness lines up with the roster's real sweep age, not with whichever single ticker was most recently opened by anyone.

### 200. Ask Largo's "Manage plan" line restated the same trim-trigger percentage twice for the common single-rung case — fix/swing-manage-lifecycle-redundant-ladder-recap — 2026-09-14

- **What was broken:** live on AMLX/NEO/HACK/MSTX/PZZA and any other single-trim-rung OPEN position, the "Manage plan" bullet read `next trim at **+100%** (+100%)` — the same `100` shown twice, once as the stated trigger and once in a parenthetical ladder recap meant to show the REST of the ladder. `manageLifecycleCoaching` appended `(${ladder})` unconditionally regardless of how many trim rungs existed; for the common single-rung case (`total === 1`), `ladder` is exactly the one number already stated.
- **What changed:** the parenthetical now only renders when `total > 1` (a real second rail exists to recap) — omitted for a single-rung ladder. Applies to both the "next trim at" clause and the sibling "rail already cleared, not yet banked" clause.
- **RTH check:** pull a live swing OPEN play-brief for a position with exactly one configured trim trigger and confirm "Manage plan" shows `next trim at **+X%**` with no trailing `(+X%)` parenthetical. Confirm a position with a genuine 2+ rung ladder still shows the full `(+X% · +Y%)` recap.

### 201. Ask Largo's confluence-zone wall-name mismatch recurred at two unpatched sibling call sites, one already-fixed root cause — fix/swing-confluence-label-sibling-call-sites — 2026-09-14

- **What was broken:** live on NAIL and IONX's real committed positions, "Levels on chart" → "Confluence nodes" (and for IONX also "Trade manager read" → "Confluence") read `"35.00 (call-wall+max-pain, score 5.0)"` / `"22.00 (call-wall+max-pain, score 5.0)"` right next to `"Call wall (GEX): 40.00"` / `"24.00"` in the SAME brief — the confluence engine had clustered a LOWER-ranked wall under the same `call-wall` name, and only the structured `envelope.levels` array (fixed 2026-09-13) disambiguated it; two prose call sites (`formatConfluenceZone` in play-brief-intel.ts, `confluenceCoaching` in play-brief-narrative-coaching.ts) never picked up the same fix.
- **What changed:** extracted the disambiguation logic into a shared `confluenceZoneKindsLabel` (play-brief-absence.ts), wired into all three call sites (the original + the two unpatched siblings). A zone whose wall genuinely matches the primary wall still renders the plain kind name; only a genuine mismatch gains an `@price` qualifier.
- **RTH check:** pull a live swing play-brief for a ticker with a confluence node whose wall component differs from the primary "Call wall (GEX)"/"Put wall (GEX)" line shown elsewhere in the same brief, and confirm BOTH "Confluence nodes" (Levels on chart) and any "Confluence <price>" line (Trade manager read) show the qualified `<kind>@<price>` form, not a bare kind name that silently disagrees with the primary wall figure.

### 202. Ask Largo's catalyst-coaching bullet kept warning "size down before report" hours after a same-day earnings print already landed and moved the stock — fix/swing-catalyst-coaching-earnings-already-printed — 2026-09-14

- **What was broken:** live on PLAY (Dave & Buster's), which reported after the 16:00 ET close and was already down 12.16% in after-hours trading within minutes (confirmed directly against Benzinga), the play-brief rendered at 19:07 ET — 2.5+ hours later, with the SAME brief's own Vector desk already reading the post-print tape — still said `**Earnings in 0d** (2026-09-14 (afterhours)) — size down or exit before report unless thesis is earnings-driven`, a forward-looking instruction for an event that had already happened. `catalystCoaching` had no concept of current ET time vs the print's own implied bell-relative timing.
- **What changed:** added a threshold check (16:00 ET for afterhours, 09:30 ET for premarket, on the print date) comparing the brief's own read time (`ctx.asOf`) against it. Past the threshold, the bullet now reads "**Earnings already printed today**... reassess off the post-print structure" instead of the forward-looking warning. `report_time === "unknown"` never claims already-printed (honest-absence). The sibling `noGapExposure` contract-expiry branch is untouched.
- **RTH check:** pull a live swing play-brief for any position with a same-day (`days_until: 0`) earnings print whose `report_time` is a known bucket (afterhours/premarket), read after that bucket's own implied print time has passed, and confirm the catalyst bullet reads "Earnings already printed today" rather than the forward-looking "size down or exit before report" warning. Confirm a position whose same-day print hasn't landed yet still reads the forward-looking warning.

### 203. `uwGetSafe`'s retry loop had no total-elapsed-time budget — an orphaned retry sequence could starve the shared UW concurrency pool for ~48s, dropping tickers from Night Hawk Legacy's dossier build — fix/dossier-uw-abort-wiring — 2026-09-14

- **What was broken:** a real user directly asked why tonight's Legacy evening edition published only 1 play; traced via live CloudWatch Logs to 6 of 14 raw candidates (ASML, KLA, AI, FTFT, PCLA, XHLD) being lost to `fetchTickerDossierWithWall`'s 45s per-ticker wall before ever being scored. `uwGetSafe` (`unusual-whales.ts`) retries a failed UW call up to 2 times with exponential backoff but had no ceiling on the TOTAL time the loop could run — worst case ~48.5s (3 attempts x up to 15s each + backoff) — and nothing upstream (`dossierFetch`'s 8s race, the dossier wall's 45s race) actually cancels that loop once started; it just keeps running orphaned after its caller gives up. Worse, an orphaned loop keeps holding one of only 2 GLOBAL concurrency slots (`throttleUw`'s `GLOBAL_MAX_CONCURRENCY`, shared by EVERY UW call app-wide, not per-ticker) for its full remaining runtime — starving every other concurrent UW caller, which is consistent with the measured pattern (individual UW calls tested fast in isolation; full concurrent dossier builds timed out).
- **What changed:** added a 20s total-elapsed-time budget (`UW_GET_SAFE_MAX_RETRY_BUDGET_MS`, env-overridable) inside `uwGetSafe`'s own retry loop — each retryable branch (429/5xx/transient-network) now checks whether the UPCOMING backoff delay would push it past budget before scheduling another attempt, falling through to the existing stale-cache-or-null fallback once spent. A second bug was fixed while landing this fix (a parallel session pushed an independent implementation of the same idea to the same branch, twice overwriting reconciliation work — see PR #4998's comment thread for the full account): that version read the env var through this file's SECONDS-based helper despite the `_MS` name, so a value set expecting milliseconds would have silently been treated as that many seconds (a ~5.5-hour budget instead of ~20s) — corrected to read the value directly in milliseconds, matching this file's own `_MS`/`_SEC` naming convention. Deliberately does NOT thread an `AbortSignal` down through the ~10 provider functions into `trackedFetch` (the originally-planned fix) — `throttleUwCoalesced` can hand the SAME in-flight fetch to multiple unrelated callers as one shared promise, and aborting it under one caller's timeout would break every other legitimate waiter. This fix only stops the loop from scheduling a NEW attempt; an attempt already in flight is left to resolve or fail on its own.
- **RTH check:** the natural validation is indirect — watch Night Hawk Legacy's evening editions over the next several trading nights (published ~5:30pm ET) for play-count trend. This fix caps how long one bad UW call can starve concurrent dossier builds; it does not guarantee more plays on any given night (a night can still legitimately be thin on real signal). If a future evening edition again shows dossier-wall ticker losses in CloudWatch (`[nighthawk/candidates]`/dossier logs) concurrently with UW queue-wait growth, re-check whether this budget (20s) needs tightening further, or whether the still-open, deliberately-deferred `dossierFetch` cancellation gap (#4990) needs to be revisited now that this fix makes that safe to do (see the paired findings-staging doc, `2026-09-14-uw-retry-budget.md`, for the full fix-rationale and the reconciliation note).

### 204. PR #5000's "earnings already printed" fix shipped as dead code — `ctx.asOf`'s real production format silently failed to parse — fix/swing-catalyst-coaching-asof-parse — 2026-09-15

- **What was broken:** `catalystCoaching`'s "already printed" detection (shipped earlier in PR #5000) computed `Date.parse(ctx.asOf)`, but real production `ctx.asOf` is `"YYYY-MM-DD HH:mm ET"` (from `etStamp()`), not ISO-8601 — `Date.parse` returns `NaN` on that shape, silently gating the whole feature off. Live re-verified on PLAY ~4h05m after its print landed: still showed the old "size down or exit before report" text. PR #5000's own tests missed this because they built `ctx.asOf` as ISO literals, a shape that never matched real data.
- **What changed:** `nowMs` now uses `parseEtStamp(ctx.asOf) ?? Date.parse(ctx.asOf)` — the same parser already used two lines below for `printThresholdMs`. Updated the 5 existing regression tests to build `asOf` in the real ET-stamp shape instead of ISO literals.
- **RTH check:** pull a live swing play-brief for any position with a same-day earnings print whose `report_time` bucket's implied print time has passed, and confirm the catalyst bullet now reads "Earnings already printed today" — this is the SAME check #202 already describes; this entry exists because that check would have failed silently until this fix (the feature never actually worked). Re-run #202's RTH check now to confirm it passes for real.

### 205. Two more Ask Largo call sites treated Vector's literal "unknown" gamma posture as resolved, contradicting other sections of the same brief — fix/swing-evidence-gamma-posture-unknown — 2026-09-15

- **What was broken:** live on TSM's real WATCH brief, `envelope.evidence`'s "Dealer posture" line read `"γ unknown · net GEX -58.5M · nearest wall 430.00 (10.5 pts)"` while the SAME brief's "Trade manager read" narrative said `"dealers **short gamma** — moves can accelerate through walls"` in the same moment — the 2026-09-12 `resolveGammaPosture` fix (treat Vector's literal `"unknown"` regime the same as null, fall through to a fresh GEX-matrix posture) was applied to the narrative's `dealerPostureLine` but never ported to `evidenceFromContext` (play-brief.ts) or `counterThesisLine` (play-brief-narrative.ts), which each hand-rolled the same now-fixed `??` short-circuit a second and third time.
- **What changed:** both call sites now delegate to the shared `resolveGammaPosture` helper instead of re-deriving the same logic. `evidenceFromContext`'s source attribution (Vector vs GEX) is preserved by mirroring the helper's own gating condition. `counterThesisLine`'s by-hand stale-GEX re-check is removed — the helper already encodes it.
- **RTH check:** pull a live swing play-brief for a ticker whose Vector regime read is genuinely `"unknown"` while a fresh, non-stale GEX-matrix posture is available, and confirm `envelope.evidence`'s "Dealer posture" line states the resolved GEX posture (not literal "γ unknown"), matching whatever the same brief's narrative section already says.

### 206. Chart technicals silently omitted "Dealer gamma regime" whenever Vector's own read was "unknown," even when a fresh GEX-matrix posture existed elsewhere in the same brief — fix/swing-chart-technicals-gex-fallback — 2026-09-15

- **What was broken:** live on TSM's real WATCH brief, "Chart technicals" had no "Dealer gamma regime" line at all, while the SAME brief's "Trade manager read" section (already using the shared `resolveGammaPosture` fallback) correctly said "dealers **short gamma**." `chartTechnicalsSection` (play-brief-intel.ts) read `vec.regime?.posture` directly with no GEX-matrix fallback — the fourth call site in this family, but unlike the three fixed earlier today it silently omitted the line rather than fabricating a wrong value.
- **What changed:** the function gained an optional `ctx` parameter; when supplied (the real production call site now passes it), posture resolves via the shared `resolveGammaPosture` helper instead of reading Vector's raw field directly. Callers that don't pass `ctx` keep the old behavior unchanged (backward compatible).
- **RTH check:** pull a live swing play-brief for a ticker whose Vector regime read is genuinely `"unknown"` while a fresh, non-stale GEX-matrix posture is available, and confirm "Chart technicals" now shows a "Dealer gamma regime" line (matching whatever "Trade manager read" already says) instead of omitting it.

### 207. Position section showed a live position's best excursion (Peak) but silently dropped its worst (Trough), even though both are fully computed on every row — feat/swing-position-trough-display — 2026-09-15

- **What was broken:** `troughDisplay` (adapters.ts) is computed symmetrically alongside `peakDisplay` and threaded onto every `TerminalPlay` row as `play.trough`, but `pnlSection` (play-brief.ts) only ever read `play.peak`. Live repro (SWING:CRWD positionId 19): the brief showed "Peak: +161.3%" with no way to know the same position had been down -57.2% before it worked — conviction-relevant history a trader would want, already computed, just never rendered.
- **What changed:** added one line to the Position section, `Trough: **${fmtPct(play.trough)}**`, immediately after Peak — same helper, same unconditional-render convention (both fields are null together exactly when the underlying data is missing).
- **RTH check:** pull a live swing play-brief for a committed position that has meaningfully drawn down before recovering, and confirm the Position section now shows both "Peak: +X%" and "Trough: -Y%" — not just Peak alone.

### 208. `scorecardCoaching` was called unconditionally in every swing coaching pass but was structurally guaranteed to always return null — chore/swing-remove-dead-scorecard-coaching — 2026-09-15

- **What was broken:** `scorecardCoaching(play)` (play-brief-narrative-coaching.ts) read `play.scorecard`, genuinely populated for 0DTE and Legacy but never for SWING/LEAPS — `terminalPlayFromHorizon` (the SWING/LEAPS adapter) never sets it, and no swing-side resolve step patches it in either. The call was unconditional in the swing coaching assembly, so it was guaranteed to return null for 100% of swing traffic forever, by the same architectural decision that already forces swing's `tierLabel: null`. Not a rendering defect (the call always evaluated to null and was silently dropped) — a maintenance/readability risk: a future reader could mistake it for live functionality.
- **What changed:** removed the dead function and its call site, with a comment tracing the root cause and pointing to the existing, honest replacement (`archetypeTrackRecordSection`/`graduatedArchetypeEntry`, #4685) that already covers this intent for swing.
- **RTH check:** none needed — this is a no-op removal (zero output change). Confirm swing briefs still compose normally (no missing "Playbook stats" regression, since that bullet never rendered for swing before or after).

### 209. `morningConfirmCoaching` was called unconditionally on every WATCH-bucket swing brief but was structurally guaranteed to always return null — chore/swing-remove-dead-morning-confirm-coaching — 2026-09-15

- **What was broken:** `morningConfirmCoaching(play)` (play-brief-narrative-coaching.ts) branched on `play.pulled`/`play.morningStatus`/`play.morningReason` — fields genuinely populated for Legacy (`terminalPlayFromEdition`) but never for SWING/LEAPS (`terminalPlayFromHorizon` never sets them, and its own input type doesn't even carry them). Same root-cause shape as `scorecardCoaching`, removed earlier the same day — a field genuinely live for a sibling lane, structurally never populated for swing, read unconditionally in the swing coaching assembly's WATCH-bucket branch.
- **What changed:** removed the dead function and its call site, with a comment naming the identical `scorecardCoaching` precedent so a future reader recognizes the pattern.
- **RTH check:** none needed — no-op removal, zero output change. `watchGateCoaching`, the sibling call directly below, already covers swing's own real WATCH-bucket gate signals.

### 210. `progressRatchetCoaching` was called unconditionally in every swing coaching pass but was structurally guaranteed to always return null — chore/swing-remove-dead-ratchet-coaching — 2026-09-15

- **What was broken:** `progressRatchetCoaching(play)` gated on `play.exitModel === "RATCHET"` — `terminalPlayFromHorizon` (the SWING/LEAPS adapter) hardcodes `exitModel: "SCALE_OUT"` for every swing row, never `"RATCHET"`. Third dead-gate instance found this session (after `scorecardCoaching`/`morningConfirmCoaching`), found via a systematic function-by-function sweep of the whole coaching module.
- **What changed:** removed the dead function, its call site, its now-orphaned synthetic-fixture-only test, and the now-unused `fmtUsd` import + its stale comment block. `play.progress` itself is untouched — it's already rendered live via the Position section's "Trim progress" line.
- **RTH check:** none needed — no-op removal, zero output change.

### 211. `underlyingExcursionCoaching` was called unconditionally in every swing coaching pass but was structurally guaranteed to always return null — and its one live-computable remainder was fully redundant with already-shipped content — chore/swing-remove-dead-underlying-excursion-coaching — 2026-09-15

- **What was broken:** `underlyingExcursionCoaching(play)` gated on `play.stockMovePct`/`stockPeakPct`/`stockTroughPct` — fields written only by a Legacy-only client-side hook (`use-legacy-quotes.ts`), never populated for swing. Fourth dead-gate instance found this session. Sharper than the prior three: it also called `mfeCaptureOutcome(play.pnlPct, play.peak, null)` using genuinely live swing fields — but that exact call, same arguments, was already live in `play-brief-intel.ts` and `play-brief-narrative.ts`, so nothing unique was lost by removing rather than rewiring the gate.
- **What changed:** removed the dead function, its call site, its three now-orphaned tests (coverage preserved via the sibling call sites' own tests), and the now-unused import. `TerminalPlay.stockMovePct`/`stockPeakPct`/`stockTroughPct` themselves are untouched — genuinely alive for Legacy UI.
- **RTH check:** none needed — no-op removal, zero output change.

### 213. Structure Ladder's "Risk — the other side" could name a neutral pivot as "real structure" over a genuine, farther wall — fix/swing-risk-the-other-side-neutral-rungs — 2026-09-15

- **What was broken:** `riskTheOtherSide` (play-brief-ladder.ts) picked the nearest unfavorable-side rung by raw distance, with no regard to `role` — so a `"neutral"` pivot (gamma flip/max pain/magnet) could win over a farther but genuine support/resistance wall, contradicting this same file's own documented stance that those pivots are "NOT hard support/resistance." Live on 4/5 structureLadder tickers checked in one batch (AAPL/CG/ENPH/PEGA); PEGA's case hid the real put wall by 13 points (magnet -8.3% shown vs put wall -21.4% actual). The member-facing widget renders the winner as "the nearest real structure."
- **What changed:** the selection now prefers a genuine support/resistance rung; only falls back to the nearest neutral pivot when no real wall exists unfavorably at all (unchanged for that case, e.g. GLXY).
- **RTH check:** pull a live swing play-brief for a ticker where a neutral pivot sits nearer to spot than the nearest real wall on the unfavorable side, and confirm "Risk — the other side" now names the real wall, not the pivot.

### 215. Ask Largo swing play-brief money formatting: signed distances printed "$-X" instead of "-$X", and dark-pool premiums rendered as raw per-contract prices instead of compact magnitudes — fix/swing-play-brief-money-formatting-sign-scale — 2026-09-15

- **What was broken:** `fmtDist` (play-brief-intel.ts) passed a signed delta straight into `fmtOptionUsd`, which its own doc comment says is "never signed" — negatives already carry a minus from `.toFixed(2)`, so prepending "$" produced "$-19.48" instead of "-$19.48" for every level below spot (this codebase already fixed the identical trap once, in `fmtPremium`'s own doc comment). Separately, the "Dark pool levels" line formatted a summed institutional block-print notional (hundreds of thousands to tens of millions of dollars) through the same per-contract 2-decimal formatter instead of the compact-magnitude `fmtPremium` the sibling `narrateDarkPool` already uses for the identical field.
- **What changed:** `fmtDist` now signs the delta itself outside the currency glyph, matching `fmtPremium`'s own convention; the dark-pool line now calls `fmtPremium` instead of `fmtOptionUsd`.
- **RTH check:** pull a live swing play-brief for a ticker with a wall/confluence level below spot and confirm the distance reads "-$N.NN from spot", never "$-N.NN"; pull one with populated dark-pool levels and confirm the premium renders compact ("$5.2M"), not a raw per-contract figure.

### 217. A rolled CLOSED swing chain's entry/peak/trough premium described the terminal leg while the reported exit P&L described a different, worse earlier leg — fix/swing-closed-chain-terminal-leg-premium-mismatch — 2026-09-15

- **What was broken:** `closedDeckSourcesFromChains` (closed-plays.ts) overrides `exitPnlPct` with the chain-composite worst-leg P&L by design (the preserved-loss invariant), but `entryPremium`/`peakPremium`/`troughPremium` stayed sourced from the terminal leg only. Whenever the worst leg was an earlier (non-terminal) leg, the served row paired one leg's realized loss with a different leg's price bounds. Live on INTC (rootPositionId 30): served `entryPremium: 2.26, peakPremium: 2.84` (leg 1's own bounds, "+25.7%") beside `exitPnlPct: -40.83` (leg 0's loss) — a positive peak next to a reported loss, for a peak that postdates the loss it was paired with. Downstream, `primaryReturnPct` prefers `peak` as the Closed-tab headline number, fabricating a green "+25.7%" for a chain whose real worst outcome was a loss.
- **What changed:** when the worst leg isn't the terminal leg, entry/peak/trough premium are now omitted (null) rather than paired with the wrong leg's journey — `primaryReturnPct` already falls back cleanly to the real exit P&L when peak is null.
- **RTH check:** none needed — the fix only tightens an existing multi-leg edge case (1/32 live closed chains affected today); confirm the Closed tab still renders normally for every other closed position.

### 218. Swing's "Break watch" risk headline always framed the premium stop as a future risk, even when the executable bid was already through it — fix/swing-break-watch-executable-stop-breach — 2026-09-15

- **What was broken:** a swing play is always long premium, so `play.execMark` (the bid) is the honest exit fill regardless of direction. The reserved, always-surfaced "Break watch" bullet only ever said "lose premium stop $X → cut size or exit" — a forward-looking framing — even when execMark was already at/through the stop. That fact already existed as a footnote in a separate reference section ("Premium stop rail... no real cushion on the executable side") but never reached the brief's actual risk headline. Live on NN#32: HOLD verdict at the top, Break watch still said "lose premium stop $0.78" while the real bid was already through it.
- **What changed:** when execMark is known and already at/through the stop, Break watch now says "stop already breached on the executable side — bid $X.XX is at/through your premium stop $X.XX right now → exit or cut size." No gate/recommendation logic changed — purely a narrative-prominence fix.
- **RTH check:** pull a live swing play-brief for an OPEN position where the bid has fallen to or through the premium stop rail, and confirm Break watch reads "stop already breached," not the forward-looking "lose premium stop" framing.

### 219. `play.trough` was rendered once as a bare number but never interpreted anywhere in the narrative — feat/swing-trough-resilience-coaching — 2026-09-15

- **What was missing:** `play.trough` (the position's own worst intra-trade excursion) is computed alongside `play.peak` and rendered once in the Position section, but nothing in the trade-manager narrative interpreted it. Live: CG round-tripped from -34.6% to +221.2%; CRWD (the board's #1-ranked, largest open winner) from -57.2% to +161.3% — neither brief said anything about the drawdown that preceded the win.
- **What changed:** a new coaching function, `troughResilienceCoaching`, fires on a real, meaningful swing (peak-minus-trough ≥ 40 points AND the position actually traded negative at some point), OPEN bucket only.
- **RTH check:** pull a live swing play-brief for an OPEN position with a real drawdown-then-recovery history and confirm the "Volatility note" bullet cites both the trough and peak.


### 216. `breakTrigger`'s "Break watch" bullet never considered the GEX king strike — fix/swing-break-watch-king-strike — 2026-09-15

- **What was broken:** `breakTrigger` (play-brief-narrative.ts) and `riskTheOtherSide` (play-brief-ladder.ts) both read the same nearest-sorted `focal` array, but `breakTrigger`'s support/resist predicates only recognized put_wall/dark_pool (support) and call_wall (resist) — never `kind === "king"` (the GEX king strike), even though it's in the same array. Live on CRWD (LONG, +149.8% P&L): the ladder widget correctly named the king at -2.41% as the real nearest risk while the SAME payload's "Break watch" bullet cited the put wall at -19.4% — 8x farther, disagreeing with the brief's own other risk-level widget. Also live on RBLU/ABTC/APPX/CGEM/CRWL/DRIP (support side) and GOOG (resist side).
- **What changed:** added `kind === "king"` to both the support and resist predicates; `focal` is already sorted by unsigned distance, so `.find()` now correctly returns whichever real wall is nearest.
- **RTH check:** pull a live swing play-brief for a LONG or SHORT position where the GEX king strike sits nearer to spot than the put/call wall, and confirm "Break watch" cites the king, not the farther wall.

### 220. Portfolio/theme concentration detection was blind to same-underlying leveraged-ETF and crypto-token-wrapper duplication — fix/swing-leveraged-crypto-wrapper-concentration-blindspot — 2026-09-15

- **What was broken:** `sector-map.ts`/`theme-cluster.ts` (the shared theme resolvers concentration detection reads) had no entry for `MSTU`/`MSTX` (leveraged ETFs on `MSTR` itself), `GLXY`/`SBET` (crypto-holdings proxies), `XRP`/`XRPZ`/`XXRP` (three wrapper tickers on the same token), or `RBLU`/`GMEU`/`SOFX`/`PLTU` (leveraged ETFs on `RBLX`/`GME`/`SOFI`/`PLTR`) — each resolved to its own isolated cluster and could never trip a Book Context concentration flag against the position it duplicates. Live: the book held `MSTU`+`MSTX` simultaneously, a 6-way instance (`XRP`/`XRPZ`/`XXRP`/`GLXY`/`MSTU`/`MSTX`, all same-direction LONG), and separately `RBLU`/`GMEU`/`SOFX`/`PLTU` in the same 85-row book — zero flag between any of these pairs.
- **What changed:** added `MSTU`/`MSTX`/`GLXY`/`SBET` to `crypto-equity`; added `PLTU` alongside `PLTR` in `software`; added three new paired sectors (`roblox`, `gamestop`, `sofi`) so each single-stock leveraged ETF clusters only with its own underlying; added `XRP`/`XRPZ`/`XXRP` to `ETF_PROXY_THEMES` under a new, deliberately separate `"crypto-xrp"` cluster (a token's own price is a different risk driver than mining/holding-equity beta).
- **RTH check:** pull a live swing play-brief for any ticker in the book alongside another MSTR-linked leveraged ETF, another XRP wrapper, or a single-stock leveraged ETF alongside its own underlying (RBLX/RBLU, GME/GMEU, SOFI/SOFX, PLTR/PLTU), and confirm Book Context now cites the concentration.

### 221. Swing Command's mobile position list was pinned to ~51% viewport width, truncating every ticker/strike/expiry into illegibility — fix/swing-mobile-list-width-cascade-trap — 2026-09-15

- **What was broken:** live-verified via a real phone-viewport (430px) screenshot: the Swing Command position list rendered squeezed into ~half the screen, blank space on the right, `PLAY`/`CLOSED 21` headers truncated, every row showing only an `L` badge with the actual ticker/strike/expiry text invisible. Root cause: `.nh-deck--swing-largo .nh-deck-left{width:30%;min-width:220px}` (unconditional, higher CSS specificity, no `!important`) silently overrode the base mobile fix's `.nh-deck-left{width:100%}` inside `@media(max-width:820px)` — the same cascade trap this file's own comments already document elsewhere, just missed for this one rule. `min-width:220px` on a 430px viewport matches the observed ~51% squeeze exactly.
- **What changed:** added `@media(max-width:820px){.nh-deck--swing-largo .nh-deck-left{width:100%!important;min-width:0!important}}`, mirroring the file's own established guarded-override pattern. CSS only, no component logic touched.
- **RTH check:** load `/nighthawk` (Swings tab) on a real phone or a ≤820px-wide browser window and confirm the position list is full-width with legible ticker/strike/DTE text in every row, not squeezed with blank space beside it.

### 222. Ask Largo's Thesis Health panel rendered a fabricated-precision, byte-identical pillar breakdown for every Banger-origin swing position — fix/swing-banger-thesis-health-fabricated-precision — 2026-09-15

- **What was broken:** `thesisHealthUncalibrated()` (`src/lib/swing/thesis-health.ts`) only caught missing-commit-input rows via sentinel default labels ("unknown"/"n/a"/"no signals"). `horizonPlayFromBangerPosition` (`banger-lane-merge.ts`) stamps concrete, non-sentinel constants (`setupState:"TRIGGERED"`, `entryStatus:"AT_TRIGGER"`, `signalKinds:["BANGER"]`, `regime:"BREAKOUT · BANGER"`) on every banger_positions ledger row, so the guard never fired for this lane. Live: ALLT, CGEM, DRIP (different tickers/prices/contracts) all rendered an exactly identical 70% health, "Minor drift" rung, and byte-for-byte identical pillar text/deltas.
- **What changed:** added one more check to `thesisHealthUncalibrated()` — the regime pillar's `currentLabel === "BREAKOUT · BANGER"` (a string written only by the Banger ledger-merge path, verified not to overlap with any native swing position's real regime string, unlike `signalKinds` alone which a native BANGER-discovered position can also legitimately carry).
- **RTH check:** pull a live swing play-brief for a Banger-origin MANAGING/SCALING_OUT position (signalKinds includes BANGER) and confirm the Thesis Health section is now omitted rather than showing a pillar breakdown, matching how any other uncalibrated/absent-data case renders elsewhere in the brief.

### 223. Swing horizons board: 2dp premium rounding disagreed with the API's own `livePnlPct` for penny-priced Banger-origin contracts — fix/swing-horizons-penny-premium-rounding-precision — 2026-09-15

- **What was broken:** `GET /api/market/nighthawk/horizons` rounds `contract.mid`/`entryPremium`/`peakPremium` to a plain 2dp default, but `livePnlPct` (banger-lane-merge.ts) is computed upstream from the RAW unrounded entry/mark. For normal contracts 2dp is invisible; for sub-$1 Banger-origin contracts (the dominant population of the Swing Command committed lane) it produces a visible arithmetic mismatch. Live on RBLU: raw mark 0.125 displayed as 0.13, entry 0.15 → recomputing (0.13-0.15)/0.15 gives -13.3%, but the same response's `livePnlPct` (computed from the real 0.125) says -16.7%.
- **What changed:** added a `keyDp` override to this route's `roundFloats` call (`{mid: 4, entryPremium: 4, peakPremium: 4}`), the same per-key-precision mechanism already used for option greeks (gamma needs 4dp or 2dp quantizes it to 0.00).
- **RTH check:** pull a live Swing Command committed play for a penny-priced Banger-origin ticker (sub-$1 entry premium) and confirm `(contract.mid / entryPremium - 1) * 100` computed from the displayed values stays within ~0.5pp of the API's own `livePnlPct` field.

### 224. Ask Largo's play-brief for a rolled/closed swing chain never disclosed the real chain-composite result, only the terminal leg's own — feat/swing-rolled-chain-composite-brief-line — 2026-09-15

- **What was broken:** live on INTC's rolled chain (rootPositionId 30, terminal leg 35): the play-brief headlined "Exit P&L: -33.2%" (terminal leg only); the same chain's real composite (`GET /api/market/swing/record`) is `-60.47%` compounded, `outcome: loss`, `worstLegPnlPct: -40.83`. A member reading the detailed brief for a rolled position saw a materially better-looking loss than the trade's real outcome, with no cue elsewhere in that brief that a worse number exists.
- **What changed:** `loadRollHistory` now also computes `buildSwingRecord(chain).composite` (same function `/api/market/swing/record` uses, never recomputed) and attaches it once the chain has actually resolved; `rollHistoryLine` appends one plain-text sentence citing the composite's own scalar fields ("Full chain result: -60.5% compounded (loss, worst leg -40.8%)"), deliberately never blended with the terminal leg's own price/peak/trough numbers in the same clause — that exact pairing caused a prior bug (closed-plays.ts's header). The per-leg headline itself is untouched.
- **RTH check:** pull a live rolled/closed swing chain's play-brief and confirm the roll-history line now also states the real chain-composite result as a second sentence, distinct from (not replacing) the terminal leg's own headline Exit P&L.

### 226. Ask Largo swing brief: an 8.5-year-old (or wrong-entity) short-interest figure rendered under the identical STALE tag as a few-days-old one — fix/swing-short-interest-ancient-data-ceiling — 2026-09-15

- **What was broken:** `fundamentalsFreshness()` feeds fundamentals `as_of` age into the shared `freshnessFromAgeMs()`, which has only `live`/`recent`/`stale`/`unknown` — no upper bound, so a figure a few days old and one ~9 years old (MSTX, `as_of: 2017-03-31` — almost certainly a recycled-ticker/wrong-entity mismatch) rendered the identical `STALE` tag. Three live corroborating instances (MSTX/2017, CRCG/2025-12-31, ECO/2025-12-31) crossed the standing 3-instance threshold.
- **What changed:** rather than widening the shared `BieFreshness` primitive (cross-product blast radius, deliberately left alone), applied a domain-specific 60-day ceiling at this one call site: past it, the short-interest evidence line is omitted entirely instead of mislabeled `stale` — the Largo contract's own absence principle applied to a freshness-gated fact.
- **RTH check:** pull a live swing play-brief for a ticker whose short-interest data is genuinely old/wrong-entity (or re-check MSTX specifically) and confirm the "Short interest" evidence line is now absent rather than shown tagged `stale`; confirm a normal ticker's short-interest line still renders as before.

### 225. A second, un-gated UI consumer still rendered Ask Largo's fabricated-precision thesis-health panel for Banger-origin swing positions after PR #5027's fix — fix/swing-thesis-health-panel-unguarded-render — 2026-09-15

- **What was broken:** found by re-screenshotting production AFTER PR #5027 deployed (confirmed live via the ECR push workflow's ECS roll step): the page's top "THESIS STRENGTH" figure correctly stopped showing the fabricated score, but a SEPARATE widget (`ZeroDteCommandPanel.tsx`'s "Swing thesis health" section, `SwingThesisHealthPanel`) still rendered the full byte-identical fabricated breakdown for RBLU, including "Regime fit: BREAKOUT · BANGER" verbatim.
- **What changed:** this render site's gate was `{play.thesisHealth && (...)}` — nullness only, never calibration. Exported `terminal-display.ts`'s existing, correctly-scoped `healthIsCalibrated` helper (already used by every other consumer on this page) and added it to the gate: `{play.thesisHealth && healthIsCalibrated(play) && (...)}`.
- **RTH check:** load `/nighthawk?view=swings&ticker=<a live Banger-origin ticker>` and confirm the "Swing thesis health" panel is now correctly absent, matching the already-fixed "THESIS STRENGTH" figure and the Ask Largo brief text on the same page.

### 227. 0DTE counterfactual skip-grader ("did this gate block a winner") was never scheduled — silently non-functional since its 2026-09-12 logic fix — fix/zerodte-skip-grading-cron — 2026-09-15

- **What was broken:** `runSkipGrading` (the counterfactual grader that answers "would a hard-gate-blocked 0DTE setup have won") had exactly one caller — an admin-gated, manually-triggered POST route — and nothing ever scheduled it. A real timezone bug in its logic was fixed 2026-09-12, but with no cron invoking it, the fix never actually ran against the live rejection backlog: a live GET on 2026-09-15 still showed every gate's `blocked_value` at n=0/all-ungradeable, the exact pre-fix signature.
- **What changed:** added `/api/cron/zerodte-skip-grade` (cron-authorized, calls the real `runSkipGrading` directly), registered in `cron-registry.ts` at 17:00 ET daily post-close, and manually created + terraform-recorded (blackout-infra PR #53) the matching EventBridge rule/target/Lambda permission. A manual trigger during this fix graded 170/200 previously-stuck rows on the first pass, confirming the underlying logic fix works and the only gap was scheduling.
- **RTH check:** the next morning, `GET /api/market/zerodte/calibration?days=1` should show yesterday's session's rejections already graded (not all-ungradeable) without any manual POST — confirms the cron fired and did its job overnight.


### 228. 0DTE trim_scale runner floor-exit narrative never mentioned already-banked tranches — fix/trim-scale-floor-exit-tranche-note — 2026-09-15

- **What was broken:** `decideTrimScale`'s floor-exit `detail` sentence (`exit-engine.ts`) described only the runner's own peak/floor/mark, with zero mention of how many trim tranches already banked profit at their own (usually better) trigger prices — even though that count was already computed a few lines above in the same function. Live on SPXW (2026-09-15, closed +21.02%): `exit_policy.trim_levels` showed BOTH tranches `fired: true` (33% at +20%, 33% at +50%, real fill premiums), but the member-facing `exit_detail` — the ONLY narrative shown for this exit — read as if 21.02% were the whole trade's result.
- **What changed:** appended one sentence to the existing `detail` string, using `taken`/`thresholds.length` (already in scope, zero new inputs), only when `taken > 0`: "This is the runner only — N/2 tranches (33% each) already banked on the way up." Narrative-only — no P&L/gate/reason-code change.
- **RTH check:** the next time a trim_scale-managed 0DTE play peaks past a tranche trigger, banks it, then exits via the profit floor (`ratchet_profit_floor`/`ratchet_early_profit_floor`/`ratchet_breakeven_floor`/`trim_scale_dead_zone_floor`), confirm its `exit_detail` now names the banked tranche count — today's SPXW row itself won't show it (closed before this fix merged, not retroactive), so this needs a FRESH exit to verify live.

### 229. Ask Largo swing brief's Meridian catalyst section had zero freshness disclosure — fix/swing-meridian-catalyst-freshness — 2026-09-15

- **What was broken:** `SwingMeridianCatalystSlice.as_of` (stamped once, at the moment the cached Meridian timeline read actually ran) was captured on the type but never read by `meridianCatalystSection` — the one narrative section in the swing play brief with zero staleness disclosure, unlike its GEX/Vector/option-mark siblings which all explicitly caveat "Last snapshot (~Xs old)" once stale. Real risk, not hypothetical: `withServerCache`'s stale-while-revalidate path can keep serving the same stored payload (and its true `as_of`) for up to `MAX_STALE_AGE_MS` = 10 minutes when the upstream Benzinga feed degrades — well past the section's own 120s TTL — so "calendar is quiet, not missing" could describe a read up to 10 minutes old with no indication to the reader.
- **What changed:** added `meridianCatalystAgeMs`/`meridianCatalystStale` (`play-brief-absence.ts`), mirroring the existing `gexMatrixAgeMs`/`gexMatrixStale` pattern exactly (same 120s bound, same future-skew guard). `meridianCatalystSection` now prefixes the same "Last snapshot" caveat GEX/Vector already use once stale; `collectBriefUnavailableSources` surfaces a matching "Meridian catalysts" / "stale" entry (gated off for CLOSED plays, same as every other live-desk-freshness check).
- **RTH check:** pull a live swing play-brief during a period of Benzinga upstream degradation (or force one via a stale cache entry) and confirm the Meridian catalysts section now shows a "Last snapshot (~Xs old)" caveat rather than present-tense "calendar is quiet" prose; confirm a normal, fresh read still renders with no caveat.

### 231. Ask Largo swing brief's evidence array never backed portfolio-overlap/sibling-position claims — fix/swing-evidence-portfolio-overlap — 2026-09-15

- **What was broken:** `evidenceFromContext` (the sole feeder of `envelope.evidence`) gives every other data-sourced narrative claim (dealer posture, HELIX flow, earnings, short interest) a matching evidence entry, but `bookContextSection`'s concentration claim ("already holding N same-direction positions in theme X") and `siblingPositionsNote`'s concurrent-position claim ("TICKER carries N concurrent live positions... entry $X, P&L Y%") had none — live-verified on CRWD/AAPL/TSM briefs, an inconsistency with the function's own established pattern, not a documented design choice.
- **What changed:** added two branches to `evidenceFromContext`, reusing the exact same `checkPortfolioOverlap` call and sibling-filter logic the two sections already use (same gating, same exclusions) so the evidence entries can never drift from the section bodies they back.
- **RTH check:** pull a live swing play-brief for a position with a real book-overlap or same-ticker sibling and confirm `envelope.evidence` now carries a matching "Book overlap: ..." or "... concurrent live position(s) ..." entry alongside the existing narrative section.

### 232. Two swing play-brief sections badged a healthy/top-ranked SHORT play "bullish" — fix/swing-nondirectional-bias-mislabel — 2026-09-15

- **What was broken:** `thesisHealthSection` mapped `h.health` (a direction-agnostic "is the setup intact" score) and `laneRankSection` mapped `deltaFromMedian` (a relative entry-score rank) straight to bullish/bearish `bias` fields. A SHORT play with a healthy thesis (health>=65, price correctly falling) or a top rank badged the section green "Bullish" via `BieSectionCard`'s real, color-coded `BiasPill` — the literal opposite of what the trade is betting, contradicting the envelope's own top-level `biasFromDirection(play.direction)` shown in the same brief. No committed SHORT exists on the live board today (only 2 SHORT WATCH rows, neither with `thesisHealth` wired), so the path hasn't fired live yet, but it's unconditional and will on the next committed SHORT.
- **What changed:** removed the `bias:` field from both sections' calibrated return paths (omission is honest — a quality/rank score has no direction of its own).
- **RTH check:** once a SHORT position commits with a healthy thesis (health>=65) or a top-ranked SHORT appears in a lane, pull its play-brief and confirm the Thesis health / Lane rank sections render with no bias pill, while the envelope's own top-level bias still correctly reads "bearish".

### 233. Swing play-brief wall/flip/king level provenance mislabeled a live Vector price as GEX's staler read — fix/swing-wall-level-provenance-mismatch — 2026-09-15

- **What was broken:** `levelsFromContext`'s `price` for call wall/put wall/gamma flip/GEX king already prefers the live Vector value (`vecX ?? gex?.X`), but the `provenance.asOf`/`freshness` for the same entry tested `gex?.X != null` (whether GEX has a value at all) instead of the vec-side variable that actually drove `price`. Since both feeds almost always carry a value, this always picked GEX's own (often staler) age bucket even when the displayed price was Vector's live one — live-confirmed on a real brief where `spot` correctly reported `freshness: "live"` while all four wall-family entries reported "recent" at the identical timestamp.
- **What changed:** replaced the `gex?.X != null` test with the same vec-side test `spot`'s provenance already uses (`vecX != null ? "vector" : "gex"`) in all four blocks.
- **RTH check:** pull a live swing play-brief where Vector's wall/flip/king data is fresher than the GEX matrix's own read and confirm `envelope.levels`' `call wall`/`put wall`/`gamma flip`/`GEX king` entries report `freshness: "live"` (matching `spot`), not GEX's staler bucket.

### 234. Swing play-brief Book Context rendered a genuine cross-engine sibling on the reviewed ticker as unlabeled self-citation — fix/swing-book-context-same-ticker-sibling-label — 2026-09-15

- **What was broken:** `loadOpenBook()` merges `swing_positions` (real `positionId`) with `banger_positions` (`positionId` deliberately unset — separate DB sequences that can collide on id). Once a reviewed play's own `positionId` excludes itself exactly, a real cross-engine sibling on the SAME ticker correctly falls through as genuine concentration, but `bookContextSection` rendered it as bare "TICKER DIRECTION" — textually indistinguishable from a self-citation/data-duplication bug. Live-confirmed on CRWD: swing position #39 (reviewed, excluded) coexists with a real, independently-committed Banger CRWD LONG (id 1123, 255C, entry $4.86) — CRWD's own Book Context showed "already holding... CRWD LONG..." with no way to tell it was a different, real position.
- **What changed:** added `formatOverlapPosition()` — when a sibling's ticker matches the reviewed play's own ticker (the only case that can read as self-citation), appends "(separate position #N)" when a real positionId is known, else "(separate, cross-engine position)".
- **RTH check:** pull a live swing play-brief for a ticker with both a swing-native and a Banger-origin open position (or any two independent same-ticker positions) and confirm Book Context now labels the same-ticker sibling distinctly rather than rendering bare, ambiguous "TICKER DIRECTION" text.

### 235. Swing play-brief roll-history date used the raw UTC calendar day instead of the ET session date — fix/swing-roll-date-utc-not-et — 2026-09-15

- **What was broken:** `rollHistoryLine()`'s roll date was `new Date(committedAt).toISOString().slice(0, 10)` — the raw UTC calendar day, not the ET session date the rest of the codebase uses (e.g. `siblingPositionsNote` correctly uses `etStampFromIso` on the identical `committedAt` field). Currently bounded (the only write path is RTH-gated, so no live commit crosses UTC midnight today) but a genuine latent bug: a roll near/after 8pm ET during EST would display the day after the true roll session.
- **What changed:** imported the shared `etSessionDate` helper and replaced the raw UTC slice with `etSessionDate(Date.parse(curr.committedAt))`.
- **RTH check:** once a roll commits near the RTH boundary (or if the market-hours gate is ever loosened), pull that position's play-brief and confirm the "Rolled ... on YYYY-MM-DD" date matches the real ET session date, not a UTC-shifted one.

### 236. SPX Slayer Live Desk brief claimed "neg-γ" on an unresolved gamma flip — fix/spx-desk-brief-unresolved-gamma-flip — 2026-09-15

- **What was broken:** `above_gamma_flip` defaults to `false` (not null) whenever `gamma_flip` is unresolved, and `src/lib/bie/spx-desk-brief.ts` treated that default as a confirmed negative-gamma regime in three places (`gammaTag()`, a `buildWhy()` branch, two `NEXT 5M` branches) without checking `gamma_flip != null` first. Live-confirmed 2026-09-15 ~19:44 ET: `GET /api/market/spx/desk` returned `gamma_flip: null, gamma_regime: "unknown", above_gamma_flip: false`, and feeding that shape through `composeSpxDeskBrief` produced body text reading "neg-γ expansion into {{…}} air if {{…}} fails" — a confident short-gamma call with no real signal behind it.
- **What changed:** added a `desk.gamma_flip != null` guard to every branch that was trusting the defaulted boolean alone; the honest fallback now reads "γ regime unresolved" instead of asserting a direction, and the `NEXT 5M` line's price substitution for the unknown flip level is now labeled as such rather than silently presented as the real flip.
- **RTH check:** pull `GET /api/market/spx/desk` during a period where `gamma_flip` is null/unresolved (pre-open, a data hiccup, or any tick where the GEX matrix hasn't populated the flip yet) and confirm the Live Desk brief's `WHY`/`NEXT 5M`/mechanic lines read "γ regime unresolved" rather than a confident "neg-γ" claim; confirm a normal tick with a resolved flip still renders the real pos-γ/neg-γ read unchanged.

### 237. Ask Largo short-interest ancient-data guard fixed at one call site, two siblings never got it — fix/swing-fundamentals-ancient-check-gap — 2026-09-16

- **What was broken:** PR #5042 (Largo C7, 2026-09-15) added an "ancient" guard to `play-brief.ts`'s `evidenceFromContext()` after live-repro'ing FINRA short-interest reads up to ~9 years stale (MSTX/2017, CRCG/2025-12-31, ECO/2025-12-31) rendering the identical `STALE` freshness tag as a genuinely few-days-old read. `catalystsSection()` (play-brief-intel.ts) and `shortInterestCoaching()` (play-brief-narrative-coaching.ts) read the exact same `arsenal.fundamentals` field with zero freshness/age check — so the same brief could show an ancient DTC figure with unqualified confidence in the two places a member would actually read it (a "Catalysts & news" bullet and a headline "Trade manager read" coaching line), while only the buried `envelope.evidence` entry correctly withheld it.
- **What changed:** centralized the ceiling check as `fundamentalsAncient()` in `play-brief-absence.ts` (already imported by all three files), and gated both previously-unguarded call sites on it.
- **RTH check:** pull a live swing play-brief for a ticker whose `arsenal.fundamentals.as_of` is more than 60 days old (or whose FINRA short-interest record is stale/recycled-ticker-adjacent) and confirm neither "Catalysts & news" nor the "Trade manager read" short-interest coaching line renders a DTC/short-vol-ratio figure; confirm a ticker with a fresh `as_of` still shows both normally.

### 238. Committed swing positions' Thesis Health could never calibrate its persistence pillar — fix/swing-thesis-health-live-setup-state — 2026-09-16

- **What was broken:** `computeSwingThesisHealth`'s persistence pillar read `src.setupState`, which is permanently `null` for a committed swing position — the WATCH-lane dossier state that would calibrate it never survives the WATCH→COMMIT transition (`SwingPositionRow` has no `setup_state` column, and `live-plays.ts`'s row→`HorizonPlay` mapper never assigned it). Every committed position's Thesis Health section rendered "Inputs not wired for committed positions" regardless of how mature the setup actually was.
- **What changed:** rather than pin a dossier state once at commit (verified this would be tautological — the dossier's own trigger level is set literally to the same price used as "current price" at build time, so it would always read TRIGGERED, a constant not a calibration), wired `live-plays.ts`/`play-brief-resolve.ts`/`adapters.ts` to thread `entry_underlying_px`/`thesis_invalidation_px`/a live spot through and DERIVE `setupState` fresh on every read via `deriveSetupState`, the same way the WATCH lane already does.
- **RTH check:** pull a live swing play-brief for an OPEN/HOLD/TRIM position and confirm the Thesis Health section's Persistence pillar now shows a real derived label (forming/triggered/extended/invalidated) reflecting current price vs. the position's entry/invalidation levels, rather than "unknown". Note: the top-level "Inputs not wired..." disclosure may still show until the companion `signalKinds` fix (a separate agent's half of this same split, tracked on #4076) also lands — check the Persistence pillar specifically, not just the overall banner.

### 239. Swing signalKinds (discovery corroboration) computed at commit but never pinned — companion to #238 — fix/swing-signal-kinds-commit-pin — 2026-09-16

- **What was broken:** the other half of #238's gap. `discovery.ts`'s commit-candidate assembly already computed `discoveryPaths` (the FLOW/STRUCTURE/CATALYST provenance the G-S6 confluence gate graduated the candidate on) but `commit.ts`'s `buildCommitInsert` never persisted it — used only to decide whether to commit, then discarded. `live-plays.ts` never read anything back from `entry_context` either, so every committed row's `signalKinds` was permanently `undefined`, which `thesis-health.ts` renders as the `"no signals"` sentinel `thesisHealthUncalibrated()` treats as proof the whole pillar breakdown is uncalibrated.
- **What changed:** `commit.ts` now pins `signal_kinds: cand.discoveryPaths ?? null` into `entry_context` (reusing the SAME already-graduated value, not a fresh derivation). `live-plays.ts` reads `row.entry_context?.signal_kinds` back (array-shape-guarded) into the returned `HorizonPlay.signalKinds`, which already flows unchanged through the existing `computeSwingThesisHealth` call.
- **RTH check:** together with #238 (both now merged), pull a live swing play-brief for an OPEN/HOLD/TRIM position committed AFTER both fixes deployed and confirm the Thesis Health section's top-level "Inputs not wired for committed positions" banner has cleared entirely (not just the Persistence pillar) — `flow_corroboration` (this fix) + `persistence`/`entry_geometry` (#238) are the three gating sentinels; all three should now read real values. Note: `entryStatus` was deliberately left unaddressed (no coherent post-commit meaning — see PR #4076 discussion) — if the banner still shows, check whether `entry_geometry`'s sentinel is the holdout before assuming a regression. **Positions committed BEFORE this deploy will still show the old degrade** (no `signal_kinds` in their `entry_context`) — only test against a freshly-committed position, not a pre-existing one, or the check will falsely read as still-broken.

### 240. Ask Largo "Data freshness" section never flagged a stale option mark, contradicting the same envelope's evidence/unavailableSources arrays — fix/swing-data-freshness-mark-stale-flag — 2026-09-16

- **What was broken:** `dataFreshnessSection` — the section named for honest freshness disclosure — printed the raw option-mark timestamp unconditionally, never checking `optionMarkIsStale`, while the SAME envelope's `evidence[]` and `unavailableSources[]` arrays both correctly computed staleness off the identical `play.markAsOf` field. Live-confirmed on all 3 currently-committed positions (CRWD:39, AAPL:38, AAPL:37): all carried a ~14-hour-old mark (prior session's close print), and "Data freshness" said "as of <time>" with no qualifier while the unavailable-source chip and evidence array both said "stale" for the same field.
- **What changed:** the option-mark line now calls the shared `optionMarkIsStale` helper (already the source of truth for the other two consumers) and renders "Option mark **stale** — last synced **<time>**" when past the 18-minute bound, matching the wording pattern the section's other staleness lines already use.
- **RTH check:** pull a live swing play-brief for an OPEN/HOLD/TRIM position whose option mark hasn't refreshed in >18 minutes and confirm "Data freshness" now says "stale", matching the `unavailableSources` chip; confirm a position with a fresh (<18min) mark still shows the plain "as of" line, no false positive.

### 241. Ask Largo "Data freshness" Vector/GEX age lines reimplemented partial staleness checks, missing future-clock-skew and null-age cases the shared helpers already handle — fix/swing-data-freshness-vector-gex-staleness-helpers — 2026-09-16

- **What was broken:** the Vector-data-age and GEX-matrix-age lines in `dataFreshnessSection` each did a raw `> threshold` comparison instead of calling the already-tested `vectorAgeStale`/`gexMatrixStale` helpers this same file uses correctly everywhere else. Two gaps: (1) a future-skewed `vec.dataAgeMs` (`Number.POSITIVE_INFINITY`) still tripped the raw `>` check but rendered the literal string "Vector data **Infinitys** old"; a `null` `dataAgeMs` (unparseable `asOf`) silently skipped the line even when `vec.freshness === "stale"` would correctly flag it. (2) a future-skewed (negative) GEX matrix age read as "fresh" under the raw `>` comparison instead of failing closed the way `gexMatrixStale` already does at every other call site in this file.
- **What changed:** both lines now gate on the shared boolean helper (`vectorAgeStale(vec, Date.now())` / `gexMatrixStale(gex, Date.now())`), falling back to a `"clock-skewed"` label instead of a raw seconds figure when the underlying age is non-finite or negative. `GEX_MATRIX_STALE_MS` import removed (became unused once the raw comparison was replaced).
- **RTH check:** no live-reproducible RTH signature expected (both defects need clock-skewed/malformed provider timestamps, not just staleness) — this is a code-correctness fix confirmed via 3 new unit tests (RED pre-fix / GREEN post-fix) plus the full 1198-test swing suite; no specific live board check needed, just confirm no regression in the normal "GEX matrix **Ns** old" / "Vector data **Ns** old" rendering on a genuinely stale-but-not-skewed live read.

### 242. Play-brief lane-wide sweep: the "Last snapshot (~Ns old)" narrative pattern rendered garbage on clock-skewed ages in 6 more call sites beyond #241 — fix/swing-age-seconds-label-sweep — 2026-09-16

- **What was broken:** a deliberate sweep of `src/lib/swing/*.ts` for the same anti-pattern #241 just fixed (a raw `Math.round(ageMs / 1000)` display without checking the failure modes the gating helper already fails closed on) found six more copies: `chartTechnicalsSection`, `vectorDeskSection`, `gexPostureSection`, `meridianCatalystSection` (all in play-brief-intel.ts), `dealerPostureLine` (play-brief-narrative.ts), and `dataHonestyCoaching`'s Vector check (play-brief-narrative-coaching.ts — this one also wasn't gated on the shared `vectorAgeStale` helper at all, the same functional gap #241 fixed in `dataFreshnessSection`). Same two failure modes: `Infinity` (Vector future-skew sentinel) renders the literal "Infinitys", and a negative (future-skewed) GEX/Meridian age renders as a negative number.
- **What changed:** added a single shared helper, `ageSecondsLabel(ageMs)` in `play-brief-absence.ts`, and switched all six call sites (plus `dataFreshnessSection` was left as-is from #241) to use it — `"Ns"` for a finite non-negative age, `"clock-skewed"` for non-finite/negative, `null` for missing (so optional-suffix callers omit the parenthetical). `dataHonestyCoaching`'s Vector check was also re-gated on `vectorAgeStale`.
- **RTH check:** same as #241 — no live-reproducible RTH signature (needs clock-skewed provider timestamps); confirmed via 11 new unit tests (RED pre-fix / GREEN post-fix) plus the full 1209-test swing suite. Confirm no regression in the normal "Last snapshot (~Ns old)" rendering across Chart technicals, Vector desk, GEX posture, Meridian catalysts, and Trade manager read on a genuinely stale-but-not-skewed live read.

### 243. Night Hawk Legacy option marks used 0DTE's 5s stale bar instead of Legacy's own 30s one, silently dropping live-sync cron updates — fix/legacy-marks-stale-threshold — 2026-09-16

- **What was broken:** `buildLegacyOptionMarkRow` (`legacy-option-mark-row.ts`) computed its `stale` flag via `isZeroDteMarkStale(asofMs, nowMs)` with no third argument, silently defaulting to `ZERODTE_MARK_STALE_MS` (5s, calibrated for 0DTE's intraday horizon) instead of `LEGACY_QUOTE_STALE_MS` (30s) — the threshold `CommandDeck.tsx`/`PlayTerminal.tsx` already correctly apply client-side for `horizon==="LEGACY"`. This module is Legacy-only (both real callers — the `/legacy-marks` API route and `legacy-option-marks-server.ts` — are Legacy-specific), so the mismatch was a pure server-side oversight. Not cosmetic: `fetchLegacyOptionMarksServer` drops any row flagged stale unless the caller passes `includeStale:true`, and `src/app/api/cron/legacy-live-sync/route.ts` (the ~5-min RTH cron that mark-and-manages real Chief Trade Alert Bot positions) calls it without that flag — so a falsely-stale row silently vanished from the mark map for a full cron cycle, skipping peak/trough tracking and trim/close evaluation for that position entirely. Live-observed repeatedly this session on RIG (a thin single-digit-underlying contract).
- **What changed:** pass `LEGACY_QUOTE_STALE_MS` explicitly as `isZeroDteMarkStale`'s third argument. No horizon branch needed (module is Legacy-only). Every other `isZeroDteMarkStale` call site (`ZeroDteBoard.tsx`, `live-marks.ts`, `exit-sync.ts`) is genuinely 0DTE-scoped and correctly keeps the 5s default, left unchanged.
- **RTH check:** already confirmed live same-session post-deploy (15:07 UTC, 2026-09-16) — pulled the raw `GET /api/market/nighthawk/legacy-marks` payload directly and computed exact quote ages: RIG's `stale:true` now reflects a genuinely 256s-old quote (not a false positive from the old 5s bar), CRWD ~3s old reads `stale:false`. For a FUTURE session: confirm a Legacy contract whose real quote tick lags 5-30s (common on thin names) reads `stale:false` (previously would have been a false positive), and that the legacy-live-sync cron's `noQuote` skip count for such rows has genuinely dropped versus pre-fix baseline (not directly instrumented — infer from more consistent peak/trough updates across consecutive cron ticks on thin-name positions).

### 244. 0DTE scanner (`warmZeroDteBoard`) silently stalled ~35min live — nothing in cron health could see it — fix/zerodte-warm-stall-heartbeat — 2026-09-16

- **What was broken:** live-observed today via CloudWatch: `zerodte_discovery_events` writes went completely dark for 41 minutes (15:29:58-16:10:52 UTC) even though the scanner's own computation (`[zerodte-scan]` logs) kept running fine and the live board stayed fresh — only the heavy persist chain (`warmZeroDteBoard` → `persistZeroDteScan` → discovery-events) silently stopped completing, a recurrence of an already-documented 2026-09-08 incident whose prior fix did not hold. Nothing could detect it: `cron_job_runs` never goes stale for this cron (the handshake logs on the route's fast synchronous path, before the heavy background work is even dispatched), and the admin dashboard's writer-target-freshness override for `zerodte-warm` probed the wrong proxy (the unrelated earnings-match cache, which stayed fresh the whole time) — so even a stale flag would have been suppressed.
- **What changed:** wired the already-existing-but-never-read scanner heartbeat (`recordZeroDteScanTick`/`loadZeroDteScanHeartbeat`, `play-engine-heartbeat.ts`) into `admin-cron-health.ts`'s job evaluation for `zerodte-warm` (mirroring the existing `spx-evaluate` pattern, but keyed on the heartbeat's own staleness rather than the unreliable cron-handshake age), and corrected `cron-writer-target-fresh.ts`'s `zerodte-warm` probe to read the same heartbeat instead of the earnings cache.
- **RTH check:** this is detection/observability infrastructure, not a fix to the underlying stall's root cause (still unknown — candidates noted in the staged finding for the next live recurrence to pin down). Check the admin cron-health dashboard during RTH for the `zerodte-warm` job: it should show `healthy` under normal conditions with a `meta.zerodte_scan_heartbeat.last_tick_at` a few minutes old at most. If a stall recurs, confirm it now flips to `warning`/`stale` with label `"Scanner stale · last scan tick Nm ago"` within 5-10 minutes — previously this would have stayed silently `healthy` for the whole 35+ minute outage.

### 245. G-18 early-window gate: 70-74 sub-band now conditionally admissible — operator-authorized loosening — fix/zerodte-g18-conditional-band — 2026-09-16

- **What was broken:** G-18 (`early_window_prime_score`) unconditionally rejected ANY score below 75 in the `[10:00, 10:45) ET` window, no admission path at all. A live counterfactual backtest (`npm run counterfactual:0dte-g18-g19`, real production skip-grading) measured a 71.4% false-block rate (n=14, 30-45 real days) for exactly this population — most of what the gate was blocking would have won. This was held OPEN earlier today pending operator authorization on a capital-risk-adjacent gate change; the operator then explicitly authorized 0DTE engine changes based on this session's analysis.
- **What changed:** narrowed G-18's unconditional block from `score < 75` to `score < 70`. G-17's own pre-existing, already-evidenced conditional-band check (confluence>=2 AND clean tape AND clean VIX AND clean execution/safety, restructured 2026-09-09) already covers `[70, 75)` at every OTHER time of day — it simply never got a chance to run in the early window because G-18's old unconditional requirement blocked first. No new gate logic was invented; this ports an existing, proven admission path into a window that previously had none. The `<70` sub-band stays an unconditional reject (no backtest evidence supports admitting that low this early).
- **RTH check:** during the next live `[10:00, 10:45) ET` window, check whether any 70-74-scored setup now commits (previously would have been unconditionally rejected). Confirm its `entry_context.gate` shows it cleared via the conditional-band path (no `early_window_prime_score` or `conditional_band_unmet` block) and that its confluence/tape/VIX/execution readings at commit time genuinely satisfy the bar (provable from the frozen `entry_context`). Re-run `npm run counterfactual:0dte-g18-g19 --days=30` in a few weeks — the residual false-block population should shrink once the 70-74 sub-band is excluded from what G-18 itself still blocks.

### 246. Legacy option-mark WS-freshness gate used 0DTE's 5s bar, not Legacy's own 30s bar — fix/legacy-marks-ws-stale-threshold — 2026-09-16

- **What was broken:** sibling defect to #243's fix, one layer earlier in the same pipeline. Both real callers of `buildLegacyOptionMarkRow` — `legacy-marks/route.ts` (member-facing marks API) and `legacy-option-marks-server.ts` (the live-sync cron's own read path) — called `getLiveOptionMarkSync(occ, ZERODTE_MARK_STALE_MS)` to fetch the cached WS tick, which returns `null` (as if no WS tick existed at all) for any tick older than the passed threshold. Passing the 5s 0DTE bar meant a WS tick 5-30s old was discarded and the row fell through to the REST snapshot fallback, even when that REST snapshot's own quote clock was equally or more stale — so #243's fix (correct staleness math) was still being fed a stale-by-omission timestamp from upstream. Live-reproduced 2026-09-16 ~18:36-18:38 UTC (mid-RTH): CRWD (a liquid name, not a thin one) read `stale:true` repeatedly with `asof` lagging real time by 70-90s across three consecutive polls, while SWKS in the same response read fresh — the signature of a fresh WS tick being discarded upstream, not of the quote genuinely going quiet.
- **What changed:** both call sites now pass `LEGACY_QUOTE_STALE_MS` (30s) instead of `ZERODTE_MARK_STALE_MS` (5s) to `getLiveOptionMarkSync`, matching the bar `buildLegacyOptionMarkRow`'s own check already uses. `vector/contract-picks/live/route.ts` and `vector-pick-sweep.ts` (the only other callers of `getLiveOptionMarkSync`) are correctly 0DTE/Vector-scoped and left unchanged.
- **RTH check:** confirm CRWD (or any normally-liquid Legacy underlying) no longer flickers `stale:true` on `GET /api/market/nighthawk/legacy-marks` during active RTH trading — `asof` should track within ~30s of request time consistently, not intermittently lag 70-90s. More importantly, confirm the legacy-live-sync cron's `noQuote` skip count drops further on liquid-name positions specifically (thin names like RIG will still legitimately skip when the market genuinely hasn't quoted in >30s — that's correct behavior, not a regression).

### 247. Read-time outcome overlay silently undid the gate-promote conviction cap on every edition read — fix/legacy-outcome-overlay-gate-promote-cap — 2026-09-16

- **What was broken:** `publish-gates.ts`'s `capGatePromotedConviction` caps a gate-promoted rescue play's displayed conviction at "B" (its own comment: "a mechanically blocked A does not read as top-tier overnight merit"), applied once at build time. `publish-context.ts` separately pins `publish_context.tier` from the RAW tier-engine assignment, computed independently of `gate_promoted` status. `edition-outcome-overlay.ts`'s `applyEditionOutcomeOverlay` — which runs on EVERY live `GET /api/market/nighthawk/edition` request, not just at build — read that raw tier pin back and unconditionally set `conviction = overlay.tier.tier`, with no `gate_promoted` check, silently re-inflating a capped "B" back to the raw tier's "A" on every read. Zero test coverage existed for this interaction.
- **What changed:** the overlay now pipes its tentative conviction assignment through the same `capGatePromotedConviction` the build-time path already uses, so both paths can never drift apart.
- **RTH check:** the next time a gate-promoted play appears in a live edition (check `play.gate_promoted === true` in the API response), confirm its displayed `conviction` stays "B" across multiple reads/refreshes rather than showing "A"/"A+" on some requests — previously it would have flip-flopped depending on whether the outcome-overlay pass had run.

### 248. G-1 (`no_market_bias`) shared a per-ticker timeout budget with SPY's own bias read, concentrating false blocks on QQQ/SPY/SPXW/SPX/DIA — fix/zerodte-spy-bias-timeout — 2026-09-16

- **What was broken:** operator asked live why the engine "hardly finds any major plays on spx spy qqq iwm .. tsla nvda." Live investigation found `attachIntradayEdge` (scan.ts) computes ONE shared SPY intraday read per scan cycle and hands its freshness to G-1, which hard-blocks EVERY index-ETF/SPX-family setup (QQQ/SPY/SPXW/SPX/DIA) if that read is missing/stale — but the SPY fetch shared the SAME tight 2.5s `within()` timeout as every other per-ticker read in the same batch, even though a per-ticker miss only softens one setup's score adjustment while a SPY miss vetoes five major tickers at once. Live rejection-export data confirmed it: 112 total `no_market_bias` rejections, 94% concentrated on exactly QQQ(44)/SPXW(25)/SPY(26)/DIA(8)/IWM(2), and a live re-run caught QQQ(84)/SPY(78)/SPXW(68)/SPX(66) — the four highest-scoring setups in the whole pool — all blocked simultaneously in one scan pass.
- **What changed:** `intradayReadFor` now accepts a `timeoutMs` override; SPY's own read in `attachIntradayEdge` uses a new `SPY_BIAS_FETCH_TIMEOUT_MS` (6s) instead of the shared 2.5s per-ticker budget. `MARKET_BIAS_MAX_AGE_MS` (the 15-min genuine-staleness ceiling) is untouched — a truly stale tape still fails closed exactly as before; only how long one cycle waits for a fresh SPY read before giving up changed.
- **RTH check:** during the next live session, sweep `GET /api/admin/zerodte/rejection-export?gate_failed=no_market_bias` and confirm the rate/concentration on QQQ/SPY/SPXW/SPX/DIA has genuinely dropped versus the 2026-09-16 baseline (112 total, 94% on those 5 tickers) — a residual few is expected (a truly stale tape should still block), but the same-cycle simultaneous multi-ticker blocks on high-scoring setups should not recur at the same rate.

### 249. Ask Largo WATCH brief duplicated "Entry geometry" across two sections, with inconsistent formatting — fix/watch-entry-geometry-duplication — 2026-09-17

- **What was broken:** `watchForSection`'s "## Watch levels" section re-rendered `play.entryStatus` as its own "Entry geometry" bullet — but `watchEntrySection`'s "## Entry" section (which `composeSwingPlayBrief` always places BEFORE it for a WATCH play) already renders the identical fact under the same label. Live repro on the TSM WATCH brief, 2026-09-17: "## Entry" printed "Entry geometry: **AT_TRIGGER**" (raw enum) and "## Watch levels" printed it again, three sections later, as "Entry geometry: **AT TRIGGER**" (humanized — underscores replaced with spaces). Same fact stated twice with two different formattings of the same value, no cross-reference between them. Exact same duplication shape as the `gateBlocks` fix already shipped in the same function on 2026-09-12 — the `entryStatus` line sitting one line below it was never given the same treatment, and no test exercised `play.entryStatus` in this function's fixtures, so nothing caught the gap.
- **What changed:** dropped the duplicate render in `watchForSection`. Unlike `gateBlocks` (a list, where a count-plus-pointer sentence is still useful), `entryStatus` is a single scalar already shown verbatim in the Entry section — nothing worth preserving, so the line is removed outright rather than replaced with a pointer.
- **RTH check:** pull a live swing WATCH play-brief (`GET /api/market/swing/play-brief?ticker=<any current WATCH name>`) and confirm "Entry geometry" appears exactly once, in the "## Entry" section, not again under "## Watch levels" — previously every WATCH brief carrying a non-null `entryStatus` showed it twice.

### WATCH ITEM (not a fix): `single_rail_corroboration` co-occurring with `no_market_bias` on QQQ/SPY/SPXW — 2026-09-17

Operator asked directly to re-check both #248 (G-1 `no_market_bias`) AND this gate live during tomorrow's RTH.
A `zerodte-gate-compound-funnel.mjs --now-et=11:00` run at 2026-09-16 23:49 ET (after hours, real
data) showed QQQ/SPY/SPXW still blocked by `no_market_bias` — expected off-hours (SPY's real intraday
read IS genuinely stale when the market's been closed for hours; the #248 fix only widened the fetch
timeout during live trading, it doesn't fake freshness after close) — but the SAME three tickers were
ALSO blocked by `single_rail_corroboration`, a gate not investigated this session. Unknown whether
that's a genuine second chokepoint on indices or an off-hours artifact (fewer real independent flow
signals at midnight). **Next-session action:** during live RTH tomorrow, (1) sweep
`GET /api/admin/zerodte/rejection-export?gate_failed=no_market_bias` and confirm the QQQ/SPY/SPXW/SPX/DIA
concentration has dropped vs the 2026-09-16 baseline (112 total, 94% on those 5 tickers) per #248's own
RTH check; (2) separately pull `?gate_failed=single_rail_corroboration` for the same tickers and check
whether it's still a live chokepoint on indices specifically during real RTH hours — if so, trace its
logic before touching anything (same "measure before guessing" discipline as every other gate fix
this file documents).

### 250. Legacy Command Deck showed a populated "Best" next to a blank "Worst" on freshly-opened positions — fix/legacy-trough-pnl-fallback-asymmetry — 2026-09-17

- **What was broken:** `legacy-primary-pnl.ts`'s `legacyPrimaryPeakPct`/`legacyPrimaryTroughPct` are meant to mirror each other (best-so-far / worst-so-far), but their fallbacks diverged: when a position has live option P&L (`pnlPct`) but no `peak`/`trough` latched yet (the real window between BTO and the live-sync cron's first tick), peak correctly fell back to the current `pnlPct` ("nothing better seen yet") while trough fell back to `null` instead of the same `pnlPct`. `TerminalPremiumPanels.tsx` renders `best`/`worst` from these two functions side by side for the same play, so a freshly-opened position showed a real "Best" number next to a blank "Worst" for the identical data-availability state.
- **What changed:** `legacyPrimaryTroughPct`'s live-P&L branch now falls back to `play.pnlPct`, exactly mirroring `legacyPrimaryPeakPct`. No change for a play that already has a latched trough.
- **RTH check:** open Command Deck's Legacy panel on a position opened within the last few minutes (before the live-sync cron's next ~5-min tick) and confirm both "Best" and "Worst" show the same live P&L number rather than "Worst" reading blank/N/A — previously only "Best" would be populated in that window.

### 251. A WS trade print silently refreshed a stale option mark's timestamp, defeating staleness detection — fix/options-ws-trade-print-stale-ts — 2026-09-17

- **What was broken:** `options-socket.ts`'s `handleTrade` (the "T" print handler) always stamped `ts: Date.now()` on every trade print while carrying `bid`/`ask`/`mark` forward unchanged from the last real Quote whenever one existed. A contract that keeps printing trades without a fresh NBBO quote update (a resting two-sided market that isn't re-quoting) would have its mark's `ts` re-stamped to "now" on every such trade, so `isWsUpdatedAtFresh`/`isZeroDteMarkStale` could report a genuinely stale mark as fresh indefinitely. This fed `getLiveOptionMarkSync`, the WS read path for both `legacy-marks/route.ts` and `legacy-option-marks-server.ts` (the legacy-live-sync cron's own mark feed), plus Vector/0DTE's own callers.
- **What changed:** extracted the merge into a pure `mergeTradeIntoOptionMark(prev, last, now)`; `ts` now only advances to `now` when the trade itself establishes the FIRST mark (no prior quote-derived mark existed). When a real mark already exists, its timestamp carries forward with it — a trade print no longer manufactures freshness on its own. `last` still updates either way.
- **RTH check:** during live trading hours, pick a thinly-traded Legacy contract (e.g. a low-volume/low-premium name like RIG has shown historically) and poll `GET /api/market/nighthawk/legacy-marks?occs=<occ>` a few times while watching for a stretch of trade prints with no quote refresh (WS logs or a code-level trace would confirm this, since the API itself only surfaces the end result) — confirm `asof`/`stale` age with real time rather than resetting on every poll during such a stretch. Absent a direct way to force a trade-without-quote window from outside, the regression test (`options-socket-trade-merge.test.ts`) is the primary proof; this RTH check is a secondary sanity pass, not the sole evidence.

### 252. Ask Largo "Lane rank" section compared a rounded score to raw peer scores — fix/lane-rank-score-precision-mismatch — 2026-09-17

- **What was broken:** `computeLaneRank`'s `playScore` was read straight off `TerminalPlay.score`, which `terminalPlayFromHorizon` (adapters.ts) rounds to the nearest integer for board display (`Math.round(src.score)`), while `medianScore`/`topScore` are computed from `laneRows: HorizonPlay[]`, which retain the raw score to one decimal. Live repro, AAPL WATCH brief, 2026-09-17: "Why this setup"'s pillar breakdown summed to the true raw score 25.5 three sections earlier, while "Below lane median" three sections later showed "score 26 (-23.6 vs median)" — the rounded 26, giving a delta 0.5pt off the true -24.1 and silently contradicting the brief's own pillar sum.
- **What changed:** `computeLaneRank` now reuses the play's own row (already present in `sorted`, the same array `medianScore`/`topScore` are computed from) for `playScore` instead of re-deriving one from the differently-rounded `TerminalPlay.score`, falling back to `play.score` only when the play's own row isn't present in `laneRows`.
- **RTH check:** pull a live swing WATCH or OPEN play-brief for a ticker whose raw entry score carries a decimal fraction that rounds up/down (e.g. any current WATCH name — check the score in `GET /api/market/nighthawk/horizons?view=swings` first) and confirm the "Lane rank"/"Below lane median" score matches the raw value, and that its sum against the "Why this setup" pillar breakdown is now consistent, rather than reading a rounded integer that disagrees with the pillar sum shown elsewhere in the same brief.

### 253. `flat_theta_bleed` exit narrative claimed "never left the ±10% band" on plays that genuinely breached it — fix/flat-theta-bleed-trough-narrative — 2026-09-17

- **What was broken:** the 0DTE exit engine's flat-timeout scratch (both `trim_scale` and `ratchet` exit modes) only checked the latched PEAK (upside) and the CURRENT mark at the moment the 25-min clock fired (downside) — never whether price dipped below the ±10% band and recovered before the timeout. `ExitEngineInput` had no trough field at all, so the detail sentence unconditionally read "...the play never left the ±10% band..." regardless. Confirmed against the DB's own `trough_premium` (already latched for stop determination elsewhere, just never read here) on 5 real `flat_theta_bleed` exits across 5 separate trading days in the 2026-09-08..09-16 window — CORZ (-13.64% trough), IONQ (-20.00%), AAPL (-10.39%), RDDT (-30.17%), ASTS (-31.73%) — every one narrated as "never left the band" while genuinely breaching it, some by a wide margin.
- **What changed:** added `troughPremium` to `ExitEngineInput`, wired `row.trough_premium` into `exit-sync.ts`'s `evaluateExitState` call (the field already existed on the row, just wasn't read for this purpose), and both `flat_theta_bleed` branches now say "dipped to X% intraday but recovered back inside the ±10% band" when the trough actually breached, otherwise the original sentence unchanged. Narrative-only — the exit condition and action/reason are byte-identical to before; does not change which plays exit or when.
- **RTH check:** during the next live session, watch for a `flat_theta_bleed` exit (`GET /api/market/zerodte/record` or the live board's `ledger`) whose `entry_context.exit.detail` — confirm the sentence correctly reflects a trough breach when one occurred (cross-check against the row's own `trough_premium` via `GET /api/admin/zerodte/tier-export`) rather than defaulting to "never left the band" on every occurrence. A play that genuinely stays flat the whole hold should still read "never left the band" — only the breach-and-recover shape should show the new sentence.

### 254. Ask Largo "Lane rank" silently excluded a floor-cleared WATCH candidate from its own peer pool — fix/lane-rank-floor-cleared-watch-exclusion — 2026-09-17

- **What was broken:** `rowInBucket` (`src/lib/swing/play-brief-lane-rank.ts`) split WATCH-lane peers from open-position peers by reading `HorizonPlay.status` (`"COMMIT"|"WATCH"`) directly, but `status` is the mechanical floor-gate result (`aboveFloor`, per `serving.ts`'s own `observablesFromHorizonPlay`), not a lifecycle field — a pre-entry candidate can legitimately carry `status: "COMMIT"` (score cleared the floor) while its real serving section is still `"WATCH"` (no trigger fired yet). Live repro, 2026-09-17: LITE (score 71, `status: "COMMIT"`/`serving: "WATCH"`) was the real leader of the 4-name WATCH lane (XOM 52.7, TSM 49.6, AAPL 25.5, LITE 71) but was silently dropped from every peer's rank pool — XOM's brief called itself "Lane leader — #1 of 3" and AAPL's named XOM (52.7) as the leader, both wrong. LITE's own brief, unable to find its own row in the 3-peer `sorted` array, fell back to `rank = sorted.length + 1` then got clamped by `Math.min(rank, sorted.length)` down to a confidently-wrong "#3/3 Top-tier setup."
- **What changed:** `rowInBucket` now reads `HorizonPlay.liveStatus` (`"OPEN"|"HOLD"|"TRIM"` when genuinely live, else absent) instead of `status` — the same authoritative live-vs-pre-entry signal `sectionForSwingPlay` itself uses. No change to rank/median/leader math, only to which rows are admitted as peers.
- **RTH check:** pull `GET /api/market/nighthawk/horizons?view=swings` and identify the current WATCH lane's real high-score name (may differ from XOM/TSM/AAPL/LITE by the time this is checked); then pull that name's own Ask Largo play-brief "Lane rank"/"Trade manager read" section and confirm it names itself the leader (or correctly ranks against the true full peer set) rather than a lower-scored candidate whose `status` happens to still read `"WATCH"`. Confirm this only after the merge (`8450e90dd`, 2026-09-17 ~16:04 UTC) has actually deployed to ECS — check `GET /api/health` or response headers for a fresh build stamp before treating a still-wrong live read as a regression rather than deploy lag.

### 255. Ask Largo "Desk says TRIM" bullet never disclosed the real reason for 5 of 6 manage rungs — fix/trim-reason-clause-non-profit-rungs — 2026-09-17

- **What was broken:** `tradeManagerNarrativeSection`'s TRIM branch (`src/lib/swing/play-brief-narrative.ts`) always rendered purely mechanical trim-ladder rail text ("Desk says TRIM — next rail at +100%") regardless of which of `manage.ts`'s six TAKE_PARTIAL rungs actually fired (`catalyst_shift`, `regime_shift`, `profit_ladder`, `flow_decay`, `rel_strength_loss`, `vol_collapse`) — only `profit_ladder` is actually about the rail. Live repro, 2026-09-17, three real open positions simultaneously: CRWD SWING:CRWD:39 (`manageReason` `catalyst_shift`, +39.2% peak/-16.3% now) and AAPL SWING:AAPL:38/:37 (`manageReason` `rel_strength_loss`, neither ever above +18.6% peak) all rendered the rail-only line though none had ever been within 60+ points of +100% — the real driver was never disclosed anywhere in the section whose whole purpose is to state the desk's reasoning. Same defect class as the already-fixed SELL-side `sellReasonClause` (FINDINGS 2026-09-10) — TRIM never got the equivalent fix.
- **What changed:** added `trimReasonClause(reason)`, mirroring `sellReasonClause`'s shape/wording for `catalyst_shift`/`regime_shift` and reusing `manage.ts`'s own reason text for `flow_decay`/`rel_strength_loss`/`vol_collapse`, wired ahead of the existing rail clause so both compose (e.g. "Desk says TRIM — catalyst shifted against the thesis — next rail at +100%."). `profit_ladder` and undefined reasons get no extra clause — the rail text alone still explains those correctly, unchanged.
- **RTH check:** during a live session, find a WATCH/OPEN swing play whose `manageAction` is `TAKE_PARTIAL` with a non-`profit_ladder` `manageReason` (`GET /api/market/nighthawk/horizons?view=swings`, check each play's raw `manageReason` field — CRWD/AAPL positions from this repro may have since closed or changed reason) and pull its Ask Largo play-brief "Trade manager read" section — confirm the "Desk says TRIM" bullet now names the real reason (catalyst/regime/flow/relative-strength/vol) rather than only the untouched profit rail. Confirm only after this merge has deployed to ECS (same deploy-lag caveat as #254 above — check for a fresh build stamp first).

### 256. R:R display rounded up across its own quality-label/color threshold — fix/0dte-rr-display-rounding-boundary — 2026-09-17

- **What was broken:** five command-deck call sites render a play's Risk:Reward ratio via `rrRatio.toFixed(1)` (round-to-nearest) while separately deriving a text quality label or a color class from the SAME raw, unrounded `rrRatio` against threshold ladders at 0.5/1/2. A value just under a threshold (e.g. `0.96`) displayed as the threshold itself ("1.0") while the label/color still read the true lower bucket — e.g. "1.0:1 (acceptable)" beside a ladder where 1.0 is the "favorable" cutoff. The live 0DTE-member-facing instance is `ZeroDteCommandPanel.tsx` (the actual render path for every `horizon === "ZERO_DTE"` play — `PlayTerminal.tsx`'s `ZeroDtePreEntryContext`, the location a cross-lane handoff from the Legacy lane originally named, turned out to be currently unreachable for 0DTE, since `commandSinglePanel` routes ZERO_DTE straight past it). Two more instances share the same shape in `PlayTerminal.tsx`'s other R:R rows and `LegacyPlayDetailPanel.tsx`.
- **What changed:** all five sites now floor to 1 decimal before formatting (`Math.floor(rr * 10 + 1e-9) / 10).toFixed(1)`) instead of rounding to-nearest — the exact pattern already shipped in `deterministic-edition.ts` (PR #4813) for the same bug shape in Legacy's thesis-text R:R line. Label/color logic (which already read the raw, correct value) is untouched.
- **RTH check:** during a live session, pull any 0DTE play's Terminal detail panel whose `rrRatio` sits just under a whole/half-point boundary (e.g. 0.9x, 1.9x — check `GET /api/market/zerodte/board`'s `plays[].rr_ratio` if exposed, or watch the panel directly for a play near those values) and confirm the printed Risk:Reward number never reads at-or-above a threshold its own color class doesn't also cross (e.g. never shows "2.0:1" in a non-green color).

### 257. Ask Largo swing play-brief never surfaced live per-position greeks, despite the identical data already rendering on the Command Deck — fix/swing-play-brief-live-greeks — 2026-09-18

- **What was broken:** `TerminalPlay.greeks` (delta/gamma/theta/vega/iv) is a real, live per-contract greek read for every open swing position — the active-refresh cron fetches it on every tick and `terminalPlayFromHorizon` (adapters.ts) already builds `play.greeks` from it for the Command Deck's own greek strip (FINDINGS 2026-08-06 SEV-3). But `pnlSection` in `play-brief.ts` — Ask Largo's own consumer of the exact same `TerminalPlay` object — never read `play.greeks` anywhere: a member asking Largo "what's my theta decay / delta exposure on this position" got nothing, even though the identical live numbers already render one click away on the deck. Same wiring-gap shape as the already-shipped #4101 `unavailableSources` fix.
- **What changed:** added a "Greeks" line to `pnlSection`'s Position section (OPEN bucket only), formatted to match `PlayTerminal.tsx`'s exact `fmtGreek` convention (signed delta/gamma/vega, unsigned theta, IV as rounded whole-percent) so a member cross-referencing the deck and Largo never sees the same number rendered two different ways. Gated purely on `if (play.greeks)` — `greeksFromContract` already only returns non-null when a field is real, so no new absence plumbing was needed. Did NOT wire up `computeSwingRisk` (a separate, unused dollar-risk engine found during the same audit) — that needs new plumbing, left as a follow-up.
- **RTH check:** during a live session, pull an OPEN swing position's Ask Largo play-brief (`GET /api/market/swing/play-brief`) and confirm the Position section now shows a "Greeks:" line whose delta/gamma/theta/vega/IV values match the same position's Command Deck greek strip exactly (same signs, same rounding) — and that a position with no live greek quote (e.g. after-hours/stale) omits the line entirely rather than showing stale or fabricated values.

### 258. Ask Largo swing WATCH brief's top-level "Invalidation" line showed a moot gate reason on a dead entry window — fix/swing-watch-invalidation-moot-gate — 2026-09-18

- **What was broken:** `composeSwingPlayBrief`'s top-level `envelope.invalidation` (the `**Invalidation:**` evidence-block line) fell straight from the `thesisBreak.level === "break"` check to `play.gateBlocks?.[0]?.reason` with no check for `deadPlayReason(play)` (entry already `INVALIDATED` or `watchEntryExpired`) — the same root cause already fixed twice elsewhere in the same file/module (`watchEntrySection`'s "Also gate-blocked (moot — ...)" header, 2026-09-14; `entryTriggerDeadReason`'s "Entry trigger" line, 2026-09-17), just never applied to this third call site. Live repro: MU WATCH brief, 2026-09-17/18 — headline correctly read "EXPIRED — wait for a fresh setup" and the Entry section correctly labeled its gate "(moot — entry-validity window expired)", but the same brief's top-level Invalidation line still read "Trading-halt feed unavailable — desk will not open until halt/LULD data recovers" — the moot gate, unqualified, as if clearing it would reopen entry.
- **What changed:** added `dead = bucket === "watch" ? deadPlayReason(play) : null`, checked ahead of `resolveBreakInvalidation(ctx)`/the gate-reason fallback; when set, invalidation now reads `"Entry-validity window expired — this setup is no longer live."` (or the invalidated-thesis equivalent) instead of a real technical level or the moot gate text. Scoped to `bucket === "watch"` only — OPEN/CLOSED invalidation logic untouched.
- **RTH check:** during a live session, find a WATCH swing candidate whose entry window has expired or thesis is `INVALIDATED` (`GET /api/market/nighthawk/horizons?view=swings`, look for `watchEntryExpired: true` or `setupState: "INVALIDATED"` — MU itself may have re-qualified with a fresh setup by the time this is checked) and pull its Ask Largo play-brief (`GET /api/market/swing/play-brief`). Confirm the top-level `**Invalidation:**` line reads "Entry-validity window expired — this setup is no longer live." (or the invalidated-thesis wording), not a raw gate-block string like a halt-feed/regime/cortex reason.

### 259. Ask Largo swing play-brief never warned before an automatic roll executes, despite the exact signal being computed every tick — fix/swing-roll-candidate-advisory — 2026-09-18

- **What was broken:** `manage.ts`'s `evaluateSwingManagement` always computes `dteMigration`/`rollIntent` (theta decaying faster than thesis progress inside the lane's migration-DTE window — the exact pre-roll signal `roll.ts`'s live executor itself acts on) and `manage-sync.ts` persists both into every snapshot's `event_json`. But `live-plays.ts`'s `manageObservablesFromEvent` — the sole reader of that event_json — never extracted either field, only `action`/`rung`/`thesis_state`. A position already flagged as an active roll candidate gave a member zero advance warning; the Command Deck has no UI for it either, and the brief's only roll disclosure (`rollLine`) cites past, already-executed rolls, never a live upcoming one. Same wiring-gap shape as the already-shipped #5161 greeks fix.
- **What changed:** threaded a new optional `rollCandidate: {reason} | null` field end-to-end (`live-plays.ts` extraction → `horizon-plays.ts`/`adapters.ts`/`types.ts` → `play-brief-resolve.ts` → `play-brief.ts`'s Management section, new "Roll watch" line), gated on `roll_intent.roll===true` AND a real string `dte_migration.reason` — malformed/partial shapes degrade to `null`, never a fabricated candidate. Surfaces `dte_migration.reason`'s clean prose rather than `roll_intent.reason`, which still carries a stale pre-PR-15 internal note ("INTENT ONLY; execution deferred to PR-15").
- **RTH check:** during a live session, find an OPEN swing position genuinely inside its migration-DTE window with theta outpacing thesis progress (check `manage_events`/the position's live manage snapshot for `roll_intent.roll===true` if directly inspectable, or watch for one to develop) and confirm its Ask Largo play-brief Management section now shows a "Roll watch: **theta outpacing thesis**" line before the roll actually executes — not just after, via the existing roll-history disclosure.

### 260. Ask Largo swing WATCH brief never disclosed the entry-validity deadline while the setup was still live — fix/swing-watch-entry-deadline — 2026-09-18

- **What was broken:** `entry-enterability.ts`'s `evaluateSwingEntryEnterability` always computes the real entry-validity deadline (`entryDeadlineMs`, entry-model.ts's sub-lane windows, real-NYSE-trading-day aware) purely to derive the `watchEntryExpired` boolean — the concrete timestamp was then discarded, never reaching `TerminalPlay` or the brief. A member watching a still-live WATCH position had no forward-looking answer to "how much longer is this entry window good for"; the first they'd hear of the deadline was the EXPIRED badge itself, after it had already passed. A direct Largo Contract C1 ("time") violation, mirroring the section's own existing backward-looking "First flagged N days ago" line.
- **What changed:** added `deadlineIso?: string | null` to `SwingEntryEnterability`, computed once and attached to EVERY return branch (not just the expired one) — honest null when neither `entryDeadline` nor a resolvable `anchoredAt`+sub-lane fallback exists. Threaded through `TerminalPlay.entryDeadline` and rendered in `watchEntrySection` as a new line, shown only while NOT already expired and only when a real deadline resolved: "Entry window closes **\<ET date\>** (**N days** left) — stale after that, wait for a fresh setup."
- **RTH check:** during a live session, pull a WATCH swing candidate that has not yet expired (`GET /api/market/nighthawk/horizons?view=swings`, look for `watchEntryExpired: false/absent` with a live setup) and confirm its Ask Largo play-brief now shows an "Entry window closes" line with a real future ET date and days-left count, consistent with the same candidate's entry-validity window — and that an already-EXPIRED candidate does NOT show this line (only its existing EXPIRED badge/moot-gate disclosure).

### 261. Ask Largo swing brief's "Lessons" section restated the same trim-rail/stop-loss advice "Trade manager read" already gave — fix/swing-lessons-advice-dedup — 2026-09-18

- **What was broken:** on CLOSED positions, `lessonsSection` (play-brief-intel.ts) and `closedCoaching` (play-brief-narrative-coaching.ts, feeds "Trade manager read", rendered immediately above "Lessons" in the same response) both independently derive the same round-trip/stop-loss facts from the same peak/exitPnlPct/closedReason inputs. A prior fix (`roundTripAlreadyNoted`) deduped the round-trip FACT sentence when both sections would otherwise state it, but the ADVICE clause attached to it and the sibling stop-loss advice were never covered — surviving under the exact mechanism meant to prevent this restatement class. Live repro, NN position #32 (real production, CLOSED/STOPPED, peak +24.4%, exit -60.3%): "Trade manager read" said "...tighten at first trim rail next time." + "...check if entry was extended past invalidation."; "Lessons" right below independently restated "Gave back the move — next time tighten at first trim rail or thesis fade." + "Stop loss — check if invalidation level was respected or entry was extended."
- **What changed:** extended `lessonsSection`'s existing dedup pattern with two new optional flags, `adviceAlreadyNoted`/`stopAdviceAlreadyNoted`, computed at the `buildIntelSections` call site by checking whether `narrative.body` already contains the matching advice text — same technique as the existing `roundTripAlreadyNoted`. Suppresses only the two duplicated advice sentences; every independent lesson (MFE capture number, exit-discipline verdicts, archetype tag, exec-vs-mid slippage) is untouched.
- **RTH check:** during a live session, pull a CLOSED swing position's Ask Largo play-brief whose exit was a round-trip-past-breakeven or a stop-out (`GET /api/market/swing/record`'s `closedDeck`, filter for `closedReason: "stopped"` or a peak/exit pattern consistent with a round-trip) and confirm "Trade manager read" and "Lessons" no longer both state the identical trim-rail or stop-loss advice — each independent lesson (MFE capture %, archetype tag) should still appear in "Lessons" as before.

### 262. Ask Largo swing brief's "Catalysts & news" headlines carried no freshness disclosure, unlike every sibling freshness-aware section — fix/swing-catalysts-news-freshness — 2026-09-18

- **What was broken:** `NewsResult.asOf` (polygon-news.ts) is stamped once, at true fetch time, inside `serverCache`'s cached builder — under that cache's stale-while-revalidate path a degraded Benzinga upstream can keep serving the same stored headline list (and its un-bumped `asOf`) for up to `MAX_STALE_AGE_MS` (10 minutes, server-cache.ts), the identical exposure `meridianCatalystStale`/`meridianCatalystSection` already document and guard for the sibling Meridian catalyst read. That field was computed correctly upstream but silently dropped one layer up, in `assembleEcosystemArsenal` (ecosystem-context.ts), when folding the raw `NewsResult` into `EcosystemArsenalNews` — the type only carried `count`/`newest`/`headlines`, never `asOf`. So `catalystsSection` (play-brief-intel.ts), the sole consumer of `headlines`, had no way to ever disclose staleness, unlike every other freshness-aware section in the same file (GEX, Vector, Meridian).
- **What changed:** added `as_of?: string | null` to `EcosystemArsenalNews`, populated from `reads.news.asOf` in `assembleEcosystemArsenal`; added `newsCatalystAgeMs`/`newsCatalystStale` (play-brief-absence.ts), structurally identical to the existing `meridianCatalystAgeMs`/`meridianCatalystStale`; `catalystsSection` now prepends a `**Last snapshot** (~Xs old) — headlines may lag.` line when stale, at the same `GEX_MATRIX_STALE_MS` (120s) threshold every other freshness check in the file uses. `as_of` is optional so an older/hand-built fixture without the field degrades to "unknown, not stale" rather than a false positive.
- **RTH check:** during a live session, pull a swing play-brief for a ticker with recent news coverage (`GET /api/market/swing/play-brief`) and confirm the "Catalysts & news" Headlines block shows no staleness disclosure when the news read is fresh, and DOES show a "Last snapshot (~Xs old)" line if the same ticker's news happens to be served from a stale cached read during a Benzinga degradation window — cross-check against CloudWatch for any Benzinga fetch errors/timeouts in the same window to confirm the staleness (if triggered) reflects a real degraded upstream, not a false positive.

### 263. Ask Largo swing "Book context" rendered two distinct Banger-engine siblings on the same ticker as identical, indistinguishable text — fix/swing-banger-sibling-disambiguation — 2026-09-18

- **What was broken:** `formatOverlapPosition`'s 2026-09-15 fix disambiguates a same-ticker book-overlap sibling from the reviewed play (a swing-native sibling cites its own `positionId`; a cross-engine/Banger sibling — which deliberately never carries `positionId`, per `loadOpenBook`'s DB-id-collision note — got a generic "(separate, cross-engine position)" tag) but only ever considered ONE such cross-engine sibling existing at a time. Live repro, CRWD:39's own brief today: TWO real, independently-committed Banger CRWD LONG positions both rendered the identical bare tag in the same concentration list — reading exactly like the duplicate-counting defect the 2026-09-15 fix was written to prevent, even though the underlying count (2) was completely honest. Traced the apparent contradiction with the board display (`GET /api/market/nighthawk/horizons?view=swings` showed zero other CRWD rows): the board's own Banger merge (`horizonPlayFromBangerPosition`) applies a DTE display window that book-context's read (`fetchBangerOpenBookRows`, no DTE filter) does not — both real, different purposes, not a bug in either.
- **What changed:** added `bangerId?: number` to `PortfolioPosition` (portfolio.ts) — a NEW field, deliberately not a reuse of `positionId` (which must stay unset on banger rows to avoid the documented cross-table id-collision risk in `checkPortfolioOverlap`'s exclude logic; `bangerId` is never read by that matching code). `loadOpenBook` now threads the real `banger_positions.id` into it; `formatOverlapPosition` renders `(separate, cross-engine position #<bangerId>)` when known, falling back to the original bare tag only when unavailable.
- **RTH check:** during a live session, find a swing play whose book overlap includes 2+ Banger-engine positions on its OWN ticker (rare — requires a member/desk to hold multiple independent Banger bets on the same name at once; may not currently exist if CRWD's second sibling has since closed or aged past its own display/holding window) and confirm its Ask Largo "Book context" concentration line cites each cross-engine sibling with its own distinct `#<bangerId>`, not the identical bare tag twice.

### 264. Ask Largo swing brief's CLOSED "Lessons" section never disclosed the position's own worst intra-trade drawdown, despite the identical trough data already used for the OPEN-bucket equivalent — fix/swing-closed-drawdown-coaching — 2026-09-18

- **What was broken:** `play.trough` (the position's own worst intra-trade excursion) is computed unconditionally in adapters.ts for every row with entry+trough premium, CLOSED rows included via `terminalPlayFromClosedSwing`. But it never reached any section of a CLOSED Ask Largo brief — `closedCoaching` (play-brief-narrative-coaching.ts, the real "Lessons" narrative for CLOSED positions) only ever cited `play.peak`, never `play.trough`. The gap was self-camouflaging: the sibling `troughResilienceCoaching` function (OPEN bucket, 2026-09-15) carried its own doc comment explicitly claiming "a CLOSED play's own 'Lessons' section already covers post-mortem framing for that bucket, and this isn't meant to duplicate it" — a claim that was never actually true, and made the gap read as already-handled to anyone trusting the comment.
- **What changed:** added a "Drawdown before outcome" line to `closedCoaching`, gated identically to `troughResilienceCoaching`'s existing threshold (trough < 0 AND peak-trough >= 40 points) — never fires on a shallow or non-negative excursion. Also corrected the false claim in `troughResilienceCoaching`'s own doc comment.
- **RTH check:** during a live session, find a CLOSED swing position whose peak-to-trough excursion cleared 40 points with a real negative trough (`GET /api/market/swing/record`'s `closedDeck`) and confirm its Ask Largo play-brief's "Lessons" section now shows a "Drawdown before outcome" line with the trough % and exit %, consistent with the position's own recorded numbers — and that a position with a shallow/non-negative trough does NOT show this line.

### 265. Ask Largo swing brief's shared "is this gate text moot?" check missed 2 of 4 dead-entry states, letting a WATCH brief imply clearing a gate would reopen entry when it wouldn't — fix/swing-entry-enterability-dead-states — 2026-09-18

- **What was broken:** `deadPlayReason` is the shared check 4 Largo-facing renderers gate on to avoid implying "clearing this gate reopens entry" for a WATCH play whose entry mechanics are already moot. `evaluateSwingEntryEnterability`'s real engine can return `dont_buy` for 4 distinct dead-entry states (INVALIDATED, deadline-expired, contract-expired, extended-chase), but `deadPlayReason` only ever recognized the first two — `entry-verdict.ts`'s own comment already documented that gate evidence stays populated for all 3 non-invalidated dead reasons, but the shared moot-check was only ever updated for 2 of them.
- **What changed:** extended `deadPlayReason` with two more checks matching the existing pattern: `entryStatus === "EXPIRED"` → "contract expired"; `setupState === "EXTENDED" || entryStatus === "EXTENDED_CHASE"` → "extended past the valid entry window". Single function fix propagates to all 4 consumers (`watchEntrySection`, the top-level Invalidation callout, `entryTriggerDeadReason`, `gateBlockCoaching`) without touching any of them.
- **RTH check:** during a live session, find a WATCH swing candidate whose contract has expired or whose setup ran EXTENDED_CHASE (`GET /api/market/nighthawk/horizons?view=swings`, look for `entryStatus: "EXPIRED"` or `setupState: "EXTENDED"`/`entryStatus: "EXTENDED_CHASE"`) and pull its Ask Largo play-brief. Confirm the "Gates blocking entry" header and top-level Invalidation line both now qualify the gate as moot ("contract expired"/"extended past the valid entry window"), not an un-qualified gate reason implying entry would reopen if cleared.

### 266. Ask Largo swing brief's stop rail carried a live room% but the symmetric target/upside rail was only ever a bare dollar figure — fix/swing-target-rail-room-disclosure — 2026-09-18

- **What was broken:** `watchForSection`'s stop-cushion block (OPEN bucket) quantifies "how far the current mark could still fall before hitting the stop" as a percentage — mark/execMark-preferring, staleness-gated, with three prior live-repro fixes (2026-09-12 x2, 2026-09-14) making it increasingly correct. `exitPolicy.target_premium` (the symmetric upside rail, equally real and already computed) never got the equivalent treatment — confirmed by exhaustive grep across the whole narrative layer, it only ever appears as a bare dollar figure in "Rails: stop X · target Y" (Management section) and "Manage rails" (Trade manager read), forcing a member to do the exact distance subtraction the stop-cushion fix's own comment names as the reason it was added.
- **What changed:** added a symmetric "Premium target rail" line, deliberately mirroring the stop block's exact basis/gating logic (execMark preferred over mid, gated on `!optionMarkGenuinelyUnknown`) rather than reinventing it. Omitted (never negative/zero) once the basis has already reached or passed the target.
- **RTH check:** during a live session, pull an OPEN swing position's Ask Largo brief with a known `exitPolicy.target_premium` (`GET /api/market/swing/play-brief`) and confirm "What to watch" now shows a "Premium target rail: $X — Y% move still needed from current mark/bid to reach target" line alongside the existing "Premium stop rail" line, with the percentage consistent with the position's own recorded mark/execMark vs target — and that a position whose mark has already reached/passed its target correctly omits the line rather than showing a negative percentage.

### 267. Ask Largo swing brief never disclosed how thin the evidence read was at commit, despite the identical fact already surfacing pre-entry on WATCH candidates — fix/swing-entry-present-pillars — 2026-09-18

- **What was broken:** `dossier.ts`'s `SwingDossier.dataQuality` (`presentPillars`/`degraded`, computed honestly at commit from the 7 evidence pillars) gets pinned into every committed position's `feature_vector.present_pillars`/`dq_degraded` columns, but was never read back out anywhere in the serving/brief layer for an already-committed OPEN or CLOSED position. A pre-entry WATCH candidate's identical read already surfaces as a "thin read — N/7 pillars grounded" thesis-health note the instant it degrades — a member sees it before committing. Once committed, that same fact silently disappears: neither `livePlayFromSwingPosition` nor `closedDeckSourceFromRow` ever read the two sibling columns sitting right next to `evidence_score`, which they already read.
- **What changed:** threaded a new `entryPresentPillars` field end-to-end (`live-plays.ts`'s new `entryPresentPillarsFromFeatureVector` helper → `closed-plays.ts` → `horizon-plays.ts`/command-deck types+adapters → `play-brief-resolve.ts` → `whyThisSetupSection`'s new "Evidence at entry: thin read — N/7 pillars grounded" line), gated on the same `dataQuality.degraded` threshold the pre-entry WATCH note already uses — silent on the overwhelming common case of a healthy entry, never fabricated.
- **RTH check:** during a live session, find an OPEN or CLOSED swing position that was committed off a genuinely thin evidence read (`feature_vector.dq_degraded === 1` if directly inspectable, or one flagged "thin read" on its own WATCH history before commit) and confirm its Ask Largo play-brief's "Why this setup" section now shows an "Evidence at entry: thin read — N/7 pillars grounded" line — and that a normally-grounded entry does NOT show this line.

### 268. Ask Largo swing brief silently dropped that the entry-time archetype classification was a razor-thin call, despite the classifier already computing and pinning the runner-up + margin — fix/swing-archetype-near-tie — 2026-09-18

- **What was broken:** `classifyArchetype` (`archetype.ts`) always computes a decisiveness `margin` (topFit − secondFit) alongside the winning archetype label, and its own tie-break logic (`MARGIN_EPS = 0.05`) treats anything within that margin as a near-coin-flip resolved only by archetype priority order, not by evidence. `classificationMetaFromVerdict` pins that margin plus the ranked runner-up archetypes onto every committed position's `feature_vector.classification_margin`/`feature_vector.secondary` columns (`commit.ts`, `discovery.ts`) — sitting right next to `evidence_score` and `present_pillars`, both of which the brief already reads off the same pinned feature vector. Nothing in the serving/brief layer ever read `classification_margin`/`secondary` back out. A member sees only `**Archetype:** Breakout continuation` with zero signal that the classifier's own math called it a near-tie against, e.g., Pullback continuation — which matters because scoring/gating/calibration all partition on that single pinned label (feature-vector.ts's own header: "Calibration keys off `archetype`/`primary` ONLY").
- **What changed:** threaded a new `archetypeNearTie` field end-to-end (`live-plays.ts`'s new `archetypeNearTieFromFeatureVector` helper, mirroring the existing `entryPresentPillarsFromFeatureVector` "only-when-it-matters" pattern → `closed-plays.ts` → `horizon-plays.ts`/command-deck types+adapters → `play-brief-resolve.ts` → `whyThisSetupSection`'s new "Classification: near-tie at entry — **X** beat **Y** by only N pts" line), gated on the classifier's own `MARGIN_EPS` (mirrored locally as `ARCHETYPE_NEAR_TIE_MARGIN` since archetype.ts's constant is module-private) — silent on the overwhelming common case of a decisive classification, never fabricated (additive per the Largo product contract).
- **RTH check:** during a live session, find an OPEN or CLOSED swing position whose entry-time archetype classification was genuinely close (check `feature_vector.classification_margin` if directly inspectable, or look for a ticker whose thesis narrative reads ambiguous between two archetypes) and confirm its Ask Largo play-brief's "Why this setup" section now shows a "Classification: near-tie at entry" line naming the runner-up and margin — and that a normal, decisive classification shows nothing extra.

### 269. Ask Largo swing brief never disclosed whether the held contract strike actually matched the flow signal that originally flagged the name — fix/swing-top-flow-provenance — 2026-09-18

- **What was broken:** `rankSwingContracts` (`contract-ranker.ts`) always independently picks the best contract by tradability × thesis-fit — deliberately never influenced by the multi-day flow accumulation's magnet strike (`topFlowStrike`) — but separately, AFTER the pick, computes `topFlowWasPicked`: whether the independently-chosen strike happens to coincide with the flow's magnet strike. `commit.ts:547` pins the raw `top_flow_strike` (not the derived boolean) onto every committed position's `SwingPositionRow` (`db.ts:2112`, a real, permanent column) alongside `contract_strike` — both real, honest facts about provenance: is the contract you're holding the exact strike flow was piling into, or a different one? Nothing in the serving/brief layer ever read `top_flow_strike` back out. Repo-wide grep confirmed zero hits in `live-plays.ts`, `closed-plays.ts`, `play-brief*.ts`, `adapters.ts`, or `types.ts` prior to this fix — the field lives outside `feature-vector.ts` entirely (a direct DB column on the position row), which is likely why the two prior "pinned at commit, never surfaced" rounds (present_pillars, classification_margin) missed it, since both of those specifically grepped the feature-vector schema.
- **What changed:** threaded a new `topFlowProvenance` field end-to-end (`live-plays.ts`'s new `topFlowProvenanceFromRow` helper, recomputing `matchedPick` from the two pinned values since no second persisted boolean exists → `closed-plays.ts` → `horizon-plays.ts`/command-deck types+adapters → `play-brief-resolve.ts` → `whyThisSetupSection`'s new "**Strike vs flow:**" line). Unlike the degraded-only gate on `entryPresentPillars`, this line renders on BOTH match (genuine corroboration) and divergence (a genuine, disclosed disagreement worth surfacing) — only silent when either strike is unknown (honest null, never a guessed provenance). Gated to the root leg only (`roll_seq === 0`) — a roll re-runs the ranker fresh against the current chain while `top_flow_strike` stays pinned to the original commit, so comparing the two on a rolled leg would misleadingly read as an entry-time disagreement when it's really just a later roll's independent pick (flagged in peer review on the PR, fixed before merge).
- **RTH check:** during a live session, find an OPEN or CLOSED swing position and confirm its Ask Largo play-brief's "Why this setup" section now shows a "Strike vs flow" line — either confirming the held strike matches the flow magnet strike, or naming the divergence when it doesn't. Confirm the line is honestly absent (not fabricated) on any position where the flow magnet strike was never resolved, and absent on any rolled leg (`roll_seq >= 1`) regardless of what the raw strikes would say.

### 270. Ask Largo swing brief's archetype near-tie line (#268, same day) fabricated a "winning archetype" claim for a position the classifier never classified — fix/swing-archetype-near-tie-null-archetype — 2026-09-18

- **What was broken:** #268's new "Classification: near-tie at entry" line fell back to literal text `"the winning archetype"` whenever `play.archetype` was null — a real, reachable state (`classifyArchetype`'s thin-evidence branch returns `archetype: null` while still computing a real `margin`; a live example is NN positionId 32, a real CLOSED position). Worse, `classificationMetaFromVerdict`'s `secondary = ranked.filter(a => a !== v.archetype)` is a no-op when `v.archetype` is null, so `secondary[0]` becomes the would-be top-fit archetype itself, not a genuine runner-up. Combined, a thin-evidence/unclassified position whose margin fell in the near-tie band rendered "near-tie at entry — **the winning archetype** beat **X** by only N pts" with no preceding "Archetype:" line to anchor it — fabricating a decisive-classification claim for a position that was explicitly never classified.
- **What changed:** two-layer fix. `archetypeNearTieFromFeatureVector` (live-plays.ts) now requires `feature_vector.archetype` to be a real non-empty string before computing anything (closes the gap for every consumer, OPEN and CLOSED alike). `whyThisSetupSection` also now requires `whyArchetypeLabel` truthy before rendering the line, and drops the `?? "the winning archetype"` fallback entirely (defense in depth).
- **RTH check:** during a live session, find a CLOSED or OPEN swing position with `archetype: null` (e.g. re-check NN or any other thin-evidence commit via `GET /api/market/swing/record`) and confirm its Ask Largo play-brief's "Why this setup" section shows NO "Classification:" line — and that a position with a real archetype and a genuine near-tie margin still shows the line correctly (per #268's own RTH check).

### 271. Ask Largo swing brief never surfaced how far the underlying itself has run favorable/adverse since entry, despite it being computed and pinned on every management tick — fix/swing-underlying-excursion — 2026-09-18

- **What was broken:** `signedExcursionPct` (`manage-sync.ts`) computes the underlying's own signed, direction-aware favorable/adverse excursion (%) since entry on every management tick for every live swing position, and `manage-sync.ts` writes it as dedicated `running_mfe`/`running_mae` columns (NOT inside `event_json`) on the append-only `swing_position_snapshots` table (`db.ts:2303-2304`). But `fetchLatestSwingSnapshotEvents` — the only function reading the latest snapshot back out for serving — selected only `position_id, event_json, thesis_state`, leaving `running_mfe`/`running_mae` unselected despite sitting on the exact same row. So this real, per-tick-computed signal never reached `manageObservablesFromEvent`, never reached `livePlayFromSwingPosition`, and never reached a single Ask Largo brief — even though it answers a question genuinely distinct from the option-premium peak/P&L already shown: how far has the UNDERLYING itself moved in the member's favor or against them since entry, separate from premium effects (a position can sit on modest premium P&L while the underlying quietly ran hard favorable and gave most of it back, or the reverse under IV effects). Confirmed via grep this field appears nowhere else in `src/components`/`src/app` either — only consumed by `feature-store.ts`'s offline trajectory studies.
- **What changed:** added `running_mfe`/`running_mae` to `fetchLatestSwingSnapshotEvents`'s SELECT (merged into the event map only when non-null), threaded a new `underlyingExcursion` field end-to-end (`live-plays.ts`'s `manageObservablesFromEvent` extracting `{ mfePct, maePct }`, honest-null unless BOTH are finite — never a half-populated excursion → `horizon-plays.ts`/command-deck types+adapters → `play-brief-resolve.ts` → `managementSection`'s new "Underlying excursion since entry" line). Deliberately OPEN-only (`terminalPlayFromHorizon`) — a CLOSED chain has no ongoing management tick, so it honestly carries no live excursion read.
- **RTH check:** during a live session, find an OPEN swing position with recorded management history and confirm its Ask Largo play-brief's Management section now shows an "Underlying excursion since entry" line with both a favorable and adverse read — and that the line is honestly absent on a position with no management snapshot yet (e.g. freshly committed, first tick not yet run).

### 272. Ask Largo swing brief showed un-graduated manage-engine recommendations with the same visual weight as hard, acted-on capital-preservation gates — fix/swing-manage-enforced — 2026-09-18

- **What was broken:** `evaluateSwingManagement` computes `verdict.enforced` on every management tick (`manage.ts`): always `true` for the four capital-preservation GATE rungs (`structural_stop`/`thesis_stop`/`expiry_risk`/`premium_stop`), but `false` for every EDGE rung (`catalyst_shift`/`regime_shift`/`flow_decay`/`rel_strength_loss`/`vol_collapse`/`time_stop`/`add_eligible`) until that specific rung graduates in the PR-16 calibration ladder (n≥10, delta≥15pt). `manage-sync.ts` persists this onto every snapshot's `event_json.enforced`, and `latchSwingLiveStatus` only actually moves the ledger to TRIM when `verdict.enforced && rung === "profit_ladder"` — the system genuinely takes no action on an un-graduated edge-rung signal. But `live-plays.ts`'s `manageObservablesFromEvent` (the sole reader of that snapshot's `event_json`) only ever extracted `action`/`rung`/`thesis_state`, never `enforced` — so `manageAction` was set to `TAKE_PARTIAL`/`EXIT`/`STOP_OUT`/`ADD` regardless of whether the deciding rung was enforced, and the brief's Management section showed "Manage engine: TAKE_PARTIAL" with the same visual weight as a hard, acted-on gate. Given the closed swing population's small size (documented in CLAUDE.md, ~31-37 trades, most calibration buckets nowhere near n≥10), most live edge-rung recommendations today are un-graduated/advisory-only — a direct violation of `manage.ts`'s own documented calibration-first law that the desk can SHOW a signal long before it's allowed to act on it, without telling the member the showing isn't the acting.
- **What changed:** threaded a new `manageEnforced: boolean | null` field end-to-end (`live-plays.ts`'s `manageObservablesFromEvent` reading `manageEvent.enforced` tri-state, force-set `true` inside the GATE override branches → `horizon-plays.ts`/command-deck types+adapters → `play-brief-resolve.ts` → `managementSection`'s new advisory-only note, appended only when `manageAction !== "HOLD" && manageEnforced === false`). Null (no snapshot yet) stays silent — honest absence, never a fabricated advisory label. Deliberately did NOT touch the wider command-deck `recommendationFromManageAction`/SELL-TRIM-BUY badge — that's a broader blast radius outside the Ask Largo brief's own scope; this fix qualifies only the brief's narrative text.
- **RTH check:** during a live session, find an OPEN swing position whose manage engine recommends a non-HOLD action off an edge rung (not one of the four capital-preservation gates) and confirm its Ask Largo play-brief's Management section now shows the advisory-only note — and that a position on a genuinely enforced gate (or a graduated edge rung) shows the recommendation with no such qualifier.

### 273. Ask Largo swing brief flattened a specific, already-computed sell reason (exact price level) to a generic "thesis broke" phrase — fix/swing-manage-reason-detail — 2026-09-18

- **What was broken:** `evaluateSwingManagement`'s `verdict.reason` (`manage.ts`) is computed every management tick with fully specific prose — e.g. `structuralStopBroken()` builds `"underlying ${comparePx} ≤ structural stop ${stop} — LONG thesis broken in underlying terms${adj}"` — and `manage-sync.ts` persists it verbatim onto every snapshot's `event_json.reason`. But `live-plays.ts`'s `manageObservablesFromEvent` (the sole reader of that `event_json`) only ever extracted `rung`/`action`/`thesis_state`, never `reason` — so the DB field was write-only. `play-brief-narrative.ts`'s `sellReasonClause`, for the two most important SELL reasons (`structural_stop`/`thesis_stop` — an actual thesis break, not a time-based force-manage), rendered only the hardcoded generic `" — thesis broke"`, discarding the exact price level and direction-specific detail the engine had already computed on the same tick. This is a narrative-QUALITY gap distinct from the prior six "field never surfaced" fixes this session — real, already-persisted specificity flattened to a canned phrase, the exact "reads like a bullet dump" category CLAUDE.md's mandate explicitly names.
- **What changed:** threaded a new `manageReasonDetail?: string | null` field end-to-end (`live-plays.ts`'s `manageObservablesFromEvent` reading `manageEvent.reason` → `horizon-plays.ts`/command-deck types+adapters → `play-brief-resolve.ts` → `sellReasonClause`'s new optional `reasonDetail` param, used for `structural_stop`/`thesis_stop`/the `default` fallback only when present, else the exact old generic text is kept unchanged as fallback). `trimReasonClause` and the other SELL rungs (`expiry_risk`/`premium_stop`/`catalyst_shift`/`regime_shift`/`time_stop`) deliberately left untouched — their existing canned wording is either intentionally member-clean or already specific.
- **RTH check:** during a live session, find an OPEN swing position whose manage engine fired a `structural_stop`/`thesis_stop` SELL and confirm its Ask Largo play-brief's trade-manager narrative now cites the specific underlying price/stop level rather than the bare generic "thesis broke" — and that a position with no persisted reason detail still shows the unchanged generic phrase (honest fallback, never fabricated).

### 274. Ask Largo swing brief's diff engine never narrated a position newly crossing into (or out of) roll-candidate territory, despite the signal already existing and being rendered statically — fix/swing-roll-candidate-diff-narration — 2026-09-18

- **What was broken:** `play.rollCandidate: { reason: string } | null` (a real, live per-tick signal set in `live-plays.ts`, computed by `manage.ts`'s roll-migration logic) is already rendered as a static "Roll watch" line in the Management section every refresh once present (#5163). But `play-brief-diff.ts`'s `BriefSnapshot`/`snapshotFromBrief` never read `play?.rollCandidate` at all, so a position crossing INTO roll-candidate territory — the manage engine newly weighing a roll, arguably the single most actionable live trade-manager fact there is — produced zero "What changed"/"Since last read" narration, even though the diff engine already narrates far less urgent things (a HELIX flow premium moving >$50k, a GEX wall drifting 5 cents, a trim rail firing). A member relying on the diff pulse (the whole point of `useSwingPlayBrief.ts`'s polling) would only ever notice a fresh roll watch by re-reading the entire static Management block on every poll — silently indistinguishable from "nothing changed."
- **What changed:** added `rollCandidateReason: string | null` to `BriefSnapshot`, populated from `play?.rollCandidate?.reason ?? null` in `snapshotFromBrief`, and two new EDGE-crossing rules in `diffBriefSnapshots` — "Roll watch triggered" (null→reason) and "Roll watch cleared" (reason→null). Deliberately does NOT narrate the reason merely restating tick-to-tick (still weighed, DTE ticking down inside the same window) — only the two genuine state transitions, matching the file's existing discipline (e.g. trims-fired only narrates on increase, never on an unchanged repeat). Post-open peer review flagged that the "cleared" line asserted a specific cause ("theta/thesis balance back in range") that isn't always true — `detectRollCandidate()` returns `roll:false` for two OTHER causes too (thesis broken, structural stop hit), both capital-preservation exits, not improvements; fixed by dropping the asserted cause entirely ("no longer being weighed") so it never contradicts the separate "Desk action shifted" line that narrates the real exit in the same pulse.
- **RTH check:** during a live session, find an OPEN swing position whose manage engine newly starts (or stops) weighing a roll between two consecutive polls and confirm the Ask Largo play-brief's diff pulse shows a "Roll watch triggered"/"Roll watch cleared" line — and that a position whose roll-candidate reason merely restates (still weighed, unchanged state) produces no extra diff line — and that a roll watch clearing alongside an EXIT (thesis broken/structural stop) never claims things "improved."

### 275. Ask Largo swing brief's "next trim" narration showed only percent-from-entry, never how close the live mark actually is to the next rung's dollar level — fix/swing-next-trim-distance — 2026-09-18

- **What was broken:** `buildTerminalExitLadder` (`terminal-ladder.ts`) computes `premium` — the ABSOLUTE per-contract dollar level each trim rung fires at (`entry × (1 + trigger_pct/100)`) — for EVERY `trim_levels` entry, fired or not, and `play-brief.ts` already reads it for FIRED rungs (the "Banked: 50% @ +100% ($4.20)" line). But `play-brief-narrative-coaching.ts`'s `manageLifecycleCoaching()` (the OPEN-bucket trim-ladder narration) only ever read `next.trigger_pct` for the UNFIRED next rung, never `next.premium`, and never compared either against `play.mark`. A member reading "next trim at +100%" had no way to tell whether that rung is 3 points or 60 points away from the position's CURRENT mark — only how far it is from entry, a materially different (and less actionable) framing once a position already carries an unrealized gain.
- **What changed:** `manageLifecycleCoaching()`'s not-yet-crossed "next trim" branch now appends a distance clause — e.g. `next trim at **+100%** — mark **$1.70**, needs **$2.00** (+18% from here)` — computed only when both `next.premium` and `play.mark` are finite/usable (never fabricated on a null/unsynced mark). The "already cleared, not yet banked" branch is deliberately untouched — the distance figure is moot/negative there.
- **RTH check:** during a live session, find an OPEN swing position sitting on a partial gain, still HOLDing, with an unfired next trim rung ahead, and confirm its Ask Largo play-brief's Management coaching now shows the live dollar distance to that rung alongside the existing percent-from-entry framing — and that a position with a genuinely unsynced/null mark still shows the plain "next trim at +X%" with no fabricated distance figure.

### 276. Ask Largo swing brief's roll-history narration named WHAT was rolled but never WHY — the runway a roll exists to buy — despite the data sitting unread on every leg — fix/swing-roll-runway-disclosure — 2026-09-18

- **What was broken:** `SwingRollHistoryLeg.expiry` (`play-brief-types.ts`) is populated on every leg by `swingRollHistoryLegFromRow` (`play-brief-roll-history.ts`), but `rollHistoryLine()` (`play-brief-narrative.ts`) only ever read `strike`/`right` from the two legs it cites — `expiry` was never referenced. This matters specifically because `roll-plan.ts`'s own module header states the entire point of a roll in its first paragraph — "A ROLL BUYS TIME" — and `buildRollChild` hard-gates every live roll on `pick.dte > parentDte + buffer` specifically to guarantee a roll never goes flat or nearer. So the one property a roll is engineered to guarantee (more runway) was the one property the roll-history narrative never disclosed — it said WHAT strike/right the position moved to, never HOW MUCH extra time the move bought.
- **What changed:** added exported pure helper `rollRunwayExtensionDays(prevExpiry, currExpiry)` — parses two YYYY-MM-DD date-only strings (no ET-offset ambiguity, unlike `committedAt`), returns the calendar-day delta, null-honest on missing/unparseable input AND on a non-positive delta (a flat/backwards roll should never occur live given the gate above, but a defensive null floor never prints a fabricated or backwards claim). Wired into `rollHistoryLine()`: the roll sentence now reads e.g. "**Rolled once** — most recently from the $100 call to the $110 call on 2026-08-20, buying **35d** of extra runway." Clause simply omitted when the delta can't be computed — never fabricated.
- **RTH check:** during a live session, find an OPEN or CLOSED swing position that has rolled at least once and confirm its Ask Largo play-brief's trade-manager narrative now cites the extra runway days bought by the most recent roll alongside the existing strike/right/date disclosure — and that a chain with a leg missing an expiry (if one exists) still shows the plain roll sentence with no fabricated day count.

### 277. Ask Largo swing brief never disclosed a ticker's own prior trade history — every position read as if it were the desk's first time ever touching that name — fix/swing-ticker-track-record — 2026-09-18

- **What was broken:** `archetypeTrackRecordSection` (play-brief-intel.ts) already cites "how did trades in THIS ARCHETYPE do" via a cron-distilled cache, but that cache is explicitly not keyed by ticker, so it can never answer "has the desk traded THIS ticker before, and how did it go." A member reading a brief for, say, a third AAPL swing this quarter had no way to know from the brief itself that the desk has traded that exact name before — the Largo product contract's "historical context" point (C10) was fully served for the archetype dimension but completely absent for the ticker dimension. No existing DB query even answered "prior trades on this exact ticker" — `fetchSwingPositionsRange` is date-scoped, `fetchSwingPositionChain` is root-scoped, neither ticker-scoped.
- **What changed:** new `fetchSwingPositionsByTicker(ticker, limit)` DB query; new `play-brief-ticker-history.ts` module (`loadTickerTrackRecord`) — a plain, best-effort LIVE read (not a cron-distilled cache like the archetype section, since a single ticker's trade population is small enough to query per-request) that reuses `record.ts`'s own `selectSwingRecordRootIds`/`buildSwingRecord` chain-assembly logic so a rolled position collapses into ONE prior trade, never one per leg, and self-excludes the reviewed play's own chain. New `tickerTrackRecordSection` in play-brief-intel.ts renders "The desk has traded **AAPL** **3** times before this play: **2W / 1L** (67% win rate...)" — wired into `buildIntelSections` right after the archetype track record. Unlike the archetype section, this is a plain factual count with no statistical graduation gate (no calibrated score is being compared cross-product) — omission here means genuine absence of a resolved prior trade, never withheld-but-existing evidence.
- **RTH check:** during a live session, find an OPEN, WATCH, or CLOSED swing position on a ticker the desk has traded before (check `/api/market/swing/record`'s closed deck for repeat tickers) and confirm its Ask Largo play-brief now shows a "Ticker track record" section citing the correct prior-trade count and win/loss split — and that a position on a genuinely first-time ticker shows no such section (honest absence, never a fabricated "0 prior trades" line).

### 278. Ask Largo swing brief's diff engine never narrated a WATCH-candidate direction flip, despite `direction` being carried on every snapshot — fix/swing-watch-direction-flip — 2026-09-18

- **What was broken:** `BriefSnapshot.direction` was documented "not itself diffed (a play's direction doesn't change mid-life)" — true for a COMMITTED position, but false for a WATCH candidate: `TerminalPlay.id` for an uncommitted row is `${horizon}:${ticker}` with no `positionId` suffix (`adapters.ts` — positionId is only appended `if (src.positionId != null)`), so the SAME `play.id` persists across discovery cycles while `src.direction` (freshly derived each cycle from net-flow) can genuinely flip bullish↔bearish before ever being committed. `diffBriefSnapshots` is keyed by that stable `play.id`, so a real directional reversal on a WATCH ticker — arguably the single most material fact possible, since every other diffed field (thesis health, spot, walls) is only meaningful relative to a direction the diff engine was implicitly assuming stayed constant — was silently un-narrated by "What changed."
- **What changed:** added a `directionChanged` check, narrated FIRST ahead of every other diff rule (since a flip recontextualizes all of them): `**Direction flipped** — LONG → **SHORT** (net flow reversed)`. Only fires when both sides carry a real, non-null direction — never fabricates a flip off a missing/predates-this-field snapshot. Corrected the misleading doc comment on `BriefSnapshot.direction` to explain the WATCH-vs-COMMITTED distinction.
- **RTH check:** during a live session, find a WATCH-bucket swing candidate whose net flow reverses direction between two discovery cycles (same ticker, no committed position) and confirm the Ask Largo play-brief's diff pulse shows a "Direction flipped" line ahead of every other diff line — and that a genuinely direction-stable position (WATCH or committed) never shows a fabricated flip.

### 279. Night Hawk Swings command-deck TRIM label falsely implied the profit ladder had fired when the recommendation came from an unrelated advisory rung — fix/swing-trim-label-source-mismatch — 2026-09-18

- **What was broken:** `swingActionDisplay()` (`play-card-lifecycle.ts`) unconditionally borrowed `exitPolicy.trim_levels`'s next-unfired rung's `trigger_pct` for the "TRIM N%" label whenever `recommendation === "TRIM"` — but `manage.ts`'s `TAKE_PARTIAL`/`EXIT_RUNNER` actions (which both map to `recommendation:"TRIM"`) come from MULTIPLE independent rungs, and only `"profit_ladder"` actually fires off the ladder. `catalyst_shift`/`regime_shift`/`flow_decay`/`rel_strength_loss`/`vol_collapse` are evidence-only advisories with a generic "consider trimming" reason completely unrelated to the ladder's own trigger_pct. Live repro (found via the Ask Largo standing mandate's 5-engine health-check deep-dive, CRWD position #39): the position's recommendation was TRIM via `catalyst_shift` (advisory-only, `manageEnforced:false`, position genuinely unchanged, +15.4% P&L nowhere near the ladder's +100% trigger), yet the desk-wide command-deck label read "TRIM 100%" — read by a trader as "the +100% trigger just fired, trim now," when nothing had fired and the system wasn't acting. Shared code — this label renders on the terminal command-deck display generally, not just the Ask Largo brief, so blast radius is the whole desk.
- **What changed:** `swingActionDisplay()`'s TRIM branch now only cites the ladder's trigger_pct when `play.manageReason` positively confirms `"profit_ladder"` as the source, or is absent entirely (most swing rows have no live manage tick yet — absence must keep the pre-existing behavior, not silently downgrade every untouched row's label). Any other `manageReason` value renders the plain "TRIM" label with no percentage. `zeroDteActionDisplay()`'s own separate TRIM branch (0DTE's exit-sync ratchet system, no `manageReason` concept, genuinely always ladder-sourced) was deliberately left untouched — confirmed via grep this is a structurally different system, not the same bug.
- **RTH check:** during a live session, find a swing position whose recommendation is TRIM via an advisory rung other than the profit ladder (catalyst_shift/regime_shift/flow_decay/rel_strength_loss/vol_collapse — check the position's `manageReason` on `/api/market/nighthawk/horizons?view=swings`) and confirm the command-deck label reads the plain "TRIM" with no percentage — and that a position whose TRIM genuinely comes from the ladder (`manageReason:"profit_ladder"`) still shows the correct trigger_pct.

### 280. Ask Largo swing brief's "Drawdown before outcome" post-mortem line rendered a false claim when the trough WAS the exit — fix/swing-drawdown-before-outcome-redundant — 2026-09-18

- **What was broken:** `closedCoaching()`'s "Drawdown before outcome" line (added same-day) fires whenever `play.trough < 0 && play.peak - play.trough >= 40`, proving the peak-to-trough swing was large but never checking whether `trough` is actually distinct from `play.exitPnlPct`. For a STOPPED close, the stop mechanically fires at (or within rounding noise of) the worst mark recorded, so trough and exit are routinely the same number. Live repro, CLOSED/stopped position NN:32 (real production data): the brief rendered "dipped to **-60.3%** at its worst before closing at **-60.3%**" — both numbers `fmtPct`'d identically — making the line's own claim ("note the real intra-trade swing") false in exactly the case a reader would trust it most: a big drawdown into a stop, where nothing actually recovered before the position closed.
- **What changed:** added a `play.exitPnlPct - play.trough >= 5` gate (only when `exitPnlPct` is a real finite number) so the line only fires when there's a genuine gap between the low point and the actual exit — i.e., the position recovered meaningfully off its trough before finally closing. The shallow/never-negative/missing-trough cases were already correctly guarded and are untouched; when `exitPnlPct` is null/non-finite, the line is suppressed rather than fabricating a claim off missing data.
- **RTH check:** during a live session, find a CLOSED swing position that was stopped out at (or very near) its own trough and confirm its Ask Largo play-brief's post-mortem coaching no longer shows a "Drawdown before outcome" line for it — and that a genuinely different CLOSED position (real recovery off a deep trough before the final exit) still shows the line correctly.

### 281. Ask Largo swing brief showed two different "% room to target" numbers for the identical dollar level in one brief — fix/swing-next-trim-distance-exec-basis — 2026-09-18

- **What was broken:** `manageLifecycleCoaching`'s "next trim" distance clause (`play-brief-narrative-coaching.ts`, shipped 2026-09-18 PR #5192) always computed distance-to-target off `play.mark` (the mid), while `play-brief-intel.ts`'s sibling `targetRoomPct` block (shipped 2026-09-17 PR #5173) already prefers `play.execMark` (the live tradable bid) for the identical dollar level whenever known — two PRs a day apart, computing the same thing two different ways with no cross-reference. Live repro, real production data, AAPL SWING:AAPL:38 OPEN brief, same instant: the "Trade manager read" bullet said "mark **$5.83**, needs **$11.30** (+94% from here)" while "What to watch" said "**102%** move still needed from current bid" for the identical $11.30 target — an 8pp gap with no basis label anywhere explaining the disagreement.
- **What changed:** mirrored `play-brief-intel.ts`'s `targetBasis`/`targetBasisIsExec` pattern into `distanceSuffix` — prefers `execMark` when set and positive, falls back to `mark`, and the rendered label switches "mark"→"bid" accordingly so the number is self-explaining and matches the sibling section exactly.
- **RTH check:** during a live session, find an OPEN swing position where `execMark` and `mark` genuinely differ (bid below mid) and confirm the "next trim" distance clause and the intel section's target-room% line now report the SAME percentage for the same dollar target, both correctly labeled "bid" — and that a position with no `execMark` still shows the plain "mark"-labeled distance unchanged.

### 282. Ask Largo swing brief's gamma magnet level was structurally present but narrated in NO prose section for CLOSED plays — fix/swing-closed-gamma-magnet-narration — 2026-09-18

- **What was broken:** the gamma magnet is narrated in prose via `magnetCoaching` (`play-brief-narrative-coaching.ts`), but `collectCoachingBullets` early-returns `closedCoaching(play)` alone for `bucket === "closed"` and never reaches `magnetCoaching`. `chartLevelsSection` ("Levels on chart") already narrates every other Vector-derived level (call/put wall, gamma flip, GEX king strike, max pain, expected move, nearest wall, confluence nodes, dark pool) regardless of bucket — the magnet was the sole exception. Live-confirmed on two independent CLOSED plays (NRG #34, CG #25): a real, computed magnet level sat in the structured `levels`/"Key levels" array with zero prose mention anywhere in the brief.
- **What changed:** added a "Gamma magnet" line to `chartLevelsSection`, gated on the CLOSED bucket only — OPEN/WATCH already get the magnet, with richer actionable framing, from `magnetCoaching`, so adding it here unconditionally would have duplicated that line.
- **RTH check:** during a live session, find a CLOSED swing position whose Vector state carries a gamma magnet level and confirm its Ask Largo play-brief's "Levels on chart" section now shows a "Gamma magnet" line — and that an OPEN/WATCH position with the same magnet still shows it only once (via the existing Trade manager read framing), never duplicated in "Levels on chart."

### 283. Ask Largo's Legacy `get_nighthawk_edition` tool bypassed the member route's resolution ladder and read-time overlays entirely — fix/legacy-largo-edition-bypass-overlays — 2026-09-18

- **What was broken:** `run-tool.ts`'s `get_nighthawk_edition` case called the bare `marketPlatform.nighthawk.getLatestNightHawkEdition()`/`getNightHawkEditionForDate()` platform getters directly — a raw DB row through `rowToNightHawkEdition` with none of the member route's (`/api/market/nighthawk/edition`) resolution ladder or read-time overlays applied. Two silent consequences: (1) `pulled`/`pulled_reason` (morning-confirm INVALIDATED verdict) and `tier`/`morning_checked_at` (pinned tier assignment) are read-time overlays merged from `pull-overlay.ts`/`publish_context` — the raw row never carries them, so Largo could describe an already-pulled play as an ordinary live pick; (2) freshness/absence state (`degraded`, `stale`+`served_for`, `carry_until_close`, `no_plays`) was never computed on this path at all, and even if it had been, `compactNightHawkEditionForModel`'s type didn't forward it — a carried-forward or stale answer read as an ordinary fresh one, the absence-disclosure violation `docs/audit/LARGO-PRODUCT-CONTRACT.md` exists to prevent.
- **What changed:** extracted the DB-only core of the route's own `resolveNighthawkEdition` (unchanged logic) into a new shared module `src/features/nighthawk/lib/resolve-edition.ts`, so both the member route and the Largo tool call the identical resolution logic — same fallback ladder, same overlays, same `editionFor` default. `run-tool.ts`'s tool case now calls it directly. `EditionLike`/`compactNightHawkEditionForModel` extended to forward `degraded`/`stale`/`served_for`/`carry_until_close`/`no_plays` plus a synthesized `freshness_note` string so the model can pass the caveat to a member.
- **RTH check:** during a live session, find a play that morning-confirm has pulled/invalidated (check `/api/market/nighthawk/edition`'s `plays[].pulled`) and confirm Largo's `get_nighthawk_edition` answer correctly describes it as pulled/non-actionable rather than an ordinary live pick — and separately, if tonight's edition hasn't published yet (carry-forward window) or is being served from a bounded-age stale cache, confirm Largo's answer discloses that state (via the new `freshness_note`) rather than presenting carried-forward/stale data as an ordinary fresh edition.

### 284. Ask Largo swing brief's "Strong exit discipline" verdict was independently restated one section after "Trade manager read" already said it — fix/swing-lessons-strong-discipline-restated — 2026-09-18

- **What was broken:** `lessonsSection` (play-brief-intel.ts) and `closedCoaching` (play-brief-narrative-coaching.ts) independently derive the same MFE-capture verdict from the same peak/exitPnlPct inputs. Earlier fixes today added dedup flags for the round_trip kind and the capture<35 "gave back" branch, but the capture>=75 "Strong exit discipline" branch — the most common closed-play outcome (any well-managed winner) — had zero suppression. Live repro, CLOSED position CRWD #19 (85.7% MFE capture): "Trade manager read" said "**Strong discipline** — captured 85.7% of peak; replicate trim timing." and the very next section, "Lessons," independently restated "MFE capture: 85.7% of peak move" + "**Strong exit discipline** — banked most of the move; replicate trim ladder timing." — same fact, two adjacent sections.
- **What changed:** added a 5th `captureAlreadyNoted` param to `lessonsSection`, mirroring the existing dedup-flag pattern exactly, gating the restated verdict sentence (not the raw "MFE capture: X%" line, which stays). Derived at the call site via `narrative?.body?.includes("replicate trim timing")` — verified collision-free against the section's own distinct "replicate trim ladder timing" phrasing.
- **RTH check:** during a live session, find a CLOSED swing position with a strong (>=75%) MFE capture and confirm its Ask Largo play-brief's "Lessons" section no longer independently restates the "Strong exit discipline" verdict already shown in "Trade manager read" — and that the raw "MFE capture: X% of peak move" fact line still renders unchanged.

### 285. Ask Largo swing brief's "What changed" diff fired a content-free "Verdict headline updated" line on a pure DTE-countdown tick — fix/swing-diff-headline-dte-noise — 2026-09-18

- **What was broken:** `diffBriefSnapshots`'s headline-change check compared the raw headline string, which bakes in the contract's own DTE via `playContractHeadline`/`playSymbolLine`/`play.contract` (e.g. "TRIM — CRWD 235C 7DTE"). DTE decrements every session day on its own with nothing else about the position necessarily moving — so on a quiet refresh across a day rollover this fired unconditionally, and unlike every other diff rule in the file (which all name a concrete before/after value), this one produced zero information. It can be the ONLY line in the entire "What changed" pulse, telling a member "something changed" with no information on what.
- **What changed:** added `stripDteFromHeadline()` and compare headlines with the trailing "<N>DTE" token stripped before comparing. A pure DTE-only change no longer fires the line (Hold plan already shows live DTE continuously); a real change (roll, action-label shift) still fires.
- **RTH check:** during a live session, find an OPEN/HOLD/TRIM swing position that carries over a day rollover with no other change and confirm its Ask Largo play-brief's "What changed" pulse no longer fires a content-free "Verdict headline updated" line for it — and that a position whose headline genuinely changes for another reason (a roll, an action-label shift) still shows the line.

### 286. Night Hawk 0DTE board's `top_block_code` preferred a stale session-cumulative tally over the live pass — fix/session-board-stats-stale-top-block-code — 2026-09-18

- **What was broken:** `computeZeroDteSessionBoardStats` preferred the caller-supplied `funnelTopCode` (`discovery_funnel.top_gate`, a session-cumulative gate-rejection tally since market open) over the live pass's own `setups[].gate.blocks` distribution whenever the cumulative figure was non-empty — which is almost the entire session. Live-observed 2026-09-17: `top_block_code` showed `thesis_rank_reject` for several consecutive cycles while the SAME pass's own live setups actually showed `plan_illiquid` (241) and `score_floor` (237) as the real dominant blockers (`thesis_rank_reject` was only 37) — a trader reading "why is nothing committing right now" got a stale running total instead.
- **What changed:** swapped the precedence — `top_block_code` now prefers the live pass's own block distribution whenever it has data, falling back to the cumulative funnel figure only when this pass itself has zero gate-blocked setups to report.
- **RTH check:** during a live session mid-day (after the gate mix has plausibly shifted from the morning's dominant blocker), pull `GET /api/market/zerodte/board` and compare `session_stats.top_block_code` against a manual tally of that same response's `setups[].gate.blocks[].code` — confirm they now agree (the live pass's own most-common code), rather than `top_block_code` lagging behind an earlier-session gate that's no longer the real bottleneck.

### 288. Ask Largo swing brief disclosed ticker-news staleness in the narrative but never in `unavailableSources` — the `UnavailableChip` UI never saw it — fix/swing-news-catalyst-staleness-chip — 2026-09-18

- **What was broken:** `#5166` (merged earlier today) added `newsCatalystStale`/`newsCatalystAgeMs` and wired them into the narrative's Headlines section, but every OTHER freshness signal in `play-brief-absence.ts` (Meridian catalyst staleness, option-mark staleness, GEX/Vector staleness) reaches BOTH the narrative prose AND `collectBriefUnavailableSources`'s `unavailableSources` array — the field the UI's `UnavailableChip` reads from. News-catalyst staleness reached only the narrative, so a member skimming the chip row had no way to know the headlines could be up to 2 minutes old (`NEWS_CATALYST_STALE_MS = 120_000`).
- **What changed:** added a parallel staleness check in `collectBriefUnavailableSources`, mirroring `meridianCatalystStale`'s existing pattern exactly (same `!isClosed` gate, same headlines-present guard) — pushes a `"Ticker news"` / `"stale — headlines may lag"` entry into `unavailableSources`.
- **RTH check:** during a live session, find an OPEN/WATCH swing position whose ticker-news read is stale (check `arsenal.news.as_of` age against a ~2min threshold) and confirm its Ask Largo play-brief's `UnavailableChip` row now shows "Ticker news" alongside the existing narrative "Last snapshot... may lag" prefix — and that a position with fresh headlines, or a CLOSED position, shows neither.

### 289. Ask Largo swing brief's Book-context narrative leaked an internal theme-cluster sentinel (`NAME:BYND`) straight into member-facing text — fix/swing-theme-sentinel-leak — 2026-09-18

- **What was broken:** `theme-cluster.ts`'s `resolveTheme()` returns an internal sentinel `NAME:<TICKER>` when a ticker maps to no shared sector/theme — meant purely as an internal partition key. Three call sites (two in `play-brief-intel.ts`, one in `play-brief.ts`) hand-built `theme "${overlap.theme}"` and interpolated the raw sentinel into narrative/evidence text. Live repro, BYND (2 concurrent unmapped positions on the same ticker): both `envelope.evidence` and the "Book context" section literally rendered `Book overlap: 1 same-direction position in theme "NAME:BYND".`
- **What changed:** added `themeDisplayLabel`/`isOwnClusterTheme`/`describeThemeOverlap` to `theme-cluster.ts` — an own-cluster sentinel renders as "the same name (BYND)", a real shared theme renders unchanged ("theme \"software\""). All 3 call sites now use `describeThemeOverlap()`.
- **RTH check:** during a live session, find a book with 2+ concurrent same-direction positions on a ticker unmapped in `sector-map.ts` (no shared sector/theme) and confirm the Ask Largo play-brief's Book-context/evidence text reads "the same name (TICKER)" rather than a raw `theme "NAME:TICKER"` sentinel — and that a book overlap through a genuine shared theme (e.g. "software") still shows the unchanged phrasing.

### 290. GEX-heatmap warm path re-fetched Polygon+UW forever for tickers structurally lacking an options chain — a real, measured contributor to the 2026-09-18 UW/Polygon rate-limiter queue-timeout-surge incident — fix/gex-heatmap-no-chain-negative-cache — 2026-09-18

- **What was broken:** live CloudWatch evidence during the incident (2,458 UW admission events / 90 min, `[api-queue-timing]`) showed two dead tickers (ACEEU, RWTN) logging `[gex-heatmap] 0 contracts … trying UW strike-exposure fallback` on a steady ~75-90s cadence for 90+ minutes straight, zero successful builds ever. `buildGexHeatmapUncached`'s Redis matrix-cache TTL is a fixed 90s constant, so once it expires the function unconditionally re-attempted the full Polygon chain fetch + UW fallback for a ticker already confirmed chain-less on every prior attempt — a real, wasted, repeating draw against the shared `UW_GLOBAL_MAX_RPS=2` ceiling. This was one measured, fixable contributor to the incident; the dominant volume was legitimate cross-cron warm traffic sharing the same tight ceiling — a previously-flagged (FINDINGS #5045/#5048) architecture/capacity question this PR deliberately does not attempt to resolve (no ceiling raised, no cron rescheduled).
- **What changed:** added a 10-minute negative-cache (`NO_CHAIN_NEGATIVE_TTL_SEC`) keyed per root, checked BEFORE any upstream call (skips even the spot fetch) and set only after BOTH Polygon (0 contracts) AND the UW fallback have genuinely come up empty for that root.
- **RTH check:** during/after a live session, grep CloudWatch `/ecs/blackout-production` for `[gex-heatmap] 0 contracts for <ticker>` lines and confirm any specific chain-less ticker (one that showed the fallback line repeatedly before this fix) now logs it at most once per 10-minute window instead of every ~75-90s — and confirm the UW `[api-queue-timing]` `stock-state`/`spot-exposures/strike` volume for the shared warm-universe's persistently-dead names drops accordingly. Separately, re-pull the UW/Polygon queue-timeout-surge alert history for the next pre-market window (~7:00-9:30 AM ET) and confirm whether the surge recurs at reduced severity (this fix alone is not expected to eliminate it — see the staged finding's "what this does NOT fix" section) — if it recurs at similar severity, that confirms the dominant-volume hypothesis and escalates the cross-cron capacity study as the real next step.

### 291. Ask Largo swing brief's "Recent prints" section silently mixed a 48h premium-sorted list into a line-item next to a 6h HELIX aggregate, reading as a self-contradiction — fix/swing-flow-prints-window-mislabel — 2026-09-18

- **What was broken:** `flowIntelSection`'s "Recent prints" block reads `eco.flow_full_state.recent`, sourced from `fetchFlowFullState(ticker)` calling `getFlowTapeSummary({ ticker, limit })` with no `since_hours`/`order` — which `flow-service.ts`'s own default resolves to `order: undefined`, and `db.ts`'s `fetchRecentFlows` treats that as a 48-hour, premium-desc-sorted query (not recency-sorted, not the same window as the adjacent "HELIX tape (6h)" aggregate). Live repro, AAPL #37 (HOLD): "HELIX tape (6h): put-heavy — calls $263K · puts $1.3M · 4 prints" was immediately followed by "Recent prints: CALL 350 $3,430,000.00…" — a single line item ~13x the entire 6h call aggregate shown one line above it, reading as an internal contradiction.
- **What changed:** relabeled the section header to "**Notable prints (48h, largest premium first):**" so it honestly states its own window/ordering, and added a per-print relative-age suffix (via the existing `relativeAgeLabel` helper) so a reader can see how old the largest print is without cross-referencing another section. The underlying query/data is unchanged — this is a disclosure fix, not a data-window change.
- **RTH check:** during a live session, pull an Ask Largo swing play-brief for any OPEN/HOLD/WATCH position that has both a "HELIX tape" aggregate line and a "Notable prints" line, and confirm the prints line now reads "Notable prints (48h, largest premium first):" with a per-print age tag (e.g. "[2h ago]") rather than the old unlabeled "Recent prints:" header — and confirm the two sections no longer read as contradicting each other once their respective windows are disclosed.

### 292. Ask Largo swing brief's CLOSED post-mortem "Lessons" section gave advice directly contradicting the "Trade manager read" section two blocks earlier — fix/swing-lessons-roundtrip-advice-mismatch — 2026-09-18

- **What was broken:** `closedCoaching`'s round_trip branch (`play-brief-narrative-coaching.ts`) has two advice phrasings sharing one sentence with the "Round-tripped past breakeven" fact — "tighten at first trim rail next time" when `peakPct > 20`, or "a trim rail wouldn't have helped here; review entry timing or thesis strength instead" when `peakPct <= 20`. `lessonsSection`'s call-site `adviceAlreadyNoted` derivation only string-matched the first phrasing, so a low-peak round-trip left the advice clause un-deduped. Live repro, AAPL:38 (CLOSED/stopped, peak +10.2%): "Trade manager read" said "...a trim rail wouldn't have helped here; review entry timing or thesis strength instead" while "Lessons" two sections later said "**Gave back the move** — next time tighten at first trim rail or thesis fade." — directly contradicting advice on the same trade, not just a restatement.
- **What changed:** since `closedCoaching` always emits the round-trip fact and its advice (whichever phrasing) as one atomic sentence for `bucket==="closed"` (the OPEN-flavored "Round-tripped past breakeven — consider protecting what's left" line in `play-brief-narrative.ts` explicitly returns null for `bucket==="closed"`, so it can never be the source), `lessonsSection`'s round_trip advice line is now gated on `!adviceAlreadyNoted && !roundTripAlreadyNoted` — `roundTripAlreadyNoted` alone is sufficient proof the advice was already stated, whichever phrasing it used, without needing to enumerate every future phrasing.
- **RTH check:** during a live session, find a CLOSED swing position that round-tripped past breakeven with peak <= 20% and confirm its Ask Largo play-brief's "Lessons" section no longer independently states "next time tighten at first trim rail or thesis fade" when "Trade manager read" already said a trim rail wouldn't have helped — and that a peak > 20% round-trip (where both sections would agree) is unaffected.

### 293. Ask Largo swing brief never surfaced live execution quality (bid/ask spread) on an open position — fix/swing-live-spread-execution-quality — 2026-09-18

- **What was broken:** entry-time contract picking (`contract-ranker.ts`) already weighs spread tightness against a calibrated per-sub-lane ceiling (`taxonomy.ts`'s `SWING_SUB_LANES[subLane].liquidity.maxSpreadPct` — 18%/25%/32% for Tactical/Standard/Extended), and the live bid/ask feeding that math is refetched every tick and already reaches `HorizonDeckSource["contract"]` (confirmed live via a real WATCH row's API response) — but nothing after entry ever surfaced it again. `greeksFromContract` already extracts delta/gamma/theta/vega/iv from the identical contract object onto `TerminalPlay` and the brief already reads `play.greeks`, but no analogous extraction existed for bid/ask, so a member trimming into an open position had no way to know whether the book was still tight or had blown out since entry. Flagged as verified idea #3 in the original trader-perspective research comment on #4076 (2026-09-06) and remained unshipped until this cycle.
- **What changed:** added `DeckLiquidity`/`TerminalPlay.liquidity` (mirrors `DeckGreeks`/`TerminalPlay.greeks` exactly) and a new `liquidityFromContract` extraction function wired into `terminalPlayFromHorizon`; the Position section now shows a `Spread: **X.X%** (bid/ask)` line, compared against the position's own sub-lane's entry-time `maxSpreadPct` gate when resolvable ("still inside it" / "now wider than it"), a bare quote line on a one-sided book, and nothing at all with no live quote — never fabricated.
- **RTH check:** during a live session, pull an Ask Largo swing play-brief for any OPEN/HOLD/TRIM position and confirm the Position section now shows a `Spread:` line with a real bid/ask and a comparison against the sub-lane's entry gate (or a bare `Quote:` line if the book is one-sided) — and confirm a position with no live quote yet (fresh commit, pre-sync) shows neither line rather than a fabricated one.

### 294. Ask Largo swing brief's trade-manager narrative rendered a real small net GEX as a false "0.0M" zero — PR #5227 — fix/swing-false-zero-precision — 2026-09-18

- **What was broken:** `tradeManagerNarrativeSection`'s dealer-posture line (`play-brief.ts`) rendered `(gex.net_gex / 1_000_000).toFixed(1)` unguarded — any real, signed net GEX under ~$50k (common on lower-priced/small-cap tickers) rounds to "0.0", reading as "no dealer exposure" when a real signed value exists. Live repro: a real ABTC ($10.15 spot) brief showed a false "0.0M" net GEX. The same unguarded pattern was also present in `play-brief-narrative-coaching.ts`'s expected-move coaching line.
- **What changed:** added `formatFixedNonZero(value, decimals)` (`src/lib/swing/format-nonzero.ts`) — behaves like `toFixed(n)` but widens precision (capped) when the fixed rounding would otherwise collapse a real nonzero value to a false zero. Applied at both call sites.
- **RTH check:** during a live session, pull an Ask Largo swing play-brief for a lower-priced/small-cap OPEN/WATCH ticker with a real net GEX under ~$50k and confirm the "Trade manager read" section's net GEX line shows the real widened-precision value (e.g. "0.04M"), never a bare "0.0M"/"-0.0M".

### 295. Ask Largo swing record and play-brief endpoints disagreed on a closed position's outcome label ("flat" vs "stopped") — PR #5228 — fix/swing-pypl-false-stopped-label — 2026-09-18

- **What was broken:** `closedReasonFromRow` (`closed-plays.ts`, called directly by `play-brief-resolve.ts`) compared raw unrounded `realized_pnl_pct` against zero, so a true flat/breakeven close carrying tiny float-division residue (e.g. `-0.0001`) labeled `"stopped"` — factually wrong, no stop ever fired. The sibling composite-chain path (`closedDeckSourcesFromChains`, used by `/api/market/swing/record`) was already fixed for this exact bug on 2026-09-13 (PYPL#24), but that fix never reached the single-leg mapper the play-brief actually calls. Live repro: PYPL#24 read "flat"/0% on `/record` but "STOPPED — Reason: stopped — Exit P&L: -0.0%" with wrong trade-manager coaching ("Stop fired...") on `/play-brief`, for the same closed position.
- **What changed:** `closedReasonFromRow` now rounds `pnl` to 2 decimals (via the file's existing `round2`) before the sign comparison, matching the already-fixed composite path.
- **RTH check:** during a live session, spot-check a handful of CLOSED swing positions across both `GET /api/market/swing/record`'s closedDeck and `GET /api/market/swing/play-brief` for the same positions, and confirm `closedReason`/narrative outcome agree on every one — especially any position whose `exitPnlPct` rounds to exactly 0.

### 296. Night Hawk Legacy edition showed a false "not published yet" banner over a correct, current edition — PR #5229 — fix/nighthawk-edition-stale-flag-replay — 2026-09-18

- **What was broken:** `timeoutFallbackEdition` (`route.ts`) restamped `stale`/`served_for` at serve time when a cached `lastGoodEdition`'s date didn't match the requested one, but replayed a captured `stale:true` UNCHANGED once the requested date naturally caught up to match — a stale flag baked in at an earlier, genuinely-mismatched capture kept showing after it was no longer true. Live repro, reproduced 3x consecutively THIS cycle (still live in production at time of fix): `GET /api/market/nighthawk/edition` returned `stale:true` with `edition_for === served_for === "2026-09-18"` and a real, on-time, 4-play edition — `containers.tsx` renders this as "tonight's not published yet" over content that was already published and current.
- **What changed:** added an explicit branch — when `lastGoodEdition.edition_for === editionFor` AND `lastGoodEdition.stale` is true, return a copy with `stale:false`/`served_for:undefined` instead of the captured object unmodified.
- **RTH check:** during a live session (or right after market open, when the prior evening's edition is the natural `lastGoodEdition` carry-forward), pull `GET /api/market/nighthawk/edition` a few times and confirm `stale` is never `true` when `edition_for === served_for` matches the requested date — and check the Night Hawk Legacy board UI doesn't show a stale/pending banner over a same-date edition that's actually published.

### 297. Night Hawk Legacy's live macro strip never surfaced the desk's regime playbook sentence — fix/legacy-macro-strip-desk-playbook — 2026-09-18

- **What was broken:** `deriveComposite()`'s authored regime strategy sentence (`market_regime.playbook`, e.g. "Dealers short gamma — moves amplify. Trend up with breakout risk; calls favored; ride momentum, avoid fades.") already reached `GET /api/platform/intel`'s `regime.playbook` field, but `nighthawk-morning-confirm/route.ts`'s `fetchPlatformIntel()` only ever read `data.regime.composite`, dropping `playbook` at that hop — so it never reached the live Legacy board's macro strip (`LegacyMacroStrip.tsx`), which only ever showed the bare `Regime <ENUM>` code, never a human-readable strategy line. A same-day prior attempt (PR #5235, Task #31) had mistakenly wired the sentence into `PlaybookBoard.tsx`, a confirmed-dead component never rendered from any live route — this fix targets the real one.
- **What changed:** threaded `playbook` through the whole real pipeline: `fetchPlatformIntel()` now reads `data.regime.playbook`, all 3 `MorningConfirmResult` construction sites in the cron carry it, `LegacyMacroContext` gained a `playbook` field, `containers.tsx`'s `macroContext` forwards it, and `LegacyMacroStrip.tsx` renders it as its own bullet. The DB-fallback reconstruction path (`morning-status-from-db.ts`, used after a 24h Redis TTL miss) honestly reports `playbook: null` — not recoverable from `morning_verdict.metrics`, same as that path's pre-existing `gex_bias`/`call_wall`/`put_wall` nulls.
- **RTH check:** on the next trading session's 9:15 ET `nighthawk-morning-confirm` cron fire, load the live Legacy board and confirm the macro strip at the top shows a `Regime <ENUM>` bullet immediately followed by the full authored strategy sentence (not just the bare enum) — and confirm a session where the regime row is stale/unavailable shows neither bullet, never a fabricated one.

### 298. Ask Largo swing greek strip rendered a percent-scale IV placeholder as a four-digit percent — fix/swing-brief-iv-placeholder-scale — 2026-09-20

- **What was broken:** `normalizeImpliedVol` (`options-snapshot.ts`) exists to catch a real provider placeholder (some expired/edge-row snapshots return `implied_volatility` on the PERCENT scale — `20` meaning `2000%` — instead of the normal DECIMAL scale, `0.20` meaning `20%`) but had zero call sites anywhere in the app: both the swing play-brief's Position-section Greeks line (`play-brief.ts`) and the Command Deck's own greek strip (`PlayTerminal.tsx`'s `fmtGreek`) formatted the raw provider `iv` straight through `Math.round(iv * 100)`. A percent-scale placeholder on a live position's contract would have rendered as "IV 2000%" instead of the intended "IV 20%".
- **What changed:** `play-brief.ts` now calls the real, shared `normalizeImpliedVol` directly. `PlayTerminal.tsx` duplicates the same small pure rescale rule locally (`normalizeIvForDisplay`, threshold `iv >= 5` decimal-equivalent) rather than importing the heavy server-only `options-snapshot.ts` module into the client bundle. Both only rescale the unmistakable placeholder range; a real IV reading (including a genuine near-0%) passes through unchanged.
- **RTH check:** during a live session, spot-check the Greeks line on a few OPEN/HOLD/TRIM swing positions' Ask Largo play-briefs (`GET /api/market/swing/play-brief`) and the Command Deck's LEAPS greek strip, and confirm every rendered `IV X%` is a plausible option-IV number (roughly 0-300%), never a four-digit percent — this can only be confirmed live if a real contract happens to carry the provider's percent-scale placeholder shape, which is rare by design (the bug was latent, not actively firing on every position).

### 299. Ask Largo swing "What changed" diff never narrated a section disappearing between refreshes — PR #5272 — fix/swing-diff-removed-sections — 2026-09-20

- **What was broken:** `diffBriefSnapshots` (`play-brief-diff.ts`) compares `prev`/`next` section titles to narrate "What changed" between two brief refreshes, but only checked `next` minus `prev` ("New sections: X"). `composeSwingPlayBrief` conditionally pushes intel sections (Book context, Cortex read, Catalysts & news, GEX posture, etc.) only when the underlying data supports them, so a section can genuinely disappear between refreshes (a portfolio overlap clears, a Cortex source starts timing out, a catalyst read goes stale) — before this fix that produced zero diff lines, silently identical to a no-op refresh even though a member had been shown real information that then vanished with no notice.
- **What changed:** added the symmetric `prev` minus `next` check, pushing a plain `No longer showing: X` line — no fabricated reason for the removal, matching the existing "name the fact, don't guess the cause" discipline this file already uses for structural-level drift.
- **RTH check:** during a live session, watch a swing OPEN/WATCH play-brief across two or more refreshes and look for a case where a conditional section (most likely "Book context" as a portfolio's concentration changes, or a Meridian/Cortex-dependent section as an upstream source recovers/times out) drops out — confirm the "What changed"/"Since last read" pulse shows a `No longer showing: <title>` line rather than staying silent.

### 300. Swings desk banger-origin rows collided into one React key, corrupting ticker search — PR #5276 — fix/banger-swing-positionid-key-collision — 2026-09-20

- **What was broken:** `horizonPlayFromBangerPosition` (`banger-lane-merge.ts`) built its `HorizonPlay` without a `positionId`, so CommandDeck's row-id template (`${horizon}:${ticker}${positionId ? ":"+positionId : ""}`) collapsed every banger-origin MANAGING/SCALING_OUT row to the bare `SWING:TICKER`. Live repro: searching the Swings desk ticker box for a real held position returned 7 unrelated banger-origin tickers alongside it, growing monotonically across searches in one session — React silently misattributing DOM state across colliding keys, not a filter bug.
- **What changed:** added `positionId: row.id` (banger_positions' own primary key), mirroring the native engine's `livePlaysFromOpenPositions`. Independently verified this cycle: confirmed the pre-fix object literal on `main` genuinely lacked the field, confirmed the fix/tests on the PR branch, and reproduced RED→GREEN myself (2/14 fail pre-fix, 14/14 pass post-fix) rather than trusting the PR body. Confirmed `horizonPlayFromBangerWatch` (pre-entry WATCH rows) correctly needed no change — `mergeBangerWatchPlays` already dedupes strictly by ticker against the full play list, so a WATCH-row collision of this shape is structurally impossible there.
- **RTH check:** once this deploys, load the live Swings desk (`/nighthawk?view=swing`) and search the ticker box for a real held banger-origin position (any MANAGING/SCALING_OUT row) — confirm exactly the matching row(s) return, with no unrelated tickers bleeding in, and that repeated searches don't accumulate stale rows.
- **CONFIRMED LIVE, 2026-09-20 (same day, ~45 min post-merge):** the ECS deploy rolled out (caught mid-rollout as an origin-classification flip-flop across repeated `GET /api/market/nighthawk/horizons?view=swings` calls — old/new task revisions round-robining behind the ALB) and has since stabilized. Re-queried the live board directly: all 7 tickers that carried a real duplicate-leg collision risk (ABTC, BLSH, MUU, SNXX, BYND, BRUN, ALAB — each with two rows, e.g. one MANAGING + one SCALING_OUT) now carry two DISTINCT `positionId`s apiece (e.g. ABTC 1220/1185, BLSH 1216/1179) — 0 of 7 would still collide, versus 7 of 7 pre-deploy. Fix verified end-to-end in production, not just merged/tested in isolation — this RTH check does not need to wait for next market open.

### 301. Live-UI interaction audit's shared geometry probe reported a false text/control collision on every desk sharing the `nav-brand-ios-compact` nav pattern — fix/ui-geometry-probe-nav-brand-collapse — 2026-09-20

- **What was broken:** this cycle's standing live-UI/interaction pass on `/heatmap` (Ask Largo × Night Hawk mandate's required check, `scripts/audit/live-ui-interaction-audit.mjs`) reproducibly FAILed with `"BLACKOUT" over control "☰"` at 430px under the iOS-app UA. Direct DOM inspection showed this is a tooling false positive: the wordmark's real ancestor (`a.nav-brand`, class `nav-brand-ios-compact`) is genuinely collapsed (`opacity:0; width:0; overflow:hidden`) by an existing, correctly-working CSS rule — no member ever sees an overlap. Two bugs in `scripts/audit/lib/ui-geometry-probe.mjs` (shared by both the interaction and page-load audits) let the invisible span past the visibility gate: `visibleFraction()` treated a zero-size clipping ancestor as "no constraint" instead of "fully clipped", and `vis()` only read a node's OWN opacity/visibility/display, never an ancestor's (opacity does not inherit as a computed value). A closed, never-merged draft PR (#2143, 2026-08-13) had already diagnosed and fixed the identical bug — a "draft deadlock" casualty per this repo's own CLAUDE.md — and `main` never picked it up, so the false positive resurfaced.
- **What changed:** tooling-only fix to `ui-geometry-probe.mjs` (no application code touched) — `visibleFraction()` now returns 0 for a zero-size `overflow:hidden` ancestor; `vis()` now walks the full ancestor chain. Added a real RED→GREEN regression test (`ui-geometry-probe.test.mjs`) reproducing the exact live coordinates/CSS pattern, which the original #2143 draft never had.
- **RTH check:** this is a tooling fix, not a product change — nothing to check on the live site itself. Confirm on the NEXT live-UI/interaction audit cycle (any desk sharing `Nav.tsx`'s `nav-brand-ios-compact` chrome — `/heatmap`, `/vector`, `/nighthawk` all confirmed to share it) that the harness no longer reports this false collision, so a future session doesn't have to re-diagnose the same false positive a third time.

### 302. Ask Largo swing play-brief: one throwing intel section 503'd the entire brief — PR #5288 — fix/swing-play-brief-intel-error-boundary — 2026-09-20

- **What was broken:** `buildIntelSections` (`play-brief-intel.ts`) called all ~20 independently-optional intel sections (Trade manager read, Why this setup, Book context, track record, GEX posture, Vector desk, flow, catalysts, Meridian, macro tape, data freshness, etc.) bare — no try/catch anywhere in this function or in `composeSwingPlayBrief`. A single throw in ANY ONE section propagated through to the API route's top-level catch (`route.ts`), which returns `{available:false, degraded:true}` (503) — the entire brief disappeared for that member (Verdict/Position/Management included) even though every other section would have built fine. Reproduced with a realistic malformed-upstream-row shape (`TerminalPlay.factors` not actually an array at runtime, tripping `whyThisSetupSection`'s `.slice(0, 10)`).
- **What changed:** added a `safeSection<T>(title, build)` helper wrapping each of the 20 per-section call sites in try/catch — a throw is logged server-side only and treated exactly like the section's own legitimate `null` return (silently omitted), never fatal to the whole brief. Scoped to `buildIntelSections`'s 20 call sites only; `composeSwingPlayBrief`'s own top-level bucket sections (Verdict/Entry/Management/Position/Outcome) and the evidence/levels builders are a disclosed, separate follow-up not touched here.
- **RTH check:** this is a resilience/error-boundary fix, not a change to any section's own output on the success path — a live RTH request to `GET /api/market/swing/play-brief` for any WATCH/OPEN/CLOSED position should render byte-identical section content to before this fix (nothing to visually confirm changed). The actual thing worth watching for: if a genuine new section-level bug surfaces in a future cycle (the kind this file's own long "GAP FOUND"/"BUG FOUND" history keeps finding), it should now show up as ONE missing section on an otherwise-complete brief, never as the whole brief 503'ing with `degraded:true` — check server logs for `[swing/play-brief] intel section "..." threw` if a member ever reports a brief that renders but looks "thinner" than expected.

### 303. Ask Largo swing play-brief: composeSwingPlayBrief's OWN top-level sections shared the same "no error boundary" gap #5288 fixed for buildIntelSections — fix/swing-play-brief-compose-error-boundary — 2026-09-20

- **What was broken:** #5288 (immediately above, merged same day) fixed the same 503-on-one-throw pattern for `buildIntelSections`'s ~20 intel sections in `play-brief-intel.ts`, and its own write-up explicitly disclosed `composeSwingPlayBrief`'s own top-level sections (Verdict/Entry/Management/Position/Outcome, evidence/levels/structure-ladder builders, `play-brief.ts`) as a separate, untouched surface. This cycle's blast-radius check (CLAUDE.md's PR write-up policy) found the same gap there: `managementSection`'s `ep.trim_levels.map(...)` is unconditional whenever `play.exitPolicy` is set (`TerminalPolicyInput.trim_levels` is typed as a required array with no runtime guarantee), and none of `composeSwingPlayBrief`'s 9 top-level calls (`watchEntrySection`/`managementSection`/`thesisHealthSection`/`pnlSection`/`siblingPositionsNote`/`closedSection`/`evidenceFromContext`/`levelsFromContext`/`buildStructureLadder`) had a try/catch — a throw in any one still 503'd the whole brief.
- **What changed:** added `safeCompose<T>(label, build, fallback)` (the composition-level twin of #5288's `safeSection`, generic over a fallback so it also covers the array-returning evidence/levels builders and the nullable structure-ladder builder, not just `RichSection | null`) wrapping all 9 call sites. A throw is logged server-side only and the composition continues with the fallback (omitted section / empty array / null ladder) instead of propagating. This PR does not read or modify `play-brief-intel.ts`.
- **RTH check:** same as #5288 — this is resilience-only, no success-path output change, so a live RTH request to `GET /api/market/swing/play-brief` should render byte-identical to before. Watch for: if a genuine new bug surfaces in Management/Position/Entry/Outcome/evidence/levels/structure-ladder in a future cycle, it should now show as one missing section/empty evidence-or-levels-array/null structure ladder on an otherwise-complete brief, never a whole-brief 503 — check server logs for `[swing/play-brief] "<label>" threw` if a member ever reports a thinner-than-expected brief.

### 304. Ask Largo `get_cross_product_read` had no wiring for Night Hawk Swings at all — PR #5291 — fix/cross-product-read-missing-swing — 2026-09-20

- **What was broken:** `get_cross_product_read` (`cross-product-read.ts`) fans out to Helix/Thermal/Vector/Meridian/Night Hawk 0DTE/SPX Slayer to join their directional reads for cross-desk questions (e.g. "where do the desks disagree on NVDA"), but Night Hawk Swings had no `ProductId`, no adapter, and no `SOURCES` entry — not an honest absence-with-a-reason (the contract's normal failure mode), but never asked in the first place. `get_swing_play_brief` has been a fully-wired single-ticker Largo tool since 2026-09-12, so a member asking Largo about a ticker with a real open Swing position got a cross-product read that structurally could not surface Swing's stance or represent a genuine Swing-vs-other-desk split.
- **What changed:** added `"swing"` to `ProductId` (`product-read.ts`), a new `swingContribution()` adapter (`product-adapters.ts`) deriving direction from `envelope.bias` (the same field the member-facing play-brief panel itself renders, so it can never disagree with what a member reads directly), wired `SOURCES` in `cross-product-read.ts` to `get_swing_play_brief` with the queried ticker threaded explicitly, and corrected `tool-defs.ts`'s description (6→7 product count).
- **RTH check:** during a live session, ask Largo a cross-product question about a ticker with a real open Swing position (e.g. "where do the desks agree/disagree on TICKER") and confirm the response now includes Swing's stance and can represent a genuine Swing-vs-other-desk `split` verdict — before this fix, Swing structurally could never appear in that answer regardless of the ticker.

### 305. Ask Largo `get_cross_product_read` silently dropped every product's `confidence`, contradicting its own contract comment — PR #5293 — fix/cross-product-confidence-dropped — 2026-09-20

- **What was broken:** `cross-product.ts`'s own header comment (decision 2) states *"Confidence is REPORTED, never multiplied by"* — but `joinProductSignals` never actually read `ProductSignal.confidence` anywhere, so it was silently discarded on every join. The "never multiplied by" half was correctly enforced (confidence never decided `verdict`/`direction`/sort order); the "REPORTED" half was silently false — a model calling `get_cross_product_read` had no way to see a product's calibrated confidence, and the system prompt had nothing to tell it to relay one. Trader impact: two products agreeing on direction with very different calibrated confidence looked identical in an `aligned` verdict.
- **What changed:** added a `CampConfidence` type + `confidence: CampConfidence[]` field on `Camp`, populated only for products that actually supplied one (C6-honest, never fabricated) and populated strictly AFTER verdict/direction/sort are decided, so it cannot influence them. Added one system-prompt bullet telling the model it may relay confidence as color but never let it override a split or promote a camp.
- **RTH check:** during a live session, ask Largo a cross-product question about a ticker where at least one contributing product (Vector or Helix are the most likely to supply a calibrated confidence first) has a real signal, and confirm the response can now mention that product's confidence level as color commentary — never as a reason to override an `aligned`/`split` verdict or reorder which camp is presented first.

### 306. Night Hawk Swings: Legacy-promoted PRE-ENTRY plays showed factors that never summed to score (4th occurrence) — fix/swing-legacy-factors-mismatch — 2026-09-20

- **What was broken:** `serving-lane.ts`'s `enrichPlay` (the PRE-ENTRY discovery-lane sibling of `attachThesisExplanation`) unconditionally overwrote `factors: meta.factors` with a freshly re-run dossier's breakdown, even when the play already carried PINNED factors consistent with its own `score` — exactly what `legacy-confirm-promote.ts` sets for Legacy-morning-confirm-promoted plays (a single "Night Hawk edition score" entry, the #4843 fix, 2026-09-12). Because a Legacy-promoted play never carries `liveStatus` until it's actually committed to a live position, it always took THIS path, never `attachThesisExplanation`'s (which already had the correct guard) — so #4843's fix was silently undone at render time. Live evidence, 2026-09-20: `LITE` score 71 vs factors summing to 70.1, `SMCI` score 91 vs 84.5 (a 6.5pt/7% gap) — both promoted well after the #4843 fix, proving this is an ongoing regression, not stale data.
- **What changed:** `enrichPlay` now prefers an existing non-empty `play.factors` over `meta.factors`, mirroring `attachThesisExplanation`'s existing guard exactly. Organic (non-Legacy) discovery plays never set `factors` before this function runs, so this is a no-op for them.
- **RTH check:** once this deploys, re-query `GET /api/market/nighthawk/horizons?view=swings` (or check the live board) for any Legacy-morning-confirm-promoted row (`reason` contains "Legacy morning confirm", `signalKinds` includes `"NIGHT HAWK"`) and confirm its `factors[].points` sum equals its `score` exactly — LITE and SMCI specifically, if either is still on the board, should now read 71.0/91.0 exactly instead of 70.1/84.5.

### 307. Night Hawk Swings: Legacy-promoted factors mismatch persisted THROUGH #5298's fix (5th occurrence) — made the guard self-healing — fix/swing-legacy-factors-self-heal — 2026-09-20

- **What was broken:** immediately re-verified #306/#5298's fix live and found LITE and SMCI STILL showing the old 5-factor dossier breakdown (LITE 71 vs 70.1, SMCI 91 vs 84.5) despite #5298 being fully deployed (8/8 ECS targets on the fix's task def, confirmed) and `buildLegacySwingArtifacts` (the writer) having been correct and deployed on both `blackout-production-web` and `blackout-production-market-worker` since well before either row's own promotion timestamp (verified via ECS task-definition history + `git merge-base --is-ancestor`). Root cause: `enrichPlay`'s (and `attachThesisExplanation`'s) "pinned" check only ever verified `factors.length > 0` — non-emptiness, never that the array actually summed to the score it rides beside. That guard can preserve a genuinely-correct pin, but it can NEVER repair one that was already wrong for any reason — and the persisted swing serving snapshot itself was found stale (`GET /api/admin/swing/discovery-debug`: `asOf` stuck ~40h in the past), meaning whatever wrote the bad value for these two rows has never been revisited since, carried forward untouched by the day-to-day contract-only refresh (`carryLegacyPromotedIntoSnapshot`).
- **What changed:** both guards now call a new `factorsSumToScore(factors, score)` check (tight floating-point-only tolerance — the underlying invariant is an EXACT sum by construction) before trusting a pinned array. When it fails AND the play is Legacy-exempt (`commitGateBlockedBy` carries `"legacy:exempt"`), the factors are REPAIRED to the correct single `"Night Hawk edition score"` entry rather than either being trusted broken or replaced with a fresh (equally mismatched) dossier decomposition. Non-Legacy plays whose pin fails are unaffected (unchanged pre-existing fallback to a fresh dossier read).
- **RTH check:** re-query `GET /api/market/nighthawk/horizons?view=swings` for LITE/SMCI (or any Legacy-morning-confirm-promoted row still on the board) and confirm `factors` is now exactly `[{label:"Night Hawk edition score", points: <score>}]` — a single entry, summing exactly. Separately: check `GET /api/admin/swing/discovery-debug`'s `asOf` is current (not stuck hours/days in the past) once RTH resumes — the persisted-snapshot staleness this investigation surfaced is a real, separate operational issue this fix does not address; if `asOf` is still stale, the `swing-discovery` cron itself needs its own investigation.

### 308. Ask Largo swing play-brief never surfaced Vector's new market_session_note disclosure — fast-follow to PR #5306 — fix/swing-market-session-note-evidence — 2026-09-20

- **What was broken:** PR #5306 (merged same cycle) shipped `market_session`/`market_session_note` on the shared `VectorFreshnessBlock` (`describeVectorFreshness`, `vector-state-freshness.ts`) — the weekend/holiday self-warm disclosure ("computed moments ago, but the market is CLOSED") — but explicitly scoped wiring it into swing's evidence array as a fast-follow rather than shipping it in the same PR. Until this fix, the original live repro (a Sunday `GET /api/market/swing/play-brief` read showing `"freshness": "live"` ~40h into a market closure) was still not visibly fixed for a real member — the field existed server-side but nothing read it.
- **What changed:** `evidenceFromContext()` (`play-brief.ts`) now reads `vec.market_session_note` (cast to include `VectorFreshnessBlock`'s fields, since the declared `VectorFullState` type predates PR #5306 even though the runtime object — via `fetchVectorFullState`/`fitVectorFullStateForModel`, both of which carry the freshness block through verbatim — genuinely has them) and pushes it as a `"Vector"`-attributed evidence line whenever present, gated `!vectorStale` (the same trust gate every other Vector-derived evidence line in this function already respects).
- **RTH check:** this fix is primarily an off-hours/weekend disclosure, so the most direct check is off-RTH: on a weekend or market holiday, pull `GET /api/market/swing/play-brief` for any ticker whose Vector state gets a fresh self-warm compute and confirm `envelope.evidence[]` now includes a line naming that the market is CLOSED despite a fresh compute. During RTH itself, spot-check a few OPEN/WATCH briefs and confirm NO such line appears (the note is null whenever the market is genuinely open) — a false-positive appearance during live trading hours would indicate the `market_session`/`freshness` combination logic regressed.

### 309. Ask Largo swing play-brief: GEX matrix had the same weekend-self-warm freshness gap as Vector — fast-follow to #5306/#5307, "Mechanism 2" — fix/swing-gex-market-session-note — 2026-09-20

- **What was broken:** #5306/#5307 (same cycle) fixed Vector's "compute is fresh but the market is CLOSED" disclosure gap. The GEX matrix has the identical symptom through a completely independent code path: `gexFreshness`/`gexMatrixStale` (`play-brief.ts`/`play-brief-absence.ts`) classify `gex.asof`, which traces to `polygon-options-gex.ts`'s own wall-clock `calculatedAt` stamp and never calls `describeVectorFreshness` at all — so fixing Vector alone left this one untouched. Live-confirmed reachable: pulled a real Sunday (market CLOSED) play-brief and reproduced the exact misleading combination via `describeVectorFreshness`/`etSessionFacts` directly.
- **What changed:** extracted the shared "compute fresh + market CLOSED" disclosure logic out of `describeVectorFreshness` into a new, source-agnostic module (`src/lib/bie/market-session-disclosure.ts`, `marketSessionDisclosure()` + `formatFreshnessAge()`) — a pure refactor of `vector-state-freshness.ts`, verified behavior-identical (its own 24 tests unchanged). Added `gexMarketSessionNote(gex, readMs)` (`play-brief-absence.ts`, next to `gexMatrixAgeMs`/`gexMatrixStale`) computing GEX's own age/freshness and delegating to the same shared helper. Wired into `evidenceFromContext()` (`play-brief.ts`) as a new `"GEX"`-attributed evidence line, gated `!gexStale`, immediately after the Vector block #5307 just added.
- **RTH check:** same shape as #308 above — on a weekend/holiday, pull `GET /api/market/swing/play-brief` for a ticker whose GEX matrix gets a fresh self-warm compute (not Vector-derived — check `envelope.evidence[]` for a `"GEX"`-sourced line, distinct from the Vector-sourced one #308 checks) and confirm the CLOSED-market disclosure appears. During RTH, confirm neither the Vector nor the GEX version of this line appears on any OPEN/WATCH brief — both should stay null whenever the market is genuinely open.
