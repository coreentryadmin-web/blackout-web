## 2026-10-31 — [FINDING, P4 dead-code, providers/ws] Two unused getter wrappers in `uw-socket.ts` — `getNetFlow`/`getUwPriceForTicker` — FIXED

> **kind:** `FINDING`

| **Area** | **Severity** | **Status** |
|---|---|---|
| `src/lib/ws/uw-socket.ts` (UW WebSocket manager) | P4 — dead code, no runtime impact | FIXED |

**What's wrong.** Round 167 of the standing dead-export sweep re-ran the whole-repo dead-export
scanner methodology against a fresh `origin/main` and found two more unused exported getters in
`src/lib/ws/uw-socket.ts` — the exact same shape as `getFlowSourceHealth()`, removed from this
same file in #7027 one round earlier:

1. **`getNetFlow()`** (was line 882) — a one-line wrapper returning the module's `netFlowStore`
   object. Zero callers anywhere in the repo.
2. **`getUwPriceForTicker(ticker)`** (was line 904) — a one-line wrapper doing a case-normalized
   lookup into the module-private `priceByTicker` map. Zero callers anywhere in the repo.

```
$ grep -rn "getNetFlow\b\|getUwPriceForTicker\b" src --include="*.ts" --include="*.tsx"
src/lib/ws/uw-socket.ts:882:export function getNetFlow(): typeof netFlowStore {
src/lib/ws/uw-socket.ts:904:export function getUwPriceForTicker(ticker: string): UwPriceTick | null {
```
Zero hits outside each function's own definition, before the fix (checked against a fresh
`origin/main`, not stale local history). After the fix, zero hits at all (both functions removed).

**Root cause.** Both functions were speculative public accessors for internal state that the real
consumers ended up reading a different way:
- `netFlowStore` (the object `getNetFlow()` wrapped) is imported and read **directly** by
  `src/app/api/market/spx/pulse/stream/route.ts` (`netFlowStore.updatedAt`/`.call_premium`/
  `.put_premium`/`.net`) — the only real consumer bypasses the getter entirely.
- `priceByTicker` (the map `getUwPriceForTicker()` wrapped) is read directly, inline, from
  **within the same file** — the module's own health-snapshot builder reads
  `priceByTicker.get("SPX")?.updatedAt` / `priceByTicker.get("SPY")?.updatedAt` (lines
  1704-1705) to populate the admin pipeline's `price_spx_updated_at`/`price_spy_updated_at`
  tiles, added by the same commit (#145, "UW price WS, lit/dark ratio, FOMC parse fix") that
  introduced `getUwPriceForTicker()` itself. The getter was written alongside its own data source
  but never became the access path either the admin tile or anything else actually used.

Both read as the same "designed a public accessor, the real caller ended up reading the
underlying store directly" pattern #7027 already found and fixed for `getFlowSourceHealth()` in
this same file one round earlier — this round re-ran the sweep fresh rather than assuming #7027
closed out every candidate in the file.

**Evidence of non-ambiguity (vs. deliberate scaffolding).** Unlike `appendUtmParams`/
`getExperimentVariant` (flagged 2026-10-13, deliberately left for owner review as plausible
"designed-ahead" capability), neither function here names a specific planned future consumer in
its own doc comment, and both have a **live sibling that already does the real job** —
`netFlowStore` has a real direct importer, `priceByTicker` has a real direct in-module reader.
This is "the getter never found its caller because the data already has one," not "built ahead
of a feature that hasn't landed yet."

**Blast radius.** Single file, `src/lib/ws/uw-socket.ts`. Removed only the two dead functions;
`netFlowStore`, `priceByTicker`, `getNetPremTicksForTicker` (the live sibling getter for
per-ticker net-premium tick history, still has its own real callers), and every other export in
the file are untouched. `tsc --noEmit` and the file's own eslint pass clean after removal; the
WS-layer sibling test suites that exercise this module (`uw-socket-gate.test.ts`,
`uw-socket-stall.test.ts`, `uw-frame.test.ts`, `source-health.test.ts`,
`socket-cluster-health.test.ts` — 52 tests total) all still pass.

**Fix rationale.** Removal, not wiring either function into a new consumer — same rationale as
#7027: inventing a new caller (e.g. exposing `getNetFlow()` on some new route, or wiring
`getUwPriceForTicker()` into a UI surface) would be a product decision for whichever lane owns
that surface, not something to invent as a side effect of a dead-code sweep. Both functions have
carried zero callers since the commit that introduced them.

**Regression guard.** None added — deleting genuinely unreferenced code has nothing to
RED→GREEN; the zero-reference grep above (re-run against a fresh `origin/main` before and after)
is the proof. Existing sibling test suites for this module were re-run post-fix to confirm no
regression.
