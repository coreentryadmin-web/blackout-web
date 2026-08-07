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

