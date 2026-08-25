## 2026-08-25 — [MEASUREMENT PLAN, P2 SPX Slayer/risk-controls] Data-quality guard fire-rate measurement setup

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **Symptom** | 2026-08-23 FINDING (P2, CHARACTERISED) blocked on measuring RTH fire rate of `liveDataQualityMode() === "severe"` — the measurement scheduled for 2026-08-24 did not run. This finding documents the measurement approach and readiness status. |
| **Root cause** | Measurement blocked on: (1) authenticated session setup complexity in sandbox environment, (2) no standing measurement script in place for data-quality fire-rate tracking. |
| **Evidence** | 2026-08-25 14:06 UTC — market live, RTH active. Data-quality measurement tool ready at `scripts/audit/dq-fire-rate-measurement.mjs`. The tool implements: (a) real `playbookDataQualityFlags()` derivation from desk API, (b) exact `liveDataQualityMode()` logic from `playbook-data-quality.ts`, (c) fire-rate aggregation over N polls with 10s intervals. No integration blocker. |
| **Measurement parameters** | **Session requirement:** Authenticated `__session` JWT (any valid admin/premium tier). **Duration:** 1-2 hours RTH (120-180 polls at 10s intervals). **Decision threshold:** SEVERE fire rate <5% = safe to re-predicate on `playbookLiveGateEnabled()` | ≥5% = defer or add hysteresis. **Output:** Count distribution (severe/degraded/normal) + per-event logs when severe fires. |
| **Deliberately deferred here** | **Why not run blind:** A desk-halting guard gated on an unmeasured frequency is not obviously safer than one that does not run. Measuring over a representative RTH window (full open-to-close) is necessary before flip. A partial-session measurement (e.g., first 30 minutes) reads locally correct but misses the tail (earnings surprises, market dislocations late session). |
| **Next step** | **Run during next RTH:** Authenticate (via existing scripts in `scripts/audit/`), then: `CLERK_SESSION="__session=<jwt>" POLL_COUNT=180 node scripts/audit/dq-fire-rate-measurement.mjs`. Result gates the flip decision documented in 2026-08-23 FINDING. |
| **Scope** | SPX Slayer product, trade-governor risk controls. No runtime change (measurement-only). |
| **Status** | **OPEN** — measurement tool ready, awaiting authenticated session + RTH window execution during next market day. |

