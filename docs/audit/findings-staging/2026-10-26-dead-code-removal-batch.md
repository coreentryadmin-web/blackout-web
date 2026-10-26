## Three confirmed-dead files removed: DealersLadderBackground.tsx, package-scorer.ts, visual-memory-persist.ts

> **kind:** `FINDING`

### Root cause

Per the standing "check for dead code/stale docs" mandate, three non-owned-lane files were confirmed to have zero live references anywhere in the repository and removed:

- **`src/components/render/DealersLadderBackground.tsx`** (625 lines) — the "Phosphor Ladder" WebGL hero background. Flagged as a dead-code candidate by a sibling round this cycle (zero importers) and independently re-confirmed here via a fresh `git fetch origin main` + full-repo grep for `DealersLadderBackground`: the only hits are the file's own internal self-references (type name, function name, closing brace comment). No other `.ts`/`.tsx` file in `src/` imports or renders it. No sibling `.test.tsx` or barrel `index.ts` exists in its directory.
- **`src/lib/x-intel/package-scorer.ts`** — exports `scoreAttachmentPackage`, `PackageAttachmentPlan`, `PackageScoreBreakdown`, `MIN_PUBLISH_SCORE`. Full-repo grep for the module path (`package-scorer`) and for each named export individually returned zero importers. One near-miss required manual verification: `MIN_PUBLISH_SCORE` also appears in `src/features/nighthawk/lib/constants.ts` (value `38`) and is imported from there by `deterministic-edition.ts`/`edition-quality.ts`/`nighthawk-evening-replay.mjs` — traced and confirmed this is a coincidentally-identically-named, independently-defined constant in an unrelated owned-lane module, not a reference to `package-scorer.ts`'s export. No actual import of `package-scorer.ts` exists anywhere.
- **`src/lib/x-intel/visual-memory-persist.ts`** — exports `VisualMemoryLedger`, `PublishHistoryLedger`, `appendVisualMemory`, `appendPublishRecord`, and the file-path constants `VISUAL_MEMORY_PATH`/`PUBLISH_HISTORY_PATH` (`data/x-intel/visual-memory.json`, `data/x-intel/publish-history.json`). Full-repo grep for the module path, every named export, and both JSON path strings returned zero hits anywhere else in the repo — confirming no other module writes to or reads from those ledger files via this module, and nothing else expects this module to exist as their writer.

### Evidence

For each file: `grep -rln "<module-path>"` and `grep -rln "<each named export>"` across the entire repository (excluding `node_modules`) returned zero results prior to deletion. After deletion, `npx tsc --noEmit` passes clean (no broken imports anywhere in the codebase) and `npx eslint src/` reports 0 errors (pre-existing warning count unchanged). No test files reference any of the three removed files.

### Blast radius

Zero. Each file was independently confirmed to have no importers, no barrel re-export, no dynamic `import()`/string-path reference, and no test coverage. Removing them changes no runtime behavior anywhere in the product.

### Fix rationale

This is pure dead-code deletion, not a design decision — every reference check came back empty before any file was touched, and `tsc`/`eslint` prove nothing else in the tree depends on them. Removing confirmed-unreferenced code reduces maintenance surface with no behavioral risk, consistent with the standing dead-code-hunting mandate.

| **Status** | Removed — see PR for exact diff. |
|---|---|
