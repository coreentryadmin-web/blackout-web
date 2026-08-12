# Synthetic order book (depth ladder) — design of record

**Status:** shipped (Thermal → Depth tab). Server: `src/lib/gex-depth.ts` + `polygon-options-gex.ts`.
View: `GexDepthLadderView` in `GexHeatmap.tsx`. Validators: `scripts/audit/gex-depth-validate.mjs`
(numbers) and `scripts/audit/depth-ladder-ui-audit.mjs` (pixels).

## What it is

> A volume profile shows where trading **has** happened. This shows where trading **must** happen.

At every price level around spot, the ladder reports the quantity of stock dealers are mechanically
obliged to trade to stay delta-neutral **if price gets there**, and in which direction. It is the
same chain data the matrix paints, rearranged into the question a trader actually asks.

## Why it is not the cumulative curve we already had

`CumulativeCurve` accumulates *today's static* per-strike gamma across the strike axis. That treats
each strike's gamma as a fixed quantity that switches on once spot passes it. Real gamma is not
fixed — it peaks at-the-money and decays away, so a strike that is a monster node at spot is nearly
inert 5% higher.

The ladder therefore **reprices the entire chain at each hypothetical spot** and differences the
resulting dealer delta. Same inputs; a materially different answer in the tails, which is exactly
where "what happens if we break out" is asked.

## The math

For each band `[Lᵢ, Lᵢ₊₁]`:

```
D(S)  = Σ  posSign(type) · δ_BS(S, K, T, σ) · OI · sharesPerContract     (dealer option delta, shares)
flow  = −[ D(Lᵢ₊₁) − D(Lᵢ) ] · midPrice                                  (the stock trade, dollars)
```

`posSign` is **+1 for a call, −1 for a put** — deliberately GEX's convention, not DEX's. The two
differ in this codebase (DEX negates the whole book as counterparty to all OI). The ladder exists to
explain the gamma walls and the flip, so it must inherit the gamma convention or it would describe a
different book than the levels drawn beside it.

The negation is the hedge: a dealer holding `+X` delta of options must be short `X` shares to sit
flat, so the traded direction is the negation of the change in `D`.

**Consequences, which fall out of the arithmetic rather than being asserted anywhere:**

| regime | above spot | below spot | shape |
|---|---|---|---|
| long gamma (`+`) | dealers **sell** | dealers **buy** | damping **bowl** |
| short gamma (`−`) | dealers **buy** | dealers **sell** | accelerating **slide** |

## Geometry

±8% of spot in 0.5% steps → 32 bands plus spot. 8% because that is about the widest move worth
planning around inside the near-term expiry set the ladder is scoped to. 0.5% because it keeps the
row count readable on a phone — the ladder is the one gamma view that fits a narrow screen — while
still resolving a wall to within half a percent.

## Why it is server-side

Not a preference. Building it means repricing every contract at ~33 hypothetical spots, which needs
per-contract **IV and time-to-expiry**. The client payload carries `cells` — already-aggregated
strike × expiry *dollars* — so the browser structurally cannot do this. Computed once on a fresh
matrix build and cached with it, exactly like the SHIFT ring, so every reader shares one computation
(55–370 ms measured across SPY/QQQ/NVDA/TSLA/ASTS/AAPL/IWM).

## The anchor

Our closed form is **r = q = 0**, the same simplification the shipped vanna and charm already make.
The provider's greeks are not. Measured live on 2026-08-12, raw agreement at spot:

| non-payers | | dividend-paying ETFs | |
|---|---|---|---|
| TSLA | 0.1% | AAPL | 7.3% |
| ASTS | 0.7% | SPY | 9.5% |
| NVDA | 1.7% | QQQ | 15.8% |
| | | IWM | 21.7% |

**The gap is the dividend yield.** So the ladder is *anchored*: scaled so its gamma at spot equals
the matrix's own `gex.total`. Each source is then used for what it is best at — provider greeks are
authoritative **at** spot, and repricing is the only thing that can speak about **other** prices.
It also means the ladder and the headline net GEX beside it agree by construction, which removes a
whole class of "why do these two numbers disagree" question.

The anchor is **refused** outside a 0.4–2.5 ratio band, or on a sign flip. A wild ratio means
something is actually wrong, and silently rescaling by 40× would hide it. `calibration_factor` is
reported so the choice is auditable.

> The same r=q=0 error still affects **VEX and CHARM**, which are computed by us and *not* anchored.
> Quantified in `FINDINGS.md` (2026-08-12); fixing it needs a dividend-yield source and its own PR.

## Invariants (why it is trustworthy)

Unit-tested in `gex-depth.test.ts` (25 tests):

- `bsGamma` **is** the finite-difference derivative of `bsDelta` — not merely a plausible curve.
- A net-long-gamma book **must** sell above and buy below; net-short must invert; flipping the
  book's sign mirrors the ladder exactly.
- `cumulative` is exactly the running sum of the marginals, per side.
- Bands integrate back to `−ΔD` across the same span.
- No NaN/Infinity can reach the DOM; every bar width is a valid 0–100%.
- Anchoring preserves shape and scale only; implausible anchors are refused.

Checked against live chains by `gex-depth-validate.mjs`:

- raw closed-form gamma vs the provider's, **measured before the anchor** (comparing after would be
  a tautology that reports PASS however wrong the model is);
- the ladder agrees with **itself** — `shares` differences delta while `gamma` sums gamma,
  computed independently, so calculus requires them to line up. 32/32 bands on all seven tickers.

## Three defects the live harness caught that unit tests did not

1. **`crossing` derived from flow direction.** Direction turns at spot in *every* long-gamma book —
   that is the bottom of the damping bowl, not a regime change. It would have painted a flip line on
   a ladder with no flip. Now derived from the sign of net dealer gamma.
2. **Two successive wall checks, wrong the same way.** First "peak SELL lands on the call wall", then
   "net gamma is negative at the put wall". Both conflate a **per-strike** quantity (a wall is the
   strike with the largest per-strike gamma) with a **whole-book** one (the ladder reprices every
   contract). A heavily net-long book has positive total gamma even at its put wall — SPY, NVDA and
   TSLA all did. There is no invariant there; asserting one produced noise.
3. **Gamma sampled at the band edge** while `shares` integrates across the band. They then disagreed
   on exactly one band per ticker — the one straddling the regime crossing, where gamma changes sign
   partway across. Now sampled at the midpoint, the same price the notional uses.

## Honest limits (on the surface, not just here)

- **Not resting liquidity.** Conditional, reactive flow that only occurs if price travels there.
- Assumes dealers hedge **fully and continuously**. Real desks hedge in bands.
- Inherits the **calls-long / puts-short** dealer assumption. Where that is wrong for a strike, the
  depth is wrong there too — which is why flow-inferred dealer sign would upgrade this for free.
- **IV is held fixed** across the ladder. A real 5% move moves vol too.

## Lifecycle

Dropped — not pruned — by `prunePastExpiriesFromHeatmap` at the ET rollover. It was built against the
pre-rollover near-term expiry set and holds no per-expiry breakdown to prune, only the collapsed
result, and rebuilding needs raw contracts a served payload does not carry. The view reports it
unavailable until the next fresh build: **absent is honest, stale is not.**

## Follow-ups

1. **Vol axis → the shock engine.** Adding a σ dimension to the same grid turns this into
   "SPX −2%, VIX +5 → dealers must sell $X", of which today's ladder is the σ-unchanged row.
2. **Matrix rail.** A compact version pinned beside the matrix, sharing its strike rows.
3. **On the price chart.** Rotated onto the price axis of the desk chart — a forward-looking volume
   profile. Probably the most-used placement eventually.
4. **Night Hawk context.** Annotate a play's target with the forced flow between here and there.
