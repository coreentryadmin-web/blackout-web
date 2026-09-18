> **kind:** `FINDING`

## Ask Largo swing brief rounded real, nonzero small-cap values to a false "0.0" — FIXED

| Field | Value |
|---|---|
| **Status** | FIXED |
| **Area** | Night Hawk Swings / Ask Largo play-brief (`src/lib/swing/play-brief.ts`, `src/lib/swing/play-brief-narrative-coaching.ts`) — found via the Ask Largo standing mandate's 5-engine health-check deep-dive |
| **Severity** | P2 (a real, meaningful signed value presented as an honest absence — worse than an unrounded float, this is a false negative) |
| **PR** | fix/swing-false-zero-precision |

### Root cause

Two independent call sites used a plain `.toFixed(1)` on a value that can be genuinely nonzero but
smaller than the rounding threshold, both surfacing on lower-priced/small-cap tickers:

- `play-brief.ts`'s dealer-posture evidence line: `net_gex / 1e6` (net GEX in millions)
  `.toFixed(1)` — any net GEX under ~$50k rounds to `"0.0M"`.
- `play-brief-narrative-coaching.ts`'s `expectedMoveCoaching`: `b1.movePts.toFixed(1)` (the 1σ
  expected-move half-width in points) — a real sub-0.05pt half-width, common when the underlying
  price itself is low, rounds to `"±0.0 pts"`.

Both values are signed/meaningful even when small — net GEX's sign drives the dealer-posture read,
and a real expected-move band still constrains price action even when narrow in dollar terms.
Rounding them to `"0.0"` doesn't just lose precision, it reads as "no exposure" / "no expected
move" — a fabricated absence for a real, present value, which is a stronger violation than the
"systemic unrounded float" pattern this repo already tracks elsewhere (that pattern is *too much*
precision leaking through; this is *too little*, producing a false negative).

Live repro (real production data, authenticated Clerk session): ABTC (spot $10.15) rendered "net
GEX +0.0M" and "Expected move 1σ 10.11–10.19 (±0.0 pts)" in the same brief — both real, nonzero
values presented as if there were none.

### Evidence

- Live ABTC repro as described above.
- `play-brief.ts`'s net-GEX line and `play-brief-narrative-coaching.ts`'s `expectedMoveCoaching`
  confirmed to use plain `toFixed(1)` with no false-zero guard, grep-verified pre-fix.
- RED→GREEN independently reproduced via `git stash` (fix isolated to `play-brief.ts`; the new
  `format-nonzero.ts` helper was untracked so only the consuming file's diff needed stashing):
  83/84 fail pre-fix (the new small-cap net-GEX test), 84/84 pass post-fix.
- New pure-helper test suite (`format-nonzero.test.ts`): 5/5 pass, covering pass-through behavior,
  exact-zero staying `"0.0"`, false-zero widening, and the widening cap's bounded fallback.
- `src/lib/swing/*.test.ts` full sweep: 1345/1345 pass.
- `npx tsc --noEmit -p .` on Node 20: clean.

### Blast radius

Two call sites, both presentation-only (`play-brief.ts`'s dealer-posture evidence line,
`play-brief-narrative-coaching.ts`'s expected-move coaching line). The underlying GEX/expected-move
data and every downstream calculation that reads the *unrounded* values are untouched — this only
changes how these two specific display strings render a real, small, nonzero number.

### Fix rationale

Added a small shared helper (`src/lib/swing/format-nonzero.ts`, `formatFixedNonZero`) that behaves
identically to `toFixed(n)` except when the fixed-decimal rounding would collapse a real nonzero
value to zero — in that case it widens precision (capped at `decimals + 4` extra places, so a
pathologically tiny value still falls back to the original fixed string rather than growing
unboundedly) until the value renders as something other than a false zero. Chose a shared display
helper over changing each call site's own rounding logic ad hoc, since this exact false-zero shape
is generic and likely to recur at other small-cap-sensitive display points in this file family.

### Verification

Independently re-verified from scratch on a fresh branch off actual latest `origin/main` — RED/GREEN
independently reproduced via `git stash`; new helper's own unit tests, the swing suite, and
`tsc --noEmit` all clean.
