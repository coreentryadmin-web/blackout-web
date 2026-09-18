# Ask Largo swing play-brief never surfaced live per-position greeks, despite the identical data already rendering on the Command Deck

> **kind:** `FINDING`

| | |
|---|---|
| **Area** | Ask Largo swing play-brief — `pnlSection` (`src/lib/swing/play-brief.ts`) |
| **Severity** | P3 (member-facing narrative gap — a real, live data field a member would naturally ask Largo about was silently absent, not incorrect) |
| **Status** | FIXED — `fix/swing-play-brief-live-greeks` |

## Root cause

`TerminalPlay.greeks` (delta/gamma/theta/vega/iv) is a real, live per-contract greek read for every
open swing position: `swing-active-refresh`'s cron fetches it on every tick via
`fetchOptionsUnifiedSnapshot` (`src/lib/swing/live-plays.ts`'s `SwingLiveQuote`, carried onto the
held contract with zero new IO), and `terminalPlayFromHorizon`
(`src/features/nighthawk/command-deck/adapters.ts:1009`) already builds `play.greeks` from it via
`greeksFromContract` — that call site's own comment traces the wiring back to FINDINGS 2026-08-06
SEV-3 ("greeks never reached the desk... SWING/LEAPS greek strip could never render anything"),
fixed there for the Command Deck's own greek strip (`PlayTerminal.tsx`).

But the swing play-brief — Ask Largo's own consumer of the exact same `TerminalPlay` object — never
read `play.greeks` anywhere in `play-brief*.ts`. A member asking Largo "what's my theta decay /
delta exposure on this position" got nothing, even though the identical live numbers already render
one click away on the deck's own greek strip. Same wiring-gap shape as the already-shipped #4101
`unavailableSources` fix: data computed, even already surfaced on a sibling UI surface, never
reached the Largo envelope.

## Evidence

Verified in source, not speculation:
- `src/lib/swing/live-plays.ts` (`SwingLiveQuote`): live per-contract greeks fetched on every
  active-refresh tick.
- `src/features/nighthawk/command-deck/adapters.ts:316-317,529-535,616`: `TerminalPlay.greeks` type
  + `terminalPlayFromHorizon` populating it from the live contract.
- `src/features/nighthawk/command-deck/adapters.ts:793`, `greeksFromContract`: only returns a
  non-null object when at least one field is real (`Object.values(...).some(v => v != null)`) — the
  same honesty gate the deck's own `greeksLive` check applies.
- `git grep -n "play.greeks\|\.greeks\b" src/lib/swing/play-brief*.ts` (pre-fix): zero matches.

## Blast radius

Single call site — `pnlSection` in `play-brief.ts` is the only place the Position section's P&L/
rail text is composed. No other section duplicates this logic. Every OPEN swing play-brief for a
position with a live greek read was affected (WATCH/CLOSED positions don't carry `play.greeks` at
all, so they're unaffected either way).

Separately noted but **NOT fixed here, out of scope**: `src/lib/swing/swing-risk.ts`'s
`computeSwingRisk` — a fully-built, tested per-position dollar-risk engine (net delta, theta $/day,
beta-weighted delta) — has zero call sites anywhere in the codebase. Wiring it into the brief needs
new plumbing (it's not a live per-contract read the way `play.greeks` is), not a small fix, so it's
left as a follow-up idea rather than implemented in this PR.

## Fix rationale

Added a "Greeks" line to `pnlSection`'s Position section (OPEN bucket only, where `play.greeks` can
be populated), formatted to match `PlayTerminal.tsx`'s exact `fmtGreek` convention (signed
delta/gamma/vega, unsigned theta since a real theta value already carries its own minus sign, IV as
a rounded whole-number percent) — so a member cross-referencing the deck and Largo never sees the
same number rendered two different ways. Gated purely on `if (play.greeks)`: `greeksFromContract`
already only returns non-null when a field is real, so no new absence/staleness plumbing was needed
on top of the existing honesty gate.

Deliberately did NOT wire up `computeSwingRisk` in the same PR — it's a separate, larger integration
(new call site, new data shape) and mixing it into this narrow wiring fix would violate the
single-issue-per-PR policy.

## Verification

- `npx tsx --experimental-test-module-mocks --test src/lib/swing/play-brief.test.ts` — 70/70 pass.
  RED→GREEN independently confirmed: reverted only the source fix (kept the 2 new tests), ran the
  file — 1/70 failed (the new greeks-present test) exactly as expected, 69/70 passed unaffected.
  Reapplied the source fix — 70/70 pass, no other regression.
- `npx tsc --noEmit` — clean.
- Full `npm test` (Node 20) — 14600/14603 pass, 0 fail, 3 pre-existing skips (net +2 tests vs the
  pre-fix baseline, matching the 2 new test cases added).
