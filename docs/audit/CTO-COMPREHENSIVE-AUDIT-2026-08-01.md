# BLACKOUT — CTO Comprehensive Engineering Audit

**Date:** 2026-08-01 (UTC)  
**Auditor role:** Acting CTO / Principal Staff / SRE / Security / Performance / Mobile / UX  
**Repo:** `coreentryadmin-web/blackout-web` (`main` @ deploy validation GREEN)  
**Production:** AWS ECS Fargate (`blackout-production-cluster`), Cloudflare → ALB → Next.js 15  
**Scope:** Full-repo discovery, 45 pages + 175 API routes, live prod probes, code-path review  

**Evidence classes used in this document:**
- **Confirmed** — measured in prod, CI, or directly read in code with file references
- **Inferred** — logical conclusion from architecture; not live-measured
- **Hypothesis** — plausible risk requiring follow-up measurement

---

## Executive summary

BlackOut is a **mature, cache-reader-first** trading desk with strong institutional guardrails (truth-first data, tier gates on pages, cron auth, Redis single-flight, UW 2 RPS cluster budget). **API warm-path latency is excellent** (25–80ms on core desk routes off-hours; site-latency audit **0 FAIL / 33 checks**).

The platform **does not yet meet 10k–100k concurrent-trader scale** without changes. The first failures at scale are **Postgres connection oversubscription**, **HTTP/autoscale ceiling (max 15 ECS tasks)**, and **client-side request/payload storms** — not raw API handler slowness.

**Top 5 systemic weaknesses (confirmed or strongly evidenced):**

| # | Finding | Severity | Impact |
|---|---------|----------|--------|
| 1 | **Premium page / community API tier mismatch** — many premium product pages gate at `requireTier("premium")` but APIs use `authorizeMarketDeskApi` (community+) | **P1 Security/Product** | Paywall bypass via direct API; entitlement drift |
| 2 | **`PG_POOL_MAX=15` × N ECS tasks vs ~20 RDS Proxy backends** | **P1 Scalability** | Connection queue → 503/timeouts under cache-miss storms |
| 3 | **Client payload bloat** — Vector SSR wall rails (~50MB RTH) | **P1 Performance** | Fix in **PR #1478** (OPEN — not merged per operator) |
| 4 | **`REPLICA_COUNT=5` in prod secrets vs 8–15 running web tasks** | **P1 Config** | UW/PG budget math wrong in degraded mode |
| 5 | **Dashboard RTH polling density** — 2s intervals × 6+ lanes + matrix + embeds | **P2 Performance** | “Feels slow/busy” despite fast APIs; mobile battery/CPU |

**Live ops note (confirmed P0):** `ops:collect` reported **1 data-correctness FLAG** — SPX 0DTE King strike disagrees with UW greek-exposure by 3.07% of spot (`correctness:flags`).

---

## Phase 1 — Architectural map

### Dependency graph (logical)

```
[Cloudflare CDN] → [ALB] → [ECS web tier × 8–15]          [ECS market-worker × 1]
        │                         │                                  │
        │                         ├─ Next.js App Router              ├─ WS ingest (UW/Polygon/LULD)
        │                         ├─ Clerk auth (middleware)         └─ Redis snapshot writers
        │                         ├─ server-cache (L1 per task)
        │                         ├─ shared-cache (L2 Redis)
        │                         └─ db.ts (PG pool → RDS Proxy)
        │
[Marketing HTML edge-cache]   [Desk routes DYNAMIC / no-store]

External: Clerk · Whop · Polygon/Massive · UW · Anthropic · Sentry · Discord · web-push
Persistence: Postgres 16 (Multi-AZ) · Redis 7 (ElastiCache HA)
Crons: EventBridge → Lambda → GET /api/cron/* (31 rules)
Deploy: merge main → ECR → ECS rollout → Cloudflare purge
```

**Note:** Railway is **legacy schedule catalog only** — production runs on **AWS ECS**, not Railway.

### Frontend architecture (confirmed)

| Layer | Location | Notes |
|-------|----------|-------|
| Marketing shell | `src/app/(marketing)/` | Lean CSS (`marketing-base.css`), no Clerk desk chrome |
| Product shell | `src/app/(site)/layout.tsx` | **Real shell** — `PlatformShell.tsx` is dead |
| Feature modules | `src/features/{spx,helix,thermal,nighthawk,largo,vector}/` | Colocated UI + lib |
| Shared UI | `src/components/` | Institutional design system |
| Client data | SWR + SSE (`usePulseStream`, vector/flows streams) | Aggressive RTH polling |

### Backend architecture (confirmed)

| Concern | Implementation |
|---------|----------------|
| Auth | Clerk middleware — **GET auth is per-route**, not middleware |
| Tier | `resolveUserTier` + `requireTierApi` / `authorizeMarketDeskApi` |
| Tool launch | `requireToolApi` — launch gate only, **not tier** |
| Market data | Cache-reader: Redis ← market-worker WS/crons |
| Play engine | `spx-service.ts` + Redis NX locks |
| 0DTE | `zerodte-service.ts` + shared board snapshot |
| GEX | Single path via `getGexPositioning()` / polygon-options-gex |

### Caching layers (confirmed)

1. **Cloudflare** — marketing HTML (with `__session` bypass for auth chrome); static assets immutable
2. **L1 `server-cache.ts`** — 5k entry LRU per ECS task, SWR + single-flight
3. **L2 `shared-cache.ts`** — `blackout:${key}` Redis, 500ms read race
4. **SWR client** — per-hook refreshInterval (2s–120s)
5. **sessionStorage** — desk merge cache (7.5s throttle)

---

## Phase 2 — Complete route inventory

**Generated:** `node scripts/generate-route-inventory.mjs`  
**Counts:** **45 pages**, **175 API routes**

### Product pages (premium tools)

| Route | Tool | Page gate (confirmed) |
|-------|------|------------------------|
| `/dashboard` | SPX Slayer | `requireTier("community")` |
| `/flows` | HELIX | `requireTier("premium")` |
| `/heatmap` | Thermal | `requireTier("premium")` |
| `/nighthawk` | Night Hawk / 0DTE | `requireTier("premium")` |
| `/terminal` | Largo | `requireTier("premium")` |
| `/vector` | Vector | `requireTier("premium")` |
| `/track-record` | Record | tier varies |
| `/account` | Account | authenticated |

### Marketing / public (30 pages)

`/`, `/pricing`, `/faq`, `/why-blackout`, `/learn/*` (18 articles), legal (`/privacy`, `/terms`, …), `/contact`, `/upgrade`

### Admin (4)

`/admin`, `/admin/users`, `/admin/track-record`, `/admin/largo-answer-preview`

### Auth & utility

`/sign-in`, `/sign-up`, `/offline`, `/embed/track-record`, `/native-signin`

### API surface (175 routes — grouped)

| Prefix | Count | Auth pattern |
|--------|-------|--------------|
| `/api/cron/*` | 40 | `isCronAuthorized` ✓ |
| `/api/admin/*` | 35+ | `requireAdminApi` ✓ |
| `/api/market/*` | 60+ | Mixed — **see P1 tier drift** |
| `/api/health`, `/api/ready` | 2 | Public |
| Webhooks, telemetry, mobile | remainder | Route-specific |

Full machine list: run `node scripts/generate-route-inventory.mjs --json`.

---

## Phase 3–7 — Page & performance audit

### Live measurements (confirmed, off-hours 2026-08-01 UTC)

| Probe | Result |
|-------|--------|
| `npm run validate:deploy` | **GREEN** (3 warnings: no prod CLI, PG unreachable from sandbox, 25 Sentry issues) |
| `npm run ops:collect` | **1 P0 item** — SPX King cross-provider disagreement |
| `site-latency-audit.mjs --api-only` | **0 FAIL / 33** — warm APIs 27–70ms except gex-heatmap SPY occasional 850–960ms WARN |
| `/vector` HTML (off-hours) | **48KB** — bloat is session/rail dependent |
| `globals.css` | **~498KB** source (Tailwind compile — **confirmed file size**) |

### Dashboard (`/dashboard`) — SPX Slayer

**User objective:** See live SPX play, matrix, levels, vector embed — decide in seconds.

| Dimension | Score / finding | Evidence |
|-----------|-----------------|----------|
| Performance | **6/10** | APIs fast; **~870ms** to matrix visible (prior audit); **~1MB JS + ~500KB CSS**; mount fires bootstrap + pulse + desk + flow + play + gex + pin + vector bars |
| UX | **8/10** | Institutional density; strong information hierarchy |
| Mobile | **6/10** | iOS shell exists; matrix + vector heavy on phone |
| Scalability | **5/10** | 2s poll × many lanes per user |

**Mount waterfall (confirmed code):** `useMergedDesk` — bootstrap first, then pulse (1–2s), desk (2s), flow (2s); matrix/ play / vector embed add parallel families (`useMergedDesk.ts`, `SpxGexMatrixHeatmap`, `SpxVectorEmbed`).

**Root cause of “slow UI” (confirmed):** Not TTFB — **client JS execution + parallel polling + large CSS/JS**, plus off-hours heatmap `?force=1` chain rebuilds (**fixed #1476 RTH-only**, merged).

### `/flows` — HELIX

| Dimension | Score | Notes |
|-----------|-------|-------|
| Performance | **6/10** | Initial 500-row page size; 4+ API families on mount; **#1475** defers secondary fetches to idle (verify merged) |
| UX | **7/10** | Dense tape — appropriate for pro users |
| Security | **4/10** | API community-tier vs page premium — **P1** |

### `/heatmap` — Thermal

| Dimension | Score | Notes |
|-----------|-------|-------|
| Performance | **7/10** post-#1476 | RTH-only force; matrix poll 5s RTH |
| UX | **8/10** | Triple desk, lens toggles |
| Security | **4/10** | `requireAnyToolApi(["spx","heatmap"])` bypass — **P1** |

### `/vector`

| Dimension | Score | Notes |
|-----------|-------|-------|
| Performance | **3/10 RTH pre-fix** | ~50MB payload — **PR #1478** (OPEN) |
| UX | **8/10** | Rich chart, replay, DTE horizons |

### `/nighthawk`

| Dimension | Score | Notes |
|-----------|-------|-------|
| Performance | **7/10** | Board 10s poll; marks SSE + 2.5s fallback |
| Correctness | **9/10** | Premium + tool gate on edition API ✓ (reference pattern) |

### `/terminal` — Largo

| Dimension | Score | Notes |
|-----------|-------|-------|
| Performance | **7/10** | Budget gates on query API |
| Security | **8/10** | Premium + tool gate ✓ |

### Marketing pages

| Dimension | Score | Notes |
|-----------|-------|-------|
| Performance | **9/10** | Edge-cached, lean CSS |
| SEO | **7/10** | Learn cluster growing (#1471, #1463 canonical) |
| Risk | **P2** | CF HTML cache rule must keep `__session` bypass (fixed 2026-07-22) |

---

## Phase 8 — Network audit

### Duplicate / serial patterns (confirmed)

| Pattern | Severity | Detail |
|---------|----------|--------|
| Dashboard cold mount | P2 | Bootstrap dedupes lanes but matrix/play/vector still parallel |
| Vector chart | P1 pre-#1478 | Full wall history in SSR + SSE attach frame |
| GEX heatmap `?force=1` | P2 | 6–11s chain rebuild — mitigated RTH-only |
| Flows tape | P3 | 60s server cache — good |

### Polling cadence summary (confirmed)

| Surface | RTH interval |
|---------|--------------|
| SPX pulse REST | 1s (2s when SSE up) |
| SPX desk / flow / play / matrix | 2s |
| Vector SSE hub | 1 Hz shared per ticker |
| HELIX flow head | 30s |
| Thermal matrix | 5s |
| 0DTE board | 10s (60s when heat CLOSED) |

**At 10k users × 2 tabs × 2s polling → ~10k req/s** to web tier — requires autoscale + cache hit rate near 100% on hot keys.

### Payload sizes

| Endpoint | Off-hours | RTH (inferred) |
|----------|-----------|----------------|
| `/api/market/spx/play` | ~30ms, small JSON | OK |
| `/api/market/gex-heatmap` | 49–960ms | Large matrix JSON |
| `/vector` page / seed | 48KB HTML off-hours | **~50MB pre-fix** |

### Compression / cache headers

- Market routes: `NO_STORE_HEADERS` on most (CI guard)
- Gaps: `/api/engine/*`, some admin routes — **P2**
- Brotli/gzip: ALB/Cloudflare (confirmed infra)

---

## Phase 9 — Database audit

### Connection pool (confirmed P1)

```text
Safe default: floor(20 / REPLICA_COUNT) → 2–4 conns/task
Prod override: PG_POOL_MAX=15 → 15 × 8 tasks = 120 clients vs ~20 proxy backends
```

**Fails first at 10k concurrent:** `pool.waitingCount > 0` → flows/desk 503.

### Hot-path queries

| Path | Assessment |
|------|------------|
| `fetchRecentFlows` | Indexed time sort ✓ |
| SPX play eval | Redis lock + 5s cache ✓ |
| 0DTE board | Shared snapshot ✓; **N UPDATEs per open row** on rebuild — P2 |
| Playbook resolver | Duplicate `loadPlaybookInstanceStates` — P3 |

### Index gaps (inferred P2)

- `nighthawk_play_outcomes (ticker, edition_for DESC)` — missing for batched echo fetch

---

## Phase 10 — Caching audit

| Issue | Severity | Detail |
|-------|----------|--------|
| TTL-aligned miss storm | P2 | All replicas cold-build same key simultaneously |
| L1 divergence if Redis slow | P2 | 500ms race → per-replica rebuild |
| 0DTE board | Fixed | Shared Redis snapshot + NX lock |
| Stale `REPLICA_COUNT` | P1 | Degraded UW RPS math wrong |

---

## Phase 11 — Security audit (API tier alignment)

**Confirmed P1:** Premium pages vs community APIs.

**Reference pattern (correct):** `nighthawk/edition/route.ts` — `authorizeCronOrTierApi(req, "premium")` + `requireToolApi`.

**Affected families (confirmed by code review):**

- HELIX: `/api/market/flows`, `/flows/stream`, `/option-contract`, `/flow-brief`
- Thermal: `/api/market/gex-heatmap*`, `/heatmap`, `/gex-positioning`, `/gex-matrix-deltas`
- Vector: all 15 `/api/market/vector/*` routes
- Intel: `/api/platform/intel`, `/api/brief/premarket`, `/api/coaching/alerts`

**Impact:** Community-tier SPX member can call premium JSON directly.

**Recommendation:** Add CI test: for each `(site)/*/page.tsx` with `requireTier("premium")`, assert matching APIs require `authorizeCronOrTierApi(..., "premium")`.

---

## Phase 12–14 — Visual, mobile, accessibility

### Visual consistency (confirmed rules)

- No grey text on `#040407` — enforced by lint:brand
- Institutional bar — DESIGN_BENCHMARK.md
- iOS: `html.ios-app`, Capacitor shell, bottom tab bar E2E

### Mobile (confirmed)

- **Strength:** Dedicated iOS app, Playwright iOS E2E, safe-area CSS
- **Weakness:** Desk designed desktop-first — matrix + vector on small screens; 2s polling battery cost
- **Hypothesis:** Dynamic Island / notch — needs device QA (not measured here)

### Accessibility (inferred P2)

- ESLint jsx-a11y non-blocking in CI
- FreshnessChip, aria-live on loaders present
- Full VoiceOver audit **not run** in this session (browser blocked in cloud sandbox)

---

## Phase 15 — Observability

| System | Status |
|--------|--------|
| `/api/health`, `/api/ready` | ✓ |
| Sentry | 25 unresolved (sample) — includes stale Server Action hash, Clerk noise |
| CloudWatch | ECS + market-worker logs |
| Cron watchdog | `ops-auto-fix.yml` every 20m |
| OpenTelemetry / Prometheus | **Not found** — gap at 50k+ scale |
| Data correctness cron | FLAG active (King strike) |

---

## Phase 16 — Scalability failure order

| Concurrent users | First failure | Second | Third |
|------------------|---------------|--------|-------|
| **10k** | PG pool queue | ALB p99 / 15 task cap | Redis read latency |
| **50k** | HTTP tier saturated | PG CPU on flow_alerts JSONB | Per-replica cache stampede |
| **100k** | Architecture limit | Need read replicas + tape materialization + edge API tier | UW irrelevant if cache-reader holds |

**UW 2 RPS:** Cluster-wide cap — **does not scale with users** if cache-reader discipline holds (confirmed design).

---

## Phase 17 — Scorecard (product pages)

Scores 1–10. **Priority:** P0–P3. **Effort:** S/M/L.

| Page | Perf | UX | A11y | Mobile | Security | Scale | Maint | Priority | Effort |
|------|------|-----|------|--------|----------|-------|-------|----------|--------|
| `/dashboard` | 6 | 8 | 7* | 6 | 7 | 5 | 7 | P2 perf | M |
| `/flows` | 6 | 7 | 7* | 7 | **4** | 6 | 7 | **P1 tier** | M |
| `/heatmap` | 7 | 8 | 7* | 6 | **4** | 6 | 7 | **P1 tier** | M |
| `/vector` | 3→7† | 8 | 7* | 5 | **4** | 5 | 6 | **P1 perf+#1478** | S |
| `/nighthawk` | 7 | 8 | 7* | 7 | 8 | 6 | 6 | P2 | M |
| `/terminal` | 7 | 8 | 7* | 6 | 8 | 7 | 7 | P3 | S |
| Marketing | 9 | 8 | 8* | 8 | 9 | 9 | 8 | P3 SEO | M |

\*A11y not device-verified this session.  
†After PR #1478 merge.

---

## Phase 18 — Implementation status

| Item | Status | Branch/PR |
|------|--------|-----------|
| Vector ~50MB payload | **Ready, not merged** | PR #1478 (operator: no auto-merge) |
| RTH-only heatmap force | **Merged** | #1476 |
| Flows defer secondary fetch | **Merged** | #1475 |
| SPX play / GEX peek | **Merged** | #1470 |
| Tier API alignment | **Documented, not implemented** | Needs dedicated PR + CI test |
| PG_POOL_MAX alignment | **Documented** | Secrets Manager change — deploy-risky |
| REPLICA_COUNT=5 drift | **Confirmed warning** | Bump to match autoscale min 8 |
| Route inventory script | **Added** | `scripts/generate-route-inventory.mjs` |
| King strike correctness | **P0 ops flag** | Needs data-path investigation |

---

## Prioritized remediation roadmap

### P0 — Do now

1. **Investigate SPX King strike cross-provider FLAG** (`ops:collect` / data-correctness)
2. **Merge PR #1478** after operator review (Vector payload)

### P1 — Next sprint

1. **Tier alignment PR** — premium APIs match premium pages (HELIX, Thermal, Vector, intel)
2. **`REPLICA_COUNT` → 8** (match autoscale min) in Secrets Manager
3. **`PG_POOL_MAX` → safe formula** (e.g. 2–3 at 8 tasks) — coordinate with proxy budget
4. **CI tier-alignment test** — prevent regression

### P2 — Scale prep

1. Batch 0DTE ledger UPDATEs
2. Add `nighthawk_play_outcomes` index
3. Cap `/api/market/flows` max limit below 5000
4. Extend `NO_STORE_HEADERS` to engine/admin gaps
5. Reduce HELIX initial page size (500 → 100) for first paint

### P3 — Institutional polish

1. OpenTelemetry on hot API routes
2. Full VoiceOver / keyboard audit in browser-capable CI
3. SEO: GSC, public track record, Learn cluster expansion
4. Codify Cloudflare cache rules in terraform

---

## Verification commands (standing)

```bash
npm run validate:deploy
npm run ops:collect
node scripts/site-latency-audit.mjs
node scripts/generate-route-inventory.mjs --json
npm run validate:rth-open          # weekdays ≥ 09:00 ET
npx tsx --test src/features/vector/lib/vector-wall-transport.test.ts
```

---

## Appendix — Architectural invariants (do not break)

1. `src/lib/db.ts` idle-pool error handler (~:113)
2. `make-redis.ts` `family:0` + reconnect
3. `SPX_OPTION_CHAIN_REQUIRED` default false in prod
4. Real shell: `src/app/(site)/layout.tsx`
5. GEX single-sourced via `getGexPositioning()`
6. Cache-reader rule for UW (2 RPS cluster-wide)

---

*End of audit. Findings logged here; product fixes follow `CLAUDE.md` issue-handling (branch → test → FINDINGS.md → PR). Operator requested no auto-merge on agent PRs.*
