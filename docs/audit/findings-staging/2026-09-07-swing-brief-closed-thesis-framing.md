# Ask Largo swing brief: CLOSED plays render live thesis/invalidation language as if the position were still open — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P2-0117 |
| **Severity** | P2 |
| **Area** | Ask Largo / Night Hawk Swings (`src/lib/swing/play-brief-intel.ts`) |
| **Status** | FIXED in PR (fix/closed-watch-levels-thesis-framing) |

## Symptom

Live spot-check during the standing 5-engine + Ask Largo monitor cycle (2026-09-07, three CLOSED
swing plays not previously audited: INTC positionId 35, EWZ positionId 29, IGV positionId 28 — all
via `GET /api/market/swing/play-brief`). Every CLOSED brief's `## Watch levels` section read as if
the already-resolved trade still had an open thesis to protect, directly under its own `## Outcome`
section reporting the trade already STOPPED/hit TARGET days earlier:

```
## Outcome
Exit P&L: -33.2%
Reason: stopped
Closed: 2026-09-04 07:00 ET
...
## Watch levels
Thesis unknown — no setup read attached to this name yet
Reclaim gamma flip 99.31 — invalidates short thesis
```

`Thesis **unknown**` and `Reclaim gamma flip ... invalidates short thesis` both read as live,
actionable guidance on a position that closed three days prior.

## Root cause

Two distinct bugs in `watchForSection()` (`play-brief-intel.ts`), both from `bucket` (watch/open/
closed) only ever special-casing "open", never "closed":

1. **`play.thesisBreak`** is stamped by `serving-ingest.ts` from a *live, present-tense, ticker-keyed*
   dossier read — "is Night Hawk's discovery pipeline currently seeing an active setup on this
   ticker" (see its own comment: "A data-absent thesis is UNKNOWN, never a fabricated intact"). It
   is **not** the thesis of the specific closed position being reviewed — that thesis already
   resolved. Rendering it unconditionally for `bucket === "closed"` presents an unrelated live signal
   as if it were commentary on the dead trade, violating the Largo product contract's identity/
   direction points (whose thesis, and is a position still live).
2. The gamma-flip line used the same `"Reclaim/Lose gamma flip ... invalidates thesis / turns against
   longs"` imperative phrasing for closed plays as for watch/open plays. That phrasing is correct
   guidance for a still-open decision (act if this level breaks) but is misleading for a closed one —
   there is no thesis left to invalidate and no position left to turn against.

Both were straightforward oversights: the function threads `bucket` through several other checks
(`bucket === "watch"`, `bucket === "open"`) but never added the `"closed"` branch these two lines
needed — the classic "handled the buckets I was thinking about, not the third one" gap.

## Blast radius

Single function, single call site — `watchForSection()` is invoked once per brief compose
(`play-brief.ts`) and the "Watch levels"/"Since it closed" section it returns is the only consumer.
No other section duplicates this logic. Checked `chartLevelsSection`, `holdPlanSection`, and
`tradeManagerNarrativeSection` for the same bucket-blind pattern — all three already gate correctly
on bucket (`holdPlanSection` returns `null` outright for non-open; the narrative section's own
CLOSED path is retrospective by construction, see `## Trade manager read` / `## Lessons` in the same
briefs, which read correctly).

## Fix

- Suppress the `Thesis **...**` line entirely when `bucket === "closed"` (in-code comment explains
  why: it's a different signal than the one a reader would assume from the position it's printed
  under).
- For `bucket === "closed"`, reframe the gamma-flip line as neutral, informational positioning
  (`"Now trades **X** vs gamma flip **Y** — where the dealer regime sits since this play closed"`)
  instead of the watch/open imperative framing.
- Reworded the empty-lines fallback string for the closed case similarly.
- Retitled the closed-bucket section `"Since it closed"` (was sharing `"Watch levels"` with the
  watch bucket, which itself implies forward-looking triggers) — verified no other code/test matches
  on that exact title string outside this file.
- watch/open bucket behavior is byte-for-byte unchanged (regression test asserts this explicitly).

## Verify

- `node --import tsx --experimental-test-module-mocks --test src/lib/swing/play-brief-intel.test.ts`
  — 3 new tests: CLOSED suppresses the live thesis note, CLOSED reframes gamma-flip as neutral
  positioning (not "invalidates thesis"), watch bucket unchanged (still shows both, confirmed
  RED→GREEN by stashing the fix and rerunning).
- Full `src/lib/swing/*.test.ts` (823 tests) and `npx tsc --noEmit` both clean after the fix.
- Live re-check once merged: pull any newly-CLOSED swing play's `/api/market/swing/play-brief` and
  confirm `## Since it closed` no longer prints "Thesis unknown" or "invalidates ... thesis" framing.
