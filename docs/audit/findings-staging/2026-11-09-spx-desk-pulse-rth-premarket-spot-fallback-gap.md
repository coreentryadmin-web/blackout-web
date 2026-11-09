# 2026-11-09: SPX desk still blanked during premarket — the THIRD (RTH/premarket) price branch in `buildSpxDeskPulse()` never got the SPY-proxy fallback either

> **kind:** `FINDING`

**Status.** FIXED — this PR.

## Summary

`buildSpxDeskPulse()` (`src/features/spx/lib/spx-desk.ts`) has three separate price-resolution
branches. Two of them — the off-hours early-return branch and `buildSpxDeskPulseMinimal()`'s
cold-replica race branch — were given a `spxPriceFromSpyProxy()` last-resort fallback earlier
today (commits `00c459a90`/#7721, `a3d8b0adc`/#7728; see the sibling finding
`2026-11-09-spx-desk-pulse-offhours-spy-proxy-gap.md`). The **third branch — the one that
actually runs whenever `rthOpen || premarketPlan` is true, i.e. the entire 7:00-9:30 ET
premarket-planning window and the regular session — was never touched** and still returned the
full empty shell the instant `spxSnap?.price` was falsy, discarding `prior.pdc` even though it had
already been fetched in the very same `Promise.all` two lines above.

Confirmed live, 2026-11-09, during this cycle's Ask Largo/5-engine live-monitor sweep and
independently re-confirmed by 3 adversarial-verify agents (0/3 refuted): `GET
/api/market/spx/desk` served `available:false, source:"none", price:0` on 3+ consecutive
authenticated polls during the premarket-planning window with `as_of` genuinely advancing each
time (ruling out a frozen cache), and `GET /api/market/spx/play` simultaneously served
`phase:SCANNING, score:0, factors:[]`.

## Root cause

```ts
const [snapsRaw, prior, priorVix] = await Promise.all([
  fetchPulseLaneSnapshots(),
  priorDayForPulseLane(rthOpen),
  vixPriorDayForPulseLane(rthOpen),
]);
...
const spxSnap = snaps[SPX];
const vixSnap = snaps[VIX];
if (!spxSnap?.price) return empty;         // <-- prior.pdc already in hand, never tried
const price = spxSnap.price;
```

During the 7:00-9:30 ET premarket-planning window, `fetchPulseLaneSnapshots()` has no fresh WS
tick for the I:SPX cash index (it hasn't started trading yet), and its REST fallback
(`fetchIndexSnapshots`) hits the documented, still-open real-time-snapshot entitlement 403
(CLAUDE.md's "Polygon snapshot entitlement lost" note, re-confirmed live again during this verify
pass: `GET /v3/snapshot?ticker.any_of=SPY` → 403 `NOT_AUTHORIZED`; `GET /v2/aggs/ticker/SPY/prev`
→ 200 `c:735.29`; `GET /v2/aggs/ticker/I:SPX/prev` → 403). So `spxSnap?.price` is reliably
null/0 for the whole premarket window, and this branch — which is the production fallback path
whenever `loadSpxDesk()`'s own cache-build loses its `maxBlockMs` race (`spx-desk-loader.ts`'s
`fallback: async () => deskShellFromPulse(await loadSpxDeskPulse())` routes straight through
`buildSpxDeskPulse()`, not `buildSpxDesk()`'s own already-fixed chain) — returned the empty shell
with zero fallback attempt, blanking the SPX desk panel, the play/trade-alert panel, and Ask
Largo's `get_spx_confluence` tool during the exact window SPX Slayer exists to serve pre-open
guidance in.

## Evidence (RED → GREEN)

RED (pre-fix, source reverted via a saved patch, test kept): the new regression test
(`"buildSpxDeskPulse: RTH/premarket branch has a prior.pdc + SPY-proxy fallback before returning
empty (2026-11-09 fix)"`, `spx-desk-offhours-spot.test.ts`) failed — 1/19 failing, 18/19 passing
(every pre-existing test in the file was already green, confirming the regression test alone
targets the new gap).

GREEN (post-fix, patch re-applied): 19/19 pass in `spx-desk-offhours-spot.test.ts`; 171/171 pass
across `src/features/spx/lib/spx-desk-*.test.ts` + `src/features/spx/lib/spx-pulse*.test.ts`;
`npx tsc --noEmit` clean. Both runs on Node 20.20.2 per the repo's standing Node-version note.

## Fix

Applied the identical fallback chain already proven correct by the two sibling branches and by
`buildSpxDesk()`'s own primary-lane chain:

```ts
const price =
  spxSnap?.price ?? lastPulseForSignals?.price ?? prior.pdc ?? (await spxPriceFromSpyProxy()) ?? 0;
if (!(price > 0)) return empty;
```

`prior.pdc` was already fetched in this branch's own `Promise.all` — the fix stops discarding it.
`spxPriceFromSpyProxy()` is only reached once every faster source (live snapshot, last-good
in-process pulse, prior-day close) has already failed, so this adds no extra latency on the
common path where a live tick exists. Order and naming mirror `buildSpxDesk()`'s own `price`
chain (line ~1637) and `buildSpxDeskPulseMinimal()`'s (line ~2626) exactly, so the pattern now
reads the same in all three places instead of as a one-off.

## Blast radius

- Same user-facing surface as the sibling off-hours fix: SPX Slayer's desk panel, the
  play/trade-alert panel, and Ask Largo's `get_spx_confluence` tool — all three read off
  `buildSpxDesk()`/`loadSpxDesk()`, which falls back to this exact pulse builder under cache
  contention.
- **Wider window than the sibling fix**: the off-hours branch only runs when the market is fully
  closed; this branch is the one that runs for the entire premarket-planning window (7:00-9:30
  ET) AND the regular RTH session — i.e. it is live far more of the trading day than the branch
  the earlier finding fixed.
- `buildSpxDeskPulseMinimal()` was re-checked for the same shape: its only price-resolution path
  (the cold-replica race branch) already carries the full fallback chain
  (`spxSnap?.price ?? lastPulseForSignals?.price ?? prior.pdc ?? (await spxPriceFromSpyProxy()) ??
  0`, shipped by #7721/#7728) — no second unfixed branch exists in that function. Left untouched.
- Did not touch `polygon-options-gex.ts`'s `fetchSpotFromPrevBar` (unrelated, deliberately
  different — protects homepage ISR) or the two already-fixed branches beyond reading them for
  the pattern.

## Relationship to the earlier (#7721/#7728) finding

`docs/audit/findings-staging/2026-11-09-spx-desk-pulse-offhours-spy-proxy-gap.md` fixed the same
root cause (I:SPX entitlement-block with no SPY-proxy recovery) in two of `buildSpxDeskPulse()`'s
three price-resolution branches. This finding is the third, previously-unaddressed branch of that
exact same root issue — found and fixed in this PR, not a re-discovery of the earlier one.

## Why this wasn't caught by the earlier fix

The earlier fix's own regression tests scoped their assertions to the off-hours
`if (!rthOpen && !premarketPlan)` block and to `buildSpxDeskPulseMinimal()` specifically; nothing
in that PR asserted anything about the code that runs in the complementary `rthOpen ||
premarketPlan` case inside `buildSpxDeskPulse()` itself, so the third branch's identical gap went
unnoticed until this cycle's live premarket re-poll caught the desk still blanked.
