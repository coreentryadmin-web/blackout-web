## 2026-09-04 — [FINDING, P2 data-correctness] HELIX flows SSE stream unrounded floats — FIXED

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **Symptom** | `/api/market/flows/stream` SSE events could carry IEEE float tails on premiums/strikes while the REST `/flows` lane already rounded at the boundary. |
| **Root cause** | `JSON.stringify` serialized raw flow payloads without `roundFloats`. |
| **Fix** | Wrap the SSE payload in `roundFloats()` before `JSON.stringify`, matching `/flows`. |
| **Regression guard** | `src/app/api/market/flows/stream/route.test.ts` — source scan asserts `roundFloats` on the stringify path. |
| **Status** | FIXED |
