## 2026-08-30 — [FINDING, P3 0DTE/Largo] `currentZerodteSessionAnchor` ignored `nowMs` for `session_state` — FIXED

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **Fix** | Optional `now: Date` on `nighthawk/lib/session.ts` `todayEt()` / `etNowParts()` (default preserves all 60+ call sites); `currentZerodteSessionAnchor` passes `new Date(nowMs)` through. |
| **Regression guard** | `session-phase.test.ts` — injected Friday 05:00 ET must return `PRE_MARKET`, not real-wall-clock `CLOSED`. |
| **Status** | FIXED |
