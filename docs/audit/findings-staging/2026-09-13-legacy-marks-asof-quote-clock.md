> **kind:** FINDING

## Night Hawk Legacy option marks conflated "we just fetched" with "the quote is fresh" — a genuinely stale book always read `stale: false` — fix/legacy-marks-asof-quote-clock — 2026-09-13

- **What was broken (found by a parallel audit workflow's Legacy health-check lane, live
  2026-09-13):** `buildLegacyOptionMarkRow()` (`src/features/nighthawk/lib/legacy-option-mark-row.ts`)
  derived its `asofMs`/`stale` fields by preferring `snap.observedAtMs` (this server's OWN fetch
  clock — when we successfully called the provider) over `snap.quoteUpdatedMs` (the REAL market
  clock — `last_quote.last_updated`, when the option's own bid/ask actually last changed). A
  successful fetch is not proof the underlying quote moved: a thinly-traded or far-dated Legacy
  contract can go quiet for many minutes while every re-fetch still returns HTTP 200 with the
  identical old `last_quote` — and each such re-fetch restamped `observedAtMs` to "now," so the
  member-facing `asof` read as "just now" indefinitely and `stale` was structurally incapable of
  ever becoming `true` for a successfully-returned snapshot, no matter how old the real quote was.
  This matters acutely here because `ZERODTE_MARK_STALE_MS` (the shared bound
  `isZeroDteMarkStale` checks against) is only **5 seconds** — with `observedAtMs` as the clock,
  virtually every live fetch would clear that bound trivially, defeating the staleness check's
  entire purpose for exactly the contracts it exists to catch (illiquid/quiet books).
- **Root cause:** `options-snapshot.ts` deliberately stamps `observedAtMs: Date.now()` on every
  fetch for a DIFFERENT, legitimate reason — 0DTE's G-9 gate wants "did we just get a live NBBO"
  as proof of a fresh READ at the moment of a synchronous commit-time fetch (see that file's own
  comment). `legacy-option-mark-row.ts` borrowed the same field for a different question — "is the
  underlying PRICE DATA itself current" — where the two clocks are not interchangeable: a fetch can
  succeed instantly while returning quote data that is genuinely old.
- **What changed:** `buildLegacyOptionMarkRow()` now prefers `snap.quoteUpdatedMs` (the real quote
  clock) for its REST-derived `asofMs`, falling back to `snap.observedAtMs` only when the provider
  gives no `last_quote` timestamp at all. The WS-tick path (`ws.ts`) is untouched — a live WebSocket
  tick's own timestamp was never affected by this bug.
- **Blast radius:** grepped every `observedAtMs`/`quoteUpdatedMs` call site repo-wide. Found one
  more instance of the identical shape: `src/lib/swing/contract-ranker.ts`'s
  `chainContractFromSnapshot()` populated a field literally named `quoteUpdatedMs` by preferring
  `snap.observedAtMs` over `snap.quoteUpdatedMs` — exactly backwards under its own field name, and
  the clock `evaluateQuoteStaleGate` (`src/lib/swing/v2/gates.ts`, "Quote freshness — transient
  stale quote blocks COMMIT") depends on to catch a stale book before a swing COMMIT. Fixed the same
  way. **Disclosed limitation:** grepped repo-wide (including inside the function's own file) and
  found **no live call site** for `chainContractFromSnapshot()` outside its own test — the function
  is exported as "the ONLY bridge from the live provider into the pure ranker" per its own doc
  comment, but nothing in the current pipeline invokes it, so this half of the fix is a latent-bug
  fix (correct hygiene, not a behavior change in production today) rather than a live-production
  correction. The 0DTE `scan.ts` call sites that also read `snap?.observedAtMs ?? snap?.quoteUpdatedMs`
  (for G-9's own quote-age gate) were investigated and are **NOT** the same bug — there, `snap`
  comes from a synchronous, just-completed `fetchOptionsUnifiedSnapshot()` call in the same
  function, so `observedAtMs` genuinely does mean "we just got this live, right now" — a legitimate
  design, left unchanged.
- **Fix rationale:** did not touch `options-snapshot.ts`'s `observedAtMs` semantics — 0DTE's G-9 use
  of it is correct and other call sites may legitimately depend on the existing behavior. Scoped the
  fix to the two callers that were using the wrong clock for a member-facing/gate-facing staleness
  question, rather than changing the shared primitive's meaning.
- **Evidence:** `src/features/nighthawk/lib/legacy-option-mark-row.test.ts` — new test: a snapshot
  with a real `quoteUpdatedMs` 45 minutes stale but `observedAtMs` stamped to "now" must read
  `stale: true` and `asof` equal to the real quote timestamp, not "now." `src/lib/swing/contract-ranker.test.ts` —
  two new tests: the real (stale) quote clock wins over a fresh fetch clock; falls back to
  `observedAtMs` only when the provider supplies no quote timestamp at all. RED→GREEN confirmed via
  `git stash` on both implementation files (both new tests failed pre-fix with the exact wrong
  values, passed post-fix). Full suite 14058/14058 pass (3 pre-existing unrelated skips),
  `tsc --noEmit` clean.
- **Not attempted here:** changing `options-snapshot.ts`'s `observedAtMs` semantics or its 0DTE G-9
  usage — that usage is correct for its own purpose and out of scope for this fix.

| **Status** | Fixed — PR opened, CI pending |
