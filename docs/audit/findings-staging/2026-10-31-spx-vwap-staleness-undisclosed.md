> **kind:** FINDING

## SPX Slayer's closed-market VWAP factor presents a Friday-close VWAP, carried forward indefinitely by a sticky cross-request fallback, as a live score contributor with zero staleness disclosure — FIXED

| | |
|---|---|
| **Area** | SPX Slayer / Night Hawk — `evaluateSpxPlayCore`'s closed-market branch (`src/features/spx/lib/spx-play-engine.ts`), fed by `mergePulseIntoDesk`'s sticky structure fallback (`src/features/spx/lib/spx-desk-merge.ts`) |
| **Status** | FIXED |
| **Severity** | P2 (member-facing signal correctness — a stale prior-session value presented as a live, scored read with zero disclosure; no financial loss by itself, since the closed-market branch never opens a real position, but it directly misinforms the "Session closed" SCANNING card's thesis/score/play-idea) |

### Root cause

`src/features/spx/lib/spx-desk-merge.ts`'s `mergePulseIntoDesk` resolves the merged desk's `vwap`
via `stickyStructureLevel("vwap", pulse.vwap, base.vwap)` (around line 302), whose non-hod/lod
branch is:

```ts
next = pulseVal ?? baseVal ?? lastGoodStructure[key] ?? null;
```

`lastGoodStructure` is a cross-request, cross-instance (Redis-backed) "last-known-good" cache that
is reset only on an ET session-date change (`ensureStructureCacheFresh`). So once BOTH
`pulse.vwap` and `base.vwap` go null — routinely true on a non-trading day (weekend/holiday), once
a prior session already seeded the cache — `stickyStructureLevel` keeps returning that prior
session's VWAP **indefinitely**, with no marker anywhere on `SpxDeskPayload` saying the value did
not come from a fresh read.

`evaluateSpxPlayCore`'s closed-market branch (`src/features/spx/lib/spx-play-engine.ts`, ~line
1654) builds its SCANNING card's score/thesis/play-idea off `computeSpxConfluence(desk)`, where
`desk` is the `peekMergedSpxDesk()` merged payload — the exact object carrying this sticky VWAP.
`computeSpxConfluence` (`spx-signals.ts`, line 471) unconditionally scores a "VWAP" factor
(`weight: ±12`) whenever `desk.vwap != null`, with no staleness check — there is nothing on the
desk payload to check against.

This is explicitly **not** covered by the existing GEX-staleness disclosure fix
(`discloseStaleGexFactors`, shipped 2026-10-26): that function's own doc comment says "Non-GEX
factors (VWAP, γ regime, max pain, …) are left untouched — their own data freshness is a separate
concern this fix does not touch."

### Evidence

Live production audit, 2026-10-31 (Saturday, market genuinely closed): `GET /api/market/spx/play`
returned a `"VWAP"` factor with `weight: -12` and `detail: "Below VWAP 7580.87 — sellers
pressing"`, contributing -12 to the closed-market SCANNING card's score — while the sibling
`GET /api/market/spx/desk` route (`peekSpxDesk()`, which does **not** go through
`mergePulseIntoDesk`'s sticky fallback) reported `"vwap": null` at the exact same instant. Same
divergence shape the 2026-10-26 GEX fix's own evidence used (that fix's write-up: "the sibling GET
/api/market/spx/desk route ... reported gex_walls:[]/gex_stale:true ... at virtually the same
instant /play served this exact idea undisclosed").

RED→GREEN proven via `git diff`/`git checkout --`/`git apply` on just the three source files
(`spx-desk.ts`, `spx-desk-merge.ts`, `spx-play-engine.ts`; test files kept): with the source
reverted, the 3 new tests failed —
`mergePulseIntoDesk vwap_stale disclosure > marks vwap_stale:true ...` (`undefined` !== `true`),
`evaluateOpenPlay closed-market SCANNING, desk.vwap_stale:true: ...` (factor detail stayed
`"Below VWAP 7580.87 — sellers pressing"`, no `/VWAP stale, not live/` match), and the
both-stale-at-once composition test (same reason) — while every other test in both files still
passed. Restoring the fix turned all 3 green with no other regressions. Full suite
(`npm test`) and `npx tsc --noEmit` both clean after the fix.

### Blast radius

- `src/features/spx/lib/spx-signals.ts`'s `computeSpxConfluence` — the VWAP factor's score
  (`±12`) and grade contribution are unchanged by this fix (deliberately — see Fix rationale); only
  the closed-market *presentation* of that factor's `detail` text gains a disclosure clause.
- `src/features/spx/lib/spx-play-intel.ts`'s `buildPlayIdea`/`anchorPhrase` can independently cite
  `desk.vwap` in the closed-market `play_idea` line (e.g. "below VWAP 7580") — not touched
  directly (same as the GEX fix's own scope), but the closed-market branch's `closedPlayIdea`
  now appends the same `"VWAP stale, not live"` suffix to the whole idea line whenever the VWAP
  factor fired stale, exactly mirroring how the GEX fix already handles a GEX-cited idea line.
- Every other consumer of `SpxDeskPayload.vwap` (open-market play evaluation, the lotto/power-play
  catalysts, the terminal lines, the mobile projection) is unaffected: the sticky-fallback
  staleness this fix discloses is a closed-market-specific condition (pulse AND base both null),
  which essentially only arises off-hours/non-trading-days — exactly the window the closed-market
  branch alone handles. `vwap_stale` is a new optional field, additive to `SpxDeskPayload`.

### Fix rationale

Added `desk.vwap_stale?: boolean` (spx-desk.ts), computed in `mergePulseIntoDesk` as
`pulse.vwap == null && base.vwap == null && vwap != null` — true exactly when the returned `vwap`
came from the sticky fallback rather than a fresh pulse/base read that cycle. This mirrors
`gex_stale`'s existing shape exactly (a boolean companion field set only by the merge layer that
actually knows the provenance), rather than inventing a new mechanism or threading a new return
shape through `stickyStructureLevel` (which is also used for hod/lod/pdh/pdl/emas under a
different, max/min-based formula not implicated by this bug — left unchanged).

In `evaluateSpxPlayCore`'s closed-market branch, added `discloseStaleVwapFactor` as a direct
sibling of the existing `discloseStaleGexFactors` — same idiom (append `" — VWAP stale, not
live"` to the factor's own `detail`), gated on `desk.vwap_stale === true` **and** the VWAP factor
actually having fired (so a closed-market read with no VWAP factor present never grows a
staleness clause about data it never showed — the same discipline the GEX check already applies).
The GEX and VWAP staleness checks are independent and now compose into one shared
`"· <clause> · <clause>"` suffix for `thesis`/`play_idea`, so a read that is stale on **both** at
once discloses both rather than one overwriting the other (covered by a new test —
`BOTH desk.gex_stale and desk.vwap_stale true`). Deliberately did **not** exclude or down-weight
the stale VWAP factor from the score — the GEX fix's own design choice was disclosure, not
exclusion ("once the market is genuinely closed, stale and correct are the same thing" — the
underlying number is still the right historical VWAP, just not live), so this fix follows the same
design rather than diverging from the pattern it extends.
