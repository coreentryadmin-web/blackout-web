# LARGO PRODUCT CONTRACT v1

> **Status:** ACTIVE. Binding on every product surface exposed to Largo.
> **Owner:** the coordinating (SPX Slayer / integration) lane.
> **Audience:** the Helix, Thermal, Vector, Meridian and Night Hawk for-Largo lanes, and anyone
> adding a Largo tool later.

## Why this exists

Largo's job is to answer a member's question by reasoning across products. It can only do that if
the products describe themselves in compatible terms. Five lanes building Largo-facing surfaces in
parallel will otherwise produce five schemas, five confidence models, five freshness definitions and
five ticker conventions — and the cross-product questions (*"Where do Helix and Vector disagree?"*,
*"How does Thermal positioning support this Night Hawk trade?"*) become unanswerable not because the
data is missing but because it cannot be joined.

This contract is **ADDITIVE**. It adds required fields. It does **not** replace a product's richer
types, and **flattening product-specific intelligence to satisfy it is a violation, not compliance.**
Where standardization would destroy meaning, carry BOTH: the native field and the normalized one.

## The governing principle

Every value that reaches Largo must be able to answer five questions **without the model guessing**:

| question | contract point |
|---|---|
| What is this about? | C4 identity |
| When is it from? | C1 time, C2 freshness |
| How sure are we? | C6 confidence, C7 evidence |
| Where did it come from? | C8 provenance |
| What if it is missing? | C3 absence |

This is not abstract. Every one of these came from a defect that shipped:

- **C1** — OHLC bars carried an epoch `t` and nothing else. The model guessed the session convention
  and answered a dated close **off by a full session**; in the worst case it selected `daily_bars[0]`
  (an 85-day-old bar) and stamped the requested date on it. Measured: 1/5 dated closes correct.
  Fixed in #2418.
- **C3** — Vector Pulse is differential. On the first read of a session there is no baseline, so an
  empty signal list means *"no baseline yet"*, **not** *"the tape is quiet"*. Reporting silence as a
  finding is the most dangerous shape in this system.
- **C4** — SPX ≈ 10 × SPY. A cross-product comparison that mixes them produces a plausible wrong
  number, which is worse than an obvious one.
- **C6/C8** — a fill rate without its cohort is not a fact about the field. Sampling earnings by date
  returns micro-caps with no options market, against which `intel.thermal` reads 0% filled; at
  `importance>=4` it is 10/10.

## The contract

### C1 — TIME. Never an epoch as the only time.

Every tool result carries `as_of: "YYYY-MM-DD HH:mm ET"`. Every dated row carries
`session_date: "YYYY-MM-DD"`.

Use the shared helpers — **do not reimplement**:
`etStamp()`, `etSessionDate()`, `stampBars()` in `src/lib/largo/temporal/bar-session-date.ts`.

A Polygon **daily** bar's `t` is not midnight ET (it lands at 01:00 ET), which is precisely the
detail that made a reader "correct" it in the wrong direction. The ET calendar date of `t` **is** the
session date, for daily and intraday alike.

### C2 — FRESHNESS. A cached value must say it is cached.

```ts
freshness: "live" | "delayed" | "cached" | "snapshot" | "stale"
age_seconds: number | null
```

If the age is known internally, it must reach the model. Highest value on snapshot-based products
(Thermal, Vector) where a stale reading presented as current is a wrong answer that looks right.

### C3 — ABSENCE. Never return `[]` / `null` / `{}` for "unavailable".

```ts
unavailable: { reason: string; what_is_missing: string; retryable: boolean }
```

"No data" and "no signal" are different claims. A consumer that cannot tell them apart will report
absence as a finding. Any fallback that returns a degraded result the caller cannot distinguish from
a real one is a defect **even when every test passes**.

### C4 — IDENTITY.

```ts
ticker: string            // uppercase canonical root: "SPX", never "I:SPX" or "SPXW"
ticker_class: "index" | "equity" | "etf"
```

### C5 — DIRECTION.

```ts
direction: "bullish" | "bearish" | "neutral"
```

Never hand the model a raw sign it must interpret — dealer-gamma sign conventions differ per product.
**Keep the product's native richer notion** (posture, regime, tone, severity tier) alongside it.

### C6 — CONFIDENCE.

```ts
confidence?: { score: number /* 0..1 */; basis: string; sample_size: number | null }
```

A score with no basis is not a fact. **If a product cannot produce a calibrated score, OMIT the
field.** An invented `0.7` is worse than nothing, because it will be compared against another lane's
real one. Omission is honest; fabrication is not.

**HELIX NOTE:** The conviction score shown in the Helix tape UI (order size + sweep/0DTE flags) is a
**notability heuristic, not a calibrated confidence measure**, and must never be sent to Largo as a
confidence field. It is documented in the UI with a caveat: *"Notability heuristic: order size + sweep/0DTE flags. Not a validated directional-conviction ranking."* Confidence to Largo, if needed, must be omitted or derived separately from real evidence.

### C7 — EVIDENCE.

```ts
evidence: string[]   // the specific numbers that produced the claim
```

Not a restatement of the claim. `"call wall 7700 holds 3.2x the gamma of the next strike"`, not
`"strong resistance"`.

### C8 — PROVENANCE.

```ts
source: "polygon" | "unusual_whales" | "benzinga" | "internal_db" | "redis" | "computed"
computed_by?: string       // for derived values
cohort?: string            // REQUIRED alongside any rate/coverage/fill number
```

### C9 — PRECISION.

Do **not** round inside providers or compute paths — rounding a delta before it is used in a
calculation changes the calculation, and in the Night Hawk lane that changes a P&L. Rounding happens
exactly once, at the model's tool boundary (`makeGuardedToolRunner`).

### C10 — HISTORICAL CONTEXT.

If a product can answer *"what happened after similar conditions historically"*, expose it as a
**tool** carrying the fields above. Historical reasoning baked into prose cannot be joined, verified
or cited.

## Cross-product disagreement is represented, never hidden

Lanes must **not** reconcile with each other. Vector and Helix both read flow and will sometimes
disagree; that disagreement is *information*, and smoothing it over destroys it.

Each lane exposes its own read honestly (C5 + C6 + C7). The integration layer — owned by the
coordinating lane — surfaces the conflict and its basis. A lane that quietly adjusts its numbers to
match a peer has removed the signal and left a false consensus in its place.

## The cross-product questions this contract exists to enable

These require several products at once, and are the acceptance test for the contract:

- What matters right now?
- Why is SPX moving?
- Where do Helix and Vector disagree?
- What changed in the last 30 minutes?
- What are the strongest setups across BLACKOUT?
- How does Thermal positioning support this Night Hawk trade?
- What does Meridian see that Helix doesn't?
- Which signals are strengthening or deteriorating?
- What happened after similar conditions historically?

## Lane ownership

| lane | owns |
|---|---|
| Helix | `src/features/helix/**`, `src/lib/helix-*.ts`, `helix-tape-analytics.ts`, `bie/helix-read.ts`, `/flows` |
| Thermal | `src/features/thermal/**`, `helix-thermal-compare.ts`, thermal crons |
| Vector | `src/features/vector/**`, `src/lib/bie/vector-*.ts`, `vector-analytics*.ts`, vector crons |
| Meridian | `src/lib/meridian/**`, `src/features/meridian/**`, `meridian-for-largo.ts`, `pre-earnings-pack.ts` |
| Night Hawk | `src/lib/zerodte/**`, `src/features/nighthawk/**`, 0DTE/nighthawk routes |
| Coordinator | `src/lib/largo/core/**`, `src/lib/largo/temporal/**`, SPX levels/GEX provider layer, the integration layer |

**Shared, touched by all:** `src/lib/largo/run-tool.ts`, `tool-defs.ts`, `system-prompt.ts`. Keep
edits surgical, confined to your own tool cases, and **declare them in the PR** so merges can be
sequenced rather than conflicting.

## Amending this contract

A lane that finds a point would destroy meaning on its surface must **push back with the specific
reason** rather than silently comply. Fixing the contract is cheaper than damaging a good field to
satisfy it. Amendments land here, versioned.
