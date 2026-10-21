> **kind:** FINDING

## Night Hawk Swings: `catalystsSection` was the one "live read" section that never disclosed a CLOSED-bucket read as current, not as-traded — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P3 — member-facing time/identity ambiguity on a CLOSED swing play-brief |
| **Found** | 2026-10-21, 5-engine live-monitor cycle, Ask Largo standing mandate, full-narrative review of a live CLOSED swing play-brief |
| **Fixed in** | `src/lib/swing/play-brief-intel.ts` |

### Root cause

Every "live read" section in `play-brief-intel.ts` that renders the CURRENT state of something
(not what a now-closed trade actually traded under) unshifts a disclosure line when the brief's
bucket is CLOSED:

- `chartLevelsSection` → `"_Current levels — not what this trade traded under._"`
- `gexPostureSection` → `"_Current dealer posture — not what this trade traded under._"`
- `flowIntelSection` → `"_Current flow — not what this trade traded under._"`
- `wallDynamicsSection` → `"_Current wall activity — not what this trade traded under._"`

`catalystsSection` ("Catalysts & news" — earnings date, headlines, short interest, peers) renders
the exact same kind of READ-TIME-current data (`eco.arsenal`, fetched fresh at read time
regardless of bucket) but never carried the matching disclosure — the one sibling section this
pattern missed.

### Live repro

A CLOSED `SWING:TSLA:57` play-brief (position exited 2026-10-16, re-checked live 2026-10-21 — 5
days later):

```
=== Catalysts & news ===
Earnings: **2026-10-21** **today** (afterhours)
...
```

Every sibling section on the SAME brief correctly prefixed its current-state disclosure
(`"_Current levels — not what this trade traded under._"`, etc.), but this one read as plain,
unqualified fact — a member could easily misread "Earnings: today" as context relevant to why
the trade closed 5 days earlier, when it is actually today's unrelated earnings calendar.

### Fix

`catalystsSection` now unshifts `"_Current catalysts — not what this trade traded under._"` when
`statusBucket(ctx.play) === "closed"`, mirroring the exact pattern (and exact `ctx.play` /
`statusBucket` check) every sibling section already uses. `ctx` is optional/nullable on this
function (unlike the sibling functions, which take a bare `play`), so the check is written as
`ctx?.play && statusBucket(ctx.play) === "closed"` to stay a no-op for the pre-existing callers
that don't pass a full context.

### Evidence

- RED: extended `play-brief-intel.test.ts` with a new test asserting the CLOSED-bucket disclosure
  appears (and an OPEN-bucket sibling case asserting it does NOT) — failed before the fix
  (`'Earnings: **2026-10-21** **today** (afterhours)'` with no disclosure line).
- GREEN: same test passes after the fix; full `play-brief-intel.test.ts` (318 tests) passes.
- `npx tsc --noEmit -p .` clean.

### Blast radius

Scoped entirely to `catalystsSection`'s own CLOSED-bucket output — no other section reads from
this function, and the `ctx?.play` guard means every existing bare-`ctx` test/caller (pre-existing
coverage for earnings landed/pending framing, headline dedup, staleness disclosures) is unaffected.
