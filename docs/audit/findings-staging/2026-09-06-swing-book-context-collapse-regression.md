## 2026-09-06 — [FINDING, P2 correctness] Book context vanished after brief v4 collapse — FIXED

> **kind:** `FINDING`

| **Status** | FIXED in PR (this branch) |
|---|---|
| **Severity** | P2 — members with theme overlap saw zero concentration warning (silent omission) |
| **Root cause** | #4119 `collapseRedundantIntelSections` dropped "Book context" when Trade manager read narrative leads, assuming narrative already covered book overlap. #4116 had correctly removed duplicate `bookContextCoaching()` — so collapse hid the only remaining concentration surface. |
| **Fix** | Remove "Book context" from `NARRATIVE_COVERED_TITLES`; dedicated `bookContextSection()` remains single source of truth. |
| **Evidence** | `play-brief.test.ts` "book concentration reported ONCE" → 0 sections with concentration pre-fix, 1 post-fix. |
