> **kind:** FINDING

## RTH deep audit false P0 (GEX cold) + swing-discovery handshake during POWER_HOUR — FIXED

| **Status** | Fixed in PR |
| --- | --- |

**Symptom:** RTH deep audit `42897223779` Tue 15:38 ET: P0 `getGexPositioning` cold SPX/SPY; P1 `swing-discovery` stale; transient `/api/market/indices` 502.

**Root cause:** (1) `data-integrity` read GEX once while Polygon circuit-open paused rebuilds; audit ran integrity before heatmap prefetch. (2) Phase-anchored `swing-discovery` handshake stale mid-POWER_HOUR while serving snapshot still intraday-fresh — suppress logic only covered post-POST_CLOSE gaps.

**Fix:** GEX retry + audit SPX/SPY warmup; indices 502 retry; intraday suppress when serving probe fresh + active phase pending.
