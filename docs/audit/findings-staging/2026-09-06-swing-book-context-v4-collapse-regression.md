## 2026-09-06 — [FINDING, P2 correctness] Brief v4 collapsed "Book context" after #4116 removed narrative duplicate — concentration vanished entirely — FIXED

> **kind:** FINDING`

| **Status** | FIXED |
|---|---|
| **Severity** | P2 — member-visible absence of book overlap warning (Truth > everything) |
| **Root cause** | #4116 correctly removed `bookContextCoaching()` so `bookContextSection()` is the sole source. #4119 added `collapseRedundantIntelSections()` with `"Book context"` in `NARRATIVE_COVERED_TITLES`, assuming narrative still coaches overlap — it does not. Result: concentration in **zero** sections; `play-brief.test.ts` integration guard failed on `main`. |
| **Fix** | Remove `"Book context"` from the collapse set; add collapse unit test pinning it stays when narrative leads. |
| **Evidence** | RED: `play-brief.test.ts` `concentrationSections.length` 0 !== 1. GREEN: same test + new `play-brief-intel-collapse.test.ts` case pass. |
