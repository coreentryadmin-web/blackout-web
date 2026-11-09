# 2026-11-09: Night Hawk Legacy's member/Largo-facing `recap_only_reason` never disclosed a discovery-lane fetch FAILURE, even after #7745 already computed and alerted ops on it

> **kind:** `FINDING`

| **Status** | FIXED |
|---|---|

## Summary

Night Hawk Legacy's evening edition builds its candidate pool from **seven** independent
discovery lanes (`extractMultiSourceCandidates`, `src/features/nighthawk/lib/candidates.ts`):
`flow`, `oi_change`, `unusual_trades`, `catalyst`, `predictions`, `movers`, `breakout`. When all
seven return zero candidates, the edition publishes a recap-only row whose `recap_only_reason`
field is the ONLY place a member, or Largo's `get_nighthawk_edition` tool
(`src/lib/largo/nighthawk-edition-for-model.ts`), ever sees why the board came back empty.

PR #7745 (merged, commit `dc67e3bfa`) already fixed a related but different bug: the internal
ops-only Discord alert (`alertRecapOnlyIfAnomalous`) used to check only the `flow` lane's own
fetch-failure flag before deciding whether a zero-candidate night was "benign" (no page) or
"anomalous" (page ops) — it now checks all 7 lanes via `anyDiscoveryLaneFetchFailed`. That fix is
correct and complete for its own scope: the ops alert.

**This finding is the narrower, still-open half #7745 did not touch.** The same 7 per-lane
`*_fetch_failed` booleans (`DiscoveryLaneFetchFailures`, already computed on `MarketWideContext`
and already threaded into the ops alert) were never passed into `zeroCandidatesRecapReason` —
the function that builds the MEMBER/LARGO-FACING `reason` string. Confirmed by reading
`edition-funnel.ts`/`edition-builder.ts` on `main` at commit `9407e9069` (current tip at the time
this finding was raised): `zeroCandidatesRecapReason`'s signature took only the 7 raw counts, with
no parameter for the failure flags at all, so it was structurally unable to disclose a failure —
and the call site in `edition-builder.ts` (~line 882, pre-fix) built `reason` from
`zeroCandidatesRecapReason({...counts})` with no failure flags, then on the very next lines built
the SAME `DiscoveryLaneFetchFailures` object a second time to pass into `alertRecapOnlyIfAnomalous`
— the already-built, still failure-blind `reason` is what flowed into `publishRecapOnlyEdition`
and from there into the edition row's `recap_only_reason` column.

So on a night where, say, the `movers` lane's own upstream fetch threw (a real possibility —
CLAUDE.md's own environment notes document the Polygon/Massive real-time-snapshot family, which
`fetchMarketMovers` depends on, as entitlement-blocked as recently as 2026-11-08), a member or
Largo reading `recap_only_reason` saw e.g. `"No candidates from any source (flows 0, OI 0, unusual
0, catalyst 0, predictions 0, movers 0, breakout 0)."` — identical in every character to a night
where every lane genuinely found nothing. Ops got paged (per #7745's fix); the member/Largo-facing
text did not change at all. This is a direct violation of
`docs/audit/LARGO-PRODUCT-CONTRACT.md`'s absence principle: "absence must be disclosed, never
silent" — here a real fetch failure was indistinguishable from a confirmed absence in the one
field external consumers actually read.

## Root cause

`zeroCandidatesRecapReason` (`edition-funnel.ts`) was a pure function of the 7 lane counts only —
it had no notion of *why* a count was zero, only that it was. `DiscoveryLaneFetchFailures` and
`failedDiscoveryLaneNames` already existed (added by #7745) and were already correct, but nothing
threaded them into this specific function; #7745's own fix scope was the ops-alert decision
(`alertRecapOnlyIfAnomalous`'s `benign` branch), not this reason string, and its own staged
finding (`2026-11-09-legacy-recap-only-silent-outage-gap.md`) explicitly describes the string as
"purely additive text, no field removed" — accurately describing what it changed (4→7 lane
counts), not claiming to have added failure disclosure to it.

## Fix

1. **`edition-funnel.ts`**: `zeroCandidatesRecapReason` now takes an optional second parameter,
   `failures?: DiscoveryLaneFetchFailures | null`. A new private helper,
   `fetchFailureDisclosureClause`, reuses the existing `failedDiscoveryLaneNames` to build a
   disclosure clause naming every lane whose fetch genuinely failed, appended to the base 7-count
   sentence:
   - 0 lanes failed (or `failures` omitted/null) → clause is `""`, output is byte-identical to
     before this fix.
   - 1 lane failed → `"... Note: movers data could not be fetched (upstream provider error) —
     this count reflects a fetch failure, not a confirmed absence."`
   - 2+ lanes failed → pluralized: `"Note: catalyst, movers data could not be fetched (upstream
     provider error) — these counts reflect fetch failures, not confirmed absences."`
   A small `LANE_DISPLAY_NAMES` table maps each flag's lane key (`oi_change`, `unusual_trades`,
   …) to the same display word the count sentence already uses (`OI`, `unusual`, …) so the two
   halves of the sentence never name the same lane two different ways.
2. **`edition-builder.ts`**: at the zero-candidates call site, the `DiscoveryLaneFetchFailures`
   object is now assembled ONCE (reordered one block earlier) and passed into BOTH
   `zeroCandidatesRecapReason` (new) and `alertRecapOnlyIfAnomalous` (unchanged call, same object
   now reused instead of rebuilt) — removing the previous duplication where the same 7-field
   literal was written out twice.

### Why additive/opt-in rather than always requiring the flags

Every other existing caller of `zeroCandidatesRecapReason` — none exist outside this one call
site today, but the signature change is still additive by design, not a breaking change, in case
a future caller (a backtest harness, an admin replay tool) wants the reason text without wiring
up failure flags. Passing `undefined`/`null` is indistinguishable from "nothing failed," which is
the correct conservative default: this function must never fabricate a disclosure it has no
evidence for.

### Why reuse `failedDiscoveryLaneNames` rather than a second enumeration

`discoveryLaneFailurePairs` (private to `edition-funnel.ts`) is already the single place that
lists the 7 lanes' flag keys, specifically so `anyDiscoveryLaneFetchFailed` and
`failedDiscoveryLaneNames` can't drift apart (per that function's own existing comment). The new
disclosure clause calls `failedDiscoveryLaneNames` rather than re-deriving which lanes failed, so
there remains exactly one place that knows the 7 lane names and their flag keys.

## What was deliberately left unchanged

- `alertRecapOnlyIfAnomalous`'s own logic (the `benign` check, the Discord alert body) — #7745's
  fix there is untouched; this PR only changes WHERE the already-assembled failure-flags object
  is also used (added a second consumer), not how the ops alert decides to fire.
- `MarketWideContext`/`market-wide.ts` — the 7 failure flags themselves (added by #7745) are
  unchanged; this PR only threads already-existing data one call further.
- The other 5 call sites of `alertRecapOnlyIfAnomalous` / recap-only reasons elsewhere in
  `edition-builder.ts` (dossier-fetch-empty, pre-synthesis score-floor short-circuit,
  synthesis-empty, publish-gate-blocked, publish-guard-empty-finalPlays) — none of them call
  `zeroCandidatesRecapReason` (it is specific to the `stage_candidates` zero-count exit), so none
  are touched by this fix.
- The all-genuine-zero sentence's wording/shape — unchanged, verified byte-identical by test.

## Blast radius

- `zeroCandidatesRecapReason`'s exported signature gained one optional trailing parameter —
  source-compatible for any existing or future caller that omits it.
- `recap_only_reason`'s shape changes ONLY on a zero-candidate night where at least one lane's own
  fetch threw — purely additive text (a trailing `Note: ...` sentence), never removing or altering
  the existing 7-count sentence that precedes it.
- Largo's `get_nighthawk_edition` tool payload (`nighthawk-edition-for-model.ts`) passes
  `recap_only_reason` through unchanged (`?? null`) — it now carries the richer, honest text
  automatically, no change needed on that side.

## Evidence (RED → GREEN)

New pure-logic tests added to `src/features/nighthawk/lib/edition-funnel.test.ts` (no mocking
needed — matches this module's existing dependency-free pattern): covering the all-genuine-zero
case (byte-identical to pre-fix output, with `failures` omitted, `null`, and all-false), the
one-lane-failed case (singular wording, correct lane name), the multi-lane-failed case (plural
wording, both lanes named), and the lane-display-name mapping (`oi_change`→`OI`,
`unusual_trades`→`unusual`, not the raw flag key).

RED (pre-fix source, test file with the new tests left in place — isolated via `git diff` saved
to a patch, `git checkout --` on just `edition-funnel.ts`/`edition-builder.ts`, patch reapplied
after): `npx tsx --experimental-test-module-mocks --test
src/features/nighthawk/lib/edition-funnel.test.ts` → **24 pass / 3 fail** (the 3 new
failure-disclosure tests; the byte-identical test passed in both states, as expected since it
asserts no change in the no-failure case).

GREEN (patch reapplied): same command → **27/27 pass**.

Combined regression run alongside sibling suites (`edition-builder-zero-candidates-funnel.test.ts`,
`edition-builder-after-hours-sanitize.test.ts`, `edition-builder-scoring-snapshot.test.ts`,
`edition-builder-scoring-history.test.ts`, `edition-builder-dossier-fetch-retry.test.ts`,
`candidates.test.ts`, `candidates-breakout-shadow.test.ts`, `candidates-breakout.test.ts`,
`candidates-discovery-snapshot.test.ts`): **109/109 pass**.

`npx tsc --noEmit` (Node 20.20.2): clean, empty output, exit 0.
