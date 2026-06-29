# BlackOut Pre-Market Brief — 2026-06-29

**Generated:** 2026-06-29 ~16:30 ET · **Underlying:** SPY 740.83 (+1.62%) ≈ SPX ~7408 · **Platform Signal:** ⚠️ CAUTION

> ⏱️ **Timing note:** This run executed from a **post-close snapshot** (all market data stamped ~20:30 UTC / ~4:30pm ET 2026-06-29; session is closed per coaching cron). Treat this as **next-session setup for Tue 2026-06-30**, not a live 9:25am pre-market read. Re-confirm levels at the cash open.

---

## 🚦 PLATFORM CALL: CAUTION
**4 critical anomalies detected — verify direction before opening.** The composite regime is **NEUTRAL** (GEX mean-revert · vol compressed · trend up · flow mixed). Reduced size; no high-conviction directional lean from the platform into Tue.

---

## GEX REGIME (SPY-based)
**Net GEX:** +$3.27B (live `gex-positioning`) — *regime snapshot recorded +$28.4B at 16:10 ET; magnitude disputed across sources, sign positive either way.*
**IV percentile:** 24 (low / compressed vol)

| Level | SPY | SPX ≈ | Meaning |
|---|---|---|---|
| 🔴 Call Wall (resistance) | **741** | ~7410 | Spot sitting **0.17 pts** under it — near-term cap |
| 🟢 Put Wall (support) | **725** | ~7250 | Dealer-long support floor |
| 👑 Max Pain (magnet) | **740** | ~7400 | Pin target into expiry |
| ⚖️ Gamma Flip | **740.26 ↔ 745.76** | ~7403–7458 | **Disputed** (see below) |

### ⚠️ Gamma flip is contested — spot is pinned at the pivot
The two GEX sources disagree on the flip (`gex_cross_validation.flipMatch = false`, ~4.2pt divergence):
- **GEX cron / coaching** → flip **740.26**, spot 740.83 just **above** it → **long-gamma, range-bound** ("textbook 741 call-wall fade").
- **Live gex-positioning** → flip **745.76**, spot **below** it → **short-gamma**, momentum/vol-expansion.

**Reconciliation:** Spot is parked *inside* the flip band (740–746), which is exactly why the composite is NEUTRAL. Don't force a directional gamma thesis — trade the **741 cap / 725 floor** range until price decisively clears either, then respect the regime that resolves.

**Secondary greeks:** Net DEX negative (dealers short delta → buy rallies / sell dips, trend-amplifying once range breaks). Net charm strongly negative → hedging drag toward heavy strikes into the close/OPEX. Net vanna positive → hedging *adds* to moves if IV pops.

---

## ⚠️ OVERNIGHT / POST-CLOSE ANOMALIES — 70 flagged (4 CRITICAL, 66 HIGH)
**Critical large prints (could be directional OR hedges — tighten stops, confirm before sizing):**
- 🔴 **QQQ — $19.6M single PUT** @ 695 (bearish-lean)
- 🔴 **SPX — $10.1M single PUT** @ 7100 (bearish-lean)
- 🔴 **QQQ — $6.0M single PUT** @ 725 (bearish-lean)
- 🟢 **SPX — $6.2M single CALL** @ 7900 (bullish-lean)

**Skew (62 names flagged ~99:1):** Heavy single-name **call** skew — NVDA ($2.4M), SPY ($3.9M), CRWV ($2.0M), AMZN, AMD, LLY. **Put** skew standout: **SMH $2.0M puts** (semis hedging). Net read: index-level **put** demand (hedging) against single-name **call** chasing → mixed, defensive undertone.

---

## PRE-MARKET / LATE-SESSION FLOW (top premium)
| Ticker | Premium | Side | Contract |
|---|---|---|---|
| QQQ | $19.7M | 🔴 PUT | 695 · exp 2026-07-31 |
| SPX | $16.9M | 🔴 PUT | 7200 · exp 2026-08-21 |
| SPX | $12.2M | 🟢 CALL | 7495 · exp 2026-09-18 |
| SPX | $10.9M | 🔴 PUT | 7495 · exp 2026-09-18 |
| SPX | $10.1M | 🔴 PUT | 7100 · exp 2026-09-18 |
| SPX | $8.5M | 🔴 PUT | 7000 · exp 2026-09-18 |

**Read:** Large-print flow skews **bearish/protective** on the indices (puts dominate the biggest tickets; Sep 7495 sees two-way positioning). Consistent with the index put-skew anomalies above.

**Dark pool:** Notable block — **COST $126.3M** @ $946.68 (133.4k sh).

---

## MACRO BACKDROP (latest prints)
*No intraday high-impact event calendar was available from the data feed for Tue 2026-06-30; below are the most recent macro readings.*
- **CPI:** 335.12 (May) — +0.63% m/m, sticky
- **Unemployment:** 4.3% (May) — flat
- **Fed Funds:** 3.63% (May) — easing trend (was 4.33% mid-2025)
- **10Y Treasury:** 4.48% (May) — +3.7%, backing up
- **GDP:** $23.85T (2025) · **Retail Sales:** $684.3B (May, +4.79%) · **Payrolls:** +159.5k (May)

---

## NIGHT HAWK CARRIES
- ⚪ **Unavailable** — `nighthawk/latest-edition` returned 404 (no published edition reachable). Per coaching cron, SPY settled near the 741 call wall in a long-gamma regime — **carry overnight gamma/event risk into Tue**.

---

## PLATFORM ACCURACY & REGIME INTEL
- ⚪ **Signal accuracy (SPX Slayer / Night Hawk): no data** — `signalAccuracy` empty.
- ⚪ **Regime-conditional accuracy: no data** — `regimeAccuracy` empty; best/worst regime null.
- *Cause: the signal-outcomes learning loop is dormant (recorder inert). Accuracy-weighted bias is unavailable this session — lean on live structure, not historical win-rate.*

---

## WHAT TO WATCH (Tue 2026-06-30)
- **SPY 741 / SPX ~7410** — call wall + spot pinned here. **Fade rejection** toward 740 max-pain in the range case; **breakout long** only on a decisive clear that flips gamma long-side.
- **SPY 725 / SPX ~7250** — put-wall support. Range buy near here; **breakdown short** below it (short-gamma resolution → moves accelerate, DEX/charm amplify).
- **740–746 flip band** — the pivot. Direction is undefined inside it; the side it breaks defines Tue's regime.
- **Index put demand** — biggest tickets are protective puts (QQQ 695, SPX 7100/7200). Respect downside hedging; don't be naked-long into a NEUTRAL/contested-gamma tape.

## BIAS: RANGE / NEUTRAL — REDUCED SIZE
⚠️ **CAUTION** — 4 critical anomalies + contested gamma flip + dormant accuracy loop. Trade the 741↔725 range, take quick profits at the walls, and wait for a decisive flip-band break before committing directional risk. Verify direction before opening.

---
*Sources: platform intel hub, gex-positioning, market flows, dark-pool, economy. Some feeds (spx-pulse, /api/flows, nighthawk) returned 404 and were substituted or marked unavailable. Data stamped ~16:30 ET 2026-06-29 (post-close).*
