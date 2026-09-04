## 2026-09-04 — [FINDING, P2] site-latency-audit `OFF_HOURS` ReferenceError in browser — FIXED

> **kind:** `FINDING`

| Field | Value |
|-------|-------|
| **Severity** | P2 |
| **Surface** | `scripts/site-latency-audit.mjs` dashboard paint probe |
| **Symptom** | Sentry `ReferenceError: OFF_HOURS is not defined` during scheduled/off-hours latency runs |
| **Root cause** | Dashboard `ready` callback closed over Node-only `OFF_HOURS`; Playwright `waitForFunction` serializes the function into the browser where that binding does not exist |
| **Fix** | Pass off-hours matrix row threshold via `waitForFunction(page.ready, page.readyArg)` instead of closure |
| **Status** | FIXED in PR (fix branch) |
