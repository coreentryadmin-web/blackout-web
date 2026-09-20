> **kind:** FINDING

## Ask Largo swing play-brief: one throwing intel section took down the entire brief — PR TBD — fix/swing-play-brief-intel-error-boundary — 2026-09-20

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P2 |
| **Area** | Swing / Ask Largo play-brief |

**What was found:** `buildIntelSections` (`src/lib/swing/play-brief-intel.ts`) composes ~20
independently-optional narrative sections (Trade manager read, Why this setup, Book context,
Archetype/Ticker track record, Cortex read, Lane rank, Chart technicals/levels, GEX posture, Wall
dynamics, Vector desk, Flow intel, Catalysts, Meridian catalyst/peer, Macro tape, Desk consensus,
Data freshness, Watch for/Hold plan, Lessons) by calling each builder bare, with no try/catch
anywhere in this function or in the caller, `composeSwingPlayBrief` (`src/lib/swing/play-brief.ts`).
Each builder chases nontrivial `??`/`.reduce()`/`.toFixed()`/`.slice()` reads off live
ecosystem/vector/GEX/flow data — this exact file's own extensive "GAP FOUND"/"BUG FOUND" comment
history is a running record of how many null-shape edge cases have already surfaced live in exactly
these sections. Because none of the calls was ever isolated, a single new edge case in ANY ONE
section throws straight through `buildIntelSections`, through `composeSwingPlayBrief`, to the API
route's top-level catch (`src/app/api/market/swing/play-brief/route.ts`), which returns
`{available:false, degraded:true}` (HTTP 503) — the **entire brief** disappears for that member
(Verdict/Position/Management included), even though 19 of the 20 intel sections, and every other
part of the envelope, would have built perfectly fine.

**Reproduction:** `TerminalPlay.factors` is typed as a required array, but nothing defended
against a degraded/malformed upstream row carrying a different shape at runtime. Constructing a
play with `factors: undefined` and calling `whyThisSetupSection` directly (the very first section
`buildIntelSections` builds, pushed unconditionally) throws a real `TypeError` inside its
`play.factors.slice(0, 10)` call. Pre-fix, calling `buildIntelSections` with that same play threw
the identical error straight out of the function (proved via `git stash` on the source file with
the new test still present — RED). Post-fix, the call no longer throws, the broken "Why this
setup" section is silently omitted, and every other section (`Trade manager read`, `Watch levels`,
etc.) still renders (GREEN).

**Why this wasn't caught by existing tests:** every existing `buildIntelSections` consumer test
(`play-brief.test.ts`, `play-brief-intel.test.ts`) constructs well-typed fixtures that satisfy
`TerminalPlay`'s required fields, so none exercised a genuinely malformed runtime shape — the exact
population most likely to originate from a real degraded upstream read in production.

**What changed:** added a `safeSection<T>(title, build)` helper that wraps each per-section builder
call in `buildIntelSections` in a try/catch — a throw is logged server-side
(`console.error("[swing/play-brief] intel section \"...\" threw — omitting it, not failing the
brief", error)`, never surfaced to the member) and treated exactly like the section's own
legitimate `null` return: silently omitted, not fatal. This is the composition-level twin of this
file's own "absence must be disclosed, never silent" principle (Largo product contract C3) — a
section that *can't* be built is exactly as absent as one that decided it had nothing to say, and
one broken section must never cost a member the other nineteen.

**Scope (deliberately narrow):** this fix covers the per-section calls inside `buildIntelSections`
— the largest surface (20 call sites), and the cleanest to wrap since every one of them is already
`RichSection | null`-shaped, making the wrap a pure behavior-preserving change on the success path
(verified: full suite unchanged pass count aside from the new test). The bucket-specific top-level
sections in `composeSwingPlayBrief` itself (Verdict/Entry/Management/Position/Outcome,
`evidenceFromContext`, `levelsFromContext`, `buildStructureLadder`) remain a separate, smaller
surface **not** touched by this PR — a natural, disclosed follow-up, kept out to preserve the
standing single-issue-per-PR policy.

**Evidence:**
- New regression test `buildIntelSections: a single section throwing does not take down the whole
  brief (error boundary)` (`src/lib/swing/play-brief-intel.test.ts`) — RED pre-fix (`git stash` on
  `play-brief-intel.ts` alone reproduces the unhandled throw), GREEN post-fix.
- `npx tsx --experimental-test-module-mocks --test src/lib/swing/play-brief-intel.test.ts` →
  173/173 pass post-fix.
- Full suite: `npm test` on Node 20 — pending final confirmation in this cycle's run (kicked off
  before this file was written; see PR for final pass count before merge).
- `npx tsc --noEmit` → clean.

**Blast radius:** `buildIntelSections`'s 20 call sites in `src/lib/swing/play-brief-intel.ts` only.
No section's own logic changed — every section still returns the exact same value on the success
path; only the failure path (previously: propagate) changed (now: log + omit). No other consumer of
these exported section functions (unit tests calling them directly, e.g. `holdPlanSection` in
isolation) is affected — `safeSection` only wraps the call sites inside `buildIntelSections`.
