# RTH deep audit false P0: SPX oracle off-hours

> **kind:** FINDING

| **Status** | FIXED (pending merge) |

## Symptom

Scheduled **RTH deep audit** failed (41537722853 @ `8f9e0d4db`) at **17:30 ET** (post-close):

`[oracle] SPX: desk 7552.74 vs Polygon 7541.40 (Δ 11.34)` — P0

## Root cause

`full-site-deep-audit.mjs` always compared desk spot to Polygon index snapshot, even when
`data-integrity` reported market closed. After RTH, desk and Polygon fields diverge legitimately.

## Fix

Skip Polygon SPX oracle when `!inRthOpenWindow()` (same ET window as other RTH checks).

## Verify

Next post-close scheduled deep audit; guard test in `full-site-deep-audit.test.mjs`.
