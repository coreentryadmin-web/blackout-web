> **kind:** FINDING

## 287. GEX-heatmap warm path re-fetched Polygon+UW forever for tickers structurally lacking an options chain — a real, measured contributor to the 2026-09-18 UW/Polygon rate-limiter queue-timeout-surge incident — fix/gex-heatmap-no-chain-negative-cache — 2026-09-18

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P2 (real, measured waste against a scarce shared ceiling; not the incident's dominant volume — see below) |

**Trigger:** the operator reported repeated "UW rate-limiter queue timeouts surging" / "Polygon
rate-limiter queue timeouts surging" ops alerts firing roughly every minute starting ~7:35 AM ET
2026-09-18 (well before the 9:30 AM open), at least 7 consecutive fires, described as sustained
pressure rather than a one-off blip — an urgent, time-sensitive production investigation.

### Investigation (live evidence, not a guess)

Pulled `/ecs/blackout-production` CloudWatch Logs for the incident window (11:20–12:50 UTC =
7:20–8:50 AM ET) via the `[api-queue-timing]` structured log line every UW-bound fetch emits:
**2,458 UW admission events in 90 minutes**, max observed `queue_wait_ms` **19,987ms** (right at
the 20,000ms budget — i.e. real drops, not comfortable margin). Endpoint breakdown showed the
volume concentrated in two shapes:
1. **SPX-specific UW endpoints** (`spot-exposures/expiry-strike` 441, `flow-alerts` 162,
   `volatility/realized` 147, `historical-risk-reversal-skew` 137, `greek-exposure/expiry` 83,
   plus darkpool/nope/flow-per-strike-intraday) — high-frequency legitimate SPX desk/Meridian/0DTE
   reads, all sharing the one cluster-wide `UW_GLOBAL_MAX_RPS=2` ceiling.
2. **A wide spread of individual equity tickers each hit 40-90 times in 90 minutes**
   (AXGN/TDOC/ARLO/EFOR/AMPL/APPN/STLN/FIGS/RWTN/ACEEU/…) via `stock-state` and
   `spot-exposures/strike` — traced to `[gex-heatmap] 0 contracts for … — trying UW
   strike-exposure fallback` log lines from `src/lib/providers/polygon-options-gex.ts`, fired by
   the `heatmap-warm` cron sweeping the shared warm universe (`listSharedUniverseTickers`, ≤100
   tickers, static allowlist ∪ member-viewed dynamic set) roughly every 30-45s.

Checked the obvious "runaway job" hypotheses first, per the task's investigation order, and ruled
each out with evidence rather than assumption:
- **Recent merges** (`git log --since="2026-09-17 00:00" -- src/lib/providers …`): the only recent
  commits touching this area (#5200 daily-learning-digest, #5132 forward-return grading) both run
  post-close (16:30/whenever the debrief fires), not pre-market — not the trigger.
- **ECS scaling**: `application-autoscaling` scaling-activity history for
  `blackout-production-web` shows the LAST scaling event was 2026-08-18 (desired count stable at
  8 since); no scale-up today. Ruled out replica-count growth as a cause.
- **Redis health**: zero `Redis degraded`/`ECONNREFUSED`/connection-error log lines in the window —
  the shared cluster-wide UW ceiling (Redis-Lua-enforced) was healthy and correctly serializing
  callers to 2rps; the queue depth, not the enforcement, is what was failing.
- **Historical baseline**: the SAME `[api-queue-timing]` filter over the same 7:20-8:50 AM ET
  window on 2026-09-16 and 2026-09-17 returned **zero events on both days** — this is a real,
  today-specific anomaly, not a recurring daily pre-market pattern that would point at a fixed,
  known-and-accepted cadence.
- **Trend**: re-checked 12:50-14:45 UTC (through and past the 9:30 ET open) — volume kept climbing
  (175 → 779 events per 10-min bucket) rather than a discrete burst that ended, consistent with
  organic demand ramping through the open, not a single stuck/looping job that would show a flat
  or decaying signature.

### Root cause (confirmed, scoped) vs. what remains a known, previously-flagged capacity question

**What this PR fixes — confirmed, reproducible, safe:** two dead tickers, ACEEU and RWTN, logged
the "0 contracts … trying UW strike-exposure fallback" line on a steady ~75-90s cadence for the
entire 90+ minute window with ZERO successful builds. Tracing `buildGexHeatmapUncached`: the
Redis matrix-cache TTL (`gexHeatmapRedisTtlSec()`, default 90s) is a FIXED constant, not
parameterized by the per-ticker `ttlMs` the function otherwise varies — so once that Redis entry
expires, the function unconditionally re-runs the FULL Polygon chain fetch + (on 0 contracts) the
UW strike-exposure fallback, for a ticker that has already failed both on every prior attempt,
forever, for as long as it stays in the shared warm universe. The sibling "no spot" case in the
SAME function already has exactly this problem solved (`EMPTY_SPOT_NEGATIVE_TTL_MS`, a short
negative-cache) — the "0 contracts + UW fallback also empty" case had no equivalent, despite being
a MORE permanent condition (a ticker with no live options market structurally stays that way,
unlike a transient missing quote) and therefore deserving a LONGER negative-cache, not a shorter
one.

**What this PR does NOT claim to fix:** the two dead tickers above were a small fraction
(~2 calls/90s) of the observed 2,458-event/90-min total. The DOMINANT volume was legitimate,
correctly-functioning, cross-cron SPX/mag7/equity-universe warm traffic (heatmap-warm, desk-warm,
meridian-warm, platform-warm, vector-walls-warm, zerodte-warm — all gated within their intended
4am-8pm ET extended-warm window, none of them newly broken) all sharing one very tight
`UW_GLOBAL_MAX_RPS=2` cluster-wide ceiling with no cross-cron coordination about WHEN they fire.
**This is a previously-identified, previously-flagged architecture/capacity question, not a new
discovery of this investigation** — see `docs/audit/FINDINGS.md` entries for PR #5045 and #5048
(the UW queue-timeout-surge alert this incident actually PAGED on), both of which explicitly
concluded "is `GLOBAL_MAX_RPS=2` genuinely under-provisioned for real platform demand, or is there
an unbounded-fan-out bug — is a design/capacity decision this session's own discipline reserves
for the owning lane, not something to guess at mid-incident," and a 2026-09-10 Legacy-lane
recurrence note in `docs/audit/MARKET-OPEN-VALIDATION.md` that likewise deferred "the deeper 'is 2
RPS actually sized for real concurrent RTH-open demand' measurement… to whichever lane/session has
capacity to take the RPS-ceiling measurement next, rather than guessing at a new value." This PR
does not raise `UW_GLOBAL_MAX_RPS` or restructure the warm-cron schedules — doing so blind, under
incident time pressure, without the cross-desk caller-count/latency study those prior write-ups
call for, would risk either masking a real problem (raise the ceiling, get UW-side throttling
later) or destabilizing correctly-functioning crons. That capacity study remains open work for the
owning lane.

### The fix

`src/lib/providers/polygon-options-gex.ts`:
- New `NO_CHAIN_NEGATIVE_TTL_SEC = 600` (10 minutes) + `isKnownNoChainTicker`/`markNoChainTicker`
  helpers, a plain Redis marker keyed `gex-heatmap:no-chain:<root>`.
- `buildGexHeatmapUncached` now checks this marker FIRST, before even the spot fetch — a
  confirmed chain-less root short-circuits straight to `emptyHeatmap` with zero upstream calls.
- The "0 contracts" branch now calls `markNoChainTicker(root, now)` only AFTER the UW fallback has
  ALSO come up empty (never speculatively before attempting UW) — so a ticker only gets negative-
  cached once both upstreams have genuinely failed for it.
- Fails open throughout (a Redis error on the marker read/write just falls back to the pre-fix
  behavior — never a correctness risk, only a missed optimization).

### Evidence

`src/lib/providers/polygon-options-gex.test.ts`: new source-text regression test (matching this
file's existing convention of asserting internal build-path wiring by source, since the full
Polygon+UW call graph isn't practically mockable here) — asserts the negative-cache constant
exists, the short-circuit runs BEFORE the spot fetch (not after — else the spot call still leaks
every cycle), and `markNoChainTicker` only fires after the UW fallback has already returned null.
RED→GREEN proven via `git stash` of the source change alone (test file kept): 1 fail (the new
test) on stashed/pre-fix source, 70/70 pass after `git stash pop` restores the fix. Full
`polygon-options-gex.test.ts` suite: 70/70 pass. `npx tsc --noEmit -p .`: clean. Both run on Node
20 (`/opt/node20/bin`) per the repo's standing Node-version discipline.

### Blast radius

Only `fetchGexHeatmap`'s uncached-build path (the shared GEX/VEX/DEX/CHARM matrix builder used by
Thermal, Vector, Largo's `gex-positioning` tool, and every `heatmap-warm`/`desk-warm`/
`meridian-warm` warm sweep) is touched. No change to the matrix shape, TTL semantics for tickers
that DO have a chain, or any member-facing payload — a chain-less ticker already rendered an empty
matrix before this fix; it still does, just without repeating two guaranteed-to-fail upstream
calls every ~90s to get there.

### Fix rationale — why this and not raising the ceiling

Per the task's own explicit instruction: prefer fixing a confirmed runaway/duplicate-call pattern
over blindly raising a shared, provider-side rate ceiling. This fix does the former — it is a
strict reduction in wasted UW/Polygon demand with no behavior change for any ticker that has real
options data, and no risk to provider-side throttling. It is deliberately scoped to NOT attempt
the larger cross-cron capacity/scheduling redesign the dominant volume actually calls for, which
prior sessions have correctly identified needs a real design decision by the owning lane rather
than an incident-pressure guess.
