## `researchGateBlocks` had no case for `entryWindowExpired`, so a lapsed-but-real triggered setup showed a misleading "thesis needs more work" reason — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Area** | Ask Largo / Night Hawk Swings — WATCH-lane RESEARCH-bucket entry verdict |
| **Severity** | P3 (member-facing narrative correctness — a real, mature setup reads as thesis-rejected rather than stale-entry, no trading-path/gate change) |
| **Status** | FIXED |
| **Files** | `src/lib/swing/entry-verdict.ts` (`SwingEntryVerdictInput`, `researchGateBlocks`), `src/features/nighthawk/command-deck/adapters.ts` |

### Root cause

`sectionForSwingPlay` (`serving.ts`) routes a pre-entry play to `RESEARCH` for four distinct
reasons, in precedence order: cross-session persistence gap, unclassified (no setup-maturity
read), thesis `INVALIDATED`, or — checked last, per the 2026-09-12 fix for the live META/MU/AMD
repro — `entryWindowExpired === true` (a real, triggered setup whose 2-5 day clean-fill window has
already lapsed). That 2026-09-12 fix (see the `watchEntryExpired` comment in `adapters.ts`) wired
the expiry signal into the WATCH-pill display so a stale name reads EXPIRED instead of a generic
WAIT pill — but it only fixed that ONE consumer.

`swingEntryVerdict`'s sibling `researchGateBlocks` function — which supplies the `gateBlocks`
reason and `recNote` for every RESEARCH-bucket row's entry verdict (consumed by both the Command
Deck and Ask Largo's play-brief for pre-entry candidates) — has explicit cases for persistence-gap,
unclassified, and `INVALIDATED`, but never checked `entryWindowExpired` at all; the type
`SwingEntryVerdictInput` didn't even carry the field. So any row landing in RESEARCH solely because
its entry window lapsed (not because the thesis is thin) fell through to the generic fallback:
`"Desk is passing this name — thesis needs more work before it can be served."` — actively
misrepresenting a real, still-scoring setup as a rejected one.

`adapters.ts` already computes `watchEntryExpired` (from `evaluateSwingEntryEnterability`'s
`expired` flag) in the exact same function that builds the `swingEntryVerdict(...)` call — it was
simply never passed through, the same "computed but not threaded to a sibling consumer" shape as
several other fixes already logged this session.

### Evidence

Live repro, 2026-09-25 ~09:16 UTC: `GET /api/market/nighthawk/horizons?view=swings`'s
`sections.RESEARCH` carried AMD — score **81.3**, `setupState: "TRIGGERED"`,
`entryStatus: "AT_TRIGGER"`, real pillar factors (Rel. strength 31.1, Regime 22.2, Structure 18,
sector-leadership `SMH +17.77pp` vs the name), `firstSeenAt: "2026-07-30"` (57 days prior),
`"watchEntryExpired": true`. Before this fix, any Ask Largo/Command Deck consumer of
`swingEntryVerdict` for this row would have shown "thesis needs more work before it can be
served" for a setup that in fact triggered cleanly and simply ran out of entry window —
the opposite of what actually happened.

### Fix

Added `entryWindowExpired?: boolean | null` to `SwingEntryVerdictInput`; added a branch in
`researchGateBlocks` (checked after persistence-gap/unclassified/`INVALIDATED`, matching
`sectionForSwingPlay`'s own precedence — a row can only reach it once those three are ruled out)
returning `{ code: "entry_window_expired", reason: "This setup triggered, but its entry window
already lapsed — the thesis wasn't rejected, the clean-fill opportunity closed." }`. Threaded
`watchEntryExpired` through in `adapters.ts`'s `swingEntryVerdict(...)` call.

Regression test added (`entry-verdict.test.ts`): RED confirmed pre-fix (`git stash` on the two
source files) — the live-shaped AMD case fell through to `research_review`; GREEN post-fix —
resolves to `entry_window_expired` with the expiry reason, and does not match `/needs more work/`.
A sibling test confirms the generic fallback still fires when `entryWindowExpired` is `false`/absent
(no regression to the pre-existing catch-all). `tsc --noEmit` clean; 310/310 collateral tests pass
across `adapters.test.ts`, `entry-verdict.test.ts`, `serving.test.ts`, `play-brief.test.ts`,
`play-brief-resolve.test.ts`.

### Blast radius

`swingEntryVerdict` has exactly one call site repo-wide (`adapters.ts`'s `terminalPlayFromHorizon`),
which feeds both the Command Deck's WATCH-lane entry pill AND (via `play-brief-resolve.ts`) Ask
Largo's play-brief `recNote`/gate-block display for pre-entry candidates — both consumers get the
corrected reason with this one fix, no duplicated logic elsewhere.
