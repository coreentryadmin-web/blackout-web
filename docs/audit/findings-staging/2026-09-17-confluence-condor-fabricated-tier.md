> **kind:** FINDING

## computeConfluence scored a committed condor's nominal fade side, fabricating a live confluence tier — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **Lane** | 0DTE deep-dive (architecture trace of every directional-vote aggregation in the engine) |
| **Severity** | P1 (member-facing on the LIVE production command-deck — `ZeroDteCommandPanel.tsx`'s `confluence N/2` line renders this value directly for an open condor position, and it also feeds `computeThesisHealth`'s confluence pillar) |
| **Files** | `src/lib/zerodte/confluence.ts` (`computeConfluence`) |
| **Found by** | Continuing the same trace that found the `computeThesisHealth` condor gap (this session) — `computeThesisHealth`'s own confluence pillar reads `computeConfluence(setup, ...)` live, so the same nominal-direction defect was one layer upstream of the fix already shipped there |

### Root cause

`computeConfluence` (`src/lib/zerodte/confluence.ts`) scores `vwap_ok` (price vs VWAP on the
setup's side) and folds it with `market_ok` into a `triple`/`double`/`weak` tier — all keyed off
`setup.direction`. For a real directional play that IS the play's actual stance. For a committed
0DTE iron condor, `direction` is only the pin's nominal fade side (`condor.ts`'s
`buildCondorSetup`: *"UNUSED by the neutral structure's gates/grader"*) — the same fact fixed
twice already this session in `product-adapters.ts`/`consensus-read-extract.ts` (#5106),
`governor.ts` (#5107), and `computeThesisHealth` itself. `attachConfluence` runs unconditionally
on every setup (condor included), so a condor's nominal side got scored as if it were a real
directional stance, producing a fabricated `"triple-confirmed"`/`"VWAP+market confirmed"` label.

This reaches TWO live surfaces: `ZeroDteCommandPanel.tsx` renders `play.confluence != null ? \`
· confluence ${play.confluence}/2\` : ""` directly for the member (a delta-neutral condor showing
"confluence 2/2" implies a directional agreement that doesn't exist), and `computeThesisHealth`'s
own confluence pillar reads the SAME live confluence off the setup — though that pillar is now
moot for condors after this session's `computeThesisHealth` fix (which returns `null` outright for
a condor row), this field can still be read directly by any other consumer of `setup.confluence`,
so fixing it at the source (rather than only downstream) closes the gap for good.

### Evidence

RED before the fix (`git stash` proof, Node 20, `--experimental-test-module-mocks`,
`confluence.test.ts`): 2 failures — a condor setup (`play_type: "CONDOR"`) returned a real
`triple`-tier confluence object instead of `null`, and `attachConfluence` on a batch containing one
condor stamped it with the same fabricated tier as its real directional sibling.

GREEN after: 11/11 pass in `confluence.test.ts`; `npx tsc --noEmit` clean; full `npm test` on
Node 20 green (see PR).

### Fix rationale

`computeConfluence`'s return type widens to `ZeroDteConfluence | null` and returns `null`
immediately for `setup.play_type === "CONDOR"`, before any of the VWAP/market scoring runs.
`null` is already this field's established shape
(`EnrichedZeroDteSetup.confluence?: ZeroDteConfluence | null`) and BOTH real consumers already
null-guard it: `gates.ts`'s G-12 confluence gate already treats `confluence == null` as a real,
handled case (and already separately exempts condor rows from G-12 entirely via its own
`!isCondor` check, so gating behavior is unaffected either way), and `thesis-health.ts` already
optional-chains `liveConf?.vwap_ok`. So this degrades safely with zero new plumbing — the same
discipline as the sibling `computeThesisHealth` condor fix in this same PR wave.
