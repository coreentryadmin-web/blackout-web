> **kind:** FINDING

## Night Hawk Cortex catalyst-news source silently drops a failed earnings-calendar fetch, never disclosing it alongside the earnings-day oppose veto — FIXED

| | |
|---|---|
| **Area** | `src/lib/nighthawk/cortex/fetch.ts`'s `fetchCortexInputs` + `src/lib/nighthawk/cortex/sources/catalyst-news.ts`'s `deriveCatalystNewsEvidence` — the 0DTE/swing Cortex evidence engine's earnings-day-risk gate |
| **Status** | FIXED |
| **File** | `src/lib/nighthawk/cortex/fetch.ts` |

### Root cause

A third, independent occurrence of the same bug shape fixed twice earlier today in sibling files
(`docs/audit/findings-staging/2026-11-08-bie-earnings-absence-mislabels-fetch-failure.md`, PR
#7584 for `ecosystem-context.ts`; `2026-11-08-pre-earnings-pack-earnings-absence-mislabels-fetch-failure.md`,
PR #7586 for `pre-earnings-pack.ts`) — this time in the Cortex evidence engine that gates new 0DTE
and swing premium commits.

`fetchCortexInputs` (fetch.ts) calls `deps.fetchNextEarningsDate(upper)` inside a
`Promise.allSettled`, wrapped in `withSourceTimeout`. Since PR #7584, `fetchNextEarningsDate`
(`src/lib/providers/uw-earnings.ts`) never rejects on a failed upstream calendar read (e.g. the
live Benzinga entitlement 403 — CLAUDE.md's "ENTITLEMENT REGRESSED 2026-11-07" note) — it resolves
with `{ ...parsed, error: bz.error }` instead, specifically so a consumer can tell "the fetch
failed" apart from "genuinely nothing scheduled." `withSourceTimeout` only races a promise against
a timer and passes a fulfilled value through untouched; it never inspects it for an `.error` field.
Because the promise always **fulfills** for this failure mode, `earningsRes.status === "rejected"`
is never true, so fetch.ts's only error-tracking call for this leg
(`note(["catalyst-news"], earningsRes.reason)`, gated on promise rejection) never fired —
`input.errors["catalyst-news"]` stayed empty for this cause.

Downstream, `mapNewsSlice` computes `earningsToday: earnings && earnings.days_until === 0 ?
(earnings.report_time ?? "unknown") : null` — it reads only `days_until`/`report_time` and never
`earnings.error`. On a failed fetch, `days_until` is null (per the shape `fetchNextEarningsDate`
now returns on error), so this renders `earningsToday: null` — byte-identical to a ticker that
genuinely has no earnings scheduled today.

`deriveCatalystNewsEvidence` (`catalyst-news.ts`) uses exactly this `news.earningsToday` field to
decide whether to push an `opposes` evidence item at `EARNINGS_TODAY_OPPOSE_WEIGHT` (0.8) — a
real, designed-in veto signal meant to discourage new 0DTE/swing premium commits ahead of
IV-crush/binary earnings risk. When the upstream fetch silently failed on a real earnings day,
this protection did not fire, and (confirmed by grep: zero reads of `.error` anywhere in
`src/lib/nighthawk/cortex/`) nothing else in the pipeline recorded the omission either. A
Cortex-gated commit decision then read as a normal, fully-evidenced clean pass rather than
"earnings status unknown, could not evaluate the earnings-day risk gate."

### Evidence

**Confirmed by reading the current source** at the exact locations the originating investigation
named: `fetch.ts` lines ~413-431 (the `Promise.allSettled` fan-out), ~452-455 (the earnings-leg
error note, rejection-only), ~296-313 (`mapNewsSlice`); `catalyst-news.ts` lines ~104-115 (the
earnings-today oppose branch). The trace held exactly as described.

**Direct probe against the unfixed source** (`fetchCortexInputs` called with a stubbed
`fetchNextEarningsDate` resolving `{ earnings_date: null, days_until: null, report_time: null,
is_confirmed: null, error: "Benzinga 403" }`):

```
news: {"asOf":"...","items":[...],"earningsToday":null}
errors: {}
```

`input.errors` is empty — the failure vanished with no trace, confirming the bug live.

**RED → GREEN proof** (Node 20, `node --import tsx --experimental-test-module-mocks --test`):
isolated the fix by reverting `fetch.ts` alone to its pre-fix `HEAD` content, re-ran the new tests
in `fetch.test.ts`:

- **Pre-fix: 21 pass / 1 fail** — `earnings-calendar fetch failure (fulfilled-with-error) surfaces
  as an error, not a confident absence` fails (`input.errors["catalyst-news"]` is falsy). The
  sibling regression guard (`genuine clean "no earnings today" (no error) leaves catalyst-news
  error-free`) already passes pre-fix, confirming the test isolates the exact failure mode and not
  a broader behavior change.
- **Post-fix (fetch.ts restored): 22/22 pass.**

Full regression after restoring the fix:
- `src/lib/nighthawk/cortex/fetch.test.ts`: **22/22 pass**.
- `src/lib/nighthawk/cortex/sources/catalyst-news.test.ts`: **12/12 pass** (unchanged — its
  existing `errors: { "catalyst-news": "..." }` → `/reader failed/` test already proves
  `absentForMissingSlice` renders the failure-vs-absence distinction correctly once
  `input.errors["catalyst-news"]` is populated; this fix supplies the missing populate call).
- Every `*.test.ts` under `src/lib/nighthawk/cortex/` (11 files, 35 suites): **131/131 pass**.
- `npx tsc --noEmit`: clean.

### Blast radius

Single call site: `fetchCortexInputs` is the one place `fetchNextEarningsDate`'s result reaches
the Cortex evidence engine for both 0DTE and swing commit gating (horizon-parameterized, same
function). No other reader of `NextEarnings.error` exists inside `src/lib/nighthawk/cortex/` (the
two sibling fixes already shipped today, `ecosystem-context.ts` and `pre-earnings-pack.ts`, are
independent consumers in different subsystems — BIE arsenal and the Largo desk pack respectively —
untouched by this change, per this fix's explicit scope boundary).

### Fix rationale

Chose **fix shape B** from the two offered: populate the existing `input.errors`/absent-sources
tracking mechanism for this fulfilled-but-errored result, rather than inventing a new "unevaluated"
evidence vocabulary (shape A). Three reasons this is the smaller, more consistent fix:

1. **The exact mechanism already exists and is already tested.** `absentForMissingSlice`
   (`sources/shared.ts`) already reads `input.errors[source]` and renders `"reader failed (<err>)"`
   instead of a generic no-data reason when it is set — `catalyst-news.test.ts`'s existing test
   (`errors: { "catalyst-news": "..." }` → `/reader failed/`) proves this path already works
   correctly. The only gap was that nothing ever called `note()` for this specific failure mode.
2. **It mirrors the line immediately above it.** `fetch.ts` already has `if (news?.unavailable)
   note(["catalyst-news"], { name: news.unavailable } as Error);` two lines above the earnings
   leg — the identical "fulfilled-but-degraded reader" pattern for the sibling news source. The fix
   is the same one-line shape: `if (earnings?.error) note(["catalyst-news"], { name: earnings.error
   } as Error);`.
3. **It does not fabricate directional certainty either way**, per this fix's explicit constraint.
   The earnings-today oppose veto is NOT added on a failed read (that would assume the worst, which
   the task scope explicitly forbids) — the fetch failure is disclosed as an absence signal only,
   exactly like every other source-read failure already handled elsewhere in this same file
   (`vectorRes`/`positioningRes`/`flowRes`/`sectorRes`/`breadthRes`/`barsRes`/`prevDayRes`/
   `internalsRes` rejections all funnel through the identical `note()` → `errors[source]` →
   `absentForMissingSlice` chain, each only surfacing when the source ends up with zero other
   evidence to report — the established, deliberate "absence is signal-neutral, precision-first"
   convention this subsystem already follows for every other error channel).

Deliberately left unchanged: `mapNewsSlice`'s `earningsToday` field semantics (still null on both a
genuine miss and a failed fetch — the real signal lives in `input.errors`, not in the slice, same
as the `news?.unavailable` precedent), `EARNINGS_TODAY_OPPOSE_WEIGHT`'s value, every other Cortex
source, and the two sibling files already fixed today (`ecosystem-context.ts`,
`pre-earnings-pack.ts`) — all out of this fix's explicit scope.
