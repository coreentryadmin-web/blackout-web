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

## WATCH LIST — HELIX, first session on 2026-08-24 (read this before the routine pass)

Fourteen HELIX fixes merged over 2026-08-22/23. **Twelve are member-facing and none has been seen
under a moving tape.** §5k is the highest-impact item on this list and should be checked first —
its **parse half is now live-validated off-hours (2026-08-23) and needs no re-run**; what remains
there is the consequence, which only a moving tape can show. Every one was validated off-hours at best, and three could not be validated at all
because the population they act on does not exist while the market is closed. This section is the
list of things that are *only* checkable at the open, with the baseline each one must be diffed
against.

**Run the whole list, then the routine pass.** Order matters only for step 0.

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
- **Check the refusal works:** `— UNREAD` must appear **only** where the `Ask%` column is genuinely
  absent. If `— UNREAD` dominates a busy tape, `ask_pct` coverage has regressed — measured at
  **29.1% of all rows but ~96.9% of Group A**, and split flow only ever sees Group A.
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
    the live session and compare. Capture the before/after firing counts — a large jump is the fix working,
  but it is also a large change in what members are shown, and it is the coordinator's call whether
  the thresholds still suit a population 3× larger.
- **The coverage note must be GONE, not merely smaller.** It rendered *"Scanned 103 of 500 prints —
  397 (SPX, SPY) carry no reported print time"*. At 5000/5000 eligible the note renders **nothing**
  by design, so on the open both radars should show no coverage line at all. A note still naming
  SPX or SPY means that request's tape disagrees with this measurement — capture it, it is news.
- **The mobile `~` marker (5f) should mostly disappear** on SPX/SPY rows — they will have real print
  times rather than ingest estimates. A row still showing `~` after this is a row that genuinely has
  no parseable time, which is now a much smaller and more interesting population.
- **Sanity-check the times themselves, do not just count them — partly answered.** A magnitude-scaled
  epoch that picked the wrong unit yields a plausible-looking but wrong instant. The 363-minute span
  over 5000 prints above rules out a unit error by three orders of magnitude in either direction.
  What it does NOT rule out is a small forward skew, so still compare a handful of new `event_at`
  values against the same prints' `alerted_at` under a moving tape: they should be close, and
  `event_at` should never be in the future. #2725 keeps a future-stamped print out of both
  detectors, so a future value would be silently *excluded* rather than visibly wrong — check the
  ineligible count, not the radars.

### 6. Open questions an RTH session can actually answer

These are recorded as needing a decision; RTH is when the data exists to inform them.

- **The `whale`-outranks-`0dte` collision** (`db.ts:2646`). `route` is `premium >= $1M ? 'whale' : expiry = TODAY ? '0dte' : 'stock'`, so the largest 0DTE prints never get the 0DTE badge. **Unmeasurable off-hours** — the closed window holds **zero** `dte === 0` rows. At the open, count prints with `expiry = TODAY` **and** `premium >= $1M`: that is the exact population being denied the badge.
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

