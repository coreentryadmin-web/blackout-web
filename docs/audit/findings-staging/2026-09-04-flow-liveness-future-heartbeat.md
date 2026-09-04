## 2026-09-04 — [FINDING, P2 correctness] Flow cluster liveness treated future heartbeats as fresh — FIXED

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **Priority** | P2 correctness / observability |
| **Surface** | `src/lib/flow-liveness.ts` |
| **Status** | FIXED |

### Root cause

`isFlowFrameFreshFromCluster`, `isFlowFrameFreshAnywhere`, and `peekFlowLivenessHeartbeat`'s `fresh` flag used raw `Date.now() - record.at <= maxAgeMs`. A future-dated Redis heartbeat (clock skew) produced negative age that always satisfied the bound, so flow-ingest REST-skip and admin HELIX health could read the cluster tape as fresh when it should not be trusted.

`peekFlowLivenessHeartbeat` already clamped `age_sec` for display but left `fresh` on the raw comparison.

### Fix

Reject negative age for freshness booleans; keep display `age_sec` clamped at zero.

### Regression guard

`src/lib/flow-liveness.test.ts` — future heartbeat not fresh; recent past fresh; self-skip unchanged.

### Market-open validation

During RTH, admin HELIX health / flow-ingest skip should not show cluster flow fresh solely from a future-dated heartbeat (no member-visible UI change expected under normal clocks).
