# 2026-09-04 — platform-integrity 401 false WARNs

> **kind:** FINDING

## Symptom

`npm run validate:platform-integrity` at RTH reported 4 WARN checks (`gex-positioning-spx`, `thermal-matrix-SPY/QQQ`, `vector-spx-0dte-walls`) even though every endpoint returned HTTP **401 Unauthorized** (tier-gated, no Clerk session).

## Root cause

`scripts/validate-platform-integrity.mjs` treated any non-200/non-pass as WARN for those three probes, while sibling checks (`helix-flows`, `nighthawk-edition`, `zerodte-board`) already mapped `401 → SKIP`.

## Fix

Align gex-positioning, thermal-matrix, and vector walls with the existing tier-gate pattern: `401 → SKIP` with detail `tier-gated`.

## Evidence

Pre-fix: 3 pass, **4 warn**, 0 fail, 6 skip @ 09:32 ET Fri 2026-09-04.  
Post-fix (same unauthenticated run): 3 pass, **0 warn**, 0 fail, **10 skip**.

| **Status** | FIXED |
