> **kind:** FINDING

# Night Hawk (Legacy/overnight scorer): institutional-flow smart-money leg was entirely dead code

| | |
|---|---|
| **Status** | FIXED |
| **Surface** | Night Hawk overnight-digest scorer (`scoreSmartMoney`/`institutionalNetSignal` in `scorer.ts`, and `smartMoneyDriverNote` in `deterministic-edition.ts`) |
| **Severity** | P2 — an entire scoring signal was permanently inert on real data; no crash, no visible symptom |

## Root cause

`institutionalNetSignal` (`src/features/nighthawk/lib/scorer.ts`) is supposed to read a ticker's
institutional-ownership rows and return net buying (+1), net selling (-1), or unknown/flat (0),
feeding `scoreSmartMoney`'s +3/-2 institutional bonus. Its field-guessing logic:

```ts
const change = Number(
  row.change ?? row.shares_change ?? row.units_change ?? row.change_in_shares ?? row.net_change ?? NaN
);
if (Number.isFinite(change) && change !== 0) { net += change; continue; }
const action = String(row.action ?? row.transaction_type ?? row.type ?? "").toLowerCase();
if (/buy|added|increase|new|accumul/.test(action)) net += 1;
else if (/sell|reduced|decrease|trim|liquidat/.test(action)) net -= 1;
```

Live-pulled the real UW `/api/institution/{ticker}/ownership` payload (the endpoint
`fetchUwInstitutionOwnership` reads) before touching any code:

```json
{
  "name": "BLACKROCK, INC.", "units": "1162996939", "units_changed": "18301514",
  "filing_date": "2026-08-07", "report_date": "2026-06-30", "historical_units": [...], ...
}
```

The real per-filing share-delta field is `units_changed` (trailing "d") — not `units_change`, not
`change`, not any other guessed name. **Neither branch of the fallback logic ever matched real
data**: the numeric branch never found a matching field (always `NaN`), and the string branch's
`action`/`transaction_type`/`type` fields don't exist at all on a 13F ownership snapshot (these
rows describe *positions*, not *transactions* — there is no verb field to regex-match). Every real
`institutional_activity` row therefore contributed `net += 0`, meaning `institutionalNetSignal`
always returned `0` regardless of real institutional accumulation or distribution — the entire
institutional leg of `scoreSmartMoney`'s bonus (+3 aligned / -2 contradicting) was **permanent dead
code in production**, more complete a failure than the OI-change and congress-decay bugs fixed
earlier this session (those under- or mis-weighted; this one never fired at all).

`smartMoneyDriverNote` (`deterministic-edition.ts`, shipped this session as #4827) has the
identical field-guessing bug in its own `instHit` presence check — same wrong fallback chain,
same silent failure, so the narrative "institutional accumulation/distribution flagged" text could
never legitimately fire off a numeric field either (only ever via a fixture-style row carrying a
literal `action` string, which real UW data doesn't produce).

**Why it wasn't caught earlier:** the existing `scoreSmartMoney` unit test builds its institutional
fixture as `[{ action: "buy", change: 500_000 }, { action: "added", change: 250_000 }]` — using
the scorer's own two independently-wrong guessed field names (`action` AND `change`), so it passed
by construction without ever exercising the real UW shape. Same failure pattern as the other two
bugs fixed this session (#4839 OI-change, #4844 congress-decay).

## Blast radius

`institutionalNetSignal` has exactly one caller, `scoreSmartMoney` (`scorer.ts`) — Night Hawk's
shared smart-money scoring used by both Legacy's overnight digest and `edition-builder.ts`.
`smartMoneyDriverNote`'s `instHit` check (`deterministic-edition.ts`) is a second, independent
instance of the same bug, fixed alongside it to keep the narrative's presence check honest.

## Fix

- `scorer.ts`: added `row.units_changed` as the first-checked field in `institutionalNetSignal`'s
  numeric fallback chain (every existing fallback kept afterward, unchanged).
- `deterministic-edition.ts`: identical fix to `smartMoneyDriverNote`'s `instHit` numeric check.
- `scorer-direction.test.ts`: added a regression test using the real UW shape (buying and selling
  cases) proving `scoreSmartMoney` now scores institutional flow correctly.
- `deterministic-edition.test.ts`: added a regression test proving the narrative note fires off
  the real `units_changed` field, not just a fixture-only `action` string.

## Why this fix, not an alternative

Considered normalizing `fetchUwInstitutionOwnership`'s return shape at the source instead of
patching every consumer's fallback chain, but that function is a thin pass-through
(`extractRows(data).slice(...)`) shared with nothing else that would benefit from renaming, and
the existing fallback-chain pattern is how every other scorer in this file already handles
uncertain upstream shapes — adding the real field name to the chain is consistent with that
convention and the smallest change that fixes both call sites.

## Evidence

- Live-pulled real UW institution-ownership data confirming `units_changed` is the actual field
  and that no `action`/`transaction_type`/`type` field exists on real rows at all.
- Live proof script: `scoreSmartMoney` scored `0`/`0` (long/short) against real-shaped buying data
  before the fix, `3`/`-2` after.
- RED: stashed both fixed files, ran `scorer-direction.test.ts` + `deterministic-edition.test.ts`
  — 2 failures.
- GREEN: restored the fix — 125/125 pass.
- `npx tsc --noEmit`: clean.
- Full suite (`npm test`, Node 20): 13845 pass / 0 fail / 3 skipped.

## What was deliberately left unchanged

The string-fallback branch (`action`/`transaction_type`/`type`) in both functions is kept as-is —
it costs nothing to leave in place for a hypothetical future/alternate institutional-activity
source that reports transactions rather than 13F position snapshots, and removing it would be
unrelated scope creep on a fix that only needed the missing real field added.
