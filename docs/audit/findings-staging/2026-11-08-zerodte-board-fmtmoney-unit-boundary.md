> **kind:** FINDING

## Night Hawk 0DTE Command board's `fmtMoney` never promotes K to M when rounding crosses $1M — FIXED

| | |
|---|---|
| **Area** | Night Hawk 0DTE Command board UI (`src/features/nighthawk/components/ZeroDteBoard.tsx`) |
| **Status** | FIXED |
| **Files** | `src/features/nighthawk/components/zerodte-board-format.ts` (new), `.test.ts` (new), `src/features/nighthawk/components/ZeroDteBoard.tsx` |

### Root cause

`ZeroDteBoard.tsx` defined its own local `fmtMoney(n)` helper (present, byte-for-byte, since the
file's original migration commit — never touched since):

```ts
function fmtMoney(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}
```

The K branch divides by 1,000 and rounds with `toFixed(0)` with **no check for whether the
rounded quotient itself reaches 1000** — exactly the "K→M unit-boundary rounding" bug class this
repo has already fixed in 16+ sibling formatters (`src/lib/fmt-money.ts`'s `fmtPremium`,
`thermal-compact-matrix.ts`, `helix-tide-money-format.ts`, `darkpool-discord-format.ts`'s
`fmtShares`, etc. — `fmt-money.ts`'s own doc comment calls out the identical case by name:
"999_700 must read $1.0M, never $1000K"). A value just under the $1,000,000 cutoff — e.g.
999,600, a realistic `gross_premium`/`recent_premium_30m` aggregate for the 0DTE Command board's
flow strip — never reaches the `abs >= 1_000_000` branch, falls into the K branch, and renders as
the four-digit, wrong-unit `"$1000K"` instead of promoting to `"$1.0M"`.

This function was written as its own standalone copy in `ZeroDteBoard.tsx` rather than importing
the already-fixed shared helper (`fmtPremium` in `src/lib/fmt-money.ts`, which every sibling
Night Hawk formatting module — e.g. `src/features/nighthawk/lib/format.ts` — already uses), so it
silently carried the exact bug class every other formatter in this family was already swept and
fixed for this session.

### Evidence

New regression test `zerodte-board-format.test.ts`, RED→GREEN proven locally:
- **RED** (pre-fix body, verified by temporarily restoring the original function): `fmtMoney(999_600)` → `"$1000K"` and `fmtMoney(-999_600)` → `"$-1000K"` — both fail the test's `"$1.0M"`/`"$-1.0M"` assertions.
- **GREEN** (fixed body): `fmtMoney(999_600)` → `"$1.0M"`, `fmtMoney(999_950)` → `"$1.0M"`, `fmtMoney(1_000_000)` → `"$1.0M"` (boundary unaffected), ordinary magnitudes (`$500`, `$2K`, `$840K`, `$2.3M`) and null/NaN/Infinity (`"—"`) unchanged, and the pre-existing (out-of-scope) sign-inside-the-glyph convention for negative values (`"$-500"`, `"$-2.3M"`) preserved byte-for-byte.

`npx tsc --noEmit` clean; the existing sibling test `zerodte-board-strips.test.ts` (same split
precedent file) still passes unaffected.

### Blast radius

Only this one function/call site: `fmtMoney` was local to `ZeroDteBoard.tsx` and used at exactly
two places in that file (`s.gross_premium`, `s.recent_premium_30m` — both in the 0DTE Command
flow-strip row). No other file imported or duplicated this specific copy, so the fix's reach is
contained to this one board's rendered flow-strip text.

### Fix rationale

Extracted the function to a new sibling file, `zerodte-board-format.ts` (same "pull pure logic out
of a `.tsx` client component so it can run under plain `node:test`" precedent this file's
component already uses for `zerodte-board-strips.tsx`/`.test.ts`), and applied the same
round-first-then-promote guard `fmt-money.ts#fmtPremium` already uses at its own K→M boundary —
compared by magnitude (`Math.abs(k) >= 1000`) since `n` can be negative. Deliberately left the
pre-existing sign-inside-the-glyph formatting for negative values (`"$-1.2M"` rather than
`"-$1.2M"`) untouched: it is a separate, already-known formatting convention (see
`fmt-money.ts`'s own comment on why it places the sign outside the glyph) and fixing it here would
be a second, unrelated change riding on this PR. Did not consolidate the call sites onto the
shared `fmtPremium` import, to keep this a single, minimal, easily-reviewed fix matching the
established pattern every prior sibling fix in this bug family used (one scoped fix per
formatter, not a drive-by refactor to a shared import).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PzDkDzjR3bJQsFbXENzsVz
