> **kind:** FINDING

# Night Hawk (Legacy/overnight scorer): congressional-trade decay measures the wrong date

| | |
|---|---|
| **Status** | FIXED |
| **Surface** | Night Hawk overnight-digest scorer (`scoreSmartMoney`/`congressTradeDecayMultiplier`, shared by Legacy's `edition-builder.ts`/`hunt-builder.ts` pipeline) |
| **Severity** | P2 — silent, real weighting error on live smart-money scoring; no crash, no visible symptom |

## Root cause

`congressTradeDecayMultiplier` (`src/features/nighthawk/lib/scorer.ts`) decays a congressional
trade's scoring weight by how recent it is, with its own docstring stating the intent plainly:

> Recency decay for congressional trades — **more recent disclosures** carry more signal.

But its field fallback chain never included the field that actually holds the disclosure date:

```ts
const raw =
  row.filed_at ??
  row.filed_date ??
  row.transaction_date ??   // <-- always matches first on real data, wrong semantics
  row.transactionDate ??
  row.disclosure_date ??
  row.date ??
  row.created_at;
```

Live-pulled the real UW `/api/congress/recent-trades` payload (the endpoint both
`fetchUwCongressTrades` and `fetchUwCongressUnusualTrades` read — confirmed in
`unusual-whales.ts`'s own comment: "recent-trades is the plan-included feed with the same row
shape") before touching any code:

```json
{
  "name": "Gilbert Cisneros", "ticker": "DASH", "txn_type": "Sell",
  "transaction_date": "2026-08-28", "filed_at_date": "2026-09-11", ...
}
```

The real disclosure-date field is `filed_at_date` — not `filed_at`, not `filed_date`. Since
neither guessed name ever matches, the chain always fell through to `transaction_date`, which
DOES exist on every row and so always wins by default. That silently measures the age of the
**trade itself**, not the age of its **public disclosure** — the opposite of the function's stated
purpose. Congress members can legally disclose up to 45 days after a transaction (STOCK Act) and
routinely file close to that deadline, so `transaction_date` and `filed_at_date` differ by weeks on
real rows: the DASH row above is 15 days old by transaction date (0.4x decay) but only 1 day old by
filing date (1.0x decay) — a 2.5x scoring difference on a disclosure that, in the sense this
function claims to measure, is brand new.

**Why it wasn't caught earlier:** the existing unit tests in `scorer-direction.test.ts` build
congress fixtures using `filed_at` (e.g. `{ txn_type: "Buy", filed_at: fresh }`) — matching the
function's own guessed (wrong) field name, not the real UW API shape — so they validated internal
self-consistency, never reality. This is the same failure shape as the OI-change bug fixed earlier
this session (#4839): the scorer's assumption about an upstream field name was never checked
against the live API, and the tests inherited the same wrong assumption instead of catching it.

## Blast radius

`congressTradeDecayMultiplier` has exactly one caller, `scoreSmartMoney` (`scorer.ts`), Night
Hawk's shared smart-money scoring function used by both Legacy's overnight digest and
`edition-builder.ts`. `smartMoneyDriverNote` (`deterministic-edition.ts`, shipped this session as
part of #4827) reads the same congress rows for narrative purposes but only checks `txn_type`
presence/side, not recency, so it is unaffected by this specific bug. Single-surface fix.

## Fix

- `scorer.ts`: added `row.filed_at_date` as the first-checked field in
  `congressTradeDecayMultiplier`'s fallback chain (kept every existing fallback name afterward,
  unchanged, in case of a future/alternate upstream shape).
- `scorer-direction.test.ts`: added a regression test proving the real shape (old
  `transaction_date`, fresh `filed_at_date`) now decays on the filing date, plus a mirror
  assertion that a row with only `transaction_date` (no `filed_at_date` at all) still falls back
  correctly rather than silently scoring 0.

## Why this fix, not an alternative

Considered replacing `transaction_date` entirely with `filed_at_date` semantics throughout, but
`transaction_date` genuinely IS the correct field for `congressSideWeight`'s buy/sell direction
read (transaction side, not filing side) — unaffected by this bug, since that function reads
`txn_type`, not a date. Only the decay function's date choice was wrong, so only its fallback
chain changed.

## Evidence

- Live-pulled real UW congress data confirming `filed_at_date` is the actual field name and
  differs materially from `transaction_date` on the same row.
- RED: stashed the `scorer.ts` fix, ran `scorer-direction.test.ts` — 1 failure.
- GREEN: restored the fix — 69/69 pass.
- `npx tsc --noEmit`: clean.
- Full suite (`npm test`, Node 20): 13830 pass / 0 fail / 3 skipped.

## What was deliberately left unchanged

`congressSideWeight` (buy/sell direction) is untouched — it reads `txn_type`, which already
matches the real UW field exactly, confirmed against the same live pull. Only the decay-by-date
path was affected.
