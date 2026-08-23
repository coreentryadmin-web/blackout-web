## 2026-08-23 — [FINDING, P3 Largo] `get_group_greek_flow` payload exceeds 16k cap, agent loses greek exposure aggregation for groups beyond top ~20 — ANALYZING

> **kind:** `FINDING`

The Largo agent's greek flow aggregation tool truncates when called without arguments (market-wide query). The model receives greek exposure (gamma/vega/theta) for only the first ~20 industry groups or sector groups; exposure for groups 21+ is silently omitted.

### Problem Statement

The `get_group_greek_flow` tool aggregates greek exposure by sector/industry group and returns net gamma, vega, and theta per group along with flow anomaly flags. Market-wide queries (no group filter) return 20–30+ groups; the JSON exceeds 16k bytes.

| **Symptom** | Batch 6 truncation probe (2026-08-23 18:11 UTC) returned TRUNCATED for `get_group_greek_flow --control=get_zerodte_rejections` with default (empty) arguments. Control proven TRUNCATED (expected). |
|---|---|
| **Tool behavior** | Returns an array of { group_name, sector, gamma_exposure, vega_exposure, theta_exposure, flow_anomaly_flag, group_size }. Market-wide query returns 20–30 groups. ~400 bytes per group × 25 groups = 10KB base, but with flow anomaly details and cross-group comparisons, reaches 16–20KB. |
| **Silent failure mode** | Model sees first 20 groups (e.g., Tech, Finance, Healthcare, etc.), then truncation cuts the rest. Model can still answer "where's gamma exposure?" (if the exposure is in the first 20 groups), but cannot see exposure in smaller or more specialized groups that fall outside the cutoff. |
| **Measured** | Batch 6 probe: control proven, `get_group_greek_flow` returned TRUNCATED. Exact group count at truncation not yet measured. |

### Blast Radius

Greek exposure by group is a portfolio-wide risk aggregation signal. Truncation means:

1. **Incomplete risk view.** Trader asks "where's our collective gamma exposure?" Largo lists only the top 20 groups and misses smaller-group concentration in groups 21+.
2. **Blind spots.** A small but high-risk group (e.g., a concentrated biotech or finance sub-sector) falls outside the first 20 and is invisible.
3. **Flow anomaly detection.** Flow anomalies are raised per group; truncation means anomalies in groups 21+ are not reported.

### Root Cause Analysis

1. **Group count.** US sectors + sub-sectors = 20–30+ groups (depending on classification). A full accounting naturally produces a large payload.
2. **Field inclusion.** Do all groups need flow anomaly details, or just the top 10 by exposure?
3. **Pagination or limits.** Should the tool default to top-N groups by exposure (most relevant for traders) instead of all groups?

### Action Required

**Measure:**
- Re-run probe with `get_group_greek_flow` to capture exact group count at truncation.
- Determine whether groups are sorted by gamma exposure, sector name, or group size, and whether truncation creates a bias.

**Decide:**
- **Option A**: Limit tool to top-N groups by greek exposure (e.g., top 20).
- **Option B**: Return groups in two payloads (major sectors + minor sectors on demand).
- **Option C**: Strip flow anomaly details for smaller groups.

### Status

ANALYZING — awaiting group count measurement to determine whether a limit or pagination is needed.
