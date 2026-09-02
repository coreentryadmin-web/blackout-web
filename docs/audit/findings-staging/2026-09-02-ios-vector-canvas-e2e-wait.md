> **kind:** FINDING

## iOS E2E Vector canvas flake after SPX segment switch — FIXED (harness)

| **Status** | Fixed — `waitForVectorCanvas()` + resilient segment clicks |
| **Severity** | P3 harness |
| **Surface** | `scripts/ios-native-ui-e2e.mjs` |

**Symptom:** `pro:spx:vector-canvas` failed with `h=0` after Matrix→Vector segment switch because the harness only slept 3s while `SpxVectorEmbed` dynamic-imports + fetches seed.

**Fix:** Poll until `.vector-chart-canvas canvas` client dimensions exceed 80×80; dismiss command deck overlay before segment clicks; early-return dashboard content assert when Intel segment hides vector.

**Evidence:** Re-run measured `pro:spx:vector-canvas — h=282 w=312` PASS during RTH.
