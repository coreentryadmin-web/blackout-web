## 2026-08-25 — [FINDING, P3 Meridian] Tier-2 UX polish bundle — FIXED

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **Symptom** | Six follow-on gaps from the CTO audit after tier-1 beast blockers: (1) every earnings event always opened on Summary despite readers who live on Positioning/History, (2) catalyst lane filter reset to `all` every visit, (3) History tab still triplicated the same track record (bar chart + open plain list), (4) halo dimension score `0` read as missing at small size, (5) ticker lookup re-derived `in_timeline` on every request without a full-response cache key, (6) no persisted desk prefs module — ad-hoc URL-only state. |
| **Root cause** | `MeridianEventDetailPanel` hard-reset tab to `summary` on every `item.id`; `MeridianDesk` defaulted filter to `all` when URL omitted `filter`; PRINT TRACK list always expanded; `MeridianRing` rendered bare `0` without context; lookup cached Benzinga rows but not the shaped lookup payload including timeline membership. |
| **Fix** | `meridian-desk-prefs` localStorage for default earnings tab + lane filter (URL still wins); PRINT TRACK wrapped in `<details>` default collapsed; halo rings label net-zero as `balanced`; lookup full-response `serverCache` keyed by ticker + ET day + timeline id set. |
| **Status** | FIXED — `meridian-desk-prefs-core.test.ts`. |
