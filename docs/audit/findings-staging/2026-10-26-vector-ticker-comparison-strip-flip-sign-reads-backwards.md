## Vector — `/vector` ticker comparison strip pairs an up/down arrow with a signed % whose convention is the OPPOSITE of every other arrow+% chip in the product — reads as a price-change contradiction, open

> **kind:** `FINDING`

**Status.** OPEN — needs the owning Vector lane to decide the fix (relabel/retool the chip so its
sign convention reads honestly, or add a disambiguating tooltip/label) rather than a blind patch;
see "Why this isn't a one-line fix" below.

### Area

`/vector` desk (non-owned, Vector lane) — `VectorTickerComparisonStrip.tsx` (the cross-ticker
"SPY vs sector peers" chip row rendered under the ticker tabs, mounted in
`VectorPageShell.tsx:961`), backed by `vector-screener.ts`'s `screenerRegimeOf`/`flipDistancePct`.

### Found by

Live-UI visual check via `proxy-browser.cjs` against prod `/vector?ticker=NVDA` (mobile viewport
430×932), DISCOVERY-lane sweep, 2026-10-26. Confirmed against the live DOM (not just the
screenshot) with a Playwright diagnostic reading `outerHTML` directly off production.

### Symptom

Live screenshot, same instant, same chip row:

- **AAPL** chip: `▼` (down arrow) paired with **`+0.5%`** (positive).
- **MSFT** chip: `▲` (up arrow) paired with **`-0.3%`** (negative).

Every other arrow+percent pairing in this product (daily change badges across Vector, Thermal,
Helix, Meridian) follows the universal finance-UI convention: up arrow + positive% = bullish/up,
down arrow + negative% = bearish/down. This chip row does the opposite — on BOTH tickers shown,
simultaneously, in a live capture — which reads as a direct self-contradiction to a member
scanning the row, not an edge case.

### Root cause (confirmed by source, not inference)

`vector-screener.ts`:

```ts
export function screenerRegimeOf(row): ScreenerRegime {
  ...
  return row.spot >= row.gammaFlip ? "above" : "below";
}

/** Signed distance from spot to the gamma flip, in % ((flip - spot)/spot). */
export function flipDistancePct(row): number | null {
  ...
  return ((row.gammaFlip - row.spot) / row.spot) * 100;
}
```

`VectorTickerComparisonStrip.tsx`:

```tsx
{row.regime === "above" ? "▲" : row.regime === "below" ? "▼" : "—"}
...
<span className="vector-comparison-chip-dist">{fmtDist(row.flipDistancePct)}</span>
```

The two values are internally self-consistent (not a math bug): when spot is **below** the gamma
flip, `gammaFlip − spot` is positive, so the chip shows `▼` + a **positive** %. When spot is
**above** the flip, `gammaFlip − spot` is negative, so the chip shows `▲` + a **negative** %. The
sign always correctly reflects "where the flip sits relative to spot," never "did price go up or
down" — but nothing in the chip discloses that. Compare the sibling
`<span class="vector-comparison-chip-strength" title="Wall strength (0–100)">` two spans later —
it carries a `title` tooltip explaining its own number. The regime arrow and the `%` span next to
it carry **no `title`, no label, no legend** anywhere on the chip or its container.

### Why this isn't a one-line sign flip

Negating the % so it matches arrow-up-for-positive would make the arrow+% pair READ naturally but
would then contradict the field's own documented meaning ("signed distance from spot to flip") and
whatever (if any) other code reads `flipDistancePct`'s sign directly — `vector-screener.ts`'s own
`nearest-flip`/`most-pinned` sort presets use this metric's magnitude via `absFlipDistancePct`, so
a silent sign flip is low-risk there, but the honest fix is a design call for the owning lane:
either (a) relabel the chip's third field as an unsigned "dist to flip" with the arrow carrying all
the directional information, or (b) add a `title`/inline legend disclosing "this % is how far spot
is from the gamma flip, not a price change" so the existing sign convention stops reading as a
contradiction. Both are legitimate; which one fits the chip's layout constraints is a call for
whoever owns Vector's screener UI, not something to patch blind from the DISCOVERY lane.

### Secondary finding: a stale "currently unmounted" code comment

`VectorTickerComparisonStrip.tsx`'s own top-of-file comment (as of this write-up) says: *"wiring
it here too so the same silent-staleness gap can't ship the moment this (currently unmounted)
component gets wired into a page."* This is stale — the component IS mounted, confirmed two ways:
(1) `VectorPageShell.tsx:960-966` imports and renders `<VectorTickerComparisonStrip>` unconditionally
whenever `!chartOnly && !comparePane && !focusMode && !(compactPanels && nativeShell)`; (2) the live
DOM diagnostic above captured real `<button class="vector-comparison-chip ...">` markup from
production. `git log -S` shows the import has been present in `VectorPageShell.tsx` since the
component's original PR (#1755) and through every subsequent `VectorPageShell` rewrite — it has not
been "about to get wired in," it has been live for a long time. Worth a one-line comment correction
whenever the arrow/sign issue above gets its real fix, so a future reader doesn't skip auditing
this component on the belief that it never renders.

### Next step (for whoever picks this up)

Pick (a) or (b) above, apply it only to `VectorTickerComparisonStrip.tsx`'s rendering (no change to
`flipDistancePct`'s underlying math or its other callers), add a regression test asserting the chip
either shows an unsigned distance or carries a disambiguating `title`, and drop the stale
"(currently unmounted)" phrase from the file's header comment in the same pass.

Not fixed in this pass — this is a design call on chip wording/layout, not a self-contained bug fix,
per the DISCOVERY lane's own scoping discipline.
