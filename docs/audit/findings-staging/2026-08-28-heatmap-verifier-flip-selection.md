> **kind:** FINDING

## Heatmap verifier gamma_flip P0 false-flag — lowest vs nearest crossing — FIXED

| **Status** | Fixed in PR (cursor/heatmap-verifier-flip-selection-3d11) |
|---|---|

**Symptom:** `ops:collect` P0 `[invariant/gamma_flip]` on ~$215 tickers off-hours — reported flip 214.95 vs verifier "nearest" 219.01 (~4pt).

**Root cause:** Production `cumulativeGammaFlipDetail` (2026-08-19) selects the **lowest plausible** short→long crossing; `heatmap-verifier.ts` INV-4 still used **nearest-to-spot**, so multi-crossing books false-flagged whenever spot sat closer to the upper crossing.

**Fix:** Align `deriveCumulativeGammaFlip` selection with production (lowest plausible within ±12%). Test ratchets parity against `cumulativeGammaFlip` on the TWO_CROSSING_BOOK fixture.

**Blast radius:** Correctness cron / ops-auto-fix only — no member-facing flip math changed.
