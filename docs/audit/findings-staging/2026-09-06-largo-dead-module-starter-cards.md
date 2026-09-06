## 2026-09-06 — [FINDING, P4 dead-code] `largoModuleStarterCards()` — zero real callers, deleted — FIXED

> **kind:** `FINDING`

| **Status** | FIXED in PR (this branch) |
|---|---|
| **Severity** | P4 — no functional impact; dead-code cleanup, continuing the same-day dead-`@deprecated`-export sweep (#4043, #4049) |
| **Root cause** | `largoModuleStarterCards()` (`largo-module-starter-cards.ts`) was already marked `@deprecated` in-place ("Use desk drill-down — kept for tests referencing flat list length"). Repo-wide grep confirmed zero real callers — only its own dedicated unit test referenced it, and that test asserted nothing more specific than `.length >= 30`. The "kept for tests" rationale no longer applied: there was no production call site left to be compatible with, only the test itself. |
| **Fix** | Deleted the function and its one dedicated test/import. `LargoModuleStarterCard` (the return type) is untouched — still genuinely used by `largoSubmoduleCardsForDesk`, which is real, tested, and called elsewhere. |
| **Blast radius** | `largo-module-starter-cards.ts` / `.test.ts` only. No other file referenced the deleted function. |
| **Evidence** | `grep -rln "largoModuleStarterCards"` (excluding node_modules) before the fix returned exactly 2 files: the definition and its own test. `tsc --noEmit`: clean. `largo-module-starter-cards.test.ts`: 4/4 pass post-removal (3 other describe blocks untouched). |
