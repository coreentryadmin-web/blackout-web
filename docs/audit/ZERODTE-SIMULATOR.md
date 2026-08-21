# 0DTE Night Hawk — ADMIN-ONLY SIMULATION VIEW

A way for an admin to open a URL in a browser and **watch a simulated 0DTE session play
through the REAL Night Hawk panel** on production — while every member keeps seeing the
real, untouched board. Members can never see sim data.

## Watch URL

```
https://blackouttrades.com/nighthawk?sim=1
```

Open it while signed in **as an admin** (Clerk `publicMetadata.role === "admin"` or an
`ADMIN_EMAILS` address). A persistent amber **"SIMULATION — not live"** banner shows on
the 0DTE deck while sim mode is active. Drop the `?sim=1` and you are back on the real
member board immediately.

## Seed / drive it

Feed board frames on a clock with the admin sim feeder (authenticates as a temporary
admin Clerk user, deleted in a `finally`):

```bash
# Full synthetic RTH arc — a RENDER-STATE SWEEP (every board state a member can see; see the
# coverage matrix below). The five canonical names lead:
#   NVDA long/FLOW → +80% (TRIM) · TSLA long/BREAKOUT → +40% · META long → +30% target
#   SPX iron CONDOR/PIN → +76% time_stop · AMD long put/FLOW → −50% STOPPED
npm run sim:feed -- --synthetic --base=https://blackouttrades.com

# Replay a captured session (array of { etMinute, payload }):
npm run sim:feed -- --replay=./session.json --base=https://blackouttrades.com

# Faster (ET-minutes advanced per real second; default 60):
npm run sim:feed -- --synthetic --speed=120

# Preview the frame schedule without authenticating or posting:
npm run sim:feed -- --synthetic --dry-run
```

Secrets are read from env only (`CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`)
and never printed. The feeder prints the exact watch URL on start.

### Render-state coverage matrix (`--synthetic` as a visual test harness)

`--synthetic` is a **render-state sweep**: every board state a member can see is exercised
by at least one play, so watching the arc (or reading a mid-session frame with `--dry-run`)
walks the whole UI surface. `--dry-run` also structurally validates every generated frame
against the same `isZeroDteBoardPayload` contract the admin ingest enforces and reports
`invalid frames: 0` (plus a one-line coverage summary of the fullest frame).

| Render state | Play | How it's produced |
|---|---|---|
| **WATCH** (pre-commit, never commits) | `QQQ` | a `setups` row, gate `WATCH`, no ledger row |
| **SKIP** (evaluated, gate-blocked) | `IWM` | a `setups` row, gate `BLOCKED` |
| **OPEN** (fresh, in the ±10% entry band) | `GOOGL` | mark hovers within ±10% of entry all session |
| **HOLD** (working, out of the entry band) | `TSLA`, `COIN`, `F`, `NFLX`, `SMCI`, `SNOW` | mark past the band, not closed |
| **TRIM** (post-target, sticky) | `NVDA` | rides to +80%, latched TRIM |
| **CLOSED · target** | `META` | `closed_reason: 'target'`, +30% |
| **CLOSED · ratchet** | `AMZN` | `closed_reason: 'ratchet'`, ratchet floor exit +50% |
| **CLOSED · time_stop** (directional) | `MSFT` | `closed_reason: 'time_stop'` at 15:30 |
| **CLOSED · time_stop** (condor winner) | `SPX` | PIN condor, credit decays → +76% time_stop |
| **CLOSED · stopped** (directional) | `AMD` | `closed_reason: 'stopped'`, pinned −50% |
| **CLOSED · stopped** (condor breach) | `SPXW` | PIN condor breached → −50% |
| **breakeven (~0%)** | `COIN` | mark hovers on entry, P&L ~0% |
| **tiny premium ($0.05-ish)** | `F` | entry `0.05` (sub-dime formatting) |
| **huge premium** | `NFLX` | entry `42.0` (wide-number formatting) |
| **STALE mark** (staleness dim) | `SMCI` | `mark_as_of` ~90s old (> `ZERODTE_MARK_STALE_MS`) |
| **NO mark ("—")** | `SNOW` | `last_mark: null`, P&L null |

The condor rows carry `is_condor: true` on the ledger row. Add a state → add a play (or a
`setups` row) and it shows up in the `--dry-run` coverage summary automatically.

## Reset

```bash
npm run sim:feed -- --reset          # clears the sim Redis key
# or directly:
curl -X DELETE https://blackouttrades.com/api/admin/zerodte/sim/board   # (admin cookie)
```

The sim key also carries a short TTL (default 30 min, `ZERODTE_SIM_BOARD_TTL_SEC`), so an
abandoned sim self-expires with no manual reset.

## Isolation guarantee — why members can NEVER see sim data

Three **independent** layers guard the member board; all three must hold before a byte of
sim data reaches a browser:

1. **Admin auth gate.** The ingest endpoint (`POST/DELETE /api/admin/zerodte/sim/board`)
   is `requireAdminApi()` — 401/403 for anyone else. The board GET route only consults
   the sim key after re-checking `isAdminUser` server-side. A non-admin who appends
   `?sim=1` gets the **member** board (proven by the `shouldServeSimBoard` truth-table
   test).
2. **Separate Redis key.** Sim frames live in `zerodte:board:snapshot:sim:v1`
   (→ `blackout:…`), a **different** key from the member snapshot
   `zerodte:board:snapshot:v1`. The sim module (`src/lib/platform/zerodte-sim-board.ts`)
   never reads or writes the member key — a bug there physically cannot corrupt what
   members see. (Enforced by a test that greps the module for the member-key literal.)
3. **Opt-in `?sim=1` param.** Absent the param, the board GET route runs the **unchanged**
   member path (`getZeroDteBoardPayload()`) for everyone, admin included.

### Member-path-unchanged proof

The board route's default path is byte-for-byte the same call it always made:
`getZeroDteBoardPayload()`. The sim behavior is an **added branch in front of it**, gated
on `isSimRequested(?sim) && authResult.via === "user" && isAdminUser(...)`. Any request
that isn't an admin explicitly asking for sim falls straight through to that untouched
call. In sim mode the client also **disables the real live-marks SSE overlay**, so no real
member marks are ever painted onto the simulated board.

## Files

- `src/lib/platform/zerodte-sim-board.ts` — isolated sim key, TTL, the `shouldServeSimBoard`
  gate, payload validation, read/write/clear (+ `.test.ts`).
- `src/app/api/admin/zerodte/sim/board/route.ts` — admin-only ingest (POST/DELETE).
- `src/app/api/market/zerodte/board/route.ts` — added the gated sim read branch.
- `src/features/nighthawk/command-deck/containers.tsx` — `?sim=1` propagation + banner.
- `scripts/audit/zerodte-sim-feed.mjs` (`npm run sim:feed`) — the feeder.

---

# 0DTE Simulator — how to WATCH a session play through the real UI

**What this is.** A way to watch the real Night Hawk 0DTE board panel play through a whole
session — winners committing at 10:00, trimming, riding a floor, exiting green, plus one
stopped loser — **without any live market data**, so the operator can eyeball the panel
(and demo it) before Monday's open. Built 2026-07-25.

Two levels:

- **Level-1 (BUILT — `scripts/audit/zerodte-sim-replay.mjs`):** a snapshot **replayer**.
  It writes pre-baked `ZeroDteBoardPayload` snapshots (+ matching `nw:optmark` marks) to
  the target Redis on a **virtual clock**. The board route serves whatever snapshot is in
  Redis, so this alone drives the panel. No pipeline runs.
- **Level-2 (SCOPED, not built — see §Clock-seam):** run the **real scan→gate→grade
  pipeline** on a virtual clock against recorded provider fixtures. Needs a single
  injectable-clock seam. This doc enumerates every wall-clock read and ranks the effort.

---

## Level-1 replayer — run it

### Prerequisites
- A **Redis** instance the app also reads (`REDIS_URL`). **MUST be non-prod / scratch.**
- The **app running on a browser-capable env** (a CI runner, a device, your laptop) so
  you can actually *see* the panel. **This sandbox cannot render pixels** (headless
  Chromium egress is blocked — see CLAUDE.md "Access reality" #2); it can only write the
  Redis keys and validate the payloads. Point a real browser at the running app's
  `/nighthawk` (0DTE Command) panel while the replayer runs.

### Commands
```bash
# Validate the synthetic session + print its timeline — writes NOTHING (no Redis needed):
node scripts/audit/zerodte-sim-replay.mjs --synthetic --dry-run

# Drive the real panel through a winning session (~13 min real at 30x):
node scripts/audit/zerodte-sim-replay.mjs --synthetic --speed=30 --redis=redis://localhost:6379

# Replay a recorded sequence of real board snapshots on the clock:
node scripts/audit/zerodte-sim-replay.mjs --replay=session.json --speed=60 --redis=...

# Clear the keys when done:
node scripts/audit/zerodte-sim-replay.mjs --reset --redis=...

# Full flag reference:
node scripts/audit/zerodte-sim-replay.mjs --help
```

### Modes & flags
- `--synthetic` — generate a plausible **winning** session (see shape below).
- `--replay=<file.json>` — replay recorded board snapshots. Schema:
  ```json
  { "frames": [
      { "et": "10:05", "board": { /* a full ZeroDteBoardPayload */ },
        "marks": { "O:NVDA260724C00182000": { "bid": 3.9, "ask": 4.0, "mark": 3.95, "last": 3.95 } } }
  ] }
  ```
  `et` is `"HH:MM"` ET (or minutes-since-midnight). Each frame publishes when the virtual
  clock reaches its ET; the latest frame at-or-before "now" is the one shown (step
  function). Each `board` is validated on load (a warning is printed, never fabricated).
- `--speed=N` — virtual seconds per real second (default **30** → a 6h RTH day in ~13 min).
- `--redis=<url>` — target Redis (default `$REDIS_URL`).
- `--key-prefix=<p>` — app key prefix (default `blackout:`, what `sharedCacheSet` uses).
- `--dry-run` — print the timeline + validate every frame; **write nothing**.
- `--force` — override the foreign-live-snapshot safety refusal (see §Safety).
- `--start-et=HH:MM` / `--end-et=HH:MM` — synthetic window (default 09:45–15:50).

### Synthetic session shape (the `--synthetic` winning day)
Five finds appear as **WATCH** cards from 09:45 (gate-BLOCKED with a G-2 "unlock 10:00"
reason), then **commit into the ledger at 10:00** and evolve on live P&L:

| Ticker | Structure / origin | Entry | Arc |
|---|---|---|---|
| NVDA | long call / **FLOW** | 3.20 | trims ⅓@+25% (10:20) + ⅓@+50% (10:50), runner **CLOSED +80% ratchet** @ 13:30 |
| TSLA | long call / **BREAKOUT** | 2.50 | trim @+26% (11:00), **CLOSED +40% ratchet** @ 14:00 |
| META | long call / **FLOW+BREAKOUT** | 1.90 | trim @+20% (10:40), **CLOSED +30% target** @ 13:10 |
| SPX | **iron CONDOR** / **PIN** | 5.00 cr | pin holds, credit decays, **CLOSED +76% time_stop** @ 15:30 |
| AMD | long put / FLOW | 1.80 | goes wrong, **CLOSED −50% STOPPED** @ 11:15 (the realism loser) |

The panel walks OPEN → TRIM → CLOSED per row, with peak/trough latching, ratchet-floor
guidance, and per-row exit reasons/sentences. Marks (`nw:optmark:<OCC>`) are written each
tick with a real-wall-clock `ts` so `getLiveOptionMark`'s freshness check passes.

---

## Injection seams (verified in code 2026-07-25)

- **Board panel ← Redis `blackout:zerodte:board:snapshot:v1`** = `JSON.stringify(ZeroDteBoardPayload)`.
  Written by `refreshZeroDteBoardSnapshot()`/`buildAndPublishBoard()` via `sharedCacheSet`
  (which prefixes every key with `blackout:` — `src/lib/shared-cache.ts:120`). Read back by
  `getZeroDteBoardPayload()` (`src/lib/platform/zerodte-service.ts`) and served **verbatim**
  by `GET /api/market/zerodte/board` to the SWR-polling panel. **Writing this key renders
  the panel** — the read path does NOT re-run the scan/grader on a Redis-read snapshot, so
  a hand-built payload shows exactly as written. This is the whole Level-1 mechanism.
- **Open-play marks ← Redis `blackout:nw:optmark:<OCC>`** = `JSON.stringify({bid,ask,mark,last,ts})`
  (`OptionMark`, `src/lib/ws/options-socket.ts:211,235`). Read by `getLiveOptionMark`.
  **Caveat:** the SSE marks frame (`getZeroDteLiveMarksFrame`, `live-marks.ts`) derives its
  *tracked set* from the **DB ledger** (`fetchZeroDteSetupLog`), so a `nw:optmark` write only
  **surfaces** on the SSE lane if a matching DB ledger row exists. This tool deliberately
  **does not touch the DB**, so on a clean scratch env the SSE P&L animation needs those DB
  rows too — but the **board snapshot's own ledger rows already carry `last_mark` /
  `live_pnl_pct` / `peak` / `trough`**, so the **panel animates fully from the snapshot
  alone**. The `nw:optmark` writes are a best-effort bonus for an env that also has ledger
  rows.

## Safety guards
- Touches **only three Redis key families** under the app prefix:
  `zerodte:board:snapshot:v1`, `nw:optmark:*`, and its own sidecar `zerodte:sim:marker:v1`.
- **Refuses to run** against a Redis that already holds a **live-looking board snapshot not
  written by this tool** (a fresh/`available:true`/non-empty snapshot with **no sim marker**)
  unless `--force`. Its own prior synthetic snapshots carry the sim marker and are always
  safe to overwrite. This is the guard that stops it stomping a real/prod board.
- **Never** touches Postgres or any provider API. `--dry-run` writes nothing at all.
- **Point it at a scratch Redis.** The refusal is a backstop, not a substitute for that.

## Validation
`assertValidBoardPayload()` (exported from the script; exercised by
`scripts/audit/zerodte-sim-replay.test.mjs`, `node --test`) structurally checks every frame
against the real `ZeroDteBoardPayload` / `ZeroDteBoardLedgerRow` / `EnrichedZeroDteSetup`
contracts (field presence + types + the `closed_reason` / origin / horizon enums). A
malformed payload won't render, so `--synthetic`/`--dry-run` validate the **entire** RTH arc
up front and abort on any invalid frame. Replay frames are validated on load (warn, never
fabricate).

---

## §Clock-seam — the audit that scopes Level-2

**Goal of Level-2:** run the REAL `scanZeroDteBoard → gates → cortex → grade` pipeline on a
**virtual clock** (against recorded provider fixtures), so the panel shows the real engine's
decisions replaying, not pre-baked snapshots. That requires making every "what time is it
now" read injectable. This is the complete enumeration of those reads on the
scan→gate→grade path.

**Legend:** *INJECTED* = the function already takes `now`/`today`/`nowEtMinutes` as a
parameter (no change needed). *HARDCODED* = it calls a global now-helper (`Date.now()`,
`new Date()`, `etNowParts()`, `todayEt()`) directly.

### The two primitive helpers (`src/features/nighthawk/lib/session.ts`)
| helper | line | reads | injectable? |
|---|---|---|---|
| `etNowParts()` | 93–107 | `new Date()` → Intl ET parts | **HARDCODED** — no param |
| `todayEt()` | 29–31 | `todayEtYmd()` → `new Date()` | **HARDCODED** — no param |
| `isTradingDayEt(ymd)` | 45–52 | — (pure on `ymd`) | INJECTED (takes ymd) |
| `nextTradingDayEt(from?)` | 54–63 | `new Date()` only when `from` omitted | INJECTED-able (pass `from`) |
| `mostRecentTradingDayEt(now=new Date())` | 83–91 | `now` default | INJECTED (has `now` param) |
| `isBeforeOrAtMarketCloseEt(ymd, now=new Date())` | 114–130 | `now` default | INJECTED (has `now` param) |

These two — **`etNowParts()` and `todayEt()`** — are the only primitives with no injection
point. Everything below funnels through them or through `Date.now()`.

### `src/lib/zerodte/scan.ts` — the orchestrator (ALL hardcoded reads live here)
`scanZeroDteBoard` and its helpers call the now-helpers directly ~25 times:

| line(s) | read | role |
|---|---|---|
| 194, 416, 458, 814, 1178, 1376, 1481, 1521, (readZeroDteLedgerChecked) | `todayEt()` | session date for candidate/gate/grade/persist |
| 197, 250, 252, 348, 351, 368, 459, 750, 866, 1174, 1466 | `Date.now()` | `nowMs` for staleness, spike window, cortex, governor stops |
| 290, 328, 360, 417, 815, 1419 | `etNowParts()` | → `nowEtMinutes` for G-2/timeofday/confluence |
| 689 | `new Date(nowMs)` | passed INTO `evaluateCortexForCommit` (on an already-read `nowMs`) |
| 996, 1138, 1234, 1251 | `Date.parse(...)` | **NOT wall-clock** — parses stored row timestamps (`last_seen`, `first_flagged_at`) |

All the wall-clock reads are **hardcoded** here, but they are read **once per stage and then
threaded down as parameters** — which is why the downstream stages are already injectable.

### Downstream stages — ALREADY fully parameterized (no hardcoded now-read)
| file | evidence | verdict |
|---|---|---|
| `gates.ts` | `ZeroDteGateInput` carries `nowEtMinutes`, `nowMs`, `biasAsOfMs`, `todayYmd`; the only `Date` uses are `etLabel(input.nowEtMinutes)` (951) and `Date.parse(input.todayYmd/echo.edition_for)` (973–974) — all on **injected** inputs | **INJECTED** — 0 hardcoded |
| `plan.ts` | `buildContractPlan({quoteAgeMs})` + `shouldExit({nowEtMinutes})` take time as params; `new Date(epochMs)` (306) formats a **given** instant | **INJECTED** — 0 hardcoded |
| `board.ts` | `deriveZeroDteSetups(opts.nowMs)` (613) is injected by scan.ts:250; `Date.parse(...)` (700/715/735/1287) parse **stored** row timestamps, not "now" | **INJECTED** — 0 hardcoded (one `?? Date.now()` fallback at 744 when caller omits `nowMs`) |
| `confluence.ts` | `computeConfluence(setup, nowEtMinutes)` / `attachConfluence(setups, nowEtMinutes)` | **INJECTED** — 0 hardcoded |
| `exit-engine.ts` | `new Date(nowMs).toISOString()` (571) on an **injected** `nowMs` | **INJECTED** — 0 hardcoded |

### Tally
- **Wall-clock reads on the scan→gate→grade path: ~27** (`Date.now()` ×~11, `etNowParts()`
  ×~6, `todayEt()` ×~9, `new Date(nowMs)` passthrough ×1) — **all in `scan.ts`** — plus the
  **2 primitive helpers** (`etNowParts`, `todayEt`).
- **Already parameterized: gates.ts, plan.ts, board.ts, confluence.ts, exit-engine.ts —
  five of the six pipeline files, i.e. every stage DOWNSTREAM of the orchestrator.** They
  take `now` as input today.
- **Hardcoded and needing the seam: `scan.ts` (the single orchestrator) + the two
  `session.ts` primitives.**

### Minimal Level-2 seam
Introduce **one injectable clock object** threaded from the scan entry points:

```ts
type SimClock = {
  nowMs(): number;                                   // replaces Date.now()
  etParts(): { hour: number; minute: number; weekday: string }; // replaces etNowParts()
  todayYmd(): string;                                // replaces todayEt()
};
const REAL_CLOCK: SimClock = { nowMs: Date.now, etParts: etNowParts, todayYmd: todayEt };
```

Thread a `clock: SimClock = REAL_CLOCK` param into `scanZeroDteBoard`, `warmZeroDteBoard`,
`gradeZeroDteLedger`/`readZeroDteLedgerChecked`, and replace the ~27 direct
`Date.now()`/`etNowParts()`/`todayEt()` calls in `scan.ts` with `clock.*`. **Nothing
downstream changes** — the five parameterized stages already accept the values scan.ts
computes, so scan.ts simply passes `clock`-derived values where it already passes
`nowMs`/`nowEtMinutes`/`today`. (Optionally give `board.ts:744`'s `?? Date.now()` fallback
the same clock for completeness.)

### Effort ranking
- **Wiring the clock through `scan.ts`: LOW–MEDIUM.** One file, ~27 mechanical call-site
  swaps + a thin clock object with a prod default. No downstream signature churn.
- **Grading on the virtual clock: LOW** (same clock into the grader entry; the grader
  already works off **bar timestamps + `today`**, both injectable).
- **The real cost is NOT the clock — it's the FIXTURES:** feeding the pipeline recorded UW
  flow (Postgres), Polygon chains/bars, VIX, macro, and GEX at each virtual instant. That's
  a separate provider-injection layer (the existing audit harnesses — `zerodte-sim.mjs`,
  `firewall-rth-replay.mjs` — already stub some of these against real Polygon REST and are
  the natural place to build it). **The clock seam is the cheap 20%; the fixture layer is
  the 80%.**

**Recommendation:** land the `SimClock` seam in `scan.ts` first (small, self-contained,
independently useful for deterministic tests), then build the fixture-replay layer on top.
Do **not** implement here — this is audit + scope only.
