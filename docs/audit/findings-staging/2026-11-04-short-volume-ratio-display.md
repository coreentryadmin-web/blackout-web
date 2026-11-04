> **kind:** FINDING

## catalystsSection short vol ratio double-scale — FIXED

| **Status** | FIXED (PR pending) |
| --- | --- |

**Symptom:** CI `verify` on `main@232c0459` — `catalystsSection: short vol ratio renders as a sane percent` failed.

**Root cause:** `play-brief-intel.ts` (and siblings) always multiplied `short_volume_ratio * 100` while upstream can already be percent-scale (~69). `normalizeShortVolumeRatio` existed at ingest but display paths skipped it.

**Fix:** `shortVolumeRatioPercentLabel()` in `ticker-fundamentals.ts`; wire into catalystsSection, play-brief evidence, verdict-core.

**Verify:** `npx tsx --test src/lib/swing/play-brief-intel.test.ts` (audit #12 case).
