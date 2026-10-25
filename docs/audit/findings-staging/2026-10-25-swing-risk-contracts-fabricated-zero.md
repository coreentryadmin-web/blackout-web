> **kind:** FINDING

## Night Hawk Swings — `computeSwingRisk` fabricated 0 risk on invalid `contracts` — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **Surface** | `src/lib/swing/swing-risk.ts` (`computeSwingRisk`) |
| **Severity** | P3 (latent — zero production call sites; see Blast radius) |

### Root cause

`computeSwingRisk`'s own file header states the module's "standing law": *"a missing greek, spot,
or beta is NEVER read as 0 risk. Whatever input is absent is listed in `missing` and the position
is flagged `partial:true`, so a downstream budget never sums a hollow risk number into a real
total."* Every input the function reads enforces this — **except `contracts`**, the one input that
scales every single output field (`greekRisk.{delta,gamma,theta,vega}`, `dollarRisk`,
`betaWeightedDelta`).

The pre-fix code was:

```ts
const qty = isFin(position.contracts) ? position.contracts : 0;
```

An invalid `contracts` (e.g. `NaN` from `Number(row.contracts)` on a malformed DB row — the exact
decode pattern this codebase uses elsewhere, per `swing-risk.ts`'s own "PURE & deterministic" header
noting it's fed by real DB-shaped callers eventually) silently became `qty = 0`. Since every output
field is `<real greek value> * qty * mult * sign`, and `qty = 0`, every field evaluated to a real,
finite `0` — not `null` — while `missing` stayed `[]` and `partial` stayed `false`. The function
reported a clean, fully-grounded read of **zero risk** for a position whose actual contract count
was simply unparseable, indistinguishable from a genuinely flat/closed position.

### Evidence

Live repro (`node --import tsx`, see fix commit for the exact script) — `contracts: NaN`, every
other input (greeks, spot, beta, premium) real and finite:

```
Pre-fix:  { greekRisk: {delta:0,gamma:0,theta:0,vega:0}, dollarRisk:0, betaWeightedDelta:0,
            partial:false, missing:[] }
Post-fix: { greekRisk: {delta:null,gamma:null,theta:null,vega:null}, dollarRisk:null,
            betaWeightedDelta:null, partial:true, missing:["contracts"] }
```

### Blast radius

`git grep -rln "computeSwingRisk" src/` (excluding `swing-risk.ts` and its own test) returns **zero
production call sites** — already documented as a separate, deliberately-deferred integration gap
in `FINDINGS.md` ("a fully-built, tested per-position dollar-risk engine... has zero call sites
anywhere in the codebase... left as a follow-up idea"). This fix does not change any live behavior
today for that reason. It matters because the moment a future PR wires this module into the
allocation/budget layer (`swing-portfolio-budget.ts` or similar), an unparseable `contracts` value
on a real row would otherwise silently report "zero risk, fully grounded" instead of surfacing as a
real gap a budget needs to see — a landmine that would ship invisibly inside that future PR's own
"it passed all tests" confidence, since nothing in the pre-fix test suite exercised this input.
Fixing it now, while the function is still inert, means the eventual wiring PR inherits a correct
primitive rather than having to rediscover and fix this mid-integration.

### Fix rationale

Added the same three-step pattern every other input in this function already uses: validate with
`isFin`, push `"contracts"` onto `missing` when invalid, and gate every dependent output
(`greekRisk.*` via `scale()`, `dollarRisk`, `betaWeightedDelta`) on the validity flag so each falls
through to `null` instead of computing against a silently-zeroed `qty`. `contractMultiplier`'s
existing `?? 100` default was deliberately left untouched — that field's own doc comment
("Shares per contract; defaults to 100") documents 100 as the correct real-world default for a
standard equity option, not a fabricated placeholder, so it isn't the same class of defect.

### Tests

Added `"invalid contracts (e.g. a malformed DB row) → partial + null every scaled field, never a
fabricated 0"` to `swing-risk.test.ts`. RED→GREEN confirmed: reverting only the source fix (keeping
the new test) fails 1/8 exactly as expected; reapplying passes 8/8. Full scoped run
(`swing-risk.test.ts`) 8/8 pass; `npx tsc --noEmit` clean; full `npm test` (Node 20) run alongside
this PR.
