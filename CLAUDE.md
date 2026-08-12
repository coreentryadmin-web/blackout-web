# CLAUDE.md — operating memory for BlackOut Trades audits

(Repo also has `AGENTS.md` — the general agent playbook. This file captures the
standing **audit + issue-handling policy**. Keep it and `docs/audit/FINDINGS.md` updated.)

## Issue-handling policy (standing instruction)
As soon as an issue is spotted during any audit/validation:
1. **Open a new branch off `main`**, named `fix/<slug>`. Do NOT push straight to `main`.
2. **Fix it and add a test** (extend the nearest `*.test.ts`; run `npx tsx --test <file>`).
3. **Log it in `docs/audit/FINDINGS.md`** only when fixing a real bug in the same PR as the code fix — never open a docs-only PR for verify passes or GREEN audit logs.
   Every entry must carry a **`> **kind:** `FINDING`` line** and a real outcome — either a
   `| **Status** | ... |` row or an outcome in the heading (`## ... — FIXED`). `src/findings-hygiene.test.ts`
   enforces this; if it fails on your new entry, run `node scripts/audit/findings-reconcile.mjs --apply`
   (idempotent — safe to re-run) and commit the result. Routine GREEN pass logs go in
   `docs/audit/RUN-LOG.md`, not here.
4. **Open a PR to `main`, verify CI is green, then auto-merge it.** Keep the PR small (one issue per branch/PR).
Documentation/policy changes (this file, FINDINGS, runbook) merge the same way once verified.

**Merge authorization — standing, ongoing (confirmed 2026-07-06):** auto-merge every
verified PR into `main` once local checks (tsc/test/build/lint as applicable) and required CI
(`verify`) are green. Do **not** stop to ask for per-PR merge approval; do **not** wait for a
human review. Enable GitHub auto-merge (`gh pr merge --auto --squash --delete-branch`) as soon as
the PR is open and mergeable — the repo's `automerge.yml` does this automatically for `cursor/*`
branches; agent branches named `fix/*` or `cursor/*` must still be merged by the agent if CI
passes before the workflow fires. This supersedes any earlier "leave OPEN for end-of-day review"
language in `FINDINGS.md` or elsewhere. Still exercise judgment on scope/blast-radius per the PR
write-up policy below, and still keep PRs small/single-issue — the standing authorization is for
**merging**, not for skipping verification or scope discipline.

**Do not auto-merge:** draft PRs; PRs with failing required CI; Dependabot major-version bumps
until CI is fixed; changes the user explicitly flags as deploy-risky (hold on a branch until
they say go).

## PR write-up policy (standing instruction)
Every PR — fix or docs — gets a deep, clean write-up so Cursor (a parallel agent working the
same repo) can read the diff cold and understand it without asking follow-up questions:
- **Root cause**, not just symptom: the exact broken logic/line, why it was wrong, and why it
  wasn't caught earlier.
- **Evidence**: live numbers, header captures, or a before/after test run — whatever actually
  proved the bug, not just an assertion that it exists.
- **Blast radius**: every other call site/consumer touched by the same root cause (duplicated
  logic in a second file counts — fix and note all of them, not just the one you tripped over).
- **Fix rationale**: why this fix and not an alternative; what was deliberately left unchanged.
- In-code comments on the non-obvious parts (the WHY, per the repo's normal comment policy) so
  the reasoning survives even if the PR description is skimmed.

## Vector E2E validation — STAGING DECOMMISSIONED (2026-07-25)
The Vector **per-push E2E gate** (`vector-staging-e2e.mjs`) and the **HARDCORE** deep-value/dynamism
suite (`vector-hardcore-e2e.mjs`) both ran against the **staging** environment
(`staging.blackouttrades.com`, Cognito temp users, the `blackout-staging/app/env` secret). **Staging
was fully decommissioned on 2026-07-25** — ECS, RDS, RDS Proxy, all 27 crons, the cron Lambda,
Cognito, ALB, the dedicated VPC/NAT, secrets, IAM roles, log groups and the ACM cert are all deleted.
Both harnesses and their `npm run validate:vector-*` scripts were removed with it.
- **There is no staging deploy target anymore.** Vector (and every) change ships straight to
  **production** (`ecr-push-production.yml` on merge to `main`) and is validated against prod with the
  read-only tools below (`data-validator.mjs`, `firewall-rth-replay.mjs`, the market-open runbook)
  plus the `verify` CI gate. Do NOT reference the deleted `blackout-staging-*` stack or
  `staging.blackouttrades.com`.
- If a pre-prod render/value gate is wanted again, **stand up a fresh ephemeral target first** and
  point a new harness at it — the old one is gone on purpose.

## Audit toolkit (committed)
- `scripts/audit/data-validator.mjs` — cross-provider validator (Polygon+UW ground truth vs the numbers members see: prices/indices, GEX/greeks, track-record math, malformed-number scan). Secrets from env only; one temp Clerk user per run, always deleted. Exits non-zero on any FAIL.
- `scripts/audit/zerodte-e2e-suite.mjs` (`npm run validate:e2e`) — **pre-open E2E validation gate** across FOUR sections, worst-verdict rollup, **exits non-zero if any REQUIRED section is RED**: **API-POLYGON** (every Polygon/Massive upstream the 0DTE pipeline reads — LIVE — HTTP-200 + schema-shape + sanity-value: grouped-daily ~12.4k rows, VIX 5–90, SPX 1000–20000, option chain carries greeks/last_quote, reference contracts, unified OCC snapshot); **API-UW** (flow-alerts data[], SPX spot-exposures/strike GEX, greek-exposure, screener, darkpool, net-flow/expiry, earnings pre/afterhours); **INFRA** (RDS `blackout-production-postgres` available/Multi-AZ + ElastiCache `blackout-production-redis-rg` available/failover via the AWS CLI — **SKIPPED, never RED, when AWS creds are absent/placeholder**); **DATA-PATH** (Redis board-snapshot path via `/board` + Postgres read path via `/record`, through ONE temp admin Clerk user deleted in `finally` — raw TCP to PG/Redis is blocked here, so validate THROUGH the app). Self-defaults `POLYGON_API_BASE` to `api.massive.com` primary with `api.polygon.io` fallback (first 200 wins, sticky). Pure schema/sanity validators live in `lib/e2e-schema-checks.mjs`, unit-tested by `zerodte-e2e-suite.test.ts` (`npx tsx --test`). Never prints secrets. Flags: `--json --provider=polygon|uw --quiet`. Companion doc: `docs/audit/MONDAY-RTH-READINESS.md` (the full play-generation BLOCKER trace + open checklist). First live run 2026-07-25: all required GREEN (off-hours ambers = empty greeks/trades), DATA-PATH GREEN (111 graded record rows), INFRA SKIPPED (sandbox AWS placeholder creds).
- `scripts/audit/zerodte-sim.mjs` (`npm run sim:0dte`) — **0DTE play simulator** for "what does this change do to today's plays?" Runs the REAL pipeline (`flowAccumulationByTicker` → `buildDeterministicEditionPlays`/`pickChainContract` → `filterPlaysByMaxDte` → `gradePlanFromBars`) against REAL data (multi-day UW flow + live Polygon chains + Polygon minute bars) and prints a per-stage FUNNEL + per-ticker GATE TRACE + generated plays; `--grade=YYYY-MM-DD` backtests a past session with minute-bar outcomes (doubled/stopped/time-stop) on a probed ATM 0DTE contract. Flags: `--days=N --min-premium=N --max-tickers=N --max-dte=N --tickers=A,B --grade=DATE --json --quiet`. Self-defaults `POLYGON_API_BASE`; run with `env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY`. Candidate discovery = the accumulation engine (not the full market-wide discovery); see FINDINGS 2026-07-22 for the scope boundary. **Use it to measure any 0DTE change before/after.**
- `scripts/audit/market-banger-scan.mjs` (`npm run scan:bangers`) — **whole-market banger scanner.** Screens EVERY US stock (Polygon grouped-daily, ~12.4k/day) for breakout/momentum movers (gain%, volume, close-strength, price/liquidity filters), ranks by $-volume, and suggests a cheap OTM weekly call per name. `--grade=YYYY-MM-DD` backtests: measures `maxRet` (top-tick) vs hold-to-expiry vs **REALIZED return under a mechanical scale-out** (partial at 2× + trailing runner + hard stop) — the exit rule that converts fleeting bangers into EV (finding them is easy; exiting is the edge — see `docs/audit/0DTE-RESEARCH.md`). Flags: `--date --grade --min-gain --min-vol --top --price-min --price-max --json`. Self-defaults `POLYGON_API_BASE`; run with `env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY`.
- `scripts/audit/condor-wr.mjs` (`npm run wr:condor`) — **0DTE iron-condor win-rate backtest** (the reproducible evidence behind the high-WR premium-SELLING engine). Sweeps short-strike widths against REAL minute bars (WIN = close inside both shorts) → the `CONDOR_WINRATE_BY_WIDTH` table in `src/lib/zerodte/iron-condor.ts`; also grades the SHIPPED `selectIronCondor` geometry and reports the honest intraday-BREACH rate (the negative-skew tail). `SPY,QQQ,IWM × 25 sessions`: ±0.6%→77%, ±0.8%→92%, shipped target-80 →98.7% WR / 18.7% breach. Flags: `--tickers --days --end --entry --target --wing --dates --json`. Self-defaults `POLYGON_API_BASE`; run with `env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY`. **Calibration-first: evidence, not gating — the ledger graduates it before it sizes real risk.**
- `scripts/audit/zerodte-e2e-healthcheck.mjs` (`npm run healthcheck:0dte`) — **LIVE end-to-end health check for the whole 0DTE "Night Hawk" system** against PROD. One repeatable run that asserts EVERY subsystem is live/producing/tracking/grading and prints a per-stage GREEN/AMBER/RED matrix: **(A)** INFRA/CONFIG (ECS web + market-worker healthy + `ZERODTE_*` discovery flags present — SKIPPED, not RED, when AWS creds absent; never prints secrets), **(B)** DISCOVERY ×3 (FLOW/BREAKOUT/PIN each present, or AMBER with the captured gate/governor/heat reason), **(C)** COMMIT/LEDGER (entry premium + frozen cortex/tier snapshot + origin per committed row), **(D)** LIVE MARKS+P&L (fresh mark staleness bound + Polygon option-quote cross-check), **(E)** EXIT MGMT (OPEN/HOLD/TRIM/CLOSED coherence; a stopped row shows the −50% stop P&L), **(F)** IRON CONDOR *(first-class stage, never skipped)* — real 4-leg geometry (short/long both sides, net credit, wings, breach) + tracking, and **(G)** GRADING/RECORD (`wins+losses+breakeven==graded`). READ-ONLY; one temp Clerk user, always deleted (self-heals leftovers); authenticates once. Exits NON-ZERO if any non-skipped stage is RED (pre-open gate). Flags: `--json --quiet --stage=A,B,...`. Self-defaults `POLYGON_API_BASE`; **run WITH AWS creds when available** for stage A (`node --import tsx scripts/audit/zerodte-e2e-healthcheck.mjs`). Pure verdict/coherence helpers in `scripts/audit/lib/zerodte-healthcheck-eval.mjs` (unit-tested). See `docs/audit/MARKET-OPEN-VALIDATION.md`.
- `scripts/audit/gex-depth-validate.mjs` — **synthetic order book (depth ladder) live validator.** Runs the REAL `buildGexDepthLadder` against REAL Polygon chains and checks it against the levels production already serves: (1) our closed-form BS gamma vs the PROVIDER's gamma at spot, measured RAW before the anchor is applied (post-anchor they agree by construction, so comparing there is a tautology); (2) that the ladder agrees with ITSELF — `shares` differences dealer DELTA while `gamma` sums closed-form GAMMA, computed independently, so calculus requires them to line up; (3) cumulative == running sum of marginals. Built BEFORE the view on the principle that a visualization of a number nobody has checked is worse than no visualization. **It caught three real defects unit tests could not** — a `crossing` derived from flow direction (which turns at spot in EVERY long-gamma book), two successive wall checks that conflated a PER-STRIKE quantity with a WHOLE-BOOK one, and gamma sampled at a band edge while shares integrate across the band. **Measured 2026-08-12: raw BS-vs-provider agreement is 0.1% (TSLA), 0.7% (ASTS), 1.7% (NVDA) but 9.5% (SPY), 15.8% (QQQ), 21.7% (IWM) — the gap IS the dividend yield our r=q=0 form does not model**, which is why the ladder is ANCHORED to the matrix's own `gex.total` at spot. Flags: `--tickers --json`. Run with `env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY NODE_USE_ENV_PROXY=1`.
- `scripts/audit/depth-ladder-ui-audit.mjs` — **depth-ladder live UI audit** (desktop 1440 + phone 430). Opens the Depth tab on prod `/heatmap` through the CONNECT-tunnel Chromium and asserts the ladder actually painted: rung count, bar count, spot row, legend, the honest-limits note, zero console errors, and no horizontal body overflow. **Proves the PAGE loaded before judging the FEATURE** — it requires the long-shipped Matrix tab first, because without that guard a blank page, a 404 or an auth bounce all report "Depth tab not found", which reads as a product defect when it is a harness failure. One temp Clerk user, deleted in a `finally`. Run from the REPO ROOT with `NODE_USE_ENV_PROXY=1`.
- `scripts/audit/firewall-rth-replay.mjs` — **fail-closed firewall RTH replay** (before/after counterfactual). Replays a session's live 0DTE board OLD (guards off) vs NEW (Phase-0 firewall) and diffs which plays each fail-closed guard (far-OTM cap, G-4 `vix_unavailable`, G-7 `macro_unavailable`, cortex `veto_blind`, earnings-all-ranks) would have HELD, grading the delta on real minute bars → loser-avoided vs winner-forgone + net session P&L. Read-only vs prod (one temp Clerk user, deleted). Run with `env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY -u POLYGON_API_BASE node --import tsx scripts/audit/firewall-rth-replay.mjs`. First run (2026-07-24) held both committed plays, both losers, −54.9% avoided — see FINDINGS.
- `scripts/audit/discovery-recall-probe.mjs` — **discovery recall probe** (design Q10, "no silent caps"). Screens a session with the REAL production screens and splits the qualifying pool at the REAL production cut — momentum re-rank (`rankMoversForChainFetch`) then the **dynamic** cap `clamp(ceil((long+short qualifying) × 0.30), 40, 100)` — into KEPT(rank 1…cap) vs DROPPED(cap+1…pool end), grading each name's intraday continuation on REAL Polygon minute bars (favorable-first long-call proxy) → per-cohort win-rate + the specific dropped winners the cut never saw. The shared split helper is `scripts/audit/lib/breakout-cohort-split.mjs` (unit-tested), also used by `breakout-dynamic-n-ab.mjs`. Read-only, Polygon-only (no UW/DB/Clerk). Flags: `--grade=YYYY-MM-DD --dates=A,B,C --fav=0.015 --entry=10:00 --concurrency=12 --json`. Run with `env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY`. **Corrected 2026-08-06** — it previously split cohorts with `screenBreakoutMovers(...).slice(0, KEEP)` ($-volume order, static cap), an ordering production has not used for weeks, so **every BREAKOUT recall number recorded before 2026-08-06 is void** (including the old "`BREAKOUT_MAX_CANDIDATES`=6 / top-6 by $-volume / leaky" summary that used to sit here). Corrected 13-session run (2026-07-20…08-05): KEPT 44.1% (n=1287) vs DROPPED 50.0% (n=1485), dropped tail ≥ kept on 7/13 — win rate does NOT decay with momentum rank, i.e. the ranking (not the cap size) is the component without demonstrated signal. No engine change was made; see `docs/audit/INTENTIONAL-DESIGN.md` §4.
- `scripts/audit/merge-precedence-ab.mjs` — **merge-precedence A/B** (INTENTIONAL-DESIGN item #1). Re-grades a session's multi-origin DISAGREEMENT rows under FLOW-first (shipped) vs evidence-weighted precedence, reading the frozen `entry_context.origin_maps` (WS-06: `origin_direction_map`/`origin_score_map`/`direction_owner`, versioned by `MERGE_POLICY_VERSION`) and grading BOTH candidate directions identically on REAL Polygon minute bars (favorable-first proxy) → which precedence graded better. Offline, read-only, changes NO board behavior. Committed rows are a DB product (raw Postgres blocked here), so pass a ledger export with `--ledger=<path.json>`; else prints INSUFFICIENT DATA (never fabricates a disagreement). Self-defaults `POLYGON_API_BASE` (`/^https?:/` guard); run with `env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY`. Flags: `--ledger --fav --entry --json`.
- `scripts/audit/veto-flicker-rate.mjs` — **Cortex veto-flicker rate** (INTENTIONAL-DESIGN item #2). Over a session's ordered scan passes, measures how often a Cortex veto CLEARS within N subsequent passes (`--within`, default 3) → flicker rate + median passes-to-clear + per-ticker churn — evidence for whether a dwell/hysteresis on the stateless veto (`cortex-gate.ts` recomputes fresh each pass) is warranted. Offline, read-only. Pass `--passes=<path.json>` (per-pass rosters with `cortex_decision` — exact) or `--rejections=<path.json>` (`zerodte_scan_rejections` `cortex_veto*` codes — approximate); else prints INSUFFICIENT DATA. No Polygon/network needed. Flags: `--passes --rejections --within --json`.
- `scripts/audit/wall-temporal-stability.mjs` — **PIN wall temporal stability** (INTENTIONAL-DESIGN item #3). Runs the REAL production `evaluatePinRegime`/`pinScore` on each of a session's GEX-wall snapshots, splits qualifying pins into multi-snapshot-STABLE vs SINGLE-snapshot, and grades each fade on REAL Polygon minute bars → do stable walls grade better (evidence for a temporal-stability requirement on the single-snapshot pin test). Offline, read-only. Intraday GEX snapshots are a server-side UW product not reachable offline, so pass `--snapshots=<path.json>` (built by `scripts/audit/gex-wall-snapshot-poll.mjs`, the live intraday poller — authenticates through the app the same way `data-validator.mjs` does and polls `GET /api/market/gex-heatmap?ticker=<T>` on an interval, deriving callWall/putWall/pct/posture with the exact same math `computeGexWalls`/the gamma-flip regime use); else prints INSUFFICIENT DATA (never fabricates a wall). Self-defaults `POLYGON_API_BASE` (`/^https?:/` guard); run with `env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY`. Flags: `--snapshots --min-snaps --wall-tol --fav --entry --json`. First attempt 2026-08-05: poller built + smoke-tested live (real auth, real prod data) but RTH was closed (~10h to next open) with no reusable earlier-session capture, so the actual stability measurement is still INSUFFICIENT DATA — see FINDINGS.md for the exact re-run command.
- `scripts/audit/outcome-grading-audit.mjs` — **outcome-grading cross-check** (turns feature-store.ts's comment-only invariant into a tested one). `feature-store.ts`'s `labelFromPlanOutcome` claims byte-identical win/loss agreement with `record.ts`'s `isZeroDteWin`, but the former reads the raw MID (mechanical) `plan_outcome`/`plan_pnl_pct` DB columns while the latter prefers the OFFICIAL WS-10/WS-11 executable/reconstructed-trim-scale lane (`entry_context.executable`) — the two CAN disagree once a row has been executable-graded. Imports BOTH real production functions live (never reimplements), fetches real graded rows from the already-live `GET /api/market/zerodte/record` (raw mid values recovered off `entry_context.executable.mid_plan_outcome`/`mid_plan_pnl_pct`, which WS-10 stamps redundantly), and flags every disagreement. Pure comparison helpers in `scripts/audit/lib/grading-agreement-eval.mjs` (unit-tested, `npx tsx --test`). Flags: `--days=90 --base= --ledger=<path.json> --json`. Self uses `scripts/audit/lib/audit-auth-fetch.mjs` (cron-bearer first, Clerk fallback, temp user released after). First live run 2026-08-05, 90-day window: 141 plays, 30 WS-10/WS-11 executable-graded (the population that can even test the invariant), 130 with evidence on both sides, **126/130 agree (96.9%), 4 real disagreements** (MU/SPXW/META 2026-07-29..08-03: mid `stopped` −50% vs official WIN via WS-11 partial-banking; OKLO 2026-07-30: mid `time_stop` win vs official small loss). See `docs/audit/OUTCOME-GRADING-SPEC.md` for the full grader inventory this measurement is one check out of.
- `scripts/audit/largo-card-deadspace.mjs` — **Largo card dead-canvas measurement + per-block height calibration.** Renders composed cards OFFLINE (no network, no auth) and scans the PNG for the largest interior gap — the space the evidence leaves ABOVE the pinned footer, which is the packer's cumulative height over-estimate made visible. `--calibrate` renders ONE block at a time and prints estimate-vs-drawn per block per size. Built because `compose.ts` packs against per-block ESTIMATES that nothing had ever compared to pixels: two were wrong by ~2×, producing a card that printed "ALSO MEASURED, NO ROOM ON THIS CARD" above 23% blank canvas (FINDINGS 2026-08-11). Bundle fixture is `src/lib/largo/visual/fixture-bundle.ts`, declared `VisualBundle` so tsc rejects an invented shape. Two gotchas it encodes: measure blankness against each ROW's own left-edge pixel (the shell paints a gradient AND a 1px border, so a global-background test reports a 0px gap on a card that is a quarter empty), and measure to the start of the largest gap, not the last drawn pixel (that is always the pinned footer). Run: `node --import tsx scripts/audit/largo-card-deadspace.mjs [--calibrate] [--sizes=a,b] [--out=DIR] [--json]`. A unit test holds every block within 0.85-1.35 of its measured drawn height, so this class of bug cannot return invisibly.
- `docs/audit/OUTCOME-GRADING-SPEC.md` — **outcome-grading specification**: every win/loss/breakeven grading function across 0DTE (4 plan.ts graders + record.ts's two tracks + feature-store.ts), Iron Condor, Swing (5-truth grader), and Banger (shared scale-out grader) — which layer calls which, and which pairs are INTENTIONALLY different views (mid vs executable, mechanical vs as-managed) vs which are SUPPOSED to be IDENTICAL (feature-store vs record — now checked by the audit script above).
- `docs/audit/INTENTIONAL-DESIGN.md` — **deliberate 0DTE design decisions** + the specific offline measurement that would justify revisiting each: (1) FLOW-first merge precedence, (2) stateless Cortex veto (no hysteresis), (3) single-snapshot PIN wall test, (4) static `BREAKOUT_MAX_CANDIDATES` (measured by the discovery-recall-probe; dynamic-N parked as a documented follow-up). The three A/B harnesses above are its companion tools. Keep updated as measurements run.
- `docs/audit/0DTE-UNIFICATION-DESIGN.md` — **design of record** for collapsing the two 0DTE engines into ONE whole-market board (①'s gate/Cortex/governor spine + ②'s discovery/condor/scale-out), the fail-closed negative-play firewall, EV trade-management, and the 5-phase build plan. Legacy = separate post-close next-day digest, untouched.
- `docs/audit/0DTE-RESEARCH.md` — evidence-driven research map + prioritized plan for the 0DTE grinder AND the whole-market banger engine (confluence, timing, exits, regime). Keep it updated as experiments run.
- `scripts/audit/zerodte-sim-feed.mjs` (`npm run sim:feed`) — **admin-only 0DTE sim feeder.** Authenticates as a temp admin Clerk user (reuses the data-validator FAPI-ticket auth block; deleted in a `finally`) and POSTs board frames to `POST /api/admin/zerodte/sim/board` on a clock so an admin can WATCH a simulated session play through the REAL Night Hawk panel at **`<base>/night-hawk?sim=1`** — members keep seeing the untouched real board. `--synthetic` generates the canonical 5-play RTH arc (NVDA +80% / TSLA +40% / META +30% / SPX condor +76% time_stop / AMD put −50% STOPPED); `--replay=<file.json>` replays `{etMinute,payload}` frames. Flags: `--speed=N --base= --start-et/--end-et --dry-run --reset`. Isolation = admin gate AND a separate Redis key (`zerodte:board:snapshot:sim:v1`, short TTL) AND the `?sim=1` opt-in — see `docs/audit/ZERODTE-SIMULATOR.md`. Read-only w.r.t. the member board + DB (writes only the sim Redis key).
- `docs/audit/ZERODTE-SIMULATOR.md` — the admin sim view: watch URL, seed/reset commands, and the three-layer isolation guarantee (why members can never see sim data) + member-path-unchanged proof.
- `scripts/audit/email-template-send.mjs` (`npm run send:emails -- --to=you@example.com`) — **send every production email template to one test inbox.** Renders all 14 (lead magnet, the 5 welcome-sequence steps, and the 8 billing/lifecycle templates incl. both welcome-premium dual-opener variants) through the REAL template builders and the REAL `sendEmail()` — nothing reimplemented — so what arrives is byte-identical to a member's copy, inline CID images and RFC 8058 one-click headers included. Read-only w.r.t. the app: no DB writes, no Clerk, no prod request. `--dry-run` prints subject / attachment count / `unsub=` / `hdrs=` per template without contacting Resend — run it first, since without `RESEND_API_KEY` the unsubscribe links and List-Unsubscribe headers can't be signed and show as `unsub=no hdrs=0`. Never prints secrets; paced ~700ms for Resend's 2 req/s default. **Most of these templates only fire on a real billing event, so nobody ever sees them** — which is how #1911 shipped a two-losing-trades screenshot under alt text promising wins. First full run 2026-08-08: 14/14 delivered.
- `docs/audit/MARKET-OPEN-VALIDATION.md` — runbook + the daily market-open **Claude scheduled-trigger** prompt + secrets checklist (13:32 UTC weekdays).
- `docs/audit/BASELINE-2026-07-01.md` — pre-open baseline to diff the live run against.
- `docs/audit/FINDINGS.md` — living issue log (keep updating).

## Environment realities (this cloud sandbox)
- **RUN TESTS ON NODE 20 — `nvm use` (or `export PATH=/opt/nvm/versions/node/v20.20.2/bin:$PATH`).
  A Node 22 test run is not evidence (established 2026-08-12).** Production is `node:20-bookworm-slim`
  and every workflow pins `node-version: 20`, but this sandbox's default `node` is 22, and the two
  disagree in BOTH directions:
  - **Phantom failures.** The full suite on Node 22 reports **12 failures** (board-convergence,
    zerodte-service, banger commit-latch, swing discovery). On Node 20 the same commit is
    **7361 pass / 0 fail**. Those 12 were treated for a whole session as an unavoidable
    "sandbox baseline" — they are not; they are Node 22 artifacts and there is no baseline to
    subtract.
  - **Missed real failures.** #2073's tsx 4.23.1→4.23.10 bump threw `ERR_INVALID_URL` inside tsx's
    own ESM resolver hook under Node 20 + `--experimental-test-module-mocks`, killing 133 tests in
    CI while passing clean on Node 22 here.
  **Node 20 is NOT pre-installed and does NOT survive a container restart — install it first:**
  `bash -lc 'nvm install 20'` (~1 min), then run with
  `export PATH=/opt/nvm/versions/node/v20.20.2/bin:$PATH`. `nvm` lives at **`/opt/nvm`**, not
  `~/.nvm` — `source ~/.nvm/nvm.sh` fails, but `nvm` is already a shell function in a LOGIN shell
  (`bash -lc`). Verified the hard way: this note originally read "v20.20.2 is installed", the
  container restarted a few hours later, `/opt/nvm/versions/node/` was gone, and the default `node`
  was back to 22 — the exact stale-doc trap the rest of this file exists to prevent. A restart also
  wipes the scratchpad and any background-task output, though the repo and `node_modules` survive.
  `npm test` goes through `scripts/run-tests.mjs`, which is the exact command CI runs and prints a
  loud banner on any other major — so a Node 22 run announces itself rather than lying quietly.
- **All infrastructure runs on AWS ECS only** — there is no Railway. Docker images are built and pushed to ECR, ECS services are force-deployed, Cloudflare cache is purged. **Production is now the ONLY environment** (`blackout-production-cluster` / `blackout-production-web` at `blackouttrades.com`) — the entire `blackout-staging-*` stack was decommissioned 2026-07-25 (see the Vector-validation note above). The `blackout-web` ECR repo is shared and still in use by production; it was deliberately NOT deleted.
- **WebSockets WORK from this sandbox — inside a CONNECT tunnel (corrected 2026-08-09).** The old
  note here said "WS upgrades unsupported"; that is true only of asking the proxy to proxy an
  upgrade on its HTTP path. A `CONNECT` tunnel is an opaque byte relay, so doing the upgrade
  *inside* one succeeds — the same trick `proxy-browser.cjs` uses for Chromium. Verified live:
  Polygon `socket.polygon.io/stocks`, `socket.massive.com/{stocks,options,indices}` all reach
  `auth_success` and accept a subscribe; UW `wss://api.unusualwhales.com/socket?token=...` reaches
  `join -> status:ok`. Recipe: `http.request({method:"CONNECT", path:"host:443"})` ->
  `tls.connect({socket})` -> `new WebSocket(url, {createConnection: () => tlsSocket})` (the `ws`
  package is already a dependency). Reusable prober: `scripts/audit/upstream-ws-probe.cjs`.
  Server-side UW/Polygon WS still run on ECS and the browser still gets SSE + SWR polling — that
  part is unchanged — but an audit no longer has to validate WS-sourced numbers *only* through REST.
- **Playwright mobile UI E2E works** — `npm run test:ios-ui-e2e` drives prod (or `VALIDATE_BASE`) with iPhone viewport + `BlackOutiOSApp` UA, Clerk cookie auth, tab/segment clicks, and screenshots under `/opt/cursor/artifacts/ios-ui-e2e/`. Full `ios-native-shell` CSS requires PR #557 merged/deployed; until then the suite still clicks the tab bar and primary controls on the live `ios-app` shell.
- **Direct Postgres (raw TCP) is blocked**, same as WebSockets — only HTTP(S) egress through the agent proxy works. So `pg_stat_activity`/lock/row-count probes against prod are **not possible from this sandbox** — root-causing a live DB-side issue (lock contention, slow query, table bloat) needs either an AWS ECS exec session or a temporary HTTP-exposed debug endpoint in the app itself. Don't spend time retrying a raw `pg.Client` connection here.
- **`${{shared.*}}` env refs do NOT resolve here** — set literals: `UW_API_KEY` (UUID), `DATABASE_URL`, `REDIS_URL`, `POLYGON_API_BASE`. Working: `POLYGON_API_KEY`, `CLERK_SECRET_KEY`, Clerk publishable key. **Benzinga rides the Polygon key** — the Benzinga news/catalysts feed is served under the same Polygon subscription at `{POLYGON_API_BASE}/benzinga/v2/news?...&apiKey={POLYGON_API_KEY}` (re-verified live 2026-07-13: 200 for `channels=fda|guidance|m&a` and `ticker=NVDA&channels=earnings`). There is **no separate `BENZINGA_API_KEY`**; news fetches live via the Polygon key. (Earlier note claiming the key was missing was stale.)
- Clerk instance requires a **phone number** on user creation; rapid sign-in/token cycles get **FAPI-rate-limited** — authenticate once per run.

## Access reality — three DIFFERENT things, do not conflate (learned 2026-07-22)
1. **Logging into the live site as a real member — WORKS, pure HTTP, no browser.** Mint a temp
   admin+premium user (Clerk Backend API) → `POST /sign_in_tokens` → FAPI ticket exchange
   (`clerk.blackouttrades.com`, `_clerk_js_version=5.57.0`, curl `-c/-b` cookie jar) → mint a
   `__session` JWT → fetch ANY authenticated page with `Cookie: __session=<jwt>; __client_uat=<epoch>`.
   Reusable auth block: `scripts/audit/data-validator.mjs` (~lines 237-271); phone via
   `scripts/audit/lib/audit-phone.mjs` `generateDefaultAuditPhone()` (E.164 `+1415555xxxx`).
   **Temp-user creation goes through `scripts/audit/lib/clerk-audit-user.mjs` — never inline a
   `POST /users` + recovery block again.** Clerk enforces uniqueness on the e-mail AND the
   phone: `createOrAdoptAuditUserViaCurl` (spawnSync-curl harnesses) / `createAuditClerkUser`
   (fetch harnesses) adopt the leftover user on an e-mail collision and REDRAW the phone on a
   phone collision (bounded retries). The old e-mail-only recovery aborted whole unattended
   runs on a phone clash — see FINDINGS 2026-08-06 [P3, tooling]. So
   **"log in and check every page" IS possible headlessly** — validates served HTML / DOM / component
   presence for the whole authenticated desk/app. Always DELETE the temp user after (cleanup).
2. **Live UI / pixel validation — WORKS, but ONLY via `proxy-browser.cjs`. Read
   `docs/audit/LIVE-UI-CONNECTION.md` FIRST.** Chromium in this sandbox cannot reach the network
   at all — direct, `proxy:{server}`, and `--proxy-server` all fail identically with
   `ERR_CONNECTION_RESET`, and the agent proxy's `recentRelayFailures` stays EMPTY (its traffic
   never even arrives), while `curl`/`fetch` to the same URL through the same proxy return 200.
   The fix is to take the network away from Chromium: `context.route('**/*')` intercepts every
   request and Node fulfills it over a manual `CONNECT` + `tls.connect()` tunnel. That is
   `proxy-browser.cjs` (repo root, committed since #1188):
   `node proxy-browser.cjs <url> out.png --cookie "$CK" --viewport 430x932 --wait 9000` — run
   from the REPO ROOT, cookie from `mintClerkPremiumSession`, and look for `Routed: N ok, 0 fail`.
   Because of this, the direct-`page.goto()` harnesses (`validate-prod-ui-full`,
   `validate:prod-admin-ui`, `test:ios-ui-e2e`, `spx-dashboard-e2e-audit`) fail at the first
   navigation here — they predate the restriction and are not themselves broken.
   **Never** tell the operator UI/pixel validation is impossible — and never conclude it from a
   plain-Playwright failure, which proves nothing but the egress block. Standing rule:
   `.cursor/rules/live-ui-validation.mdc`. Real desk paths are `/nighthawk`, `/terminal`,
   `/vector`, `/flows`, `/heatmap` — there is no `/night-hawk` and no `/swings`; an unstyled
   Times render is the 404 page, not a CSS failure.
3. **AWS — the operator supplies valid creds; the sandbox defaults are INVALID.** Default
   `AWS_ACCESS_KEY_ID/SECRET` env vars are placeholders (`InvalidClientTokenId`). When the operator
   pastes valid creds (in-session env vars), the `aws` CLI works through the proxy — pass `--region
   us-east-1` explicitly (bare `AWS_REGION` didn't stick; use `AWS_DEFAULT_REGION` or `--region`).
   **NEVER commit cred values.** Acct `177922194517` (IAM `vinay-blackout`). Prod web ALB target group
   `blackout-production-app` (`arn:...targetgroup/blackout-production-app/8841ca2aeba05d87`). Prod ACM
   cert (blackouttrades.com): `arn:aws:acm:us-east-1:177922194517:certificate/586bdf10-ec5f-4e8a-a14a-f257f218bd18`.
   Prefer **surgical `aws` CLI changes** (e.g. `elbv2 modify-target-group-attributes`) over the prod
   `terraform apply -auto-approve` (human-gated `workflow_dispatch`, needs `ACM_CERTIFICATE_ARN` secret,
   reconciles the WHOLE stack = drift risk). `deregistration_delay` on the prod TG was set to 30s this
   way on 2026-07-22 (was the 300s default → deploys served stale for ~5min; now ~30s).
4. **Cloudflare purge works in-session** — `CF_API_TOKEN` + `CF_ZONE_ID` are valid;
   `POST api.cloudflare.com/.../zones/$CF_ZONE_ID/purge_cache {"purge_everything":true}` after a
   *visible* deploy clears the edge once ECS has drained. The token also **reads AND writes the
   cache rulesets** (`GET/PATCH .../zones/$CF_ZONE_ID/rulesets[/{id}/rules/{ruleId}]`, phase
   `http_request_cache_settings`) — it does NOT have legacy Page Rules scope (9109). These cache
   rules are hand-made in the CF dashboard, **not** in `blackout-infra` terraform, so API edits
   persist.
5. **Cloudflare edge-caches some HTML pages — auth-dependent chrome gotcha (fixed 2026-07-22).**
   A cache rule (rule `f261edb0…`) force-caches `/`, `/upgrade`, `/learn*` HTML at the edge
   (`edge_ttl 7200`, `override_origin`), *ignoring* the origin's `Cache-Control: no-store`. Because
   those pages render per-user nav (Sign-in vs "Open desk →"), one anonymous snapshot was served to
   everyone → **signed-in users saw "Sign in" forever**. Fix: the rule expression now ends with
   `and (not http.cookie contains "__session")`, so any request with a Clerk session cookie bypasses
   the edge (origin renders correct state) while anon/logged-out (`__client_uat=0`, no `__session`)
   still cache fast. `__session` is httpOnly but the edge still sees it. **Rule of thumb:** never
   edge-cache HTML that renders auth-dependent chrome without the `__session` cookie-bypass guard;
   `/pricing`, `/faq`, and all `(site)` desk pages are already `DYNAMIC` (uncached) and fine. Codify
   the CF cache rules in terraform as the durable follow-up so a dashboard edit can't silently
   regress this.

## Auth model (quick ref)
- Admin: Clerk `publicMetadata.role === "admin"` (or `ADMIN_EMAILS`). Tier: `publicMetadata.tier` (Whop-driven; 60s cache). `role:admin` bypasses per-tool launch gates.
- Prod audit login: mint Backend-API `sign_in_token` → FAPI `clerk.blackouttrades.com` ticket exchange → `__session` cookie. Documented in `AGENTS.md`.

## Data-correctness notes learned
- Prices: validate app SPY/SPX/VIX against Polygon; SPX ≈ 10× SPY.
- EMA/VWAP logic: `src/lib/providers/ma-math.ts`. Prior-session OHLC: `src/lib/providers/spx-session.ts`.
- Systemic: several endpoints serve unrounded floats (e.g. `7499.360000000001`) — round at the data layer.
