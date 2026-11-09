# 2026-11-09: worstKnownSwingDataAgeMs never considered the discovery-scan age — Largo-contract freshness/age_seconds misreported "cached"/null for a live WATCH play with a disclosed multi-day-stale scan

> **kind:** `FINDING`

**Status.** FIXED — this PR.

## Summary

`adaptSwingBriefToLargo` (`src/lib/swing/play-brief-adapter.ts`) derives the top-level Largo-contract
C2 fields `freshness`/`age_seconds` entirely from `SwingPlayBriefResult.dataAgeMs`, which is
`worstKnownSwingDataAgeMs(ctx)` (`play-brief-intel.ts`). That function aggregated exactly two
sources (option-mark age, Vector/GEX age) and never read `ctx.scanAsOf` — the swing-discovery-scan
timestamp the SAME compose path already uses as its own most-prominent staleness signal (it drives
the "Swing discovery scan as of ..." Data-freshness line). Found by this cycle's Ask Largo/5-engine
Workflow (unanimous 3/3 adversarial verify, 0 refuted).

## Root cause

For a live (not entry-window-expired, not dead) WATCH play where Vector/GEX are both genuinely
unavailable this cycle (the ongoing Polygon real-time-snapshot entitlement loss, still open per
CLAUDE.md) and no option mark is expected (WATCH candidates have no live sync age by design),
`ages[]` stayed empty, `worstKnownSwingDataAgeMs` returned `null`, and `adaptSwingBriefToLargo`
fell back to its honest-omission default of `freshness:"cached", age_seconds:null` — even though
`envelope.evidence[0]` in the SAME response carried `{text:"Swing discovery scan as of 2026-11-06
09:15 ET.", provenance:{freshness:"stale"}}`. A model reading only the structured C2 fields (the
entire point of exposing them) saw "cached, unknown age" for an answer running on a ~2.7-day-old
discovery scan the response's own prose disclosed in the same breath. This is the same bug class
the file's header already fixed twice for other sources (hardcoded-null, 2026-10-21;
`optionMarkGenuinelyUnknown`, 2026-10-26) — the scan-age source was simply never added to the
aggregation at all.

## Evidence (RED → GREEN)

RED (pre-fix, via `git stash` isolating only the source change): 1/15 tests failed in
`play-brief-adapter.test.ts` (the new scan-age regression test).

GREEN (post-fix): 15/15 pass in that file; full `src/lib/swing/*` suite green; `npx tsc --noEmit`
clean.

Live production evidence (from the Workflow): `GET /api/market/swing/play-brief` for TSLA
(status WATCH, entry window still open) returned top-level `freshness:"cached", age_seconds:null`
while `envelope.evidence[0]` disclosed a scan from 2026-11-06 09:15 ET, read 2026-11-09 — ~2.7 days
later. MGNI (also WATCH) reproduced identically.

## Fix

Added `ctx.scanAsOf` as a third age source to `worstKnownSwingDataAgeMs`'s aggregation, gated by
the SAME `isSwingPlayStaleCheckExempt` predicate the prose "Swing scan: ..." line already uses —
so a CLOSED/dead-WATCH play (for which "today's scan" is not a live-staleness claim at all, per
that predicate's own header) never gains a fabricated age. The function already takes the `max()`
of all known sources, so adding this one can only make the reported age more honest, never mask a
real staleness another source already surfaced.

## Blast radius

One function, one file. Fixes `freshness`/`age_seconds` for every Largo-facing swing play-brief
whose only genuinely-known staleness source this cycle is the discovery scan itself — most
commonly a WATCH candidate during the ongoing Vector/GEX real-time entitlement outage. No change
to the native `dataFreshnessSection` prose (which already read `scanAsOf` correctly) — only the
structured C2 mirror of it.
