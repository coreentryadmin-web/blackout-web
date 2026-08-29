## Polygon's own fetch layer swallowed every failure (including a circuit-breaker throw) into a bare empty result — FIXED

> **kind:** `FINDING`

| **Status** | FIXED in `fix/polygon-fetch-swallowed-failure-reason` |
| **Severity** | P2 — desk-operations calibration surface, follow-up to the `blocked_value` reason-surfacing fix in the same audit pass |
| **Surface** | `src/lib/providers/polygon-largo.ts` `polygonGet`/`fetchAggBars`; consumed by `src/lib/zerodte/skip-grading.ts` |

### Root cause

The prior fix in this same pass (surfacing `ungradeable_reasons` in the calibration report,
plus capturing a thrown error in `skip-grading.ts`'s `barsFor`) assumed the underlying-bar fetch
would THROW on failure and get caught. A fresh production run after that fix deployed showed the
exact same generic reason ("no bar data available for the session...") on every one of a new
400-row batch, with `fetchThrew` never populated — meaning `fetchAggBars` genuinely never rejects.

Tracing one level deeper: `polygon-largo.ts`'s `polygonGet` wraps the whole request (not
configured, non-2xx status, or a caught exception) in a try/catch that returns a bare `null` in
every case, logging only a `console.warn` (server logs, never surfaced to this or any audit tool).
Critically, `polygonTrackedFetch` (`polygon-rate-limiter.ts`) DOES throw a real `Error` when the
Polygon circuit breaker is open (`"[polygon] Circuit open — rate limited, pausing Xs"`) — but
`polygonGet`'s own catch swallows that throw identically to a plain 404. So even the one failure
mode that already surfaces as a real exception elsewhere in the codebase never escaped this
function. `fetchAggBars` maps `polygonGet`'s `null` to a plain empty array, and by the time
`skip-grading.ts` sees it, an HTTP error, a network failure, a circuit-breaker trip, and a
genuinely-empty-but-successful response are all identically an empty array — the actual failure
mode was invisible everywhere: this app's own logs, the calibration report, and this session's
first-pass fix all missed it, because the swallow happens inside the shared provider function
every other caller in this file also depends on staying null-on-failure.

### Evidence

Manually replaying the exact Polygon endpoint outside the app (same params, real recent session
date) returned 797 real minute bars over HTTP 200 — ruling out "Polygon has nothing" a second time,
independently of the first pass's version of this same check. New tests in `skip-grading.test.ts`
pin both failure shapes: an actually-thrown exception (dynamic import failure) and the realistic
shape (`fetchAggBarsWithDiagnostics` returning a captured `failureReason` string with no throw at
all, modeling a circuit-breaker-open trip) both now surface as `"underlying bar fetch threw: <the
real reason>"` in the persisted counterfactual instead of the generic bar-empty message.

### Blast radius

`polygonGet` is called by several other functions in `polygon-largo.ts` (`fetchPreviousDayBar`,
`fetchPolygonMacd`, indicator resolvers). None of them are touched: the new `onFailure` parameter
is optional and defaults to a no-op, so every existing caller's behavior (return `null`/empty on
any failure, nothing more) is byte-for-byte unchanged. Only the new `fetchAggBarsWithDiagnostics`
sibling function (used solely by `skip-grading.ts`) opts into the diagnostic.

### Fix rationale

Added an additive `onFailure` hook to `polygonGet` rather than changing its return contract —
every other caller in this shared provider file depends on the plain `T | null` shape, and
widening that risked a much larger, riskier PR for a fix that only one caller actually needs.
`fetchAggBarsWithDiagnostics` is a new sibling to `fetchAggBars` (unchanged) rather than a
modification, so no other consumer of `fetchAggBars` is affected. This is now the second layer of
the same silent-absence-as-fact bug found and fixed in one pass — first in the report's own
aggregation, now in the fetch layer feeding it — and the next `?grade_skips=1` run against
production should finally show a real, specific reason (an HTTP status, a circuit-breaker pause,
or a genuinely empty range) instead of the generic message, which is the concrete next diagnostic
step once this deploys.
