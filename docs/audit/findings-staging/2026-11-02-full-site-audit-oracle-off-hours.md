## 2026-11-02 — [FINDING] RTH deep audit P0 oracle off-hours false positive — FIXED

> **kind:** `FINDING`

| Field | Detail |
| --- | --- |
| **Symptom** | `audit` on `main` @ `8f9e0d4` (Mon ~17:30 ET): P0 `[oracle] SPX: desk 7552.74 vs Polygon 7541.40 (Δ 11.34)` while cross-tool integrity correctly skipped (market closed). |
| **Root cause** | `full-site-deep-audit.mjs` always compared desk spot to Polygon index snapshot with $5 tolerance; after RTH close, sources diverge by design. |
| **Fix** | Gate oracle on `data-integrity` `market_open` (fallback `inRthOpenWindow()`); emit pass skip off-hours. |
| **Status** | FIXED on `fix/full-site-audit-oracle-rth-only`. |
