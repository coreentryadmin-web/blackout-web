## 2026-10-18 — [FINDING, P0, time-critical] Night Hawk Legacy's Monday 2026-10-19 digest is still `recap_only` with zero plays — known, safe remediation from 2026-10-17 was never executed

> **kind:** `FINDING`

| Field | Value |
| --- | --- |
| **Status** | NEEDS OPERATOR/AUTHORIZED-ADMIN ACTION — blocked here by the sandbox's auto-mode permission classifier (`Modify Shared Resources`), not by missing information |
| **Severity** | P0 |
| **Surface** | Night Hawk Legacy next-day digest board (`GET /api/market/nighthawk/edition`) |

### Symptom (re-confirmed live 2026-10-18 23:09 UTC, ~10.5h before Monday 2026-10-19 09:30am ET open)

```
GET /api/market/nighthawk/edition
{
  "available": true,
  "edition_for": "2026-10-19",
  "published_at": "2026-10-16T21:42:41.000Z",
  "plays": [],
  "recap_only": true,
  "recap_only_reason": "No scored dossiers after staging (20 candidate(s)).",
  "funnel": {"candidates": 20, "ranked": 0, "dossiers": 0, "synthesized": 0, "critic_passed": 0, "published": 0},
  "no_plays": true
}
```

20 real discovered candidates (CRGY, AI, SNDQ, TRV, OVV, RPGL, KMI, FANG, PR, EOG, TRGP, EQT, USO,
LNG, ALL, NOC, COP, RTX, APA, EXE), **zero** scored dossiers. Members will see an empty Monday
board despite a healthy candidate pool.

### Root cause (NOT new — already diagnosed 2026-10-17)

Already root-caused and documented in `docs/audit/MARKET-OPEN-VALIDATION.md` (PR #6124, merged
2026-10-17T15:04:44Z, docs-only): a transient UW flow-alerts rate-limiter congestion window during
Friday 2026-10-16's 21:30-21:42 UTC build (45000ms wall timeouts, 12-17s queue waits — confirmed via
CloudWatch at the time, NOT a UW outage or a code regression). The build silently degraded to
`recap_only` rather than failing loudly.

**The safe, idempotent remediation was identified and documented at the time but never executed:**

```
POST /api/admin/nighthawk/run?asOfEt=2026-10-16&persist=1
```

The 2026-10-17 investigation explicitly declined to execute this itself (a live-production admin
write, outside the normal PR pipeline) and flagged it for an authorized session to act on. **Nobody
has executed it in the ~30 hours since.** This cycle's 5-engine health-check sweep independently
re-confirmed the board is still broken, live, right now.

### Why the standing healthcheck script didn't catch this (separate P2, being fixed in parallel)

`scripts/audit/legacy-e2e-healthcheck.mjs`'s Stage A (EDITION) verdict never reads
`funnel.candidates`/`funnel.ranked` — an honest-looking `recap_only`/`no_plays` edition scores
identically whether it's a genuinely quiet market or 20 starved candidates. This is why the Night
Hawk Legacy lane's own last status read "healthcheck GREEN... monitoring" without catching the live
incident. A fix for this tooling gap is included in this cycle's fix-PR batch
(`scripts/audit/legacy-e2e-healthcheck.mjs`, `scripts/audit/lib/legacy-healthcheck-eval.mjs`).

### Why this session didn't execute the remediation itself

Attempted to escalate this directly to the Night Hawk Legacy owner lane (the system's designated
owner, with admin-session context) via a scheduled wake — **blocked by this sandbox's own auto-mode
permission classifier** (`Modify Shared Resources`). Did not attempt to call the admin endpoint
directly from this session either, for the same reason the 2026-10-17 investigation gave: this is a
live-production admin write outside the normal read-only audit/PR pipeline, and an explicit
permission denial on the adjacent action (asking another session to do it) is a strong signal this
needs a human or an explicitly-authorized path, not a route-around.

### Action needed

Someone with standing authorization to call production admin endpoints (the operator, or a session
with that permission) should run:

```
POST /api/admin/nighthawk/run?asOfEt=2026-10-16&persist=1
```

then verify `GET /api/market/nighthawk/edition` for `edition_for:"2026-10-19"` shows real,
non-empty `plays[]` and `recap_only:false` before Monday's open, and log the outcome in
`docs/audit/MARKET-OPEN-VALIDATION.md` per the standing runbook pattern.
