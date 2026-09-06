## 2026-09-06 — [FINDING, P1 Night Hawk Swings / Ask Largo] Swing serving-snapshot TTL (26h) is shorter than the ordinary Friday-close → Monday-open gap, silently zeroing thesis-health enrichment every weekend — FIXED

> **kind:** `FINDING`

| Field | Value |
|-------|-------|
| **Status** | FIXED — `SWING_SERVING_TTL_SEC` raised 26h → 120h; regression test derives the worst-case ordinary weekly gap from `SWING_SCAN_PHASES` itself. |
| **Priority** | P1 — recurs every single week, silently degrades Ask Largo's + the main board's core "Thesis health" panel for every live committed swing position |
| **Area** | Night Hawk Swings / Ask Largo — `src/lib/swing/serving-lane.ts` |
| **Branch** | `fix/swing-serving-snapshot-weekend-ttl` |

## Context — where this was found

Standing Ask-Largo ownership mandate cycle (CLAUDE.md), live health-check + play-brief deep-dive
against production on 2026-09-06 (a Sunday). Session's own prior commits this cycle (#4182, merged
hours earlier) claimed to wire `attachThesisExplanation` into the Ask Largo swing play-brief path
specifically to fix `SWING-SYSTEM-CTO-AUDIT-2026-09-06.md` findings #8/#9 (thesis-health frozen at a
generic 46%/Degraded for every live position because factors/regime never reached it). Re-fetching
the exact same 4 live committed positions (NRG:34, NN:32, CG:25, CRWD:19) post-merge showed **zero
change** — all four still render byte-identical `46% · Degraded` with `Persistence — unknown`,
`Entry geometry — n/a`, `Signal stack — no signals`, `Regime fit — unread`, exactly as the
pre-fix audit captured. That is the finding below, not a report that #4182 is broken — the fix is
correct code, but its one trigger condition (a live persisted discovery snapshot) is absent right
now in production, and will be absent every week at this point in the cycle.

## Root cause

`attachThesisExplanation` (`serving-lane.ts`) is FAIL-CLOSED by design: no dossier for the ticker
this scan ⇒ leave the row untouched (correct — never invent an explanation). Both call sites —
`getSwingServingLane` (the main `/horizons?view=swings` board, pre-existing) and
`play-brief-resolve.ts`'s `loadOpenTerminalPlay` (Ask Largo, #4182) — get their dossier index from
`discoverSwingFromPersisted()`, which returns `null` outright whenever
`readSwingServingSnapshot()` (a single Redis key, `swing:serving:latest:v1`) comes back empty. A
`null` result means dossier lookup finds nothing for ANY ticker, so the enrichment silently no-ops
for every committed position at once — not just the one that rotated out of today's screen.

The snapshot's TTL (`SWING_SERVING_TTL_SEC`, was `26 * 60 * 60`) was sized, per its own comment, to
"outlive a full session day so the latest scan serves until the next scan refreshes it." That
reasoning holds Monday–Thursday (next weekday scan is <24h later) but not Friday: `swing-discovery`
is `weekdays_only` (`cron-registry.ts`), so the next scan after Friday is Monday, not Saturday.

**Live evidence, this cycle:**
- CloudWatch Logs Insights (`/ecs/blackout-production`, `filter @message like /swing-discovery/`,
  4-day window) shows the last write of the week at **2026-09-04 20:35:00 UTC** (Friday POST_CLOSE:
  `commit gate: 0 graduated-eligible / 0 opened / 1 shadow-eligible / 1 shadowed`) — no OVERNIGHT
  entry after it, and nothing again until the next weekday.
- 26h later = **2026-09-05 22:35 UTC (Saturday evening)** — the snapshot expires and stays gone.
- Confirmed live via `GET /api/market/nighthawk/horizons?view=swings` on 2026-09-06 ~10:03 UTC
  (Sunday): `board.lanes.SWING.scanAsOf: null`, `scanSessionDay: null` — `readSwingServingSnapshot()`
  is returning nothing, exactly as predicted.
- Confirmed via `GET /api/market/swing/play-brief?playId=SWING:<T>:<id>` for all 4 live positions
  (NRG:34, NN:32, CG:25, CRWD:19): every "Thesis health" section reads `46% · Degraded` with the
  identical generic pillar labels — the #4182 enrichment is a live no-op right now.
- `docs/audit/findings-staging/2026-09-04-largo-swing-horizon-missing-freshness.md` (a different,
  already-shipped fix) independently corroborates that "hours or days stale" was already an
  acknowledged possibility for this exact 26h constant — it solved *visibility* of staleness for the
  Largo chat tool (`swingHorizonForLargo`); this fix addresses the *frequency/duration* of the
  underlying outage for the deterministic play-brief and board paths, which carry no such caveat and
  still assert `confidence.level: "high"` while silently degraded (CTO-AUDIT finding #20).
- `admin-cron-health.ts`'s own `effectiveStaleMinutes()` already applies a **2.5× weekend
  multiplier** to `swing-discovery`'s own `stale_after_min` (36h × 2.5 = 90h) before flagging the CRON
  itself unhealthy — i.e. the codebase already knows this cron's ordinary idle window over a weekend
  is far longer than 26h; the serving-snapshot TTL simply never accounted for it.

## Blast radius

Both consumers of `discoverSwingFromPersisted()` share this root cause and are both fixed by the
same TTL change (no other code touched):
- `getSwingServingLane` (main Night Hawk Swings board) — loses `factors`/`regime`/`setupState`/
  `entryStatus`/`thesisLevel` enrichment for every WATCH row and, via `attachThesisExplanation`, the
  factors/regime borrow for every committed row.
- `play-brief-resolve.ts`'s `loadOpenTerminalPlay` (Ask Largo swing play-brief, #4182) — same
  factors/regime borrow, same silent no-op.

Not touched (deliberately, scope discipline): `src/lib/banger/watch-cache.ts` has an identical
`TTL_SEC = 26 * 60 * 60` literal, but its cache key is per-session-date
(`banger:watch:v1:${sessionDate}`), not a single rolling "latest" key — the failure shape is
different (a stale key for *today* isn't masked by an old day's key surviving) and needs its own
investigation rather than being folded into this fix. Flagged for follow-up (PR #4076 comment).

## Fix

`SWING_SERVING_TTL_SEC`: `26 * 60 * 60` → `120 * 60 * 60` (5 days). Sized with headroom past the
*measured* worst ordinary weekly gap (~58h: Friday POST_CLOSE end at 20:00 ET → Monday PRE_OPEN start
at 06:00 ET, i.e. the case where OVERNIGHT — the day's last phase — never fires) to also cover a
Monday market holiday (Friday close → Tuesday PRE_OPEN, ~82h). Comment on the constant explains the
reasoning and the measurement so it can't silently regress again.

## Regression test

`src/lib/swing/serving-lane.test.ts` — new test `"SWING_SERVING_TTL_SEC survives the ordinary
Friday-close -> Monday-open gap, not just a weekday one"`. Derives the worst-case gap
programmatically from `SWING_SCAN_PHASES` (POST_CLOSE's `endMin` → PRE_OPEN's `startMin`, plus a full
weekend) rather than hardcoding a number, so the assertion can't drift from `scan-cadence.ts` the way
the original 26h constant drifted from the real weekly cadence.

RED pre-fix / GREEN post-fix (git-stash proof, Node 20):
```
$ git stash push -- src/lib/swing/serving-lane.ts   # keep the test, revert only the TTL
$ node --experimental-test-module-mocks --import tsx --test src/lib/swing/serving-lane.test.ts
not ok 15 - SWING_SERVING_TTL_SEC survives the ordinary Friday-close -> Monday-open gap, not just a weekday one
  error: 'SWING_SERVING_TTL_SEC (93600s) must exceed the Fri-close -> Mon-PRE_OPEN gap (208800s / 58.0h) ...'
# pass 14 / fail 1

$ git stash pop
$ node --experimental-test-module-mocks --import tsx --test src/lib/swing/serving-lane.test.ts
# pass 15 / fail 0
```
Also ran clean together with `play-brief-resolve.test.ts`, `product-reads-swing-freshness.test.ts`,
`serving-board.test.ts`, `serving-ingest.test.ts` (37/37 pass) and `npx tsc --noEmit` (clean).

## Suggested follow-up (not in this PR — raised with Cursor separately)

- Same TTL-literal pattern in `src/lib/banger/watch-cache.ts` (`TTL_SEC = 26 * 60 * 60`) is worth an
  independent check — different cache-key shape (per-session-date vs one rolling key) means the
  failure mode may or may not be the same, but the magic number recurring unchecked is itself a
  signal worth a second pair of eyes.
- Once this snapshot reliably survives the weekend, it's worth re-auditing whether
  `attachThesisExplanation`'s fail-closed behavior (CTO-AUDIT finding #32: persistence/entry-geometry
  pillars have no live equivalent at all, even when a dossier IS present) is the next thing worth
  closing — this fix restores the INTENDED degrade-to-last-scan behavior, it doesn't add new signal.
