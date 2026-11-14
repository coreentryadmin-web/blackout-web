> **kind:** FINDING

| Field | Value |
| --- | --- |
| **Title** | `summarizeGroupGreekFlow` headline could assert "supportive"/"opposing" directly beside a dissenting, sign-conflicting delta figure |
| **Status** | FIXED |
| **Area** | `src/lib/group-greek-flow-summary.ts` (Largo `get_group_greek_flow` tool, SPX desk `mag7_greek_flow`, Night Hawk market-wide `mag7_greek_flow`) |
| **Severity** | P3 (narrative/display correctness — no gate, score, or trading decision reads this field) |

## What broke

`summarizeGroupGreekFlow`'s one-line `bias`/`headline` summary feeds the SPX desk's
`mag7_greek_flow`, Night Hawk's market-wide `mag7_greek_flow`, and Largo's
`get_group_greek_flow` tool (`run-tool.ts`). `bias` is decided by **either** signal alone —
`netDelta > 50_000 || (netGammaResult != null && netGammaResult > 0)` → `"supportive"`, and the
mirror for `"opposing"` — so gamma can decide the bias even while delta's own value sits on the
*other* side of zero. The headline, however, unconditionally quoted the raw delta figure next to
that label with no qualification:

```ts
const headline =
  bias === "supportive"
    ? `${groupLabel} dealer ${gammaWord} supportive — net ${deltaM} delta`
    : ...
```

Whenever gamma (not delta) decided the bias and delta's sign disagreed, this produced a literally
self-contradictory sentence: the label says one direction, the number right next to it reads the
opposite. Live-reproducible with fixture input (pure function, no DB):

```
net_delta=-45_000, net_gamma=+80_000
  bias: "supportive"
  headline: "semis dealer gamma supportive — net -45K delta"   <- "supportive" next to an explicit "-45K"

net_delta=+45_000, net_gamma=-80_000
  bias: "opposing"
  headline: "semis dealer gamma opposing — net 45K delta"      <- "opposing" next to an unsigned positive figure
```

The only caller observed hard-coding `group="mag7"` (`spx-desk.ts`, `market-wide.ts`) is immune in
practice — UW's `/api/group-flow/mag7/greek-flow` never carries a gamma field at all (confirmed
live 2026-08-29/09-02, see this file's own `numPresent` doc comment), so `netGammaResult` is
always `null` for that one group and `bias` is delta-only there. But `run-tool.ts`'s
`get_group_greek_flow` Largo tool calls this with an **arbitrary, model-supplied** `group` (any UW
group-flow cohort, e.g. a sector group), and other groups are not confirmed gamma-free — so the
contradictory-headline path is live-reachable through that tool, not merely theoretical.

This is exactly the failure mode `docs/audit/LARGO-PRODUCT-CONTRACT.md`'s own rule exists to
prevent: *"Cross-product disagreement is represented, never reconciled by the lanes themselves...
A lane that quietly adjusts its numbers to match a peer has destroyed the signal and left a false
consensus."* Printing the dissenting delta number as if it agreed with the gamma-driven label
does exactly that — it hides a real disagreement inside a sentence that reads as agreement,
rather than disclosing it.

## Fix

Detect when the quoted delta figure's own sign contradicts the stated bias (only possible when
gamma, not delta, decided it) and disclose the disagreement explicitly instead of presenting the
two signals as if they agreed:

```ts
const deltaDisagrees =
  netGammaResult != null &&
  ((bias === "supportive" && netDelta < 0) || (bias === "opposing" && netDelta > 0));
const deltaClause = deltaDisagrees ? `delta flow disagrees (net ${deltaM})` : `net ${deltaM} delta`;
```

`headline` now reads `"semis dealer gamma supportive — delta flow disagrees (net -45K)"` instead
of the contradictory `"...supportive — net -45K delta"`. When delta and gamma agree (the ordinary
case, and the only case reachable for `mag7`), the clause is unchanged (`"net ${deltaM} delta"`) —
no behavior change for the one confirmed live call site.

**Fix rationale / what was deliberately left unchanged**: the `bias`-decision logic itself (the
OR-across-both-signals rule) was NOT touched — changing which signal wins when they disagree is a
genuine design/weighting question, not a formatting bug, and outside this fix's scope. Only the
*text* that was asserting false agreement is corrected, per the "represent, never reconcile"
contract rule.

## Evidence (RED before fix, GREEN after)

Added to `src/lib/group-greek-flow-summary.test.ts`:
- `summarizeGroupGreekFlow headline discloses it when GAMMA decides 'supportive' but delta
  disagrees (negative)`
- `summarizeGroupGreekFlow headline discloses it when GAMMA decides 'opposing' but delta
  disagrees (positive)`
- `summarizeGroupGreekFlow headline stays a plain 'net X delta' clause when gamma and delta agree`
  (no-regression guard for the one confirmed live call site, `mag7`)

Proven via `git stash` isolation on the source file only (tests kept):
- **RED** (pre-fix `group-greek-flow-summary.ts`): 2 failing — `expected the headline to
  disclose the delta/gamma disagreement, got: semis dealer gamma opposing — net 45K delta` (and
  the mirror case).
- **GREEN** (post-fix): 14/14 pass.

Full file: `npx tsx --experimental-test-module-mocks --test src/lib/group-greek-flow-summary.test.ts`
→ `# pass 14 / # fail 0`.

## Blast radius

One function, one call site inside it (`headline` construction) — `bias`, `net_delta`,
`net_gamma`, `call_delta`, `put_delta` are all unchanged; only the `headline` string's wording
changes, and only in the disagreement case. Consumers read `headline` as free text (SPX desk /
Night Hawk market-wide payloads, Largo tool-use context) — none pattern-match on its exact
substring, confirmed by grep across `run-tool.ts`, `market-wide.ts`, `format.ts`, `spx-desk.ts`.
No gate, score, or commit decision reads this field.

## Verify

`npx tsx --experimental-test-module-mocks --test src/lib/group-greek-flow-summary.test.ts`
