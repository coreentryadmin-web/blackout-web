## 2026-09-06 — [FINDING, Ask Largo / Night Hawk Swings, P2] play-brief empty ticker blocks playId fallback — FIXED

> **kind:** `FINDING`

### Symptom

`GET /api/market/swing/play-brief?playId=SWING:NVDA` (ticker param omitted) returned **404 play not found**
even though the play id embeds the ticker.

### Root cause

The route passes `ticker: ""` when the query param is absent. `resolveSwingPlayForBrief` used
`(input.ticker ?? parsed.ticker)` — empty string is not nullish, so `"".toUpperCase()` blocked the
`parseSwingPlayId` fallback and hit `if (!ticker) return null`.

### Fix

Treat blank/whitespace ticker as absent: `(input.ticker?.trim() || parsed.ticker)`.

### Evidence

- Regression test in `play-brief-resolve.test.ts`: `{ playId: "SWING:NVDA", ticker: "" }` resolves.

| **Status** | FIXED — PR opened, merge pending CI/peer-review |
