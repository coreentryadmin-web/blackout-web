## 2026-10-19 — [FINDING, swing] Seven top-level `composeSwingPlayBrief` section builders could fail silently with no `unavailableSources` disclosure — Largo C3 gap

> **kind:** `FINDING`

| Field | Value |
| --- | --- |
| **Status** | FIXED |
| **Severity** | P2 (WATCH — requires a degraded upstream row shape to trigger; the brief never crashes, the gap is a silent disclosure miss) |
| **Surface** | `src/lib/swing/play-brief.ts` — `composeSwingPlayBrief()` |

### Context

Part of the standing "Ask Largo × Night Hawk Swings" ownership mandate's non-skippable deep-dive
sub-task: audit the swing play-brief against `docs/audit/LARGO-PRODUCT-CONTRACT.md`'s ten points,
specifically hunting for dead-wired data and silent-absence gaps of the same shape as the already-
fixed `arsenal.unavailable_sources` bug (#4101) and the `entryTriggerDeadReason` shadowing bug
(#6261). Found while re-reading `composeSwingPlayBrief` end to end rather than relying on earlier
knowledge of the file (other lanes/sessions touch this same file routinely per the standing
collaboration protocol).

### Root cause

`safeCompose(label, build, fallback, onFailure?)` is this file's own error-boundary helper (added
2026-09-20, sibling of PR #5288's `buildIntelSections` protection): if `build()` throws, the
section is silently replaced with `fallback` (usually `null`, dropping the section) rather than
crashing the whole brief. The 2026-10-07 fix extended this with an `onFailure` callback
specifically for the `evidence`/`levels` builders, so a thrown builder there gets folded into
`envelope.unavailableSources` instead of being indistinguishable from "this product genuinely has
nothing to show" — the exact Largo C3 absence principle ("any fallback that returns a degraded
result the caller cannot distinguish from a real one is a defect even when every test passes").

That `onFailure` wiring was never extended to the other seven `safeCompose` call sites in this same
function: `watchEntrySection` ("Entry"), the WATCH-bucket and OPEN-bucket `siblingPositionsNote`
calls ("Other concurrent position(s)"), `managementSection` ("Management"), `thesisHealthSection`
("Thesis health"), `pnlSection` ("Position"), `closedSection` ("Outcome"), and
`buildStructureLadder` (the `structureLadder` envelope field). Each was still called as
`safeCompose(label, fn, null)` — three args, the ORIGINAL 2026-09-20 shape, pre-dating the fourth
`onFailure` parameter added 2026-10-07 for evidence/levels only. The existing regression test for
this exact error boundary ("composeSwingPlayBrief: a throwing top-level section (Management/
Position) does not take down the whole brief") already proved these seven sections can throw on a
realistic degraded row (a malformed `exitPolicy.trim_levels`) and get silently dropped — it just
never checked whether that drop was disclosed anywhere, because until this fix it genuinely was
not.

Concretely: a member asking Largo "how should I manage this open position" on a row whose
`exitPolicy.trim_levels` came back malformed got a brief with no Management section, no Position
(P&L!) section, and zero trace in `unavailableSources` — indistinguishable from "nothing to
report" for two of the brief's most load-bearing sections.

### Secondary defect found while implementing: wrong ordering for `structureLadder`

`structureLadder` was originally computed inline inside the envelope object literal, which is
built *after* `unavailableSources` is already assembled from `buildFailures`. Simply adding
`trackBuildFailure` as a fourth argument there (without moving the computation) would have pushed
to `buildFailures` too late to ever reach the `unavailableSources` array already baked into the
envelope — the ordering, not a missing argument, was the real defect for this one call site. Fixed
by hoisting the `structureLadder` computation to a local `const`, before `unavailableSources` is
assembled, and referencing that local in the envelope literal instead of calling `safeCompose`
inline there.

### Fix

1. Hoisted `const buildFailures: string[] = []; const trackBuildFailure = ...` from its previous
   position (declared only after the bucket branches, immediately before the `buildIntelSections`
   call) to immediately after `sections` is initialized — before the `if (bucket === "watch") ...`
   branches — so every top-level `safeCompose` call in this function can feed the same collector.
2. Added `trackBuildFailure` as the fourth argument to all seven previously-bare `safeCompose`
   calls: the WATCH-branch `watchEntrySection`/`siblingPositionsNote` calls, the OPEN-branch
   `managementSection`/`thesisHealthSection`/`pnlSection`/`siblingPositionsNote` calls, and the
   CLOSED-branch `closedSection` call.
3. Moved the `structureLadder` computation to a local `const` before `unavailableSources` is
   assembled (see "Secondary defect" above), keeping the same `safeCompose("structureLadder", ...,
   null, trackBuildFailure)` call, and referenced the local in the envelope literal.

No change to `safeCompose` itself, to `buildIntelSections`'s already-protected 20 sections, or to
the evidence/levels builders — this is purely closing the SAME disclosure gap those already-fixed
call sites close, for the seven call sites that were missed when the pattern was first introduced.

### Evidence (RED → GREEN)

Extended the existing regression test ("a throwing top-level section (Management/Position) does
not take down the whole brief") with two new assertions: `unavailableSources` must contain an
entry with `what_is_missing === "Management"` and one with `what_is_missing === "Position"` for the
same malformed-`trim_levels` fixture the test already uses to prove the sections are dropped.

- **Pre-fix (`git stash` of `play-brief.ts` only, test kept):** `not ok 7` —
  `AssertionError: a Management build failure must be disclosed via unavailableSources, not
  silently dropped (Largo C3)`, `expected: true, actual: false`.
- **Post-fix (`git stash pop`):** all 155 tests in `play-brief.test.ts` pass, including both new
  assertions.

`npx tsc --noEmit` clean both before and after (the pre-fix state for this RED/GREEN check was the
test-only stash, not a type-error state).

### Blast radius

Confined to `src/lib/swing/play-brief.ts`'s own `composeSwingPlayBrief` — `safeCompose` itself,
`buildIntelSections`'s sections, and the evidence/levels builders were already correctly wired and
are untouched. No other composer in the repo uses this specific `safeCompose` helper (it is a
private, file-local function), so this fix does not generalize to other Largo-facing products —
each product's own composer would need the equivalent audit if it has a similar error-boundary
pattern.
