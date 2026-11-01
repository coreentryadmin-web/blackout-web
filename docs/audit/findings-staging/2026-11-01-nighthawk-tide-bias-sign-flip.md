> **kind:** FINDING

## Night Hawk Legacy: `tideBias()`/`tideSummary()` mislabel a one-sidedly directional net-options-premium tide as NEUTRAL/"flat, no premium" whenever the signed sum crosses zero — FIXED

| **Status** | Fixed |
|---|---|

**Found by:** correctness audit of `src/features/nighthawk/lib/format.ts` (2026-11-01), following
up the earlier 2026-08-23 `HelixTideBar` signed-net-premium fix (which explicitly left
`tide_bias`/`format.ts` untouched, per `FINDINGS.md`).

**Root cause:** `tideBias()` and `tideSummary()` (`src/features/nighthawk/lib/format.ts`) computed
`total = call_premium + put_premium` and treated `total <= 0` as "no real premium at all"
(`tideSummary` literally returns `"Market tide flat / no premium"` on that branch), then derived
BULLISH/BEARISH from `callPct = call / total * 100` otherwise (BULLISH `>55`, BEARISH `<45`, else
NEUTRAL). **That arithmetic is only correct if `call_premium`/`put_premium` are non-negative gross
premiums**, where a sum `<= 0` can only mean both sides are ~0. The real field is NOT that: UW's
market-tide row (`fetchUwMarketTide`, `src/lib/providers/unusual-whales.ts:649-655` —
`Number(r.net_call_premium ?? r.call_premium ?? 0)`) is a genuinely SIGNED NET premium, where a
negative value means that side was net SOLD. Net call-selling is routine, not an edge case.

Because the function derived its verdict only from which side of zero the raw signed sum happened
to land on, a MORE extreme version of an already-correctly-classified bearish (or bullish) tape
could flip the verdict backward to NEUTRAL — i.e. the mislabel got WORSE, not better, as the real
market got more one-sided. Two signals pointing the same direction (net call-selling AND net
put-buying, or the bullish mirror) could sum to a negative/zero total purely by magnitude, even
though both signals agree.

**Evidence:**
- Live, already-shipped-correctly case (2026-10-21 Legacy edition, `recap_summary`):
  `call_premium=-$10.1M`, `put_premium=$32.0M` → signed sum `+$21.9M` (stays positive) →
  correctly read `"BEARISH — calls -46% (-$10.1M) vs puts $32.0M"`.
- Reproduced directly against the live shipped function (pre-fix, via `node --import tsx`):
  `tideBias({call_premium: -50_000_000, put_premium: 10_000_000})` → `'NEUTRAL'`, and
  `tideSummary()` on the same input → `"Market tide flat / no premium"` — despite $60M of real,
  one-sidedly bearish flow (heavier net call-selling, same sign pattern as the live 2026-10-21
  case, just larger in magnitude, enough to push the signed sum negative).
- The mirror bullish case has the identical defect: `call_premium=110_000_000` (calls bought,
  bullish) + `put_premium=-120_000_000` (puts sold, also bullish) sums to `-10_000_000` → pre-fix
  `tideBias` returned `'NEUTRAL'` despite both signals pointing bullish.
- `unusual-whales.test.ts:282` already treats negative `call_premium` as a normal, expected input
  shape elsewhere in this codebase, confirming this is a reachable real-world input, not a
  theoretical one.

**Fix rationale:** reused the bullish/bearish decomposition already shipped and reviewed for the
*identical* root cause in `HelixTideBar` (`src/features/helix/lib/helix-tide-split.ts`'s
`tideSplit()`, 2026-08-23) rather than inventing new math for the same bug class:
`bullish = max(call, 0) + max(-put, 0)` (net call-buying + net put-selling),
`bearish = max(-call, 0) + max(put, 0)` (net call-selling + net put-buying). Both are non-negative
by construction, so a one-sided tape can never cancel itself back to "no signal" via a signed sum.
`bullishPct = bullish / (bullish + bearish) * 100`, `null` only when BOTH sides are genuinely zero
(the real "no premium at all" case) — `tideBias`/`tideSummary` now branch on that `null` instead
of on `total <= 0`. For non-negative (gross) inputs this is byte-identical to the old
`call / (call + put)` ratio (`bullish === call`, `bearish === put` when both `>= 0`), so every
existing non-negative caller/test is unaffected — confirmed by the pre-existing
`{call_premium: 6_000_000, put_premium: 4_000_000}` → `"BULLISH — calls 60% ($6.0M) vs puts $4.0M"`
test still passing unchanged.

**Blast radius:**
- `tideBias()` is exported and consumed directly by `src/features/nighthawk/lib/scorer.ts`
  (`regimeContextFromMarket` → `computeRegimeMultiplier`, which applies a 0.6x–0.85x score penalty
  specifically when `tide_bias === 'BEARISH'` under elevated VIX) and by
  `src/features/nighthawk/lib/direction-failure-diagnosis.ts`
  (`regimeConflictsWithDirection`/`detectBookPosture`, one of three signals requiring ≥2-of-3 to
  re-rank the nightly book toward SHORT). Both are fixed transitively — no separate change needed,
  since they only ever read `tideBias()`'s return value.
- `tideSummary()` (not exported) feeds `buildMarketRecap()`'s `tide` field — which is both
  `market_recap.tide` and the leading clause of `recap_summary` on every Legacy edition — and
  `formatEtfTides()`'s per-ETF tide line (`SPY/QQQ/IWM/XLF/XLE`). Both corrected by the same fix.
- **Checked and ruled out as a duplicate instance:** `src/features/nighthawk/lib/index-dossier.ts`'s
  `flowBias(call, put)` has the IDENTICAL code shape (`total = call+put`, `total<=0` → `"MIXED"`,
  `callPct` thresholds) but is fed by `ctx.index_flows[ticker]`
  (`market-wide.ts`'s `fetchIndexFlowsPooled`), which sums raw per-alert `premium` values
  (`alerts.filter(...).reduce((s,a) => s+a.premium, 0)`) — genuinely non-negative gross sums, never
  signed net premiums. Left unchanged: it is correct for its actual input domain, not a second copy
  of this bug.

**Evidence (RED → GREEN):** added regression tests to `src/features/nighthawk/lib/format.test.ts`
reproducing the exact live bug shape (one-sided bearish case matching the 2026-10-21 pattern at
larger magnitude, the bullish mirror case, and a `tideSummary`-via-`buildMarketRecap` check that
the rendered text is no longer `"Market tide flat / no premium"`), plus a guard that the known-good
live 2026-10-21 case and the genuinely-flat `{0,0}` case are unaffected.
- **RED** (format.ts reverted to its pre-fix state via a saved patch, test file kept): 3/13 failing
  — `tideBias({call:-50_000_000, put:10_000_000})` returned `'NEUTRAL'` instead of `'BEARISH'`,
  the bullish-mirror case returned `'NEUTRAL'` instead of `'BULLISH'`, and the `tideSummary` text
  was `"Market tide flat / no premium"` instead of starting with `"BEARISH"`.
- **GREEN** (fix reapplied): `npx tsx --experimental-test-module-mocks --test
  src/features/nighthawk/lib/format.test.ts` → 13/13 pass.
- Blast-radius test files run together (360 tests, all passing): `format.test.ts`,
  `helix-tide-split.test.ts`, `bearish-posture.test.ts`, `bearish-posture-shadow.test.ts`,
  `posture-backtest.test.ts`, `direction-failure-diagnosis.test.ts`, `scorer-direction.test.ts`,
  `debrief.test.ts`, `publish-context.test.ts`, `score-signal-analysis.test.ts`,
  `spx-live-voice.test.ts`, `spx-live-voice.guard.test.ts`, `nighthawk-edition-read.test.ts`,
  `spx-desk-brief.test.ts`, `meridian-cross-product-for-earnings-core.test.ts`.
- `npx tsc --noEmit`: clean.
