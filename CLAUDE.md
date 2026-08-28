# CLAUDE.md — operating memory for BlackOut Trades audits

(Repo also has `AGENTS.md` — the general agent playbook. This file captures the
standing **audit + issue-handling policy**. Keep it and `docs/audit/FINDINGS.md` updated.)

## NEVER SIT IDLE WHILE WAITING (standing instruction, confirmed 2026-08-28)
**Waiting on a PR — your own or a lane's — is not a stopping point.** CI pending, a review
requested from Cursor, another PR's merge, a lane's response: none of these block you from other
work. They block that ONE PR, not you. The concrete failure mode this corrects: an agent that opens
a PR, tags `@cursor review`, then spends every subsequent wake-up doing nothing but re-checking that
one PR's comment thread and re-scheduling the next check — reporting "still waiting" as if that were
itself the work. It is not. That agent had a live coordinator loop the whole time (sweep other PRs,
chase other lanes, scan CloudWatch, revisit FINDINGS.md, do live product exploration) and used none
of it, because "waiting" was silently treated as "idle" instead of as one blocked item among many
open ones.
**The rule:** every time you would otherwise just poll and re-schedule, first ask "is there
independent work I could be doing right now instead of just checking this one thing?" — a fresh
CloudWatch sweep, another open PR, another lane's stale status, an old FINDINGS.md entry worth
revisiting, a new bug/feature/enhancement worth starting. If yes, do that work in the same turn,
*then* schedule the check-in. Only report "nothing to do, waiting" after you've actually verified
there is nothing — the same discipline `DEFINITION OF IDLE` (in the standing autonomous-mode
instructions, not this file) already requires before concluding no worthwhile work exists. A blocked
PR is a reason to route around it, never a reason to stop.

## Issue-handling policy (standing instruction)
As soon as an issue is spotted during any audit/validation:
1. **Open a new branch off `main`**, named `fix/<slug>`. Do NOT push straight to `main`.
2. **Fix it and add a test** (extend the nearest `*.test.ts`; run `npx tsx --test <file>`).
3. **Log it as a new file in `docs/audit/findings-staging/`** — one file per finding,
   `YYYY-MM-DD-<slug>.md`, in the same PR as the code fix — only when fixing a real bug, never for
   verify passes or GREEN audit logs. **Do not edit `docs/audit/FINDINGS.md` directly** — see
   `docs/audit/findings-staging/README.md` for why (every concurrent lane editing the same file at
   the same anchor made every PR go stale within minutes of any other one merging, 2026-08-23).
   The coordinator folds staged files into `FINDINGS.md` with
   `node scripts/audit/findings-fold-staging.mjs`, typically after a merge wave.
   Every staged entry must carry a **`> **kind:** `FINDING`` line** and a real outcome — either a
   `| **Status** | ... |` row or an outcome in the heading (`## ... — FIXED`). `src/findings-hygiene.test.ts`
   enforces this once the entry is folded into `FINDINGS.md`; if it fails, run
   `node scripts/audit/findings-reconcile.mjs --apply` (idempotent — safe to re-run) and commit the
   result. Routine GREEN pass logs go in `docs/audit/RUN-LOG.md`, not here.
4. **Open a PR to `main`, verify CI is green, then auto-merge it.** Keep the PR small (one issue per branch/PR).
Documentation/policy changes (this file, FINDINGS, runbook) merge the same way once verified.

**Merge authorization — standing, ongoing (confirmed 2026-07-06):** auto-merge every
verified PR into `main` once local checks (tsc/test/build/lint as applicable) and required CI
(`verify`) are green. Do **not** stop to ask for per-PR merge approval; do **not** wait for a
human review. Enable GitHub auto-merge (`gh pr merge --auto --squash --delete-branch`) as soon as
the PR is open and mergeable — the repo's `automerge.yml` does this automatically for `cursor/*`
and `claude/*` branches; agent branches named `fix/*` must still be merged by the agent if CI
passes before the workflow fires.

**THE DRAFT DEADLOCK — read this before concluding "the agents are stuck" (2026-08-21).**
On 2026-08-21 the fleet had **36 open PRs, 28 with `verify` GREEN, and not one could ever merge.**
Nothing had failed: no red check, no error, no agent complaint. It read like a broken connection to
the agents. It was not — the agents had finished correctly and handed over exactly as asked. Two
standing instructions, each sensible alone, formed a deadlock:
- the agent harness says **"create the pull request as a draft"**, so every agent PR is born a draft;
- this file says **"do not auto-merge: draft PRs"**, so no agent PR is ever eligible.
Compounding it, `automerge.yml` matched only `cursor/*`, so even an un-drafted `claude/*` PR was
ignored. Both conditions failed independently — fixing either alone would have left the jam intact.
**The draft gate is kept on purpose**: draft is the agent's own "still working" signal, and
auto-undrafting would merge work the instant CI passed even if the agent had more to push.
Resolving it is the COORDINATOR'S job, and it is a real review step, not a formality: read the
green draft, then mark it ready and `automerge.yml` takes it from there.
**Undrafting is narrower than it looks — three of the four obvious ways do not work** (all measured
2026-08-21): REST `PATCH /pulls/{n}` `{"draft":false}` returns 200 and silently leaves it a draft
(read-only field); GraphQL `markPullRequestReadyForReview` is blocked for agent sessions; and the
Actions `GITHUB_TOKEN` is ALSO refused it (`Resource not accessible by integration`, run
32447301837) — so `agent-pr-release.yml` cannot arm without an `AGENT_RELEASE_TOKEN` PAT. What DOES
work today is the GitHub MCP `update_pull_request` tool with `draft: false` (verified on #2458,
#2424, #2423, #2422). Do not assume a token can undraft because it can write PRs — test it. **A green draft that nobody marks ready is not "in progress" — it is
finished work that has fallen out of the pipeline.** Sweep for them by state, never by memory of
what was launched: `state=open AND draft=true AND verify=pass` is the query that finds the jam. This supersedes any earlier "leave OPEN for end-of-day review"
language in `FINDINGS.md` or elsewhere. Still exercise judgment on scope/blast-radius per the PR
write-up policy below, and still keep PRs small/single-issue — the standing authorization is for
**merging**, not for skipping verification or scope discipline.

**Do not auto-merge:** draft PRs; PRs with failing required CI; Dependabot major-version bumps
until CI is fixed; changes the user explicitly flags as deploy-risky (hold on a branch until
they say go).

**CROSS-PR ORDERING DEPENDENCIES — sequence them, do not race them (added 2026-08-21, after a
red `main`).** Two PRs can each be green, each be correct in isolation, and still break `main` when
composed. Measured that day: #2482 fixed `get_earnings_market`'s bare UTC stamp; #2421 shipped a
new C1 ratchet (`src/lib/largo/contract/session-anchor.test.ts`) that listed the SAME file in its
KNOWN_GAPS allowlist, deliberately deferring the fix rather than writing a second conflicting one.
Correct call — but it made #2421 depend on #2482 landing SECOND. #2482 was already non-draft, so
`automerge.yml` took it as soon as its checks went green, #2421 merged five minutes later, and the
allowlist arrived describing a file that was already fixed. The "list SHRINKS" assertion fired,
correctly, on `main` and on every open PR that rebased onto it (#2480, #2451, #2487 all went red on
someone else's mistake). Fixed by #2486.

The general shape: **an allowlist entry, a TODO, or a comment that defers to an OPEN PR is an
ordering dependency, and `automerge.yml` does not know about it.** It merges by check-completion
time, which is effectively random. So when one PR's correctness depends on another's merge state:
land the deferred-to PR FIRST and confirm it is in `main` before releasing the dependent one, or
put both in a single merge. Never release both and hope. And do not respond to the resulting
breakage by weakening the guard — a ratchet that tolerates stale entries is the stale-by-omission
failure it was written to prevent.

**A merge is not a verification.** After merging anything whose correctness depends on the state of
`main`, re-run the affected check AGAINST `origin/main` rather than trusting that the merge did what
you expected. That is how the twenty-minute red window above was caught at all.

**A PUSH TO AN ALREADY-MERGED PR IS SILENT — CHECK BEFORE YOU PUSH, AND AFTER (2026-08-23).** With
`automerge.yml` armed, a green PR can go from opened to merged in **thirteen minutes**. Widen the
scope of your own PR, run the suite, push — and the push can land after it merged. Measured that
day: #2713 merged 08:44:02 and the widening was committed 08:47:41 (**3m39s late**); #2711 merged
08:48:37 and its correction 08:49:16 (**39s late**). Both pushes SUCCEEDED. Git accepts them, the
branch moves, GitHub reports nothing, and a merged PR simply ignores everything that arrives after.

**There is no error anywhere in this.** The PR reads merged, green, closed; CI is untouched; the
branch has your commit on it. The only symptom is that `main` is missing work you believe you
shipped — and the two dropped commits here were the ones that made `main` SELF-CONSISTENT, so what
landed was a runbook describing four fixed panels beside a probe that checks one. A half-merged
change reads at validation time as "the fix is broken", not as "the fix is half-merged", which is a
strictly more expensive way to find out.

The cheap guard, one API call, after every push to a PR branch:

```bash
curl -s "https://api.github.com/repos/$REPO/pulls/$N" -H "Authorization: Bearer $GITHUB_TOKEN" \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['state'],d['merged'],d['head']['sha'][:8])"
# state must be `open`, merged `False`, and head sha must equal what you just pushed.
```

If it comes back merged: **do not push more commits to that branch** and do not reopen it. Branch
fresh off `origin/main` and open a NEW PR for the remainder — the same rule the agent harness states
for a merged designated branch, and it applies to any PR, not just that one. Then verify by
ancestry/content against `origin/main`, never by the PR's own status.

**The generalisation worth keeping:** the faster the merge queue, the smaller the window in which
"my open PR" is still true. Treat a PR as open only as of the last time you actually looked, and
prefer landing a widened scope as a NEW PR over racing a push into an old one.

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

## Largo product contract (standing instruction)
Every product surface exposed to Largo — Helix, Thermal, Vector, Meridian, Night Hawk, SPX — follows
**`docs/audit/LARGO-PRODUCT-CONTRACT.md`** (prose) and imports its types from
**`src/lib/largo/contract/product-read.ts`**. Ten points: time, freshness, absence, identity,
direction, confidence, evidence, provenance, precision, historical context. It exists because
parallel lanes otherwise invent incompatible schemas and the cross-product questions become
unanswerable — not for lack of data, but because it cannot be joined.

Two properties are easy to get backwards, so they are stated here too:
- The contract is **ADDITIVE**. `ProductRead<T>` WRAPS a product's own `T`. **Flattening
  product-specific intelligence to satisfy the contract is a violation, not compliance** — keep both
  the native field and the normalized one.
- **`confidence` must be OMITTED when a product cannot calibrate it.** An invented score is compared
  against another lane's measured one, so fabricated certainty does not stay local — it corrupts
  cross-product ranking. Omission is honest; fabrication is not.

Cross-product **disagreement is represented, never reconciled by the lanes themselves**. Vector and
Helix both read flow and will sometimes differ; that difference is information. A lane that quietly
adjusts its numbers to match a peer has destroyed the signal and left a false consensus.

## Audit toolkit (committed)
- `scripts/audit/data-validator.mjs` — cross-provider validator (Polygon+UW ground truth vs the numbers members see: prices/indices, GEX/greeks, track-record math, malformed-number scan). Secrets from env only; one temp Clerk user per run, always deleted. Exits non-zero on any FAIL.
- `scripts/audit/zerodte-e2e-suite.mjs` (`npm run validate:e2e`) — **pre-open E2E validation gate** across FOUR sections, worst-verdict rollup, **exits non-zero if any REQUIRED section is RED**: **API-POLYGON** (every Polygon/Massive upstream the 0DTE pipeline reads — LIVE — HTTP-200 + schema-shape + sanity-value: grouped-daily ~12.4k rows, VIX 5–90, SPX 1000–20000, option chain carries greeks/last_quote, reference contracts, unified OCC snapshot); **API-UW** (flow-alerts data[], SPX spot-exposures/strike GEX, greek-exposure, screener, darkpool, net-flow/expiry, earnings pre/afterhours); **INFRA** (RDS `blackout-production-postgres` available/Multi-AZ + ElastiCache `blackout-production-redis-rg` available/failover via the AWS CLI — **SKIPPED, never RED, when AWS creds are absent/placeholder**); **DATA-PATH** (Redis board-snapshot path via `/board` + Postgres read path via `/record`, through ONE temp admin Clerk user deleted in `finally` — raw TCP to PG/Redis is blocked here, so validate THROUGH the app). Self-defaults `POLYGON_API_BASE` to `api.massive.com` primary with `api.polygon.io` fallback (first 200 wins, sticky). Pure schema/sanity validators live in `lib/e2e-schema-checks.mjs`, unit-tested by `zerodte-e2e-suite.test.ts` (`npx tsx --test`). Never prints secrets. Flags: `--json --provider=polygon|uw --quiet`. Companion doc: `docs/audit/MONDAY-RTH-READINESS.md` (the full play-generation BLOCKER trace + open checklist). First live run 2026-07-25: all required GREEN (off-hours ambers = empty greeks/trades), DATA-PATH GREEN (111 graded record rows), INFRA SKIPPED (sandbox AWS placeholder creds).
- `scripts/audit/zerodte-sim.mjs` (`npm run sim:0dte`) — **0DTE play simulator** for "what does this change do to today's plays?" Runs the REAL pipeline (`flowAccumulationByTicker` → `buildDeterministicEditionPlays`/`pickChainContract` → `filterPlaysByMaxDte` → `gradePlanFromBars`) against REAL data (multi-day UW flow + live Polygon chains + Polygon minute bars) and prints a per-stage FUNNEL + per-ticker GATE TRACE + generated plays; `--grade=YYYY-MM-DD` backtests a past session with minute-bar outcomes (doubled/stopped/time-stop) on a probed ATM 0DTE contract. Flags: `--days=N --min-premium=N --max-tickers=N --max-dte=N --tickers=A,B --grade=DATE --json --quiet`. Self-defaults `POLYGON_API_BASE`; run with `env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY`. Candidate discovery = the accumulation engine (not the full market-wide discovery); see FINDINGS 2026-07-22 for the scope boundary. **Use it to measure any 0DTE change before/after.**
- `scripts/audit/market-banger-scan.mjs` (`npm run scan:bangers`) — **whole-market banger scanner.** Screens EVERY US stock (Polygon grouped-daily, ~12.4k/day) for breakout/momentum movers (gain%, volume, close-strength, price/liquidity filters), ranks by $-volume, and suggests a cheap OTM weekly call per name. `--grade=YYYY-MM-DD` backtests: measures `maxRet` (top-tick) vs hold-to-expiry vs **REALIZED return under a mechanical scale-out** (partial at 2× + trailing runner + hard stop) — the exit rule that converts fleeting bangers into EV (finding them is easy; exiting is the edge — see `docs/audit/0DTE-RESEARCH.md`). Flags: `--date --grade --min-gain --min-vol --top --price-min --price-max --json`. Self-defaults `POLYGON_API_BASE`; run with `env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY`.
- `scripts/audit/condor-wr.mjs` (`npm run wr:condor`) — **0DTE iron-condor win-rate backtest** (the reproducible evidence behind the high-WR premium-SELLING engine). Sweeps short-strike widths against REAL minute bars (WIN = close inside both shorts) → the `CONDOR_WINRATE_BY_WIDTH` table in `src/lib/zerodte/iron-condor.ts`; also grades the SHIPPED `selectIronCondor` geometry and reports the honest intraday-BREACH rate (the negative-skew tail). `SPY,QQQ,IWM × 25 sessions`: ±0.6%→77%, ±0.8%→92%, shipped target-80 →98.7% WR / 18.7% breach. Flags: `--tickers --days --end --entry --target --wing --dates --json`. Self-defaults `POLYGON_API_BASE`; run with `env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY`. **Calibration-first: evidence, not gating — the ledger graduates it before it sizes real risk.**
- `scripts/audit/zerodte-e2e-healthcheck.mjs` (`npm run healthcheck:0dte`) — **LIVE end-to-end health check for the whole 0DTE "Night Hawk" system** against PROD. One repeatable run that asserts EVERY subsystem is live/producing/tracking/grading and prints a per-stage GREEN/AMBER/RED matrix: **(A)** INFRA/CONFIG (ECS web + market-worker healthy + `ZERODTE_*` discovery flags present — SKIPPED, not RED, when AWS creds absent; never prints secrets), **(B)** DISCOVERY ×3 (FLOW/BREAKOUT/PIN each present, or AMBER with the captured gate/governor/heat reason), **(C)** COMMIT/LEDGER (entry premium + frozen cortex/tier snapshot + origin per committed row), **(D)** LIVE MARKS+P&L (fresh mark staleness bound + Polygon option-quote cross-check), **(E)** EXIT MGMT (OPEN/HOLD/TRIM/CLOSED coherence; a stopped row shows the −50% stop P&L), **(F)** IRON CONDOR *(first-class stage, never skipped)* — real 4-leg geometry (short/long both sides, net credit, wings, breach) + tracking, and **(G)** GRADING/RECORD (`wins+losses+breakeven==graded`). READ-ONLY; one temp Clerk user, always deleted (self-heals leftovers); authenticates once. Exits NON-ZERO if any non-skipped stage is RED (pre-open gate). Flags: `--json --quiet --stage=A,B,...`. Self-defaults `POLYGON_API_BASE`; **run WITH AWS creds when available** for stage A (`node --import tsx scripts/audit/zerodte-e2e-healthcheck.mjs`). Pure verdict/coherence helpers in `scripts/audit/lib/zerodte-healthcheck-eval.mjs` (unit-tested). See `docs/audit/MARKET-OPEN-VALIDATION.md`.
- `scripts/audit/meridian-interaction-audit.mjs` — **Meridian live INTERACTION audit** (desktop 1440 / tablet 1024 / phone 430). Deliberately asks what `meridian-earnings-ui-audit.mjs` cannot: that harness checks whether the right SELECTORS painted, and a panel whose labels overlap into garbage satisfies every one of its assertions — which is exactly how two P2 defects shipped on 2026-08-18. This one measures **behaviour and pixels**: physical intersection between rendered text leaves (parents and invisible nodes excluded, else real hits drown in hundreds of false ones), clipped text, sub-24px tap targets, horizontal body overflow, rapid tab-hammering leaving ≠1 tab active, keyboard reachability + focus ring, deep-link survival across a reload, failed and duplicated API requests, and console errors. Gated on a PAGE-LOADED proof so a blank page / 404 / auth bounce reports `HARNESS`, never a product verdict; a probe that returns `undefined` is also HARNESS, because "the probe never ran" must never read as "clean". One temp Clerk user, deleted in a `finally`. Run from the REPO ROOT with `NODE_USE_ENV_PROXY=1`. Flags: `--base --out --viewport`. First run 2026-08-18 independently reproduced the orbital label collision found by eye (`"MERIDIAN" ∩ "Fundamentals" 24x10px`).
- `scripts/audit/gex-depth-validate.mjs` — **synthetic order book (depth ladder) live validator.** Runs the REAL `buildGexDepthLadder` against REAL Polygon chains and checks it against the levels production already serves: (1) our closed-form BS gamma vs the PROVIDER's gamma at spot, measured RAW before the anchor is applied (post-anchor they agree by construction, so comparing there is a tautology); (2) that the ladder agrees with ITSELF — `shares` differences dealer DELTA while `gamma` sums closed-form GAMMA, computed independently, so calculus requires them to line up; (3) cumulative == running sum of marginals. Built BEFORE the view on the principle that a visualization of a number nobody has checked is worse than no visualization. **It caught three real defects unit tests could not** — a `crossing` derived from flow direction (which turns at spot in EVERY long-gamma book), two successive wall checks that conflated a PER-STRIKE quantity with a WHOLE-BOOK one, and gamma sampled at a band edge while shares integrate across the band. **Measured 2026-08-12: raw BS-vs-provider agreement is 0.1% (TSLA), 0.7% (ASTS), 1.7% (NVDA) but 9.5% (SPY), 15.8% (QQQ), 21.7% (IWM) — the gap IS the dividend yield our r=q=0 form does not model**, which is why the ladder is ANCHORED to the matrix's own `gex.total` at spot. Flags: `--tickers --json`. Run with `env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY NODE_USE_ENV_PROXY=1`.
- `scripts/audit/depth-live-check.mjs` — **post-deploy proof for the depth ladder.** Fetches the ladder the SERVER built and independently REBUILDS one in-process from the raw Polygon chain, then compares crossing + peak band. Agreement means the deployed code path actually ran, used the expiries it claims, and applied the anchor — not merely that a `depth` key exists. `--wait=N` polls while the matrix cache turns over and says so out loud, because **a check run seconds after a deploy proves nothing** (that mistake cost an hour on 2026-08-12: a correct fix read as broken off a pre-deploy cached payload). Tolerance is a band width, not equality — the server built its ladder at a different instant, so spot has moved; demanding equality would fail on a healthy system during RTH. Flags: `--tickers --base --wait --json`. Run with `NODE_USE_ENV_PROXY=1`.
- `scripts/audit/depth-ladder-ui-audit.mjs` — **depth-ladder live UI audit** (desktop 1440 + phone 430). Opens the Depth tab on prod `/heatmap` through the CONNECT-tunnel Chromium and asserts the ladder actually painted: rung count, bar count, spot row, legend, the honest-limits note, zero console errors, and no horizontal body overflow. **Proves the PAGE loaded before judging the FEATURE** — it requires the long-shipped Matrix tab first, because without that guard a blank page, a 404 or an auth bounce all report "Depth tab not found", which reads as a product defect when it is a harness failure. One temp Clerk user, deleted in a `finally`. Run from the REPO ROOT with `NODE_USE_ENV_PROXY=1`.
- `scripts/audit/cls-measure.cjs` — **live Cumulative Layout Shift measurement through the agent-proxy tunnel.** Answers the one question a diff cannot: is the page's CLS actually under 0.1, *measured*, not inferred from an animation change. Installs a `PerformanceObserver({type:'layout-shift', buffered:true})` BEFORE navigation (so the earliest shifts are caught), sums `value` excluding `hadRecentInput` exactly as CrUX/Lighthouse define CLS, then SCROLLS the page to trip any viewport-entry animations (the `sweep`/`spulse` keyframes that caused the homepage desktop 0.55 were scroll/entry-driven — a static load would have read clean). Same CONNECT+tls tunnel as `proxy-browser.cjs`, so Chromium reaches prod; look for `Routed: N ok, 0 fail` (a non-zero fail count makes the number suspect — assets that never painted cannot shift). **Two traps it encodes:** measure at the viewport where the shift lives (the #2453 regression was DESKTOP-only — a mobile-only check would have missed it), and PURGE the Cloudflare edge HTML first (7200s edge TTL ignores the origin's `no-store`, so an unpurged run measures the OLD page and calls a live fix broken — the exact failure mode the SEO lane heartbeat warns about). Exits non-zero on CLS ≥ 0.1 so it can gate. Flags: `--viewport WxH --wait ms --cookie --json`. Run from REPO ROOT with `NODE_USE_ENV_PROXY=1`. First run 2026-08-21 confirmed homepage CLS **0.0002** desktop 1440×900 AND mobile 430×932 post-purge (validating #2453 on production, not from the diff).
- `scripts/audit/firewall-rth-replay.mjs` — **fail-closed firewall RTH replay** (before/after counterfactual). Replays a session's live 0DTE board OLD (guards off) vs NEW (Phase-0 firewall) and diffs which plays each fail-closed guard (far-OTM cap, G-4 `vix_unavailable`, G-7 `macro_unavailable`, cortex `veto_blind`, earnings-all-ranks) would have HELD, grading the delta on real minute bars → loser-avoided vs winner-forgone + net session P&L. Read-only vs prod (one temp Clerk user, deleted). Run with `env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY -u POLYGON_API_BASE node --import tsx scripts/audit/firewall-rth-replay.mjs`. First run (2026-07-24) held both committed plays, both losers, −54.9% avoided — see FINDINGS.
- `scripts/audit/discovery-recall-probe.mjs` — **discovery recall probe** (design Q10, "no silent caps"). Screens a session with the REAL production screens and splits the qualifying pool at the REAL production cut — momentum re-rank (`rankMoversForChainFetch`) then the **dynamic** cap `clamp(ceil((long+short qualifying) × 0.30), 40, 100)` — into KEPT(rank 1…cap) vs DROPPED(cap+1…pool end), grading each name's intraday continuation on REAL Polygon minute bars (favorable-first long-call proxy) → per-cohort win-rate + the specific dropped winners the cut never saw. The shared split helper is `scripts/audit/lib/breakout-cohort-split.mjs` (unit-tested), also used by `breakout-dynamic-n-ab.mjs`. Read-only, Polygon-only (no UW/DB/Clerk). Flags: `--grade=YYYY-MM-DD --dates=A,B,C --fav=0.015 --entry=10:00 --concurrency=12 --json`. Run with `env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY`. **Corrected 2026-08-06** — it previously split cohorts with `screenBreakoutMovers(...).slice(0, KEEP)` ($-volume order, static cap), an ordering production has not used for weeks, so **every BREAKOUT recall number recorded before 2026-08-06 is void** (including the old "`BREAKOUT_MAX_CANDIDATES`=6 / top-6 by $-volume / leaky" summary that used to sit here). Corrected 13-session run (2026-07-20…08-05): KEPT 44.1% (n=1287) vs DROPPED 50.0% (n=1485), dropped tail ≥ kept on 7/13 — win rate does NOT decay with momentum rank, i.e. the ranking (not the cap size) is the component without demonstrated signal. No engine change was made; see `docs/audit/INTENTIONAL-DESIGN.md` §4.
- `scripts/audit/merge-precedence-ab.mjs` — **merge-precedence A/B** (INTENTIONAL-DESIGN item #1). Re-grades a session's multi-origin DISAGREEMENT rows under FLOW-first (shipped) vs evidence-weighted precedence, reading the frozen `entry_context.origin_maps` (WS-06: `origin_direction_map`/`origin_score_map`/`direction_owner`, versioned by `MERGE_POLICY_VERSION`) and grading BOTH candidate directions identically on REAL Polygon minute bars (favorable-first proxy) → which precedence graded better. Offline, read-only, changes NO board behavior. Committed rows are a DB product (raw Postgres blocked here), so pass a ledger export with `--ledger=<path.json>`; else prints INSUFFICIENT DATA (never fabricates a disagreement). Self-defaults `POLYGON_API_BASE` (`/^https?:/` guard); run with `env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY`. Flags: `--ledger --fav --entry --json`.
- `scripts/audit/veto-flicker-rate.mjs` — **Cortex veto-flicker rate** (INTENTIONAL-DESIGN item #2). Over a session's ordered scan passes, measures how often a Cortex veto CLEARS within N subsequent passes (`--within`, default 3) → flicker rate + median passes-to-clear + per-ticker churn — evidence for whether a dwell/hysteresis on the stateless veto (`cortex-gate.ts` recomputes fresh each pass) is warranted. Offline, read-only. Pass `--passes=<path.json>` (per-pass rosters with `cortex_decision` — exact) or `--rejections=<path.json>` (`zerodte_scan_rejections` `cortex_veto*` codes — approximate); else prints INSUFFICIENT DATA. No Polygon/network needed. Flags: `--passes --rejections --within --json`.
- `scripts/audit/wall-temporal-stability.mjs` — **PIN wall temporal stability** (INTENTIONAL-DESIGN item #3). Runs the REAL production `evaluatePinRegime`/`pinScore` on each of a session's GEX-wall snapshots, splits qualifying pins into multi-snapshot-STABLE vs SINGLE-snapshot, and grades each fade on REAL Polygon minute bars → do stable walls grade better (evidence for a temporal-stability requirement on the single-snapshot pin test). Offline, read-only. Intraday GEX snapshots are a server-side UW product not reachable offline, so pass `--snapshots=<path.json>` (built by `scripts/audit/gex-wall-snapshot-poll.mjs`, the live intraday poller — authenticates through the app the same way `data-validator.mjs` does and polls `GET /api/market/gex-heatmap?ticker=<T>` on an interval, deriving callWall/putWall/pct/posture with the exact same math `computeGexWalls`/the gamma-flip regime use); else prints INSUFFICIENT DATA (never fabricates a wall). Self-defaults `POLYGON_API_BASE` (`/^https?:/` guard); run with `env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY`. Flags: `--snapshots --min-snaps --wall-tol --fav --entry --json`. First attempt 2026-08-05: poller built + smoke-tested live (real auth, real prod data) but RTH was closed (~10h to next open) with no reusable earlier-session capture, so the actual stability measurement is still INSUFFICIENT DATA — see FINDINGS.md for the exact re-run command.
- `scripts/audit/outcome-grading-audit.mjs` — **outcome-grading cross-check** (turns feature-store.ts's comment-only invariant into a tested one). `feature-store.ts`'s `labelFromPlanOutcome` claims byte-identical win/loss agreement with `record.ts`'s `isZeroDteWin`, but the former reads the raw MID (mechanical) `plan_outcome`/`plan_pnl_pct` DB columns while the latter prefers the OFFICIAL WS-10/WS-11 executable/reconstructed-trim-scale lane (`entry_context.executable`) — the two CAN disagree once a row has been executable-graded. Imports BOTH real production functions live (never reimplements), fetches real graded rows from the already-live `GET /api/market/zerodte/record` (raw mid values recovered off `entry_context.executable.mid_plan_outcome`/`mid_plan_pnl_pct`, which WS-10 stamps redundantly), and flags every disagreement. Pure comparison helpers in `scripts/audit/lib/grading-agreement-eval.mjs` (unit-tested, `npx tsx --test`). Flags: `--days=90 --base= --ledger=<path.json> --json`. Self uses `scripts/audit/lib/audit-auth-fetch.mjs` (cron-bearer first, Clerk fallback, temp user released after). First live run 2026-08-05, 90-day window: 141 plays, 30 WS-10/WS-11 executable-graded (the population that can even test the invariant), 130 with evidence on both sides, **126/130 agree (96.9%), 4 real disagreements** (MU/SPXW/META 2026-07-29..08-03: mid `stopped` −50% vs official WIN via WS-11 partial-banking; OKLO 2026-07-30: mid `time_stop` win vs official small loss). See `docs/audit/OUTCOME-GRADING-SPEC.md` for the full grader inventory this measurement is one check out of.
- `scripts/audit/largo-card-deadspace.mjs` — **Largo card dead-canvas measurement + per-block height calibration.** Renders composed cards OFFLINE (no network, no auth) and scans the PNG for the largest interior gap — the space the evidence leaves ABOVE the pinned footer, which is the packer's cumulative height over-estimate made visible. `--calibrate` renders ONE block at a time and prints estimate-vs-drawn per block per size. Built because `compose.ts` packs against per-block ESTIMATES that nothing had ever compared to pixels: two were wrong by ~2×, producing a card that printed "ALSO MEASURED, NO ROOM ON THIS CARD" above 23% blank canvas (FINDINGS 2026-08-11). Bundle fixture is `src/lib/largo/visual/fixture-bundle.ts`, declared `VisualBundle` so tsc rejects an invented shape. Two gotchas it encodes: measure blankness against each ROW's own left-edge pixel (the shell paints a gradient AND a 1px border, so a global-background test reports a 0px gap on a card that is a quarter empty), and measure to the start of the largest gap, not the last drawn pixel (that is always the pinned footer). Run: `node --import tsx scripts/audit/largo-card-deadspace.mjs [--calibrate] [--sizes=a,b] [--out=DIR] [--json]`. A unit test holds every block within 0.85-1.35 of its measured drawn height, so this class of bug cannot return invisibly.
- `scripts/audit/gex-force-rebuild-timing.mjs` — **GEX `?force=1` rebuild-timing harness.** Times N forced matrix recomputes per ticker through ONE long-lived session and reports p50/p90/p95/max plus the fraction breaching a candidate cap, so `GEX_HEATMAP_FORCE_MAX_BLOCK_MS` (a **fail-closed** 55s deadline, env-overridable, picked against the ALB's 120s idle timeout rather than measured cost) can be set from a distribution instead of an anecdote. Sequential by design — concurrent forces on one ticker collapse onto a single inflight rebuild, so the second caller measures the first one's tail and reads as fast. Warmup pass excluded; a 200 carrying zero strikes is NOT counted as a rebuild; the run prints its **market phase** so an off-hours number can never be quoted as an RTH p95. Carries the 45s re-mint jar + 401 retry + AUTH-vs-rebuild bucketing (a run outlives its ~72s JWT, and without it the LAST tickers return 401 in ~60ms and read as "that ticker's matrix is broken and fast"). Flags: `--tickers --n --cap --base --no-warmup --json`. First run 2026-08-14 (overnight): SPY p95 5.4s, SPX 7.3s, QQQ 4.4s, IWM 2.1s, 20/20 clean, 0 over cap — see RUN-LOG. **The cap was NOT changed on this evidence**: overnight is a floor, and the 56.7s SPY observation from 2026-08-13 is still unexplained until an RTH re-run.
- `scripts/audit/meridian-earnings-data-inventory.mjs` — **Meridian earnings per-field FILL-RATE inventory.** Walks live earnings events and buckets every leaf path ALWAYS(>=90%) / USUALLY(>=60%) / SOMETIMES(>=20%) / RARE(<20%), so a panel is never designed against a field prod does not fill. Carries a **COHORT GUARD** (`--min-importance`) after walking straight into the trap it now prevents: sampling earnings by date returns micro-caps with no options market, against which `intel.thermal`, `dark_pool` and `expected_move` all read 0% filled and a redesign would wrongly conclude those datasets are dead. At `importance>=4` they are 10/10, 8-prints-on-10/10 and 10/10. **A fill rate without its cohort is not a fact about the field** — always report which cohort produced it. Found the null-reaction defect below. Flags: `--tickers --min-importance --base --json`.
- `scripts/audit/meridian-earnings-ui-audit.mjs` — **live Meridian earnings UI audit** (desktop 1440 / tablet 1024 / mobile 430) through the CONNECT-tunnel Chromium. Asserts REPORT/ESTIMATES/POSITIONING/HISTORY each painted their required marks, with no horizontal overflow. **Gated on a PAGE-LOADED proof** (desk shell + earnings tab bar) before any tab assertion, and a missing gate reports `HARNESS`, never `RED` — a blank render, a 404 and an auth bounce all surface as "the halo is missing", which reads as a product defect when it is a harness failure. Two traps it now encodes: the timeline mixes macro/FDA/OpEx rows so it must select by the row's own `meridian-theme-earnings` class (clicking the first row lands on a macro print with no earnings tabs), and `ERR_CONNECTION_RESET` on navigation is a **draining ECS replica mid-rollout**, not the egress block — retried once, and each viewport isolated so one failed pass cannot discard the others. One temp Clerk user, cleaned up in a `finally`. Run from the REPO ROOT with `NODE_USE_ENV_PROXY=1`.
- `scripts/audit/cron-dst-audit.mjs` — **does each cron's fixed-UTC schedule still satisfy the ET wall-clock gate its route applies, in BOTH halves of the year?** EventBridge classic Rules (`aws_cloudwatch_event_rule.schedule_expression`) fire on a FIXED UTC clock — they have no timezone support at all; only EventBridge *Scheduler* has `schedule_expression_timezone` — while half the cron routes gate on `America/New_York`. So a schedule that satisfies its gate under EDT can miss it entirely under EST, and **the failure is silent**: the cron fires on time, the route self-skips, and returns 200, which `stale_after_min` cannot see because nothing is late and nothing errored. Expands every deployed cron and reports per route: registered UTC cron · what the route gates on · fires-hit under EDT · under EST. Runs TWO checks, because the bug has two forms — **A: ET-GATED** (a gate that stops being satisfied → silence) and **B: ET-INTENT** (no gate at all, so the job still RUNS, just on the wrong side of the event it was scheduled around, emitting output that looks valid — strictly worse). Reads the DEPLOYED manifest from blackout-infra rather than `cron-registry.ts`'s `schedule_cron_utc`, which is only a mirror; refuses to print a verdict if it cannot see that file. Two discriminations keep it from crying wolf: a wide band that brackets its ET window in both offsets is CORRECT, not drift (`banger-live-sync`), and an early fire whose writer is idempotent-last-write-wins is repaired by its own next fire (`gex-eod-snapshot`). Flags: `--infra=<path> --json`. Exits non-zero on any broken job. First run 2026-08-21 found `x-autopost` (39 in-window fires under EDT, **0** under EST) and `banger-discovery` (fired 15:15 ET in winter — 45 min BEFORE the close — and committed positions off an unsettled tape); confirmed `nighthawk-morning-confirm`, `nighthawk-outcomes`, `spx-signal-observe` and `swing-discovery` correct in both offsets. Companion: `scripts/audit/cron-schedule-coverage.mjs` answers the different question of whether a route is scheduled *at all*.
- `scripts/audit/helix-score-signal.mjs` — **does HELIX's conviction score rank anything?** (HELIX-MAP §9.7). `score` is `min(60, premium/$1M × 60) + sweep(25) + 0dte(15)`, so every print at or above $1M contributes the same 60 premium points and the top of the range is nearly empty. The map named the signal ledger as the only instrument that could test it — and that ledger **has no writer**: `helix-signal-outcomes` is fully registered in `cron-registry.ts` yet absent from blackout-infra's deployed `cron-jobs.json` (verified 2026-08-23). So this grades each print's own underlying forward on REAL Polygon minute bars instead, direction from option type **×** aggressor side (`flowDirection`, the rule the drilldown already ships). **First run: 748 prints graded across three horizons — every bucket 41–53% win rate, the BEST bucket changes at every horizon, and the rank correlation FLIPS SIGN (ρ=+0.40 at +30min, −0.40 at +60min). Verdict `SPREAD WITHOUT ORDER` at every horizon.** The verdict logic itself had to be corrected mid-build: it originally graded on SPREAD alone and called a 10.9pp scrambled spread `SEPARATES` — **a spread is not a ranking**, so it now requires a monotonic Spearman trend as well, and distinguishes `SPREAD WITHOUT ORDER` and `INVERTED` from `RANKS`. Only 84/748 (11.2%) score above 59, confirming the saturation. **Scope discipline it encodes:** it measures direction in the UNDERLYING, not option P&L — no strike, decay or exit rule — so a flat result is evidence score does not rank *direction*, never proof it is useless for sizing; and it refuses a verdict from buckets with n<30, **naming** what it dropped rather than quietly averaging over 4 rows. Pure helpers in `lib/helix-score-eval.mjs` (7 unit tests). Self-defaults `POLYGON_API_BASE` with the `/^https?:/` guard — this sandbox ships it as the literal unresolved string `"POLYGON_API_BASE"`, and a truthiness check alone 404s every bar fetch and reports "0 rows graded", which reads as missing data rather than broken config. Flags: `--horizon --max --json`. Run with `env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY`.
- `docs/audit/OUTCOME-GRADING-SPEC.md` — **outcome-grading specification**: every win/loss/breakeven grading function across 0DTE (4 plan.ts graders + record.ts's two tracks + feature-store.ts), Iron Condor, Swing (5-truth grader), and Banger (shared scale-out grader) — which layer calls which, and which pairs are INTENTIONALLY different views (mid vs executable, mechanical vs as-managed) vs which are SUPPOSED to be IDENTICAL (feature-store vs record — now checked by the audit script above).
- `docs/audit/INTENTIONAL-DESIGN.md` — **deliberate 0DTE design decisions** + the specific offline measurement that would justify revisiting each: (1) FLOW-first merge precedence, (2) stateless Cortex veto (no hysteresis), (3) single-snapshot PIN wall test, (4) static `BREAKOUT_MAX_CANDIDATES` (measured by the discovery-recall-probe; dynamic-N parked as a documented follow-up). The three A/B harnesses above are its companion tools. Keep updated as measurements run.
- `docs/audit/0DTE-UNIFICATION-DESIGN.md` — **design of record** for collapsing the two 0DTE engines into ONE whole-market board (①'s gate/Cortex/governor spine + ②'s discovery/condor/scale-out), the fail-closed negative-play firewall, EV trade-management, and the 5-phase build plan. Legacy = separate post-close next-day digest, untouched.
- `docs/audit/0DTE-RESEARCH.md` — evidence-driven research map + prioritized plan for the 0DTE grinder AND the whole-market banger engine (confluence, timing, exits, regime). Keep it updated as experiments run.
- `scripts/audit/zerodte-sim-feed.mjs` (`npm run sim:feed`) — **admin-only 0DTE sim feeder.** Authenticates as a temp admin Clerk user (reuses the data-validator FAPI-ticket auth block; deleted in a `finally`) and POSTs board frames to `POST /api/admin/zerodte/sim/board` on a clock so an admin can WATCH a simulated session play through the REAL Night Hawk panel at **`<base>/nighthawk?sim=1`** — members keep seeing the untouched real board. `--synthetic` generates the canonical 5-play RTH arc (NVDA +80% / TSLA +40% / META +30% / SPX condor +76% time_stop / AMD put −50% STOPPED); `--replay=<file.json>` replays `{etMinute,payload}` frames. Flags: `--speed=N --base= --start-et/--end-et --dry-run --reset`. Isolation = admin gate AND a separate Redis key (`zerodte:board:snapshot:sim:v1`, short TTL) AND the `?sim=1` opt-in — see `docs/audit/ZERODTE-SIMULATOR.md`. Read-only w.r.t. the member board + DB (writes only the sim Redis key).
- `docs/audit/ZERODTE-SIMULATOR.md` — the admin sim view: watch URL, seed/reset commands, and the three-layer isolation guarantee (why members can never see sim data) + member-path-unchanged proof.
- `scripts/audit/email-template-send.mjs` (`npm run send:emails -- --to=you@example.com`) — **send every production email template to one test inbox.** Renders all 14 (lead magnet, the 5 welcome-sequence steps, and the 8 billing/lifecycle templates incl. both welcome-premium dual-opener variants) through the REAL template builders and the REAL `sendEmail()` — nothing reimplemented — so what arrives is byte-identical to a member's copy, inline CID images and RFC 8058 one-click headers included. Read-only w.r.t. the app: no DB writes, no Clerk, no prod request. `--dry-run` prints subject / attachment count / `unsub=` / `hdrs=` per template without contacting Resend — run it first, since without `RESEND_API_KEY` the unsubscribe links and List-Unsubscribe headers can't be signed and show as `unsub=no hdrs=0`. Never prints secrets; paced ~700ms for Resend's 2 req/s default. **Most of these templates only fire on a real billing event, so nobody ever sees them** — which is how #1911 shipped a two-losing-trades screenshot under alt text promising wins. First full run 2026-08-08: 14/14 delivered.
- `scripts/audit/largo-truncation-probe.mjs` — **does the model actually RECEIVE each tool's payload?** `anthropicToolLoop` caps every `tool_result` at `MAX_TOOL_RESULT_CHARS` by keeping the FIRST that-many characters and discarding everything after (`raw.slice(0, MAX)` — key order decides what survives), and an over-cap tool still "works": the call succeeds, the loop completes, and the model writes a fluent answer from whatever survived. Three defects shipped exactly that way in the Night Hawk lane — `get_zerodte_record` delivered **1.5%** of itself with every aggregate cut off (#2433), `get_nighthawk_edition` cut off **every play** (#2436), and `get_nighthawk_outcomes` had Largo quoting a **40% win rate over "5 plays"** for a window whose real record was **74 resolved at 50%** (#2480). Every prior Largo audit graded whether an answer was CORRECT or ROUTED correctly; **none asked whether the payload arrived.** `largo-payload-hygiene.mjs` cannot answer it from this sandbox (it runs tools IN-PROCESS and every DB-backed tool is unreachable here); this probe goes the other way and asks the LIVE agent, which runs where the data is. **The trick:** the transport appends a literal `…[truncated]` marker to an over-cap result and the model can observe its own tool result, so the question is answerable without counting a byte. **The rule that makes it trustworthy:** the instrument is a model, so a run of all-COMPLETE is indistinguishable from a run whose question never landed — every run therefore probes a CONTROL tool known to exceed the cap, and if the control does not come back TRUNCATED, **every COMPLETE is reported UNVERIFIED rather than clean**. A tool absent from the answer's trace is INDETERMINATE, never a pass. Pure verdict helpers in `lib/truncation-verdict.mjs` (11 unit tests). READ-ONLY; one temp Clerk user, deleted before exit (never in a `finally` racing `process.exit`, which would leak it). Exits non-zero on any truncation, any indeterminate, or an unproven instrument. Flags: `--tools --control --base --json`. First live run 2026-08-21: control PROVEN, `get_zerodte_record`/`get_nighthawk_edition`/`get_zerodte_plays` COMPLETE (live confirmation that #2433 and #2436 hold in production), `get_nighthawk_outcomes` TRUNCATED.
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
  **Node 20's availability is container-dependent — CHECK before assuming either way (corrected
  2026-08-22, after two containers disagreed on the same day).** This note previously asserted Node
  20 is *never* pre-installed and `node_modules` *always* survives a restart. Neither holds
  universally: one container had `/opt/node20/bin/node` (v20.20.2) pre-installed AND a populated
  `node_modules` with no setup step; a fresh SPX-lane container the same day had neither — its first
  test run reported ~20 failures that were pure missing-dependency noise, not real regressions,
  until `npm ci` (~2 min) fixed it. That is the exact phantom-failure trap this section exists to
  prevent, arriving from an angle it didn't cover.
  **Check first, don't install blind:**
  ```
  ls /opt/node20/bin/node 2>/dev/null && echo "pre-installed" || echo "need nvm install 20"
  test -d node_modules && ls node_modules | wc -l
  ```
  If Node 20 is missing: `bash -lc 'nvm install 20'` (~1 min) — `nvm` lives at **`/opt/nvm`**, not
  `~/.nvm` (`source ~/.nvm/nvm.sh` fails, but `nvm` is already a shell function in a LOGIN shell via
  `bash -lc`) — then use whichever path resolves, `/opt/node20/bin` or
  `/opt/nvm/versions/node/v20.20.2/bin`. If `node_modules` is missing or looks thin: `npm ci` before
  trusting any test run. A restart also wipes the scratchpad and any background-task output.
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
- **THE SANDBOX CLONE IS SHALLOW — `git merge-base` and `git merge-tree` LIE (2026-08-21).** The
  repo arrives with `.git/shallow` set, so history is truncated. Any branch whose tip predates the
  cut has **no common ancestor in the local object store**, and git reports that as
  `fatal: refusing to merge unrelated histories` with `merge-base` exiting 1 and printing nothing.
  That reads as "this PR is built on a foreign history" — a scary, wrong conclusion about the PR.
  It is a fact about the clone. Measured on #2331, a perfectly ordinary Cursor PR that the release
  sweep's trial-merge silently classified as unmergeable. **Run `git rev-parse
  --is-shallow-repository` before believing any merge-base result**, and
  `git fetch --unshallow -q origin` (~30s) once per container. A container restart brings the
  shallow clone back.
- **Direct Postgres (raw TCP) is blocked**, same as WebSockets — only HTTP(S) egress through the agent proxy works. So `pg_stat_activity`/lock/row-count probes against prod are **not possible from this sandbox** — root-causing a live DB-side issue (lock contention, slow query, table bloat) needs either an AWS ECS exec session or a temporary HTTP-exposed debug endpoint in the app itself. Don't spend time retrying a raw `pg.Client` connection here.
- **`${{shared.*}}` env refs do NOT resolve here** — set literals: `UW_API_KEY` (UUID), `DATABASE_URL`, `REDIS_URL`, `POLYGON_API_BASE`. Working: `POLYGON_API_KEY`, `CLERK_SECRET_KEY`, Clerk publishable key. **Benzinga rides the Polygon key** — the Benzinga news/catalysts feed is served under the same Polygon subscription at `{POLYGON_API_BASE}/benzinga/v2/news?...&apiKey={POLYGON_API_KEY}` (re-verified live 2026-07-13: 200 for `channels=fda|guidance|m&a` and `ticker=NVDA&channels=earnings`). There is **no separate `BENZINGA_API_KEY`**; news fetches live via the Polygon key. (Earlier note claiming the key was missing was stale.)
- Clerk instance requires a **phone number** on user creation; rapid sign-in/token cycles get **FAPI-rate-limited** — authenticate once per run.

## GitHub API: FOUR separate budgets, do not conflate them (measured 2026-08-21)

"Rate limited" is four different facts here with four different remedies, and treating them as one
wasted an hour. Check which one you are actually hitting before concluding anything:

| # | Budget | Who spends it | Symptom | What it means |
|---|---|---|---|---|
| 1 | **Session REST** (GitHub App installation token) | `curl`/`fetch` to `api.github.com` | plentiful — 15000/hr | The workhorse. Poll CI here, not through MCP. |
| 2 | **Session GraphQL** | nothing — **blocked outright at the proxy** | `"This GraphQL query is not enabled for this session — only the pinned set of PR-review operations is served"` | NOT a budget. No amount of waiting helps. `/rate_limit` still reports a healthy `graphql` quota, which is misleading — the block is upstream of the quota. |
| 3 | **GitHub MCP server** | `mcp__github__*` tools | `"Retry after 16m39s"` | Its own limiter, independent of 1 and 2. This is the ONLY path that can undraft a PR, so exhausting it blocks releases specifically. |
| 4 | **`AGENT_RELEASE_TOKEN` PAT** (user `284440397`) | `agent-pr-release.yml` in Actions | `"API rate limit exceeded for user ID 284440397"` | A user PAT gets 5000/hr **per user, shared across all that user's PATs** — a different pool from #1, which is why the session can be healthy while the workflow starves. |

**The consequence that matters:** #4 is on the SAME account the fleet uses, so a job that leans on
it is rate-limited precisely when the fleet is busy — exactly when there is a backlog to release.
`agent-pr-release.yml` hit this three runs in a row and never reached a single PR.

**The fix was NOT a second account.** That was the obvious answer and it treats a self-inflicted
problem as an infrastructure one. `GITHUB_TOKEN` can do every READ the job needs; the PAT is only
required for `gh pr ready`, the one call `GITHUB_TOKEN` is refused. So the job now splits them —
reads on `GITHUB_TOKEN`, the PAT injected for that single command — which at a cap of 3 releases
per run costs the PAT **12 calls an hour**. The general rule: when a shared, scarce credential
starves, look first at what you are spending it on. A budget problem is usually a scope problem.

**A green `agent-pr-release` run does NOT mean it released anything.** Since it now exits 0 on a
rate limit (deliberately — see the workflow header), "success" and "did nothing" look identical from
the conclusion. **Read the log.** Runs 32460029586 and 32461784083 are both green and both end
`RATE LIMITED while listing PRs — exiting 0, next run retries.` As of this writing the workflow has
never actually released a PR; that is still unproven, not proven.

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
   runs on a phone clash — see FINDINGS 2026-08-06 [P3, tooling].
   **IDENTITY IS PER-RUN, NOT SHARED (changed 2026-08-20, #2403/#2407).** The default address is
   now `claude-audit-temp+<pid><uptime>@…`, not the bare shared one. WHY: adoption-on-collision
   means two runs overlapping IN TIME share ONE user, and whichever finishes first `cleanup()`s it
   **out from under the other** — the survivor then holds a session whose user no longer exists,
   so `refresh()` cannot mint and re-establish returns **HTTP 404 `resource_not_found`**. Measured:
   two probes overlapping a validator burst died at t=60s/t=90s; one probe run alone survived 7/7
   refreshes to t=210s; a fourth "solo" run died at t=120s because an earlier probe was still alive.
   **This is very likely the 401 storm mis-read as a PRODUCT fault three times** (thermal validator
   sectors, force-rebuild "IWM 0/5", the Vector board poll) — all long runs, all alongside other
   audits. Per-run identity removed an accidental garbage collector (one shared user held one phone
   forever), so `mintClerkPremiumSession` now SWEEPS tagged temp users older than 30 min before
   minting — the age gate must exceed the longest harness (~15 min) or it re-creates the delete
   race it was built to remove. So
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
3. **AWS — WORKS IN-SESSION when the operator's creds are present (corrected 2026-08-21).** This
   note previously said the sandbox defaults are always placeholders. That is not reliably true:
   on 2026-08-21 `sts get-caller-identity` returned `arn:aws:iam::177922194517:user/vinay-blackout`
   with no creds pasted that session. **Test before assuming** — `pip install boto3` (not
   preinstalled, installs fine) then `boto3.client("sts").get_caller_identity()`. There is no `aws`
   CLI; use boto3. Secrets Manager is writable: `blackout-production/<area>/<name>` is the
   convention (`blackout-production/app/env` is a 98-key JSON blob ECS injects; `rds/master`;
   `seo/gsc-service-account`; `marketing/x-pixel`).
   **Before overwriting any existing secret, FINGERPRINT-COMPARE first** — a supplied credential is
   often identical to what is already live, and blindly writing it risks breaking production for no
   gain. `RESEND_API_KEY` was re-supplied on 2026-08-21 and proved byte-identical; nothing was
   written.
3b. **Google Search Console — service account, in Secrets Manager (2026-08-21).**
   `blackout-production/seo/gsc-service-account` holds `claude-seo@blackout-trades.iam.gserviceaccount.com`,
   verified `siteOwner` on **`sc-domain:blackouttrades.com`** — a **DOMAIN property**, so URL-encode
   it as `sc-domain%3Ablackouttrades.com` in API paths. Getting that wrong returns an EMPTY result
   rather than an error, which reads as "no search data" and is the same absence-as-fact trap this
   file keeps documenting. A plain Google **API key does NOT work** for this API
   (`UNAUTHENTICATED: API keys are not supported by this API`) — it needs a service account or OAuth.
3c. **Python's crypto stack is BROKEN here — sign JWTs in Node.** `import cryptography` dies with a
   `pyo3_runtime.PanicException` (`No module named '_cffi_backend'`), which takes `PyJWT` and
   `google-auth` down with it, so the standard `google-api-python-client` path is unusable. Node's
   built-in `crypto` works: `crypto.createSign("RSA-SHA256").update(unsigned).sign(sa.private_key)`
   → POST `token_uri` with `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer`. `openssl` is
   also present.
3d. **AWS (original note, still true when creds ARE absent).** Default
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

   **⛔ TERRAFORM STATE DOES NOT MATCH PRODUCTION — most resources were applied MANUALLY (standing,
   from the operator, 2026-08-21).** So `terraform apply` is not "the safe way to make an infra
   change" here; it is the risky way. An apply reconciles against a state that has drifted, and what
   it does to a resource it did not create is not predictable from reading the diff.
   - **Never `terraform apply` against production.** Not to "sync", not to "check", not with
     `-auto-approve`.
   - **Never destroy a resource.** If something looks orphaned, it is far likelier that state is
     wrong than that production is.
   - **Need a NEW resource? Create it MANUALLY** (boto3 — there is no `aws` CLI here), then codify it
     in terraform as a *record* so it does not drift back.
   - **Changing an EXISTING resource? One surgical in-place call**, after reading the live object
     first and passing every unchanged attribute back verbatim.
   - **A terraform change in a PR is a RECORD, not an instruction to apply.** Say so in the PR, or
     someone will helpfully apply it.

   Confirmed live 2026-08-21 rather than assumed: `blackout-production-banger-discovery` carries the
   description *"Engine B: whole-market weekly-banger discovery+commit, once per session day"*, while
   `terraform/modules/crons/main.tf` generates `"BlackOut cron: ${each.value.path}"`. An apply would
   silently overwrite operator-authored metadata on a correctly-working rule. That is the small,
   visible end of the drift; the large end is not visible from the repo at all.
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
- **Polygon aggregate `limit` MUST be derived from the window, never fixed.** `sort=asc` means a
  too-small cap returns the OLDEST N sessions and silently drops the recent end — which presents as
  "we don't have that data", not as a truncated fetch. Cost: every recent earnings reaction was null
  for months (`limit=120` under a ~380-day window). `barLimitForWindow` in `meridian-reaction-core.ts`
  is the shared derivation; the index path had the identical latent bug.
- **An earnings reaction must be anchored to the print's BMO/AMC timing.** A post-close print's
  reaction is the NEXT session; the report date's own session is the drift BEFORE the numbers were
  public. This does not degrade the number, it inverts its meaning — measured 7.41% vs 3.01% on one
  real print. `classifyPrintTiming` + `reaction_basis` carry it; `assumed_report_session` must be
  marked in the UI rather than presented as measured.
- Prices: validate app SPY/SPX/VIX against Polygon; SPX ≈ 10× SPY.
- EMA/VWAP logic: `src/lib/providers/ma-math.ts`. Prior-session OHLC: `src/lib/providers/spx-session.ts`.
- Systemic: several endpoints serve unrounded floats (e.g. `7499.360000000001`) — round at the data layer.
