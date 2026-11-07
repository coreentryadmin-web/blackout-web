# Meridian reaction qualifier misses the "reaction_pct never computed" case — a bare session read can render as a clean, unqualified reaction

> **kind:** FINDING

| **Status** | FIXED |
|------------|-------|
| **Area** | `src/features/meridian/lib/meridian-reaction-display.ts` (`reactionQualifier`, `settledReactions`) |
| **Severity** | P2 — correctness/display (silent data-correctness defect, no outage) |

## Root cause

`reactionQualifier()` exists specifically to stop a provisional or wrongly-anchored earnings
reaction from rendering as if it were a clean, settled measurement (its own header documents two
prior incidents of exactly this: an unsettled BEKE print and an `assumed_report_session` sign
flip). It checks two conditions, in order:

1. `print.reaction_settled === false` → "live" (still forming).
2. `print.reaction_basis === "assumed_report_session"` → "assumed" (wrong-session guess).
3. Otherwise → `null` (no caveat, render the number plainly).

Every render site in this feature displays `reaction_pct ?? session_change_pct` (the fallback the
`PrintLike`/`MeridianEarningsPrint` type comments describe as "pre-#2483 payloads only, where the
two agree"). But `reactionForPrint` (`src/lib/meridian/meridian-reaction-core.ts`) can leave
`reaction_pct: null` on a **current, fully-resolved** BMO/AMC print while still stamping
`reaction_basis` and `session_change_pct` — whenever the bar needed to anchor the gap (the report
date's own close for AMC, the prior session's close for BMO) isn't present in the fetched window,
but the anchor session's own bar resolved fine. In that state:

- `reaction_pct` is `null` (the real, gap-inclusive reaction could not be measured).
- `session_change_pct` is non-null (the anchor session's own bare open→close — NOT the reaction;
  see `loadMeridianEarningsPrintHistory`'s own header on why conflating the two "disagreed in
  sign with the market on ~a third of post-close prints").
- `reaction_basis` is set to `"amc_next_session"`/`"bmo_session"` — **not** `"assumed_report_session"`.
- `reaction_settled` is `null` — **not** `false` (`reactionForPrint` only sets `reaction_settled`
  when `reaction_pct` itself exists).

Neither of `reactionQualifier`'s two checks fires on this combination, so it falls through to
`return null` — "nothing to flag, render it plainly" — even though the value about to render
(`session_change_pct`, via the universal `?? ` fallback) is not the reaction at all.

## Evidence

Reproduced directly against the real, unmodified `reactionForPrint`:

```js
import { reactionForPrint } from "./src/lib/meridian/meridian-reaction-core.ts";

const byYmd = new Map([
  ["2026-03-03", { o: 100, h: 102, l: 99, c: 101 }], // anchor session only
]);
reactionForPrint(byYmd, ["2026-03-03"], "2026-03-02", "amc", null);
// => {
//   session_change_pct: 1,
//   next_day_change_pct: null,
//   reaction_basis: "amc_next_session",
//   reaction_pct: null,
//   reaction_measure: null,
//   reaction_settled: null,
//   reaction_includes_prior_drift: null
// }
```

`reactionQualifier(...)` on that exact shape returned `null` before this fix — RED on the new test
`reaction_pct null but session_change_pct present (AMC gap-anchor bar missing) is flagged, never
rendered as a clean reaction` (verified by `git stash`-ing just the fix file and re-running
`meridian-reaction-display.test.ts`).

This is a real, reachable shape, not a contrived one: the AMC branch's anchor for `priorClose` is
`byYmd.get(reportYmd)` — the report date's OWN bar — which can be absent from the fetched window
whenever a provider gap, a limit-truncation, or a report date landing right at the edge of the
retained window drops it, while the very next session (the "anchor") is still present and
resolves normally. `barLimitForWindow`'s own history in this codebase (see
`meridian-reaction-core.ts`'s comments and `CLAUDE.md`'s "Polygon aggregate `limit`" note) is
exactly the kind of truncation that produces this.

## Blast radius

Every current consumer of `reactionQualifier`/`settledReactions` is affected, since the gap is in
the shared qualifier itself, not any one render site:

- `src/features/meridian/components/meridian-ui.tsx` — `ReactionFlag` (the badge rendered at
  three sites per its own header).
- `src/features/meridian/components/MeridianEarningsHistoryPanel.tsx`.
- `src/lib/meridian/meridian-earnings-history.ts` — `printHistorySummary`'s average-reaction line
  (via `settledReactions`).
- `src/lib/meridian/meridian-sector-core.ts` — `summarizePeerReaction` (via `settledReactions`),
  which pools reactions across a peer cohort.
- `src/features/meridian/components/MeridianEarningsTabs.tsx`'s own "Raw EPS vs estimate per
  print" details list, which does the `reaction_pct ?? session_change_pct` fallback inline next to
  a `<ReactionFlag print={row} />` that — before this fix — could not catch this specific case.

## Fix rationale

Added a third check to `reactionQualifier`, after the existing two (so a genuine "live"/"assumed"
read is never second-guessed): when `print.reaction_pct == null` — meaning the real reaction was
never computed — but the first early-return didn't fire (because `session_change_pct` is
non-null, so a number WILL render), return a provisional qualifier (`kind: "assumed"`, reusing the
existing visual language rather than inventing a third badge color) explaining that the shown
number is a bare session read, not the gap-inclusive reaction.

Deliberately left unchanged: `reactionForPrint`'s own `reaction_basis` computation. It is gated by
`measured` (true whenever `session_change_pct`/`next_day_change_pct`/`reaction_pct` is non-null)
rather than strictly by `reaction_pct != null` — inconsistent with the sibling
`reaction_measure`/`reaction_settled`/`reaction_includes_prior_drift` fields, which *are* gated
that way. That inconsistency is arguably a second, smaller issue, but fixing it would change what
`reaction_basis` means for every consumer of `PrintReaction` (several of which live in the
excluded Largo tree and were not auditable in this round), which is a larger, riskier surface than
this single-issue PR should take on. The display-layer fix here is self-contained, closes the
actual member-visible defect (a mislabeled number reaching a render site unflagged), and does not
require touching `meridian-reaction-core.ts` at all.

## Test

`src/features/meridian/lib/meridian-reaction-display.test.ts` — new test constructs the exact
field combination `reactionForPrint` produces in this scenario (for both AMC and BMO bases) and
asserts `reactionQualifier` now returns a provisional qualifier, and that `settledReactions`
excludes the row. Verified RED before the fix (via `git stash` on the fix file alone) and GREEN
after. `npx tsc --noEmit` clean.
