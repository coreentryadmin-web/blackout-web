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

## WATCH LIST — 2026-09-04 coordinator sweep (read this before the routine pass)

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

### 0ad. UW L1 cache + stocks/polygon stall future guards — fix/uw-cache-stocks-polygon-stall-freshness (pending)

**What was broken:** Three paths missed the #3745/#3760 future-timestamp sweep: `readUwCache()` (in-process UW REST L1 — future `fetchedAt` reads as fresh forever), `startStocksWatchdog()` (stocks `A.*` stall — future `lastMessageAt` never triggers reconnect), polygon indices watchdog (same on `lastIndicesMessageAt`).

**Fix:** Route all three through `isWsUpdatedAtFresh` from `timestamp-freshness.ts`.

**Check at the open:** Admin System Vitals stocks + indices socket tiles still reconnect on genuine silence; UW-backed desk supplements (dark pool, flow) still serve from cache during normal RTH without false cache hits from skewed clocks.
### 0ab. LULD halt future-timestamp guard — fix/luld-halt-future-timestamp-guard (pending)

**What was broken:** `isLuldHaltSourceStaleForState()` and `isLuldHaltFeedStale()` used raw `Date.now() - timestamp` age math without a future guard — clock-skewed future cluster/local `last_message_at` stamps read as live/trusted (same class as the UW halt bug fixed in #3745).

**Fix:** Gate all LULD freshness probes through shared `isWsUpdatedAtFresh`.

**Check at the open:** Admin System Vitals → Massive LULD tile shows live during RTH when feed is healthy; 0DTE halt gate still blocks when BOTH UW and LULD are genuinely down (not on a single future-skewed stamp).

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

