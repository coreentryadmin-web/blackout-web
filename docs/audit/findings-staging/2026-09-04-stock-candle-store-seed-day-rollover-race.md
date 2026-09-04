# 2026-09-04 — `stock-candle-store` REST session-open seed could stamp the new ET session with yesterday's `prev_close` — FIXED

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **Priority** | P2 data-correctness |
| **Surface** | `src/lib/ws/stock-candle-store.ts` — `seedSessionOpenIfNeeded()` |
| **Status** | FIXED |

## Root cause

`seedSessionOpenIfNeeded()` lazily fires a REST snapshot fetch to seed the authoritative
`session_open` anchor (`prev_close`) for a demanded ticker, then applies it in a `.then()`
callback. The callback's comment claimed the guard checks "this ticker is still on the session we
seeded for", but the code it described only checked:

```ts
if (!snap || s.openSource === "rest" || !(snap.prev_close > 0)) return;
```

`s.openSource === "rest"` only detects a **concurrent seed that has already landed for the same
session** — it says nothing about whether the *session itself* has since rolled over. Meanwhile
`recordStockTick`'s day-rollover branch (when `todayEtYmd()` no longer matches `s.sessionDate`)
resets `s.openSource` back to `""` (not `"rest"`):

```ts
if (sessionDate !== s.sessionDate) {
  s.current = null;
  s.sessionDate = sessionDate;
  s.sessionOpen = 0;
  s.openSource = "";
  s.lastSeedAttemptAt = 0;
}
```

So a REST fetch fired just before an ET session boundary (midnight, for a 24-hour-eligible
symbol) that resolves *after* the rollover sails straight past the only guard the callback had:
`openSource` is `""`, not `"rest"`, at resolution time, so the callback proceeds to overwrite
`s.sessionOpen` with a `prev_close` that was fetched **for the OLD session** — and per this same
file's own "rest is never downgraded back to ws-bar" invariant (the `TickerState.openSource`
field comment, and the comment directly above `if (s.openSource === "") { ... "ws-bar" }` in
`recordStockTick`), that wrong anchor then becomes **permanently authoritative** for the rest of
the new session's `change_pct` — every subsequent `computeChangePct(close, sessionOpen)` for that
ticker is computed against the wrong denominator until the *next* rollover.

## Evidence (RED → GREEN)

Added a regression test that fakes `Date` (`t.mock.timers.enable({ apis: ["Date"], ... })` —
`recordStockTick`'s rollover check reads the real ET wall clock via `todayEtYmd()`, with no
injection point in this store, so a genuine same-process day rollover can only be produced by
faking `Date` itself) to reproduce the exact race:

1. Tick a ticker on day 1 → ws-bar seeds `sessionOpen=50`.
2. Fire the REST seed for day 1's session, but keep its promise **pending**.
3. Advance the mocked clock 6h across ET midnight; tick the ticker again → the rollover branch
   resets state and re-seeds day 2's ws-bar anchor at `sessionOpen=70`.
4. Resolve the pending (day-1) fetch with a stale `prev_close: 999`.

- **Pre-fix (RED):** `git stash push -- src/lib/ws/stock-candle-store.ts` (fix reverted, test
  kept), ran `node --import tsx --experimental-test-module-mocks --test
  src/lib/ws/stock-candle-store.test.ts` → new test failed:
  `Expected values to be strictly equal: -92.99 !== 0` — `changePct` was computed as
  `computeChangePct(70, 999)` (the stale day-1 anchor won).
- **Post-fix (GREEN):** `git stash pop`, re-ran the same command → **20/20 pass**, `changePct`
  equals `computeChangePct(70, 70)` — day 2's own ws-bar anchor stayed authoritative and the stale
  `999` was discarded.

## Fix

Capture the session identity at the moment the seed is **fired** (a local closure variable,
`firedForSessionDate = s.sessionDate`), and additionally require it to still match `s.sessionDate`
at the moment the fetch **resolves**:

```ts
const firedForSessionDate = s.sessionDate;
s.seedInflight = snapshotFetcher(ticker)
  .then((snap) => {
    if (!snap || s.openSource === "rest" || s.sessionDate !== firedForSessionDate || !(snap.prev_close > 0)) return;
    s.sessionOpen = snap.prev_close;
    s.openSource = "rest";
  })
  ...
```

The original `s.openSource === "rest"` check is preserved unchanged — it is still needed for the
in-session case (a second concurrent seed landing after the first already succeeded). The new
`s.sessionDate !== firedForSessionDate` check adds the missing cross-session guard the comment
already claimed existed.

### Fix rationale — what was deliberately left unchanged

- Did **not** touch the `openSource === "rest"` never-downgraded invariant itself — that design
  (prefer a true 09:30-equivalent REST anchor over a live ws-bar fallback, permanently for the
  day) is intentional and correct; the bug was only that the *cross-session* case wasn't excluded
  from applying a REST result at all.
- Did **not** add a generic "is this seed still fresh" timeout — the existing
  `SEED_RETRY_COOLDOWN_MS` / `lastSeedAttemptAt` cooldown already bounds retry rate for failed
  seeds; this fix is scoped narrowly to the specific staleness dimension the comment already
  claimed to check (session identity), not to a broader freshness policy.
- Left `recordStockTick`'s rollover branch itself untouched — resetting `openSource` to `""`
  (not `"rest"`) on a new day is correct (the new session genuinely has no REST anchor yet); the
  gap was entirely in the seed callback's staleness check, not in the rollover logic.

## Blast radius

Single call site (`seedSessionOpenIfNeeded` has exactly one `.then()` callback and one caller,
`getStockLiveCandle`). No sibling copy of this pattern exists in `stock-candle-store.ts`.
`src/lib/ws/spx-candle-store.ts` and `index`/`polygon-socket.ts` carry an **analogous** (not
identical) FIX-A day-anchor pattern per this file's own header comment ("mirrors the indexStore
FIX-A pattern in polygon-socket.ts") — worth a follow-up read to confirm they don't share the same
gap, but that is out of scope for this single-issue PR; not touched here.

## Regression guard

`src/lib/ws/stock-candle-store.test.ts` — new test:
`seedSessionOpenIfNeeded: a REST seed that resolves AFTER a day rollover must not stamp the new
session with the stale prior-day anchor`. Full adjacent-suite run
(`src/lib/ws/*.test.ts`, 139 tests) and `npx tsc --noEmit` both clean post-fix.
