# 2026-11-09: Night Hawk Legacy recap-only "benign" check only watched 1 of 7 discovery lanes — a real outage on the other 6 silently skipped the ops alert

> **kind:** `FINDING`

**Status.** FIXED — this PR.

## Summary

Night Hawk Legacy's evening edition builds its candidate pool from **seven** independent
discovery lanes (`extractMultiSourceCandidates`, `src/features/nighthawk/lib/candidates.ts`):
`flow` (UW), `oi_change` (UW), `unusual_trades` (UW), `catalyst` (Benzinga/Polygon after-hours
movers), `predictions` (UW), `movers` (Polygon gainers/losers), `breakout` (Polygon
`breakout_movers`, derived from the daily-market-summary fetch).

When all seven return zero candidates, the edition publishes a recap-only row and
`alertRecapOnlyIfAnomalous` (`src/features/nighthawk/lib/edition-builder.ts`) decides whether to
page ops. Before this fix, that decision checked **only** whether the flow lane's own fetch had
thrown (`opts?.flowFetchFailed`, sourced from `ctx.flow_fetch_failed` in `market-wide.ts`):

```ts
const benign = (funnel.candidates ?? 0) === 0 && !opts?.flowFetchFailed;
```

The other six upstream fetches feeding the same candidate funnel — `fetchUwMarketOiChange`,
`fetchUwUnusualTrades`, `fetchBenzingaAfterHoursMovers`, `fetchUwPredictionsConsensus`,
`fetchMarketMovers`, and `fetchDailyMarketSummary` (the breakout lane's sole upstream) — were all
swallowed with a bare `.catch(() => [] | null)` with **no equivalent failure flag at all**. So a
genuine provider outage on any of those six lanes alone (flow still succeeding, even on a thin
night) was silently classified `benign` — no ops Discord alert fired, indistinguishable from an
honestly quiet market. This is exactly the kind of outage CLAUDE.md's own environment notes
document as live and ongoing: `fetchMarketMovers` hits the real-time-snapshot-family Polygon/
Massive endpoint confirmed entitlement-blocked (403 `NOT_AUTHORIZED`) as of 2026-11-08, one day
before this edition built.

The member-facing `recap_only_reason` string compounded the blind spot: it reported only 4 of the
7 real lane counts (`flows`, `OI`, `unusual`, `movers`) — `catalyst`/`predictions`/`breakout`
never appeared in the disclosed reason at all, so even a human reading the stored reason text
could not tell those three lanes existed or whether they returned data.

Confirmed live: `GET /api/market/nighthawk/edition` (2026-11-09 ~10:52 UTC) returned
`{"recap_only": true, "no_plays": true, "plays": [], "recap_only_reason": "No candidates from any
source (flows 0, OI 0, unusual 0, movers 0)."}` — only 4 lane counts visible, no way to tell
whether catalyst/predictions/breakout even ran.

## Distinguishing this from the unrelated 2026-09-13 FINDINGS.md entry

`docs/audit/FINDINGS.md` (2026-09-13, "Legacy recap-only reason cross-references the WRONG
upstream heartbeat...") is a **different, unrelated** finding about the TEXT QUALITY of the
`recap_only_reason` string at a *different* exit path (the publish-gate-blocked exit,
`recapReasonAtPublishExit` in `edition-funnel.ts`, which can misname a stalled 0DTE heartbeat as
the cause). That entry explicitly notes, as supporting evidence for its own (held, unfixed) issue,
that `alertRecapOnlyIfAnomalous` "branches only on `candidates ?? 0 === 0` and `flowFetchFailed`,
never on the reason string" — i.e. it already observed the exact single-flag gap this PR closes,
but only in passing, to make a point about a different bug (alert *severity/firing* being
decoupled from reason *text*). It is not a fix for, and should not be conflated with, the 6-of-7-
lanes-unmonitored gap this PR actually fixes. Both can be true at once: this PR fixes WHICH lanes'
failures are tracked and WHAT the reason string names; the 2026-09-13 entry is about a *different*
exit path misattributing blame to the wrong upstream system in its reason text.

## Root cause

`market-wide.ts`'s `fetchMarketWideContext` tracked exactly one failure flag
(`let flowFetchFailed = false`, set inside the flow-alerts `.catch()`), treating flow as if it
were "the SOLE candidate source" (per its own comment) — stale once the discovery pool grew to 7
lanes. The other six fetches' `.catch()` handlers discarded the error entirely and returned a
plain empty default, with no way for a caller to tell "this lane legitimately found nothing" from
"this lane's upstream provider is down."

## Fix

1. **`market-wide.ts`**: added a sibling failure flag for each of the other six lanes
   (`oi_change_fetch_failed`, `unusual_trades_fetch_failed`, `catalyst_fetch_failed`,
   `predictions_fetch_failed`, `movers_fetch_failed`, `breakout_fetch_failed` — the last tied to
   the `fetchDailyMarketSummary` fetch, breakout's sole upstream), each set only inside that
   fetch's own `.catch()`, never on a legitimate empty result — mirroring `flow_fetch_failed`'s
   existing, already-correct pattern exactly. All seven are now returned on `MarketWideContext`.
2. **`edition-funnel.ts`** (pure, already-unit-tested module — no new heavy dependencies): added
   `DiscoveryLaneFetchFailures` (the structural flag shape), `anyDiscoveryLaneFetchFailed` (true
   if ANY of the 7 lanes failed), `failedDiscoveryLaneNames` (names which ones, for the ops alert
   body), and `zeroCandidatesRecapReason` (builds the reason string naming all 7 lanes' counts,
   not 4).
3. **`edition-builder.ts`**: `alertRecapOnlyIfAnomalous`'s `benign` check now uses
   `anyDiscoveryLaneFetchFailed` across all 7 flags instead of the single `flowFetchFailed`
   check, so a failure on ANY lane makes a zero-candidate night non-benign and pages ops; the
   Discord alert body now also names which lane(s) failed. The zero-candidates recap-only reason
   (the one call site that previously hand-built a 4-lane string) now calls
   `zeroCandidatesRecapReason` with all 7 real lane counts (`flows`, `oi`, `unusual`, `catalyst`,
   `predictions`, `movers`, `breakout`).

### Why per-lane flags, not one aggregated flag

The existing codebase pattern (`flow_fetch_failed`) is already per-lane, and ops alerting
genuinely benefits from knowing WHICH lane broke (e.g. "catalyst" points at a Benzinga/Polygon
news-feed problem, "movers" points at the real-time-snapshot entitlement outage already flagged
elsewhere in this repo) rather than just "something did." Keeping per-lane flags in
`MarketWideContext` and only aggregating at the decision point (`anyDiscoveryLaneFetchFailed`)
preserves both the coarse yes/no the `benign` check needs and the detail an ops responder needs,
without duplicating the "which lanes exist" enumeration in more than one place
(`discoveryLaneFailurePairs` in `edition-funnel.ts` is the single source of truth both helpers
read from).

## Blast radius

- `MarketWideContext` (`market-wide.ts`) gains 6 new optional boolean fields — additive, no
  existing field renamed or removed, so every existing consumer (candidates.ts's lane functions,
  edition-builder.ts's other recap-only exits, any snapshot/test fixture building a
  `MarketWideContext` literal) is unaffected.
- The other 5 call sites of `alertRecapOnlyIfAnomalous` (dossier-fetch-empty, pre-synthesis
  score-floor short-circuit, synthesis-empty, publish-gate-blocked, publish-guard-empty-finalPlays)
  are unchanged — they already only fire once `candidates.length > 0`, so `funnel.candidates ?? 0
  === 0` is already false there and the `benign` branch was never reachable regardless of this
  fix; they continue to call the function with no `opts`, which remains valid (all fields
  optional).
- `recap_only_reason`'s member-facing string changes shape only at the single zero-candidates
  exit path (stage_candidates), now naming 7 lanes instead of 4 — purely additive text, no field
  removed from the payload.

## Evidence (RED → GREEN)

New pure-logic tests added to `src/features/nighthawk/lib/edition-funnel.test.ts` (the existing,
dependency-free test file for this module — no mocking needed, matching its established pattern):
11 new tests covering `anyDiscoveryLaneFetchFailed` (including one per each of the 6 previously-
unmonitored lanes failing ALONE with flow succeeding), `failedDiscoveryLaneNames`, and
`zeroCandidatesRecapReason`.

RED (pre-fix, via a saved `git diff` patch of the 3 source files — `edition-funnel.ts`,
`market-wide.ts`, `edition-builder.ts` — reverted with `git checkout --`, test file left in
place): `npx tsx --experimental-test-module-mocks --test
src/features/nighthawk/lib/edition-funnel.test.ts` → **12 pass / 11 fail** (`TypeError:
anyDiscoveryLaneFetchFailed/failedDiscoveryLaneNames/zeroCandidatesRecapReason is not a
function`).

GREEN (patch reapplied): same command → **23/23 pass**.

Combined regression run alongside sibling suites (`candidates.test.ts`,
`candidates-breakout-shadow.test.ts`, `candidates-breakout.test.ts`,
`candidates-discovery-snapshot.test.ts`, `edition-builder-zero-candidates-funnel.test.ts`,
`edition-builder-after-hours-sanitize.test.ts`, `edition-funnel.test.ts`): **67/67 pass**.

`npx tsc --noEmit`: clean (empty output, exit 0) both before and after the fix.
