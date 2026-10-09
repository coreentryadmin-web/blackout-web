## 2026-10-08 — [FINDING, largo-swing] Play-brief "Leader: X @ score" cross-reference could name a structurally-uncommittable peer with no disclosure — FIXED

> **kind:** `FINDING`

| Field | Value |
| --- | --- |
| **Status** | FIXED |
| **Severity** | P3 (no wrong number served — score/rank/median are all real and correctly computed; the defect is presentation-only: the narrative implies "go look at this one, it's worth confirming" about a ticker that cannot actually fire a commit right now for a plumbing reason, not a setup-quality one) |
| **Component** | `src/lib/swing/play-brief-lane-rank.ts` (`computeLaneRank`, new `topLegacyExemptOnly` field), `src/lib/swing/play-brief-narrative-coaching.ts` (`laneRankCoaching`'s below-median branch) |
| **PR** | fix/swing-play-brief-leader-legacy-exempt-caveat |
| **Found via** | Ask Largo standing mandate — routine WATCH-board forensics + play-brief deep audit, 2026-10-08 19:02 UTC cycle; raised as a design-level idea on PR #4076 comment 6067024911, confirmed "still open, unclaimed" by a parallel coordinator session's comment 6079698901 the next morning before this fix was implemented |

### Root cause

`laneRankCoaching`'s below-median branch names the lane's top-ranked eligible peer as a "Leader" to
compare against — e.g. `GET /api/market/swing/play-brief?playId=SWING:GOOGL` (live, 2026-10-08
19:02 UTC) rendered *"Below lane median — #14/16 (score 36, -27.5 vs median). Leader: **VST** @
**76** — confirm before adding size."* `computeLaneRank` already excludes a leader candidate whose
own `manageAction` says exit/reduce or whose `setupState` is `INVALIDATED` (both already-handled,
tested cases — see the function's own doc comments for the 2026-09-12 live repros that added those
guards), but it had no equivalent exclusion/caveat for a peer blocked purely by
`commitGateBlockedBy: ["legacy:exempt"]` — the `LEGACY_COMMIT_GATE_EXEMPT` constant
(`entry-gate-constants.ts`) stamped on every Legacy-morning-confirm-promoted thesis whose commit-loop
wiring (`#5577`'s `legacyCommitCandidatesFromSnapshot`) was shipped+tested but never called from the
live discovery loop (confirmed unwired as of this writing — the follow-up PR #5753 that wires it
ships flag-gated OFF, pending separate operator sign-off since it's a live-trading-path change).

That block reason is structural/plumbing, not a real gate rejection (regime/cortex/confluence/etc.)
— live-verified the same cycle: VST (score 76), MUU (64), MRVL (51) and TER (83, flagged the day
before) all sat on the WATCH board with `commitGateBlockedBy` reading exactly `["legacy:exempt"]`
and nothing else, meaning they can never commit right now regardless of how strong their own setup
is. A trader reading a *different* ticker's brief (GOOGL's, in the live repro) had no way to know
the named "Leader" couldn't actually fire — the cross-reference doesn't carry the same disclosure
VST's own brief presumably shows for its own entry section.

### Evidence

Live envelope, `GET /api/market/swing/play-brief?playId=SWING:GOOGL&ticker=GOOGL` (2026-10-08
15:02 ET): `"Trade manager read"` section body included
`"Below lane median — #14/16 (score 36, -27.5 vs median). Leader: **VST** @ **76** — confirm before
adding size."`. Same-tick `GET /api/market/nighthawk/horizons?view=swings` WATCH list:
`{"ticker":"VST","setupState":"FORMING","entryStatus":"PRE_TRIGGER","score":76,"commitGateBlockedBy":["legacy:exempt"]}`
— VST's only listed block is the structural one, confirmed repeatedly across the trading day (also
observed on MUU/MRVL at scores 64/51, and TER at 83 the prior day).

### Fix rationale

Added `topLegacyExemptOnly: boolean` to `LaneRankSnapshot`, computed narrowly: true only when the
named leader's `commitGateBlockedBy` is *exactly* `["legacy:exempt"]` (length 1, that one value) —
not merely "includes" it. A peer blocked by `legacy:exempt` *alongside* a real gate (e.g.
`gate:G-S4:regime_degraded`) is not purely a plumbing block (the real gate would have stopped the
commit anyway), so the caveat must not fire there — covered by its own test
(`computeLaneRank: topLegacyExemptOnly is false when the named leader also carries a real gate
block`).

`laneRankCoaching`'s below-median branch (the one that actually produces the live-rendered text)
swaps the trailing `" — confirm before adding size"` for
`" (structurally blocked from committing — pending #5577 wiring, not a live gate)"` when
`topLegacyExemptOnly` is true, keeping the honest score/rank/median comparison intact and only
changing the implication that attaches to the specific named ticker. `play-brief-lane-rank.ts`'s own
`laneRankSection` (a separate, simpler "Desk leader:" rendering used elsewhere) gets the equivalent
caveat for consistency, though live traffic currently renders through `laneRankCoaching`'s folded
text.

**Why caveat, not suppress:** unlike the EXIT_RUNNER/INVALIDATED cases (which skip to the *next*
eligible peer, because naming an exiting/broken position as "the one to look at" is actively wrong
advice), a `legacy:exempt`-blocked peer's own setup quality is unaffected by the plumbing gap — VST
really is the lane's strongest WATCH candidate by score. Skipping it entirely would hide a real
signal; the fix discloses the caveat instead so the comparison stays informative without implying
an imminent trigger.

**Scope boundary, deliberately not touched:** this is presentation-layer only. The actual #5577
commit-loop wiring (giving Legacy-promoted theses a real path to commit) is separate, larger,
live-trading-path scope — already built in PR #5753 by a parallel session, shipped inert behind
`SWING_LEGACY_COMMIT_BRIDGE_ENABLED` (default off), explicitly held for operator sign-off per the
standing CARVE-OUT. Nothing in this PR changes what can or cannot commit.

### Evidence that the fix is real (RED → GREEN)

`git stash push` on just the two implementation files (kept the four new/modified tests): the new
`laneRankCoaching` caveat test failed with the exact live-repro text
(`'**Below lane median** — **#2/2** (score **36**, -20 vs median). Leader: **VST** @ **76** —
confirm before adding size.'`, no caveat) while the companion "real gate" and "no block" tests
(deliberately unaffected cases) still passed. After `git stash pop`, all 187 tests in
`play-brief-lane-rank.test.ts` + `play-brief-narrative-coaching.test.ts` passed, including the 5 new
ones (3 unit tests on `computeLaneRank.topLegacyExemptOnly`, 2 on `laneRankCoaching`'s rendered
text). `npx tsc --noEmit` clean.
