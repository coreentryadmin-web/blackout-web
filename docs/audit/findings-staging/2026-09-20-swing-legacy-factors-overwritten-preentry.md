> **kind:** FINDING

## Night Hawk Swings — Legacy-promoted PRE-ENTRY plays showed factors that never summed to score (4th occurrence) — FIXED

| | |
|---|---|
| **Lane** | Ask Largo × Night Hawk Swings — swing serving lane (`src/lib/swing/serving-lane.ts`) |
| **Severity** | P2 (member-facing "why this play" explanation panel shows an internally inconsistent breakdown; no gate/scoring/capital impact) |
| **Status** | FIXED — `src/lib/swing/serving-lane.ts` |
| **Found by** | Ask Largo × Night Hawk Swings standing ownership mandate (CLAUDE.md), 2026-09-20 |

### Root cause

This is a fourth occurrence of the bug class already fixed three times (#4826/#4832 for
Banger/Vector-bump lanes, #4843 for `legacy-confirm-promote.ts`'s own play construction): a card's
`score` and its `factors[]` breakdown come from two different, unrelated scoring runs, so the
factors silently stop summing to the displayed score.

`legacy-confirm-promote.ts`'s `buildLegacySwingArtifacts` deliberately pins Legacy-morning-confirm-
promoted plays' `factors` to a single entry, `[{label:"Night Hawk edition score", points:
swingPlay.score}]` — the #4843 fix (2026-09-12), because the play's `score` is Legacy's own
published edition conviction score, not the dossier's independently-computed synthetic pillar
score. Pairing them was exactly the bug #4843 fixed.

But `serving-lane.ts` has TWO enrichment functions that attach a card's `factors` at render time:
`attachThesisExplanation` (for LIVE committed rows, via `fetchOpenPositions`) and `enrichPlay` (for
PRE-ENTRY discovery rows). `attachThesisExplanation` was fixed to respect a pinned `play.factors`
(prefer it, only borrow the dossier's `meta.factors` when the row carries none) as part of an
earlier fix in this same class. `enrichPlay` was never given the same guard — it unconditionally
set `factors: meta.factors`, overwriting the pinned single-factor array with a fresh dossier re-run
whenever a same-ticker dossier existed (which it always does here: `mergeLegacyPromotedSnapshot`
also pushes the promoted play's own dossier into the snapshot).

A Legacy-promoted play never carries `liveStatus`/`manageAction` until it is actually committed to
a real open position, so it always routes through `enrichPlay`, never
`attachThesisExplanation` — meaning #4843's construction-time fix was silently undone at render
time for every Legacy-promoted row that hadn't yet become a live position.

### Evidence

Live production check, 2026-09-20 (`GET /api/market/nighthawk/horizons?view=swings`, market
closed — data reflects the last live scan): two Legacy-morning-confirm-promoted rows, both promoted
well AFTER the #4843 fix landed (2026-09-12), still showed the mismatch:

- `LITE`: score 71, factors sum 70.1 (Structure 42.1 + Regime 10.1 + Volatility 8.6 + Flow 5.7 +
  Data quality 3.6) — a 0.9pt gap, `firstSeenAt` 2026-09-17.
- `SMCI`: score 91, factors sum 84.5 (Structure 50 + Volatility 21.2 + Regime 13.3) — a 6.5pt/7%
  gap, `firstSeenAt` 2026-09-18.

Every other committed/watch row in the same live payload (68 of 70) summed cleanly, confirming this
is specific to the Legacy-promotion path, not a general rounding issue.

New regression test in `src/lib/swing/serving-lane.test.ts` (`a PRE-ENTRY play's OWN pinned factors
win over a fresh same-day dossier's — score/factors never disagree even before commit`) mirrors the
existing live-position pinned-factors test: a play pinned to a single 71-point factor plus a
same-ticker dossier scoring differently. RED→GREEN confirmed via `git stash`: fails
(`85.7 !== 71`) before the fix, passes after. Full file: 17/17 pass post-fix. `npx tsc --noEmit`
clean.

### Fix

`enrichPlay` now checks `pinnedFactors = Array.isArray(play.factors) && play.factors.length > 0`
before deciding `factors`: `pinnedFactors ? play.factors : meta.factors` — the same guard
`attachThesisExplanation` already uses. Organic (non-Legacy) discovery plays never set
`play.factors` at all (`horizon-plays.ts`'s `factors` field is optional/undefined until this
function fills it), so this is a no-op for them — confirmed by the untouched
`assembles a real sectioned lane` / `ungraduated AT_TRIGGER` tests still passing unchanged.

### Fix rationale

Mirrored `attachThesisExplanation`'s existing guard rather than inventing a new one, for
consistency and because it is already proven correct for the sibling (live-position) call site.
Considered instead fixing this only in `buildLegacySwingArtifacts` by having it also stamp a marker
field `enrichPlay` could key on — rejected: the general "an existing pinned `factors[]` wins over a
freshly recomputed one" rule is the right invariant regardless of WHO pinned it, and keeps the two
enrichment functions symmetric instead of adding a Legacy-specific special case to a third file.

### Blast radius

Single call site (`getSwingServingLane`'s `enrichedDiscovery = discoveryPlays.map((p) =>
enrichPlay(...))`), which is the only place `enrichPlay` is used. Affects every PRE-ENTRY row with
a same-ticker dossier and pre-existing pinned factors — today that is exclusively the Legacy-
promotion path; any future producer of a pinned pre-entry `factors[]` gets the same protection for
free. `attachThesisExplanation` (live rows) was already correct and is untouched.
