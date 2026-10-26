> **kind:** `FINDING`

## Meridian earnings "calendar feed did not respond" banner fires falsely on a guidance-only outage, claiming print history/estimates are unavailable when they are live — FIXED

**Status.** FIXED (this PR).

### Area

`src/lib/meridian/meridian-earnings-enrich.ts` (`loadMeridianEarningsEnrichment`),
`src/features/meridian/components/MeridianEarningsTabs.tsx` (the banner that reads the field).
Non-owned lane.

### Found by

DISCOVERY-lane live-UI sweep (`proxy-browser.cjs` against prod `/meridian`, desktop viewport),
2026-10-26.

### Symptom (live repro, NE earnings, 2026-10-26 ~12:59 AM ET)

The Summary tab rendered a banner: *"Earnings calendar feed did not respond — estimates and
print history are unavailable for this refresh. Everything else on this page is live."*
Simultaneously, the SAME page rendered real print-history-derived content directly below it:
`3/7 of this name's last prints reacted up` (call side), `4/7 of this name's last prints reacted
down` (put side), both with `n=7` — not zero, not a placeholder. The "PRINT HISTORY" evidence
pillar was lit (filled) as one of the three pillars behind "Evidence leans bearish." Print
history was plainly present and rendering correctly while the banner claimed it was unavailable.

### Root cause

`calendar_error` (type doc: *"Non-null when the earnings-calendar fetch failed — empty panels
must say WHY"*) was built from THREE independent fetches' errors, not one:

```ts
calendar_error:
  history.history_error ??
  (benzingaRes as { error?: string | null }).error ??
  guidanceRes.error ??
  null,
```

`history.history_error` (print-history fetch) and `benzingaRes.error` (calendar/estimates fetch)
are exactly what the banner's wording is about — both legitimate. But `guidanceRes.error` (the
corporate-guidance fetch) was ALSO folded in, even though guidance has nothing to do with the
calendar, estimates, or print history. The original intent (per the code's own comment) was
good: an outage must be distinguishable from "this company filed no guidance" — but the
mechanism used made a guidance-only failure set the SAME flag that drives a banner specifically
claiming print history and estimates are unavailable, which is false whenever only guidance
failed and the other two fetches succeeded (exactly the NE repro: `print_history` was populated,
`calendar_error` was still non-null from `guidanceRes.error` alone).

`print_history: history.print_history` is assigned unconditionally in the same return object,
independent of which of the three sources produced `calendar_error` — confirming the Summary
tab's "N/7 reacted" stats (`src/lib/meridian/meridian-summary-core.ts`'s `reactionStats`, fed
`prints: enrichment?.print_history ?? null`) can be fully populated at the exact moment the
banner claims print history is unavailable.

### Fix

Added `deriveMeridianEarningsErrors(historyError, calendarError, guidanceError)` to
`src/lib/meridian/meridian-benzinga-earnings-core.ts` — a pure helper returning two separate
fields: `calendar_error` narrowed to only `history.history_error ?? calendarError` (what the
banner is actually about), and a new `guidance_error` carrying the guidance fetch's own failure,
preserving the original absence-vs-outage goal for a guidance-specific error without conflating
it into an unrelated claim. Wired into `loadMeridianEarningsEnrichment` via a spread. Added
`guidance_error?: string | null` to `MeridianEarningsEnrichment`
(`src/features/meridian/lib/meridian-types.ts`) with a doc comment cross-referencing
`calendar_error`'s own updated doc comment.

No UI currently renders `guidance_entitled`/`guidance_on_file`/the new `guidance_error` directly
(confirmed via `grep -rln "guidance_entitled\|guidance_on_file" src/features/meridian/` — only
the type file references them) — out of scope here; this fix only stops the existing banner from
making a false claim, it does not add a new guidance-outage UI surface.

### Evidence

RED→GREEN: 5 new unit tests for `deriveMeridianEarningsErrors` in
`meridian-benzinga-earnings-core.test.ts`, including the exact regression case (a guidance-only
failure must not set `calendar_error`). Confirmed RED via `git stash` on the lib-only change
(5/5 new tests fail, `is not a function`), GREEN restored (32/32 pass in that file).
`npx tsc --noEmit` clean. Full suite: 16984 pass / 0 fail / 3 pre-existing skips.

### Blast radius

`calendar_error` has exactly one other producer in the repo
(`src/lib/largo/run-tool.ts:898`), a structurally different, independently-built object for a
Largo tool response — **Largo-owned, not touched**. The only consumer of the Meridian
`calendar_error` field is the one banner in `MeridianEarningsTabs.tsx` (confirmed via
`grep -rn "calendar_error" src/features/meridian/ src/lib/meridian/`). `print_history`,
`street_estimates`, `guidance_entitled`, `guidance_on_file`, `corporate_guidance` and every other
field in the enrichment object are unchanged — only the two error-flag fields were touched.
