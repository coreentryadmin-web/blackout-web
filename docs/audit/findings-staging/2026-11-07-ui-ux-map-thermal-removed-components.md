> **kind:** FINDING

## 2026-11-07 — `docs/audit/UI-UX-MAP.md` §4 (Thermal) cites two components deleted months ago as current, and understates the file count — FIXED (docs)

| **Status** | FIXED on `fix/ui-ux-map-thermal-stale-components` (docs-only) |
| --- | --- |

**Symptom:** `docs/audit/UI-UX-MAP.md` §4's Thermal "Coordinates" line lists the product's
component inventory as "11 component files total" and names seven examples, including
`ThermalCompareStrip` (213 lines) and `ThermalFreshnessBar` (91 lines). Both files were deleted
from the repo before this round, so a reader following the doc into the source tree would not
find them — present-tense claims about files that no longer exist.

**Verification against current `main`:**

- `find . -iname "*ThermalCompareStrip*" -not -path "*/node_modules/*" -not -path "*/.git/*"` and
  the same for `ThermalFreshnessBar` return nothing under `src/` — neither file exists.
- `git log --oneline --diff-filter=D --all -- src/features/thermal/components/ThermalCompareStrip.tsx`
  → `c992fd862`/`e27844e73` = **#5917**, "fix(thermal): remove ThermalCompareStrip.tsx, orphaned
  since 2026-07-28" (merged 2026-10-12). `src/repo-hygiene.test.ts`'s own removed-files comment
  confirms: *"neither of which calls it"* (zero live call sites).
- `git log --oneline --diff-filter=D --all -- src/features/thermal/components/ThermalFreshnessBar.tsx`
  → `f64fb1185`/`09bb330c0` = **#3624**, "fix(dead-code): remove six orphaned SPX/Thermal/marketing
  modules" (merged 2026-09-04). `repo-hygiene.test.ts`'s comment explains the file was
  *superseded*: `ThermalTripleDesk.tsx` grew its own inline `ThermalMatrixFreshnessChip`, a strict
  subset of what the original showed, and nothing pointed back at the fuller original.
- Re-counting `src/features/thermal/components/*.tsx` (excluding `*.test.ts`) today gives **13
  files**, not 11 — the doc's count was already stale even setting the two deletions aside, because
  five newer components (`GreeksDistributionPanel.tsx`, `ThetaDistributionPanel.tsx`,
  `ThermalSessionTimeline.tsx`, `ThermalSavedDesksMenu.tsx`, `ThermalSkeleton.tsx`) were added after
  this section's original 2026-08-23 pass and were never folded into the inventory.
- Line counts for the five named components that do still exist have also drifted since the
  original pass (e.g. `ThermalTripleDesk` 537→557, `ThermalRegimeStrip` 159→195, `GexHeatmap.tsx`
  4530→4649) — ordinary code churn, noted but not individually called out as a defect.

**Fix (docs-only):** struck through the two removed component names in the original inventory
line (`~~ThermalCompareStrip (213)~~`, `~~ThermalFreshnessBar (91)~~`) and added a
`**CORRECTED 2026-11-07**` paragraph immediately after, naming each removal's PR/date/reason and
giving the re-counted current 13-file inventory with today's line counts — the same convention
this file already uses throughout for every other correction (strikethrough + dated correction
note, never a silent rewrite).

**Blast radius:** `docs/audit/UI-UX-MAP.md` only — no source files changed. Checked
`docs/audit/UI-UX-OPPORTUNITIES.md` for the same two names: no hits, so no sibling doc needed the
same fix.

**Evidence:**
- `git log --oneline --diff-filter=D --all -- src/features/thermal/components/ThermalCompareStrip.tsx src/features/thermal/components/ThermalFreshnessBar.tsx` — the two deletion commits above.
- `grep -rl "ThermalCompareStrip\|ThermalFreshnessBar" src` — only `src/repo-hygiene.test.ts` (which asserts they stay deleted), confirming no live reference survived either removal.
- `ls`/`wc -l` on `src/features/thermal/components/*.tsx` — the current 13-file, re-counted inventory quoted above.
- Docs-only change — full `npm test` run before push to confirm no regression; `npx tsc --noEmit` unaffected (no `.ts`/`.tsx` touched).

Found while fact-checking `docs/audit/UI-UX-MAP.md` §4 against current source, per the standing
"cross-check present-tense claims against actual current source, not the doc's own internal
consistency" audit methodology (round 383 prompt lead #3).
