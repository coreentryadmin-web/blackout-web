> **kind:** FINDING

## HELIX session pulse "top ticker" silently flips on an exact premium tie, depending only on upstream print-arrival order — FIXED

**Status:** FIXED (regression test added, RED→GREEN proven via `git stash`).

### Root cause

`computeHelixSessionPulse` (`src/features/helix/lib/helix-session-pulse.ts`) builds a
`Map<ticker, summedPremium>` from the session's flow alerts, then picks the "top ticker" with:

```ts
let topTicker: { ticker: string; premium: number } | null = null;
for (const [ticker, premium] of byTicker) {
  if (!topTicker || premium > topTicker.premium) topTicker = { ticker, premium };
}
```

`for...of` over a `Map` iterates in **insertion order**, i.e. the order in which each ticker
*first appeared* in the `flows` array. The comparison is a strict `premium > topTicker.premium`,
so on an **exact tie** between two tickers' summed premium, the walk keeps whichever one it saw
first and never updates — the "winner" is decided purely by which print the upstream UW feed
happened to deliver first that poll, not by anything that actually distinguishes the two tickers.

Exact ties here are not theoretical: whale prints routinely land on round premium figures (one
$500,000 print, or several smaller prints that happen to sum to the same total as another
ticker's single print), so two names landing on the identical summed premium within one session
is a realistic, recurring scenario on a live, high-volume flow tape.

This is the exact same "single-winner pick with no tie-break" defect class already fixed six+
times elsewhere in this codebase this session (most recently `rankOpexSessionMovers` in
`meridian-opex-cross-market-core.ts`, PR #7252 — "Array#sort is stable... the 'winner' silently
depended on which row... happened to list first"). Here the shape is a `reduce`-style running-max
scan over Map iteration order instead of a stable sort, but the failure mode is identical:
byte-identical underlying data, different reported answer, purely because of input order.

### Evidence

New test in `src/features/helix/lib/helix-session-pulse.test.ts`:
feeds `computeHelixSessionPulse` two tickers (`ALPHA`, `ZEBRA`) each summing to an identical
$500,000 premium, once with `ZEBRA`'s print first and once with `ALPHA`'s print first.

- **Before the fix (RED):** `pulseA.topTicker?.ticker` is `"ZEBRA"`, `pulseB.topTicker?.ticker`
  is `"ALPHA"` — the reported top ticker flips between runs on identical underlying premium,
  solely because of array order. Confirmed via `git stash` on just the source file (keeping the
  new test): 1 failing subtest.
- **After the fix (GREEN):** both orderings report `"ALPHA"` (the alphabetically-first ticker on
  a tie, matching the established convention). Full `helix-session-pulse.test.ts` suite: 8/8 pass.
  Full `src/features/helix/lib/*.test.ts` suite: 298/298 pass.

### Blast radius

`computeHelixSessionPulse`'s `topTicker` is rendered live in `HelixSessionPulseBar.tsx`
("Top ticker" stat on the Helix session pulse bar) — a member-facing, real-time panel. No other
call sites read `topTicker`. The fix only changes behavior on an exact premium tie; every
non-tied result is unchanged (the new comparator's first clause, `premium > topTicker.premium`,
is untouched — the second clause only ever fires when the first is false and premiums are
exactly equal).

### Fix rationale

Added an explicit secondary tie-break: on an exact premium tie, the alphabetically-first ticker
(`ticker.localeCompare(topTicker.ticker) < 0`) wins, matching the convention already established
for this exact bug shape elsewhere in the repo (`rankOpexSessionMovers`'s
`a.ticker.localeCompare(b.ticker)` secondary sort key). This makes the pick deterministic without
changing any non-tied result, and without introducing a new, independently-invented tie-break
rule into a codebase that already has one.
