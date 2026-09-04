# 2026-09-04 — platform-integrity false WARN on tier-gated 401

> **kind:** FINDING

## Symptom

`npm run validate:platform-integrity` reported 4 WARNs during RTH lifecycle (`gex-positioning-spx`, `thermal-matrix-SPY/QQQ`, `vector-spx-0dte-walls`) even though every probe returned HTTP **401 Unauthorized** — the harness runs without Clerk auth by design.

## Root cause

`scripts/validate-platform-integrity.mjs` treated 401 as WARN for several premium routes while other routes (`spx-desk`, `flows`, `nighthawk`, `zerodte`) already mapped 401 → SKIP.

## Fix

Map 401 → SKIP + `tier-gated` detail for `gex-positioning`, `thermal-matrix-*`, and `vector-spx-0dte-walls`.

| **Status** | FIXED (PR pending) |
