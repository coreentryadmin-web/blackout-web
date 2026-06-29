# Heatmaps — Deep End-to-End Audit
Last updated: 2026-06-29 19:10 ET (automated scheduled run)
Market status: **CLOSED** (7:10 PM ET Monday — RTH 9:30–16:00 ET)

## Overall Health: **PASS**

The GEX/VEX/DEX/CHARM engine is sound: dollar-gamma scaling is the SpotGamma per-1%-move
convention (#92 fix present and uniformly applied), King/wall/flip selection is correct and
independently cross-checked by a dedicated 6-layer verifier + the UW oracle, live values are
in-range with no NaN/null, and there are no hardcoded/faked values. Two non-blocking notes:
(1) the SKILL's own STEP-3 probe checks fields that don't exist on this route (stale skill);
(2) `net_charm` magnitude is enormous near 0DTE by construction — informational only.

---

## GEX Data Verification (live, apex + Bearer, market closed → values are last-settled)

### SPY — spot 740.81 (+1.62%), asof 2026-06-29T23:08:01Z
| Metric | Value | Reasonable? | Notes |
|---|---|---|---|
| Net GEX | +$3.25B | ✅ | Positive net, but posture SHORT (spot < flip) — correct decoupling |
| Gamma posture | short | ✅ | spot 740.81 < flip 745.76 → short. NOT derived from net_gex sign |
| Gamma Flip | 745.76 | ✅ | ~5 pts above spot |
| Call Wall | 741 | ✅ | argmax(+net γ); 0.19 pt from spot (nearest_wall resistance) |
| Put Wall | 725 | ✅ | argmax(−net γ); ~16 pts below spot (support) |
| Max Pain | 740 | ✅ | at spot |
| Net VEX | +$50.0B | ✅ | vanna positive |
| Net DEX | −$9.29B | ✅ | dealers net short delta → destabilizing |
| Net CHARM | −$1.15e12 | ⚠️ | per-year scale; huge near 0DTE (1/2t term) — see note |
| Data freshness | asof = now | ✅ | My GET forced a fresh rebuild (cron idle post-close) |

### SPX — spot 7440.43 (+1.18%), asof 2026-06-29T23:07:58Z
| Metric | Value | Reasonable? | Notes |
|---|---|---|---|
| Net GEX | +$30.3B | ✅ | Order of magnitude consistent with per-1%-move $-gamma at competitor scale |
| Gamma posture | long | ✅ | spot 7440.43 ≥ flip 7435.16 → long |
| Gamma Flip | 7435.16 | ✅ | ~5 pts below spot |
| Call Wall | 7440 | ✅ | at spot (nearest_wall resistance −0.43 pt) |
| Put Wall | 7350 | ✅ | ~90 pts below spot |
| Max Pain | 7450 | ✅ | ~10 pts above spot |
| Net VEX | +$386B | ✅ | vanna positive |
| Net DEX | −$5.83B | ✅ | short delta |
| Net CHARM | −$9.83e12 | ⚠️ | ~300× net_gex; per-year near-0DTE blow-up (informational) |
| Strikes | all > 0, in-band | ✅ | walls/flip/max-pain all within ±2% of spot |

No null / NaN in any served aggregate for either ticker. ✅

---

## Calculation Verification
| Calculation | Formula Used | Correct? | Notes |
|---|---|---|---|
| GEX (dollar gamma) | `sign · γ · OI · sharesPerContract · spot² · 0.01` | ✅ | `100 × 0.01 = 1` → per-1%-move $-gamma (SpotGamma/Barchart). call +/put −. Uses REAL `shares_per_contract` (≠100 for adjusted contracts), defaults 100 |
| VEX (vanna) | `sign · vanna · OI · spc · spot` | ✅ | Closed-form BS vanna `−φ(d1)·d2/σ`; per 1.00 σ; distinct ×100×spot notional (deliberately NOT on GEX's per-1% scale) |
| DEX (delta) | `−(δ · OI · spc · spot)` | ✅ | δ already type-signed → Σ(δ·OI) = customer net; dealer = negation (single sign, NOT double-signed). Positive = dealers long → stabilizing |
| CHARM | `sign · charm · OI · spc · spot` | ✅ math, ⚠️ scale | Closed-form `φ(d1)·d2/(2T)` (r=q=0), numerically verified to ~1e-7 vs finite-diff. Per-YEAR units → magnitude explodes as T→0 (0DTE); only sign/relative is meaningful (matches "only near expiry" caveat) |
| King node selection | `argmax over strikes of \|net_gex\|` | ✅ | ABSOLUTE gamma magnitude. UI "anchor" = same rule. Consistent profile / matrix / card |
| Gamma flip | per-strike neg→pos crossing nearest spot, interpolated; cumulative-sum fallback | ✅ | Robust on one-sided books |
| Zero-gamma posture | `spot ≥ flip ? long : short` | ✅ | Decoupled from net_gex sign (correct) |

Scaling is identical in both the matrix path (`accumulateContract`) and the desk path
(`aggregateGexRows`) — no drift between the two.

## Cross-Tool Consistency
- GEX walls match SPX Slayer: **yes** — `crossToolChecks` asserts SPX desk price/γ-flip == heatmap spot/flip (temporal-immune, via the pure `gexPositioningFromHeatmap` mapper).
- King node consistent across views: **yes** — overall anchor = `argmax|strikeTotals|`; per-day anchor = `argmax|cell|` per expiry column (task #88).
- Wall labels consistent (task #80): **resolved** — Call Wall→posWall (argmax +γ, tone bull), Put Wall→negWall (argmax −γ, tone support). No "PUT WALL/support" vs "GEX resistance" mislabel.

## Known Issues Status
- **Task #92 (60× scaling): RESOLVED.** `spot² · 0.01` per-1%-move normalization present in both code paths; live SPX net GEX (~$30B) reflects competitor scale, not the ~$500M understated value.
- **Task #80 (wall label mismatch): RESOLVED.** Labels/tones correct and derived from the same `posWall`/`negWall`.
- **Task #88 (per-day king node): RESOLVED.** Each expiry column marks its own `argmax|cell net GEX|` with a subtle white ring; overall anchor separate.

## Data Source Verification
- Options chain source: **Massive** (`POLYGON_API_BASE` default `https://api.massive.com`), Options Advanced plan, **real-time**. SPX/index options correctly resolve to `I:SPX` underlying (bare "SPX"/"SPXW" returns 0 results — the historical empty-walls trap, handled).
- Chain freshness: warmed every ~20–30s during RTH by `heatmap-warm` cron (RTH-gated 9:30–16:00 ET, weekdays, `?force=1` override); 11 presets (SPY, SPX, QQQ, IWM, NVDA, TSLA, AAPL, AMD, META, AMZN, GOOGL). Single-flight guard + in-mem/Redis cache + fast-move TTL bypass (>0.5% in 5 min).
- Strike band: ±~4% around spot, all expiries in one paginated pass (16-page guard, truncation warned) + bounded far-dated 3rd-Friday monthly/quarterly OpEx columns (≤8, ~6 mo out).

## Correctness Harness (already in place)
`src/lib/correctness/heatmap-verifier.ts` runs 6 layers per ticker, independently re-deriving
King/walls/flip/net from scratch (not a fork of the engine):
- INV-1 Σ(strike_totals)==total (tol 1e-6) catches ×100 / B-vs-M scale bugs (sign-preserving) — temporal-immune.
- INV-2b per-strike cell-resum sign == strike_total sign — catches flipped call/put sign, temporal-immune.
- Sanity: no NaN/Inf, walls within ±50% of spot, valid future expiries, absurd-magnitude ceiling.
- Shadow raw-chain recompute (SPX/SPY) — demoted to consistency-only (cross-time by construction during RTH).
- UW cross-provider oracle (SPX) — independently CONFIRMS King strike + net-GEX sign (scale-invariant).
- Cross-tool: getGexPositioning + SPX desk agree on spot/flip/walls.

This is a strong, honest design (confirmed-vs-consistency distinction; never hard-flags on timing skew).

## Findings / Recommendations
1. **[INFO] SKILL is stale — STEP-3 probe checks non-existent fields.** The task's PowerShell expects
   `kingStrike`, `kingGamma`, `profile[]`, `matrix[]` on `/api/market/gex-positioning`. The route's
   actual contract is `{ spot, change_pct, asof, flip, call_wall, put_wall, max_pain, net_gex,
   gamma_posture, net_vex, net_dex, net_charm, nearest_wall, distance_to_flip_pct, ... }`. King/profile/
   matrix live on the heavier `gex-heatmap` route + the UI component, not this light cache-reader.
   The probe also uses `www` without auth → 401 (apex + Bearer CRON_SECRET required; route is launch-gated
   behind `requireToolApi("heatmap")`). Recommend updating the SKILL probe to the real fields/host, or
   pointing it at `/api/market/gex-heatmap` if matrix/king fields are wanted. (No code bug — skill drift.)
2. **[INFO] CHARM magnitude near 0DTE.** `net_charm` (per-year, `φ(d1)·d2/(2T)`) is ~100–300× net_gex
   when a 0DTE expiry is in-band (T→0 ⇒ 1/2T blow-up). The math is correct and verified; only the
   sign/posture is consumed, and the regime read never quotes the raw number. If any surface ever renders
   raw charm $ next to GEX/VEX on a shared scale it would mislead — recommend keeping charm to
   posture/relative display only (current behavior). Not a data bug.
3. **[INFO] Doc wording drift on King Node.** `learn/heat-maps` + `learn/glossary` describe King Node as
   the "dominant **positive** GEX strike," but code (and the spx-slayer learn page) define it as the
   highest **absolute** |GEX| strike. The code is correct (argmax|net|); the two learn pages slightly
   misstate it. Cosmetic copy fix only.
4. **[OK] No hardcoded/faked GEX values** anywhere in the engine or components.
5. **[OK] Sign convention correct & consistent** — calls +, puts − for gamma/vanna/charm; delta
   single-signed (negation of customer net) to avoid the double-sign DEX pin. Posture uses spot-vs-flip,
   not net sign.
