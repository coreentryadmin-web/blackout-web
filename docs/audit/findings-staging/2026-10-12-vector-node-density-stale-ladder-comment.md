## 2026-10-12 — [Vector] Stale "6 → 20" auto-ladder comment, contradicted by the real values — FIXED
> **kind:** `FINDING`

| **Area** | **Severity** | **Status** |
|---|---|---|
| Vector / dev docs | P3 — comment-only, no behavior affected | FIXED |

**What's wrong.** `src/features/vector/lib/vector-node-density.ts`'s header comment claimed:
```
The chart's automatic count (`wallCountForTimeframe`) already walks 6 → 20 with the timeframe
```
and
```
AUTO (default) follows the timeframe walk (6 → 20) on dense ladders like SPX.
```
`wallCountForTimeframe` (`vector-bar-timeframes.ts:51-78`) never returns `6` — its actual ladder
is `8/11/13/16/20`. A sibling comment in the same subsystem already states this correctly:
`vector-ticker.ts:68` — "the timeframe-driven AUTO ladder (`wallCountForTimeframe`, 8/11/13/16)".
The claim that the manual `VECTOR_NODE_DENSITY_OPTIONS` ladder (`6/8/12/16/20`) is "a subset of
that same walk" is also false independent of the 6-vs-8 slip: `12` isn't in the auto walk's
values either (which has `11`/`13` instead) — the two ladders overlap only at `8`, `16`, `20`.
Likely stale from an earlier revision of the auto walk before it was tuned to its current
values (the file's sibling, `vector-bar-timeframes.ts`, documents several such tunings with git
references).

**Fix.** Corrected both "6 → 20" references to "8 → 20" and rewrote the subset claim to
accurately describe the manual ladder as a separate, member-facing set of round numbers rather
than a subset of the auto walk's own values — `nodeDensityLabel`'s "AUTO <n>" display is what
actually keeps the two legible against each other, not a shared value set.

**Verification.** `vector-node-density.test.ts` → 7/7 pass (unchanged — comment-only edit).
`tsc --noEmit` clean.

**Blast radius.** This file's header comment only. No behavior change.

Found via a background Explore-agent sweep of the Vector/Thermal desk UI, independently
re-verified (`wallCountForTimeframe`'s actual branches, the sibling correct comment in
`vector-ticker.ts`, and that the manual/auto ladders only partially overlap) before fixing.
