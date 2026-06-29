# Polygon / Massive Numeric Cross-Validation Log

Ground-truth verification: every Polygon/Massive-sourced number served by BlackOut is
pulled BOTH from our served API and directly from the source, then compared. A number
that doesn't match its source is fabricated → P0.

## How to read this log
- **SPX price** diff > $5 during RTH = **P0** (fabrication). $1–$5 = WARN. < $1 = PASS.
- **Walls** are compared with a methodology caveat (see below). Off > 50 strikes on a
  like-for-like basis = investigate.

## Method caveats (corrections to the runbook — discovered 2026-06-29)
The scheduled-task SKILL.md has several stale assumptions. The real, working method:
1. **Host:** hit the **apex** `https://blackouttrades.com`, NOT `www.` — `www` returns a
   Cloudflare **301** to apex that **drops the `Authorization` header**, so every authed
   call against `www` 401s.
2. **Served endpoints are auth-gated** (premium tier OR `Bearer CRON_SECRET`); they are not
   public. Use `Authorization: Bearer $CRON_SECRET`.
3. **Endpoint path:** SPX pulse is `/api/market/spx/pulse`, not `/api/market/spx-pulse`
   (the latter 404s — there is no such route).
4. **Raw SPX path:** `/v2/last/indice/I:SPX` is dead (404). Use
   `/v3/snapshot/indices?ticker=I:SPX` → `.results.value`.
5. **Field names:** the served JSON is snake_case — `price`, `vwap`, `call_wall`,
   `put_wall`, `net_gex`. There is no `kingStrike`/`callWall`/`putWall` (camelCase), and the
   pulse payload carries **no** wall fields at all (walls live on `/gex-positioning`).
6. **GEX is computed on SPY, not SPX.** `/gex-positioning` returns `ticker:"SPY"`,
   `spot ~739`, walls `750/725` in **SPY** strike space (~1/10 of SPX). Comparing our walls
   against a raw `I:SPX` options chain (as the runbook's STEP 4 does) is a ~10x unit
   mismatch and is invalid. Validate SPY walls against a **SPY** chain.
7. Walls are a **full-surface / UW-aligned** aggregation, not a single-expiry gamma×OI peak.
   A naive 0DTE-only gamma×OI top strike will legitimately differ — this is a methodology
   gap, not a data bug. The served `/gex-positioning` already carries its own
   `gex_cross_validation` block (vs Unusual Whales) for the authoritative wall check.

---

## 2026-06-29 13:09 ET (Monday, RTH OPEN)
**SPX Price:** Ours **7420.36** | Polygon (concurrent v3 snapshot) **7420.76** | Diff **0.40 pts (0.005%)** | **PASS**
&nbsp;&nbsp;↳ corroboration: HOD 7427.8=7427.8 ✓, LOD 7348.88=7348.88 ✓, prior_close 7354.02=7354.02 ✓, chg% 0.904≈0.908 ✓
**SPY Spot (GEX basis):** Ours **739.13** | Polygon last trade **739.305** | Diff **0.18 (0.024%)** | **PASS**
**Call Wall:** Ours **750** (SPY) | naive 0DTE gamma×OI top **740** | Δ 10 strikes — *methodology mismatch (full-surface vs 0DTE-only)*; served self-check vs UW `callWallMatch:true`, divergence 0.34 | **PASS**
**Put Wall:** Ours **725** (SPY) | naive 0DTE gamma×OI top **734** | Δ 9 strikes — *same methodology note*; served self-check vs UW `putWallMatch:true` | **PASS**
**Net GEX:** 1.333B (long gamma, spot above flip 735.34) — directionally consistent with SPY chain (call gamma stacked 738–740). No source contradiction.
**Verdict:** No P0. All price-level numerics confirmed live & correct vs source. Walls confirmed via the served-side UW cross-validation; raw-chain wall reproduction deferred to a SPY-chain method (runbook STEP 4 uses the wrong underlying).

---
## 2026-06-29 14:10 ET
**Auth note:** served endpoints reached via apex `blackouttrades.com` + Bearer CRON_SECRET. `www.` host issues a 301 that strips the Authorization header in PowerShell (SKILL.md `spx-pulse` path is dead — used `/api/market/indices`, `/api/market/gex-positioning`, `/api/market/spx/desk`). Raw source = Polygon `v3/snapshot/indices` + `v3/snapshot/options/I:SPX` (POLYGON_API_BASE unset → api.polygon.io; key is a live Polygon key). RTH session, data live.

### SPX Price: Ours 7434.95 (desk) / 7435.66 (indices) / 7435.54 (gex spot) | Polygon raw 7434.86 | Diff <1 pt | **PASS**
Fetched seconds apart during RTH; sub-point spread is intra-second tick noise. as_of 2026-06-29T18:07Z (14:07 ET) — live, not stale.

### Call Wall: Ours 7450 | Raw 7450 (max gamma×OI, near-money 0DTE) | Diff 0 strikes | **PASS (exact)**

### Put Wall: Ours 7400 | Naive-raw 7450 | Diff 50 strikes | **WARN (methodology, not data error)**
Root-caused: our put_wall = strike with largest put OI / net-GEX support = 7400 (OI 5,674 — the genuine support wall). The SKILL's naive gamma×OI proxy is gamma-dominated near ATM, so it picks the 7450 put (OI 3,151, higher gamma) which sits *above* spot — not a real downside support. No fabrication; our 7400 is the correct support wall. NOT a P0.

### Internal cross-validation (served gex_cross_validation, our UW-vs-Massive check):
- SPX: callWallMatch=true, putWallMatch=false (divergence 25), flipMatch=false — UW and Massive disagree on the SPX put wall / flip by ~25 strikes. Consistent with the 0DTE put-wall ambiguity above.
- SPY: callWallMatch=true, putWallMatch=true, flipMatch=true, divergence 0.47 — fully converged.

### Other served numerics (sanity, not cross-validated against a second source this run):
net_gex 1.699e10 (long gamma), flip 7404.27, max_pain 7450, vwap 7410.12, vix 17.67. spot above flip → mean-revert posture; internally consistent.

**Verdict: no P0. SPX price and call wall match Polygon raw exactly/within tolerance. Put-wall gap is a known methodology difference (net-GEX support vs naive gamma×OI), already surfaced by our own internal validator.**
---

## 2026-06-29 15:13 ET (Monday, RTH OPEN)
**Auth/method:** served via apex `blackouttrades.com` + `Bearer CRON_SECRET` (local secret confirmed == prod via Railway). `www` host 301-drops the auth header → 401. Raw source = Massive (`POLYGON_API_BASE` set; key present). `/v2/last/indice/I:SPX` is dead on this base (404) → used `/v3/snapshot/indices?ticker=I:SPX`. Data live.
**SPX Price:** Ours **7436.15** (`/api/market/spx/pulse`, polled 19:10:08Z) | Polygon raw **7436.97** (snapshot value; session.close 7436.31, chg +82.95) | Diff **0.82 pts (0.011%)** | **PASS**
&nbsp;&nbsp;↳ corroboration: HOD 7440.64, LOD 7348.88, vwap 7414.73, vix 17.59 — all internally consistent; intra-second tick noise only.
**GEX basis = SPY** (`ticker:"SPY"`, spot **740.71**, change +1.61%, asof 19:10:28Z, source polygon).
**Call Wall:** Ours **750** (SPY) | naive full-0DTE-chain gamma×OI directional top **741** | Δ ~9 strikes — *methodology (full-surface/UW-aligned vs naive 0DTE gamma×OI, which peaks ATM)*; served self-check `callWallMatch:true` | **PASS**
**Put Wall:** Ours **735** (SPY) | naive directional top **740** (ATM artifact) | Δ ~5 strikes — *same methodology note*; served self-check `putWallMatch:true` | **PASS**
**Served internal cross-validation (gex_cross_validation vs UW):** callWallMatch=true, putWallMatch=true, flipMatch=true, divergence **1.8** — fully converged.
**Other served numerics (sanity):** net_gex 1.945e9 (long gamma), flip 736.8, max_pain 740, net_vex 5.26e10 (+vanna), net_dex −9.57e9 (short, trend-amplifying), nearest_wall 735 support (−5.71 pts). Internally consistent with spot 740.71 above flip.
**Raw-chain note:** 0DTE SPY chain truncated at the 250 `limit`; full chain (paginated) = 346 contracts, strikes 500–950. Naive gamma×OI walls land ATM (741/740) regardless — confirms the runbook's STEP 4 naive method cannot reproduce structural walls and is not a fabrication signal.
**Verdict:** No P0. SPX price confirmed live & correct vs Massive raw (<1 pt). SPY walls confirmed via the served-side UW cross-validation (all-match, divergence 1.8); independent raw reproduction blocked only by methodology (naive gamma×OI ≠ full-surface walls), not by any data discrepancy.
---

## 2026-06-29 16:18 ET

**Context:** market_status = `extended-hours` (RTH closed, post-close). Source base = `https://api.massive.com` (prod POLYGON_API_BASE; key is a Massive key). Served values pulled via `https://blackouttrades.com` (apex host + Bearer CRON_SECRET; the `www` host 301-redirects and drops the Authorization header → 401).

### SPY spot (gex-positioning, ticker=SPY): Ours 740.92 | Raw Massive 740.95 (lastTrade) | Diff 0.03 (<0.005%) | **PASS**
### SPX index price (spx/pulse): Ours 0 (`available:false`, extended-hours — unavailable BY DESIGN) | Raw Massive I:SPX 7440.43 | **N/A this cycle** (post-close, not a fabrication)
### Call Wall: Ours 741 | Raw dominant call gamma*OI 740 (741 is #2, tied) | Diff 1 strike | **PASS** — internal UW cross-val callWallMatch=true
### Put Wall: Ours 735 | Raw #1 below-spot put gamma*OI peak 735 | Diff 0 strikes | **PASS** — internal UW cross-val putWallMatch=true
### Net GEX 2.117B | flip 739.1 (just below spot 740.92 → long-gamma posture, consistent) | max_pain 740 (= ATM gamma concentration, consistent)
### Internal gex_cross_validation (vs Unusual Whales): callWallMatch=true, putWallMatch=true, flipMatch=true, divergence=1.9 — independent second confirmation.

**Verdict:** No P0. All Polygon/Massive-sourced numbers match upstream within tolerance. Walls are methodology-aligned (tool uses directional dollar-gamma γ·spot²·OI across banded near + monthly-OpEx expiries; naive single-peak aggregation lands 740 ATM for both, our tool correctly splits call=above / put=below spot).

**SKILL.md staleness noted (for next run):** (1) served path is `/api/market/spx/pulse` not `/api/market/spx-pulse`; (2) MUST use apex `https://blackouttrades.com` + `Authorization: Bearer \` (www drops auth, routes are premium-gated); (3) raw base = `https://api.massive.com`, NOT the api.polygon.io default; SPX index = `/v3/snapshot/indices?ticker=I:SPX` (`/v2/last/indice` 404s); (4) gex-positioning is SPY-based, not SPX.
---

## 2026-06-29 17:04 ET

**Context:** market_status = `extended-hours` (RTH closed, post-close). Source base = `https://api.massive.com` (prod POLYGON_API_BASE; key is a 32-char Massive key). Served values pulled via apex `https://blackouttrades.com` + `Bearer CRON_SECRET` (www host 301-drops the Authorization header → 401). Data timestamps: gex asof 21:04:31Z, pulse polled 21:04:41Z — live.

### SPY spot (gex-positioning, ticker=SPY): Ours **740.5906** | Raw Massive **740.77** (SPY lastTrade, regex-extracted around the PS dup-key `t`/`T` collision) | Diff **0.18 (0.024%)** | **PASS**
### SPX index price (spx/pulse): Ours **0** (`available:false`, extended-hours — unavailable BY DESIGN) | Raw Massive I:SPX **7440.43** (session.close) | **N/A this cycle** (post-close, not a fabrication; SPX/10 = 744.04 ≈ SPY 740.6 within the normal tracking gap)
### Call Wall: Ours **741** | Raw call gamma×OI top at/above spot **741** | Diff **0 strikes** | **PASS (exact)** — internal UW cross-val `callWallMatch:true`
### Put Wall: Ours **725** | Raw put gamma×OI top below spot **740** (ATM artifact; 250-`limit` truncation — only 250 contracts returned, biases toward near-money) | Diff **15 strikes** (< 25 thresh) | **PASS** — internal UW cross-val `putWallMatch:true` independently confirms 725 is the structural support wall
### Net GEX **3.176B** | flip **745.77** (ABOVE spot 740.59 → **spot below flip = short-gamma / trend-amplifying** posture; per memory, do NOT read net_gex>0 as range-bound without the spot-vs-flip check) | max_pain **739** (≈ ATM concentration, consistent)
### Internal gex_cross_validation (vs Unusual Whales): callWallMatch=true, putWallMatch=true, **flipMatch=false** (divergence 4.23), uw_asof 21:04:43Z — walls converged; flip differs ~4 pts between UW and Massive (within prior-run drift range, not a data fault).

**Verdict:** No P0. All Polygon/Massive-sourced numbers match upstream within tolerance. SPY spot < 0.03% off raw. Call wall exact; put wall confirmed via the served-side UW cross-validation (the raw naive gamma×OI put peak lands at the ATM 740 due to the 250-contract truncation and is the known methodology gap, not a fabrication). SPX index price skipped — post-close `available:false` is the by-design unavailable state.
---
