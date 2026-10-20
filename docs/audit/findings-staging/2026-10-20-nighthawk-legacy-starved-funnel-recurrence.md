## Night Hawk Legacy's starved-dossier-funnel incident (2026-10-18/19, `candidates=20 ranked=0`) recurred on a FRESH build the very next night — escalated to the Night Hawk lane, not yet remediated

> **kind:** `FINDING`

| Field | Value |
| --- | --- |
| **Status** | Escalated to Night Hawk lane (`session_01Urd7n4TkQUjnsmhb3PPq9U`) via scheduled trigger — not yet remediated as of this entry |
| **Severity** | P1 (standing 5-engine monitor + coordinator-cycle finding) |
| **Surface** | `src/features/nighthawk/lib/edition-builder.ts` stage_dossiers, `GET /api/market/nighthawk/edition` |

### Symptom (re-confirmed live, 2026-10-20 ~17:35 UTC)

`scripts/audit/legacy-e2e-healthcheck.mjs` Stage A reports **RED**:
```
A EDITION  RED  published edition with zero plays, but funnel shows 20 candidate(s) and 0 ranked — starved funnel, not a quiet market
```
Live `GET /api/market/nighthawk/edition` confirms a **FRESH** build, not the previously-stuck one:
```json
{
  "edition_for": "2026-10-20",
  "published_at": "2026-10-19T21:41:46.000Z",
  "recap_only": true,
  "recap_only_reason": "No scored dossiers after staging (20 candidate(s)).",
  "funnel": {"candidates": 20, "ranked": 0, "dossiers": 0, "synthesized": 0, "critic_passed": 0, "published": 0},
  "no_plays": true
}
```

### Why this is a NEW entry, not a duplicate of the 2026-10-18 finding

The prior documented incident (`FINDINGS.md`, "2026-10-18/19 — starved funnel") was a **stuck** edition:
`edition_for: "2026-10-19"`, `published_at: "2026-10-16T21:42:41Z"` — one bad build from Friday night
that was never remediated and kept being served stale for days. **This is a different build**:
`edition_for: "2026-10-20"`, `published_at: "2026-10-19T21:41:46Z"` — last night's (Monday→Tuesday)
build, freshly run, and it **starved in exactly the same shape** (`candidates: 20, ranked: 0,
dossiers: 0`). Two consecutive nightly builds producing the identical zero-dossier signature argues
the 2026-10-17 root-cause diagnosis ("a transient UW flow-alerts rate-limiter congestion window,
confirmed via CloudWatch at the time, not a UW outage or a code regression") may not fully explain a
now-*recurring* pattern — or the same transient condition is itself recurring nightly, which would
also be worth knowing. Neither has been re-confirmed for last night's specific build (this session has
no CloudWatch access — AWS creds are placeholder this session, confirmed via `sts get-caller-identity`
→ `InvalidClientTokenId`).

### Root cause (as traced in source, `edition-builder.ts` lines ~899-946)

`stage_dossiers` fetches a dossier (incl. `scored`) for every discovered candidate
(`fetchAllDossiers`). `scoredList = Object.values(dossiers).filter(d => d.scored != null)` — when
**every single one** of the 20 candidates comes back with `d.scored == null` (dossier fetch/scoring
failed for 100% of candidates, not a partial degradation), `scoredList.length === 0`, and the builder
takes the `if (!scoredList.length)` branch: logs a warning, fires `alertRecapOnlyIfAnomalous` (a
Discord ops alert via `notifyOpsDiscord` — **this already fires automatically**, so ops was very
likely notified via `#🌩️website-logs` at build time, both last night and two nights before), and
publishes a `recap_only` edition rather than failing dark. The fallback-to-recap behavior itself is
working as designed (publish *something* rather than nothing); the open question is why dossier
scoring fails for ALL candidates, two nights running, rather than a partial degradation.

### Why this session did not execute remediation or deep-dive CloudWatch itself

Same reasoning the 2026-10-17/18 investigation already gave, still applicable: the documented
remediation (`POST /api/admin/nighthawk/run?asOfEt=<date>&persist=1`) is a live-production admin
write outside the normal read-only audit/PR pipeline, not something to route around from an
audit-sweep context without explicit authorization. CloudWatch access (to confirm whether last
night's failure was UW-rate-limiter congestion again, or something else) requires AWS credentials
this sandbox does not have this session.

### Action taken this cycle

Escalated directly to the Night Hawk lane's permanent-lane session (`session_01Urd7n4TkQUjnsmhb3PPq9U`)
via `create_trigger`/`fire_trigger` with this exact evidence, asking it to: (1) confirm via CloudWatch
whether last night's build hit the same UW rate-limiter congestion signature as 2026-10-16, or a
different cause; (2) decide whether the admin remediation POST should be run for `2026-10-19` (today's
session date); (3) consider whether two consecutive starved nights argues for a retry/backoff inside
`stage_dossiers` itself (e.g., one bounded retry on a 100%-failure dossier batch before falling to
recap-only) rather than relying on a human to notice and re-run — that would be a genuine code fix,
scoped and tested like any other, if the lane confirms it's the right shape.

### Blast radius

Member-facing: tonight's "Evening Playbook" Legacy digest board is empty (recap-only, zero plays) for
the second night running, despite a non-trivial discovered candidate pool both nights.
