> **kind:** `FINDING`

## A recurring admin incident reopening from `resolved` kept its PREVIOUS occurrence's `acked_at`/`acked_by` — fabricating an MTTA for an incident nobody has acked this time — FIXED

| | |
|---|---|
| **Severity** | P3 (admin-only observability defect — no member-facing impact, but corrupts an operational metric the dashboard uses to judge response time) |
| **Surface** | `src/lib/admin-incidents.ts` — `syncAdminIncidents`'s upsert, shared by the `data-integrity` cron, the `provider-health-reconcile` cron, `spx-issues-sync`, and `AdminOperationsDashboard`/`admin-spx-dashboard.ts` (polled every 5s from the admin terminal) |
| **Status** | FIXED |

### Root cause

`syncAdminIncidents`'s batched INSERT...ON CONFLICT upsert reactivated a fingerprint (same
`category:title`) that had previously been resolved by resetting only `status` and `resolved_at`:

```sql
status = CASE WHEN admin_incidents.status = 'resolved' THEN 'open' ELSE admin_incidents.status END,
resolved_at = CASE WHEN admin_incidents.status = 'resolved' THEN NULL ELSE admin_incidents.resolved_at END
```

`acked_at`, `acked_by`, and `opened_at` were never touched by the upsert at all. So a recurring
issue — acked, then resolved, then fired again later (the normal shape of a recurring incident,
not a rare edge case) — came back with `status: 'open'` but a **non-null `acked_at`/`acked_by`**
carried straight over from its previous, unrelated occurrence, and an `opened_at` from whenever
the fingerprint was first ever created.

`computeMttaMs`'s own doc comment (and its own regression test, already in `admin-incidents.test.ts`
before this fix) states the invariant this breaks: *"Deliberately NEVER falls back to time elapsed
since open for a still-unacked incident — that would fabricate an ack latency for an incident
nobody has acked."* But `listOpenAdminIncidents` computes `mtta_ms` straight from whatever
`acked_at`/`opened_at` the row carries, with no awareness that the CURRENT occurrence was never
acked. `AdminOperationsDashboard.tsx`'s per-row "MTTA" badge is gated only on
`incident.mtta_ms != null` (never on `incident.status`), and the dashboard's aggregate "Avg MTTA"
KPI (`mttaAll = incidents.map(i => i.mtta_ms).filter(v => v != null)`) pools every incident's
`mtta_ms` unconditionally. So a reactivated-but-not-yet-acked-this-time incident would silently
render — and get averaged into the fleet-wide KPI as — a real-looking ack-latency number that
belongs entirely to the incident's last, unrelated occurrence, while the incident sits visibly
`status: open` with no ack action yet taken on it.

### Evidence

New tests:
- `src/lib/admin-incidents.test.ts` — 4 new unit tests on the extracted pure function
  `nextIncidentLifecycle`: brand-new fingerprint, still-open (untouched), still-acked (untouched,
  real ack preserved), and the regression case — a `resolved` prior row reactivating.
- `src/lib/admin-incidents-reactivation.test.ts` (new) — integration-style coverage of the real
  `syncAdminIncidents`, mocking `@/lib/db`'s `dbQuery`/`dbConfigured` to capture the exact upsert
  params. 5 cases, including one with 3 simultaneous issues (new / still-open / brand-new) in a
  single call to prove each row's lifecycle is computed independently.

RED→GREEN confirmed via `git stash` on `src/lib/admin-incidents.ts` alone (both test files kept):
- **Before the fix:** 9/18 tests in `admin-incidents.test.ts` fail (`nextIncidentLifecycle` does not
  exist yet) and all 5 tests in `admin-incidents-reactivation.test.ts` fail — the pre-fix upsert
  only ever threads 5 params per row (fingerprint/severity/category/title/detail), so it cannot
  produce the explicit-reset lifecycle fields the test asserts on at all. This is the structural
  signature of the bug: the pre-fix code never computes or passes an ack-reset decision in the
  first place — in real Postgres, the live CASE clause never reaching `acked_at`/`acked_by` means
  those columns are left exactly as they were.
- **After the fix:** all 18 + 5 = 23 tests pass.

### Blast radius

`syncAdminIncidents` is shared infrastructure called from 4 places: `src/app/api/cron/data-integrity/route.ts`,
`src/app/api/cron/provider-health-reconcile/route.ts`, `src/features/spx/lib/spx-issues-sync.ts`
(via the `spx-issues-sync` cron), and `src/lib/admin-spx-dashboard.ts` (the admin terminal's
5s-polled live path). All four get the fix with no call-site changes — the function's signature is
unchanged. `listOpenAdminIncidents`, `ackAdminIncident`, `resolveAdminIncident` needed no change;
the bug was entirely in what the upsert wrote on reactivation, not in how acks/resolves/reads work.

### Fix

Extracted the upsert's reactivation decision into a pure, unit-tested function
(`nextIncidentLifecycle`), matching this same file's existing `computeIncidentsToResolve` pattern
(split out specifically so branching logic is testable without a live Postgres connection — raw
Postgres is blocked from this sandbox per `CLAUDE.md`). `syncAdminIncidents` now does one extra
batched `SELECT` (keyed on the same fingerprints the upsert is about to touch) to read each active
fingerprint's current `status`/`acked_at`/`acked_by`/`opened_at`, computes the correct lifecycle
for each row in JS, and passes explicit values into the upsert (`status`, `opened_at`, `acked_at`,
`acked_by`, `resolved_at` all now real columns via `(VALUES ...)` + `ON CONFLICT DO UPDATE SET col
= EXCLUDED.col`, replacing the old SQL-side `CASE WHEN admin_incidents.status = 'resolved'`
expressions that only ever covered 2 of the 5 lifecycle columns that actually needed one). A
reactivated incident now gets a clean `opened_at: NOW()` too, consistent with it being a genuinely
new occurrence rather than a continuation of a resolved one from days/weeks earlier.

### Fix rationale

Considered leaving the single-query upsert and just widening the existing inline `CASE WHEN
admin_incidents.status = 'resolved'` expressions to also cover `acked_at`/`acked_by` (zero extra
round trips). Chose the prefetch-and-decide-in-JS approach instead because it is directly,
genuinely testable without a live Postgres connection — this sandbox cannot reach raw Postgres, and
an inline SQL `CASE` can only be proven correct by someone reading the SQL text, not by a test that
actually executes the decision. The extra `SELECT` is one more batched round trip (keyed on the
same fingerprint array the upsert already uses), not a per-row query, so it does not reintroduce
the N-round-trip contention problem this same upsert was batched to fix in the first place
(`EDGE-12`/the `#111-storm` comment already in the file). Deliberately left `ackAdminIncident`/
`resolveAdminIncident` untouched — they already correctly set exactly one lifecycle column each and
have no reactivation case to get wrong.

### Tests

`src/lib/admin-incidents.test.ts` (4 new cases on `nextIncidentLifecycle`, 14 existing untouched),
`src/lib/admin-incidents-reactivation.test.ts` (new, 5 cases). Also re-ran
`src/app/api/cron/spx-issues-sync/route.test.ts` and `src/lib/admin-spx-terminal.test.ts` (both
exercise code paths downstream of `syncAdminIncidents`/`admin-incidents.ts`) — unaffected, still
green. `npx tsc --noEmit` clean. `npx eslint` clean on all 3 changed/added files.
