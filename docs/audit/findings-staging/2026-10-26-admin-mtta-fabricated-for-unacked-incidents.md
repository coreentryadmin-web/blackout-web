> **kind:** `FINDING`

## Admin Operations dashboard's "Avg MTTA" / per-incident MTTA badge fabricated an ack latency for incidents that were never acknowledged — FIXED

| | |
|---|---|
| **Area** | `/admin` Operations Center — `src/lib/admin-incidents.ts` (`listOpenAdminIncidents`), consumed by `AdminOperationsDashboard.tsx`'s "Avg MTTA" KPI tile and per-incident "MTTA" badge. |
| **Severity** | P3 — admin-facing operational metric, not member-facing, but genuinely misleading to whoever is actually operating the platform. |
| **Status** | FIXED (PR #6783, open). |
| **Found by** | DISCOVERY-lane live-UI sweep of `/admin` (desktop viewport, temp admin Clerk session, via `proxy-browser.cjs`). |

### Root cause

`listOpenAdminIncidents()` computed `mtta_ms` as:

```ts
mtta_ms: ackedMs != null ? ackedMs - openedMs : row.status === "open" ? now - openedMs : null,
```

For a still-open, never-acknowledged incident, this silently backfilled "mean time to
acknowledge" with "how long this incident has been open" — a completely different quantity.
Both dashboard consumers treat `mtta_ms` as a genuine measured ack latency: the aggregate
"Avg MTTA" KPI averages it across ALL incidents whose `mtta_ms != null` (acked or not), and the
per-incident row renders a "MTTA {duration}" badge whenever `mtta_ms != null`.

### Live repro (prod, 2026-10-26)

The `/admin` Operations Center showed exactly one open incident ("polygon upstream errors
elevated", category `PROVIDER-HEALTH`, opened 117 days ago) alongside `ACKNOWLEDGED: 0`. The
same dashboard simultaneously displayed:

- The incident's own row: `opened 117d ago` · `MTTA 2821h`
- The aggregate KPI tile: `AVG MTTA  2821h`

2821 hours ≈ 117.5 days — the incident's raw age, not an acknowledgment latency, because it has
never been acknowledged. An admin reading "Avg MTTA: 2821h" would reasonably but wrongly
conclude incidents typically take ~117 days to acknowledge, when in fact zero incidents have
ever been acknowledged on this system.

### Confirming evidence this was unintentional, not a deliberate "live age" design

- `src/lib/admin-spx-terminal.ts`'s `buildSpxTerminalFeed` — a **different** consumer of the
  same `AdminIncidentRow.mtta_ms` field — already has fallback logic treating `mtta_ms == null`
  as `"open {age}s"` vs. a non-null value as `"MTTA {duration}"`. That consumer was already
  written assuming null-until-acked semantics.
- `src/lib/admin-incidents.test.ts`'s own `incident()` test-fixture helper already defaults
  `mtta_ms: null` for a `status: "open"` row, before this fix touched that file.

Only the real, DB-backed `listOpenAdminIncidents()` violated the contract every other piece of
code in the repo already assumed.

### Fix

Extracted the computation into a pure, exported `computeMttaMs(ackedMs, openedMs)` helper in
`src/lib/admin-incidents.ts` — mirroring the file's own existing `computeIncidentsToResolve`
pattern, split out specifically so it is unit-testable without a live Postgres connection — and
narrowed it to `ackedMs != null ? ackedMs - openedMs : null`: strictly a real ack latency, never
incident age. The per-row `opened {time ago}` text (already rendered separately) continues to
cover "how long has this been open," so no UI information is lost; only the honest null-fallback
(already implemented independently in `admin-spx-terminal.ts`) now also applies in the main
dashboard.

### Blast radius

`listOpenAdminIncidents()` is the sole producer of `mtta_ms` (one query, one `.map()`). Two
consumers: `AdminOperationsDashboard.tsx` (the per-row badge, gated on `mtta_ms != null` — now
correctly hidden for unacked incidents; the aggregate `avgMtta` KPI, already filtering
`mtta_ms != null`, now only averages genuine acks) and `admin-spx-terminal.ts` (already correct,
unaffected). No schema change, no other call sites (confirmed via `grep -rn "mtta_ms" src`).

### Tests

Added 3 new unit tests for `computeMttaMs` in `admin-incidents.test.ts`: a genuine acked
latency, the exact regression case (a still-open incident opened 117 days ago must report
`null`, never its raw age), and a zero-elapsed edge case (a real `0`, distinguished from
`null`). RED→GREEN confirmed via `git stash` on the lib-only change (3/9 tests in this file fail
pre-fix with `computeMttaMs is not a function`, 9/9 pass post-fix). `npx tsc --noEmit` clean.
Full suite: 16989 pass / 0 fail / 3 pre-existing skips (unrelated).
