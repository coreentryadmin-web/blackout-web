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
