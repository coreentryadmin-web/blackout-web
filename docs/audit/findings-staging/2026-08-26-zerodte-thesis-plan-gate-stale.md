> **kind:** FINDING

## 2026-08-26 — Thesis-first live path left stale `plan_no_quote` on every setup — FIXED

| **Status** | FIXED in PR (cursor/zerodte-desk-evidence-fallback-3d11) |
|---|---|

**Symptom:** RTH board showed 27 live setups with valid bid/ask/mark plans but `gate.verdict=BLOCKED` with `plan_no_quote` on every name; 0 ledger commits all session.

**Root cause:** When `ZERODTE_THESIS_FIRST=1`, `scan.ts` intentionally defers `attachContractPlans` until after `attachGateVerdicts`. Gates ran with `plan=null`, so `planQualityGateBlocks(null)` stamped `plan_no_quote` on every setup. Plans were attached afterward for display but gate blocks were never refreshed.

**Fix:** `deferPlanQualityGates` on `evaluateZeroDteGates` + `refreshPlanQualityGateBlocks()` after thesis-first plan attach.

**Evidence:** Live prod 2026-08-26 ~10:15 ET — 27/27 setups had quotes but `plan_no_quote`; META A-tier blocked solely by stale plan gate.
