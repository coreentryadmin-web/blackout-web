# Swing play-brief earnings evidence missing asOf — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Priority** | P2 |
| **Area** | Night Hawk Swings / Ask Largo |
| **Contract** | C1 time + C8 provenance |
| **Status** | FIXED in `fix/swing-brief-earnings-evidence-asof` |

## Root cause

`evidenceFromContext()` stamped `provenance.asOf` on HELIX flow, swing scan, and option mark evidence, but the earnings-calendar row only carried `source` + `freshness`. Cross-product Largo joins cannot anchor when the earnings datum was read.

## Fix

Add `asOf: ctx.asOf` to the earnings evidence provenance (same brief clock as HELIX flow).

## RTH validation

On `/nighthawk` Swings, open Ask Largo for a ticker with a known upcoming earnings date — evidence row should carry the brief's ET `asOf` in structured provenance (API: `GET /api/market/swing/play-brief`).
