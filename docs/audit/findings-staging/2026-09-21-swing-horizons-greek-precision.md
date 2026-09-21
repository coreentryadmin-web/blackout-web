> **kind:** FINDING

## Ask Largo — `GET /api/market/nighthawk/horizons?view=swings` destroyed real gamma/theta/vega/iv to 0.00 at the response boundary — FIXED

| | |
|---|---|
| **Area** | `src/app/api/market/nighthawk/horizons/route.ts` |
| **Status** | FIXED |
| **Severity** | P2 — Largo product-contract precision violation (fabricated-looking certainty via lossy rounding, not an honest omission); no wrong-DIRECTION risk, but a real greek silently reads as a confident "0" |
| **Found via** | Ask Largo × Night Hawk Swings standing ownership mandate (`CLAUDE.md`) priority follow-up on a flagged AAPL swing position (`positionId 37`, 330C) whose horizons payload showed `gamma:0, vega:0, iv:0` exactly |

### Root cause

`GET /api/market/nighthawk/horizons` wraps its whole response in `roundFloats(payload, 2, keyDp)` —
the shared response-boundary rounding helper whose own header explicitly documents the exact hazard
this bug hit: *"Option greeks are the motivating case: gamma is routinely 0.0008–0.05, so the 2dp
default would quantize it to 0.00 and DESTROY the number"* (`src/lib/round-floats.ts`).

The route's own inline comment already cited that precedent by name — *"Same per-key-precision
pattern round-floats.ts's own docs establish for gamma (0.0008-0.05 needs 4dp or it quantizes to
0.00) — option premiums need the same treatment"* — while fixing only `mid`/`entryPremium`/
`peakPremium` in the `keyDp` map two lines below it. `gamma`/`theta`/`vega`/`iv` were never actually
added to the override, so the comment described the fix without the code applying it:

```ts
roundFloats(
  { board, upstream_ok: payload?.upstream_ok ?? true, session: payload?.session ?? null },
  2,
  { mid: 4, entryPremium: 4, peakPremium: 4 }   // gamma/theta/vega/iv missing
)
```

The greeks themselves are computed and carried HONESTLY all the way up to this boundary —
`live-plays.ts`'s `contractFromRow` stamps `gamma: quote?.gamma ?? null` (never fabricates a value;
an absent quote reads as an explicit `null`, per that file's own "NULL-HONEST" header), and the
provider mapper (`options-snapshot.ts`) uses `finiteOrNull(r.greeks?.gamma)` so a non-finite upstream
value is also nulled, not coerced. So a real small-but-nonzero greek (e.g. `0.0031`) survived every
layer of this pipeline intact and correct — then got quantized to `0.00` by this ONE response-edge
`roundFloats` call, which is indistinguishable from a genuinely-absent quote (`null`) to any Largo
consumer or member reading the board. That is exactly the class of defect the standing Largo product
contract's "precision" point (`docs/audit/LARGO-PRODUCT-CONTRACT.md`) exists to prevent — the number
was real, not omitted, and rounding silently manufactured a false "known-zero" reading.

The same class of bug, in the same product family, was already found and fixed once before for
Vector (`src/features/vector/lib/vector-response-rounding.ts`, 2026-08-07: `movePct`/`atmIv`/etc
quantized to 0.00 at the identical 2dp default) — that fix's own header is what this route's comment
was citing. This is the second sibling call site with the identical shape, just never actually wired.

### Evidence

Live repro against production, `GET /api/market/nighthawk/horizons?view=swings` (temp Clerk session,
2026-09-21), the flagged AAPL 330C 1DTE swing position (`positionId 37`, expiry `2026-09-21`):

```
"contract": {
  "delta": 1, "gamma": 0, "theta": -0.03, "vega": 0, "iv": 0
}
```

A direct provider re-query of the SAME contract (`O:AAPL260921C00330000`, `/v3/snapshot`) taken
minutes later returned real, meaningfully-sized greeks for it — confirming the greeks pipeline
genuinely carries non-trivial numbers for this contract shape and the served `0`s are not simply
"this option has no optionality left":

```
"greeks": { "delta": 0.7336, "gamma": 0.0417, "theta": -1.526, "vega": 0.0562 },
"implied_volatility": 0.4848
```

(The served payload's `markAsOf` is `2026-09-18T20:00:20.380Z` — a stale, pre-weekend quote snapshot
carried by the manage-sync cron, so the exact magnitude comparison above is not apples-to-apples
minute-for-minute; that staleness gap on an expiry-day position is a separate, still-open lead for a
future cycle, noted below, not something this fix addresses.) Regardless of the staleness question,
the mechanism this PR fixes is proven directly: `roundFloats(x, 2)` with no `gamma`/`theta`/`vega`/
`iv` override quantizes any real value under `0.005` to `0.00` — verified with a RED→GREEN regression
test (`src/app/api/market/nighthawk/horizons/route.test.ts`, fixture values `gamma:0.0031`,
`theta:-0.0087`, `vega:0.0054`, `iv:0.1823`, all served byte-identical pre-fix-reverted `0` /
post-fix real value).

### Fix

Added `gamma`, `theta`, `vega`, `iv` to the route's existing `keyDp` map (4dp, matching
`round-floats.ts`'s own stated precedent and `vector-response-rounding.ts`'s `atmIv`). `delta` is
deliberately left at the 2dp default — it already renders meaningfully at that precision (0.30–1.00
native range) and is not the field the destroyed-to-zero hazard applies to.

### Blast radius

Single call site (`horizons/route.ts` is the only route that assembles this SWING-lane `contract`
shape at the response boundary with a bare 2dp default) — the 0DTE lane's own `roundFloats` call
inside `zerodte-service.ts` is a SEPARATE, unaudited call site with the identical bare-2dp shape;
flagged as a follow-up, not touched here (single-issue-PR discipline — the 0DTE gamma question needs
its own live repro before a fix, and 0DTE's own greek-quantization exposure was not part of this
cycle's flagged report).

### Follow-up for a future cycle (not fixed here, disclosed rather than silently dropped)

The `markAsOf` staleness (3 days old on an expiry-day position) surfaced while investigating this is
worth a dedicated look: does `swing-active-refresh` genuinely re-quote every OPEN position every RTH
tick, and if so why did this one not refresh over the trading day leading into its own expiry? Not
chased further this cycle to stay single-issue; noted for the standing Ask Largo mandate to pick up.
