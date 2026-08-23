## 2026-08-23 — [FINDING, P3 Helix] Two chart panels where the file already contained the right answer and the render path didn't use it — FIXED

> **kind:** `FINDING`

Found by sweeping every bar-width computation in the HELIX panels for the shape that broke `ExpiryConcentration` — a max denominator read off `[0]` of an array sorted by something else. **That specific bug is not present anywhere else**: `VelocityRadar` uses a real `Math.max(...)`, and `RouteBreakdown`, `NetPremiumLeaderboard` and `SectorFlowPanel` all sort by the same field they read the max from. The sweep surfaced two different defects instead, both of the same shape — *the correct version already exists in the same file.*

### (a) `NetPremiumLeaderboard` renders `width: NaN%` for a zero-premium row

| Field | Detail |
|---|---|
| **Root cause** | The row builder refuses to divide by zero — `callPct: calls + puts > 0 ? Math.round((calls / (calls + puts)) * 100) : 50` — and then the render path **recomputed the same ratio** two lines later without the guard: `const callBarW = Math.round((row.calls / row.total) * barW)`. |
| **Evidence — executed, not reasoned** | With `calls: 0, puts: 0, total: 0`: `row.callPct` (guarded) → **50**; `barW` → 0; `callBarW` → **NaN**; `putBarW` → **NaN**; rendered as `width: NaN% / width: NaN%`. |
| **Reachability** | Narrow but real. A row exists for any ticker on the tape and `.slice()` only trims the top N, so on a thin or filtered tape a ticker whose prints all carry zero premium reaches the render. |
| **Fix** | Extracted to `leaderBarWidths(row, maxTotal)` in `helix-bar-widths.ts` — the arithmetic was three inline expressions inside a `.map()`, unreachable from a test. `callBarW` is now guarded on `row.total > 0`, and `barW` on `maxTotal > 0`. The zero case returns **0-width bars, not a 50/50 split**: `barW` is already 0 for such a row, so half a bar of each colour would invent width the row has no premium to justify. `putBarW` stays derived by subtraction rather than a second division, so the two slices always sum to exactly `barW` — the rail is `overflow-hidden`, and two independently-rounded divisions can land a pixel over. |
| **The pattern** | The guard existed, in the same file, on the same quantity. It just was not applied where the division happens. That is the sixth instance this session of *a guard placed where the bug was found rather than everywhere the bug can occur* — after #2721, #2722, #2725, #2727 and #2741. |

### (b) `SectorFlowPanel`'s SECTOR_ORDER comparator is dead code, and its comment describes behaviour that never happens

| Field | Detail |
|---|---|
| **Root cause** | `[...entries].sort(<SECTOR_ORDER-aware comparator>).sort((a, b) => b.total - a.total)`. The second sort replaces the ordering wholesale, so the curated sector grouping never reaches the screen. The comment above it reads *"Sort by SECTOR_ORDER then by total premium for unlisted sectors"* — which is what the first comparator does and what the panel does not. |
| **Evidence** | Ran both orderings against the same input: **byte-identical output**. `SECTOR_ORDER` is imported by this file for the dead comparator only — its sole other reference is its definition in `sector-map.ts`. |
| **Why remove rather than leave** | Someone changing the sector ordering would edit those eight lines and watch nothing happen. Dead code that looks load-bearing costs more than no code. |
| **Fix, and what it deliberately does NOT decide** | The comparator and the now-unused import are deleted; the surviving `.sort((a, b) => b.total - a.total)` is **exactly what shipped**, so no member sees any change. Whether the panel *should* group by `SECTOR_ORDER` instead of ranking by premium is a **product question**, recorded in the comment and not answered here — quietly "restoring" the sector grouping would be a silent behaviour change dressed as a cleanup. |

| **Blast radius** | Two panels. `NetPremiumLeaderboard` swaps three inline expressions for one call, identical output for every non-zero row and finite output for the zero row. `SectorFlowPanel` loses dead code only. No API, no Largo field, no persisted value, no shared helper touched. |
| **Regression guard** | 7 tests, proven falsifiable: restoring the unguarded division fails **3 of 7**, the fix passes 7/7. They pin the NaN case by name; that a zero-premium row draws nothing rather than 50/50; that an empty leaderboard (`maxTotal` 0) gives empty bars rather than infinite ones; that the largest row fills the rail and splits by its call share; that a smaller row scales against the **largest**, not itself; that the two slices always sum to `barW` across five ratio shapes; and the all-put / all-call extremes. |
| **Status** | FIXED. |
