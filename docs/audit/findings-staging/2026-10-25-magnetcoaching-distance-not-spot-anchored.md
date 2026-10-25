## 2026-10-25 — [FINDING, P3 Night Hawk Swings / Ask Largo] `magnetCoaching`'s gamma-magnet distance trusts the upstream Vector snapshot verbatim instead of recomputing from the brief's own canonical spot, so it can disagree with every other level in the same brief — FIXED

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **Area** | Swing play-brief "Trade manager read" section — `src/lib/swing/play-brief-narrative-coaching.ts`'s `magnetCoaching()` |
| **Found by** | Ask Largo × Night Hawk Swings standing ownership mandate — fresh envelope-completeness dig against a live WATCH-bucket brief, 2026-10-25 |

### Symptom

Live repro: `GET /api/market/swing/play-brief?playId=SWING:MSTR&ticker=MSTR&status=WATCH` on
2026-10-25 (spot **146.54**, gamma magnet strike **161.56**). The "Trade manager read" section's
magnet bullet read:

```
Gamma magnet 161.56 (+10.3% from spot) — pull up toward this node.
```

but the SAME brief's `structureLadder.rungs` (feeding the member-facing ladder widget) reported the
identical magnet level at:

```
"kind": "magnet", "price": 161.56, "distancePct": 10.2
```

`(161.56 - 146.54) / 146.54 * 100 = 10.2498...%`, which rounds to **10.2%** — the ladder's number is
correct; the prose bullet's 10.3% is not. Two sections of the same envelope, reading the same spot
and the same magnet level, disagreed on a number that should be identical by construction.

### Root cause

`collectFocalLevels` (`play-brief-narrative.ts:173-181`) recomputes the magnet's distance fresh via
its own `distPct(spot, magnet)` helper — the SAME canonical `spot` the rest of the brief uses — and
that recomputed value is what feeds both the "Why this setup"-style focal-level narration and
`play-brief-ladder.ts`'s `structureLadder` widget. That file's own header comment states the
intended invariant directly: the ladder widget "can never disagree with 'Trade manager read' about
where a wall or the gamma flip sits" (lines 10-13).

`magnetCoaching` (`play-brief-narrative-coaching.ts:330-361`) — the function that actually produces
the "Trade manager read" bullet quoted above — is a separate, duplicate implementation (already
flagged as such in a 2026-09-21-dated comment at `play-brief-narrative.ts:498-504`, which notes the
two are "kept in sync" on their existence/staleness gating). That dedup logic was kept in sync; the
*number* was not. `magnetCoaching` accepted a `spot` parameter but never referenced it — it read
`m.distancePct` straight off the raw Vector snapshot (`vec.magnet.distancePct`), which is computed
**upstream, by Vector's own engine, against Vector's own spot snapshot at write time**. That snapshot
spot can differ fractionally from this brief's own resolved `spot` (146.54 here), so the two
distance computations — one spot-anchored, one not — can and did diverge after rounding.

### Fix

`magnetCoaching` now computes `distancePct = ((m.strike - spot) / spot) * 100` from the function's
own `spot` parameter — the same formula `collectFocalLevels` already uses — and uses that recomputed
value both for the displayed `fmtPct(...)` text and for the `near` (<1.2%, "sitting on the magnet")
threshold check. `m.distancePct` itself is no longer read for either purpose; only `m.strike`,
`m.pull`, and `m.callout` are still taken from the upstream snapshot.

### Blast radius

One call site (`tradeManagerNarrativeSection`'s coaching-bullet collection, via
`collectCoachingBullets`) — the only place `magnetCoaching` is wired in. The `near` threshold is also
corrected by the same fix: a stale upstream `distancePct` that read "far" while the real spot/strike
distance is inside the near band (or vice versa) previously could pick the wrong pin-gravity framing
entirely (generic "pivot node" text vs. "you're sitting on the magnet" chop warning) — not just a
cosmetic percentage mismatch.

### Tests

Added two regression tests to `play-brief-narrative-coaching.test.ts`:
- Live-repro shape: `strike=161.56, spot=146.54`, upstream `vec.magnet.distancePct` deliberately set
  to a wrong value (10.8) — asserts the bullet shows the spot/strike-derived `+10.2%`, not the
  upstream snapshot's own 10.8%.
- Threshold-direction repro: upstream says "5% away" (would skip the near-magnet framing) while the
  real `strike=101`/`spot=100` distance is 1% (inside the <1.2% near band) — asserts the bullet still
  picks "You're sitting on the magnet", proving the `near` check also uses the recomputed value.

Updated one pre-existing test (`"uses ctx.readMs..."`) whose fixture had `strike=100=spot` while
claiming `distancePct: 3` — an artifact of the old implementation never cross-checking strike against
spot; changed to `strike=103` so the fixture is self-consistent under the new spot-anchored
computation, preserving the test's original (unrelated) staleness-anchor intent.

RED→GREEN reasoning (not a literal revert, to avoid mutating the shared working tree mid-fix): without
the fix, the first new test's bullet would read `+10.8%` (from the trusted-verbatim upstream value),
failing the `+10.2%` assertion; the second new test's `near` check would evaluate
`Math.abs(5) < 1.2 === false`, routing to the long-posture "Dealer hedging center of mass" framing
instead of the expected near-magnet text, failing that assertion too.

Full suite after the fix: `play-brief-narrative-coaching.test.ts` 191/191 pass (1 pre-existing test
fixture updated as above); all `src/lib/swing/play-brief*.test.ts` together 1167/1167 pass;
`npx tsc --noEmit` clean; full repo suite (Node 20) 16870/16870 pass, 3 skipped, 0 fail.
