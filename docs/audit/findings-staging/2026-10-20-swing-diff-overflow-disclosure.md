## A swing play-brief's live "what changed" diff silently dropped changes beyond the 8th with no disclosure to the member — FIXED

> **kind:** `FINDING`

| **Status** | Fixed |
|---|---|

**Found:** 2026-10-20, Ask Largo standing mandate — a fresh-angle Workflow audit reading
`src/lib/swing/play-brief-diff.ts` source directly against
`docs/audit/LARGO-PRODUCT-CONTRACT.md`'s "absence" point (C3): a missing datapoint must be honestly
disclosed, never silently dropped.

**Root cause:** `diffBriefSnapshots` (`src/lib/swing/play-brief-diff.ts`) can push up to ~17
independent change facts into its `lines` array in one pulse (direction flip, thesis/P&L synthesis,
recommendation, mark, spot, gamma flip, call/put wall, HELIX flow, trims fired, roll-watch
triggered/cleared, entry-gates shifted, headline, section add/remove) but returned a bare
`lines.slice(0, 8)` with no comment justifying the cap and no disclosure anywhere downstream. A
refresh after a long gap (overnight, a multi-hour stall) can legitimately produce more than 8 real
changes, and the lowest-priority ones (e.g. "Entry gates shifted," "No longer showing: X") were
dropped with zero indication to the member that anything was cut — the member reads a
complete-looking "Since last read"/"What changed" pulse that is actually partial.

This is the exact silent-truncation shape `scripts/audit/largo-truncation-probe.mjs` was built to
catch on other Largo surfaces (three real shipped bugs: #2433, #2436, #2480) — just unguarded on
this particular surface. `envelopeWithNarrativePulse`'s own overflow logic (fans the array out across
"Since last read" + "What changed" sections) correctly handles everything it's handed — the loss
happens one layer earlier, inside `diffBriefSnapshots` itself, before that overflow handling ever
sees the extra lines.

**Live impact:** reachable on any swing play-brief refresh where more than 8 independently-diffed
facts change in one tick — not a constant occurrence, but a realistic one after any multi-hour gap
(overnight, a stalled refresh, a member re-opening the brief after a while away).

**Fix:** When `lines.length` exceeds the existing 8-line cap, append one disclosure line —
`"+N more change(s) this refresh (not shown — see the live board for full detail)."` — naming the
exact count of changes that didn't make the cut, instead of silently dropping them. When the cap
isn't hit, behavior is unchanged (returns `lines` as-is).

**Fix rationale:** Kept the existing 8-line cap itself (a reasonable readability bound for a single
pulse) — the defect was the silence, not the cap. Named the overflow count rather than a vague "more
changes happened" so a member can judge for themselves whether to go check the full board. Did not
touch `envelopeWithNarrativePulse`'s own overflow-fanning logic, which already correctly distributes
whatever array it's handed (the disclosure line itself flows through that same logic like any other
change line, landing in whichever section the overflow-fan places it).

**Blast radius:** single function, one return statement. The one consumer
(`envelopeWithNarrativePulse` → `useSwingPlayBrief.ts`'s SSE "Since last read" pulse) benefits
automatically with no call-site changes needed.

**Tests:** 1 new regression test constructing a prev/next snapshot pair that triggers 12 real
independent facts at once (recommendation, thesis, P&L, mark, gamma flip, call wall, put wall, HELIX
flow, trims fired, roll watch, gate blocks, headline — deliberately avoiding spot movement so the
cross-field synthesis rules don't consume/merge any of these into fewer lines) — asserts the
returned array is exactly 8 real lines + 1 disclosure line reading `"+4 more changes this refresh..."`.
RED→GREEN proven via `git stash` (1/1 new test fails pre-fix — the pre-fix array truncates to exactly
8 with no 9th disclosure line — passes post-fix). `tsc --noEmit` clean. Full suite green on Node 20.
