## 2026-11-09: SPX Slayer play eval collapses to total `available:false`/`score:0` on a thrown bars fetch instead of degrading like it already does for an empty one

> **kind:** `FINDING`

| **Status** | FIXED — this PR |
|---|---|

### Summary

`buildPlayTechnicals()` (`src/features/spx/lib/spx-play-technicals.ts`) is the SHARED function both
the member-read path (`evaluateSpxPlayState()`, `spx-service.ts:221`) and the cron-write path
(`GET /api/cron/spx-evaluate`, `route.ts:40`) call for SPX Slayer's 1m/3m/5m technicals (OR, VWAP
streaks, EMA9, RSI, breakout flags). It fetches its two upstream legs as:

```ts
const [bars, indexRsi] = await Promise.all([
  fetchIndexMinuteBars(SPX, today, today),
  fetchIndexRsi(SPX, 14, "minute"),
]);
```

`fetchIndexRsi` (`src/lib/providers/polygon.ts` ~1903-1921) already guards itself — its own comment
says why: *"polygonGet THROWS on a non-OK response, so a transient blip here would reject into
callers instead of degrading to null"* — and returns `null` on any failure. `fetchIndexMinuteBars`
(same file, ~1095-1102) has **no such guard**: `polygonGet` throws on a 403/429/any non-OK response
(polygon.ts ~43-44), and that raw throw propagated straight out of the `Promise.all`, out of
`buildPlayTechnicals`, out of `evaluateSpxPlayState` (whose own caller
`evaluateSpxPlayStateCrossReplica` only has `try {...} finally {...}` — no `catch`), and into
`withServerCache`'s internal `Promise.race` (`src/lib/server-cache.ts` ~491-498) — where a FAST
rejection wins that race before the timeout branch (the only one that engages the configured
`fallback: spxPlayReadFallback`) ever fires, skipping the fallback entirely.

`buildPlayTechnicals` already has a ready-made graceful degraded shape for exactly this situation —
`available: false, score`-relevant fields nulled/zeroed, the same shape used today whenever the
genuinely-empty-bars case (`if (!bars.length) return empty;`) fires — but that path was only
reachable when the fetch *resolved* to an empty array, never when it *threw*.

### Live evidence

Production, real RTH (desk-confirmed `market_open: true`), 2026-11-09:
`GET /api/market/spx/play` returned, on 3 consecutive polls over ~5 minutes:

```json
{"available":false,"phase":"SCANNING","score":0,"rawScore":0,"factors":[],"assessed":false,
 "headline":"Play scan still catching up — retry shortly","session_phase":"cash","degraded":true}
```

Cross-checked via `GET /api/admin/cron-health`: the `spx-evaluate` cron (the exact function calling
this same `buildPlayTechnicals` path every ~5min) showed `status:"failed"`,
`runs_24h:{ok:78,failed:93-95,skipped:15}` (~54% failure rate), `last_message` literally
`"Polygon /v2/aggs/ticker/I:SPX/range/1/minute/... → 403"` on one read and `"[polygon] Circuit open
— rate limited, pausing 44s"` on another — both consistent with the already-documented
Polygon/Massive real-time-snapshot entitlement loss and rate-limiter circuit breaker in `CLAUDE.md`
(2026-11-07/08 notes), neither of which this fix touches.

`src/app/api/cron/spx-evaluate/route.ts` (~38-92) calls `buildPlayTechnicals` directly inside one
outer `try/catch` that turns ANY failure into a hard `ok:false, 500` cron failure — the same gap on
the cron-write path, consistent with the ~54% 24h cron failure rate above.

### Root cause

```ts
// before — the whole eval collapses if EITHER leg throws, even though bars-empty already has a
// graceful path two lines below
const [bars, indexRsi] = await Promise.all([
  fetchIndexMinuteBars(SPX, today, today),
  fetchIndexRsi(SPX, 14, "minute"),
]);
if (!bars.length) return empty; // never reached on a THROW — only on a resolved []
```

`fetchIndexMinuteBars` not catching its own failure meant the one call site that most needed
graceful degradation (a live member-facing read, hit every few seconds during RTH, AND a cron that
hard-fails the whole route on any throw) had none — while its sibling call (`fetchIndexRsi`) already
had it, in the same file, for the same reason, visibly commented as deliberate. This was a
consistency gap within one file, not a design decision: nothing suggests the asymmetry was
intentional.

Why it wasn't caught earlier: every existing test for this file either tests the pure sub-helpers
directly (`spx-play-technicals-bars.test.ts`) or asserts against `spx-service.ts`'s/`route.ts`'s
own SOURCE TEXT (`spx-service.play.test.ts`) — none actually invoked `buildPlayTechnicals` itself
with a mocked fetch that throws, so the gap had no test surface at all until this fix added one.

### Evidence (RED → GREEN)

New file `src/features/spx/lib/spx-play-technicals-fetch-throw.test.ts`, mocking
`../../../lib/providers/polygon`'s `fetchIndexMinuteBars`/`fetchIndexRsi` directly (the isolation
under test lives in `spx-play-technicals.ts`, not in `polygon.ts`, so the provider module itself is
faked rather than its own internals).

RED (pre-fix, verified via a plain file-copy backup of `spx-play-technicals.ts` restored before
re-running — not `git stash`, per this repo's shared-worktree stash risk):

```
not ok 1 - a genuine fetchIndexMinuteBars THROW degrades to the same available:false shape as empty bars, instead of propagating (2026-11-09 fix)
  error: 'Polygon /v2/aggs/ticker/I:SPX/range/1/minute/... → 403'
not ok 2 - fetchIndexRsi ALSO throwing (double-fault) is still graceful — no unhandled rejection, same empty shape
  error: 'Polygon /v2/aggs/ticker/I:SPX/range/1/minute/... → 403'
ok 3 - a genuinely-empty bars response (fetch resolves to []) still returns the same available:false shape — unchanged pre-existing behavior
ok 4 - a successful bars fetch with real data still produces an available:true result (no over-broad catch)
# tests 4, pass 2, fail 2
```

GREEN (post-fix):

```
ok 1 - a genuine fetchIndexMinuteBars THROW degrades to the same available:false shape as empty bars, instead of propagating (2026-11-09 fix)
ok 2 - fetchIndexRsi ALSO throwing (double-fault) is still graceful — no unhandled rejection, same empty shape
ok 3 - a genuinely-empty bars response (fetch resolves to []) still returns the same available:false shape — unchanged pre-existing behavior
ok 4 - a successful bars fetch with real data still produces an available:true result (no over-broad catch)
# tests 4, pass 4, fail 0
```

Also ran (Node 20.20.2, `npx tsx --experimental-test-module-mocks --test`):
`spx-play-technicals-bars.test.ts`, `spx-play-technicals-freshness.test.ts`, `spx-service.play.test.ts`,
`cron/spx-issues-sync/route.test.ts` — **32/32 pass, 0 fail** (no regression in the sibling SPX
play-eval tests). Full `npm test` (7000+ tests across `src/` + `scripts/`) — green, see PR for the
exact tally. `npx tsc --noEmit` on Node 20.20.2: clean.

### Fix

Each leg of the `Promise.all` now degrades independently instead of letting a throw escape the
function:

```ts
const [bars, indexRsi] = await Promise.all([
  fetchIndexMinuteBars(SPX, today, today).catch(() => []),
  fetchIndexRsi(SPX, 14, "minute").catch(() => null),
]);
if (!bars.length) return empty; // now ALSO reached on a throw, not just a resolved []
```

`[]` for bars is the sentinel the very next line already treats as "no data" — routing a throw
through the exact same `available:false` branch a legitimately-empty response already takes, so
this is not a new code path, it's making an existing one reachable. `null` for RSI mirrors
`fetchIndexRsi`'s own internal guard (so a throw and its own internal null-on-failure path now look
identical to every caller, which is the stated intent of that guard's own comment). No new "empty"
shape was invented, per the task's explicit instruction.

**Why this one fix covers both call sites**: `buildPlayTechnicals` is the shared function — both
`spx-service.ts:221`'s `const technicals = await buildPlayTechnicals(merged.price, {...})` (member
read) and `cron/spx-evaluate/route.ts:40`'s identical direct call (cron write) call it with no
try/catch of their own around this specific call. Fixing it inside `buildPlayTechnicals` means
neither call site needs to change — traced both after the fix: neither has any surrounding
try/catch around the `buildPlayTechnicals` call itself, so both now receive a graceful
`available:false` `PlayTechnicals` object on a thrown fetch instead of an unhandled rejection. On the
cron route specifically, `runSpxEvaluator(merged, technicals, "cron")` is the next call after
`buildPlayTechnicals` — it already has to handle `technicals.available === false` today (the
existing empty-bars case, e.g. pre-market/thin data), so a thrown-fetch degrade reaching it in the
identical shape requires no further change there either.

### What was deliberately left unchanged

Per the task's explicit scope boundary: the underlying Polygon/Massive entitlement outage and the
rate-limiter circuit breaker are NOT touched — those are separate, already-tracked issues (see
`CLAUDE.md`'s 2026-11-07/08 notes). This fix only stops ONE upstream failure from collapsing the
whole SPX play evaluation; it does not retry past, route around, or paper over the outage itself. A
SPY-proxy-style substitute (the pattern `spxPriceFromSpyProxy()` uses for the desk price field,
PRs #7721/#7728/#7750) was considered per the task prompt and deliberately NOT used here — unlike
spot price, there is no cheaper substitute source for SPX's own 1m bars/RSI, and the function
already had the correct degrade-to-`available:false` shape ready; building a SPY-bar proxy would
have been new, untested surface for a problem the existing shape already solves honestly (a
desk/play panel that says "catching up" is strictly more honest than one synthesizing SPX technicals
from a SPY proxy during an entitlement outage).

### Blast radius

The fix lives inside the one shared function (`buildPlayTechnicals`), so it mechanically covers
**every** caller, not just the two the task named. A repo-wide grep for `buildPlayTechnicals(`
found seven call sites total (excluding the function's own definition and test files); each was
traced for whether it already had its own surrounding try/catch (meaning this fix changes nothing
observable there — it was already safe) or not (meaning this fix closes a real, previously-live
gap):

- **`spx-service.ts:221`** (`evaluateSpxPlayState`, the member-read path) — **no surrounding
  try/catch** at this call. The primary target of this fix; traced in detail above.
- **`cron/spx-evaluate/route.ts:40`** (the `spx-evaluate` cron's `GET` handler) — **no surrounding
  try/catch** at this call; the OUTER route-level `try/catch` turns any throw into a hard
  `ok:false, 500`. The second named target; traced in detail above.
- **`cron/spx-issues-sync/route.ts`** → `spx-issues-sync.ts:45`'s `runSpxIssuesSync()` — **no
  surrounding try/catch** at the `buildPlayTechnicals` call itself, and the cron route around it
  has the identical outer-try/catch-turns-any-throw-into-500 shape as `spx-evaluate`. Not named in
  the task, found while tracing blast radius — a second cron with the exact same bug shape, fixed
  by the same change with no further code needed.
- **`spx-play-engine.ts:1868`** (`evaluateSpxPlayCore`'s `prefetchedTechnicals ?? (await
  buildPlayTechnicals(...))` fallback, used by any caller of `evaluateSpxPlay`/`readSpxPlaySnapshot`
  that does NOT pass a prefetched `technicals`) — **no surrounding try/catch** at this call either.
  Now also degrades instead of throwing.
- **`admin-spx-dashboard.ts:181`** (`fetchSpxAdminDashboard`'s live-engine branch) — **no
  surrounding try/catch** at this call; an admin-only page, lower severity, but now also benefits.
- **`spx-slayer-badge.ts:42`** — **already wrapped** in its own try/catch
  (`buildSpxSlayerBadgeSnapshot`'s own doc comment: *"any failure... yields
  `unavailableSpxSlayerBadge()`... never a thrown error"*). Already safe before this fix; this fix
  changes nothing observable here (the inner function now resolves instead of rejecting, but the
  outer catch handled either outcome identically).
- **`admin-spx-health.ts:137`** — **already wrapped** in its own nested try/catch
  (`fetchSpxHealthSnapshot` explicitly catches around this exact call and records
  `errors.push(\`technicals: ...\`)`). Already safe before this fix for the same reason.

`fetchIndexMinuteBars`/`fetchIndexRsi` themselves are unchanged — this fix adds a `.catch()` only
inside `buildPlayTechnicals`, so every OTHER, unrelated caller of either function (e.g. the Vector
4h-bars route, which calls `fetchIndexMinuteBars` directly and already has its own per-day throw
handling) is unaffected.
