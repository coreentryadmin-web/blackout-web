# SPX Playbook — Implementation Roadmap

> ### ⚠ ENVIRONMENT CLAIMS IN THIS FILE ARE STALE — audited 2026-08-22
>
> This document predates the **decommissioning of staging on 2026-07-25**. Its *engineering* content
> was re-checked against the code at `9b20b63c` and is largely **accurate**; its *environment* content
> is **false**. Specifically, anywhere in this file:
>
> - **`staging.blackouttrades.com` / "staging lab" / "on staging"** — that environment no longer
>   exists. ECS, RDS, Cognito, ALB, crons, secrets: all deleted. There is no pre-prod deploy target;
>   changes ship straight to production.
> - **`coreentryadmin-web/blackout-web-sandbox`** — not this repo. This is `blackout-web`.
> - **"Railway prod"** — there is no Railway. All infrastructure is AWS ECS.
> - **`isStagingDeploy()`-gated behaviour described as active** — that predicate has been
>   permanently false in every environment since 2026-07-25, so those code paths run nowhere. See
>   `docs/spx/SLAYER-MAP.md` §7.1 (it left PB-01/PB-02 unable to fire at all, fixed in #2636).
> - **"prod: playbook live gate off"** — measured false. `PLAYBOOK_LIVE_GATE="1"` in
>   `blackout-production/app/env`, so gate A17 requires a matched primary playbook before any BUY.
>
> **`docs/spx/SLAYER-MAP.md` is the live inventory.** Read this file for design intent and the
> per-playbook detail; do not read it for where anything runs or what is currently enabled.


**→ See `PLAYBOOK-ARCHITECTURE-STATUS.md` for the single source of truth (architecture, families, per-PB matrix, fixed vs open).**

Tracks ChatGPT + Claude external-review recommendations against staging (`blackout-web-sandbox`).

**Last updated:** 2026-07-10

---

## P0 — Evidence foundation

| Item | Status | Notes |
|------|--------|-------|
| `PLAYBOOK_LIVE_ALLOWLIST` gate A17 | ✅ Shipped (#62) | Staging default PB-01–04 |
| Persistent state machine + `instance_id` | ✅ Shipped | `playbook-state.ts`, `spx_playbook_instances` |
| Per-instance telemetry + feature snapshot | ✅ Shipped | `feature_snapshot`, `instance_transitions` on shadow rows |
| Short-side pipeline audit counters | ✅ Shipped | `playbook-pipeline-audit.ts`, surfaced on `playbook_shadow` panel |
| Unknown regime fail-closed (live BUY) | ✅ Shipped | `isUnknownPlaybookRegime` in gate A17 |
| PB-11 rolling 30m range | ✅ Shipped (#61) | |
| PB-01 strict 15m VWAP pre | ✅ Shipped (#61) | |

## P1 — Cost-adjusted evidence

| Item | Status | Notes |
|------|--------|-------|
| Data-quality degraded mode (event/breakout PBs) | ✅ Shipped | `playbook-data-quality.ts` blocks PB-03,05,09,13,14 on live gate |
| PB-02 flow materiality threshold | ✅ Shipped | `PLAYBOOK_FLOW_MATERIALITY_MIN` default 100k |
| Option execution simulator (spread/slippage) | ✅ Shipped | `execution_sim` on `option_ticket` at BUY open |
| Gate category split (operational/risk/validity/quality) | ✅ Shipped | `blocks_by_category` on `PlayGateResult` + API payload |
| PB-14 OR break memory | ✅ Shipped | `playbook-break-memory.ts` + platform_meta persistence |

## P2 — Production discipline

| Item | Status | Notes |
|------|--------|-------|
| Playbook-specific exit management | ⏳ Planned | Legacy engine exits still own open plays |
| Session risk governor | 🟡 Partial | `playSessionMaxEntries` / `playSessionMaxLosses` exist |
| Evidence-aware primary ranking | ✅ Shipped | `playbook-primary-score.ts` + `playbook-primary-rank.ts` — composite factors; static order tie-break only |
| `setup_family` on registry | ✅ Shipped | Four families + `family_audit` on pipeline |
| State machine invalidation | ✅ Shipped | `resolvePlaybookLifecycleState` |
| Severe data quality fail-closed | ✅ Shipped | `liveDataQualityMode` in gate A17 |

## P3 — Catalog hygiene

| Item | Status | Notes |
|------|--------|-------|
| Typed registry → doc matrices | ⏳ Planned | Prevent E2E/registry drift |
| PB-14 live allowlist expansion | ⏳ Blocked | Memory shipped; still shadow-only until evidence tiers |
| Expand beyond 14 playbooks | ❌ Frozen | Per decision log |

---

## Validation

```bash
npm test -- --test-name-pattern 'playbook'
npx tsc --noEmit
npm run validate:staging-playbook   # after ECS deploy
```

---

## Promotion tiers (unchanged)

See `PLAYBOOK-EXTERNAL-REVIEW-2026-07-10.md` §1 — research ≥30 triggers / staging ≥50–75 prospective trades before limited-live prod.
