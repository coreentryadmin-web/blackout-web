## 2026-11-01 — [FINDING, P2 CI] `verify` flake — polygon-largo cancellation test missed TCP connect under full suite — FIXED

> **kind:** `FINDING`

| Field | Detail |
| --- | --- |
| **Symptom** | `verify` on `7f5519c17`: `fetchPolygonTickerDetails: aborting the caller's signal…` failed — socket never arrived in 2s (`fetch failed`), while isolated file run passed. |
| **Root cause** | Full-suite parallel load + shared Polygon circuit/failover module state could route the request away from the local mock server or delay admission long enough for the 2s connect wait to expire. |
| **Fix** | Reset breaker + largo failover before each case; raise connect wait to 8s; export `resetPolygonLargoFailoverForTest()`. |
| **Status** | FIXED — branch `fix/polygon-largo-cancellation-ci-flake`. |
