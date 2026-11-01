> **kind:** FINDING

## Vector pick evidence "HELIX flow" section shows raw option_type prints, not aggressor-aware ones — a SOLD call renders as confirming evidence for a BOUGHT call pick — FIXED

**Where:** `src/features/vector/lib/vector-pick-evidence.ts` — `flowsAtStrike()`, feeding the
`"flow"` ("HELIX flow") evidence section inside `buildVectorPickEvidence()`. This is the per-pick
evidence drawer rendered under each Vector contract pick (`VectorContractPicksCard.tsx` ->
`VectorRankedPick.evidence`) — the panel whose entire job is to show a member grounded, auditable
reasons to trust (or distrust) a specific contract recommendation.

### Root cause

`flowsAtStrike()` filtered session flow prints by **raw `option_type`** matching the picked
contract's side:

```ts
const want = side === "call" ? "CALL" : "PUT";
return flows.filter((f) => f.option_type?.toUpperCase() === want && f.strike === strike)...
```

That is exactly the conflation this codebase has already found and fixed three separate times in
sibling files, each with the identical lesson documented in-code:

- `vector-play-candidates.ts`'s `flowPremiumAtStrike`/`largestFlowPremium` ("A print's option TYPE
  matching the recommended contract's side is not confirmation on its own — a SOLD call at this
  strike is bearish, not support for buying more calls there.")
- `vector-play-platform.ts`'s `summarizeSessionFlowBias` ("a sold call is bearish, not bullish, so
  `bias` is bucketed on the aggressor-aware `flowDirection`... a call/put count that ignores
  buy-vs-sell is the exact conflation measured to sign-flip 44.6% of tickers in
  helix-flow-aggression.ts")
- `vector-play-platform.ts`'s `largestAlignedFlowPremium` ("Aligned on the aggressor-aware
  direction, not raw option type — a sold call must not confirm a 'long' bias just because it is
  nominally a CALL print.")

`vector-pick-evidence.ts` imports `summarizeSessionFlowBias` (already aggressor-aware) and uses it
correctly as a *fallback* when no print matches at the exact strike — but the *primary* path,
`flowsAtStrike()`, never imported `flowDirection` at all and filtered on raw `option_type`. It was
the missed consumer of a fix that every other sibling flow-reading helper in this feature already
carries.

### Evidence

Live repro (scratch probe, `node --import tsx`): a recommended long-call pick at strike 575 with
one session flow print — a CALL at strike 575, `ask_pct: 8` (seller-initiated per
`ASK_SIDE_SOLD_PCT=40`, i.e. a **SOLD call = bearish** per `flowDirection`'s own documented
CALL-sold→bearish rule) — rendered:

```json
{
  "id": "flow",
  "title": "HELIX flow",
  "items": [{ "label": "Print at strike", "value": "$2.6M", "detail": "exp 08/28" }]
}
```

directly under the "Why this strike" / "HELIX flow" evidence for the bought-call pick — reading as
a $2.6M confirming print when the actual tape at that exact strike was bearish.

Regression test added (`vector-pick-evidence.test.ts`): RED before fix (the sold-call print wrongly
rendered as a "Print at strike" item), GREEN after (the sold print is excluded; a genuinely bought
call at the same strike/premium still renders, proving the fix filters by direction rather than
hiding the section).

### Blast radius

Only one function (`flowsAtStrike`) and one caller site (the "flow" section of
`buildVectorPickEvidence`), but that function feeds every Vector contract pick's evidence drawer —
every member opening the "why this strike" panel on any pick where a flow print exists at that
exact strike was potentially shown a direction-flipped "confirmation." The sibling fallback path
(`summarizeSessionFlowBias`, used when no exact-strike print matches) was already correct and is
untouched.

### Fix rationale

Mirror the exact pattern already used by every sibling helper: filter on
`flowDirection(f) === wantDir` (call pick wants `bullish`, put pick wants `bearish`) instead of raw
`option_type`, importing the shared `flowDirection` from
`@/features/helix/lib/helix-flow-aggression` rather than re-deriving the rule locally. An
undetermined-aggressor print (no `ask_pct`, or at the midpoint) is excluded rather than guessed —
same "never invent a direction" discipline the other helpers already apply. The pre-existing test
("includes strike, flow, positioning, technicals when grounded") was updated to supply a
determined (`ask_pct: 85`, bought) print so it continues to exercise a genuine confirming print
rather than an accidental one; a new regression test pins the sold-call exclusion and a matching
bought-call inclusion side by side.

| **Status** | FIXED — `flowsAtStrike()` now filters by aggressor-aware `flowDirection`, not raw `option_type`. |
|---|---|
