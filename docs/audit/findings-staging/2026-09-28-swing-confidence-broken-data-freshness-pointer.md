# P2: Ask Largo swing confidence line points to a section that never has (or may not even have) the detail it promises — FIXED

> **kind:** FINDING

## Problem

Live repro (2026-09-28, NVDA and MSTR swing play-briefs, `GET /api/market/swing/play-brief`): whenever
`swingPlayBriefConfidence` returns `level: "moderate"`, the `why` text read `"N sources unavailable this
cycle — see Data freshness."` But the rendered "Data freshness" section never actually listed which
sources were unavailable or why — a reader following the pointer found only an option-mark/scan
timestamp line, nothing about the fetch failures the confidence line was warning about.

## Root Cause

`dataFreshnessSection` (`play-brief-intel.ts`) and `collectBriefUnavailableSources` (`play-brief-
absence.ts`) check two entirely disjoint sets of conditions:

- `dataFreshnessSection`: option-mark staleness, swing-scan staleness, Vector-data age, GEX-matrix
  age, HELIX-flow-pipeline staleness.
- `collectBriefUnavailableSources`: `ctx.ecosystem?.arsenal?.unavailable_sources` (genuine upstream
  fetch failures like "ecosystem context: fetch failed", "Vector state: fetch failed") plus several
  other absence checks — none of which `dataFreshnessSection` reads.

`swingPlayBriefConfidence`'s "moderate" branch is driven by `unavailableSources.length`, but its `why`
text pointed at the section built from the *other* set — so the two could (and did, live) disagree.
Worse: `dataFreshnessSection` returns `null` (renders nothing) whenever its own lines array is empty,
which can happen even while `unavailableSources` is non-empty — meaning the pointer could name a
section that isn't even present in the rendered brief at all.

## Fix

Changed `swingPlayBriefConfidence`'s moderate-branch `why` text to name the actual unavailable sources
inline (`unavailableSources.map(s => s.source).join(", ")`) instead of pointing at "Data freshness".
The real detail already renders as the envelope's generic `_Unavailable this turn:_` footer
(`answer-envelope.ts`'s shared markdown builder, driven directly by `env.unavailableSources`) — the fix
does not duplicate that content into `dataFreshnessSection`, which would have created the exact kind of
duplicate-rendering bug this codebase has hit and fixed before (`bookContextCoaching` vs
`bookContextSection`, #4110/#4116).

## Files Changed

- `src/lib/swing/play-brief-confidence.ts` — moderate-branch `why` text, plus a comment explaining why
  `dataFreshnessSection` was deliberately NOT touched (duplication risk).
- `src/lib/swing/play-brief-confidence.test.ts` — new regression test asserting the `why` text names
  the real sources and never says "Data freshness".

## Evidence

- Live repro: `GET /api/market/swing/play-brief?playId=SWING:NVDA&ticker=NVDA` (WATCH, 2026-09-28
  ~15:40 ET) — confidence `"moderate — 2 sources unavailable this cycle — see Data freshness."`, Data
  freshness section body: only `"Swing scan: 2026-09-28 09:15 ET"`, no mention of the 2 unavailable
  sources.
- New regression test RED pre-fix (`git stash` proof) / GREEN post-fix.
- `npx tsc --noEmit` clean.
- `npx tsx --experimental-test-module-mocks --test src/lib/swing/play-brief.test.ts
  src/lib/swing/play-brief-confidence.test.ts` — 119/119 pass, no regression.

## Status

| **Status** | FIXED |
| --- | --- |
| **Commit** | this PR |
| **PR** | small, single-issue, no application logic beyond the `why` string change |
