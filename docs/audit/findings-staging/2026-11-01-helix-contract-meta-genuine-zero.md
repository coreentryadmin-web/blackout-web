> **kind:** FINDING

## Helix contract drilldown: `parseContractMeta` coerces genuine zero `open_interest`/`day_volume` (and `underlying_price`/`delta`) to `null`, silently hiding the stat — FIXED

**Status:** Fixed, regression tests added (`src/lib/helix/contract-drilldown-parse.test.ts`).

### Root cause

`parseContractMeta` (`src/lib/helix/contract-drilldown-parse.ts`) built each field as
`num(r.open_interest) || null` / `num(r.volume) || null` / `num(r.underlying_price) || null` /
`num(r.delta) || null`. The file's own `num()` helper returns `0` — never `null` — for both a
genuinely-zero input AND a missing/unparseable one:

```ts
function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
```

`||` cannot distinguish "num() returned 0 because the real value is 0" from "num() returned 0
because the field was absent" — both fall through to `null`. A brand-new, never-yet-traded
option contract genuinely has `open_interest: 0` (confirmed to occur on real live UW rows:
`docs/audit/FINDINGS.md`'s 2026-08-23 measurement found 12/1500 sampled flow rows with
`OI === 0`), and early in a session a contract's `day_volume` can also legitimately be `0`. In
both cases the real `0` was silently turned into `null`.

Downstream, `src/features/helix/components/ContractDrilldownDrawer.tsx` gates rendering of the
"Open interest" / "Day volume" stat chips on `meta?.open_interest != null` /
`meta?.day_volume != null`, so for a contract that genuinely has zero open interest or zero
volume so far, the stat line simply vanished from the drawer instead of showing "0" — itself
meaningful information ("nobody has traded this yet"), indistinguishable in the UI from "we
don't know."

### Evidence

- Read the current source directly (not just the audit description) and confirmed the exact
  `num(r.open_interest) || null` / `num(r.volume) || null` pattern at lines 82-83 (plus the
  same pattern on `underlying_price`/`delta` at lines 84/86), and confirmed the drawer's
  `!= null` gate at `ContractDrilldownDrawer.tsx` lines ~369/375.
- **RED (pre-fix):** added `src/lib/helix/contract-drilldown-parse.test.ts` test
  `"parseContractMeta preserves a genuine zero open_interest/day_volume instead of nulling
  it"` — failed against the unmodified source: `Expected values to be strictly equal: null !==
  0`.
- **GREEN (post-fix):** same test passes; full file suite 6/6 pass
  (`npx tsx --experimental-test-module-mocks --test
  src/lib/helix/contract-drilldown-parse.test.ts`).
- A second new test, `"parseContractMeta reports null (not a fabricated 0) when there is no
  flow data at all"`, passed both BEFORE and AFTER the fix — confirming the fix does not
  overcorrect into treating a genuinely-missing row (`rows.length === 0`, the real shape
  `option-contract/route.ts` passes when `flow` isn't an array) as a fabricated `0`.
- `npx tsc --noEmit` clean on the whole project after the fix.

### Blast radius

Only consumer: `GET /api/market/option-contract` (`src/app/api/market/option-contract/route.ts`)
calls `parseContractMeta(flowRows)` once and serves `contract_meta` verbatim; the only reader of
`contract_meta` is `ContractDrilldownDrawer.tsx`'s stat-chip row. `underlying_price`/`delta`
share the exact same `|| null` pattern and get the same fix for consistency, even though a
genuine exact `0` is far less likely for either in practice (as the original audit description
also noted) — the practical blast radius remains concentrated in `open_interest`/`day_volume`.
`parseContractFills`/`parseContractIntraday`/`volumeProfileBidAskPct` in the same file use `num()`
for SUMS (missing contributing `0` to a total is correct there) and are deliberately untouched.

### Fix rationale

The literal fix suggested by the audit — dropping `|| null` and returning `num(r.open_interest)`
directly, on the premise that `num()` "already returns null for missing/invalid input" — does
**not** hold: `num()` returns `0`, not `null`, on missing input (see the reproduced source
above). Applying that literal suggestion would have fixed the genuine-zero case but silently
introduced the opposite bug: `rows.length === 0` (no flow data at all — the real shape when a
contract has no fills, handled explicitly in the route as `Array.isArray(flow) ? flow : []`)
would then report a fabricated `0` instead of the honest `null`, since `r = (rows[0] ?? {})` and
every field access on `{}` is `undefined`, which `num()` already collapses to `0`.

Instead added `numOrNull()`, a sibling of `num()` that checks for `undefined`/`null` **before**
calling `Number()`, so it can tell "absent" and "zero" apart at the one place that distinction
actually needs to survive into the returned shape. `parseContractMeta` now calls `numOrNull()`
for `open_interest`/`day_volume`/`underlying_price`/`delta` instead of `num() || null`. This
preserves both halves of the contract: a real `0` passes through as `0`, and a genuinely absent
row/field still resolves to `null` — verified by both new tests, which the literal `num()`
single-line fix could not have satisfied simultaneously.

### Deliberately left unchanged

- `num()` itself — still used by `parseContractFills`/`parseContractIntraday` for sums, where
  collapsing "missing" to `0` is the correct, intended behavior.
- `iv`'s existing `iv > 0 ? ... : null` branch — already correctly treats `0`/absent IV as
  "unknown" (a `0%` implied volatility is not a meaningful real-world value the way a `0`
  open-interest/volume genuinely is), so it is out of scope for this fix.
- `ContractDrilldownDrawer.tsx`'s `!= null` gates — correct as written; they already do the
  right thing once `meta.open_interest`/`meta.day_volume` carry real `0`s instead of fabricated
  `null`s.
