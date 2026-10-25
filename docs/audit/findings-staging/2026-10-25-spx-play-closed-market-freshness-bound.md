## 2026-10-25 — [FINDING, P2 SPX Slayer] PR #6719's 20s freshness bound rejected every closed-market cached play snapshot, forcing a redundant re-evaluation on every contended poll — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED (PR #TBD, `fix/spx-play-closed-market-freshness-bound`) |
| **Found by** | Adversarially-verified live audit, same-day follow-up to PR #6719 |
| **Scope** | `src/features/spx/lib/spx-service.ts` (`waitForPeerSpxPlaySnapshot`, `evaluateSpxPlayStateCrossReplica`'s lock-not-won branch, `spxPlayReadFallback`), `src/features/spx/lib/spx-play-freshness.ts` |

### Root cause

PR #6719 (merged earlier today, `1f4f78319`) fixed a real bug: three of the four Redis read sites
for the shared `spx-play-read:<date>` cache key trusted `sharedCacheGetWithTtl`'s Redis-native
`ttl > 0` gate alone, with no check against the route's own 20s freshness bound
(`isSpxPlaySnapshotFreshEnough` / `playMemberPeekMaxAgeSec()`), serving snapshots up to ~24 minutes
stale non-monotonically. The fix applied that bound unconditionally at all three sites.

That over-corrects for the CLOSED-MARKET case. `evaluateSpxPlayCore`'s closed-market branch
(`src/features/spx/lib/spx-play-engine.ts`, the `!desk.market_open && !premarket` early return) —
and the shared `scanningPayload()`/`degradedPlayPayload()` builders
(`src/features/spx/lib/spx-play-payload.ts`) — all deliberately stamp `as_of` from the **desk
snapshot's own timestamp** (`desk.polled_at ?? desk.as_of`), not evaluation time, whenever
`session_phase` is `"closed"`. `evaluateSpxPlayState`'s own comment in `spx-service.ts` states the
intent directly: "once the market is genuinely closed, 'stale' and 'correct' are the same thing...
a generous staleness ceiling is safe here specifically." A plain 20s bound can never be satisfied
against that legitimately-old stamp, so every closed-market read at the three fixed sites was
rejecting the just-published snapshot and falling through to `waitForPeerSpxPlaySnapshot` (an
800ms poll loop against the identical, identically-failing key) and then `spxPlayReadDegraded()` —
forcing a redundant re-evaluation (or a "Desk warming" degraded placeholder) on every single
contended request during closed-market hours, defeating the "collapse member polls into one eval
per window" purpose `evaluateSpxPlayStateCrossReplica`'s single-flight lock exists to provide,
without fixing anything real: the re-evaluation reads the exact same stale `spx-merged:<date>`
desk peek (a DIFFERENT Redis lane, `peekMergedSpxDesk()`, which nothing refreshes off-hours except
incidental traffic to `loadMergedSpxDesk()` callers like `/api/market/spx/merged`) and produces an
identical result either way.

`session_phase` — already present on every `SpxPlayPayload` (`"premarket" | "cash" | "closed"`,
derived by `currentSessionPhase(desk)` or stamped directly in the closed-market branch) — is the
existing, reliable discriminator: whenever a payload's `session_phase` is `"closed"`, its `as_of`
is desk-snapshot time by design; every other payload (`"cash"`/`"premarket"`) that reaches the
degraded builders (`spxPlayReadDegraded`/`degradedPlayPayload`) stamps a genuine eval-time `as_of`,
and the one management/exit branch that force-settles an open position after close
(`spx-play-engine.ts`, the `!desk.market_open` SELL/SESSION-FLAT path) hardcodes
`session_phase: "cash"` with `as_of: confluence.as_of` (a fresh evaluation), not `"closed"` —
confirming the field never disagrees with the age semantics of `as_of` on this specific cache key.

### Evidence

Live, 2026-10-25: `GET /api/market/spx/play`'s `as_of` frozen at
`2026-10-25T21:15:02.434Z` across 3 consecutive polls spanning 22+ minutes, while the sibling
`GET /api/market/spx/desk` (its own independent `spx-desk:<date>` cache lane, refreshed by its own
traffic) stayed current the whole time — confirming the staleness lives in the un-refreshed
`spx-merged:<date>` desk-peek lane `/play`'s off-hours shortcut reads, not in `/desk`'s own path.
Traced the mechanism in the current source (`spx-service.ts`/`spx-play-engine.ts`/
`spx-play-payload.ts`), confirmed every `session_phase: "closed"` payload stamps `as_of` from
`desk.polled_at ?? desk.as_of`, and reproduced the rejection in a unit test against the actual
`evaluateSpxPlayStateCrossReplica` lock-not-won branch (RED pre-fix, see Regression tests below).

### Fix

Added `isSpxPlaySnapshotShareable(value, nowMs, maxAgeMs)` to `spx-play-freshness.ts`: trusts a
cached snapshot whose `session_phase === "closed"` regardless of its `as_of` age, otherwise falls
through to the existing `isSpxPlaySnapshotFreshEnough` bound unchanged. Swapped the three PR #6719
call sites (`waitForPeerSpxPlaySnapshot`, `evaluateSpxPlayStateCrossReplica`'s lock-not-won branch,
`spxPlayReadFallback`) from `isSpxPlaySnapshotFreshEnough(hit.value.as_of, ...)` to
`isSpxPlaySnapshotShareable(hit.value, ...)`. `peekSpxPlayState()` (the fourth, pre-existing
2026-09-13 reader of the same cache key, not part of PR #6719 and not named in this finding's root
cause) is deliberately left untouched — same unconditional `isSpxPlaySnapshotFreshEnough` behavior
it has had for over a month, out of scope for this same-day regression fix.

### Fix rationale

`session_phase` is the discriminator the engine already stamps for exactly this purpose, so the fix
reads it at the cache-read site rather than re-deriving market-open state independently there
(which would risk disagreeing with whatever state the snapshot was actually built under). An
alternative considered and rejected: widen the Redis-read freshness bound itself (e.g. to several
hours) — rejected because that would silently restore exactly the non-monotonic-stale-snapshot risk
PR #6719 fixed for the live-market case, just with a looser, easier-to-forget threshold instead of
a correct per-case rule. Deliberately left unchanged: PR #6719's live-market fix itself (a
live-market snapshot, `session_phase !== "closed"`, still has to clear the real 20s bound, proven by
the new "live-market... still rejected" regression tests below); `peekSpxPlayState()`'s identical
pre-existing check pattern (out of scope, not part of PR #6719, not touched); the underlying
`spx-merged:<date>` desk-peek lane's own off-hours staleness (a separate, lower-priority
observation the finding also traces but does not fix here — the frozen `as_of` itself is legitimate
display behavior once the market is genuinely closed, per `evaluateSpxPlayState`'s own stated
design intent; only the redundant-re-evaluation side effect is fixed).

### Blast radius

All three fixed call sites feed the same shared `spx-play-read:<date>` cache key read by every
consumer of `getSpxPlayState()`/`evaluateSpxPlayStateCrossReplica()` — member reads
(`GET /api/market/spx/play`), BIE `spx_full_state`, and Largo `get_spx_play`. No other call site in
the repo applies this freshness bound to a cached `SpxPlayPayload`-shaped value; `peekSpxPlayState`
is the only other reader of this exact key and is explicitly out of scope (see Fix above).

### Regression tests

Added to `src/features/spx/lib/spx-play-freshness.test.ts` (pure unit tests for the new predicate):
a closed-market snapshot ~22 minutes stale is shareable regardless of age; a live-market
(`session_phase: "cash"`) snapshot of the same age is still rejected; a premarket snapshot older
than the bound is still rejected (only `"closed"` is exempt); a fresh live-market snapshot within
the bound is still shareable; a null/undefined cached value is rejected (fail closed).

Added to `src/features/spx/lib/spx-service-play-cache-staleness.test.ts` (exercising the real
`evaluateSpxPlayStateCrossReplica` lock-not-won branch, per the finding's explicit request):
`evaluateSpxPlayStateCrossReplica serves a stale CLOSED-MARKET cached snapshot instead of forcing a
redundant re-evaluation` — a ~24-minute-stale snapshot with `session_phase: "closed"` is served
as-is. Confirmed RED pre-fix (stashed the source-only change via a temporary copy, re-ran the test:
failed, asserting the stale snapshot was wrongly rejected and the fallback's fresh `as_of` returned
instead) and GREEN post-fix. The existing PR #6719 test
(`evaluateSpxPlayStateCrossReplica rejects a stale ... cached snapshot ... (lock-not-won branch)`,
renamed to make explicit it exercises the LIVE-MARKET case) still passes unchanged, confirming
PR #6719's own fix is not weakened.

Ran the full suite under `src/features/spx/` (142 test files, 919 tests, 0 failures) and
`npx tsc --noEmit` (clean) on Node 20
(`export PATH=/opt/node20/bin:$PATH && npx tsx --experimental-test-module-mocks --test ...`).
