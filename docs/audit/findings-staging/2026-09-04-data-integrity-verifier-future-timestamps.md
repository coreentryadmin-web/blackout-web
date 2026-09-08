# `data-integrity-verifier.ts`'s own `ageMin()` read a future-dated timestamp as trustworthy — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED |
| **Area** | `src/lib/correctness/data-integrity-verifier.ts` — the shared `ageMin()` helper, used by all 4 freshness checks in the file (Postgres `flow_alerts` latest-row age, Postgres `cron_job_runs` latest-run age, the Redis GEX matrix `asof` age, and the writer target-freshness reconciliation) |
| **Severity** | P3 — correctness of an audit surface, not a member-facing defect. No live occurrence confirmed (this is a structural gap, found by code sweep, not a CloudWatch incident) — but a real blind spot in the tool whose entire purpose is to catch data corruption |
| **Found by** | DISCOVERY 24/7 audit sweep, 2026-09-04, sweeping for the "future-dated data not rejected" bug shape named in the standing mandate (angle 2) |

## Root cause

`data-integrity-verifier.ts` is the "is the data LAYER healthy end-to-end?" surface of the
`data-correctness` cron — its own file header states the discipline explicitly: *"HONESTY: ...
Nothing here is a false green: a missing source SKIPS ..., never passes."* Every one of its
freshness checks (Postgres latest-row age, Redis GEX matrix `asof` age, and a writer's
target-freshness reconciliation that can SUPPRESS a `failed` cron handshake row as a "logging
artifact") funnels through one shared helper:

```ts
function ageMin(thenMs: number, now: number): number {
  return (now - thenMs) / 60_000;
}
```

This has no guard for `thenMs` being in the future. If the underlying timestamp is future-dated —
cross-process clock skew between the writer and this verifier, or a corrupted/miswritten row —
`now - thenMs` is negative, and every call site's `fresh = Number.isFinite(latestMs) && aMin <=
thresholdMinutes` check reads a negative number as trivially `<= threshold`, i.e. trivially FRESH.
Concretely:

- The Postgres `flow_alerts`/`cron_job_runs` freshness checks (lines ~167, ~232) would report
  `pass` for a table whose latest row carries a bogus future timestamp, instead of flagging it.
- The Redis GEX matrix freshness check (line ~398) would treat a corrupted future `asof` as a
  freshly-refreshed cache instead of flagging it as stuck/expired-but-mislabeled.
- The writer target-freshness reconciliation (`targetFreshDespiteFailedHandshake`, ~line 634, which
  had its OWN duplicated inline copy of the same unguarded calculation) would let a bogus future
  `published_at`/`updated_at` SUPPRESS a genuine `failed` cron handshake row as a logging artifact
  — the one call site here where the bug could actively hide a real writer outage rather than just
  mis-scoring one check.

This is the identical bug shape already fixed at 16+ other sites this session (`c0c875dbf` SPX
Slayer #3423, `1620aee8a` coaching alerts #3442, `ccdde698b` GEX heatmap cache #3481, `0a1d688e0`
GEX heatmap context editions #3573, `74c9b6729` Helix flow-anomaly banner #3559, and others) — a
naive `now - eventTimestamp` freshness check with no future-timestamp guard. It is a notable
instance of the pattern specifically because this file is not just ANOTHER consumer of a
timestamp — it is the tool built to independently verify that the platform's data is not corrupted
or stale, so being blind to exactly this corruption shape is a gap in the auditor itself, not just
in a display or a trading gate.

## Evidence

- `src/lib/correctness/data-integrity-verifier.test.ts` (new file — no test file existed for this
  module before this fix), RED before / GREEN after (`git stash push -- src/lib/correctness/data-integrity-verifier.ts`,
  keeping the new test file — the documented repo convention):
  - Pre-fix: all 6 new tests fail — `ageMin` was not exported at all pre-fix (`{ ageMin } = await
    import(...)` destructures `undefined`, so calling it throws), which is itself proof no test
    previously covered this helper's contract.
  - Post-fix: `node --import tsx --experimental-test-module-mocks --test src/lib/correctness/data-integrity-verifier.test.ts`
    → `tests 6 / pass 6 / fail 0`.
  - Tests cover: an ordinary past timestamp still returns its true positive age; a timestamp
    within the 60s future-clock-skew tolerance still returns a small (finite) negative age rather
    than flipping to Infinity (so legitimate clock skew doesn't cause a real false FLAG); a
    timestamp beyond the tolerance returns `Infinity`; `Infinity` fails every realistic freshness
    threshold used by this file's own checks (15m/20m/30m); and the exact tolerance boundary (at
    vs. just past `ZERODTE_MARK_FUTURE_TOLERANCE_MS`) is correctly discriminated.
- `npx tsc --noEmit` clean across the repo after the change.
- Full `src/lib/correctness/*.test.ts` suite (152 tests) + `marks-math.test.ts` +
  `admin-cron-health.test.ts` green on Node 20 after the change — no regression to any sibling
  verifier.

## Blast radius

All 4 `ageMin()` call sites in the file share the identical root cause and are fixed by the single
guard in the shared helper. The writer-freshness call site additionally had its own duplicated
inline reimplementation of the same unguarded formula, which was replaced with a call to the
now-guarded `ageMin()` — deduplicating the logic so all 4 sites behave identically rather than
fixing 3 of 4 and leaving a 4th, slightly different copy of the same bug behind.

## Fix rationale

Mirrors the exact convention already established for this bug shape elsewhere in the codebase:
`ZERODTE_MARK_FUTURE_TOLERANCE_MS` (60s, `src/lib/zerodte/marks-math.ts`) is the SAME constant
`spx-play-gates.ts`/`playbook-option-execution-contract.ts` already use for this identical guard,
reused here rather than inventing a second tolerance constant. `ageMin()` now returns `Infinity`
past that tolerance — deliberately the SAME sentinel this file already uses for a NaN/unparseable
timestamp (every `Number.isFinite(latestMs) ? ageMin(...) : Infinity` call site), so a
future-dated row and an unparseable one now degrade the same way: a FLAG, not a false PASS. This
was chosen over the SPX-fix's alternative convention (clamping to "just over threshold") because
`ageMin()` is a single shared helper feeding checks with THREE DIFFERENT thresholds (15/20/30
minutes) — `Infinity` fails all of them uniformly without needing a per-call-site clamp target.
Left unchanged: `ageMin()` still returns a genuine small negative value for a timestamp within the
60s tolerance (real, bounded clock skew), so it does not turn ordinary cross-process clock drift
into a new false FLAG — only a timestamp meaningfully in the future is treated as untrustworthy.
