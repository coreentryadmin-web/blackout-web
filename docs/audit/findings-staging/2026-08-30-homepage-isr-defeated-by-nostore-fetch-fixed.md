## 2026-08-30 — [FINDING, P4 marketing/public-site] Homepage `revalidate = 3600` defeated by nested `no-store` prev-bar fetch — FIXED

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **Root cause** | `fetchSpotFromPrevBar` → `fetchPreviousDayBar` → `polygon-largo` `polygonGet` hardcoded `cache: "no-store"`, forcing dynamic `/` renders when the GEX last-resort spot path fired. |
| **Fix** | Thread optional `fetchInit` through `polygonGet` / `fetchPreviousDayBar`; last-resort prev-bar lookup uses `{ next: { revalidate: 3600 } }` to align with homepage ISR. All other `polygonGet` callers unchanged (default `no-store`). |
| **Status** | FIXED |
