# Swing/Banger "score pillars" never summed to the score shown next to them

> **kind:** FINDING

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P2 (product-honesty/trust — the desk and Ask Largo both narrate a factor breakdown as "why" a score exists, and for ~85 of ~90 live committed SWING rows in this snapshot the numbers do not add up, by roughly half the score) |
| **Area** | Night Hawk Swings — `src/lib/swing/banger-lane-merge.ts` (Engine B/Banger lane merge), `src/lib/swing/vector-lane-enrich.ts` (Vector-corroboration score bump); consumed by `PlayTerminal.tsx`'s "Why this play was picked" panel and Ask Largo's `play-brief-intel.ts::whyThisSetupSection` ("**Score pillars:**") |
| **Found by** | Standing Ask Largo × Night Hawk Swings ownership mandate — 2026-09-12 5-engine + Largo deep-dive cycle |

## Root cause

Two independent code paths add to a SWING `HorizonPlay.score` without updating `factors`
(`{label, points}[]`) to match — even though every consumer treats `factors` as an
itemized, additive explanation of `score`:

1. **`banger-lane-merge.ts`** (`horizonPlayFromBangerPosition` for live Engine-B/Banger
   positions, `horizonPlayFromBangerWatch` for pre-entry banger WATCH rows). `score` is
   derived from the raw discovery gain% via `60 + round(gainPct/2)` (or `58 +
   round(gainPct/3)` pre-entry) — but `factors` carried `[{label: "Discovery gain",
   points: Math.round(gainPct)}]`, i.e. the **raw gain%**, not the transformed score
   contribution. These are different quantities (roughly 2-3x apart) with the same field
   name/shape `swing-pillars.ts` uses for actual score contributions (where
   `SwingPillarContribution.points` is documented as "Points actually contributed" and
   `score = round1(sum of all contributions)` by construction).
2. **`vector-lane-enrich.ts`** (`enrichPlayWithVectorLeader`) bumps `score` by up to +8
   when a recent Vector pick corroborates the same ticker, but never added a matching
   `factors` entry for the bump at all.

Both surfaces that render `factors` assume the sum equals `score`:
- `PlayTerminal.tsx`'s "Why this play was picked" panel titles the section on the factor
  count and renders each `{label, points}` as its own line with a bar sized by `points`,
  right next to the big `SCORE` readout.
- `play-brief-intel.ts::whyThisSetupSection` — the Ask Largo play-brief's "Why this
  setup" section — literally headers this list `**Score pillars:**`.

## Evidence

Live `GET /api/market/nighthawk/horizons?view=swings` (2026-09-12, off-hours,
authenticated via `scripts/audit/lib/audit-auth-fetch.mjs`) — SWING lane, 90 committed
rows. Comparing `score` to `sum(factors[].points)` for every row:

- 85 of 90 rows are BREAKOUT-archetype (Banger-lane-merged) rows, EVERY one short by
  roughly half its own score, e.g.:
  - `ODD`: score 66, factors sum 13 (single "Discovery gain" factor) — 53pt gap.
  - `HPE`: score 65, factors sum 10 — 55pt gap.
  - `DLLL`: score 69, factors sum 18 — 51pt gap.
  - (77 more BREAKOUT rows, same pattern, gaps of 51-58pt.)
- A member expanding "Why this play was picked" on any of these sees exactly ONE factor
  ("Discovery gain +N pts") next to a SCORE that is roughly double N, with nothing to
  explain where the rest of the score came from — the opposite of what the panel and the
  Largo section promise.
- 5 of 90 rows are true swing-pillar dossiers (`swing-pillars.ts`), and those already
  reconciled exactly (e.g. `META` 76/76, `EWY` 72.9/72.9, `PLTR` 61.7/61.7) — confirming
  the invariant holds everywhere EXCEPT the two paths fixed here.

## Blast radius

- `horizonPlayFromBangerPosition` and `horizonPlayFromBangerWatch` (both in
  `banger-lane-merge.ts`) — same root cause, same fix shape, fixed in both.
- `enrichPlayWithVectorLeader` (`vector-lane-enrich.ts`) — a second, independent call
  site with the identical failure mode (score adjusted, `factors` not); fixed alongside
  since it's the same invariant and the same PR review would otherwise re-discover it.
- Not touched: `swing-pillars.ts`'s own `scoreSwingPillars` (already correct by
  construction — `score` IS `sum(contributions.points)`), and the 0DTE lane's own
  `factor_breakdown`→`factors` mapping in `adapters.ts` (separate desk, separate scoring
  system, out of scope here — SPX Slayer/0DTE checks this same cycle found no analogous
  mismatch there).

## Fix

- `banger-lane-merge.ts`: compute `score` once per function, then set
  `factors: [{label: "Discovery gain", points: score}]` instead of the raw gain%. This is
  not just an arithmetic patch — it's the honest read: the banger lane has no second
  pillar, so the WHOLE score legitimately belongs to this one signal. The raw gain% is
  not lost; it stays visible in `reason` ("Banger breakout +N% · ...").
- `vector-lane-enrich.ts`: compute the actually-applied score delta (`nextScore -
  play.score`, which can be less than the raw bump near the 99 ceiling) and append it as
  a `{label: "Vector corroboration", points: appliedBump}` factor when `appliedBump > 0`
  (never a zero-point factor). Using the applied delta rather than the raw bump avoids
  overstating the factor when the ceiling clamp already reduced the real increase.

## Evidence (before/after)

- RED before fix (git-stashed the two source files, kept only the new/extended tests):
  `npx tsx --experimental-test-module-mocks --test src/lib/swing/banger-lane-merge.test.ts src/lib/swing/vector-lane-enrich.test.ts`
  → 5 of 17 tests fail (both banger factor-sum tests, and 3 of the vector-bump tests
  including the ceiling-clamp case).
- GREEN after fix: same command, 17/17 pass.
- Full suite: `npm test` (Node 20) — 13789 pass / 0 fail / 3 skipped (pre-existing,
  unrelated).
- `npx tsc --noEmit`: clean.

## Market-open validation

Logged in `docs/audit/MARKET-OPEN-VALIDATION.md` — during the next RTH session, open a
live BREAKOUT/Banger-origin SWING position's "Why this play was picked" panel (command
deck) and its Ask Largo play-brief "Why this setup" section, and confirm the single
"Discovery gain" factor now equals the SCORE shown next to it (previously roughly half).
Also confirm a freshly Vector-corroborated play now shows a "Vector corroboration" line
in the same breakdown, summing to its (possibly bumped) score.
