# SPX Slayer — Deep End-to-End Audit
Last updated: 2026-06-29 17:45 ET (automated scheduled audit)
Market status at audit time: **CLOSED / after-hours (EXTENDED)** — RTH closed at 16:00 ET. Live RTH WS price-streaming could not be observed; verified code + live last-good cached responses.

## Overall Health: **PASS**

No P0 data-correctness defects found on the SPX Slayer desk. Every number traced is live, SPX-scale, correctly labeled, and internally consistent. Three findings are WARN-level (a cross-endpoint scale trap that does NOT touch the desk, a cosmetic zero-flow bar, and confluence completeness gaps). No hardcoded/faked values feed any displayed number.

---

## Data Point Verification

| Data Point | Source (api → field) | Live? | Correct? | Label Accurate? | Issues |
|---|---|---|---|---|---|
| SPX Price | Polygon `I:SPX` snapshot (`/v3/snapshot/indices`, field `value`) + WS leader; desk lane `merged.price` | ✅ | ✅ `7440.43` == `indices.spx.price` exactly | ✅ | none |
| Put Wall / supports | SPX flow lane (`I:SPX` options chain) → `gex_walls[]` positional ladder | ✅ | ✅ SPX-scale (7435/7430/7425…) | ✅ | support/resistance labeled **positionally** (above/below spot), not by gamma sign — by design |
| Call Wall / resistances | same → `gex_walls[]` | ✅ | ✅ SPX-scale (7445/7450/7460/7465) | ✅ | none |
| Gamma flip / king | flow lane → `gamma_flip` 7435.15, `gex_king` 7440 | ✅ | ✅ SPX-scale | ✅ | none |
| Max Pain | desk lane → `max_pain` 7450 | ✅ | ✅ SPX-scale | ✅ | null if desk unavailable (no fabrication) |
| Dollar-gamma scaling | `polygon-options-gex.ts:1883` `sign·γ·oi·sharesPerContract·spot²·0.01` | ✅ | ✅ all 5 factors present | ✅ | **task #92 confirmed FIXED** (spot²·0.01 re-added; multiplier data-driven, not hardcoded 100) |
| VWAP | Polygon `I:SPX` minute bars → `computeIndexVwapFromBars` | ✅ | ✅ intraday, resets at open, vol-weighted (not approximated) | ✅ | sticky Redis cache prevents micro-gaps (`vwap` 7417.46) |
| Intraday MAs | `spx-play-technicals.ts` m3/m5 closes + `fetchIndexEma(SPX,20,minute)` | ✅ | ✅ genuine intraday bars | ✅ | task #91 (MA timeframe mixing) — not reproduced; labels match bars |
| Daily MAs | desk `ema20/50/200`, `sma50/200` | ✅ | ✅ correctly ordered (ema20 7421 → ema200 6914, sma200 6929) | ✅ | none |
| IV / IV Rank | Polygon VIX ~1y daily closes → `(cur-min)/(max-min)·100` | ✅ | ✅ **true IV Rank** (TastyTrade), not percentile | ✅ | **task #93 confirmed FIXED**. Fn legacy-named `fetchVixIvRankPercentile` (naming only). Live `uw_iv_rank=24` |
| Dark Pool | UW dark-pool prints → `SpxDarkPoolCard` (mounted `SpxDashboard.tsx:104`) | ✅ | ✅ real prints | ✅ | **task #97 confirmed FIXED** — card imported & rendered, not orphaned. (After-hours: 0 prints, bias neutral — expected) |
| Confluence | `computeSpxConfluence()` (`spx-signals.ts`) — 22 signals scored, deterministic | ✅ | ✅ explainable (per-factor label/weight/detail) | ✅ | **WARN:** several available signals not scored (see #73 below) |
| Play Engine | `spx-evaluate` cron (5-min RTH) → `spx-play-engine.ts` → `spx_play_outcomes` | ✅ | ✅ opening plays (3 today) & recording outcomes | ✅ | open-veto bug FIXED; outcomes write path has cross-replica failure counter |
| Options chain | Massive (`api.massive.com` via `POLYGON_API_KEY/BASE`), underlying `SPX` | ✅ | ✅ 0DTE today-ET, spot±60pt band, OTM+delta+spread+OI filters | ✅ | `implied_volatility` read from chain but not yet used in scoring (no hardcoded IV) |

---

## Live Endpoint Results (apex host + Bearer, 17:39–17:43 ET)

**`GET /api/market/spx/pulse`** → 200. After-hours gated: `available:false, price:0, market_status:"extended-hours", market_label:"EXTENDED"`, all structure null, `internals_estimated` all false, `missing:[]`. Honest closed-session contract (price 0 is a gated default, never overlaid onto the desk — verified below).

**`GET /api/market/spx/desk` (via `/spx/merged`)** → 200, `merged.available:true`:
- `price: 7440.43` (== `I:SPX`), `market_label: EXTENDED`
- `max_pain: 7450`, `gamma_flip: 7435.15`, `gex_king: 7440`, `gex_net: 2.99e10`
- `vwap: 7417.46`, `hod: 7444.32`, `lod: 7348.88`, `pdh: 7392.95`, `pdl: 7294.18`
- `ema20: 7421.23`, `ema50: 7324.55`, `ema200: 6914.42`, `sma50: 7371.41`, `sma200: 6929.52`
- `uw_iv_rank: 24`, `dark_pool.bias: neutral` (0 prints after-hours)
- GEX wall ladder: 7465 / 7460 / 7455 / 7450 / 7445 (resistance) · 7440 / 7435 / 7430 / 7425 / 7350 (support) — all SPX-scale
- `polled_at: 21:42:50Z`, `feed_stalled:false`, `gex_stale:false` (fresh re-poll even after close)
- **Merge integrity verified:** standalone pulse returned `price:0`, yet merged desk preserved `7440.43` — the pulse→desk overlay correctly did NOT bleed the closed-session zero into the displayed price.

**`GET /api/market/gex-positioning`** → 200, **`ticker:"SPY"`** (route default), `spot:740.65`, `call_wall:741`, `put_wall:725`, `max_pain:740`, `flip:745.78`, `gamma_posture:"short"` (correctly derived from spot<flip, not net_gex sign), `gex_cross_validation` present (call/put wall match UW, flip divergence 4.22), `asof` fresh.

**`GET /api/market/gex-heatmap`** → 200, `underlying:"SPY"`, `spot:740.7`, `max_pain:740`. Converged with gex-positioning (W1 confirmed: `getGexPositioning` = cache-reader of `fetchGexHeatmap`).

**`GET /api/market/indices`** → 200: `spx I:SPX = 7440.43 (+1.18%)`, `vix I:VIX = 17.65 (-4.13%)`. SPX desk price ties out to the penny.

**`GET /api/market/spx/outcomes`** → 200: `total_closed:3` today, all 3 losses (win_rate 0), `cold_buy 1`, `watch_promote 2`. Learning loop is recording (small 0.18-day sample — performance, not a data bug).

---

## Hardcoded / Faked Values Found

**None affecting displayed numbers.** Full scan results:
- All `Math.random()` hits are legitimate: WS reconnect jitter (`polygon-socket.ts:179`, `options-socket.ts:297`), UW retry backoff, DB log sampling (`db.ts:2857`, 5%), decorative radar/ember backdrops (NightHawk embeds), and `*.test.ts`. **No data is synthesized.**
- `polygon-options-gex.ts` comments confirm the contract multiplier is now data-driven ("multiplier instead of a hardcoded 100", "byte-identical to the previous hardcoded ×100").
- Only literal price levels in the tree are test fixtures (`largo-verifier.ts:168` `5842.31/5900`, `gamma-desk.test.ts`).
- Stub/fallback literals (`signalDeskStub` `price:0`, `b.value ?? 0` sort guard, `calls+puts||1` bar denominator) only render when `available===false` or as divide-by-zero guards — none fabricate a live value.

---

## Known Issues (from task backlog) — current status

- **Task #97** (SpxDarkPoolCard never imported): **FIXED** — imported `SpxDashboard.tsx:13`, rendered `:104` inside an error boundary.
- **Task #102** (per-replica WS stale price on scale-out): **MITIGATED** — Redis SETNX leader election (`polygon-socket.ts`, key `polygon:indices:leader`, 25s TTL); non-leaders read `spx:pulse:snapshot` from Redis, so all replicas serve the same index within the 30s cache TTL.
- **Task #92** (dollar-gamma 60× understated): **FIXED** — formula `γ·oi·sharesPerContract·spot²·0.01`, all factors present.
- **Task #93** (IV Rank vs Percentile mislabel): **FIXED** — computes true IV Rank, labeled correctly.
- **Task #91** (MA timeframe mixing): **NOT REPRODUCED** — intraday MAs use intraday bars, daily MAs use daily; labels accurate.
- **Task #80** (wall labels match Heatmap vs SPX desk): **N/A on desk** — desk walls come from the SPX `I:SPX` flow lane (7440-scale); the SPY Heatmap surface is a separate tool. They are different underlyings *by design*, not a mismatch within the desk. See WARN-1.
- **Task #73** (confluence blind spots): **PARTIALLY OPEN** — 22 signals scored, but several available signals still unconsumed (see WARN-3).
- **SPX plays never opened** (open-veto): **FIXED** — `spx-play-engine.ts:811` veto is now conditional on `playOptionChainRequired()` which defaults `false`; plays open with a fallback index ticket. 3 plays opened/closed today.

---

## WARN-level findings

**WARN-1 — gex-positioning / gex-heatmap default to SPY (10× scale trap for future callers).**
`gex-positioning/route.ts:33` defaults `ticker=SPY`; live response is SPY-scale (spot 740, walls 741/725). The **SPX Slayer desk does not consume this endpoint** (it uses the SPX `I:SPX` flow lane), so there is **no desk bug today**. Risk is latent: any new consumer that pulls `getGexPositioning()`/`/api/market/gex-positioning` expecting SPX strikes would be off by 10×. Route comment already notes "no in-repo HTTP caller." *Recommendation:* keep, but document the SPY default loudly at the call site and add a guard/assert if an SPX-context caller is ever added.

**WARN-2 — 0DTE flow split-bar denominator masks zero-flow.**
`SpxDeskPanels.tsx:413` `calls / (calls + puts || 1)`. If both 0DTE premiums are null/0 (true data gap), the bar renders 0% call / 100% put instead of empty/“—”. Cosmetic mislead during gaps only; not a numeric error. *Recommendation:* render an explicit empty state when `calls+puts===0`.

**WARN-3 — Confluence completeness gaps (task #73).**
`computeSpxConfluence()` scores 22 signals (VWAP, GEX walls/flip/king, max pain, 0DTE flow, dark pool, tide, NOPE, IV rank, TICK/TRIN/ADD, leaders, tape skew, EMA20, net premium, VIX term, session window, HELIX sweeps, news, strike concentration). It **reads but does not score:** `greek_exposure`, `flow_by_expiry`, `market_breadth`, `mag7_greek_flow`, `macro_indicators`, `iv_term_structure`, `oi_changes`, `gap_pct`, `gex_net`, and EMA50/200 + SMA50/200 (only EMA20 scored). These are completeness gaps, not correctness bugs — the score is deterministic and fully explainable. *Recommendation:* fold in at least `gap_pct`, `gex_net`, and EMA50/200 (all already displayed on the desk) for signal/label parity.

---

## Data Flow Diagram

```
SPX Price:  Polygon I:SPX REST snapshot (field `value`)  ─┐
            + Polygon WS (single leader via Redis SETNX)  ─┴→ pulse lane (1s TTL) ─┐
                                                                                    ├→ mergePulseIntoDesk (guards price>0)
GEX Walls:  Massive/Polygon I:SPX 0DTE chain → polygon-options-gex                  │
            γ·oi·shares·spot²·0.01 → analyzeStrikeGexRows → gamma-desk walls ──────→ flow lane (2s TTL) ─┤
                                                                                    ├→ useMergedDesk → desk render (SPX-scale)
Full desk:  Polygon chains, max pain, breadth, leaders, news ─────────────────────→ desk lane (10s TTL) ─┘
VWAP/MAs:   I:SPX minute bars → sessionStats/EMA → sticky Redis (session-keyed, 2h) → pulse lane → Levels card
IV Rank:    VIX ~1y daily closes → true-rank → desk lane → "IV Rank" pill
Dark Pool:  UW prints → flow lane + SpxDarkPoolCard (30s self-poll) → left-rail card
Confluence: all desk signals → computeSpxConfluence (deterministic, 22 scored) → grade/score/factors
Play Engine: spx-evaluate cron (5-min RTH, advisory lock) → evaluateFlatPlay → openPlay + recordPlayEntry
             → spx_open_play / spx_play_outcomes (write-failure counter) → /spx/outcomes, Track Record panel

Separate surface (NOT on SPX desk): gex-positioning / gex-heatmap = SPY-based, feeds locked Heatmaps tool.
```

## Recommendations (ranked)

1. **(WARN-1, P2)** Document/guard the SPY default on `gex-positioning` so no future SPX-context caller reads SPY strikes as SPX. Latent 10× trap, zero impact today.
2. **(WARN-3, P2)** Extend confluence to score the already-displayed-but-unscored signals (`gap_pct`, `gex_net`, EMA50/200) for desk/score parity (task #73).
3. **(WARN-2, P3)** Replace the `||1` split-bar denominator with an explicit empty state on zero 0DTE flow.
4. **(P3)** Rename `fetchVixIvRankPercentile` → `fetchVixIvRank` to kill the misleading legacy name (label is already correct).
5. **(monitor)** Re-run this audit during RTH (2:30pm ET as scheduled) to verify live WS price streaming and non-zero dark-pool/flow values, which after-hours cannot exercise.
```
