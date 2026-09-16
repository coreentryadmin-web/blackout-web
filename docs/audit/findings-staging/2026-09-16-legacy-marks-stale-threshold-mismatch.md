## 2026-09-16 — [FINDING, FIXED] Legacy option marks used 0DTE's 5s staleness bar instead of Legacy's own 30s one, silently dropping live-sync updates

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P2 (live position management, no wrong money moved, but a correctness/precision defect that silently delayed real live-sync updates) |
| **Lane** | Night Hawk Legacy |
| **Files** | `src/features/nighthawk/lib/legacy-option-mark-row.ts`, `src/features/nighthawk/lib/legacy-option-mark-row.test.ts` |
| **PR** | (see PR link in commit trailer) |

### Root cause

`buildLegacyOptionMarkRow` (`legacy-option-mark-row.ts`) computes each mark row's `stale` flag via:

```ts
const stale = ... || isZeroDteMarkStale(asofMs, nowMs);
```

`isZeroDteMarkStale`'s third argument (the staleness threshold) is optional and defaults to
`ZERODTE_MARK_STALE_MS` (5 seconds) — a bar calibrated for 0DTE's intraday scalping horizon, where
a 5-second-old quote genuinely is stale. `legacy-option-mark-row.ts` is **exclusively** a Legacy
module (its own file header: "Shared Legacy option mark assembly ... Used by the legacy-marks API
route, server live-sync, and unit tests") — Legacy is an overnight/next-day digest product, not an
intraday one, and the client UI has already recognized this exact distinction:
`CommandDeck.tsx:741` and `PlayTerminal.tsx:204` both explicitly branch on `horizon === "LEGACY"`
to apply the far more generous `LEGACY_QUOTE_STALE_MS` (30 seconds) instead of
`ZERODTE_MARK_STALE_MS`. The server-side assembly never made that same distinction and fell
through to the 5s default.

### Why this wasn't just cosmetic

`legacy-option-marks-server.ts`'s `fetchLegacyOptionMarksServer` — used by "Legacy live-sync and
EOD grading" per its own header — **drops any row whose `stale` flag is true** unless the caller
passes `{ includeStale: true }`:

```ts
if (!opts?.includeStale && row.stale) continue;
```

`src/app/api/cron/legacy-live-sync/route.ts:64` calls it **without** that flag. This cron
(~every 5 min during RTH) drives `runLegacyLiveSync`, which mark-and-manages real, live Chief
Trade Alert Bot positions — peak/trough premium tracking, scale-out trim latches, target/stop
close detection. When a mark is absent from the map for a row, `runLegacyLiveSync` does:

```ts
const mark = marks.get(row.contract_occ);
if (mark == null || ...) { noQuote += 1; continue; }
```

— skipping that position's peak/trough update and every downstream trim/close check **for the
entire cron cycle**, not just its display. A thinly-traded Legacy contract (observed live and
repeatedly this segment on RIG, a ~$0.10 single-digit-underlying contract) can easily go 10–25
seconds between real quote ticks — perfectly fresh by a 30-second overnight-product standard, but
flagged stale and dropped under the mismatched 5-second bar, silently delaying live position
management by a cron cycle purely due to the wrong threshold, not any real data problem.

### Evidence

Live-observed this segment (multiple healthcheck cycles, 2026-09-16 RTH): RIG's raw
`GET /api/market/nighthawk/legacy-marks` mark repeatedly read `stale: true` with a real two-sided
quote only ~10–30s old, while CRWD/SWKS (more liquid names) read `stale: false` at similar ages —
the split tracked liquidity/tick-cadence, not any actual staleness by the product's own 30s
standard. `LEGACY_QUOTE_STALE_MS = 30_000` confirmed at `src/lib/zerodte/marks-math.ts:42`;
`ZERODTE_MARK_STALE_MS = 5_000` at the same file's line 39; `isZeroDteMarkStale`'s default
parameter confirmed at line 209.

### Fix

Pass `LEGACY_QUOTE_STALE_MS` explicitly as `isZeroDteMarkStale`'s third argument in
`buildLegacyOptionMarkRow`. No horizon branch is needed (unlike the client components) because
this module only ever serves Legacy — both of its real callers (`/api/market/nighthawk/legacy-marks`
route, `legacy-option-marks-server.ts`) are Legacy-specific.

### Regression test

Added `legacy-option-mark-row.test.ts`: a quote 15 seconds old (between the two thresholds) must
read `stale: false` under Legacy's 30s bar. RED→GREEN proven via `git stash` of the fix-only diff:
10/11 pass pre-fix (the new test fails), 11/11 pass post-fix.

### Blast radius

- `GET /api/market/nighthawk/legacy-marks` — the raw API payload's `stale` field is now correctly
  scoped to Legacy's product cadence (this lane's own healthcheck, `legacy-e2e-healthcheck.mjs`,
  reads this field directly for its B_marks stage).
- `legacy-option-marks-server.ts`'s `fetchLegacyOptionMarksServer` — no longer silently drops
  fresh-but->5s-old Legacy marks, so the legacy-live-sync cron sees a mark for these rows every
  cycle instead of intermittently skipping them.
- `legacy-discord-trade-notify.ts` already passed `{ includeStale: true }` for its one call site
  (a single-OCC lookup for an already-known position), so it was structurally unaffected by the
  drop behavior either way — not part of this fix's blast radius, noted for completeness.
- Client-side `CommandDeck.tsx`/`PlayTerminal.tsx` already recomputed their own `stale` locally
  from `markAsOf` using the correct 30s threshold, so the visible staleness badge in the terminal
  UI was never wrong — this fix corrects the SERVER's own `stale` field (consumed by the API
  payload and the live-sync cron), which is a distinct, real defect from the display layer.
