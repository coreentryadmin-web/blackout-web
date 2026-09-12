> **kind:** FINDING

# Night Hawk dossier's "Flow by expiry" narrative line always printed $0

| | |
|---|---|
| **Status** | FIXED |
| **Surface** | `formatTickerDossierText` (`src/features/nighthawk/lib/format.ts`) — the per-ticker dossier text fed into the Legacy edition's Claude prompt (`buildClaudePrompt`) |
| **Severity** | P2 — a narrative line always showed $0 regardless of real flow; no crash, no visible symptom outside the AI-facing prompt text |

## Root cause

The "Flow by expiry" line computed premium as:

```ts
const prem = Number(r.premium ?? r.total_premium ?? 0);
```

Live-pulled the real `/api/stock/{ticker}/flow-per-expiry` payload (the endpoint
`fetchUwFlowPerExpiry` reads) before touching any code:

```json
{
  "date": "2026-09-11", "ticker": "AAPL", "expiry": "2026-09-14",
  "call_premium": "47977407.00", "put_premium": "23757826.00",
  "call_volume": 201729, "put_volume": 175083, ...
}
```

There is no `premium` or `total_premium` field on this row shape at all — only separate
`call_premium`/`put_premium` strings. Both guessed field names were dead code, so `prem` was
`0` on every real row, and every "Flow by expiry: <date>: $0" line in the dossier text was
printed regardless of how much real premium traded that expiry (in the sample above, ~$72M
combined). This text is not member-facing UI, but it IS fed directly into the Legacy overnight
edition's Claude prompt — a false "$0 flow" signal in the prompt is worse than omitting the line
entirely, since it reads as a measured absence rather than a broken field.

## Blast radius

Checked every other consumer of `flow_by_expiry`/`fetchUwFlowPerExpiry` for the same guess:
`dossier.ts` just stores the raw rows (no field extraction), the SPX desk (`spx-desk.ts`) and
Largo's `get_flow_per_expiry`-style tool (`run-tool.ts`) both pass the raw rows through
untransformed, and `meridian-event-brief.ts`'s `net_flow_by_expiry` consumer (a *different* UW
endpoint/shape) already correctly checks `call_premium`/`put_premium` as its fallback — confirming
those are the real field names and this `format.ts` call site was the outlier. `format.ts` itself
has a second, unrelated `r.total_premium ?? r.premium` read for `dossier.flows` (a different data
source, UW flow-alerts, already audited/correct in a prior session) — left untouched.

## Fix

Extracted the computation into an exported, directly-testable `flowByExpiryPremium(row)` helper:
sums the real `call_premium`/`put_premium` fields first, falling back to the old guessed
`premium`/`total_premium` names only if that sum is falsy (harmless no-op today, kept for
defense against a future upstream shape that might use the singular field). Added 3 regression
tests in `format.test.ts` using the real row shape.

## Why this fix, not an alternative

Considered fixing this inline without extracting a helper, but `formatTickerDossierText` takes a
full `TickerDossier` + `ScoredCandidate` (dozens of required fields) as input — testing the fix
directly would need a heavy fixture for a one-line computation. Extracting the pure premium
calculation into its own exported function is the smallest change that makes the fix testable in
isolation, consistent with the "test the pure logic" pattern already used elsewhere in this
session's fixes.

## Evidence

- Live UW pull of `/api/stock/AAPL/flow-per-expiry` confirming the real row shape (no `premium`/
  `total_premium` field; `call_premium`/`put_premium` present).
- Cross-checked `meridian-event-brief.ts`'s independent `net_flow_by_expiry` consumer, which
  already correctly falls back to `call_premium`/`put_premium` — corroborating these are the real
  field names, not a one-off observation.
- RED: stashed the fix, ran `format.test.ts` — `flowByExpiryPremium is not a function` (3 new
  tests fail on import).
- GREEN: restored the fix — 7/7 pass.
- `npx tsc --noEmit`: clean.
- Full suite (`npm test`, Node 20): 13925 pass / 0 fail / 3 skipped.

## What was deliberately left unchanged

`dossier.flows.reduce((s, f) => s + Number(f.total_premium ?? f.premium ?? 0), 0)` a few lines
above this fix (the "Flow today" line, a different data source — UW flow-alerts, not
flow-per-expiry) is untouched; per prior-session notes that field/source was already audited and
is correct for its own shape.
