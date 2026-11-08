> **kind:** FINDING

# `boardExposure()` never reads the 0DTE board's own `upstream_ok` flag — a degraded board renders the same confident "Not committed" label as a genuinely clean absence

| | |
|---|---|
| **Status** | FIXED |
| **Area** | Largo / `src/lib/largo/pre-earnings-pack.ts` (`boardExposure()`), `src/features/largo/components/LargoPreEarningsPackCard.tsx` |
| **Severity** | P2 (confidently-wrong member-facing + Largo-facing label during a real, measured, recurring board outage — not a crash, but a silent mislabel) |

## Root cause

`boardExposure()` (`pre-earnings-pack.ts`) calls `getZeroDteBoardPayload()` — a function that, by
design, **never throws**: on an outage it resolves to a structurally valid but degraded
`ZeroDteBoardPayload` (`buildMinimalBoardFallback()`, `zerodte-service.ts`), with `upstream_ok:
false` and empty `ledger: []` / `setups: []`. `boardExposure()` searched those two arrays for the
ticker and, on a miss, fell straight through to its final line:

```ts
return { on_board: false, status: null, direction: null, pnl_pct: null, headline: null };
```

— with no reference to `board.upstream_ok` anywhere in the function. A ticker is (trivially)
absent from the degraded fallback's *empty* arrays, so this exact byte-identical shape was
returned for two completely different facts: "the board could not be built or read this cycle"
and "this ticker genuinely isn't committed and isn't a setup candidate." `PreEarningsPackCard`'s
`zerodte` field carried no error/degraded signal at all — unlike the sibling `earnings_error` /
`history_error` fields on the very same card (one fixed earlier today in #7586, the other
pre-existing) — and `LargoPreEarningsPackCard.tsx` rendered the result with full confidence as
"Not committed."

This is a repeat of a bug class already fixed elsewhere in this exact codebase. The sibling Largo
tool `zeroDtePlaysForLargo` (`zerodte-service.ts`) was fixed for precisely this — its own comment
calls it "WHICH EMPTY IS THIS?" — by checking `board.upstream_ok !== false` before trusting an
empty result; `rememberGoodBoard` (same file) is the established pattern for treating
`upstream_ok` as load-bearing, not decorative. `boardExposure()` reads the identical
`ZeroDteBoardPayload` type but was never given the same check.

**Measured, recurring impact** (not theoretical): `zerodte-service.ts`'s own in-code comment
documents 11 occurrences of this exact degraded fallback being served to real members in one
30-minute CloudWatch window on 2026-10-08 — the SAME window the real discovery pipeline was
finding 180-200+ setups, i.e. a real outage affecting only the degraded-serving path, not the
underlying data.

## Fix

1. `PreEarningsExposure` (the type `boardExposure()` returns) gains a new field,
   `board_error: string | null`, following the exact naming/shape convention the sibling
   `earnings_error` / `history_error` fields on `PreEarningsPackCard` already established on this
   same card (non-null = "the read itself failed/degraded," null = "a genuine answer, trust it").
2. `boardExposure()` mirrors the `upstream_ok !== false` idiom `zeroDtePlaysForLargo` already uses.
   A real ledger/setup match is still returned exactly as before (a real hit on a degraded board is
   real signal, never suppressed) — the check only changes what happens on a **miss**: if
   `board.upstream_ok === false`, the function now returns a `board_error`-carrying exposure
   instead of the confident `on_board:false` shape. Every other return site sets
   `board_error: null` explicitly, so no caller that reads the legacy fields unchanged is left
   guessing at `undefined`.
3. `LargoPreEarningsPackCard.tsx`'s "0DTE exposure" section now branches on `card.zerodte.board_error`
   first: when set, it renders an honest "0DTE board unavailable — could not check" line instead of
   "Not committed." The healthy-absence and real-hit renders are unchanged.

## Evidence (RED → GREEN)

`src/lib/largo/pre-earnings-pack.test.ts` — four new tests exercising `boardExposure()` through
`preEarningsPackForLargo()` against a mutable fake board fixture:
- healthy board, ticker genuinely absent → confident `on_board:false`, `board_error: null` (no
  regression)
- **degraded board (`upstream_ok:false`, empty arrays) → `board_error` set, instead of the old
  confident `on_board:false`** (the actual bug)
- ticker found on the committed ledger of an otherwise-degraded board → the real hit is still
  reported, `board_error: null` (fix does not suppress real signal)
- ticker found as a setup candidate on a healthy board → unchanged

RED (source reverted via `git checkout -- src/lib/largo/pre-earnings-pack.ts`, test file kept):
```
not ok 5 - boardExposure: degraded board (upstream_ok:false) reports board_error instead of a confident on_board:false
  error: 'a degraded (upstream_ok:false) board must disclose that it could not be checked'
# pass 3 / # fail 4
```
GREEN (fix restored): `# pass 7 / # fail 0`.

`src/features/largo/components/LargoPreEarningsPackCard.test.ts` — three new tests (degraded
render, healthy-absence no-regression, real-hit no-regression).

RED (component source reverted, test kept):
```
not ok 4 - REGRESSION: a degraded 0DTE board (board_error set) renders an honest 'could not check' state, never 'Not committed'
  error: "The input did not match the regular expression /could not check/i. Input: ...<p class=\"largo-struct-summary\">Not committed</p>..."
# pass 5 / # fail 1
```
GREEN (fix restored): `# pass 6 / # fail 0`.

Commands: `npx tsx --experimental-test-module-mocks --test <file>` (Node 20.20.2, per CLAUDE.md's
"run tests on Node 20" guidance — this repo's `mock.module()` usage needs the experimental flag).

`npx tsc --noEmit` is clean. Full `npm test` run separately, see PR for result.

## Blast radius

Single data-layer function (`boardExposure()`) and its one UI consumer
(`LargoPreEarningsPackCard.tsx` — confirmed via repo-wide grep the only renderer of
`PreEarningsPackCard.zerodte`). `preEarningsPackForLargo()`'s JSON result is also handed directly
to the Largo tool-use loop (it is "for Largo"), so the new `board_error` field also lets the model
itself narrate an outage honestly instead of asserting "not committed" from a degraded read — same
fix, no extra code needed for that consumer.

## Second occurrence investigated, NOT fixed here (disclosed follow-up)

A structurally similar but NOT cheaply-fixable second instance exists:
`shapeMeridianNighthawkBoardRead` (`src/lib/meridian/meridian-cross-product-for-earnings-core.ts`),
fed by `readMeridianBoardSnapshot` (`src/lib/meridian/meridian-board-tickers.ts`, a **direct**
`sharedCacheGet` read of the Redis board-snapshot key — a different path from
`getZeroDteBoardPayload()`'s fallback chain; `buildMinimalBoardFallback()`'s degraded payload is
never published to that Redis key at all, so this consumer cannot see *that* specific fallback).
It checks only `board.available` / `snap.available`, and that field's type is the **literal
constant `true`** on every `ZeroDteBoardPayload` (confirmed at its definition, `zerodte-service.ts`)
— so the early `!board?.available` guard only ever fires when `board` itself is `null`/`undefined`
(no snapshot cached at all), never on a degraded-but-present board.

Traced further than the open investigation note that flagged this: a **real** board build (not the
minimal fallback) CAN still carry `upstream_ok: false` — `scanZeroDteBoard`'s
`upstream_ok: upstream_ok && committedKnown` branch (same file) — and that real-but-degraded build
**is** published to the shared Redis snapshot via `publishBoardSnapshot`, so
`readMeridianBoardSnapshot()` genuinely can return an `upstream_ok:false` board with an empty
`setups` array (`displaySetups = committedKnown ? setups : []`). When the ticker isn't found in
that degraded board's arrays, `shapeMeridianNighthawkBoardRead` falls through to its own final
return, which already sets `available: false` — the SAME value a genuinely-clean "ticker not on
the board" read gets. So this is the identical "WHICH EMPTY IS THIS?" conflation, one level
removed.

The failure mode on this consumer is different from the primary fix above, not the same shape:
`MeridianEarningsIntelPanel.tsx` renders `{intel.nighthawk.available && (...)}}` — i.e. the entire
Night Hawk card section is **silently omitted** from the panel on `available:false`, rather than
rendering a confidently-wrong label. Confirmed by reading the panel directly (line ~208).

This was not folded into this PR because fixing it needs materially different plumbing than a
one-line `!== false` check: `MeridianEarningsNighthawkRead` (`meridian-types.ts`) has no spare
field to carry "could not check" distinctly from "ticker not found," so a fix needs (a) a new field
threaded through `shapeMeridianNighthawkBoardRead`'s return type, and (b) a new rendered state in
`MeridianEarningsIntelPanel.tsx` (a different component from the one touched here) replacing the
current all-or-nothing `available &&` gate. That is a second, separate single-issue fix, not a
surgical addition to this one — left as a clearly-named follow-up rather than force-fit into this
PR's scope.

## Fix rationale

Reused the exact `board.upstream_ok !== false` idiom the sibling `zeroDtePlaysForLargo` already
established in the same file, and the exact `*_error: string | null` field convention
`earnings_error` / `history_error` already established on this exact card type — no new pattern
invented. Deliberately did NOT gate the whole function on `upstream_ok` up front: a genuine match
in `ledger`/`setups` is real information even when the board build that produced it also set
`upstream_ok: false` for an unrelated reason (e.g. `committedKnown` false), so suppressing a real
hit in that case would have thrown away real signal to fix a different problem (a miss reporting
false confidence).
