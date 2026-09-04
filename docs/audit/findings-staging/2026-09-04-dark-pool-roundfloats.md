# 2026-09-04 — Dark pool API roundFloats boundary

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Severity** | P2 |
| **Area** | `GET /api/market/dark-pool` |
| **Status** | FIXED |

## Symptom

Dark pool prints returned raw IEEE `premium` floats at the JSON boundary.

## Fix

Wrap response in `roundFloats({ prints, count })`.

## Evidence

`src/app/api/market/dark-pool/route.test.ts` source-scan guard.
