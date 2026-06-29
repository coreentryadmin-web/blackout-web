# Phase 10 — Performance Deep-Dive (live prod measured, 2026-06-29)

Method: real `curl` server timing against prod (TTFB = `time_starttransfer`), `EXPLAIN (ANALYZE,
BUFFERS)` on prod Postgres (read-only via `DATABASE_PUBLIC_URL`), build output for bundle sizes,
code path tracing for root cause. ~5 web replicas. Cold = first request after cache expiry; warm =
subsequent.

## Measured latencies (prod, 2 samples each)
| Endpoint | Cold TTFB | Warm TTFB | Payload | Note |
|---|---|---|---|---|
| `/` (landing) | **30–37 ms** | 30 ms | 119 KB | edge-cached, fast ✅ |
| `/api/health` | 70 ms | 65 ms | 64 B | fine |
| `/api/market/spx/desk` | **943 ms** | 64 ms | 97 KB | cold desk build |
| `/api/market/gex-positioning?ticker=SPX` | **1.80 s** | 282 ms | 1.4 KB | cold GEX matrix (chain fetch) |
| **`/api/market/flows`** | **🔴 17.8 s** | 93 ms | 184 KB | **GEX-enrichment cold-build storm** |
| `/api/track-record` | 70 ms | 75 ms | 353 B | fast |
| `/api/market/spx/pulse` | 73 ms | 86 ms | 648 B | fast |

## Findings (root-caused, ranked by user pain)

### P-1 — [P1, biggest pain] HELIX `/api/market/flows` cold = **17.8 s**
- **Root cause (not the DB):** `src/app/api/market/flows/route.ts:93-102`. On a cold `serverCache`
  miss the route runs GEX-proximity enrichment: `const uniqueTickers = […].slice(0,30)` then
  `await Promise.all(uniqueTickers.map(t => getGexPositioning(t)))`. When the per-ticker GEX matrix
  cache is cold, **each `getGexPositioning(t)` builds a fresh options chain** through the
  rate-limited Polygon funnel (~1.8 s each, measured). 30 cold builds drained by the ~40-RPS limiter
  ≈ **~17 s**, and it **blocks the entire tape response**. Warm matrices → 93 ms.
- **Proof:** the DB query is fully indexed and **0.07 ms** (see Data-Layer below); the only heavy
  work on the cold path is the 30× GEX builds. `flows/route.ts:74` wraps it all in one `serverCache`,
  so the first user after expiry eats the full 17.8 s.
- **Fix (cheap, low-risk, ~18 s → <1 s):**
  1. Make enrichment a **strict warm-cache-only reader** — never trigger a cold matrix build inside
     the tape path. Either call a read-only variant of `getGexPositioning` that returns `null` on a
     cache miss, or wrap each call in a **per-ticker timeout (~250 ms)** and a **smaller cap (top
     ~8 tickers by premium, not 30)**. A miss simply leaves the row unannotated (it's best-effort).
  2. Optionally return the tape first and enrich asynchronously (annotations arrive on the next poll).
- **Expected impact:** cold HELIX tape **17.8 s → <1 s**; eliminates the worst user-visible lag.
- **Confidence:** High (measured + code-traced).
- **✅ FIXED & VERIFIED IN PROD (PR #15, commit `338d7dd`):** applied the timeout (300ms) + cap (8)
  bound. Re-measured live post-deploy: cold `/api/market/flows` TTFB **0.64 s** (was 17.8 s — **~28×
  faster**), warm 79 ms. Tape no longer blocks on cold GEX matrices.

### P-2 — [P2] Cold GEX matrix (1.8 s) / SPX desk (0.94 s) builds; cold build got heavier after PR #11
- **Root cause:** `fetchGexHeatmap` / `buildSpxDesk` fetch + compute the banded options chain on a
  cold cache. PR #11 raised the heatmap page-guard 16→40 (correct for SPX wall accuracy) which makes
  the **SPX cold build pull more pages → slower cold build**. Warm reads are fine (cached ~20 s).
- **Fix:** ensure `heatmap-warm` (and the desk warm) crons keep `SPX/SPY/QQQ` matrices hot during RTH
  so users rarely hit a cold build; consider a background refresh-ahead before TTL expiry
  (single-flight is already present). Quantify the warm-cron cadence vs the 20 s matrix TTL.
- **Expected impact:** users almost never see the 1–2 s cold path during RTH.
- **Confidence:** High (measured).

### P-3 — [P2] Static payload: 305 KB monolithic `globals.css` on every route + ~102 KB shared First-Load JS
- **Evidence:** build output (First Load JS shared ≈ 102 KB) + the known ~305 KB / 11k-line
  `globals.css` shipped on every page including the logged-out landing (carried from the master
  audit). Landing TTFB is great (edge-cached 30 ms) but the CSS weight inflates **LCP/CLS** on first
  paint, especially mobile.
- **Fix:** split tool CSS into route-scoped modules / `@layer`; target a <40 KB public sheet; defer
  desk-only CSS off the landing path.
- **Confidence:** Medium — **needs a live LCP/INP measurement pass** (Lighthouse/computerUse) on the
  authed pages to quantify; flagged for the measured-frontend pass (Phase 9/10 continuation).

### P-4 — [P3] Tape build couples to desk + Night Hawk summaries
- `flows/route.ts:83-86` also builds `getSpxDeskSummary()` + `getLatestNightHawkSummary()` inside the
  cold flows build (`Promise.all`). Minor vs P-1 but adds to cold-path cost; both are best-effort
  (`.catch(()=>null)`). Could be lazily attached.

## VERIFIED CLEAN (performance)
- **Landing is edge-cached** (Cloudflare) — 30 ms TTFB. ✅
- **Warm reads are fast** (60–280 ms) across desk/GEX/flows/pulse/track-record. ✅
- **DB is well-indexed for the hot flow query** — `idx_flow_alerts_recency_premium` is an expression
  index exactly matching `WHERE COALESCE(created_at,inserted_at)… ORDER BY COALESCE(total_premium,0)`;
  EXPLAIN shows an Index Scan, **0.07 ms** exec, 24 MB / 12,828 rows. **The master audit's
  "fetchRecentFlows index-defeating scan / un-indexed ORDER BY" finding is RESOLVED** (false-positive
  if re-reported). ✅
- **Cache-reader discipline holds on the hot path** — the flows enrichment uses `getGexPositioning`
  (shared matrix cache), not a per-user upstream call; the cost is *cold-build fan-out*, not a
  cache-reader violation.

## WHY IT FEELS "ALWAYS SLOW" — browser-measured (live /dashboard, premium, DevTools)
Resources are idle (Railway CPU **~0% / 24 vCPU**, mem **3.5%**) and server p50 is **168 ms**, so it's
**not** the server/DB for typical requests. The persistent slowness is on the client + a few real bugs:

- **PF-1 [P1] CSP blocks `blob:` Web Workers (and CF Insights) → Clerk degraded → auth churn.**
  `next.config.mjs:21` CSP has **no `worker-src`**, so it inherits `default-src 'self'` and blocks
  `blob:` workers. Console: *"Creating a worker from 'blob:…' violates CSP"*. Clerk/Turnstile use a
  blob worker; blocked → Clerk falls back to a slower **main-thread token-refresh polling** path
  (observed `tokens?_clerk_api_version` polling at **100–968 ms** spikes). Also blocks
  `static.cloudflareinsights.com`. Likely contributor to the **38% 4xx** (Railway HTTP metrics:
  `4xx=964/2514`, error_rate ~12%) from auth retries. **Fix:** add `worker-src 'self' blob:;` and
  allow `https://static.cloudflareinsights.com` in `script-src`/`connect-src`. Low-risk (only widens
  to legit sources). **Confidence:** High (CSP source + live console).
- **PF-2 [P1] React hydration error #418 on dashboard** → React discards server HTML and re-renders
  client-side = slower first paint + content flash on every load. Almost certainly the documented
  `FlowBrief.tsx` `new Date().getHours()` server/client mismatch (master-audit bug list). **Fix:**
  derive time from ET on the server / gate first paint behind `mounted`. **Confidence:** Med-High.
- **PF-3 [P2] Page never "settles" — continuous polling.** Multiple endpoints poll indefinitely
  (Clerk token + `outcomes` + `indices`), each 100–900 ms. Network never idles → "always loading"
  feel. **Fix:** prefer SSE over polling, widen poll intervals to match cache TTLs, exponential
  backoff, `revalidateOnFocus:false`. (Matches master-audit §K8.)
- **PF-4 [P2] Heavy payload:** /dashboard = **1.4 MB transferred / 88+ requests** (+ the ~305 KB
  `globals.css`). **Fix:** split CSS route-scoped; reduce request count; code-split the desk widgets.
- **PF-5 [P2] Cold-build tail:** server **p90/p95/p99 ≈ 901 ms** = the GEX/desk cold matrix builds
  (P-2). **Fix:** warm-ahead crons so users rarely hit cold.
- **VERIFIED CLEAN:** scroll/animation render is smooth (no GPU jank); CPU/mem hugely
  under-utilized (not a scaling/resource problem at current load).

## Still to measure (continuation)
- Live LCP/CLS/INP + JS bundle/hydration per page (authed) via a measured browser pass at RTH.
- Cold-build counts in prod logs (how often users actually hit cold vs warm) to size P-1/P-2 impact.
- Redis memory/eviction (could a hot matrix key get evicted → forced cold build?) — pending Redis read access.
