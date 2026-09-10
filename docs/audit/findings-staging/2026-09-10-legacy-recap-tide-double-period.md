# Night Hawk Legacy overnight-edition recap_summary double-periods whenever market tide is unavailable

> **kind:** FINDING

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P3 (member/Largo-visible cosmetic text defect, no data corruption) |
| **Area** | Night Hawk Legacy overnight edition (`GET /api/market/nighthawk/edition`), `recap_summary` field |
| **Files** | `src/features/nighthawk/lib/format.ts` (`tideSummary`, `formatEtfTides`), `src/features/nighthawk/lib/format.test.ts` (new) |

## Context

Live capture from `GET /api/market/nighthawk/edition` (2026-09-10, ~13:52 UTC, pre-open) during
the standing 5-engine live monitor cycle:

```
"recap_summary": "Market tide unavailable.. SPX 7636.36 (-0.48%) · H 7661 L 7624 · VIX 16.46 (+4.7%). ..."
```

Note the double period right after "unavailable" — `"unavailable.."`.

## Root cause

`tideSummary()` (`format.ts:164`) returns a full sentence including its own trailing period on
two of its three branches:

```ts
function tideSummary(tide: Record<string, unknown> | null): string {
  if (!tide) return "Market tide unavailable.";          // <- trailing period
  ...
  if (total <= 0) return "Market tide flat / no premium."; // <- trailing period
  ...
  return `${bias} — calls ${callPct.toFixed(0)}% (...) vs puts ${fmtPremium(put)}`; // <- no period
}
```

`buildMarketRecap()` (`format.ts:242`) then builds the `summary` field with its own period after
the tide segment: `` `${tide}. ${spx}.${...}` ``. When `ctx.tide` is null (or flat) — a routine,
honest absence state (no UW tide data for the session, not a bug in itself) — the two periods
concatenate into `".."`. The third (real-tide) branch never had this problem because it never
included a trailing period of its own, which is exactly why the bug was branch-specific and easy
to miss in earlier live captures that happened to run during a session with real tide data.

## Evidence

RED→GREEN via `src/features/nighthawk/lib/format.test.ts` (new): pre-fix, `buildMarketRecap()`
with `tide: null` produced `tide === "Market tide unavailable."` and
`summary.includes("..") === true`; post-fix, `tide === "Market tide unavailable"` (no trailing
period) and no double period anywhere in `summary`. Verified via `git stash` on the source file
only (RED), then `git stash pop` (GREEN) — both runs on Node 20.

Full `npm test` (Node 20): pending in the same PR wave, see PR body.
`npx tsc --noEmit`: clean.

## Blast radius

`grep -rn "tideSummary" src/` confirms exactly two call sites, both now handled:
- `buildMarketRecap()`'s `summary` template — already appended its own period; now correctly
  produces a single period since `tideSummary()` no longer bakes one in.
- `formatEtfTides()` (the per-ETF tide line, e.g. `SPY: BULLISH — calls 60% ...`) — this call site
  did **not** append its own trailing period, so it relied on `tideSummary()`'s to end the line.
  Fixed at the call site instead (`` `${sym}: ${tideSummary(tide)}.` ``) so ETF tide lines keep
  their trailing period rather than losing it.

No other formatter reads `tideSummary()`'s return value, and no schema/API shape changed — only
the text of `recap_summary` (and the per-ETF tide lines, cosmetically identical either way since
that call site was patched to preserve its own period).

## Fix rationale — what was deliberately left unchanged

Considered stripping the period only inside `buildMarketRecap()`'s consumption of `tide` (e.g.
`tide.replace(/\.$/, "")`) instead of changing `tideSummary()` itself — rejected because that
papers over the actual inconsistency (two of three branches self-punctuate, one doesn't) rather
than fixing it, and would leave `formatEtfTides()`'s reliance on the self-punctuating branches
intact as a latent trap for the next caller. Standardizing `tideSummary()` to never self-punctuate,
and making both call sites own their own trailing punctuation explicitly, removes the ambiguity
for any future caller rather than just patching today's one observed symptom.
