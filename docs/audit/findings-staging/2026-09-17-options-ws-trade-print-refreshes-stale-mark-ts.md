## 2026-09-17 — [FINDING, FIXED] A trade print silently refreshed a stale WS option mark's timestamp, defeating staleness detection

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P2 — live position management: a genuinely stale mark can read as fresh indefinitely, letting `getLiveOptionMarkSync`'s staleness gate silently pass data it exists to reject |
| **Lane** | Night Hawk Legacy (found during the outcome-honesty/marks-correctness sweep; the defect lives in the shared `options-socket.ts` WS layer, so it also affects every other consumer of `getLiveOptionMarkSync`/`getLiveOptionMark`, not just Legacy) |
| **Files** | `src/lib/ws/options-socket.ts`, `src/lib/ws/options-socket-trade-merge.test.ts` |
| **PR** | (see PR link in commit trailer) |

### Root cause

`OptionMark.ts` is documented as "epoch ms when this mark was received/updated," and every
staleness check downstream (`isWsUpdatedAtFresh`, `isZeroDteMarkStale`) trusts it to mean exactly
that — "how old is this mark." `handleQuote` (a real "Q" NBBO frame) correctly stamps `ts: now`
alongside a freshly-computed `mark`. But `handleTrade` (a "T" print) did NOT:

```ts
// BEFORE
const entry: OptionMark = {
  bid: prev?.bid ?? null,
  ask: prev?.ask ?? null,
  mark: prev?.mark ?? last,
  last,
  ts: now,           // <-- always "now", even when mark/bid/ask are untouched
};
```

When a prior quote-derived mark already existed, `mark`/`bid`/`ask` were carried forward
byte-for-byte unchanged — only `ts` moved to `Date.now()`. A contract can print trades (even
sporadically) for a long stretch with no accompanying fresh NBBO quote update — a resting
two-sided market that simply isn't re-quoting — and each such trade would re-stamp `ts` to "now"
even though nothing about the mark itself had changed. `isWsUpdatedAtFresh`/`isZeroDteMarkStale`
then read that manufactured recency as real freshness, so a mark that was actually minutes old
could report `stale: false` indefinitely as long as trade prints kept trickling in.

This is the exact same root-cause shape as the already-fixed 2026-09-13 defect in
`legacy-option-mark-row.ts` ("the REST branch used to prefer `snap.observedAtMs` — our own fetch
clock — over `snap.quoteUpdatedMs` — the real market clock"), just on the WS ingestion side
instead of the REST fetch side, and left unaddressed by that fix and the four subsequent
staleness-threshold fixes to the same pipeline (PRs #5073, #5084, #4914, #4970) because none of
them touched `handleTrade`.

### Why this wasn't just cosmetic

`getLiveOptionMarkSync`/`getLiveOptionMark` are the WS read path for BOTH:
- `GET /api/market/nighthawk/legacy-marks` — the member-facing marks API.
- `legacy-option-marks-server.ts`'s `fetchLegacyOptionMarksServer` — the **legacy-live-sync cron's
  own mark read**, which drives `runLegacyLiveSync`'s peak/trough tracking and scale-out/close
  evaluation for real Chief Trade Alert Bot positions.

A falsely-fresh mark isn't merely a display quirk here: `buildLegacyOptionMarkRow`'s own
staleness check (already correctly bar'd at `LEGACY_QUOTE_STALE_MS`) is only as honest as the
`asofMs` it's given. If `ts` has been artificially kept current by trade-print noise, a mark that
should have been excluded/flagged stale is instead treated as live input to real position
management.

### Evidence

Traced structurally (not yet caught live at the healthcheck layer, since B_marks currently reads
correctly stale post-close): `handleMessage` dispatches `"T"` frames to `handleTrade` for every
subscribed contract (`sendSubscribe` subscribes both `Q.<sym>` and `T.<sym>` channels). Confirmed
`OptionMark.ts`'s own doc comment ("epoch ms when this mark was received/updated") is the
contract every caller relies on, and that `handleTrade` was the one code path violating it —
`handleQuote` was already correct (stamps `ts` alongside a freshly-computed `mark`).

### Fix

Extracted the merge logic into a pure, exported `mergeTradeIntoOptionMark(prev, last, now)` so it
could be unit-tested directly without instantiating the private `OptionsShard` class (same
pure-decision-extraction pattern already used elsewhere in this file's test suite, e.g.
`stocks-socket.test.ts`'s `isLuldHaltSourceStaleForState`). `ts` now only advances to `now` when
this trade is the thing that actually established the mark (no prior quote-derived mark existed,
so `mark` falls back to the trade's own `last`); when a real mark already exists, carrying it
forward carries its own timestamp forward too. `last` (the raw trade print) is still updated
either way — it never claimed to be a staleness signal on its own, only `mark`/`ts` are.

### Fix rationale

The alternative — leaving `ts` at `now` always — was the original (buggy) behavior. Never
advancing `ts` at all on a trade would also be wrong: when NO quote has ever established a mark
yet (`prev` is `undefined`, or a prior quote resulted in a crossed/invalid book so `mark` stayed
`null`), the trade print IS genuinely new information and its timestamp should count. The fix
distinguishes those two cases via `prev?.mark != null`, matching exactly the same condition
`mark: prev?.mark ?? last` already used to decide whether the trade contributes a new mark at all
— `ts` now tracks the same boundary `mark` already does, instead of tracking neither.

### Blast radius

- `getLiveOptionMarkSync`/`getLiveOptionMark` (`options-socket.ts`) — the shared WS mark-read
  layer; this fix benefits every consumer, not only Legacy.
- `legacy-marks/route.ts` and `legacy-option-marks-server.ts` (Legacy) — the two Legacy-specific
  consumers named in this lane's own standing mandate.
- `vector/contract-picks/live/route.ts` and `vector-pick-sweep.ts` (Vector/0DTE) — also read
  through `getLiveOptionMarkSync`, so they benefit from the same correction; not otherwise
  touched, no behavior of theirs is changed beyond marks now aging correctly.
- `handleQuote` was already correct and is untouched by this fix.

### Regression test

`options-socket-trade-merge.test.ts` (new file) tests the extracted pure function directly:
1. A trade print carrying forward an already-established mark must NOT refresh `ts`.
2. A trade print that establishes the FIRST mark (no prior quote) DOES stamp `ts` to now.
3. A trade print following a quote that resulted in a null mark (crossed book) also stamps `ts`
   to now.
4. A chain of repeated trade-only updates all stay anchored to the original quote's `ts` (no
   creeping drift).

RED→GREEN proven via `git stash push -u -- src/lib/ws/options-socket.ts`: 4/4 new tests fail
pre-fix (`mergeTradeIntoOptionMark is not a function`), 4/4 pass post-fix. Full suite +
`tsc --noEmit` both clean post-fix.
