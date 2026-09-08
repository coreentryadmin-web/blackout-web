> **kind:** FINDING

## Largo swing brief — magnet coaching claims "long-gamma regime" regardless of measured posture — FIXED

**Status:** FIXED (this PR)

### Root cause

`magnetCoaching()` in `src/lib/swing/play-brief-narrative-coaching.ts` narrated a far-from-spot
gamma magnet with a HARDCODED claim, independent of any measured dealer posture:

```ts
const pin =
  near
    ? "You're sitting on the magnet — expect chop; trim into extensions, don't chase breakouts."
    : "Dealer hedging center of mass — price gravitates here in long-gamma regimes.";
```

The "not near" branch always said "long-gamma regimes" — even when the SAME brief's dealer
posture line, moments earlier in the same "Trade manager read" section, reported the opposite.

### Evidence (live production repro, 2026-09-06)

Pulled `GET /api/market/swing/play-brief?playId=SWING:NRG` for the real, currently-committed
`SWING:NRG` position (a genuine live audit against production, per the standing Ask Largo
mandate). The composed "Trade manager read" section read, in order:

```
• Gamma magnet 134.37 (+13.0% from spot) — pull up toward this node. Dealer hedging center of
  mass — price gravitates here in long-gamma regimes.
...
• Right now — spot 118.95 · dealers short gamma — moves can accelerate through walls · γ-flip 129.84
```

The SAME brief simultaneously told the reader dealers are "short gamma" and that price
"gravitates here in long-gamma regimes" — an internally inconsistent, factually wrong claim, not
a staleness issue (both reads were fresh). This is distinct from the stale-GEX-fallback class
fixed in #4360/#4364/#4367/#4372/#4375 — here the bug is a hardcoded string that never consulted
posture at all, live or stale.

New regression test `"magnetCoaching (via tradeManagerNarrativeSection): must not claim
long-gamma regime when posture is short (live NRG repro 2026-09-06)"` reproduces this exact case
— RED pre-fix (`git stash` on the three touched source files), GREEN post-fix. A companion test
confirms the long-gamma text still fires when posture is genuinely measured "long".

### Fix

`magnetCoaching()` now takes `ctx` and resolves posture via the shared `resolveGammaPosture(ctx,
vec)` helper (extracted from #4375, moved to `play-brief-absence.ts` to avoid a circular import
between `play-brief-narrative.ts` and `play-brief-narrative-coaching.ts`) — live Vector regime
wins, GEX-only fallback suppressed when stale. When posture is not measured "long", the magnet
line now says "Pivot node — acceleration risk if the magnet fails to hold." instead of asserting
a long-gamma regime that isn't there.

### Blast radius

`magnetCoaching()` and its one call site in `collectCoachingBullets()`
(`play-brief-narrative-coaching.ts`). `resolveGammaPosture` relocated from `play-brief-narrative.ts`
to `play-brief-absence.ts` (re-exported, same signature) so both `narrateKing`/`narrateMagnet`
(play-brief-narrative.ts) and `magnetCoaching` (play-brief-narrative-coaching.ts) share one
implementation instead of two independently-maintained copies.

### Market-open validation

See `docs/audit/MARKET-OPEN-VALIDATION.md` — next RTH session, pull the swing play-brief for any
open position with a far gamma magnet (`distancePct` beyond ±1.2%) while the desk's own dealer
posture reads "short gamma" or unresolved, and confirm the magnet line says "Pivot node —
acceleration risk" rather than "long-gamma regimes".
