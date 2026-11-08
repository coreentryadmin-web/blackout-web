> **kind:** FINDING

# Meridian revenue formatter (duplicated in two panels) never promotes M → B when rounding crosses $1B

| | |
|---|---|
| **Status** | FIXED |
| **Area** | Meridian estimates + earnings tabs — `MeridianEarningsEstimatesPanel.tsx` (`fmtMoney`) and `MeridianEarningsTabs.tsx` (`fmtRev`), now `src/features/meridian/lib/meridian-revenue-format.ts` |
| **Severity** | P3 — display-only magnitude mislabel, no calculation/trading impact |

## Root cause

Two Meridian panels independently defined the **exact same** compact-revenue formatter — same
thresholds, same `.toFixed()` precision per tier — and both picked the display unit (`B` vs `M`)
off the **unrounded** value, then rounded the quotient *inside* that chosen unit:

```ts
// MeridianEarningsEstimatesPanel.tsx's fmtMoney (feeds the Revenue trajectory chart)
function fmtMoney(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(0)}M`;
  return `$${n.toFixed(0)}`;
}

// MeridianEarningsTabs.tsx's fmtRev — byte-for-byte the same algorithm, plus a null guard
function fmtRev(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(0)}M`;
  return `$${n.toFixed(0)}`;
}
```

A revenue print of `$999,600,000` is `< 1e9`, so both take the `M` branch:
`(999_600_000 / 1e6).toFixed(0)` → `"1000"` → the literal **`"$1000M"`**, instead of promoting to
the `B` tier the value had actually rounded into (`"$1.00B"`). This is the exact same bug class
already fixed nine times this session across this repo — `fmt-money.ts`'s `fmtPremium`,
`meridian-earnings-intel-core.ts`/`meridian-earnings-intel.ts`'s `fmtPremShort`/`fmtPrem`,
`meridian-earnings-analytics-core.ts`'s `fmtCompactMoney`, `thermal-discord-card.ts`'s
`fmtCompactHeatMoney`, `darkpool-discord-format.ts`'s `fmtShares`,
`discord-context-enrichment.ts`'s `formatAdvShareLabel`, `helix-flow-format.ts`'s `fmtOi`, and
`group-greek-flow-summary.ts`'s `deltaM` — picking the display unit off the raw value before
rounding the quotient, so a value just under a threshold rounds up past 999/1000 in its chosen
unit and never promotes.

It was not caught earlier because: (a) large-cap revenue prints — the realistic input here, street
estimates/actuals/guidance for mega-cap names — routinely land in the ordinary `[$999.5M, $1B)`
window; (b) the eight prior fixes this session all lived in server-side `src/lib/*` modules — this
is the first pair of instances found living directly inside client components
(`src/features/*`); and (c) the bug was pasted into two sibling panels independently rather than
shared, so a fix to one would not have caught the other.

**Why this, and not the three other round-400 leads:** `MeridianEventDetailPanel.tsx`'s `fmtPrem`
has the identical shape but is **dead code** — `grep -n "fmtPrem("` across the file matches only
its own definition line, never called, not exported — so fixing it would change nothing
observable; noted but left untouched. `VectorCrosshairLegend.tsx`'s `fmtGex` has a third,
B/M/K-tiered copy of the *same* bug class (the `M` branch's `(n/1e6).toFixed(1)` can also round up
to `1000.0` without promoting to `B`) and IS live (used by `renderVectorCrosshairLegend`), but was
deliberately left for a future round to keep this PR's blast radius to the Meridian pair it was
built around — flagging it here so it isn't lost: `src/features/vector/components/
VectorCrosshairLegend.tsx:23-29`'s `fmtGex` needs the identical round-first-then-promote guard at
both its `M→B` and `K→M` thresholds.

## Evidence (RED → GREEN)

Centralized both duplicates into a new pure module, `src/features/meridian/lib/
meridian-revenue-format.ts` (`fmtCompactRevenue` + a null-safe `fmtCompactRevenueOrDash` wrapper),
with `meridian-revenue-format.test.ts`.

**RED** (pre-fix algorithm — the original unrounded-unit-pick logic — restored into the same
file): `npx tsx --experimental-test-module-mocks --test
src/features/meridian/lib/meridian-revenue-format.test.ts` → 2 pass / **2 fail**:

```
Expected values to be strictly equal:
+ actual - expected
+ '$1000M'
- '$1.00B'
```

**GREEN** (post-fix): same command → **4 pass / 0 fail**. The sibling
`meridian-earnings-estimates-format.test.ts` (covering the `fmtMoney` re-export plus the
untouched `fmtEps`/`period` helpers) is **3 pass / 0 fail**.

## Blast radius

- `MeridianEarningsEstimatesPanel.tsx` — `MeridianTrajectory rows={revRows} title="Revenue
  trajectory" format={fmtMoney}`, the Revenue trajectory bar's hover title
  (`${p.period} · est ${format(p.estimate)} → act ${format(p.actual)}`).
- `MeridianEarningsTabs.tsx` — 5 call sites of its own local `fmtRev`: "Revenue est"/"Revenue
  actual" KV rows, the management-guidance "Rev guide min – max" range (both bounds), and the
  Street estimates list's per-row revenue figure.
- **Not touched, flagged for a future round:** `VectorCrosshairLegend.tsx`'s `fmtGex` (same bug
  class, confirmed live, different feature area — see "Root cause" above).
- **Not touched, confirmed inert:** `MeridianEventDetailPanel.tsx`'s `fmtPrem` (same shape, but
  dead code — never called).

## Fix rationale

Mirrors the already-shipped overflow-into-next-unit guard used by every prior instance of this
bug class: check whether the rounded `M` value reached `1000` and, if so, render from the `B` unit
instead, preserving the two panels' own existing display precision (`toFixed(0)` for `M`,
`toFixed(2)` for `B` — deliberately NOT switched to the shared `fmt-money.ts`'s `fmtPremium`,
which uses `toFixed(1)` for both tiers and would have silently changed both panels' existing
display precision as a side effect of an unrelated bug fix).

```ts
if (abs >= 1e6) {
  const m = abs / 1e6;
  if (Math.round(m) >= 1000) return `$${(n / 1e9).toFixed(2)}B`;
  return `$${(n / 1e6).toFixed(0)}M`;
}
```

Centralizing the two byte-for-byte duplicates into one shared `fmtCompactRevenue` (rather than
patching each copy in place) is a deliberate choice, not scope creep: it is the same root cause in
two files, and fixing only one would leave the other panel silently un-fixed with the identical
defect — the exact "duplicated logic in a second file counts — fix and note all of them" case this
repo's PR write-up policy calls out. `MeridianEarningsTabs.tsx`'s `fmtRev` keeps its own name and
null-handling signature via a thin re-export (`fmtCompactRevenueOrDash as fmtRev`) so its 5 call
sites needed zero changes beyond the import line.

Deliberately left unchanged: the `B` branch's own upper end (no `T` tier exists here — equity
revenue never approaches $1T, and even if it did the only symptom would be a wide-but-correct
`"$1000.00B"` string, not a wrong unit label); the sign-placement convention (`$${n...}` puts the
`-` *inside* the `$`, e.g. `"$-650M"`, not `"-$650M"`) — unrelated to this bug and left exactly as
both panels already rendered it, to avoid an unrequested cosmetic change riding along with the
rounding fix; `fmtEps`/`period` (no unit tier, nothing to overflow) — only relocated alongside the
fix into the new pure `meridian-earnings-estimates-format.ts` module so the component keeps one
import instead of three scattered local helper functions.
