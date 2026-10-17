> **kind:** FINDING

## SPX desk intel "WALLS" brief line: gamma-flip distance sign-inverted relative to its own sibling clauses — FIXED

| **Status** | Fixed (`wallsBriefLine()`, `src/lib/bie/spx-desk-intel.ts`) |
|---|---|

**Found via:** this session's standing Ask Largo deep-dive (5-engine monitor cycle, 2026-10-17 ~21:21 UTC), a systematic static-code sweep for the same defect class just fixed in the swing play-brief (PR #6147).

**Live repro.** `GET /api/market/gex-positioning?ticker=<T>` (production, 2026-10-17 ~21:25 UTC), 4/4 tickers checked with a resolved flip show the identical inversion:

| Ticker | spot | flip | flip vs spot | raw `distance_to_flip_pct` | rendered (pre-fix) | correct sign |
|---|---|---|---|---|---|---|
| AAPL | 342.62 | 348.59 | +5.97 (ABOVE) | −1.74 | "−1.7% from γflip" | +1.7% |
| META | 705.32 | 699.76 | −5.56 (BELOW) | +0.79 | "+0.8% from γflip" | −0.8% |
| AMZN | 248.98 | 273.66 | +24.68 (ABOVE) | −9.91 | "−9.9% from γflip" | +9.9% |
| MSFT | 526.83 | 523.76 | −3.07 (BELOW) | +0.58 | "+0.6% from γflip" | −0.6% |

**Root cause.** Same shape as #6147 (swing play-brief), different file. `wallsBriefLine()`'s "WALLS" line composes several distance clauses via `signedPts(level - spot)` — e.g. `call wall ${n} (${signedPts(p.call_wall - spot)}, caps upside)` — positive when the level is ABOVE spot. The γflip clause instead rendered the raw `p.distance_to_flip_pct` field (`src/lib/providers/gex-positioning.ts`, `(spot - flip) / spot * 100`) directly — positive when flip is BELOW spot, the exact opposite convention from its own call-wall/put-wall neighbors three words earlier in the identical string.

**Already baked into the committed test fixture as "expected."** `spx-desk-intel.test.ts`'s `fakePositioning()`: `spot: 5900, flip: 5890` (flip 10pts BELOW spot — true distance −0.17%), but the fixture supplied `distance_to_flip_pct: 0.17` (positive) — the raw, already-inverted field, baked in as a fixture value. The one existing test for this function (`wallsBriefLine lists call and put walls with distance`) only asserted `.includes("call wall")`/`.includes("put wall")`, never checking the γflip clause's sign at all, so the inversion was never caught.

**Blast radius.** Two live Largo-reachable call sites compose this line: `src/lib/bie/wall-dynamics-read.ts` (`composeWallDynamicsRead("SPX"/"SPXW")`, Largo's "wall dynamics" tool answer) and `src/lib/bie/spx-desk-brief.ts` (the composed SPX full-state desk brief's `WALLS` line, the general "what's SPX doing" Largo answer). Confirmed **not** reachable from the swing play-brief (grepped `src/lib/swing/*.ts` for any import of `spx-desk-intel.ts` — zero hits) — this is a different Largo surface (SPX desk intel) from #6147's fix, same root-cause family rather than the same code.

**Fix.** Compute the signed distance locally as `(flip - spot) / spot * 100` instead of reading the raw `distance_to_flip_pct` field — the same `(level - spot)` convention `signedPts` already uses for the call/put wall clauses a few lines above. Also merged the `flip != null` and (now-removed) `distance_to_flip_pct != null` gates into one, since the raw field is only ever non-null when `flip` is non-null in the first place (confirmed in `gex-positioning.ts`'s own computation) — no behavior change for the common case, and the clause now renders whenever `flip` and `spot` are valid rather than depending on a second field's own null-ness.

**Tests.** Added a dedicated test asserting the γflip clause's sign (flip below spot ⟹ negative distance), using the existing fixture. RED→GREEN proven via `git stash` of `spx-desk-intel.ts` alone (1 failure without the fix, 0 with it restored). Full `src/lib/bie` suite: 782/782 pass. `tsc --noEmit`: clean.

**Lower-confidence secondary observation (not fixed here, flagged for a second look):** `regimeBriefLine()` in `src/lib/bie/vector-desk-intel.ts` uses the same "spot relative to flip" convention, composed into the same Vector full-state brief alongside `magnetBriefLine`'s opposite "level relative to spot" convention — but it phrases the number as "spot vs γflip," a defensible self-contained reading rather than a clear inversion like the one fixed here. Not acted on in this PR.
