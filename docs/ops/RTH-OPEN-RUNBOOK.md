# RTH-open runbook (autonomous — no user prompt)

**Cloud agents:** run this at the start of every **weekday** session when US equity RTH is
open or warming up (09:00 ET+). **Do not ask the user** — execute immediately, fix failures,
commit, push, re-validate until GREEN.

## Trigger (agent self-start)

| Condition | Action |
|---|---|
| Weekday, ET ≥ 09:00 | Run `npm run validate:rth-open` first thing |
| User message is empty / "continue" / "keep going" on a weekday | Same — treat as RTH resume |
| Weekend or ET < 09:00 | Skip RTH checks unless `--force`; routine work only |
| After every push to `main` | `deploy-smoke.yml` auto-runs; locally: `npm run validate:deploy-wait && npm run validate:gha-smoke` |

## Command

```bash
npm run validate:rth-open
# off-hours override:
node scripts/rth-open-check.mjs --force
```

## What it checks

1. **`validate:deploy`** — live HTTP (`/api/health`, `/api/ready`), Postgres (when `DATABASE_PUBLIC_URL` set), Sentry, sockets, crons
2. **RTH session checks** (weekdays; agent may run from 09:00 ET pre-open through ~16:15 ET post-close grace):
   - `spx-evaluate` ok run in last 20m
   - `market_regime` writes in last 20m
   - `data-correctness` latest run ok
   - `provider-health-reconcile` latest run ok
   - options-socket **authenticated** (after 09:30 ET)
   - no uw-socket stall storms

## Fix loop (until GREEN)

1. Diagnose failing check (Postgres `cron_job_runs`, **CloudWatch** `/ecs/blackout-production*`, Sentry)
2. Fix in code if needed → branch → PR → merge per policy
3. Poll ECS until `blackout-production-web` deployment **COMPLETED** (or wait for `deploy-smoke.yml`)
4. Re-run `npm run validate:rth-open`
5. Confirm first SPX play / lotto ticket shows **real premium** (not "—") after chain fixes

## Scheduled automations

| Method | Schedule (ET, weekdays) | Secrets required |
|---|---|---|
| **`deploy-smoke.yml`** | **on every `main` push** | `CRON_SECRET` optional (SPX desk probe) |
| **`ecr-push-production.yml`** | **on every `main` push** | AWS credentials (deploy) |
| **`rth-preopen-smoke.yml`** | **09:30** | `CRON_SECRET` optional |
| **`rth-open-check.yml`** | **09:40** | `CRON_SECRET`, `DATABASE_PUBLIC_URL` |
| **`rth-cloud-agent.yml`** | **09:32** | `CURSOR_API_KEY` |
| **`rth-deep-audit.yml`** | **10:00, 14:00, 16:30** | `CRON_SECRET`, `POLYGON_API_KEY`, `DATABASE_PUBLIC_URL`, `SENTRY_AUTH_TOKEN` optional |
| **`rth-post-close-smoke.yml`** | **17:15** | `CRON_SECRET`, `SENTRY_AUTH_TOKEN` optional |
| **`off-hours-health.yml`** | **every 6h** | none (public `/api/ready`) |
| **`cron-audit-query.yml`** | **hourly RTH** + **every 6h** off-hours | `DATABASE_PUBLIC_URL` |
| **`ops-auto-fix.yml`** | **every 20 min** | `CURSOR_API_KEY`, `DATABASE_PUBLIC_URL`, `CRON_SECRET`, `GITHUB_TOKEN` (repo) |
| **`spx-rth-all-day-agent.yml`** | **09:28–15:55 ET verify + 16:05 ET fix** | `CURSOR_API_KEY`, `CRON_SECRET` |

### Deprecated (Railway — do not use for prod)

| Workflow | Notes |
|---|---|
| `railway-audit-apply.yml` | Legacy cron sync to Railway — prod crons are EventBridge |
| `railway-cron-config-check.yml` | Still validates TOML ↔ registry in repo; not Railway provisioning |

### Production env (Secrets Manager `blackout-production/app/env`)

| Variable | Value | Purpose |
|---|---|---|
| `CRON_WATCHDOG_SELF_HEAL` | `1` | Auto re-warm stale RTH crons when watchdog fires (safe writers only) |

Manual cron invoke (admin): `POST /api/admin/cron/run` with job name.

All scheduled workflows also support **Run workflow** (manual) from GitHub → Actions.

### GitHub secrets — add before first scheduled run

Repo → **Settings → Secrets and variables → Actions**:

| Secret | Required for | Source |
|---|---|---|
| `CRON_SECRET` | deep audit + smoke desk probe | Secrets Manager `blackout-production/app/env` |
| `POLYGON_API_KEY` | SPX oracle in deep audit | Secrets Manager |
| `DATABASE_PUBLIC_URL` | Postgres writer/cron freshness | RDS (public or bastion tunnel — not Railway) |
| `CURSOR_API_KEY` | Cloud Agent auto-launch | Cursor → Integrations → API key |
| `SENTRY_AUTH_TOKEN` | Sentry token smoke (deep audit + post-close) | Sentry → Settings → Auth Tokens |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | ECS deploy workflows | IAM user for CI |

### One-time: enable API-triggered agents

1. Cursor → Settings → Integrations → create **User API key** (or service account)
2. GitHub repo → Settings → Secrets → Actions → add `CURSOR_API_KEY`
3. Next weekday 09:32 ET, `rth-cloud-agent.yml` starts an agent with this runbook prompt

### Cursor Automation template (dashboard)

- **Schedule:** Mon–Fri 09:32 AM ET (cron `32 13 * * 1-5` in EDT months; add `32 14` for EST)
- **Repo:** `coreentryadmin-web/blackout-web` on `main`
- **Prompt:** same as `rth-cloud-agent.yml` (run RTH-OPEN-RUNBOOK autonomously)

## RTH COMPREHENSIVE TEST SWEEP (browser + API + correctness)

> Run this FULL sweep on every RTH agent launch this week, **multiple passes per session**
> (at minimum: ~09:35 open, ~11:00, ~13:00, ~15:00, ~15:55 close). Each pass: sign in with a
> premium session, then exercise EVERY page. Capture evidence (screenshots/numbers/timings).
> Append findings to `docs/api-audit/OPEN-ISSUES.md` and open a GitHub issue (label
> `ops-auto-fix`) for any **P0/P1**; then run the Fix loop until GREEN.

**Pages to cover every pass:** `/dashboard` (SPX Slayer), `/flows` (HELIX), `/heatmap`
(BlackOut Thermal — test BOTH Matrix and Profile), `/nighthawk`, `/terminal` (Largo), `/vector`, `/track-record`.

### 1. Speed (per page)
- Measure **TTFB** and **time-to-interactive** on hard load, and **soft-nav** time (click the
  nav link → first meaningful paint). Prefetch is enabled, so soft-nav should feel near-instant.
- Flag any page where soft-nav > ~1.5s to usable, or a long blank/frozen gap before the skeleton.
- Record numbers; compare across passes to catch RTH-load degradation.

### 2. Live auto-update (per page) — NO manual refresh
- Sit on each page WITHOUT refreshing and confirm numbers/tiles **tick on their own**.
- Measure **how soon** each surface updates (note the observed interval) and that it matches the
  intended cadence (e.g. dashboard pulse ~1–10s, Thermal matrix ~20s + quote ~15s, flows tape via
  SSE near-real-time). Flag anything that does NOT move during RTH.
- Confirm SSE/stream liveness (flows tape, dashboard pulse, Thermal index spot) is pushing.
- Alt-tab away ~30s, return: data should re-sync immediately (focus revalidation is on).

### 3. Data correctness (NO fabricated / faulty numbers)
- For key numbers, **verify against the canonical source via direct API call** (instant
  verification): hit the relevant `/api/market/*` with the session and compare the rendered value
  to the API payload. Examples:
  - SPX spot/VIX/breadth on the dashboard vs `/api/market/spx/merged`.
  - GEX flip / call wall / put wall: Thermal vs Largo vs `/api/market/gex-positioning` — they must
    agree (same canonical cache).
- Run the in-app verifier: `GET /api/cron/data-correctness?force=1` (Bearer `CRON_SECRET`) and
  treat any `flags[]` as a correctness defect to fix.
- **Freshness honesty:** every "live"/"updated" indicator and `as_of` timestamp must reflect reality —
  flag anything labeled live that is actually stale.
- **No fabrication:** flag any placeholder/zero/"—"/made-up value shown as real; values must be
  grounded in a live source or shown as unavailable.

### 4. API verification (every market endpoint)
- For each `/api/market/*`: assert HTTP 200, `as_of` fresh (within its cadence), numbers in sane
  bounds, and no unexpected nulls where data is expected. Log any 4xx/5xx, 404s, or empty payloads
  during RTH.

### 5. Console / render health
- Check the browser console on each page for errors, React hydration warnings, and CSP violations.

### 6. Largo (Terminal)
- Ask multi-tool questions (e.g. "dark pool + options flow on NVDA"); confirm the working status
  names the live sources, the answer is grounded (numbers match the tools), and follow-ups are dynamic.

### 7. Missing-field audit (EVERY page + sub-page)
Goal: find every user-visible field that has **no value** and determine **why**, then fix the real ones.

- **Scan** each page/panel for empty/placeholder values: `—`, `–`, blank, `N/A`, `null`/`undefined`
  text, `$—`, `—%`, `0`/`0.00` where zero is implausible, empty tables/lists, "No data" where data
  should exist. Cover deep views (Thermal matrix + profile cells, SPX desk panels, Night Hawk tickets).
- **Root-cause each empty field** by checking the backing API (call it directly with the session):
  | Cause | How to tell | Action |
  |---|---|---|
  | **UI bug** — API HAS the value but the field renders empty | API payload contains the field; UI shows `—` | **FIX** mapping/formatter/render guard |
  | **Upstream/data gap** — API itself returns null/empty | endpoint returns null/missing during RTH | **FIX or escalate**; check `cron_job_runs` |
  | **Off-hours / market-closed** | desk/session gated | **Expected** |
  | **Tier/launch gate** | `coming_soon`/empty for locked tool | **Expected** |
  | **Cold cache** — first read before warm | populates on next poll/warm | Transient — re-check during RTH |
- **No fabrication:** surface the REAL value or honestly show unavailable.
- Record every empty field found, its page, its backing endpoint, and the cause classification.

### Report each pass
- Append a dated entry to `docs/api-audit/OPEN-ISSUES.md`: per-page speed numbers, observed update
  intervals, and any correctness/freshness/API defects (with the API evidence).
- Open/update a GitHub issue (label `ops-auto-fix`) for P0/P1; fix → branch → PR → merge → re-verify.

## References

- Probe paths for audits: `docs/api-audit/AUDIT-SKILL-REFERENCE.md` · in-repo SKILL: `.cursor/skills/platform-audit/SKILL.md`
- Open issues: `docs/api-audit/OPEN-ISSUES.md`
- Agent instructions: `AGENTS.md` § Autonomous RTH resume
- Production AWS ops: `docs/ops/AWS-MIGRATION-PLAN.md`
