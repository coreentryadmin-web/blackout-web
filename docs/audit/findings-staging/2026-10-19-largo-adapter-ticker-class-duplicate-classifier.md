## 2026-10-19 — [FINDING, P3 Largo/Swing] play-brief-adapter.ts reimplemented its own ticker_class classifier, disagreeing with the brief's own C4 identity field — FIXED

> **kind:** `FINDING`

| **Status** | FIXED |
|---|---|

**Severity:** P3 — not yet live (the field this adapter computes is unused by `route.ts`'s HTTP
response today), but `ticker_class` is a **required** field on `ProductSignal` (the base Largo
contract type every product surface must populate per C4 IDENTITY), and a second in-process
consumer that reads `adaptSwingBriefToLargo(...).data.ticker_class` — which is clearly the field's
intended purpose — would get a silently wrong, self-contradictory answer today.

**What's wrong.** `src/lib/swing/play-brief-adapter.ts`'s `adaptSwingBriefToLargo` computed
`ticker_class` via its own private `tickerClassFromTicker()` — a 6-name hardcoded ETF allowlist
(XLF/GLD/SLV/XBI/XLV/XLE) plus a 4-name index allowlist — instead of reusing
`SwingPlayBriefResult.ticker_class`, the field `composeSwingPlayBrief` (`play-brief.ts:1588`)
already derives correctly from the shared, actively-maintained `canonicalTicker` in
`src/lib/largo/core/entities.ts` (whose own header warns: *"This list being partial is safe for
[labelling]. It stopped being safe the moment Night Hawk Swings started reading `kind` for
Largo"* — exactly the situation this adapter recreated). The result: for any ticker in the real,
maintained ETF list but NOT in the adapter's own 6-name copy — e.g. **SQQQ**, the same
leveraged-ETF ticker `play-brief.test.ts`'s own regression test already covers for the native
field — `brief.ticker_class === "etf"` while `adaptSwingBriefToLargo(brief).data.ticker_class
=== "equity"` in the **same response**, the exact two-classifications-of-one-fact pattern the
2026-10-17 fix (`play-brief.ts` commit history) was written to eliminate.

**Also found in the same function, same cleanup:** an inert `if (envelope.tradeDecision?.ticker)`
block whose body was comments only (no assignment, no side effect — a half-finished
"populate archetype/sub_lane/entry/peak premium later" stub). `tradeDecision` is a wholly
unrelated field (`BieAnswerEnvelope.tradeDecision` — "Integrity supplement for play questions —
badges only," `ticker`/`actionLabel`/`signalRows`, no archetype/premium fields at all) that
`composeSwingPlayBrief` never sets, so the condition was structurally always false — guaranteed
dead code, not just unfinished. Removed rather than wired up: populating `archetype`/`sub_lane`/
`entry_premium`/`peak_premium`/`bucket`/`thesis_strength_pct`/`grade`/`invalidation` correctly
needs real plumbing from `ctx`/`play` the adapter doesn't receive today, and those fields are
optional on `SwingPlayBriefSignal` — a genuine follow-up, not a one-line fix, logged for Cursor/
next-session pickup via the standing #4076 collaboration thread rather than half-wired here.

**Root cause.** The adapter was written fresh (introduced this week as part of the in-flight
Largo-contract-compliance work, commit `4349848f5` and follow-ons) without reusing the one place
ticker classification was already correct and tested — a second, independently-hardcoded guess at
a fact one call away (`result.ticker_class`) or one import away (`canonicalTicker` from
`largo/core/entities.ts`, which the adapter doesn't import at all — it only imports the
differently-named, differently-shaped `canonicalTicker` from `largo/contract/product-read.ts`,
which normalizes a ticker STRING and has nothing to do with instrument classification; two
functions named `canonicalTicker` in two modules with unrelated return shapes is itself a latent
trap worth flagging for whoever touches this next).

**Fix.** `adaptSwingBriefToLargo` now takes `ticker_class` straight from the `SwingPlayBriefResult`
it's given (`const { ..., ticker_class, ... } = result`) — one brief, one classification, no
second guess. Deleted the now-dead `tickerClassFromTicker()` function (23 lines) and its
now-unused `TickerClass` type import, and deleted the inert `tradeDecision` if-block.

**Evidence.** New regression tests in `src/lib/swing/play-brief-adapter.test.ts` (the file had
zero test coverage before this fix): SQQQ fails RED on the pre-fix code
(`largoRead.data.ticker_class` returns `"equity"`, expected `"etf"`) and passes GREEN post-fix,
plus a same-response cross-check (`largoRead.data.ticker_class === brief.ticker_class`) and an
equity-ticker sanity case. `npx tsc --noEmit` clean; full `npm test` run on Node 20 green.

**Note for context:** production is currently serving pre-`play-brief-adapter.ts` code (the
standing ECS web deploy deadlock, 7+ consecutive failed deploys as of this writing — already
tracked, not re-escalated here), so this fix has not yet been observed live — confirmed by
diffing the live `GET /api/market/swing/play-brief` response (no `freshness`/`as_of`/`direction`/
etc. top-level fields present) against this file's own wiring in `route.ts`. Caught via static
review of the new, not-yet-deployed code rather than a live probe, since the live route can't yet
exercise it.
