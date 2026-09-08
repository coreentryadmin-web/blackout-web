> **kind:** `FINDING`

## Swing cross-session persistence floor loosened for 5 "standard" archetypes — FIXED

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Area** | Swing WATCH-promotion persistence gate (`src/lib/swing/taxonomy.ts` `ARCHETYPE_PERSISTENCE`, `accumulation-store.ts` `meetsPersistence`) |
| **PR** | (pending — `fix/swing-persistence-loosen-standard-archetypes`) |

### Symptom

Operator-reported, live investigation this session: several high-scoring TRIGGERED+AT_TRIGGER
swing setups (HOOD score 83.6, EWY 84.9, AMD 75.9, XME 69.7, CCJ 67.3) sat blocked from COMMIT all
day, routed to RESEARCH purely by `sectionForSwingPlay`'s cross-session persistence check (a
candidate must be seen on 2 distinct session days before promotion is even considered for
BREAKOUT/PULLBACK_CONTINUATION/MEAN_REVERSION/FLOW_ACCUMULATION/SECTOR_ROTATION). The gate was
already documented in `accumulation-store.ts` as "Provisional — never a graduated edge, just the
persistence floor" — i.e. never empirically validated.

### Evidence

`scripts/audit/swing-persistence-recall.mjs` (built and run earlier this session, see
`docs/audit/INTENTIONAL-DESIGN.md` item #7) split 232 real `swing_candidate_accumulation` rows
(90-day window — effectively the whole life of the feature, which only started 2026-06-10) into
CLEARED (persistence-passed or promoted) vs BLOCKED (persistence-failed) cohorts using the gate's
own predicate, and graded both on real Polygon daily bars at +1/+3/+5 trading days:

| Horizon | CLEARED WR (n) | BLOCKED WR (n) |
|---|---|---|
| +1d | 45.5% (143) | **58.8%** (34) |
| +3d | 52.6% (133) | 50.0% (20) |
| +5d | 55.3% (114) | 43.8% (16) |

CLEARED did not clearly outperform BLOCKED at any horizon — if anything BLOCKED led at the
largest-sample horizon. A by-archetype breakdown also found >50% of all accumulation rows carry no
archetype at all (an honest `classifyArchetype` "null-when-thin" result, not a bug), so the
looser 1-session rule already given to EVENT_DRIVEN/POST_EARNINGS_DRIFT rarely applied in practice
— most real candidates hit the flat 2-session default regardless of what kind of setup they were.

### Fix

`ARCHETYPE_PERSISTENCE` in `taxonomy.ts`: the 5 "standard" (previously cross-session-only)
archetypes now use `minDistinctSessions: 1, requiresCorroboration: true` — the same rule already
shipped for EVENT_DRIVEN/POST_EARNINGS_DRIFT — instead of `minDistinctSessions: 2,
requiresCorroboration: false`. This does **not** remove the quality bar:
`meetsPersistence`'s anti-lone-print invariant still requires ≥2 independent signal KINDS in the
same session (never a single raw print promotes); it just stops requiring that confirmation arrive
on a second calendar day when same-day corroboration already exists. `FAILED_BREAKDOWN` (1 session,
no corroboration) and the `DEFAULT_PERSISTENCE_RULE` for unclassified candidates (2 sessions, no
corroboration) are both unchanged.

### Blast radius

- `accumulation-store.ts`'s `fetchWatchEligible` DB pre-fetch floor (`MIN_EVENT_PERSISTENCE_SESSIONS
  = 1`) already always pre-fetches at floor 1 regardless of per-archetype rules — no change needed
  there, `meetsPersistence` per-row remains the real authority.
- `scripts/audit/swing-persistence-recall.mjs`'s own mirrored copy of `ARCHETYPE_PERSISTENCE`
  updated in lockstep (its own header comment requires this) so future re-runs measure the current
  live rule, not a stale one.
- Two `discovery.test.ts` scenarios that asserted the OLD 2-session gate for cross-session
  archetypes (`makeDeps`'s default multi-signal-kind wiring — FLOW+POSITIONING+CATALYST+VECTOR —
  satisfies corroboration on session 1) now correctly assert the loosened fast-track instead.
  `accumulation-store.test.ts`'s `persistenceGapReason` test updated similarly (a single-kind
  BREAKOUT sighting now reports a corroboration gap, not a session-count gap).

### Fix rationale

Not a blind removal of the gate — a targeted loosening to match the already-shipped, already-proven
treatment for event archetypes, motivated by a real 90-day measurement rather than the single live
anecdote that prompted the investigation. Left FAILED_BREAKDOWN and unclassified candidates
untouched since neither had measured evidence pointing either way. `npx tsc --noEmit` clean; full
suite green on Node 20 via `scripts/run-tests.mjs` (13320/13320 pass, 3 pre-existing skips).
