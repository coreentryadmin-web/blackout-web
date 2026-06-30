# BlackOut Platform Intelligence
**Last updated:** 2026-06-30 05:44 ET
**Today's findings:** 65 total | 4 P0 | 2 P1 | 59 WARN
**Reports analyzed (last 26h):** 28
**Platform trend:** INSUFFICIENT HISTORY
**History:** 75 findings on record across 3 days

---

## PLATFORM HEALTH SCORECARD
| Service | Issues today | Issues (7d) | Trend |
|---|---|---|---|
| spx-slayer | 0 | 0 | n/a |
| helix | 2 | 0 | n/a |
| heatmaps | 3 | 0 | n/a |
| largo | 0 | 0 | n/a |
| night-hawk | 0 | 4 | n/a |
| nights-watch | 0 | 0 | n/a |
| blackout-grid | 1 | 0 | n/a |
| membership | 1 | 0 | n/a |
| postgres | 2 | 0 | n/a |
| polygon | 0 | 0 | n/a |
| unusual-whales | 1 | 0 | n/a |
| anthropic | 0 | 0 | n/a |
| connectivity | 13 | 8 | n/a |
| cto | 3 | 40 | n/a |
| coaching | 0 | 0 | n/a |

---

## TOP RECURRING ROOT CAUSES
These same problems keep appearing. Fix the root cause, not the symptom.
- _No recurring issues matched -- either history is young or today's findings are all new._

---

## SYSTEMIC PATTERNS (Affecting Multiple Services)
- DATA FRESHNESS: stale/lag signals across 5 reports -- likely cron or cache layer

---

## TRADING IMPACT SUMMARY
| Impact Type | Count | Severity |
|---|---|---|
| Wrong prices shown to users | 1 | CRITICAL |
| Data integrity violations | 8 | CRITICAL |
| Stale data (users see old info) | 2 | HIGH |
| Disconnected service channels | 1 | HIGH |
| Missing signals in AI/tools | 1 | MEDIUM |
| Broken features | 2 | MEDIUM |

---

## INTELLIGENT RECOMMENDATIONS (Priority Order)
### 3. [SYSTEMIC] Fix systemic issue affecting multiple services
DATA FRESHNESS: stale/lag signals across 5 reports -- likely cron or cache layer

**Why:** Multi-service issues indicate a shared-layer/infra problem. One fix improves every consumer.

### 4. [DATA INTEGRITY] Fix data integrity issues -- wrong numbers cost users money
⚠️ **HEATMAP -> LARGO (non-SPX / non-0DTE):** `run-tool.ts get_gex` only routes through the shared desk for `isSpxTicker && expiry==today`. Other tickers/expiries call `fetchPolygonOdteGexRows` then UW directly, bypassing the `getGexPositioning` cache-reader the Heatmap tool uses. Low impact (Heatmap GEX is itself index-focused) but it's a divergent code path — converge by having non-SPX `get_gex` read `getGexPositioning` too.; ⚠️ **degraded** — 3 rows (AVAV, CNXC, ELTP) all `afterhours`, but `name: ""`, `eps_estimate: null`, `eps_actual: null`, `surprise_pct: null` on **every** row. Tickers are real but the panel shows no company name and no EPS data. Either the UW pre/after-hours endpoint isn't returning `eps_estimate`/`name` for these rows, or the field mapping in `shapeEarningsRows` is missing the live field names. **P1 — verify on a real reporting day during RTH.**; ⚠️ **Data-correctness anomaly (out of scope, follow-up task spawned):** id=3 is a **+7.30pt winning long** (exit 7439.43 > entry 7432.13) yet labeled `outcome=loss` → `stats.overall.win_rate=0` when true rate is ≥1/3. This corrupts `computeAdaptiveGates(stats)` calibration. Likely the win/loss classifier keys off "hit target" not pnl sign (id=3 exited on THESIS before target 7446.13).

**Why:** Wrong GEX walls / P&L / flow premiums => wrong trades. Highest-stakes category.

---

## DISCONNECTED SERVICE CHANNELS
- None flagged in the latest connectivity matrix.

---

## LEARNING VELOCITY
- Days of history: 3
- Issues ever recorded (pre-today): 75
- Recurring (root causes not yet fixed): 0
- New issues this cycle: 65

