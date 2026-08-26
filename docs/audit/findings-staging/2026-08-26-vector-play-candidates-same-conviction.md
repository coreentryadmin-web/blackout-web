> **kind:** FINDING

## Vector contract picks cloned range legs at one conviction — FIXED

| **Status** | FIXED in `cursor/vector-play-candidates-rank-3d11` |
|---|---|

**Symptom:** META (and any range play) showed 575C 0DTE + 565P 0DTE both at 75% — contradictory legs, forced 0DTE via chart horizon, no per-pick justification.

**Root cause:** `legsForBias("range")` priced call+put at the same `play.conviction`; `horizonMaxDte(chart toggle)` restricted all picks to 0DTE when the desk was on 0DTE.

**Fix:** `rankVectorPlayCandidates` searches 0DTE / weekly / monthly independently, scores each pick (walls, spot proximity, HELIX flow, DTE fit, liquidity), returns top 1–3 with distinct confidence + reason bullets in the drawer.
