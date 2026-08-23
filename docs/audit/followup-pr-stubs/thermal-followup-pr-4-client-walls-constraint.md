# PR: Fix Client Walls Constraint Issue (Awaiting Product Decision)

**Issue:** Member route's Key Levels row calls `gexWallsFromStrikeTotals(totals)` without spot, so it shows wrong-side walls. Server returns `null`.

**Root cause:** The client-side wall computation in the Key Levels row doesn't apply spot-side constraint (call walls must be ≥ spot, put walls must be ≤ spot). It naively uses the raw highest/lowest strikes from the totals, which can show nonsensical "call wall below spot" levels.

Server-side `wallsFromStrikeTotals(totals, spot)` correctly constrains. Server returns `null` when no valid wall exists on a side.

**Current behavior on SPX 4800 spot:**
- Call wall shows 4795 (should be ≥4800, but shows below)
- This is the highest call GEX, but it's below spot, so it's not a meaningful resistance level

**Decision needed:** Product choice between two approaches:

### Option A: Relabel as Concentration (Public Page Model)
- Show the highest GEX strike on each side, regardless of side
- Relabel: "Concentration" instead of "wall"
- Rationale: Traders interested in where dealer gamma is centered, not directional resistance
- Impact: Matches public page `/tools/gamma-snapshot` behavior

### Option B: Constraint to Same Side of Spot (Member Route Model)
- Show only strikes on the correct side of spot
- Return `null` if no valid wall exists
- Rationale: Walls are directional support/resistance, must be on correct side
- Impact: Some strikes show `null` wall, but it's honest

**Files affected (once decision is made):**

```typescript
// In the Key Levels UI component:
// Currently:
const callWall = gexWallsFromStrikeTotals(totals); // NO spot input, unconstrained

// Option A (relabel):
const callWall = gexWallsFromStrikeTotals(totals); // unchanged
// UI: label as "Peak concentration" not "Wall"

// Option B (constrain):
const callWall = gexWallsFromStrikeTotals(totals, spot); // add spot
// UI: show null as "—" when no valid side
```

**Related code:**
- Server: `src/lib/providers/polygon-options-gex.ts` `wallsFromStrikeTotals` (takes spot, constrains)
- Client: `src/app/heatmap/key-levels.tsx` or similar (calls without spot)

**Tests:**
- Unit: `gex-walls.test.ts` — verify constraint logic (call wall ≥ spot, put wall ≤ spot)
- Integration: Data validator — measure % of sessions where Option B would show `null` on either side
- Live: Tomorrow — visual check that Key Levels row makes sense on SPX/SPY/QQQ during RTH

**Decision template:**
> Do you want Key Levels "walls" to represent:
> (A) **Concentration** — highest GEX on each side regardless of spot position (relabel, always has a value)
> (B) **Resistance/Support** — walls constrained to correct side of spot (null if no valid level on that side)

**Recommendation:** Option B (constrain) — walls are directional signals and showing wrong-side peaks is worse than showing null. Document in UI: "Wall shows the highest dealer gamma level above/below spot; null when no option exists on that side."

**Risk:** Medium. Changes Key Levels display; some tickers will show `null` where they currently show a value. But the current values are misleading.
