## Ask Largo "Desk says TRIM" bullet never disclosed the real trim reason for 5 of 6 manage.ts rungs

> **kind:** `FINDING`

| | |
|---|---|
| **Area** | Ask Largo swing play-brief — `tradeManagerNarrativeSection` (`src/lib/swing/play-brief-narrative.ts`) |
| **Severity** | P2 (member-facing narrative correctness — the brief's own "why" disclosure was silently wrong, not just incomplete) |
| **Status** | FIXED — `fix/trim-reason-clause-non-profit-rungs` |

### Root cause

`manage.ts`'s `evaluateSwingManagement` has six rungs that all map to the same `TAKE_PARTIAL`
action (`catalyst_shift`, `regime_shift`, `profit_ladder`, `flow_decay`, `rel_strength_loss`,
`vol_collapse` — see its own file-header precedence table). `TerminalPlay.manageReason` carries
whichever one actually fired. But `tradeManagerNarrativeSection`'s TRIM branch never read
`manageReason` at all — the "Desk says TRIM" bullet always rendered purely mechanical trim-ladder
rail text (`— next rail at +100%`), regardless of which rung produced the recommendation. When the
real rung was `profit_ladder` this is accurate (the rail IS the reason). For the other five rungs
it is a non-sequitur: the position may be nowhere near the rail, and the bullet that is supposed to
explain "why TRIM" never named the actual driver.

This is the identical defect class already fixed on the SELL side of this exact file (FINDINGS
2026-09-10, `sellReasonClause`, live NRG repro) — TRIM never got the equivalent fix.

### Evidence

Live repro, 2026-09-17, three real open swing-native positions simultaneously:

| Position | Real `manageReason` | Peak / current P&L | Brief said |
|---|---|---|---|
| CRWD SWING:CRWD:39 | `catalyst_shift` | +39.2% peak, -16.3% now | "Desk says TRIM — next rail at **+100%**." (no reason) |
| AAPL SWING:AAPL:38 | `rel_strength_loss` | +8.4% peak, -8% now | "Desk says TRIM — next rail at **+100%**." (no reason) |
| AAPL SWING:AAPL:37 | `rel_strength_loss` | +18.6% peak, round-tripped | "Desk says TRIM — next rail at **+100%**." (no reason) |

`manageReason` confirmed directly off `GET /api/market/nighthawk/horizons?view=swings`'s
`SCALING_OUT` rows (the raw field, not the narrative) for all three — none of the three had ever
been within 60+ points of the +100% rail the bullet named as the only context, and the real
driver (a broken catalyst / lost relative strength vs benchmark) was disclosed nowhere in the
section whose whole purpose is to state the desk's reasoning.

### Blast radius

Single call site — `tradeManagerNarrativeSection`'s TRIM branch is the only place this bullet is
built (`laneRankCoaching`/other coaching bullets are separate, unaffected sections). Every WATCH/
OPEN swing play-brief whose recommendation is TRIM for a non-`profit_ladder` reason was affected;
`profit_ladder` (the majority case in prior audits, e.g. the CG/NN/NRG repros already in this
file's comments) already read correctly and is unchanged by this fix.

### Fix rationale

Added `trimReasonClause(reason)`, mirroring the existing `sellReasonClause` in shape and, for the
two shared rungs (`catalyst_shift`/`regime_shift`), exact wording — for `flow_decay`/
`rel_strength_loss`/`vol_collapse` it reuses the identical reason text `manage.ts` itself already
generates (lines 345/348/351) so the brief never invents a second description of the same event.
Wired in ahead of the existing `railClause` so both compose: `"Desk says TRIM — catalyst shifted
against the thesis — next rail at +100%."` — the real reason first, the rail as secondary context
(still true and still useful: it tells the member where the profit ladder's next rung sits if the
position recovers). `profit_ladder` (and any rung without a defined clause, plus `undefined` for
pre-manage-sync data) get `""` — no redundant clause on top of the already-accurate rail text.

Deliberately did NOT touch the rail-clause logic itself (already correct per the 2026-09-14
CG repro fix in the same block) or the `sellReasonClause` SELL-side function — this is a narrow,
single-branch fix mirroring an established, already-reviewed pattern in the same file.

### Verification

- `npx tsx --experimental-test-module-mocks --test src/lib/swing/play-brief-narrative.test.ts` —
  88/88 pass. RED→GREEN confirmed via `git stash` on the source fix alone: 2 of 4 new tests failed
  pre-fix (catalyst_shift and rel_strength_loss cases rendered rail-only text), 2 passed either way
  (profit_ladder unchanged-behavior test, and the RED run itself was diffed against the GREEN run
  to confirm exactly the expected two failures — no other regression).
- `npx tsx --experimental-test-module-mocks --test src/lib/swing/*.test.ts src/features/nighthawk/command-deck/*.test.ts` — 1651/1651 pass.
- `npx tsc --noEmit` — clean.
