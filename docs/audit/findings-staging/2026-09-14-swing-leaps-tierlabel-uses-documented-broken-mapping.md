> **kind:** FINDING

## Every SWING/LEAPS play's displayed letter grade uses the score→letter mapping `nighthawk-tiers.ts` documents as empirically INVERTED — HELD, cross-lane (Swings), reported for that lane's attention

| | |
|---|---|
| **Status** | OPEN — reported per the standing escalation policy ("ambiguous/live-picks-logic → report, hold") and because this is explicitly a Swings-lane surface, out of the Night Hawk Legacy lane's scope ("Not yours: 0DTE or Swings — separate lanes"). No code changed. |
| **Area** | Night Hawk Swings/LEAPS — `command-deck/adapters.ts`'s `terminalPlayFromHorizon`, and the display fallbacks in `terminal-display.ts`/`play-card-display.ts` |
| **Severity** | Potentially P1 if reachable as described below — a member-facing letter grade that may be backwards for every Swing/LEAPS play |
| **Found by** | Night Hawk Legacy standing audit mandate (general sweep of shared `nighthawk/lib` files), 01:07 UTC cycle, 2026-09-14, while closing out a full review of `scorer.ts`/`conviction.ts` |

### What was found

`conviction.ts`'s `convictionFromScore(score)` maps `score >= 70 → "A+"`, `>= 55 → "A"`, `>= 40 → "B"`,
else `"C"`.

`nighthawk-tiers.ts`'s own header comment (lines 6-13) documents this EXACT function as the root
cause of an already-diagnosed, measured product defect:

```
// The root cause this fixes: convictionFromScore (scorer.ts:707-712) mapped
// ≥70 → A+, ≥55 → A, ≥40 → B, else C. The measured overnight track record
// showed a top-band INVERSION identical to the 0DTE one:
//   A+ (≥70): 0 wins / 1 loss
//   A  (55-69): avg −0.55%
//   B  (40-54): avg +2.99% — the best performer
```

i.e. the function labels the empirically WORST-performing score band as the BEST possible grade
("A+"), and the actual best-performing band as the second-worst grade ("B"). `assignNighthawkTier`
was built specifically to fix this (excludes "A+" from `NighthawkTier` entirely — see that file's
own comment, "A+ is deliberately NOT here").

**But `convictionFromScore` is still live and, for one real path, unconditional:**

- `command-deck/adapters.ts`'s `HorizonDeckSource` type (the source shape for
  `terminalPlayFromHorizon`, which serves `horizon: "SWING" | "LEAPS"`) has **no `tier`/`conviction`
  field at all** — grep confirms zero occurrences of either name anywhere in that ~100-line type
  definition (lines 646-741).
- `terminalPlayFromHorizon`'s return object sets `tierLabel: convictionFromScore(Math.round(src.score))`
  **unconditionally** (adapters.ts:1004) — there is no pinned-tier value to prefer, so this fires
  for every SWING/LEAPS play processed by this adapter (both open positions via `liveStatus`
  OPEN/HOLD/TRIM, and closed positions via `closedReason`/`exitAt`).
- The two DISPLAY-layer consumers (`terminal-display.ts:123`, `play-card-display.ts:23`) also call
  `convictionFromScore` themselves, but only as a fallback gated on `play.tierLabel` being empty —
  for a `terminalPlayFromHorizon`-sourced play, `tierLabel` is NEVER empty (see above), so those two
  call sites are effectively dead for this source, but the adapter's own unconditional call already
  delivers the same broken mapping regardless.

Contrast with the two OTHER horizon adapters in the same file, both of which correctly prefer a
real pinned tier: `terminalPlayFromZeroDte` (adapters.ts:542, `src.tier?.tier`) and
`terminalPlayFromEdition` — the Legacy adapter already reviewed this session (adapters.ts:1228,
`src.tier?.tier ?? src.conviction ?? null`). SWING/LEAPS is the one horizon whose adapter never had
a pinned-tier field wired in at all.

### Why this is reported, not fixed here

This is squarely Swings/LEAPS product surface — the Night Hawk Legacy lane's standing mandate is
explicit that 0DTE and Swings are separate lanes with their own ownership, and the Swings lane has
been actively shipping in this exact adapter file throughout this session (interleaved commits
observed all day). Fixing it myself risks exactly the cross-lane edit collision the standing
ownership discipline exists to prevent, and the correct fix likely needs a decision only that lane
can make well: is there already a real per-ticker Swing tier assignment computed server-side
(mirroring `assignNighthawkTier`'s overnight-specific bands, or the swing-specific equivalent) that
should be wired into `HorizonDeckSource` as a new `tier`/`conviction` field, the way `src.tier?.tier`
already works for 0DTE and Legacy? Or does Swing scoring not yet have an equivalent tier engine at
all (in which case the fix is a new one, not just wiring an existing field through)?

### Suggested next step for the Swings lane

1. Confirm whether Swing candidates are scored with `nighthawk-tiers.ts`'s `assignNighthawkTier`
   (or an equivalent Swing-specific tier function) anywhere upstream, and if so, thread that pinned
   value onto `HorizonDeckSource` as `tier`/`conviction` the same way the 0DTE/Legacy sources
   already carry it.
2. If no such tier engine exists yet for Swings, that's the real gap — `convictionFromScore` was
   only ever meant as a legacy/interim mapping (see `nighthawk-tiers.ts`'s framing of it as "the
   root cause this fixes"), not a permanent Swing-tier source.
3. Either way, `terminalPlayFromHorizon`'s unconditional `convictionFromScore` call should be
   replaced with "prefer pinned tier, fall back honestly (null, not a fabricated letter) when
   absent" — matching the Largo product-contract's own absence principle already applied
   consistently elsewhere in this codebase.

### Evidence

- `nighthawk-tiers.ts:6-13`'s own comment, quoted above verbatim, naming `convictionFromScore` as
  the root cause of a measured A+/A/B inversion.
- Grep confirms `HorizonDeckSource` (adapters.ts:646-741) has no `tier` or `conviction` field.
- Grep confirms `convictionFromScore`'s only three call sites repo-wide are: `adapters.ts:1004`
  (unconditional, `terminalPlayFromHorizon`), `terminal-display.ts:124` (fallback-only, SWING/LEAPS
  gated), `play-card-display.ts:28` (fallback-only, SWING/LEAPS gated) — all three are SWING/LEAPS
  scoped; 0DTE and Legacy each correctly source `tierLabel` from a pinned tier instead.
