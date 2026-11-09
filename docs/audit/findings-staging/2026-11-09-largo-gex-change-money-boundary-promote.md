> **kind:** FINDING

## Largo's `formatGexChange()` / `system-reads.ts`'s `money()` round past the K/M and M/B boundary without promoting the unit — FIXED

**Status** | FIXED (PR, see below)

### Root cause

Both `src/lib/largo/core/gex-shift-extract.ts`'s `formatGexChange()` (the GEX-matrix-change
renderer feeding `LargoDeskRead.tsx` and `BieGexShiftsPanel.tsx`) and `src/lib/largo/core/
system-reads.ts`'s local `money()` helper (feeding `helixFlowRead()`'s `basis` string, part of
the Ask Largo cross-product stance strip) are **byte-identical duplicates** of the same tiered
money formatter, and both carry the exact "round-first-then-promote" bug this repo has already
fixed ~22 other times (`fmt-money.ts`, `helix-tide-money-format.ts`, `thermal-compact-matrix.ts`,
etc. — see CLAUDE.md's "Round-first-then-promote money-formatter vein"):

```ts
function money(n: number): string {
  const sign = n < 0 ? "−" : "+";
  const a = Math.abs(n);
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(1)}M`;   // <- picks M before rounding
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(0)}K`;   // <- picks K before rounding
  return `${sign}$${a.toFixed(0)}`;
}
```

The tier is selected from the **raw** value, then that tier's own `toFixed` can round the
mantissa up to 1000 — at which point the function has already committed to the wrong unit label
and never re-checks:

- `n = 999_500`: `999_500 < 1e6`, so the K branch is taken. `(999_500 / 1e3).toFixed(0)` is
  `"1000"`, rendering `"+$1000K"` instead of the correct `"+$1.0M"`.
- `n = 999_950_000`: `999_950_000 < 1e9`, so the M branch is taken. `(999_950_000 /
  1e6).toFixed(1)` is `"1000.0"`, rendering the nonsensical `"+$1000.0M"` instead of the correct
  `"+$1.0B"`.

### Why it wasn't caught earlier

Every unit test that previously exercised these two functions used round, mid-tier values
(`-177_800_000`, `310_900_000`, `-30e6`/`40e6`, etc.) — none within ~0.1% of a tier boundary, so
the rounding-promotion gap was never exercised. The duplication itself (the identical helper
copy-pasted into a second file rather than imported from `fmt-money.ts`, which already has the
correct logic) is also why the earlier ~22-instance sweep of this exact vein never reached these
two: neither file matched the earlier greps' naming conventions as closely, and `system-reads.ts`'s
copy is a private, unexported `function money(...)`, invisible from any call-site grep for the
name `money` elsewhere in the app.

### Blast radius

Both files are display-only (no trading decision logic, no tool-dispatch): `formatGexChange()`
renders the GEX-matrix change table for `LargoDeskRead.tsx` (Ask Largo's own structured-answer
panel) and `BieGexShiftsPanel.tsx`; `money()` renders the HELIX row's `basis` string inside the
Ask Largo cross-product "stance strip" (`agreementOf`/`helixFlowRead`). Both are reachable with
unrestricted real dollar-gamma / dollar-premium values (no floor gates the input the way
`vector-pulse.ts`'s and `spx-pulse.ts`'s sibling `fmtPremium()` helpers do — those two were
checked during this round and found to be dead-code-protected: both are only ever called with
values already `>= $1,000,000`, so their own K-branch boundary bug is structurally unreachable
and was correctly left untouched).

### Fix rationale

Applied the same "round first, then re-check the next threshold, then format" pattern already
shipped in `fmt-money.ts` to both functions, independently (each file stays self-contained per
its own "no UI dependency" / "no IO" module comments — not consolidated into one shared import,
which would be a larger refactor than this fix warrants). Values strictly below the rounded
boundary (e.g. `999_400`, `999_940_000`) are asserted to still render in their original unit, so
the fix cannot be "always promote" — it must genuinely depend on the rounded mantissa.

### Evidence

`src/lib/largo/core/gex-shift-extract.test.ts` and `src/lib/largo/core/system-reads.test.ts` each
gained a boundary-case regression test. Confirmed RED pre-fix (`git stash` the two source files,
re-run — 2 failures, exactly the 2 new assertions) and GREEN post-fix (22/22 passing in both
files together). `npx tsc --noEmit` clean.
