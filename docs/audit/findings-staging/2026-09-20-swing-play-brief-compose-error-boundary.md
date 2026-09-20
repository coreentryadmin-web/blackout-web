> **kind:** FINDING

## Ask Largo swing play-brief: composeSwingPlayBrief's OWN top-level sections lacked the same error boundary as buildIntelSections — PR TBD — fix/swing-play-brief-compose-error-boundary — 2026-09-20

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P2 |
| **Area** | Swing / Ask Largo play-brief |

**What was found:** PR #5288 (2026-09-20, same day) gave `buildIntelSections`'s ~20 intel sections
an error boundary after finding a throw in any one of them propagated all the way to the API
route's top-level catch and 503'd the entire brief. That PR's own write-up explicitly disclosed a
narrower, separate surface it deliberately did NOT touch: *"composeSwingPlayBrief's own top-level
bucket sections (Verdict/Entry/Management/Position/Outcome) and the evidence/levels builders are a
disclosed, separate follow-up not touched here."* This cycle's blast-radius sweep (CLAUDE.md's PR
write-up policy: "every other call site/consumer touched by the same root cause") checked that
exact surface and found the identical pattern, unfixed:

`composeSwingPlayBrief` (`src/lib/swing/play-brief.ts`) calls each of its own top-level section
builders — `watchEntrySection`, `managementSection`, `thesisHealthSection`, `pnlSection`,
`siblingPositionsNote`, `closedSection` — plus `evidenceFromContext`, `levelsFromContext`, and
`buildStructureLadder`, all bare, with no try/catch anywhere in this function. A single throw in
ANY of these propagates through to the same API route top-level catch
(`src/app/api/market/swing/play-brief/route.ts`) that #5288 fixed for the intel-section surface,
producing the identical `{available:false, degraded:true}` 503 for the whole brief.

**Reproduction:** `managementSection`'s `ep.trim_levels.map(...)` (play-brief.ts) is unconditional
whenever `play.exitPolicy` is set. `TerminalPolicyInput.trim_levels` (exit-policy.ts) is typed as a
required array, but nothing in `composeSwingPlayBrief` defended against a degraded/malformed row
carrying a different runtime shape — the exact same "typed non-optional, not actually guaranteed"
gap #5288 found in `TerminalPlay.factors`, just surfacing in a sibling function instead of the same
one. Constructing an OPEN play with `exitPolicy.trim_levels: undefined` and calling
`composeSwingPlayBrief` threw a real `TypeError` straight out of `managementSection` (proved via
`git stash` on `play-brief.ts` alone with the new test still present — RED). Post-fix, the call no
longer throws, the broken Management section is silently omitted, and every other top-level section
(Verdict, Position, Entry-context evidence/levels) still renders (GREEN).

**Why this wasn't caught by existing tests:** every existing `composeSwingPlayBrief` test
(`play-brief.test.ts`) constructs well-typed fixtures that satisfy `TerminalPlay`'s required
fields, so none exercised a genuinely malformed runtime shape on this specific surface — same root
cause as #5288's own explanation for why its sibling gap escaped detection.

**What changed:** added a `safeCompose<T>(label, build, fallback)` helper — the composition-level
twin of #5288's `safeSection`, but generic over a fallback value instead of always returning
`T | null`, since this surface also needs to protect array-returning builders (`evidence`/`levels`,
fallback `[]`) and a nullable-object builder (`structureLadder`, fallback `null`), not only
`RichSection | null` builders. Wraps: `watchEntrySection`, `managementSection`,
`thesisHealthSection`, `pnlSection`, `siblingPositionsNote`, `closedSection`,
`evidenceFromContext`, `levelsFromContext`, `buildStructureLadder`. A throw is logged server-side
(`console.error('[swing/play-brief] "<label>" threw — falling back, not failing the brief', error)`,
never surfaced to the member) and the composition continues with the fallback — silently omitted
for an optional section, an empty array for evidence/levels, `null` for the structure ladder.

**Scope (deliberately narrow, mirrors #5288's own discipline):** this fix covers ONLY
`composeSwingPlayBrief`'s own top-level calls — the exact surface #5288 disclosed as
out-of-scope for itself. `buildIntelSections`'s 20 sections are independently protected by #5288
(a separate, already-open PR, not touched or depended on here — this PR does not read or modify
`play-brief-intel.ts` at all, so it has no merge-ordering dependency on #5288 landing first or
after). `loadSwingPlayBriefContext` (the context-loading step before `composeSwingPlayBrief` is
even called) is untouched — a failure to load context at all has no partial brief to salvage, so
the route's existing top-level catch remains the correct behavior there.

**Evidence:**
- New regression test `composeSwingPlayBrief: a throwing top-level section (Management) does not
  take down the whole brief (error boundary)` (`src/lib/swing/play-brief.test.ts`) — RED pre-fix
  (`git stash` on `play-brief.ts` alone reproduces the unhandled `TypeError`), GREEN post-fix.
- `npx tsx --experimental-test-module-mocks --test src/lib/swing/play-brief.test.ts` → 91/91 pass
  post-fix (90/91 pre-fix with the new test present, RED confirmed on the added test specifically).
- `npx tsc --noEmit` → clean.
- Full suite (`npm test`, Node 20) → run in progress at write time; see PR for final pass count
  before merge.

**Blast radius:** `composeSwingPlayBrief`'s 9 top-level call sites in `src/lib/swing/play-brief.ts`
only. No section's own logic changed — every section still returns the exact same value on the
success path; only the failure path (previously: propagate) changed (now: log + fall back). No
other consumer of these exported/unexported section functions is affected — `safeCompose` only
wraps the call sites inside `composeSwingPlayBrief` itself.
