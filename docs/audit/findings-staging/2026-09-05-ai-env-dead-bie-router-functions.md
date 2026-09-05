## 2026-09-05 — [FINDING, P4 dead-code] `largoSkipBieRouter()`/`largoBieOnly()` — zero real callers, deleted — FIXED

> **kind:** `FINDING`

| **Status** | FIXED in PR (this branch) |
|---|---|
| **Severity** | P4 — no functional impact; dead-code cleanup |
| **Root cause** | `src/lib/ai-env.ts` still exported two functions both already marked `@deprecated` in-place ("Largo no longer runs the BIE router — always Claude + tools. Kept for call-site compat." / "Largo is Claude-only; BIE-without-Claude mode was removed."), left over from the 2026-08 change (#1766, per the module's own header comment) that made Largo Claude-only permanently. Confirmed via repo-wide grep: `largoSkipBieRouter` and `largoBieOnly` had **zero real callers** — only their own unit tests referenced them. The "kept for call-site compat" rationale in the doc comment no longer applied; there was no call site left to be compatible with. |
| **Fix** | Deleted both functions and their two dedicated unit tests in `ai-env.test.ts` (the remaining tests — `largoClaudeEnabled`, `largoAvailable`, `isStagingBieMode` — are all still real, called functions and untouched). Also annotated `docs/bie/LARGO-DATA-ACCESS-AUDIT.md` (dated 2026-07-17, predates the Claude-only reversal) as HISTORICAL/superseded at the top, since it documents the now-removed BIE-router migration plan and referenced these two functions by name — left in place for historical context rather than deleted, per the "don't delete work you didn't create without reason" discipline, but now clearly marked so nobody reads it as current guidance. |
| **Blast radius** | `src/lib/ai-env.ts`/`ai-env.test.ts` only for the code change; one doc annotation. No other file referenced either function. |
| **Evidence** | `grep -rln "largoSkipBieRouter\|largoBieOnly" .` (excluding node_modules) before the fix returned exactly 3 files: `ai-env.ts` (definition), `ai-env.test.ts` (its own tests), and the now-annotated historical doc — no production call site anywhere. `npx tsx --test src/lib/ai-env.test.ts` (Node 20): 2/2 pass post-fix; `tsc --noEmit` clean. |
