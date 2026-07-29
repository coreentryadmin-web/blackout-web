# FINDINGS — living issue log

(Rebuilt 2026-07-13: the prior log was clobbered to an empty file by a squash-merge
conflict-resolution mishap. Historical entries live in git history — `git log --all --
docs/audit/FINDINGS.md`. New entries append below; keep severity / root cause / file:line /
evidence / fix / status per the CLAUDE.md policy.)

## 2026-07-30 — [Swing] Hourly manage is mark-and-review (not tactical live mgmt) + grader honesty labels

**Severity.** P1 documentation / product-claim — overstated management precision + grader "truth".

**#4 Active refresh.** Live manage cron is hourly. Tactical 2–7 DTE can move materially between
samples; intrahour stop touch / recover is invisible; live MFE/MAE from hourly samples understate path.
Claiming responsive structural_stop / premium_stop / scale-out / EXITING precision from that loop is false.

**#5 Grader.** Families were labeled as execution/path/management/financial "truth" while production
entry is typically a chain mid (reference mark), path resolution equals supplied bars (not guaranteed
minute), and financial is marked scale-out P&L. The pure grader already fail-softs (`no_fill`,
`ungradeable`) — the overclaim was primarily terminology + docs.

**Fix (honesty, not cadence infra).**
1. Docs + cron header: **hourly mark-and-review**; faster per-sub-lane cadence deferred (rate budget).
2. Grader docs/header: REFERENCE_EXECUTION / OBSERVED_PATH / MODEL_MANAGEMENT / MARKED_FINANCIAL;
   `SWING_GRADE_FAMILY_LABEL` map; code keys unchanged for JSON stability.
3. Did **not** cut EventBridge to 1–5m tactical in this change — that needs an explicit schedule split
   + UW/Polygon budget math before deploy.

**Status.** Honesty FIXED on `cursor/swing-followups-3d11`. Faster tactical cadence = open follow-up.

## 2026-07-30 — [Swing] COMMIT_NOW required graduation (cold-book "Act now" defect)

**Severity.** P1 product / risk-control — member "Act now" on setups the model will not open.

**Root cause.** Serving section `COMMIT_NOW` keyed only on TRIGGERED + AT_TRIGGER + floor clear.
Score floors are provisional; ledger OPEN requires archetype×sub-lane graduation (+ budget/caps).
Docs said "Act now" for COMMIT_NOW while the cold book kept `commitEligibleCount = 0`.

**Fix.** `sectionForSwingPlay` requires `bucketGraduated === true` for COMMIT_NOW; otherwise
WAITING_FOR_ENTRY. Discovery stamps `bucketGraduated` from the same `isCommitGraduated` ladder.
Budget/caps stay model-book-only. Did **not** adopt ENTRY_READY_UNVALIDATED / MEMBER_ACTIONABLE
renames — desk vocabulary stays institutional; the gate is the honesty fix.

**Status.** FIXED on `cursor/swing-followups-3d11`.

## 2026-07-30 — [Swing] Persistence keyed only by (ticker, direction) — false WATCH eligibility

**Severity.** P0 / release-blocking — thesis flip inherited another archetype's session count.

**Root cause.** `swing_candidate_accumulation` PRIMARY KEY was `(ticker, direction)`. Mon
FLOW_ACCUMULATION → Tue MEAN_REVERSION → Wed BREAKOUT on the same NVDA long shared one row, so a
new archetype inherited `distinct_session_days` and could falsely clear the WATCH bar. Live-flow
advances also merged into whatever classified thesis shared that name+side. Archetype was only
applied at *read* time via `archetypeOf` on `fetchWatchEligible`.

**Evidence.** DDL `PRIMARY KEY (ticker, direction)` in `db.ts`; `ON CONFLICT (ticker, direction)`;
`observeSwingCandidate` / `markAccumPromoted` lacked archetype; docs said "one observation per
(ticker, direction)".

**Fix.** Thesis identity = `(ticker, direction, archetype)`:
1. Schema migration adds `archetype` (default `UNCLASSIFIED`) and rebuilds PK.
2. Upsert / promote / observe / watch / serve gates use `swingThesisKey(...)`.
3. Live FLOW advances land in `UNCLASSIFIED` and never merge into a classified thesis.
4. Promote is thesis-scoped so a sibling archetype on the same name+side survives.

**Status.** FIXED on `cursor/swing-followups-3d11`.

## 2026-07-30 — [Swing] CTO follow-ups — feature vector, graduated rungs, serve reads, beta/IV, cron catalog

**Severity.** P1 — management/serve/calibration seams left dormant after the 2026-07-29 CTO audit.

**Root cause / gaps.**
1. `buildCommitInsert` pinned `feature_vector`, but discovery never threaded pillars / classification meta / ivRank onto commit candidates → every commit vector was hollow.
2. `manage.ts` honored `graduatedRungs`, but active-refresh never loaded the calibration ladder → edge rungs stayed advisory forever.
3. Horizons called `getSwingServingLane` without `readsByTicker` → setup maturity stuck at RESEARCH/`thesis unknown`.
4. `fetchNameBeta` was a permanent stub; IV series fetcher existed but ingest only used the point rank.
5. Swing crons had no `railway.swing-*.toml` catalog → EventBridge sync could not manage them.
6. `time_stop` required `thesisProgress01` which was never supplied; TRIM never latched → `EXIT_RUNNER` unreachable.
7. Live sections (MANAGING/SCALING_OUT/EXITING) never received open ledger rows.

**Fix.**
1. Discovery maps dossier pillars + `classificationMetaFromVerdict` + `ivRank` onto commit candidates; dossier.plan carries `atr`.
2. Active-refresh loads graduated rungs once/tick; refreshes IV + `thesisProgress01` + `volCollapsed`; latches TRIM; warms beta cache; refreshes serving spots.
3. Discovery persists `spotsByTicker`; serve path builds reads + merges `fetchOpenSwingPositions` into live sections.
4. `fetchNameBeta` + `createDailyClosesBetaSource`; ingest IV series fallback via `latestIvRankFromSeries`.
5. Added `railway.swing-discovery.toml` + `railway.swing-active-refresh.toml`.

**Status.** FIXED on `cursor/swing-followups-3d11`. Infra sync still required for EventBridge rule create/update.

## 2026-07-29 — [Grid/0DTE] grid-e2e board HTTP 504 under orchestrator burst

**Severity.** P1 — flaky `validate:grid-rth --phase=post-close` on `grid:dashboard-e2e` when nested
`validate:grid-e2e` hits HTTP **504** on `/api/market/zerodte/board` after long orchestrator run.

**Root cause.** `grid-zerodte-e2e-audit.mjs` `app()` curl had no retry on transient 502/504/524 (unlike
`fetchAuditJson` used by logic/integration audits).

**Fix.** `auditGridApis`: 4× retry with backoff on transient board status. Shared `isTransientOriginError`
in `auth-status.mjs` (also dedupes `audit-auth-fetch.mjs`).

**Status.** `fix/grid-e2e-board-retry` → PR.

## 2026-07-29 — [Grid/0DTE] grid-rth orchestrator syntax error (broken merge #1305)

**Severity.** P0 — `validate:grid-rth` could not run at all (`SyntaxError: Illegal return statement`).

**Root cause.** PR #1305 refactored `auditOpsCollect()` to shared `ops-collect-scope.mjs` in SPX runbook but left
`grid-rth-all-day-audit.mjs` with the function body orphaned at module top level (import mid-file, no
`function auditOpsCollect()` wrapper).

**Fix.** Restore `function auditOpsCollect()` wrapper; move `ops-collect-scope` import to top.

**Status.** Merged PR #1307.

## 2026-07-29 — [SPX] Post-close audit flake: ops:collect stderr mask + transient 502 on desk lanes

**Severity.** P1 — blocked `validate:spx-rth --phase=post-close` despite member SPX surfaces GREEN.

**Symptoms.**
1. `ops:collect` FAIL with only stderr `Postgres audit skipped` — stdout JSON not parsed (same class as grid #1298).
2. `spx:desk-lanes` FAIL on HTTP 502 `/api/market/spx/flow` during parallel audit burst; matrix/play GREEN on retry.
3. `validate:spx-e2e` matrix fetch HTTP 502 + Playwright timeout cascade when heatmap cold.

**Root cause.**
1. `spx-rth-all-day-audit.mjs` used naive `run()` for ops:collect — non-zero exit from unrelated P0/P1 or stderr-only postgres skip masked zero-item payload.
2. Desk lane check treated transient 5xx on pulse/flow as hard FAIL instead of unavailable (post-close flow lane returns `available:false` when not RTH).
3. `fetchAuditJson` / E2E `app()` had no retry on edge 502/504/524 during parallel probe bursts.

**Evidence.** Post-close 2026-07-29 ~18:03–18:13 ET: matrix + cross-endpoint + BIE GREEN; desk-lanes/e2e FAIL on 502; standalone `ops:collect` exit 0 with postgres skip.

**Fix.** Shared `ops-collect-scope.mjs` + `auditOpsCollect()` in SPX runbook; `softFetchJson` for pulse/flow lanes; `fetchAuditJson` 3× retry on 502/504/524; E2E matrix `app()` 5xx retry.

**Status.** `cursor/spx-post-close-findings-2224` → PR.

## 2026-07-29 — [Swing] CTO audit — management gates null-wired + desk ignored sections

**Severity.** P0 capital-path / P1 member UX — Swing engine looked “built” but premium_stop,
structural_stop, time_stop, and mark-frozen rolls could never fire; desk flattened the 7-section triage.

**Root cause.**
1. `commit.ts` wrote `contract_occ: null`; active-refresh `loadOptionMark` gated on OCC → mark always null.
2. Commit candidates never received `thesisInvalidationPx` / entry / target from dossier.
3. `fadeStaleSwingCandidates` never called from discovery.
4. `sessionsHeld` omitted from active-refresh reads.
5. `HorizonDeck` used flat committed/watch and dropped serving meta (factors/setup/thesis).
6. Persist failure still upgraded phase NX claim to DONE (22h stale board).

**Evidence.** Code audit 2026-07-29; `npm run healthcheck:swing` AMBER (empty book, serving GREEN).
Full matrix: `docs/audit/SWING-CTO-AUDIT-2026-07-29.md`.

**Fix.** OCC reconstruct + plan levels at ingest/commit; fade stale; sessionsHeld; section-aware
HorizonDeck; persist boolean + claim release; FAILED_BREAKDOWN 1-session structure promote;
archetype intended-DTE realign. Branch `cursor/swing-cto-audit-3d11`.

**Status.** Merged into follow-ups branch; PR #1310.


## 2026-07-29 — [Grid/0DTE] zerodte board HTTP 504 on aged snapshot cold-build


**Severity.** P0 member path (Night Hawk `/api/market/zerodte/board`).

**Symptoms.** Parallel grid-rth audit burst: `integration:zerodte-board` HTTP **504**;
`zerodte-bie-consistency` `live:board-fetch` HTTP **504**; `validate:zerodte-logic`
`live:board` HTTP 401 when CRON bearer timed out without Clerk fallback.

**Root cause.** `getZeroDteBoardPayload()` (`zerodte-service.ts`) treated snapshots with
`as_of` age >30s as unservable and **blocked** on `buildAndPublishBoard()`. Under audit
parallelism or a slow scan, cold builds exceeded Cloudflare origin timeout (~100s) while
the Redis snapshot key (`zerodte:board:snapshot:v1`, TTL 60s) was still present.

**Evidence.** `grid-rth-2026-07-29` verify pass: curl board 504 via cron; sequential Clerk
probe succeeded; `audit-output/grid-rth-*-verify-*.json`.

**Fix.** Serve shared snapshot SWR up to `BOARD_SNAPSHOT_TTL_SEC` (60s); only true cold miss
blocks. `audit-auth-fetch.mjs`: fall through to Clerk on 502/504/524. `zerodte-logic-audit.mjs`:
use `fetchAuditJson`. Test: `zerodte-board-convergence.test.ts` 35s-aged snapshot case.

**Status.** `fix/zerodte-board-swr-504` → PR.

## 2026-07-29 — [ops] SPY flow cross-check false FLAG — bounded Massive oracle (#1299)

**Severity.** P0 data-correctness (ops-auto-fix #1299, fingerprint `ee994b4b2bf8`).

**Symptoms.** `data-correctness` FLAG: SPY `net_premium` — UW $1.62M (0% call) vs Massive
$0.53–0.65M (30% call) over 33–34 NTM contracts; UW/Massive=2.47–3.05× (> 1.25× allowance).

**Root cause.** Massive `/v3/trades` reconstruction is **bounded** (40 contracts, 2 pages/
contract, ±4% band). Liquid SPY 0DTE routinely hits per-contract **page** caps even when
`contractsCapped` is false — the oracle is NOT a complete superset. Prior fix (#1287 grid
post-close) only skipped subset FLAG on `contractsCapped`/`partial`, not page truncation.

**Evidence.** `ops-collect` fingerprint `ee994b4b2bf8`; live ratio 3.05× with 33/40 contracts,
no `(partial)` or `(contract-capped)` tags.

**Fix.** `option-trades.ts`: track `meta.pagesTruncated`. `flows-verifier.ts`: scope UW to
Massive's exact strike set; skip (not flag) subset violation when oracle is partial/capped/
pages-truncated; flag subset only on complete oracle.

**Status.** `fix/ops-1299-flow-xcheck-bounded-oracle` → PR #1301.

## 2026-07-29 — [Grid/0DTE] Post-close agent: contract-capped Massive oracle false FLAG + ops:collect stderr mask

**Severity.** P1 — blocked `validate:grid-rth --phase=post-close` (13/13 → 13/14 FAIL on `ops:collect`).

**Symptoms.**
1. `ops:collect` P0 `correctness:flags`: SPY `net_premium` — UW $8.6M (0% call) vs Massive $1.9M
   (42% call), UW/Massive=4.52× on 38 NTM contracts.
2. `grid-rth` reported `ops:collect` FAIL with only stderr `Postgres audit skipped` — could not
   parse stdout JSON to distinguish grid vs non-grid action items.

**Root cause.**
1. `flows-verifier.ts` treated Massive's `OPTION_TRADES_MAX_CONTRACTS` (40) bounded sample as a true
   superset oracle — UW unusual prints legitimately exceed the capped sample total post-close.
2. `grid-rth-all-day-audit.mjs` `run()` preferred stderr over stdout on non-zero exit; postgres VPC
   skip masked the real ops payload.

**Evidence.** Post-close 2026-07-29 ~17:02 ET: `validate:zerodte-logic` 17/17 GREEN,
`validate:grid-e2e` 4/4 GREEN; `validate:grid-rth` FAIL 1/13 on ops:collect only. All 0DTE board
probes (gates, ledger PnL, mergePlays, session heat) GREEN.

**Fix.** `crossCheckAgainstMassive`: skip when `!marketOpen`, `contractsCapped`, or `partial`
(subset-ratio not assertable on bounded oracle). `grid-rth-all-day-audit.mjs`: dedicated
`auditOpsCollect()` parses stdout JSON. SPX runbook Grid probe → `/api/market/spx/bootstrap`.

**Status.** PRs `fix/grid-post-close-ops-collect-20260729` + `fix/spx-post-close-flow-xcheck` → `main`.
Also unblocks `validate:spx-rth --phase=post-close` (matrix/desk/play/E2E were already GREEN).

## 2026-07-29 — [ops] x-autopost cron STALE + SPY flow cross-check false FLAG (#1287)

**Severity.** P1 ops + P0 data-correctness (ops-auto-fix #1287, fingerprint `5ed63c855361`).

**Symptoms.**
1. `cron-staleness-watchdog` flagged `x-autopost` stale — no `cron_job_runs` in 150m.
2. `data-correctness` FLAG: SPY `net_premium` — UW 0% call vs Massive 32% call (32pt gap) while
   UW/Massive=0.78× (valid subset).

**Root cause.**
1. EventBridge `blackout-production-x-autopost` **DISABLED** (same X-marketing batch as #1277).
2. `flows-verifier.ts` flagged same-direction skew **magnitude** when UW unusual subset was still
   below Massive raw superset — expected subset vs superset, not a member-facing bug.

**Evidence.** AWS rule DISABLED, schedule `cron(0 12,14,16,18,20,22,0 ? * * *)`. Dry-run cleared
watchdog; `data-correctness?force=1` reproduced FLAG pre-fix.

**Fix.** Re-enabled EventBridge; `railway.x-autopost.toml`; cross-check flags opposite skew or subset
violation only (same direction + valid subset → independently confirmed).

**Status.** `fix/ops-1287-autopost-flow-xcheck` → PR.
=======
## 2026-07-29 — [Thermal+Vector] Shared sticky universe (≤100 / 14d)

**Severity.** P2 product gap — Vector already sticky-recorded member-viewed names (cap 100,
14d) while Thermal `heatmap-warm` only warmed the static ~21 allowlist. Opening NVDA on
Thermal registered it for Vector beads but did not keep the Thermal matrix cache-hot in
background; the desks drifted to two different “universes.”

**Root cause.** Warm cron used `vectorWarmTickers()` (static only). Dynamic list lived in
`vector-dynamic-universe.ts` and was only unioned into Vector recorder / walls paths that
already called `listDynamicUniverseTickers` — not Thermal matrix warm.

**Fix.** `mergeSharedUniverseTickers` / `listSharedUniverseTickers` — one static∪dynamic set.
`heatmap-warm`, `vector-walls-warm`, and `buildVectorUniverseSnapshot` all consume it. UW
overlays stay on the static allowlist (2 RPS). CORE SPY/SPX/QQQ still force-refresh first.

**Status.** `cursor/thermal-share-dynamic-universe-3d11` → PR.
>>>>>>> 1d12b294 (feat(thermal): share Vector sticky universe (≤100/14d) for matrix warm)

## 2026-07-29 — [Thermal] Triple desk SPY/QQQ not refreshing every 5–10s


**Severity.** P1 UX — compare desk felt stuck; SPX stayed ~5s while SPY/QQQ asof climbed
15–25s (live poll 2026-07-29 ~15:58 ET). Browser showed force requests stuck on
`force=1&n=1` (same SWR key every cycle).

**Root cause.**
1. Client cleared `forceNonce` → 0 on success, then bumped to 1 again → identical SWR key.
2. Force age/throttle were 8s while UI goal is Slayer-like 5–10s; server throttle matched 8s.

**Fix.** Monotonic force nonce + `forceActive` flag (unique SWR keys); force age/throttle
5s client+server. Triple desk ticks every 1s and waits for in-flight force to settle.

**Status.** `cursor/thermal-matrix-cadence-3d11` → PR.

## 2026-07-29 — [Thermal] Triple desk opens scrolled to top of strike band (not spot)

**Severity.** P2 — on `/heatmap` compare desk, SPY|SPX|QQQ ladders painted with spot
highlighted (`is-spot`) but `scrollTop` stayed at 0, so traders had to manually scroll
each column to find price. SPX Slayer already auto-centers + has a ↻ refresh.

**Root cause.** `ThermalCompactMatrix` rendered the spot row but never called
`scrollRowIntoViewCenter`. No rail control revalidated/recentered all three panels.

**Fix.** Auto-center each panel on visit / spot-strike change (Slayer pin semantics);
rail ↻ (+ `R`) revalidates all three SWR keys and bumps a recenter epoch; programmatic
centers suppress cross-panel scroll-sync so each ladder maps to its own spot.

**Status.** `cursor/thermal-spot-recenter-3d11` → PR.

## 2026-07-29 — [ops] x-replies cron STALE (EventBridge DISABLED)

**Severity.** P1 ops (ops-auto-fix #1277).

**Symptom.** `cron-staleness-watchdog` flagged `x-replies` stale — no `cron_job_runs` row in 90m
during RTH weekdays.

**Root cause.**
1. EventBridge rule `blackout-production-x-replies` was **DISABLED** (along with other X marketing
   rules) — scheduled fires never hit `/api/cron/x-replies`.
2. `railway.x-replies.toml` catalog had a stale 3×/day schedule (`0 13,17,22`) vs the live EventBridge
   expression `cron(20 13-22 ? * MON-FRI *)` (hourly :20).

**Evidence.** AWS `DescribeRule`: State=DISABLED, Schedule=`cron(20 13-22 ? * MON-FRI *)`.
Manual `GET /api/cron/x-replies` returned 200 with replies; watchdog `problem_keys` cleared after
one run. `ops-collect` fingerprint `b60c447e4c03`.

**Fix.** Re-enabled EventBridge rule; aligned `railway.x-replies.toml` to `20 13-22 * * 1-5`;
`xMarketingCronPaused()` + admin cron-health override so intentionally paused X marketing does not
page STALE; added X crons to `railway-cron-services.mjs` ops registry.

**Status.** `fix/x-replies-cron-stale` → PR.

## 2026-07-30 — [ops] x-replies/x-growth cron STALE off-schedule (false positive)

**Severity.** P1 ops (ops-auto-fix #1312, fingerprint `b60c447e4c03`).

**Symptom.** `cron-staleness-watchdog` flagged `x-replies` (and later `x-growth`) stale after the
daily UTC fire window closed — e.g. 00:14 UTC with no `cron_job_runs` in 90m.

**Root cause.** EventBridge rules are **ENABLED** (`x-replies` `cron(20 13-22 ? * MON-FRI *)`,
`x-growth` `cron(0/30 13-23 ? * * *)`), but `admin-cron-health` treated `stale_after_min` as 24/7.
After the last tick (22:20 / 23:30 UTC) age inevitably exceeds the threshold until the next
morning band — recurring nightly false positive. `xMarketingCronPaused()` did not help because ECS
tasks had not picked up `X_MARKETING_POSTS_PAUSED=1` from Secrets Manager (manual run did not skip).

**Evidence.** AWS `DescribeRule` State=ENABLED for both rules. Watchdog `problem_keys: ["x-replies"]`
at 00:14 UTC; manual `GET /api/cron/x-replies?manual=1` cleared it; `x-growth` borderline stale at
45m threshold. Same fingerprint as #1277 but different root cause (schedule-window, not disabled EB).

**Fix.** `schedule_cron_utc` on X marketing registry entries + `cron-schedule-window.ts`
`isInOffScheduleIdleGap()` suppresses stale when outside long inter-fire gaps; added
`railway.x-growth.toml` catalog aligned to EventBridge.

**Status.** `fix/x-replies-off-schedule-stale` → PR (schedule-window helper; superseded by operator OFF policy below).

## 2026-07-30 — [ops] X marketing OFF — operator standing order (#1312)

**Severity.** P1 ops false positive — **not** a prod outage.

**Symptom.** ops-auto-fix #1312 flagged `x-replies` stale; agent began tuning cron schedule windows.

**Root cause.** Operator previously requested **all X bot/marketing automation stopped**. Secrets
already had `X_MARKETING_POSTS_PAUSED=1` + `X_MENTION_REPLIES_PAUSED=1`, but EventBridge rules had
been re-enabled by prior ops fixes (#1277, #1287). Stale watchdog noise is expected when X is off.

**Fix (this session).** Disabled EventBridge `blackout-production-x-{autopost,growth,replies,analytics}`;
forced ECS redeploy for pause env; documented standing OFF policy in `docs/ops/X-MARKETING.md` +
`OPS-AUTO-FIX.md`; `ops-collect` skips X cron watchdog items when pause flags set in Secrets Manager.

**Status.** CLOSED — do not re-enable without explicit operator request.

## 2026-07-29 — [SPX] EOD Pin Forecaster glued ~120pts below spot (weak far wall)

**Severity.** P1 — SPX Slayer EOD Pin panel + Vector "Pin" axis tag looked frozen all afternoon;
traders saw projected close ~7313 while spot ~7420–7430 (−110 to −120pts) with only 15% confidence.

**Evidence (live 2026-07-29 ~14:41–14:46 ET).**
- `GET /api/market/spx/pin`: spot 7422.87 → projectedClose **7312.29**, magnet put_wall **7300 @ 3% OI**,
  pinPct 0.15; 12s later spot −2.6pts but proj moved only −0.26 (visually static at 1dp).
- UI screenshots: Projected close 7,313.4 → 7,313.3 over 32s; "pins to 7,313 put wall" (mislabeled).

**Root cause.**
1. `oiWalls` picked walls by **raw max OI** on each side of spot — a thin far put at 7300 won a
   fragmented book.
2. `pullFraction` ignored `magnetStrengthPct` — short-γ base 0.9 × accelerating charm ≈ **90% pull**
   to that 3% wall → projected close glued near the magnet, so spot ticks barely moved the headline.
3. MC seed `floor(nowMs/60_000)` only changed once/minute → MC overlay looked frozen across polls.
4. UI "pins to {pinPx}" showed the unsnapped close, not the magnet strike.

**Fix.** Distance-weighted wall score `oi/(1+|K−S|/spacing)`; strength-scaled pull via
`magnetPullScale`; weak-wall (&lt;5% OI) prefers nearer max pain; MC seed every 5s; UI labels magnet
strike. Tests cover the live regression.

**Status.** MERGED via `cursor/spx-pin-weak-magnet-3d11`.

## 2026-07-29 — [Thermal] Matrix asof 25–60s while SPX Slayer stays ~5s; SPY blanks

**Severity.** P1 — Thermal compare desk (`/heatmap?compare=1`) showed `MATRIX · 25s` /
`45s` on SPY/QQQ while SPX column + Slayer rail stayed ~4–5s; SPY sometimes flashed
"No matrix yet" / empty strip (spot **0.00**).

**Evidence.** Live UI screenshot 2026-07-29 ~14:50 ET: SPY 25s, SPX 4s, QQQ ~45s.
Later screenshot: SPY column **No matrix yet** + spot **0.00** while SPX/QQQ painted.
EventBridge `heatmap-warm` = 1/min floor. Client polled 5s but served SWR without age-based
`?force=1`. Transient `available:false` / `spot:0` emptyHeatmap replaced a good matrix.
`Number.isFinite(0)` showed **0.00** instead of —.

**Fix.** Age-based force (>8s); last-good + session cache; heatmap-warm forces SPY/SPX/QQQ
first; rth-warm-leader ~20s; refuse to display spot≤0; reject WS/REST spot≤0 before caching empty.

**Status.** `cursor/thermal-matrix-fresh-3d11` → PR.

## 2026-07-29 — [ops] ops-auto-fix #1247 — stale GitHub secrets + false cron failures

**Severity.** P1 — `ops-collect` reported `postgres:query-failed` (user `postgres`) and
`watchdog:http` 401; blocked autonomous ops loop.

**Root cause.** (1) `resolveAuditDbUrl()` preferred stale `DATABASE_PUBLIC_URL` GitHub
secret over AWS Secrets Manager; (2) Cloud Agent pods lacked `aws` CLI so `auditSecret()`
fell back to stale env `CRON_SECRET`; (3) `data-correctness` logged `ok:false` when
FLAGS were found (cron ran fine); (4) `socket-health` on web tier failed options cluster
read when Redis SCAN unavailable.

**Fix.** `auditSecret()` for DB URL; `@aws-sdk/client-secrets-manager` SDK fallback in
`prod-secrets.mjs`; `ops-auto-fix.yml` uses AWS creds (not legacy GitHub DB/CRON secrets);
skip postgres audit on unreachable/stale-auth hosts; data-correctness `logCronRun({ok:true})`
on successful sweep; options cluster health treats ingest leader lock as live.

**Status.** PR `fix/ops-auto-fix-secrets-1247` → `main`.

## 2026-07-29 — [Swing] Discovery cron 100% FailedInvocations — board permanently empty

**Severity.** P0 — Night Hawk Swing lane showed 0 watch / 0 commits all session. EventBridge
fired the rule; nothing ever landed a serving snapshot with plays.

**Evidence (prod 2026-07-29).**
- EventBridge `blackout-production-swing-discovery`: **38 Invocations / 38 FailedInvocations** (24h).
- `swing-active-refresh`: **8 / 8 Failed**.
- Lambda hit-cron path stats: **0** successful `/api/cron/swing-discovery` completions in 7 days.
- Manual `GET ?force=1` → ALB **504**; subsequent fire → `phase MIDDAY already claimed` (idempotent skip).
- `?view=swings` → structured empty lane; `scoreFloorGraduated=false`.

**Root cause (three stacked failures).**
1. **60s abort chain:** Lambda hit-cron hardcoded `timeoutMs = 60_000`; ALB `idle_timeout = 60`;
   whole-market Tier-1 enrich (40 names × news/earnings/IV/chain, sequential) routinely exceeds 60s
   → AbortError / 504 → EventBridge FailedInvocations.
2. **Claim-before-success burns the phase:** `sharedCacheSetNx(..., 22h)` ran *before* the scan.
   A timed-out attempt left the NX key stuck → every re-fire skipped for the rest of the day.
3. **Horizons only spliced Swing on `?view=swings`:** default all-lanes board kept the empty 0DTE
   placeholder even when a snapshot existed.

**Fix.**
- Two-stage claim: short **running** TTL (3m) → upgrade to **done** (22h) only after persist;
  release on throw; `?force=1` clears claim.
- Parallel Tier-1 enrich (`enrichConcurrency: 8`).
- Always splice persisted Swing lane into horizons (all views).
- `scripts/hit-cron.mjs` default timeout **120s**; Lambda code + `CRON_HTTP_TIMEOUT_MS=120000`;
  ALB idle_timeout **120s** (surgical AWS).

**Blast radius.** Heavy crons (bie-full-state, zerodte-warm) also benefit from 120s budget.
Swing commits remain graduation-gated (cold book → `commitEligibleCount=0` until n≥10) — this
fix only restores the WATCH/serving write path.

**Status.** This PR + live Lambda/ALB patch.

## 2026-07-29 — [ops] ops-auto-fix #1270 — data-integrity SQL merge conflict → error spike

**Severity.** P0 — `watchdog:error-spike` (109 errors / 15m).

**Root cause.** Accidental `<<<<<<< HEAD` merge conflict markers left in
`data-integrity-verifier.ts` nighthawk_play_outcomes SQL probe. Every
`data-correctness` cron run threw `syntax error at or near "("` → `request_error`
rows flooded `error_events`.

**Fix.** Remove conflict markers; keep dynamic `NH_OUTCOME_VOCAB` `${vocabSql}` list.

**Status.** PR `fix/ops-auto-fix-1270` → `main`.

## 2026-07-29 — [ops] ops-auto-fix #1261 — SWR background refresh + private RDS false P1

**Severity.** P1 — `ops-collect` reported `postgres:query-failed` (empty detail) and
`watchdog:error-spike` (38–54 `unhandled_rejection` TimeoutErrors / 15m).

**Root cause.** (1) `ops-collect` attempted Postgres via private RDS proxy URL when
`DATABASE_PUBLIC_URL` is unset (GHA/cloud agents cannot reach VPC); (2) `withServerCache`
stale-while-revalidate fired `void refreshCache()` on expiry — `refreshCache` re-threw after
logging, so Polygon `trackedFetch` timeouts became `unhandledRejection` → `error_events` spike.

**Fix.** Skip Postgres audit when only private VPC URL is configured; `refreshCacheInBackground`
swallows errors on fire-and-forget SWR refreshes.

**Status.** PR `fix/ops-auto-fix-1261` → `main`.

## 2026-07-29 — [Ops] Cloud-agent audit CRON_SECRET stale + NH `unfilled` verifier gap

**Severity.** P1 — RTH crons (`data-correctness`, `socket-health`, `zerodte-warm`) returned
401/503 in cloud-agent sweeps; `data-correctness` flagged 15 bogus `pg_nh_outcomes` rows.

**Root cause.** (1) `loadProdSecretsFromAws()` called `aws` on PATH — cloud images install
the CLI to `/home/ubuntu/.local/bin/aws`, so SM fetch failed silently and `auditSecret`
fell back to a stale 44-char env `CRON_SECRET` vs prod 48-char. (2) `audit-auth-fetch`
did not fall through to Clerk on cron 401. (3) `data-integrity-verifier` outcome vocabulary
omitted `unfilled` (added to DB CHECK in `db.ts` PR-N1) → false P1 on honest grades.

**Fix.** `prod-secrets.mjs` resolves AWS CLI from common paths; `audit-auth-fetch.mjs`
uses `auditSecret` + Clerk on 401/403; verifier includes `unfilled`; grid-rth nested
`validate:rth-open` timeout 300s + 10MB buffer.

**Evidence.** Pre-fix: `curl data-correctness` → 401; post-fix SM load 81 keys, CRON 48
chars, `validate:rth-open` GREEN, options-socket authenticated.

**Status.** PR #1250.

## 2026-07-29 — [0DTE] G-9 `plan_quote_stale` false-positive on live REST books

**Severity.** P0 — AAPL/MU/GOOGL cleared score/confluence but stayed BLOCKED on
`plan_quote_stale` while marks SSE showed fresh mids (1–3s). Starved OPEN commits.

**Root cause.** Plan attach measured quote age from `last_quote.last_updated` (ns→ms).
That exchange clock often stamps **prior session close** even when the unified-snapshot
REST response just returned a live two-sided NBBO — so age ≫ 60s and G-9 fired.

**Fix.** Attach `observedAtMs` on live fetch / cache read; `attachContractPlans` uses
`observedAtMs ?? quoteUpdatedMs` for G-9. `GATE_VERSION=v7`.

**Status.** Same PR as open-play uncap (`cursor/zerodte-uncap-open-plays-3d11`).

## 2026-07-29 — [0DTE] Open-play concurrent cap was starving the desk (6 → 100)

**Severity.** P0 product — operator never wanted an artificial limit on OPEN 0DTE plays;
the desk should commit every setup that clears quality + risk gates.

**Root cause.** `GOVERNOR_MAX_CONCURRENT_PLANS = 6` hard-blocked new commits with
`governor_max_concurrent` once six plans were live. That was framed as risk control, but
the real capital brakes are already the per-play −50% stop, 3-stop session halt, 5-loser /
−120% session-loss floor, and opposing correlated conflict. The concurrent cap was a
**scarcity throttle** that discarded better late-morning setups after early fills.

**Upstream seat budgets also starved the merge:** FLOW `maxSetups: 20`,
`BREAKOUT_MAX_CANDIDATES=25`, `PIN_MAX_CANDIDATES=8`, and `ZERODTE_LIVE_CONTRACT_CAP=16`
(marks lane would silently drop OCCs past 16 even if more committed).

**Fix.**
- Concurrent default **100**, env `ZERODTE_MAX_CONCURRENT` (`0` = unlimited).
- FLOW `maxSetups` **48**; BREAKOUT seats **40**/side; PIN seats **16**.
- Live marks cap **100** (tracks the open book).
- `GOVERNOR_VERSION=v2`. Session stop/loss + correlated-oppose unchanged.

**Status.** PR `cursor/zerodte-uncap-open-plays-3d11`.

## 2026-07-29 — [0DTE] BREAKOUT live but built 0 — board looked FLOW-only after multi-rail merge

**Severity.** P0 — multi-rail (#1199 MERGE v2 + flags ON) was deployed, yet every RTH scan
logged `BREAKOUT=0 PIN=0` and the desk showed only FLOW WATCH cards (0 OPEN).

**Root cause (not a flag/merge regression).**
1. **`BREAKOUT_MAX_PRICE = 400`** in `candidates.ts` screened OUT the liquid 0DTE names that
   were actually moving (live 10:40 ET: MU ≈ $783, AMD ≈ $432, META ≈ $589).
2. Momentum-top chain budget then spent on sub-$100 % movers whose nearest listed expiry was
   a **weekly** (Aug 21 / Jul 31 = dte≥2). Horizon integrity correctly returns null from
   `pickAtmZeroDteContract` → `built 0 setup(s) from momentum-top 24L + 25S` every cycle.
3. PIN separately SKIP'd (`no clean pin regime`) — CONDOR therefore had no seat. FLOW-only
   mix was a **funnel artifact**, not MERGE v1 coming back.

**Evidence.** Market-worker logs: `merge_policy=v2`, `ZERODTE_SRC_BREAKOUT=1`, breakout
pool non-empty, built 0. Polygon: top-80 momentum longs had **0** with `expiration_date=today`;
MU/AMD failed the $400 screen despite −6%/−4.6% with weak closes.

**Fix.** `BREAKOUT_MAX_PRICE` → **$2,500**; BREAKOUT discovery **walks** a wider momentum
rank until same-day setups fill (log `no_chain` / `no_same_day`); `DISCOVERY_VERSION=v4`.

**Status.** PR `cursor/zerodte-breakout-price-cap-3d11`.

## 2026-07-29 — [Security] Medium hygiene: cron redact + Largo budget + flows rate limit

**Severity.** MEDIUM (cron info leak / budget race / desk abuse) + infra notes.

**Verified.**
1. **CSP nonce** — REAL but HARD. `next.config.mjs` still has `'unsafe-inline'/'unsafe-eval'`;
   TradingView hosts are **legacy** (desk uses `lightweight-charts`). Full nonce needs
   Next+Clerk+CF Transform Rule sync + live QA. **Deferred** (not this PR).
2. **Per-user flow/SSE limits** — PARTIAL → fixed for `/api/market/flows` + `flows/stream`
   (120/min REST, 30/min SSE connect attempts; env-overridable). Other SSE routes still
   instance-capped only.
3. **DATABASE_SSL_STRICT=1** — REAL and **worse than assumed**: Secrets Manager had
   `DATABASE_SSL_STRICT=true`, but `db.ts` only treated `=== "1"` as strict — so verify
   stayed **off** in prod despite the key existing. Fixed parser (`1|true|yes`) + normalized
   secret to `"1"`. Takes effect on next ECS task launch (this PR's deploy).
4. **Cron error redaction** — REAL, undercounted (~14 not 8). HTTP bodies no longer echo
   `err.message` / `detail`; `logCronRun` still keeps detail. Guard test added.
5. **Largo budget optimistic INCR** — REAL. Replaced check-then-act with atomic
   reserve Lua (INCR + DECR if over cap) before work.

**Status.** Code fixes on `cursor/security-medium-hygiene-3d11`. CSP deferred; SSL env ops.

## 2026-07-29 — [Security] Open redirect in Clerk middleware + SW push URL

**Severity.** HIGH (open redirect) / MEDIUM (push notification phishing).

**Root cause.** `middleware-clerk.ts` passed raw `redirect_url` into
`new URL(dest, req.url)` — absolute URLs override the base
(`new URL("https://evil.com", base)` → attacker). `clerkPostAuthReturnPath` was
imported but unused on that path. `public/sw.js` `notificationclick` opened
push-payload URLs without same-origin checks.

**Evidence.** Live on `main` at review of PR #1226; #1226's security commit is
correct but the PR also re-ships already-merged #1221/#1224 cache work (merge
conflicts / draft). Helper previously turned `//evil.com/phish` → `/phish`
(pathname coincidence) — hardened.

**Fix.** `isSafeAppRelativePath` + `clerkPostAuthReturnPath` on all middleware
redirect_url sites (incl. staging satellite); SW relative-path gate; tests.

**Status.** Merged #1227 (supersedes #1226 security slice).

## 2026-07-29 — [Latency] Auth-gate Clerk storm + desk/marketing TTFB/LCP wins

**Severity.** P0 TTFB (auth) + P1 first-paint / LCP — verified real against `main`.

**Root cause (P0).** `isAdminUser` only short-circuited JWT `role === "admin"`; JWT
`"member"` still hit Clerk Backend HTTPS (~100–300ms). `userCanAccessTool` called
`isAdminUser(userId)` **without** sessionClaims, so the JWT path never fired there.
`canAccessTool` also detoured through `getAdminStatus` → `getUserProfile` (another
getUser). Same page render: layout + `requireTier` + `canAccessTool` → 3–5 Clerk
calls. Class already fixed once in `tier-cache.ts` (502 rate-limit comment) but never
applied to the tool-access gate.

**Also verified REAL.** No `next/image` (homepage emblem raw `<img>`); Night Hawk no
SSR seed (client SWR waterfall); VectorPageShell 1Hz `setNow` full-tree re-render;
gex-heatmap sequential overlays/nighthawk/cross-val; ContractDrilldownDrawer static
recharts; gex-matrix-deltas SSE no heartbeat + cancel unsubscribe leak; LandingRedesignFx
eager on homepage; ~9MB orphan `public/images/*` assets.

**Fix.**
- `adminFromJwtRole` + JWT member short-circuit; `getClerkUserCached` (5s coalesce);
  pass sessionClaims through tool-access; drop getAdminStatus from page gate.
- Night Hawk `loadNightHawkSeedProps` → SWR `fallbackData` on ZeroDteDeck.
- Homepage `next/image` + priority; dynamic LandingRedesignFx; delete dead assets.
- FreshnessChip `staleAfterMs` (kill Vector 1Hz parent timer); Thermal matrix chip leaf.
- gex-heatmap `Promise.all`; SSE heartbeat + cancel cleanup; Helix drawer dynamic.

**Status.** PR #1225 (branch `cursor/latency-audit-perf-3d11`).

## 2026-07-29 — [Cache] Members hit stale desk / wrong auth chrome — CF + origin gaps

**Severity.** P0 UX / Truth — members reported massively stale pages; `/sign-up` error class
overlaps ChunkLoadError (#1220); live probe showed `/upgrade` CF HIT without CDN no-store and
an auth-gated API force-cached at the edge.

**Evidence (live 2026-07-29).**
- `/upgrade` → `cf-cache-status: HIT`, **no** `CDN-Cache-Control` (auth-dependent chrome).
- `/` → `cdn-cache-control: no-store` yet `cf-cache-status: HIT` (`age: 2300`) — HTML Cache
  Rule #6 `override_origin` 2h for anon (expected for speed; signed-in bypasses via `__session`).
- CF Cache Rule cached **`/api/market/gex-positioning` 60s override_origin** while the route is
  **auth-gated** — cross-user / stale GEX risk.
- PR #1221 closed 50+ origin routes missing `CDN-Cache-Control` but left track-record / signals /
  largo / streams / membership/sync incomplete; `NO_STORE_HEADERS` lacked Cloudflare-CDN twin.

**Fix.**
1. Merged #1221 (origin CDN headers + marketing force-static cleanup + purge list).
2. **Disabled** CF gex-positioning cache rule; purged entire zone.
3. Follow-up: strengthen `NO_STORE_HEADERS` (+ Cloudflare-CDN), `/upgrade` next.config +
   middleware no-edge-cache, remaining member/admin routes + stream headers, guard test,
   `CLOUDFLARE_CONFIG.md` corrected.

**Speed posture.** Keep caching `/_next/static`, images, anon marketing HTML. Never cache
auth-gated JSON. Signed-in HTML bypasses via `__session`.

**Status.** Open — this PR (after #1221).

## 2026-07-29 — [Night Hawk Legacy] Replay harness + polarity measure + recap reason

**Severity.** P1 tooling / honesty — could not counterfactual score floors or quantify
flow-polarity misreads; members saw recap-only with no funnel reason.

**What shipped (measure first; scorer unchanged).**
1. `buildEveningEdition({ asOfEt, dryRun, persist })` + `fetchMarketWideContext({ asOfEt })` —
   historical asOfEt defaults to dry-run (no DB write). Live publish path skips upsert when
   `checkpointing` is false.
2. `npm run sim:nighthawk-evening` — `--mode=floor` offline counterfactual; `--mode=live --as-of=`
   dry-run full builder with score-floor table on returned plays.
3. `npm run probe:nighthawk-flow-polarity` — Legacy call/put vs signed-aggression disagreement
   rate (`flow-polarity.ts`). **No scorer change** until measured rate justifies it.
4. `recap_only_reason` mapped from `meta` → `NightHawkEdition` → PlaybookBoard empty-state copy.

**Deliberately not shipped.** Position sizing. Scorer polarity flip (await polarity probe evidence).

**Status.** Open — this PR.

## 2026-07-29 — [Night Hawk Legacy] Soft hedge/rescue floors shipped score-20 filler

**Severity.** P0 product — Legacy overnight digest published noise next to one real name.

**Evidence (live `GET /api/market/nighthawk/edition`, ~2026-07-29).**
- `edition_for: 2026-07-30`, `published_at: 2026-07-29T04:06:41Z`
- Plays: **AMZN LONG @ 49**, **AI LONG @ 26**, **SNDQ LONG @ 20**
- AI/SNDQ theses empty (`"mixed ·"`) — classic diversity/hedge/backfill filler under the old
  soft floors (`DIVERSITY_HEDGE_FLOOR=20`, `FORCED_CONTRARIAN_FLOOR=25`) plus promote-to-5
  rescue that padded the book after publish gates.

**Root cause.** Volume-first loosenings in the Legacy pipeline:
1. Diversity/forced-contrarian floors at 20/25 admitted rounding-noise scores into hedge slots.
2. Thin-edition backfill reused the hedge floor instead of `MIN_PUBLISH_SCORE` (42).
3. Critic-zero rescue + `promoteTopBlocked` padded toward `EDITION_TARGET_PLAYS` (5) with
   gate-failed / low-score plays rather than stopping at the ops minimum (3).
4. Geometry `MIN_RR_RATIO` was 0.5 while `play-levels` already enforced 0.75 — asymmetric.

**Fix (precision restore).**
- `DIVERSITY_HEDGE_FLOOR` / `FORCED_CONTRARIAN_FLOOR` → **35** (still below organic 42).
- Backfill + `GATE_PROMOTE_MIN_SCORE` → **`MIN_PUBLISH_SCORE` (42)**.
- Critic rescue / promote-blocked only fill to **`EDITION_MIN_PUBLISH_PLAYS` (3)** — prefer a
  clean 3-play book over 5 with garbage hedges.
- `play-constraints` `MIN_RR_RATIO` → **0.75** (aligned with levels builder).

**Blast radius.** Fewer Legacy plays on thin nights; more recap-only / 3-play books. Morning
confirm + outcomes unchanged. Force-rebuild the live edition after deploy so members do not
keep AI@26/SNDQ@20 until the next evening cron.

**Post-deploy verify.** Force `nighthawk-edition?force=1` after #1219 deploy → new edition
`published_at: 2026-07-29T06:13:41Z` — NVDA@71 / AAPL@67 / GOOG@60 / COST@59 / EWZ@55 (all B,
no gate_promoted, no sub-35 filler). Evening window will rebuild again on post-close data.

**Status.** Merged #1219.

## 2026-07-29 — [0DTE] Precision harden — stop opening measured-losing commits

**Severity.** P0 product — graded book **35.6% WR (36W/65L, n=101)** sits on the −50/+100
breakeven line (~33%). Funnel remodel (#1199) shipped multi-rail discovery; edge did not.

**Root cause (architecture diagnosis).** The *spine* (discovery → gates → Cortex → governor →
ledger → exits → grade) is sound. What weakened the book were **volume-first loosenings** that
reopened measured-losing buckets:
1. G-12 confluence default **1** (1-conf = 0% EV; only 2-conf = +15.9% EV).
2. BREAKOUT/PIN G-3 floor **58** (inside the flat/toxic 55–64 band).
3. Cortex veto-blind **ABSTAIN** (2026-07-27) — fresh commits opened without gex-walls +
   flow-quality veto protection (Phase-0 firewall leak #1).
4. Aggression share cleared on the **0.5 neutral default** when `ask_pct` was missing (#1028 held).

**Fix (precision restore, env-overridable).**
- `ZERODTE_CONFLUENCE_MIN` / `_EARLY` default **2**.
- BREAKOUT/PIN score floors → **65** (same as FLOW).
- `failClosedOnVetoBlind:true` → **VETO_BLIND HOLD** again (`cortex_veto_blind`).
- `SETUP_MIN_KNOWN_AGGR_FRAC = 0.5` — no aggressor metadata ⇒ reject.
- `GATE_VERSION=v6`, `CORTEX_VERSION=v2` (calibration partitions the new cohort).

**Blast radius.** Fewer directional commits; WATCH/SKIP cards rise. Condor path unchanged
(G-12/G-1 skipped for condors). Ops can dial `ZERODTE_CONFLUENCE_MIN=1` if the board empties
under provider stress — do not leave it there.

**Status.** Merged #1217.

## 2026-07-29 — [Thermal] Near-Term Triple Desk extreme cells look “broken”

**Severity.** P1 UX — yellow/purple call/put-wall cells misalign, overflow neighbors, and
pulse out of the grid on the SPY|SPX|QQQ compare desk.

**Symptom.** On Near-Term Triple Desk, extreme nodes (yellow PLUS / purple MINUS) appear
offset, clipped, or larger than surrounding cells; ★ king marks widen values and fight the
5-column layout. Operator screenshot marked those cells as visually broken.

**Root cause.** `ThermalCompactMatrix` applied the shared class `gex-heatmap-extreme-pop`
(globals.css) to `<td>` cells. That class sets `display: inline-block` and animates
`transform: scale(1.16)` — fine for SPX Slayer inline spans, catastrophic for table cells in
a tight 5-expiry grid (`min-width: 3.4rem` columns). Inline ★ after the money label also
inflated cell width.

**Fix.** Compact desk uses `thermal-compact-cell--extreme` (brightness-only pulse, stays
`table-cell`, `overflow: hidden`). King ★ moves to a corner badge. Near-term column/cell
min-width raised to ~4.85rem so `+$261.0M`-class labels fit.

**Status.** Merged #1216.

## 2026-07-29 — [Night Hawk Legacy] Stale edition: cron never rebuilds after market close

**Severity.** P0 — Legacy tab shows pre-market plays night after night; the whole purpose of
Night Hawk Legacy is fresh post-close plays for members.

**Symptom.** Legacy tab shows the same 5 plays (IREN/ISRG/SNDK/ORCL/XYZ) indefinitely. The
edition for 2026-07-29 was `published_at: 2026-07-28T10:49:14Z` (6:49 AM ET) — built with
pre-market data, before the market even opened. Evening cron fires at 5:30 PM ET but never
overwrites it.

**Root cause.** `buildEveningEdition` (edition-builder.ts:376): when `job.status === "published"`
and `opts.force` is false, the function returned immediately with `resumed: true` — no rebuild.
There was no check for WHEN the edition was published. A premature build (from a checkpoint
resume, a mis-timed trigger, or a Friday→Monday carry) locked the edition forever until
someone called `?force=1`.

**Evidence.** Production probe: authenticated temp user → `GET /api/market/nighthawk/edition`
→ `edition_for: 2026-07-29`, `published_at: 2026-07-28T10:49:14.000Z`, `stale: false`. The
plays had real contracts (IREN $36.5 PUT @ $3.65, etc.) but built from stale pre-market flow
data — wrong plays for tonight.

**Fix.** When `buildEveningEdition` is called inside the edition window (5:30-7:30 PM ET on
a trading day) and the existing edition was published before today's window start (ET
timestamp comparison), auto-rebuild: archive+clear staging, reset job to "running", run full
pipeline with fresh post-close data. Editions published within the current window are already
fresh and skip as before.

**Second fix.** `MIN_DTE_CALENDAR_DAYS` lowered from 5 to 2 — the old 5-day floor starved
TACTICAL sub-lane (2-7 DTE) contracts from the Legacy edition. A 3-DTE contract that passes
every gate was demoted to a last-resort pool.

**Status.** PR #1211 — pushed, CI green on first commit, awaiting rate-limit reset to undraft
and merge. Both fixes on `claude/wall-beads-data-validation-4re5wo`.

## 2026-07-29 — [Thermal] Discord card still unreadable on mobile (nodes/drift)

**Severity.** P1 UX.

**Symptom.** After #1206 deploy, Discord mobile still looked “broken”: multi-expiry tiny
cells hid yellow/purple nodes; caption legend mangled (`Yellow !! = node`) from markdown;
DRIFT column too narrow to survive Discord downscale.

**Root cause.** 8-expiry dense grid at 4K becomes ~unreadable when Discord compresses for
phone; free-text `+`/`−`/`★`/`=` in the caption is unsafe under Discord markdown.

**Fix.** Discord card = **0DTE-only** fat strip (STRIKE | DRIFT% pill | GEX); PLUS/MINUS/KING
badges on wall rows; Discord-safe legend in a code span; taller strike band (half=28).

**Status.** PR `cursor/thermal-discord-card-fix-3d11`.

## 2026-07-29 — [Thermal] Discord cron “boxes” — ECS has no fonts for Sharp SVG text

**Severity.** P0 UX (cron PNG unreadable; manual local posts looked fine).

**Symptom.** EventBridge `/api/cron/thermal-discord` posts showed solid yellow /
purple / green / orange rectangles / hollow tofu □□□ (“boxes”) instead of strike
+ GEX $ labels. Same renderer looked correct when posted from a Cloud Agent /
laptop.

**Root cause.** Manual post = laptop/agent **has fonts**. Cron = ECS
`node:20-bookworm-slim` had **zero fonts**. Sharp→librsvg/pango skips `<text>`
→ only colored `<rect>` fills remain (or missing-glyph tofu boxes).

**Fix.**
1. Install `fonts-dejavu-core` in the runner image (#1213).
2. **Embed** DejaVu Sans Mono as base64 `@font-face` in the SVG + ship TTFs under
   `deploy/fonts/` copied into the image — cron no longer depends on fontconfig.

**Status.** PR `cursor/thermal-discord-embed-font-3d11`.

## 2026-07-29 — [Thermal] Discord “No numbers” — settled empty 0DTE after close

**Severity.** P1 UX (blank Discord grids).

**Symptom.** Post-RTH Discord Thermal PNG showed empty dark grids — no yellow/purple nodes,
no GEX $ labels (“No numbers”), while caption still said 0DTE and Drift: collecting.

**Root cause.** Desk forced today’s calendar expiry. After 0DTE settlement every cell in-band
was `$0` → heat fill empty + labels were `·` (zero suppressed). Multi-expiry older cards
still looked full because other expiries retained exposure.

**Evidence.** Live cache for `2026-07-28` 0DTE band: `0/57` nonzero GEX cells; next near-term
expiry still populated.

**Fix.** Discord card restored to **SPX Slayer–style tight near-term matrix** (≤6 expiry
cols, strike half=14); `resolveDiscordNearExpiries` skips empty settled today-0DTE;
`fmtCompactHeatMoney` always prints `$` amounts; yellow/purple nodes + ★ king per column.

**Status.** PR `cursor/thermal-discord-card-fix-3d11`.

## 2026-07-28 — [Thermal] Discord card missing yellow/purple nodes + % drift

**Severity.** P1 UX (desk card readability / parity with major matrix).

**Symptom.** Live Discord Thermal PNG showed only green/red cells — no yellow + node /
purple − node highlights, and no per-strike DRIFT % (build/melt) column.

**Root cause.** `thermal-discord-card.ts` painted every cell with signed green/red fills
only; never computed per-expiry extremes or read `heatmap.shift.delta_by_strike`.

**Fix.** Per-expiry +node/#ffd60a and −node/#d97bff (same beads as major matrix), ★ king
label, DRIFT % column from live shift (honest `·` while collecting), caption wall-drift +
legend line.

**Status.** PR `cursor/thermal-discord-nodes-drift-3d11`.

## 2026-07-28 — [Thermal] Discord #admin-talk spam (no post dedupe)

**Severity.** P1 ops / UX (channel flood).

**Symptom.** `#admin-talk` filled with identical Thermal desk posts (old C/P caption + 4K Call/Put
wall caption mixed) within minutes.

**Root cause.**
1. `/api/cron/thermal-discord` had **no cross-replica idempotency** — every authorized hit posted.
2. Deploy debugging force-hit `?force=1` many times against ECS/ALB while rolling task defs.
3. EventBridge `*/15` plus overlapping retries could double-post under multi-web-task races.

**Evidence.** Mobile Discord screenshots: repeated “Thermal desk - GEX” / SPY~741 / SPX~7428 blocks;
EventBridge rule paused (`DISABLED`) to stop the firehose.

**Fix.** Redis NX claim `thermal-discord:posted` (TTL 14m) before render; bare `force=1` still
dedupes; only `force=1&allow_dup=1` bypasses. Release claim on render/empty/502 so retries work.
EventBridge stays DISABLED until this ships, then re-enable.

**Status.** PR `cursor/thermal-discord-dedupe-3d11`.

## 2026-07-28 — [Thermal] Compare triple desk unreadable (7.5px / 1.85rem cells)

**Severity.** P1 UX.

**Symptom.** Compare ON matrices (SPY|SPX|QQQ) were too small to read — ultra-dense
`thermal-compact-*` CSS (7.5px cell text, 1.85rem expiry cols, 62vh/520px scroll).
Operator reference: tall 0DTE heat strips with a synced horizontal cursor.

**Root cause.** Triple desk shipped with “fit three desks in one viewport” density that
crushed fonts/columns far below the major Thermal matrix / 0DTE strip aesthetic.

**Fix.** Default compare mode = **0DTE** single-expiry heat strip (Near toggle for multi);
13px labels; **green/red** signed heat (not viridis); **yellow + node / purple − node /
★ king** via same `heatmapMatrixExtremeCellStyle` as major matrix; ~81-strike ladder;
tall scroll; synced crosshair + scroll across SPY|SPX|QQQ.

**Status.** PR `cursor/thermal-compare-matrix-size-3d11`.

## 2026-07-28 — [Thermal] Discord desk card → 4K + clearer UI chrome

**Severity.** P2 UX.

**Ask.** Posts were hard to read in Discord — bump to 4K and label UI elements clearly.

**Fix.** `thermal-discord-card.ts` renders **3840×2160** (4K); column chips for CALL WALL / PUT WALL / FLIP;
ticker badge, spot + change%, desk-style expiry labels (`Jul 28`), legend footer, LIVE SNAPSHOT chip.
Caption uses Call wall / Put wall / Flip wording. (5120 ultra pass reverted — 4K preferred.)

**Status.** PR `cursor/thermal-discord-4k-card-3d11`.

## 2026-07-28 — [Thermal] Triple desk SPY|SPX|QQQ (dense matrices)

**Severity.** P1 product enhancement (desk density + compare UX).

**Ask.** Tighten expiry spacing so three live matrices (SPY / SPX / QQQ) sit side-by-side.

**Shipped on `cursor/thermal-deep-audit-3d11`.**
1. **`ThermalTripleDesk`** — three cache-reader columns (`/api/market/gex-heatmap`), 5s poll,
   per-column FreshnessChip + walls + active glow. Keys `1/2/3` focus; `G/V/D/C` switch lens.
2. **`ThermalCompactMatrix`** — near-term expiry cap (8) + ±14 strike band around spot;
   ultra-narrow expiry cols (~1.85rem) + dense money labels (`fmtCompactHeatMoney`).
3. **Pins + CSV** — strike pins in `localStorage`; per-column CSV export of the full chain.
4. **Compare toggle** now mounts the triple desk on the Matrix tab (default ON; `?compare=0` off).
   Single-ticker full matrix remains when Compare is off / Profile tab.

**Status.** PR #1200 (merging).

## 2026-07-28 — [Thermal] SPY/SPX/QQQ compare + per-layer freshness + deep-links

**Severity.** P1 product enhancement (honesty + desk speed).

**Shipped on `cursor/thermal-deep-audit-3d11`.**
1. **Compare strip** — live SPY / SPX / QQQ cards (spot, call/put wall, flip) on the shared
   5s heatmap cache-reader; click selects ticker. Toggle via control-row **Compare** (`?compare=0` off).
   Superseded as the Matrix hero by the triple desk (strip component retained).
2. **Per-layer FreshnessChip bar** — Matrix / Overlays / UW check ages + near-term wall-scope chip
   (never one fake LIVE for 5s + 30s + 60s layers).
3. **Deep-links** — `?ticker=SPX&lens=vex&compare=1` syncs URL ↔ desk.
4. **Honest flip empty** — undetermined flip help via `honestLevelEmpty("flip")`.

**Status.** PR #1200 (merging).

## 2026-07-28 — [Thermal] Deep audit: WS wall override still unscoped + stale 20s freshness copy

**Severity.** P1 correctness (RTH) + P2 UX honesty.

**Live probe (~22:19 UTC / 18:19 ET, admin).** SPY/SPX/QQQ/NVDA/IWM matrices `available:true`,
2835+ nonzero GEX cells on SPX, walls match positioning (WS idle after hours so unscoped bug
latent). SPX/SPY/QQQ `gex.flip=null` with honest “undetermined” regime read. `cross_validation=null`
(expected off-hours: scoped REST fallback skipped). Shift `available:false`/`collecting` (off-RTH
gate working). Page `/heatmap` 200, no Sign-In chrome for authed admin.

**Root causes fixed.**
1. **`/api/market/gex-heatmap` WS wall override unscoped** — `getGexStrikeExpiryLadder(ticker)` with
   no `nearTermExpiries` while `cross_validation` + `getGexPositioning` were already scoped
   (FINDINGS 2026-07-24). Thermal could paint far-OpEx walls next to near-term flip in RTH.
   Fix: resolve near-term once; pass to wall override + oracle.
2. **Stale “20s” freshness UX** — poll/TTL are 5s; `MATRIX_STALE_MS` was 40s with “20s window”
   copy. Fix: 15s amber threshold + 5s copy.

**Still open (adjacent, not this PR).**
- `spx-desk.ts` still has unscoped `getGexStrikeExpiryLadder("SPX")` on sticky fallback paths
- FreshnessChip institutional pattern unused (custom MatrixFreshness OK)
- Cold-cache latency under burst (WATCH)

**Status.** Fixed on `cursor/thermal-deep-audit-3d11`.
## 2026-07-28 — [Thermal] Discord triple-desk PNG cron (15m RTH)

**Severity.** P2 product enhancement.

**Ask.** Auto-post SPY|SPX|QQQ Thermal layout to a designated Discord channel every 15 minutes.

**Approach.** Server-rendered PNG from shared `fetchGexHeatmap` cache (sharp SVG→PNG) + Discord
multipart webhook — no Chromium on ECS. Route `/api/cron/thermal-discord`, catalog
`railway.thermal-discord.toml` (`*/15 * * * *` 24/7), inert without `DISCORD_THERMAL_WEBHOOK_URL`.
Optional `THERMAL_DISCORD_RTH_ONLY=1` to skip outside cash RTH.

**Status.** Draft PR `cursor/thermal-discord-desk-3d11`. Webhook stored in Secrets Manager only
(never committed). EventBridge rule must exist after sync.

## 2026-07-28 — [0DTE-funnel] CTO pass-3: still had bugs on the branch (1DTE commit + PIN rank)

**Severity.** P0 honesty / P1 recall — user challenge: line was **not** clean after pass-2.

**Bugs still on PR #1199 after pass-2 (fixed this pass).**
1. **1DTE still committed** — prefer-ZERO_DTE was sort-only; MU/AMD/AAPL etc. opened as ONE_DTE
   on a 0DTE product. Fix: **G-15 `not_zero_dte`** — fresh commit requires `contract_horizon=ZERO_DTE`
   (1DTE stays WATCH). `GATE_VERSION` → **v4**.
2. **PIN first-8 list-order** — evaluated `.slice(0,8)` before regime quality. Fix: evaluate up to
   `PIN_EVAL_CAP=20`, condor roots first, return top `PIN_MAX_CANDIDATES` by score.
3. **Stale ZeroDteBoard 15:00 copy/test** — updated to POST_COMMIT / 14:00.

**Still open (not claiming clean).**
- VIX elevated floor, edge/WR, CONDOR unproven live, prod undeployed.

**Status.** Fixed on draft PR #1199.

## 2026-07-28 — [0DTE-funnel] CTO audit pass-2: heat/CONDOR/ToD still broken after cutoff align

**Severity.** P0 — second deep read after pass-1 cutoff align found **four more commit/path bugs**
on the same branch that would have kept multi-rail / CONDOR starved even after deploy.

**Root causes (code — fixed this pass).**
1. **Heat/SKIP desync** — `sessionHeat` stayed `RTH` until 15:00 while G-14/persist die at 14:00 →
   cards stayed WATCH in a closed commit window (`board.ts` `sessionHeat` / `resolveFreshFindStatus`).
   Fix: `POST_COMMIT` heat 14:00–15:00; SKIP on that state.
2. **CONDOR merge wipe** — `mergeSameTickerDiscovery` same-dir kept FLOW incumbent and dropped
   `play_type`/`condor_plan` → SPX FLOW + SPX CONDOR never seated a condor. Fix: prefer CONDOR
   structure when exactly one side is CONDOR; score-tie opposing also prefers CONDOR.
3. **CONDOR late-theta dead** — G-14 exempted CONDOR but PIN discovery hard-stopped at 14:00 and
   `persistZeroDteScan` zeroed **all** fresh after cutoff. Fix: PIN late window 14:00–15:30
   condor-eligible roots only; persist allows fresh `play_type===CONDOR` past cutoff.
4. **ToD score fought the calendar** — lunch −3 through 14:00 + dead +3 after 14:00. Fix: lunch
   12:30–13:30; last commit hour neutral; post-14:00 zero.

**Still NOT fixed (intentional / product / edge).**
1. VIX≥17 elevated floor (starves weak FLOW on elevated days)
2. Edge / ~35.6% WR (funnel ≠ expectancy)
3. 1DTE still allowed on “0DTE” surface (`SETUP_MAX_DTE=1`)
4. PIN `.slice(0,8)` before regime rank (recall risk for condor roots if universe reorder)
5. Prod still on **main** — none of #1199 is live until merge+deploy

**Live re-probe (~22:05 UTC / 18:05 ET).** Still 1 ledger CLOSED (SPY FLOW), 8 setups 100% FLOW,
blocks: `late_afternoon@900`, `score_floor`, `vix_elevated`, `confluence_floor`, `plan_quote_stale`.
`GATE_VERSION` bump → **v3**.

**Status.** Fixed on draft PR #1199 (pass-2 commit); awaiting merge.

## 2026-07-28 — [0DTE-funnel] CTO deep audit: why only 1 play today (prod still on old engine)

**Severity.** P0 product — 2026-07-28 RTH produced **1 OPEN** (SPY FLOW @ 11:01 ET, +12% thesis_break).
Post-close board: **8 setups, 100% FLOW**, 7× BLOCKED, record **35.6% WR / n=101**.

**Live prod evidence (admin probe ~18:02 ET).**
- Heat CLOSED; `upstream_ok=true`
- Origin mix: `{ FLOW: 8 }` — 0 BREAKOUT / 0 PIN / 0 CONDOR
- Gate mix: 7× BLOCKED (dominant codes: `late_afternoon` threshold **900=15:00**, `plan_quote_stale`,
  `vix_elevated` VIX 19.05→score≥75, `score_floor` 65, `confluence_floor`)
- Several "0DTE" cards are **1DTE** (MU/AMD/AAPL/NVDA/SMH)
- PR #1199 **not deployed** — prod still `LATE_AFTERNOON=15:00`, `DISCOVERY/SCORER/GATE=v1`

**Root causes — fixed on draft PR #1199 (not live yet).**
| Cause | Fix on PR |
|---|---|
| FLOW-only merge v1 | MERGE v2 evidence-weighted |
| BREAKOUT/PIN score floors too high | rescale + G-3 origin floors 58 |
| NH edition tickers excluded | stop excluding |
| Caps / chain timeout | widened |
| G-14 at 15:00 (toxic 14–15:30) | → **14:00** |
| Cutoff desync (audit find) | confluence + BREAKOUT/PIN RTH windows still 15:00 → aligned **14:00** |

**NOT fixed by more commits (still open after merge).**
1. **VIX≥17 elevated floor** (score 75 when not tape-aligned) — intentional, but starves elevated-VIX days
2. **Edge / 35.6% WR** — funnel volume ≠ expectancy; needs RTH A/B after merge
3. **1DTE pollution** on a 0DTE product surface
4. **CONDOR path** still not producing visible seats
5. **After-hours `plan_quote_stale`** — expected; not a RTH commit bug

**Verdict.** We did **not** fix all root causes in production. The PR addresses the main starvation
stack; merge + one RTH day is required to prove multi-rail commits. Cutoff desync closed in the
same PR after this audit.

**Status.** OPEN draft PR #1199.

## 2026-07-28 — [0DTE-UI] Command Deck UX honesty (session strip, hard gate, nav, defaults)

**Severity.** P1 — live admin Chrome pass on prod `/nighthawk` (2026-07-28 ~17:50 ET) showed:
authed desk + **"Sign In"** nav; CLOSED SPY with **✗ Hard gate**; greeks `—` under SYNC with no
session-closed label; left rail filtered to CLOSED (hiding 6 WATCH); "LIVE THESIS MONITOR" copy
while nothing streamed.

**Root cause.**
1. Desk `Nav` trusted Clerk client `isSignedIn` only — no server `auth()` seed / `__client_uat` heal
   (marketing already had this; desk did not).
2. Hard gate treated CLOSED like WATCH — refresh-lane `BLOCKED` after close painted red on a play
   that had already committed.
3. Mark stream had no SESSION CLOSED state; greeks strip stayed visually "live-ready" with dashes.
4. Status filter defaulted to ALL but selection preferred sort-top (often CLOSED); no RTH-aware default.

**Fix (draft PR #1199).** Session-aware stream badge + dim greeks; CLOSED passes hard gate;
`initialSignedIn` + `__client_uat` heal on desk Nav; default filter OPEN/WATCH in RTH else ALL;
prefer working→watch selection; collapse thesis factors; Management rails distance lead; honest
monitor copy.

**Status.** OPEN on `cursor/zerodte-multi-rail-discovery-3d11` (draft PR #1199).

## 2026-07-28 — [0DTE-UI] Right-rail Thesis/Management/PnL panels looked static

**Severity.** P0 (member-facing) — the three Command Deck right-rail tabs on `/nighthawk` (0DTE)
showed frozen "—" marks / non-updating peak-trough / non-advancing underlying after hours and for
WATCH setups, even when the board payload carried live plan quotes.

**Root cause.**
1. `zerodte-sources.ts` `sourceFrom` set `last_mark` / `bid` / `ask` **only** from the ledger row.
   WATCH finds have no ledger mark — only `setup.plan.{mark,bid,ask,occ}` — so the adapter painted
   `mark: null` and the right rail stayed "—" until a fresh SSE tick.
2. After hours the marks lane returns `stale:true, mark:null` for every WATCH OCC (prod probe
   2026-07-28 ~17:40 ET: 7 marks, 0 with a mark). `overlayLiveMarks` correctly skips stale rows,
   so with (1) the panels never recovered to the board's plan quote.
3. Ledger payload omitted `occ` (`plan_json.occ` stayed server-side) → ledger-only working rows
   could not key the SSE overlay (`overlayLiveMarks` is OCC-keyed).
4. Peak/trough + trim FIRED only advanced on the server persist cycle; SSE `pnlPct` ticked ~1s
   but the PnL Peak/Trough and Management trim chips stayed board-frozen.
5. Underlying `stockPrice` only moved when the board snapshot rebuilt — no quote-poll overlay
   (Legacy already had `useLegacyStockQuotes`).

**Evidence.** Admin Clerk session against prod: MU WATCH `plan.mark=21.38` / `occ=O:MU…` on board;
marks API same OCC `mark:null stale:true`; ledger SPY CLOSED had `last_mark` but `occ` absent from
payload keys.

**Fix (draft PR #1199).**
- Plumb `plan.mark/bid/ask/occ` (+ ledger `occ`) in `zerodte-sources`; badge plan-only marks as SYNC.
- Emit `occ` on `ZeroDteBoardLedgerRow` from `plan_json.occ`.
- Client `latchLiveExcursion` in `overlayLiveMarks` for peak/trough + trim FIRED; stock-quote
  overlay for underlying/condor spot; RTH board poll 2.5s + loading skeleton; honest thesis monitor.

**Status.** OPEN on `cursor/zerodte-multi-rail-discovery-3d11` (draft PR #1199).

## 2026-07-28 — [product] 0DTE engine starved to 1 OPEN/day (score map + caps + NH exclude)

**Severity.** P0 — whole-market 0DTE product produced **1 committed play** on 2026-07-28
(SPY FLOW long @ 11:01 ET, +12% thesis_break) despite scanning ~12k grouped-daily names. Board
setups post-close were **8× FLOW-only**; BREAKOUT/PIN never committed. Record remains ~35.6% WR.

**Root cause (stacked funnel, not one bug).**
1. **BREAKOUT score map** required ~15%+ strong-close to clear G-3=65 → almost no whole-market
   movers ever became commits (8–10% liquid continuations scored ~34–49).
2. **PIN score map** similarly needed ~9%+ walls + 2% band — rare on live long-γ days.
3. **NH edition tickers excluded** from 0DTE discovery (`nighthawkCovered` in `scan.ts`) — removed
   the overnight playbook's best names from the live commit path.
4. **FLOW floors / caps** (`SETUP_MIN_GROSS` $300k, fetch `$150k`, `maxSetups:10`, enrich top-5)
   + **2.5s** chain snapshot timeout dropped otherwise-viable plans.
5. **G-14 still at 15:00** while FINDINGS already measured the toxic 14:00–15:30 bucket (14.3% WR).

**Evidence.** Prod board 2026-07-28: ledger_n=1 (SPY), setups 100% FLOW, health
`candidates_scanned=1`/`committed_count=1`. Calibration score bands: `<55` = 20% WR / −23% avg;
`55–64` ≈ flat. VIX day-open 19.05 (elevated).

**Fix (engine remodel on `cursor/zerodte-multi-rail-discovery-3d11`).**
- Rescale `breakoutScore` / `pinScore` so liquid 8–10% / mid-tier pins clear 65.
- Origin-aware G-3 floors (FLOW 65 / BREAKOUT+PIN 58).
- Stop excluding NH edition tickers; widen FLOW/BREAKOUT caps; enrich top-12; 5s snapshot.
- Ship G-14 + `NEW_PLAY_CUTOFF` to **14:00 ET**; prefer ZERO_DTE in commit ranking.
- Version bumps: `DISCOVERY_VERSION=v3`, `SCORER_VERSION=v2`, `GATE_VERSION=v2`.

**Status.** OPEN draft PR #1199 for review (do not auto-merge).

## 2026-07-28 — [product] 0DTE board was FLOW-only in practice (merge v1 + $-volume chain-fetch)

**Severity.** P1 — Night Hawk / 0DTE Command supposed to mix FLOW + BREAKOUT + PIN (+ CONDOR), but
live board ownership and outcomes behaved like a single-rail flow-momentum buyer.

**Root cause.**
1. `MERGE_POLICY_VERSION=v1` always kept the seating-order incumbent on direction conflict
   (`mergeDiscoveryOrigins` / `mergePinOrigins`), so BREAKOUT/PIN could only ever *annotate* a FLOW
   row — never own the ticket when they disagreed more strongly.
2. Opposing co-discovery still received the `+8` corroboration boost (PIN fades almost always oppose
   momentum), helping weak FLOW clears of G-3.
3. BREAKOUT chain-fetch took the top-N by **$-volume** after `screenBreakoutMovers`, so sharper
   mid-cap continuations lost the chain budget to mega-caps (discovery-recall-probe 2026-07-20…24).

**Evidence.** Prod 2026-07-28 post-close board: 8 setups, 100% FLOW origin; 0 BREAKOUT / 0 PIN /
0 CONDOR on the visible mix. 0DTE Command record ~35.6% WR / −2.87% avg (101 graded). (Post-close
BREAKOUT also skips via RTH window — expected — but RTH ownership was still FLOW-dominated.)

**Fix.** `MERGE_POLICY_VERSION=v2`: evidence-weighted conflict (higher score owns; seating-order
ties); corroboration boost **only** on same-direction union. `rankMoversForChainFetch` orders the
chain-fetch budget by momentum quality over a wider liquidity pool. Scan logs
`[zerodte-scan] discovery rail mix …` each cycle. Docs: INTENTIONAL-DESIGN §1 + §4 updated.

**Status.** OPEN PR for review (do not auto-merge) — branch `cursor/zerodte-multi-rail-discovery-3d11`.

## 2026-07-28 — [data-honesty] Vector max-pain `?horizon=` silently defaulted to ALL (7410 vs desk 7440)

**Severity.** P2 — cross-tool mismatch risk on `/dashboard` confluence + audit/API consumers.

**Root cause.** All Vector DTE routes only read `?dte=`. `normalizeDteHorizon(null)` → `"all"`. Passing
`?horizon=0dte` (natural alias) was ignored, so max-pain returned the all-expiry pin (**7410**) while
the SPX desk/heatmap front-expiry max pain stayed **7440**. The live chart client already sends
`dte=` correctly; the footgun hits audits, BIE/tooling, and any caller using `horizon`.

**Evidence.** Prod 2026-07-28: `dte=0dte` → 7440 (= desk/heatmap); `horizon=0dte` → horizon:"all", 7410.

**Fix.** `resolveDteHorizonParam` accepts `dte` or `horizon` (`dte` wins). Wired through all Vector
DTE routes. 0DTE max-pain prefers `getGexPositioning().max_pain` (same front-expiry source as the
desk/matrix) so Vector confluence cannot diverge from the header when positioning is warm.

**Status.** Same draft PR `cursor/spx-desk-truth-fixes-3d11` (#1197).

## 2026-07-28 — [data-honesty] SPX desk sticky gamma flip + pin spot=0 after hours

**Severity.** P1 — member-facing false levels / dishonest empty states on the SPX Slayer desk.

**Root cause.**
1. `buildSpxDesk` published `gamma_flip` as `intel ?? canonical ?? lastGoodGammaFlip`. After a
   successful live heatmap with `flip: null` (honest undetermined), the desk still resurfaced a
   sticky Redis/in-process flip (~7596 while spot was ~7429). `mergeFlowIntoDesk` compounded this
   via `flow.gamma_flip ?? base.gamma_flip` (`??` treats live null as missing).
2. `buildSpxPinForecast` read only the pulse lane. Pulse returns `price: 0` outside RTH/premarket,
   so the pin panel showed `spot: 0` + "Collecting" after the close even though the full desk still
   held the real last print.
3. `data-correctness` INV-4 used a per-strike flip oracle while production uses cumulative
   short→long (`cumulativeGammaFlip`) — false FLAGs when a per-strike crossing exists near spot
   but the cumulative book has no long-gamma boundary.

**Evidence (prod 2026-07-28 ~16:40 ET).** Heatmap `gex.flip=null`, walls 7430/7425, spot 7428.78;
desk `gamma_flip≈7596` with `gex_stale:false`. Pin payload `spot:0`, driver "Collecting".
`data-correctness` flagged "clean sign-change crossing near spot at 7,426.83 but matrix reports NO flip".

**Fix.** Clear sticky flip on successful live null; stop re-applying `lastGoodGammaFlip` on the
desk payload; trust flow-lane null flip in merge; pin falls back to `loadSpxDesk()` spot; INV-4
oracle aligned to cumulative definition (still independently re-derived). Docs paths in
`docs/bie/spx-slayer-mechanics.md` corrected to `src/features/spx/lib/`.

**Status.** OPEN PR for review (do not auto-merge) — branch `cursor/spx-desk-truth-fixes-3d11`.

## 2026-07-28 — [gate-calibration] Late-afternoon 0DTE entries (14:00-15:30) run 14.3% WR / −19% avg

**Severity.** P1 — the late-afternoon window is the second-worst time bucket in the 90-day record
(after the opening drive, already blocked by G-2). Responsible for ~7 losing plays that should
never have committed.

**Root cause.** The `NEW_PLAY_CUTOFF_ET_MINUTES` was set to 15:00 ET, allowing new directional
entries between 14:00-15:00 ET. With <1.5 hours of 0DTE theta remaining, long-premium entries face
accelerating decay and almost never reach the +100% target. 85.7% of late entries hit the -50% stop.
No hard gate existed between the 10:00 ET opening window unlock and the 15:00 ET persist cutoff.

**Evidence.** 90-day production record (101 graded plays): `late 14:00-15:30` bucket = 14.3% WR,
−19.02% avg P&L. Compare to `prime 9:50-11:00` = 38.0% WR, +2.7% avg P&L.

**Fix.** New hard gate G-14 (`late_afternoon`) + persist `NEW_PLAY_CUTOFF` block directional
0DTE commits at/after **14:00 ET** (code was briefly still 15:00 — corrected in the 2026-07-28
engine remodel PR). Condors remain exempt (want late theta).
Condor-exempt: iron condors BENEFIT from late-session theta crush (credit seller). Persist-layer
`NEW_PLAY_CUTOFF_ET_MINUTES` also moved from 15:00 → 14:00 as a backstop. Files:
`gates.ts` (G-14 enforcement + constant), `board.ts` (failure type), `plan.ts` (cutoff constant).
Tests: 3 new tests in `gates.test.ts` (boundary, condor exemption). **Status: MERGED.**

## 2026-07-28 — [data-honesty] Legacy 0% WR caused by unfillable entry bands (PR #1186)

**Severity.** P0 — the single biggest quality gap in the Legacy engine. 15 of 31 resolved plays
graded "unfilled" because the published entry band never overlapped the next session's trading range.
Top failure modes: `band_detached`(7), `unfilled_never_traded_back`(7), `wrong_direction`(7).

**Root cause.** Entry bands were built at edition time (~5:30 PM ET) as a fixed ±0.5% band around the
closing price (`spot * 0.995` to `spot * 1.005` in `buildDirectionalStockLevels`, play-levels.ts:138).
Night Hawk specifically selects momentum/catalyst names with strong directional flow — exactly the
stocks that gap 2-5%+ overnight. The next session's open prints well outside the band, so
`resolveOutcome` (play-outcomes.ts:591) correctly grades the play as "unfilled" and excludes it from
win/loss tallies.

**Fix (two-pronged).**
1. **ATR-scaled entry band at build time** (play-levels.ts): replaced the fixed ±0.5% halfwidth with
   `entryHalfWidth(spot, atr)` — scales to 40% of ATR (floor 0.5%, cap 2.5%). A 4% ATR name now gets
   a ±1.6% band instead of ±0.5%, covering normal overnight gaps.
2. **Morning confirm re-anchors entry band** (nighthawk-morning-confirm route.ts, Phase 3.75): when
   pre-market price confirms the thesis direction but the stock has gapped THROUGH the published entry
   band, the grading-side entry band (`nighthawk_play_outcomes.entry_range_low/high`) is updated to
   center on the pre-market price. The published edition is never mutated. INVALIDATED plays (stop
   breached, regime flip) are NOT re-anchored. New DB function `reanchorNighthawkEntryBand` (db.ts).
3. **Verdict engine updated** (morning-confirm-verdict.ts): gap-through-entry in thesis direction no
   longer degrades to "do not chase" — the re-anchor makes the entry fillable, so the play stays
   CONFIRMED with an advisory "entry re-anchored to pre-market" note.

**Blast radius.** Only affects Legacy overnight plays. 0DTE entries are intraday (no overnight gap).
The fillability grading logic (play-outcomes.ts) is unchanged — it still checks range overlap, but now
the range reflects where the stock actually traded, not the stale prior close.

**Evidence.** 8 play-levels tests (ATR scaling), 22 morning-confirm-verdict tests (including updated
gap-above test), 30 play-outcomes tests, 15 morning-verdict-persist tests — all green. TypeScript
compiles clean.

**Status.** PR #1186 — merging.

## 2026-07-28 — [correctness] fundamental_signals omitted from rescoreDossier + rescue play sector missing (PR #1176)

**Severity.** P1 (fundamental_signals) / P3 (rescue sector).

**Finding 1: `fundamental_signals` omitted from `rescoreDossier`.**
`rescoreDossier` in `hunt-builder.ts:172` built the `dossierExtras` object for `scoreCandidate` but
omitted `fundamental_signals`. The scorer's `scoreFundamentalTailwind` (scorer.ts:165) has two branches:
a **signals** path (max ±8 points across revenue_yoy_pct, operating_margin_pct, margin_trend,
fcf_positive, fcf_trend, net_cash_positive, share_count_trend, eps_trajectory) and a **ratios** path
(max ±2 from ROE + debt-to-equity). Without signals, every Legacy hunt candidate only ever hit the
ratios path — zeroing 6 of 8 possible fundamental score points.

**Root cause.** The extras object in `rescoreDossier` listed `fundamental_ratios` but simply forgot
`fundamental_signals`. The field exists on `TickerDossier` and is populated by `fetchAllDossiers`, so
the data was available — just not passed through.

**Fix.** Added `fundamental_signals: dossier.fundamental_signals` to the extras object.

**Finding 2: `sector` omitted from `buildRescuePlays`.**
`buildRescuePlays` in `deterministic-edition.ts:850` built rescue play objects without `sector`. The
cross-edition governor's per-sector cap couldn't count rescue plays, allowing sector concentration in
rescue-heavy editions.

**Fix.** Added `sector: scored.sector?.toLowerCase() || undefined`.

**Evidence.** 5 new tests (scorer-direction: 61/61 pass; deterministic-edition: 32/32 pass).
`scoreCandidate` with `fundamental_signals` scores higher than without. `buildRescuePlays` with
`sector` on `ScoredCandidate` produces a lowercased `sector` on the play.

**Blast radius.** Only these two call sites affected — the 0DTE pipeline's `scoreCandidate` in
`dossier.ts` already passes `fundamental_signals`, and the main `buildDeterministicEditionPlays`
already sets `sector`.

**Status.** FIXED — PR #1176.

## 2026-07-28 — [correctness] Four additional Legacy scorer/UI bugs (PR #1176, batch 2)

**Severity.** P2 (contrarian hedge stale signals + deprecated conviction) / P3 (ask-side double-count, positioning floor, confluence denominator).

**Finding 1: Contrarian hedge inherits stale `confirming_signals` + uses deprecated conviction.**
`scoreContrarianHedge` in `deterministic-edition.ts:66` re-scores a candidate in the opposite
direction for the diversity hedge slot, but spread `...original` which carried the ORIGINAL
candidate's `confirming_signals` count — not the count computed from the new (forced-direction)
sub-scores. It also called the deprecated `convictionFromScore(score)` (score-only, no
confirming_signals or earningsRisk) instead of the modern `assignNighthawkTier`.

**Root cause.** `confirming_signals` was computed in `scoreCandidate` but `scoreContrarianHedge`
was written before that field existed and never updated. The `...original` spread silently carried
the original's count forward.

**Fix.** Recalculated `confirming_signals` from the 9 new sub-scores using the same thresholds as
`scoreCandidate`. Replaced `convictionFromScore(score)` with `assignNighthawkTier({ score,
confirmingSignals, earningsRisk })`. Removed the now-unused `convictionFromScore` import.

**Finding 2: Ask-side premium double-count in `scoreFlowQuality`.**
`scorer.ts:370` used `safeFloat(r.ask_side_pct ?? r.total_ask_side_prem)` — when `ask_side_pct`
was absent, a large dollar amount (e.g. $2M) was used as a percentage, always exceeding the 60%
threshold and falsely crediting ask-side dominance on every flow record.

**Fix.** Only test `ask_side_pct` for the percentage threshold; fall through to the ratio check
when `ask_side_pct` is absent.

**Finding 3: Positioning floor asymmetry.**
`scorer.ts:659` clamped the positioning score at `Math.max(0, score)`, preventing mild negatives
(e.g. -2 for contradicting greek flow). Other sub-scorers allow negatives down to -3, making
positioning an outlier that couldn't express bearish signal.

**Fix.** Changed floor from `Math.max(0, score)` to `Math.max(-3, score)`.

**Finding 4: Confluence badge denominator wrong for Legacy.**
`PlayTerminal.tsx:267` always showed `CONFLUENCE {n}/2`, which is the 0DTE scale. Legacy uses a
9-dimension scale (0–9 confirming signals).

**Fix.** Omit the denominator for Legacy plays: `CONFLUENCE {n}` vs `CONFLUENCE {n}/2` for 0DTE.

**Evidence.** All tests pass — scorer-direction: 64/64, deterministic-edition: 33/33. New test
`scoreContrarianHedge recalculates confirming_signals from new sub-scores` verifies the
contrarian's signals differ from the original's.

**Blast radius.** `scoreContrarianHedge` is the only contrarian call site — the main
`scoreCandidate` was already correct. Ask-side and positioning fixes affect all candidates scored
through the Legacy pipeline. The confluence badge fix only affects the UI display.

**Status.** FIXED — PR #1176.

## 2026-07-28 — [data-loss + honesty] Sector dropped in LegacyDeck + fabricated discovery badges (PR #1176, batch 3)

**Severity.** P3.

**Finding 1: Sector field dropped in `LegacyDeck` container.**
`containers.tsx:120` built the object passed to `terminalPlayFromEdition` but never included
`sector: p.sector ?? null`. The edition builder populates `sector`, `EditionDeckSource` declares it,
and the adapter + terminal both handle it — but the container that bridges them silently dropped it.
Members never saw sector badges on Legacy plays, and `hasBadges` layout gating was partly broken.

**Fix.** Added `sector: p.sector ?? null` to the container's map.

**Finding 2: Fabricated discovery-origin badges from free-text regex.**
`adapters.ts:518-536` inferred BREAKOUT/CATALYST/SWEEP origin badges and `whyNow` trigger reasons
by running loose regexes against `key_signal`, a free-form thesis string never designed to encode
taxonomy. A thesis like "avoiding a dark-pool overhang before earnings" would tag the play SWEEP +
CATALYST even though neither discovery rail fired. This violates the codebase's "never fabricate"
convention.

**Fix.** Removed all regex-inferred badges. Only the data-grounded FLOW badge (from real
`flow_streak_days`) remains. `whyNow` is now only set when `flow_streak_days > 0`.

**Finding 3: Tier dimension count text wrong.**
`nighthawk-tiers.ts:79,180` said "7 dimensions" but `confirming_signals` counts 9 (flow, tech,
pos, news, smart, fundamental, shortInterest, wall, vex).

**Fix.** Changed comment and detail text to "9 dimensions".

**Status.** FIXED — PR #1176.

## 2026-07-28 — [correctness] Soft wall drift not direction-gated + cross-edition sector cap doesn't count tonight (PR #1176, batch 4)

**Severity.** P3.

**Finding 1: Soft GEX-wall-drift check not direction-gated.**
`morning-confirm-verdict.ts:198-211` applied both call-wall and put-wall soft drift to all plays
regardless of direction. The hard-shift check (lines 153-168) correctly gated: call wall → SHORT
only, put wall → LONG only. Impact: LONG plays spuriously DEGRADED on call-wall noise (irrelevant
to longs), and vice versa.

**Fix.** Added `&& !isLong` guard on call-wall soft check and `&& isLong` on put-wall soft check,
mirroring the hard-shift gates.

**Finding 2: Cross-edition sector cap doesn't count tonight's candidates.**
`cross-edition-governor.ts:161` built `sectorCounts` once from `recentOutcomes` (past editions) and
never incremented as tonight's candidates passed through the loop. The docstring at line 46-48
explicitly promised "lookback PLUS tonight's edition" but tonight's accepted candidates didn't
count against each other — so 4+ candidates from the same under-represented sector could all
pass through unpenalized.

**Fix.** Increment `sectorCounts` as each candidate survives (pass or demote, not cut) so later
candidates see the running total including tonight's accepted ones.

**Evidence.** 3 new tests in `morning-confirm-verdict.test.ts` (21/21 pass). All nighthawk tests
pass (97+21=118 total). tsc clean.

**Status.** FIXED — PR #1176.

## 2026-07-28 — [correctness] Governor demotion undone by builder merge-sort + no R:R minimum gate (branch `fix/governor-sort-override`)

**Severity.** Medium (edition quality — governor-demoted plays could re-promote to the top 5; plays with terrible R:R could publish).

**Finding 1: Governor sort override.**
The cross-edition governor (`cross-edition-governor.ts`) re-sorts candidates by `effectiveScore` (original − penalty) but only returns the original `ScoredCandidate` objects. The edition builder (`deterministic-edition.ts:640`) then re-sorts grounded plays by `score` (the original, un-penalized field), undoing the governor's demotion. A candidate the governor pushed from rank 3 to rank 8 would get rebuilt (within the buffer of 25) and then re-promoted to rank 3 by the merge sort, potentially appearing in the final top-5 edition over a non-demoted candidate.

**Root cause.** `applyCrossEditionGovernor` returns `survivors.map(s => s.scored)` — the original scored objects without any trace of the penalty. The builder's merge sort at line 640 has no access to the penalty.

**Fix.** Added `govPenalty?: number` to `ScoredCandidate` (scorer.ts:55). The governor now stamps it on demoted candidates. The builder's merge sort uses `score − govPenalty` so the governor ordering survives grounding.

**Finding 2: No minimum R:R enforcement.**
`validatePlayGeometry()` in `play-constraints.ts` checked directional consistency (target on the right side of entry, stop on the right side) but never enforced a minimum reward-to-risk ratio. A play with 0.2:1 R:R would pass geometry and publish.

**Fix.** Added `MIN_RR_RATIO = 0.5` and a geometry drop when `reward/risk < 0.5`. This means a play's potential reward must be at least half its risk — an extremely lenient floor that only catches truly untradeable geometry.

**Evidence.** All 65 tests pass (governor 25, constraints 12, deterministic-edition 28). New tests cover both fixes. `npx tsc --noEmit` clean.

**Status.** FIXED — PR pending.

## 2026-07-26 — [correctness] Iron-condor `live_pnl_pct` inverted AT THE SERVER SOURCE — fixed at source + removed the redundant Wave-2 render flip (branch `fix/condor-graded-pnl-sign`)

**Severity.** Medium (member-facing data correctness; condor rows only — active when `ZERODTE_CONDOR=1`).

**Root cause.** The board payload's `live_pnl_pct` is derived in `zerodte-service.ts` via `pinnedLivePnlPct`
= the LONG-premium return `(mark − entry)/entry`. That formula is correct for a bought option but WRONG for
a credit iron condor, which is SOLD for the credit and bought back to close — its return is the inverse
`(entry − mark)/entry`. A decaying (winning) condor marks DOWN, so the long formula stores a +76% winner as
−76%. Wave 2 (#1117) masked this at the render adapter (`terminalPlayFromZeroDte`) by re-deriving a seller
P&L from `last_mark`, but the underlying payload field stayed inverted, and the render flip risked a
DOUBLE-invert the moment the source was corrected.

**Two fields — investigated, only ONE was actually inverted:**
- **Live `live_pnl_pct` (board payload) — WAS INVERTED.** Computed at two sites in `zerodte-service.ts`
  (`mapLedgerRow` ~L350 and the post-`roundFloats` re-price ~L567), both via `pinnedLivePnlPct`. THIS is the
  bug. Also `floor_pnl_pct` (a directional ratchet concept) was long-framed on a condor's peak = meaningless.
- **Graded `plan_pnl_pct` (ledger) — was ALREADY CORRECT, NOT inverted.** A condor is graded by the
  condor-specific `gradeCondorFromBars` (`condor.ts`), which returns `pnl_pct = usd / gross_wing_risk`:
  `+net_credit` on a WIN (positive), `−max_loss` on a breach (negative). `scan.ts` routes condor rows there
  and never to the directional `gradePlanFromBars`. So the graded column, and everything reading it
  (`record.ts` win-rate `plan_pnl_pct > 0`, `officialPlanPnlPct`, `calibration.ts`), were already
  correctly signed. The task's premise that the graded/calibration data was inverted did NOT hold — the
  inversion was confined to the live board display path Wave 2 had masked.

**Evidence.** `condorSellerPnlPct(4.2, 1.0) = +76.19` vs `pinnedLivePnlPct(4.2, 1.0) = −76.19` (exact
mirrors — new `marks-math.test.ts` cases). `gradeCondorFromBars` win → `pnl_pct 40`, breach → `−60`
(`condor.test.ts` L326/L340, unchanged — proves the grade was never inverted).

**Fix.** New `marks-math.ts` leaf helpers: `condorSellerPnlPct` (seller-framed), `livePnlPctFor(isCondor,…)`,
and `reconcileLedgerLivePnlPct(row)` — the ONE structure-aware board derivation used at BOTH
`zerodte-service.ts` build sites (seller-framed for condors, long-framed + stopped-pin for directional,
byte-identical for directional). `floor_pnl_pct` suppressed (null) for condors. In `adapters.ts` the Wave-2
`pnlDisplay` seller RE-derive is REMOVED — the render now DISPLAYS the server's already-correct
`live_pnl_pct` verbatim (no double-invert; new "no double-invert" regression test). Peak/trough stay a
DISPLAY transform of the RAW latched premiums the payload carries (not a re-invert of the signed headline),
and the executable-fill suppression for condors (a directional long framing) is KEPT. `zerodte-sim-feed.mjs`
now feeds condor `live_pnl_pct`/`plan_pnl_pct` seller-framed too (winner positive), so `?sim=1` matches the
corrected server; `--synthetic --dry-run` → `invalid frames: 0`.

**Blast radius.** Live board `live_pnl_pct` + `floor_pnl_pct` (both zerodte-service sites) + the SSE re-price;
the render adapter; the sim feeder. The per-OCC live-marks lane (`live-marks.ts`) carries single
contracts only — a condor has no single OCC and never appears there, so it needed no change. Graded ledger /
record / calibration unaffected (already correct).

**Fix rationale.** Correcting the sign at the server source is the durable fix; the Wave-2 render flip was a
display-layer workaround that would double-invert once the source was fixed. Doing both in one change is the
only way to keep the member-visible number correct with no window of double-inversion.

**Status.** DRAFT PR (member-facing data correctness — operator reviews + verifies before merge).

## 2026-07-25 — [correctness] Night Hawk deck: iron-condor P&L was DIRECTIONALLY INVERTED (a winning condor read NEGATIVE) — FIXED (Wave 2 branch `feat/nighthawk-wave2-leftpanel`)

**Severity.** Medium (member-facing correctness; condor rows only — dormant unless `ZERODTE_CONDOR=1`,
so no live member saw it yet, but it would have shipped inverted the moment condors go live).

**Root cause.** The command-deck adapter (`terminalPlayFromZeroDte`) mapped `pnlPct` straight from the
payload's `live_pnl_pct`, which is the LONG-premium return `(mark − entry)/entry`. A credit iron condor
is SOLD for the credit and bought back to close, so its return is the INVERSE `(entry − mark)/entry`. A
decaying (winning) condor marks DOWN, so the long-framed number is a large NEGATIVE — e.g. a +76% winner
rendered as −76%. The sim feeder even carried this: `zerodte-sim-feed.mjs` set the SPX condor winner's
`live_pnl_pct` to −76% while its comment said "+76%". Peak/trough inherited the same inversion (a
seller's BEST excursion is the LOWEST mark, not the highest), and the "sell into the BID" executable-fill
line is a long framing that doesn't apply to a credit structure at all.

**Evidence.** `src/features/nighthawk/command-deck/adapters.ts` old line `pnlPct: pnl` +
`peak: …(peak_premium/entry − 1)…`. Sim: `scripts/audit/zerodte-sim-feed.mjs` `ledgerRowFor` `rawPnl =
(mark/entry − 1)` (−76.2% for the 4.2→1.0 winner). New adapter test asserts the +76.2% seller return.

**Fix.** In the adapter, for `isCondor` rows only, `pnlPct = (entry − mark)/entry` (seller-framed), with
peak/trough inverted to match (lowest mark = best) and the executable-fill line suppressed (`execMark`/
`execPnlPct` null). Directional rows are byte-identical. Management recommendation now reads the seller
P&L too. Covered by `adapters.test.ts` ("condor: P&L is SELLER-framed …").

**Blast radius.** Only condor rows; the session-P&L cockpit tape reads the corrected `pnlPct`, so it too
is now seller-correct. No server/grader change (the payload's `live_pnl_pct` sign is untouched — the fix
is at the render adapter, the one place that knows a row is a credit structure).

**Status.** Fixed on the Wave-2 branch (DRAFT PR, member-facing — operator reviews before merge).

## 2026-07-25 — [tooling] NEW: 0DTE E2E validation suite (`zerodte-e2e-suite.mjs`, `npm run validate:e2e`) + Monday-RTH readiness trace — ADDED

**Severity.** N/A — additive read-only tooling + docs (no app/behavior change). Safe to merge on green.

**What + why.** The one question before an open is "will 0DTE plays actually generate, and is anything
blocking them?" There was a per-stage healthcheck and a per-number data-validator, but no single
**pre-open GATE** that (a) hits EVERY upstream the pipeline reads with a schema + sanity assertion,
(b) proves the RDS/Redis infra, and (c) proves the DB/cache data-path through the app — with a
non-zero exit so it can gate. Added `scripts/audit/zerodte-e2e-suite.mjs` (`npm run validate:e2e`):

- **API-POLYGON / API-UW** — every endpoint enumerated from `docs/audit/NIGHTHAWK-DATA-PROVENANCE.md`
  + the real call sites in `src/lib/providers/{polygon,unusual-whales,options-snapshot,option-trades,
  polygon-options-gex,polygon-news}.ts` (NOT guessed): marketstatus, indices (VIX/SPX), aggs prev +
  minute range, grouped-daily, `/v3/snapshot/options/{u}`, `/v3/snapshot` unified OCC, reference
  contracts, `/v3/trades/{occ}`, benzinga news; UW flow-alerts (global + per-stock), spot-exposures/
  strike GEX, greek-exposure/strike, screener/stocks, darkpool, net-flow/expiry, earnings pre/after.
  Each: HTTP-200 + shape check + sanity value (grouped ~12.4k, VIX 5–90, chain carries greeks/quote).
- **INFRA** — RDS `blackout-production-postgres` available/Multi-AZ + ElastiCache
  `blackout-production-redis-rg` available/failover via the AWS CLI. **SKIPPED (never RED) without AWS
  creds** (sandbox defaults are `InvalidClientTokenId` placeholders), mirroring the healthcheck stage A.
- **DATA-PATH** — raw TCP to PG/Redis is blocked here (do NOT attempt pg.Client/redis-cli — it hangs).
  Validated THROUGH the app instead: `/board` served = Redis snapshot path live (+ as_of freshness),
  `/record` graded rows = Postgres read path live. ONE temp admin Clerk user, deleted in `finally`.

**Base-URL fix baked in.** `POLYGON_API_BASE` is a broken placeholder in this env; the suite
self-defaults to `https://api.massive.com` (primary) with `https://api.polygon.io` fallback — tries
in order, locks onto the first 200 for the run. A malformed value is dropped by a `/^https?:/` guard.

**Evidence (live 2026-07-25, off-hours).** `npm run validate:e2e` → API-POLYGON all-required GREEN
(SPX 7411.98 / **VIX 18.58**, grouped-daily **12,410 stocks**, reference exp 2026-07-27; off-hours
ambers = empty greeks/trades), API-UW GREEN (flow 25 rows, **GEX 50 strike rows**, greek-exposure
791), INFRA SKIPPED (placeholder AWS creds), DATA-PATH GREEN (`/board` fresh snapshot, `/record`
**111 graded rows**). Overall AMBER (off-hours-empty only), **exit 0**. `--provider=uw` → GREEN.

**Pure validators are unit-tested.** `scripts/audit/zerodte-e2e-suite.test.ts` (15 tests, `npx tsx
--test`) drives every validator branch with mock payloads — VIX band, grouped floor, greeks-empty
off-hours vs RTH, the unified-snapshot top-level-`ticker` shape, RDS/Redis/snapshot verdicts. All pass.

**Companion doc.** `docs/audit/MONDAY-RTH-READINESS.md` — the full raw-data→committed-play BLOCKER
trace: ingestion (UW leader lock fail-CLOSED on multi-replica + Redis blip; `flow_alerts` RDS write
path), discovery ×3 (FLOW always-on; BREAKOUT/PIN flag-gated), gates G-1..G-12 + fail-closed firewall
(with kill-switch defaults), governor, Cortex veto + confluence-2, commit→snapshot cadence, rate-limit
budgets, and a prioritized 12-item open checklist. **Top-line verdict: plays ARE expected to generate
Monday 2026-07-27 (a normal full trading day)**, conditional on (1) discovery flags set on the worker
task def, (2) the ingestion write path warming after 10:00; the real anomaly to watch is the G-11
fail-OPEN case (a board that PRINTS while halt/earnings feeds are cold), not an empty board.

**Status.** MERGED via `feat/api-endpoint-validator` (additive; verified green).

## 2026-07-25 — [tooling] NEW: 0DTE Night Hawk end-to-end LIVE health check (`zerodte-e2e-healthcheck.mjs`) — ADDED

**Severity.** N/A — additive read-only tooling (no app/behavior change). Safe to merge on green.

**What + why.** There was no single "is the whole 0DTE system actually working end-to-end before
the open" check. `data-validator.mjs` cross-checks individual numbers on the board; it does NOT walk
the pipeline (discovery → commit → marks → exit → **condor** → grading) and assert each subsystem is
live. Added `scripts/audit/zerodte-e2e-healthcheck.mjs` (`npm run healthcheck:0dte`): logs into prod
as ONE temp admin+premium Clerk user (reused data-validator auth block — mint `sign_in_token` → FAPI
ticket exchange → `__session`; always deleted in `finally`, self-heals leftovers; authenticates
once), reads the SAME authenticated `/api/market/zerodte/{board,marks,record}` endpoints the desk
polls, and prints a per-stage GREEN/AMBER/RED matrix. Exits non-zero if any non-skipped stage is RED.

**Stages (grounded in the real payloads, not guessed fields).**
- **A INFRA/CONFIG** — ECS `blackout-production-{web,market-worker}` `running==desired` + PRIMARY
  rollout, and the `ZERODTE_WHOLE_MARKET`/`SRC_BREAKOUT`/`SRC_PIN`/`CONDOR` flags present in the
  worker task def. AWS creds absent/placeholder → **SKIPPED**, never RED. Never prints secret values.
- **B DISCOVERY ×3** — `board.setups[].discovery_origin` (`board.ts` `DiscoveryOrigin` = FLOW/
  BREAKOUT/PIN) covers all three; a zero-origin → AMBER with the captured `session.heat` / `governor`
  / `gate.blocks[].code` reason (empty is never assumed correct).
- **C COMMIT/LEDGER** — each `board.ledger` row carries `entry_premium`, `direction`, `top_strike`,
  `first_flagged_at`, and a frozen `cortex`/`tier` snapshot (the `entry_context` passthrough on
  `ZeroDteBoardLedgerRow`, `zerodte-service.ts`).
- **D LIVE MARKS+P&L** — `/marks` open rows (`ZeroDteLiveMarkRow`) have a fresh `mark`
  (`mark_age_ms` ≤ 20s RTH, mirrors `ZERODTE_MARK_STALE_MS`), a coherent `live_pnl_pct`, and the
  displayed mark is cross-checked vs Polygon `/v3/snapshot/options/{underlying}/{occ}` (±15%, the
  app's own illiquid threshold; off-hours/thin → AMBER).
- **E EXIT MGMT** — `status` ∈ {OPEN,HOLD,TRIM,CLOSED} coherence; a CLOSED `closed_reason:"stopped"`
  row shows the pinned `PLAN_RULES.stop_pct` (−50%), matching `mapLedgerRow`'s D-1 pin.
- **F IRON CONDOR (first-class, never skipped)** — a routed `play_type:"CONDOR"` `condor_plan`
  (`condor.ts` `CondorPlan`: short/long put+call, `net_credit`, `wing_pts`, `breach_lower/upper`) with
  correct leg ordering, OR (no live condor) the calibration `condor` geometry (`iron-condor.ts`
  `IronCondorLegs`) attached to directional setups → engine proven wired even when
  `ZERODTE_CONDOR`/`SRC_PIN` haven't routed a PIN candidate this session.
- **G GRADING/RECORD** — `/record` (`ZeroDteRecord`) `wins+losses+breakeven == graded`; today's CLOSED
  rows carry a graded outcome (`graded`/`plan_outcome`).

**Evidence.** Pure verdict/coherence logic extracted to `scripts/audit/lib/zerodte-healthcheck-eval.mjs`
+ `…​.test.mjs` (8 tests, `node --test` → 8/8 pass): rollup ordering, staleness, mark agreement, condor
leg-ordering geometry, track-record arithmetic, exit-lifecycle coherence, commit-row completeness.
`node --check` clean on both `.mjs`; eslint clean on all three touched files; offline `--stage=A`
dry-run renders the matrix + SKIPPED path with no network. The live prod path was intentionally NOT
executed from the sandbox (no creds needed to build it).

**Status.** DONE — merged additive tooling. Wire it into the market-open runbook as the "before the
open" gate (documented in `docs/audit/MARKET-OPEN-VALIDATION.md`).
## 2026-07-25 — [SIM-VIEW] Admin-only 0DTE simulation view of the Night Hawk board — NEW FEATURE (member board untouched)

**Severity.** Feature (deploy-affecting, safety-critical isolation). Not a bug fix — an additive
admin capability. The #1 requirement was that members can NEVER see sim data and the member board
path stays byte-for-byte unchanged.

**What shipped.** An admin can open `https://blackouttrades.com/night-hawk?sim=1` and watch a
simulated 0DTE session play through the REAL Night Hawk panel, fed by `npm run sim:feed --
--synthetic`. Members keep seeing the real, untouched board.

**Isolation design (three independent layers, ALL must hold).** (1) **Admin gate** — ingest is
`requireAdminApi()`; the board GET re-checks `isAdminUser` before serving sim. (2) **Separate Redis
key** — `zerodte:board:snapshot:sim:v1`, distinct from the member `zerodte:board:snapshot:v1`; the
sim module never touches the member key (grep-enforced by a test). (3) **Opt-in `?sim=1`** — absent
it, the member path (`getZeroDteBoardPayload()`) runs unchanged for everyone. A non-admin passing
`?sim=1` deliberately falls through to the member board.

**Member-path-unchanged proof.** The board route's default call is the same
`getZeroDteBoardPayload()` as before; sim is an added branch IN FRONT of it, gated on
`isSimRequested && via==="user" && isAdminUser`. In sim mode the client also disables the real
live-marks SSE overlay so real member marks never paint the sim board.

**Evidence.** New `zerodte-sim-board.test.ts` (9 tests): the `shouldServeSimBoard` truth table (sim
ONLY for admin+sim=1; non-admin+sim=1 → member), `?sim=1` opt-in parsing, malformed-frame rejection,
key isolation (sim key ≠ member key, module never references the member literal), short self-expiring
TTL, and route-source assertions (member call intact, ingest admin-gated + writes only sim). `npx tsc
--noEmit` clean; eslint clean on all touched files; existing `zerodte-service.test.ts` (17) still green.

**Files.** `src/lib/platform/zerodte-sim-board.ts` (+ `.test.ts`),
`src/app/api/admin/zerodte/sim/board/route.ts` (new ingest POST/DELETE),
`src/app/api/market/zerodte/board/route.ts` (gated read branch),
`src/features/nighthawk/command-deck/containers.tsx` (`?sim=1` propagation + banner),
`scripts/audit/zerodte-sim-feed.mjs` (`npm run sim:feed`), `docs/audit/ZERODTE-SIMULATOR.md`.

**Status.** OPEN PR → auto-merge on green CI per standing policy (additive; member path proven
unchanged).

## 2026-07-25 — [WS-11] Mechanical grader single-walked a TRIM-SCALE strategy — calibration graded a DIFFERENT strategy than the engine runs; now reconstructs the ⅓/⅓/⅓ partial path executable-side as ONE official as-managed number — FIXED

**Severity.** High (calibration integrity / member-record honesty, TRADES). Ref: NightHawk Remediation
Directive §WS-11. **[TRADES] — DEPLOY-RISKY, HOLD for operator go; STACKED on #1107 (WS-10)** (changes the
official simulated P&L + the member as-managed record for trim_scale rows). Depends on WS-10 (executable
per-leg pricing) and WS-02 (frozen exit-policy snapshot, already on main).

**Root cause.** The engine's shipped profit-management family is TRIM-SCALE (exit-engine.ts, FINDINGS
2026-07-23): bank ⅓ of the original at +25%, another ⅓ at +50%, run the last ⅓ to the plan rails. But the
mechanical grader `gradePlanFromBars`/`gradePlanExecutableFromBars` (`plan.ts`) is a SINGLE stop/target/
time-stop walk — it exits the WHOLE position once, never reconstructing the partials. So the OFFICIAL grade
calibration buckets (calibration.ts → `officialPlanPnlPct`) and the member-facing "as-managed" record
(record.ts) could grade a DIFFERENT strategy than the one the member is guided to trade, and the ledger could
graduate a strategy nobody actually runs. The as-managed headline separately read a single stamped
`entry_context.exit` (the live engine's one terminal EXIT, not the blended tranche path), so the two numbers
could disagree with no reconciliation.

**Evidence (fail-before / pass-after).** New WS-11 tests in `marks-math.test.ts` (6) + `record.test.ts` (3) +
`latency-telemetry.test.ts` (1). Required #1 — a bar path that trims twice then trails reconstructs THREE legs
(⅓/⅓/⅓), executable-priced (entry ask 1.10; legs sell the bid at 1.25/1.50 then time-stop the runner at the
last close bid 1.395 → leg returns +13.64%/+36.36%/+26.82%), blended +25.61% = the fraction-weighted sum; the
single-walk executable grade on the SAME bars is a different single number (fail-before proof). Required #2 —
on a reconstructed row `officialPlanPnlPct == asManagedPnlPct` (grade_vs_asmanaged_delta = 0 bps) and the
record headline books +25.61% with `managed_source: "reconstructed"`. Required #3 — a ratchet row (no
tranches) is unregressed: official = the single-walk exec grade, as-managed = the live ratchet exit (source
"engine"). Required #4 — a row with no executable blob / a malformed tranches field falls back to the prior
mid+engine behavior. Full suite `src/**/*.test.ts` 4873/0; `tsc --noEmit` clean.

**Fix (additive; no migration; WS-08 null-guarded back-compat).**
- `plan.ts` — `reconstructTrimScaleExecutableFromBars(bars, entry, flaggedAt, halfSpreadFrac, spec, params)`:
  replays the frozen trim ladder leg-by-leg on the WS-10 executable frame (entry=ask, each exit=bid), banks
  `fractionₖ` at each trim LEVEL (bid-high crossing, mirroring the executable target trigger), runs the last
  fraction to target/stop (stop-before-target same-bar collision, frozen rule)/time-stop, and returns ONE
  blended `pnl_pct` + a per-leg `tranches` array `{tranche,fraction,exit_pnl_pct,exit_reason,at_et}`. New
  `PlanTrancheFill`/`TrimScaleSpec` types; `PlanOutcome.tranches` optional (single walks omit it). Empty
  ladder → defers to the single walk; no post-flag bars / non-positive entry → ungradeable (never fabricated).
- `scan.ts` grade path — when the row's FROZEN policy (`readFrozenExitPolicy`) is `trim_scale`, the OFFICIAL
  executable grade IS the reconstruction; ratchet/legacy rows keep the single-walk `gradePlanExecutableFromBars`.
  The `tranches` (or null) ride in the `entry_context.executable` blob (same stamp as WS-10). Emits the WS-11
  `grade_vs_asmanaged_delta` telemetry on reconstructed rows only.
- `record.ts` — `readReconstructedTrimScale` (executable blob with a non-empty `tranches` array); the
  as-managed headline routes to that reconstruction (`managed_source: "reconstructed"`) so the member number ==
  the calibration official number by construction; ratchet/legacy rows unchanged. New `asManagedPnlPct` export.
- `latency-telemetry.ts` — `grade_vs_asmanaged_delta_bps` percentile histogram (|official − as-managed|, ≈0),
  beside WS-10 `execution_tax_bps`.

**Blast radius.** `gradePlanFromBars` + the scan.ts grade path; `record.ts` as-managed + per-play columns;
`calibration.ts` reader (now grading the reconstructed official outcome via `officialPlanPnlPct`); the
`managed_source` union (+"reconstructed") — consumed only by the record route payload (pass-through) and tests.
CONDOR stays on `gradeCondorFromBars` (out of scope, confirmed). Ratchet mode stays single-exit (confirmed by
test #3). The executable-lane official number from WS-10 IS the per-tranche pricing basis (each leg priced
bid-to-close vs ask-to-open). **Status: OPEN PR (base `fix/ws-10-executable-pnl`, stacked), holding for
operator go (DEPLOY-RISKY); WS-10+WS-11 presented together as one go/no-go.**

## 2026-07-25 — [WS-10] Official 0DTE P&L graded on the MIDPOINT — understated the execution tax; calibration/record now grade the CONSERVATIVE EXECUTABLE lane (entry=ask, exit=bid) — FIXED

**Severity.** High (correctness / calibration integrity, TRADES). Ref: NightHawk Remediation Directive
§WS-10. **[TRADES] — DEPLOY-RISKY, HOLD for explicit operator go before prod merge** (changes the official
simulated P&L every calibration/record consumer reads — safer/honest, but a behavior change).

**Root cause.** The mechanical grader `gradePlanFromBars` (`plan.ts:348`) grades on the MID: it fires the
stop when the option's trade LOW touches the −50% level and books the exit at that level against a mid entry
basis. But a long-premium 0DTE option is BOUGHT near the ASK and SOLD near the BID (both directions —
"long"=bought call, "short"=bought put — are long premium; only the iron condor is credit, and it is graded
on its own 4-leg path). Mid marks BOTH the entry and the exit at a price no member could transact, so the
official `plan_pnl_pct` (calibration.ts buckets it; record.ts mechanical grades it) answered "did the MIDPOINT
touch target/stop," not "could a member have EXITED there" — systematically understating the exit tax (acute
for 0DTE, where spreads blow out into the stop). That lets calibration graduate strategies that only win at mid.

**Evidence (fail-before / pass-after).** New `marks-math.test.ts` (executable math + `gradePlanExecutableFromBars`)
+ a calibration test. Against pre-change source the three required tests fail: #1/#2 fail to load (the
executable exports/grader don't exist); #3 (`bucketOf` reading the executable lane) asserts `wins=1` but OLD
`bucketOf` reads mid → `actual: 2`. Post-fix all pass. Wide-spread winner: mid `doubled +100%` vs executable
`doubled +81.82%` ((2.0−1.1)/1.1). Bid-stop: a trade low of 0.54 (above the 0.50 mid stop) → mid `time_stop`,
but the bid (0.54×0.9=0.486) crosses → executable `stopped −54.55%` — the negative-skew tail mid was blind to.
Full suite `src/**/*.test.ts` 4864/0; `tsc --noEmit` clean; eslint clean.

**Fix (three lanes; additive, no migration).**
- `marks-math.ts` — pure executable math: `zeroDteHalfSpreadFrac` (ask−bid)/(ask+bid), `zeroDteExecutableEntry`
  (ask), `zeroDteExecutableExit` (bid), `executablePnlPct` ((exit bid − entry ask)/entry ask), `executionTaxBps`
  (mid−exec ×100), `ZERODTE_DEFAULT_HALF_SPREAD_FRAC` (5% floor for a one-sided book).
- `plan.ts` — `gradePlanExecutableFromBars`: re-prices the plan on the executable frame — entry=ask, the stop/
  target LATCH ON THE BID (bar×(1−f)), a time-stop sells the closing bid. Stop/target premium LEVELS unchanged.
- `scan.ts` grade path — computes the executable grade beside the mid grade using the row's OWN pinned entry
  spread (`plan_json.bid/ask`), stamps it additively at `entry_context.executable` (`stampZeroDteExecutableGrade`,
  db.ts — same JSONB-merge/no-migration pattern as `stampZeroDteExitContext`), and emits `execution_tax_bps`.
- `record.ts` — `officialPlanPnlPct`/`officialPlanOutcome`/`readExecutableGrade`; the shared `isZeroDteWin`/
  `isGradedZeroDteRow` and the mechanical grade now read the executable lane, mid columns as the LEGACY fallback.
- `calibration.ts` — `bucketOf` win + avg P&L read the official (executable) lane.
- `live-marks.ts` — additive `live_pnl_pct_exec` (position marked at the bid) for monitoring; mid `live_pnl_pct`
  stays the board default. `latency-telemetry.ts` — `execution_tax_bps` percentile histogram.

**Blast radius.** Every P&L consumer verified: mechanical grader, `record.ts` (mechanical/per-play), calibration
reader, feature-store label (via the shared predicates), live board (`live_pnl_pct` mid retained). CONDOR is out
of scope (separate 4-leg grader). AS-MANAGED/engine-exit partials stay on mid — deferred to WS-11 (executable-side
partial reconstruction), which depends on this lane. **Status: OPEN PR, holding for operator go (DEPLOY-RISKY).**

## 2026-07-25 — [D1] Earnings gate (G-11) failed OPEN — a failed/timed-out earnings feed read looked identical to "no earnings" and let a name reporting today commit a fresh 0DTE — FIXED (fail-closed `earningsUnavailable` firewall)

**Severity.** High (correctness / TRADES). DANGER item **D1** from `docs/audit/NIGHTHAWK-DATA-PROVENANCE.md`
(market-open danger list). On a cold earnings snapshot or a busy-open read timeout, the desk could open a
fresh 0DTE straight into a name printing earnings today (pre/after-hours) — a categorically different trade.
**[TRADES] — DEPLOY-RISKY, HOLD for explicit operator go before prod merge.** Strictly safer (only ever
WITHHOLDS a commit), but it changes what commits, so it holds on the branch until the operator says go.

**Root cause.** The G-11 earnings read collapsed THREE distinct outcomes into one "no earnings" signal. In
`src/lib/zerodte/scan.ts` (~523-533) the earnings IIFE returned a bare `Map<string, EarningsFlag>`:
`readGridEarnings()` returns `ZeroDteEarningsSnapshot | null` (`earnings.ts:105` — **null already means
failure**) and `within(p, 2500)` returns null on timeout (`scan.ts:143`), yet BOTH null cases, plus the
`catch`, returned `new Map()` — indistinguishable from a successful read that genuinely matched no reporter.
Then `gates.ts` (~598) blocked only when `input.earnings != null`; a failed read → empty map → every
candidate had `earnings == null` → no earnings block → **committed**. The failed-vs-empty signal already
EXISTED (the null return); it was just discarded — the exact inverse of the VIX/macro firewall the codebase
already had (`vixUnavailable`/`macroUnavailable`, `scan.ts:553-554`, `gates.ts:460-492`/`:534-549`).

**Evidence.** Fail-before/pass-after in `gates.test.ts` (three-outcome contract). Neutralizing only the new
fail-closed block (simulating OLD behavior) while keeping the fixed tests:
```
=== OLD behavior (block neutralized) ===     === POST-FIX ===
not ok 47 - FAILED read fails closed          ok 47 - FAILED read fails closed
ok 48 - SUCCESS no-reporter still COMMITS     ok 48 - SUCCESS no-reporter still COMMITS
ok 49 - present flag still fires `earnings`   ok 49 - present flag still fires `earnings`
# pass 66  # fail 1                           # pass 67  # fail 0
```
Test 47 proves the OLD code COMMITTED a fresh candidate on a failed earnings read; 48 proves the fix does
NOT over-block a successful "none report today" read (the critical no-false-empty case); 49 proves the
existing present-and-reporting `earnings` block is unregressed. `scan.test.ts` 17/0, `board.test.ts` +
`rejections.test.ts` 109/0 (with `--experimental-test-module-mocks`); `tsc --noEmit` clean.

**Fix.** Strictly ADDITIVE, mirroring `vixUnavailable`/`macroUnavailable` exactly:
- `scan.ts` earnings IIFE now returns `{ map, unavailable }` — `unavailable=true` ONLY on a genuine failure
  (`within` timeout → null, `readGridEarnings()` typed null, or the `catch`); `false` on success (even when
  the matched map is empty because no candidate reports today) and `false` when `freshTickers` is empty
  (nothing to check). Derived `earningsUnavailable` is threaded into `ZeroDteGateInput` next to `earnings`.
- `gates.ts` G-11 gains an `else if (input.earningsUnavailable === true && G11_EARNINGS_FAIL_CLOSED_ENABLED)`
  branch pushing a distinct **`earnings_unavailable`** block (added to the `ZeroDteGateFailure` union in
  `board.ts` beside `vix_unavailable`/`macro_unavailable`). New env kill-switch
  `G11_EARNINGS_FAIL_CLOSED_ENABLED` (`ZERODTE_G11_FAIL_CLOSED=0` to disable), matching the G-4/G-7 switches.

**Blast radius.** The earnings read has a single consumer — the batch G-11 path in `scan.ts` feeding
`evaluateZeroDteGates` for EVERY committable rank (the fix covers ranks 6-10, not just the dossier top-5).
The block sits OUTSIDE the `isCondor` branch (same as the present-and-reporting `earnings` block), so it
applies to BOTH lanes — earnings risk is direction-agnostic, so NO `couldBlock` narrowing is used (unlike
G-4's index/ETF narrowing, which is VIX-regime-specific). The dossier-only `s.earnings` fallback is
unchanged. No other call site reads `readGridEarnings` for gating.

**Fix rationale.** Mirror the proven VIX/macro firewall rather than invent a new shape: a failed read is a
FAILURE, not a benign empty, and must fail closed. Additive `else if` keeps the present-and-reporting
`earnings` block (and its behavior) byte-for-byte unchanged and guarantees the two branches are mutually
exclusive (present flag wins; no double-block). Deliberately NOT narrowed by product/direction because any
name printing today is out of scope for a 0DTE scalp regardless of side. The successful-but-empty case is
explicitly preserved as a COMMIT (test 48) so a quiet earnings day never empties the board.

**Status.** Fixed on `fix/d1-earnings-fail-closed`; DRAFT PR opened. **HOLD for explicit operator go before
prod merge** ([TRADES] deploy-risky per CLAUDE.md — changes what commits).

## 2026-07-25 — [D2] Halt/LULD gate (G-11) failed OPEN on a cold halt feed — a dark/dead halt socket left the store empty and a HALTED underlying could commit a fresh 0DTE — FIXED (fail-closed `haltFeedStale` firewall)

**Severity.** High (correctness / TRADES). DANGER item **D2** from `docs/audit/NIGHTHAWK-DATA-PROVENANCE.md`
(market-open danger list). Post-deploy (halt socket not yet connected) or on a mid-session socket death, the
0DTE board could open a fresh 0DTE straight into a HALTED name — the store is empty precisely because the
feed is dark, and an empty halt store on a dead feed is NOT "no halts." **STACKED on D1 (#1102).**
**[TRADES] — DEPLOY-RISKY, HOLD for explicit operator go before prod merge.** Strictly safer (only ever
WITHHOLDS a commit), but it changes what commits, so it holds on the branch until the operator says go.

**Root cause.** In `src/lib/zerodte/scan.ts` (~546-562, pre-D2) the board halt IIFE read
`shouldBlockForTradingHalt([t], { failClosedOnStale: false })` — `failClosedOnStale:false` means only an
ACTIVELY-stored halt blocks; a stale/cold/dead halt channel does NOT. So when the UW halt socket hadn't
connected (post-deploy) or died mid-session, the in-memory `tradingHaltsStore` was empty, every candidate
read `halted:false`, and G-11 found nothing to block → committed. The desk/dossier path already used the
fail-closed default. This is the exact inverse of the VIX/macro/earnings firewalls the codebase already had.

**Why the fix is SAFE (no board-starvation — the critical property).** `shouldBlockForTradingHalt` with
fail-closed-on-stale calls `isTradingHaltChannelStale()` (`uw-socket.ts:1018`), which is stale ONLY when BOTH
the UW and LULD sources are stale. `isUwHaltSourceStale` (`:1010`) reads FRESH if `isUwChannelFresh("trading_halts")`
OR `effectiveFreshestUwMessageAt()` is within maxAge — i.e. the **freshest message across ALL UW channels**,
NOT the event-only `trading_halts` channel's naturally-silent heartbeat. On a healthy socket (flow/price/tide
streaming constantly during RTH) the halt source therefore reads FRESH, so the fix does NOT block. It trips
ONLY on a genuine full-socket + LULD outage — exactly when you want to hold. This is the "edition-builder
trap" the code comments warn about, and it is pinned by tests (below).

**Evidence.** Fail-before/pass-after. Reverting ONLY the three source files to the D1 base while keeping the
D2 tests:
```
=== OLD behavior (D1 base sources) ===              === POST-FIX (D2) ===
gates.test.ts:                                       gates.test.ts:
not ok 50 - D2 cold halt feed fails closed           ok 50 - D2 cold halt feed fails closed
ok   51 - D2 healthy feed still COMMITS (no starve)  ok 51 - D2 healthy feed still COMMITS (no starve)
ok   52 - D2 active halt fires `halted` not stale    ok 52 - D2 active halt fires `halted` not stale
# pass 69 # fail 1                                    # pass 70 # fail 0
scan.test.ts:                                        scan.test.ts:
not ok 16 - COLD halt feed → halt_feed_stale         ok 16 - COLD halt feed → halt_feed_stale
ok   17 - HEALTHY feed adds NO halt_feed_stale        ok 17 - HEALTHY feed adds NO halt_feed_stale
# pass 18 # fail 1                                    # pass 19 # fail 0
```
gates test 50 + scan test 16 prove the OLD `failClosedOnStale:false` code COMMITTED a fresh candidate past a
dead halt feed. **The no-starve tests (gate 51 + scan 17) are the important ones**: a HEALTHY feed (quiet
halt channel, socket live → `haltFeedStale=false`) never manufactures a block and still COMMITS — the fix
does not empty the board on a normal day. gates test 52 proves an ACTIVE halt still fires the distinct
`halted` code (never double-firing `halt_feed_stale`). `tsc --noEmit` clean; `trading-halts-expiry` 7/0,
`gates-replay` 9/0, `skip-grading` 11/0 regression green.

**Fix.** Strictly ADDITIVE, mirroring `earningsUnavailable` (D1) exactly:
- `scan.ts` halt IIFE now returns `{ active, feedStale }` — `active` is the per-ticker stored-halt set
  (unchanged `failClosedOnStale:false` read); `feedStale` is the GLOBAL `isTradingHaltChannelStale()` read
  (both UW+LULD cold). Derived `freshHaltFeedStale` is threaded into `ZeroDteGateInput.haltFeedStale` for
  EVERY committable rank. On a thrown import, `feedStale` stays false (pre-D2 behavior — a crash must not
  empty the board).
- `gates.ts` G-11 gains an `else if (input.haltFeedStale === true && G11_HALT_FAIL_CLOSED_ENABLED)` branch
  pushing a distinct **`halt_feed_stale`** block (added to the `ZeroDteGateFailure` union in `board.ts`
  beside `earnings_unavailable`). New env kill-switch `G11_HALT_FAIL_CLOSED_ENABLED`
  (`ZERODTE_G11_HALT_FAIL_CLOSED=0` to disable), matching G-4/G-7/G-11-earnings.

**Distinct code vs reusing `halted`.** Chose a DISTINCT `halt_feed_stale` code (not the `halted` path): a
stale FEED is a data-plane outage, not a live halt on this specific name — conflating them would mislabel a
socket outage as a per-ticker halt in the rejection ledger and on the WATCH/SKIP card. The surface added is
tiny (one union member + one `else if`), mirroring the D1 `earnings_unavailable` shape, so the observability
gain is worth it.

**Blast radius.** Two lanes read the halt: (1) the board scan (`scan.ts` batch G-11) — the fixed path; (2)
the desk/dossier path, which ALREADY used `shouldBlockForTradingHalt`'s fail-closed-on-stale default — so D2
brings the board into line with the desk, it does not introduce new semantics. The `else if` on the
active-halt block guarantees mutual exclusivity (an active `halted` wins; no double-block). Direction-agnostic
(applies to BOTH directional and condor lanes, like the active-halt block) — a halt is side-independent, so
NO `couldBlock` narrowing. No other call site was changed.

**Status.** Fixed on `fix/d2-halt-fail-closed` (base `fix/d1-earnings-fail-closed`, STACKED); DRAFT PR opened.
**HOLD for explicit operator go before prod merge** ([TRADES] deploy-risky per CLAUDE.md — changes what commits).

## 2026-07-25 — [D3] Option-quote staleness never checked — `OptionSnapshot` dropped `last_quote.last_updated`, so the WS-04 `stale` predicate was DEAD CODE in prod and a minutes-old but structurally-valid quote entered/graded as fresh — FIXED (plumb the timestamp ns→ms → `quoteAgeMs`)

**Severity.** High (correctness / TRADES). DANGER item **D3** from `docs/audit/NIGHTHAWK-DATA-PROVENANCE.md`
(market-open danger list). WS-04 built a fail-closed `stale` branch (`plan.ts` `evaluateQuoteValidity`,
guarded by `QUOTE_VALIDITY.max_quote_age_ms`=60000ms) but the quote timestamp was never plumbed, so the
branch never executed: a thin 0DTE contract whose last quote was minutes old — but structurally valid
(bid<ask, mark in band) — committed and graded off a **phantom mark** at an unfillable price.
**STACKED on D2 (#1103) → D1 (#1102).** **[TRADES] — DEPLOY-RISKY, HOLD for explicit operator go before
prod merge.** Strictly safer (only ever WITHHOLDS a commit on a genuinely stale quote), but it changes what
commits, so it holds on the branch until the operator says go.

**Root cause (dormant WS-04 predicate — the timestamp dropped at the mapper).** WS-04 wired the whole
`stale` path EXCEPT its input: `evaluateQuoteValidity`/`buildContractPlan` already accept `quoteAgeMs` and
fire `stale` when `quoteAgeMs > max_quote_age_ms`, but nothing ever fed a real age.
- `src/lib/providers/options-snapshot.ts`: the RAW `UnifiedSnapshotResult.last_quote` type carried
  `last_updated` (`:42`), but the exported `OptionSnapshot` type OMITTED it and the mapper never mapped it.
- `src/lib/zerodte/scan.ts` `attachContractPlans` (~689-690, pre-D3) therefore passed NO `quoteAgeMs` into
  `buildContractPlan`, so `input.quoteAgeMs ?? null` was always null and the `stale` branch was unreachable
  in production. The WS-04 unit predicate proved the LOGIC works (gates test 58, calling the helper
  directly), which masked the fact that the PRODUCTION path never supplied an age.

**UNIT verification (ns vs ms — how I confirmed).** Polygon/Massive's `last_quote.last_updated` on the
`/v3/snapshot` endpoint is a **NANOSECOND** epoch, same scale as `sip_timestamp` (`option-trades.ts:290`
divides ns→ms). Confirmed against LIVE prod data (probe, 2026-07-25): a real SPY option chain row returned
`last_quote.last_updated = 1784923199637468200` (~1.78e18). `/1e6 → 1784923199637 ms =
2026-07-24T19:59:59.637Z` — the prior session's 3:59:59pm-ET close, a SANE timestamp. Interpreting the same
value AS milliseconds overflows to an invalid far-future date (`new Date(1.78e18)` → RangeError). So the
conversion is `epochMs = Math.floor(ns / 1e6)` (identical to `tradeMs`). The unit is asserted in tests so a
future ms-vs-ns regression fails loudly.

**Evidence.** Fail-before/pass-after — reverting ONLY the three source files to the D2 base while keeping the
D3 tests:
```
=== OLD behavior (D2 base sources) ===                          === POST-FIX (D3) ===
options-snapshot.test.ts:                                       options-snapshot.test.ts:
not ok 10 - nsToEpochMs ns→ms; garbage→null                     ok 10 - nsToEpochMs ns→ms; garbage→null
not ok 11 - mapper: last_updated(ns) → quoteUpdatedMs(ms)       ok 11 - mapper: last_updated(ns) → quoteUpdatedMs(ms)
not ok 12 - mapper: NO last_updated → quoteUpdatedMs null       ok 12 - mapper: NO last_updated → quoteUpdatedMs null
# pass 15 # fail 3                                               # pass 18 # fail 0
scan.test.ts:                                                   scan.test.ts:
not ok 20 - computeQuoteAgeMs missing/fresh/stale/skew          ok 20 - computeQuoteAgeMs missing/fresh/stale/skew
not ok 21 - integration: age drives buildContractPlan stale     ok 21 - integration: age drives buildContractPlan stale
# pass 19 # fail 2                                               # pass 21 # fail 0
```
The OLD failures are `nsToEpochMs is not a function` / `computeQuoteAgeMs is not a function` / `quoteUpdatedMs
undefined` — i.e. the timestamp was genuinely absent from the prod data path. The **back-compat tests are the
important ones**: a snapshot with NO `last_updated` maps `quoteUpdatedMs=null` → `computeQuoteAgeMs` returns
`undefined` → the `stale` predicate stays DORMANT for that contract (never blocked on absence), and a FRESH
quote (age < bound) still COMMITS (gates test 60). gates test 59 proves the pre-D3 (no-age) path did NOT block
while a plumbed stale age now fires the distinct `plan_quote_stale`. `tsc --noEmit` clean; regression green:
`options-snapshot` 18/0, `gates` 72/0, `board` 97/0, `scan` 21/0, `live-marks` 29/0, `contract-ranker` 9/0.

**Fix.** Strictly ADDITIVE (plumb the existing WS-04 input; no threshold/predicate change):
- `options-snapshot.ts`: new `nsToEpochMs()` (ns→epoch-ms, null on absent/zero/non-finite/sub-ms-garbage) +
  new `OptionSnapshot.quoteUpdatedMs: number | null` mapped from `r.last_quote?.last_updated`.
- `scan.ts`: new exported pure helper `computeQuoteAgeMs(quoteUpdatedMs, nowMs)` — returns `undefined` on a
  null timestamp (predicate dormant — **absence is never staleness**) and floors a NEGATIVE age (clock skew
  between the provider quote clock and ours) to `0`=fresh (skew must not manufacture a `stale` block).
  `attachContractPlans` captures ONE cycle clock (`nowMs`) and passes `quoteAgeMs: computeQuoteAgeMs(...)`.
- `plan.ts`: no logic change — only the now-outdated "none is plumbed / dormant" comments updated to note D3
  makes the bound LIVE. Threshold (`max_quote_age_ms=60000`) and the predicate are untouched.

**Fix rationale (why absence-is-exempt + negative-is-fresh, and not the alternatives).** Blocking on a MISSING
timestamp would fail-closed on the (common, pre-market/quiet-tape) case where the provider simply omits
`last_updated`, starving the board on absence rather than on a proven stale quote — so absence keeps the
predicate dormant, matching WS-04's own min-size conditional-on-availability rule. Flooring negative age to 0
(rather than reporting a negative or huge age) means provider/our clock skew can never fabricate a `stale`
verdict. A garbage sub-millisecond `last_updated` (e.g. `1` ns → 0 ms epoch-1970) is treated as absent, not
as a decades-old quote, so junk data doesn't fail a live book closed.

**Blast radius.** `OptionSnapshot` has two other consumers besides the 0DTE scan — both are additive/null-safe
with the new field: (1) `zerodte/live-marks.ts` `markFromSnapshot` reads only named fields (`bid/ask/last/greeks`),
never `quoteUpdatedMs`, and builds its own output shape (live-marks 29/0); (2) `swing/contract-ranker.ts`'s
`OptionSnapshot → ChainContract` mapper likewise reads named fields only (contract-ranker 9/0). The
`swing-active-refresh` cron and `nighthawk/option-chain-prompt` consume via those same mappers. Neither
iterates keys nor requires the field, so adding it changes no non-0DTE behavior. The CONDOR lane is unaffected
(it skips single-contract plan-attach and gates its own 4-leg structure). No threshold or predicate was
changed — only a real age is now fed into the already-shipped WS-04 `stale` branch.

**Status.** Fixed on `fix/d3-quote-staleness` (base `fix/d2-halt-fail-closed`, STACKED); DRAFT PR opened.
**HOLD for explicit operator go before prod merge** ([TRADES] deploy-risky per CLAUDE.md — changes what commits).

## 2026-07-25 — [WS-04] Malformed-quote books passed the liquidity gate as "liquid" — percent-spread check failed OPEN on zero/null-bid, crossed, and locked markets — FIXED (fail-closed quote-validity predicate)

**Severity.** High (correctness / TRADES). A structurally malformed option quote could be treated as a
tradeable 0DTE contract and committed to the ledger, entering/grading off a phantom price. **[TRADES] —
CI-green on branch, HOLD for explicit human go before merge** (per the directive's Category-1 disposition).

**Root cause.** `src/lib/zerodte/plan.ts` computed liquidity as PERCENT-SPREAD ONLY:
`spreadPct = (ask−bid)/mark*100` guarded by `bid != null && ask != null && ask > 0 && mark > 0`, then
`illiquid = spreadPct != null && spreadPct > 15` (plan.ts ~87-93). On a malformed book the percentage
landed in a "convenient" direction and the `> 15` test waved it through:
- **zero/null bid** → the `bid != null && …` guard made `spreadPct` **null** → `spreadPct != null` is
  false → `illiquid = false` → **PASSED as liquid**.
- **crossed (bid > ask)** → `(ask−bid)` negative → **negative** `spreadPct` → `−x > 15` is false → PASSED.
- **locked (bid == ask)** → `spreadPct === 0` → `0 > 15` is false → PASSED.
There was also no mark-in-band check (a mark outside `[bid,ask]`), no absolute-dollar spread cap, and no
quote-age check. The block taxonomy in `gates.ts` `planQualityGateBlocks` (~696-735) emitted only
`plan_no_quote` / `plan_moved` / `plan_illiquid` — none of which fire on these malformed books.

**Evidence.** Fail-before/pass-after on the real plan builder + gate helper (only pre-existing exports, so
the pre-fix source compiles): four cases — zero-bid `{bid:0,ask:2.4,mark:1.2}`, crossed
`{bid:2.6,ask:2.4}`, locked `{bid:2.4,ask:2.4}`, mark-out-of-band `{bid:2.3,ask:2.5,mark:3.1}` — each
built via `buildContractPlan` then checked with `planQualityGateBlocks`:
```
=== PRE-FIX (stashed) ===        === POST-FIX ===
not ok 1 - zero-bid blocks       ok 1 - zero-bid blocks
not ok 2 - crossed blocks        ok 2 - crossed blocks
not ok 3 - locked blocks         ok 3 - locked blocks
not ok 4 - mark out of band       ok 4 - mark out of band
# pass 0  # fail 4               # pass 4  # fail 0
```
Full `gates.test.ts`: 55 → 64 tests, all pass; `board.test.ts` 97/0; `scan.test.ts` 17/0 and
`skip-grading.test.ts` 11/0 (with `--experimental-test-module-mocks`); `tsc --noEmit` clean.

**Fix.** Strictly ADDITIVE fail-closed predicate `evaluateQuoteValidity` in `plan.ts` requiring ALL of:
`bid>0`, `ask>0`, `ask>bid` (rejects crossed AND locked), `mark ∈ [bid,ask]`, `ask−bid ≤ max_spread_dollars`
(new $5.00 backstop constant), plus two conditional-on-availability bounds — `quote_age ≤ max_quote_age_ms`
(60s) and `min_quote_size` (1 contract each side). It returns a distinct `QuoteInvalidReason`
(`zero_bid`/`crossed`/`locked`/`mark_out_of_band`/`wide_dollars`/`thin_size`/`stale`/null) exposed on
`ContractPlan.quote_invalid_reason` (OPTIONAL field → null-guarded, back-compat with historical/hand-built
plans). `planQualityGateBlocks` translates a non-null reason into a distinct block: `stale` →
**`plan_quote_stale`**, every other reason → **`plan_quote_invalid`** (both added to the `ZeroDteGateFailure`
union in `board.ts`). The existing 15% `illiquid` → `plan_illiquid` check and all other blocks are untouched.
`scan.ts` `attachContractPlans` now threads `snap.bidSize`/`snap.askSize` (already on `OptionSnapshot`) into
the builder so the min-size predicate can enforce when present.

**Fix rationale.** Additive predicate + distinct codes (not a rewrite of the % check) so the block taxonomy
grows without touching graded behavior of the existing codes; the 15% illiquid check is deliberately KEPT
(it catches proportionally-wide books the absolute $ cap does not). Fail-closed: a null/zero/degenerate side
BLOCKS, never passes — the inverse of the loophole. `quote_age` is written as a live predicate but stays
**dormant** because no quote timestamp is plumbed onto `ContractPlan` today — `OptionSnapshot` maps
`last_quote.bid/ask/bid_size/ask_size` but NOT `last_quote.last_updated`. Rather than a large refactor to
thread a timestamp end-to-end (out of scope for this fix), the predicate activates the moment an age is
supplied, tested directly against the helper; the gap is noted here and in-code (`scan.ts`). `min_quote_size`
is conditional-on-availability (absent size is not proof of illiquidity). New codes bucket cleanly:
`zerodte_scan_rejections.gate_failed` is `TEXT` read back via `String()` everywhere (db.ts, skip-grading.ts,
grid-rejections-read.ts) — no enum switch to choke; no migration.

**Blast radius.** One root cause, one seam (`buildContractPlan` → `planQualityGateBlocks`), consumed by BOTH
fresh-commit lanes that reuse it: `evaluateZeroDteGates` (gates.ts:575, the scan-time verdict) and the
persist defense `freshCommitBlockedByPlan` / `planQualityGateBlocks` in `persistZeroDteScan` (scan.ts:744,
754). CONDORs are unaffected — they carry no single-leg directional plan (`s.plan` null) and are gated on
`condor_plan` liquidity separately, exactly as before. `resolveLedgerEntryPremium` / `gradePlanFromBars` /
`derivePlayStatus` untouched.

**Status.** FIXED on `fix/ws-04-malformed-quote-gate`. Tests fail-before/pass-after (above); tsc clean.
**Draft PR — HOLD for explicit go before merge (TRADES).**

## 2026-07-25 — [WS-01] Governor commit was a TOCTOU race — two overlapping scans could each commit past GOVERNOR_MAX_CONCURRENT_PLANS — FIXED (atomic xact-lock recount)

**Severity.** High (portfolio risk / over-exposure). This is the exact 7/13-class failure the session
governor exists to prevent — concurrently-open plans breaching the 3-play cap.

**Root cause.** `src/lib/zerodte/scan.ts` `persistZeroDteScan` (~line 706+) commits fresh plays with NO
DB-level serialization around count→evaluate→insert. The governor verdict (`evaluateZeroDteGovernor`,
`src/lib/zerodte/governor.ts:394`) is computed EARLIER in the pipeline against a snapshot read at scan
START; persist then re-reads the pre-cycle open book (`fetchZeroDteSetupLog`, scan.ts:728) and calls the
per-row `INSERT … ON CONFLICT` (`upsertZeroDteSetupLog`, db.ts:4686) on a pooled connection. Between the
count and the insert there is a classic time-of-check/time-of-use gap: two overlapping passes (the
member-poll path and the cron `warmZeroDteBoard` path, or two ECS replicas) can each read the same
pre-cycle count (say 2 open, cap 3), each independently decide "room for 1 more", and BOTH insert —
producing 4 concurrently-open plans past the cap. The pure governor's `committedThisCycle` threading only
bounds a SINGLE scan pass against ONE snapshot; it has no cross-pass/cross-replica interlock.

**Evidence.** New hermetic test `scan.test.ts` "WS-01 … RACE": book 2/3 open (a racing writer's committed
row surfaced only via the in-transaction recount), two fresh candidates NVDA(80)/AMD(70) that BOTH gated
COMMIT at scan time. OLD path would insert both → 4 open. NEW path: the transactional recount re-runs the
pure governor in score order threading acceptedThisTxn — NVDA takes the last slot, AMD returns
`governor_max_concurrent` and is DROPPED, recorded to `zerodte_scan_rejections` (asserted
`gate_failed === "governor_max_concurrent"`, reason matches /max 3 concurrent/). Companion
"WS-01 … UNCONTENDED" test: with no concurrent writer the recount equals the scan-time snapshot, so the
SAME candidates commit (both admit at 1-open+2-fresh) — behavior byte-identical, and zero rejections.

**Fix.** New `commitFreshZeroDteRowsAtomic(sessionDate, select)` in `src/lib/db.ts` (near
upsertZeroDteSetupLog): `BEGIN` → `pg_advisory_xact_lock(hashtext('zerodte:commit:<session_date>'))` (the
XACT variant so the lock auto-releases at COMMIT/ROLLBACK — no manual unlock, no leak on error, matching
the repo's `hashtext($1::text)` convention) → re-SELECT the current open book INSIDE the lock
(transactional recount) → run the caller's `select` (the recount+re-evaluate) → per-row INSERT … ON
CONFLICT → COMMIT (ROLLBACK on error, returns null). The lock wraps ONLY count→evaluate→insert; zero
provider/network I/O happens under it (chain quotes/Polygon/UW all ran before persist). `persistZeroDteScan`
now routes ONLY fresh candidates (`committedFresh`) through this path — inside the lock it re-derives the
snapshot via `deriveGovernorFromLedger` and re-runs `evaluateZeroDteGovernor` per candidate IN SCORE ORDER,
threading acceptedSoFar into `committedThisCycle`; a candidate that now blocks is dropped and recorded to
rejections (fail-VISIBLE). REFRESH rows (ticker already in the ledger) are NOT new exposure and are never
cap-limited — they upsert exactly as before. The single upsert SQL was extracted into one shared helper
(`upsertOneZeroDteSetupRow`) so the plain and atomic paths can never drift.

**Fix rationale.** No `ZERODTE_ATOMIC_COMMIT` flag needed: the change is strictly-more-conservative and
proven uncontended-identical by test — the atomic path re-runs the SAME pure governor against the SAME
snapshot when there is no racing writer, so the same rows commit. This channel can only ever WITHHOLD a
commit that races past the cap, never add one. If `dbConfigured()` is false or the txn/lock cannot be
acquired, `commitFreshZeroDteRowsAtomic` ROLLS BACK (nothing inserted) and returns null; the caller falls
back to the plain pooled upsert — which cannot double-insert precisely because the rollback wrote nothing.
Pure governor logic, the gate union, Cortex, grader and exit paths are deliberately untouched.

**Blast radius.** Both scan entry points that reach `persistZeroDteScan` are covered by the one atomic
seam: the member-poll path and the cron `warmZeroDteBoard` path, and — because the lock is a Postgres
advisory lock keyed by session date — across BOTH ECS replicas (the lock is DB-side, not per-process,
unlike the existing `heldLockClients` try-lock map). `upsertZeroDteSetupLog` keeps its original signature/
behavior for every other caller. `persistZeroDteScan`'s return is now actual-committed
(`freshlyFlagged.size + refreshRows.length`) instead of attempted (`rows.length`) — identical when
uncontended, honest when a recount drops a racer.

**Status.** FIXED on `fix/ws-01-governor-atomicity`. `tsc --noEmit` clean; `scan.test.ts` 17/17 (15→17,
+2 WS-01), `governor.test.ts` 32/32, `rejections.test.ts` 12/12 green. Draft PR opened.

## 2026-07-25 — [WS-19] BREAKOUT trusted a successful grouped-daily response regardless of bar freshness — FIXED (fail closed)

**Severity.** Medium (data-correctness / fail-open). Live-board discovery input; no crash, but a stale
snapshot could silently drive the whole-market BREAKOUT origin and — worse — read as a *genuine* "no
breakouts today".

**Root cause.** `src/lib/zerodte/breakout-discovery.ts` (`discoverBreakoutSetups`) skipped only on the
RTH-window gate and on an EMPTY grouped result (`results.length === 0`, old line ~58). A *successful,
non-empty* grouped-daily response from `fetchDailyMarketSummary` was trusted unconditionally — its bar
freshness was never checked. A provider/cache hiccup that serves a stale-but-non-empty snapshot (e.g.
yesterday's bars) during RTH would (a) drive `screenBreakoutMovers` off dead data, and (b) if it screened
to nothing, be indistinguishable from a real quiet market. Not caught earlier because the only staleness
defense was "empty ⇒ skip"; a stale non-empty payload has neither an empty guard nor a freshness guard.

**Evidence.** New hermetic test `breakout-discovery.test.ts` (7 cases). With `nowMs` fixed at
2026-07-24T15:00Z and a grouped snapshot whose freshest bar is dated 26h earlier: OLD code path (screen +
build) would have produced candidates from the stale bars; NEW code returns `{status:"data_unavailable",
reason:"stale_snapshot", setups:[]}` and never calls the screen/chain (asserted call-count 0). A fresh
(19h-old, same-session) snapshot that screens to nothing returns `{status:"ok", setups:[]}` — DISTINCT
from stale. Polygon grouped-daily confirmed to carry a per-bar `t` (Unix-ms window start).

**Fix.** Added `BREAKOUT_MAX_BAR_AGE_MS` (24h, rationale commented) + pure `assessGroupedBarFreshness()`.
`discoverBreakoutSetups` now reads the freshest bar's `t`; if age > threshold, or no bar exposes a `t`, it
returns a `data_unavailable` outcome (fail CLOSED) instead of an empty list. Return type changed from
`EnrichedZeroDteSetup[]` to a discriminated `BreakoutDiscoveryOutcome` ({status, setups, reason?}) so a
stale snapshot is never conflated with a genuine empty. Daily granularity is honestly commented: `t` is
the session-open window start, so this catches the dominant real failure (a prior-day/cached snapshot
during RTH), NOT intra-session freeze — the 24h cap sits above any legit same-day age (≤~20h in the
[9:30,15:00) window) and below any prior-day bar (≥~33h). `t?: number` added to `DailyMarketBar`.

**Blast radius.** Sole caller is `scan.ts` (~line 264), updated to consume `outcome.setups`. No other
consumer of `discoverBreakoutSetups`. `fetchDailyMarketSummary`'s other callers (`fetchPriorDayCloses`,
breadth) are untouched — the added optional `t` field is additive. Fail-closed direction only: the change
can REMOVE stale-driven candidates, never ADD any; the flow board is untouched on every non-`ok` outcome.

**Status.** FIXED on `fix/breakout-grouped-bar-age-ws19`. `tsc --noEmit` clean; 7/7 new tests pass;
`scan.test.ts` 15/15 still green. Draft PR opened.
## 2026-07-25 — [Hardening WS-20] Record intentional-design items + add offline A/B measurement — DOCS + TOOLS

**Severity.** None (additive documentation + read-only measurement). **NO production behavior changed.**

**What.** Four 0DTE-board behaviors are DELIBERATE design decisions, not oversights. Recorded each as
intentional in `docs/audit/INTENTIONAL-DESIGN.md` (rationale grounded in code + the specific offline
measurement that would justify revisiting it), and added three offline, read-only A/B harnesses so any
future change is evidence-driven:
1. **FLOW-first merge precedence** — `breakout-source.ts mergeDiscoveryOrigins` / `pin-source.ts
   mergePinOrigins` keep the highest-precedence rail (FLOW > BREAKOUT > PIN) on a same-ticker direction
   conflict, no evidence weighting; now versioned `MERGE_POLICY_VERSION="v1"` (`board.ts` L303), every
   rail's read frozen at `entry_context.origin_maps`. Measure → `scripts/audit/merge-precedence-ab.mjs`.
2. **Cortex veto is stateless** — `cortex-gate.ts evaluateCortexForCommit` recomputes fresh each pass
   (no latch/dwell), deliberately so the precision layer never suppresses a genuinely-cleared setup from
   stale state. Measure → `scripts/audit/veto-flicker-rate.mjs`.
3. **PIN wall is a single-snapshot test** — `pin-source.ts evaluatePinRegime` (L119) requires no
   cross-snapshot persistence; the five strict structural conditions + G-1 carry the honesty instead.
   Measure → `scripts/audit/wall-temporal-stability.mjs` (runs the REAL regime per snapshot).
4. **Static `BREAKOUT_MAX_CANDIDATES`** — already measured by the existing
   `discovery-recall-probe.mjs`; the **dynamic-N** question is PARKED as a documented follow-up (extend
   that probe, don't duplicate). See INTENTIONAL-DESIGN item #4.

**Evidence (harnesses run).** All three parse/import under `node --import tsx` and self-report
INSUFFICIENT DATA (never fabricate) when their DB/UW-sourced input isn't reachable offline. Smoke runs:
(a) graded a synthetic 3-row ledger — FLOW-first vs evidence-weighted disagreement detection + BOTH
directions graded on REAL Polygon minute bars (SPY/QQQ 2026-07-24); single-origin rows correctly
excluded. (b) exact flicker tally on a synthetic 4-pass roster → 3 veto episodes, 2 cleared within 3,
flicker 0.667, median passes-to-clear 1. (c) REAL `evaluatePinRegime` qualified stable vs
single-snapshot cohorts on a synthetic snapshot set (grading needs real bars). Baseline
`npx tsc --noEmit` clean before and after (scripts are `.mjs`, no `src/` touched).

**Root cause.** N/A — these are intentional choices; the finding is that they were undocumented and
unmeasured, so a future reader could "fix" them blind or change them without evidence.

**Fix.** Document as deliberate + ship the measurement (calibration-first: evidence, not gating).
Registered the tools + INTENTIONAL-DESIGN.md in CLAUDE.md's audit-toolkit list.

**Status.** DRAFT PR (docs + tools only). No behavioral change; no gate/merge/regime logic touched.

---

## 2026-07-25 — [Hardening WS-14/15] 0DTE end-to-end latency telemetry + input-age manifest — ADDITIVE observability

**Severity.** SEV-5 (observability; no behavior change). **Status.** Shipped.

**What.** The 0DTE scan had no measure of HOW LONG each pipeline hop took, nor HOW STALE each input was
AT THE INSTANT a play committed — so a slow board or a commit on aged data had no persisted evidence to
root-cause. New pure module `src/lib/zerodte/latency-telemetry.ts` (mirrors `api-telemetry.ts`: bounded
in-process ring buffers + a shared nearest-rank `percentile()`):
- **WS-14 span/latency.** `scanZeroDteBoard` stamps `scan_started/candidate_derived/chain_received/
  gates_completed/cortex_completed` wall-clocks and records per-hop stage durations + overall scan
  duration; `persistZeroDteScan` records per-commit end-to-end latency (freshest flow print → commit)
  bucketed BY discovery origin.
- **WS-14 input-age manifest.** `entry_context.input_age_manifest` is frozen at commit = age (ms) at
  decision time of each input {flow, underlying, option_quote, gex, vix, macro, spy_bias}. Computed from
  timestamps ON the setup at commit (`flow`=`last_seen`, `underlying`=`intraday.last_bar_ms`); the inputs
  that carry no per-value timestamp into the commit function are stored **null** — the "never fabricate
  an unknown age" rule — not back-filled from a cache TTL.
- **WS-15 counters.** Per-session committed-row write counter + committed-**ungradeable** rate (rows the
  grader stamps `ungradeable` / total committed). All three surfaced on `admin-zerodte-health.ts`
  (`ZeroDteHealthSnapshot.latency`).

**Additive guarantee.** Every recorder swallows its own errors and returns void; nothing is ever read back
as a gate/grade/commit input. `entry_context.input_age_manifest` is an optional field (pre-WS-14 rows
carry it undefined). No gate/Cortex/governor/grader decision path was touched.

**Evidence.** `npx tsc --noEmit` → clean (exit 0). New `latency-telemetry.test.ts` (6 cases: manifest
all-keys/null-where-unknown, clock-skew clamp, nearest-rank p50/p95/p99, stage-duration deltas, origin
bucketing, full snapshot incl. ungradeable-rate=0.25 and null-rate for a zero-committed date) + extended
`scan.test.ts` (the COMMIT test asserts the frozen manifest has all 7 keys, real ages for flow/underlying,
null for the rest) → 6/6 + 15/15 pass; `entry-context.test.ts` 8/8, `admin-zerodte-health.test.ts` 12/12
unaffected.
## 2026-07-25 — [WS-21/22] WS reconciliation + recovery health states + amended-print handling (FLAG-OFF)

**Severity.** SEV-4 (hardening / capability; ZERO live behavior change until graduated).

**What.** Adds — all behind a DEFAULT-OFF flag — reconnect gap reconciliation, an explicit source
recovery health state machine, a commit-authorization gate, a dead-letter path, and amended-print
supersede handling. New pure modules: `src/lib/ws/source-health.ts`, `src/lib/ws/flow-reconciliation.ts`,
`src/lib/flow-dlq.ts`, `src/lib/flow-amendment.ts` (each with a `*.test.ts`). Wired into
`src/lib/ws/uw-socket.ts` (lifecycle transitions, reconnect reconciliation, per-row DLQ, admin health),
`src/lib/zerodte/gates.ts` (the gate), `board.ts` (`source_recovering` failure code), `scan.ts` (passes
the flag), `pane.ts` (label).

**Root cause addressed.** On a WS drop+reconnect the in-process live view has a GAP (frames delivered
during the outage were never seen), yet the desk would keep committing off it. Separately, an amended UW
print lands as a new `alert_id` and double-counts the underlying event in aggregates; and an unprocessable
message was silently swallowed with no operator signal.

**WS-21.** Source health lifecycle OFFLINE→RECOVERING→CATCHING_UP→WARM→HEALTHY. On reconnect (gate armed
only) a REST backfill runs from `last_confirmed_provider_ts − overlap_buffer`, deduped by `alert_id`
(reusing `makeFlowDedup`), and the source is marked HEALTHY only AFTER catch-up + a warm window. The
commit gate `commitAuthorizedBySourceHealth` withholds new source-dependent commits until HEALTHY —
**behind `ZERODTE_REQUIRE_HEALTHY_SOURCE` (default OFF)**. Flag off ⇒ gate is a no-op, existing freshness
thresholds still govern, commit path byte-for-byte unchanged; flag off also means NO reconnect REST
backfill fires (the existing flow-ingest cursor cron still covers gaps). DLQ (`flow-dlq.ts`) captures
malformed frames + poison rows best-effort, never blocking ingest.

**WS-22.** `flow-amendment.ts` ledger keys by the underlying-event identity (event_key → amends_id →
alert_id), SUPERSEDES the prior version on a newer amendment (version, then receipt-time tiebreak), and
`aggregatePremium()` reads the latest per identity — no double count. Idempotent: replaying the same
amendment is a no-op ("duplicate").

**Evidence.** `npx tsc --noEmit` clean (exit 0). New tests: source-health 6, flow-reconciliation 5,
flow-dlq 4, flow-amendment 7, plus 3 WS-21 integration cases in `gates.test.ts` (53→56) — all green. The
reconciliation test simulates a reconnect gap (overlap re-fetch of a1/a2 already seen + missed a3/a4) and
asserts only a3/a4 are processed once; the gate test asserts flag-OFF verdict == unchanged in every source
state, flag-ON withholds until HEALTHY.

**Graduation.** Flip `ZERODTE_REQUIRE_HEALTHY_SOURCE=1` to arm the warm-up gate + reconnect reconciliation.

**Status.** Merged flag-OFF (no behavior change). Follow-ups: durable `flow_dlq` sink via `setDlqSink`;
route live amended prints through the ledger at the aggregation read sites (blast-radius-heavy — deliberately
out of scope here).

## 2026-07-25 — [Q10] Discovery recall probe: the BREAKOUT top-6 $-volume cap is LEAKY — NEW TOOL

**What.** "No silent caps" (design Q10). The BREAKOUT origin screens the whole market (~12k grouped-daily
names) but `discoverBreakoutSetups` keeps only the top `BREAKOUT_MAX_CANDIDATES` (=6) by $-volume
(`breakout-discovery.ts:74`, `movers.slice(0, 6)`) — rank 7+ is silently dropped and never graded. New
read-only probe `scripts/audit/discovery-recall-probe.mjs` screens a session with the EXACT production
ranking (`screenBreakoutMovers`, imported from src), splits qualifying movers at the production cap into
KEPT (top-6) vs DROPPED (rank 7…N), and grades each name's intraday continuation on REAL Polygon minute
bars (favorable-first proxy for a long ATM-0DTE call: underlying +1.5% before −0.75%, entry 10:00 ET).

**Evidence (5 real sessions, `--scan-top=40`).** Win-rate KEPT(top-6) vs DROPPED(7–40), + recall misses
(dropped names that were favorable-first winners):
- 2026-07-24: KEPT 33% / DROPPED **50%** — 17 misses (NBIZ +27.7%, IREZ +14.7%, RKLZ +15.2%…)
- 2026-07-23: KEPT 50% / DROPPED 38% — 13 misses
- 2026-07-22: KEPT 17% / DROPPED **29%** — 10 misses
- 2026-07-21: KEPT 17% / DROPPED **29%** — 10 misses
- 2026-07-20: KEPT 83% / DROPPED 44% — 15 misses
→ On 3 of 5 sessions the DROPPED tail won at least as often as the kept top-6, and EVERY session dropped
10–17 winning movers. The $-volume rank favors megacaps, which continued LESS than smaller high-gain
movers below the cut. The cap is real recall leakage.

**Root cause.** Ranking the momentum/continuation lane purely by $-volume (a liquidity proxy) then hard-
capping at 6 selects for size, not for the intraday follow-through a 0DTE call needs.

**Fix (this change): MEASURE it, don't blind-widen.** Ship the probe as committed evidence (calibration-
first — evidence, not gating). It quantifies the recall cost per session so a cap decision (raise
`BREAKOUT_MAX_CANDIDATES`, or rank the lane by gain×close-strength instead of $-volume) is made on data,
not a guess. Caveats stated in-tool: n=6 kept is tiny, single-day proxy (underlying continuation, not
exact option P&L) — the probe is the honest bound, not a verdict on one session.

**Status.** Tool committed; multi-session evidence logged. Follow-up (separate PR, on the evidence): a
gain-weighted rank and/or a wider cap for the breakout lane, graduated on the origin band.

## 2026-07-25 — [Phase 4] Iron-CONDOR as a live SELL-side 0DTE play-type (flag-gated `ZERODTE_CONDOR`, default OFF) — LANDED

**What.** The board committed DIRECTIONAL single-contract plays only. Phase 4 adds the non-directional
iron-condor SELL structure, fed by the PIN discovery origin (deep long-gamma dealer-defended ranges).
Triple-flag-gated OFF (`ZERODTE_CONDOR` + the PIN source's `ZERODTE_WHOLE_MARKET`/`ZERODTE_SRC_PIN`),
so production is byte-for-byte unchanged until all three are on.

**Files.** `board.ts` (`play_type: "DIRECTIONAL"|"CONDOR"` default DIRECTIONAL on `ZeroDteSetup`, stamped
at every construction site; `condor_plan` on the enriched setup; 4 new gate-failure codes) · new
`condor.ts` (router `condorSellRegime`, `buildCondorPlan`, liquidity gate, range-intact proxy, grader
`gradeCondorFromBars`, seed→setup `buildCondorSetup`) · `pin-source.ts`/`breakout-source.ts` (stamp
DIRECTIONAL) · `pin-discovery.ts` (condor routing off the same chain, falls back to the fade when
geometry/legs unavailable) · `gates.ts` (branch by `play_type` — the delicate part) · `scan.ts` (skip
directional plan-attach for condors; pass play_type/condorPlan to the gates; persist play_type +
geometry in `entry_context`; route condor grading in `gradeZeroDteLedger`) · `macro-hard-block.ts`
(`hasHighImpactMacroEvent`) · `calibration.ts` (`play_type_bands`).

**Gate branch by play_type (the delicate part).** For a CONDOR: G-1 tape-alignment + its no_market_bias
companion / G-10 intraday-conflict / G-12 confluence / G-6 cross-system are all SKIPPED (nothing
directional to judge on a delta-neutral structure); directional plan-quality (G-8/G-9) is REPLACED by a
condor liquidity gate (4 legs quotable + net credit ≥ wing-risk floor + per-leg spread tax ≤12%); G-4
VIX blocks the sale outright at ≥17 (no score escape hatch) + fails closed on unavailable VIX; G-7 macro
holds the sale for the WHOLE session on any high-impact release (a breakout is a condor's worst case) +
fail-closed; a cheap range-intact proxy blocks when spot has crept to a short. Shared (both types): G-2
window, G-3 score floor, G-5 governor, G-11 halt/earnings. Grading: WIN=close-inside-both-shorts (+credit)
/ DEFINED-LOSS=breach (−max_loss, capped) — never the −50/+100 grader; realized credit/loss in
`plan_outcome`/`plan_pnl_pct`. WR surfaced ≤97 with the 18.7% breach companion (iron-condor.ts honored).

**Deferred (follow-ups):** rich condor exit management (only hold-to-close + breach-stop here); a full
Cortex gex-walls range-intact read (spot-proximity proxy stands in); condor UI leg rendering; dead-CENTER
pin discovery (the router only sees off-center pins `evaluatePinRegime` emits — condor routes the tight/
centered *subset* of those). **Calibration-first:** condor sizes nothing until its `play_type_bands`
ledger clears real credits + breach fills.

**Verify.** `tsc --noEmit` clean; `lint:brand` clean; new `condor.test.ts` 31/31; full zerodte suite 503
pass (7 pre-existing `mock.module`-unsupported failures in this Node sandbox, unrelated); `sim:0dte` runs
unchanged (flags off). **Status:** committed to `fix/zerodte-condor-playtype`, pushed for lead review (no
PR/merge per instruction).

## 2026-07-24 — [firewall RTH replay] Phase-0 fail-closed firewall would have HELD both of today's committed 0DTE plays — both losers (−54.9% avoided) — VALIDATED

**Harness.** `scripts/audit/firewall-rth-replay.mjs` — replays a session's live 0DTE board OLD (guards off)
vs NEW (Phase-0 firewall on, PR #1078) and diffs. Read-only vs prod (one temp Clerk user, deleted). Flow via
UW REST with the exact `scanZeroDteBoard` params; OTM-cap toggle applied as the guard's own per-ticker
post-filter (cross-checked byte-exact vs a real `cap=12` child run); G4/G7 toggled in real env-toggled child
processes; Cortex veto-blind via `assessCortexVerdict(v,{failClosedOnVetoBlind})`.

**Result 2026-07-24 (2 real commits, both held, both losers):**
- **MU long 980c** — committed with `entry_context.vix_open=null` → G-4 `vix_unavailable` HOLD (non-index) → actual **−50%** (LOSER AVOIDED).
- **SPXW long 7425c** — committed cortex `PASS` but **both** veto sources (gex-walls+flow-quality) absent → `veto_blind` HOLD → actual **−4.92%** (LOSER AVOIDED). VIX was fine (18.96).
- Net: **2 losers avoided / 0 winners forgone; −54.9% combined play P&L avoided** (unsized %). Each play caught by a *different* guard (not one over-broad rule). Far-OTM cap + earnings-past-top-5 were inert today (correct — tail insurance).
- Part D proves all three code-path guards fire on injected outages (VETO_BLIND vs PASS; `vix_unavailable`/`macro_unavailable` BLOCKED vs COMMIT).

**Honest tradeoff on the record:** the firewall EMPTIED the board today (held both commits) — correct because both
lost, but a veto-blind / VIX-null hold could forgo a winner on another day; every guard has an env kill-switch.
Also note today's provider reads were flaky at commit time (VIX null, both veto sources absent) — exactly the
fail-OPEN condition the firewall exists for.

**[SEV-4, follow-up] `macroUnavailable` (and the fail-open flags generally) are NOT persisted on the ledger.**
`macroUnavailable`/`vixUnavailable`/veto-blind are transient scan-time gate inputs; only `vix_open` and the cortex
absent-list survive on `entry_context`, so a committed play's macro-at-commit state is UNKNOWABLE post-hoc (the
replay reports it as such, never inferred). **Fix (future):** persist the fail-closed gate signals on the ledger
row so this replay — and per-guard calibration — is exact. Aligns with the design's "persist gate-verdict / grade
the skips" recommendation (`0DTE-UNIFICATION-DESIGN.md`). Status: OPEN (tracked; low priority).

## 2026-07-24 — [SEV-3, member-facing display] 0DTE board setup SCORES flip-flopped between two values across a member's poll (board assembled per-replica, no shared snapshot) — FIXED

**Symptom (live evidence).** A 4-round authenticated poll of `/api/market/zerodte/board` ~12s apart
(17:18 UTC 2026-07-24) showed the board `as_of` ADVANCING every round (fresh builds) while the setup
SCORES alternated between exactly TWO states: round1==round3 (QQQ=68, MU=52, SNDK=60) and
round2==round4 (QQQ=50, MU=56, SNDK=52). A member's ~5s SWR poll round-robins across web replicas →
scores JUMP between two values. CONTRAST: in the SAME poll the live MARKS were monotonic/consistent
(QQQ 11.36→11.29→11.04→10.915) because they ride the shared `nw:optmark:` Redis write-through — the
fast lane is converged cross-replica; the board was NOT.

**Root cause (confirmed by code).** `getZeroDteBoardPayload` served the board through
`withServerCache("zerodte:board:v1", 5s, buildZeroDteBoardPayload)`. `withServerCache` prefers each
replica's OWN in-process store during the 5s fresh window (`server-cache.ts:131`) and its background
SWR refresh re-runs `buildZeroDteBoardPayload` LOCALLY (`server-cache.ts:218` → the loader), so the
Redis layer is continuously overwritten by whichever replica rebuilt last and is bypassed on the hot
path. The board is therefore ASSEMBLED PER-REPLICA (root cause class **a**), and `buildZeroDteBoardPayload`
→ `scanZeroDteBoard` scores each setup off per-replica-cached inputs — the per-ticker
`zerodte:intraday:<t>:<day>` reads (3-min TTL, replica-local while fresh; `scan.ts:257`) and
`zerodte:vix-open` — which each replica warmed at a DIFFERENT instant with a DIFFERENT bar snapshot
(root cause class **c**). Result: each replica converges to its OWN stable-but-different score set,
stable for the ~3-min intraday-cache life (matches the 4 rounds ~36s apart), and the member poll
alternates between replicas. Marks did not flip because `mapLedgerRow` reads them from the shared
`nw:optmark:` store every replica READS in common.

**Fix (`fix/zerodte-board-convergence`).** Give the WHOLE board the marks lane's property — one shared
snapshot every replica reads. `getZeroDteBoardPayload` now reads a shared Redis snapshot
(`zerodte:board:snapshot:v1`, `shared-cache.ts`) and serves it directly, so any two reads across any
two replicas within a cycle return the byte-identical board. Liveness is preserved with a
stale-while-revalidate refresh: a snapshot younger than 5s is served as-is; once it ages past 5s the
next reader fires a SINGLE-WRITER background rebuild (NX build-lock elects one replica per cycle,
deletes the lock after publishing so the next cycle advances); only a cold miss or a snapshot older
than 30s blocks on a build, and that build publishes so peers converge onto it. The ~1-5 min cron
warmer (`api/cron/zerodte-warm`) now calls the new `refreshZeroDteBoardSnapshot()` to proactively
rebuild+publish each tick so the shared snapshot advances even with zero member traffic (mirrors
"scan/cron builds once → writes the shared store"). Fail-soft throughout: any shared-store error
(`sharedCacheGet/Set/SetNx`) degrades to a local build — the pre-fix per-replica behaviour — never a
blank board. NO change to the scan/scoring/gates or to WHAT commits — only WHERE the served board
comes from.

**Files:** `src/lib/platform/zerodte-service.ts` (shared-snapshot read/publish/SWR + cron publisher;
dropped `withServerCache` for the board), `src/app/api/cron/zerodte-warm/route.ts` (proactive publish),
tests `src/lib/platform/zerodte-board-convergence.test.ts` (new) + `zerodte-service.test.ts`
(always-miss shared-cache mock so its state-driven cases stay isolated).

**Evidence.** `npx tsc --noEmit` clean; `zerodte-board-convergence.test.ts` 4/4 (two reads within a
cycle = one build + identical `as_of`; snapshot advances across cycles; SWR single background rebuild
republishes a newer `as_of`; shared-store outage still serves `available:true`); `zerodte-service.test.ts`
11/11, `zerodte-service-marks` 1/1, `zerodte-ledger-pnl` 1/1, `horizon-board-from-payload` 5/5,
`nighthawk/horizons` + `admin-zerodte-health` 16/16; `check-brand.mjs` clean.

**Status.** FIXED on `fix/zerodte-board-convergence`. **SAFE TO DEPLOY MID-RTH** — serving-consistency
only: this changes WHERE a replica reads the board from (shared snapshot vs its own in-memory build),
not the scan/scoring/gates or what commits; fail-soft to the old local build on any Redis hiccup.
NON-DRAFT PR; no auto-merge (lead reviews — touches the core board).

## 2026-07-24 — [SEV-3, member-facing display] 0DTE Command Deck showed Δ Γ Θ V IV + mark "—" for every WATCH-only setup (live greeks never sourced for non-entered contracts) — FIXED

**Symptom (live screenshot).** Selecting a WATCH-only setup (not entered — below the score floor /
SKIP / BLOCKED) on the 0DTE Command Deck (`PlayTerminal.tsx`) rendered **Δ Γ Θ V IV all "—"**,
**"mark —"**, PnL **"— not entered"**. Only ENTERED ledger plays ever showed live greeks/mark.

**Root cause.** The 1s live-marks lane quoted ENTERED ledger plays only. `live-marks.ts`
`getActivePlays()`→`boundActivePlays()`→`toActivePlay()` tracks non-CLOSED ledger rows; a watch setup
is never in the ledger, so its `plan.occ` never entered the mark store → never in
`/api/market/zerodte/marks(/stream)` → `use-live-marks.ts` `overlayLiveMarks` (which overlays
mark/pnl/greeks **by OCC**) found no row → the terminal fell back to the adapter's hardcoded
`greeks: null` (`adapters.ts:149`) + `mark: fin(src.last_mark)` (null for a non-entered setup).

**Fix.** Extend the lane to ALSO quote the CURRENT board setups' contracts as **quote-only**:
- `zerodte-service.ts` `buildZeroDteBoardPayload` pushes the watch-only setups' OCCs
  (`registerSetupQuotes` → `setZeroDteSetupQuotes`) into the lane each build (~5s). Watch-only = a
  setup whose ticker is NOT in today's ledger (an entered/managed/closed ledger ticker OWNS its card's
  mark via the entered lane; quoting its possibly-different-strike setup contract would overlay a
  mismatched mark). No plan OCC → skipped. Sourced from the assembled board — no re-derivation.
- `live-marks.ts` `mergeTrackedContracts` merges entered plays (PRIORITY, cap-first, never evicted)
  with setup quotes (remaining slots, deduped by OCC), hard-capped at `ZERODTE_LIVE_CONTRACT_CAP` (16).
  Setup plays carry `quote_only:true` + `entry_premium:null`. The poller quotes the FULL set (WS →
  batched-REST fallback, which carries greeks — covers the code=1006 options-WS flaps); the persist /
  exit-engine / latch pass iterates the ENTERED list ONLY. `pinnedLivePnlPct(null, mark)===null` keeps
  PnL honest ("not entered"); only greeks + live mark populate. `overlayLiveMarks` then fills the
  terminal automatically (unchanged).

**Files:** `src/lib/zerodte/live-marks.ts` (registry + `mergeTrackedContracts` + tick/payload merge),
`src/lib/platform/zerodte-service.ts` (`registerSetupQuotes` push), tests in
`src/lib/zerodte/live-marks.test.ts`.

**Evidence.** `npx tsc --noEmit` clean; `live-marks.test.ts` 29/29 pass (9 new: watch setup surfaces
greeks+mark with `live_pnl_pct:null`; entered plays prioritized + still persisted/exited; cap
entered-first/never-evicted; setup deduped/no-occ-skipped; ledger persist NOT invoked for a setup-only
OCC); all `src/lib/zerodte/*.test.ts` 487/487 pass; command-deck suites pass; `check-brand.mjs` clean.

**Status.** FIXED on `fix/zerodte-setup-live-greeks`. **SAFE TO DEPLOY MID-RTH** — display-only; a
watch setup gets a QUOTE ONLY, never a ledger row/status/persist/exit, so nothing about what trades
commit changes. NON-DRAFT PR; no auto-merge (per launch instruction).

## 2026-07-24 — [GO-LIVE, REAL MONEY] SWING engine taken LIVE — commit + roll now open REAL member positions (operator-authorized "everything live")

**Status: NON-DRAFT PR, HELD for lead review of the commit gate before deploy (no auto-merge).** Branch
`feat/swing-commit-roll-live`. The operator EXPLICITLY authorized the swing lane live ("GO — everything
live, not paper-first"). This lifts the three deliberate holds — discovery's literal-`0`
`commitEligibleCount`, the unreachable `insertSwingPosition`, and the un-wired `roll.ts` — behind FOUR
conjunctive hard rails. Nothing was weakened; the commit was WIRED to fire only where the existing
graduation/Wilson-LB/persistence gates already say eligible.

**The exact commit-trigger condition (`src/lib/swing/commit.ts` `computeSwingCommitPlan`).** A WATCH
candidate opens a real position IFF ALL of:
1. **GRADUATION** — its archetype×sub-lane bucket has GRADUATED through the shipped staged Wilson-LB
   ladder: `analyzeArchetypeRecord(...).floorGraduated` **AND** `analyzeSubLaneRecord(...).floorGraduated`
   over the live graded history (`isCommitGraduated`). BOTH floors — the conservative reading, reusing the
   PR-16 wrappers verbatim (zero new calibration math). Cold book / thin record (n<30, or Wilson-LB below
   the bar) ⇒ nothing graduates ⇒ nothing commits. That is the rail, not a bug.
2. **ARMED BUDGET** — the candidate, added to the live book, must not push a portfolio-risk dimension it
   contributes to into HARD over-limit (`evaluateSwingCommitBudget`).
3. **BOOK-PERCENT CAPS** — orthogonal %-of-member-book concentration (`allocateSwingBook`): per-position
   5% / theme 20% / total-in-swings 40% / max-3-same-week-expiry.
4. **IDEMPOTENCY** — a stable `commit_key` (`${session}:${TICKER}:${SUBLANE}:${dir}`); a name already open
   under that key is never re-opened (and `insertSwingPosition` upserts on it as a DB backstop).
Any failure ⇒ no commit, with a queryable `blockedBy` reason. `commitEligibleCount` is now the REAL count
of graduated WATCH candidates (was a hardcoded literal `0`).

**Armed budget — the operator-delegated numbers (`swing-portfolio-budget.ts` `PRODUCTION_PORTFOLIO_BUDGET`,
env-overridable via `resolveProductionPortfolioBudget`).** Against a **$100k reference account** (the
engine's own model book; members size to their own capital at serve time): `maxPortfolioLossPct 6`
(total book heat $6k), `perPositionLossPct 2` (per-trade $2k), `eventExposureCap 3` ($3k of EVENT_DRIVEN /
POST_EARNINGS_DRIFT exposure), `overnightCap 4` ($4k, every swing is overnight), `enforce true`. Env
overrides: `SWING_CAPITAL_USD / SWING_MAX_PORTFOLIO_LOSS_PCT / SWING_PER_POSITION_LOSS_PCT /
SWING_EVENT_EXPOSURE_CAP / SWING_OVERNIGHT_CAP / SWING_BUDGET_ENFORCE`. `DEFAULT_PORTFOLIO_BUDGET` stays
DISARMED so every pure test / advisory consumer is a clean no-op. **Sizing model:** the ledger row is a
MODEL position of ONE reference contract; `riskUsd = entry_premium × 100` (a long option's max loss IS the
debit paid). A single lot richer than the 2% cap ($2k → premium > $20/share) is blocked by the per-position
budget dimension — the honest "too expensive for a 2% risk slice."

**How the budget gate blocks (`evaluateSwingCommitBudget`).** It evaluates (book + candidate) and blocks the
candidate ONLY for a hard-exceeded dimension it CONTRIBUTES to: per-position when the candidate is itself the
oversized offender; portfolio/event/overnight when the candidate adds nonzero risk to an aggregate that is
over. Edge cases: unknown/zero risk ⇒ 0 contribution ⇒ never blocks on the budget; a non-event candidate is
never blocked by an event breach it doesn't touch; book at an aggregate cap ⇒ new commits blocked until a
close frees room.

**Roll wired live (`src/lib/swing/roll-plan.ts` → active-refresh cron).** The already-built roll executor
(`roll.ts` `closeAndRollSwingPosition`, transactional via `withSwingRollTx`) is now activated: at a
capital-preservation GATE rung, `buildSwingRollPlan` freezes the parent from the live/latched mark
(`(mark−entry)/entry×100`; never a fabricated grade — no mark ⇒ DEFER) and, for a ROLL (still-valid thesis),
picks a FURTHER-OUT child via `rankSwingContracts` and gates it on the SAME budget + caps + idempotency
rails (child key carries the roll generation `:r{seq}` so it never collides with the parent). A CLOSE
(thesis-broken) grades+closes with no child. Any block ⇒ DEFER (parent stays OPEN, re-evaluated next tick) —
a roll never half-executes or opens risk a gate forbids. The roll is NOT re-gated on graduation (capital
preservation never waits on the ladder — manager design); it continues an already-authorized thesis.

**Discovery cron** now attaches WATCH contracts (`fetchChainRows` → `resolveTickerChainRows`, fail-soft per
name) so `playSet.SWING` is non-empty, and injects the commit seam (graded-history → calibration report,
open book, `insertSwingPosition`, `promoteSwingCandidate`, armed budget). Absent the seam (every unit test /
evidence-only caller) `commitEligibleCount` stays 0 and nothing opens — the exact PR-11 behavior.

**Evidence.** `npx tsc --noEmit` clean; `node --import tsx --experimental-test-module-mocks --test
src/lib/swing/*.test.ts src/lib/db-swing-ledger.test.ts` → 364 pass / 0 fail; `node scripts/check-brand.mjs`
clean. New suites: `commit.test.ts` (17), `roll-plan.test.ts` (11), budget arming (8 added), discovery
commit-seam (4 added), calibration mapper (1). Tests prove: commit fires ONLY on graduated+budget+caps+
idempotency; each over-cap dimension blocks; the real graduated `commitEligibleCount`; roll opens a gated
child; unknown-risk / missing-contract / at-cap edges are safe.

**Unsure-about / conservative defaults chosen (flagged for the lead):**
- *"archetype×sub-lane bucket graduates" → BOTH floors (AND), not either.* The calibration ladder graduates
  per-archetype and per-sub-lane separately (no joint bucket exists; building one would be "inventing a new
  bar"). I require BOTH to have graduated — the stricter reading, using the shipped wrappers unchanged.
- *Roll parent graded from the live mark, not the full multi-truth forward-bar grade.* Honest realized P&L
  at roll time with no heavy forward-bar dependency in the hot cron path; `graded_at IS NULL` freezes it once.
- *The roll child is gated on budget/caps/idempotency but NOT re-gated on graduation* (a roll continues an
  authorized thesis on a capital-preservation rung; the manager's gates never wait on the ladder).
- *Roll needs an option mark, which the active-refresh reads supply.* PR-#1066 (now merged) wires the live
  option mark into the active-refresh reads; the roll's `gradeParentFromMark` uses it (falling back to the
  latched `last_mark`). No mark ⇒ the roll DEFERS (null-honest), never a fabricated grade.

## 2026-07-24 — [SEV-2/SEV-3, swing pre-live] Discovery reduced the 8-archetype × 7-pillar swing engine to a 3-pillar momentum screen; archetype fast-track + corroboration were dead — FIXED

**Context / risk.** The swing lane is pre-live (WATCH-only, `commitEligibleCount` is a literal 0;
nothing sizes risk), so live blast radius is nil — but the sophistication the engine advertises was
silently inert. Three coupled defects. Branch `fix/swing-discovery-archetype-grounding`.

**Fix 1 (SEV-2) — only 3 of 7 pillars grounded → the engine renormalized to momentum+flow, and 2 of
the 3 FAST-TRACK archetypes could never be produced (dead code).**
Root cause: `swing-ingest.ts` `assembleSwingDossierInput` grounded STRUCTURE / REL_STRENGTH / FLOW
and left VOLATILITY / CATALYST / REGIME / DATA_QUALITY null. `swing-pillars.ts:64` renormalizes over
PRESENT pillars, so every name scored on a 3-pillar (momentum+flow) vector — the archetype-specific
weight tables (`swing-archetype.ts`) barely mattered. Worse, the classifier's catalyst/earnings
signal clusters (`catalystInWindow01` / `earningsGapRecent01` / `postEarningsDrift01`, archetype.ts)
were NEVER grounded, so `fitEventDriven` / `fitPostEarningsDrift` always returned null → EVENT_DRIVEN
and POST_EARNINGS_DRIFT could not classify. Those are exactly the two archetypes the persistence
FAST-TRACK (`taxonomy.ts:180-182`, `ARCHETYPE_PERSISTENCE`) was built for — so the fast-track guarded
archetypes that could never be produced. Dead code end-to-end.
- **New `src/lib/swing/swing-catalyst.ts` (PURE, tested):** `deriveCatalystReads` grounds
  `catalystStrength01` (freshest in-window Benzinga catalyst-channel headline, recency-weighted, OR a
  known upcoming earnings inside the holding window as pre-earnings momentum) + the `earningsInWindow`
  binary-gap hazard, `catalystInWindow01` (→ EVENT_DRIVEN), and the post-earnings drift extras
  (`earningsGapRecent01` recency×gap-size, `postEarningsDrift01` direction-aligned continuation) which
  fire ONLY inside a ≤15-day post-print window (→ POST_EARNINGS_DRIFT). `contractQualityFromIvRank`
  grounds VOLATILITY as the INVERSE of UW IV rank (a 0.5–0.75Δ debit swing wants cheap premium).
  `parseEarningsWindows` derives BOTH the next and last print from ONE `/api/earnings/{ticker}` feed
  (no second fetch). Benzinga rides the Polygon key per CLAUDE.md; the readers already fail-open.
- **REGIME** grounded in `regimeFromSpyTrend` from the SPY closes already fetched once per scan (SPY
  trend-stack as risk-on, DIRECTION-ALIGNED — risk-on is a LONG tailwind / SHORT headwind). Coarse v1
  by design; TODO left in-code to upgrade to breadth/VIX/`market_regime`.
- **DATA_QUALITY** deliberately left null (TODO): it is an honesty meta-pillar the dossier already
  tracks via `dataQuality.degraded/missing`; grounding it as a real feed-agreement 0–1 is a follow-up.
  `oversold01`/`reclaim01`/`retraceToSupport01` (MEAN_REVERSION / FAILED_BREAKDOWN reclaim) left as
  TODOs — reliable level/reclaim detection needs intraday/structure the daily-closes read can't give
  honestly; PULLBACK already classifies on the grounded `trendStack01`. Pillars grounded: **6 of 7**.
- IO: `SwingIngestDeps` gains OPTIONAL fail-soft `fetchCatalystNews`/`fetchEarningsRows`/`fetchIvRank`
  (absent → those pillars stay null, unchanged behavior); the cron route + the audit scan wire the
  real Benzinga/UW readers. Each read degrades to null independently — a provider outage drops only
  that pillar for that name, never the candidate.
Evidence: a fresh-catalyst name now classifies EVENT_DRIVEN with 6 present pillars (was the 3-pillar
screen); a recent-earnings name classifies POST_EARNINGS_DRIFT — both previously impossible.

**Fix 2 (SEV-3) — the archetype-aware 1-session fast-track never fired in the live rail.**
Root cause: `discovery.ts` called `fetchWatchEligible(deps.accum, cfg.minPersistenceSessions)` with NO
`archetypeOf` arg, so `accumulation-store.ts:192` applied the conservative ≥2-distinct-session default
to EVERY candidate — the 1-session event fast-track (`ARCHETYPE_PERSISTENCE`) was unreachable from the
live scan. Fix: build a `(ticker,direction)→archetype` resolver from THIS scan's dossiers
(`d.archetype.archetype`) and pass it (plus an explicit fetch limit) so event archetypes get their
intended single-corroborated-session promotion; cross-session archetypes still gate to 2 sessions.

**Fix 3 (SEV-3) — corroboration counted CADENCE PHASE, not signal KIND (weakened the anti-lone-print
invariant).** Root cause: `hasCorroboration` counted `new Set(phases_seen).size`, but every writer
stamps `phases_seen` with the CADENCE phase/channel (`deps.phase` = POST_CLOSE…; event-trigger's
`SWING_LIVE_FLOW_PHASE` = LIVE_FLOW), NOT the screen provenance. So ONE kind of evidence re-seen
across cadence windows (FLOW at POST_CLOSE, FLOW again at MIDDAY) read as "2 independent signals" and
could corroborate a lone print. Fix: a NEW `signal_kinds` column (JSONB, `ADD COLUMN IF NOT EXISTS`;
deduped-unioned exactly like `phases_seen`) carries the real SCREEN provenance — the discovery writer
accretes `seed.paths` (FLOW/STRUCTURE) + `CATALYST` when the dossier grounded that pillar
(`signalKindsForObservation`), and the live-flow writer stamps `FLOW`. `hasCorroboration` now counts
`signal_kinds`; `phases_seen` stays as pure cadence provenance. Two FLOW sightings across cadence
windows = one kind = NOT corroborated; a FLOW print + a grounded CATALYST = two kinds = corroborated.

**The three fixes interlock:** an EVENT_DRIVEN name surfaced by the FLOW screen with a grounded
CATALYST now carries `signal_kinds={FLOW,CATALYST}` (Fix 1+3) → corroborated → the resolver (Fix 2)
applies the event archetype's 1-session rule → it reaches WATCH in a SINGLE scan, as designed.

**Evidence / tests.** `tsc --noEmit` clean; `check-brand.mjs` clean; full swing suite
`node --import tsx --test src/lib/swing/*.test.ts` → 301 pass, `db-swing-ledger.test.ts` → 22 pass.
New/updated coverage: `swing-catalyst.test.ts` (all mappings incl. direction-aligned drift, IV-rank
inverse, honest-null); `swing-ingest.test.ts` (regime alignment, pillar grounding, EVENT_DRIVEN now
producible, fail-soft providers); `dossier.test.ts` (POST_EARNINGS_DRIFT now producible);
`accumulation-store.test.ts` (corroboration counts KINDS not phases — the exact regression);
`discovery.test.ts` (end-to-end 1-session fast-track for an EVENT_DRIVEN name + no false fast-track
for a cross-session name); `db-swing-ledger.test.ts` (`signal_kinds` DDL + deduped-union SQL guard).

**Status:** DONE (branch `fix/swing-discovery-archetype-grounding`). Swing is pre-live — deploy AFTER
close; NO auto-merge (non-draft PR to `main`, held for review per the task).
## 2026-07-24 — [SEV-3 ×4, pre-live] SWING serving + feature-vector wiring dead-ends — FIXED

Four WIRING dead-ends (not the deliberate commit/roll holds) left the swing engine dark even as a
research scaffold. All swing-surface / pre-live, so low live risk; member-facing serving is involved
(deploy after close). Branch `fix/swing-serving-featurevector-wiring`.

**1 — the member SWING board rendered permanently empty.** `market/nighthawk/horizons/route.ts:48`
called `getSwingServingLane()` with NO `discover` source, so `serving-lane.ts:73` returned
`emptySwingServingLane()` unconditionally; AND `cron/swing-discovery/route.ts` advanced only the
accumulation memory — it never persisted the scored dossiers/plays/watch, so there was nothing to
read even if a source were injected. **Fix:** the discovery cron now `persistSwingServingSnapshot(...)`s
its scored output to a shared-cache blob (best-effort; never fails the cron), and the route injects
`discoverSwingFromPersisted` — a pure cache read (no provider IO on the member request path) GATED so
only persistence-cleared names (in the persisted `watch` list) can surface. Member-safe empty fallback
untouched. NOTE: `playSet.SWING` is only non-empty once discovery attaches concrete WATCH contracts
(the OPTIONAL `fetchChainRows` dep — the deliberate "WATCH by persistence, not by contract" evidence-only
posture), so the live board is honestly empty until that lands; the persist+read path is now complete
and lights up with zero further route change.

**2 — the feature-vector WRITE side was dead → every snapshot's `feature_vector` was null.**
`buildSwingFeatureVector` (`feature-vector.ts`) had ZERO callers; `planManageSync` built the snapshot
insert with no `feature_vector`, so `feature-store.ts` trajectory studies (`studyFlowDecay` reads
`feature_vector.pil_flow`, `studyIvKillsGoodSetups` reads `evidence_score`, …) were permanently empty.
**Fix:** `planManageSync` now builds and stamps the vector on every snapshot from the position's pinned
commit vector (echoed static thesis part — pillars/evidence/iv_rank so the studies have data) + the
authoritative ledger columns + the tick's dynamic reads/verdict. iv_rank prefers a fresh resolved read
(the new `ManageSyncReads.ivRank` seam), else the commit-pinned value. Null-safe throughout.

**3 — active-refresh wrote RAW SPOT into `running_mfe`/`running_mae`.** `swing-active-refresh/route.ts`
passed `underlyingMfe: spot`, and `manage-sync.ts` copied that straight into the snapshot, so
`studyTwoStagnantSessions` (compares running_mfe across sessions) and `studyIvKillsGoodSetups`
(compares running_mae to a −3% threshold) saw prices, not excursion — a raw price ≥ −3 always, so the
"underlying held" branch could never be false. **Fix:** new pure `signedExcursionPct` converts the
ledger's ratcheted PRICE extremes + entry + this tick's spot into direction-aware SIGNED excursion %
(MFE ≥ 0, MAE ≤ 0), and `planManageSync` writes THAT to the snapshot (+ the feature vector). The
ledger's `underlying_mfe`/`underlying_mae` PRICE columns keep their GREATEST/LEAST ratchet (separate,
unchanged).

**4 — option marks were never fed to active-refresh.** `loadReads` returned underlying only, so every
premium rung (profit-ladder / −60% backstop) and the premium ratchet skipped via null-honesty even for
a live position. **Fix:** a best-effort `loadOptionMark(row)` (reuses the 0DTE unified-snapshot marks
path; normalizes the ledger OCC to the `O:`-prefixed form the endpoint needs) now runs in parallel with
the spot fetch and threads the contract mark into `reads.mark`.

**Evidence / tests.** `tsc --noEmit` clean; `check-brand.mjs` clean; `swing/*.test.ts` + `horizon*.test.ts`
= 343/343 pass. New tests: serving-lane persist→read round-trip + persistence-gate filtering + end-to-end
board render; snapshot carries a populated feature_vector (dynamic + echoed pinned static) + null-safety +
fresh-ivRank-wins; running_mfe/mae are signed % (LONG/SHORT/ratcheted-extremes/honest-null); an option mark
from loadReads lands on the snapshot + feature vector. Calibration/graduation logic untouched — pure wiring.

**Status:** DONE (PR open, deploy-after-close, no auto-merge).
## 2026-07-24 — [feat + SAFE] 0DTE trade management: trim-scale exit A/B (default-OFF) + exit-engine visibility + condor breach guard

Branch `feat/zerodte-exit-engine-visibility`. Three changes, deploy after close, NO auto-merge —
one STRATEGY change (operator sign-off) + two SAFE.

**1. [STRATEGY, default-OFF] trim-scale exit as the ratchet replacement (`exit-engine.ts`).**
- **Root cause:** `EXIT_RULES.ratchet_arm_pnl_pct = 25` (`exit-engine.ts:48`) arms a breakeven floor
  the moment a 0DTE momentum leg reaches +25% — a *continuation* signal — so it scratches at
  breakeven the exact plays that go on to +100% (green≠profitable). E5 (FINDINGS 2026-07-23) measured
  it: HOLD beats the shipped ratchet full-sample, and a **trim ⅓@+25% + ⅓@+50%, run the last ⅓**
  scale-out beats BOTH in every split (calib+valid) and both universes, lifting WR 32%→50%
  (`+0.6%/−4.4%/−0.7%` vs HOLD `−0.8%/−12.1%/−3.7%` vs shipped `−4.4%/−10.1%/−5.8%`).
- **Fix:** new `exitMode` A/B on the pure engine — `"ratchet"` (`DEFAULT_EXIT_MODE`, unchanged live
  behavior) vs `"trim_scale"` (`decideTrimScale` + `TRIM_SCALE_RULES` + `trimTranchesArmed`). The
  trim schedule is **regime-conditioned** (`neutral`=E5 base +25/+50; `trend`=+40/+80 lets it run;
  `range`=+20/+40 banks sooner) and reuses scale-out.ts's partial-SCALE mechanism — but deliberately
  NO trailing stop (P3 proved trailing hurts 0DTE; the last third runs to the plan rails). Thesis
  break / flat timeout / plan stop+target are shared by both modes. **DEFAULT-OFF:** graduates on the
  live-ledger grader, not this offline flip — the operator flips it via `ZERODTE_EXIT_MODE=trim_scale`
  (IO shell `exit-sync.ts:resolveExitMode`; the pure leaf never reads an env). Live wiring derives the
  trim latch from the monotonic peak (no DB column yet — the tranche-persistence graduation is the
  follow-up); the two intermediate ⅓ TRIMs stay advisory until then, matching today's EXIT-only sync.
- **Evidence:** `sim:0dte` extended to grade BOTH modes head-to-head on live bars through the REAL
  engine (`gradeTrimScaleExit`, `ZERODTE_SIM_REGIME`). Synthetic validation of the accounting: a play
  peaking +50% then reversing to the stop returns **+8.3%** under trim_scale (banked ⅓@+25 + ⅓@+50,
  last third stops) vs **−50%** hold vs **~breakeven** ratchet-scratch — the positive-skew edge, live.

**2. [SAFE] exit-engine decision surfaced on the board payload (`zerodte-service.ts`).** The rich exit
decision (`floorPnlPct` / reason / `detail`) was computed but never left the engine — `closed_reason`
couldn't even tell a ratchet exit from a target trim (both null). Added `floor_pnl_pct` (the live
ratchet floor — the "your stop is now at breakeven/+20/+50" guidance, pure from the latched peak),
`exit_reason` (coarse category from the pinned `entry_context.exit`), `exit_detail` (the engine's
sentence), and WIDENED `closed_reason` to distinguish stopped/ratchet/thesis/flat/target/time_stop.
Additive, no computation change; the pinned-stop P&L pin is preserved. Rendered as a floor chip +
exit-reason chip (detail = tooltip) on the play card (`ZeroDteBoard.tsx`).

**3. [SAFE] condor breach-pct guard (`iron-condor.ts:195`).** `SHIPPED_INTRADAY_BREACH_PCT=18.7` was
stamped on EVERY condor regardless of width — it was measured for the shipped target-80 geometry ONLY.
Now `est_intraday_breach_pct` (type `number | null`) nulls off when `targetWinRate`/`shortWidthPct`
deviates from the shipped default, so a consumer can't pair a non-default win rate with a mismatched
breach number. Walls don't count as a deviation (same selection, pushed out).

- **Verify:** `tsc` clean; `zerodte/*.test.ts` 497/497 + platform 19/19 (adds trim_scale mode/regime
  tables, board visibility fields, condor null-off); brand guard clean. **Status: PR OPEN (non-draft,
  deploy after close, operator sign-off on the STRATEGY flip; no auto-merge).**
## 2026-07-24 — [HIGH, infra] production deploy pipeline never rolled the market-worker → task-def ROT — FIXED (draft PR, HOLD)

**Severity HIGH (silent worker outage).** `.github/workflows/ecr-push-production.yml` built+pushed the
image then rolled ONLY the `blackout-production-web` ECS service. It NEVER touched the separate
`blackout-production-market-worker` service, so that service's task def was updated only by hand and
ROTTED between manual touches.

**Root cause.** Two independent rot vectors, both because the worker was outside the deploy loop:
(1) its task def pinned an old ECR image tag that the ECR **lifecycle policy eventually PRUNES** →
`CannotPullContainerError: ... not found`; (2) its `secrets[]` kept referencing keys later removed from
Secrets Manager (e.g. `NEXT_PUBLIC_WHOP_CHECKOUT_LIFETIME`) → `ResourceInitializationError: ... did not
contain json key ...`. Today the worker was DOWN (runningCount 0/1) from BOTH at once.

**Evidence.** Live 2026-07-24: the worker service at runningCount 0/1 with the two errors above in its
stopped-task reasons. Manually restored by registering task-def revision `:10` (current SHA image +
the stale `NEXT_PUBLIC_WHOP_CHECKOUT_LIFETIME` secret ref stripped). The web roll step already solves
BOTH rot classes generically (rewrites `image` to the SHA-pinned build; strips any `secrets[]` entry
whose `name` is absent from the Secrets Manager JSON) — the worker simply never ran that logic.

**Fix.** Added ONE new, isolated step "Roll ECS production market-worker" that mirrors the web roll's
generic fix for the worker service: fetch the live worker task def, repin `image` to
`${REGISTRY}/${REPO}:${{ github.sha }}`, re-derive valid secret keys from the WORKER's own secret ARN
and strip stale refs, register + `update-service --force-new-deployment`, then poll the PRIMARY
deployment to `COMPLETED` with a 12-min timeout. Singleton-appropriate deploy config
(`minimumHealthyPercent=0,maximumPercent=200` — minHealthy>0 deadlocks a 1-task service; circuit
breaker + rollback kept). No `--desired-count` (worker desiredCount=1 lives on the service). Placed
LAST — after web has fully rolled+purged+validated — so it is purely additive and a worker failure is
visible (job red) but never rolls back or delays web.

**Blast radius.** Every prior production deploy left the worker stale — it only survived on whatever
manual revision someone last registered, guaranteeing eventual rot once the pinned image aged past the
ECR lifecycle window or a secret key churned. Only the web service was ever kept current. The web roll
step is deliberately left **byte-for-byte unchanged** (critical path); the change is one additive step.

**Verify.** `yaml.safe_load` parses (8 steps); all 6 embedded python snippets `py_compile`-clean;
de-indent simulation confirms the heredoc terminator lands at col0 in the executed shell script; `git
diff` is purely additive (149 insertions, 0 deletions — web step untouched).

**Status:** FIXED on branch `fix/market-worker-deploy-pipeline`. **DRAFT PR, HOLD** — deploy-pipeline
infra; operator reviews before merge (do NOT auto-merge).

## 2026-07-24 — [SEV-3 + SEV-4] 0DTE command-deck live-marks: missing REST fallback + no sync-mark age flag — FIXED

**SEV-3 — command-deck live-marks hook was SSE-only despite the documented REST fallback.**
`src/features/nighthawk/command-deck/use-live-marks.ts` subscribed to the ~1s SSE lane and, on a
terminal `EventSource.CLOSED`, cleared its marks and relied entirely on the 5s board poll. But both
route headers promise a client fallback — `marks/stream/route.ts:8` and `marks/route.ts:3` state
*"Client fallback: GET /api/market/zerodte/marks polled at 2–3s."* So whenever the SSE lane dropped
(proxy kills the stream, a `503` from the stream cap, a network blip past the reconnect window),
per-contract mark/P&L/greeks refreshed at 5s — or greeks vanished entirely (the board payload's
`greeks` is null; only the live lane carries Δ Γ Θ V IV) — instead of the promised ~2.5s. The
documented contract existed and the REST route was built; only the client wiring was missing. The
sibling hook `src/features/nighthawk/hooks/useZeroDteLiveMarks.ts` already implements this fallback,
so the command-deck hook was the odd one out (blast radius: one hook; the sibling is correct).

**Fix.** Added a `setInterval` REST poll (2.5s) that activates ONLY while `EventSource.readyState
!== OPEN` (`restFallbackShouldPoll`) — the CONNECTING reconnect window and the terminal CLOSED state
the browser won't auto-retry — and feeds the SAME OCC-keyed overlay map via a shared
`marksMapFromPayload` builder used by BOTH the SSE frame and the poll. A healthy OPEN stream
short-circuits every tick, so the two never double-fetch; when SSE reopens, the poll stands down on
its own. The `>5s` stale-row drop is untouched — polled rows carry the same server-computed `stale`
flag and route through `overlayLiveMarks` identically. In-flight/unmount guards (`pollInflight`,
`closed`) prevent overlap and post-unmount `setState`. **The fallback gates cleanly on SSE state:
yes** — `EventSource.readyState` is the exact signal ("not OPEN → poll"), no timers/heuristics.

**SEV-4 — no per-mark age indicator when the board is the sole mark source.**
`src/lib/platform/zerodte-service.ts` `mapLedgerRow` (~L132/160): when the live lane has no fresh
quote for a contract, the board falls back to `r.last_mark` with `mark_as_of: null` and
`mark_source: null` — an unknown-age "sync" mark the deck rendered indistinguishably from a 1s-fresh
live one. **Fix:** added a derived boolean `mark_is_sync` to `ZeroDteBoardLedgerRow`
(`mark_is_sync = liveMark == null && lastMark != null`) so the deck can badge a non-live mark as
unknown-age. Additive/minimal — no payload restructure, no P&L/greek computation touched. The board
payload is `Record<string,unknown>` to the deck (`zerodte-sources.ts`), so the flag is readable
without a client type change; wiring the actual UI badge is a follow-up.

**Evidence / tests.** `tsc --noEmit` clean; `check-brand.mjs` clean. Extended
`command-deck/use-live-marks.test.ts` (pure pieces: `restFallbackShouldPoll` polls only when not
OPEN; SSE & REST payloads build the identical map; empty/idle → no-op; a polled STALE row still hits
the >5s drop) and `platform/zerodte-service-marks.test.ts` (`mark_is_sync` true on the stale-refused
sync row + the CLOSED sync row, false on the fresh live row). 98/98 across command-deck + platform +
live-marks suites pass.

**Status:** DONE. Branch `fix/zerodte-marks-rest-fallback`.

## 2026-07-24 — [HIGH, correctness] 0DTE aggression signal DEAD — `ask_pct` read a field UW never sends — FIXED

**Severity HIGH (the engine's core "at-the-ask conviction" edge was silently inert in production).**
The 0DTE board weights each print's directional premium by aggressor side via `aggressionWeight`
(`src/lib/zerodte/board.ts` ~L232, a 0-100 `ask_pct` → conviction-weight map: ≥60→1, ≥45→0.6,
else→0.15, null→neutral 0.5).

**Root cause — both `ask_pct` extractors read `ask_side_pct`, a field UW does NOT send.** The SSE
path (`flow-raw-fields.ts:37` `numFromRaw(raw,"ask_side_pct")`) and the REST/DB read path
(`db.ts:2211` `(raw_payload->>'ask_side_pct')::numeric AS ask_pct`) both keyed off `ask_side_pct`.
Live UW `flow_alerts` tape: **`ask_side_pct` 0/2782 rows, `total_ask_side_prem`/`total_bid_side_prem`
2782/2782 (100%)**. So `ask_pct` was **null on every print** → `aggressionWeight` fell back to the
neutral **0.5 for every ticker**. Consequences: (a) the `SETUP_MIN_AGGR_SHARE=0.3` gate was a **silent
no-op** (every candidate's aggression == 0.50 ≥ 0.3), and (b) direction was decided by the raw
call/put premium split, NOT aggressor-confirmed flow.

**Why it wasn't caught:** the field name was plausible and `numFromRaw`/the SQL cast returned null
silently (no error); `flow-raw-fields.test.ts` only fed a synthetic row that HAD `ask_side_pct`, so it
never exercised the real-tape shape. `scorer.ts:366-367` (Night Hawk) already derives aggression from
`total_ask_side_prem` — the 0DTE path just never adopted that.

**Fix — derive `ask_pct` from the premium legs UW actually sends, mirroring scorer.ts.** New pure
helper `askPctFromTwoSidedPremium(ask,bid)` in `flow-raw-fields.ts`: prefer a real `ask_side_pct`,
else `ask/(ask+bid) * 100`. Both paths now COALESCE(real, derived): the SSE extractor calls the
helper; the SQL mirrors it (`COALESCE(ask_side_pct-cast, (ask/NULLIF(ask+bid,0))*100)`). **Scale is
0-100** (the established `ask_pct` scale — `flow-raw-fields.test.ts` asserts `"72"→72`, board.test.ts
`90→weight 1`, helix `askPct>=60`); the `0.70` *ratio* for ask=700k/bid=300k is stored as **70**.
Storing the raw 0.70 would be worse-than-dead: all fractions <45 collapse to a flat 0.15 AND invert
conviction. Divide-by-zero → null (NOT 0 — a 0 reads as 100% sold). `aggressionWeight`, gate
thresholds, `SETUP_MIN_AGGR_SHARE` deliberately unchanged — only `ask_pct` now populates.

**Evidence — live `deriveZeroDteSetups` before/after (same tape, ~2780 rows):**
```
                 aggression range   distinct  knownAggrFrac(avg)  SETUP_MIN_AGGR_SHARE gate
  BEFORE (main):  [0.500, 0.500]        1           0.00          no-op (all pass at 0.50)
  AFTER  (fix):   [0.150, 0.910]       22           0.99          discriminates
```
After the fix the gate correctly REJECTS bid-heavy/sold flow that the bug waved through: SNDK 0.297,
MSFT 0.256, DHR/SE 0.150, ASML 0.232 now fail `>=0.3` (SNDK was a live "long" survivor off majority-
SOLD premium — the exact fake-out the gate exists to stop); survivors 11→7. Direction is now
aggressor-confirmed.

**Verify:** `tsc --noEmit` clean; `flow-raw-fields.test.ts` + `board.test.ts` + `db.test.ts` =
104/104 pass (new: derivation, 0-100 scale, primary-wins, zero/absent→undefined, reactivated
`aggressionWeight`, and a `db.ts` source-assertion pinning the SQL — raw PG blocked in CI);
`check-brand.mjs` clean. Files: `src/lib/flow-raw-fields.ts`, `src/lib/db.ts`,
`src/lib/flow-raw-fields.test.ts`, `src/lib/db.test.ts`. Status: FIXED, branch
`fix/zerodte-aggression-askpct-plumbing` (PR to main; deploys AFTER close — changes direction
determination — so NOT auto-merged). Unblocks #1028 (its `SETUP_MIN_KNOWN_AGGR_FRAC` floor is a no-op
until `ask_pct` actually populates).

## 2026-07-24 — [HIGH, safety-inert] 0DTE realized-loss session halt was WIRED but INERT — FIXED

**Severity HIGH (a shipped capital-protection halt could never fire).** PR #1056 added the AUDIT
SEV-3 realized-loss day-halt to `governor.ts`: `governorLossHaltReason` stands the desk down when
`realized_losers >= 3` OR `session_pnl_pct <= −120`, and `deriveGovernorFromLedger` correctly
COMPUTES both tallies.

**Root cause — dropped fields in the ENFORCEMENT snapshot.** `scan.ts`'s `attachGateVerdicts`
(~L337-341) built the snapshot handed to the gate stack as a hand-written object literal that copied
ONLY `open_plans` + `stops` and DROPPED `realized_losers` + `session_pnl_pct`:
```ts
const governor: GovernorSnapshot = {
  open_plans: ledgerGovernor.open_plans,
  stops: mergeGovernorStops(ledgerGovernor.stops, recordedStops),
}; // realized_losers + session_pnl_pct dropped
```
Those two fields are OPTIONAL on `GovernorSnapshot` (back-compat for pre-SEV-3 literals), so
`governorLossHaltReason` read `snap.realized_losers ?? 0` / `snap.session_pnl_pct ?? 0` → always 0 →
**the loss-halt could NEVER fire in the live commit path.** Meanwhile the member board strip showed
"halted" because `summarizeGovernorForBoard` derives its OWN snapshot correctly — board said halted,
scanner kept committing. A chop-and-bleed day of losing time-stops (each ~−25…−45%, none tripping the
−50% hard stop) was uncapped exactly as before SEV-3 shipped — the same class of day (7/13) the halt
was built for.

**Why it wasn't caught:** governor.test.ts passes a snapshot in DIRECTLY (never exercises scan.ts's
construction), so the wiring seam was untested.

**Fix (`scan.ts:337-346`, one line of substance):** build the enforcement snapshot FROM the derived
one via spread so all four fields reach the gate stack, still overriding `stops` with the
Redis-timestamp-merged set:
```ts
const governor: GovernorSnapshot = { ...ledgerGovernor, stops: mergeGovernorStops(ledgerGovernor.stops, recordedStops) };
```
Left the two fields OPTIONAL (making them required cascades into ~17 test/literal call sites across
governor.test.ts / gates.test.ts / gates-replay — over the safe-scope threshold; noted, not done).
Strictly-more-conservative: this only lets an existing fail-safe halt fire; no thresholds changed.

**Evidence/verify:** new integration test in `scan.test.ts` drives the REAL `scanZeroDteBoard` with a
ledger of 3 losing time-stops (realized_losers 3, stops 0/3, session −90% — isolating the count
channel) + a fresh NVDA flow candidate, and asserts the fresh setup's gate carries the
`governor_session_stops` loss-halt block and verdict BLOCKED. Proven to FAIL on the old two-field
literal (`not ok 10`) and PASS on the fix. `tsc --noEmit` clean; all 480 `src/lib/zerodte/*.test.ts`
pass; `check-brand.mjs` clean. Files: `src/lib/zerodte/scan.ts`, `src/lib/zerodte/scan.test.ts`.
Status: FIXED, branch `fix/zerodte-loss-halt-wire` (PR to main).

## 2026-07-24 — [MED+LOW×2] 0DTE live-marks lane: stale-mark engine exit + store leak + dead SSE dedupe — FIXED

Three defects in the ~1s live-marks lane (branch `fix/live-marks-robustness`), one PR.

**FIX 1 [MED, correctness] — the exit ENGINE could fire on a stale mark.**
Root cause: `live-marks.ts` derived ONE `mark` at up to `LATCH_MAX_MARK_AGE_MS` (30s) old and passed it
as `syncMark` into `evaluateLedgerRowExit`. `exit-sync.ts:132` uses the lane mark only if fresh (≤5s,
`ZERODTE_MARK_STALE_MS`) else falls back to that ≤30s `syncMark` — so a mark-DRIVEN engine exit
(ratchet-floor / thesis / flat-timeout) could trigger at a price 5–30s old. On 0DTE premium (10–30%/min)
that's an exit at a price nobody currently sees. Evidence: `exit-sync.ts` freshest-mark-wins block +
`live-marks.ts:385/397` passing the 30s mark as `syncMark`.
Fix (`live-marks.ts`, tick loop): split into two marks. `mark` keeps the 30s bar and feeds ONLY
`advancePlayLatch` (peak/trough + the plan hard-stop — the trough only widens, so an aged mark can only
deepen a latched stop, and `derivePlayStatus` fires CLOSED off the latch regardless of freshness). New
`engineMark` uses the 5s bar and is the `syncMark` passed to the engine; when the freshest mark is >5s,
`engineMark` is null → the engine HOLDs by its own missing-mark contract. The latch-driven stop is
deliberately left on the 30s bar so capital protection never depends on live-mark freshness. Contract
note added to `exit-sync.ts` (callers must pass a CURRENT `syncMark` or null — a bare number's age can't
be re-checked there). `scan.ts` unaffected (it passes a just-fetched snapshot mark).

**FIX 2 [LOW, memory] — `markStore` was append-only.** Closed/rolled OCCs lingered for the process
lifetime (per-replica leak over a day of turnover). Fix: new `pruneMarkStore(activeOccs)` evicts marks
for OCCs absent from the active set (never an active OCC), called in the tick's active-set/reconcile path
right after the active `occs` are derived.

**FIX 3 [LOW, bandwidth] — SSE per-tick dedupe was dead code.** `route.ts` compared the full JSON string,
but every build stamps `as_of` + per-row `mark_age_ms` from `now`, so consecutive frames always differ →
`if (json === lastSentFrame) return;` never fired. Fix: new `zeroDteMarksContentKey(payload)` hashes the
payload EXCLUDING the two time-only fields (`as_of`, `mark_age_ms`); `getZeroDteLiveMarksFrame()` returns
`{ json, contentKey }` and the SSE route dedupes on `contentKey`. `mark_as_of` and `stale` are kept (a new
quote / a mark crossing the 5s bar are real content changes that must push). `mark_age_ms` retained on the
row (multiple consumers derive age from it) — only excluded from the dedupe key. `getZeroDteLiveMarksJson`
kept for the REST fallback route.

**Evidence/verify:** `tsc --noEmit` clean; `live-marks.test.ts` 22/22 (adds: engine HOLDs on a >5s-stale
mark while the latched trough stop still CLOSES on a stale mark; store prunes a dead OCC but keeps the
active one; two identical-market ticks share a content key while raw JSON differs); `exit-sync.test.ts`
7/7; `zerodte-service-marks.test.ts` 1/1; `check-brand.mjs` clean. Files: `src/lib/zerodte/live-marks.ts`,
`src/lib/zerodte/exit-sync.ts`, `src/app/api/market/zerodte/marks/stream/route.ts`. Status: FIXED, on
branch (not merged — no PR opened per request).
## 2026-07-24 — [LOW×3, honesty] null-honesty cleanups: a null is honest, a fabricated zero is a lie — FIXED

**Severity LOW ×3 (non-member-critical, but the platform's honesty discipline).** Three sites
manufactured a numeric value where the honest answer was "no value":

1. **`src/features/nighthawk/lib/analytics.ts` (~211-240).** `winRate`/`profitableRate` returned `0`
   for a zero-row sample and `groupWithReturn` emitted `win_rate: 0` for an empty cut — a fabricated
   **0% win rate** that reads as "every play lost," inconsistent with `calibration.ts`
   (`win_rate_pct: rows.length>0 ? … : null`). **Fix:** both functions now return `number | null`
   (`null` on empty / no-priced-rows); `NighthawkRecordCut.win_rate` + `by_score_bucket.win_rate`
   widened to `number | null`; `emptyMetrics` empty cuts carry `win_rate: null`. Consumers made
   null-safe: `AdminNightHawkDashboard` (`pctCut` → "—", `winRateStyle` accepts null) and the
   member record route (`by_conviction.win_rate_pct` null-guarded, mirroring the existing
   `segmentWire` convention). Headline `profitable_rate` stays `number` (`?? 0`) — it's reached only
   when rows exist and has no `low_n` badge to carry a null.
2. **`src/lib/nighthawk/cortex/fetch.ts` (~270).** `premium: finiteOrNull(r.premium) ?? 0` coerced an
   unpriced print to `$0`. **Fix:** carry `null` (`CortexFlowPrint.premium: number | null`); the
   aggregation site `findFlowCluster` (`flow-quality.ts`) now excludes null explicitly so an unpriced
   print neither joins the premium sum nor inflates the print count (the `p.premium <= 0` guard
   already dropped a coerced $0, but a null is the honest carrier).
3. **`src/lib/zerodte/banger-scale-out-grade.ts` (~50).** `hold_mult = last.c / entry` measured
   hold-to-last-bar; the defined baseline is hold-to-EXPIRY (which decays toward ~0 for an OTM
   weekly). A series truncated before expiry (thin option / short Polygon page) read an artificially
   HIGH hold_mult. **Fix:** `gradeBangerScaleOut` takes `expiryYmd`; if the last forward bar's ET
   date < expiry, the row is `ungradeable` (`reason: "forward_bars_truncated"`) rather than crediting
   a non-expiry close as held-to-expiry. Realized-multiple logic unchanged; caller (`play-outcomes.ts`)
   passes `resolution.request.expiryYmd`.

**Verified:** `tsc --noEmit` clean; touched tests pass — `analytics.test.ts` 24/24,
`banger-scale-out-grade.test.ts` 30/30, `fetch.test.ts` + `flow-quality.test.ts` 28/28 (adds:
null-on-empty for winRate/profitableRate/groupWithReturn; null-premium excluded from cluster sum+count;
mapFlowSlice carries null; expiry-truncation → ungradeable), `analytics-methodology`/`analytics-pulled`
8/8, intel route 9/9; `check-brand.mjs` clean. Branch `fix/null-honesty-cleanups`.

## 2026-07-24 — [HIGH, honesty] iron-condor surfaced a literal "100%" WR with no breach companion — FIXED

**Severity HIGH (member-facing honesty on a real-money product).** `selectIronCondor` returned
`est_win_rate` straight off `CONDOR_WINRATE_BY_WIDTH`, whose top buckets read `0.010→96` and
`0.015→100`. So a member could be shown a **literal 100% (or 96%/92%) win rate** on a 0DTE iron
condor. Two defects: (1) a 25-session / ~75 ticker-session backtest cannot support a literal 100%;
(2) the struct exposed ONLY close-settlement WR with **no intraday-breach companion**, while the
repo's own condor-wr evidence records the shipped target-80 geometry at **98.7% WR / 18.7% intraday
BREACH** — a negative-skew product that trades against you ~1 session in 5, presented as near-certain.

**Root cause.** `iron-condor.ts:150` — `est_win_rate: estWinRateForWidth(tighter)` surfaced the raw
table value verbatim, and `IronCondorLegs` had no breach/skew field, so the negative-skew tail lived
only in a header comment (not machine-readable next to the number).

**Evidence.** `docs/audit/0DTE-RESEARCH.md` (E-condor): shipped `selectIronCondor(target=80)` → 98.7%
close WR **/ 18.7% intraday-breach**; `CONDOR_WINRATE_BY_WIDTH` table `±1.50%→100` (n≈75).

**Fix (`iron-condor.ts`).** (a) `SURFACED_WIN_RATE_CAP = 97` + `surfacedWinRate()` clamp the DISPLAYED
`est_win_rate` (raw table kept intact — it's the calibration basis `condor-wr.mjs` grades against, so
capping there would corrupt the comparison; only the surfaced number is clamped). (b) new
`est_win_rate_small_sample` flags any width whose raw WR exceeds the cap. (c) new `est_intraday_breach_pct`
(= documented `SHIPPED_INTRADAY_BREACH_PCT = 18.7`, labeled AGGREGATE not per-width — the backtest
published no per-width breach numbers, so no per-width value was invented) + `skew: "negative"` carry
the breach tail machine-readably next to the WR. Geometry/strike math unchanged. Sole `IronCondorLegs`
consumer (`board.ts`, pass-through) needs no change; new required fields are always set by
`selectIronCondor`. **Verified:** `tsc --noEmit` clean; `iron-condor.test.ts` 16/16 pass (adds:
est_win_rate ≤ cap across the width sweep, never 100; top-bucket clamps + flags small-sample; breach +
skew present/finite on a normal pick); `check-brand.mjs` clean.

## 2026-07-23 — [HIGH, self-inflicted] `--watch` gave FALSE "all clean" after ~10min (silent auth decay) — FIXED

**Severity HIGH** because it's the failure the whole audit layer exists to prevent: a validator that
reports green while validating nothing. Caught by the 12:22 ET act-on-findings pass reading the live
watch log — passes #9-15 showed `{"INFO":3,"PASS":1} ✓ all clean`, down from `{"PASS":32}` at launch.

**Root cause.** The shipped `--watch` loop (PR #980) authenticated ONCE and only ever called `mint()`
(a token refresh off the existing Clerk session) each pass. A Clerk session ages out after ~10 min;
once it did, `mint()` returned null, every `app()` call shipped `Cookie: __session=null` → 401 → all
~29 app-derived checks skipped to INFO ("payload unavailable"), leaving ~1 non-authed check (the
Polygon/UW ground-truth ones) to carry a green summary. Two independent defects made it invisible:
(1) no recovery path — `mint()` can't revive a dead session, only a full re-sign-in can; (2) the
per-pass summary counted only PASS/FAIL/WARN, so a collapse from 32→1 PASS with everything else
skipped (INFO) still printed "✓ all clean."

**Evidence.** `validation-watch.out` pass#11-15: `[INFO] 0DTE board: no response … (fetch/auth
failure)` on every app surface, `PASS:1`, yet `✓ all clean`. Reproduced the decay window; the ground-
truth-only checks are exactly the 1 that survived.

**Fix (`data-validator.mjs`).** (a) Session state is now re-establishable: `sid`/`clientUat` are `let`,
and `establishSession()` does a fresh `sign_in_token → ticket → session`. `app()` escalates re-mint →
full re-establish via `ensureAuth()`, with a per-pass `authDead` flag so a genuinely-down Clerk can't
trigger a re-sign-in storm (FAPI rate-limit guard). (b) Auth is re-asserted EVERY pass — a dead session
now records a `FAIL`, not silence. (c) Coverage-collapse backstop: a pass whose PASS count craters below
60% of the pass-1 baseline prints `⚠ COVERAGE DROP … NOT actually all-clean`, never "✓ all clean".
**Verified:** 6 consecutive passes hold `PASS:32`; one-shot mode + temp-user cleanup (DELETE 200/404)
unchanged. Lesson: a "clean" signal must be able to distinguish *checked-and-passed* from *never-checked*.

## 2026-07-23 — [TOOLING] data-validator `--watch` = per-minute continuous validation (one auth)

**What:** added a `WATCH_SECONDS` loop to `scripts/audit/data-validator.mjs` so the full authed check
battery (prices/indices, GEX/greeks, 0DTE live+ledger contract/underlying/entry-premium, track-record
math, malformed-float scan) runs **every minute** on a single Clerk session instead of one-shot.
**Root cause it solves:** the prior cadence was every ~12 min (`validation-loop.sh`) because a fresh
`node` invocation re-signs-in, and rapid Clerk sign-in cycles get FAPI-rate-limited. Key realization:
`mint()` REFRESHES the token from the *existing* session (not a new sign-in) → no rate limit → safe to
loop at 60s. **How:** authenticate once (unchanged), then `for (iter…)` re-runs the battery; each pass
clears `checks`, calls `mint()`, and appends a one-line `TOTALS + any FAIL/WARN` to `WATCH_LOG`/
`WATCH_STATUS`. `WATCH_END_UTC` bounds the run; `WATCH` unset → **exact original one-shot behavior**
(verified: `TOTALS {"PASS":33,"INFO":3}` + cleanup 200/404 unchanged). Added SIGINT/SIGTERM cleanup so
a killed watch still deletes the temp Clerk user (the unbounded loop bypasses `main().finally()`).
**Evidence:** live multi-pass on one auth, no auth failure, entry_premium now PASSES live (3.74 ∈
[0.99, 3.95]). Retired `validation-loop.sh` (superseded). Status: SHIPPED.

## 2026-07-23 — [LOW] Live-open validation findings (RTH acid test of the shipped system)

Ran the full live-validation sequence at the 9:33 ET open (data-validator + both engines) against LIVE
RTH data. **The system is correct on live data** — 22→26 PASS, VIX matched Polygon live to Δ0.000%
(clearing the pre-open "13% off" flag, which was purely an off-hours prev-close artifact), SPY/SPX/QQQ
prices/GEX/walls all matched, Engine A generated 5 quality gated plays, Engine B screened 9k+ stocks and
correctly reported no-weekly for optionless micro-cap movers. Two findings:

- **[FIXED] Validator false-FAILed a fast single-name mover.** `0DTE live MU: underlying_price` FAILed at
  Δ0.55% (later Δ1.4% as MU ran 967→987 in 5min) under the RTH `priceTol=0.3%`. Root cause: that tolerance
  is calibrated for the SLOW index/ETF core (SPY matched to 0.003%); a single stock legitimately diverges
  more. Fix (`data-validator.mjs`): asset-class-aware tolerance — index/ETF names keep the tight 0.3%
  band, single names get a wider band (1.5% RTH) that still catches GROSS staleness. The code comment had
  already flagged this exact assumption as "worth revisiting if it false-fails in practice" — today it did.
- **[FIXED] Validator false-FAILed `entry_premium` (basis mismatch, 11:00 checkpoint).** `0DTE ledger QQQ:
  entry_premium` FAILed at logged 7.81 vs the option's ±3m flag-window range [5.29, 6.63]. Root cause:
  `entry_premium` is `resolveLedgerEntryPremium(plan.entry_max, top_strike_avg_fill)` (plan.ts:146) — the
  flow's AVERAGE FILL over the accumulation window (the "enter ≤ X" ceiling), which the grading uses as the
  entry basis by design (`scan.ts:560` "MUST match entry_max") and is CONSERVATIVE (grades long entries at
  the ceiling → understates wins, never overstates). The fill accumulated from the 9:30 open where the
  option traded 7.78; the setup only flagged at 10:01 where it traded ~6, so the tight ±3m window missed the
  real fill. Fix (`data-validator.mjs`): ground `entry_premium` against an ASYMMETRIC accumulation-aware
  window (look back `ENTRY_PREM_LOOKBACK_MS`=150m + a small forward cushion) — 7.81 now sits inside [3.61,
  7.78] → PASS. Still catches a fabricated premium the contract never traded near all day. NOT an app bug.
- **[OPEN, app-design] The board's `underlying_price` is FLOW-DERIVED, so it lags on sparse-flow names.**
  `scan.ts` sets `underlying_price` from the UW flow alerts (`f.underlying_price`), not a live quote — so
  it's only as fresh as the name's flow cadence. SPY/QQQ (constant flow) stay live-fresh; MU (sparse flow)
  sat frozen at 972.84 across 5min while the tape moved ~2%. This nudges the board's moneyness gate +
  displayed underlying for less-active single names. NOT a clear bug (the flow-context price may be
  intentional), but a real freshness question — candidate improvement: overlay a live underlying quote on
  the board setup so moneyness/display is accurate for all names regardless of flow cadence. Surfaced for a
  product call, not unilaterally changed.

## 2026-07-23 — [MILESTONE] Banger scale-out flagship WIRED LIVE end-to-end (rearchitecture 6b complete)

- **What shipped:** the whole-market banger scale-out — the +26%/+20%-net-OOS positive-skew flagship — is
  no longer backtest-only. It now grades on the live overnight cron and graduates on the live ledger:
  - **#973** pure core: `resolveBangerGradeRequest` (published play → OCC + entry premium + expiry, or
    `not_banger`/`ungradeable`) + `optionAggBarsToScaleOut` (Polygon AggBar → ScaleOutBar, drop undefined-t).
  - **#974** migration + fail-soft cron: nullable `nighthawk_play_outcomes.scale_out_grade` JSONB; a
    dedicated EXPIRY-GATED pass (`resolveBangerScaleOutGrades`) grades each banger on its OPTION's forward
    bars once expiry passes and pins first-write-wins. Fully isolated — can never fail the stock-outcome sync.
  - **#975** reader: shared pure graduation core (`recommendScaleOutFromGrades` + `readScaleOutGradeBlob`,
    reused by BOTH the 0DTE ledger and the nighthawk ledger so the rule can't drift) + `summarizeBangerScaleOut`
    track record, surfaced read-only on `admin/nighthawk/analytics` (fail-soft).
- **The bridge (why 3 PRs, not 1):** `recommendScaleOut` reads `zerodte_setup_log`, but bangers live only in
  `nighthawk_play_outcomes` (disjoint tables, no shared column). The nighthawk-side bridge keeps the two
  products cleanly separated while sharing ONE graduation rule.
- **Validation:** full path proven live (real daily option bars → real multiple, e.g. NVDA $180C
  1.23×/1.23×); flagship EV re-confirmed at ~1000-play scale (**1176 movers, +19% net-OOS, 53% green**,
  realistic minute fills + 7.5% slippage); shipped trail 0.5 at/below OOS optimum. Index pipeline sim runs
  clean end-to-end (3179 alerts/3d → 5 published gated plays). Touched-file tests 47/47 green.
- **Remaining (6d, gated on evidence, NOT build work):** flip the live managed exit when the live ledger's
  `recommendScaleOut` reads `enforce` (n ≥ 10 gradeable bangers clearing the +0.15×/$1 bar). Until then the
  scale-out is advisory and accrues real evidence — calibration-first to the end. **Status: 6b COMPLETE.**

## 2026-07-23 — [HIGH] Offline ratchet grader was EV-optimistic (mark-faithfulness) — FIXED + iron-condor guard

- **Severity:** HIGH for evidence-fidelity (the grader that measures the ratchet exit / would gate the
  banger scale-out was optimistically biased); **LOW blast radius** — every defect lived in the audit
  HARNESS (`scripts/audit/zerodte-sim.mjs`) + one latent guard in `iron-condor.ts`, **not** in any live
  trading path. Surfaced by a 10-agent adversarial audit of this session's new 0DTE code (the banger-live
  cores `banger-scale-out-grade.ts` + the calibration graduation ladder came back CLEAN). **Status: FIXED.**
- **Root cause & fixes (`gradeThroughExitEngine`):**
  1. **(#1, HIGH) best-case fill.** A ratchet/runner FLOOR breach booked `floorPnlPct` — the rule level —
     not the breaching mark. The live engine freezes `pinnedLivePnlPct(entry, mark)`, and by the breach
     condition that mark is at/below the floor (a fast candle undershoots it). So every ratchet exit was
     credited the best-case fill → the ratchet's realized EV was systematically **optimistic by ~20–50 pts
     per floored event**, and the advertised `RATCHET_PROTECT_AT=low|close` bracket only moved the TRIGGER,
     never the fill. **Fix:** the pessimistic bound (`=low`) now books the gap-through fill `pnlAt(bar low)`;
     the optimistic bound (`=close`) keeps the clean-floor `floorPnlPct`. The bracket now varies the fill
     (proven: SPY/QQ/… 2026-07-20 low 43.0% vs close 45.0%, previously identical). plan_stop keeps
     `pnlAt(planStop)` (repo stop convention).
  2. **(#2, MED) post-15:30 grading.** The replay ran bars to 16:00 (960) while the board hard-CLOSES every
     0DTE row at 15:30 (930, `derivePlayStatus`) and fires NO exit after — grading 30 min of trades the
     board forbids, and diverging from the sibling `gradePlanFromBars` (which breaks at 15:30). **Fix:** cap
     the replay at `REPLAY_STOP_ET_MIN = 930`.
  3. **(#3, MED) entry-bar look-ahead.** The entry bar was included (`b.t >= flaggedMs`); entry is its CLOSE,
     so its intrabar HIGH (printed earlier in that minute) could arm a floor/trim off a price the trade
     never had. **Fix:** exclude the entry bar (`b.t > flaggedMs`); the peak latch starts post-entry.
  - **(LOW, #5) iron-condor guard** — `selectIronCondor` never asserted strikes > 0, so a sub-$1.50 spot
    could return a negative-strike condor with `est_win_rate=100`. Fixed + tested in **PR #970** (latent on
    today's index/mega-cap 0DTE universe; load-bearing before the geometry is reused on cheaper bangers).
- **Net effect on the ratchet finding below:** the bias was optimistic TOWARD the ratchet, so correcting it
  did not overturn "hold > ratchet" — it **reinforced** it and made the magnitudes honest (see the updated
  evidence). No production behavior changed; the corrected grader is what the ratchet-finding numbers now cite.

## 2026-07-23 — [MEDIUM] Index 0DTE ratchet exit costs EV vs hold — CONFIRMED finding, live change DEFERRED

- **Severity:** MEDIUM (an EV leak on the live index exit; not a crash/data bug). **Status: CONFIRMED
  FINDING; exit change DEFERRED — larger-sample sweep run with the honest grader still cannot identify an
  optimal config; do NOT flip the live exit yet.**
- **Root cause:** `exit-engine.ts` `EXIT_RULES.ratchet_arm_pnl_pct = 25` arms a **breakeven floor** once
  a play's peak P&L hits +25%. But a 0DTE momentum play reaching +25% is a *continuation* signal, not a
  take-profit one — so the floor scratches at breakeven the exact plays that go on to +100%. The
  scratched-winner cost exceeds the saved-loss benefit.
- **Evidence (mark-faithful grader, larger sample):** graded through the SHIPPED exit
  (`gradeThroughExitEngine`, PR #961), now MARK-CORRECT (the grader-fidelity fixes above — gap-through
  fill, 15:30 cap, no entry-bar look-ahead). Re-swept over a dense Feb→Jul grid: **276 plays / 40 sessions**
  (all names) and **106 index-only plays** (SPY/QQQ/IWM). On the FULL sample **HOLD (−50/+100) beats the
  shipped ratchet**: **+4.1 pts/play** (all), **+2.8 pts/play** (index-only). The ratchet **buys win-rate,
  not EV** — WR climbs 34%→51% as the floors tighten while full-sample EV stays flat-to-worse (a clean
  green≠profitable illustration). Index 0DTE directional buying at 09:45 is ~breakeven-to-slightly-negative
  under EVERY exit config; the exit tune is a second-order lever. CONVERGES with the P3 "let-it-run" result.
- **Why STILL DEFERRED (larger sweep run, config still not identifiable):** the OOS split **disagrees in
  both universes** — calib ranks HOLD best (all +0.2% vs shipped −6.1%; index +1.1% vs −6.1%), the newest
  30% ranks the RATCHET best (all: shipped +3.0% vs hold +0.2%; index: shipped −4.9% vs hold −13.8%). 0DTE
  EV is dominated by a few big winners, so even at n=276/40-sessions the *config* choice is regime-noise.
  The *direction* (hold ≥ shipped ratchet on the full sample) is robust; the *optimal intermediate config*
  is not. Flipping a LIVE risk-management exit on windows that disagree would be reckless.
- **MECHANISM breakthrough (robust, unlike the config question):** the earlier work compared the shipped
  breakeven-FLOOR-EXIT only against pure HOLD (which flipped OOS). Testing the *mechanism* the exit-engine
  header itself hints at — a partial **TRIM**-at-arm instead of a floor-**EXIT** — separates cleanly. Over
  **352 plays / 51 sessions** (mark-faithful grader), a `trim ⅓@+25% + ⅓@+50%, run the last ⅓` beats **both**
  HOLD and the shipped floor-exit in **every** split (calib AND valid) and **both** universes (all-names AND
  index-only), and lifts win-rate 32%→**50%**:
  ```
  exit (all names)          calib    valid    all     win
  HOLD                      -0.8%   -12.1%   -3.7%    33%
  shipped floor arm+25      -4.4%   -10.1%   -5.8%    32%
  trim ⅓@25 + ⅓@50, run     +0.6%    -4.4%   -0.7%    50%   ← dominates both, every window
  ```
  Root: the floor-exit dumps the WHOLE runner on a dip to breakeven (scratching momentum); a partial trim
  banks into strength while letting the rest run — positive-skew-preserving, the same edge as the banger
  scale-out. Honest caveat: the valid regime was bad for 0DTE longs so all configs are negative there; the
  trim just loses least — it makes the exit strictly better and much greener, not the engine profitable.
- **Fix path — leading candidate identified, graduate before flipping:** the partial-trim is the clear
  replacement for the floor-exit, BUT `exit-engine.ts`'s own design says the ratchet thresholds are "v1
  constants … tuned with data" via **the counterfactual LEDGER grader**, not an offline backtest — and my
  evidence is an offline mirror over probed contracts. So the disciplined path is a `recommendExit`-style
  coded verdict that pins per-row floor-vs-trim counterfactuals on the LIVE ledger and graduates the trim
  when the live data confirms (the same calibration-first ladder as confluence/accumulation/scale-out).
  Until then the shipped floor-exit stands; the offline mirror (a `RATCHET_DUMP`-fed exit-variant sweep over
  the cached bar-paths) is reproducible evidence, not a license to hand-flip live risk code. **Do NOT flip
  the live exit off the backtest alone.**

## 2026-07-23 — 0DTE entry-timing correction: unlock 9:45 → 10:00 + timeOfDayFactor recalibration (USER-AUTHORIZED)

- **Root cause:** the G-2 opening-window unlock sat at **9:45 ET** (2026-07-13 directive) and
  `timeOfDayFactor` (`intraday.ts`) **rewarded** the 9:50–11:00 window (+5) while **penalizing** 11:00
  (−5, "lunch chop"). The simulator (25 sessions × SPY/QQQ/IWM, EV by fixed entry time) showed this is
  inverted vs reality: **9:45 −12.1% EV / 26% win (the WORST tested time)**, improving monotonically —
  10:00 −7.8%, 10:30 −9.1%, **11:00 +1.5%**. The gate unlocked at the worst moment and the score nudge
  favored the weak window.
- **Fix (user-authorized 2026-07-23, supersedes the 2026-07-13 directive):**
  (a) `OPENING_WINDOW_UNLOCK_ET_MINUTES` 9:45 → **10:00** (block the demonstrably-worst first 30 min);
  (b) `timeOfDayFactor` recalibrated — opening-chop penalty extends to 10:00, the **+reward moves to the
  10:30–12:30 continuation window**, real lunch chop is 12:30–14:00, afternoon-trend window unchanged.
- **Measured, not blunt:** stopped at 10:00 (not 11:00) because the backtest grader holds to
  stop/target/15:30 and ignores the live exit engine (likely UNDERSTATES early entries), and blocking
  the whole morning would empty the board. The soft 10:00–12:30 gradient is a score nudge, not a gate.
  The gate still buckets every commit by ET time (`gate_calibration_json.committed_at_et`), so the
  **live ledger** — not this backtest — decides whether to push the unlock later.
- **Evidence:** gates + board + 7/13-replay suites updated and green (133/133); the 7/13 replay now
  shows G-2 catching the pre-10:00 entries (AMD 09:50, SPY/MU 09:55) as a corroborating guard while
  G-1 tape-alignment remains the primary killer (F-3 holds). tsc + eslint clean.
- **Status:** SHIPPED (PR next).

## 2026-07-23 — Whole-market banger research + scanner tool (research + tooling)

### Research (docs/audit/0DTE-RESEARCH.md) — evidence-driven map for a top-tier system
- **0DTE grinder:** multi-day vs single-day discovery is a WASH (32% vs 36% WR, n≈30); entry timing is
  a real-but-modest edge (later > open ~13 EV pts; a 7-session "+43%" was OVERFIT, 25-session truth
  +1.5%); **CONFLUENCE is the edge** — 0/1/2 confirmations (VWAP-side + SPY-aligned) ladder −12.5% → 0%
  → **+15.9% EV** @ −50/+100, which resolves the geometry paradox (wide target is best ONLY for the
  confluent subset). The live `timeOfDayFactor`/9:45-unlock look mis-boundaried vs the data (surface to
  user; don't override the 2026-07-13 directive).
- **Whole-market bangers:** Polygon grouped-daily screens EVERY US stock (~12.4k/day). A dumb
  breakout+volume screen surfaces bangers constantly — **75% of movers' cheap OTM weeklies touch ≥2x,
  50% ≥3x, 25% ≥5x** (ANET $0.36→23x). **BUT held to expiry they decay to ~zero** (hold ~1.3x mean).
  The edge is the EXIT: a mechanical scale-out (50%@2x + trail + −60% stop) returns **+47% / +86% / +16%
  realized EV** across the 3 sessions with data (~+50% weighted, n=28, every session positive).

### Tooling — `scripts/audit/market-banger-scan.mjs` (`npm run scan:bangers`)
- Whole-market screen → ranked banger candidates + suggested cheap OTM weekly call; `--grade=DATE`
  measures maxRet vs hold-to-expiry vs REALIZED-under-scale-out. Read-only; secrets from env.
- **Key product truth:** finding bangers is trivial; **exiting them mechanically is the whole edge** —
  where a system beats a human. This is the north star for the whole-market engine.
- **Status:** research + tool committed (PR next). Prioritized plan in the research doc: P1 confluence
  tier → P2 banger scanner→discovery → P3 exit-engine study → P4 regime → P5 timing → P6 learning loop.

## 2026-07-22 — Multi-day flow accumulation wired into the LIVE 0DTE loop (feat, calibration-first)

### feat — the always-on scanner now has multi-day memory
- **Root problem (the user's red flag, confirmed):** `scanZeroDteBoard()` discovered setups from a
  SEVEN-HOUR window only — `fetchRecentFlows({ since_hours: 7, min_premium: 150_000, max_dte: 1 })`
  (`src/lib/zerodte/scan.ts:152`). Single-day amnesia: a name hit on the same directional strike for
  three days running looked identical to a one-off print. Real conviction is ACCUMULATION.
- **Fix:** the scan now also pulls a WIDE multi-day window (`MULTI_DAY_FLOW_HOURS=120` ≈ 5 days, all
  expiries, `min_premium 250k`, best-effort — a failure degrades to "no memory", never breaks the
  intraday scan) and runs the merged multi-day accumulation engine (`flowAccumulationByTicker`, #943)
  over it. New pure module `src/lib/zerodte/flow-accumulation-context.ts` maps DB `FlowRow`s →
  `FlowAlertRow`s (reconstructing the aggressor split from `ask_pct`), computes per-ticker signals,
  and attaches `flow_accumulation` to every `EnrichedZeroDteSetup`: `{direction, strength, days,
  net_signed_premium, magnet_strike, magnet_side, aligned}` — where `aligned` = today's 0DTE
  direction agrees with the multi-day stacked positioning. Flows through the board payload
  (`setups: EnrichedZeroDteSetup[]`).
- **Calibration-first (this codebase's own discipline, `calibration.ts`):** EVIDENCE ONLY. It is
  recorded/surfaced but does NOT yet move the score or gate the board. Whether "aligned with
  multi-day accumulation" predicts wins is a question for the graded ledger — once the bucket is
  large enough and measurably better, the alignment graduates into a scoring input the way G-4/G-6
  did. Never on vibes.
- **Evidence:** new pure module 6/6 unit tests (ask_pct split, missing-split fallback, malformed-row
  drop, alignment logic, end-to-end 3-day build reads bull + aligned, attach match/miss);
  `board.test.ts` 82/82 (no regression); tsc + eslint clean. (DB path itself can't run in-sandbox —
  Postgres TCP is blocked — but the engine was proven on live flow via `sim:0dte`.)
- **Follow-ups (noted, not in this PR — single-issue discipline):** (1) render the badge on the 0DTE
  card (payload already carries it); (2) persist `flow_accumulation` + `aligned` into the ledger
  `entry_context` and extend `calibration.ts` to bucket graded outcomes by alignment → graduate to a
  real scoring boost.
- **Status:** MERGED-pending (PR opens next). This is breakthrough #1 of the 0DTE loop plan.

## 2026-07-22 — 0DTE play SIMULATOR shipped + first structural findings (tooling + P2)

### Tooling — `scripts/audit/zerodte-sim.mjs` (`npm run sim:0dte`)
- **What:** a per-change 0DTE simulator that runs the REAL pipeline functions (imported from
  `src/`, not reimplemented) against REAL data (multi-day UW flow + live Polygon chains + Polygon
  minute bars) and reports, per stage: which tickers become candidates, the exact FUNNEL
  (candidates → score floor → chain → contract → premium → geometry → grounded → built → 0DTE
  filter → published), a per-ticker GATE TRACE (where each candidate died / that it passed), the
  generated plays with real contracts, and — in `--grade=YYYY-MM-DD` backtest mode — a minute-bar
  outcome (doubled / stopped / time-stop) per play.
- **Real code exercised:** `flowAccumulationByTicker`, `buildDeterministicEditionPlays` +
  `pickChainContract` (+ its funnel), `filterPlaysByMaxDte`/`optionsPlayWithinMaxDte`,
  `validatePlayGeometry`, `gradePlanFromBars` + `PLAN_RULES`.
- **Scope boundary (honest):** candidate DISCOVERY here is the accumulation engine itself
  (direction + strength from stacked multi-day flow), not the full production market-wide
  discovery (`candidates.ts` needs UW endpoints + Redis not all reachable from the sandbox). The
  point is to test how accumulation-driven candidates flow through the REAL selector/gates.
  Backtest grading uses an ATM 0DTE strike probed against the option's OWN minute bars on the
  session date (historical per-strike OI isn't available, so the live-OI picker is not used in
  backtest mode).
- **Env:** the script self-defaults `POLYGON_API_BASE` to `https://api.massive.com` when it's the
  unresolved sandbox placeholder. Run with `env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY`.

### P2 — Strict `maxDte=1` structurally starves the board on non-Friday sessions
- **Symptom (simulator, live + backtest):** on a Tuesday (`--grade=2026-07-21`) only SPY/QQQ/IWM
  graded; every single-name candidate returned `no_0dte` ("no 0DTE contract"). On a Friday
  (`--grade=2026-07-17`) all 10 candidates graded (the whole weekly universe expires that day).
- **Root cause:** only the big index ETFs (SPY/QQQ/IWM) + a few indices list Mon–Fri **daily**
  expiries; single names (NVDA, AAPL, MU, TSM, …) list weekly (Friday) expiries. `pickChainContract`
  in day mode requires an expiry within `[today, today+maxDte]`, so on Mon–Thu every non-daily name
  becomes stock-only ("— no options data available") and is dropped by `filterPlaysByMaxDte`. In
  today-mode the gate trace shows this precisely (`◐ built but dropped by 0DTE filter — contract
  "TSM — no options data available"`).
- **Evidence:** `npm run sim:0dte -- --grade=2026-07-21` → 2 gradeable (SPY/QQQ), 8 `no_0dte`;
  `--grade=2026-07-17` → 10 gradeable. Live today-mode funnel: 25 candidates → 10 stock-only.
- **Implication (not yet fixed — design decision needed):** a strict same-day-only 0DTE system can
  only trade ~3 ETFs four days out of five. Options to strengthen coverage: (a) widen the day window
  to the nearest listed weekly per-underlying (trade the true front expiry, still short-dated); (b)
  on Mon–Thu, concentrate the single-name universe into Friday 0DTE and only trade ETFs same-day;
  (c) keep strict same-day and accept an ETF-only board Mon–Thu. Flagging for the roadmap; the
  simulator now measures the trade-off of whichever path we pick.
- **Status:** OPEN (design). Simulator committed so any fix can be measured before/after.

### P2 — Grader shows stop-dominated outcomes at a fixed 09:45 ATM entry
- **Observation (backtest):** `--grade=2026-07-17` → 2 doubled / 8 stopped (20% double-rate, avg
  −20%); `--grade=2026-07-21` → 1/1. A fixed 09:45-ET ATM entry with the current PLAN_RULES
  (−50% stop / +100% target / 15:30 time-stop) is stop-heavy — consistent with the earlier live
  debrief (0% win / `target_unreachable` gate). Not a code bug; a tuning signal. The simulator is
  the harness to sweep entry timing / strike offset / stop-target geometry against real bars before
  changing the live rules.
- **Status:** OPEN (tuning) — measure candidate changes with the sim before shipping.

## 2026-07-22 — Auth nav stuck on "Sign in" after login (P1, FIXED live)

### P1 — Cloudflare edge-cached the homepage HTML, so signed-in users saw the anonymous nav
- **Symptom (member-reported):** sign in successfully, but the marketing nav keeps showing
  "Sign in" / "Get access →" instead of "Open desk →" — indefinitely.
- **Root cause — NOT the app.** The origin is correct: `MarketingPageShell`
  (`src/components/landing/MarketingPageShell.tsx:15`) computes `signedIn` per-request via
  `activeClerkUserIdFromRequestCookies()` (`src/lib/clerk-session-cookies.ts`), which decodes the
  `__session` JWT; `cookies()` makes the route dynamic and the origin sends
  `Cache-Control: private, no-store`. The bug was at the edge: a Cloudflare **cache rule**
  (`http_request_cache_settings` ruleset, rule `f261edb0…`) matched
  `path eq "/" or path eq "/upgrade" or starts_with(path,"/learn")` with
  `cache:true, edge_ttl.default=7200, mode=override_origin` — i.e. it **force-cached the HTML for
  2h, ignoring the origin's no-store**. One anonymous snapshot was stored and served to every
  visitor, signed-in included. (`/pricing`, `/faq`, and all `(site)` desk pages were already
  `cf-cache-status: DYNAMIC`, so only these three auth-chrome pages were affected.)
- **Evidence (live, headless Clerk login):** origin fetch of `/` with a cache-buster —
  anonymous → `Get access →` present; with a real `__session` cookie → `Get access →` gone,
  `/dashboard` links +2 (the nav flips to "Open desk →"). So the origin renders both states
  correctly. But the EDGE fetch of the real URL `/` WITH a valid `__session` cookie returned
  `cf-cache-status: HIT` (age climbing 135→136 across requests) — the cached anonymous HTML.
- **Fix (live, root cause):** appended `and (not http.cookie contains "__session")` to the rule's
  expression via the Cloudflare rulesets API (PATCH `…/rulesets/{id}/rules/{ruleId}`). Now any
  request carrying a Clerk session cookie **bypasses** the edge cache and hits the origin (correct
  per-user nav), while anonymous / signed-out (`__client_uat=0`, no `__session`) requests still get
  the fast cached copy — landing-page perf preserved. `__session` is httpOnly but the edge sees it
  (httpOnly hides from JS, not from Cloudflare). Verified post-fix: signed-in edge fetch →
  `cf-cache-status: MISS/DYNAMIC` + correct "Open desk →" nav; anonymous → still `HIT`.
- **Durability / follow-up:** this cache ruleset was created **manually in the Cloudflare dashboard**
  — it is NOT in `blackout-infra` terraform, so the live edit persists and no IaC will revert it. The
  deploy pipeline's `purge_everything` does not reintroduce the bug (first anon request re-caches
  anon; signed-in still bypasses). Remaining risk is a human re-editing the rule and dropping the
  cookie guard → codifying the Cloudflare cache rules in terraform (blackout-infra) is the durable
  belt-and-suspenders follow-up. Any NEW auth-dependent HTML route added to an edge-cache rule must
  carry the same `not http.cookie contains "__session"` guard.
- **Status:** FIXED live + verified. This docs entry is the in-repo record (the fix itself lives in
  Cloudflare, not code).

## 2026-07-21 — Enhancement: Wall Integrity Rings (second visual channel on beads)

### FEATURE — Bead halo now encodes wall confidence (firm/moderate/thin), not just magnitude
- **Gap, not a bug:** a bead's SIZE encodes magnitude (dealer gamma parked at the strike), but a
  member staring at the rail couldn't distinguish a wall that held all session and towers over its
  neighbors from a fat-but-fleeting level sitting in a mushy cluster — both drew as a big bead.
  Integrity was already computed (`vector-wall-integrity.ts`) but only surfaced as text for the
  TOP wall on the desk terminal; the chart threw it away.
- **Fix (additive, zero new plumbing):** generalized `scoreTopWalls` → `integrityByStrike()`
  (scores EVERY wall per side, same math + shared refMaxPct, so ring and terminal never disagree).
  New pure `haloRingForTier()` in `vector-wall-visual.ts` maps the tier onto the halo already drawn
  behind each core dot → the halo becomes a confidence RING (firm: crisp/bright/larger; moderate:
  soft; thin: suppressed → bare dot). `buildWallBeadMarkers`/`applyWallBeadMarkers` thread the map
  from the latest rail sample; GEX lens only (persistence is GEX-scoped). Core dot untouched, so the
  magnitude and confidence channels stay independent.
- **Non-breaking by construction:** unknown tier → neutral {1,1} multiplier, so VEX-lens and
  unscored/legacy rails render byte-identical to pre-ring (unit-tested).
- **Evidence:** 3909/3909 unit tests pass (+7 new: `integrityByStrike` all-wall scoring + shared
  ref + empty-safety; `haloRingForTier` neutral default + firm>moderate>thin ordering). tsc clean.
- **Status:** OPEN PR (fresh branch off main after #876 merged). Live visual validation via the
  Vector E2E screenshot gate after staging deploy.

## 2026-07-13 — Vector bead-rail / DTE-coherence audit (member-driven, RTH live)

### P0 — Bead trails ran full-width from the open; "no new walls all day" (FIXED, live-verified)
- **Root cause:** the recorder stores the full 20-deep-per-side ladder every 15s bucket, and
  `trailsByStrike` drew a bead in EVERY bucket where a strike appeared anywhere in that set.
  Structural round-number strikes never leave a 20-wide set → every trail born at the open; a
  wall that became dominant intraday was invisible as "new". `src/features/vector/lib/vector-wall-history.ts`.
- **Fix:** per-bucket DOMINANCE filter (`DOMINANT_WALLS_PER_BUCKET = 6`, top-N by |gamma| share) —
  honest births/deaths; persistent walls still run full-width. Commit `64f09e6` + regression test.
- **Evidence live:** 10-ticker rail sweep post-deploy: every ticker 2–8 distinct trail origins
  (pre-fix: one shared origin). Rebirth cue + trim-edge birth suppression followed (`21091ef`, `070da8e`).

### P0 — Universe limited to ~21 tickers; ASTS single beads (FIXED, live-verified)
- **Root cause:** the rail inherited the UW-overlay allowlist accidentally — walls are
  Polygon-cache cheap for any ticker; only pre-view recording was missing.
- **Fix:** `backfillRailPrefix` + `reconstructSessionRail` (today's published OI, gamma recomputed
  along the real spot path, ghost-rendered, dominance-filtered; never overwrites observed samples).
  ASTS added to the recorded set. Commit `070da8e`.
- **Evidence live:** PLTR/HOOD/SOFI/RIVN (never recorded) render full first-class Vector pages
  with staggered-birth rails.

### P1 — Wheel zoom snapped back (price-axis autoScale re-forced per tick) (FIXED, live-verified)
- **Root cause:** `refreshTrails`/`refreshOverlays` unconditionally re-applied
  `priceScale().applyOptions({autoScale:true})` every SSE tick, overriding a member's manual zoom
  (#299 had fixed only the time axis). `VectorChart.tsx`.
- **Fix:** `reassertPriceAutoScale` guard (only re-nudge while autoscale still engaged). Commit `35b8485`.
- **Evidence live:** wheel-gesture harness 5/5 — zoomed 103→39 bar-runs, held 39→39 through 12s
  of live ticks.

### P1 — SPX WEEKLY flip narrated 5,996 with spot 7,522 (−20%) while the API said 7,995 (FIXED)
- **Root cause:** banded chain snapshot edge flaps which zero-crossings exist; when the near-spot
  crossing vanished, nearest-spot selection returned the deep-OTM artifact.
  `vector-gex-reconstruct.ts:gammaFlipFromLadder`.
- **Fix:** plausibility band ±12% of spot; none survive → null → blended-flip fallback. Commit
  `75296eb` + regression test. Caught by the DTE grind (UI-vs-API same-instant).

### P1 — "All" horizon meant different things on different surfaces (FIXED)
- **Root cause:** stream-fed surfaces show the warm blended near-term aggregate; a COLD API task
  fell back to an all-expiry CHAIN aggregate (grind: ASTS banner resistance 75 vs dte=all API 90;
  TSLA support 392.5 vs 380). `vector-snapshot.ts:getVectorGexWallsForHorizon`.
- **Fix:** cold path reads the last recorded rail sample from shared Redis first (the numbers the
  stream showed ≤15s ago); chain stays last resort. Commit `75296eb`. Re-grind pending confirmation.

### P1 — AAPL banner "support NaN" (FIXED) + intermittent missing put side (OPEN lead)
- **Fix shipped:** `deriveVectorRegime` finite-guards wall levels (NaN passes `!= null` and
  toLocaleString renders "NaN"). Commit `f34ccc5` + test.
- **Open lead:** per-expiry gate lets a call-only scoped set win (`vector-snapshot.ts` narrowed
  branch), so "support" intermittently disappears for a horizon while the API (one cache refresh
  later) has a put king. Needs producer-side investigation (thin-chain honesty vs sign/threshold bug).

### P2 — dte= query param was case-sensitive; "0DTE" silently re-scoped to "all" (FIXED)
- `normalizeDteHorizon` now case-folds. Commit `a01f313` + tests. (Found because the hardcore
  harness itself hit it; a member integration could too.)

### P2 — Pivot-P line shared EMA 9's exact color #fb923c (FIXED)
- Two indicators indistinguishable on-chart; also collided pixel-level E2E checks. Pivot-P →
  #f97316. Commit `a01f313`.

### Harness false negatives fixed (testing the tests)
- Terminal capture truncated at 300 chars (cut before king citations); rail-advance poll queried
  `dte=all` without session (empty by route contract), then uppercase `0DTE` (re-scoped to "all"),
  then a DOM date-scrape that could yield null; zoom predicate expected bar-runs to INCREASE on
  zoom-in (they decrease). All four blamed the product falsely; all fixed with comments explaining why.

### Verified-healthy (evidence against suspicion)
- Narrowed recorders: SPX 0dte/weekly/monthly = 319 samples each (full session), AAPL/NVDA 73 —
  direct authed probe. Rail advance re-check: AAPL 85→88 samples in 35s.
- Indicators one-by-one (6 line indicators × 6 tickers): paint alone, clear to 0px on disable.
- Rapid-switch race (0DTE→150ms→MONTHLY): final state is MONTHLY's on all 6 tickers.
- DTE grind totals: 358/364 checks green across SPX/SPY/NVDA/TSLA/AAPL/ASTS.

### Still open (tracked)
- `/api/account/personal-alerts` 502 (origin-side; #304 made the failure honest).
- Night Hawk "Invalid Date" ×2; dashboard hydration #418 (can blank the desk on a cold load —
  escalated toward P0); SPX Slayer "Largo LIVE COMMENTARY" panel blank (pre-existing).
- Ladder "21 UI rows vs 20 API" one-off on AAPL (suspect: spot-divider row class; re-check).
- AAPL missing-put-side producer lead (above).

## 2026-07-13 evening — wall-engine overhaul (member-driven)

### P0 — Mid-session wall births were MATHEMATICALLY IMPOSSIBLE (FIXED — verify at 07-14 open)
- **Root cause (the deepest one):** wall strength = OI × gamma, and OI is published once pre-market
  and frozen all day → the dominant strike set was fixed at 9:30 regardless of session flow. No
  render-side filter could ever produce a mid-day birth. The reference product's walls birth
  mid-day because they accumulate TODAY's flow.
- **Fix:** positioning = OI + today's per-strike traded volume (Polygon day.volume, live) in the
  live per-expiry path; 0-OI contracts that traded today are kept (a brand-new same-day wall).
  Back-projected reconstruction stays OI-only (no fabricated morning walls). `a63f162` + tests.
- **Verification:** scheduled 2026-07-14T14:05Z — screenshots must show trails starting at
  mid-session candles.

### P0 — Narrowed rails contained blended data MISLABELED as the horizon (FIXED)
- TSLA "0DTE" on a Monday (no 0DTE chain exists) drew a full-width static rail — the #301
  blended-fallback recorded blended walls into narrowed rails when the chain was empty. Fallback
  deleted: empty chain → honest gap. `bb4ddeb`. Today's contaminated rows age out at session end.

### Product decisions (user-directed)
- DTE toggle = 0DTE/WEEKLY/MONTHLY only ("All" option removed; back-end "all" APIs intact);
  default weekly. `bb4ddeb` (corrects the over-removal in `b6697e4`).
- King anchor price-lines removed (redundant with king beads). `b6697e4`, visually verified gone.
- DOMINANT_WALLS_PER_BUCKET 6 → 3 (Skylit NODES=3): sparse rails, visible rotation. `bb4ddeb`.

### Process failure logged honestly
- THREE validation runs invalidated by launching inside rolling-deploy windows (mixed replicas
  serve old+new builds for several minutes; per-navigation results flip). Rule going forward:
  after a trunk push, wait ≥6 min AND confirm a marker (e.g. the toggle testids) before treating
  any UI run as evidence.

## 2026-07-14 — Vector data refresh rate optimization (member-reported, real-time responsiveness)

### P2 — Slow Vector data updates (spot every 3s, GEX ladder every 60s, flow/history every 30-60s) (FIXED, pending deploy verify)
- **Root cause:** SWR refresh intervals set conservatively for minimal server load; member reported Vector felt "static" and laggy, not responsive to market moves. Multiple Vector surfaces refreshing at different rates (3s/30s/60s).
- **Requirement:** All Vector data (GEX, VEX, DEX, charm) should update with uniform 15-second cadence across all stocks (universe + non-universe), timeframes, and DTEs. Spot prices 1 second from playbook.
- **Fix:** Standardized all Vector refresh intervals to 15 seconds default:
  - **Commit a3aced5:**
    - VectorDeskTerminal.tsx:61: SPX playbook refresh `3_000` → `1_000` (every 1s)
    - VectorGexLadder.tsx:105: GEX matrix refresh `60_000` → `15_000` (every 15s)
  - **Commit 78cdf74:**
    - VectorChart.tsx:1514: Flow data fetch `30_000` → `15_000` (every 15s)
    - VectorChart.tsx:1982: Wall history fetch `60_000` → `15_000` (every 15s)
    - VectorScanner.tsx:45: Universe scanner refresh `30_000` → `15_000` (every 15s)
- **Impact:** All Vector surfaces now refresh on same 15s cadence; spot prices update every 1s from playbook/SSE stream; gamma Greeks (GEX/VEX/DEX/charm) refresh 4x per minute instead of every 1-2 minutes.
- **Evidence expected:** Post-deploy, GEX/flow/history all update 4 times per minute; consistent refresh across all tickers and horizons; member experience no longer "static".
- **Status:** Fixed (commit 78cdf74), staged on `claude/three-repos-review-36t217`, awaiting staging deployment verification. Full UI validation requires Cognito authentication (https://staging.blackouttrades.com/vector)

## 2026-07-14 — Vector GEX ladder asymmetry (discovered during wall-birth validation)

### P1 — Scoped DTE ladder strikes mismatched chart walls (FIXED)
- **Root cause:** The GEX ladder panel (gex-ladder API endpoint) computed the ladder for narrowed horizons (0DTE/WEEKLY/MONTHLY) using OI-only GEX values, while the chart walls used volumeAdjusted GEX (OI + today's per-strike traded volume). This created an asymmetry: ladder UI showed different strike sets and values than the chart's beads, breaking cross-surface truth.
  - `src/features/vector/lib/vector-dte-walls-server.ts:95` — `getHorizonStrikeTotals()` called `gexLadderAtSpot(filtered, spot, today)` without `volumeAdjusted` flag (defaulted to false).
  - Chart walls used `{ volumeAdjusted: true }` (vector-dte-walls-core.ts:58) for mid-day births.
- **Evidence:** Test failures showed NVDA scoped ladder 44 UI strikes vs 89 API ladder strikes (49% data), banner support rendering NaN, cross-surface disagreement on king strikes (banner 210/NaN vs ladder 215/180). All consistent with unmatched GEX computation.
- **Fix:** Pass `{ volumeAdjusted: true }` to `gexLadderAtSpot()` in `getHorizonStrikeTotals()` (line 95). Since the ladder is fetched every 15s during live session, it must show dynamic walls (OI + dayVolume) that birth mid-day, not static OI-only structures.
  - **Commit 107c450:** Single-line fix + deep-dive comment in PR write-up.
- **Rationale:** The ladder is displayed live alongside the chart and polls every 15s. It should reflect the same volumeAdjusted positioning the chart uses for wall/bead rendering — consistency and honest mid-day births. Reconstruction (historical playback) still uses OI-only (no options passed).
- **Status:** Fixed (commit 107c450). Pending staging E2E re-validation (ladder strike count, banner/king alignment, cross-surface agreement).

## 2026-07-14 — Vector wall death visibility (user-observed)

### P2 — Dead walls not visually distinguished from live walls (FIXED)
- **Observation:** Old walls that dropped below the dominant set (top-3 by strength) were still visible on the chart at the same brightness as active walls, making it unclear which walls were live vs stale/dead.
- **Root cause:** Inactive walls (marked `active: false` when `lastSeen < latest` bucket) were dimmed to only 40% opacity (`STALE_TRAIL_FADE = 0.4`). At 40%, they're still faintly prominent and could read as "still forming" rather than "departed".
- **Code flow (verified correct):**
  - `trailsByStrike()`: Only records points for strikes in the DOMINANT set (top-3 per bucket by |pct| strength)
  - Strikes that drop below top-3 don't get a point in that bucket → `lastSeen` stops
  - `strikeTrailLifecycle()`: Sets `active = (lastSeen === latest)`. A wall is inactive if it's not in the latest bucket.
  - `VectorChart.tsx:740`: Applies `staleFade` multiplier to alpha (40% for inactive)
- **Fix:** Increased wall fade for inactive trails from 40% to 15% opacity (commit 70df3ea). Dead walls now render at the same ghost-opacity as modeled/reconstructed beads, making the "alive vs dead" distinction unmistakable. Visual hierarchy: solid beads (100%) > modeled beads (15%) ≈ dead walls (15%) > background.
- **Status:** Fixed (commit 70df3ea). Visual distinction should now be clear on staging — dead walls fade to a faint historical artifact level instead of remaining visually prominent.

## 2026-07-15 — Night Hawk publish gates too strict off-hours/staging

### P1 — Staging/off-hours Night Hawk editions published zero plays after G-N3 gate merged (FIXED, CI green, deployable)
- **Root cause:** PR-N3 (commit 9c9c122) added publish-gate G-N3 (stale-quote basis check). Price from Polygon fallback to hourly bars (no daily bar) yields `price_session=null`. The gate failed-closed: null=unknown=indistinguishable from stale → BLOCK. All plays blocked on staging (off-hours, no daily bars). Real issue: the gate couldn't distinguish "no daily bar" (legitimate, current data) from "stale quote" (wrong trading day).
- **Fix:** G-N3 now only blocks when `price_session` is KNOWN but STALE (wrong trading day). Null passes — data-gap ≠ staleness proof. `src/features/nighthawk/lib/publish-gates.ts:200,207`. Commit 53e1f67. Test updated (was fail-closed on null; now passes "hourly fallback is valid off-hours").
- **Verification:** (1) All 3487 unit tests pass, including deterministic-edition.test.ts (10/10 green). (2) TypeScript clean (`npx tsc --noEmit`). (3) Test updated: "G-N3 lenient: an UNDATEABLE quote (price_session null) passes — hourly fallback is valid off-hours" asserts `verdict="PUBLISH"`.
- **Blast radius:** Fix is isolated to the G-N3 gate logic in publish-gates.ts; no other code paths reference stale-quote checks. Deterministic edition builder, candidate extraction, and scoring all untouched.
- **Status:** Fixed (commit 53e1f67), deployable; Night Hawk on staging should now publish with plays. Trigger with `?force=1` post-deploy and verify 5 plays generate for tomorrow.

## 2026-07-15 — 0DTE desk bundle cache stampede (architecture audit)

### P3 — No single-flight coalescing on `fetchPolygonOdteDeskBundle` (FIXED)
- **Severity:** P3 (minor — wastes API quota, not data correctness)
- **Root cause:** `fetchPolygonOdteDeskBundle` (`polygon-options-gex.ts:177`) uses a plain `cachedOdteBundle` variable with no inflight guard. During a cache miss (every 5s at the new TTL), N concurrent requests each independently call `loadOdteContracts` → `aggregateGexRows`, producing N redundant Polygon API calls. The main heatmap path (`heatmapInflight` Map at line 1120) already prevents this correctly — the 0DTE path was never given the same treatment.
- **Evidence:** Code inspection — no inflight promise variable existed; the heatmap path has `heatmapInflight = new Map<string, Promise<...>>()` with `.finally(() => delete)` cleanup, but the 0DTE path had no equivalent. Under load (deploy cold start, 5s cache expiry with multiple SSE streams polling), all concurrent callers would independently fetch the same Polygon chain snapshot.
- **Fix:** Added `odteBundleInflight` promise variable (single key — always SPX). When a build is in progress, concurrent callers share the in-flight promise. The promise is cleared in `.finally()` so a thrown build can't wedge the slot. Cache checks (in-memory + Redis) remain outside the guard since they're fast reads. `polygon-options-gex.ts:92,225-247`.
- **Blast radius:** Single caller at line 2932 (`aggregateGexRows` in the SPX desk route). Return type unchanged (`Promise<{ rows, maxPain }>`). The positioning bundle (`fetchPolygonPositioningBundle` at line 3063) has the same pattern but is keyed per-ticker, so stampede risk is distributed — not fixed here, lower priority.
- **Status:** Fixed (this PR).

## 2026-07-16 — Night Hawk overnight edition deep audit (play quality + gate bias)

### P0 — Entry levels anchored at support, not spot — all 5 plays unfillable (FIXED)
- **Severity:** P0 (every published play was unfillable — members cannot trade at the suggested entries)
- **Root cause:** `buildDirectionalStockLevels()` in `play-levels.ts:68-77` set LONG entries at `support * 0.998 – support`, a "buy the pullback" shape. For overnight plays where members act at the next session's open, support is typically far below spot for trending stocks. The entry band sits 6–18% below market — unfillable. All 5 plays failed G-N1 (band_detached, max 3.5%) and G-N2 (target_unreachable, max 2× ATR14). The rescue cascade (PR-N13 `promoteTopBlocked`) correctly surfaced them with `gate_promoted: true` warnings, but the entries remain untradeable.
- **Evidence:** Staging edition 2026-07-17: FHN entry $23.20 vs spot $25.40 (−8.5%), COF $174.07 vs $211.93 (−17.8%), GOOGL $329.87 vs $354.46 (−6.8%), GOOG $333.35 vs $353.81 (−5.7%), ZETA $17.75 vs $21.40 (−17.0%). All 5/5 `gate_promoted: true`.
- **Fix:** Added optional `spot` parameter to `buildDirectionalStockLevels`. When present: LONG entry = spot ±0.5%, target = resistance, stop = support. SHORT entry = spot ±0.5%, target = support, stop = resistance. `resolveLevels()` in `deterministic-edition.ts` now passes spot through. Legacy callers (no spot param) unchanged. 4 new tests.
- **Blast radius:** 2 callers — `resolveLevels` (now passes spot) and `play-backfill.ts` (unchanged).
- **Status:** Fixed (PR #400).

### P0 — No ticker-family dedup — GOOGL + GOOG (same company) both in top 5 (FIXED)
- **Severity:** P0 (halves effective diversification; members get two plays on Alphabet)
- **Root cause:** Zero ticker-family awareness anywhere in the pipeline. `aggregateTickerFlows()` keys by raw ticker string. `rankCandidates()` sorts independently. `capSectorConcentration()` caps at 2/sector but both GOOGL and GOOG fit under that. `cross-edition-governor.ts` does exact string match only. `deterministic-edition.ts` iterates ranked order with no family check.
- **Evidence:** Staging edition 2026-07-17: GOOGL (rank 3, score 67) and GOOG (rank 4, score 63) both published as separate plays on Alphabet Inc.
- **Fix:** Added `TICKER_FAMILIES` map (GOOG→GOOGL, BRK.B→BRK.A, FOX→FOXA, etc.), `canonicalTicker()`, and `deduplicateTickerFamilies()` in `play-constraints.ts`. Wired into both `buildDeterministicEditionPlays` and `buildRescuePlays` — once a family member is selected, subsequent members are skipped. 8 new tests.
- **Status:** Fixed (PR #400).

### P2 — All-LONG structural bias in non-bearish markets (BY DESIGN)
- **Severity:** P2 (by design, but a diversification gap)
- **Root cause:** Five structural biases: (1) direction tie-break `>=` defaults to LONG (`scorer.ts:412`), (2) short-interest score is LONG-only (`scorer.ts:761`), (3) call premiums dominate in normal markets, (4) bearish posture requires 2/3 bearish signals (`bearish-posture.ts:29`), (5) regime multiplier is direction-blind (`scorer.ts:68`).
- **Evidence:** All 5 plays in the 2026-07-17 edition are LONG. The pipeline has no direction-balance constraint analogous to the sector concentration cap.
- **Status:** By design. Documented for future enhancement consideration (min-1-short constraint).

### P3 — Tier inversion: score 77 → B, score 67 → A (BY DESIGN)
- **Severity:** P3 (confusing UX but data-justified)
- **Root cause:** `nighthawk-tiers.ts:137-151` — scores ≥70 are ceiling-capped at B tier. The measured track record shows A+ (≥70) went 0 wins / 1 loss, while B (40-54) averaged +2.99%. The tier engine prices in the overnight inversion.
- **Evidence:** FHN score 77 → B (capped), GOOGL score 67 → A (mid-band, 3+ confirming signals).
- **Status:** By design. No member-facing explanation of the inversion exists (future UX item).

## 2026-07-18 — Production auth redirect validation

### P1 — Authenticated users see sign-in page instead of being redirected (FIXING)
- **Severity:** P1 (UX disruption — authenticated users landing on /sign-in see the form instead of being redirected to /)
- **Root cause:** `src/middleware-clerk.ts:47` — Clerk v7.5.17's `auth()` function in the `clerkMiddleware` callback does not reliably return `userId`, even when the session JWT is valid and `auth.protect()` succeeds. The internal `createMiddlewareAuthHandler` calls `requestState.toAuth()` on each invocation, while `createMiddlewareProtect` uses a pre-computed `rawAuthObject` from the initial `requestState.toAuth()` call. The divergence causes `auth().userId` to be `null` while `auth.protect()` correctly detects the authenticated user.
- **Evidence:** fetch-based validation against `blackouttrades.com` with FAPI-minted Clerk session (JWT `sub` confirmed via Backend API, session status: active). Protected routes return 200 (`auth.protect()` succeeds), but `/sign-in` returns 200 with `x-middleware-rewrite: /sign-in` (our redirect branch never fires). Unauthenticated requests correctly get 307 to `/sign-in?redirect_url=...`.
- **Fix (attempt 2, failed):** `auth.protect()` try-catch (PR #785). Deployed but still broken — `auth.protect()` also throws on `/sign-in` pages (Clerk's `authenticateRequest` produces a different `requestState` for auth pages vs protected pages with the same cookies).
- **Fix (attempt 3):** Bypass Clerk's auth resolution entirely. Decode the `__session` JWT payload directly in middleware (`atob` base64url decode), check `sub` (userId) and `exp` (expiry). The JWT is already cryptographically verified by Clerk's `authenticateRequest` before our handler runs. See issue #789.
- **Status:** Fix shipped (PR #790, hardened #792). Prod validated 2026-07-18.

## 2026-07-18 — 0DTE Command deep system audit (docs-only PR)

### P0 — Persist path ignores MOVED / illiquid / NO_QUOTE (FIXING — PR #788)
- **Severity:** P0 (commit discipline — UI shows SKIP via `resolveFreshFindStatus` but `persistZeroDteScan` only checks `gate.verdict === "COMMIT"`, `scan.ts` ~463–465)
- **Root cause:** Chase guard lives in `plan.ts` (`CHASE_PCT=35` → `entry_status=MOVED`) and board display, not in the one-way commit door.
- **Evidence:** `docs/audit/0DTE-SYSTEM-DEEP-AUDIT-2026-07-18.md` §3; `board.test.ts` MOVED → SKIP; no matching test on persist.
- **Fix:** G-8/G-9 hard blocks in `evaluateZeroDteGates` + persist belt-and-suspenders (PR #788).
- **Status:** Code PR #788 pending merge.

### P1 — G-7 macro hard-block not wired to 0DTE (FIXING — PR #788)
- **Severity:** P1 (event-day risk)
- **Root cause:** SPX Slayer has `macroHardBlock()` in `spx-play-gates.ts`; 0DTE gate spec lists G-7 but no shared module under `src/lib/zerodte/`.
- **Fix:** `macro-hard-block.ts` + wire into `evaluateZeroDteGates` (PR #788).
- **Status:** PR #788 pending merge.

### P1 — intraday_conflict flag not a hard gate (FIXING — PR #788)
- **Severity:** P1
- **Root cause:** `attachIntradayEdge` sets `intraday_conflict` on setup; logged in audit row only — not evaluated in `gates.ts`.
- **Fix:** G-10 in PR #788.
- **Status:** PR #788 pending merge.

### Reference
- **Full analysis:** `docs/audit/0DTE-SYSTEM-DEEP-AUDIT-2026-07-18.md` (architecture, loser forensics, API roadmap, phased build plan).
- **Implementation track:** PR #786 Night Hawk UI + 1s live lane; PR #788 precision gates.

## 2026-07-21 — Wall / bead / matrix-drift end-to-end validation (live prod, RTH)

### Live validation result: walls + beads + matrix % drift are numerically correct (PASS)
- **Method:** minted one temp prod Clerk admin/premium user (deleted after), swept SPX/SPY/NVDA/ASTS ×
  0DTE/WEEKLY/MONTHLY/ALL against the clean JSON APIs, independently RECOMPUTED the wall pick + pct
  share + drift-% formulas, and cross-checked against Polygon ground truth. 312 assertions PASS / 0 FAIL.
- **Walls:** served king wall == ladder argmax(+g)/argmin(−g) on every ticker×horizon; king pct ==
  independent |g|/Σ|g|; magnitude∈[0,1]; ≤1 king/side; flip within ±12% of spot; no malformed floats.
- **Beads:** recorded rails present (e.g. SPX 957 samples), times ascending/unique, all nodes finite &
  pct-valid, genuine mid-session births (SPX 11/17 strikes born after the first bucket — not back-filled).
- **Matrix % drift:** `shiftPercentForStrike` = (Δ/|current−Δ|)·100 is finite, sign-tracks-Δ, non-absurd
  across all strikes; drift keys ⊆ matrix strikes (2 minor out-of-window strikes on NVDA/ASTS — cosmetic).
- **Parity:** SPX≈10×SPY (10.034); app spot vs Polygon last within 0.14% (SPY/NVDA/ASTS); ladder advanced live in 35s.

### P2 — Put-wall proximity callout inverted the trade bias when support broke (FIXED, tested)
- **Severity:** P2 (member-facing narration; narrow ≤0.5% band, crossed-side case only). No numeric wall/bead value affected.
- **Root cause:** `src/features/vector/lib/vector-wall-proximity.ts` — for `side==="put"`, `above = signed>=0`
  means the put-wall STRIKE is at/above spot, i.e. spot has fallen THROUGH its largest-negative-gamma
  support (support breaking). The branch printed "reclaimed support, dip-buy zone" — a bullish dip-buy at
  the exact moment support was lost. The `!above` (intact support) branch was already correct, which made
  the inversion clear. The distance word ("% above") was also geometrically wrong for a below-spot wall.
- **Blast radius:** surfaced in the Vector desk terminal (`VectorChart`), `VectorPageShell`, AND the Largo
  AI read (`src/lib/bie/vector-full-state.ts`) — three member-facing consumers of the same string.
- **Fix:** `above` put branch now reads "Lost the {strike} put wall ({dist}% overhead) — support gave way …";
  `!above` distance corrected to "% below". Regression test added (spot under put wall must not narrate
  dip-buy/reclaimed). `npx tsx --test vector-wall-proximity.test.ts` → 7/7 pass.

### P2 — Gamma flip used a per-strike crossing, not the cumulative zero-gamma boundary (FIXED, tested)
- **Root cause:** `gex-cross-validation-core.ts:zeroGammaFlip` (Heat Map / positioning / intraday-adjust /
  odte-scope) picked the PER-STRIKE net-gamma sign crossing nearest spot, while `gammaFlipFromLadder`
  (reconstruct rail) and `gamma-desk.ts:computeGammaFlip` (SPX desk) used the CUMULATIVE zero-gamma crossing.
  On a net-short-across-the-book chain the per-strike path interpolates a spurious crossing below spot; the
  `spot >= flip ? "long" : "short"` posture in `computeGexRegime` then reads "long gamma" on a book that is
  short gamma everywhere. Evidenced by unit ladder {698:-2e9,700:-3e9,710:+1e8,720:+2e9,730:-1e8} @ spot 715:
  per-strike → 709.68 (→ "long"), cumulative → null (honest: no long-gamma regime).
- **Scope discipline:** `zeroGammaFlip` is ALSO the generic per-strike zero-level detector for the VEX flip and
  DEX/CHARM zero-levels (polygon-options-gex.ts:2395/2403/2414), where bidirectional per-strike crossing is the
  correct definition (a deliberate prior fix). So `zeroGammaFlip` was LEFT UNCHANGED; a dedicated
  `cumulativeGammaFlip` was added and wired to the four GAMMA sites only (gexFlip 2384, cross-validation
  gammaFlip, intraday `flipAdjusted`, odte-scope scoped flip). All surfaces now share one gamma-flip definition.
- **Live pre-validation (RTH 2026-07-21):** recomputed old-vs-new on 16 live ticker×horizon chains — the
  cumulative flip sits at spot (SPX/SPY/NVDA narrowed 0.00–0.29% from spot vs the old ~13pt-below-spot bias)
  and NEVER blanked. Unit tests: net-short→null (+ per-strike contrast), ±12% band rejection, <2 strikes→null.

### P3 — Third gamma-flip implementation (gamma-desk) folded onto the shared cumulative flip (FIXED, tested)
- **Follow-on to the 2026-07-21 flip unification.** `gamma-desk.ts:computeGammaFlip` (SPX desk + Nighthawk
  positioning, via `/api/market/gex-positioning`) was a THIRD cumulative flip impl that detected a cumulative
  sign change in EITHER direction plus terminal zero-touches (no plausibility band). It agreed with the
  heatmap flip on normal books but diverged on inverted/boundary profiles (e.g. [100:+8,110:-12]→106.67;
  [100:+10,105:0,110:-10]→110).
- **Fix:** `computeGammaFlip` now delegates to the shared `cumulativeGammaFlip` (convert ranked_levels →
  strike-total record). One gamma-flip definition across heatmap, SPX desk, reconstruct rail, and Nighthawk:
  net-short→net-long crossing nearest spot, ±12% band, null when the book never turns net-long. Behavior
  change is confined to inverted/net-short/boundary books (now null or the near-spot crossing instead of a
  long→short crossing / terminal zero-touch). Tests updated + net-short→null case added; gamma-desk suite 15/15.

## 2026-07-21 — SPX Slayer live CTO audit (99 samples, RTH) — fixes batch 1

Deep live audit of the SPX Slayer desk (poll every 15s, 18:54–19:35 UTC, cross-checked vs Polygon).
No P0: 0 correctness violations across 99 samples (above_flip, flip/maxpain band, SPX≈10×SPY 10.032–10.035,
price-vs-matrix ≤1.61pt). Cadence healthy (desk/matrix as_of advance ~every poll ≈5s). Beads forming
(wall-history 976→992). This batch fixes the two clean backend data-correctness findings.

### P1 — "GEX stale" pill never fired even at 3-min-old dealer gamma (FIXED, tested)
- **Root cause:** `spx-desk.ts` canonical desk-GEX path returned `gex_stale: false` HARDCODED while
  computing a real `gex_age_ms = now − pos.asof`. When the UW positioning snapshot lagged, the desk
  served stale GEX flagged as fresh. The fallback path derived staleness correctly, so the two paths
  disagreed. **Evidence:** live sample 19:08:25 had `gex_age_ms = 183,827` (183s, 6× the 30s
  `GEX_STALE_MS`) with `gex_stale:false`; 0/99 samples ever flagged stale.
- **Fix:** extracted `gexStaleFromAge(ageMs)` (pure, `spx-desk-numerics.ts`) = `age==null || age>GEX_STALE_MS`;
  both desk-GEX paths now derive `gex_stale` from it. Unit-tested incl. the exact 183,827ms case.

### P2 — /api/market/spx/pulse leaked unrounded floats (FIXED, tested)
- **Root cause:** `buildSpxDeskPulse` returned every numeric RAW; `buildSpxDeskFull` rounds via
  `roundDeskNum`. The header ribbon merges both lanes, so the pulse lane surfaced unrounded floats.
  **Evidence (every one of 99 samples):** `vwap 7500.4571055…`, `ema20 7490.6383…`,
  `lod 7467.860000000001`, `sma200 6994.99535…` (desk lane served these rounded). CLAUDE.md systemic
  "round at the data layer".
- **Fix:** `roundPulseNumerics(pulse)` (pure, `spx-desk-numerics.ts`) rounds all price-class fields to
  2dp; applied to the pulse result at return (after regime/above_vwap are computed from raw values, so
  no derived flag shifts). Unit-tested (rounds the live leak values; preserves nulls; price stays number).

### Deferred (logged, not in this batch)
- P2 `gap_pct` is not a gap in RTH — `gap-proxy.ts:resolveDeskGap` uses `gapFromPrice(current, prior)`,
  so it tracks live price and equals `spx_change_pct` (confirmed: changed 9× in 8 min in lockstep). NOT
  rendered on the SPX ribbon (backend field → lotto engine); fix needs the session-open price. Hold.
- P2/UX same concept, different number on one screen: ribbon flip (~7598, near-term aggregate) vs embedded
  chart flip (~7504, 0DTE); desk king 7600 vs 0DTE ladder king ~7515; ribbon EMA 20/50/200 vs chart EMA
  9/21/50. Needs scope labels / design decision.
- P3 flip level jitter (7578–7607, ±18pt on a 4pt-quiet tape — sensitive near the concentrated 7600 wall);
  consider display smoothing. TICK/TRIN/ADD estimated (`add` clamp) + not rendered. Matrix poll comment
  stale (says 8s/20s; actual 5s).

## 2026-07-21 — SPX Slayer audit fixes batch 2

### P2 — gap_pct was the live change, not a gap, during RTH (FIXED, tested)
- **Root cause:** `gap-proxy.ts:resolveDeskGap` RTH branch used `gapFromPrice(spx_price, prior_close)`
  — the LIVE price — so `gap_pct` drifted every tick and was identical to `spx_change_pct` (audit
  evidence: changed 9× in 8 min in lockstep). A gap is the OPENING dislocation, frozen at the open.
- **Fix:** `resolveDeskGap` now takes `rth_open` and, in RTH, computes the gap from the session open
  (frozen `sessionStatsFromMinuteBars(...).open`, first-bar open), falling back to spot only before
  the first bar prints. Threaded through both the desk (`session.open`) and pulse (added `open` to
  `PulseStructureCache`, populated from the same session stats → `structure.open`). Consumers (lotto
  engine) now get a true opening gap. Test: `gap-proxy.test.ts` 4/4 — proves the gap stays frozen as
  spot moves and is NOT the live change; null-open falls back; null prior → null.

### P2/UX — same concept, two numbers on one screen (FIXED — ribbon flip label)
- Ribbon γ-flip (near-term aggregate, ~7598) vs the embedded chart's 0DTE flip line (~7504) read
  differently; both are internally correct (different scopes). **Fix:** the ribbon flip tooltip now
  states its scope explicitly ("NEAR-TERM aggregate … the chart's flip line is 0DTE-scoped, so the two
  can read differently"). EMA/SMA are already period-labeled (20/50/200 vs 9/21/50), self-disambiguating.
  The matrix king already carries the multi-expiry disclaimer. Text-only, no layout risk.

### P3 — stale matrix-poll comment (FIXED)
- `SpxGexMatrixHeatmap.tsx` DeskProps comment claimed "8s RTH / 20s off"; actual is 5s in both
  (`SPX_MATRIX_POLL_RTH_MS === SPX_MATRIX_POLL_OFF_MS === 5000`). Comment corrected.

### Deferred with rationale (NOT forgotten)
- **P3 flip-jitter smoothing:** the flip jitters ±~15pt near a concentrated wall on a quiet tape. A
  server-side deadband is unreliable here — the desk value is cached 5s and served by any of 8+
  replicas, so there is no dependable "previous displayed flip" to hold against. Correct fix is
  CLIENT-side (the continuous SSE/SWR view owns a stable prior value) — a larger, separate change.
- **TICK/TRIN/ADD "wire real internals":** `market-internals.ts` computes these as PROXIES from
  adv/dec ("TICK-like reading", "TRIN proxy"); there is no real TICK/TRIN/ADD feed wired. They are
  already honestly flagged `internals_estimated` AND not rendered. So this is not a bug to fix —
  surfacing them requires integrating a real intraday internals feed (data-integration project),
  which should precede any UI. Left estimated-and-gated, as designed.

## 2026-07-22 — SPX Slayer bead rail: "too light" + thin semantics (P2, FIXED — full SPX audit)

### P2 — Wall/bead rail rendered too faint and encoded only ONE dimension three times
- **Symptom (member-reported):** beads "too light on rendering"; the rail "just paints" instead
  of representing wall dynamics.
- **Root cause:** in `src/features/vector/lib/vector-wall-visual.ts`, core opacity, bead size, and
  glow ALL keyed off the same frame-relative strength `t = (pct/maxPct)^REL_CONTRAST_EXP`, with
  `REL_CONTRAST_EXP = 2.0` (squared) and floor `ALPHA_MIN = 0.05`. A half-king wall therefore sat
  at t=0.25 → ~0.29 alpha (near-dead), and early-session modeled beads were ghosted to
  `MODELED_ALPHA_SCALE = 0.15` — the "too light" report. Absolute magnitude, growth/decay velocity,
  and death were not encoded at all (birth was; death was only a whole-trail dim).
- **Evidence:** live authenticated probe (SPX desk `/api/market/spx/pin` + `gex_walls`) confirmed
  per-strike shares in the 5–7% band so the frame-relative king is ~7% and secondaries fall to
  25–30% of it → the exact regime the squared curve crushes. Opacity math corroborated in
  `vector-wall-visual.test.ts`.
- **Fix (`vector-wall-visual.ts` + `VectorChart.tsx`):**
  - Brightness: new `REL_ALPHA_MIN = 0.14` floor for the bead rail (separate from the legacy
    absolute `ALPHA_MIN`, so absolute-path tests are untouched); `REL_CONTRAST_EXP 2.0 → 1.6`;
    `MODELED_ALPHA_SCALE 0.15 → 0.26`. Half-king wall now ~0.42 alpha.
  - New **absolute-magnitude glow channel** (`magnitudeGlowBoost`): a genuinely massive wall halos
    up to ~1.7× wider regardless of frame rank — magnitude gets its own voice, distinct from the
    (frame-relative) size/opacity, so the frame-contrast regression tests still hold.
  - New **growth/decay velocity channel** (`growthModulation`): a bead compares its share to the
    previous bucket — a wall being STACKED flares brighter+fatter, one bleeding out dims+narrows
    (capped so a single burst can't blow out). The rail now visibly breathes.
  - New **death dissipation halo**: the last bucket of a departed (inactive) wall gets a wide, dim
    ring so it reads as "dissolved here," completing the birth→build→fade→death lifecycle.
- **Tests:** `vector-wall-visual.test.ts` extended (brightness retune, growthModulation building/
  fading/neutral/cap, magnitudeGlowBoost monotonicity) — 23 pass; `tsc --noEmit` clean.
- **Status:** FIXED (branch `claude/wall-beads-data-validation-4re5wo`).

## 2026-07-22 — GEX matrix "built/melted" verb inverted on the put side (P2, FIXED)

### P2 — Shift leaders labeled build/decay by raw delta sign → building put walls read "melted"
- **Symptom:** in the Dealer Gamma Map shift strip + cell badges, a put wall that is actively
  BUILDING (its net dealer GEX going more negative) was labeled "melted" (and a decaying put wall
  "built"), and put-side % showed the wrong sign. Root of the user's "top-3 calls/puts don't look
  right" question.
- **Root cause:** `GexMatrixShiftBadge.tsx` / `GexShiftLeadersStrip.tsx` derived the verb from
  `delta > 0` and bucketed side by the leader's delta sign. For a put strike (negative net GEX),
  building means delta < 0, so `built = delta > 0` inverted it; and a melting put wall (delta > 0)
  was bucketed as a "call". The % came from `shiftPercentForStrike` (delta/|baseline|), whose sign
  follows the raw delta — correct on the call side, inverted on the put side. The arithmetic was
  fine; the SEMANTICS were wrong.
- **Evidence:** live desk screenshot showed puts as "-62% / -21% / -27%" (all melting) during a
  session where those put walls were building; audit of `shift-math.ts:4-8` (documents the
  delta-sign convention) + `GexMatrixShiftBadge.tsx:33` (`built = leader.delta > 0`).
- **Fix:** new `wallStrengthShift(currentValue, delta)` in `shift-math.ts` — compares |current| vs
  |baseline| so `built` = the wall's magnitude grew, side-agnostic, with the % signed by growth
  (+ heavier / − lighter), always consistent with the verb. Wired into both display components;
  side is now the strike's OWN net-GEX sign (`currentValue >= 0` → call/yellow) not the delta
  direction, so a melting put wall stays purple under P. `shiftPercentForStrike` left intact for
  any other consumer. Deeper follow-up (noted): move the side bucketing into `pickGexShiftLeaders`
  so Thermal/Vector surfaces inherit the same correction at the source.
- **Tests:** `shift-math.test.ts` extended (call/put build+melt, verb⇔sign consistency, guards) —
  12 pass; `tsc --noEmit` clean.
- **Status:** FIXED (branch `claude/wall-beads-data-validation-4re5wo`).

## 2026-07-22 — SPX 0DTE gamma flip fragmented across panels (P1, FIXED — data unification)

### P1 — Four independent gamma-flip engines; pin used a volume-poisoned SIGNED ladder
- **Symptom (member-reported, screenshot):** the gamma flip showed FOUR different values on one
  page — header Γ FLIP 7,600.71, Vector chart 7,524.02, EOD Pin Forecaster 7,513, Dealer Gamma Map
  "FLIP (0DTE)" ~7,531.5 — and two panels gave contradictory regime reads (chart "sitting ON the
  flip, undecided" vs pin "above the flip, long gamma").
- **Root cause:** every panel recomputes the flip independently with a different expiry scope /
  positioning basis / spot snapshot. Two are genuine bugs:
  1. **Pin forecaster (7,513):** `pinLadderAtSpot` (`spx-pin-forecast-core.ts:105`) built the SIGNED
     net-GEX ladder from `openInterest + max(0, dayVolume)`. Volume is UNSIGNED, so folding it into a
     signed cumulative zero-crossing poisons the sign — the exact regression the Vector 0DTE path
     documents (`vector-dte-walls-core.ts`: volume "dragged the flip from ~7,522 to ~7,000"). The pin
     re-committed it, dragging its flip ~11 pts off the chart's OI-only flip.
  2. **GEX matrix (7,531.5):** `SpxGexMatrixHeatmap.tsx:305` interpolated the 0DTE crossing at
     `matrixSpot` (the matrix payload's own, several-seconds-stale snapshot spot) instead of the live
     stream spot — a ~7 pt skew vs the chart.
  The header's 7,600 is a DIFFERENT measure (near-term 8–15 expiry aggregate) and is correctly
  labeled — not a bug.
- **Evidence:** cross-surface trace (SpxSniperHeader/spx-desk near-term aggregate vs
  getVectorGammaFlipForHorizon 0DTE OI-only vs pinFlip OI+vol vs matrix 0DTE column at stale spot);
  live authenticated probe confirmed pin.flip=7510.95 while chart flip ~7524 same instant.
- **Fix:**
  1. `pinLadderAtSpot` → **OI-only** (drop dayVolume from the SIGNED ladder). Walls (`oiWalls`) +
     max-pain keep volume — those are unsigned concentration measures where intraday build is signal.
  2. Matrix 0DTE levels → **`overlaySpot` (live)** instead of `matrixSpot` (stale snapshot).
  Result: chart, pin, and matrix converge on one SPX 0DTE gamma flip; header stays the labeled
  aggregate. First step of the broader "unify every SPX value" mandate.
- **Tests:** `spx-pin-forecast-core.test.ts` — new OI-only invariance test (lopsided put volume must
  not move the flip); 8 pass. `tsc --noEmit` clean.
- **Status:** FIXED (branch `claude/wall-beads-data-validation-4re5wo`).

## 2026-07-22 — Full GEX/VEX matrix table (feature — SPX desk)

### Dealer Gamma Map was truncated to 6 expiry columns; user wants the full table
- **Request:** show the complete GEX/VEX matrix (every expiry as a column), not the shortened rail.
- **Root of the truncation:** `SpxGexMatrixHeatmap.tsx` sliced columns to `MAX_EXPIRY_COLS = 6`
  (`displayExpiries = expiriesAll.slice(0, 6)`). The payload already ships the FULL expiry axis
  (near-term ≤15 + far-dated monthlies ≤8 ≈ 23 columns) in `cells` — the cut was purely client
  display, so no provider/fetch change is needed. Strikes were never client-truncated.
- **Fix (`SpxGexMatrixHeatmap.tsx`):**
  - Default to the FULL table (all expiries); a compact **Near/Full toggle** collapses back to the
    6-column rail (only shown when there are >6 expiries).
  - **Two-tier color peak** — far-dated monthly OpEx cells are orders of magnitude larger than
    near-term ones, so a single shared peak would wash the near-term block flat. Near-term and
    far-dated columns now each scale to their OWN peak (`nearPeak`/`farPeak`, split by
    `near_term_expiries`), so both blocks show gradient. The Net column (a near-term aggregate)
    keeps the near-term peak.
  - Added `near_term_expiries` to the client `GexHeatmapResponse` type (already served by the route
    via `...heatmap`; only the client type omitted it).
- **Known display caveat (documented, not a bug):** the "Net" column is the near-term aggregate
  per strike, so once far columns are visible it is not the sum of the on-screen cells — a labeled
  follow-up if members find it confusing.
- **Verification:** `tsc --noEmit` clean; brand lint clean.
- **Status:** DONE (branch `claude/wall-beads-data-validation-4re5wo`).

## 2026-07-22 — Header label collisions + VWAP tone/value split (P2, FIXED — consistency)

### P2 — "Regime" meant two things; max-pain horizon undisclosed; VWAP tone could contradict value
- **Symptom:** the desk "said different things" for the same label. (1) Header "Regime" pill = TREND
  (price vs EMAs) while the chart banner + EOD pin show GAMMA regime (spot vs flip) — one word, two
  concepts. (2) Header Max Pain = near-term aggregate while pin/chart use 0DTE — undisclosed (γ-flip
  had a disclosure, max-pain didn't). (3) VWAP pill TONE was driven by the raw pulse `above_vwap`
  flag while the VALUE/arrow use the sticky merged `desk.vwap` — when `pulse.vwap` momentarily nulls,
  a bear tone could paint over a VWAP drawn below spot.
- **Fix (`SpxSniperHeader.tsx`):**
  - Relabel the trend pill "Regime" → **"Trend"**, and expand its tooltip to explicitly contrast it
    with the gamma regime on the chart/pin — same word no longer implies the same measure.
  - Add the near-term-vs-0DTE horizon disclosure to the **Max Pain** tooltip (mirrors γ-flip).
  - Derive the VWAP **tone from the displayed value** (`spot >= desk.vwap`), falling back to
    `above_vwap` only when vwap is null — tone, arrow, and value can no longer disagree.
- **Rationale:** these are intentionally DIFFERENT concepts (daily trend vs gamma regime; near-term
  vs 0DTE), so the correct unification is precise labels, NOT forcing different measures equal (that
  would itself be wrong data). Verified `tsc --noEmit` clean.
- **Status:** FIXED (branch `claude/wall-beads-data-validation-4re5wo`).

## 2026-07-22 — EOD pin cone painted ZERO uncertainty at the bell (P2, FIXED — accuracy)

### P2 — Analytic confidence cone collapsed to a point (p10=p50=p90) at 16:00
- **Symptom:** the EOD pin forecaster's confidence cone pinched to a single point at the close,
  asserting perfect certainty the model hasn't earned (settlement/auction still moves the close).
- **Root cause:** in `medianPath` (`spx-pin-forecast-core.ts`), the diffusion sigma
  `spot·atmIv·√(tYearsRemain)` → 0 as time-to-close → 0, so the last cone step had
  `p10 = p50 = p90 = pin`. Verified LIVE twice via authenticated probe: `cone[last]` =
  `{tMin:0, p10:7517.74, p50:7517.74, p90:7517.74}` (and again 7518.13).
- **Fix:** floor the cone sigma at `CONE_RESIDUAL_FRAC = 0.12 ×` the session's OPENING sigma, so the
  cone stays honestly narrow into the bell instead of collapsing to a line. Kept under the ~15%
  confidence floor (so confidence still reads a hair tighter than the drawn cone) and well under the
  35% "cone pinches into the close" contract the tests assert.
- **Tests:** `spx-pin-forecast-core.test.ts` — the pinch test now also asserts the bell cone keeps
  non-zero width and stays ordered p10<p50<p90; 8 pass. `tsc --noEmit` clean.
- **Follow-ups (noted):** the MC diffusion ×tFracAt over-suppresses late-session noise; the
  trend-day degrade never fires live (recentReturns not passed) — both tracked for a later PR.
- **Status:** FIXED (branch `claude/wall-beads-data-validation-4re5wo`).

## 2026-07-22 — Commentary rail never announced a pin/max-pain migration (P2, FIXED — signal gap)

### P2 — 0DTE pin (max-pain magnet) drift was silent in the live commentary
- **Symptom (from the left-pane audit):** `detectSpxVoiceEvents` fired on γ-flip crosses, king-wall
  migrations, wall build/fade, VWAP, EMA, HOD/LOD etc., but had NO event for the max-pain (pin)
  magnet stepping — even though for a 0DTE desk a pin drifting into the close is exactly what a
  trader watches. Max pain surfaced only as a static "watch level," never announced when it moved.
- **Fix (`spx-live-voice.ts`):** new `pin-migrate` event kind. When `maxPain` steps ≥ one SPX strike
  (`MAXPAIN_STEP_MIN = 5`) between snapshots, the rail emits `◎ pin 7,500→7,510 — max-pain magnet
  stepped UP → close-drift target higher` (bull on up-step, bear on down-step). Sub-strike jitter is
  suppressed; the existing per-key cooldown dedupes repeats.
- **Tests:** `spx-live-voice.test.ts` — up-step (bull), down-step (bear), sub-strike jitter ignored;
  53 pass. `tsc --noEmit` clean.
- **Related gap noted (not fixed here):** the `rsi` event kind is dead on the live rail (the desk
  feed carries no `rsi`, so overbought/oversold never fires) — a follow-up (wire RSI or remove).
- **Status:** FIXED (branch `claude/wall-beads-data-validation-4re5wo`).

## 2026-07-22 — EOD pin projected close + band drawn ON the price chart (feature)

### Move the EOD pin onto the chart (user chose "on-chart cone + slim panel")
- **What:** the SPX Vector chart now draws the EOD pin's **projected 0DTE close** as a solid gold
  price-line + the **pin band** edges as dashed gold lines, in price space next to the candles —
  the 0DTE close-target a trader watches, no longer only in the side panel.
- **Implementation (`VectorChart.tsx`):** `applyPinProjection` mirrors the proven
  `applyExpectedMoveBand` (idempotent signature ref; `createPriceLine`; cleared when disabled). A
  new effect **gated to `ticker === "SPX"`** self-fetches `/api/market/spx/pin` at the 5s desk
  cadence (one fetch off-hours) and repaints via `paintOverlays`; `/vector` and other tickers never
  fetch or draw it. Refs cleared on the same ticker-change teardown as the expected-move band.
- **Scope:** the *levels* (close + band) ship now via the battle-tested price-line infra; the shaded
  time→close **cone** is a follow-up (needs a canvas primitive). Panel-slimming (drop the redundant
  levels, keep why/scenarios) is a follow-up too — the on-chart lines are additive for now.
- **Validation caveat:** this is a client-canvas change; it CANNOT be pixel-verified from the
  sandbox (headless browser egress is blocked — proven: ERR_CONNECTION_RESET to example.com; and the
  CI screenshot path needs a repo CLERK secret that isn't set). Logic is typecheck-clean and reuses
  proven infra (worst case is a cosmetic misplacement, never a broken chart). Needs a glance on the
  deployed build.
- **Verification:** `tsc --noEmit` clean; brand lint clean.
- **Status:** DONE (levels); cone + panel-slim = follow-ups. Branch `claude/wall-beads-data-validation-4re5wo`.

## 2026-07-22 — Pinned bias prose named stale walls after a king migration (P3, FIXED)

### P3 — Bias card kept citing an old king wall for up to 5 min after it stepped
- **Symptom (left-pane audit item A):** the pinned bias narrative bakes specific wall/pin numbers
  into prose ("7,530 put wall is the line…"), but `deriveSpxBias.key` excluded the king-wall strikes
  and max-pain, so the card only re-voiced on a direction change or the 5-min periodic refresh. After
  a king migration the "Recent shifts"/tape feed showed the move while the pinned paragraph kept
  naming the OLD wall — internally contradictory on the same card.
- **Fix (`spx-live-voice.ts`):** add the king call/put strikes + max-pain to the bias key, so the
  pinned card re-voices the moment a NAMED level migrates (still not on plain price ticks — those
  aren't in the key). It's a re-voice trigger, not a bias flip (direction/conviction unaffected).
- **Tests:** `spx-live-voice.test.ts` — key changes on king-call + max-pain migration, direction
  unchanged, price-tick invariance still holds; 54 pass. `tsc` clean.
- **Status:** FIXED (branch `claude/wall-beads-data-validation-4re5wo`).

## 2026-07-22 — SPX desk: 4-panel layout (EOD pin own rail) + drop chart max-pain line (member-directed)

### Layout — EOD pin split into its own 4th panel so the matrix gets full height
- **Request:** "4 panels with EOD pin forecaster as the new panel so we can get full view of the
  matrix table"; and "remove the Max Pain from the chart, not needed".
- **Change:**
  - `SpxDashboard.tsx`: the `SpxPinForecast` was stacked UNDER the matrix in the same column,
    squeezing the (now full) Dealer Gamma Map. Split it into its OWN `aside.spx-left-pin` rail.
    Desk is now **Largo | Matrix | EOD Pin | Vector** (4 rails); the matrix gets the full column
    height. On the compact/iOS shell the pin rides the "matrix" segment (kept together there).
  - `globals.css`: `desk-v3` grid → 4 columns `"largo matrix pin vector"` (chart still the widest,
    minmax(0,…) so the canvas shrinks — no h-overflow); focus mode → 4 tracks (3 rails collapse,
    chart fills); new `.spx-left-pin { grid-area: pin }` + desk-fill height rules.
  - `VectorChart.tsx`: removed the amber "⊗ Max Pain" price line (`applyMaxPainLine(..., null)`);
    the value is kept in `maxPainValueRef` so it still feeds the confluence zone stack.
- **Verification:** `tsc --noEmit` clean. Client-canvas/layout change — needs a look on the deployed
  build (will capture via spx-live-check). Stylelint pre-existing error at :7945 is unrelated.
- **Status:** DONE (branch `claude/wall-beads-data-validation-4re5wo`).

## 2026-07-22 — On-chart pin → Monte-Carlo source + relax over-tight MC diffusion (member-directed)

### The on-chart pin now uses the Monte-Carlo projection; MC late-session cone widened to be honest
- **Request:** "do the monte carlo EOD pin so it looks like a curve on chart instead of the analytic
  one"; and the conceptual Q: do analytic & MC give the same pin? (Usually yes — both pull to the
  dominant magnet — but MC diverges when the close distribution is bimodal, which is the point of MC.)
- **Changes:**
  - `VectorChart.tsx`: the on-chart pin line + band now read `montecarlo.pin` / `montecarlo.pinBand`
    (empirical modal close + band), falling back to the analytic base when the MC overlay is absent.
  - `spx-pin-forecast-core.ts`: relaxed the MC Brownian-bridge diffusion — was `× tFracAt`, which
    drove step variance to ~0 at the bell (on top of √dt) and manufactured an over-tight MC cone /
    over-confident pin. Now `× (MC_BRIDGE_NOISE_FLOOR=0.35 + 0.65·tFracAt)`, so late-session
    settlement noise stays real (the MC analogue of the analytic cone-floor fix). Verified: the MC
    cone still narrows from its mid-session bulge (51.6→45.2, 0.88×) instead of collapsing to a thread.
- **Tests:** MC test updated to assert the cone narrows from the peak AND keeps honest residual width
  (>0.5× max); 8 pass. `tsc` clean.
- **Follow-up (next PR):** the SHADED time→16:00 converging cone as a canvas primitive (needs future
  whitespace so it maps past the last candle) — this PR does the levels + honest width.
- **Status:** DONE (levels + width). Branch `claude/wall-beads-data-validation-4re5wo`.

## 2026-07-24 — [HIGH] index-option underlying spot dropped in batched snapshot mapper — FIXED

**Severity HIGH** (real-money valuation surface): `OptionSnapshot.underlyingPrice` was `null` for
EVERY index-option OCC (SPX/SPXW/NDX/RUT/VIX) valued through the batched `/v3/snapshot` path.

**Root cause.** `mapUnifiedSnapshotResult` (`src/lib/providers/options-snapshot.ts:180`) read the
underlying spot ONLY from `underlying_asset.price`. Massive/Polygon returns the underlying for INDEX
OCCs under `underlying_asset.value` (an index has no trade "price", only an index value); only STOCK
OCCs use `.price`. So every index-option row got `up = finiteOrNull(undefined) = null` → spot null.

**Fix.** Read `underlying_asset.price ?? underlying_asset.value` (type widened to include `value?`).
Still `null` when neither is finite — never fabricated. **Blast radius:** the only real consumer of
`underlying_asset` for spot is this mapper. `polygon-options-gex.ts` declares `underlying_asset?.price`
on `ChainContract` but NEVER reads it for spot (the chain path gets spot from `resolveSpotSnapshot`),
so no second call site to fix — noted for completeness.

**Adjacent [LOW] — IV unit inconsistency.** Provider `implied_volatility` is a decimal for live rows
(0.229) but sometimes a percent-scale placeholder on expired/edge rows (20, 15.83). Added a
conservative, opt-in `normalizeImpliedVol()` consumer guard (rescales only values >= `IV_DECIMAL_MAX`
= 5 / 500%, a bound no real decimal vol reaches; live decimals pass through UNTOUCHED). The mapper
still stores the RAW value verbatim so nothing is lost.

**Evidence / tests.** Extended `options-snapshot.test.ts`: index OCC with `.value` (no `.price`) →
`underlyingPrice` is the value; stock OCC with `.price` still resolves; neither present → null; plus
the IV guard cases. `npx tsx --test` 15/15 pass; `tsc --noEmit` clean; `check-brand.mjs` clean.

**Status:** DONE. Branch `fix/index-option-underlying-value`.

---

## 2026-07-24 — Night Hawk SWING (2–30 DTE) engine BUILT end-to-end (16 PRs)

**Severity:** N/A (feature build, not a defect). **Status:** DONE.

The full Swing lane shipped as a 16-PR dependency-ordered sequence (`docs/audit/SWING-ENGINE.md` §4),
redesigned around a multi-session thesis rather than a stretched 0DTE engine (operator directive):
- **PRs #1032, #1033, #1035, #1036** (Phase 0) — canonical taxonomy (8 archetypes × 3 sub-lanes), 7-pillar
  archetype-weighted scorer, archetype classifier + canonical `SwingDossier`, 0.50–0.75Δ directional contract ranker.
- **#1037, #1038, #1039, #1040, #1041** (Phase 1) — management state machine (underlying-thesis-primary),
  multi-truth grader, gate stack + setup-state + entry-model + theme-cluster, 7-section serving router,
  risk math + advisory allocation (caps 5%/20%/40%/max-3-same-week as % of member book, `enforce:false`).
- **#1042** (ledger) — `swing_positions` (roll chain + first-write-wins pinning + monotonic status),
  `swing_position_snapshots` (append-only), `swing_candidate_accumulation`.
- **#1043, #1044, #1045, #1046** (feature store, discovery, serving lane, cron/WS) — longitudinal feature
  vector + roll-chain-aware record, whole-market two-tier discovery + persistence-gated WATCH, `?view=swings`
  live desk, phase-anchored cron + active-refresh snapshots + UW WS accumulation hook.
- **#1047, #1048** (calibration, roll) — 7 distinct graduation wrappers over the reused `recommendSignal`
  ladder, transactional close+grade+link roll execution (preserve-parent-loss, all-or-nothing guard).

**Discipline:** every stage is evidence-only until its archetype×sub-lane bucket graduates (n≥10, Δ≥15pt);
`commitEligibleCount` held at 0 (WATCH-only rail); cron/WS writes are accumulation + snapshots only (no
position commits). PR-4 shipped a fixture regression (10 horizon tests encoded the old 0.35Δ swing stance)
caught in CI and fixed; two CodeQL nits (self-assignment, unused import) caught + fixed in-flight. Every PR
verified `tsc --noEmit` + full swing/horizon suite + `check-brand.mjs` before merge. The 0DTE HOLDs #1028
(aggression floor) and #1031 (governor-txn) remain parked as drafts (operator validates).

## 2026-07-24 — [MED, correctness] gex-positioning WS wall override summed ALL expiries (far-OpEx walls next to near-term flip) — FIXED

**Severity MED (RTH-only wrong key levels on the desk-terminal/positioning surface; no capital path).**
`getGexPositioning` publishes the canonical call/put wall consumed by the desk terminal, Largo and
Night's Watch via `/api/market/gex-positioning`.

**Root cause — an unscoped ladder call.** When the UW `gex_strike_expiry` WS channel is live (RTH),
`gex-positioning.ts` (~L153-159) OVERRODE the near-term Polygon walls with a WS ladder summed over
**every expiry** — it called `getGexStrikeExpiryLadder(root)` with **no `allowedExpiries` argument**:
```ts
const wsLadder = getGexStrikeExpiryLadder(root);   // ALL expiries — BUG
```
`base.flip` and the cross-validation oracle (~L177) are BOTH scoped to `resolveNearTermExpiriesFor
CrossValidation(hm)` (Polygon's near-term-only set), but the wall override was not. So the call/put
wall snapped to a far monthly/quarterly OpEx strike (larger all-expiry magnitude) hundreds of points
from the near-term flip — internally inconsistent walls-vs-flip on the surface, and the cross-val
warned `divergence=505/535pt vs UW strike ladder` every few seconds during RTH. Off-hours the WS
channel is idle (`hasLiveGexStrikeExpiry` false) so the override never fired and walls were correct —
which is why it only showed live.

**Why it wasn't caught:** the only test for this file exercised the pure `gexPositioningFromHeatmap`
mapper, never `getGexPositioning`'s live-WS override seam. The Vector CHART walls were already correct
(a different, DTE-scoped ladder path); only this gex-positioning/desk surface was affected.

**Fix (`gex-positioning.ts`, one line of substance):** resolve the near-term expiry set ONCE and pass
it to BOTH the override and the oracle:
```ts
const nearTermExpiries = resolveNearTermExpiriesForCrossValidation(hm);
const wsLadder = getGexStrikeExpiryLadder(root, nearTermExpiries);
```
`getGexStrikeExpiryLadder(ticker, allowedExpiries?)` already filters by expiry (proven in
`gex-strike-expiry-ladder.test.ts`) — the bug was purely not passing the scope. Only the expiry SCOPE
changes; the 5s WS-freshness benefit is retained. Also demoted the per-call cross-val `console.warn`
(fired on `div > 5` nearly every call, ~few-sec spam during RTH) to `console.debug` UNLESS a WALL
actually mismatched — a flip-only residual (Polygon zero-gamma interpolation vs UW per-strike ladder,
within ±2 tolerance) is a known methodology gap, not a data bug.

**Evidence/verify:** new `getGexPositioning` test wires a live WS ladder with near-term walls at
6050/5950 (±50 from spot 6000) AND far-OpEx walls at 6500/5500 (±500, 50× magnitude); asserts the
override picks the near-term pair. Proven to FAIL on the old unscoped call (`actual: 6500`) and PASS
on the fix (`6050`). `tsc --noEmit` clean; all 77 `src/lib/providers/gex*.test.ts` pass;
`check-brand.mjs` clean. Files: `src/lib/providers/gex-positioning.ts`,
`src/lib/providers/gex-positioning.test.ts`. Status: FIXED, branch
`fix/gex-positioning-walls-nearterm-scope` (PR to main).

## 2026-07-24 — [SEV-3, swing pre-live] SECTOR_ROTATION mislabeled on coarse name-vs-SPY RS; wired a real INDUSTRY-GROUP RS feed — FIXED (WIRED, not skipped)

**Context / risk.** Swing lane is pre-live (WATCH-only, `commitEligibleCount` ≡ 0 — nothing sizes
risk), so live blast radius is nil. Operator directive: *"Industry-group RS data feed → so
SECTOR_ROTATION stops mislabeling on coarse SPY RS. — if our current apis don't provide these
details, skip it fully .. but check closely."* Branch `fix/swing-sector-rotation-rs`.

**DECISION: WIRED (the data IS obtainable, live-probed).** The "check closely" step confirmed both
providers ground industry-group membership AND its relative performance, cheaply — so per the directive
this was wired, not skipped.

**Root cause.** `archetype.ts` `fitSectorRotation` was `blend(sectorLeadership01, relStrength01)`, but
`sectorLeadership01` was **never grounded** by `assembleSwingDossierInput` (swing-ingest.ts) — the
`archetypeExtras` it built omitted it. So the fit collapsed to `relStrength01` alone, which
`archetypeInputsFromReads` computes as `relativeStrengthScore(returnPct10d, spyReturnPct10d)` — the
name's return **vs SPY**. A rotation thesis is only real when a name LEADS ITS OWN INDUSTRY GROUP; vs
SPY, in any broad rally almost everything beats SPY, so SECTOR_ROTATION attached to tape-riders, not
rotation leaders. It was flagged blocked-on-data by `ARCHETYPE_META.SECTOR_ROTATION.provisionalUntilIndustryRs`
(taxonomy.ts) awaiting exactly this feed.

**API evidence (live probes, 2026-07-24, `env -u AWS_*`).**
- Polygon `GET /v3/reference/tickers/{ticker}` → 200 with `sic_code` + `sic_description` (rate-limit-free
  reference; `fetchPolygonTickerDetails`). NVDA/AMD → `3674 SEMICONDUCTORS & RELATED DEVICES`; JPM →
  `6021 NATIONAL COMMERCIAL BANKS`; PLTR → `7372 PREPACKAGED SOFTWARE`; NEM → `1040 GOLD AND SILVER
  ORES`; DAL → `4512 AIR TRANSPORTATION`; AAPL → `3571 ELECTRONIC COMPUTERS`; NEE → `4911 ELECTRIC
  SERVICES`. (XOM returned no SIC; SMH/XLK/SPY are `type:"ETF"` with no SIC — used as the ETF/self guard.)
- UW `GET /api/companies/{t}/profile` → 200 `{ sector:"TECHNOLOGY", industry:"SEMICONDUCTORS", … }`;
  `GET /api/stock/{t}/info` → 200 `{ sector:"Technology", uw_tags:["semi","gaming"], … }`;
  `GET /api/market/sector-etfs` → 200 (11 sector ETFs' OHLC); `GET /api/group-flow/{g}/greek-flow` 422
  leaked the valid group slugs (`…, semi, silver, technology, uranium, …`). UW gives membership too,
  but Polygon SIC is finer + rate-limit-free, so it's the classifier.
- Benchmark ETF closes (SMH/XLK/KBE/…) fetch on the SAME `/v2/aggs/.../range/1/day` path the swing
  name-closes already use (SMH → 200, `c` present) — so the RS denominator is one cacheable extra fetch,
  not a new pipeline.

**Construction (name RS vs its INDUSTRY GROUP, not SPY).** New pure `src/lib/swing/industry-group-rs.ts`:
`resolveGroupBenchmark` maps finest-first — exact-SIC **industry** ETF (SMH/KBE/IGV/GDX/JETS/XOP/XHB;
high-confidence only) → SIC-range **sector** ETF (the 11 SPDRs) → static sector-map label → null (honest
absence). `industryGroupRs01` = the name's N-session return vs that benchmark's, direction-signed exactly
like the SPY rel-strength pillar (so a SHORT leading its group DOWN mirrors its LONG), reusing
`relativeStrengthScore`. Guards: an ETF candidate or a self-benchmark (candidate IS the ETF) → null.

**Wiring (fail-soft, in-pattern with PR #1069's optional deps).**
- `swing-ingest.ts`: `SwingIngestDeps` gains optional `fetchTickerClassification` (Polygon SIC).
  `ingestSwingReads` resolves the benchmark + fetches its closes (only for a directional flow name — the
  RS is direction-signed), passes `groupCloses` to `assembleSwingDossierInput`, which grounds
  `sectorLeadership01 = industryGroupRs01(…)` into `archetypeExtras`. Any hiccup ⇒ null benchmark/closes
  ⇒ null signal ⇒ SECTOR_ROTATION simply doesn't fire (never a SPY-RS mislabel).
- `archetype.ts`: `fitSectorRotation = blend(sectorLeadership01)` **only** — `relStrength01` (vs SPY) is
  removed from the fit AND from `ArchetypeInputs`. The REL_STRENGTH *pillar*'s own SPY comparison is
  untouched; only the archetype LABEL stops keying off SPY RS.
- `swing-discovery/route.ts`: wires `fetchTickerClassification` from `fetchPolygonTickerDetails`; memoizes
  per-scan closes so a semis-heavy scan fetches SMH once, not once per name.
- `taxonomy.ts` / `swing-archetype.ts`: the `provisionalUntilIndustryRs` blocked-on-data marker is now
  RESOLVED (the feed shipped) — no archetype carries it; SECTOR_ROTATION stays a valid enum, graduates on
  its bucket like every other archetype.

**Evidence the fix changes the label (shipped functions, REAL data — SPY RS vs industry-group RS, LONG):**
```
name  benchmark(kind)   spyRS   groupRS   sic  | industry
NVDA  SMH(industry)     0.152   1.000     3674 SEMICONDUCTORS   (leads semis; SPY RS under-rated it)
AMD   SMH(industry)     0.000   0.334     3674 SEMICONDUCTORS   (SPY RS: no leader → actually leads group)
JPM   KBE(industry)     1.000   0.604     6021 BANKS            (SPY RS overstated the lead)
DAL   JETS(industry)    0.000   0.519     4512 AIRLINES         (SPY RS: no leader → clearly leads airlines)
NEE   XLU(sector)       0.662   0.000     4911 ELECTRIC         (THE mislabel: hot sector → beats SPY, LAGS group)
XOM   XLE(sector)       1.000   0.752     ---- (no SIC)         (static-map fallback works, fail-soft)
```
NEE is the exact false-positive the operator flagged (rides a hot sector → high SPY RS, but 0.000 within
its own group); AMD/DAL are false-negatives SPY RS missed. The classifier now sees within-group leadership.

**Tests.** New `industry-group-rs.test.ts` (resolver tiers, ETF/self/null guards, RS sign-symmetry). New
`swing-ingest` tests (SIC→industry benchmark grounds `sectorLeadership01`; classifier-outage → static
sector fallback; unclassifiable → null signal + no extra fetch). New `archetype` test (SECTOR_ROTATION
grounds ONLY on `sectorLeadership01`, never SPY RS). Updated fixtures/symmetry + the taxonomy marker test.
`npx tsc --noEmit` clean; `node --import tsx --experimental-test-module-mocks --test src/lib/swing/*.test.ts`
= **315 pass / 0 fail**; `node scripts/check-brand.mjs` clean. Files: `src/lib/swing/industry-group-rs.ts`
(+ test), `src/lib/swing/archetype.ts` (+ test), `src/lib/swing/swing-ingest.ts` (+ test),
`src/lib/swing/taxonomy.ts` (+ test), `src/lib/swing/swing-archetype.ts`,
`src/app/api/cron/swing-discovery/route.ts`. Status: FIXED, branch `fix/swing-sector-rotation-rs`
(NON-DRAFT PR to main, no auto-merge per operator directive).
## 2026-07-24 — [7-fix cluster] 0DTE grading + track-record HONESTY — FIXED (deploys AFTER close)

The reported 0DTE record must reflect the exit the member actually trades, and every number
must be internally consistent. Seven root causes, one branch (`fix/zerodte-grading-record-honesty`).
These change REPORTED numbers → **deploy AFTER market close** (no auto-merge).

**Fix 1 (SEV-2, biggest) — record graded a PHANTOM mechanical plan, not the executed exit.**
Production grades only the fixed −50/+100/15:30 plan (`plan.ts` `gradePlanFromBars`, surfaced by
`record.ts`), IGNORING the exit engine (ratchet / thesis-break / flat-timeout / plan stop-or-target)
the member is live-guided by (`exit-engine.ts` via `syncLedgerLiveState`) whose realized exit is
already stamped at `entry_context.exit` (`exit-sync.ts:174-182`). A member ratcheted out green at
+22% had it booked −50%. **Fix:** dual-track in `record.ts` — the HEADLINE is now the AS-MANAGED
grade (`managedGradeView`: the stamped engine exit, falling back to the mechanical grade when no
engine exit fired), with the mechanical plan grade kept as a labeled comparison (`ZeroDteRecord.mechanical`).
Per-play carries `managed_outcome/managed_pnl_pct/managed_source` beside `plan_outcome/plan_pnl_pct`.
When no engine exit fired, as-managed == mechanical → the clean path (incl. the 7/13 1W/7L fixture)
is unchanged. Threaded through `track-record-page.ts`.

**Fix 2 (SEV-3) — card vs grade resolved a within-bar stop+target tie OPPOSITELY.** `plan.ts`
`gradePlanFromBars` is stop-first (pessimistic) on a same-bar tie; `derivePlayStatus` is peak-first
(a target touch is a STICKY TRIM — the guarded "already-doubled stays TRIM" P0 test). A member saw a
TRIM; the mechanical record booked −50%. The peak-first card is a DELIBERATE, guarded design, so this
is resolved per the "document + make the reported record match what was shown" path: both functions
now cross-document the intentional divergence, and the member-facing record is the AS-MANAGED grade
(Fix 1) — a trimmed/target play books the engine's WIN, matching the card, while the mechanical −50%
stays only as the labeled comparison. Test: a TRIM-shown row books a headline win, mechanical loss.

**Fix 3 (SEV-3) — grade used a flow-fill basis up to +34% BELOW the achievable mark.** `plan.ts:81`
`entryMax = flowAvgFill ?? mark`; `CHASE_PCT=35` keeps IN_RANGE while the mark runs +34% over the
fill. The graded entry/stop/target were pinned to the smart-money's cheaper fill — a price a member
arriving at flag time can't get → flatters WR. **Fix:** `resolveLedgerEntryPremium` takes the
flag-time mark and FLOORS the graded basis at it (raises only UP toward the mark, never below
entry_max); `scan.ts` threads `s.plan?.mark` (pinned first-write-wins by the upsert). The
member-facing entry_max/stop/target (the don't-chase instruction) are untouched — only the ledger
basis moves. Test: mark 5.20 > fill 4.20 flips a phantom "doubled" (off 4.20) into the honest
"stopped" (off 5.20) through `gradePlanFromBars`.

**Fix 4 (SEV-4) — breakeven booked as a loss; flat close a directional miss.** `record.ts:102`
`isZeroDteWin = pnl > 0` lumped exact-0 into losses (`losses = graded − wins`). **Fix:** added a
`breakeven` bucket (pnl exactly 0 → neither win nor loss), `losses = graded − wins − breakeven`,
`win_rate = wins/graded` — SPX 3-way parity (`wins+losses+breakeven == graded`). Also
`computeLedgerGrade` (`board.ts`) `direction_hit: signed > 0` booked a dead-flat close (signed===0)
as a `false` miss; now `signed>0 ? true : signed<0 ? false : null` (flat = no directional edge).

**Fix 5 (SEV-4) — win predicates keyed on different columns.** `isGradedZeroDteRow` read
`plan_outcome`; `isZeroDteWin` read `plan_pnl_pct`. A partial write (outcome set, pnl NULL) counted
as graded-but-not-a-win → a phantom loss. **Fix:** `isGradedZeroDteRow` now ALSO requires a finite
`plan_pnl_pct`, so the two can never disagree (calibration.ts inherits the fix — single source).

**Fix 6 (SEV-4) — track-record verifier miscounted `superseded`.** `track-record-verifier.ts:94`
kept `superseded` in `closedRows`, but the served path (`computePlayOutcomeStats`:
`outcome !== 'open' && !== 'superseded'`) excludes them → false L1/L2 + hit-rate FLAGs on a healthy
ledger whenever any superseded rows existed. **Fix:** exclude `superseded` to match the served
"closed" definition. New `track-record-verifier.test.ts` (proven fail-before / pass-after).

**Fix 7 (SEV-4) — index-root empty bars → PERMANENT null grade.** `scan.ts` `gradeZeroDteLedger`:
a known index root whose mapped `I:` symbol returns ZERO daily bars (transient provider gap) got
`close=null` → stamped graded with a null direction FOREVER (`graded_at` removes it; only THROWN
fetches retry, not empty results). **Fix:** empty bars for a KNOWN index root (`INDEX_OPTION_ROOTS`)
are a RETRYABLE non-grade (leave ungraded, mirror the throw path); equities unchanged (a real gap).

**Evidence/verify:** `tsc --noEmit` clean; `check-brand.mjs` clean; the full target suite
(`src/lib/zerodte/*.test.ts src/lib/*record*.test.ts src/lib/correctness/*.test.ts`) 549 pass
(+13 new, one per fix, each fail-before / pass-after). Files: `src/lib/zerodte/{plan,record,board,scan}.ts`,
`src/lib/track-record-page.ts`, `src/lib/correctness/track-record-verifier.ts` (+ their tests).
**Status:** DONE — PR to main, **HOLD for after-market-close deploy** (changes reported numbers), NO auto-merge.

## 2026-07-24 — [SEV-2, real-money gate] 0DTE firewall: five safety protections FAILED OPEN under provider stress — FIXED (Phase 0, `fix/zerodte-firewall-fail-closed`)

**Class.** The live 0DTE commit stack (scan → board evidence gates → G-1..G-11 → Cortex) had several
protections that silently degraded to a PASS exactly when their input was unavailable — i.e. on the
volatile/stressed days they exist for. Pure risk-reduction; NO strategy/scoring/discovery change. Each
fix is conservative (blocks only when a present value could actually have fired the gate → no spurious
empties) and env-overridable.

1. **Cortex veto-blindness → ABSTAIN-pass (the #1 leak).** `evaluateCortexForCommit` degraded a total
   Cortex outage to ABSTAIN → commit on gates alone. The ONLY two veto-capable sources are `gex-walls`
   ("dealer wall in your path") and `flow-quality` ("opposing $1M cluster"). If BOTH failed to read the
   commit went in blind to every hard-block reason. **Fix:** `cortex-gate.ts` `assessCortexVerdict` gains
   an opt-in `failClosedOnVetoBlind` — when BOTH `VETO_CAPABLE_SOURCES` (new centralized const in
   `nighthawk/cortex/types.ts`) are absent it returns a new `VETO_BLIND` HOLD (block code
   `cortex_veto_blind`), NOT a pass. ≥1 veto source answering keeps prior behavior. **Opt-in scopes it to
   0DTE fresh commits** (`scan.ts` passes it) — SPX engine + exit engine pass it off, so they are
   byte-for-byte unchanged (proven by their green suites).
2. **G-4 VIX fail-open.** null day-open VIX (best-effort `within(...,2500)` timeout) = "no G-4 verdict" =
   free pass. **Fix:** `gates.ts` blocks `vix_unavailable` when scan signals `vixUnavailable` AND a present
   VIX could have blocked (non-index single name, or non-tape-aligned index/ETF below the 75 elevated
   floor). Index/ETF clearing the floor is NOT blocked. Env: `ZERODTE_G4_FAIL_CLOSED=0` to disable.
3. **G-7 macro fail-open.** A FAILED macro-calendar fetch (`.catch(()=>[])`) was indistinguishable from
   "zero events" → CPI/FOMC/NFP hard-block silently disabled. **Fix:** scan preserves null (failed) vs []
   (zero events); `gates.ts` blocks `macro_unavailable` only on a genuine fetch failure. Env:
   `ZERODTE_G7_FAIL_CLOSED=0`.
4. **Far-OTM lotto had no cap.** `board.ts` moneyness gate only bounded ITM; far-OTM lotto stacks passed.
   **Fix:** new `SETUP_MAX_OTM_PCT` evidence gate (code `max_otm_pct`), default 12% (env
   `ZERODTE_SETUP_MAX_OTM_PCT`) — egregious only; normal 2-5% OTM momentum untouched.
5. **G-11 halt/earnings no-op'd for ranks 6-10 AND the whole cron commit path had no earnings.** Only the
   top-5 got a dossier (halt), and `warmZeroDteBoard`→`scanZeroDteBoard()` passes NO earnings flags, so
   earnings never reached the commit path at all. **Fix (lower-risk of the two options):** `scan.ts`
   `attachGateVerdicts` now fetches cheap batch halt (in-memory UW store, `failClosedOnStale:false` to
   mirror the dossier and avoid a naturally-quiet-channel empty) + earnings (one cached market-wide
   snapshot) for EVERY fresh candidate and feeds them to G-11, so no halted/earnings-today name commits
   regardless of rank. Fail-closed-on-unknown was rejected because it would blank ranks 6-10 wholesale.
6. **Stale comment** in `gates.ts` claiming "missing/stale gate inputs block a NEW commit" is now true for
   VIX/macro — comment updated to match.

**Evidence/verify:** `tsc --noEmit` clean; `check-brand.mjs` clean; `src/lib/zerodte/*.test.ts` = 512 pass
(+13 new across cortex-gate/gates/board/scan, each fail-before/pass-after); cortex core+sources (116),
SPX play-engine + cortex-read (33), pane/replay/board-component (60) all green (shared-module regression
guard). Files: `nighthawk/cortex/{types,index}.ts`, `zerodte/{cortex-gate,gates,board,scan,pane}.ts`.
**Status:** DONE on branch — pushed, **NO PR / NO merge** (user reviews the diff first).

---

### 2026-07-27 — G-8 chase guard (CHASE_PCT) too tight for 0DTE gamma

**Severity:** HIGH (board-emptying — sole blocker on the day's best setup)

**Root cause:** `CHASE_PCT = 35` in `plan.ts` sat inside normal 0DTE intraday gamma noise.
A 0.2% underlying move swings an ATM 0DTE option premium 30–50%, so the "already happened"
threshold was trivially crossed by routine price action. The value had no empirical calibration.

**Evidence:** 2026-07-27 live board — SPXW short, score 77, triple confluence (the strongest
gate profile possible), blocked **solely** by `plan_moved` at `vs_flow_pct = 54%`. This was
the only viable play on the board; the other two (QQQ score 48, GOOGL score 26) were correctly
blocked by 5 gates each (tape_alignment, score_floor, confluence_floor, vix_elevated,
intraday_conflict). Result: zero commits, zero ledger rows, empty board all session.

**Fix:** `CHASE_PCT` raised from 35 → 55 (`plan.ts:25`), now exported and env-configurable
via `ZERODTE_CHASE_PCT`. `gates.ts` imports the dynamic value instead of hardcoding 35.
The achievability floor (`resolveLedgerEntryPremium`) independently handles grading honesty
by flooring at the flag-time mark, so the wider IN_RANGE band does not flatter the win rate.

**Blast radius:** `plan.ts` (threshold), `gates.ts` (import + dynamic message/threshold),
`board.test.ts` (comment). No other consumers. Grading path unchanged.

**File:line:** `src/lib/zerodte/plan.ts:25`, `src/lib/zerodte/gates.ts:782`
**Status:** PR #1150 — CI pending.

---

### 2026-07-27 — Discovery engines silently OFF: flags default OFF, not set in infra

**Severity:** CRITICAL — BREAKOUT, PIN, and CONDOR discovery never run unless env vars
are manually set. ECS task definition and terraform carry no `ZERODTE_*` flags; any task
definition update (deploy, scaling, infra change) silently drops manually-set env vars.

**Root cause:** `wholeMarketEnabled()`, `breakoutSrcFlagEnabled()`, `pinSrcFlagEnabled()`,
and `condorFlagEnabled()` all check `=== "1"` (opt-IN). These flags were originally
gated OFF during the Phase 3 build (safe-by-default while shipping). Task #47 set them
live via manual ECS env vars, but the code default remained OFF, so any task definition
update that didn't carry the vars silently disabled 3 of 4 discovery systems + condor.
The result: only FLOW discovery ran (tickers with ≥$150k option flow prints), producing
≤3 setups from 12,000+ stocks. BREAKOUT (whole-market momentum scanner) and PIN
(GEX-wall mean-reversion fades) never fired. Iron condor never built.

**Evidence:** Live board on 2026-07-27 showed only 3 FLOW-origin setups (SPXW, QQQ, GOOGL).
`grep ZERODTE` across `blackout-infra/terraform/` returned zero matches. The ECS task
definition (`main.tf:140-143`) only sets `PROCESS_ROLE=web` and `DATA_SOCKETS_ENABLED=0`.

**Fix:** Flip all four flags to default ON (`!== "0"` instead of `=== "1"`). The systems
are production-ready (Phase 3a/3b/4 all shipped and tested). To disable, operators set
the env var to `"0"` explicitly. This survives task definition updates.

**Blast radius:** `breakout-source.ts:33-38`, `pin-source.ts:40-45`, `condor.ts:43-44`.
Tests updated in all three `*.test.ts` files. `scan.ts` consumption unchanged (still
checks `breakoutSourceEnabled()`/`pinSourceEnabled()`). `pin-discovery.ts` condor routing
unchanged (still checks `condorFlagEnabled()`).

**File:line:** `src/lib/zerodte/breakout-source.ts:33`, `src/lib/zerodte/pin-source.ts:40`,
`src/lib/zerodte/condor.ts:43`
**Status:** PR #1150 — included with chase-guard fix.

---

## 2026-07-27 — G-4 VIX elevated gate treats flat tape as non-aligned (zero-commit sessions)

**Severity:** CRITICAL — the most common market regime (VIX 17-20, flat/choppy tape) produced
ZERO committed plays across entire RTH sessions. The system was live but completely inert on
range-bound days.

**Root cause:** In `gates.ts`, the G-4 VIX elevated gate computed `tapeAligned` as:
```
input.bias != null && input.bias !== "flat" && (input.bias === "up") === (input.direction === "long")
```
This excluded flat tape (`bias === "flat"`), treating it the same as unknown/counter-tape and
requiring score >= 75 (VIX_ELEVATED_SCORE_FLOOR) instead of the standard >= 65. But G-1 already
hard-blocks counter-tape entries — a setup that reaches G-4 with flat tape has NO directional
opposition (G-1 passed it). The 75 floor was designed for counter-tape entries that G-1 already
kills, and flat tape was collateral damage.

**Evidence:** Live board on 2026-07-27 (VIX 17.62-18.82, flat tape):
```
QQQ (long) score=74 — BLOCKED by vix_elevated (needs ≥75, got 74)
```
ONE POINT from committing. With the fix (flat tape → standard 65 floor), QQQ at 74 commits.
The same pattern likely explains zero-commit sessions on 2026-07-24 (VIX 19+, choppy tape).

**Fix:** Changed `tapeAligned` to `tapeAlignedOrFlat` in three locations:
1. G-4 elevated gate (line ~476): flat tape gets the standard 65 floor
2. G-4 fail-closed mirror (line ~510): flat tape treated as aligned for couldBlock calc
3. Calibration `computeGateCalibration` (line ~870): flat tape → `aligned = true`

The logic: `input.bias === "flat" || (input.bias === "up") === (input.direction === "long")`.
Null bias (unknown/stale tape — already blocked by G-1 `no_market_bias`) still gets the 75
belt-and-suspenders floor.

**Blast radius:** Only `gates.ts` — three sites, one semantic change. The gate evaluation, its
fail-closed mirror, and the calibration snapshot all had the same flat-tape-as-non-aligned bug.
No other files reference `tapeAligned`. Tests updated in `gates.test.ts` (5 tests adjusted).

**File:line:** `src/lib/zerodte/gates.ts:476`, `:510`, `:870`
**Status:** PR #1152 — MERGED

---

## 2026-07-27 — Condor VIX gate blocks at elevated (17) instead of extreme (20)

**Severity:** CRITICAL — iron condors (the ONE structure designed for flat/range-bound markets)
were hard-blocked on any day with VIX >= 17. Since VIX sits between 17-20 for ~40% of trading
days, the condor engine — purpose-built for the exact market regime that directional plays
struggle in — was dead on arrival in its primary use case.

**Root cause:** In `gates.ts:425`, the condor VIX gate used `VIX_ELEVATED_THRESHOLD` (17):
```
if (vix != null && vix >= VIX_ELEVATED_THRESHOLD) {
  return reject("condor_vix_elevated", ...);
}
```
This was copy-pasted from the directional VIX gate logic. But the F-1 evidence for VIX-gating
(docs/audit/0DTE-RESEARCH.md) measured DIRECTIONAL 0DTE plays — long calls/puts that suffer in
high-vol from gamma crush and wide bid-asks. Iron condors are delta-neutral premium SELLERS that
BENEFIT from elevated vol (higher credit collected, wider profitable range). The condor-WR
backtest (`condor-wr.mjs`) showed 98.7% WR at the shipped geometry even through VIX 17-20
sessions. The correct threshold for condors is VIX_EXTREME (>= 20), where even condors face
tail risk from violent moves.

**Evidence:** Live board on 2026-07-27 (VIX 17.62-18.82): zero condors generated despite
SPY/QQQ/IWM all trading in tight ranges — the ideal condor setup. The condor gate rejected
every candidate with `condor_vix_elevated`.

**Fix:** Changed threshold from `VIX_ELEVATED_THRESHOLD` (17) to `VIX_EXTREME_THRESHOLD` (20)
at `gates.ts:425`. Added explanatory comment documenting why condors use a different threshold.
Three new tests added to `gates.test.ts`: VIX 18 passes condor, VIX 20 blocks condor,
unavailable VIX still fails closed.

**Blast radius:** Single site in `gates.ts`. The constant `VIX_EXTREME_THRESHOLD` (20) already
existed and was used by the extreme-regime gate (G-4b). No other condor logic references the
elevated threshold.

**File:line:** `src/lib/zerodte/gates.ts:425`
**Status:** PR (pending, bundled with confluence fix below)

---

## 2026-07-27 — Flat tape market_aligned=null blocks early-window confluence gate (G-12)

**Severity:** HIGH — during the early entry window [10:00, 10:45) ET, G-12 requires >= 2
confirmations (VWAP-side + market-aligned). But flat tape set `market_aligned = null` (unknown),
which `confluence.ts` correctly treated as "not a confirmation" (`market_ok = false`). This
capped confirmations at 1 (VWAP-side only) on flat-tape days, hard-blocking ALL setups in the
early window — even ones with strong VWAP confirmation.

**Root cause:** In `scan.ts:447`, the market_aligned assignment was:
```
s.market_aligned = bias == null || bias === "flat" ? null : (bias === "up") === (s.direction === "long");
```
This lumped flat tape (`bias === "flat"`) with unknown/stale tape (`bias == null`) and returned
`null` for both. But they're semantically different: null = we don't know the tape (shouldn't
confirm anything), flat = the tape is known and non-opposing (no directional headwind). G-1
already blocks counter-tape entries, so a flat tape that reaches the confluence check is a
non-opposing environment — it should count as a confirmation.

**Evidence:** Combined with the G-4 flat-tape fix (PR #1152), this was the remaining blocker
for early-window entries on flat-tape days. A setup with VWAP confirmation but flat tape would
get `confirmations = 1`, hitting the `>= 2` early-window floor in G-12.

**Fix:** In `scan.ts:447`, split the ternary so `bias === "flat"` returns `true` (non-opposing)
while `bias == null` returns `null` (unknown). Updated comment in `confluence.ts:78` to document
the semantics: `true = aligned or flat tape (non-opposing), false = counter, null = unknown`.

**Blast radius:** `scan.ts:447` (the assignment), `confluence.ts:79` (already reads `=== true`,
so `true` from flat tape flows through correctly with no code change needed — only the comment
updated). No other files assign `market_aligned`.

**File:line:** `src/lib/zerodte/scan.ts:447`, `src/lib/zerodte/confluence.ts:78`
**Status:** MERGED (PR #1154)

---

### 2026-07-27 — Cortex veto_blind hard block kills entire 0DTE engine
**Severity:** HIGH (zero-play sessions when UW GEX/flow data stale or absent)

**Root cause:** `cortex-gate.ts:159` — when BOTH veto-capable Cortex sources (`gex-walls` +
`flow-quality`) failed to read, the firewall returned `VETO_BLIND` which `cortexGateBlocks()`
rendered as a hard `cortex_veto_blind` block. This was the Phase-0 fail-closed firewall, designed
to prevent blind commits. In practice, UW GEX and flow data is stale or absent for ~40% of
tickers and during most pre-market/Sunday sessions, so VETO_BLIND silently killed the entire
0DTE engine — every candidate that survived all 12 hard gates was then blocked by Cortex.

**Evidence:** Live board 2026-07-27 (Sunday RTH): SPXW 7400p had triple confluence (score=77,
tape-aligned) and passed all hard gates — blocked ONLY by `cortex_veto_blind`. The hard gates
(G-1..G-12) are the safety floor; Cortex is the precision layer. The tier cap
(`CORTEX_THIN_EVIDENCE_MAX_ABSENT` in `tiers.ts`) already caps thin-evidence plays at B-tier,
handling the quality downgrade without needing a hard block.

**Fix:** Changed `assessCortexVerdict()` in `cortex-gate.ts` to return `ABSTAIN` (graceful
degradation) instead of `VETO_BLIND` (hard block) when both veto sources are dark. The play
commits on hard gates alone, tier is capped at B for thin evidence, and the veto-blind state
is recorded on `entry_context` for calibration measurement. Real vetoes (an actual opposing
$1M cluster or dealer wall detected) still hard-block — only the "can't see" case changed.

**Blast radius:** `cortex-gate.ts` (the decision function), `cortex-gate.test.ts` (10 tests
updated from VETO_BLIND→ABSTAIN expectations), `scan.ts` (comment only). `board.ts`, `pane.ts`,
`calibration.ts` retain VETO_BLIND in their types/logic for backward compat with historical data.

**File:line:** `src/lib/zerodte/cortex-gate.ts:153-171`
**Status:** MERGED (PR #1155)

## 2026-07-27 — G-12 early-window confluence floor (2→1), G-10 intraday_conflict demotion, fail-closed stale fallback

**Severity.** High (cumulative — the three issues combined produced zero-play sessions on full trading days).

**Root cause (three interacting gates):**

1. **G-12 early window `ZERODTE_CONFLUENCE_MIN_EARLY` default 2:** The early window [10:00, 10:45) ET
   required 2 confluences (VWAP + market alignment) before committing. Most plays in the first 45
   minutes carry only 1 confirmation (market-aligned OR VWAP-confirmed, rarely both that early). The
   2-conf requirement blocked nearly everything in the morning window, starving the board during the
   highest-activity period.
   **File:line:** `src/lib/zerodte/gates.ts:110` — `envInt("ZERODTE_CONFLUENCE_MIN_EARLY", 2)` → `1`.

2. **G-10 intraday_conflict hard block:** Promoted from score-only to hard block on 2026-07-18. The
   gate blocked when a name's session VWAP and 5m trend opposed the play direction. But flow precedes
   trend changes — the signal that justified the play (institutional flow) correctly leads reversals,
   and the hard block killed valid plays where flow was right and structure was about to follow. The
   score penalty via `adj.delta` in `scan.ts:computeIntradayEdge()` already weights structure conflict
   into the score; the hard block was redundant and destructive.
   **File:line:** `src/lib/zerodte/gates.ts:611-620` — block removed, replaced with comment explaining demotion.

3. **Fail-closed provider timeout resilience:** The four fail-closed gates (G-4 `vix_unavailable`, G-7
   `macro_unavailable`, G-11 `earnings_unavailable`, G-11 `halt_feed_stale`) correctly distinguish
   "data unavailable" from "data present but nothing to block." But a single transient provider timeout
   (the `within(withServerCache(...), 2500)` pattern) set the `*Unavailable` flag and emptied the board
   for that entire scan pass — even when the previous scan pass 2 minutes ago had a successful read.
   **File:line:** `src/lib/zerodte/scan.ts:609-628` — added module-level last-known-good fallback stores
   (`_lastVix`, `_lastMacroRead`, `_lastEarnings`). On a successful read, the value is stored. On a
   subsequent timeout, the fallback is used instead of marking unavailable. On true cold start (no prior
   read), the fail-closed gates correctly hold as designed.

**Evidence:** Live board 2026-07-27 — zero plays committed on a full trading Monday. The kill chain was:
early window (G-12 floor=2 blocked 1-conf plays 10:00-10:45) + intraday_conflict (G-10 hard-blocked
plays where flow led a reversal) + Cortex veto_blind (fixed in PR #1155) = nothing survived all gates.

**Fix rationale:**
- G-12: lowering the early floor to 1 matches the standard floor. The 0-conf bucket (−12.5% EV) is still
  blocked. The operator can raise it via `ZERODTE_CONFLUENCE_MIN_EARLY` env if calibration supports it.
- G-10: flow precedes trend by design — the intraday edge already penalizes the score, so the signal is
  still present but can't single-handedly kill the board. The `intradayConflict` field remains on the
  setup for audit/display.
- Fail-closed: the fallback only activates after a successful read in the current session. A process
  restart still has no fallback (correct — fail-closed on true unknowns). The halt feed stale flag is
  not included in the fallback (it's a socket-health signal, not a fetch timeout).

**Blast radius:** `gates.ts` (G-12 config + G-10 block removal), `gates.test.ts` (2 tests updated),
`scan.ts` (3 module-level fallback stores + fallback logic at the firewall-signal derivation site).
`board.ts` retains `intraday_conflict` field for display.

**Status:** PR (pending)

## 2026-07-27 — [CTO AUDIT] Night Hawk 0DTE full-system hardening (27 findings, 4 workstreams)

**Severity.** Mixed (4× HIGH, 8× MEDIUM, 15× LOW/additive). Full CTO-level audit of the entire Night
Hawk 0DTE system — architecture, gates, discovery, exit engine, governor, data resilience, telemetry.

**Workstream 1 — Data resilience** (4 fixes):

1. **Stale fallback max-age cap (30 min):** Module-level `_lastVix`, `_lastMacroRead`, `_lastEarnings`
   had NO timestamp — a 3-hour-old VIX could back-fill as "current." Added `_lastVixAt`,
   `_lastMacroReadAt`, `_lastEarningsAt` timestamps + `MAX_FALLBACK_AGE_MS = 30 * 60 * 1000`. Fallbacks
   older than 30 min are treated as truly unavailable (fail-closed).
   **File:line:** `src/lib/zerodte/scan.ts:163-171`

2. **Degraded-key blocking refresh skip:** `server-cache.ts` forced a BLOCKING refresh when
   `staleAge > MAX_STALE_AGE_MS` even when the upstream was already degraded (3+ consecutive failures).
   Now returns stale + kicks off non-blocking background refresh when `degradedKeys.has(key)`.
   **File:line:** `src/lib/server-cache.ts:160-166`

3. **Polygon null-return logging:** `polygon-largo.ts` `polygonGet()` returned null silently on errors.
   Added `console.warn` for non-ok HTTP responses (path + status) and caught errors (path + message).
   **File:line:** `src/lib/providers/polygon-largo.ts:50-56`

4. **Polygon URL failover:** Production reads `POLYGON_API_BASE` once from env (no runtime failover).
   Added primary/fallback URL switching (api.massive.com ↔ api.polygon.io) triggered by the circuit
   breaker state via `isPolygonCircuitOpen()`. Sticky until breaker resets.
   **File:line:** `src/lib/providers/polygon-largo.ts:11-35`

**Workstream 2 — Discovery expansion** (4 fixes):

5. **BREAKOUT_MAX_CANDIDATES raised 6→15:** The discovery-recall-probe proved the top-6 $-volume cap
   dropped 10-17 winning movers per session. Downstream gate stack (G-3 score floor, Cortex, governor)
   handles quality filtering.
   **File:line:** `src/lib/zerodte/breakout-discovery.ts:41`

6. **Breakdown (SHORT-side) discovery added:** New `screenBreakdownMovers()` screens gap-down movers
   (gain >= 5% negative, weak close-strength <= 0.5). Breakout discovery now screens both long breakouts
   AND short breakdowns from the same grouped-daily, deduplicates (long wins), picks put contracts.
   **Files:** `candidates.ts`, `breakout-source.ts`, `breakout-discovery.ts`

7. **PIN universe expanded 14→30:** Added 16 high-OI names: NFLX, CRM, AVGO, COST, LLY, JPM, V, MA,
   UNH, WMT, PG, JNJ, HD, ADBE, INTC, MU.
   **File:line:** `src/lib/zerodte/pin-discovery.ts`

8. **Multi-source +8 score boost:** When a ticker appears in 2+ discovery origins (FLOW + BREAKOUT,
   FLOW + PIN, etc.), score gets +8 (capped at 100). Applied in both `mergeDiscoveryOrigins` and
   `mergePinOrigins`.
   **Files:** `breakout-source.ts`, `pin-source.ts`

**Workstream 3 — Exit engine + governor** (4 fixes):

9. **Tier-aware exit mode (E5 graduation):** A/B-tier plays default to `trim_scale` (proven to dominate
   ratchet in EVERY backtest window); C-tier stays on conservative ratchet. New `resolveExitModeForTier()`
   in exit-sync.ts. Exit policy now resolved PER PLAY (not per scan) based on the assigned merit tier.
   Operator `ZERODTE_EXIT_MODE=ratchet` env override still forces all tiers.
   **Files:** `exit-sync.ts:112-132`, `scan.ts:913-951`

10. **Distinct `governor_session_loss_halt` code:** Realized-loss halt reused the hard-stop halt's
    `governor_session_stops` code. Consumers couldn't tell the two halts apart. Now uses distinct
    `governor_session_loss_halt` code.
    **Files:** `governor.ts:423-432`, `board.ts` (type union)

11. **Sector-pair correlation groups:** Single broad-index/ETF group expanded with 4 sector pairs:
    Semiconductors (NVDA/AMD/INTC/MU), Mega-cap tech (MSFT/GOOGL/META/AMZN), Tech/enterprise
    (AAPL/AVGO/CRM/ADBE), Financials (JPM/GS/MS/BAC). `CONCENTRATION_POLICY_VERSION` bumped v1→v2.
    **File:line:** `src/lib/zerodte/governor.ts:102-108`

12. **Dedicated grading cron route:** New `src/app/api/cron/zerodte-grade/route.ts` — standalone grading
    endpoint that bypasses the 10-minute throttle. Decouples grading from the warm cron.

**Workstream 4 — Gate tests + docs** (4 fixes):

13. **G-4 dead-code comment:** The null `spy_bias` path in G-4's elevated-VIX regime is unreachable
    (G-1 blocks null bias first). Added explanatory comment.
    **File:line:** `src/lib/zerodte/gates.ts:468`

14. **Ticker-set divergence documented:** Added comments documenting that `SPX_CORRELATED_TICKERS`
    (G-6) is intentionally broader than `CORRELATION_GROUPS` (governor).
    **Files:** `gates.ts:178`, `governor.ts:101`

15. **3 missing gate tests added:** `condor_macro_block` (G-7 blocks condors on high-impact macro),
    `condor_range_break` (spot breached short strike), `FOMC_afternoon_window` (directional lifts
    after ±15m, condor stays blocked). Total gate tests: 90→94.
    **File:line:** `src/lib/zerodte/gates.test.ts`

16. **G-12 null-confluence telemetry counter:** `_nullConfluencePassCount` + getter
    `getNullConfluencePassCount()` tracks how often the G-12 fail-open path fires. Exported for
    health checks. Test added.
    **File:line:** `src/lib/zerodte/gates.ts`

**Evidence:** Full audit artifact published. TypeScript compiles clean (0 errors). 94/94 gate tests
pass. 10/10 breakout-source tests pass.

**Blast radius:** 14 files changed across the 0DTE subsystem. No member-facing UI changes. Exit
mode change is the highest-risk item — mitigated by operator kill-switch (`ZERODTE_EXIT_MODE=ratchet`)
and per-play frozen exit policy (existing plays unaffected).

**Status:** PR (pending)

## 2026-07-28 — [UI/UX] Batch 5: keyboard shortcut conflict + stock-price flash + confirm polling + backfill score floor (PR #1176)

**Severity.** P3 (keyboard) / P3 (flash) / P2 (confirm polling) / P2 (backfill floor).

**Root cause — keyboard shortcut conflict (P3).** `PlayTerminal.tsx` registered `1`/`2`/`3`
key listeners on `window` with no input-guard. Typing a number in any `<input>` or `<textarea>`
on the page would switch the terminal tab instead of entering the character.

**Fix:** Guard the keydown handler: skip when `e.target` is an INPUT/TEXTAREA/SELECT, or when
a modifier key (meta/ctrl/alt) is held. File: `PlayTerminal.tsx:129-136`.

**Root cause — stock-price flash missing for Legacy (P3).** `useFlash(play?.mark)` fires a
green/red neon flash on price changes, but Legacy plays have `mark: null`. The stock price
updates every 5s via polling but no flash hook tracked it — the Legacy stream bar never flashed.

**Fix:** Added `useFlash(play?.stockPrice)` and wired `stockFlash` into the stream bar's class.
File: `PlayTerminal.tsx:142,189`.

**Root cause — morning confirm polling too slow (P2).** SWR `refreshInterval` for
`/api/nighthawk/play-status` was 300_000ms (5 min). During the pre-market confirm window
(9:10-9:45 ET), members could see stale badges for up to 5 minutes after invalidation.

**Fix:** Reduced to 60_000ms (1 min). File: `containers.tsx:110`.

**Root cause — backfill has no score floor (P2).** `backfillThinEditionPlays` applies no score
floor. A candidate with score 5 could backfill into the edition. The main synthesis path
enforces `MIN_PUBLISH_SCORE = 42`.

**Fix:** Added `DIVERSITY_HEDGE_FLOOR = 20` as the minimum score for backfill candidates.
File: `play-backfill.ts:87`.

**Status:** COMMITTED (PR #1176, batch 5)

## 2026-07-28 — [correctness] "no dominant pattern" sentinel leaks into thesis text + compounding option-coherence push inflates R:R (P1×2)

**Severity.** P1 (sentinel leak) / P1 (R:R inflation).

**Finding 1: `classifySetup` sentinel string leaked into member-facing thesis copy.**
`technicals.ts:120` fell back to `["no dominant pattern"]` when no setup condition matched,
instead of an empty array. `buildDeterministicThesis` (`deterministic-edition.ts:389-391`) joins
`setup_tags` directly into prose with no special-casing for this sentinel, so members saw literal
copy like "NVDA showing no dominant pattern in mixed trend" — an internal diagnostic label
presented as a trade thesis.

**Root cause.** The sentinel was written as a placeholder for logging/debugging and never
special-cased at the one call site that renders `setup_tags` into member copy.

**Fix.** Return `tags` (possibly empty) instead of the sentinel. `classifySetup` is now exported
for direct unit testing. The caller already handles an empty array correctly: `deterministic-edition.ts:389-395`
falls through to trend-only prose (`else if (trend)`) or a generic setup line (`else`) — verified by
the existing `else`/`else if` branches, no caller change needed.

**Finding 2: compounding target pushes inflate displayed R:R.**
Two independent target pushes stack: (a) `deterministic-edition.ts:339-349` pushes the S/R target
side out to at least 1.5×ATR from spot ("PR-N21/N22"), then (b) `buildPlay` (`deterministic-edition.ts:497-509`,
"PR-N29") unconditionally pushes the target again to at least `strike ± 2×premium` so the option is
ITM at "target". Each push is individually reasonable (guards against a thin range / an
option that's worthless at target), but stacked and uncapped they can inflate the displayed R:R well
beyond what the technical level or option geometry actually supports.

**Fix.** Capped the option-coherence push (b) at 1.25× the *original* (pre-push) target distance
from the entry-range midpoint. If `strike ± 2×premium` would require a bigger move than that, the
target is pushed only as far as the cap allows rather than chasing the option strike unconditionally
— the push still fixes the economically-broken case (target on the wrong side of the strike) without
unbounded R:R inflation. Two existing PR-N29 tests (`deterministic-edition.test.ts`) encoded the old
uncapped invariant (`target >= strike + 2×premium` / `target <= strike - 2×premium`) and were updated
to assert the new capped bounds instead, with a new dedicated test asserting the 1.25× cap directly.

**Evidence.** `npx tsx --test src/features/nighthawk/lib/technicals.test.ts` (2/2 pass, new file);
`npx tsx --test src/features/nighthawk/lib/deterministic-edition.test.ts` (34/34 pass, 2 updated +
1 new). `npx tsc --noEmit` clean for both changed files.

**Blast radius.** `classifySetup` is the only tag source feeding `setup_tags`; `grep` confirms no
other reference to the `"no dominant pattern"` string anywhere in `src/`. The option-coherence push
in `buildPlay` is the only caller of `minOptionTarget`; the earlier S/R push in `buildStockLevels`
is unchanged (still 1.5×ATR, not capped) — capping only the second, redundant push is sufficient to
bound the compounding effect.

**Fix rationale.** Considered plumbing ATR into `buildPlay` to cap directly against ATR, but
`buildPlay` doesn't have ATR in scope and threading it through every call site is a larger, riskier
change for a P1 fix. Capping relative to the already-computed entry-to-target distance achieves the
same goal (bound the total push) without a signature change.

**Status:** FIXED (branch `fix/nighthawk-sentinel-and-rr-inflation`, PR pending).

## 2026-07-28 — [correctness] "ambiguous" both-hit outcome deflates Night Hawk win rate (PR #1181)

**Severity.** P2 — systemic understatement of the public win rate, not a wrong-direction grade.

**Finding.** `resolveOutcome()` in `src/features/nighthawk/lib/play-outcomes.ts:616-624` graded a
play `"ambiguous"` whenever BOTH `target` AND `stop` were hit intraday and the next-day open sat
strictly between them (neither `open >= target` nor `open <= stop`, LONG case; mirrored for SHORT).
This is the common shape for overnight/gap plays: the open lands between the two published levels,
then the session later trades through both. `src/features/nighthawk/lib/analytics.ts` counts
`"ambiguous"` rows in the `scoreable` denominator but never in the `wins` numerator
(`win_rate = wins / scoreable`), so every ambiguous grade silently deflated the reported win rate.

**Root cause.** The branch had no tiebreaker for the both-hit / open-between case — it fell straight
to `"ambiguous"` rather than making any attempt to infer which level was likely hit first. Not caught
earlier because the exclusion looks identical in shape to the legitimate `unfilled`/
`stop_data_unavailable` exclusions already in the same function, so it read as intentional
data-honesty rather than a gap.

**Fix.** When both are hit and the open is between them, use distance from the open to each level as
a heuristic tiebreaker: closer to target → likely ran to target first (`"target"`); closer to stop →
likely hit stop first (`"stop"`). Exact ties default to `"stop"` (conservative — can't be used to
inflate the win rate on ambiguous evidence). `"ambiguous"` remains in the return-type union and now
fires only when `open`/`target`/`stop` are null (rare).

**Evidence.** 5 new tests in `play-outcomes.test.ts`: open-closer-to-target → `"target"`,
open-closer-to-stop → `"stop"`, exact-tie → `"stop"`, open missing → still `"ambiguous"`, SHORT-mirror
→ `"target"`. `npx tsx --test src/features/nighthawk/lib/play-outcomes.test.ts`: 30/30 pass.
`tsc --noEmit` clean.

**Blast radius.** Every other reader of `"ambiguous"` (`analytics.ts`, `debrief.ts`,
`debrief-persist.ts`, `regrade-legacy.ts`, `alert-outcome-sync.ts`, `nighthawk-edition-read.ts`, plus
the `PlayHistoryTable` / `spx-signals-shadow-precedents` type unions) only reads `row.outcome` — no
changes needed since `"ambiguous"` stays a valid (just less frequent) union member.

**Status:** MERGED (PR #1181).

## 2026-07-28 — [quality] Tier A threshold too lenient + forced contrarian floor too soft (P2×2)

**Severity.** P2 (tier inflation) / P2 (low-confluence contrarian).

**Finding 1: `NH_TIER_A_MIN_POINTS = 3` meant virtually every published play earned tier A.**
`nighthawk-tiers.ts:91` set the A threshold at 3 points. Since the publish floor (`MIN_PUBLISH_SCORE
= 42`) lands squarely in the prime score band (40-54, weight +2), any published play with 3+
confirming signals (weight +2) automatically scored 4 points → tier A. With adequate signals (2,
weight +1), the total was still 3 → tier A. The only published plays that got B were those with
earnings risk (hard-capped) or thin signals (<2, hard-capped). Real-world result: ~90% of edition
plays were tier A, providing zero differentiation to members.

**Root cause.** The prime-band weight (+2) was set for overnight plays where the 40-54 score band is
genuinely the sweet spot (high scores can be momentum-inflated), but the A threshold was set at 3
when it should have required both strong axes: prime band AND broad signals.

**Fix.** Raised `NH_TIER_A_MIN_POINTS` from 3 → 4. Now tier A requires prime-band score (40-54, +2)
AND strong signal breadth (3+ dimensions, +2) = 4 points. Mid/top-band plays with strong signals
score 3 points → tier B (still solid, just not the top tier). This creates meaningful 3-tier
differentiation: A (~30-40% of plays), B (~40-50%), C (~10-20%).

**Finding 2: `FORCED_CONTRARIAN_FLOOR = 15` admitted plays with essentially zero real signal.**
`constants.ts:78` let forced contrarian plays publish with a score of 15 — far below the normal
42 publish floor. The forced contrarian path discounts flow to 0.3× and re-scores tech/positioning
against the dominant trend, yielding raw totals of 5-18 in extreme markets. At a floor of 15, a
play could clear with just rounding noise from re-scoring rather than genuine technical or
positioning support for the contrarian thesis.

**Fix.** Raised `FORCED_CONTRARIAN_FLOOR` from 15 → 25. The contrarian still needs to clear a softer
bar than normal plays (25 vs 42) since flow is gutted at 0.3×, but at 25 it requires genuine bearish
tech or negative-gamma positioning — not just noise. When no candidate clears 25, the edition accepts
the all-directional book honestly rather than publishing a noise hedge.

**Evidence.** `npx tsx --test nighthawk-tiers.test.ts`: 26/26 pass (6 updated expectations).
`npx tsx --test deterministic-edition.test.ts`: 34/34 pass (1 dossier enriched, 3 assertions
updated). `tsc --noEmit` clean.

**Blast radius.** `NH_TIER_A_MIN_POINTS` is read only in `assignNighthawkTier` — affects all tier
assignments (edition build, forced contrarian, display). No other constant references it.
`FORCED_CONTRARIAN_FLOOR` is read only in the Phase 2 forced-contrarian path of
`buildDeterministicEditionPlays` — Phase 1 (natural diversity swap using `DIVERSITY_HEDGE_FLOOR = 20`)
is unchanged.

**Status:** PR #1184 open (branch `fix/nighthawk-tier-and-contrarian`).

## 2026-07-28 — [0DTE-UI] CLOSED plays vanishing from Command Deck (PR #1188)

**Severity.** P1 — closed plays silently vanished from the only surface that manages them.

**Root cause.** `zerodte-sources.ts:116` — the ledger union loop that surfaces positions the scanner
didn't return only passed through `WORKING_STATUSES` (OPEN/HOLD/TRIM). When the scanner dropped a
ticker, its CLOSED ledger row was filtered out. An open play that got closed would vanish instead of
appearing under a "Closed" view. The `WORKING_STATUSES` set was designed for rule 9-4 (working
positions always render) but didn't account for the need to show CLOSED plays in the Command Deck.

**Evidence.** `zerodte-sources.test.ts` test #5: before fix, a TSLA CLOSED ledger row was absent from
the output; after fix, it appears correctly. All 8 tests pass. `tsc --noEmit` clean. 103/103 adapter
tests pass.

**Fix.** Changed the union loop condition from `if (!WORKING_STATUSES.has(st)) continue;` to
`if (!WORKING_STATUSES.has(st) && st !== "CLOSED") continue;`. The `WORKING_STATUSES` set itself is
NOT modified (still OPEN/HOLD/TRIM) because other consumers may depend on its exact membership.

Added: ALL/OPEN/WATCH/CLOSED filter toggle bar in CommandDeck with live counts per status group. This
was the missing UX — there was no way to filter plays by status, so closed plays (even when present)
were mixed into the list with no way to find them.

Also enriched the 0DTE panel to match Legacy richness: `stockPrice`, `optionsPlay`, `rrRatio` mapped
in the adapter + pre-entry context and entry plan components in PlayTerminal.

**Blast radius.** `zerodte-sources.ts` (1 condition), `CommandDeck.tsx` (filter state + UI),
`globals.css` (8 lines filter bar CSS), `adapters.ts` (3 new fields), `PlayTerminal.tsx` (2 new
components). No existing fields or rendering changed. `deck-sort.ts` already buckets CLOSED into
band 2 (sorted last).

**Status:** PR #1188 merged (squash, `ff17eefd`).

## 2026-07-28 — [correctness] ManagePanel frozen at 5s board poll cadence (PR #1189)

**Severity.** P1 — the Management tab (the "action" panel users watch most) only updated every 5s
while the P&L tab updated every 1s from SSE marks, making it look "static".

**Root cause.** `PlayTerminal.tsx:ManagePanel` read `play.recommendation`, `play.recNote`, and
`play.progress` — values computed once in the adapter (`managementFor()`) from the board-poll
`live_pnl_pct`. The SSE live-marks overlay pushed fresh `pnlPct` at ~1s, but ManagePanel's
recommendation badge, advisory text, and ratchet progress bar stayed frozen at the 5s value.

**Fix.** ManagePanel now calls `managementFor(play.exitModel, play.status, play.pnlPct)` at render
time, recomputing from the SSE-overlaid pnlPct on every render.

**Status:** PR #1189 merged (squash, `b4a46eb4`).

## 2026-07-28 — [regression] Legacy ManagePanel shows generic "HOLD" after PR #1189 (PR #1190)

**Severity.** P1 — Legacy plays always showed "HOLD" with generic text even when the stock hit
stop/target levels, because `managementFor("PLAN", ...)` doesn't know about stop/target geometry.

**Root cause.** PR #1189's `managementFor()` recompute was correct for 0DTE (RATCHET/SCALE_OUT) but
regressed Legacy (exitModel `"PLAN"`). The function's P&L thresholds (-45% sell, +90% trim) are
designed for option-premium P&L, not stock-level moves (typically single-digit %). Meanwhile,
`overlayLegacyQuotes` (use-legacy-quotes.ts:141-153) had already computed the correct dynamic
recommendation from live stock price vs stop/target — PR #1189 discarded these values.

**Fix.** ManagePanel now prefers `play.recommendation`/`play.recNote` when `exitModel === "PLAN"` and
the overlay has set them. 0DTE RATCHET/SCALE_OUT still recompute from live pnlPct as intended.

Also fixed P&L display precision: 0DTE card/PnlPanel rendered raw `pnlPct` without `.toFixed()`,
showing values like `+64.29%` vs Legacy's clean `+64.3%`. Now consistently `.toFixed(1)` everywhere.

**Status:** PR #1190 — CI running.
