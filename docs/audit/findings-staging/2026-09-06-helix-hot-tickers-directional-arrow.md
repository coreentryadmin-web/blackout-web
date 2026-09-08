# 2026-09-06 — Helix Hot Tickers rail arrow used the pre-#2691 raw call/put sign — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Priority** | P2 |
| **Area** | Helix — flow tape |
| **PR** | (this branch) |

## Root cause

`#2691` (documented at length in `src/features/helix/lib/helix-direction-read.ts`) replaced the
raw `callPremium - putPremium >= 0` sign rule with an aggression-aware read
(`readDirection`/`directionTone`) across `ExpiryConcentration`, `NetPremiumLeaderboard`, and the
ticker drawer's bias pill — because a SOLD call is bearish, not bullish, and the old sign rule got
that backwards on measured live tape (SPX's top net-premium row: a green ▲ over $4.02B whose
direction was 0.1% readable; "This week" horizon: bearish premium slightly exceeded bullish while
the bar rendered green).

`HelixHotTickersRail` (rendered on the same page, same tape, right next to those fixed panels) was
never migrated. Its ▲/▼ arrow and bull/bear color still come straight from
`computeHelixHotTickers`'s `callPremium - putPremium` sign — the exact rule #2691 replaced
everywhere else.

## Concrete divergent scenario

A ticker with only CALL prints, all seller-initiated (`ask_pct` ≈ 20, below the sold threshold),
$3M total premium, $0 in puts. `NetPremiumLeaderboard`/`readDirection` correctly classify this as
**bearish** (a sold call is bearish). `HelixHotTickersRail`'s chip for the identical ticker on the
identical tape computes `net = 3,000,000 - 0 = +3,000,000` and renders **▲ green "bull"** — the
opposite verdict, two panels, one tape.

## Fix

`computeHelixHotTickers` now retains each ticker's flows during accumulation and computes
`direction: DirectionRead` via `readDirection(flows)` — the same derivation
`NetPremiumLeaderboard`/`ExpiryConcentration` already use, per `helix-direction-read.ts`'s own "one
derivation, because three surfaces on one page silently disagreeing... is the failure this whole
lane keeps finding" design note. `HelixHotTickersRail` renders the arrow via `directionTone(row.direction)`
instead of the raw sign, and renders no arrow at all (not a guessed one) when the verdict rests on
a minority of readable premium — matching the sibling panels' honest-neutral behavior.
`callPremium`/`putPremium` are untouched (still the panel's own native call-vs-put fact, per the
Largo product contract's ADDITIVE principle — they simply no longer decide the arrow's color).

## Evidence

- New tests, RED before / GREEN after (`git stash` on the two source files, tests kept):
  - "direction is aggression-aware, not the raw callPremium - putPremium sign — a ticker that's
    100% SOLD calls reads bearish, not bullish" — failed pre-fix (`direction` was `undefined`,
    since the old type had no such field).
  - "a mostly-unreadable ticker (no ask_pct) renders no direction tone, not a guessed one" — same
    failure mode pre-fix.
  - `helix-hot-tickers.test.ts`: 3/3 pass post-fix.
- `tsc --noEmit`: clean.
- Full `npm test` (Node 20): pending in this PR's evidence trail (see push).

## Blast radius

- `helix-hot-tickers.ts` (lib) and `HelixHotTickersRail.tsx` (component) only. `HelixHotTicker`
  gained a `direction` field; the only construction site is `computeHelixHotTickers` itself
  (repo-wide grep confirmed no other file constructs this type as a literal).
- No change to `readDirection`/`directionTone`/`helix-direction-read.ts` — reused verbatim,
  matching the module's own stated intent to be the single derivation every Helix surface shares.

## Fix rationale

Mirrors `NetPremiumLeaderboard`'s exact established pattern (accumulate flows per ticker, call
`readDirection(flows)` once, keep the raw sum as a separately-labeled fact) rather than inventing a
new derivation — the whole point of `helix-direction-read.ts`'s existence is that Helix surfaces
must share one direction computation, not five that can each independently drift.
