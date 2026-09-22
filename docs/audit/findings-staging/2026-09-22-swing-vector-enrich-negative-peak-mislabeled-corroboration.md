## A losing Vector pick silently penalized a swing play's score and mislabeled it as "Vector corroboration"

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED |
| **Date** | 2026-09-22 |
| **Severity** | P2 (score/provenance integrity — a losing signal presented as supporting evidence, undisclosed score reduction, reopens the exact invariant class #4826 fixed 2026-09-12) |
| **Surface** | Night Hawk Swings — `src/lib/swing/vector-lane-enrich.ts` |

### Root cause

`enrichPlayWithVectorLeader` stamps `VECTOR` provenance and a score "corroboration" bump onto a swing
WATCH/COMMIT play whenever its ticker matches an active Vector pick leader:

```ts
const rawBump =
  leader.peakPremiumPct != null && Number.isFinite(leader.peakPremiumPct)
    ? Math.min(8, Math.round(leader.peakPremiumPct / 5))
    : 3;
const nextScore = Math.min(99, play.score + rawBump);
```

`peakPremiumPct` is a genuine running max — `upsertVectorPickLeader`'s SQL upsert
(`vector-pick-leaders-db.ts`) merges it via `GREATEST(existing, new)` on every sweep tick, so it can
only ever hold the HIGHEST premium % the pick has ever reached. A NEGATIVE value therefore means the
pick has never once been profitable — a genuinely losing signal, not corroboration.

Fed through unguarded, a negative `peakPremiumPct` (e.g. −20) computes a NEGATIVE `rawBump`
(`round(-20/5) = -4`), which reduces `nextScore` below `play.score`. Because `appliedBump = nextScore -
play.score` is then negative, the `appliedBump > 0` guard a few lines down correctly skips adding a
`factors[]` entry for it — but the function unconditionally still: (1) applies the score reduction, (2)
adds `"VECTOR"` to `signalKinds`, and (3) appends `" · Vector corroboration"` to `reason` — mislabeling a
contradicting signal as supporting, with the score change left completely undisclosed. This is the exact
invariant class (`sum(factors.points) === score`) the 2026-09-12 fix (#4826) closed for the *positive*
case in this same function, reopened here for the negative one, which that fix's own comment didn't
anticipate.

### Evidence

Traced the full read path with no filtering anywhere that would exclude a losing/invalidated Vector
leader before it reaches this function: `GET /api/market/nighthawk/horizons` (`horizons/route.ts`)
fetches up to 120 leader rows via `fetchVectorPickLeaderRows({ limit: 120 })` — unfiltered by
`action_status`/`setup_invalidated`/sign of `peak_premium_pct` — and maps every one straight into
`VectorLeaderHint[]`, passed to `getSwingServingLane` → `enrichSwingPlaysWithVectorLeaders` →
`enrichPlayWithVectorLeader`. A Vector pick that has never gone green (plausible and expected for some
real picks) is therefore a live-reachable input.

New regression tests in `vector-lane-enrich.test.ts`: a `peakPremiumPct: -20` case asserts the play comes
back completely untouched (`enriched === play`, no score change, no `VECTOR` tag, no "Vector" in
`reason`); a `peakPremiumPct: 0` boundary case confirms the fix's `< 0` check doesn't over-trigger on a
genuinely non-negative (if zero-bump) leader. RED confirmed via `git stash push -- src/lib/swing/vector-lane-enrich.ts`
(negative-peak test failed pre-fix — the play was mutated). GREEN after restoring the fix.

Full `vector-lane-enrich.test.ts`: 7/7 pass. Collateral (`serving-lane.test.ts`, the only other file
importing these functions — repo-wide grep): 27/27 pass combined. `npx tsc --noEmit`: clean.

### Fix

Added an early return in `enrichPlayWithVectorLeader`: when `leader.peakPremiumPct` is a finite number
strictly less than 0, return `play` unchanged — no score change, no signal tag, no reason text. The
existing null/undefined-peak path (defaults to a flat +3 bump) and the zero-peak path (computes a
genuine zero-point bump, still tagged/disclosed) are both left exactly as they were — only the
confirmed-negative case is now excluded.

### Blast radius

One file changed for behavior (`vector-lane-enrich.ts`). `enrichSwingPlaysWithVectorLeaders` (the only
caller, `serving-lane.ts`) is unaffected in shape — it still maps every play through
`enrichPlayWithVectorLeader`, which now simply no-ops for the negative-peak case instead of silently
penalizing. No other consumer of `VectorLeaderHint`/`enrichPlayWithVectorLeader` exists (repo-wide grep).

### Fix rationale

Minimal, symmetric with the function's own existing early-return shape (`if (!leader) return play;`) —
adds one more "this input doesn't qualify for enrichment" guard rather than trying to make the
downstream math handle a negative bump gracefully (e.g. clamping rawBump to ≥0 would still leave the
`VECTOR` tag and "corroboration" reason text on a losing pick, which is the more serious half of the
bug — the mislabeling, not just the score arithmetic). Deliberately left unchanged: the null-peak default
bump and the positive-peak bump math, both already covered by #4826's tests.
