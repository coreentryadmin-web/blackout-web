# Data-integrity false RED: GEX cold on Polygon circuit-open blip

> **kind:** FINDING

| **Status** | FIXED |
| --- | --- |

## Symptom

RTH deep audit run **42897223779** (~3:38 PM ET) failed `data-integrity` and full-site P0 `integrity/cross-tool` with:

```text
getGexPositioning("SPX") returned no matrix while market is open
getGexPositioning("SPY") returned no matrix while market is open
```

Same run: heatmap matrix audit **passed** seconds later; logs showed `[polygon] Circuit open — rate limited`.

## Root cause

`runDataIntegrityChecks()` sampled `getGexPositioning` once in parallel. A transient Polygon circuit-open (or cold cache miss) returned `null` for both tickers while the shared matrix was still warming — the dedicated C6 freshness check fired before the retry path `fetchGexHeatmap` could serve.

## Fix

`loadGexPositioningPairForIntegrity()` — up to three reads with 2s pauses for SPX/SPY before C6 flags cold.

## Evidence

`npx tsx --test src/lib/data-integrity-gex-load.test.ts`
