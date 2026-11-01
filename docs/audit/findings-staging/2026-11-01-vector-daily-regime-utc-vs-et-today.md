> **kind:** FINDING

## Vector `loadDailyRegime` computed "today" from UTC, not ET — misclassified today's own session as "settled" during the evening UTC-rollover window — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **Area** | `src/features/vector/lib/vector-daily-regime-server.ts` (Vector end-of-session dealer-regime series; also served to Largo via `get_vector_analytics`) |
| **Severity** | P2 — correctness (stale/incomplete data served for several hours a day), not crash-level |

### Root cause

`loadDailyRegime` computes the "today" anchor and the walk-back calendar days with raw UTC
arithmetic:

```ts
const today = new Date();
const todayYmd = today.toISOString().slice(0, 10);
...
const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i));
batch.push(d.toISOString().slice(0, 10));
```

`todayYmd` is then passed into `loadSessionWallTail(ymd, ticker, horizon, limit, todayYmd)`
(`vector-wall-persist.ts`), which decides whether a session is "settled" via:

```ts
const settled = todayYmd != null && sessionYmd < todayYmd;
```

A settled session is served from the historical DB-mirror tail read; an un-settled one takes the
full live Redis-backed read instead — and the code's own comment on the call site explains why
that split exists: *"Today's session still takes the full read (the mirror lags the live
recorder)."*

The bug: ET and UTC calendar dates disagree for roughly 19:00–23:59 ET every day (the exact window
depends on EDT/EST — e.g. 2026-07-15T22:00 ET = 2026-07-16T02:00Z). During that window, UTC has
already rolled over to the next calendar day while the ET trading session is still "today". A
UTC-derived `todayYmd` is then one calendar day AHEAD of the real ET trading day, so for the real
"today" session, `sessionYmd < todayYmd` evaluates **true** — today's own, still-fresh session is
wrongly classified as an already-settled historical day and routed to the lagging DB mirror
instead of the full live read the un-settled branch exists to give it. The end-of-session
dealer-regime row for the current session (gamma flip + primary call/put wall) can therefore read
stale/incomplete for up to ~5 hours each evening, in both the Vector chart overlay and Largo's
`get_vector_analytics` tool (which reads the same `loadDailyRegime`).

Every sibling file in this exact feature area (`vector-prior-day-server.ts`) and dozens of other
call sites across the codebase (`polygon.ts`, `largo/technicals.ts`, `largo/run-tool.ts`,
`zerodte/entry-context.ts`, `spx-desk.ts`, `features/nighthawk/lib/market-wide.ts`) already use the
ET-correct `todayEtYmd()`/`priorEtYmd()` helpers (`@/lib/providers/spx-session.ts`, backed by
`todayEt()` in `@/lib/et-date.ts`, which is itself timezone-aware and unit-tested) for exactly this
"N days back, in ET trading-calendar terms" computation — `vector-daily-regime-server.ts` was the
one place in the Vector feature area that reinvented it with raw UTC math instead of reusing the
already-correct, already-tested shared helper.

### Evidence

Reproduced the bug directly: faking the clock to `2026-07-16T02:00:00.000Z` (= 2026-07-15 22:00 ET,
EDT) and running the OLD inline computation gives `todayYmd = "2026-07-16"` while the real ET
trading day is `"2026-07-15"` — a one-day-ahead mismatch, exactly the condition that flips
`sessionYmd < todayYmd` to `true` for today's own session. Confirmed as a standalone RED check
(deleted scratch file, not part of the PR) before writing the fix, then confirmed GREEN against the
new `dailyRegimeWalkWindow` helper:

```
test("OLD logic misclassifies today as one day ahead during the ET evening UTC-rollover window")
  todayYmd === "2026-07-16"   // WRONG — real ET today is 2026-07-15
```

New regression test (`vector-daily-regime-window.test.ts`) asserts the fixed helper reports
`todayYmd === "2026-07-15"` at the same fake instant, and that `ymds[0] === todayYmd` (the
invariant `loadSessionWallTail`'s settled-check relies on).

### Blast radius

Single call site: `loadDailyRegime` is the only consumer of the buggy inline computation (it was
extracted into this one file specifically so there would be exactly one derivation — see the
file's own "WHY THIS FILE EXISTS" comment). Two consumers of `loadDailyRegime` itself are affected
identically: the Vector chart's daily-regime overlay (`GET /api/market/vector/daily-regime`, now a
thin wrapper) and Largo's `get_vector_analytics` tool. No other file in the codebase had this
particular UTC-vs-ET mistake for this computation — checked for the same `toISOString().slice` /
`Date.UTC(...).slice` pattern elsewhere in `src/features/vector/lib/` and found none.

### Fix rationale

Extracted the date-window computation into a new, plain (non-`server-only`) sibling module,
`vector-daily-regime-window.ts`, exporting `dailyRegimeWalkWindow(count)` — because
`vector-daily-regime-server.ts` carries `import "server-only"`, which throws under a plain
`tsx --test` import (same pattern already used by `vector-wall-db.test.ts` / the
`vector-dte-walls-server.test.ts` comment for this exact constraint), so the fixed logic needed a
testable home. The helper itself just calls the already-correct, already-tested
`todayEtYmd()`/`priorEtYmd(i)` from `@/lib/providers/spx-session.ts` rather than reimplementing ET
date math — no new date-handling logic, just routing this one file onto the same shared,
already-proven helper every sibling caller already uses. `vector-daily-regime-server.ts` now calls
`dailyRegimeWalkWindow(days + 10)` once and reads from its `ymds` array in the existing chunked
walk-back loop; the chunking/`days + 10` slack/sort/slice logic is otherwise untouched.

Deliberately left unchanged: `loadSessionWallTail`'s own settled/un-settled branch logic (it is
correct — the bug was only in what it was being fed), and the cache-first/chunking behavior
documented in `loadDailyRegime`'s own comments.

### Outcome

RED → GREEN proven (see Evidence). `npx tsx --experimental-test-module-mocks --test` across
`vector-daily-regime-window.test.ts`, `vector-daily-regime.test.ts`, `vector-wall-persist.test.ts`,
`spx-session.test.ts`, `et-date.test.ts`, and the full `src/features/vector/lib/*.test.ts` suite
(1347 tests) — all pass. `tsc --noEmit` clean.
