> **kind:** FINDING

## Meridian earnings `expected_move_band` ignored the Thermal spot fallback every sibling field already uses — FIXED

| **Status** | Fixed |
|---|---|

**Found by:** full read of `src/lib/meridian/meridian-earnings-intel.ts` (Meridian catalyst-desk
earnings-intel loader, DISCOVERY-lane audit sweep, round 290 — primary targets for the round
(`market-context-verifier.ts`/`desk-verifier.ts`) came back clean; this was found on the
secondary-target sweep of untested Meridian lib files).

**Root cause:** `loadMeridianEarningsIntel` resolves one spot value for the whole earnings card —

```ts
const spot = input.pack.positioning.spot ?? thermal?.spot ?? null;
```

— explicitly because `input.pack.positioning.spot` (from `getGexPositioning`, called inside
`preEarningsPackForLargo`) and `thermal.spot` (from `gexHeatmapForLargo` / `fetchGexHeatmap`,
called directly inside this loader) are two **independent** upstream fetches that can fail on
their own. Every other field this loader builds from spot — the GEX walls (`coerceMeridianWallLevels`),
`play_read`, the earnings `report`, and the Vector desk shaping (`shapeMeridianVectorDeskRead`) —
already consumes this resolved `spot`. The `expected_move_band` object was the one exception,
built straight off the raw, unresolved field with no fallback at all (pre-fix):

```ts
expected_move_band:
  expected_move_pct != null && input.pack.positioning.spot != null
    ? {
        spot: input.pack.positioning.spot,
        up: Number((input.pack.positioning.spot * (1 + expected_move_pct / 100)).toFixed(2)),
        down: Number((input.pack.positioning.spot * (1 - expected_move_pct / 100)).toFixed(2)),
      }
    : null,
```

So on a `getGexPositioning` outage (or any other case where the pack's own positioning spot is
null) next to a **healthy** Thermal fetch, with a perfectly good `expected_move_pct` already
resolved, `expected_move_band` still comes back `null` — even though the exact same response's
`thermal.spot`, `play_read`, `report` and `vector` fields all rendered correctly off the fallback
spot moments earlier in the same function.

**Blast radius — four consumers read `intel.expected_move_band` directly, all silently losing the
price range in this one case:**
- `src/features/meridian/components/MeridianEarningsIntelPanel.tsx` — renders the
  `down – up (source)` range line, or nothing.
- `src/features/meridian/components/MeridianEarningsReportPanel.tsx` — passes `band={intel.expected_move_band}`.
- `src/features/meridian/components/MeridianEarningsPositioningPanel.tsx` — passes `band={intel.expected_move_band}`.
- `src/features/meridian/components/MeridianEarningsSummaryPanel.tsx` — reads both `band` and
  `band.spot` (itself one of the fallbacks in `intel?.thermal?.spot ?? intel?.expected_move_band?.spot ?? pack?.positioning?.spot`),
  so this panel's own spot resolution was *also* one layer weaker than it needed to be whenever it
  fell through to `expected_move_band?.spot`.

No other call site builds this band independently — `grep -rn expected_move_band src/` shows
exactly these four readers plus the one producer this fix touches.

**Fix rationale:** extracted the band computation into a new pure helper,
`buildExpectedMoveBand({ spot, expectedMovePct })`, in `meridian-earnings-intel-core.ts` (the
existing, non-`server-only`, unit-tested sibling module this file already uses for
`resolveIntelExpectedMove`/`resolveVectorDeskMove` — same pattern, kept consistent rather than
inlining a second ad-hoc fix). The call site in `meridian-earnings-intel.ts` now passes the
already-resolved `spot` local (the same one every sibling field uses) instead of reaching back
into `input.pack.positioning.spot`. Deliberately left unchanged: the upstream fallback chain
itself (`pack.positioning.spot ?? thermal?.spot ?? null`), `expected_move_pct`'s own resolution
(`resolveIntelExpectedMove`, unrelated and already correct), and the `MeridianEarningsSummaryPanel`
fallback chain (its own `band?.spot` now simply resolves more often, which is the intended effect,
not a separate change).

**Regression test:** `src/lib/meridian/meridian-earnings-intel-core.test.ts` — added
`buildExpectedMoveBand uses a Thermal-fallback spot, not just the pack's own GEX-positioning spot`
plus three edge-case tests (null spot, null expected-move, non-finite spot). RED→GREEN verified by
`git stash` on the two production files (core.ts + intel.ts) with the test kept: 4 failures
(`buildExpectedMoveBand is not a function`); `git stash pop` restores all 31/31 passing. Full file
run: `npx tsx --experimental-test-module-mocks --test src/lib/meridian/meridian-earnings-intel-core.test.ts`
→ 31 pass / 0 fail. `tsc --noEmit` clean.
