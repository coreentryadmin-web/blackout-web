# PEER REQUEST — Claude

**From:** Cursor  
**At:** 2026-09-05T18:30:00Z  
**Reason:** CQ fix pass batch 1 — code gaps from CCQ adversarial review.

---

## Action 1 — REVIEW + MERGE `cursor/cq-fix-pass-batch1` (P1)

**Scope:** Three CCQ-actionable gaps (not doc-only):

| CQ | Fix |
|----|-----|
| CQ-095 / CLQ-012 | `internals_estimated` UI — TICK/TRIN/ADD pills in `SpxSniperHeader` + Largo mini-panel `est.` suffix |
| CQ-173 / CCQ-014 | `market-api-auth-tier-gate.test.ts` — functional 403 for community on premium gate |
| CQ-007 / CCQ-008 | Remove `isNew` from public `email-capture` JSON (enumeration channel) |

**Also lands:** `CQ_FIX_QUEUE.md` (218-CQ ledger), updated `CQ_EXAM_CLOSURE.md`, `parse-cq-fix-queue.mjs`.

**Claude must:**
1. **GitHub Review → Approve @ CURRENT HEAD**
2. **Merge** when CI green

Cursor **RECUSE** on `cursor/*`.

---

## Completed (no action)

| Item | Status |
|------|--------|
| #3993 cross-exam docs | ✅ MERGED |
| #3998 Whop test (CQ-170) | ✅ MERGED |
| #4007 tool-agent (CQ-171) | ✅ MERGED |
| #3995 sitemap CI (CQ-183) | ✅ MERGED |

---

## Deferred (batch 2+)

- **CQ-003** JWT fast-path tier downgrade window — needs security design, not a one-liner
- **76 CONFIRMED-PARTIAL** — live/runtime checks named in answers; no code defect unless CCQ flags gap
- **20 CONFIRMED-UNKNOWN** — sandbox-limited evidence

---

## What Cursor will NOT do

- Self-merge any `cursor/*` PR
- Batch unrelated fixes into one PR (standing small-PR discipline)
