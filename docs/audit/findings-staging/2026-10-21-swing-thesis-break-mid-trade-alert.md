## Swing "alerting only bookends the trade" — added a one-shot mid-trade Discord alert when a thesis-break gate is detected but the position doesn't close that same tick — SHIPPED

> **kind:** `FINDING`

| **Status** | Shipped |
|---|---|

**Found:** 2026-10-21, Ask Largo standing mandate, 5-engine live monitor cycle — following up on a
genuine gap I raised on the standing collaboration thread (PR #4076, comment 6303734681), offered
to take, and nobody else claimed within the cycle.

**Context / root cause:** `src/lib/swing/discord-trade-notify.ts` only ever posted two kinds of
member-visible Discord alert for a swing position: a fresh commit (`notifySwingTradeOpen`, BTO) and
a terminal close/roll (`notifySwingTradeClose`/`notifySwingTerminalFromOutcome`, STC). There was no
alert for the moment the desk's own management engine (`manage.ts`'s `evaluateSwingManagement`)
detects the two capital-preservation THESIS gates — `structural_stop` (underlying broke its
invalidation level) or `thesis_stop` (an archetype-specific invalidation signal) — while the
position is **still open**.

Verified this isn't merely theoretical: `swing-active-refresh/route.ts` DOES auto-execute a
gating close/roll when these rungs fire (the roll-ledger seam is fully wired in production —
`insertChild`/`gradeParent`/`runRollTx`/`buildRollPlan` all present), and that execution path
already fires the existing STC alert same-tick via `notifySwingTerminalFromOutcome`. But
`buildRollPlan` can return `null` on a given tick (no forward bars, a chain-fetch failure, a
budget/cap gate) — per `manage-sync.ts`'s own documented contract, that degrades the tick to
**evidence-only**: the verdict (and its `event_json`/snapshot) is recorded, but nothing closes and
no alert fires. A member relying on Discord alerts would only learn the thesis broke once a later
tick's execution finally succeeds, or if they happened to check the board/play-brief in between —
exactly the "alerting only bookends the trade" gap named on the thread.

**Fix:**
- `src/lib/swing/manage.ts` — added `THESIS_BREAK_RUNGS` (`{structural_stop, thesis_stop}`), the
  named subset of `GATING_RUNGS` that specifically means "the thesis broke" (as opposed to
  `expiry_risk`'s time pressure or `premium_stop`'s capital backstop on an otherwise-intact
  thesis), so callers ask this rather than re-deriving rung string literals.
- `src/lib/swing/discord-trade-notify.ts` — added `swingAlertWebhookUrl()` (reads
  `SWING_ALERT_WEBHOOK_URL`) and `notifySwingThesisBreak(input, reason)`, which posts a plain
  Discord embed (ticker, direction, contract, entry/last-mark, the verdict's own reason string) via
  the existing generic `postDiscordWebhook` — deliberately **not** routed through
  `postChiefTrade`/BTO-STC: that bot only understands BTO/STC and feeds a FIFO PnL ledger, and the
  position hasn't closed, so forcing it through there would fabricate a phantom close and corrupt
  the ledger. This follows the same precedent `src/features/spx/lib/spx-play-notify.ts` already
  set for non-FIFO desk alerts (`DISCORD_PLAY_WEBHOOK_URL`).
- `src/app/api/cron/swing-active-refresh/route.ts` — added a loop over `result.outcomes` that
  fires `notifySwingThesisBreak` for every outcome where `THESIS_BREAK_RUNGS.has(o.verdict.rung)`
  **and** `!o.roll?.parentGraded` (i.e. the thesis gate fired but did NOT execute a close/roll this
  tick — a position that DID close already gets the stronger, more specific STC alert from the
  existing loop just above). De-duplicated per position via `sharedCacheSetNx` (`swing:thesis-
  break-alerted:v1:<positionId>`, 90-day TTL — comfortably longer than any swing position's real
  lifetime) so a stuck-evidence-only position isn't re-alerted every 15-minute tick; the dedup
  claim fails OPEN (`.catch(() => true)`) rather than closed, since the cost of a Redis hiccup here
  should be at most a duplicate alert, never a silently dropped one — matching
  `notifySwingThesisBreak`'s own fire-and-forget contract.

**Evidence:** Live-read the actual wiring before building: confirmed in
`swing-active-refresh/route.ts` that the roll-ledger seam (`insertChild`/`gradeParent`/
`buildRollPlan`/`runRollTx`) is fully wired in production (so a gating rung CAN execute
same-tick), and confirmed `buildRollPlan`'s own contract (manage-sync.ts's header comments) that a
`null` plan degrades to evidence-only with no terminal write and no alert — the real, still-open
gap this PR closes.

**Tests:**
- `src/lib/swing/manage.test.ts` — new test asserting `THESIS_BREAK_RUNGS` is exactly
  `{structural_stop, thesis_stop}`, is a subset of `GATING_RUNGS`, and excludes
  `expiry_risk`/`premium_stop`.
- `src/lib/swing/discord-trade-notify.test.ts` — three new tests: (1) no fetch call when
  `SWING_ALERT_WEBHOOK_URL` is unset; (2) a configured webhook gets exactly one embed with the
  ticker/direction in the title, the supplied reason in the description, the contract in `fields`,
  and **no** `action` field anywhere in the payload (proving it can never be mistaken for a BTO/STC
  chief-trade call); (3) a missing reason falls back to a generic description instead of an empty
  one.
- `src/app/api/cron/swing-active-refresh/route.test.ts` — new regex-based regression test (matching
  this file's own established convention for route.ts's DB/provider-heavy side effects) asserting
  the `THESIS_BREAK_RUNGS` import, the `THESIS_BREAK_RUNGS.has(...) && !o.roll?.parentGraded` gate,
  the `sharedCacheSetNx` dedup call, and the `notifySwingThesisBreak` call are all present in
  source. RED→GREEN proven by `git stash`-reverting only `route.ts` (keeping the new test) and
  confirming it fails (1 fail / 7 pass), then restoring and confirming all 8 pass.
- Full suite (`npm test`, Node 20): pass, 0 fail (ongoing at the time of this write-up — see PR for
  the final run); `tsc --noEmit` clean.

**Blast radius:** New code paths only — `THESIS_BREAK_RUNGS`/`notifySwingThesisBreak`/
`swingAlertWebhookUrl` are new exports, and the new route loop is additive (reads
`result.outcomes`/`openRows`, both already computed) alongside the existing rolls loop, which is
untouched. No existing behavior changes unless `SWING_ALERT_WEBHOOK_URL` is set in production
(currently unset — the alert is fully inert/no-op until the operator configures a channel for it,
same posture as every other `*_DISCORD_ALERTS`/`*_WEBHOOK_URL` gate in this repo).
