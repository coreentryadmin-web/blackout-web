# RUN LOG — routine validation passes

Moved out of FINDINGS.md on 2026-08-08. These entries record that a scheduled validation ran and
came back green. They are useful as history and were never findings; mixed into FINDINGS.md they
made it impossible to tell an open P1 from a finished chore.

New pass logs belong here, not in FINDINGS.md — see CLAUDE.md's issue-handling policy, which
already forbids opening docs-only PRs for GREEN audit logs.

---

## 2026-08-20 — [UI] Post-deploy live validation of #2368 (ET clocks) — PASS; #2372 SKIPPED off-hours

**Severity.** — (no product defect found)

**Why it ran.** Seven member-visible fixes shipped 2026-08-19/20 verified by unit test and root
cause; none had been observed in a browser against production. The replay-beads fix got its own
pixel probe. This closes the gap for the two remaining fixes that are observable OFF-HOURS.

**#2368 — ET clock pinning: PASS.** Ten formatters called `toLocaleTimeString`/`toLocaleDateString`
with no `timeZone`, so they rendered in the VIEWER's zone. Measured live on `/nighthawk` from a
browser pinned to **Asia/Tokyo** (UTC+9), confirmed via `Intl.DateTimeFormat().resolvedOptions()`:

| metric | value |
|---|---|
| clock strings rendered | 54 |
| parsed to a time | 40 |
| inside the ET session window (04:00–20:00) | **40 / 40** |
| overnight-shifted (>=21:00 or <=03:00) | **0** |
| observed range | 10:02 – 14:33 |
| tunnel routing | 138 ok / 0 fail |

Unpinned, a UTC+9 browser renders those ET instants ~13h later — clustered in 22:00–06:00. The
observed range is the ET session itself, and the two windows do not overlap, so one load settles it.

**#2372 — Expiry Concentration bars: SKIPPED, not passed.** The panel hides below a $50k premium
floor and the tape is frozen off-hours, so zero buckets rendered. Nothing to measure. Re-run during
RTH; the harness reports SKIP rather than inventing a verdict.

**A harness correction worth recording.** The first version of the clock check rendered the page in
two zones and required the clock sets to match byte-for-byte. It reported **FAIL** — with an
ASYMMETRIC diff: 8 strings only in the Tokyo load, ZERO only in the Los Angeles load. A timezone
fault differs on BOTH sides by construction, so a one-sided difference is **live-data drift** on a
board whose timestamps legitimately move between two loads minutes apart. Reporting it would have
been a false alarm on a working fix. The check is now a single-load window test, which is immune to
drift; the cross-zone comparison is retained as context and never gates the verdict.

**Also:** `ERR_CONNECTION_RESET` hit mid-run while the `fab8a26f` deploy was still rolling — a
draining ECS replica, not the sandbox egress block. The harness now retries navigation 3x with
backoff, the same trap `meridian-earnings-ui-audit.mjs` already documents.

**Tooling:** `scripts/audit/post-deploy-ui-validate.cjs` (new); `timezoneId` threaded through
`scripts/audit/lib/proxy-tunnel-context.cjs` — without it this fix cannot be validated at all, since
a runner already in ET sees both readings agree and a pass proves nothing.

---

## 2026-08-14 — [Thermal/GEX] Force-rebuild timing baseline — overnight, 20/20 clean, an order of magnitude under the cap

**Severity.** — (no product defect found; this is a measurement, and it did NOT justify the config change it was run to justify)

**Session.** First run of `scripts/audit/gex-force-rebuild-timing.mjs` (new), ~00:05 UTC, market phase **overnight**.

**Why it ran.** `GEX_HEATMAP_FORCE_MAX_BLOCK_MS` defaults to 55s — a fail-closed deadline picked
against the prod ALB's 120s idle timeout, not against measured rebuild cost. On 2026-08-13 SPY was
observed at **56.7s WARM**, i.e. over the cap on a healthy system, which raised the question of
whether the cap should move. A handful of ad-hoc samples is not enough to move a fail-closed
deadline, so the point was to get a distribution.

**Evidence** (n=5 per ticker after an excluded warmup, sequential, one long-lived session):

| ticker | usable | p50 | p95 | max | over 55s cap |
|---|---|---|---|---|---|
| SPY | 5/5 | 5247ms | 5378ms | 5378ms | 0/5 |
| SPX | 5/5 | 5667ms | 7299ms | 7299ms | 0/5 |
| QQQ | 5/5 | 4175ms | 4438ms | 4438ms | 0/5 |
| IWM | 5/5 | 1934ms | 2079ms | 2079ms | 0/5 |

**Outcome — NO config change.** Overnight rebuilds run 2–7s, roughly an order of magnitude below
the 55s cap. That does not vindicate the cap; it localises the 56.7s observation to load/RTH
conditions this run cannot reproduce. Re-run during RTH before touching the env var — an overnight
number is a floor, not the tail, and setting a fail-closed deadline from a floor is how you get a
deadline that fires only when the system is busy.

**Harness defect found and fixed in the same run (worth recording).** The first version
authenticated once and never refreshed. A forced rebuild takes seconds, so the run outlived its
~72s session JWT and the LAST tickers returned 401 in ~60ms while the first ones measured fine —
printing `QQQ 1/5` and `IWM 0/5` on a healthy system. Read naively that says "IWM's matrix is broken
and fast". Fixed with a 45s re-mint jar + one forced re-mint retry on a 401, and AUTH failures are
now bucketed separately from rebuild failures so the probe can never blame the product for its own
expired token. This is the same defect class as the thermal validator's 2026-08-13 fix — the second
time one session's JWT lifetime has been mistaken for a product failure.

**Status.** GREEN (measurement complete, config unchanged pending an RTH re-run).

## 2026-08-05 — [Grid/0DTE] Post-close fix agent — all validators GREEN (~3:18 PM PT / 6:18 PM ET)

**Severity.** — (no additional product defects)

**Session.** Scheduled post-close fix agent per `docs/ops/GRID-RTH-ALL-DAY-AGENT.md` Step 4 (Cloud Agent `cursor/0dte-grid-post-close-agent-cd7c`; executed ~3:18 PM PT / 6:18 PM ET / 22:18 UTC).

**Evidence.**
- `validate:grid-rth -- --phase=post-close` → **12/12 PASS** (0 FAIL; `zerodte-warm` cron accepted, data-correctness flags=0, ops:collect zero items)
- `validate:zerodte-logic` → **17/17 PASS** — gates, plan exits (-50%/+100%/15:30 ET), lifecycle OPEN→TRIM→CLOSED, mergePlays SKIP past cutoff/MOVED, live board 9 setups / 3 ledger, cutoff 15:30 ET
- `validate:grid-e2e` → **5/5 PASS** — board API 9/3, HELIX 20 prints, Playwright `/nighthawk` load, zero console errors
- `validate:deploy` → **GREEN**

**Root cause.** Initial cloud-agent run failed on missing `node_modules` (tsx/playwright/pg/react) — environment only. After `npm install` + `npx playwright install chromium`, all suites GREEN on re-run. Also resolved committed merge-conflict markers (`<<<<<<< HEAD` / `=======` / `>>>>>>>`) in this file from PR #1757/#1758 squash. No unresolved gate logic, play picking, trade management, mergePlays, cron bypass, or ledger PnL defects.

**Status.** FIXED — docs-only on `fix/findings-merge-conflict-aug5`.

---

## 2026-08-05 — [Grid/0DTE] Post-close fix agent — all validators GREEN (~2:18 PM PT / 5:18 PM ET)

**Severity.** — (no additional product defects)

**Session.** Scheduled post-close fix agent per `docs/ops/GRID-RTH-ALL-DAY-AGENT.md` Step 4 (Cloud Agent `cursor/0dte-grid-post-close-agent-9cf0`; executed ~2:18 PM PT / 5:18 PM ET / 21:18 UTC).

**Evidence.**
- `validate:grid-rth -- --phase=post-close` → **13/13 PASS** (0 FAIL; `zerodte-warm` cron accepted, data-correctness flags=0, ops:collect zero items)
- `validate:zerodte-logic` → **17/17 PASS** — gates, plan exits (-50%/+100%/15:30 ET), lifecycle OPEN→TRIM→CLOSED, mergePlays SKIP past cutoff/MOVED, live board 9 setups / 3 ledger, cutoff 15:30 ET
- `validate:grid-e2e` → **5/5 PASS** — board API 9/3, HELIX 20 prints, Playwright `/nighthawk` load, zero console errors
- `validate:deploy` → **GREEN**

**Root cause.** Initial cloud-agent run failed on missing `node_modules` (tsx/playwright/pg/react) — environment only. After `npm install` + `npx playwright install chromium`, all suites GREEN on re-run. Reviewed today's merged fixes (SPX 0DTE King UW overlay #1706, Bangers scroll parity #1704, NH-R4 session-gap evidence, outcome-grading audit); no unresolved gate logic, play picking, trade management, mergePlays, cron bypass, or ledger PnL defects.

**Status.** FIXED — no code changes required; docs only on `fix/grid-post-close-aug5-green`.

---

## 2026-08-05 — [SPX Slayer] Post-close fix agent pass 2 — all validators GREEN (~3:13 PM PT / 6:13 PM ET)

**Severity.** — (no additional product defects)

**Session.** SPX Slayer post-close fix agent per `docs/ops/SPX-RTH-ALL-DAY-AGENT.md` § Step 6 (Cloud Agent `cursor/spx-post-close-findings-36ba`; executed ~3:13 PM PT / 6:13 PM ET / 22:13 UTC).

**Evidence.**
- `validate:spx-rth -- --phase=post-close` → **6 PASS · 1 WARN · 0 FAIL** — matrix 160 strikes GEX+VEX+DEX+CHARM, cross-endpoint spot merged=7723.55, BIE consistency, dashboard E2E nested, ops:collect zero items
- `validate:spx-e2e` → **0 FAIL / 18 checks** — matrix every-cell-api 160 strikes, GEX+VEX tabs, commentary expand, play verdict SCANNING, zero console errors
- Cross-tool integration: Thermal, HELIX (30 prints), Largo, Grid bootstrap, 0DTE (9 setups), Night Hawk — all PASS

**Root cause.** Initial run failed on missing `node_modules` (tsx/playwright/pg) — environment only. After `npm install` + `npx playwright install chromium`, all suites GREEN. Reviewed all `spx-rth-2026-08-05` findings: P1 `SPX-VERDICT-CLOSED-FLICKER` already fixed (#1758), P0 SPX 0DTE King UW overlay already fixed (#1706). Remaining P2 items (cron auth mismatch, desk lanes off-hours) are expected post-close deferrals. Resolved accidental merge conflict markers in `docs/audit/FINDINGS.md`.

**Status.** FIXED — docs only on `cursor/spx-post-close-findings-36ba`.

## 2026-08-04 — [Grid/0DTE] Post-close fix agent pass3 — all validators GREEN (~3:21 PM PT / 6:21 PM ET)

**Severity.** — (no additional product defects)

**Session.** Scheduled post-close fix agent per `docs/ops/GRID-RTH-ALL-DAY-AGENT.md` Step 4 (Cloud Agent `cursor/0dte-grid-post-close-agent-b871`; executed ~3:21 PM PT / 6:21 PM ET / 22:21 UTC).

**Evidence.**
- `validate:grid-rth -- --phase=post-close` → **13/13 PASS** (0 FAIL; `zerodte-warm` cron accepted, data-correctness flags=0, ops:collect zero items)
- `validate:zerodte-logic` → **17/17 PASS** — gates, plan exits (-50%/+100%/15:30 ET), lifecycle OPEN→TRIM→CLOSED, mergePlays SKIP past cutoff/MOVED, live board 9 setups / 6 ledger, cutoff 15:30 ET
- `validate:grid-e2e` → **5/5 PASS** — board API 9/6, HELIX 20 prints, Playwright `/nighthawk` load, zero console errors
- `validate:deploy` → **GREEN**

**Root cause.** Initial cloud-agent run failed on missing `node_modules` (tsx/playwright/pg/react) — environment only. After `npm install` + `npx playwright install chromium`, all suites GREEN on re-run. Reviewed today's earlier verify passes (#1664, #1666); no gate logic, play picking, trade management, mergePlays, cron bypass, or ledger PnL defects found.

**Status.** FIXED — no code changes required; docs only on `fix/grid-post-close-aug4-pass3`.

---

## 2026-08-04 — [Grid/0DTE] Post-close fix agent — all validators GREEN (~1:05 PM PT / 5:17 PM ET)

**Severity.** — (no additional product defects)

**Session.** Scheduled post-close fix agent per `docs/ops/GRID-RTH-ALL-DAY-AGENT.md` Step 4 (~1:05 PM PT slot; executed ~5:17 PM ET / 21:17 UTC).

**Evidence.**
- `validate:grid-rth -- --phase=post-close` → **13/13 PASS** (0 FAIL; `zerodte-warm` cron accepted, data-correctness flags=0, ops:collect zero items)
- `validate:zerodte-logic` → **17/17 PASS** — gates, plan exits (-50%/+100%/15:30 ET), lifecycle OPEN→TRIM→CLOSED, mergePlays SKIP past cutoff/MOVED, live board 10 setups / 6 ledger, cutoff 15:30 ET
- `validate:grid-e2e` → **5/5 PASS** — board API 10/6, HELIX 20 prints, Playwright `/nighthawk` load, zero console errors
- `validate:deploy` → **GREEN**

**Root cause.** Initial cloud-agent run failed on missing `node_modules` (tsx/playwright/pg/react) — environment only. After `npm install` + `npx playwright install chromium`, all suites GREEN on re-run. No gate logic, play picking, trade management, mergePlays, cron bypass, or ledger PnL defects found.

**Status.** FIXED — no code changes required; docs only on `fix/grid-post-close-aug4-green`.

---

## 2026-08-04 — [spx] Post-close fix agent pass2 — all validators GREEN (~3:13 PM PT / 6:13 PM ET)

**Severity:** — (no product defect)

**Session:** SPX Slayer post-close fix agent per `docs/ops/SPX-RTH-ALL-DAY-AGENT.md` Step 6 (Cloud Agent `cursor/spx-post-close-findings-16a9`).

**Evidence.** `npm run validate:spx-rth -- --phase=post-close` → 6 PASS / 1 WARN / 0 FAIL; `npm run validate:spx-e2e` → 0 FAIL / 18 checks; `npm run validate:deploy` → GREEN. Matrix oracle: 159 strikes GEX+VEX+DEX+CHARM finite; cross-endpoint spot merged=7736.52 hm=7736.52; play SCANNING with no stale confirmations; BIE `getSpxPlayState()` consistent; cross-tool integration (Thermal, HELIX, Largo, Grid, 0DTE, Night Hawk) all PASS.

**Today's findings.** Reviewed all `spx-rth-2026-08-04` verify passes (open through pass5) and prior post-close fix. No unresolved P0/P1 SPX defects. Harness-only initial FAIL (missing `node_modules`) resolved via `npm install` + Playwright chromium install.

**Status.** `cursor/spx-post-close-findings-16a9` → docs-only PR.

---

## 2026-08-04 — [spx] Post-close fix agent — all validators GREEN (~2:21 PM PT / 5:21 PM ET)

**Severity:** — (no product defect)

**Session:** SPX Slayer post-close fix agent per `docs/ops/SPX-RTH-ALL-DAY-AGENT.md` Step 6 (Cloud Agent `cursor/spx-post-close-findings-fde7`).

**Evidence.** `npm run validate:spx-rth -- --phase=post-close` → 6 PASS / 1 WARN / 0 FAIL; `npm run validate:spx-e2e` → 0 FAIL / 18 checks; `npm run validate:deploy` → GREEN. Matrix oracle: 159 strikes GEX+VEX+DEX+CHARM finite; cross-endpoint spot merged=7736.52 hm=7736.52; play SCANNING with no stale confirmations; BIE `getSpxPlayState()` consistent; cross-tool integration (Thermal, HELIX, Largo, Grid, 0DTE, Night Hawk) all PASS.

**Today's findings.** Reviewed all `spx-rth-2026-08-04` verify passes (open through pass5). No unresolved P0/P1 SPX defects. Harness-only initial FAIL (missing `node_modules`) resolved via `npm install` + Playwright chromium install.

**Status.** `fix/spx-post-close-aug4-green` → PR #1661.

## 2026-08-03 — [Grid/0DTE] Post-close fix agent (cloud session) — all validators GREEN (~3:14 PM PT / 6:14 PM ET)

**Severity.** — (no additional product defects)

**Session.** Cloud Agent post-close fix per `docs/ops/GRID-RTH-ALL-DAY-AGENT.md` Step 4 (executed ~3:14 PM PT / 6:14 PM ET / 22:14 UTC).

**Evidence.**
- `validate:grid-rth -- --phase=post-close` → **12/12 PASS** (0 FAIL; `zerodte-warm` cron WARN HTTP 502 transient; data-correctness flags=0; ops:collect zero items)
- `validate:zerodte-logic` → **17/17 PASS** — gates, plan exits (-50%/+100%/15:30 ET), lifecycle OPEN→TRIM→CLOSED, mergePlays SKIP past cutoff/MOVED, live board 7 setups / 2 ledger, cutoff 14:00 ET
- `validate:grid-e2e` → **5/5 PASS** — board API 7/2, HELIX 20 prints, Playwright `/nighthawk` load, zero console errors
- `validate:deploy` → **GREEN**

**Root cause.** First run in fresh cloud env failed on missing `node_modules` (tsx/playwright/pg/react) — environment only. After `npm install` + `npx playwright install chromium`, all suites GREEN on re-run. No gate logic, play picking, trade management, mergePlays, cron bypass, or ledger PnL defects found.

**Status.** FIXED — no code changes required; docs only on `fix/grid-post-close-aug3-agent-evening`.

## 2026-08-03 — [Grid/0DTE] Post-close fix agent — all validators GREEN (~1:05 PM PT / 5:10 PM ET)

**Severity.** — (no additional product defects)

**Session.** Scheduled post-close fix agent per `docs/ops/GRID-RTH-ALL-DAY-AGENT.md` Step 4 (~1:05 PM PT slot; executed ~5:10 PM ET / 21:10 UTC).

**Evidence.**
- `validate:grid-rth -- --phase=post-close` → **12/12 PASS** (0 FAIL; `zerodte-warm` cron accepted, data-correctness flags=0, ops:collect zero items)
- `validate:zerodte-logic` → **17/17 PASS** — gates, plan exits (-50%/+100%/15:30 ET), lifecycle OPEN→TRIM→CLOSED, mergePlays SKIP past cutoff/MOVED, live board 6 setups / 2 ledger, cutoff 14:00 ET
- `validate:grid-e2e` → **5/5 PASS** — board API 6/2, HELIX 20 prints, Playwright `/nighthawk` load, zero console errors
- `validate:deploy` → **GREEN**

**Root cause.** Initial cloud-agent run failed on missing `node_modules` (tsx/playwright/pg) — environment only. After `npm install` + `npx playwright install chromium`, all suites GREEN. RTH verify pass earlier today (`grid-rth-2026-08-03`, PR #1554) already confirmed zero P0/P1 Grid/0DTE defects; no gate logic, play picking, trade management, mergePlays, cron bypass, or ledger PnL fixes required.

**Status.** FIXED — no new code changes required; docs only on `fix/grid-post-close-aug3-green`.

## 2026-07-31 — [Grid/0DTE] Post-close fix agent pass 6 — all validators GREEN (~3:17 PM PT / 6:17 PM ET)

**Severity.** — (no additional product defects)

**Session.** Scheduled post-close fix agent per `docs/ops/GRID-RTH-ALL-DAY-AGENT.md` Step 4 (~1:05 PM PT slot; executed ~3:17 PM PT / 6:17 PM ET).

**Evidence.**
- `validate:grid-rth -- --phase=post-close` → **12/12 PASS** (0 FAIL; transient `zerodte:upstream` + `integration:helix-flows` WARN off-hours)
- `validate:zerodte-logic` → **17/17 PASS**
- `validate:grid-e2e` → **4/4 PASS** (Playwright WARN only — chromium not installed in sandbox; API probes authoritative)
- `validate:deploy` → **GREEN**

**Root cause.** Initial cloud-agent run failed on missing `node_modules` (tsx/playwright/pg) — environment only. After `npm install`, all suites GREEN. Prior pass-4 fix (`buildMinimalBoardFallback` live ET session heat, PR #1457) holds.

**Status.** FIXED — no new code changes required; docs only on `fix/grid-post-close-pass6-green`.

## 2026-07-31 — [Grid/0DTE] Post-close fix agent pass 4 — all validators GREEN (~5:39 PM ET)

**Severity.** — (no additional product defects after fix above)

**Session.** Scheduled post-close fix agent per `docs/ops/GRID-RTH-ALL-DAY-AGENT.md` Step 4 (~1:39 PM PT / 5:39 PM ET).

**Evidence.**
- `validate:grid-rth -- --phase=post-close` → **12/12 PASS** (0 FAIL; upstream WARN transient)
- `validate:zerodte-logic` → **17/17 PASS**
- `validate:grid-e2e` → **5/5 PASS** (Playwright `/nighthawk`, zero console errors)

**Root cause.** Initial cloud-agent run failed on missing `node_modules` (tsx/playwright/pg) — environment only. One product defect: minimal fallback session heat (above).

**Status.** FIXED on `fix/grid-minimal-fallback-session-heat`.

## 2026-08-03 — [spx] Post-close fix agent — all validators GREEN (~6:10 PM ET)

**Severity:** — (no product defect)

**Session:** SPX Slayer post-close fix agent per `docs/ops/SPX-RTH-ALL-DAY-AGENT.md` Step 6 (Cloud Agent `cursor/spx-post-close-findings-1080`).

**Evidence.** `npm run validate:spx-rth -- --phase=post-close` → 6 PASS / 1 WARN / 0 FAIL; `npm run validate:spx-e2e` → 0 FAIL / 17 checks; `npm run validate:deploy` → GREEN. Matrix oracle: 167 strikes GEX+VEX+DEX+CHARM finite; cross-endpoint spot merged=7600.5 hm=7600.5; play SCANNING with no stale confirmations; BIE `getSpxPlayState()` consistent; cross-tool integration (Thermal, HELIX, Largo, Grid, 0DTE, Night Hawk) all PASS.

**Harness fix.** P2 `SPX-RTH-E2E-HERO`: E2E still probed removed `.spx-trade-alert-hero` — updated to `.spx-play-verdict-bar` (`SpxPlayVerdictBar`) with SCANNING/HUNTING stale-confirmation guard.

**Status.** `fix/spx-e2e-verdict-bar-selector` → PR.

## 2026-08-03 — [spx] Post-close fix agent — all validators GREEN (~1:14 PM PT / 4:14 PM ET)

**Severity:** — (no product defect)

**Session:** SPX Slayer post-close fix agent per `docs/ops/SPX-RTH-ALL-DAY-AGENT.md` Step 6 (Cloud Agent `cursor/spx-post-close-findings-21ec`).

**Evidence.** `npm run validate:spx-rth -- --phase=post-close` → 6 PASS / 1 WARN / 0 FAIL; `npm run validate:spx-e2e` → 0 FAIL / 17 checks; `npm run validate:deploy` → GREEN. Matrix oracle: 167 strikes GEX+VEX+DEX+CHARM finite; cross-endpoint spot merged=7600.5 hm=7600.5; play SCANNING with no stale confirmations; BIE `getSpxPlayState()` consistent; cross-tool integration (Thermal, HELIX, Largo, Grid, 0DTE, Night Hawk) all PASS.

**Environment flake.** First cloud-agent pass failed on missing `node_modules` (tsx/playwright/pg) — resolved with `npm install` + Playwright Chromium install. No product code changes required.

**Status.** GREEN — no additional fix branch required.

## 2026-07-31 — [spx] Post-close fix agent final — all validators GREEN (~3:10 PM PT / 6:10 PM ET)

**Severity:** — (no product defect)

**Session:** SPX Slayer post-close fix agent per `docs/ops/SPX-RTH-ALL-DAY-AGENT.md` Step 6 (Cloud Agent `cursor/spx-post-close-findings-9fd0`).

**Evidence.** `npm run validate:spx-rth -- --phase=post-close` → 6 PASS / 1 WARN / 0 FAIL; `npm run validate:spx-e2e` → 0 FAIL / 17 checks; `npm run validate:deploy` → GREEN. Matrix oracle: 170 strikes GEX+VEX+DEX+CHARM finite; cross-endpoint spot merged=7489.72 hm=7489.72; play SCANNING with no stale confirmations; BIE `getSpxPlayState()` consistent; cross-tool integration (Thermal, HELIX, Largo, Grid, 0DTE, Night Hawk) all PASS.

**Environment flake.** First cloud-agent pass failed on missing `node_modules` (tsx/playwright/pg) — resolved with `npm install` + Playwright Chromium install. Transient `merged spot 0` on first cross-endpoint probe resolved on retry (harness retry already merged #1456).

**Product fixes already on main.** P0 matrix unavailable (#1428), heatmap enrichment timeout, socket-health REST fallback, SPX E2E Clerk mint hardening (#1454), merged-spot retry + 502 filter (#1456).

**Status.** GREEN — no additional fix branch required.

## 2026-07-31 — [spx] Post-close fix agent — all validators GREEN (~1:05 PM PT)

**Severity:** — (no product defect)

**Session:** SPX Slayer post-close fix agent per `docs/ops/SPX-RTH-ALL-DAY-AGENT.md` Step 6.

**Evidence.** `npm run validate:spx-rth -- --phase=post-close` → 6 PASS / 1 WARN / 0 FAIL; `npm run validate:spx-e2e` → 0 FAIL / 17 checks; `npm run validate:deploy` → GREEN. Matrix oracle: 170 strikes GEX+VEX+DEX+CHARM finite; cross-endpoint spot merged=7489.72 hm=7489.72; play SCANNING with no stale confirmations; BIE `getSpxPlayState()` consistent; cross-tool integration (Thermal, HELIX, Largo, Grid, 0DTE, Night Hawk) all PASS.

**Harness flake.** First post-close orchestrator pass failed `spx:cross-endpoint` on transient `merged spot 0` while heatmap held 7489.72 — cold merged cache edge (same class as 2026-07-30). Retry passed; harness now retries merged fetch when heatmap spot is live but merged price is 0.

**Product fixes already on main.** P0 matrix unavailable (#1428), heatmap enrichment timeout, socket-health REST fallback, SPX E2E Clerk mint hardening (#1454).

**Status.** GREEN — harness retry in `fix/spx-cross-endpoint-merged-retry`.

## 2026-07-30 — [spx] Post-close fix agent — all validators GREEN (~3:09 PM PT)

**Severity:** — (no product defect)

**Session:** SPX Slayer post-close fix agent per `docs/ops/SPX-RTH-ALL-DAY-AGENT.md` Step 6.

**Evidence.** `npm run validate:spx-rth -- --phase=post-close` → 6 PASS / 1 WARN / 0 FAIL; `npm run validate:spx-e2e` → 0 FAIL / 17 checks; `npm run validate:deploy` → GREEN. Matrix oracle: 172 strikes GEX+VEX+DEX+CHARM finite; cross-endpoint spot merged=7437.63 hm=7437.63; play SCANNING with no stale confirmations; BIE `getSpxPlayState()` consistent; cross-tool integration (Thermal, HELIX, Largo, Grid, 0DTE, Night Hawk) all PASS.

**Root cause.** No new product defects. Initial cloud-agent run failed on missing `node_modules` (tsx/playwright/pg) and Playwright browser binary — environment setup, not member-facing. Transient `merged spot 0` on first probe resolved on retry (cold merged cache edge).

**Status.** GREEN — no fix branch required. Prior fixes already on main: cross-replica play cache (#1382), E2E harness hardening (#1383).

evidence / fix / status per the CLAUDE.md policy.)

## 2026-07-30 — [Grid/0DTE] Post-close fix agent — all validators GREEN

**Severity.** P2 doc only — no product defects.

**Symptom.** Scheduled post-close fix pass (~1:17 PM PT / 5:17 PM ET) per `GRID-RTH-ALL-DAY-AGENT.md` Step 4.

**Evidence.** After `npm install` on current `main` (`68fa6983`):
- `validate:grid-rth -- --phase=post-close` — **13/13 PASS** (board 13 setups / 15 ledger, ledger PnL coherent, zerodte-warm 202, data-correctness flags=0, ops:collect zero items)
- `validate:zerodte-logic` — **17/17 PASS** (gates, plans, lifecycle OPEN→TRIM→CLOSED, mergePlays past-cutoff→SKIP, live board)
- `validate:grid-e2e` — **4/4 PASS** (board API + HELIX flows; Playwright WARN only — chromium not installed in sandbox)
- `validate:deploy` — GREEN

First orchestrator attempt failed on missing `node_modules` (tsx/playwright/pg/react) — env-only, not prod.

**Fix.** Runbook `GRID-RTH-ALL-DAY-AGENT.md` updated: classic `/grid` deleted 2026-07-07; Step 2 now `/nighthawk`; coverage list matches `grid-rth-all-day-audit.mjs` (zerodte-warm, not grid-warm).

**Status.** FIXED on `fix/grid-runbook-nighthawk-20260730`.

---

## 2026-08-15 — [Full-stack production audit] Membership, security, latency, deploy — required stages GREEN

**Session.** Off-hours ET (~18:15 ET Sat). Branch `cursor/full-stack-production-audit-3d11`.

**Tier / membership (live prod).**
- `tier-access-e2e.mjs` — **39/39 GREEN** (free/community/premium × 6 desk pages + 7 API gates incl. Largo POST + admin health)
- Tier model: `free` / `community` (SPX Slayer) / `premium`; `pro`/`elite` alias → `premium`; admin = role overlay
- Whop webhook overwrites temp tiers unless `tier_managed_by: "admin"` — harness lock verified

**Security.**
- `deep-security-audit.mjs` — **P0=0 P1=0** after harness tier-lock fix; P2×3 CSP `unsafe-eval` (TradingView embed — accepted)
- `validate:api-auth` — 201 routes, 17 public allowlist, all guarded
- Cron/webhook bypass, open redirects, IDOR, admin escalation — no leaks
- Headers: HSTS, CSP, X-Frame-Options, nosniff via Cloudflare; no source maps in prod build

**Deploy / ops.**
- `validate:deploy` — GREEN (ECS rollout IN_PROGRESS noted)
- `ops:collect` — 0 action items

**Latency (optional).**
- APIs warm 30–100ms; cold `/api/ready` spike during rollout (4.1s one sample)
- Browser paint: dashboard/heatmap `content ready` hit 30s selector timeout during deploy (transient); nighthawk ~1.1s off-hours after threshold tuning

**Harness fixes shipped in PR.**
- `tier-access-e2e`: POST APIs, admin 401|403, extended matrix
- `deep-security-audit`: `tier_managed_by` + JWT remint; clearer denial vs escalation titles
- `site-latency-audit`: off-hours ET thresholds + Night Hawk slow-desk carve-out
- `full-stack-production-audit.mjs` orchestrator + `npm run validate:full-stack-audit`

**Scalability notes (evidence-based, no load test).**
- Prod: ECS web 8–15 tasks (`REPLICA_COUNT=8`), 1 market worker, UW **2 RPS cluster-wide** hard cap
- First stress points: UW cache-miss storms + Clerk tier cache cold path before raw CPU; PG pool = `PG_POOL_MAX × REPLICA_COUNT` vs PgBouncer budget
- 1k concurrent: likely OK on cache hits; 10k+: UW/Redis hot-path saturation; 50k–100k: upstream provider ceiling before horizontal web scale helps

**Status.** GREEN required gates; optional latency flaky during deploy — re-run RTH for paint baselines.

## 2026-08-19 — Vector rail validation, PRE-DEPLOY baseline (all tickers x all horizons)

New tool: `scripts/audit/vector-rail-validate.mjs`. One command, per ticker x horizon: samples,
median/max gap, rows drawn per side, beads-per-row, and wall BIRTHS/DEATHS.

Captured against prod on ET session 2026-08-18, **before #2322 (append-only rails + rationing
removed) deployed** — so this is the "before" column for tomorrow's comparison.

| ticker | horizon | verdict | samples | medGap | maxGap | rows c/p | beads/row | born | died | static |
|---|---|---|---|---|---|---|---|---|---|---|
| SPX | all | GREEN | 649 | 60 | 245 | 8/8 | 217 | 22 | 20 | 10 |
| SPX | 0dte | GREEN | 3964 | 5 | 435 | 8/8 | 1035 | 31 | 25 | 7 |
| SPX | weekly | GREEN | 3845 | 5 | 435 | 8/8 | 1207 | 21 | 24 | 5 |
| SPX | monthly | GREEN | 3845 | 5 | 435 | 8/8 | 1353 | 17 | 20 | 8 |
| NVDA | all | GREEN | 442 | 60 | 600 | 6/8 | 307 | 7 | 6 | 10 |
| NVDA | 0dte | RED | 546 | 5 | 3570 | 8/8 | 298 | 10 | 11 | 11 |
| NVDA | weekly | RED | 100 | 70 | 3275 | 7/8 | 80 | 5 | 4 | 12 |
| NVDA | monthly | RED | 98 | 70 | 4205 | 7/8 | 84 | 4 | 3 | 10 |
| TSLA | 0dte | RED | 750 | 5 | 2105 | 8/8 | 523 | 8 | 6 | 13 |
| TSLA | weekly | RED | 591 | 5 | 2105 | 8/8 | 332 | 10 | 9 | 10 |
| AAPL | weekly | RED | 70 | 300 | 4205 | 8/8 | 53 | 7 | 6 | 12 |
| SPY | weekly | RED | 64 | 300 | 3305 | 8/8 | 31 | 15 | 15 | 11 |
| QQQ | weekly | RED | 97 | 70 | 3905 | 8/8 | 41 | 19 | 18 | 9 |

(Full 24-row output in the PR; the rows above are the ones that carry the argument.)

**Three things this settles.**

1. **Row selection was never broken.** Every ticker draws 6-8 rows per side on every horizon,
   identical to SPX. The "NVDA has one level, SPX has ten" report is entirely beads-per-row:
   SPX weekly 1207 beads/row against NVDA 80, AAPL 53, SPY 31.
2. **Births and deaths WORK.** Every rail shows staggered births and deaths (SPX 0dte 31 born /
   25 died; QQQ 0dte 27/33; NVDA weekly 5/4). No rail is a static ladder, so the "same walls all
   day" failure mode is NOT present. This was an open question and the answer is positive.
3. **The discrimination is on the NARROWED horizons only.** The blended "all" rail is coarse for
   everyone (~442 samples, 60s median) including SPX — no per-ticker bias there. On 0dte/weekly/
   monthly, SPX sits at 3845-3964 samples / 5s median while every other name is 64-750 with 35-70
   minute holes. That is the viewing-drives-density effect #2322 removes.

## 2026-08-21 — Largo payload hygiene: both systemic classes measured to ZERO

`scripts/audit/largo-payload-hygiene.mjs`, 28 tools, live upstream data, run through the REAL
model-facing path (`roundResultForReading`, as `makeGuardedToolRunner` applies it).

| class | before | after | fixed by |
|---|---|---|---|
| `bare_epoch` (a timestamp with no readable date on the same object) | 60 | **0** | #2418 |
| `unrounded_float` (more decimals than any real measurement) | 547 | **0** | #2419 |

`21/21 SCANNED tools clean · 0 flagged leaves · 7 EMPTY · 0 ERRORED`. The 7 EMPTY are off-hours
tools with genuinely no data (post-close); they are reported as UNKNOWN and are NOT counted as
passes — an empty payload scans clean by construction, which is the failure this harness exists to
catch and once committed itself.

**Scope of the claim.** This runs the real code path against live upstreams, so it proves the fixes
work. It does not prove members are receiving them — that is the deploy, which was still rolling ECS
when this ran. The separate answer-level check (`scratch/largo-dated-close-probe.mjs`, baseline
**1/5** dated closes correct) hits the live site and is still outstanding.

**Harness correction made in the same run.** The scanner previously called `runLargoTool` directly,
which bypasses the guarded runner — so it was measuring a payload no model ever sees. It would have
kept reporting hundreds of already-rounded floats as violations, and could not have verified #2419
at all. It now mirrors the real path and refuses to run if it cannot resolve the rounding function,
rather than silently scanning the raw surface again.

## 2026-08-21 — Largo truncation probe, first live run (Night Hawk lane)

New harness `scripts/audit/largo-truncation-probe.mjs`. Asks the LIVE agent whether each tool's
raw `tool_result` ended with the transport's `…[truncated]` marker — the question no prior Largo
audit asked, and the only way to answer it from this sandbox (the in-process hygiene scanner
cannot reach any DB-backed tool here).

```
CONTROL get_nighthawk_outcomes -> TRUNCATED
  instrument PROVEN — it detected a real truncation, so COMPLETE below means clean

  ✅ get_zerodte_record         COMPLETE
  ✅ get_zerodte_plays          COMPLETE
  ✅ get_nighthawk_edition      COMPLETE
  ❌ get_nighthawk_outcomes     TRUNCATED

=== 1 TRUNCATED · 3 clean · 0 unverified · 0 indeterminate ===
```

Two results worth recording:

1. **#2433 and #2436 are confirmed holding in PRODUCTION**, not merely CI-green — `get_zerodte_record`
   and `get_nighthawk_edition` both come back COMPLETE, and `get_zerodte_record`'s last visible key
   is `plays`, which is exactly the aggregates-first / sample-last shape #2433 shipped.
2. **The control fired**, so the three COMPLETEs are trustworthy negatives rather than a run that
   silently never reached the model. `get_nighthawk_outcomes` is the tool #2480 fixes and is still
   truncated on the deployed build, as expected.

Swept separately with the same probe and also COMPLETE: `get_nighthawk_dossier` (last key
`archived`), `get_cortex_decision` (`context`), `get_horizon_outcomes` (`sample`).


## 2026-08-21 — Largo truncation probe, full lane sweep (Night Hawk)

Second live run, now over all 13 lane tools rather than 3-4 at a time. Two things came out of it —
one a validation, one a defect in the harness itself.

```
CONTROL get_nighthawk_outcomes -> TRUNCATED
  instrument PROVEN — it detected a real truncation, so COMPLETE below means clean

  ✅ get_zerodte_record       ✅ get_zerodte_plays      ✅ get_zerodte_rejections
  ✅ get_nighthawk_edition    ❌ get_nighthawk_outcomes ✅ get_nighthawk_horizons
  ✅ get_nighthawk_dossier    ✅ get_horizon_outcomes   ✅ get_cortex_decision
  ✅ get_gate_blocked_value   ✅ get_grader_agreement
  ❔ get_banger_board         ❔ get_swing_horizon      — HTTP 401

=== 1 TRUNCATED · 10 clean · 0 unverified · 2 indeterminate ===
```

**The validation.** Ten lane tools measured CLEAN in production with the control proving the
instrument in the same run. `get_zerodte_record` (#2433) and `get_nighthawk_edition` (#2436) are
confirmed holding on the deployed build, and eight more lane tools now have a first measurement
rather than an assumption. `get_nighthawk_outcomes` is still TRUNCATED, which is correct: #2480
fixes it and is still an unmerged draft. Nothing here is new breakage.

**The defect, in the probe.** The FIRST attempt at this sweep returned twelve INDETERMINATEs and
gave no way to tell why — a model that hedged, a model that never answered, and twelve HTTP
failures all rendered as the same blank. They were HTTP 401: the temp Clerk session stops
authenticating partway through a run this long. One fact — the session died — had been smeared
across twelve rows, each of which read like a finding about a tool.

That is the same shape this repo keeps catching in the product (an absence printed as an
emptiness), found this time in the audit tooling. Two changes: every INDETERMINATE now states
which kind of unknown it is (`HTTP 401 — the question never reached the model`, `reply claimed
BOTH truncated and complete`, `empty reply`, `never appears in the trace`), and a 401/403 now
ABORTS the run and says so once, instead of spending the remaining queries on a locked door and
reporting the results as per-tool unknowns.

`get_banger_board` and `get_swing_horizon` were left UNMEASURED by that run, not clean — and a
gap you have written down is a gap you have to close. Re-probed on their own (a two-tool run stays
well inside the session's lifetime, which is what the abort now makes visible):

```
CONTROL get_nighthawk_outcomes -> TRUNCATED
  instrument PROVEN

  ✅ get_banger_board       COMPLETE
  ✅ get_swing_horizon      COMPLETE

=== 0 TRUNCATED · 2 clean · 0 unverified · 0 indeterminate ===
```

**The lane is now fully measured**: 12 of 13 tools COMPLETE on the deployed build, and the one
TRUNCATED is `get_nighthawk_outcomes`, which #2480 fixes and which is still an unmerged draft.

## 2026-08-21 — Night Hawk × Largo stress harness, first committed run

New reusable harness `scripts/audit/nighthawk-largo-stress.mjs` (+ pure, unit-tested graders in
`lib/nighthawk-largo-checks.mjs`). Asks live Largo hard member questions and grades each answer
against the product's own ground-truth endpoints, with each fixed defect encoded as a standing
regression check on Largo's ANSWERS. First run (phase PRE_MARKET), against the deployed build
BEFORE the day's fixes drained:

```
  ❌ condor-exists          denies the condor exists: "does not publish iron condor"
  ❌ condor-exists          condor win rate cited with NO breach/negative-skew companion
  ✅ rejections-session     session claim consistent with phase PRE_MARKET
  ❌ banger-pnl-signs       WRBY: stated -34.62% but realized +32.69%; VKTX: stated -34.62% but realized +50%
  ✅ gate-value-denominator stated rates are self-consistent
  === 3 FAIL ===
```

The three FAILs are the exact defects still awaiting deploy: the condor confabulation (#2519) and
the banger closed-winner-as-loss (#2490). The harness reproducing them live is the proof it works —
they flip to PASS when those deploy, which is the live-validation the charter asks for, automated.
The two PASSes are honest but luck-dependent this run (the model happened to state the pre-market
phase and a consistent denominator); #2525 and #2523 make them robust rather than luck.

NOT a CI gate: it hits live prod, whose current state legitimately carries pending-deploy defects.
It is a manual / scheduled post-close QA tool, like the truncation probe.

## 2026-08-21 — Helix RTH live-product validation pass (market open, 09:36–11:40 ET)

Live validation of the HELIX tape and its Largo surface during the open market, per the RTH
heartbeat. Prod (`blackouttrades.com`), premium session, read-only.

- **Tape flowing.** Market-wide + SPX pulls returned live prints, newest 0–1 min old (SPX 2h: 199
  prints, $446M premium). Real-time ingestion, not a stale replay.
- **Provider cross-check (direct, not our aggregate).** UW `flow-alerts` returned 200 live SPX
  alerts (newest ~8 min old); our raw `option_trades` ingestion was *fresher* (1 min) — the two are
  different UW products, and the freshness ordering is the expected one.
- **#2520 + #2528 live-validated on the real session.** SPX authoritative `session.call_pct` = 78%
  bullish (calls $1,276M vs puts $367M); the compare-card flow bias reads bullish off the *identical*
  premiums (`compareSidesFrom` over the recent-session population), not carried by a LEAP whale.
  Single-sourced, agrees — the property #2520/#2528 shipped.
- **Absence vs measurement.** signal-outcomes reconcile exactly (graded 40 = 25 continued + 12 flat
  + 3 reversed; every rate divides by a real denominator). Also caught + disambiguated a **transient
  false-absence** — an SPX pull momentarily returned 0 prints; a re-pull showed 500. Reported the 0
  as a stale read, not an empty tape.
- **Window-claim vs window-used swept clean** across every HELIX model-facing tool: `helixDerived`
  publishes no window claim (rolling windows anchored to nowMs), `flowBrief` and `tapeAnalytics`
  route through `tapeWindowCoverage` (actual_hours + limit_reached); the compare card was the last
  gap and is fixed by #2567.
- **Member `/flows` UI** rendered clean on live data via `proxy-browser.cjs` (112 requests ok / 0
  fail, live anomaly panel populated, no overflow).

Defect found + shipped this session: **#2578** (signal follow-through rate carried a read-time
`as_of` but no data-time window — `graded_window` added). Follow-up build shipped: **#2597** (C10
`session_skew_baseline` — is today's skew unusual vs the ticker's recent norm).

**Model-facing re-validation of #2567/#2578/#2597 is OWED and currently BLOCKED**: on 2026-08-21
~17:40Z Largo's answering path is a live P0 (every question returns "couldn't pull enough live data",
`tools_used` shows prefetch only, no answering tool reached — confirmed 3/3 on the HELIX lane,
reported on #2591; Night Hawk owns the diagnosis). Until that is fixed AND each PR's deploy drains,
`get_helix_signal_outcomes.graded_window`, `get_helix_thermal_compare.window_hours`, and
`get_helix_tape_analytics.session_skew_baseline` cannot be exercised through their intended surface.

---

## 2026-08-22 — SPX env-drift audit, first run (GREEN, no defect found)

**Lane:** SPX Slayer. **Tool:** `scripts/audit/spx-env-drift.mjs` (new, this run's subject).

Closes `docs/spx/SLAYER-MAP.md` §8 item 0. Not logged in `FINDINGS.md` — nothing here is broken;
the production overrides are coherent operational tuning, and the only defect this question
produced (a map freshness table built from code defaults, wrong by 50% on the desk lane) was
already fixed in #2632.

**142 SPX-relevant `process.env` keys referenced across 156 files. Six override their code default:**

```
PLAYBOOK_LIVE_GATE               code=false   deployed=1
SPX_DESK_CACHE_SEC               code=20      deployed=30
SPX_PULSE_CACHE_SEC              code=1       deployed=2
SPX_FLOW_CACHE_SEC               code=2       deployed=5
SPX_PLAY_MEMBER_READ_CACHE_SEC   code=5       deployed=2
SPX_CHAIN_QUOTE_TTL_MS           code=5000    deployed=4000
```

132 unset (the code default genuinely governs) · 1 no-op (`ENGINE_INTEL_OVERLAY="0"`, equal to its
default — looks deliberate, is not) · 3 secrets with no determinable default.

**The useful shape:** the trap is small and enumerable, not everywhere. Five of the six are latency
knobs, and the tuning is coherent — the three shared lanes are all *slowed* while the per-member
play read is *sped up*. `PLAYBOOK_LIVE_GATE=1` is the one with teeth: it is what made the
PB-01/PB-02 defect (#2636) a live P1 rather than a latent landmine.

**Two self-caught bugs during the run, worth recording because both would have reported a clean
sheet from a broken instrument:**

1. The first extractor read defaults only from the same line, so every `const raw = process.env.X;
   const v = raw ? Number(raw) : 20;` — the shape this repo uses for *every* cache TTL — reported
   `unknown`. That silently excused the three overrides the script was written to catch.
2. Fixing (1) with a consuming 240-char window advanced the regex past any other `process.env`
   reference inside it: **142 keys became 97 and two known overrides vanished.** Caught only by
   comparing against the hand-derived answer from a manual boto3 read minutes earlier. Now a
   lookahead. A scan that silently drops 45 keys still prints a confident summary.

Without credentials the script prints **SKIPPED, never GREEN**, and says so in those words —
"I could not look" must not render as "clean". Verified with bogus creds: exit 0, `SKIPPED`.
