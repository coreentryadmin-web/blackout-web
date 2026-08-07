# Night Hawk DAY TRADES (0DTE board) — live RTH audit backlog · 2026-08-07

Audited against LIVE PRODUCTION (`https://blackouttrades.com`) during RTH on 2026-08-07,
09:36–10:15 ET. Read-only throughout. AWS credentials were valid this session, so ECS/ALB/
CloudWatch evidence is first-hand rather than skipped.

**No code was changed, no branch was created, no PR was opened** — per the operator's
RTH instruction, everything below is backlog for after the close.

---

## Stage matrix — `npm run healthcheck:0dte` (two runs)

| Stage | Without AWS (09:37 ET) | With AWS (09:44 ET) |
|---|---|---|
| A · INFRA/CONFIG | ⚪ SKIPPED (creds absent) | 🟢 **GREEN** — web 5/5 running, market-worker 2/2, rollout COMPLETED, `ZERODTE_WHOLE_MARKET=on SRC_BREAKOUT=on SRC_PIN=on CONDOR=on` |
| B · DISCOVERY ×3 | 🟡 AMBER — PIN 0 | 🟡 AMBER — FLOW 6 GREEN, BREAKOUT 29 GREEN, **PIN 0** |
| C · COMMIT/LEDGER | 🟡 AMBER — 0 rows | 🟡 AMBER — 0 rows (pre-10:00; first row landed 10:05:23) |
| D · LIVE MARKS+P&L | 🟡 AMBER — no ENTERED play | 🟡 AMBER — 29/29 setup contracts quoted |
| E · EXIT MGMT | 🟡 AMBER — 0 ledger rows | 🟡 AMBER |
| F · IRON CONDOR | 🟡 AMBER — 34/34 geometry well-formed, none routed | 🟡 AMBER |
| G · GRADING/RECORD | 🟢 GREEN — 48+88+0 = 136 = graded | 🟢 GREEN |

The C/D/E/F ambers at 09:44 were **legitimate pre-commit emptiness**, not defects: the
`opening_window` gate blocks every commit before 10:00 ET, which I then watched unlock live
(see GREEN-7). Nothing was RED in either run. The P0 below was **not** caught by the
healthcheck — it is an availability defect the single-shot probe passes straight through.

---

# FINDINGS

## [P0] Production ALB returns 502s continuously — target keep-alive (5s) is 24× shorter than the ALB idle timeout (120s)
**Date:** 2026-08-07

**Symptom** — A member on the Day Trades desk intermittently gets nothing. The board panel
fails to load, the desk shows a fetch error, a refresh "fixes" it. It is not specific to
0DTE — every route behind the ALB is affected — but it lands hardest here because the desk
polls `/api/market/zerodte/board` and `/marks` continuously while a position is open.

**Evidence** (all first-hand, this session)

1. Burst test, 14 sequential requests to `/api/market/zerodte/board`, 10:10:49–10:11:33 ET:
   **2 of 14 returned 502 (14.3%)** — at 10:11:00 and 10:11:30. The other 12 returned 200
   with a coherent payload (`as_of 2026-08-07T14:10:08.488Z`, 67 setups, 2 ledger rows).
2. The 502 body is Cloudflare's origin error, not an app error:
   `{"status":502,"error_name":"origin_bad_gateway","error_category":"origin",`
   `"ray_id":"a276dcbcf9725c90","timestamp":"2026-08-07T14:10:01Z","zone":"blackouttrades.com"}`
3. Session poller independently caught the same thing: sample `10:09:59` → `board_status 502`.
4. The hydrated `/nighthawk` render at ~09:55 ET logged
   `Failed to load resource: the server responded with a status of 502 (Bad Gateway)` **×5**
   in the browser console on a single page load.
5. CloudWatch `AWS/ApplicationELB`, 1-minute Sum, 35-minute window to 14:10Z — the signature
   that identifies the mechanism:

   | metric | values |
   |---|---|
   | `HTTPCode_ELB_5XX_Count` | 11, 21, 16, 26, 4, 2, 13, 8, 12, 7, 13, 17 (**every minute, sustained**) |
   | `HTTPCode_Target_5XX_Count` | 1, 1 (two datapoints in 35 min) |
   | `TargetConnectionErrorCount` | *(no datapoints — zero)* |

6. All five targets healthy: `10.1.11.142 / 10.1.10.244 / 10.1.10.30 / 10.1.11.85 /
   10.1.10.85`, port 3000, `healthy`, reason `None`.
7. **ELB_5XX high + Target_5XX ~0 + ConnectionError 0 + all targets healthy** is the canonical
   signature of the ALB reusing a pooled keep-alive connection that the target has already
   closed. So I checked both timeouts:
   - ALB: `idle_timeout.timeout_seconds = 120`
   - Target: `.next/standalone/server.js:11-24` reads `KEEP_ALIVE_TIMEOUT` from env and, when
     it is unset/NaN, assigns `keepAliveTimeout = undefined` → **Node's default 5 seconds**.
   - ECS task definition `blackout-production-web:600` — the query for env vars matching
     `KEEP_ALIVE`/`TIMEOUT` returns `[]`. The complete env var list on the container is
     `DATA_SOCKETS_ENABLED, NODE_OPTIONS, PROCESS_ROLE, ZERODTE_CONDOR, ZERODTE_SRC_BREAKOUT,
     ZERODTE_SRC_PIN, ZERODTE_WHOLE_MARKET`. **`KEEP_ALIVE_TIMEOUT` is not set.**

**Root cause** — The ALB holds an idle upstream connection for up to 120s; Node closes it
after 5s idle. When the ALB dispatches a request into a socket the target closed in that
115-second gap, the ALB has no valid response and synthesises a 502. The app never sees the
request, which is exactly why nothing appears in the origin logs — I grepped
`/ecs/blackout-production` for `Error`, `timeout`, `ECONNRESET` and `zerodte/board` across the
7 minutes spanning both observed 502s and found **no** corresponding error line.
Files: `.next/standalone/server.js:11-24` (the `undefined` fallback), ECS task definition
`blackout-production-web:600` (the missing env var), ALB `blackout-production-alb`
(`idle_timeout.timeout_seconds=120`).

**Suggested fix** — Set `KEEP_ALIVE_TIMEOUT` on the web container to comfortably exceed the
ALB idle timeout (e.g. `125000`–`135000` ms) and set `headersTimeout` slightly above that.
AWS's own guidance is that the target's keep-alive must be *longer* than the ALB's idle
timeout, never shorter. This is a task-definition env var, so it can ship without a code
change — but it should be added to the infra definition, not applied by hand, or the next
deploy reverts it.
**Deliberately leave alone:** the ALB idle timeout itself (120s is a reasonable value and other
consumers depend on it — move the target to match it, not the reverse), and the target group's
`deregistration_delay` (already tuned to 30s on 2026-07-22).

**Status** — `BACKLOG — fix after close 2026-08-07`

---

## [P1] FLOW-origin ledger basis can be a premium the member could never pay — the achievability floor is one-sided
**Date:** 2026-08-07

**Symptom** — A FLOW-origin play appears on the board already deep in the red. The member sees
an entry premium they cannot fill at, an instant −20%+ P&L on a position they just opened, and
frequently an immediate stop or thesis-break exit. It also drags the published track record
*down*, because every such play is graded against an inflated basis.

**Evidence** — today's TSLA row, cross-checked against Polygon minute bars.

Ledger row (`GET /api/market/zerodte/board`, `as_of 2026-08-07T14:05:31.542Z`):

```
ticker TSLA · discovery_origin ["FLOW"] · occ O:TSLA260807C00325000
first_flagged_at 2026-08-07T14:03:04.000Z   (10:03 ET)
entry_premium   3.30      flow_avg_fill 3.30      underlying_at_flag 325.71
peak_premium    2.53      trough_premium 1.91-2.26
peak_pnl_pct   -23.33     live_pnl_pct -27.88
status CLOSED · exit_reason "thesis" · exit_at 14:03:25.916Z · exit_pnl_pct -30.91
```

Polygon 1-minute bars for `O:TSLA260807C00325000` on 2026-08-07 (o/h/l/c):

| ET | TSLA | 325C o/h/l/c |
|---|---|---|
| 09:56 | 326.89 | 4.00 / 4.08 / 3.20 / **3.30** |
| 10:01 | 325.79 | 3.15 / 3.15 / 2.29 / 2.60 |
| 10:02 | 325.73 | 2.55 / 2.72 / 2.43 / 2.60 |
| **10:03 (commit)** | **324.89** | 2.58 / **2.58** / 1.98 / 2.09 |
| 10:04 | 323.96 | 2.05 / 2.06 / 1.64 / 1.68 |

At the commit minute the contract's **entire range was 1.98–2.58**. The stamped entry of
**3.30 is the 09:56 close — seven minutes stale** and ~28% above the best price available at
commit. `peak_premium 2.53` confirms it: from the instant of commit the mark never came close
to the recorded basis, so the play was born at −23% and could only go down. It was exited 22
seconds later at −30.91%.

**Control, same session, same board** — PLTR (`discovery_origin ["BREAKOUT"]`,
`flow_avg_fill: null`), `first_flagged_at 14:01:24Z` (10:01 ET), `entry_premium 2.40`,
`underlying_at_flag 168.59`. Polygon 10:01 bar for `O:PLTR260807C00167500`:
`2.27 / 2.69 / 2.16 / 2.42`, and PLTR's 10:01 close was **168.59 — exact to the cent**.
`peak_premium 2.68` vs the bar high 2.69; `trough_premium 1.91` vs the 10:04 low 1.90. The
machinery is correct when there is no flow fill; the distortion tracks the FLOW lane.

**Root cause** — `src/lib/zerodte/plan.ts:209`:
```ts
const entryMax = flowAvgFill ?? mark ?? null;
```
`entry_max` is the smart money's own fill, and the ledger basis resolves from it via
`resolveLedgerEntryPremium` (`src/lib/zerodte/plan.ts:301-309`), consumed by
`gates.ts:850` (`entry_premium: input.plan?.entry_max ?? input.plan?.mark`).
`resolveLedgerEntryPremium` already exists precisely to keep the basis achievable — but it is
**one-sided**:
```ts
if (markAtFlag != null && markAtFlag > 0 && markAtFlag > base) return round2(markAtFlag);
return base;
```
Its docstring states the concern explicitly — *"the graded entry/stop/target could be pinned to
a premium a member filling at the live mark at flag time simply cannot get — a cheaper-than-
achievable basis flatters the win rate"* — and it correctly floors the basis **up** to the mark
when the flow fill sits *below* it. The opposite case, a flow fill sitting *above* the live
mark (the tape has already faded the print), was not considered: `markAtFlag > base` is false,
so the guard is a no-op and the basis stays at the unachievable 3.30. The distortion runs the
other way — it makes the record look *worse* than the strategy is, and shows the member a
losing position the moment it opens.

**Suggested fix** — Make the floor a two-sided **achievability clamp**: the ledger basis should
be the price a member arriving at flag time actually pays, i.e. `markAtFlag` whenever a valid
flag-time mark exists, with the flow fill used only as a fallback when no mark is available.
Keep the member-facing `entry_max` / `stop_premium` / `target_premium` untouched — they are the
"enter at or below" instruction and the existing docstring is right that they should not move.
Only the ledger's grading/tracking reference changes.
**Deliberately leave alone:** the `CHASE_PCT` / `entry_status` MOVED band and the printed plan
instruction — this is about the grading basis, not the trade advice.

**Status** — `BACKLOG — fix after close 2026-08-07`

---

## [P1] Commits are made on stale market inputs — underlying price is a median 4.2 minutes old at commit, never fresher than 69s
**Date:** 2026-08-07

**Symptom** — Plays are committed, sized and gated against a price the market has already left.
The member is entered on a thesis computed from a stale spot, and the entry/stop/target
geometry is anchored to it. Downstream, the exit narrative quotes a price that no longer exists.

**Evidence** — the engine measures this itself and stores it. `entry_context.input_age_manifest`
on every WS-10-era row, read from `GET /api/market/zerodte/record?days=90` (157 plays, 46 carry
the manifest):

| input | n | min | p50 | p95 | max |
|---|---|---|---|---|---|
| `underlying` | 46 | **69.2s** | **250.2s** | 593.8s | **728.1s** |
| `flow` | 15 | 76.4s | 521.4s | 2233.9s | 2233.9s |
| `option_quote` | 0 | — | — | — | — (always null) |
| `gex` / `vix` / `macro` / `spy_bias` | 0 | — | — | — | — (always null) |

**Not a single commit in 46 had an underlying price under 69 seconds old**, and the median was
over four minutes. Worst offenders: QQQ 2026-08-06 at **728s (12.1 min)** → `time_stop -15.31`;
and eight rows on 2026-07-30 all at **594s (9.9 min)** — APLD `stopped -51.91`, NVTS
`stopped -53.30`, RIOT `stopped -53.21`, MARA `time_stop -37.87`, NBIS `time_stop -25.70`,
DELL `time_stop -19.89`, MU `doubled +56.93`, SNXX `time_stop +24.84`.

Corroborated on today's live TSLA row from three independent directions: `underlying_at_flag
325.71` vs Polygon's actual 10:03 close of **324.89**; the Cortex `gex-walls` source quoting
`spot 326.36` as of 14:01:49Z; and the exit narrative quoting **`spot 328.36`** at 14:03:25Z
when TSLA was 324.89 at 10:03 and 323.96 at 10:04 — 328.07 was the **09:55** price, roughly
**8 minutes stale**, embedded verbatim in the member-visible exit reason:

> "Thesis broken (veto) at -30.91% — … long target path crosses dominant call wall 330 (31.49%
> of ladder gamma) 1.64 pts above spot 328.36, inside 0.5x expected move (2.38 pts)."

A directional split on outcome is suggestive but **underpowered and I am not claiming
causality**: rows with `underlying` age >120s ran a 31.7% profitable rate (n=41) vs 60.0%
(n=5) at ≤120s. n=5 is far too small to conclude anything; it is recorded only as a reason to
measure properly after the fix.

**Root cause** — Not yet traced. The manifest proves the staleness and localises it to the
commit path's underlying/flow reads, but I did not identify which cache or provider layer is
serving the aged value. The fact that `option_quote`, `gex`, `vix`, `macro` and `spy_bias` ages
are **null on all 46 rows** means the manifest itself is only partly wired, so the true input
staleness may be broader than the one field that reports.

**Suggested fix** — Two steps, in order. (1) Finish wiring `input_age_manifest` so
`option_quote`, `gex`, `vix`, `macro` and `spy_bias` report real ages instead of null — without
that the blind spots cannot be measured. (2) Add a freshness precondition to the commit gate
stack (a fail-closed `stale_underlying` block in the same family as the existing
`vix_unavailable` / `macro_unavailable` guards) so a commit cannot be stamped against a spot
older than some bound, and re-measure. Fix P1-#2 (entry basis) first — it is the sharper of the
two and independently verifiable.
**Deliberately leave alone:** the scan cadence. Scans run frequently and healthily (see GREEN-2);
this is about the age of the values a scan *reads*, not how often it runs.

**Status** — `BACKLOG — fix after close 2026-08-07`

---

## [P2] 10 of the 30 names in the PIN universe are structurally unreachable — `PIN_EVAL_CAP` was never raised when the universe was expanded
**Date:** 2026-08-07

**Symptom** — Not directly member-visible. The PIN discovery rail silently screens two-thirds
of its configured universe. Ten tickers that were deliberately added "for broader PIN coverage"
have never once been evaluated, so any pin regime forming on them cannot be found. This is
exactly the "silent cap" class the design's Q10 forbids.

**Evidence**

`src/lib/zerodte/pin-discovery.ts` — `DEFAULT_PIN_UNIVERSE` has **30** entries, with a comment
recording the intent: *"Expanded from 14 to 30 names … widening the universe just lets the
regime filter see more candidates."* But `PIN_EVAL_CAP = 20`, and the eval window is a
**list-order slice**, not a ranked one:

```ts
const roots = universe.filter((t) => condorEligibleTicker(t));   // SPX, NDX
const others = universe.filter((t) => !condorEligibleTicker(t));
universe = [...roots, ...others];
const evalCap = Math.max(maxCandidates, PIN_EVAL_CAP);           // max(16, 20) = 20
universe = universe.slice(0, evalCap);
```

`CASH_SETTLED_CONDOR_ROOTS` defaults to `SPX,NDX` (`condor.ts:65-70`), so reordering is a
no-op here and the slice keeps the first 20 in declaration order:

- **EVALUATED (20):** SPX, NDX, SPY, QQQ, IWM, DIA, AAPL, MSFT, NVDA, AMZN, META, TSLA, GOOGL, AMD, NFLX, CRM, AVGO, COST, LLY, JPM
- **NEVER EVALUATED (10):** V, MA, UNH, WMT, PG, JNJ, HD, ADBE, INTC, MU

Confirmed in production, not just inferred. CloudWatch `/ecs/blackout-production` and
`/ecs/blackout-production-market-worker`, every scan pass this session, logs the count verbatim:

```
1786110566593  [zerodte-pin] scanned 20 liquid name(s), no clean pin regime — SKIP
1786110545610  [zerodte-pin] scanned 20 liquid name(s), no clean pin regime — SKIP
1786110475013  [zerodte-pin] scanned 20 liquid name(s), no clean pin regime — SKIP
```

`scanned 20`, never 30 — on every pass, in both services.

The `PIN_EVAL_CAP` comment argues the cap exists so that we *"pick the best regimes, not the
first N list-order names (FINDINGS 2026-07-28)"* — but with a 30-name universe and a cap of 20
applied as `slice(0, 20)`, that is precisely what it does. The ranking it describes happens
*after* evaluation (`.sort((a,b) => b.score - a.score).slice(0, maxCandidates)`), so it can only
rank names that survived the list-order cut.

**Root cause** — `src/lib/zerodte/pin-discovery.ts`: `PIN_EVAL_CAP = 20` (declared ~line 77)
against a 30-entry `DEFAULT_PIN_UNIVERSE` (~lines 51-58), sliced in list order at the
`universe.slice(0, evalCap)` line in `discoverPinSetups`. The universe was widened 14→30
without raising the cap, and the cap's own comment masks the effect.

**Suggested fix** — Raise `PIN_EVAL_CAP` to at least `DEFAULT_PIN_UNIVERSE.length` (or drop the
slice and let the post-evaluation score ranking do the selecting, which is what the comment
already claims happens). If the cap exists for cost reasons — each evaluated ticker costs a GEX
heatmap read plus a chain fetch — then make that explicit and add the evaluated/skipped counts
to the log line so the truncation is visible rather than silent.
**Deliberately leave alone:** the five regime conditions and their thresholds. They are strict
by design and there is no evidence today that they are miscalibrated — PIN legitimately found
no pin (see GREEN-3).

**Status** — `BACKLOG — fix after close 2026-08-07`

---

## [P2] Admin 0DTE health panel's rejection metrics are permanently zero — a JS `Date === string` comparison that can never be true
**Date:** 2026-08-07

**Symptom** — Admin-only. The "0DTE Command health" panel reports `candidates_scanned 0`,
`rejected_count 0` and `rejection_rate null` on a session where the scanner rejected 146
candidates. One of the three metrics that panel exists to surface is dead, and it reads as an
honest "nothing scanned yet" rather than as a broken metric — so it is silently misleading.

**Evidence** — two admin endpoints, same session, same underlying table, queried **within the
same second**:

`GET /api/admin/zerodte/health` — `generated_at 2026-08-07T13:48:16.163Z`:
```json
{"session_date":"2026-08-07","db_configured":true,
 "candidates_scanned":0,"committed_count":0,"rejected_count":0,"rejection_rate":null,
 "rejections_sample_capped":false,"errors":[]}
```

`GET /api/admin/zerodte/funnel` — `generated_at 2026-08-07T13:48:15.898Z`:
```json
{"session_date":"2026-08-07","detected_tickers":47,"gate_blocked_events":200,
 "commit_events":0,"rejection_rows":146,"errors":[]}
```

`errors: []` on both, so neither leg failed — health genuinely fetched rows and then counted
zero of them. A sample rejection row from the funnel, unambiguously today's session:
`{"observed_at":"Fri Aug 07 2026 13:31:21 GMT+0000","ticker":"GLD","gate_failed":"max_itm_pct","direction":"long"}`.

**Root cause** — `src/lib/admin-zerodte-health.ts:150`:
```ts
const todaysRejections = rejections.filter((r) => r.session_date === sessionDate);
```
where `sessionDate = todayEt()` → the string `"2026-08-07"`.

`zerodte_scan_rejections.session_date` is a Postgres **`DATE`** column (`src/lib/db.ts:1384`).
`fetchZeroDteScanRejections` (`src/lib/db.ts:3790-3830`) selects it raw and declares its return
type as `session_date: string` — a **false annotation**. The repo documents the actual behaviour
in its own helper at `src/lib/db.ts:2740`: *"node-postgres returns DATE columns as JS Date
objects by default (no setTypeParser override here) … Any raw-query consumer of a DATE column
must funnel through here"* (`isoDateString`). Nothing normalizes this path, so the filter
compares a `Date` object to a string with `===`, which is **always false**. Hence
`todaysRejections` is always `[]` → `rejected_count = 0`, `candidates_scanned =
committed_count + 0`, and `rejection_rate = null` whenever nothing has committed.

The asymmetry is the proof: `src/lib/admin-zerodte-funnel.ts:250` passes `session_date` **into
the SQL query** (`fetchZeroDteScanRejections({ session_date: sessionDate })`), where Postgres
does the comparison correctly — which is why the funnel sees 146 and health sees 0.

**Suggested fix** — Either push the filter into SQL as the funnel already does (pass
`session_date` to `fetchZeroDteScanRejections`), or normalize via the existing `isoDateString`
helper before comparing. Pushing it into SQL is preferable: it fixes the bug and removes the
over-fetch. Separately, correct the `session_date: string` annotation on
`fetchZeroDteScanRejections`'s return type to reflect what pg actually returns, or add a
`setTypeParser` for `DATE` globally — the false annotation is what let this pass type-checking
and will let the next one through too.
**Deliberately leave alone:** the funnel endpoint (it is correct), and the `committed_count`
leg (it reads `zerodte_setup_log` through a different path and was 0 legitimately — nothing had
committed at 13:48Z; the first commit landed at 14:05Z).

**Status** — `BACKLOG — fix after close 2026-08-07`

---

## [P2] Board served a stale, much smaller snapshot on one poll — 58 setups + 1 ledger row → 10 setups + 0 ledger rows → back to 58
**Date:** 2026-08-07

**Symptom** — A member watching the desk sees the board collapse to a fraction of its plays and
**their open position vanish from the ledger**, then reappear ~90 seconds later. With a live
position open, that is alarming in a way a slow refresh is not.

**Evidence** — consecutive samples from the session poller (90s interval), all HTTP 200:

| ET | `as_of` | setups | ledger | `discovery_funnel.top_gate_n` |
|---|---|---|---|---|
| 10:05:23 | `14:05:04.129Z` | 58 | **1** | 200 |
| **10:06:54** | **`14:04:48.799Z`** | **10** | **0** | **246** |
| 10:08:27 | `14:05:04.129Z` | 58 | **1** | 200 |

The middle response carries an **older `as_of`** (14:04:48.799Z vs 14:05:04.129Z) *and* a
different funnel count, so it is a genuinely different backing snapshot, not a partial render.
The service runs 5 web tasks (`blackout-production-web`, running 5/5), which is consistent with
per-task board state and a poll landing on a task holding an older, less-populated snapshot.

A follow-up 14-request burst at 10:10:49–10:11:33 ET did **not** reproduce it — all 12 non-502
responses were identical (`as_of 14:10:08.488Z`, 67 setups, 2 ledger rows). So this is
intermittent, observed once, and I am not over-claiming a persistent replica split.

**Root cause** — Not yet traced. The evidence localises it to snapshot propagation across the
5 web tasks but I did not identify the write/read path that allows a task to serve a stale
board.

**Suggested fix** — Investigate whether the board snapshot is per-task in-memory or shared via
the Redis key; if per-task, either move the read to the shared snapshot or have the client
reject a payload whose `as_of` is older than one it has already rendered (a monotonic `as_of`
guard on the client is cheap and would mask the flicker regardless of the server-side cause).
Worth pairing with the P0 above, since both concern how the 5 web tasks are fronted.
**Deliberately leave alone:** the 90s poll cadence — this reproduced at the API level, so it is
not a client polling artifact.

**Status** — `BACKLOG — fix after close 2026-08-07`

---

## [P1] The live-marks lane drops OPEN positions — its tracked set collapsed from 64 contracts to 2 inside four minutes, losing 2 of 4 open plays
**Date:** 2026-08-07

**Symptom** — A member with an open Day Trades position stops getting live P&L updates on it.
`/api/market/zerodte/marks` (and the SSE stream it backs) is the fast lane that drives the
ticking mark and live P&L on the desk; when a position falls out of that payload, its number
goes static while the position is still live and still at risk.

**Evidence** — resolved directly against the board's own ledger, 10:18 ET:

`GET /api/market/zerodte/board`, `as_of 2026-08-07T14:17:33.685Z`, 7 ledger rows —
**4 OPEN**, 3 CLOSED:

```
NBIS  OPEN    O:NBIS260807P00180000  entry 2.36  last_mark 2.22  live_pnl  -5.93
RIOT  OPEN    O:RIOT260807P00020500  entry 0.35  last_mark 0.38  live_pnl   8.57
SKHY  OPEN    O:SKHY260807P00134000  entry 1.60  last_mark 1.68  live_pnl   5.00
APLD  OPEN    O:APLD260807P00028000  entry 0.39  last_mark 0.39  live_pnl   0
TTD   CLOSED  · TSLA CLOSED · PLTR CLOSED
```

`GET /api/market/zerodte/marks`, `as_of 2026-08-07T14:18:29.414Z` — **n = 2** (cap 100).
Matching the four OPEN rows' OCC symbols against the marks payload:

> **OPEN ledger rows: 4 | present in marks: 2**
> MISSING FROM MARKS: **NBIS** OPEN `O:NBIS260807P00180000`
> MISSING FROM MARKS: **SKHY** OPEN `O:SKHY260807P00134000`

The tracked-set collapse is visible across the poller samples — each with a **fresh**
`marks.as_of`, so this is not a stale-payload artifact:

| ET | `marks.as_of` | marks n | statuses |
|---|---|---|---|
| 10:13:02 | `14:13:02.002Z` | 56 | HOLD 1, WATCH 55 |
| 10:14:37 | `14:14:38.272Z` | **64** | WATCH 64 (**0 entered, with 2 ledger rows**) |
| 10:16:08 | `14:16:09.308Z` | **13** | HOLD 3, WATCH 10 |
| 10:17:40 | `14:17:41.079Z` | **12** | HOLD 2, WATCH 10 |
| 10:18:29 | `14:18:29.414Z` | **2** | — |

64 → 13 → 12 → 2 in roughly four minutes, against a `cap` of 100 that was never approached.
Note the 10:14:37 sample separately: 64 tracked contracts, **zero** carrying an
`entry_premium`, while the board simultaneously reported 2 ledger rows — so at that instant the
marks lane knew about no position at all.

Across the whole poll, of the 7 samples where the board carried ledger rows, **6 showed fewer
entered contracts in marks than the board showed ledger rows**. Some of that gap is legitimate
(a CLOSED row correctly has no live mark), which is why the 10:18 ET check above was done
against OPEN rows only — and it still shows 2 of 4 missing.

**Root cause** — Not yet traced. The board's own `last_mark` / `live_pnl_pct` remain populated
for the missing rows, so the failure is specific to the marks lane's tracked-contract set
(`src/lib/zerodte/live-marks.ts` — `ensureZeroDteMarkPoller` and the roster it builds), not to
quote availability. I did not identify what evicts an open play's contract from that roster.

**Suggested fix** — Make membership of the marks roster **guaranteed** for every non-CLOSED
ledger row, independent of whatever churn drives the watch-only set: build the roster as
`open ledger contracts ∪ (watch set, truncated to cap)` so watch-list rotation can never evict
a position the member actually holds. Add an assertion/alarm on the invariant
`every OPEN ledger row has a marks entry` — it is cheap and is exactly what this audit had to
reconstruct by hand.
**Deliberately leave alone:** the watch-only set's churn and the 100 cap — rotating candidates
in and out is expected and the cap was never reached; the defect is that open positions are
being treated as part of that rotation.

**Status** — `BACKLOG — fix after close 2026-08-07`

---

## [P3] PIN discovery has no persisted observability — zero rejections reach any HTTP surface
**Date:** 2026-08-07

**Symptom** — Admin-only. When PIN produces nothing, no endpoint can say why, or even confirm
that it ran. "PIN evaluated its universe and found no pin" and "PIN never ran / threw" are
indistinguishable from outside the container. This audit could only answer the question because
AWS credentials happened to be valid and I could read CloudWatch directly.

**Evidence** — `/api/admin/zerodte/funnel` carries `by_gate` (opening_window 164, min_gross 131,
min_aggr_share 26, max_itm_pct 19, min_dominance 6), `by_kind` (gate_blocked 200, detected 117),
317 `raw_events` and 146 `raw_rejections` — and **not one row attributable to PIN**. That is
structurally correct rather than a data loss: a ticker that fails `evaluatePinRegime` never
becomes a candidate, so it never reaches the gate stack that persists events. But it means the
rail is invisible.

`src/lib/zerodte/pin-discovery.ts` emits only `console.info` — lines 171, 177, 181, 199, 231,
290, 293. The BREAKOUT source is the same (`breakout-discovery.ts` lines 222, 230, 241, 283,
314, 420), but BREAKOUT's output is self-evidently non-empty on the board, so its silence costs
less.

**Root cause** — By design, not a defect: `discovery-events.ts` persistence is wired to the gate
stack, and per-ticker PIN regime rejections happen upstream of it. `pin-discovery.ts` never
calls a persist function.

**Suggested fix** — Persist a per-ticker PIN regime verdict (the failing condition among the
five: posture / not_bracketed / band_width / wall_dominance / offset) as a discovery event, or
at minimum surface a per-source summary on `/api/admin/zerodte/funnel` — evaluated count,
skipped-by-cap count, and the failure-mix histogram. That would have answered this session's
PIN question without CloudWatch, and it is what makes the P2 cap finding above visible.
**Deliberately leave alone:** the console lines — they are useful and cheap; this is about
adding a queryable surface, not removing logs.

**Status** — `BACKLOG — fix after close 2026-08-07`

---

## [P3] 0DTE scan p95 latency is 53 seconds against a p50 of 300ms
**Date:** 2026-08-07

**Symptom** — Not directly member-visible, but a scan pass that takes ~53s while the board's
inputs are already minutes stale (see P1-#3) widens the window in which a commit is priced
against a market that has moved.

**Evidence** — `GET /api/admin/zerodte/health`, `generated_at 2026-08-07T13:48:16.163Z`,
`latency` block (n=18 passes):

| stage | count | p50 | p95 | p99 |
|---|---|---|---|---|
| `scan_duration` | 18 | **300 ms** | **52,963 ms** | 52,963 ms |
| `derive` | 18 | 191 ms | 287 ms | 287 ms |
| `chain` | 18 | 74 ms | **45,623 ms** | 45,623 ms |
| `gates` | 18 | 0 ms | **23,687 ms** | 23,687 ms |

The tail is dominated by `chain` (option-chain fetch, 45.6s) with `gates` also spiking to 23.7s,
while `derive` stays flat at ~200-290ms. n=18 is small and p95≡p99 means the tail is one or two
passes, so this is a signal to investigate rather than a measured steady state.

**Root cause** — Not yet traced. The stage split points at the option-chain fetch as the
dominant contributor.

**Suggested fix** — Instrument the `chain` stage per-ticker to find whether the tail is one slow
upstream call or fan-out across many tickers, then bound it (per-ticker timeout with the
partial result kept, rather than the whole pass waiting). Re-measure with a larger n before
changing anything.
**Deliberately leave alone:** the p50 — 300ms end-to-end is healthy and should not regress in
pursuit of the tail.

**Status** — `BACKLOG — fix after close 2026-08-07`

---

## [P3] `411 Length Required` on every hydrated desk render — likely sandbox transport, not confirmed against prod
**Date:** 2026-08-07

**Symptom** — Two `Failed to load resource: the server responded with a status of 411 (Length
Required)` console errors on every load of `/nighthawk`, at both viewports.

**Evidence** — reproduced in two independent renders through the routed-Chromium harness
(`scripts/audit/live-ui-audit.cjs`): desktop 1440×900 at ~09:55 ET and iPhone 430×932 at
~10:00 ET, exactly ×2 each time. Candidate sources are the two `navigator.sendBeacon` call
sites (`src/components/auth/AuthFailureObserver.tsx:26`,
`src/components/ClientErrorReporter.tsx:32`), both of which POST a `Blob`.

**Root cause** — Not traced, and **I am flagging this as probably an artifact of this sandbox
rather than a production defect.** The harness fulfils every request over a manual
`CONNECT` + `tls.connect()` tunnel because Chromium here has no network access; a POST relayed
without a `Content-Length` through that tunnel would produce exactly this. I could not
distinguish the two from inside the sandbox.

**Suggested fix** — Confirm from a real browser against production before spending any time on
it. If it reproduces there, check that the `sendBeacon` payloads carry a length.
**Deliberately leave alone:** everything, until it is confirmed outside the sandbox.

**Status** — `BACKLOG — fix after close 2026-08-07`

---

# VERIFIED GREEN — with numbers (do not re-check tonight)

**GREEN-1 · Infrastructure and feature flags.** `blackout-production-web` running **5/5**,
rollout COMPLETED; `blackout-production-market-worker` running **2/2**, rollout COMPLETED.
Discovery flags on the worker task definition: `ZERODTE_WHOLE_MARKET=on`,
`ZERODTE_SRC_BREAKOUT=on`, `ZERODTE_SRC_PIN=on`, `ZERODTE_CONDOR=on`. All five ALB targets
healthy. (Caveat: the same task definition is missing `KEEP_ALIVE_TIMEOUT` — see P0.)

**GREEN-2 · FLOW and BREAKOUT discovery are producing continuously.** 25 CloudWatch
`[zerodte-scan] discovery rail mix` lines across 13:34–13:49Z, growing monotonically:
`total=25 FLOW=6 BREAKOUT=19` → `total=46 FLOW=8 BREAKOUT=40 multi=2`. Board setups over my
19-sample poll: 34 → 67. BREAKOUT's own pass log is healthy and honest about drop-off:
`30 breakouts + 20 breakdowns (pool), built 27 setup(s) (18L/9S) from walk 30L+20S attempted=50
no_chain=3 no_0dte=0 no_same_day=20 1dte_fallback=0 err=0`. `upstream_ok=true` on 18/19 samples
(the 19th was the P0 502).

**GREEN-3 · PIN's emptiness is legitimate, not a failure.** PIN ran on **every** scan pass in
both services and rejected cleanly: `[zerodte-pin] scanned 20 liquid name(s), no clean pin
regime — SKIP`, logged at 13:38:09Z, 13:39:35Z, 14:06:58Z, 14:07:02Z, 14:07:55Z, 14:09:05Z and
14:09:26Z among others. The regime is a strict five-condition conjunction (long gamma posture;
spot bracketed between walls; band width 0.4–6%; both walls ≥4% of ladder gamma; spot 0.25–0.9
off-centre) and today's tape did not produce one. Separately capped — see P2.

**GREEN-4 · Grading arithmetic is exact, on both windows.**
30-day (`since 2026-07-08`, 21 sessions): 136 flagged, 136 graded, 0 ungraded,
**48 + 88 + 0 = 136**, WR 35.3%, avg −7.34%.
90-day (`since 2026-05-09`, 24 sessions): 157 flagged, 146 graded, **53 + 93 + 0 = 146**,
WR 36.3%, avg −4.90%.
Every sub-bucket also reconciles internally — `by_outcome`, `by_time_of_day`, `by_direction`
each sum to the graded total, and every published `win_rate_pct` matches `wins/n` to within
0.1pp. Checked programmatically across all buckets in both windows: **zero** mismatches.

**GREEN-5 · The mid-vs-official grading invariant holds.**
`scripts/audit/outcome-grading-audit.mjs --days=90`: 157 plays scanned (111 legacy/pre-WS10,
46 WS-10 executable-graded), both graders had evidence on 146, **agreement 146/146 (100.0%),
0 disagreements**. An improvement on the 126/130 (96.9%, 4 disagreements) recorded 2026-08-05.

**GREEN-6 · "STOPPED with a positive P&L" is correct, not a bug — investigated and cleared.**
7 rows show `plan_outcome: "stopped"` with a `plan_pnl_pct` far from −50% (META 2026-08-03
+3.41, SPXW 2026-07-29 +7.77, MU 2026-07-29 +6.25, WDC 2026-08-06 −29.63, SPY 2026-07-31
−25.34, AMD 2026-07-29 −26.94, INTC 2026-07-29 −27.00). Checking each against
`entry_context.executable`: **all seven carry `mid_plan_outcome: "stopped"` with
`mid_plan_pnl_pct: -50` exactly**, and `managed_source: "reconstructed"`, `lane: "conservative"`.
These are the documented mid-vs-official lanes — the mechanical mid grade did hit the −50% stop;
the official as-managed grade reflects trims banked before it. Per
`docs/audit/OUTCOME-GRADING-SPEC.md` this is intentional. Across the 90-day window 32 of 157
rows show this legitimate divergence. **Not a defect — do not re-open.**

**GREEN-7 · The `opening_window` gate works, proven live.** Across 14 poller samples from
09:42 to 10:02 ET, `opening_window` blocked **every** setup on the board (34/34, 40/40 …
55/55, verdicts `{"BLOCKED": N}` with no exceptions). At the **10:03:52** sample the gate
disappeared from the block mix entirely and the first `COMMIT` verdict appeared
(`{"BLOCKED":54,"COMMIT":1,"none":1}`), with `session.heat.state` flipping `OPENING_DRIVE` →
`RTH`. The first ledger row landed at **10:05:23**. Corroborated historically: in the 90-day
record, **no play has been flagged before 10:00 ET since 2026-07-17** — the 36 pre-10:00 rows
all fall on 2026-07-06 … 2026-07-17.

**GREEN-8 · Live marks are fresh and internally coherent.** 19 samples over 28 minutes:
`mark_age_ms` max — min 293ms, p50 879ms, p95 4,799ms, max 4,799ms. **0 marks flagged stale,
0 null marks across all samples.** On a full 29-mark snapshot: `mid == (bid+ask)/2` on 29/29 to
within half a cent, **0 rows with bid > ask**, all `source: "mid"`.

**GREEN-9 · Marks cross-check against live Polygon option quotes.** 28 of 29 contracts resolved
(the 29th, `O:SPXW260807C07700000`, 404s on the per-underlying snapshot route — my query shape,
not an app defect). Tight names agree closely: TE `0.10/0.20` vs Polygon `0.10/0.20` (0.0%),
SPCX 3.45 vs 3.50 (−1.4%), MU 16.60 vs 16.70 (−0.6%), ABNB 2.685 vs 2.56 (+4.9%), QQQ 2.675 vs
2.495 (+7.2%). Greeks track well — e.g. TE delta 0.3381 vs 0.3304, vega 0.000752 vs 0.000749;
QQQ gamma 0.058652 vs 0.060751. Wider divergences are confined to wide-spread illiquid
contracts quoted at different instants (SNDK app `7.5/8.2` vs Polygon `4.4/4.8`; TEAM app
`5.0/7.0` vs Polygon `2.8/5.5`) and are not evidence of a mark defect on their own.

**GREEN-10 · Iron-condor geometry is well-formed on every setup.** All **43/43** setups on the
authenticated board carry condor geometry passing every structural check: `long_put < short_put
< short_call < long_call`, symmetric wings, `wing_pts` equal to the measured put-side width,
`est_win_rate` in (0,100], and `gross_wing_risk_per_side == wing_pts × 100` exactly. Example
(CLSK): `short_put 12.5 / long_put 12 / short_call 13 / long_call 13.5`, `wing_pts 0.5`,
`gross_wing_risk_per_side 50`, `est_win_rate 97`, `est_intraday_breach_pct 18.7`,
`skew "negative"`. No live CONDOR play was routed — it requires a PIN candidate, and there were
none (GREEN-3), so the engine is proven wired but not exercised end-to-end today.

**GREEN-11 · Malformed numbers: clean.** Scanned every numeric leaf of the authenticated board
(158,747 B / 43 setups), marks, `record?days=30`, `record?days=90` and calibration for
float-representation artifacts (the `7499.360000000001` class): **0 found**. The only
high-precision values are greeks (`gamma` 6dp, `vega` 6dp), which is deliberate precision, not
a rounding miss. `roundFloats` is doing its job on these surfaces.

**GREEN-12 · Entitlement and caching.** Anonymous: `/api/market/zerodte/board` → **401**,
`/marks` → **401**, `/record` → **401**, `/nighthawk` → **307 → /sign-in?redirect_url=%2Fnighthawk`.
Authenticated: all 8 endpoints returned 200 with
`Cache-Control: private, no-cache, no-store, must-revalidate, max-age=0`, and `/nighthawk`
served `cf-cache-status: DYNAMIC` at both UAs — the auth-dependent-chrome edge-cache hazard
documented in CLAUDE.md does not apply here.

**GREEN-13 · Mobile and desktop rendering of the live desk.** Hydrated DOM measured through
`scripts/audit/live-ui-audit.cjs`. iPhone **430×932**: 1,100 DOM nodes, title
`Night Hawk · BlackOut`, **horizontal overflow 0px**, **0 tap targets under 44×44**, 0 unlabeled
controls, 0 unlabeled inputs, 0 images missing alt, 0 heading-order jumps, exactly 1 `<h1>`,
**0 page errors**, 123 routed requests with 0 failures. The #1842 touch-target fix holds on the
live deck. Desktop **1440×900**: 982 nodes, overflow 0px, 0 page errors; three sub-44px targets
remain, all in the marketing nav rather than the deck (`Features▾ 102×36`, `FAQ 61×36`,
`Learn 71×36`).

**GREEN-14 · Commit → manage → exit is coherent on real rows.** PLTR (BREAKOUT, `status OPEN`):
`entry_premium 2.40`, `last_mark 2.38`, `live_pnl_pct −0.83` — and (2.38−2.40)/2.40 = −0.83% ✓.
`live_pnl_pct_exec −2.08` computed off the bid (2.35) ✓. `peak_premium 2.68` /
`trough_premium 1.91`, `exit_policy` = `trim_scale` with `hard_stop_pct −50`, `target_pct 100`,
trims at +20%/+33% and +50%/+33%, `stop_premium 1.20` (= 2.40 × 0.5 ✓), `target_premium 4.80`
(= 2.40 × 2 ✓), `time_stop_et 15:50`. `thesis_health` carries a full 10-pillar decomposition
(health 63, entryIndex 83, delta −20, rung `WEAKENING`) with per-pillar deltas that sum
correctly. TSLA (`status CLOSED`): `exit_reason "thesis"`, `exit_at`, `exit_pnl_pct` all
populated and consistent with `last_mark`. The governor tracked it correctly throughout —
`open_plans [{"ticker":"PLTR","direction":"long"}]`, `premium_at_risk 2`, `session_pnl_pct 0`,
`effective_max_concurrent 85` under a `time_of_day_sizing_factor 0.85`. The entry *basis* on
the TSLA row is the subject of P1-#2; the lifecycle mechanics around it are sound.

---

# COVERAGE — what I could NOT check

- **The live-marks roster mechanism (P1-#4).** Confirmed the symptom precisely against the
  board's own OPEN rows; did not trace which code path evicts a held contract from the roster.
- **A live iron condor end-to-end.** No CONDOR play was routed today (it requires a PIN
  candidate; there were none). Geometry is verified on all 43 setups, but net credit on a real
  4-leg fill, live breach tracking and condor grading were **not** exercised.
- **A stop-out and a grading cycle on today's rows.** The session's first commits landed at
  10:05 ET; nothing reached the −50% stop or the 15:50 time-stop inside my window. The −50%
  stop invariant was verified against the historical record instead (GREEN-6), not live.
- **Raw Postgres.** Blocked from this sandbox by design. Everything DB-side was validated
  through the app's REST surfaces. Ledger-row internals not exposed by an endpoint were not
  inspected.
- **SSE / WebSocket lanes.** `/api/market/zerodte/marks/stream` and
  `/api/market/stocks/spot-stream` time out through the agent proxy (WS/streaming upgrades are
  unsupported here). The REST fallback for both was validated instead. **A regression in the
  SSE lane specifically would not have been caught by this audit.**
- **Un-entitled (signed-in, non-premium) view.** I verified anonymous vs admin+premium.
  A signed-in free-tier member's view of `/nighthawk` was not rendered — the temp-user helper
  mints admin+premium, and minting a second differently-tiered user was not worth the Clerk
  FAPI rate-limit risk with four other audit agents running concurrently.
- **The P2 board-flicker's mechanism.** Observed once with full evidence; a follow-up 14-request
  burst did not reproduce it, so the propagation path is unidentified.
- **Whether the P0 502 rate varies by route or by hour.** I measured it on
  `/api/market/zerodte/board` (14.3% of 14 requests) and saw the ALB-wide metric; I did not
  break the ELB 5XX count down per target group or per path.
- **The full afternoon session.** My window closed around 10:15 ET. Late-session behaviour —
  the 15:30 directional cutoff, the 15:50 time-stop, post-close grading — was not observed.

---

# METHOD NOTES

- **One authenticated pass per purpose**, temp Clerk user always released in a `finally`
  (3 mints total across the run: the deep API/page probe, and two UI renders). Cron-bearer
  auth (resolved from Secrets Manager, not the stale sandbox env var) carried the rest, which
  kept Clerk FAPI pressure low while four other agents were running.
- **Time-sampled, not single-shot**: a 90-second poller captured 19 board+marks snapshots from
  09:42 to 10:10 ET. The P0 and P2 above were both found by that poller and would have been
  invisible to a single probe — this is the technique that earned its keep today.
- Scratch artifacts live outside the repo, under
  `…/scratchpad/nh0dte-audit/` (poller log, per-sample board/marks snapshots, Polygon
  cross-check scripts). **Nothing was written into the working tree except this file.**
- No branch, no commit, no push, no PR — per the operator's RTH coordination rule.
