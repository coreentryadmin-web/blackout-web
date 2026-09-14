> **kind:** FINDING

# SPX `computePlayOutcomeStats` win_rate divides by closed count, not decided count — breakeven rows silently dilute the desk's own track record

| | |
|---|---|
| **Status** | OPEN — reported per the standing escalation policy (ambiguous fix shape / broad public-facing blast radius, not fixed directly) |
| **Area** | `src/features/spx/lib/spx-play-outcomes.ts` — consumed by Night Hawk Legacy (`format.ts`'s `formatTrackRecord`), the public track record page/API, and Largo's `get_...` tool answers |
| **Found by** | Night Hawk Legacy audit lane, file sweep of Legacy's overnight-prompt dependencies (`format.ts`) |
| **Severity** | P2 — silently wrong, public-facing statistic; not a live-picks/gating bug |

## Root cause

`computePlayOutcomeStats` (spx-play-outcomes.ts:367-392) computes the overall win rate as:

```ts
const closed = rows.filter((r) => r.outcome !== "open" && r.outcome !== "superseded");
const wins = closed.filter((r) => r.outcome === "win").length;
const losses = closed.filter((r) => r.outcome === "loss").length;
const breakeven = closed.filter((r) => r.outcome === "breakeven").length;
...
overall: {
  wins,
  losses,
  breakeven,
  win_rate: closed.length > 0 ? wins / closed.length : 0,   // <-- denominator includes breakeven
},
```

`closed.length` is `wins + losses + breakeven`. The per-entry-path helper `bucket()` (lines 346-363) has the identical shape: `count = slice.length` (win+loss+breakeven rows for that path), and `win_rate: count > 0 ? wins / count : 0`.

This is exactly the defect class CLAUDE.md documents as a **standing, already-fixed-twice rule**: *"DECIDED-denominator honesty rule (`win_rate = wins/(wins+losses)`, NEVER `wins/scoreable` or `wins/n`)"* — first fixed in `analytics.ts`'s `buildRecordSegment` after a live 2026-08-06 incident (a bucket with `n=29/decided=0` rendered a false "0% win rate"), and independently re-derived correctly in `debrief-aggregate.ts`'s `groupRecord`/`mirrorBucket`, which explicitly cite the same incident. `spx-play-outcomes.ts` was never brought into line with that rule — it still divides by every closed row (win+loss+breakeven) instead of only the decided ones (win+loss).

**Effect direction:** any breakeven-heavy population understates the real decided win rate. Concretely: 5 wins, 0 losses, 5 breakeven → `win_rate = 5/10 = 50%` today, when the true decided rate is `5/5 = 100%` (every trade that actually resolved directionally was a winner). The published number silently drifts *worse* than reality precisely when the desk's real edge is strongest and losses are rare — the mirror image of the 2026-08-06 incident, which drifted the other way (a false 0% from an all-open/breakeven bucket), but the same root defect: the wrong population in the denominator.

## Evidence

The existing unit test for this function (`spx-play-outcomes-stats.test.ts`, `computePlayOutcomeStats overall win rate and path buckets`) asserts `stats.overall.win_rate === 2 / 3` for a population of `[win, loss, win]` (0 breakeven) — which is numerically identical whether you divide by `closed.length` or by `wins + losses`, because there are no breakeven rows in the fixture. **No test in this file exercises a breakeven row against `win_rate`**, so the gap between "decided" and "closed" denominators has never been caught by CI. Traced by hand against the live formula above; not yet re-run against a live breakeven-containing window (would need `fetchPlayOutcomeStats()` against production data with a real breakeven print in the sample).

## Blast radius

`PlayOutcomeStats`/`computePlayOutcomeStats`/`fetchPlayOutcomeStats(ForWindow)` are consumed well beyond Night Hawk Legacy:
- **Night Hawk Legacy** (this lane's own scope): `src/features/nighthawk/lib/format.ts`'s `formatTrackRecord` renders `overall ${wins}-${losses}-${breakeven} (${pct(win_rate)} win-rate)` straight into the overnight `buildClaudePrompt` — Legacy's own play-generation model is anchored to this wrong number every night via the "DESK TRACK RECORD" line, and `edition-builder.ts`/`claude-edition.ts` both pull `fetchPlayOutcomeStats()` for the same purpose.
- **Public-facing**: `src/lib/track-record-public.ts` and `src/lib/track-record-page.ts` (the public track record page) both import `fetchPlayOutcomeStats`/`PlayOutcomeStats` directly.
- **Largo**: `src/lib/largo/run-tool.ts` calls `fetchPlayOutcomeStatsForWindow` — a Largo tool answer about SPX play performance would carry the same diluted number.
- **Admin/correctness**: `src/lib/admin-spx-analytics.ts`, `src/lib/correctness/track-record-verifier.ts`, `src/features/spx/lib/spx-play-telemetry.ts`, `src/app/api/market/spx/outcomes/route.ts` all read the same stats.

Every one of these renders or reasons about the SAME wrong `win_rate` field — this is one root cause with many call sites, not a Legacy-local bug, even though it was found while auditing a Legacy consumer.

## Why held rather than fixed directly

The mechanical piece of the fix is unambiguous (denominator should be `wins + losses`, matching the precedent in `analytics.ts`/`debrief-aggregate.ts` exactly). What is NOT unambiguous, and is why this is being reported rather than patched in this PR:

1. **The zero-decided edge case needs a type decision.** `PlayOutcomeStats.overall.win_rate` and `bucket()`'s `win_rate` are typed as plain `number`, not `number | null`. The established precedent this defect class follows (`analytics.ts`'s `buildRecordSegment`) treats a zero-decided bucket as **honestly null**, not a fabricated `0`— that is the actual lesson of the 2026-08-06 incident this rule exists to prevent, not just "pick a different denominator." Doing the minimal in-place fix (`wins/(wins+losses)` but still defaulting to `0` when `wins+losses===0`) reproduces the SAME false-zero failure mode CLAUDE.md's rule was written to eliminate, just for a narrower input (all-breakeven or all-open closed population) than the original incident. Doing the FULL fix (matching `analytics.ts`'s honest-null pattern) requires widening the type to `number | null` and updating every one of the ~10 consumer files above to null-guard it before formatting/displaying, which is a genuine multi-file, cross-lane (SPX lane owns this file, not Legacy) change.
2. **Blast radius crosses lane ownership.** `spx-play-outcomes.ts` lives under `src/features/spx/lib/`, not Legacy's own directory — per the standing collaboration protocol, a change this broad (public track record page + Largo tool + admin dashboards) is better raised for the owning lane (or a session with SPX-desk context) to size and sequence, rather than a Legacy-scoped session silently reshaping a shared, public-facing statistics function.

**Suggested fix shape** (for whoever picks this up): widen `win_rate` to `number | null` in `bucket()` and `overall`, compute it as `wins + losses > 0 ? wins / (wins + losses) : null`, and update each consumer's render path to say "no decided trades yet" (or omit the win-rate clause entirely) when null — mirroring exactly how `buildRecordSegment` in `analytics.ts` already handles this for Legacy's own record segments. Add a unit-test fixture with a breakeven row mixed into wins/losses so this gap can never silently regress again (the existing `computePlayOutcomeStats overall win rate and path buckets` test's all-win/loss fixture cannot catch it).
