> **kind:** FINDING

## Options WS: a Quote (NBBO) frame wiped the last-trade price back to null on every tick — FIXED

**Status:** Fixed, regression tests added (`src/lib/ws/options-socket-quote-merge.test.ts`).

### Root cause

`OptionsShard.handleQuote` (`src/lib/ws/options-socket.ts`) built a brand-new `OptionMark` on
every Q (NBBO) frame using `last: finiteOrNull(msg.lp ?? msg.last ?? msg.p)`. Per the module's
own documented protocol (file header: "message Array<{ ev: \"Q\"|\"status\"|..., sym, bp/bid,
ap/ask, ... }>" and the quote handler's own comment "Massive quote fields are bp/ap ... we only
need the NBBO prices"), a real Quote frame never carries a trade price — `lp`/`last`/`p` are
Trade-frame fields. So `finiteOrNull(msg.lp ?? msg.last ?? msg.p)` resolves to `null` on
virtually every real quote tick.

Because the handler constructed a fresh object from that `null` instead of merging with the
existing entry, every quote tick overwrote whatever `last` the most recent Trade ("T") frame
had just established via the sibling `mergeTradeIntoOptionMark` (which, by contrast, correctly
carries `bid`/`ask`/`mark` forward from the prior entry — see its own 2026-09-17 fix). Since a
contract typically quotes far more often than it trades (NBBO updates on every book change vs.
a trade print only when one actually executes), `last` was wiped back to null within
milliseconds of being set, essentially all the time.

`last` was added to `OptionMark`/`getLiveOptionMarkSync` specifically on 2026-09-15 (see that
function's own doc comment) "so a caller can apply the same bid=0 backstop-quote divergence
guard (`reliableMarkFromQuote`, `options-snapshot.ts`) to this WS mark too" — `handleQuote`'s
own `midOf(bp, ap)` computation has the identical exposure to a market-maker backstop ask that
guard exists to catch. This defect defeated that stated purpose for as long as quotes kept
arriving, which is nearly always: a caller reading `getLiveOptionMarkSync` between ticks would
see `last: null` instead of the real last-trade price.

### Evidence

- **RED (pre-fix behavioral repro):** simulated the exact pre-fix `handleQuote` logic against a
  map entry carrying `last: 1.35` from a prior trade (`{bid:1.2, ask:1.4, mark:1.3, last:1.35,
  ts:1000}`), fed a realistic Q frame (`{bp:1.25, ap:1.45}`, no `lp`/`last`/`p` — exactly what
  Massive actually sends). Result: `optionMarks.get("OCC").last === null` — the real defect,
  reproduced outside the test harness first.
- **RED (via `git stash` on `options-socket.ts` only, new test file kept):** all 5 new tests in
  `options-socket-quote-merge.test.ts` failed with `mergeQuoteIntoOptionMark is not a function`
  (the function did not exist pre-fix) — confirms the fix is new code, not a pre-existing path.
- **GREEN (fix restored):** all 5 new tests pass, plus the existing 14
  `options-socket-trade-merge.test.ts`/`options-socket-gate.test.ts` tests, plus the full
  `src/lib/ws/*.test.ts` suite (192/192 pass), on Node 20.
- `npx tsc --noEmit` clean on the whole project.

### Blast radius

Every consumer of the WS mark store (`getLiveOptionMark`, `getLiveOptionMarkSync`) inherits the
fix automatically — today's one in-tree caller is `vector-pick-sweep.ts`'s `quoteForOcc`, plus
any future Legacy/0DTE caller that adopts the backstop-quote divergence guard the field was
built for. `bid`/`ask`/`mark`/`ts` are untouched by this fix — they still refresh unconditionally
on every quote frame, exactly as before; only `last`'s carry-forward behavior changed.

### Fix rationale

Extracted `mergeQuoteIntoOptionMark(prev, bid, ask, quoteLast, now)` as a pure, exported,
unit-tested function mirroring `mergeTradeIntoOptionMark`'s own carry-forward discipline, just in
the opposite direction: `last` only overwrites when the frame itself carries one (`quoteLast ??
prev?.last ?? null`), otherwise the previous entry's `last` survives. `bid`/`ask`/`mark`/`ts`
still update unconditionally on every quote, since a Quote frame IS the fresh NBBO — there is no
staleness concern on that side (unlike the Trade-frame `ts` fix, which deliberately does NOT
advance `ts` when nothing about the mark actually changed). The "drop an all-empty frame" guard
in `handleQuote` now checks the frame's own raw fields (`bid`/`ask`/`quoteLast`) rather than the
merged result, so a truly empty frame (no bid, no ask, no trade price, and nothing to carry
forward would matter anyway) is still a no-op exactly as before — the drop condition is
unchanged in substance, just expressed over the frame's own values instead of the derived
`mark`.

Considered and rejected: changing `ts` semantics to not advance on a bid/ask-only quote (out of
scope — the existing `ts` contract for quotes, "epoch ms when this mark was received/updated",
is correct for bid/ask/mark; only `last`'s clobbering was the defect); wiring the backstop-quote
divergence guard into `vector-pick-sweep.ts` itself (a separate, optional feature change to an
existing consumer, not a correctness fix to the WS ingestion path this PR targets).

### Deliberately left unchanged

- `mergeTradeIntoOptionMark` and its own `ts`-anchoring fix (2026-09-17) — already correct,
  re-verified, not re-fixed.
- `handleTrade`, the leader-election/fencing logic, the reconnect/backoff curve, and every other
  part of `options-socket.ts` not touched by this change.
- `vector-pick-sweep.ts`'s `quoteForOcc` — does not currently apply `reliableMarkFromQuote` to
  the WS mark's `last`; that is a separate, optional follow-up to actually USE the guard this
  field exists for, out of scope for this ingestion-path correctness fix.
