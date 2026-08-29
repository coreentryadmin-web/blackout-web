## SPX Desk Feed Staleness During RTH — 2026-08-24

> **kind:** FINDING

### Summary

Desk API staleness measurement during regular trading hours shows sustained feed lag: **flow data >30s stale 70% of the time** during intraday polling. GEX data also exceeds 30s threshold in 35% of measurements. The desk exposes age metrics (`gex_age_ms`, `flow_data_age_ms`) and a `gex_stale` flag but does not expose a unified `staleness_ms` field.

### Evidence

20 consecutive polls during RTH 2026-08-24 15:43-15:58 UTC (11:43-11:58 AM ET) at 3-second intervals:

**Flow Data Age (`flow_data_age_ms`):**
- Exceeds 30s threshold: **14/20 (70.0%)**
- Range: 6.8s–87.5s
- Average: 54.5s
- Max spike: 87.5s

**GEX Age (`gex_age_ms`):**
- Exceeds 30s threshold: **7/20 (35.0%)**
- Range: 1.3s–187.0s (some cached responses)
- Average: 79.1s
- Max spike: 187.0s
- `gex_stale=true` flag: 7/20 polls

**Feed Status Flags:**
- `feed_stalled=false`: 20/20 polls (feed not halted)
- `gex_stale=true`: 7/20 polls

### Measurement Method

Authenticated RTH polling of `GET /api/market/spx/desk` extracting the `gex_age_ms`, `flow_data_age_ms`, and staleness flags. The desk does NOT expose a unified `staleness_ms` field; instrumentation is distributed across:
- `flow_data_age_ms` (UW flow data age)
- `gex_age_ms` (GEX snapshot age)
- `feed_stalled` flag (feed halted boolean)
- `gex_stale` flag (GEX exceeds threshold)

### Root Cause Investigation

**Not yet started.** Possible vectors:
- UW WebSocket subscription lag (flow feed pushes to Redis, desk polls Redis)
- GEX snapshot rebuild rate or polling interval upstream
- Redis board-snapshot TTL/refresh logic (`buildSpxDeskPulse` cache behavior)
- Polygon quote lag (price comparisons in flow scoring use quote age)

### Impact

- **Playbook Entry Timing:** Flow-driven playbook decisions (FLOW-first merge precedence, trade-governor gates) use data that is regularly >30s stale
- **GEX Regime Detection:** Gamma-flip/wall detection gated on GEX snapshot, which lags significantly
- **Label Coherence:** The 7.74pt desk/Polygon lod divergence (FINDINGS 2026-08-24-spx-lod-stale-rtd.md) may partially correlate with flow stall (desk computes high/lod from older tapes)

### Status

**OPEN** — measurement complete, root cause investigation pending.

### Next Steps

1. Trace `buildSpxDeskPulse` to identify where flow/GEX lag accumulates
2. Cross-check desk rebuild rate vs UW/Polygon subscription cadence
3. Measure intraday lag correlation with market velocity (volatile vs quiet sessions)
4. Measure lag distribution across different market phases (pre-open, RTH, post-close)
5. Establish SLO for acceptable feed age during playbook execution
