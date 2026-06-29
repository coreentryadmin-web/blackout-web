# Night's Watch — Deep End-to-End Audit
Last updated: 2026-06-29 (automated)

## Overall Health: **PASS** (with 2 minor P2 polish items)

Night's Watch is the per-user options position manager embedded in `/nighthawk`
(`NightsWatchPanel`). End-to-end the P&L math, valuation sourcing, verdict logic, and
open/closed lifecycle are **correct, live-sourced, and honest** — no fabricated marks, no
hardcoded P&L. Both previously-flagged tasks (#94 realized P&L, #96 SSE marks) are
**implemented**. The only findings are two cosmetic data-integrity smells (a `?? 5500` SPX
spot fallback in a *display-only* delta-dollars calc, and a `×100` basis assumption in the
*client* return-% strip) — neither touches the dollar P&L users read.

Architecture is textbook for this codebase: every upstream read is a **cache reader**
(`getNwChain`, `getNwTickerGex`, desk loader) keyed by (underlying, expiry/date) — never
per-user, never per-position. Valuation functions are **pure** (no network) and the verdict
engine is **pure + deterministic + transparent** (every action traces to named signals).

---

## P&L Calculation Verification

Core math lives in `enrichPosition()` — [valuation.ts:343](src/lib/nights-watch/valuation.ts).

| Calculation | Formula | Source | Correct? | Issues |
|---|---|---|---|---|
| Unrealized P&L | `(mark − entry_premium) × contracts × sharesPerContract × sideSign` | live valuation | ✅ | side-aware (long +1 / short −1); multiplier from real `shares_per_contract`, defaults 100 |
| Realized P&L (#94) | `(exit_premium − entry_premium) × contracts × sharesPerContract × sideSign` | stored `exit_premium` | ✅ | only on `status='closed'` + recorded exit; null otherwise |
| Option mark | WS mid → snapshot mid(bid,ask) → last → prior close | Massive | ✅ | returns `null` (never fabricated) when no tier has a price |
| Entry price storage | `entry_premium NUMERIC NOT NULL` at create | Postgres `user_positions` | ✅ | validated `>= 0` on POST/PATCH |
| Current value | `mark × multiplier × sideSign` | live valuation | ✅ | side-aware (short = cost-to-close liability, negative) |
| pnl_pct | `unrealized_pnl / (entry × multiplier) × 100` | derived | ✅ | guards cost > 0; short base = premium received (intended) |

**Direction handling:** `sideSign = side === "long" ? 1 : -1` applied consistently to
current value, unrealized P&L, and realized P&L. Short premium-seller accounting is correct
(profit when mark → 0, base = premium received).

**Contracts / multiplier:** `multiplier = contracts × sharesPerContract`. `sharesPerContract`
is the real Massive `details.shares_per_contract` ([options-snapshot.ts:177](src/lib/providers/options-snapshot.ts)),
so corporate-action-adjusted (non-100) contracts price correctly; `spcOf()` rejects
0/negative/NaN → defaults to 100 (standard listed + the closed-position settle path where
valuation is null by design).

**Realized P&L (#94): RESOLVED.** `enrichPosition` computes `realized_pnl` + `realized_pnl_pct`
for closed legs; `closeUserPosition` ([db.ts:1813](src/lib/db.ts)) persists `exit_premium`,
`status='closed'`, `closed_at`. Closed cards render the settled figure (emerald/bear by sign)
in the dedicated "Closed · Settled" group ([NightsWatchPanel.tsx:620](src/components/nights-watch/NightsWatchPanel.tsx)).

---

## Valuation Source

- **Mark source:** Massive (via the Polygon-compatible options layer). Two paths that are
  byte-identical by construction (shared `resolveMark` ladder): per-OCC unified snapshot
  (preferred) and the full chain (fallback). Live WS quote folded in on top of both.
- **Mark type / priority:** ① fresh WS bid/ask mid → ② snapshot mid(bid,ask) [ask>0, bid≥0]
  → ③ last trade (>0) → ④ prior session close (>0, flagged `mark_is_day_close`). No usable
  price → `null` + `mark_source:"none"` → status `unavailable` (**never fabricated**).
- **Cache TTL:** chain = `TTL.OPTIONS_CHAIN` (cache-reader, shared per ticker|expiry|ET-date);
  per-user enriched pass = **3s** single-flight (`localOnly`, SWR **off** so stale P&L is never
  served); GEX context = 180s; flows = 30s; technicals = 60s; dark-pool = 120s; earnings = 300s.
- **Warm cron:** `nights-watch-warm`, ~every 60s market-hours/weekdays, `stale_after_min:10`
  ([cron-registry.ts:80](src/lib/cron-registry.ts)). Warms distinct chains + non-SPX per-ticker
  GEX + held-contract unified snapshots (batched ≤250 through the rate-limited funnel). Partial
  failures log per-OCC diagnostics (unfound/no-quote/missing) and never page ops; only a
  whole-batch failure flips `ok:false`.
- **Identity guard:** a snapshot is trusted only when `optionType`+`strike`(±0.005)+`expiry`
  match the position; mismatch → clean fall-through to the chain re-match
  ([enrichment.ts:202](src/lib/nights-watch/enrichment.ts)).

---

## Verdict Logic

Pure/deterministic engine in [verdict.ts](src/lib/nights-watch/verdict.ts). No live valuation
→ `watch` (honest abstention). Precedence: any sell → sell; else trim → trim; else hold; else
watch. Confidence scales with agreeing-signal count. **Honesty rule throughout: a signal fires
only when its data is actually present** — never faked.

| Signal | Used? | Source | Notes |
|---|---|---|---|
| GEX wall approach / break | ✅ | SPX desk **or** per-ticker GEX heatmap (`gexWalls`) | side-aware; break requires decisive 15-pt penetration (no hair-trigger) |
| Flow confirmation | ✅ | HELIX/Postgres recent flows | gated: ≥ $250k premium **and** ≥ 1.5× skew; aligned → hold, opposed → trim |
| Price action (trend) | ✅ | Polygon MTF technicals | up/down only; sideways/null never fire |
| Key-level proximity | ✅ | desk/technical levels | threatening side only, within 0.5% |
| IV change | ✅ | dossier `ivRank` / `entryIv` | elevated-long, depressed-short, crush-in-progress (needs entry baseline) |
| Theta decay | ✅ | live greeks | long → trim (erosion), short → hold (income tailwind) |
| Expiry zone | ✅ | DTE + moneyness | long = worthless risk (sell), short = assignment risk (sell) / capture (hold) |
| Deep loss | ✅ | pnl_pct | side-aware floor (−60% long / −150% short) |
| Earnings before expiry | ✅ | UW/Benzinga earnings | short → sell (gap), long → trim (IV crush) |
| Analyst downgrade / insider sell / dark-pool / short-squeeze | ✅ | dossier (detail path) | each side-aware, fires only when populated |

**No blind spots of the Largo kind.** Walls read off a shared `gexWalls` field (generalizes
to any underlying with a real dealer-gamma profile); the non-SPX heatmap wall `kind` is
**geometric** (spot-side), fixing the prior bug where a sub-spot call_wall was mislabeled
"resistance". List path leaves dossier fields undefined (those signals simply don't fire);
the detail path populates them — by design, not a gap.

---

## Known Issues Status

- **Task #94 (realized P&L): RESOLVED.** Computed in `enrichPosition`, persisted by
  `closeUserPosition`, displayed in the settled group with `realized_pnl_pct`.
- **Task #96 (real-time marks SSE): IMPLEMENTED.** `GET /api/account/positions/stream` pushes
  enriched positions every 3s; client `usePositionStream` consumes it with the polling loop as
  graceful fallback ("Live · SSE" vs "Live · updating" indicator).

---

## Data Integrity

- **Hardcoded / fabricated P&L:** **None.** Marks are real or `null`. The `?? 100` defaults in
  valuation.ts are the legitimate `sharesPerContract` fallback (standard contracts + null-valuation
  settle path), not a faked price.
- **Null marks in active positions:** handled — status `unavailable` with a machine reason
  (`contract-not-found` = likely unlisted; `no-quote` = illiquid; `market-closed`; `pending`).
  UI shows "—" + tag, never a $0 placeholder.
- **Stale valuations:** flagged — `mark_is_day_close` renders "prior close · not live" (amber);
  `mark_age_ms` carried for WS marks; 3s enriched cache with SWR off prevents stale P&L.
- **Per-user isolation:** `user_id` always from Clerk `auth()`, every query scoped by
  `(user_id, id)`; settled rows immutable (`AND status='open'` SQL guard → 409 vs 404).

### P2 polish (display-only — do NOT affect dollar P&L)
1. **`?? 5500` SPX spot fallback** in the *delta-dollars* aggregate (both
   [positions/route.ts:96](src/app/api/account/positions/route.ts) and
   [NightsWatchPanel.tsx:1000](src/components/nights-watch/NightsWatchPanel.tsx)). When a live
   leg has a null `underlyingPrice`, the "$/pt" delta-dollar display assumes SPX≈5500. This is a
   fabricated constant in a display metric — prefer skipping the leg's delta-dollars (or "—")
   rather than assuming a level. Net Delta/Gamma/Theta/Vega and all P&L are unaffected.
2. **Client return-% basis hardcodes `×100`** in `summarize()`
   ([NightsWatchPanel.tsx:890](src/components/nights-watch/NightsWatchPanel.tsx)) instead of
   `sharesPerContract`. Only the portfolio *return %* denominator for non-100 adjusted contracts
   would be slightly off; the dollar `pnlSum` comes straight from the correct server figure.
3. Server `portfolioGreeks` (route.ts) is computed and returned but the client recomputes its
   own via `computePortfolioGreeks` and ignores the server value — harmless redundancy; consider
   consuming one to avoid drift.

---

## Recommendations

- **P2:** Replace the `?? 5500` delta-dollars fallback with a skip/"—" when `underlyingPrice`
  is null (truth mandate — no assumed index level, even in a display metric).
- **P2:** Thread `sharesPerContract` into the client `summarize()` basis, or drop the client
  recompute and consume the server's already-correct figures (eliminates the ×100 assumption and
  the greeks redundancy).
- **No P0/P1.** P&L, marks, verdicts, and lifecycle are correct and live-grounded. Users can
  trust the numbers.

> Live-data spot-check (positions endpoint, warm-cron freshness vs real held contracts) is
> gated by Clerk auth + the `nighthawk` launch lock, so it can't be exercised unauthenticated
> from this audit. Recommend a market-hours authed pass once the tool unlocks to confirm marks
> match a broker for a sample contract.
