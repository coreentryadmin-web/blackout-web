## 2026-10-21 — [FINDING, stale-OPEN correction] `ThermalCompareStrip` change_pct finding — fixed same day, file later deleted entirely — correction

> **kind:** `FINDING`

| | |
|---|---|
| **What this corrects** | `docs/audit/FINDINGS.md`'s 2026-09-05 entry **"`ThermalCompareStrip` still uses raw `change_pct` not `rebaseChangePct` — OPEN"** (P2, data-correctness, Cursor 360° cross-exam CLQ-018), which has sat marked OPEN for ~6 weeks |
| **Status** | FIXED — the root cause this entry names was fixed the SAME day it was filed, and the file itself was later deleted entirely as orphaned dead code |

**What actually happened, by commit:**
- `359702bd0`/`8b67fda20`/`bf2e44cc9` — all three dated **2026-09-05**, the same day as the
  OPEN entry — are three passes of `fix(thermal): rebase compare(-)strip change_pct on live push
  spot`, the last merged as **#3962** (CLQ-018). This is the exact fix the FINDINGS entry's own
  "Recommended fix" row describes ("mirror `rebaseChangePct` pattern from #3944") — it landed
  before the OPEN status was ever corrected.
- `c992fd862`/`e27844e73` (2026-10-12, PR #5917) — `fix(thermal): remove ThermalCompareStrip.tsx,
  orphaned since 2026-07-28`. The component was later found to have zero live callers and was
  deleted outright, so the question the finding raises (does this component's % change agree with
  the rebased desk headers) is now moot — there is no such component left to disagree.

**Why this matters as a correction, not just a status flip.** This is the exact "re-verify old
FINDINGS.md claims" trap this repo's own entries already warn about elsewhere (see the 2026-08-18
Meridian and 2026-08-30 zerodte-session-anchor stale-OPEN corrections) — a six-week-old OPEN entry
describing a file and a bug that have both been gone for over a week. Confirmed directly, not
inferred:
```
$ find src -iname '*ThermalCompareStrip*'
(no output — file does not exist)
$ git log --oneline --all | grep -i "compare.*strip.*rebase"
bf2e44cc9 fix(thermal): rebase CompareStrip change_pct on live push spot (#3962)
0cf3b49f7 docs(audit): add market-open watch item for compare strip rebase
8b67fda20 fix(thermal): rebase compare-strip change_pct on live push spot (CLQ-018)
359702bd0 fix(thermal): rebase compare strip change_pct on live push spot
```

**No code changed, no gate touched.** Documentation-only correction, same convention as the prior
stale-OPEN corrections in this file (new dated entry, original left intact).
