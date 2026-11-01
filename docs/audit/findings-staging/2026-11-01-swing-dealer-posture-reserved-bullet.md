> **kind:** FINDING

## Swing `tradeManagerNarrativeSection`: unresolved dealer-posture disclosure silently starved by MAX_BULLETS — FIXED

| **Status** | Fixed |
|---|---|

**Found by:** five-engine-largo-cycle-60 live Ask Largo audit (2026-11-01, ticker TPR), per the
standing Ask Largo × Night Hawk Swings ownership mandate (CLAUDE.md).

**Live repro:** `GET /api/market/swing/play-brief?playId=SWING:TPR&ticker=TPR&positionId=2287&status=COMMIT&expandIntel=1`.
TPR's gamma posture is genuinely unresolved (`resolveGammaPosture` returns `null`), and
`envelope.unavailableSources` correctly lists "GEX gamma flip" with a real reason — but the
"Trade manager read" bullet list contains **no bullet saying so**, a cross-section contradiction
that Largo contract point C3 ("absence must be disclosed, never silent") exists to prevent.

**Root cause:** `tradeManagerNarrativeSection` (`src/lib/swing/play-brief-narrative.ts`) builds its
bullet list through an `add(line, { reserved? })` helper gated by `MAX_BULLETS = 14`
(`!opts?.reserved && bullets.length >= MAX_BULLETS` drops the bullet). Two other always-shown,
safety-critical bullets in the same function — "Break watch" and "Counter-thesis" — are already
marked `{ reserved: true }` specifically so they can never starve behind the cap (the existing code
comment: "safety-critical coaching must not starve"). The call that renders
`dealerPostureLine`'s bullet (originally around line 1776-1778) was **never** marked `reserved`:

```ts
if (spot != null) {
  const posture = dealerPostureLine(ctx, spot, bucket);
  if (posture) add(posture);          // <-- not reserved
} else { ... }
```

`dealerPostureLine` runs right after `collectCoachingBullets(ctx, bucket, spot)` — a large batch of
~13-20 candidate coaching bullets (thesis-break, manage-plan, catalyst, cross-desk, exec-slippage,
short-interest, VEX lens, magnet, confluence, expected-move, wall-integrity, wall-dynamics,
technicals, vector-play, data-honesty, etc.), each itself routed through the same capped `add()`.
On a ticker with enough of those firing, `bullets.length` hits 14 **before** `dealerPostureLine`'s
own `add()` call ever runs, so its candidate bullet becomes #15 and is dropped — with no warning,
no log, nothing in the response that hints a bullet was ever computed.

**Live TPR arithmetic (five-engine-largo-cycle-60, 2026-11-01):** TPR's non-reserved bullet
sequence hit exactly 14 before `dealerPostureLine` ran — action + Manage plan + Earnings in 4d +
Cross-desk friction + Executable P&L + Short interest + VEX lens + Gamma magnet + Confluence +
Expected move + put wall firm + Chart read + Vector desk starred level + Data caveat = 14 =
`MAX_BULLETS`. Three other tickers checked the same cycle (VFC, F, TXRH) have the identical
unresolved-posture condition but fewer non-reserved bullets firing (12-13), leaving room under the
cap — so their dealer-posture bullet correctly rendered. This confirms an **unlucky-insertion-order
bug**, not a priority scheme: a position with *more* going on (earnings imminent, cross-desk
conflict, elevated short interest) is paradoxically the one more likely to lose this
independently-important disclosure bullet.

**This is the 4th live instance of this exact MAX_BULLETS-starvation defect class** in this
file/sibling file, each previously fixed for a *different* bullet:
1. **Break watch** — already `{ reserved: true }` (the call site this fix is modeled on).
2. **Counter-thesis** — already `{ reserved: true }` (same precedent).
3. **`meridianPeerEarningsCoaching`'s peer-earnings bullet** — fixed by moving it into its own
   *uncapped* section (`meridianPeerSection`, `play-brief-intel.ts`) rather than leaving it in the
   capped coaching list (see `FINDINGS.md`'s write-up on that fix).
`dealerPostureLine`'s call site was never covered by any of those three prior fixes — this is a
genuinely new instance of the class, not a regression of a prior one.

**Fix:** marked the `add(posture)` call `{ reserved: true }`, matching the Break-watch/
Counter-thesis precedent directly adjacent to it:

```ts
if (spot != null) {
  const posture = dealerPostureLine(ctx, spot, bucket);
  if (posture) add(posture, { reserved: true });
} else { ... }
```

**Fix rationale — option (a) over option (b):** the task considered two shapes: (a) mark this call
`reserved: true` like Break watch/Counter-thesis, or (b) move it into its own small uncapped
section near "GEX posture"/"Data freshness" (the `meridianPeerSection` precedent). Chose (a):
`dealerPostureLine` renders exactly ONE short bullet, the same shape as Break watch/Counter-thesis
(a single always-shown disclosure/coaching line), not a variable-length list like
`meridianPeerEarningsCoaching`'s peer set — the `meridianPeerSection` extraction was motivated by
that bullet's unbounded size risking inflating the response once uncapped, which doesn't apply
here. `reserved: true` is also the minimal, most consistent change: it reuses the exact mechanism
already proven correct for the two sibling always-shown bullets in the same function, with no new
section, no new render path, and no change to where in the bullet order this line appears.

**Blast radius:** single call site — `dealerPostureLine` is only invoked from this one `add()` call
in `tradeManagerNarrativeSection`. No other function renders this bullet. The fix affects both the
"posture resolved" (dealer long/short/at-flip) and "posture unresolved" render branches of
`dealerPostureLine` identically — both are now guaranteed to survive the cap, which is correct:
a resolved dealer-posture read is also useful, always-shown coaching, not disposable filler either.

**Evidence (RED → GREEN):**
- Added two regression tests to `src/lib/swing/play-brief-narrative.test.ts`:
  1. `"tradeManagerNarrativeSection: unresolved dealer-posture disclosure survives MAX_BULLETS when
     14+ other coaching bullets already fired (2026-11-01, live TPR shape)"` — a fixture matching
     TPR's real bullet set (earnings-in-4d via `meridian.items`, cross-desk friction via opposed
     `nighthawk_recent`/HELIX flow, executable P&L slippage, short interest, IV rank, volatility
     note, ticker history, macro tape, VEX lens, gamma magnet, confluence, put-wall-firm, plus the
     leading action/manage-plan bullets) with gamma posture genuinely unresolved (no `vector.regime`,
     `gex_positioning.gamma_posture: null`). Asserts the dealer-posture bullet's index in the
     rendered list is `>= 14` (proving the cap was genuinely full before it was reached) **and**
     that `"dealer gamma posture not resolved on this read"` is present in the body.
  2. `"tradeManagerNarrativeSection: unresolved dealer-posture disclosure still renders normally
     when well under MAX_BULLETS (no regression)"` — the VFC/F/TXRH shape: far fewer bullets fire
     (`< 14`), confirming the fix changes nothing for the common case.
- **RED** (fix temporarily reverted — `add(posture)` without `{ reserved: true }`): ran
  `npx tsx --experimental-test-module-mocks --test src/lib/swing/play-brief-narrative.test.ts` →
  **170 pass / 1 fail** — test 1 failed with `expected index >= 14, got -1` (bullet entirely
  absent from the rendered body); test 2 passed (confirming it alone doesn't catch this class of
  bug, which is why test 1 was necessary).
- **GREEN** (fix restored): same command → **171/171 pass**.
- Full file suite: `npx tsx --experimental-test-module-mocks --test
  src/lib/swing/play-brief-narrative.test.ts src/lib/swing/play-brief-narrative-coaching.test.ts`
  → **369/369 pass**.
- `npx tsc --noEmit`: clean.
