> **kind:** `FINDING`

## Vector play engine: dataAgeMs staleness never produced nor consumed — FIXED

| **Status** | FIXED |
|---|---|

**Root cause.** `VectorSnapshot.dataAgeMs` was documented ("Age of the underlying stream data in
ms... for the terminal to show staleness") but three things were all simultaneously true: (1)
`computeConviction` never read `input.dataAgeMs` — a play built from data frozen for 20 minutes
scored identically to one built this instant; (2) the sole production caller, `VectorChart.tsx`'s
`emitPlay`, never set `dataAgeMs` on the snapshot it built; (3) no UI component ever read
`play.dataAge` to show staleness as the doc comment promised. The field was simultaneously never
produced and never consumed.

**Fix — three parts:**

1. **Producer:** `VectorChart.tsx` now tracks `dataReceivedAtMsRef`, stamped to `Date.now()` every
   time a live spot/wall tick actually lands (the same handler that updates `spotRef.current`).
   `emitPlay` passes `dataAgeMs: Date.now() - dataReceivedAtMsRef.current` into `buildVectorPlay`.
2. **Consumer:** `computeConviction` now applies a graduated discount via a new exported pure
   function, `stalenessConvictionDiscount(dataAgeMs)`: 0 under 30s (normal SSE cadence, ~1 tick/sec —
   this is not a staleness signal), −5 at 30s–2min, −15 at 2–10min, −30 beyond 10min (feed reads as
   effectively disconnected). Graduated, not a cliff: a member losing their feed for a few minutes
   still gets a play, just a visibly less confident one.
3. **UI:** `VectorPlayCard` now shows a small "STALE" badge once `play.dataAge` crosses the same
   `STALE_MILD_MS` boundary the discount uses (exported from the engine so the UI can't drift out of
   sync with the scoring threshold) — the actual "terminal shows staleness" surface the original doc
   comment promised but nothing ever built.

**Blast radius.** `vector-play-engine.ts` (new discount + export), `VectorChart.tsx` (new ref +
one field on the `buildVectorPlay` call), `VectorPlayCard.tsx` (one badge). No other `VectorSnapshot`
consumer reads `dataAgeMs`, and no other caller of `computeConviction`/`buildVectorPlay` exists.

**What was deliberately left unchanged.** The specific threshold values (30s/2min/10min) and discount
magnitudes (−5/−15/−30) are a reasonable first calibration matched to the ~1s SSE tick cadence
documented elsewhere in this file, not a measured/backtested calibration — there is no existing A/B
harness for Vector play conviction the way `docs/audit/INTENTIONAL-DESIGN.md`'s 0DTE harnesses exist.
Flagged here rather than silently treated as final; a future pass could measure real disconnect
durations and calibrate against them if this proves too aggressive or too lax in practice.

**Verification:** new unit tests for `stalenessConvictionDiscount` (every threshold boundary), an
integration test (`buildVectorPlay` with fresh vs. stale `dataAgeMs`), and wiring tests confirming
`VectorChart.tsx` captures/passes the real value and `VectorPlayCard` reads it. `tsc --noEmit` clean,
full suite clean (11008 pass / 0 fail / 2 pre-existing skips), `npm run build` clean.
