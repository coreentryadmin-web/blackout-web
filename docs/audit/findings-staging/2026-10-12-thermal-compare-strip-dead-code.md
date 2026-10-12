## 2026-10-12 — [FINDING, P3 dead-code] `ThermalCompareStrip.tsx` orphaned since 2026-07-28 — five FINDINGS.md "fixes" shipped to code that could never render — FIXED

> **kind:** `FINDING`

| **Area** | **Severity** | **Status** |
|---|---|---|
| Thermal desk / Heatmap components | P3 — dead code, multiple real fixes wasted on it | FIXED |

**What's wrong.** `src/features/thermal/components/ThermalCompareStrip.tsx` (the SPY/SPX/QQQ
"compare strip" — three live mini-matrix cards above the main Heatmap) has had **zero render
call sites anywhere in the repo for 2.5+ months**, yet kept receiving real, tested fixes as if it
were a live sibling of `GexHeatmap`/`ThermalTripleDesk`.

- **Orphaned by:** commit `230726ee0` ("feat(thermal): SPY|SPX|QQQ triple desk with dense expiry
  columns", 2026-07-28). The diff removes `import { ThermalCompareStrip } from
  "@/features/thermal/components/ThermalCompareStrip"` and its only JSX render call from
  `GexHeatmap.tsx`, replacing it with `<ThermalTripleDesk>` — the commit message says so
  explicitly: "Replace the compare strip as the Matrix hero with three live compact matrices
  side-by-side." The component file itself, and its barrel export, were never removed.
- **Confirmed zero remaining callers**, repo-wide: grepping `ThermalCompareStrip` across all
  `.ts`/`.tsx` turns up only the component's own file, its own test, and the dead barrel-export
  line in `src/features/thermal/index.ts:5` — no component, route, or test imports and renders it.
- **Real fixes shipped into dead code anyway** — at least five `FINDINGS.md` entries (2026-08-13,
  2026-08-14, 2026-09-05 ×2, 2026-10-06) diagnose and "fix" bugs inside this file (a hardcoded
  "Live matrix · 5s" liveness claim, raw `change_pct` not rebased against live push spot, a dead
  ternary, an unguarded `active:scale` transform, a missing min-height causing layout jump) — every
  one landed on a file that has not been reachable by any user since 2026-07-28. None of those
  fixes were wrong on their own terms; they just could never be seen.
- **Precedent already exists for exactly this class of bug**: `src/repo-hygiene.test.ts`'s
  "known-orphaned modules stay removed" test already carries `ThermalFreshnessBar.tsx` — superseded
  the same way (absorbed into `ThermalTripleDesk`'s own inline freshness chip) and already deleted.
  `ThermalCompareStrip.tsx` was never added to that list.

**Fix.** Deleted `ThermalCompareStrip.tsx` and its dedicated test
(`ThermalCompareStrip-header-change-pct.test.ts`). Removed the dead barrel-export line in
`src/features/thermal/index.ts` (the `THERMAL_COMPARE_TICKERS`/`ThermalCompareTicker` exports on
neighboring lines stay — confirmed live callers in `GexHeatmap.tsx`, `src/lib/largo/slash-prompts.ts`,
`src/lib/largo/product-reads.ts`, `thermal-compare-presets.ts`). Added the file to
`repo-hygiene.test.ts`'s existing allowlist with a dated explanation, matching the `ThermalFreshnessBar`
precedent exactly.

**Blast radius caught one level deeper.** `thermalCompareStripLabel()` (`thermal-desk-state.ts`) —
the strip's cadence/liveness label helper — had exactly one real caller: `ThermalCompareStrip.tsx`
itself. Deleting the component without also removing this helper would have just created a second,
smaller orphan of the identical shape. Removed the function, its doc comment, and its 4 dedicated
unit tests in `thermal-desk-state.test.ts` in the same PR. `THERMAL_COMPARE_TICKERS` and
`ThermalCompareTicker` are NOT part of this — confirmed they have real callers elsewhere and were
left untouched.

**What was deliberately left alone.** `GexHeatmap-header-change-pct.test.ts`'s doc comment
("ThermalCompareStrip already uses `?? null`...") still mentions the now-deleted component by name
— left as-is, since it's narrating a past comparison (matching this codebase's own convention of
"THE BUG THIS REPLACES" historical doc comments elsewhere), not asserting a live dependency; the
test itself only reads `GexHeatmap.tsx`, never `ThermalCompareStrip.tsx`.

**Verification.** `tsc --noEmit` clean. Full Thermal feature suite (`npx tsx
--experimental-test-module-mocks --test $(find src/features/thermal -name "*.test.ts" -o -name
"*.test.tsx")`) — 137/137 pass. `src/repo-hygiene.test.ts` — 7/7 pass (the new allowlist entry
only resolves once the deletion is staged/committed — `git ls-files` reflects the index, not the
working tree).

Found via a background Explore-agent sweep of Thermal desk components, independently re-verified
before fixing: confirmed the exact commit and diff that orphaned the file (`git show 230726ee0`),
confirmed zero remaining repo-wide callers via grep, confirmed the five FINDINGS.md entries citing
real fixes shipped to this dead file, and confirmed `thermalCompareStripLabel`'s only caller before
removing it alongside the component.
