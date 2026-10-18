## SPX Slayer: `confluence.rawScore` left stale after the Night Hawk "morning prior" bonus mutation — fix/spx-rawscore-stale-nighthawk-bonus — 2026-10-18

> **kind:** `FINDING`

| **Status** | FIXED |
|---|---|

- **What was broken:** `reclassifyConfluenceScore()` (`src/features/spx/lib/spx-signals.ts`) was
  added on 2026-09-22 (FINDINGS #337) to fix exactly this class of bug — the Night Hawk
  "morning prior" bonus in `spx-play-engine.ts` mutates an already-built `SpxConfluence` in place
  (`confluence.score += nhBonus.bonus`, `confluence.factors.push({...})`), so every field derived
  from score/factors has to be recomputed and reassigned together or it goes stale. That fix's own
  `Pick<SpxConfluence, "score"|"bias"|"action"|"grade"|"direction"|"agreeing"|"conflicts"|
  "weighted_conflicts">` return type — and its call site's field-by-field reassignment — covered
  every derived field EXCEPT `rawScore`, which was left out of both the Pick and the reassignment
  list. `rawScore` is computed in `computeSpxConfluence` via
  `clamp(round(|score|*1.15 + factors.length*3), 0, 96)` — a function of the exact same two inputs
  (`score`, `factors.length`) the Night Hawk bonus mutates — so after the bonus landed, every OTHER
  field (`grade`/`direction`/`agreeing`/`conflicts`/`weighted_conflicts`) reflected the post-bonus
  state while `confluence.rawScore` stayed frozen at the value computed before the "Night Hawk
  prior" factor was ever pushed, on the stale pre-bonus `|score|` and `factors.length`.
- **Impact:** this stale `rawScore` is shown to members and persisted downstream as "confidence"
  (`src/features/spx/lib/spx-signal-log.ts:102`, `confidence: play.rawScore`) and in outcome
  snapshots (`spx-play-outcomes.ts`) used for calibration. It does **not** affect any
  gating/trading decision — those key off `score`/`grade`/`direction`, which were already correctly
  fresh via the 2026-09-22 fix. This is a narrower reopening of one field that fix's own explicit
  field list omitted.
- **Evidence:** reverting the fix (restoring the pre-fix `spx-signals.ts`/`spx-play-engine.ts`
  while keeping the new test) reproduces the failure —
  `reclassifyConfluenceScore: rawScore reflects the POST-bonus score/factors.length, not the
  frozen pre-bonus value` fails with `rawScore (undefined) ... 81 !== undefined` pre-fix (the
  pre-fix return type has no `rawScore` key at all); 14/14 tests in `spx-signals.test.ts` pass
  post-fix. Verified via
  `npx tsx --experimental-test-module-mocks --test src/features/spx/lib/spx-signals.test.ts` on
  Node 20.
- **Blast radius:** every reader of `confluence.rawScore` downstream of the Night Hawk prior
  mutation in `spx-play-engine.ts` — `spx-signal-log.ts`'s `confidence` persistence, outcome
  snapshots in `spx-play-outcomes.ts`, and every play-payload copy of `confluence.rawScore`
  throughout `spx-play-engine.ts` (lines 409/451/497/555/603/650/775/1354/1439/1507/1523/1643).
  None of these affect gating/trading logic, which reads `score`/`grade`/`direction` instead.
- **Fix rationale:** widened `reclassifyConfluenceScore`'s return type to also include `rawScore`,
  computed with the exact same formula `computeSpxConfluence` uses
  (`clamp(round(|score|*1.15 + factors.length*3), 0, 96)`), evaluated on the function's own
  post-bonus `clamped`/`factors` inputs — mirroring how `score`/`grade`/etc. are already handled
  through this same helper rather than introducing a second, separately-maintained formula.
  Reassigned `confluence.rawScore = reclass.rawScore` at the call site alongside the other fields.
  Deliberately did not touch `computeSpxConfluence` itself (unrelated, heavily byte-for-byte
  regression-tested) — same discipline as the original 2026-09-22 fix.
- **In-code comments:** both `reclassifyConfluenceScore`'s header (spx-signals.ts) and its call
  site (spx-play-engine.ts) carry a 2026-10-18 addendum explaining which field was missed and why,
  cross-referencing the original 2026-09-22 fix.

**Market-open validation**: see `docs/audit/MARKET-OPEN-VALIDATION.md` for the RTH check to run
next session — confirm a live Night Hawk-prior-bonus play's `rawScore` in the `/api/market/spx/*`
payload matches `clamp(round(|score|*1.15 + factors.length*3), 0, 96)` on its OWN post-bonus
score/factors, not a value consistent only with the pre-bonus factor count.
