## 2026-08-25 — [FINDING, P3 Meridian] History tab repeated the same track-record sentence verbatim — FIXED

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **Symptom** | Live, DKS earnings (2026-08-25), History tab: `MeridianEarningsHistoryPanel`'s own "Summary" card and the "Track record" `MeridianAnalyticsBanner` immediately below it both rendered `enrichment.print_history_summary` — the identical string, twice, back to back. Found during a CTO-depth Meridian audit (`docs/audit/MERIDIAN-CTO-AUDIT-2026-08-25.md`). |
| **Root cause** | `MeridianEarningsTabs.tsx`'s history-tab block rendered a `MeridianAnalyticsBanner` with `headline={enrichment.print_history_summary}` directly after `MeridianEarningsHistoryPanel`, which already renders that same field as its own "Summary" panel. Not two views of the data — the same sentence twice. |
| **Fix** | Removed the duplicate `MeridianAnalyticsBanner` block. `MeridianAnalyticsBanner` remains in use elsewhere in the same file (Report/Positioning/Estimates tabs) — only this one redundant call site was removed. |
| **Status** | FIXED — one-line removal (plus the surrounding block), no behavior change beyond the duplicate no longer rendering. `npx tsc --noEmit` clean. |
