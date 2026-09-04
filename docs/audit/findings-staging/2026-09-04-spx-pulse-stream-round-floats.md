## 2026-09-04 — [FINDING, P2 data-correctness] SPX pulse SSE stream unrounded floats — FIXED

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **Symptom** | `/api/market/spx/pulse/stream` SSE events could carry IEEE float tails on index prices and tide premiums while the REST `/spx/pulse` lane already rounded at the boundary (PR #3751). |
| **Root cause** | `JSON.stringify` serialized raw `indexStore` / UW store numbers without `roundFloats`. |
| **Fix** | Wrap the SSE payload in `roundFloats()` before `JSON.stringify`, matching `/spx/pulse`. |
| **Regression guard** | `src/app/api/market/spx/pulse/stream/route.test.ts` — source scan asserts `roundFloats` on the stringify path. |
| **Status** | FIXED |
