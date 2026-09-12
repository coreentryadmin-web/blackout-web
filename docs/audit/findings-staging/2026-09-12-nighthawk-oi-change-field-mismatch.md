> **kind:** FINDING

# Night Hawk (Legacy/overnight scorer): OI-change alignment bonus dead-coded by a field-name mismatch

| | |
|---|---|
| **Status** | FIXED |
| **Surface** | Night Hawk overnight-digest scorer (`scoreOptionsPositioning`, shared by Legacy's `edition-builder.ts`/`hunt-builder.ts` pipeline) |
| **Severity** | P2 — silent, permanent loss of one real scoring signal; no crash, no visible symptom |

## Root cause

`scoreOptionsPositioning` (`src/features/nighthawk/lib/scorer.ts`) computes a +2 bonus when a
ticker's open-interest change is aligned with the candidate's direction (rising call OI backs a
long, rising put OI backs a short):

```ts
const alignedOi = oi.filter((r) => {
  const grew = (r.oi_change ?? 0) > 0;
  if (!grew) return false;
  const t = (r.option_type ?? "").toLowerCase();   // <-- wrong field
  return direction === "long" ? t.startsWith("c") : t.startsWith("p");
});
if (alignedOi.length >= 2) score += 2;
```

It reads `r.option_type`. But the real data source, `fetchUwOiChange` (`src/lib/providers/
unusual-whales.ts:1497-1515`), returns `OiChangeItem[]` shaped `{strike, oi_change, kind}` — the
option side lives in `kind`, and `option_type` does not exist on this type at all:

```ts
export type OiChangeItem = { strike: number; oi_change: number; kind: string };
export async function fetchUwOiChange(ticker = "SPX"): Promise<OiChangeItem[]> {
  const data = await uwGetSafe<unknown>(`/api/stock/${safeTicker(ticker)}/oi-change`, {});
  return extractRows(data)
    .map((r) => ({
      strike: Number(r.strike ?? 0),
      oi_change: Number(r.oi_change ?? r.change ?? r.diff ?? 0),
      kind: String(r.type ?? r.option_type ?? "unknown").toLowerCase(),
    }))
    ...
}
```

`TickerDossier.oi_change` (`dossier.ts:61`) is typed directly off this return type, and
`dossier.ts:475` passes it straight into `scoreCandidate`'s `dossierExtras.oi_change` with no
mapping step. So in production, `r.option_type` is always `undefined` on every row, `t` is always
`""`, `t.startsWith("c")`/`t.startsWith("p")` are both always `false`, and `alignedOi` is *always*
empty — the +2 bonus has never fired against real data, regardless of how strongly OI change
actually agreed with the play's direction.

**Why it wasn't caught earlier:** `scoreOptionsPositioning`'s own inline parameter type declared
`oi_change?: Array<{ oi_change?: number; option_type?: string }>` — i.e. the type signature itself
encoded the same wrong field name as the implementation, so TypeScript never flagged the mismatch
against the real `OiChangeItem` shape (structural typing let a `{strike, oi_change, kind}` object
satisfy the looser `{oi_change?, option_type?}` shape, since both fields are optional). And every
existing unit test in `scorer-direction.test.ts` hand-built its OI-change fixtures using
`option_type` (matching the scorer's mistaken assumption, not the real API), so the tests
validated internal self-consistency, never reality. Live-proved this in the sandbox with the exact
`fetchUwOiChange` field shape (`kind`, not `option_type`) before touching any code:

```
$ node script feeding {strike, oi_change, kind} rows into scoreOptionsPositioning({oi_change}, "long")
Score with REAL oi_change shape (kind field): 0 -- expected 2 if OI alignment bonus works
```

## Blast radius

`scoreOptionsPositioning` is called from exactly one place, `scoreCandidate` (`scorer.ts:1003`),
which is Night Hawk's single shared scoring entrypoint used by both `hunt-builder.ts` (Legacy's
overnight digest) and `edition-builder.ts`. No other lane or desk reads `OiChangeItem`/`oi_change`
through this path — the `market_oi_change` field elsewhere in `market-wide.ts` is an unrelated,
differently-shaped market-wide rollup, not this per-ticker positioning input. So the fix is
single-surface: it only changes Legacy/overnight scoring, and only adds signal it was always
supposed to have — no other consumer depends on the OI bonus staying silent.

## Fix

- `src/features/nighthawk/lib/scorer.ts`: changed both inline `oi_change` parameter type
  declarations (`scoreOptionsPositioning`'s own param, and `scoreCandidate`'s `dossierExtras`) from
  `{ oi_change?: number; option_type?: string }` to `{ oi_change?: number; kind?: string }`, and the
  filter body from `r.option_type` to `r.kind`.
- `src/features/nighthawk/lib/scorer-direction.test.ts`: updated the four existing OI-change
  fixtures that used the wrong field name (`option_type`) to the real one (`kind`), and added a new
  regression test asserting BOTH directions — the real `kind`-shaped data scores the +2 bonus, and
  a row carrying only the old, wrong field name does NOT score it. This is the test that would have
  caught the original bug: a fixture matching the real upstream API shape, not the scorer's own
  (mistaken) assumption about it.

## Why this fix, not an alternative

The alternative — leaving `scoreOptionsPositioning` accept either field name (`r.kind ?? r.option_type`)
— was considered and rejected: `option_type` never appears on real `OiChangeItem` rows, so
supporting it would just be dead code left in place for a shape nothing produces, obscuring that
`kind` is the only real field. Renaming cleanly matches the type to reality.

## Evidence

- RED: stashed the `scorer.ts` fix, ran `scorer-direction.test.ts` — 2 failures (the new
  kind-vs-option_type regression test, and the updated capped-at-18 fixture which now correctly
  requires the OI bonus to contribute before the cap is meaningful).
- GREEN: restored the fix — 68/68 pass in `scorer-direction.test.ts`.
- `npx tsc --noEmit`: clean.
- Full suite (`npm test`, Node 20): 13829 pass / 0 fail / 3 skipped.

## What was deliberately left unchanged

Did not touch `stack()`'s `option_type` field in the same test file (used for `FlowStrikeStack`
fixtures) — that type genuinely carries `option_type` (confirmed against `stackAlignsWithDirection`
in `scorer.ts`, which reads `stack.option_type`), a completely separate data shape from
`OiChangeItem`. Only the OI-change path was affected by this bug.
