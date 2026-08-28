# Vector pivot PLYS panel vanished at gamma flip — FIXED

> **kind:** FINDING

## Symptom

On `/vector?ticker=TSLA` (and any ticker in transition at the gamma flip), members saw the SCALP play card (`bias: neutral`, setup `pivot`) but the **PLYS** contract-picks panel was completely absent.

## Root cause

`VectorContractPicksCard` returned `null` whenever `play.bias === "neutral"` with no picks. Pivot plays intentionally stay neutral in the play card ("long above / short below") while spot straddles the flip, so the panel silently disappeared even though the play rail was visible.

## Fix

- `effectivePickBias()` — once spot clears the flip by `PIVOT_PICK_COMMIT_EPS`, rank the committed side for picks.
- `pivotPickWaitingCopy()` — honest PLYS waiting state when spot is still on the flip.
- Thread `setup` through `VectorPlay` + contract-picks API parse path.

| **Status** | FIXED in PR (cursor/vector-pivot-plays-panel-3d11) |
