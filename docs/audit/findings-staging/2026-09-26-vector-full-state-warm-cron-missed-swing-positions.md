## `vector-full-state-snapshot` cron warmed only the static Vector allowlist, never a real committed swing position outside it — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Area** | Ask Largo × Night Hawk Swings standing mandate — Vector full-state cache warming |
| **Severity** | P3 (avoidable member-facing latency/absence on Ask Largo's swing play-brief for a real committed position — no trading-path/gate change) |
| **Status** | FIXED |
| **Files** | `src/app/api/cron/vector-full-state-snapshot/route.ts`, `src/features/vector/lib/vector-full-state-warm-universe.ts` (new), `.test.ts` (new + updated route test) |

### Root cause

`vector-full-state-snapshot`'s cron warms `vector:full-state:{ticker}:{horizon}` — the cache
`fetchVectorFullState`/`fetchEcosystemContext` read cache-first, consumed by Ask Largo's swing
play-brief, ecosystem context, and every other reader `vector-full-state.ts`'s own header lists.
It iterated only `vectorUniverseTickers()` (the ~40-name static allowlist), unlike its sibling
crons (`heatmap-warm`, `vector-walls-warm`) which already union in the dynamic (member-viewed)
universe via `listSharedUniverseTickers()`.

`vector-dynamic-universe.ts`'s own header names the resulting hole explicitly and had done so for
some time: "Night Hawk is deliberately NOT wired in here: its ticker universe is discovery-driven
... if Night Hawk ever needs its board's active tickers kept warm, that should be a bulk union of
discovery output, not this per-view path." Nobody had closed it — a ticker with a REAL, committed
swing position (real member capital) but outside the static allowlist never got proactively
warmed. Its full-state entry only existed when someone happened to read it, and expired 15 minutes
later (`VECTOR_FULL_STATE_CACHE_TTL_SEC`).

### Evidence

Live-reproduced 2026-09-26 on HUT, a real open swing position (`positionId` present, `liveStatus:
HOLD`) not on the static allowlist:

- `GET /api/market/swing/play-brief?playId=SWING:HUT&ticker=HUT&status=COMMIT` returned
  `unavailableSources` including `ecosystem context: fetch failed` and `Vector state: fetch
  failed` — a real, disclosed absence (correctly labeled per the 2026-09-06 `#11` fix
  distinguishing a thrown fetch from a legitimate empty read), not a fabricated one.
- Timing `GET /api/market/largo/context?ticker=HUT` (same `fetchVectorFullState` cache) three
  times in a row: **2169ms** (cold), then **287ms**, then **153ms** — confirming the failure mode
  is a cold-cache compute that can exceed the swing play-brief's 8s per-source budget
  (`BRIEF_SOURCE_TIMEOUT_MS`, `brief-source-timeout.ts`) under concurrent load, not a genuine
  upstream outage.
- The same spot-check on AAPL/AMZN/MSTR (all on the static allowlist) showed no `fetch failed`
  entries in the same window — only honest staleness/absence notes (`GEX matrix: stale`, `Vector
  heatmap: not present on this read`) — confirming the failure is specific to off-allowlist
  tickers, not a systemic weekend/off-hours condition.

### Fix rationale

Added `activeVectorFullStateTickers()` (`vector-full-state-warm-universe.ts`), unioning the
existing shared universe (`listSharedUniverseTickers()`: static ∪ member-viewed dynamic, ≤100/14d)
with real open swing-position tickers (`fetchOpenSwingPositions()`), and wired it into the cron's
background sweep in place of the static-only call. Scoped to OPEN positions (real capital, the
highest-stakes blast radius) rather than the full WATCH rail, matching the header comment's own
"bulk union of discovery output" framing without re-deriving the whole discovery pool here. A DB
failure degrades to the shared universe alone (never blocks the sweep) — covered by a unit test.
Left the `GET` handshake's own ticker-count field on the cheap static-only read (informational
only, and the handshake must stay fast per this route's own ops #1355 history) — only the
background sweep's actual warming target changed.

### Verification

`npx tsx --experimental-test-module-mocks --test src/features/vector/lib/vector-full-state-warm-universe.test.ts src/app/api/cron/vector-full-state-snapshot/route.test.ts` — 11/11 pass (4 new
unit tests + 1 new route-wiring regression test + 6 pre-existing). Full `src/features/vector/lib/*.test.ts` suite: 1310/1310 pass. `tsc --noEmit`: clean. `eslint` on touched files: clean.
