## Night Hawk Swings: "Earnings peer lens" gave live position-management advice on a CLOSED play with none of the sibling sections' CLOSED-bucket disclosure — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P3 — member-facing current-vs-as-traded ambiguity on a CLOSED swing play-brief |
| **Found** | 2026-10-24, Ask Largo standing mandate, weekend-backlog verification pass |
| **Fixed in** | `src/lib/swing/play-brief-intel.ts` |

### Root cause

Every "live read" market-context section in `play-brief-intel.ts` that renders the CURRENT state
of something (not what a now-closed trade actually traded under) unshifts a disclosure line when
the brief's bucket is CLOSED:

- `chartTechnicalsSection`/`chartLevelsSection` → `"_Current levels — not what this trade traded under._"`
- `gexPostureSection` → `"_Current dealer posture — not what this trade traded under._"`
- `flowIntelSection` → `"_Current flow — not what this trade traded under._"`
- `wallDynamicsSection` → `"_Current wall activity — not what this trade traded under._"`
- `catalystsSection` → `"_Current catalysts — not what this trade traded under._"` (fixed 2026-10-21, PR #6493)

`meridianPeerSection`/`meridianPeerEarningsCoaching` (the "Earnings peer lens" section —
implied move, days-to-print, sector beat-rate context, and this ticker's own print history) reads
from the exact same kind of READ-TIME-current data (`ctx.meridian`/`ctx.meridianPeer`, fetched
fresh at read time regardless of bucket) and, worse, ends on an explicit live
position-management instruction — "Peers that beat often gap through implied — size down or
hedge vol unless thesis is the print" — but never carried the matching disclosure. It was the one
sibling this earlier sweep missed.

`meridianPeerEarningsCoaching` (`play-brief-meridian-peer-core.ts`) takes no play/bucket parameter
at all — it is a pure, play-unaware formatter — so the gap could only be closed at its caller,
`meridianPeerSection(ctx)`, the same assembly layer `catalystsSection` already does its own
disclosure-prepending at.

### Live repro

`GET /api/market/swing/play-brief?playId=SWING:GOOGL:58&ticker=GOOGL&expandIntel=1` — position is
CLOSED/STOPPED, exited 2026-10-16 10:01 ET (-35.9%), checked 8 days later with GOOGL earnings 4
days out:

```
=== Earnings peer lens ===
**Earnings peer lens** — implied move ... reports in **4d** ... Peers that beat often gap through
implied — size down or hedge vol unless thesis is the print.
```

Every other market-context section in the SAME brief (Chart technicals, Levels on chart, GEX
posture, Vector desk, Catalysts & news) correctly prepended the "_Current ... — not what this
trade traded under._" caveat. "Earnings peer lens" was the one section with no such disclosure,
telling a member to "size down or hedge vol" on a position that had already been closed for over
a week.

### Fix

`meridianPeerSection` now prepends `"_Current earnings peer lens — not what this trade traded
under._\n\n"` to the body when `statusBucket(ctx.play) === "closed"`, matching the exact pattern
(and exact `ctx.play` / `statusBucket` check) every sibling section already uses.
`meridianPeerEarningsCoaching` itself is left untouched/pure — `ctx` is already a required,
non-nullable parameter on `meridianPeerSection` (unlike `catalystsSection`'s optional `ctx`), so no
extra null-guard is needed.

### Evidence

- RED: extended `play-brief-intel.test.ts` with a new test (`meridianPeerSection: CLOSED bucket
  prefixes a current-not-as-traded disclosure`) asserting the CLOSED-bucket disclosure appears
  (and an OPEN-bucket sibling case asserting it does NOT) — failed before the fix with the actual
  live-shaped body (`'**Earnings peer lens** — implied move **6.5%** · reports in **4d** · ...
  Peers that beat often gap through implied — size down or hedge vol unless thesis is the print.'`
  and no disclosure line), proven via a real RED→GREEN stash/restore cycle (`git apply -R`/`git
  apply` on just the source-file hunk, test file left in place).
- GREEN: same test passes after the fix; full `play-brief-intel.test.ts` (321 tests) passes, 0
  failures.
- `npx tsc --noEmit` clean (Node 20.20.2).

### Blast radius

Scoped entirely to `meridianPeerSection`'s own CLOSED-bucket output. `meridianPeerSection` has
exactly one production call site (`buildIntelSections` in the same file); `meridianPeerEarningsCoaching`
is unchanged, so its own direct test coverage in `play-brief-intel.test.ts`/`play-brief-absence.test.ts`/
`play-brief-meridian-peer.test.ts` is unaffected.
