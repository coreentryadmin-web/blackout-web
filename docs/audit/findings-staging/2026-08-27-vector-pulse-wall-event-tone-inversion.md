## 2026-08-27 — [FINDING, P3 Vector] wallEventToPulseSignal's kind-based bull/bear mapping was inverted for spot_broke_call/spot_broke_put — currently dead code, fixed before it could bite — FIXED

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **Symptom** | `wallEventToPulseSignal` (`src/features/vector/lib/vector-pulse.ts`) derives a signal's `tone` ("bull"/"bear"/"warn"/"info") from the wall event. Its kind-based branch mapped `ev.kind === "spot_broke_put"` (a bearish support break) to `"bull"`, and `ev.kind === "spot_broke_call"` (a bullish resistance break) to `"bear"` — backwards. |
| **Why it's not live today** | The tone function checks `ev.severity === "warn"` FIRST, before falling through to the kind-based branch. `vector-wall-events.ts` sets `severity: "warn"` unconditionally for both `spot_broke_call` and `spot_broke_put` — the only two kinds the inverted branch is meant to catch — so that branch is currently unreachable for them. Found via a data-integrity audit of Vector's GEX/contract-picks pipeline, not a live symptom report. |
| **Why it's still worth fixing now** | It's a landmine: if any future change ever demotes either event's severity to `"info"` (e.g. to reduce feed noise for a routine break), the pulse feed would silently start coloring a bullish resistance-break event red and a bearish support-break event green — with no test or type system in place today to catch that regression, since the branch has zero coverage while unreachable. |
| **Fix** | Swapped the two kind checks so the mapping is correct: `spot_broke_call` → `"bull"`, `spot_broke_put` → `"bear"`. Added a comment at the site explaining the dead-code status and why it's fixed anyway. |
| **Regression guard** | `vector-pulse.test.ts` — two new tests construct a `VectorWallEvent` with `severity: "info"` (impossible via the real event builder today, but valid per the type) and each currently-unreachable kind, asserting the correct tone. This is the only way to exercise and pin the mapping ahead of a future severity change making it live. |
| **Blast radius** | Single function, single file. No behavior change today (confirmed: both real callers always pass `severity: "warn"` for these kinds, so `tone` is unaffected in production as of this fix). |
| **Status** | FIXED. |
