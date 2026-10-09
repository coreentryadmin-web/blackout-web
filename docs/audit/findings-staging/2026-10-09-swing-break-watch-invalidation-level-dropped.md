## 2026-10-09 — [FINDING, largo-swing] "Break watch" can cite an invalidation price with zero supporting narration — MAX_BULLETS truncation can drop exactly the level it depends on — FIXED

> **kind:** `FINDING`

| Field | Value |
| --- | --- |
| **Status** | FIXED |
| **Severity** | P3 (no wrong price — the cited invalidation level is always correct; the defect is a missing explanation for the single most safety-critical line in the brief, while less-critical duplicate-strike bullets consume the budget instead) |
| **Component** | `src/lib/swing/play-brief-narrative.ts` (`tradeManagerNarrativeSection`'s level-narration loop, `breakTrigger`) |
| **PR** | fix/swing-break-watch-invalidation-level-dropped |
| **Found via** | Ask Largo standing sub-mandate — this cycle's 5-engine live monitor, fetching fresh `GET /api/market/swing/play-brief` envelopes against `docs/audit/LARGO-PRODUCT-CONTRACT.md`'s ten points for PLAY, GRPN, SPCG, GMEU and PROF (OPEN/MANAGING), fresh tickers not yet checked earlier this session. |

### Root cause

`collectFocalLevels` returns every GEX/structure level (put wall, call wall, GEX king, max pain,
gamma magnet, gamma flip, dark pool) sorted **nearest-first by unsigned distance from spot**.
`tradeManagerNarrativeSection`'s "Trade manager read" loop walks that sorted array and narrates
each one into its own bullet, capped at `MAX_BULLETS` (14) — a cap that exists so the section
can't grow unbounded on a ticker with many live signals. Separately, the section's reserved
"Break watch" bullet (which bypasses the cap entirely, by design, since it's safety-critical) is
built by `breakTrigger`, which independently calls `.find()` on the SAME sorted `focal` array to
pick the one real structural stop (for a LONG: the nearest put wall / dark pool / GEX king that
sits BELOW spot).

The two paths are decoupled. For a LONG breakout, resistance levels (call wall, GEX king, max
pain) commonly cluster a few percent above spot while the one real support (put wall) sits much
farther away below it — so put wall is reliably the LAST entry the capped loop reaches, and on a
ticker with a couple of extra coaching bullets ahead of it in the same section (short interest,
a confluence node — both ordinary, not rare), the cap is already hit before the loop ever gets to
it. The bullet gets silently dropped. The reserved "Break watch" bullet, unaffected by the cap,
still fires and still cites the correct price — so the brief ends up stating an invalidation level
with **no bullet anywhere in the section explaining what that price is or why it matters**, while
two separate bullets get spent narrating call wall and GEX king — frequently the identical strike,
narrated twice — which have nothing to do with the downside risk the Break watch line names.

Live repro, `GET /api/market/swing/play-brief?playId=SWING:PROF&ticker=PROF&status=OPEN`
(2026-10-08, ~19:54 ET), a real committed BANGER-origin position (entry $0.10, LONG 7.5C 8DTE,
spot $6.85, put wall $5.00 at -27.0% from spot, call wall/GEX king/max pain all $7.50 at +9.5%):
the "Trade manager read" section's 14 capped bullets were Hold the line / Manage plan / Short
interest / VEX lens / Gamma magnet / Confluence / Expected move / call wall firm / Chart read /
Vector desk / Data caveat / Spot (dealer posture) / Call wall $7.50 / GEX king $7.50 — no Put wall
bullet anywhere — followed by the reserved `**Break watch** — lose **5.00** on a closing basis →
structural support failed; exit or cut size.` A member reading the section top-to-bottom sees the
exact dollar figure their whole position's risk hinges on, with zero narrated context for what it
is (the raw level IS shown, unexplained, in the separate "Levels on chart"/"What to watch"
sections further down the same envelope — this is specifically the narrated coaching bullet going
missing from the section a member reads first).

### Evidence

Confirmed via this cycle's live play-brief fetches (temp Clerk premium session, same auth pattern
`scripts/audit/lib/audit-auth-fetch.mjs` uses) across five fresh OPEN swing positions:

- **PROF** (reproduced the bug): Put wall $5.00 at -27.0% — NO bullet; Call wall/GEX king $7.50 at
  +9.5% — each got its own bullet.
- **PLAY** (did NOT reproduce — put wall at -12.9% sorted nearer than the +16.1% resistance
  cluster, so it survived the cap on nearest-first merit alone): confirms the bug is specifically a
  function of sort position vs. cap, not a blanket omission of put wall everywhere.
- **GMEU** (did NOT reproduce — put wall at -47.1%, farther than call wall's +5.7%, but with fewer
  pre-loop coaching bullets than PROF (`"Book context"` present, `"Short interest"`/`"Confluence"`
  absent) the cap was never hit before put wall's turn): confirms the defect is genuinely about the
  COMBINATION of distance-sort order and bullet budget, not either alone.

### Fix rationale

Factored the side-filtered `.find()` predicate `breakTrigger` already used (put_wall/dark_pool/king
below spot for LONG, call_wall/king above spot for SHORT) into a shared
`resolveInvalidationFocalLevel(play, focal)`, called by both `breakTrigger` (unchanged selection,
now DRY against a second call site instead of risking the two drifting apart — exactly the class of
bug this same file's own `king`-strike history warns about) and the narration loop. The loop now
identifies that exact object by reference and passes `{ reserved: true }` into the same `add()`
bypass Break watch/Counter-thesis already use, so the level a stated invalidation depends on can
never be silently truncated — while every other level keeps the existing cap untouched (no
unbounded growth risk introduced). Changed the loop's early-exit from `break` to `continue` once
the cap is hit and the current level isn't the invalidation level: `focal` is small (at most 7
entries), so the scan cost is negligible, and `continue` (not `break`) is required so a
later-sorted invalidation level (the common case, per the evidence above) is still reached rather
than the loop exiting before it ever gets there.

Deliberately left unchanged: the gamma-flip fallback branch in `breakTrigger` (when no real
support/resist wall exists and the play falls back to citing the gamma flip as the stop) — that
bullet is gated by its own `Math.abs(distancePct) < 3` narration threshold, a different, narrower
potential gap that was not reproduced live this cycle and is out of scope for this fix.

### Tests

Added `src/lib/swing/play-brief-narrative.test.ts`: a PROF-shaped fixture (LONG breakout, put wall
far below spot, resistance cluster near spot, enough coaching bullets to hit the cap before the
loop's natural iteration would reach put wall) asserting both that "Break watch" still cites the
real put wall price AND that the put wall now has its own explanatory bullet in the section body.
Proved RED pre-fix via `git stash` (reproduced the exact PROF shape: Break watch fired correctly,
the Put wall bullet was absent) and GREEN post-fix. Full `src/lib/swing/play-brief-narrative.test.ts`:
109/109 pass. Full `src/lib/swing/play-brief*.test.ts`: 853/853 pass. Full `npm test`:
15842/15842 pass (0 fail, 3 pre-existing skipped, unrelated to this change). `npx tsc --noEmit`
clean.
