## 2026-09-06 — [FINDING, P2 swing] Book context collapsed after narrative coaching removed — FIXED

> **kind:** `FINDING`

| **Status** | FIXED in PR (this branch) |
|---|---|
| **Severity** | P2 — members with overlapping swing book saw no concentration warning at all (worse than duplicate) |
| **Root cause** | `#4116` removed `bookContextCoaching` from Trade manager read bullets, but `collapseRedundantIntelSections` still listed `"Book context"` in `NARRATIVE_COVERED_TITLES`, so the dedicated section was dropped whenever narrative was present |
| **Fix** | Removed `"Book context"` from the collapse set; regression test ensures it survives when narrative leads |
| **Evidence** | `play-brief.test.ts` RED on main (`0 !== 1` concentration sections) → GREEN post-fix; `play-brief-intel-collapse.test.ts` 3/3 |
