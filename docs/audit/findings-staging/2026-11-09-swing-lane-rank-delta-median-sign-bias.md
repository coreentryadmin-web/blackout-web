> **kind:** FINDING

## Swing `deltaFromMedian` sign-bias rounding tie — `commit.ts` + `play-brief-lane-rank.ts` — FIXED

| **Status** | FIXED (PR #TBD) |

### Root cause

Both `commit.ts`'s `laneRankAtCommitFor` (commit-time snapshot, stamped into
`entry_context.lane_rank_at_commit`) and `play-brief-lane-rank.ts`'s `computeLaneRank`
(live/open-brief snapshot) independently compute a candidate/play's score distance from its
lane's median as:

```ts
deltaFromMedian: Math.round((score - medianScore) * 10) / 10,
```

Plain `Math.round(n * factor) / factor` ties toward `+Infinity` — `Math.round(-67.5) === -67`,
not `-68` — so a NEGATIVE `deltaFromMedian` landing exactly on a `.x5` display-precision tie
rounds to a **smaller magnitude** than the identical positive-magnitude case. Repro (exact
IEEE754 tie, verified in node — most two-decimal candidates drift a few ULPs off the tie after
subtraction and silently stop reproducing it): `medianScore = 60.0`, `score = 53.25` → raw delta
`-6.75` → `(-6.75 * 10) = -67.5` exactly → old rounding gives `-6.7`; the mirror-image
`score = 66.75` (raw delta `+6.75`) gives `+6.8` — a `0.1`pt asymmetry between two candidates
equidistant from the median on opposite sides.

This is the exact same bug class fixed earlier today, same session, in `fmt-money.ts`'s
`fmtPct` (2026-10-26), `record.ts`'s `round2` (PR #7706), and `play-brief-intel.ts`'s
Industry-read line (PR #7730) — a bidirectional quantity rounded with a sign-biased formula.

### Blast radius

Two independent call sites compute the identical quantity with the identical bug (duplicated
logic, not a single shared helper):
- `commit.ts`'s `laneRankAtCommitFor` — stamped into `entry_context.lane_rank_at_commit` at
  commit time, read back verbatim by `closedLaneRankSection` (play-brief-lane-rank.ts) for
  CLOSED plays' "Lane rank" section.
- `play-brief-lane-rank.ts`'s `computeLaneRank` — computed live for every WATCH/OPEN play's
  "Lane rank" section.

This isn't purely cosmetic: `laneRankCoaching` (play-brief-narrative-coaching.ts) gates
narrative branches directly on the ROUNDED `deltaFromMedian` value (`< -15`, `>= 10`,
`rank <= 3 && deltaFromMedian >= 10`). A tie landing exactly adjacent to one of those thresholds
(e.g. raw delta `-15.05`, which the biased rounding collapses to `-15.0` — not `< -15` — while
the correct magnitude-rounded `-15.1` would clear the threshold) could silently suppress or
misfire a "below median — confirm before adding size" / "Top-tier setup" sentence. The displayed
`"+X vs median"` / `"-X vs median"` text itself is also directly affected for any play whose
delta lands on a tie.

### Fix rationale

Applied the same round-by-magnitude-then-reapply-sign formula already established today
(`(Math.sign(n) * Math.round(Math.abs(n) * factor)) / factor`) at both call sites — a new
module-local `deltaFromMedianRounded` helper in `play-brief-lane-rank.ts` (file has no shared
rounding utility import to reuse), and inline in `commit.ts` (consistent with that file's
existing `laneRankAtCommitFor` style). Left `medianScore` itself untouched at both sites — it's
computed from a set of individually non-negative evidence scores, so the median of non-negative
values is never negative and the sign-bias formula is a no-op there; only the delta
(`score - medianScore`, genuinely bidirectional) needed the fix.

### Evidence

New regression tests in `commit.test.ts` and `play-brief-lane-rank.test.ts` using the exact
IEEE754-tie fixture above (`53.25`/`60.0`/`66.75`), confirmed RED (old code: `-6.7` vs `+6.8`,
an asymmetric pair) → GREEN (fixed code: `-6.8` vs `+6.8`, symmetric) via `git stash` isolation
on just the two source files. Full `src/lib/swing/*.test.ts` suite + `tsc --noEmit` both clean
post-fix.
