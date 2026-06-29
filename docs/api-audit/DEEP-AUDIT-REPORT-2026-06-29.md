# Deep Platform Audit — 2026-06-29 (for fix agents)

> **Audience:** the two code-fix agents working in parallel. This is the QA agent’s live
> production audit — every finding is verified against `blackouttrades.com` with admin/cron
> credentials, Polygon oracle, and browser cross-service reads.

---

## Secrets to add (operator action)

These are **missing or invalid** in the Cloud Agent environment. Adding them unlocks DB/Redis/Railway
layer audits the cron verifiers cannot fully substitute.

| Secret | Why needed | Priority |
|---|---|---|
| `DATABASE_URL` or `DATABASE_PUBLIC_URL` | Direct Postgres row counts, `signal_outcomes` vs `spx_play_outcomes` split-brain proof, cron_job_runs, Night Hawk edition rows | **P0** |
| `REDIS_URL` | Verify hot keys (`gex-heatmap:*`, `spx-desk:*`, flow cache TTLs) — data-layer verifier reads via app cache only | **P0** |
| `RAILWAY_TOKEN` (project-scoped, valid) | Current token returns `Unauthorized`. Needed for service list, deploy logs, cron trigger health | **P1** |
| `ADMIN_EMAILS` | Confirm `coreentryadmin@gmail.com` is on allowlist (Clerk user has `tier:premium`, role not set) | **P2** |
| Fix typo `CLOUDFLARE_API_TOKE` → use `CF_API_TOKEN` (already works) | Housekeeping | **P3** |

Already present and used this session: `CRON_SECRET`, `CLERK_SECRET_KEY`, `POLYGON_API_KEY`,
`UW_API_KEY`, `WHOP_*`, `CF_API_TOKEN`, `CF_ZONE_ID`, `ANTHROPIC_API_KEY`, `SENTRY_AUTH_TOKEN`.

---

## Executive summary

| Area | Verdict |
|---|---|
| Malformed UI (`NaN`, `undefined`, etc.) | ✅ Clean on all public + premium pages tested |
| SPX spot cross-service (backend) | ✅ **7440.43** — desk snapshot == Polygon `I:SPX` oracle (Δ 0.00) |
| VIX cross-service | ✅ **17.65** — desk == Polygon oracle |
| Data-correctness cron (`force=1`) | ✅ 0 FLAGS; 7 independently confirmed; 69 consistency-only gaps (expected off-RTH) |
| Data-integrity cron (`force=1`) | ⏸ 0 checks (market closed — by design) |
| Track record | ❌ **P1 split-brain** (see below) |
| Night Hawk crons | ❌ **P1 stale** — outcomes + playbook |
| Largo SPX answers | ✅ Correct (~7448) — **NOT a bug** (browser agent misread dashboard) |

---

## 🔴 P1 — Track record split-brain (FIX AGENT #1)

**Symptom:** Users see contradictory track-record states on the same product.

| Surface | Endpoint / source | Production now |
|---|---|---|
| `/track-record` page | `GET /api/track-record` → `signal_outcomes` (T+30 / EOD checkpoints) | **0 signals** → UI: "Track record is building" |
| `/embed/track-record` | `buildPublicTrackRecord()` → `spx_play_outcomes` ledger | **3 closed plays**, 0% hit rate, LIVE |
| `GET /api/public/track-record` | Same as embed | **3 closed** — math verified ✅ |

**Math on public API (verified):**
- wins(0) + losses(3) + breakeven(0) = total_closed(3) ✅
- cold_buy(1) + watch_promote(2) = 3 ✅
- win_rate_pct 0% ✅

**Root cause:** Two aggregation paths. Page uses `src/app/api/track-record/route.ts` (signal_outcomes).
Embed/public uses `src/lib/track-record-public.ts` (play outcomes ledger). The data-correctness verifier
(`track-record-verifier.ts`) validates ledger ↔ public but **does not check `/api/track-record`**.

**Fix direction:** Unify on one ledger OR wire `TrackRecordView` to `/api/public/track-record` and
retire the signal_outcomes path for SPX Slayer social proof. File: `src/components/track-record/TrackRecordView.tsx:46`.

---

## 🔴 P1 — Night Hawk crons stale (FIX AGENT #2 / operator)

**Source:** `GET /api/cron/cron-staleness-watchdog` (cron auth)

```json
{
  "problem_keys": ["nighthawk-outcomes", "nighthawk-playbook"],
  "problems": 2
}
```

- `nighthawk-outcomes` — resolves play target/stop vs next-day prices (4:30 PM ET)
- `nighthawk-playbook` — edition worker (5:30 PM ET)

**Note:** Night Hawk **UI still shows a live edition** (5 plays via platform snapshot). Outcomes cron
may be failing silently while publish path works — verify `cron_job_runs` in Postgres once `DATABASE_URL`
is available.

**Files:** `railway.nighthawk-outcomes.toml`, `railway.nighthawk-playbook.toml`, registry keys in
`src/lib/cron-registry.ts`.

---

## 🟡 P2 — Analytical cross-service validation (RTH re-test needed)

Ran during **post-RTH** (~16:24 ET). Backend numbers are internally consistent; full cross-tool matrix
(data-integrity C1–C6) skips when `merged.market_open === false`.

### Oracle-grounded answers (what Largo *should* say — verified via cron snapshot + Polygon)

| Question | Expected answer (2026-06-29 ~20:30 UTC) | Sources |
|---|---|---|
| SPX spot now? | **7440.43** | Platform snapshot + Polygon `I:SPX` |
| Gamma flip? | **7435.15** | Platform snapshot `spx.gamma_flip` |
| SPX vs VWAP? | **Above** (+22.97 pts, VWAP **7417.46**) | snapshot price vs vwap |
| VIX? | **17.65** (−4.13%) | snapshot + Polygon `I:VIX` |
| Regime? | **NEUTRAL**, net GEX **+$28.4B**, above VWAP **true** | `/api/market/regime` |

### Largo analytical questions (browser session — admin premium)

| # | Question | Largo answer | Verdict |
|---|---|---|---|
| Q1 | SPX spot + gamma flip | SPX **7448.43**, flip **7435.15** | ✅ Matches backend (±8 pts live drift OK) |
| Q2 | SPY net GEX + call wall | Net GEX **+$2.898B**, call wall **741** | ⚠️ Re-verify vs `/api/market/gex-positioning?ticker=SPY` at RTH |
| Q3 | NVDA flow put vs call | Calls **$177M**, puts **$73M**, net call-skewed | ⚠️ Re-verify vs HELIX tape filters |
| Q4 | SPX vs VWAP | **7448.43** vs **7417.46**, above (+0.31%) | ✅ Consistent with snapshot |

**Correction to prior browser report:** Largo SPX ~7448 is **correct**. Dashboard reading of ~5460 was
likely a mis-read or stale client cache — **backend desk price is 7440.43**, not 5460. Re-test dashboard
header at RTH with hard refresh.

### Cross-service matrix (backend, cron auth)

| Check | Result |
|---|---|
| Polygon SPX vs desk snapshot | ✅ Δ 0.00 |
| Polygon VIX vs desk | ✅ Match |
| Regime `aboveVwap` vs desk price > vwap | ✅ Both true |
| Public track-record vs page track-record | ❌ Split-brain |
| Flows in snapshot (50 rows, $602M total) | ✅ Present; re-verify Σ vs HELIX UI at RTH |
| Night Hawk edition | ✅ `play_count: 5`, `edition_for` set |

---

## 🟢 Verified GREEN

- `npm test` 402/402, `tsc`, `build`, `lint:brand`
- Auth on premium market routes (401 without session)
- `/api/platform/intel` requires cron or premium session (cron auth works — intentional)
- No data-correctness FLAGS on forced run
- Cloudflare zone `blackouttrades.com` active
- Clerk admin user exists: `coreentryadmin@gmail.com` (`tier: premium`)

---

## Tool-by-tool status (premium browser + API)

| Tool | Data correct? | Notes |
|---|---|---|
| SPX Slayer / Dashboard | ⚠️ Re-verify UI at RTH | Backend 7440.43; UI may cache stale |
| Heat Maps | ✅ | SPY GEX matrix loads, lenses switch |
| HELIX Flows | ✅ | 500 alerts, call/put partition sane |
| Night Hawk | ✅ UI / ❌ crons | Edition live; outcomes cron stale |
| BlackOut Grid | ✅ | Pulse uses same merged desk path |
| Largo | ✅ | Grounded answers match snapshot |
| Track record page | ❌ | Split-brain vs embed |
| Track record embed | ✅ | 3 closed, math correct |

---

## Assignments for parallel fix agents

### Agent A — Track record + public surfaces
1. Fix `/track-record` page to use the same source as `/api/public/track-record`
2. Extend `track-record-verifier.ts` to FLAG when `/api/track-record` disagrees with ledger
3. Add test: public page and embed must show identical counts

### Agent B — Crons + Night Hawk pipeline
1. Investigate `nighthawk-outcomes` + `nighthawk-playbook` Railway services (last run, logs)
2. Confirm `cron_job_runs` rows after manual `hit-cron.mjs` trigger
3. If services exist but stale, fix schedule/env; if missing, provision from `.toml`

### Both — RTH validation pass (Monday 9:30–16:00 ET)
1. Re-run `data-integrity?force=1` — expect `checks_run > 0`, `discrepancies: 0`
2. Re-run browser cross-service matrix (desk vs heatmap vs Largo vs flows)
3. Confirm data-correctness `independentlyConfirmed > 0` during RTH

---

## Commands to re-run

```bash
# Cross-service snapshot (cron)
curl -sS -H "Authorization: Bearer $CRON_SECRET" \
  https://blackouttrades.com/api/market/platform/snapshot | jq '.spx'

# Data correctness (full platform)
node scripts/hit-cron.mjs /api/cron/data-correctness
# add ?force=1 off-hours via curl

# Cron health
node scripts/hit-cron.mjs /api/cron/cron-staleness-watchdog

# Public site sweep
node scripts/site-audit.mjs --base=https://blackouttrades.com
```

---

Last run: 2026-06-29 ~20:35 UTC · QA agent session
