# 2026-09-05 — Night Hawk legacy-marks + play-bars roundFloats

> **kind:** FINDING

## Symptom

Two Night Hawk cache-reader routes (`legacy-marks`, `play-bars`) returned raw IEEE floats at the JSON boundary while sibling routes (`edition`, `horizons`) already wrap responses in `roundFloats`.

## Fix

Wrap success payloads with `roundFloats(...)` before `NextResponse.json`. Source-scan regression tests on both routes.

## RTH validation

- Open a Legacy play detail panel with live marks — confirm no `7499.360000000001`-style noise in network JSON.
- Open a 0DTE play detail chart — confirm mark closes are 2dp at the wire.
