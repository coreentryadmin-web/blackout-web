# Re-Audit — Batch 07: Frontend + Config/Deploy

> **Repo:** `C:\Users\raidu\blackout-web`  
> **Phase:** 3 · **Date:** 2026-06-19  
> **Original:** `audits/AUDIT-Frontend-Config.md`

---

## Finding status

| ID | Status | Evidence |
|----|--------|----------|
| **F1/H2** | ✅ **FIXED** | Polygon key redacted in docs |
| **F2** | ✅ **FIXED** | Auth-gated `/api/docs/spx-playbook` |
| **F3/F4/F9** | ✅ **FIXED** | Premium docs layout + `.env` gitignore |
| **F5** | ✅ **FIXED** | `next.config.mjs` — HSTS, CSP, frame-ancestors, etc. |
| **F6** | ✅ **FIXED** | `TradingViewWidget.tsx` — iframe `sandbox` |
| **F7** | ✅ **FIXED** | `tsconfig.json` — `"strict": true` |
| **F8** | ℹ️ **INFO** | Railway build DB URL pattern (expected) |
| **S1/S4/S5/S7** | ✅ **FIXED** | Mitigated via F5 CSP baseline + premium docs gate |
| **FC-NEW-1** | ✅ **FIXED** | `/api/health` deploy liveness |

---

## Summary counts

| Status | Count |
|--------|------:|
| ✅ FIXED | 12 |
| ⚠️ PARTIAL | 0 |
| ❌ OPEN | 0 |
| 🆕 NEW | 0 |
| ℹ️ INFO | 1 |
