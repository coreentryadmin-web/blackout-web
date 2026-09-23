> **kind:** FINDING

## Swing "Option mark as of" evidence mislabels an on-schedule mark as stale — FIXED

| | |
|---|---|
| **Area** | Ask Largo / Night Hawk Swings play-brief |
| **Severity** | P2 (correctness — false staleness disclosure, not a data-availability bug) |
| **Status** | FIXED |
| **File** | `src/lib/swing/play-brief.ts` (`evidenceFromContext`) |

### Root cause

A swing position's option mark has exactly one writer — `swing-active-refresh`
(`cron-registry.ts`), which runs every 15 minutes during market hours. So a mark
10-15 minutes old is **on schedule**, not stale — this is already documented and
handled by `optionMarkIsStale()` in `src/lib/swing/play-brief-absence.ts`, which
carries an 18-minute cadence-aware threshold specifically built (2026-09-15) to stop
the generic cross-product `freshnessFromObservedMs` bucket (stale at 10 minutes,
`src/lib/bie/answer-envelope.ts`) from false-positiving on exactly this window.

That fix never reached `evidenceFromContext`'s own `"Option mark as of …"` evidence
entry (`play-brief.ts:716-721` prior to this fix), which still called
`freshnessFromObservedMs` directly. So every other freshness surface in the swing
play-brief (the Position section, the gating logic, `optionMarkIsStale` callers)
correctly treated a 10-15 minute old mark as current, while the Data Freshness
evidence entry — read directly by both members and Ask Largo — kept calling it
`stale`.

### Evidence

Live repro, 2026-09-23, real NVDA swing position (positionId 42, `SWING:NVDA:42`):
`GET /api/market/swing/play-brief?playId=SWING:NVDA&ticker=NVDA&status=OPEN&positionId=42`
returned an option mark timestamped `2026-09-23 12:30 ET`, read at `2026-09-23 12:42
ET` — 12 minutes old, well inside the 18-minute cadence window — yet the evidence
array carried:

```json
{
  "kind": "fact",
  "text": "Option mark as of 2026-09-23 12:30 ET.",
  "provenance": { "source": "Swing ledger", "asOf": "2026-09-23 12:42 ET", "freshness": "stale" }
}
```

Regression test added: `composeSwingPlayBrief: on-schedule 12min-old option mark
evidence reads recent, not stale` (`src/lib/swing/play-brief.test.ts`) — confirmed
RED before the fix (`freshness: "stale"` on a 12-minute-old mark), GREEN after.

### Fix

`evidenceFromContext` now computes the generic freshness bucket first; only when
that bucket says `"stale"` does it cross-check `optionMarkIsStale(ctx.play, readMs)`
— if the cadence-aware check disagrees (mark is within the 18-minute window), the
evidence entry downgrades to `"recent"` instead. `"live"`/`"recent"` verdicts from
the generic bucket pass through unchanged (the cadence-aware check can't make a mark
fresher than the generic bucket already says), and the existing future-skew
fail-closed behavior (Largo C2 — a future-timestamped mark must read `"stale"`, not
`"unknown"`) is preserved, since `optionMarkIsStale` itself fails closed on negative
age.

### Blast radius

Single call site — `evidenceFromContext` is the only place in the swing play-brief
that builds the `"Option mark as of …"` evidence entry. No other consumer
(0DTE/Legacy/Vector) shares this function.

### Tests

- `npx tsx --experimental-test-module-mocks --test src/lib/swing/play-brief.test.ts` — 101/101 pass (was 100/101 RED before fix).
- `npx tsc --noEmit` — clean.
