# UW Numeric Cross-Validation Log

Automated cross-validation of Unusual Whales–sourced numerics: our served values (Postgres `flow_alerts`, the HELIX tape source) vs the UW REST API live values. Divergence = stale / miscalculated / fabricated.

> Methodology note (2026-06-29): the SKILL's HTTP-only approach does not work as written and was corrected in-run:
> - Env key is `UW_API_KEY`, not `UNUSUAL_WHALES_API_KEY`.
> - The served flow endpoint is `/api/market/flows` (not `/api/flows`) and is auth-gated (401 unauth), so served values are read directly from the prod Postgres `flow_alerts` table via the Railway public proxy.
> - UW raw field names: `id` (not `alert_uuid`), `ticker` (not `ticker_symbol`), `total_premium`, `created_at`.
> - DB `alert_id` is stored with a `uw:` prefix — must be normalized before matching UW `id`, else every row falsely reads as "missing".
> - Ingest only persists `total_premium >= UW_FLOW_MIN_PREMIUM` (default **200,000**); the missing/dedup check must compare against the ≥threshold subset only, and exclude prints younger than the ~90s ingest cadence, or sub-threshold/bleeding-edge flows read as false data loss.

---

## 2026-06-29 17:44 ET
- Premium check (matched UW `id` ↔ DB `alert_id`): 14 matched | 0 mismatches → **PASS** (served premium == UW `total_premium` verbatim)
- Tape lag (newest UW `created_at` − newest DB `created_at`): 0.5 min → **PASS** (HELIX tape live; DB newest age 0.6 min)
- Missing from tape (UW ≥200k, settled >90s, not in DB): 0 → **PASS** (no over-dedup; earlier apparent "missing" were sub-200k by-design filtering)
- Verdict: **NO P0 / NO WARN.** All UW-sourced flow numerics match the live source.
- Surfaces validated: HELIX flow premiums, tape lag, dedup integrity. Not yet covered this run: SPX desk IV, Grid dark-pool/congress (SKILL provides no scripted check for these — flow-only).
---

## 2026-06-29 11:40 ET
- Premium check: 4 matched | 0 mismatches
- Tape lag: 0.8 min (DB newest age 0.9 min; RTH=True)
- Missing from tape (UW >=200000, settled): 0 of 3 eligible
- Verdict: **PASS**
---

## 2026-06-29 12:40 ET
- Premium check: 6 matched | 0 mismatches
- Tape lag: 0.2 min (DB newest age 0.2 min; RTH=True)
- Missing from tape (UW >=200000, settled): 0 of 5 eligible
- Verdict: **PASS**
---

## 2026-06-29 13:35 ET
- Premium check: 31 matched | 0 mismatches
- Tape lag: 1.6 min (DB newest age 22.9 min; RTH=False)
- Missing from tape (UW >=200000, settled): 0 of 34 eligible
- Verdict: **PASS**
---

## 2026-06-29 14:35 ET
- Premium check: 31 matched | 0 mismatches
- Tape lag: 1.6 min (DB newest age 83.6 min; RTH=False)
- Missing from tape (UW >=200000, settled): 0 of 34 eligible
- Verdict: **PASS**
---
