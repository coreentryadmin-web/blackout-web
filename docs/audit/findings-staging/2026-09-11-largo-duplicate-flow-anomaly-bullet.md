# Ask Largo swing brief renders the same HELIX flow anomaly bullet twice

> **kind:** FINDING

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P3 (quality/trust — no wrong numbers, but a byte-identical duplicated bullet reads as a copy-paste bug and erodes trust in the "Flow anomalies" read) |
| **Area** | Ask Largo — Swing play-brief (`src/lib/swing/play-brief-intel.ts::flowIntelSection`) |
| **Found by** | Standing Ask Largo × Night Hawk Swings ownership mandate — 2026-09-11 live coordinator cycle, auditing an as-yet-unaudited section (Flow & positioning) |

## Root cause

`flowIntelSection` renders `eco.recent_anomalies` (top 4, no dedup) straight from the
`flow_anomalies` DB query in `ecosystem-context.ts`. That query already dedups at write
time — but only "(anomaly_type, ticker) within a 15-minute window", per
`EcosystemAnomaly`'s own doc comment. The writer (`market-regime-detector` cron) runs
every **30 minutes**. So a pattern that is still active on the *next* cron cycle
(>15min after the last write, i.e. every persisting pattern under normal operation)
writes a **second row** with an identical `anomaly_type`/`detail` and only a newer
`detected_at` — the write-time dedup window is narrower than the writer's own interval,
so it structurally cannot prevent this.

Live evidence, `GET /api/market/swing/play-brief?playId=SWING:NRG&ticker=NRG&status=WATCH`
on 2026-09-11 — the rendered "Flow anomalies" section:

```
**Flow anomalies:**
• **DIRECTIONAL_FLOW_SKEW** — NRG: one-sided call flow — $0.7M calls vs no put premium (bullish)
• **DIRECTIONAL_FLOW_SKEW** — NRG: one-sided call flow — $0.7M calls vs no put premium (bullish)
```

Byte-identical, back to back, with no timestamp or count to explain why it appears
twice — reads as a rendering bug even though the two DB rows are technically distinct
writes.

## Blast radius

- `flowIntelSection` is the only consumer of `eco.recent_anomalies` in the swing brief
  (checked: no other call site renders this field), so the fix is fully scoped to this
  one function.
- Not a data-layer bug — `flow_anomalies` itself is working as designed (each cron tick
  is a legitimate observation); this is purely a rendering-layer failure to collapse
  repeat observations of the same pattern into one bullet.
- The DB-side write dedup window (15min vs a 30min writer interval) is a separate,
  smaller latent issue — logged here for visibility but NOT touched by this fix: fixing
  it would need the writer's own dedup key widened (a market-regime-detector change,
  out of scope for this brief-rendering fix, and there's a real design question of
  whether it *should* re-fire every cycle for downstream consumers other than Largo).

## Fix

`flowIntelSection` now dedups `eco.recent_anomalies` on `(anomaly_type, detail)` before
slicing to the top 4. The query is already `ORDER BY detected_at DESC`, so keeping the
first occurrence of each key naturally keeps the most recent write. Two anomalies with
different `anomaly_type` or `detail` (a genuinely different pattern) still both render —
only exact repeats collapse.

## Evidence (before/after)

- RED before fix (git-stashed the source fix, kept only the new tests):
  `npx tsx --experimental-test-module-mocks --test src/lib/swing/play-brief-intel.test.ts`
  → `flowIntelSection: a persisting anomaly re-written across two 30min cron cycles must
  render once, not twice` fails, `2 !== 1`.
- GREEN after fix: same command, 88 pass / 0 fail (full file).
- `npx tsc --noEmit`: clean.
- Companion test confirms two *genuinely different* anomalies on the same ticker still
  both render (no over-collapsing).

## Market-open validation

Logged in `docs/audit/MARKET-OPEN-VALIDATION.md` — during the next RTH session, pull
`GET /api/market/swing/play-brief` for a ticker with an active, persisting flow anomaly
(one that spans >30min) and confirm the "Flow anomalies" section shows it once, not
once per cron cycle it has persisted through.
