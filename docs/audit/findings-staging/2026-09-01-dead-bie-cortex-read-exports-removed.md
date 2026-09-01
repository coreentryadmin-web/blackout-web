## 2026-09-01 — [cleanup, BIE/Largo] two dead BIE cortex-read exports removed (pinnedCortexLinesForSession, renderCortexCitation) — FIXED

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **Context** | PR 2 of 6 from the dedicated dead-code cleanup audit (8 subsystems, hunt + adversarial verify) launched after the user asked for a real dead-code sweep across the 0DTE/BIE stack. |
| **Root cause** | Two functions in `src/lib/bie/cortex-read.ts`, each superseded by an independently-tested live equivalent that was wired in instead, with the old function left behind: (1) `pinnedCortexLinesForSession()` — the board composer that would plausibly need it, `src/lib/platform/zerodte-service.ts`, instead calls `cortexSummaryFor` (imported from `@/lib/zerodte/cortex-gate`), an independently-tested, actually-wired equivalent — confirmed at `zerodte-service.ts:31,1154`. (2) `renderCortexCitation()` — its sole plausible consumer, `verdict-core.ts`'s Cortex evidence section, builds its citation markdown inline with different label text rather than calling this function — confirmed by reading `verdict-core.ts` directly, no reference to `renderCortexCitation` anywhere in it. |
| **Evidence** | Independently re-ran a whole-repo grep for both symbol names immediately before deleting: every hit for `pinnedCortexLinesForSession` and `renderCortexCitation` is inside `cortex-read.ts` (the definition) or `cortex-read.test.ts` (the test) — zero external callers. Confirmed `ledgerRowsFor`, the helper `pinnedCortexLinesForSession` called, has 3 other live call sites in the same file (unaffected by this removal). Confirmed the `CortexCitation` type itself stays live — it's still returned by `citationFromView`/`cortexCitationFor` elsewhere in the file; only the standalone markdown-rendering function built on top of it is dead. |
| **Fix** | Deleted both functions from `cortex-read.ts`. Deleted the dedicated `pinnedCortexLinesForSession` test. The `renderCortexCitation + directionFromQuestion` test bundled two unrelated functions — kept `directionFromQuestion`'s coverage (still live), dropped only the `renderCortexCitation` assertions, renamed the test. |
| **What was deliberately NOT changed** | `ledgerRowsFor` and its 3 other live callers. `CortexCitation` type, `citationFromView`, `cortexCitationFor` — all confirmed live, untouched. |
| **Blast radius checked** | Grepped both removed symbols across the whole repo — zero surviving references. No script or cron reference. |
| **Regression guard** | `cortex-read.test.ts`: 31/31 pass. Full `src/lib/bie/*.test.ts`: 730/730 pass. `npx tsc --noEmit` clean. |
| **Status** | FIXED — PR pending (2 of 6 from the dead-code cleanup plan). |
