## 2026-11-02 — [FINDING, P2 CI] Dark-pool WS tests used UTC calendar date vs ET session filter — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED (PR pending) |
| **Found by** | CI `verify` on `main` @ `1c760ad54`, run `41366602528` |
| **Scope** | `uw-ws-normalize.test.ts`, `uw-ws-cache-bridge.test.ts` |

### Root cause

`normalizeDarkPoolWsPayload` and `darkPoolSnapshotFromRecentRows` filter prints to **today in ET**
(`todayEt()` / `execAtEtYmd`). Two regression tests stamped fixtures with
`new Date().toISOString().slice(0, 10)` (UTC). After 00:00 UTC while US markets are still on the
prior ET session date, every row is dropped → `null` / empty `prints` → RED verify.

### Fix

Use `todayEt()` for fixture timestamps in both tests.

### Regression guard

Same tests; stable across UTC midnight.
