# 2026-11-09: WATCH-bucket "Setup score" evidence fact dead-wired to today's read time, contradicting the sibling "Swing discovery scan" fact about the same data

> **kind:** `FINDING`

**Status.** FIXED — this PR.

## Summary

`evidenceFromContext()` (`src/lib/swing/play-brief.ts`) pushes a `Setup score: N (...)` fact whose
provenance comes from `commitTimeProvenance(ctx.play.committedAt, ctx.asOf, readMs)`. That helper
only ever looked at `committedAt`; when it is null — true for every PRE-COMMIT bucket (WATCH/
RESEARCH/SKIP) — it fell back to `{asOf: ctx.asOf, freshness: "unknown"}`, i.e. TODAY's brief-read
time with an honest-sounding but uninformative "unknown" freshness. Found by this cycle's Ask Largo
standing deep-dive mandate, live-reproduced on `GET /api/market/swing/play-brief?playId=SWING:TSLA
&ticker=TSLA&status=WATCH` and independently on `SWING:MGNI`.

## Root cause

For a WATCH play, the score IS dated — it is the last-discovery-scan value (`computeLaneRank`,
`play-brief-lane-rank.ts`, sources `playScore` straight off the same `laneRows`/scan snapshot). The
SAME `evidenceFromContext()` function already computes the real scan timestamp (`ctx.scanAsOf`) and
a `staleScan` boolean a few dozen lines earlier for a separate "Swing discovery scan as of ..."
fact — the Setup-score fallback simply never consulted them, even though both facts describe the
exact same underlying scan snapshot.

Net effect, confirmed live: the same envelope carried two facts about the exact same 2026-11-06
scan — one correctly stamped `freshness:"stale", asOf:"2026-11-06 09:15 ET"` (the scan fact) and
the sibling Setup-score fact stamped `freshness:"unknown", asOf:"2026-11-09 08:24 ET"` (today,
wrong) — a structured self-contradiction, reproduced identically on a second ticker (MGNI). This is
a third, distinct gap from the two prior `commitTimeProvenance`-adjacent fixes in this file (#7279's
Entry/Exit-policy-rails anchoring, #7725's `worstKnownSwingDataAgeMs` scan-age aggregation) — this
one is specifically the Setup-score fact never being offered a scan-based fallback at all.

## Evidence (RED → GREEN)

RED (pre-fix, via `git stash` isolating only the source change `src/lib/swing/play-brief.ts`, new
regression tests kept in `play-brief.test.ts`): 2/202 tests failed —
`composeSwingPlayBrief: WATCH play's Setup-score evidence is anchored to the discovery scan, not
today's read time, when committedAt is absent` and the sibling same-session-day "recent" test — both
failing with the exact live defect shape (`asOf` showing today's `ctx.asOf` instead of the real
scan time).

GREEN (post-fix): 202/202 pass in `play-brief.test.ts`; sibling suites
(`play-brief-lane-rank.test.ts`, `play-brief-context.test.ts`, `play-brief-intel.test.ts`,
`play-brief-absence.test.ts`) all green (549/549); `npx tsc --noEmit` clean.

## Fix

Added an optional 4th parameter, `scanFallback`, to `commitTimeProvenance`: when `committedAt` is
absent/unparseable, the function now returns the caller-supplied scan-based provenance instead of
unconditionally falling back to `{asOf: ctxAsOf, freshness: "unknown"}`. `evidenceFromContext()`
hoists the scan-timestamp/staleness computation that already fed the sibling "Swing discovery scan"
fact (unchanged in behavior — the formatting/staleness logic is reused verbatim, not duplicated) and
threads it through as `scanFallbackProvenance` only into the Setup-score call site. The two other
call sites (Entry, Exit-policy rails — both gated to `statusBucket === "open"`, which in practice
always carries a real `committedAt`) pass no 4th argument and are completely untouched.

## Fix rationale

Considered inlining a separate fallback directly at the Setup-score call site instead of extending
the shared helper — rejected because it would duplicate `commitTimeProvenance`'s committed-vs-not
branching logic a second time in the same function, which is exactly the kind of drift this file's
own `commitTimeProvenance` doc comment says the helper exists to prevent. An optional parameter is
the smallest change that keeps one source of truth for "how do we decide a fact's provenance" while
letting one specific caller supply a better fallback than the generic "unknown" default. Did NOT
touch `commitTimeProvenance`'s existing committed-branch logic, `src/lib/largo/contract/
product-read.ts`'s PR #7279 Entry/Exit-policy-rails callers, or PR #7725's
`worstKnownSwingDataAgeMs` — all three were read for context only, per the task's explicit
instruction, and remain byte-for-byte unchanged by this diff (confirmed via `git diff`).

## Blast radius

One function (`commitTimeProvenance`), one call site (the Setup-score fact) in one file
(`src/lib/swing/play-brief.ts`). Fixes the Setup-score fact's provenance for every PRE-COMMIT
(WATCH/RESEARCH/SKIP) swing play-brief that has a live discovery-scan snapshot — the common case
during normal operation. CLOSED plays are explicitly excluded from the new fallback (gated by the
same `!isClosed` the sibling scan fact already uses) and always carry a real `committedAt` in
practice, so they are unaffected either way. OPEN/post-commit plays keep anchoring to `committedAt`
exactly as before — a live scan snapshot sitting alongside a committed position's Setup-score fact
never overrides the commit anchor (proven by a dedicated regression test).
