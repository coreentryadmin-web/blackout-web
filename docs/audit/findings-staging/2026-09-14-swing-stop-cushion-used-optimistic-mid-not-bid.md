> **kind:** FINDING

## Ask Largo's "Premium stop rail" cushion percentage used the optimistic mid price instead of the real executable bid — overstated real safety margin by ~4x on a live losing position — FIXED

| **Status** | FIXED (this commit) |
|---|---|

**Root cause:** `watchForSection`'s "Premium stop rail" cushion (`play-brief-intel.ts`, ~line
746) already had one fix (2026-09-12, live NN#32 repro) for the *binary* case — when the real
executable price (`play.execMark`, the bid a long would actually sell into) has already fallen
to or through the stop, the code correctly drops the percentage and says "no real cushion on the
executable side" instead. But that fix only handled `execMark <= stop`. The percentage itself,
whenever `execMark` was still above the stop, kept computing unconditionally from `play.mark`
(the mid) — `((play.mark - stop) / play.mark) * 100` — never once considering `execMark` even
though it was already fetched and already used two lines up for the "Executable P&L" bullet.

**Evidence (live reproduction, 2026-09-14, NN — the same real position #32 the original fix was
built from):** pulled NN's live play-brief. Position: entry $1.95, mark $1.13 (mid P&L **-42.3%**),
exec P&L **-56.4%** (bid-based), premium stop $0.78. The brief rendered:

> Premium stop rail: **$0.78** — **31% cushion from current mark**

Back-solving the executable fill from the stated Exec P&L (-56.4%): `1.95 × (1 - 0.564) ≈ $0.85`.
Since `$0.85 > $0.78`, the existing "gone" binary check correctly did NOT fire — but the **real**
executable cushion is `(0.85 - 0.78) / 0.85 ≈ 8.2%`, not the 31% the mid-only formula produced.
A member on a position already down 42–56% and evaluating whether they have room before deciding
to exit was reading a number **roughly 4x too generous** relative to what they would actually
realize selling into the bid. This is exactly the "plausible wrong number is worse than an
obvious one" trap the Largo product contract's C4 identity section (and the original 2026-09-12
fix's own comment) already names — just a second, unclosed instance of the same trap in the same
function.

**Blast radius:** single function, `watchForSection`'s Premium-stop-rail block — the only
consumer of this cushion computation. No other section computes a stop cushion independently.

**Fix:** the cushion basis now prefers `execMark` whenever it's known and positive, falling back
to `play.mark` only when `execMark` itself is unavailable (`execMark == null`) — the same
fallback discipline the file already uses elsewhere (never fabricate a bid that isn't there). The
cushion label now says "cushion from current bid" when the executable basis was used, vs. "cushion
from current mark" for the mid fallback, so the number's own label discloses which price it's
measuring against rather than silently switching meaning. The dollar stop level, the "no real
cushion" binary branch, and `optionMarkGenuinelyUnknown`'s absence gate are all unchanged.

**Fix rationale:** reusing `execMark` (already fetched, already trusted for the adjacent
Executable P&L bullet) rather than inventing a second bid-fetch path keeps this additive and low-
risk. Preferring the safer number by default — rather than showing both mid and exec cushion side
by side — matches the established precedent from the original 2026-09-12 fix, which also chose
"drop the optimistic number, state the safe truth plainly" over showing two conflicting
percentages.

**Test:** RED→GREEN proven (git-stashed the source fix, confirmed the updated/new tests fail
without it, restored and confirmed green). Updated the existing test that had encoded the old
(buggy) mid-based behavior as correct — `stop_premium 0.78`, `mark 1.10`, `execMark 1.00` now
correctly expects `22% cushion from current bid` (was asserting the wrong `29% ... from current
mark`). Added 2 new tests: the exact NN#32 live-repro shape (`mark 1.13`/`execMark 0.85`/`stop
0.78` → `8% cushion from current bid`, not the old `31%`), and a fallback-to-mid guard when
`execMark` is genuinely unavailable. Full `src/lib/swing/*.test.ts` (1117 tests) green, `tsc
--noEmit` and `eslint` clean.
